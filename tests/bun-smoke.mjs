import assert from "node:assert/strict";
import { VLoggo } from "../build/index.js";

const logger = new VLoggo({ outputs: { console: false, text: false, json: false } });
logger.info("BUN_IMPORT", "Bun can load compiled package");
await logger.fatal("BUN_FATAL", "SMTP-disabled fatal log remains local");
await logger.close();
assert.equal(logger.config.notify, false);
console.info("Bun runtime smoke test passed.");
