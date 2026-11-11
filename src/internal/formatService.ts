import { randomUUID } from "node:crypto";
import type { LogData, LogEntry } from "../interfaces/interfaces.js";

/** Escape control characters so each text event stays on one physical line. */
export function safeText(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, character => {
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

function timezoneParts(date: Date, timezone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return safeText(value).replace(/\s+/g, " ").trim();
  if (value === null || typeof value !== "object") return safeText(String(value));
  return safeText(JSON.stringify(value));
}

function headerText(value: string): string {
  return safeText(value).replace(/[\[\]]/g, character => `\\${character}`);
}

/** Formats one structured event consistently across console, text, JSON, and email. */
export default class FormatService {
  constructor(private client = "VLoggo", private timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC") {}

  setTimezone(timezone: string): void { this.timezone = timezone; }

  id(): string { return randomUUID(); }

  shortId(eventId: string): string { return `evt-${eventId.replaceAll("-", "").slice(0, 8)}`; }

  date(date: Date = new Date()): string {
    const part = timezoneParts(date, this.timezone);
    return `${part.day}/${part.month}/${part.year} ${part.hour}:${part.minute}:${part.second}.${part.fractionalSecond}`;
  }

  emailDate(date: Date): string { return `${this.date(date)} ${this.timezone}`; }

  isoDate(date: Date = new Date()): string { return date.toISOString(); }

  day(date: Date = new Date()): string {
    const part = timezoneParts(date, this.timezone);
    return `${part.year}-${part.month}-${part.day}`;
  }

  filename(date: Date = new Date(), sequence = 0): string {
    return `log-${this.day(date)}${sequence ? `.${String(sequence).padStart(3, "0")}` : ""}.txt`;
  }

  jsonFilename(date: Date = new Date(), sequence = 0): string {
    return `log-${this.day(date)}${sequence ? `.${String(sequence).padStart(3, "0")}` : ""}.jsonl`;
  }

  line(entry: LogEntry): string {
    const id = this.shortId(entry.eventId);
    const level = entry.level.padEnd(5, " ");
    const message = safeText(entry.message).replace(/\s+/g, " ").trim();
    const fields: string[] = [];
    for (const [key, value] of Object.entries(entry.context ?? {})) fields.push(`${key}=${displayValue(value)}`);
    for (const [key, value] of Object.entries(entry.data ?? {})) fields.push(`${key}=${displayValue(value)}`);
    if (entry.error) fields.push(`error=${displayValue({ name: entry.error.name, message: entry.error.message })}`);
    const suffix = fields.length ? ` > ${fields.join(" > ")}` : "";
    return `[${headerText(entry.client)}] [${this.date(new Date(entry.timestamp))}] [${id}] [${level}] [${headerText(entry.code)}] : ${message}${suffix}\n`;
  }

  jsonLine(entry: LogEntry): string { return `${JSON.stringify(entry)}\n`; }

  caller(): string {
    const stack = new Error().stack?.split("\n").slice(1) ?? [];
    for (const line of stack) {
      const match = line.match(/\((.+?):(\d+):\d+\)/) ?? line.match(/at\s+(.+?):(\d+):\d+/);
      if (!match) continue;
      const filepath = match[1];
      if (/[/\\](?:internal\/formatService|internal\/redactionService|services\/logService)\.(?:js|ts)$/.test(filepath)) continue;
      return `${filepath.split(/[/\\]/).pop()}:${match[2]}`;
    }
    return "(unknown:0)";
  }
}
