import * as os from "os";
import * as path from "path";
import FormatService from "../internal/formatService";

import type {
  VLoggoConfig,
  VLoggoSMTPConfig,
  VLoggoDirectory,
  VLoggoFilecount,
} from "../interfaces/interfaces";

/**
 * Configuration manager for VLoggo.
 * Manages all settings including SMTP, file rotation and debugging.
 *
 * @class Config
 */

class Config {
  private _client!: string;
  private _json: boolean;
  private _debug: boolean;
  private _console: boolean;

  private _filecount: VLoggoFilecount;
  private _directory!: VLoggoDirectory;

  private _notify: boolean;
  private _throttle: number;
  private _smtp: VLoggoSMTPConfig | undefined = undefined;

  private format: FormatService = new FormatService();

  /**
   * Creates a new Config instance.
   * Loads configuration from options or environment variables.
   *
   * @param {Partial<VLoggoConfig>} [options] - Optional configuration overrides
   *
   * @example
   * ```typescript
   * // Minimal config
   * const config = new Config({ client: 'MyApp' });
   *
   * // With SMTP
   * const config = new Config({
   *   client: 'MyApp',
   *   smtp: { host: '...', port: 465, ... }
   * });
   * ```
   */

  constructor(options?: Partial<VLoggoConfig>) {
    this._client = options?.client || process.env.CLIENT_NAME || "VLoggo";
    this._json = options?.json ?? false;
    this._debug = options?.debug ?? false;
    this._console = options?.console ?? true;

    this._filecount = options?.filecount ?? { txt: 31, json: 31 };
    this._directory = options?.directory || {
      txt: path.resolve(os.homedir(), this._client, "logs"),
      json: path.resolve(os.homedir(), this._client, "json"),
    };

    this._notify = options?.notify ?? false;
    this._throttle = options?.throttle ?? 30000;

    if (options?.smtp) {
      this._smtp = options.smtp as VLoggoSMTPConfig;
      this._notify = true;
    } else {
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
        `[VLoggo] > [${this.client}] [${this.format.date()}] [WARN] : notification service disabled > missing configuration`,
      );
      this._notify = false;
      return;
    }

    const port = parseInt(portStr);
    if (isNaN(port) || port <= 0 || port > 65535) {
      console.error(
        `[VLoggo] > [${this.client}] [${this.format.date()}] [ERROR] : notification service disabled > invalid port - ${portStr}.`,
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
   * @param {Partial<VLoggoConfig> & { smtp?: Partial<VLoggoSMTPConfig> }} options - Configuration properties to update
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
    options: Partial<VLoggoConfig> & { smtp?: Partial<VLoggoSMTPConfig> },
  ): void {
    if (options.client) {
      this._client = options.client;
    }

    if (options.json !== undefined) {
      this._json = options.json;
    }

    if (options.debug !== undefined) {
      this._debug = options.debug;
    }

    if (options.console !== undefined) {
      this._console = options.console;
    }

    if (options.filecount) {
      if (options.filecount.txt) {
        this._filecount.txt = options.filecount.txt;
      }
      if (options.filecount.json) {
        this._filecount.json = options.filecount.json;
      }
    }

    if (options.directory) {
      if (options.directory.txt) {
        this._directory.txt = options.directory.txt;
      }
      if (options.directory.json) {
        this._directory.json = options.directory.json;
      }
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
      } as VLoggoSMTPConfig;
    }
  }

  /**
   * Creates a clone of this config with optional overrides.
   * The original config is not modified.
   *
   * @param {Partial<VLoggoConfig>} [overrides] - Properties to override in the cloned config
   * @returns {Config} New Config instance with overrides applied
   *
   * @example
   * ```typescript
   * const baseConfig = new Config();
   * const apiConfig = baseConfig.clone({ client: 'API' });
   * ```
   */

  clone(overrides?: Partial<VLoggoConfig>): Config {
    return new Config({
      client: overrides?.client ?? this._client,
      json: overrides?.json ?? this._json,
      debug: overrides?.debug ?? this._debug,
      console: overrides?.console ?? this._console,

      directory: overrides?.directory ?? this._directory,
      filecount: overrides?.filecount ?? this._filecount,

      throttle: overrides?.throttle ?? this._throttle,
      notify: overrides?.notify ?? this._notify,
      smtp: overrides?.smtp ?? this._smtp,
    });
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
   * Gets whether json mode is enabled.
   *
   * @readonly
   * @returns {boolean} True if debug mode is enabled
   */

  get json(): boolean {
    return this._json;
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
   * Gets the maximum number of log files to keep.
   *
   * @readonly
   * @returns {number} Maximum file count before rotation
   */

  get filecount(): VLoggoFilecount {
    return this._filecount;
  }

  /**
   * Gets the log directory path.
   *
   * @readonly
   * @returns {string} Absolute path to log directory
   */

  get directory(): VLoggoDirectory {
    return this._directory;
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
   * @returns {VLoggoSMTPConfig | undefined} SMTP config object or undefined if not configured
   */

  get smtp(): VLoggoSMTPConfig | undefined {
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

export const defaultConfig: VLoggoConfig = {
  client: "VLoggo",
  json: false,
  debug: false,
  console: true,
  filecount: { txt: 31, json: 31 },
  directory: {
    txt: path.resolve(os.homedir(), "VLoggo", "logs"),
    json: path.resolve(os.homedir(), "VLoggo", "json"),
  },
  throttle: 30000,
  notify: false, // Importante: false por padrão
  smtp: undefined,
};

export default Config;
