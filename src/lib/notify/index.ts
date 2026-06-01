import type { EmailAdapter, WhatsAppAdapter } from "./types";
import { ConsoleEmailAdapter } from "./channels/email-console";
import { ResendEmailAdapter } from "./channels/email-resend";
import { SmtpEmailAdapter } from "./channels/email-smtp";
import { ConsoleWhatsAppAdapter } from "./channels/whatsapp-console";
import { CloudWhatsAppAdapter } from "./channels/whatsapp-cloud";
import { LinkWhatsAppAdapter } from "./channels/whatsapp-link";

declare global {
  var __rakshanaEmail: EmailAdapter | undefined;
  var __rakshanaWhatsApp: WhatsAppAdapter | undefined;
}

function buildEmail(): EmailAdapter {
  const driver = (process.env["EMAIL_DRIVER"] ?? "console").toLowerCase();
  if (driver === "resend") return new ResendEmailAdapter();
  if (driver === "smtp" || driver === "gmail") return new SmtpEmailAdapter();
  return new ConsoleEmailAdapter();
}

function buildWhatsApp(): WhatsAppAdapter {
  const driver = (process.env["WHATSAPP_DRIVER"] ?? "console").toLowerCase();
  if (driver === "cloud") return new CloudWhatsAppAdapter();
  if (driver === "link" || driver === "wame") return new LinkWhatsAppAdapter();
  return new ConsoleWhatsAppAdapter();
}

export const email: EmailAdapter =
  globalThis.__rakshanaEmail ?? (globalThis.__rakshanaEmail = buildEmail());

export const whatsapp: WhatsAppAdapter =
  globalThis.__rakshanaWhatsApp ?? (globalThis.__rakshanaWhatsApp = buildWhatsApp());

export type * from "./types";
export { dispatchDonationReceipt } from "./dispatch";
