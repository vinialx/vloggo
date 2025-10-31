import * as os from "os";
import * as path from "path";

import { LoggoConfig, LoggoSMTPConfig } from "../interfaces/interfaces";

class Config {
  private _debug: boolean;
  private _console: boolean;

  private _client!: string;
  private _filecount: number;
  private _directory!: string;

  private _notify: boolean;
  private _throttle: number;
  private _smtp: LoggoSMTPConfig | undefined = undefined;

  constructor(options?: Partial<LoggoConfig>) {
    this._debug = options?.debug ?? true;
    this._console = options?.console ?? true;

    this._client = options?.client || process.env.CLIENT_NAME || "Loggo";
    this._filecount = options?.filecount ?? 31;
    this._directory =
      options?.directory || path.resolve(os.homedir(), this._client, "logs");

    this._notify = options?.notify ?? true;
    this._throttle = options?.throttle ?? 30000;

    if (options?.smtp && this._notify) {
      this._smtp = options.smtp;
    } else {
      this._smtp = undefined;
      this._notify = false;
      this.loadSMTPFromEnv();
    }
  }

  private loadSMTPFromEnv(): void {
    const to = process.env.SMTP_TO;
    const from = process.env.SMTP_FROM;
    const host = process.env.SMTP_HOST;
    const portStr = process.env.SMTP_PORT;
    const username = process.env.SMTP_USERNAME;
    const password = process.env.SMTP_PASSWORD;

    if (!to || !from || !host || !portStr || !username || !password) {
      console.warn("[Loggo] SMTP disabled: missing configuration.");
      this._notify = false;
      return;
    }

    const port = parseInt(portStr);
    if (isNaN(port) || port <= 0 || port > 65535) {
      console.warn(`[Loggo] SMTP disabled: invalid port "${portStr}".`);
      this._notify = false;
      return;
    }

    const secure = port === 465 ? true : false;

    this._smtp = {
      to,
      from,
      host,
      port,
      username,
      password,
      secure,
    };

    this._notify = true;
  }

  /**
   * Creates a clone of this config with optional overrides.
   * The original config is not modified.
   * @param overrides - Properties to override in the cloned config
   * @returns New Config instance with overrides applied
   * @example
   * ```typescript
   * const baseConfig = new Config();
   * const apiConfig = baseConfig.clone({ client: 'API' });
   * ```
   */

  clone(overrides?: Partial<LoggoConfig>): Config {
    return new Config({
      client: overrides?.client ?? this._client,
      directory: overrides?.directory ?? this._directory,
      debug: overrides?.debug ?? this._debug,
      console: overrides?.console ?? this._console,
      filecount: overrides?.filecount ?? this._filecount,
      throttle: overrides?.throttle ?? this._throttle,
      notify: overrides?.notify ?? this._notify,
      smtp: overrides?.smtp ?? this._smtp,
    });
  }

  /**
   * Gets whether debug mode is enabled.
   */
  get debug(): boolean {
    return this._debug;
  }

  /**
   * Gets whether console output is enabled.
   */
  get console(): boolean {
    return this._console;
  }

  /**
   * Gets the client/application name.
   */
  get client(): string {
    return this._client;
  }

  /**
   * Gets the log directory path.
   */
  get directory(): string {
    return this._directory;
  }

  /**
   * Gets the maximum number of log files to keep.
   */
  get filecount(): number {
    return this._filecount;
  }

  /**
   * Gets whether email notifications are enabled.
   */
  get notify(): boolean {
    return this._notify;
  }

  /**
   * Gets the email throttle time in milliseconds.
   */
  get throttle(): number {
    return this._throttle;
  }
}

export default Config;
