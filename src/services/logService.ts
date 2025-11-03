import { LogEntry, LogLevel } from "../interfaces/interfaces";

import FileService from "../internal/fileService";
import EmailService from "../internal/emailService";
import FormatService from "../internal/formatService";
import Config, { defaultConfig } from "../config/config";

/**
 * Main logging service for Loggo.
 * Provides methods for logging at different severity levels with automatic file writing,
 * console output, and email notifications for critical errors.
 *
 * @class Loggo
 */

export class Loggo {
  private fileService: FileService;
  private emailService: EmailService;
  private formatService: FormatService;

  /**
   * Main logging service for Loggo.
   * Provides methods for logging at different severity levels with automatic file writing,
   * console output, and email notifications for critical errors.
   *
   * @class Loggo
   */

  constructor(private _config: Config = defaultConfig) {
    this.fileService = new FileService(this._config);
    this.formatService = new FormatService(this._config.client);
    this.emailService = new EmailService(this._config);

    this.fileService.initialize();
  }

  /**
   * Gets the current configuration.
   *
   * @readonly
   * @returns {Config} Current configuration object
   */

  get config(): Config {
    return this._config;
  }

  /**
   * Internal logging method that handles log entry creation and writing.
   * Verifies file rotation, formats the log entry with caller information,
   * writes to file and optionally outputs to console.
   *
   * @private
   * @param {LogLevel} level - Log severity level
   * @param {string} code - Log code identifier for categorization
   * @param {string} message - Log message content
   * @returns {void}
   */

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
      switch (level) {
        case "INFO":
        case "DEBUG":
          console.info(line.trim());
          break;
        case "WARN":
          console.warn(line.trim());
          break;
        case "ERROR":
        case "FATAL":
          console.error(line.trim());
          break;
        default:
          console.log(line.trim());
      }
    }
  }

  /**
   * Logs an informational message.
   * Used for general application flow information.
   *
   * @param {string} code - Log code identifier
   * @param {string} text - Log message
   * @returns {void}
   *
   * @example
   * ```typescript
   * logger.info('APP_START', 'Application started successfully');
   * ```
   */

  info(code: string, text: string): void {
    this.log("INFO", code, text);
  }

  /**
   * Logs a warning message.
   * Used for potentially harmful situations that don't prevent operation.
   *
   * @param {string} code - Log code identifier
   * @param {string} text - Log message
   * @returns {void}
   *
   * @example
   * ```typescript
   * logger.warn('DB_SLOW', 'Database query took longer than expected');
   * ```
   */

  warn(code: string, text: string): void {
    this.log("WARN", code, text);
  }

  /**
   * Logs a debug message.
   * Used for detailed diagnostic information useful during development.
   *
   * @param {string} code - Log code identifier
   * @param {string} text - Log message
   * @returns {void}
   *
   * @example
   * ```typescript
   * logger.debug('API_REQ', 'Request received: GET /api/users');
   * ```
   */

  debug(code: string, text: string): void {
    this.log("DEBUG", code, text);
  }

  /**
   * Logs an error message.
   * Used for error events that might still allow the application to continue.
   *
   * @param {string} code - Log code identifier
   * @param {string} text - Log message
   * @returns {void}
   *
   * @example
   * ```typescript
   * logger.error('API_FAIL', 'Failed to fetch user data from external API');
   * ```
   */

  error(code: string, text: string): void {
    this.log("ERROR", code, text);
  }

  /**
   * Logs a fatal error message and sends an email notification.
   * Used for severe error events that might cause the application to abort.
   * Automatically triggers email notification if email service is configured and ready.
   *
   * @param {string} code - Log code identifier
   * @param {string} text - Log message
   * @returns {void}
   *
   * @example
   * ```typescript
   * logger.fatal('DB_CONN_FAIL', 'Unable to connect to database after 5 retries');
   * ```
   */

  fatal(code: string, text: string): void {
    this.log("FATAL", code, text);

    if (!this.emailService.ready) {
      if (this._config.debug) {
        console.info(
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
