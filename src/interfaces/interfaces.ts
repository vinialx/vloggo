export interface VLoggoConfig {
  client?: string;
  json?: boolean;
  debug?: boolean;
  console?: boolean;

  directory?: VLoggoDirectory;
  filecount?: VLoggoFilecount;

  notify?: boolean;
  smtp?: VLoggoSMTPConfig;
  throttle?: number;
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
  secure: boolean;
}

export type LogLevel = "INFO" | "WARN" | "ERROR" | "FATAL" | "DEBUG";

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  code: string;
  caller: string;
  message: string;
}
