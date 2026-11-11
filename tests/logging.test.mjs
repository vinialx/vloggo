import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import FormatService from "../build/internal/formatService.js";
import { workspace, records } from "./helpers.mjs";

test("DEBUG flag suppresses entries and updates affect every output's client", async context => {
  const work = workspace(context);
  const logger = work.logger({ client: "Before", json: true });
  logger.debug("HIDDEN", "not logged");
  logger.config.update({ client: "After", debug: true });
  logger.debug("VISIBLE", "logged");
  await logger.flush();
  const entries = records(logger.config.directory.json).filter(entry => entry.level !== "INIT");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].client, "After");
  assert.equal(entries[0].code, "VISIBLE");
  assert.match(records(logger.config.directory.txt, "txt").join("\n"), /\[After\].*VISIBLE/);
});

test("console keeps application entries when file initialization fails", async context => {
  const work = workspace(context);
  fs.writeFileSync(work.options.directory.txt, "blocks directory");
  const original = { info: console.info, error: console.error };
  const output = [];
  console.info = line => output.push(line);
  console.error = () => {};
  try {
    const logger = work.logger({ console: true });
    logger.info("SURVIVES", "business event");
    await logger.close();
  } finally { Object.assign(console, original); }
  assert.equal(output.length, 1);
  assert.match(output[0], /SURVIVES.*business event/);
});

test("text remains one line; JSON retains original message and shared timestamp", async context => {
  const work = workspace(context);
  const logger = work.logger({ json: true });
  const message = "first\n[FORGED] second\r\u001b[31m";
  logger.info("CODE\nFORGED", message);
  await logger.flush();
  const entry = records(logger.config.directory.json).find(entry => entry.level === "INFO");
  const lines = records(logger.config.directory.txt, "txt");
  assert.equal(lines.length, 1);
  assert.equal(entry.message, message);
  assert.match(lines[0], /first\\n\[FORGED\]/);
  assert.ok(lines[0].includes(new FormatService("App", logger.config.format.timezone).date(new Date(entry.timestamp))));
  assert.match(entry.caller, /^logging\.test\.mjs:\d+$/);
  assert.match(lines[0], /\[evt-[0-9a-f]{8}\]/);
  assert.match(entry.eventId, /^[0-9a-f-]{36}$/);
});

test("formatters use supplied event and default client", () => {
  const formatter = new FormatService();
  const entry = { eventId: "550e8400-e29b-41d4-a716-446655440000", client: "VLoggo", timestamp: "2000-01-01T12:00:00.000Z", level: "INFO", code: "CODE", caller: "app.ts:1", message: "message" };
  assert.match(formatter.line(entry), /^\[VLoggo\]/);
  assert.ok(formatter.line(entry).includes(formatter.date(new Date(entry.timestamp))));
  assert.equal(JSON.parse(formatter.jsonLine(entry)).timestamp, entry.timestamp);
  assert.match(formatter.line(entry), /\[evt-550e8400\]/);
});

test("close is idempotent and later entries or updates cannot reopen outputs", async context => {
  const work = workspace(context);
  const logger = work.logger({ json: true });
  logger.info("BEFORE", "before");
  const first = logger.close();
  assert.equal(logger.close(), first);
  await first;
  logger.info("AFTER", "ignored");
  await logger.fatal("AFTER_FATAL", "ignored");
  logger.config.update({ client: "Closed" });
  const entries = records(logger.config.directory.json).filter(entry => entry.level !== "INIT");
  assert.deepEqual(entries.map(entry => entry.code), ["BEFORE"]);
  await assert.rejects(logger.flush({ timeout: 0 }), TypeError);
});
