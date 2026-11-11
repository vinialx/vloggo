import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sanitize } from "../build/internal/redactionService.js";
import { records, smtpServer, workspace } from "./helpers.mjs";

test("outputs are independent and console-only mode creates no log files", async context => {
  const work = workspace(context);
  const logger = work.logger({ outputs: { console: false, text: false, json: true } });
  logger.info("JSON_ONLY", "structured only", { count: 3 });
  await logger.flush();
  assert.equal(fs.existsSync(logger.config.directory.txt), false);
  const entries = records(logger.config.directory.json);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.count, 3);

  const consoleOnly = work.logger({
    outputs: { console: false, text: false, json: false },
    directory: { txt: path.join(work.root, "memory-text"), json: path.join(work.root, "memory-json") },
  });
  consoleOnly.info("MEMORY_ONLY", "no files");
  assert.equal(fs.existsSync(consoleOnly.config.directory.txt), false);
  assert.equal(fs.existsSync(consoleOnly.config.directory.json), false);
});

test("minimum level filters every output; legacy debug alias still enables DEBUG", async context => {
  const work = workspace(context);
  const logger = work.logger({ level: "warn", json: true });
  logger.debug("DEBUG", "hidden");
  logger.info("INFO", "hidden");
  logger.warn("WARN", "visible");
  logger.error("ERROR", "visible");
  await logger.flush();
  assert.deepEqual(records(logger.config.directory.json).map(entry => entry.code), ["WARN", "ERROR"]);

  const legacy = work.logger({ debug: true, outputs: { console: false, text: false, json: true } });
  legacy.debug("LEGACY_DEBUG", "visible");
  await legacy.flush();
  assert.ok(records(legacy.config.directory.json).some(entry => entry.code === "LEGACY_DEBUG"));
});

test("child contexts inherit, override, redact, and share event correlation", async context => {
  const work = workspace(context);
  const logger = work.logger({ outputs: { console: false, text: true, json: true }, redact: ["password", "headers.authorization"] });
  const request = logger.child({ requestId: "req-7", userId: "usr-parent", password: "secret" });
  const nested = request.child({ userId: "usr-child", headers: { authorization: "Bearer hidden" } });
  nested.info("REQUEST", "Started", { method: "POST" });
  logger.info("UNRELATED", "No child context");
  await logger.flush();
  const json = records(logger.config.directory.json);
  assert.equal(json[0].context.requestId, "req-7");
  assert.equal(json[0].context.userId, "usr-child");
  assert.equal(json[0].context.password, "[REDACTED]");
  assert.equal(json[0].context.headers.authorization, "[REDACTED]");
  assert.equal(json[0].data.method, "POST");
  assert.match(records(logger.config.directory.txt, "txt")[0], /evt-[0-9a-f]{8}/);
  assert.equal(json[0].eventId.length, 36);
  assert.equal(json[1].context, undefined);
});

test("native errors keep cause and stack while configured fields are redacted", async context => {
  const work = workspace(context);
  const logger = work.logger({ json: true, redact: ["error.message", "error.code", "data.password"] });
  const cause = new Error("inner secret");
  const error = new Error("database detail", { cause });
  error.code = "PRIVATE-CODE";
  logger.error("DB_ERROR", "Database failed", { error, password: "secret", attempts: 2 });
  await logger.flush();
  const entry = records(logger.config.directory.json)[0];
  assert.equal(entry.error.message, "[REDACTED]");
  assert.equal(entry.error.code, "[REDACTED]");
  assert.equal(entry.error.cause.message, "[REDACTED]");
  assert.match(entry.error.stack, /Error: \[REDACTED\]/);
  assert.equal(entry.data.password, "[REDACTED]");
  assert.equal(entry.data.attempts, 2);
  assert.equal(error.message, "database detail");
});

test("redaction supports dotted paths and wildcard arrays without invoking getters", () => {
  let reads = 0;
  const source = {
    users: [{ password: "one", name: "A" }, { password: "two", name: "B" }],
    headers: { authorization: "Bearer secret" },
  };
  Object.defineProperty(source, "unsafe", { enumerable: true, get() { reads++; return "secret"; } });
  assert.deepEqual(sanitize(source, ["users.*.password", "headers.authorization"]), {
    users: [{ password: "[REDACTED]", name: "A" }, { password: "[REDACTED]", name: "B" }],
    headers: { authorization: "[REDACTED]" }, unsafe: "[Accessor]",
  });
  assert.equal(reads, 0);
});

