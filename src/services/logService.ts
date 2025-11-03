import { LogEntry, LogLevel } from "../interfaces/interfaces";

import FileService from "../internal/fileService";
import EmailService from "../internal/emailService";
import FormatService from "../internal/formatService";
import Config, { defaultConfig } from "../config/config";

export class Loggo {
  private fileService: FileService;
  private emailService: EmailService;
  private formatService: FormatService;

  constructor(private _config: Config = defaultConfig) {
    this.fileService = new FileService(this._config);
    this.formatService = new FormatService(this._config.client);
    this.emailService = new EmailService(this._config);

    this.fileService.initialize();
  }

  get config(): Config {
    return this._config;
  }

  private log(level: LogLevel, code: string, message: string): void {
    if (!this.fileService.initialized) {
      console.error(
        `[Loggo] > [${this._config.client}] [${this.formatService.date()}] [ERROR] : loggo not initialized > skipping log`
      );
      return;
    }

    this.fileService.verify();

    const entry: LogEntry = {
      level,
      code,
      caller: this.formatService.caller(2),
      message,
      timestamp: this.formatService.date(),
    };

    const line = this.formatService.line(entry);
    this.fileService.write(line);

    if (this._config.console) {
      console.log(line.trim());
    }
  }

  info(code: string, text: string): void {
    this.log("INFO", code, text);
  }

  warn(code: string, text: string): void {
    this.log("WARN", code, text);
  }

  debug(code: string, text: string): void {
    this.log("DEBUG", code, text);
  }

  error(code: string, text: string): void {
    this.log("ERROR", code, text);
  }

  fatal(code: string, text: string): void {
    this.log("FATAL", code, text);

    if (!this.emailService.ready) {
      if (this._config.debug) {
        console.log(
          `[Loggo] > [${this._config.client}] [${this.formatService.date()}] [INFO] : notification service not ready`
        );
      }
      return;
    }

    this.emailService
      .sendErrorNotification(this._config.client, code, text)
      .catch((error) =>
        console.error(
          `[Loggo] > [${this._config.client}] [${this.formatService.date()}] [ERROR] : failed to send error message > ${(error as Error).message}`
        )
      );
  }
}
