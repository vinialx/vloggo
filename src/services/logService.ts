import type {
  LifecycleOptions,
  LogData,
  LogEntry,
  LogLevel,
  LogLevelName,
  LogMetadata,
  VLoggoConfig,
} from "../interfaces/interfaces.js";
import FileService from "../internal/fileService.js";
import EmailService from "../internal/emailService.js";
import FormatService from "../internal/formatService.js";
import { sanitize, serializeError } from "../internal/redactionService.js";
import Config from "../config/config.js";

const LEVELS: readonly LogLevelName[] = ["debug", "info", "warn", "error", "fatal"];
const UPPER_LEVEL: Record<LogLevelName, LogLevel> = {
  debug: "DEBUG", info: "INFO", warn: "WARN", error: "ERROR", fatal: "FATAL",
};

function mergeContext(parent: LogData, child: LogData): LogData {
  return { ...parent, ...child };
}

/** Logger sharing application's outputs and lifecycle with its child loggers. */
export class VLoggoChild {
  constructor(
    private emit: (level: LogLevelName, code: string, message: string, metadata: LogMetadata | undefined, context: LogData) => void | Promise<void>,
    readonly config: Readonly<Config>,
    private readonly context: LogData,
  ) {}

  /** Creates a nested child; child fields override inherited fields with same names. */
  child(context: LogData): VLoggoChild {
    const detached = sanitize(context, this.config.redact) as LogData;
    return new VLoggoChild(this.emit, this.config, mergeContext(this.context, detached));
  }

  /** Writes a debug event when the configured minimum level allows it. */
  debug(code: string, message: string, metadata?: LogMetadata): void { this.emit("debug", code, message, metadata, this.context); }
  /** Writes an informational event. */
  info(code: string, message: string, metadata?: LogMetadata): void { this.emit("info", code, message, metadata, this.context); }
  /** Writes a warning event. */
  warn(code: string, message: string, metadata?: LogMetadata): void { this.emit("warn", code, message, metadata, this.context); }
  /** Writes an error event. */
  error(code: string, message: string, metadata?: LogMetadata): void { this.emit("error", code, message, metadata, this.context); }
  /** Writes a fatal event and waits for an enabled notification attempt. */
  fatal(code: string, message: string, metadata?: LogMetadata): Promise<void> {
    return Promise.resolve(this.emit("fatal", code, message, metadata, this.context));
  }
}

/** Logging facade with independent console, text, JSONL, and SMTP outputs. */
export class VLoggo {
  private _config: Config;
  private fileService: FileService;
  private emailService: EmailService;
  private formatService: FormatService;
  private unsubscribe: () => void;
  private closed = false;
  private closing?: Promise<void>;

  constructor(options?: VLoggoConfig | Config) {
    this._config = new Config(options);
    this.formatService = new FormatService(this._config.client, this._config.format.timezone);
    this.fileService = new FileService(this._config);
    this.emailService = new EmailService(this._config);
    this.fileService.initialize();
    this.unsubscribe = this._config.subscribe(() => {
      this.formatService.setTimezone(this._config.format.timezone);
      this.fileService.initialize();
      this.emailService.reconfigure();
    });
    if (this._config.startupMessage) this.log("info", "APP_START", "Logger initialized", undefined, {});
  }

  /** Current validated configuration. Nested values are immutable; use update() to change them. */
  get config(): Readonly<Config> { return this._config; }

  /** Creates a logger that adds immutable context to every event. */
  child(context: LogData): VLoggoChild {
    const detached = sanitize(context, this.config.redact) as LogData;
    return new VLoggoChild((level, code, message, metadata, inherited) =>
      this.logWithContext(level, code, message, metadata, inherited), this.config, detached);
  }

