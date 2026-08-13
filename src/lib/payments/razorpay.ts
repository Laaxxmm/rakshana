import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { Decimal } from "decimal.js";

/**
 * Razorpay adapter. Same shape as `src/lib/storage/` and `src/lib/notify/`:
 * env-driven, cached on globalThis, built lazily.
 *
 * Nothing here reads the keys at import time — an NGO that hasn't signed up
 * for Razorpay yet must still be able to boot the app, log in and record
 * offline donations. Every entry point throws only when actually called.
 */

declare global {
  var __rakshanaRazorpay: Razorpay | undefined;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `${key} is not set — payment collection is disabled. Add the Razorpay keys to .env.`,
    );
  }
  return value;
}

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env["RAZORPAY_KEY_ID"] && process.env["RAZORPAY_KEY_SECRET"]);
}

function client(): Razorpay {
  return (globalThis.__rakshanaRazorpay ??= new Razorpay({
    key_id: requireEnv("RAZORPAY_KEY_ID"),
    key_secret: requireEnv("RAZORPAY_KEY_SECRET"),
  }));
}

/** Rupees (Decimal string) → integer paise, which is what the API wants. */
export function toPaise(amountInRupees: string): number {
  const paise = new Decimal(amountInRupees).times(100);
  if (!paise.isInteger() || paise.lessThanOrEqualTo(0)) {
    throw new Error(`Invalid amount: ${amountInRupees}`);
  }
  return paise.toNumber();
}

/**
 * Verify the `X-Razorpay-Signature` header against the RAW request body.
 * Constant-time compare — a fast-fail `===` leaks the expected digest one
 * byte at a time.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", requireEnv("RAZORPAY_WEBHOOK_SECRET"))
    .update(rawBody, "utf8")
    .digest();
  // Buffer.from silently drops invalid hex, so length is checked first —
  // timingSafeEqual throws on a length mismatch.
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type PaymentLinkInput = {
  amountInRupees: string;
  description: string;
  donorName?: string | null;
  donorPhone?: string | null;
  donorEmail?: string | null;
};

/**
 * Shareable payment link (WhatsApp / SMS). Razorpay's own notifications are
 * off: the 80G receipt dispatch in `src/lib/notify/` is the single channel
 * the donor hears from.
 */
export async function createPaymentLink(
  input: PaymentLinkInput,
): Promise<{ id: string; shortUrl: string }> {
  const link = await client().paymentLink.create({
    amount: toPaise(input.amountInRupees),
    currency: "INR",
    description: input.description,
    customer: {
      name: input.donorName ?? undefined,
      contact: input.donorPhone ?? undefined,
      email: input.donorEmail ?? undefined,
    },
    notify: { sms: false, email: false },
    reminder_enable: false,
  });
  return { id: link.id, shortUrl: link.short_url };
}

/**
 * Single-use fixed-amount UPI QR — the thing a volunteer holds up at a
 * fundraiser. `paymentIntentId` rides along in notes because the
 * `qr_code.credited` webhook carries no order id to look the row up by.
 */
export async function createUpiQr(input: {
  amountInRupees: string;
  name: string;
  paymentIntentId: string;
}): Promise<{ id: string; imageUrl: string }> {
  const qr = await client().qrCode.create({
    type: "upi_qr",
    name: input.name,
    usage: "single_use",
    fixed_amount: true,
    payment_amount: toPaise(input.amountInRupees),
    notes: { paymentIntentId: input.paymentIntentId },
  });
  return { id: qr.id, imageUrl: qr.image_url };
}
