import { homedir } from "node:os";
import path from "node:path";
import type {
  LogLevelName,
  SizeLimit,
  VLoggoConfig,
  VLoggoDirectory,
  VLoggoFilecount,
  VLoggoFormat,
  VLoggoOutputs,
  VLoggoRotation,
  VLoggoSMTPConfig,
  VLoggoUpdate,
} from "../interfaces/interfaces.js";

type SMTPInput = Partial<VLoggoSMTPConfig> & { to?: string | string[] };
type SMTPSettings = Readonly<VLoggoSMTPConfig> & { to: string | readonly string[] };
type ResolvedRotation = Readonly<{ retentionDays: number; maxFileSize: number; maxTotalSize: number }>;
type ResolvedConfig = Readonly<{
  client: string;
  level: LogLevelName;
  outputs: Readonly<Required<VLoggoOutputs>>;
  directory: Readonly<Required<VLoggoDirectory>>;
  filecount: Readonly<Required<VLoggoFilecount>>;
  rotation: ResolvedRotation;
  format: Readonly<Required<VLoggoFormat>>;
  redact: readonly string[];
  startupMessage: boolean;
  notify: boolean;
  throttle: number;
  notificationTimeout: number;
  retryDelay: number;
  smtp?: SMTPSettings;
  notificationIssue?: string;
}>;

const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

function copy(options: VLoggoConfig): VLoggoConfig {
  const smtp = options.smtp as SMTPInput | undefined;
  return {
    ...options,
    outputs: options.outputs && { ...options.outputs },
    directory: options.directory && { ...options.directory },
    filecount: options.filecount && { ...options.filecount },
    rotation: options.rotation && { ...options.rotation },
    format: options.format && { ...options.format },
    redact: options.redact && [...options.redact],
    smtp: smtp && { ...smtp, to: Array.isArray(smtp.to) ? [...smtp.to] : smtp.to } as VLoggoSMTPConfig,
  };
}

function numberOption(name: string, value: number, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

function booleanOption(name: string, value: boolean): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
  return value;
}

function stringOption(name: string, value: string): string {
  if (typeof value !== "string" || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) {
    throw new TypeError(`${name} must be a nonempty string without control characters`);
  }
  return value;
}

function parseSize(name: string, value: SizeLimit | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === "number") return numberOption(name, value, 1);
  const match = /^\s*(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?\s*$/i.exec(value);
  if (!match) throw new TypeError(`${name} must be a positive byte count, such as "20 MB"`);
  const unit = (match[2] ?? "B").toUpperCase();
  const multiplier = unit === "B" ? 1 : unit === "KB" ? 1024 : unit === "MB" ? 1024 ** 2 : unit === "GB" ? 1024 ** 3 : 1024 ** 4;
  const bytes = Number(match[1]) * multiplier;
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new TypeError(`${name} must resolve to a positive safe integer byte count`);
  return bytes;
}

function smtpFromEnv(): SMTPInput | undefined {
  const { SMTP_HOST: host, SMTP_PORT: port, SMTP_USERNAME: username,
    SMTP_PASSWORD: password, SMTP_FROM: from, SMTP_TO: to } = process.env;
  if (![host, port, username, password, from, to].some(value => value !== undefined)) return;
  return {
    host,
    port: port && /^\d+$/.test(port) ? Number(port) : undefined,
    username,
    password,
    from,
    to,
  };
}

