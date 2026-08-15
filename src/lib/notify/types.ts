/**
 * Notify abstraction. Two channels (email, whatsapp), one adapter shape
 * per channel. Console adapter is the dev default; real Resend / WhatsApp
 * Cloud adapters are stubbed for Phase 6 deploy.
 *
 * Same pattern as `src/lib/storage/`: interface → adapters → factory by
 * env var.
 */

// ----- Email -----

export type EmailAttachment = {
  filename: string;
  /** Raw bytes. Adapters base64-encode if their transport needs it. */
  content: Buffer;
  contentType: string;
};

export type EmailMessage = {
  to: string;
  from?: string; // adapter applies a sensible default from env
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
};

export type EmailSendResult = { ok: true; id: string } | { ok: false; error: string };

export interface EmailAdapter {
  readonly name: string;
  send(msg: EmailMessage): Promise<EmailSendResult>;
}

// ----- WhatsApp -----

/**
 * Text only. There is no media field: every receipt URL this app can mint is
 * `/api/files/…`, which requires a session in the owning organisation, so it
 * is unopenable by the donor and unfetchable by Meta. A media field would only
 * ever carry a link that promises a document nobody outside the trust can
 * reach. Adding one back means first adding a signed, expiring, single-purpose
 * receipt route for it to point at.
 */
export type WhatsAppMessage = {
  /** E.164 phone number (e.g. +91987…). */
  to: string;
  templateName: string;
  /** Named substitutions for the template body. */
  params: Record<string, string>;
};

export type WhatsAppSendResult = { ok: true; id: string } | { ok: false; error: string };

export interface WhatsAppAdapter {
  readonly name: string;
  /**
   * False when `send` only prepares a message a human still has to tap —
   * the click-to-chat adapter builds a wa.me URL and nothing leaves the
   * building. The dispatch layer reports those separately, because telling
   * a volunteer a receipt was sent when it is sitting in a log is how a
   * donor ends up without their 80G evidence and nobody chases it.
   */
  readonly delivers: boolean;
  send(msg: WhatsAppMessage): Promise<WhatsAppSendResult>;
}
