import * as os from "os";
import * as path from "path";
import FormatService from "../internal/formatService";

import { LoggoConfig, LoggoSMTPConfig } from "../interfaces/interfaces";

/**
 * Configuration manager for Loggo.
 * Manages all settings including SMTP, file rotation and debugging.
 *
 * @class Config
 */

class Config {
  private _debug: boolean;
  private _client!: string;
  private _notify: boolean;
  private _console: boolean;
  private _throttle: number;
  private _filecount: number;
  private _directory!: string;
  private _smtp: LoggoSMTPConfig | undefined = undefined;

  private format: FormatService = new FormatService();

  /**
   * Creates a new Config instance.
   * Loads configuration from options or environment variables.
   *
   * @param {Partial<LoggoConfig>} [options] - Optional configuration overrides
   *
   * @example
   * ```typescript
   * // Use default config (from .env)
   * const config = new Config();
   *
   * // Custom config
   * const customConfig = new Config({
   *   client: 'MyApp',
   *   directory: './logs',
   *   console: false
   * });
   *
   * // Clone with overrides
   * const apiConfig = config.clone({ client: 'API' });
   * ```
   */

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

  /**
   * Loads SMTP configuration from environment variables.
   * Validates port number and sets secure flag based on port 465.
   * Disables notifications if any required environment variable is missing or invalid.
   *
   * Required environment variables:
   * - SMTP_TO: Recipient email address
   * - SMTP_FROM: Sender email address
   * - SMTP_HOST: SMTP server hostname
   * - SMTP_PORT: SMTP server port
   * - SMTP_USERNAME: SMTP authentication username
   * - SMTP_PASSWORD: SMTP authentication password
   *
   * @private
   * @returns {void}
   */

  private loadSMTPFromEnv(): void {
    const to = process.env.SMTP_TO;
    const from = process.env.SMTP_FROM;
    const host = process.env.SMTP_HOST;
    const portStr = process.env.SMTP_PORT;
    const username = process.env.SMTP_USERNAME;
    const password = process.env.SMTP_PASSWORD;

    if (!to || !from || !host || !portStr || !username || !password) {
      console.warn(
        `[Loggo] > [${this.client}] [${this.format.date()}] [WARN] : notification service disabled > missing configuration`
      );
      this._notify = false;
      return;
    }

    const port = parseInt(portStr);
    if (isNaN(port) || port <= 0 || port > 65535) {
      console.error(
        `[Loggo] > [${this.client}] [${this.format.date()}] [ERROR] : notification service disabled > invalid port - ${portStr}.`
      );
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
   * Updates configuration properties.
   * Only updates properties that are provided in the options parameter.
   * Supports partial SMTP configuration updates - merges with existing SMTP settings.
   *
   * @param {Partial<LoggoConfig> & { smtp?: Partial<LoggoSMTPConfig> }} options - Configuration properties to update
   * @returns {void}
   *
   * @example
   * ```typescript
   * // Update simple properties
   * config.update({ debug: false, throttle: 60000 });
   *
   * // Update only specific SMTP properties
   * config.update({
   *   smtp: {
   *     host: 'new-smtp.example.com',
   *     port: 587
   *   }
   * });
   * ```
   */
  update(
    options: Partial<LoggoConfig> & { smtp?: Partial<LoggoSMTPConfig> }
  ): void {
    if (options.client) {
      this._client = options.client;
    }
    if (options.directory) {
      this._directory = options.directory;
    }

    if (options.debug !== undefined) {
      this._debug = options.debug;
    }

    if (options.console !== undefined) {
      this._console = options.console;
    }

    if (options.filecount) {
      this._filecount = options.filecount;
    }

    if (options.notify !== undefined) {
      this._notify = options.notify;
    }

    if (options.throttle) {
      this._throttle = options.throttle;
    }

    if (options.smtp) {
      this._smtp = {
        ...this._smtp,
        ...options.smtp,
      } as LoggoSMTPConfig;
    }
  }

  /**
   * Creates a clone of this config with optional overrides.
   * The original config is not modified.
   *
   * @param {Partial<LoggoConfig>} [overrides] - Properties to override in the cloned config
   * @returns {Config} New Config instance with overrides applied
   *
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
   *
   * @readonly
   * @returns {boolean} True if debug mode is enabled
   */

  get debug(): boolean {
    return this._debug;
  }

  /**
   * Gets whether console output is enabled.
   *
   * @readonly
   * @returns {boolean} True if console output is enabled
   */

  get console(): boolean {
    return this._console;
  }

  /**
   * Gets the client/application name.
   *
   * @readonly
   * @returns {string} Client/application name
   */
  get client(): string {
    return this._client;
  }

  /**
   * Gets the log directory path.
   *
   * @readonly
   * @returns {string} Absolute path to log directory
   */
  get directory(): string {
    return this._directory;
  }

  /**
   * Gets the maximum number of log files to keep.
   *
   * @readonly
   * @returns {number} Maximum file count before rotation
   */
  get filecount(): number {
    return this._filecount;
  }

  /**
   * Gets whether email notifications are enabled.
   *
   * @readonly
   * @returns {boolean} True if email notifications are enabled
   */
  get notify(): boolean {
    return this._notify;
  }

  /**
   * Gets the SMTP configuration.
   *
   * @readonly
   * @returns {LoggoSMTPConfig | undefined} SMTP config object or undefined if not configured
   */
  get smtp(): LoggoSMTPConfig | undefined {
    return this._smtp;
  }

  /**
   * Gets the email throttle time in milliseconds.
   *
   * @readonly
   * @returns {number} Throttle time in milliseconds
   */
  get throttle(): number {
    return this._throttle;
  }
}

export const defaultConfig = new Config();
export default Config;
