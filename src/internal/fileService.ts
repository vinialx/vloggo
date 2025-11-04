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
  private _txtFilename: string = "";
  private _jsonFilename: string = "";
  private _currentDay: number = 0;
  private _initialized: boolean = false;

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
    if (this._initialized) {
      return;
    }

    try {
      this._currentDay = new Date().getDate();

      const txtDirectory = this.config.directory.txt;

      fs.mkdirSync(txtDirectory!, { recursive: true });
      this._txtFilename = path.resolve(txtDirectory!, this.format.filename());

      fs.appendFileSync(this._txtFilename, this.format.separator());

      if (this.config.json) {
        const jsonDirectory = this.config.directory.json;

        fs.mkdirSync(jsonDirectory!, { recursive: true });
        this._jsonFilename = path.resolve(
          jsonDirectory!,
          this.format.jsonFilename()
        );

        fs.appendFileSync(this._jsonFilename, this.format.jsonSeparator());
      }

      this._initialized = true;
    } catch (error) {
      console.error(
        `[VLoggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : error initializing VLoggo > ${(error as Error).message}`
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

  write(line: string, json?: string): void {
    if (!this.initialized) {
      console.warn(
        `[VLoggo] > [${this.config.client}] [${this.format.date()}] [WARN] : file service not initialized`
      );
      return;
    }

    try {
      fs.appendFileSync(this._txtFilename, line);

      if (this.config.json && json != undefined) {
        fs.appendFileSync(this._jsonFilename, json);
      }
    } catch (error) {
      console.error(
        `[VLoggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : failed to write to log file > ${(error as Error).message}`
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
      fs.mkdirSync(this.config.directory.txt!, { recursive: true });
      this._txtFilename = path.resolve(
        this.config.directory.txt!,
        this.format.filename()
      );

      fs.appendFileSync(this._txtFilename, this.format.separator());

      if (this.config.json) {
        fs.mkdirSync(this.config.directory.json!, { recursive: true });
        this._jsonFilename = path.resolve(
          this.config.directory.json!,
          this.format.jsonFilename()
        );

        fs.appendFileSync(this._jsonFilename, this.format.jsonSeparator());
      }

      this._initialized = true;

      this.rotate().catch((error) =>
        console.error(
          `[VLoggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : error rotating VLoggo > ${(error as Error).message}`
        )
      );
    } catch (error) {
      console.error(
        `[VLoggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : error verifying VLoggo rotation > ${(error as Error).message}`
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
      const txtDirectory = this.config.directory.txt;
      const txtFiles = await fsp.readdir(txtDirectory!);

      const logFilesPromises = txtFiles
        .filter((file) => file.endsWith(".txt"))
        .map(async (file) => {
          const filePath = path.join(txtDirectory!, file);
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

      if (logFiles.length > this.config.filecount.txt!) {
        const filesToDelete = logFiles.slice(this.config.filecount.txt!);

        await Promise.allSettled(
          filesToDelete.map(async (file) => {
            try {
              await fsp.unlink(file.path);
            } catch (error) {
              console.error(
                `[VLoggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : error deleting old .txt file > ${(error as Error).message}`
              );
            }
          })
        );
      }

      if (this.config.json) {
        const jsonDirectory = this.config.directory.json;
        const jsonFiles = await fsp.readdir(jsonDirectory!);

        const logFilesPromises = jsonFiles
          .filter((file) => file.endsWith(".jsonl"))
          .map(async (file) => {
            const filePath = path.join(jsonDirectory!, file);
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

        if (logFiles.length > this.config.filecount.json!) {
          const filesToDelete = logFiles.slice(this.config.filecount.json!);

          await Promise.allSettled(
            filesToDelete.map(async (file) => {
              try {
                await fsp.unlink(file.path);
              } catch (error) {
                console.error(
                  `[VLoggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : error deleting old .json file > ${(error as Error).message}`
                );
              }
            })
          );
        }
      }
    } catch (error) {
      console.error(
        `[VLoggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : VLoggo cleanup failed > ${(error as Error).message}`
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
    return this._initialized;
  }
}

export default FileService;
