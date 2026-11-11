export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
export type LogLevelName = "debug" | "info" | "warn" | "error" | "fatal";
export type LogData = Record<string, unknown>;
/** Structured fields or a native Error passed as a log method's third argument. */
export type LogMetadata = LogData | Error;

export interface VLoggoOutputs {
  console?: boolean;
  text?: boolean;
  json?: boolean;
}

export interface VLoggoFormat {
  /** IANA timezone used for text timestamps and daily rotation. JSON timestamps remain UTC. */
  timezone?: string;
}

export type SizeLimit = number | string;

export interface VLoggoRotation {
  /** Keep files whose dates fall within this many calendar days. Default: 31. */
  retentionDays?: number;
  /** Rotate before appending an event that would exceed this size. Default: 20 MiB. */
  maxFileSize?: SizeLimit;
  /** Maximum size of all managed text and JSON files combined. Default: 1 GiB. */
  maxTotalSize?: SizeLimit;
}

export interface VLoggoConfig {
  /** Application name shown in every event. Also selects default log directories. */
  client?: string;

  /** Legacy alias for outputs.console. */
  console?: boolean;
  /** Legacy alias enabling DEBUG logs when level is omitted. */
  debug?: boolean;
  /** Legacy alias for outputs.json. */
  json?: boolean;
  /** Independent output controls. Text output defaults to true. */
  outputs?: VLoggoOutputs;
  /** Minimum severity. Defaults to info. */
  level?: LogLevelName;

  /** Text and JSONL directories. Defaults to client-specific paths under the home directory. */
  directory?: VLoggoDirectory;
  /** Legacy maximum number of files to keep for each output. Defaults to 31. */
  filecount?: VLoggoFilecount;
  /** Daily retention and size-based rotation controls. */
  rotation?: VLoggoRotation;
  /** Currently supports only an IANA timezone. */
  format?: VLoggoFormat;
  /** Field names or dotted paths to replace with [REDACTED]. */
  redact?: string[];
  /** Emit one startup record when true. Default: false. */
  startupMessage?: boolean;

  /** Send notifications for fatal events. Defaults to true only for complete SMTP config. */
  notify?: boolean;
  smtp?: VLoggoSMTPConfig;
  /** Minimum interval between successful notification sends, in milliseconds. */
  throttle?: number;
  /** Maximum duration of one notification attempt, in milliseconds. */
  notificationTimeout?: number;
  /** Delay before another notification may be attempted after a failure, in milliseconds. */
  retryDelay?: number;
}

export interface VLoggoDirectory {
  txt?: string;
  json?: string;
}

export interface VLoggoFilecount {
  txt?: number;
  json?: number;
}

export interface VLoggoSMTPConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  to: string | string[];
  secure?: boolean;
  /** Require STARTTLS when secure is false. */
  requireTLS?: boolean;
  /** Enable SMTP protocol diagnostics independently of application debug logs. */
  debug?: boolean;
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
}

export type VLoggoUpdate = Omit<VLoggoConfig, "smtp" | "outputs" | "directory" | "filecount" | "rotation" | "format"> & {
  /** Merge SMTP fields, or use null to remove SMTP configuration. */
  smtp?: Partial<VLoggoSMTPConfig> | null;
  outputs?: VLoggoOutputs;
  directory?: VLoggoDirectory;
  filecount?: VLoggoFilecount;
  rotation?: VLoggoRotation;
  format?: VLoggoFormat;
};

export interface LifecycleOptions {
  /** Maximum wait in milliseconds. Defaults to 10000. */
  timeout?: number;
}

export interface LogError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
  [key: string]: unknown;
}

export interface LogEntry {
  eventId: string;
  client: string;
  level: LogLevel;
  timestamp: string;
  code: string;
  caller: string;
  message: string;
  context?: LogData;
  data?: LogData;
  error?: LogError;
}

/** JSONL records use the same structured event schema as the public LogEntry type. */
export type JsonLogEntry = LogEntry;
