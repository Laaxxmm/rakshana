import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/payments/razorpay";
import { processRazorpayEvent, type RazorpayWebhookEvent } from "@/lib/payments/process-payment";
import { prismaUnsafe } from "@/lib/db/prisma";

/**
 * Razorpay webhook. Public path (see PUBLIC_PATHS in src/middleware.ts) —
 * the HMAC signature IS the authentication, so it is checked against the
 * raw body before anything is parsed or trusted.
 *
 * Events to enable in the Razorpay dashboard: the two sets below. Delivery
 * of two success events for the same payment is safe (see process-payment.ts).
 */

/** Money landed. These are the only events allowed to mint a Donation. */
const SUCCESS_EVENTS = new Set(["payment.captured", "payment_link.paid", "qr_code.credited"]);

/** Money will not land. Close the intent so the collect screen stops waiting. */
const FAILURE_EVENTS = new Set([
  "payment.failed",
  "payment_link.cancelled",
  "payment_link.expired",
]);

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();

  let verified = false;
  try {
    verified = verifyWebhookSignature(rawBody, req.headers.get("x-razorpay-signature"));
  } catch {
    // Webhook secret not configured — nothing can be trusted, so reject.
    verified = false;
  }
  if (!verified) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: RazorpayWebhookEvent;
  try {
    event = JSON.parse(rawBody) as RazorpayWebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const name = event.event ?? "";
  try {
    // Dispatch on the event name, not on "is there a payment entity" — a
    // payment.failed payload carries one too, and converting that would book
    // a donation for money that never arrived.
    if (FAILURE_EVENTS.has(name)) {
      const closed = await failIntent(event);
      return NextResponse.json({ status: closed ? "failed" : "ignored" });
    }
    if (!SUCCESS_EVENTS.has(name)) {
      return NextResponse.json({ status: "ignored", reason: `unhandled event ${name}` });
    }
    return NextResponse.json(await processRazorpayEvent(event));
  } catch (err) {
    // 500 makes Razorpay retry — the conversion is idempotent, so a retry
    // after a transient DB failure is exactly what we want.
    console.error("[razorpay] webhook failed", err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}

/**
 * Flip the matching PaymentIntent to FAILED. `prismaUnsafe` because a webhook
 * has no session; the match is on gateway-issued ids only, so no tenant data
 * is read from the payload.
 */
async function failIntent(event: RazorpayWebhookEvent): Promise<boolean> {
  const p = event.payload;
  const gatewayIds = [p?.payment_link?.entity?.id, p?.payment?.entity?.order_id].filter(isId);
  const intentIds = [p?.qr_code?.entity?.notes, p?.payment?.entity?.notes]
    .map((n) => n?.["paymentIntentId"])
    .filter(isId);
  if (gatewayIds.length === 0 && intentIds.length === 0) return false;

  // Guarded on CREATED so a late stray failure event can never un-confirm an
  // intent that already produced a donation.
  const res = await prismaUnsafe.paymentIntent.updateMany({
    where: {
      status: "CREATED",
      OR: [{ razorpayOrderId: { in: gatewayIds } }, { id: { in: intentIds } }],
    },
    data: { status: "FAILED" },
  });
  return res.count > 0;
}

function isId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
