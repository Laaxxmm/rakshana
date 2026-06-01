import type { EmailAdapter, EmailMessage, EmailSendResult } from "../types";

/**
 * Dev/test email adapter. Prints a clearly-tagged block to the server log
 * including subject, body length, and attachment metadata. The actual
 * message body is omitted from logs (could contain donor PII) — just length.
 */
export class ConsoleEmailAdapter implements EmailAdapter {
  readonly name = "console";

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    const id = `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const lines = [
      "----- [EMAIL] -----",
      `id:        ${id}`,
      `to:        ${msg.to}`,
      `from:      ${msg.from ?? "(default)"}`,
      `subject:   ${msg.subject}`,
      `html:      ${msg.html.length} chars`,
      ...(msg.attachments ?? []).map(
        (a, i) => `attach[${i}]: ${a.filename} (${a.contentType}, ${a.content.length} bytes)`,
      ),
      "-------------------",
    ];
    // Use console.log directly: pino-piped logs would obscure the visual block.
    console.log(lines.join("\n"));
    return { ok: true, id };
  }
}
