# VLoggo

VLoggo is a logging library for Node.js and Bun. It writes one-line text and JSONL events, supports request-scoped child loggers, redacts structured fields, rotates log files, and sends optional fatal-error email notifications.

## Requirements

- Node.js 20 or newer, or a current Bun release.
- ESM project for direct `import` usage.
- Nodemailer 10 is included as a runtime dependency.

## Install

```sh
npm install vloggo
```

```sh
bun add vloggo
```

## Quick start

```ts
import { VLoggo } from "vloggo";

const logger = new VLoggo({ client: "MinhaAPI" });

logger.info("APP_READY", "Servidor iniciado", { port: 3000 });
logger.warn("HIGH_MEMORY", "Uso de memória elevado", { percent: 82 });
logger.error("API_FAIL", "Serviço externo indisponível", { service: "billing" });

await logger.close();
```

Example console and text output:

```text
[MinhaAPI] [11/11/2026 14:32:08.125] [evt-550e8400] [INFO ] [APP_READY] : Servidor iniciado > port=3000
```

Each event occupies one line. No startup banner, line separator, or SMTP message appears by default. The text ID contains `evt-` plus first eight hexadecimal UUID characters. JSONL and email keep full UUID for exact correlation.

## Configuration

```ts
import { VLoggo } from "vloggo";

const logger = new VLoggo({
  client: "MinhaAPI",
  level: "info",

  outputs: {
    console: true,
    text: true,
    json: true,
  },

  directory: {
    txt: "./logs/text",
    json: "./logs/json",
  },

  format: {
    timezone: "America/Sao_Paulo",
  },

  rotation: {
    retentionDays: 14,
    maxFileSize: "20 MB",
    maxTotalSize: "1 GB",
  },

  redact: ["password", "token", "headers.authorization"],
  startupMessage: false,

  notify: false,
});
```

### Defaults

| Option | Default | Meaning |
| --- | --- | --- |
| `client` | `"VLoggo"` or `CLIENT_NAME` | Application name and default log-directory name |
| `level` | `"info"` | Lowest event level to write |
| `outputs.console` | `true` | Print events to console |
| `outputs.text` | `true` | Write one-line text log |
| `outputs.json` | `false` | Write JSON Lines log |
| `directory.txt` | `~/[client]/logs` | Text log directory |
| `directory.json` | `~/[client]/json` | JSONL directory |
| `filecount.txt`, `filecount.json` | `31` | Maximum retained files per output |
| `rotation.retentionDays` | `31` | Maximum age of managed daily log files |
| `rotation.maxFileSize` | `20 MB` | Start a new segment before an append would exceed this size |
| `rotation.maxTotalSize` | `1 GB` | Maximum size for managed text and JSONL files combined |
| `format.timezone` | System timezone | Timezone for displayed timestamps and daily filenames |
| `redact` | `[]` | Field names or paths to replace with `[REDACTED]` |
| `startupMessage` | `false` | Emit an `APP_START` event during construction |
| `notify` | `true` only when SMTP configuration is valid | Send email for fatal events |
| `throttle` | `30000` ms | Minimum time between successful email sends |
| `notificationTimeout` | `10000` ms | Maximum duration for one email attempt |
| `retryDelay` | `1000` ms | Delay after an email failure before another attempt |

`maxFileSize` and `maxTotalSize` accept positive byte counts or strings with `B`, `KB`, `MB`, `GB`, or `TB` units. Units use powers of 1024. Numeric values mean bytes.

`outputs` are independent. For console-only logging, set `text: false` and `json: false`; VLoggo will not create log directories. With both file outputs disabled, `directory` and rotation settings have no effect.

### Log levels

Levels, from least to most severe: `debug`, `info`, `warn`, `error`, `fatal`. The selected level applies to every output. Events below it are dropped before caller lookup and serialization.

```ts
const logger = new VLoggo({ level: "warn" });
logger.info("CACHE_HIT", "This event is filtered");
logger.warn("CACHE_MISS", "This event is written");
```

For compatibility, `debug: true` enables the `debug` level when `level` is omitted. `debug: false` keeps the default `info` level. An explicit `level` takes precedence.

### Legacy output options

Existing applications may continue using:

```ts
new VLoggo({ console: true, json: true, debug: true });
```

These map to `outputs.console`, `outputs.json`, and `level: "debug"`. In a configuration object, explicit `outputs` values take precedence over legacy `console` and `json` values.

### Timezone

`format` currently supports only `timezone`:

```ts
format: { timezone: "America/Sao_Paulo" }
```

