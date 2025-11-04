# VLoggo

Logging library for Node.js and Bun with file rotation, SMTP notifications, and JSON output support.

## Features

- **Multiple log levels**: INFO, WARN, DEBUG, ERROR, FATAL
- **Automatic file rotation**: Daily rotation with configurable retention
- **SMTP notifications**: Email alerts for fatal errors with throttling
- **JSON output**: Optional structured logging in JSONL format
- **Caller tracking**: Automatic source file and line number tracking
- **TypeScript support**: Full type definitions included
- **Zero configuration**: Works out of the box with sensible defaults

## Installation

```bash
npm install @vinialx/vloggo
```

```bash
bun add @vinialx/vloggo
```

## Quick Start

```typescript
import { VLoggo } from "@vinialx/vloggo";

const logger = new VLoggo({ client: "MyApp" });

logger.info("APP_START", "Application started");
logger.warn("HIGH_MEMORY", "Memory usage above 80%");
logger.error("API_FAIL", "External API request failed");
logger.fatal("DB_DOWN", "Database connection lost");
```

## Configuration

### Basic Configuration

```typescript
const logger = new VLoggo({
  client: "MyApp", // Application name
  console: true, // Enable console output
  debug: false, // Enable debug logs
  json: false, // Enable JSON output
});
```

### File Configuration

```typescript
const logger = new VLoggo({
  client: "MyApp",
  directory: {
    txt: "/var/log/myapp", // Text log directory
    json: "/var/log/myapp/json", // JSON log directory
  },
  filecount: {
    txt: 31, // Keep 31 days of text logs
    json: 7, // Keep 7 days of JSON logs
  },
});
```

### SMTP Configuration

```typescript
const logger = new VLoggo({
  client: "MyApp",
  smtp: {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    username: "your-email@gmail.com",
    password: "your-password",
    from: "logs@myapp.com",
    to: "admin@myapp.com", // Can be string or array
  },
  throttle: 300000, // Min 5 minutes between emails
});
```

### Environment Variables

SMTP can be configured via environment variables:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-password
SMTP_FROM=logs@myapp.com
SMTP_TO=admin@myapp.com
```

## API Reference

### Constructor

```typescript
new VLoggo(options?: Partial<VLoggoConfig>)
```

**Options:**

- `client`: Application name (default: 'VLoggo')
- `console`: Enable console output (default: true)
- `debug`: Enable debug mode (default: false)
- `json`: Enable JSON output (default: false)
- `directory`: Log directories (default: ~/[client]/logs)
- `filecount`: Retention days (default: { txt: 31, json: 31 })
- `smtp`: SMTP configuration (optional)
- `throttle`: Email throttle in ms (default: 30000)

### Logging Methods

```typescript
logger.info(code: string, message: string): void
logger.warn(code: string, message: string): void
logger.debug(code: string, message: string): void
logger.error(code: string, message: string): void
logger.fatal(code: string, message: string): void
```

**Parameters:**

- `code`: Short identifier for the log entry
- `message`: Detailed log message

### Configuration Access

```typescript
// Read configuration
logger.config.client; // string
logger.config.debug; // boolean
logger.config.console; // boolean
logger.config.json; // boolean
logger.config.directory; // VLoggoDirectory
logger.config.filecount; // VLoggoFilecount
logger.config.notify; // boolean
logger.config.smtp; // VLoggoSMTPConfig | undefined
logger.config.throttle; // number

// Clone configuration
const newConfig = logger.config.clone({ client: "NewApp" });

// Update configuration
logger.config.update({ debug: true, throttle: 60000 });
```

## Log Format

### Text Format

```
[MyApp] [03/11/2025 14:30:45] [INFO] [APP_START] [server.ts:15]: Application started
```

### JSON Format (JSONL)

```json
{
  "client": "MyApp",
  "timestamp": "2025-11-03T14:30:45.123Z",
  "level": "INFO",
  "code": "APP_START",
  "caller": "server.ts:15",
  "message": "Application started"
}
```

## File Rotation

- Logs rotate daily at midnight
- Old logs are automatically deleted based on `filecount` setting
- Separate rotation for text and JSON logs
- Rotation happens asynchronously without blocking logging

## Email Notifications

- Only sent for `fatal()` logs
- Throttled to prevent spam (configurable via `throttle`)
- Includes timestamp, code, caller location, and message
- HTML formatted emails

## Examples

### Express.js Integration

```typescript
import express from "express";
import { VLoggo } from "@vinialx/vloggo";

const app = express();
const logger = new VLoggo({ client: "API" });

app.use((req, res, next) => {
  logger.info("REQUEST", `${req.method} ${req.path}`);
  next();
});

app.use((err, req, res, next) => {
  logger.error("ERROR", err.message);
  res.status(500).json({ error: "Internal Server Error" });
});
```

### Database Connection Monitoring

```typescript
async function connectDatabase() {
  try {
    await db.connect();
    logger.info("DB_CONNECT", "Database connected successfully");
  } catch (error) {
    logger.fatal("DB_CONNECT_FAIL", error.message);
    process.exit(1);
  }
}
```

### Scheduled Task Logging

```typescript
import cron from "node-cron";

cron.schedule("0 0 * * *", () => {
  logger.info("CRON_START", "Daily cleanup task started");

  try {
    performCleanup();
    logger.info("CRON_SUCCESS", "Daily cleanup completed");
  } catch (error) {
    logger.error("CRON_FAIL", error.message);
  }
});
```

## TypeScript Support

Full TypeScript definitions are included:

```typescript
import { VLoggo, VLoggoConfig, LogLevel, LogEntry } from "vloggo";

const config: Partial<VLoggoConfig> = {
  client: "TypeScriptApp",
  debug: true,
};

const logger = new VLoggo(config);
```

## Performance Considerations

- File writes are synchronous for data integrity
- Rotation is asynchronous to avoid blocking
- Email sending is asynchronous with error handling
- Minimal overhead for disabled features

## License

MIT

## Support

For issues and feature requests, visit: https://github.com/vinialx/vloggo/issues


## Author

Email: vini.aloise.silva@gmail.com
