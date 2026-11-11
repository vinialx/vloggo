import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type Config from "../config/config.js";
import FormatService from "./formatService.js";
import { diagnostic } from "./diagnostics.js";

type Sink = "txt" | "json";
interface FileState { filename: string; day: string; sequence: number; ready: boolean }
interface ManagedFile { filename: string; day: string; sequence: number; size: number; sink: Sink }

const EMPTY: FileState = { filename: "", day: "", sequence: 0, ready: false };
const activeOwners = new Map<string, Set<FileService>>();

function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }

function dateOrdinal(day: string): number { return Date.parse(`${day}T00:00:00Z`); }

function appendNoFollow(filename: string, content: string): void {
  const flags = fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW;
  const descriptor = fs.openSync(filename, flags, 0o666);
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error("log target is not a regular file");
    if (content) fs.writeSync(descriptor, content, undefined, "utf8");
  } finally { fs.closeSync(descriptor); }
}

/** Synchronous appends with independent outputs and asynchronous, serialized retention. */
export default class FileService {
  private files: Record<Sink, FileState> = { txt: { ...EMPTY }, json: { ...EMPTY } };
  private format: FormatService;
  private cleanup: Promise<void> = Promise.resolve();
  private cleanupScheduled = false;
  private cleanupAgain = false;
  private cleanupDate = new Date();
  private reported = new Set<string>();

  constructor(private config: Config) { this.format = new FormatService(config.client, config.format.timezone); }

  initialize(date: Date = new Date()): void {
    this.format.setTimezone(this.config.format.timezone);
    this.ensure("txt", date, 0);
    this.ensure("json", date, 0);
    this.scheduleCleanup(date);
  }

