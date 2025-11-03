import * as fs from "fs";
import * as path from "path";
import * as fsp from "fs/promises";

import Config from "../config/config";
import FormatService from "./formatService";

/**
 * Service responsible for managing log file operations.
 * Handles file creation, writing, rotation, and cleanup based on retention policies.
 *
 * @class FileService
 */

class FileService {
  private _filename: string = "";
  private _currentDay: number = 0;
  private _initicialized: boolean = false;

  private format: FormatService;

  /**
   * Creates an instance of FileService.
   *
   * @param {Config} config - Configuration object containing directory and file retention settings
   */

  constructor(private config: Config) {
    this.format = new FormatService(this.config.client);
  }

  /**
   * Initializes the file service by creating the log directory and first log file.
   * Sets up the current day tracking for rotation purposes.
   * This method is idempotent - calling it multiple times has no effect after first initialization.
   *
   * @returns {void}
   */

  initialize(): void {
    if (this._initicialized) {
      return;
    }

    try {
      this._currentDay = new Date().getDate();

      fs.mkdirSync(this.config.directory, { recursive: true });
      this._filename = path.resolve(
        this.config.directory,
        this.format.filename()
      );

      fs.appendFileSync(this._filename, this.format.separator());
      this._initicialized = true;
    } catch (error) {
      console.error(
        `[Loggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : error initializing loggo > ${(error as Error).message}`
      );
    }
  }

  /**
   * Writes a line to the current log file.
   * Checks if the service is initialized before writing.
   *
   * @param {string} line - Log line to write (should include newline character)
   * @returns {void}
   *
   * @example
   * ```typescript
   * fileService.write("[INFO] User logged in\n");
   * ```
   */

  write(line: string): void {
    if (!this.initialized) {
      console.warn(
        `[Loggo] > [${this.config.client}] [${this.format.date()}] [WARN] : file service not initialized`
      );
      return;
    }

    try {
      fs.appendFileSync(this._filename, line);
    } catch (error) {
      console.error(
        `[Loggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : failed to write to log file > ${(error as Error).message}`
      );
    }
  }

  /**
   * Verifies if log rotation is needed by checking if the day has changed.
   * If rotation is needed, creates a new log file and triggers cleanup of old files.
   * This method should be called before each write operation to ensure proper rotation.
   *
   * @returns {void}
   */

  verify(): void {
    const today = new Date().getDate();

    if (today === this._currentDay) {
      return;
    }

    try {
      fs.mkdirSync(this.config.directory, { recursive: true });
      this._filename = path.resolve(
        this.config.directory,
        this.format.filename()
      );

      fs.appendFileSync(this._filename, this.format.separator());
      this._initicialized = true;

      this.rotate().catch((error) =>
        console.error(
          `[Loggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : error rotating loggo > ${(error as Error).message}`
        )
      );
    } catch (error) {
      console.error(
        `[Loggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : error verifying loggo rotation > ${(error as Error).message}`
      );
    }
  }

  /**
   * Rotates log files by removing old files that exceed the retention count.
   * Scans the log directory, sorts files by modification time (newest first),
   * and deletes the oldest files when the count exceeds config.filecount.
   *
   * @private
   * @async
   * @returns {Promise<void>}
   */

  private async rotate(): Promise<void> {
    try {
      const files = await fsp.readdir(this.config.directory);

      const logFilesPromises = files
        .filter((file) => file.endsWith(".txt"))
        .map(async (file) => {
          const filePath = path.join(this.config.directory, file);
          const stats = await fsp.stat(filePath);
          return {
            name: file,
            path: filePath,
            mtime: stats.mtime.getTime(),
          };
        });

      const logFiles = (await Promise.all(logFilesPromises)).sort(
        (a, b) => b.mtime - a.mtime
      );

      if (logFiles.length > this.config.filecount) {
        const filesToDelete = logFiles.slice(this.config.filecount);

        await Promise.allSettled(
          filesToDelete.map(async (file) => {
            try {
              await fsp.unlink(file.path);
            } catch (error) {
              console.error(
                `[Loggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : error deleting old file > ${(error as Error).message}`
              );
            }
          })
        );
      }
    } catch (error) {
      console.error(
        `[Loggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : loggo cleanup failed > ${(error as Error).message}`
      );
    }
  }

  /**
   * Gets the initialization status of the file service.
   *
   * @readonly
   * @returns {boolean} True if the service is initialized and ready to write logs
   */

  get initialized(): boolean {
    return this._initicialized;
  }
}

export default FileService;
