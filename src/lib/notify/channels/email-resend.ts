import type { EmailAdapter, EmailMessage, EmailSendResult } from "../types";

/**
 * Resend email adapter — stub for Phase 6.
 *
 * When enabled:
 *  - Env: `EMAIL_DRIVER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (e.g.
 *    "Rakshana Trust <receipts@rakshana.org>").
 *  - Implementation: call `https://api.resend.com/emails` with the message
 *    body. Attachments go in the `attachments` array (base64-encoded content
 *    per Resend's schema).
 *  - Set up SPF / DKIM / DMARC on the sending domain BEFORE going live —
 *    80G receipts in spam mean donors don't get their tax certificates.
 *
 * Until lit up, throw with a clear message so a misconfiguration is loud.
 */
export class ResendEmailAdapter implements EmailAdapter {
  readonly name = "resend";

  async send(_msg: EmailMessage): Promise<EmailSendResult> {
    throw new Error(
      "[notify] ResendEmailAdapter not implemented — set EMAIL_DRIVER=console " +
        "or implement Resend (Phase 6 deploy).",
    );
  }
}
