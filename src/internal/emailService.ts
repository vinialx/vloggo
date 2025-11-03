import nodemailer from "nodemailer";
import Config from "../config/config";

import FormatService from "./formatService";

/**
 * Service responsible for sending email notifications via SMTP.
 * Handles error notifications with throttling to prevent spam.
 *
 * @class EmailService
 */

class EmailService {
  private format: FormatService = new FormatService();
  private transporter: nodemailer.Transporter | null = null;

  private _ready: boolean = false;
  private lastEmailSent: number = 0;

  /**
   * Creates an instance of EmailService and initializes the SMTP transport.
   *
   * @param {Config} config - Configuration object containing SMTP settings
   */

  constructor(private config: Config) {
    this.initialize();
  }

  /**
   * Initializes SMTP transport using nodemailer.
   * Sets up connection pooling and authentication.
   * Logs initialization status if debug mode is enabled.
   *
   * @private
   * @returns {void}
   */

  private initialize(): void {
    if (!this.config.smtp) {
      if (this.config.console) {
        console.info(
          `[Loggo] > [${this.config.client}] [${this.format.date()}] [INFO] : notification service disabled > missing configuration`
        );
      }
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: this.config.smtp.secure ?? this.config.smtp.port === 465,
        pool: true,
        auth: {
          user: this.config.smtp.username,
          pass: this.config.smtp.password,
        },
        debug: this.config.debug,
        logger: this.config.debug,
      });

      this._ready = true;

      if (this.config.debug) {
        console.info(
          `[Loggo] > [${this.config.client}] [${this.format.date()}] [INFO] : notification service initialized succesfully`
        );
      }
    } catch (error) {
      console.error(
        `[Loggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : error initializing notification service > ${(error as Error).message}`
      );

      this.transporter = null;
    }
  }

  /**
   * Sends an error notification email to configured recipients.
   * Implements throttling based on config.throttle to prevent email spam.
   *
   * @async
   * @param {string} client - Name of the client/application reporting the error
   * @param {string} code - Error code identifier
   * @param {string} error - Detailed error message
   * @returns {Promise<void>}
   *
   * @example
   * ```typescript
   * await emailService.sendErrorNotification(
   *   "MyApp",
   *   "ERR_DATABASE",
   *   "Failed to connect to database"
   * );
   * ```
   */

  async sendErrorNotification(
    client: string,
    code: string,
    error: string
  ): Promise<void> {
    if (!this.transporter || !this.config.smtp) {
      console.error(
        `[Loggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : failed to send error message > email service not initialized`
      );
      return;
    }

    const now = Date.now();

    if (now - this.lastEmailSent < this.config.throttle) {
      if (this.config.debug) {
        console.info(
          `[Loggo] > [${this.config.client}] [${this.format.date()}] [INFO] : email throttled > ${now - this.lastEmailSent} ms remaining`
        );
      }

      return;
    }

    this.lastEmailSent = now;

    const recipients = Array.isArray(this.config.smtp.to)
      ? this.config.smtp.to.join(", ")
      : this.config.smtp.to;

    const caller = this.format.caller(3);

    const emailContent = {
      from: `"${client}" <${this.config.smtp.from}>`,
      to: recipients,
      subject: `[${client}] Error Alert - ${code}`,
      html: `
        <h2>Error Report</h2>
        <p><strong>Client:</strong> ${client}</p>
        <p><strong>Error Code:</strong> ${code}</p>
        <p><strong>Caller:</strong> ${caller}</p>
        <p><strong>Error Message:</strong> ${error}</p>
        <p><strong>Timestamp:</strong> ${new Date().toLocaleString("pt-BR")}</p>
        <hr>
      `,
    };

    try {
      await this.transporter.sendMail(emailContent);
      if (this.config.debug) {
        console.info(
          `[Loggo] > [${this.config.client}] [${this.format.date()}] [INFO] : error email sent successfully to ${recipients}`
        );
      }
    } catch (error) {
      console.error(
        `[Loggo] > [${this.config.client}] [${this.format.date()}] [ERROR] : failed to send error message > ${(error as Error).message}`
      );
    }
  }

  /**
   * Gets the ready status of the email service.
   *
   * @readonly
   * @returns {boolean} True if the service is initialized and ready to send emails
   */

  get ready(): boolean {
    return this._ready;
  }
}

export default EmailService;
