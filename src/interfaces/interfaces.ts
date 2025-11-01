export interface LoggoConfig {
  client?: string;
  directory?: string;
  console?: boolean;
  filecount?: number;
  notify?: boolean;
  smtp?: LoggoSMTPConfig;
  throttle?: number;
  debug?: boolean;
}

export interface LoggoSMTPConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  to: string | string[];
  secure: boolean;
}

export type LogLevel = "INFO" | "WARN" | "ERROR" | "CRITICAL" | "DEBUG";

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  code: string;
  module: string;
  message: string;
}
