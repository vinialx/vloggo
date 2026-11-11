import { VLoggo, type VLoggoConfig, type JsonLogEntry } from "../../src/index.js";

const options: VLoggoConfig = { client: "App", directory: { txt: "/logs" }, filecount: { txt: 7 } };
const logger = new VLoggo(options);
logger.config.update({ smtp: { host: "smtp.example.com" }, throttle: 0 });
const clone = new VLoggo(logger.config.clone({ client: "Clone" }));
const notification: Promise<void> = clone.fatal("CODE", "message");
const closed: Promise<void> = clone.close({ timeout: 1000 });
const flushed: Promise<void> = logger.flush();
const record: JsonLogEntry = {
  eventId: "550e8400-e29b-41d4-a716-446655440000",
  client: "App", timestamp: new Date().toISOString(), level: "INFO",
  code: "INIT", caller: "app.ts:1", message: "initialized",
};
void [notification, closed, flushed, record];

// @ts-expect-error Nested configuration is readonly.
logger.config.directory.txt = "/mutated";
// @ts-expect-error Partial SMTP is only accepted by updates, not initial construction.
new VLoggo({ smtp: { host: "incomplete" } });
