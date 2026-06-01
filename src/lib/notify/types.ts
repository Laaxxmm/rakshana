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

export type WhatsAppMessage = {
  /** E.164 phone number (e.g. +91987…). */
  to: string;
  templateName: string;
  /** Named substitutions for the template body. */
  params: Record<string, string>;
  /** Optional file the recipient can tap to download (signed-URL'd PDF). */
  mediaUrl?: string;
};

export type WhatsAppSendResult = { ok: true; id: string } | { ok: false; error: string };

export interface WhatsAppAdapter {
  readonly name: string;
  send(msg: WhatsAppMessage): Promise<WhatsAppSendResult>;
}
