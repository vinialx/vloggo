import { VLoggo } from "vloggo";

const logger = new VLoggo({
  client: "Worker",
  outputs: { console: true, text: true, json: true },
  redact: ["password", "error.code"],
  notify: false,
});

try {
  throw new Error("Connection timed out");
} catch (cause) {
  const error = new Error("Could not load account", { cause });
  error.code = "DB_PRIVATE_CODE";
  logger.error("ACCOUNT_LOAD_FAILED", "Account could not be loaded", {
    error,
    database: "primary",
    attempts: 3,
  });
}

await logger.flush();
await logger.close();