function validateSmtp(input: SMTPInput | undefined): { smtp?: SMTPSettings; issue?: string } {
  if (!input) return { issue: "missing SMTP configuration" };
  const missing = (["host", "port", "username", "password", "from", "to"] as const)
    .filter(key => input[key] === undefined || input[key] === "");
  if (missing.length) return { issue: `incomplete SMTP configuration: ${missing.join(", ")}` };
  for (const key of ["host", "username", "password", "from"] as const) {
    if (typeof input[key] !== "string" || !input[key]!.trim() || /[\x00-\x1f\x7f]/.test(input[key]!)) {
      return { issue: `invalid SMTP field: ${key}` };
    }
  }
  const port = input.port!;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return { issue: "SMTP port must be an integer from 1 to 65535" };
  const recipients = Array.isArray(input.to) ? input.to : [input.to!];
  if (!recipients.length || recipients.some(recipient => typeof recipient !== "string" || !recipient.trim() || /[\x00-\x1f\x7f]/.test(recipient))) {
    return { issue: "SMTP recipients must be nonempty addresses" };
  }
  for (const key of ["connectionTimeout", "greetingTimeout", "socketTimeout"] as const) {
    if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || input[key]! < 1)) {
      return { issue: `SMTP ${key} must be a positive integer` };
    }
  }
  if (input.secure !== undefined && typeof input.secure !== "boolean") return { issue: "SMTP secure must be a boolean" };
  if (input.requireTLS !== undefined && typeof input.requireTLS !== "boolean") return { issue: "SMTP requireTLS must be a boolean" };
  if (input.debug !== undefined && typeof input.debug !== "boolean") return { issue: "SMTP debug must be a boolean" };
  return {
    smtp: Object.freeze({
      ...input,
      host: input.host!, port, username: input.username!, password: input.password!, from: input.from!,
      to: Array.isArray(input.to) ? Object.freeze([...input.to]) : input.to!,
      secure: input.secure ?? port === 465,
      requireTLS: input.requireTLS ?? false,
      debug: input.debug ?? false,
    }) as SMTPSettings,
  };
}

function resolve(options: VLoggoConfig): ResolvedConfig {
  const client = stringOption("client", options.client ?? "VLoggo");
  const directoryInput = options.directory;
  if ((!directoryInput?.txt || !directoryInput?.json) &&
      (client === "." || client === ".." || /[/\\]/.test(client))) {
    throw new TypeError("client must be a single directory name when using default directories");
  }
  const level = options.level ?? (options.debug ? "debug" : "info");
  if (!LOG_LEVELS.includes(level)) throw new TypeError(`level must be one of: ${LOG_LEVELS.join(", ")}`);
  const outputs = Object.freeze({
    console: booleanOption("outputs.console", options.outputs?.console ?? options.console ?? true),
    text: booleanOption("outputs.text", options.outputs?.text ?? true),
    json: booleanOption("outputs.json", options.outputs?.json ?? options.json ?? false),
  });
  const directory = Object.freeze({
    txt: path.resolve(stringOption("directory.txt", directoryInput?.txt ?? path.join(homedir(), client, "logs"))),
    json: path.resolve(stringOption("directory.json", directoryInput?.json ?? path.join(homedir(), client, "json"))),
  });
  const filecount = Object.freeze({
    txt: numberOption("filecount.txt", options.filecount?.txt ?? 31, 1),
    json: numberOption("filecount.json", options.filecount?.json ?? 31, 1),
  });
  const rotation: ResolvedRotation = Object.freeze({
    retentionDays: numberOption("rotation.retentionDays", options.rotation?.retentionDays ?? 31, 1),
    maxFileSize: parseSize("rotation.maxFileSize", options.rotation?.maxFileSize, 20 * 1024 ** 2),
    maxTotalSize: parseSize("rotation.maxTotalSize", options.rotation?.maxTotalSize, 1024 ** 3),
  });
  const timezone = options.format?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0); }
  catch { throw new TypeError(`format.timezone must be a valid IANA timezone: ${timezone}`); }
  const format = Object.freeze({ timezone });
  const redact = Object.freeze([...(options.redact ?? [])].map((field, index) => stringOption(`redact[${index}]`, field)));
  const startupMessage = booleanOption("startupMessage", options.startupMessage ?? false);
  let smtpInput = options.smtp as SMTPInput | undefined;
  if (options.notify !== false && !smtpInput) {
    smtpInput = smtpFromEnv();
  }
  const smtpResult = validateSmtp(smtpInput);
  const notify = booleanOption("notify", options.notify ?? Boolean(smtpResult.smtp));
  const notificationIssue = notify && !smtpResult.smtp
    ? (smtpResult.issue ?? "missing SMTP configuration")
    : undefined;
  // A partial environment configuration is intentionally silent unless notifications were explicitly enabled.
  const shouldExposeIssue = options.notify === true;
  return Object.freeze({
    client, level, outputs, directory, filecount, rotation, format, redact, startupMessage,
    notify, smtp: smtpResult.smtp, notificationIssue: shouldExposeIssue ? notificationIssue : undefined,
    throttle: numberOption("throttle", options.throttle ?? 30000, 0),
    notificationTimeout: numberOption("notificationTimeout", options.notificationTimeout ?? 10000, 1),
    retryDelay: numberOption("retryDelay", options.retryDelay ?? 1000, 0),
  });
}

