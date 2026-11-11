import nodemailer, { type Transporter } from "nodemailer";
import { performance } from "node:perf_hooks";
import type Config from "../config/config.js";
import type { LogEntry } from "../interfaces/interfaces.js";
import FormatService from "./formatService.js";
import { diagnostic } from "./diagnostics.js";

function escapeHtml(value: string): string {
  const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, character => escapes[character]);
}

interface TransportState {
  transport: Transporter;
  pending: number;
  retired: boolean;
}

/** Owns SMTP configuration, notifications, retry throttling, and transport lifetime. */
export default class EmailService {
  private format: FormatService;
  private current?: TransportState;
  private transports = new Set<TransportState>();
  private settings = "";
  private pending = new Set<Promise<void>>();
  private controllers = new Set<AbortController>();
  private inFlight = false;
  private lastSuccess = -Infinity;
  private retryAfter = -Infinity;
  private reportedIssue = "";
  private closed = false;

  constructor(private config: Config) {
    this.format = new FormatService(config.client, config.format.timezone);
    this.reconfigure();
  }

  reconfigure(): void {
    if (this.closed) return;
    this.format.setTimezone(this.config.format.timezone);
    const smtp = this.config.smtp;
    const issue = this.config.notificationIssue;
    const settings = JSON.stringify({
      enabled: this.config.notify,
      smtp: this.config.notify ? smtp : undefined,
      issue: this.config.notify ? issue : undefined,
      console: this.config.outputs.console,
    });
    if (settings === this.settings) return;
    this.settings = settings;

    if (this.current) {
      this.current.retired = true;
      this.release(this.current);
      this.current = undefined;
    }

    if (!this.config.notify) {
      this.reportedIssue = "";
      return;
    }
    if (!smtp || issue) {
      if (issue && this.reportedIssue !== issue) {
        this.reportedIssue = issue;
        diagnostic(this.config, `notifications enabled but ${issue}`, undefined, "SMTP_CONFIG");
      }
      return;
    }
    this.reportedIssue = "";

    try {
      const transport = nodemailer.createTransport({
        host: smtp.host, port: smtp.port, secure: smtp.secure,
        requireTLS: smtp.requireTLS, pool: true,
        auth: { user: smtp.username, pass: smtp.password },
        connectionTimeout: smtp.connectionTimeout ?? 10000,
        greetingTimeout: smtp.greetingTimeout ?? 10000,
        socketTimeout: smtp.socketTimeout ?? 10000,
        debug: Boolean(smtp.debug && this.config.outputs.console),
        logger: Boolean(smtp.debug && this.config.outputs.console),
      });
      this.current = { transport, pending: 0, retired: false };
      this.transports.add(this.current);
    } catch (error) {
      diagnostic(this.config, "failed to initialize notification service", error);
    }
  }

  sendErrorNotification(entry: LogEntry): Promise<void> {
    if (this.closed || !this.config.notify) return Promise.resolve();
    this.reconfigure();
    const state = this.current;
    const smtp = this.config.smtp;
    const now = performance.now();
    if (!state || !smtp || this.inFlight || now < this.retryAfter || now - this.lastSuccess < this.config.throttle) {
      return Promise.resolve();
    }

    this.inFlight = true;
    state.pending++;
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(new Error("Notification timed out")), this.config.notificationTimeout);
    const date = new Date(entry.timestamp);
    const fields = [
      ["Event ID", entry.eventId],
      ["Timestamp", this.format.emailDate(date)],
      ["Application", entry.client],
      ["Level", entry.level],
      ["Code", entry.code],
      ["Caller", entry.caller],
      ["Message", entry.message],
    ];
    const details = {
      ...(entry.context ? { context: entry.context } : {}),
      ...(entry.data ? { data: entry.data } : {}),
      ...(entry.error ? { error: entry.error } : {}),
    };
    const detailsText = Object.keys(details).length ? `\n\nDetails\n${JSON.stringify(details, null, 2)}` : "";
    const detailsHtml = Object.keys(details).length
      ? `<h3>Details</h3><pre>${escapeHtml(JSON.stringify(details, null, 2))}</pre>`
      : "";
    const attempt = (async () => {
      try {
        const info = await state.transport.sendMail({
          from: { name: entry.client, address: smtp.from },
          to: typeof smtp.to === "string" ? smtp.to : [...smtp.to],
          subject: `[${entry.level}] ${entry.client} - ${entry.code}`,
          text: `${fields.map(([label, value]) => `${label}: ${value}`).join("\n")}${detailsText}`,
          html: `<h2>${escapeHtml(entry.level)}: ${escapeHtml(entry.client)}</h2><p>${escapeHtml(entry.message)}</p><dl>${fields.filter(([label]) => label !== "Message").map(([label, value]) => `<dt><strong>${escapeHtml(label)}</strong></dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>${detailsHtml}`,
          signal: controller.signal,
        });
        this.lastSuccess = performance.now();
        this.retryAfter = -Infinity;
        if (info.rejected?.length) {
          diagnostic(this.config, `SMTP rejected ${info.rejected.length} recipient(s)`);
        }
      } catch (error) {
        this.retryAfter = performance.now() + this.config.retryDelay;
        diagnostic(this.config, "failed to send error notification", error);
      } finally {
        clearTimeout(timer);
        this.controllers.delete(controller);
        this.inFlight = false;
        state.pending--;
        this.release(state);
      }
    })();
    this.pending.add(attempt);
    void attempt.then(() => { this.pending.delete(attempt); });
    return attempt;
  }

  private release(state: TransportState): void {
    if (state.retired && !state.pending) {
      state.transport.close();
      this.transports.delete(state);
    }
  }

  async flush(): Promise<void> { await Promise.all([...this.pending]); }

  close(force = false): void {
    this.closed = true;
    if (force) for (const controller of this.controllers) controller.abort(new Error("Logger closed"));
    for (const state of this.transports) {
      state.retired = true;
      if (force) state.transport.close({ force: true });
      else this.release(state);
    }
    if (force) this.transports.clear();
    this.current = undefined;
  }

  get ready(): boolean { return Boolean(!this.closed && this.config.notify && this.current); }
}
