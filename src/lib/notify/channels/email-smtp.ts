import nodemailer, { type Transporter } from "nodemailer";
import type {
  EmailAdapter,
  EmailMessage,
  EmailSendResult,
} from "../types";

/**
 * SMTP email adapter.
 *
 * Works with any SMTP provider (Gmail, Yahoo, Outlook, custom). Default
 * config below is tuned for **Gmail with an App Password**:
 *
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=465
 *   SMTP_SECURE=true             (port 465 → TLS; port 587 → STARTTLS)
 *   SMTP_USER=youraddress@gmail.com
 *   SMTP_PASS=<16-char Gmail App Password — NOT your Google password>
 *   EMAIL_FROM=Rakshana Trust <youraddress@gmail.com>
 *
 * **Important Gmail setup steps:**
 *   1. Enable 2FA on the Google account (required to create app passwords)
 *   2. https://myaccount.google.com/apppasswords → generate one for "Mail"
 *   3. Use the 16-character password (no spaces) as SMTP_PASS
 *   4. Send "from" address must match SMTP_USER (Gmail enforces this)
 *
 * Gmail's free tier limits: ~500 messages/day, ~100 recipients/message.
 * Plenty for a charitable trust's receipt + reminder volume.
 */
export class SmtpEmailAdapter implements EmailAdapter {
  readonly name = "smtp";
  private transporter: Transporter | null = null;
  private defaultFrom: string;

  constructor() {
    this.defaultFrom =
      process.env["EMAIL_FROM"] ??
      process.env["SMTP_USER"] ??
      "no-reply@localhost";
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const host = process.env["SMTP_HOST"] ?? "smtp.gmail.com";
    const port = Number(process.env["SMTP_PORT"] ?? "465");
    const secure =
      (process.env["SMTP_SECURE"] ?? "true").toLowerCase() === "true";
    const user = process.env["SMTP_USER"];
    const pass = process.env["SMTP_PASS"];
    if (!user || !pass) {
      throw new Error(
        "SMTP_USER and SMTP_PASS must be set. For Gmail, generate an App Password at https://myaccount.google.com/apppasswords (requires 2FA).",
      );
    }
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    return this.transporter;
  }

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: msg.from ?? this.defaultFrom,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        attachments: msg.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      return { ok: true, id: info.messageId };
    } catch (err) {
      console.error("[smtp-email] send failed", err);
      return { ok: false, error: (err as Error).message };
    }
  }
}
