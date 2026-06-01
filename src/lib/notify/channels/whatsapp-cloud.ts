import type { WhatsAppAdapter, WhatsAppMessage, WhatsAppSendResult } from "../types";

/**
 * WhatsApp Cloud API adapter — stub for Phase 6.
 *
 * Env when enabled:
 *  - `WHATSAPP_DRIVER=cloud`
 *  - `WHATSAPP_PHONE_ID` — Business phone-number id from Meta
 *  - `WHATSAPP_ACCESS_TOKEN` — system-user permanent token (rotate ≥ yearly)
 *
 * Implementation:
 *  POST https://graph.facebook.com/v20.0/{WHATSAPP_PHONE_ID}/messages
 *  body: { messaging_product: "whatsapp", to, type: "template", template: { name, components } }
 *
 * Templates must be pre-approved in WhatsApp Business Manager. Until then,
 * this stub throws so a misconfiguration is loud rather than silent.
 */
export class CloudWhatsAppAdapter implements WhatsAppAdapter {
  readonly name = "cloud";

  async send(_msg: WhatsAppMessage): Promise<WhatsAppSendResult> {
    throw new Error(
      "[notify] CloudWhatsAppAdapter not implemented — set WHATSAPP_DRIVER=console " +
        "or implement Cloud API (Phase 6 deploy).",
    );
  }
}
