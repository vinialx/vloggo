import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Config from "../build/config/config.js";
import FileService from "../build/internal/fileService.js";
import { workspace } from "./helpers.mjs";

test("retention runs at startup, sorts dates, and protects unrelated files and symlinks", async context => {
  const work = workspace(context);
  const directory = work.options.directory.txt;
  fs.mkdirSync(directory);
  const names = ["log-2026-01-01.txt", "log-2026-01-02.txt", "notes.txt", "log-2026-02-30.txt"];
  for (const name of names) fs.writeFileSync(path.join(directory, name), name);
  fs.utimesSync(path.join(directory, names[0]), new Date("2030-01-01"), new Date("2030-01-01"));
  const external = path.join(work.root, "external.txt");
  fs.writeFileSync(external, "must survive");
  fs.symlinkSync(external, path.join(directory, "log-2025-01-01.txt"));
  fs.mkdirSync(path.join(directory, "log-2025-02-01.txt"));
  const files = new FileService(new Config({ ...work.options, filecount: { txt: 2 } }));
  files.initialize(new Date(2026, 0, 3, 12));
  await files.flush();
  assert.equal(fs.existsSync(path.join(directory, names[0])), false);
  for (const name of [names[1], names[2], names[3], "log-2026-01-03.txt", "log-2025-01-01.txt", "log-2025-02-01.txt"]) {
    assert.equal(fs.existsSync(path.join(directory, name)), true, name);
  }
  assert.equal(fs.readFileSync(external, "utf8"), "must survive");
});

test("full dates rotate after an idle month and across years", async context => {
  const work = workspace(context);
  const files = new FileService(new Config({ ...work.options, rotation: { retentionDays: 1000 } }));
  files.write("january\n", undefined, new Date(2026, 0, 15, 12));
  files.write("february\n", undefined, new Date(2026, 1, 15, 12));
  files.write("next year\n", undefined, new Date(2027, 1, 15, 12));
  await files.flush();
  for (const [date, text] of [["2026-01-15", "january"], ["2026-02-15", "february"], ["2027-02-15", "next year"]]) {
    assert.match(fs.readFileSync(path.join(work.options.directory.txt, `log-${date}.txt`), "utf8"), new RegExp(text));
  }
});

test("rotation failure retries the same day without writing into previous file", async context => {
  const work = workspace(context);
  const files = new FileService(new Config(work.options));
  files.write("old\n", undefined, new Date(2026, 0, 1, 12));
  await files.flush();
  const next = path.join(work.options.directory.txt, "log-2026-01-02.txt");
  fs.mkdirSync(next);
  files.write("lost\n", undefined, new Date(2026, 0, 2, 12));
  assert.doesNotMatch(fs.readFileSync(path.join(work.options.directory.txt, "log-2026-01-01.txt"), "utf8"), /lost/);
  fs.rmdirSync(next);
  files.write("recovered\n", undefined, new Date(2026, 0, 2, 12));
  await files.flush();
  assert.match(fs.readFileSync(path.join(work.options.directory.txt, "log-2026-01-02.001.txt"), "utf8"), /recovered/);
});

test("text failures do not block JSON and recover after directory becomes writable", async context => {
  const work = workspace(context);
  fs.writeFileSync(work.options.directory.txt, "blocks mkdir");
  const files = new FileService(new Config({ ...work.options, json: true }));
  const date = new Date(2026, 0, 1, 12);
  files.write("text\n", '{"message":"json survives"}\n', date);
  await files.flush();
  assert.match(fs.readFileSync(path.join(work.options.directory.json, "log-2026-01-01.jsonl"), "utf8"), /json survives/);
  fs.unlinkSync(work.options.directory.txt);
  files.write("recovered\n", '{"message":"again"}\n', date);
  await files.flush();
  assert.match(fs.readFileSync(path.join(work.options.directory.txt, "log-2026-01-01.txt"), "utf8"), /recovered/);
});

test("active log creation never follows a symlink to another file", async context => {
  const work = workspace(context);
  fs.mkdirSync(work.options.directory.txt, { recursive: true });
  const external = path.join(work.root, "outside.txt");
  fs.writeFileSync(external, "keep this file unchanged");
  const target = path.join(work.options.directory.txt, "log-2026-01-01.txt");
  fs.symlinkSync(external, target);
  const files = new FileService(new Config(work.options));
  files.write("safe event\n", undefined, new Date(2026, 0, 1, 12));
  await files.flush();
  assert.equal(fs.readFileSync(external, "utf8"), "keep this file unchanged");
  assert.match(fs.readFileSync(path.join(work.options.directory.txt, "log-2026-01-01.001.txt"), "utf8"), /safe event/);
});

test("JSON toggles and directory changes take effect immediately", async context => {
  const work = workspace(context);
  const logger = work.logger();
  logger.config.update({ json: true });
  logger.info("JSON_ON", "first");
  const moved = path.join(work.root, "moved");
  logger.config.update({ directory: { txt: moved, json: moved }, filecount: { txt: 1, json: 1 } });
  logger.info("MOVED", "second");
  logger.config.update({ json: false });
  logger.info("JSON_OFF", "third");
  await logger.flush();
  const txt = fs.readdirSync(moved).find(file => file.endsWith(".txt"));
  const json = fs.readdirSync(moved).find(file => file.endsWith(".jsonl"));
  assert.match(fs.readFileSync(path.join(moved, txt), "utf8"), /JSON_OFF/);
  assert.match(fs.readFileSync(path.join(moved, json), "utf8"), /MOVED/);
  assert.doesNotMatch(fs.readFileSync(path.join(moved, json), "utf8"), /JSON_OFF/);
});

test("multiple instances can clean a shared dedicated directory concurrently", async context => {
  const work = workspace(context);
  fs.mkdirSync(work.options.directory.txt);
  for (let day = 1; day <= 5; day++) fs.writeFileSync(path.join(work.options.directory.txt, `log-2025-01-0${day}.txt`), "old");
  const a = work.logger({ filecount: { txt: 1 } });
  const b = work.logger({ filecount: { txt: 1 } });
  a.info("A", "a"); b.info("B", "b");
  await Promise.all([a.flush(), b.flush()]);
  assert.equal(fs.readdirSync(work.options.directory.txt).length, 1);
});
