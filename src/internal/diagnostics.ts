import type Config from "../config/config.js";
import FormatService, { safeText } from "./formatService.js";

const format = new FormatService();

/** Internal failures never recurse through application logging. */
export function diagnostic(config: Config, message: string, error?: unknown, code = "INTERNAL"): void {
  if (!config.outputs.console) return;
  const detail = error === undefined ? "" : ` > ${error instanceof Error ? error.message : String(error)}`;
  format.setTimezone(config.format.timezone);
  const eventId = format.id();
  const client = safeText(config.client).replace(/[\[\]]/g, character => `\\${character}`);
  const safeCode = safeText(code).replace(/[\[\]]/g, character => `\\${character}`);
  console.error(`[${client}] [${format.date()}] [${format.shortId(eventId)}] [ERROR] [${safeCode}] : ${safeText(message + detail)}`);
}
