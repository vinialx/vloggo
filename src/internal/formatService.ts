import { LogEntry } from "../interfaces/interfaces";

class FormatService {

  formatDate(date: Date = new Date()): string {
    const pad = (num: number) => num.toString().padStart(2, "0");
    const d = pad(date.getDate());
    const m = pad(date.getMonth() + 1);
    const y = date.getFullYear();
    const h = pad(date.getHours());
    const min = pad(date.getMinutes());
    const s = pad(date.getSeconds());
    return `${d}/${m}/${y} ${h}:${min}:${s}`;
  }

  formatFilename(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `log-${year}-${month}-${day}.txt`;
  }

  formatLogLine(entry: LogEntry): string {
    const timestamp = this.formatDate(entry.timestamp);
    return `[${entry.clientName}] [${timestamp}] [${entry.level}] [${entry.code}] [${entry.module}]: ${entry.text}\n`;
  }

  formatSeparator(message: string): string {
    const separator = "\n" + "_".repeat(50) + "\n\n";
    const timestamp = this.formatDate();
    return `${separator}[${this.clientName}] [${timestamp}] ${message}\n`;
  }
}