Text and console timestamps use this IANA timezone with millisecond precision. Daily filenames use the same timezone. JSON timestamps remain ISO 8601 UTC. Other display settings are intentionally fixed; VLoggo does not currently support pretty modes, colors, or separator lines.

## Structured events

All logging methods accept optional structured metadata as third argument:

```ts
logger.info("HTTP_START", "Request received", {
  method: "POST",
  path: "/login",
  requestId: "req-8f21",
});
```

Text output appends metadata as `key=value` fields. JSONL keeps context and event data in separate objects.

### Native errors

Pass an `Error` directly or as `metadata.error`. VLoggo records its name, message, stack, cause, and enumerable fields.

```ts
try {
  await database.query(sql);
} catch (error) {
  logger.error("DB_QUERY_FAILED", "Database query failed", {
    error,
    database: "primary",
    requestId: "req-8f21",
  });
}
```

Circular values become `[Circular]`; excessive nesting becomes `[MaxDepth]`; getters are not invoked. `BigInt`, dates, maps, sets, byte arrays, and non-finite numbers are converted to JSON-safe values.

### Child loggers and correlation

Use a child to add request or job context to every event from one operation:

```ts
const requestLogger = logger.child({
  requestId: "req-8f21",
  userId: "usr-42",
});

requestLogger.info("HTTP_START", "Request received");
requestLogger.info("DB_QUERY", "Loading account", { database: "primary" });
requestLogger.error("DB_FAIL", "Account query failed", { error });
```

Child loggers can create nested children. More specific child context overrides inherited fields. The parent and children share outputs, configuration, SMTP throttling, file rotation, and lifecycle. Context objects are copied when a child is created. Closing the parent closes shared resources; child loggers do not have their own `close()` method.

`eventId` identifies one event across destinations. `requestId` or a similar context field connects different events from one request. VLoggo does not keep an in-memory event history or require a database; search enabled log files with your normal log tools.

### Redaction

```ts
const logger = new VLoggo({
  redact: [
    "password",                 // Match this key at any object depth
    "headers.authorization",   // Match this nested path
    "users.*.accessToken",     // Match any array/object entry
  ],
});

logger.info("LOGIN", "Credentials checked", {
  password: "hidden",
  headers: { authorization: "Bearer hidden" },
  users: [{ accessToken: "hidden" }],
});
```

Redaction runs before console, text, JSONL, and email output. It does not modify the input objects. Matched native error messages also have their stack's first line redacted. Redaction matches structured fields only; it cannot detect a secret embedded in a message string, stack location, or arbitrary text.

## Text and JSONL formats

Console and text files use one line per event:

```text
[MinhaAPI] [11/11/2026 14:32:09.041] [evt-b8c3d1a2] [INFO ] [HTTP_START] : Request received > requestId=req-8f21 > userId=usr-42 > method=POST
```

The short event ID is derived from the full UUID. Its eight hexadecimal characters are convenient for reading, but may collide in large log volumes. Use the full `eventId` from JSONL or email for exact searches.

JSON output is JSON Lines: one complete object per line, with UTC timestamp and full event ID.

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-11-11T17:32:09.041Z",
  "client": "MinhaAPI",
  "level": "INFO",
  "code": "HTTP_START",
  "caller": "routes.ts:42",
  "message": "Request received",
  "context": {
    "requestId": "req-8f21",
    "userId": "usr-42"
  },
  "data": {
    "method": "POST"
  }
}
```

Optional `context`, `data`, and `error` fields are omitted when absent. The timestamp, caller, and event ID are captured once and shared across enabled outputs.

## File rotation and retention

- Files rotate when the configured timezone's calendar day changes or an append would exceed `maxFileSize`.
- Rotation occurs on the next log event; VLoggo does not create a timer for midnight.
- Segment names use `log-YYYY-MM-DD.txt` and `log-YYYY-MM-DD.001.txt`; JSONL uses `.jsonl`.
- One oversized event is kept intact in its own segment.
- Cleanup runs asynchronously at startup and after events.
- `retentionDays`, legacy `filecount`, and `maxTotalSize` all apply. The active files are protected, so size limits can be exceeded by active files until a later cleanup.
- Cleanup only considers regular files whose names match VLoggo's managed log pattern. It does not delete unrelated files or symlinks.
- Synchronous appends preserve immediate write ordering but can block the event loop. Retention cleanup runs asynchronously.

Use dedicated log directories. Separate processes writing into the same directories do not coordinate their file-size rotation or active-file protection.

## SMTP notifications

Only `fatal()` events send email. SMTP protocol debugging is separate from application log level and is disabled by default.

### Quiet disabled behavior

```ts
const logger = new VLoggo({ notify: false });
```

When `notify` is explicitly `false`, VLoggo does not read SMTP environment variables, create a transport, or emit an SMTP configuration warning.

When `notify` is omitted, valid SMTP options or a complete SMTP environment configuration enable notifications. Missing or partial environment configuration stays silent and leaves notifications disabled. Set `notify: true` to require SMTP; if configuration is missing or invalid, VLoggo emits one `SMTP_CONFIG` diagnostic when console output is enabled, continues logging, and does not throw.

### Configure SMTP directly

```ts
const logger = new VLoggo({
  notify: true,
  throttle: 300_000,
  notificationTimeout: 10_000,
  retryDelay: 1_000,
  smtp: {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    username: process.env.SMTP_USERNAME!,
    password: process.env.SMTP_PASSWORD!,
    from: "logs@example.com",
    to: ["ops@example.com"],
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  },
});