  private log(
    levelName: LogLevelName,
    code: string,
    message: string,
    metadata?: LogMetadata,
    inheritedContext: LogData = {},
  ): LogEntry | undefined {
    if (this.closed || LEVELS.indexOf(levelName) < LEVELS.indexOf(this.config.level)) return;
    if (typeof code !== "string" || !code.trim()) throw new TypeError("code must be a nonempty string");
    if (typeof message !== "string") throw new TypeError("message must be a string");

    const date = new Date();
    const rawData = metadata instanceof Error ? undefined : metadata;
    const rawError = metadata instanceof Error
      ? metadata
      : metadata?.error instanceof Error ? metadata.error : undefined;
    let data = rawData ? sanitize(rawData, this.config.redact) as LogData : undefined;
    if (rawError && data) {
      data = { ...data };
      delete data.error;
      if (!Object.keys(data).length) data = undefined;
    }
    const context = Object.keys(inheritedContext).length
      ? sanitize(inheritedContext, this.config.redact) as LogData
      : undefined;
    const serializedError = serializeError(rawError, this.config.redact);
    const entry: LogEntry = {
      eventId: this.formatService.id(),
      timestamp: date.toISOString(),
      client: this.config.client,
      level: UPPER_LEVEL[levelName],
      code,
      caller: this.formatService.caller(),
      message,
      ...(context ? { context } : {}),
      ...(data ? { data } : {}),
      ...(serializedError ? { error: serializedError as LogEntry["error"] } : {}),
    };

    if (this.config.outputs.console) {
      const output = levelName === "warn" ? console.warn : levelName === "error" || levelName === "fatal" ? console.error : console.info;
      output(this.formatService.line(entry).trimEnd());
    }
    this.fileService.write(
      this.config.outputs.text ? this.formatService.line(entry) : undefined,
      this.config.outputs.json ? this.formatService.jsonLine(entry) : undefined,
      date,
    );
    return entry;
  }

  private logWithContext(
    level: LogLevelName,
    code: string,
    message: string,
    metadata: LogMetadata | undefined,
    context: LogData,
  ): void | Promise<void> {
    const entry = this.log(level, code, message, metadata, context);
    if (level === "fatal" && entry) return this.emailService.sendErrorNotification(entry);
  }

  /** Writes a debug event when the configured minimum level allows it. */
  debug(code: string, message: string, metadata?: LogMetadata): void { this.log("debug", code, message, metadata); }
  /** Writes an informational event to enabled outputs. */
  info(code: string, message: string, metadata?: LogMetadata): void { this.log("info", code, message, metadata); }
  /** Writes a warning event to enabled outputs. */
  warn(code: string, message: string, metadata?: LogMetadata): void { this.log("warn", code, message, metadata); }
  /** Writes an error event to enabled outputs. */
  error(code: string, message: string, metadata?: LogMetadata): void { this.log("error", code, message, metadata); }

  /** Writes fatal event and waits for enabled SMTP attempt. Delivery errors are reported as diagnostics. */
  async fatal(code: string, message: string, metadata?: LogMetadata): Promise<void> {
    const entry = this.log("fatal", code, message, metadata);
    if (entry) await this.emailService.sendErrorNotification(entry);
  }

  /** Waits for accepted email and cleanup work. Timeout rejects without closing the logger. */
  async flush(options: LifecycleOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 10000;
    if (!Number.isSafeInteger(timeout) || timeout < 1) throw new TypeError("timeout must be a positive integer");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await this.emailService.flush();
          await this.fileService.flush();
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Logger flush timed out")), timeout); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  /** Stops accepting events, drains work, and releases SMTP connections. Repeated calls share one result. */
  close(options: LifecycleOptions = {}): Promise<void> {
    if (this.closing) return this.closing;
    const timeout = options.timeout ?? 10000;
    if (!Number.isSafeInteger(timeout) || timeout < 1) return Promise.reject(new TypeError("timeout must be a positive integer"));
    this.closed = true;
    this.unsubscribe();
    this.closing = (async () => {
      try {
        await this.flush({ timeout });
        this.emailService.close();
        this.fileService.deactivate();
      } catch (error) {
        this.emailService.close(true);
        this.fileService.deactivate();
        throw error;
      }
    })();
    return this.closing;
  }
}
