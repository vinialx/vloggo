import { VLoggo } from "vloggo";

const logger = new VLoggo({
  client: "StoreAPI",
  level: "info",
  outputs: { console: true, text: true, json: true },
  format: { timezone: "America/Sao_Paulo" },
  redact: ["password", "headers.authorization"],
  notify: false,
});

logger.info("APP_READY", "Store API started", { port: 3000, environment: "production" });

const requestLogger = logger.child({ requestId: "req-8f21", userId: "usr-42" });
requestLogger.info("HTTP_START", "Request received", { method: "POST", path: "/login" });
requestLogger.info("AUTH_CHECK", "Credentials checked", {
  email: "ana@example.com",
  password: "never-written",
  headers: { authorization: "Bearer never-written" },
});

await logger.close();
