import type {
  WhatsAppAdapter,
  WhatsAppMessage,
  WhatsAppSendResult,
} from "../types";

/**
 * "Click-to-chat" WhatsApp adapter.
 *
 * Doesn't actually send anything programmatically — instead it constructs
 * a `https://wa.me/<phone>?text=<message>` URL and returns it as the
 * `id` field of the result. The UI is expected to open this URL, which
 * launches WhatsApp Web / mobile app with the message and recipient
 * pre-filled; the user (typically the accountant) taps Send to dispatch.
 *
 * Why this exists:
 *   - Zero setup. No Meta business verification, no template approval,
 *     no API credentials. Works the moment WhatsApp is installed.
 *   - Free forever. No per-conversation cost.
 *   - The trust accountant is in the loop on every send — useful for
 *     small org receipt dispatch where a typo in the donor profile
 *     would otherwise blast wrong-recipient messages.
 *
 * Trade-offs:
 *   - Not automatable — every send is a manual tap. Phase 6 layers a
 *     "bulk WhatsApp" flow on top by opening N tabs sequentially.
 *   - No delivery / read receipts via Rakshana. We mark
 *     `Donation.whatsappedAt` when the URL is opened, not when WhatsApp
 *     itself confirms delivery.
 *
 * Phone format: WhatsApp wants international format WITHOUT the `+` and
 * WITHOUT spaces (`+91 98765 43210` → `919876543210`). We normalise.
 *
 * Body: the `templateName` is ignored (no Meta templates here). The
 * message is built from the `params` map by joining key:value lines —
 * the dispatch layer already passes a sensible body via the `body` key.
 */
export class LinkWhatsAppAdapter implements WhatsAppAdapter {
  readonly name = "link";

  async send(msg: WhatsAppMessage): Promise<WhatsAppSendResult> {
    const e164 = normalisePhone(msg.to);
    if (!e164) {
      return { ok: false, error: `Invalid phone number: ${msg.to}` };
    }
    const text = buildMessageText(msg);
    const url = `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
    // We return the URL via `id` so the action layer can pass it to the
    // browser. Logging here is intentional — operators sometimes want to
    // see the exact URL produced.
    console.log(`[whatsapp-link] ready to send to ${e164}: ${url}`);
    return { ok: true, id: url };
  }
}

/**
 * Normalise an Indian phone number to international format without the
 * `+` so WhatsApp accepts it. Returns `null` if the input doesn't look
 * like a valid number.
 *
 *   "+91 98765 43210"  → "919876543210"
 *   "919876543210"     → "919876543210"
 *   "9876543210"       → "919876543210"   (assume India default)
 *   "98765 43210"      → "919876543210"
 *   "+1 415 555 0100"  → "14155550100"
 */
function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) return `91${digits}`; // assume India
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/**
 * Build the prefilled message text. Special keys the dispatch layer can
 * pass through `params`:
 *   - `body`    → the full message; if present, used verbatim
 *   - `link`    → appended on its own line with a "📎 Receipt:" prefix
 *
 * Otherwise we render every param as `Label: value` lines.
 */
function buildMessageText(msg: WhatsAppMessage): string {
  if (msg.params["body"]) {
    let body = msg.params["body"];
    if (msg.mediaUrl) {
      body += `\n\n📎 Receipt: ${msg.mediaUrl}`;
    } else if (msg.params["link"]) {
      body += `\n\n📎 ${msg.params["link"]}`;
    }
    return body;
  }
  const lines: string[] = [];
  for (const [k, v] of Object.entries(msg.params)) {
    if (k === "link") continue;
    lines.push(`${humanise(k)}: ${v}`);
  }
  if (msg.mediaUrl) lines.push(`📎 Receipt: ${msg.mediaUrl}`);
  else if (msg.params["link"]) lines.push(`📎 ${msg.params["link"]}`);
  return lines.join("\n");
}

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