  private ensure(sink: Sink, date: Date, nextBytes: number): void {
    if (sink === "txt" ? !this.config.outputs.text : !this.config.outputs.json) {
      this.setFile(sink, { ...EMPTY });
      return;
    }
    const directory = this.config.directory[sink];
    const day = this.format.day(date);
    const extension = sink === "txt" ? "txt" : "jsonl";
    const current = this.files[sink];
    try {
      fs.mkdirSync(directory, { recursive: true });
      const pattern = new RegExp(`^log-${day.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.(\\d+))?\\.${extension}$`);
      const candidates = fs.readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile() && pattern.test(entry.name))
        .map(entry => {
          const match = pattern.exec(entry.name)!;
          const sequence = Number(match[1] ?? 0);
          const filename = path.join(directory, entry.name);
          return { filename, sequence, size: fs.statSync(filename).size };
        })
        .sort((left, right) => right.sequence - left.sequence);
      const latest = candidates[0];
      let selected: { filename: string; sequence: number; size: number } | undefined;
      if (current.ready && current.day === day && path.dirname(current.filename) === directory) {
        const size = fs.statSync(current.filename).size;
        if (current.sequence === latest?.sequence && (size === 0 || size + nextBytes <= this.config.rotation.maxFileSize)) {
          selected = { filename: current.filename, sequence: current.sequence, size };
        }
      }
      if (!selected) {
        selected = latest && (latest.size === 0 || latest.size + nextBytes <= this.config.rotation.maxFileSize)
          ? latest
          : undefined;
        if (!selected) {
          const sequence = candidates.length ? candidates[0].sequence + 1 : 0;
          const filename = path.join(directory, sink === "txt"
            ? this.format.filename(date, sequence)
            : this.format.jsonFilename(date, sequence));
          selected = { filename, sequence, size: 0 };
        }
      }
      for (let attempt = 0; ; attempt++) {
        try {
          appendNoFollow(selected.filename, "");
          break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (!["ELOOP", "EISDIR"].includes(code ?? "") || attempt >= 100) throw error;
          selected.sequence++;
          selected.filename = path.join(directory, sink === "txt"
            ? this.format.filename(date, selected.sequence)
            : this.format.jsonFilename(date, selected.sequence));
        }
      }
      this.setFile(sink, { filename: selected.filename, day, sequence: selected.sequence, ready: true });
      this.reported.delete(`${sink}:${directory}`);
    } catch (error) {
      this.setFile(sink, { ...EMPTY, day });
      this.reportOnce(`${sink}:${directory}`, `failed to initialize ${sink} log file`, error);
    }
  }

  write(text: string | undefined, json?: string, date: Date = new Date()): void {
    this.format.setTimezone(this.config.format.timezone);
    for (const sink of ["txt", "json"] as const) {
      const content = sink === "txt" ? text : json;
      if (content === undefined) continue;
      const bytes = Buffer.byteLength(content, "utf8");
      this.ensure(sink, date, bytes);
      let state = this.files[sink];
      if (!state.ready) continue;
      try {
        appendNoFollow(state.filename, content);
        this.reported.delete(`${sink}:${this.config.directory[sink]}`);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ELOOP" || code === "EISDIR") {
          this.setFile(sink, { ...state, ready: false });
          this.ensure(sink, date, bytes);
          state = this.files[sink];
          if (state.ready) {
            try {
              appendNoFollow(state.filename, content);
              this.reported.delete(`${sink}:${this.config.directory[sink]}`);
              continue;
            } catch (retryError) { error = retryError; }
          }
        }
        this.setFile(sink, { ...state, ready: false });
        this.reportOnce(`${sink}:${this.config.directory[sink]}`, `failed to write ${sink} log file`, error);
      }
    }
    this.scheduleCleanup(date);
  }

  private reportOnce(key: string, message: string, error: unknown): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    diagnostic(this.config, message, error);
  }

  private setFile(sink: Sink, state: FileState): void {
    const previous = this.files[sink];
    if (previous.ready && (!state.ready || previous.filename !== state.filename)) {
      const owners = activeOwners.get(previous.filename);
      owners?.delete(this);
      if (!owners?.size) activeOwners.delete(previous.filename);
    }
    this.files[sink] = state;
    if (state.ready) {
      let owners = activeOwners.get(state.filename);
      if (!owners) activeOwners.set(state.filename, owners = new Set());
      owners.add(this);
    }
  }

  private scheduleCleanup(date: Date): void {
    if (!this.config.outputs.text && !this.config.outputs.json) return;
    this.cleanupDate = new Date(date);
    if (this.cleanupScheduled) {
      this.cleanupAgain = true;
      return;
    }
    this.cleanupScheduled = true;
    this.cleanup = this.cleanup.then(() => this.cleanupFiles(date)).catch(error => {
      diagnostic(this.config, "logger cleanup failed", error);
    }).finally(() => {
      this.cleanupScheduled = false;
      if (this.cleanupAgain) {
        this.cleanupAgain = false;
        this.scheduleCleanup(this.cleanupDate);
      }
    });
  }

  private async managedFiles(): Promise<ManagedFile[]> {
    const result: ManagedFile[] = [];
    for (const sink of ["txt", "json"] as const) {
      if (sink === "txt" ? !this.config.outputs.text : !this.config.outputs.json) continue;
      const directory = this.config.directory[sink];
      const extension = sink === "txt" ? "txt" : "jsonl";
      let entries: fs.Dirent[];
      try { entries = await fsp.readdir(directory, { withFileTypes: true }); }
      catch (error) { if (missing(error)) continue; throw error; }
      const pattern = new RegExp(`^log-(\\d{4}-\\d{2}-\\d{2})(?:\\.(\\d+))?\\.${extension}$`);
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const match = pattern.exec(entry.name);
        if (!match) continue;
        const ordinal = dateOrdinal(match[1]);
        if (!Number.isFinite(ordinal) || new Date(ordinal).toISOString().slice(0, 10) !== match[1]) continue;
        const filename = path.join(directory, entry.name);
        try { result.push({ filename, day: match[1], sequence: Number(match[2] ?? 0), size: (await fsp.stat(filename)).size, sink }); }
        catch (error) { if (!missing(error)) throw error; }
      }
    }
    return result;
  }

  private async remove(file: ManagedFile): Promise<boolean> {
    if (activeOwners.has(file.filename)) return false;
    try { await fsp.unlink(file.filename); return true; }
    catch (error) { if (missing(error)) return true; diagnostic(this.config, "failed to remove expired log file", error); return false; }
  }

  private async cleanupFiles(date: Date): Promise<void> {
    let files = await this.managedFiles();
    const today = dateOrdinal(this.format.day(date));
    const oldestDay = today - (this.config.rotation.retentionDays - 1) * 86400000;
    for (const file of files) {
      if (dateOrdinal(file.day) < oldestDay && await this.remove(file)) {
        files = files.filter(candidate => candidate.filename !== file.filename);
      }
    }

    for (const sink of ["txt", "json"] as const) {
      const matching = files.filter(file => file.sink === sink)
        .sort((left, right) => right.day.localeCompare(left.day) || right.sequence - left.sequence);
      const protectedFiles = matching.filter(file => activeOwners.has(file.filename));
      const retained = new Set([...protectedFiles, ...matching.filter(file => file.filename !== this.files[sink].filename).slice(0, Math.max(0, this.config.filecount[sink] - protectedFiles.length))].map(file => file.filename));
      for (const file of matching) {
        if (!retained.has(file.filename) && await this.remove(file)) files = files.filter(candidate => candidate.filename !== file.filename);
      }
    }

    let total = files.reduce((sum, file) => sum + file.size, 0);
    if (total <= this.config.rotation.maxTotalSize) return;
    files.sort((left, right) => left.day.localeCompare(right.day) || left.sequence - right.sequence);
    for (const file of files) {
      if (total <= this.config.rotation.maxTotalSize) break;
      if (await this.remove(file)) total -= file.size;
    }
  }

  async flush(): Promise<void> {
    while (true) {
      const pending = this.cleanup;
      await pending;
      if (pending === this.cleanup && !this.cleanupScheduled) return;
    }
  }

  deactivate(): void {
    this.setFile("txt", { ...EMPTY });
    this.setFile("json", { ...EMPTY });
  }

  get initialized(): boolean {
    return (!this.config.outputs.text || this.files.txt.ready) && (!this.config.outputs.json || this.files.json.ready);
  }
}