test("rotation handles size limits and total storage caps", async context => {
  const work = workspace(context);
  const logger = work.logger({
    outputs: { console: false, text: true, json: false },
    rotation: { retentionDays: 1000, maxFileSize: 150, maxTotalSize: 300 },
  });
  for (let index = 0; index < 6; index++) logger.info(`EVENT_${index}`, "x".repeat(25));
  await logger.flush();
  const files = fs.readdirSync(logger.config.directory.txt).filter(name => name.endsWith(".txt"));
  assert.ok(files.length > 1);
  assert.ok(files.every(file => fs.statSync(path.join(logger.config.directory.txt, file)).size <= 150));
  assert.ok(files.reduce((sum, file) => sum + fs.statSync(path.join(logger.config.directory.txt, file)).size, 0) <= 300);
});

test("SMTP disabled is silent; explicit missing configuration reports once", async context => {
  const work = workspace(context);
  const originalError = console.error;
  const output = [];
  console.error = line => output.push(String(line));
  try {
    const disabled = work.logger({ notify: false, outputs: { console: true, text: false, json: false } });
    await disabled.fatal("FATAL", "No email configured");
    assert.equal(output.filter(line => line.includes("[SMTP_CONFIG]")).length, 0);
    assert.equal(output.filter(line => line.includes("[APP_START]")).length, 0);
    const enabled = work.logger({ notify: true, outputs: { console: true, text: false, json: false } });
    assert.equal(output.filter(line => line.includes("[SMTP_CONFIG]")).length, 1);
    assert.match(output.find(line => line.includes("[SMTP_CONFIG]")), /\[SMTP_CONFIG\]/);
    enabled.config.update({ outputs: { console: false } });
    enabled.config.update({ outputs: { console: true } });
    await enabled.fatal("FIRST", "No server");
    await enabled.fatal("SECOND", "Still no server");
    assert.equal(output.filter(line => line.includes("[SMTP_CONFIG]")).length, 1);
  } finally { console.error = originalError; }
});

test("SMTP changes replace transports and respect updated notification settings", async context => {
  const firstServer = await smtpServer(context);
  const secondServer = await smtpServer(context);
  const work = workspace(context);
  const logger = work.logger({
    outputs: { console: false, text: false, json: false },
    notify: true,
    throttle: 0,
    smtp: firstServer.config,
  });
  await logger.fatal("FIRST", "sent through first transport");
  logger.config.update({ smtp: secondServer.config });
  await logger.fatal("SECOND", "sent through updated transport");
  logger.config.update({ notify: false });
  await logger.fatal("DISABLED", "not sent");
  await logger.close();
  assert.equal(firstServer.messages.length, 1);
  assert.equal(secondServer.messages.length, 1);
});

test("SMTP uses structured sender, escaped HTML, redacted fields, and full event ID", async context => {
  const server = await smtpServer(context);
  const work = workspace(context);
  const logger = work.logger({
    client: 'My "App" <test>',
    outputs: { console: false, text: false, json: true },
    notify: true,
    throttle: 0,
    smtp: server.config,
    redact: ["password"],
  });
  await logger.fatal("<DB&FAIL>", "<img src=x onerror=alert(1)>", { password: "top-secret", requestId: "req-9" });
  await logger.flush();
  await logger.close();
  assert.equal(server.messages.length, 1);
  const message = server.messages[0];
  const html = message.split(/Content-Type: text\/html[^\r\n]*\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n/)[1].split("\r\n----_NmP")[0]
    .replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(message, /\[REDACTED\]/);
  assert.doesNotMatch(message, /top-secret/);
  const event = records(logger.config.directory.json)[0];
  assert.ok(message.includes(event.eventId));
  assert.match(message, /requestId.*req-9/s);
});

test("SMTP throttle allows only one concurrent delivery", async context => {
  const server = await smtpServer(context, { stall: true });
  const work = workspace(context);
  const logger = work.logger({
    outputs: { console: false, text: false, json: false }, notify: true,
    throttle: 0, notificationTimeout: 200, smtp: server.config,
  });
  const first = logger.fatal("ONE", "first");
  await new Promise(resolve => setTimeout(resolve, 30));
  const second = logger.fatal("TWO", "second");
  await Promise.all([first, second]);
  assert.equal(server.attempts, 1);
  await logger.close();
});

test("explicit timezone formats text while JSON remains UTC", async context => {
  const work = workspace(context);
  const logger = work.logger({ json: true, format: { timezone: "Pacific/Auckland" } });
  logger.info("TIMEZONE", "timestamp test");
  await logger.flush();
  const entry = records(logger.config.directory.json)[0];
  const text = records(logger.config.directory.txt, "txt")[0];
  assert.equal(entry.timestamp, new Date(entry.timestamp).toISOString());
  assert.match(text, /^\[VLoggo\] \[\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\.\d{3}\]/);
  assert.notEqual(logger.config.format.timezone, "UTC");
});