await logger.fatal("DB_UNAVAILABLE", "Database is unavailable", {
  error,
  requestId: "req-8f21",
});
```

Sender display names use Nodemailer's structured address handling. Email contains the full event ID and uses escaped HTML plus a plain-text alternative. Redaction applies before sending. Partial recipient rejection and send failures produce diagnostics, not exceptions from `fatal()`.

### Environment variables

VLoggo reads these values from `process.env` when `notify` is not explicitly false. VLoggo does not load `.env` files itself; use your runtime or dotenv loader.

```sh
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USERNAME=service-account
SMTP_PASSWORD=replace-with-a-secret
SMTP_FROM=logs@example.com
SMTP_TO=ops@example.com
```

Set `notify: true` when missing variables should produce one configuration diagnostic. `SMTP_TO` accepts comma-separated addresses in the environment or a string/array in code.

## Configuration updates

Read configuration through immutable getters. Change it with `update()`:

```ts
logger.config.update({
  level: "debug",
  outputs: { json: true },
  format: { timezone: "UTC" },
  rotation: { maxFileSize: "50 MB" },
  throttle: 60_000,
  smtp: { host: "smtp2.example.com" },
});
```

Nested SMTP fields merge with existing settings. Updates validate atomically. Use `smtp: null` to remove SMTP settings; if `notify` remains explicitly true, one missing-configuration diagnostic is reported. Zero is valid for `throttle` and `retryDelay`.

Clone and construct another independent logger:

```ts
const cloneConfig = logger.config.clone({ client: "Worker" });
const workerLogger = new VLoggo(cloneConfig);
```

`clone()` copies configuration; it does not share mutable nested objects or transports.

## Shutdown API

```ts
await logger.flush({ timeout: 10_000 });
await logger.close({ timeout: 10_000 });
```

`flush()` waits for currently accepted notifications and retention cleanup. `close()` stops accepting events, drains pending work, and closes SMTP connections. Calls to `close()` are idempotent. A timeout rejects; VLoggo then force-closes SMTP connections. The library does not install process signal handlers.

`fatal()` returns `Promise<void>` for compatibility with the existing API. It resolves after an enabled attempt finishes, but does not guarantee SMTP delivery; delivery failures are reported as diagnostics.

## API reference

```ts
logger.debug(code: string, message: string, metadata?: LogMetadata): void
logger.info(code: string, message: string, metadata?: LogMetadata): void
logger.warn(code: string, message: string, metadata?: LogMetadata): void
logger.error(code: string, message: string, metadata?: LogMetadata): void
logger.fatal(code: string, message: string, metadata?: LogMetadata): Promise<void>
logger.child(context: LogData): VLoggoChild
logger.flush(options?: LifecycleOptions): Promise<void>
logger.close(options?: LifecycleOptions): Promise<void>
logger.config.update(options: VLoggoUpdate): void
logger.config.clone(overrides?: VLoggoUpdate): Config
logger.config.toOptions(): VLoggoConfig
```

The package exports `VLoggo`, `VLoggoChild`, `VLoggoConfig`, `VLoggoUpdate`, `VLoggoOutputs`, `VLoggoFormat`, `VLoggoRotation`, `VLoggoSMTPConfig`, `VLoggoDirectory`, `VLoggoFilecount`, `LogLevel`, `LogLevelName`, `LogData`, `LogMetadata`, `LogEntry`, `JsonLogEntry`, `LogError`, and `LifecycleOptions`.

## Migration from 1.x

Existing two-argument logging calls and legacy `console`, `json`, and `debug` options remain supported. Important behavior changes and migration guidance are in [MIGRATION.md](MIGRATION.md).

## License

ISC. See [LICENSE](LICENSE).

## Support

Report issues at <https://github.com/vinialx/vloggo/issues>.
