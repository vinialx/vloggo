import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import Config from "../build/config/config.js";
import { workspace } from "./helpers.mjs";

const smtp = { host: "smtp.example.test", port: 465, username: "u", password: "p", from: "from@example.test", to: ["to@example.test"] };

test("defaults follow client and partial nested options retain missing defaults", () => {
  const config = new Config({ client: "Application", directory: { txt: "/custom" }, filecount: { txt: 7 } });
  assert.equal(config.directory.txt, "/custom");
  assert.equal(config.directory.json, path.join(os.homedir(), "Application", "json"));
  assert.equal(config.filecount.json, 31);
  config.update({ client: "Renamed" });
  assert.equal(config.directory.json, path.join(os.homedir(), "Renamed", "json"));
  assert.equal(config.directory.txt, "/custom");
});

test("defaults, inputs, snapshots, and clones own nested configuration", () => {
  const input = { directory: { txt: "/first" }, filecount: { txt: 3 }, smtp };
  const first = new Config(input);
  const second = new Config();
  input.directory.txt = "/changed";
  const clone = first.clone();
  clone.update({ directory: { txt: "/clone" }, filecount: { txt: 1 }, smtp: { to: ["new@example.test"] } });
  assert.equal(first.directory.txt, "/first");
  assert.equal(first.filecount.txt, 3);
  assert.equal(second.filecount.txt, 31);
  assert.deepEqual(first.smtp.to, ["to@example.test"]);
  const snapshot = first.toOptions();
  snapshot.smtp.to.push("extra@example.test");
  snapshot.filecount.txt = 99;
  assert.equal(first.filecount.txt, 3);
  assert.equal(first.smtp.to.length, 1);
  assert.throws(() => { first.directory.txt = "/mutated"; }, TypeError);
  assert.throws(() => first.smtp.to.push("other@example.test"), TypeError);
});

test("documented clone constructor preserves configuration", context => {
  const work = workspace(context);
  const original = work.logger({ client: "Original", debug: true });
  const clone = work.logger(original.config.clone({ client: "Clone" }).toOptions());
  assert.equal(clone.config.client, "Clone");
  const direct = new original.constructor(original.config.clone({ client: "Direct" }));
  context.after(() => direct.close());
  assert.equal(direct.config.client, "Direct");
  assert.equal(direct.config.debug, true);
});

test("notify inference respects explicit false and later SMTP changes", () => {
  assert.equal(new Config({ smtp }).notify, true);
  assert.equal(new Config({ smtp, notify: false }).notify, false);
  const config = new Config();
  config.update({ smtp });
  assert.equal(config.notify, true);
  config.update({ notify: false, smtp: { host: "new.example.test" }, throttle: 0 });
  assert.equal(config.notify, false);
  assert.equal(config.throttle, 0);
  assert.equal(config.smtp.host, "new.example.test");
  config.update({ smtp: null });
  assert.equal(config.smtp, undefined);
});

test("SMTP environment is read only when notifications are explicitly enabled", () => {
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_USERNAME = "user";
  process.env.SMTP_PASSWORD = "password";
  process.env.SMTP_FROM = "from@example.test";
  process.env.SMTP_TO = "to@example.test";
  try {
    const config = new Config({ notify: false });
    assert.equal(config.smtp, undefined);
    config.update({ notify: true });
    assert.equal(config.notify, true);
    assert.equal(config.smtp.host, "smtp.example.test");
  } finally {
    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_TO"]) delete process.env[key];
  }
});

test("invalid updates are atomic and invalid numeric settings fail early", () => {
  const config = new Config({ client: "Original" });
  for (const value of [-1, Infinity, NaN, 1.5]) assert.throws(() => config.update({ throttle: value }), TypeError);
  for (const value of [0, -1, Infinity, 1.5]) assert.throws(() => config.update({ filecount: { txt: value } }), TypeError);
  assert.throws(() => config.update({ client: "Changed", outputs: { console: "yes" } }), TypeError);
  assert.equal(config.client, "Original");
  const invalidSmtp = new Config({ smtp: { ...smtp, port: 65536 } });
  assert.equal(invalidSmtp.notify, false);
  assert.equal(invalidSmtp.notificationIssue, undefined);
  assert.throws(() => new Config({ client: "../outside" }), TypeError);
  assert.equal(new Config({ notify: true }).notificationIssue, "missing SMTP configuration");
});

test("environment is resolved once, strictly, with explicit options taking precedence", () => {
  process.env.CLIENT_NAME = "FromEnv";
  process.env.SMTP_HOST = "smtp.env.test";
  process.env.SMTP_PORT = "587junk";
  process.env.SMTP_USERNAME = "user";
  process.env.SMTP_PASSWORD = "password";
  process.env.SMTP_FROM = "from@example.test";
  process.env.SMTP_TO = "to@example.test";
  try {
    assert.equal(new Config().notificationIssue, undefined);
    process.env.SMTP_PORT = "587";
    const config = new Config({ notify: true });
    assert.equal(config.client, "FromEnv");
    assert.equal(config.smtp.secure, false);
    assert.equal(config.notify, true);
    const explicit = new Config({ client: "Explicit", smtp });
    assert.equal(explicit.smtp.host, smtp.host);
    process.env.CLIENT_NAME = "ChangedEnv";
    assert.equal(config.clone().client, "FromEnv");
    process.env.SMTP_PORT = "587junk";
    assert.match(new Config({ notify: true }).notificationIssue, /port/i);
  } finally {
    for (const key of ["CLIENT_NAME", "SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_TO"]) delete process.env[key];
  }
});
