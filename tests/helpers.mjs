import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { VLoggo } from "../build/index.js";

// Tests must not use workstation SMTP credentials or application defaults.
for (const key of ["CLIENT_NAME", "SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_TO"]) delete process.env[key];

export function workspace(context) {
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "vloggo-test-"));
  const loggers = [];
  const options = { console: false, directory: { txt: path.join(root, "txt"), json: path.join(root, "json") } };
  context.after(async () => {
    try { await Promise.all(loggers.map(logger => logger.close().catch(() => {}))); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  return {
    root, options,
    logger(overrides = {}) {
      const logger = new VLoggo({ ...options, ...overrides });
      loggers.push(logger);
      return logger;
    },
  };
}

export function records(directory, extension = "jsonl") {
  return fs.readdirSync(directory).filter(file => file.endsWith(`.${extension}`))
    .flatMap(file => fs.readFileSync(path.join(directory, file), "utf8").trim().split("\n"))
    .map(line => extension === "jsonl" ? JSON.parse(line) : line);
}

/** A local SMTP peer that exercises real Nodemailer parsing, pooling, and delivery. */
export async function smtpServer(context, options = {}) {
  const sockets = new Set();
  const messages = [];
  let connections = 0;
  let attempts = 0;
  const server = net.createServer(socket => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let input = "";
    let data = false;
    let body = [];
    let auth = false;
    socket.write("220 localhost ESMTP test\r\n");
    socket.on("data", chunk => {
      input += chunk.toString();
      let index;
      while ((index = input.indexOf("\r\n")) >= 0) {
        const line = input.slice(0, index);
        input = input.slice(index + 2);
        if (data) {
          if (line === ".") {
            messages.push(body.join("\r\n"));
            data = false;
            body = [];
            if (!options.stall) socket.write("250 2.0.0 queued\r\n");
          } else body.push(line.replace(/^\.\./, "."));
          continue;
        }
        if (auth) { auth = false; socket.write(options.authFailure ? "535 Authentication failed\r\n" : "235 Authenticated\r\n"); }
        else if (/^EHLO|^HELO/.test(line)) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH PLAIN/.test(line)) {
          if (line.split(" ").length < 3) { auth = true; socket.write("334 \r\n"); }
          else socket.write(options.authFailure ? "535 Authentication failed\r\n" : "235 Authenticated\r\n");
        } else if (/^MAIL FROM:/.test(line)) {
          attempts++;
          if (options.disconnectOnce && attempts === 1) socket.destroy();
          else socket.write("250 Sender OK\r\n");
        } else if (/^RCPT TO:/.test(line)) socket.write(options.reject && line.includes(options.reject) ? "550 Recipient rejected\r\n" : "250 Recipient OK\r\n");
        else if (line === "DATA") { data = true; socket.write("354 End with dot\r\n"); }
        else if (line === "QUIT") socket.end("221 Bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return {
    messages, sockets,
    get connections() { return connections; },
    get attempts() { return attempts; },
    config: { host: "127.0.0.1", port: server.address().port, secure: false, username: "test", password: "test", from: "sender@example.test", to: "recipient@example.test" },
  };
}

export function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
