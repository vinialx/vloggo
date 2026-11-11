# Migrating from VLoggo 1.x to 2.x

VLoggo 2 keeps the existing two-argument logging methods and legacy `console`, `json`, and `debug` options. The release still changes runtime requirements, text output, JSONL schema, defaults, and configuration ownership. Review this guide before upgrading.

## Runtime requirement

Nodemailer 10 requires Node.js 20 or newer. VLoggo 2 declares Node.js `>=20`. Upgrade the runtime before deploying the new package.

## Text output

Text records now use this one-line format:

```text
[client] [DD/MM/YYYY HH:mm:ss.SSS] [evt-xxxxxxxx] [LEVEL] [CODE] : message > key=value
```

The caller is available in JSONL and email, rather than in the text header. Text timestamps include milliseconds and use configured `format.timezone` (system timezone by default). Newlines and terminal control characters are escaped. Automated parsers that depend on the 1.x field order or caller text must be updated.

VLoggo no longer writes initialization banners or `INIT` records by default. Set `startupMessage: true` to write one `APP_START` event.

## JSONL schema

JSONL remains one JSON object per line, but each event now includes a full UUID `eventId`, `client`, ISO UTC timestamp, `caller`, and optional `context`, `data`, and serialized `error` fields. Newline-delimited parsers remain compatible; consumers that validate the exact field set or require the previous schema must be updated.

IDs shown in console and text use a short `evt-` prefix plus eight UUID hexadecimal characters. Use full `eventId` from JSONL or email for exact correlation. Short IDs can collide in sufficiently large event sets.

## Configuration

Legacy options remain supported:

```ts
new VLoggo({ console: true, json: true, debug: true });
```

Equivalent new options:

```ts
new VLoggo({
  level: "debug",
  outputs: { console: true, text: true, json: true },
});
```

`debug: false` now consistently filters DEBUG events. The new default log level is `info`. File outputs can be disabled independently; console-only configurations no longer create log directories.

Default directories now use the configured client name: `~/[client]/logs` and `~/[client]/json`. If 1.x applications relied on all clients sharing the accidental `~/VLoggo` path, configure `directory` explicitly.

Nested configuration getters are immutable. Replace direct mutations such as `logger.config.filecount.txt = 7` with:

```ts
logger.config.update({ filecount: { txt: 7 } });
```

Partial nested options now receive defaults for omitted fields. SMTP updates merge with existing SMTP settings. `config.clone()` and `new VLoggo(existingConfig)` create independent configuration snapshots.

## SMTP behavior

- `notify: false` skips SMTP environment loading, transport creation, and SMTP diagnostics.
- With `notify` omitted, only complete, valid SMTP settings enable notifications. Missing environment settings remain silent.
- `notify: true` with missing/invalid SMTP settings writes one `SMTP_CONFIG` diagnostic when console output is enabled. It does not throw or stop other logging outputs.
- Fatal notifications now use structured sender addresses, HTML escaping, plain-text alternatives, redaction, retry delay, timeout, and pooled transport shutdown.

SMTP environment variables are read from `process.env`; VLoggo does not load `.env` files itself.

## Rotation and retention

Daily rotation now compares full calendar dates in the configured timezone. It no longer compares only the day number. Size-based segments and a total-storage cap are available through `rotation`. Legacy `filecount` remains a maximum number of managed files per output. Cleanup only targets VLoggo-named regular files and protects active files.

Rotation still happens on the next write after midnight; it is not scheduled by a background timer.

## Lifecycle

`fatal()` has returned a promise in 1.x, despite older README examples describing it as `void`. VLoggo 2 documents that return type accurately. Await it when the application must wait for the email attempt:

```ts
await logger.fatal("DB_DOWN", "Database connection lost", { error });
await logger.close();
```

`close()` stops new writes, drains pending work, and closes SMTP resources. Configure process signal handlers in the application; VLoggo does not install global handlers.

## Package metadata

The package moves to version 2.0, upgrades Nodemailer to 10.5, removes `@types/nodemailer` because Nodemailer bundles declarations, and makes TypeScript a development dependency. Consumers of JavaScript do not need TypeScript installed. The package declares Node.js `>=20` and uses ISC consistently in metadata, README, and `LICENSE`.
