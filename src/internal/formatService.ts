import { LogEntry } from "../interfaces/interfaces";

/**
 * Service responsible for formatting log-related strings.
 * Provides utilities for date formatting, filename generation, separators, and caller traceability.
 *
 * @class FormatService
 */

class FormatService {
  constructor(private client?: string) {
    if (!client) {
      client = "Loggo";
    }
  }

  /**
   * Formats a date object into DD/MM/YYYY HH:mm:ss format.
   * @param date - Date to format
   * @returns Formatted date string
   * @example
   * ```typescript
   * formatter.formatDate(new Date())
   * // "29/10/2025 14:30:15"
   * ```
   */

  date(date: Date = new Date()): string {
    const pad = (num: number) => num.toString().padStart(2, "0");
    const d = pad(date.getDate());
    const m = pad(date.getMonth() + 1);
    const y = date.getFullYear();
    const h = pad(date.getHours());
    const min = pad(date.getMinutes());
    const s = pad(date.getSeconds());
    return `${d}/${m}/${y} ${h}:${min}:${s}`;
  }

  /**
   * Formats a filename based on the current date (YYYY-MM-DD).
   * @returns Filename in format log-YYYY-MM-DD.txt
   * @example
   * ```typescript
   * formatter.formatFilename()
   * // "log-2025-10-29.txt"
   * ```
   */
  
  filename(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `log-${year}-${month}-${day}.txt`;
  }

  /**
   * Formats a complete log entry into a single line.
   * @param entry - Log entry to format
   * @returns Formatted log line
   * @example
   * ```typescript
   * const line = formatter.formatLogLine(entry);
   * // "[MyApp] [29/10/2025 14:30:15] [INFO] [APP001] [Main]: Application started\n"
   * ```
   */

  line(entry: LogEntry): string {
    const timestamp = this.date(new Date());
    return `[${this.client}] [${timestamp}] [${entry.level}] [${entry.code}] [${entry.caller}]: ${entry.message}\n`;
  }

  /**
   * Creates a separator line for log file initialization.
   * @param message - Optional message to include
   * @returns Formatted separator with message
   */

  separator(): string {
    const separator = "\n" + "_".repeat(50) + "\n\n";
    const timestamp = this.date();
    return `${separator}[${this.client}] [${timestamp}] [INIT] : loggo initialized successfully \n`;
  }

  /**
   * Gets caller location as "file.ts:line"
   * @param skip - Number of stack frames to skip (default: 0)
   * @returns Formatted string like "server.ts:123" or empty string if failed
   */

  caller(skip: number = 0): string {
    const err = new Error();
    const stack = err.stack;

    if (!stack) {
      return "(unknow:0)";
    }

    const lines = stack.split("\n");
    const targetLine = lines[skip + 2];

    if (!targetLine) {
      return "(unknow:0)";
    }

    const match =
      targetLine.match(/\((.+?):(\d+):\d+\)/) ||
      targetLine.match(/at\s+(.+?):(\d+):\d+/);

    if (!match) {
      return "(unknow:0)";
    }

    const [, filepath, line] = match;
    const filename = filepath.split(/[/\\]/).pop() || filepath;

    return `${filename}:${line}`;
  }
}

export default FormatService;