/** Owns validated configuration. Updates are atomic and nested getters are immutable. */
export default class Config {
  private options: VLoggoConfig;
  private state: ResolvedConfig;
  private listeners = new Set<() => void>();

  /** Creates validated configuration. SMTP environment values are skipped when notify is false. */
  constructor(options?: VLoggoConfig | Config) {
    if (options instanceof Config) {
      this.options = copy(options.options);
    } else {
      const configured = copy(options ?? {});
      configured.client ??= process.env.CLIENT_NAME ?? "VLoggo";
      if (configured.notify !== false && !configured.smtp) {
        configured.smtp = smtpFromEnv() as VLoggoSMTPConfig | undefined;
      }
      this.options = configured;
    }
    this.state = resolve(this.options);
  }

  /** Atomically validates and applies configuration changes. Partial nested objects are merged. */
  update(update: VLoggoUpdate): void {
    const next = copy(this.options);
    if (update.client !== undefined) next.client = update.client;
    if (update.outputs) next.outputs = { ...next.outputs, ...update.outputs };
    if (update.console !== undefined) next.outputs = { ...next.outputs, console: update.console };
    if (update.json !== undefined) next.outputs = { ...next.outputs, json: update.json };
    if (update.level !== undefined) {
      next.level = update.level;
      next.debug = undefined;
    } else if (update.debug !== undefined) {
      next.debug = update.debug;
      next.level = undefined;
    }
    if (update.directory) next.directory = { ...next.directory, ...update.directory };
    if (update.filecount) next.filecount = { ...next.filecount, ...update.filecount };
    if (update.rotation) next.rotation = { ...next.rotation, ...update.rotation };
    if (update.format) next.format = { ...next.format, ...update.format };
    if (update.redact !== undefined) next.redact = [...update.redact];
    for (const key of ["startupMessage", "notify", "throttle", "notificationTimeout", "retryDelay"] as const) {
      if (update[key] !== undefined) Object.assign(next, { [key]: update[key] });
    }
    if (update.notify === true && update.smtp === undefined && !this.state.smtp) {
      next.smtp = smtpFromEnv() as VLoggoSMTPConfig | undefined;
    }
    if (update.smtp === null) {
      next.smtp = undefined;
    } else if (update.smtp !== undefined) {
      next.smtp = { ...next.smtp, ...update.smtp } as VLoggoSMTPConfig;
    }
    const owned = copy(next);
    const state = resolve(owned);
    this.options = owned;
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  /** Creates an independent configuration copy with optional overrides. */
  clone(overrides?: VLoggoUpdate): Config {
    const clone = new Config(this);
    if (overrides) clone.update(overrides);
    return clone;
  }

  /** Returns a detached snapshot suitable for constructing another logger. */
  toOptions(): VLoggoConfig {
    return copy({
      ...this.options,
      client: this.client,
      level: this.level,
      outputs: { ...this.outputs },
      directory: this.options.directory && { ...this.options.directory },
      filecount: { ...this.filecount },
      rotation: { retentionDays: this.rotation.retentionDays, maxFileSize: this.rotation.maxFileSize, maxTotalSize: this.rotation.maxTotalSize },
      format: { ...this.format },
      redact: [...this.redact],
      startupMessage: this.startupMessage,
      notify: this.notify,
      smtp: this.smtp as VLoggoSMTPConfig | undefined,
      throttle: this.throttle,
      notificationTimeout: this.notificationTimeout,
      retryDelay: this.retryDelay,
    });
  }

  /** @internal Subscribe without exposing mutable configuration state. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get client() { return this.state.client; }
  get level() { return this.state.level; }
  get outputs() { return this.state.outputs; }
  get directory() { return this.state.directory; }
  get filecount() { return this.state.filecount; }
  get rotation() { return this.state.rotation; }
  get format() { return this.state.format; }
  get redact() { return this.state.redact; }
  get startupMessage() { return this.state.startupMessage; }
  get notify() { return this.state.notify; }
  get throttle() { return this.state.throttle; }
  get notificationTimeout() { return this.state.notificationTimeout; }
  get retryDelay() { return this.state.retryDelay; }
  get smtp() { return this.state.smtp; }
  get notificationIssue() { return this.state.notificationIssue; }
  get console() { return this.state.outputs.console; }
  get json() { return this.state.outputs.json; }
  get debug() { return this.state.level === "debug"; }
  get text() { return this.state.outputs.text; }
}
