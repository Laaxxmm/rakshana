import type { WhatsAppAdapter, WhatsAppMessage, WhatsAppSendResult } from "../types";

export class ConsoleWhatsAppAdapter implements WhatsAppAdapter {
  readonly name = "console";
  /** Prints to stdout for local development; nothing reaches a donor. */
  readonly delivers = false;

  async send(msg: WhatsAppMessage): Promise<WhatsAppSendResult> {
    const id = `wa-console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const lines = [
      "----- [WHATSAPP] -----",
      `id:        ${id}`,
      `to:        ${msg.to}`,
      `template:  ${msg.templateName}`,
      ...Object.entries(msg.params).map(([k, v]) => `params.${k}: ${v}`),
      "----------------------",
    ];
    console.log(lines.join("\n"));
    return { ok: true, id };
  }
}
