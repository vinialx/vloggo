# Changelog

## 2.0.0

- Upgrade Nodemailer to 10.5.0 and require Node.js 20 or newer.
- Add structured event IDs, metadata, native error serialization, child loggers, and field redaction.
- Add independent outputs, minimum log levels, timezone-aware timestamps, and JSONL event records.
- Add size-based rotation, age retention, total-storage limits, SMTP retry controls, and explicit shutdown.
- Keep legacy logging calls and `console`, `json`, and `debug` configuration aliases.
- Remove startup banners and silent optional-SMTP warnings; diagnose missing SMTP once only when notifications are explicitly enabled.
- Align package licensing to ISC and add regression, runtime, and package-consumer checks.
