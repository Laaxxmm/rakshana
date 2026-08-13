import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/payments/razorpay";
import { processRazorpayEvent } from "@/lib/payments/process-payment";

/**
 * Razorpay webhook. Public path (see PUBLIC_PATHS in src/middleware.ts) —
 * the HMAC signature IS the authentication, so it is checked against the
 * raw body before anything is parsed or trusted.
 *
 * Events to enable in the Razorpay dashboard: payment.captured,
 * payment_link.paid, qr_code.credited. All three land here; delivery of
 * two events for the same payment is safe (see process-payment.ts).
 */
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

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  try {
    const result = await processRazorpayEvent(event as Parameters<typeof processRazorpayEvent>[0]);
    return NextResponse.json(result);
  } catch (err) {
    // 500 makes Razorpay retry — the conversion is idempotent, so a retry
    // after a transient DB failure is exactly what we want.
    console.error("[razorpay] webhook failed", err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
