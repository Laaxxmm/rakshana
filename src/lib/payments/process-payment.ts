import "server-only";
import { Decimal } from "decimal.js";
import { Prisma, type Prisma as P } from "@prisma/client";
import { prismaUnsafe } from "@/lib/db/prisma";
import { allocateReceiptNumber } from "@/lib/services/receipt-number";
import { getFinancialYear } from "@/lib/format/date";
import { generate80GReceipt } from "@/lib/pdf/receipt-80g";
import { dispatchDonationReceipt } from "@/lib/notify";

/**
 * Converts a verified Razorpay webhook into a Donation + 80G receipt.
 *
 * `prismaUnsafe` is used because a webhook has no session — so every read
 * and write below carries the organisationId taken from the PaymentIntent
 * row, never from the request payload. (Documented in REUSE-MAP.md.)
 *
 * Idempotency is a DB guarantee, not an if-check: the claim is a single
 * `UPDATE … WHERE razorpayPaymentId IS NULL`, and PaymentIntent.razorpayPaymentId
 * is unique. A redelivered payment updates zero rows and the whole
 * transaction (donation included) never runs.
 */

type Entity = {
  id?: string;
  order_id?: string | null;
  /** Captured amount in paise — Razorpay never sends rupees. */
  amount?: number;
  notes?: Record<string, unknown>;
};

export type RazorpayWebhookEvent = {
  event?: string;
  payload?: {
    payment?: { entity?: Entity };
    payment_link?: { entity?: Entity };
    qr_code?: { entity?: Entity };
  };
};

export type ProcessResult =
  | { status: "ignored"; reason: string }
  | { status: "duplicate" }
  | { status: "converted"; donationId: string };

type TxClient = P.TransactionClient;

export async function processRazorpayEvent(
  event: RazorpayWebhookEvent,
): Promise<ProcessResult> {
  const payment = event.payload?.payment?.entity;
  const paymentId = payment?.id;
  if (!paymentId) return { status: "ignored", reason: "no payment entity" };

  const intent = await findIntent(event);
  if (!intent) return { status: "ignored", reason: "no matching payment intent" };
  if (intent.donationId) return { status: "duplicate" };

  // Book what the gateway says was actually captured, not what we asked for.
  // Razorpay enforces the amount for fixed orders, but a variable-amount QR
  // lets the donor choose, and receipting more than was paid would be a
  // false 80G claim. Rejecting is worse than recording the true figure, so
  // we take the captured amount and record the discrepancy for review.
  const capturedPaise =
    typeof payment.amount === "number" && Number.isFinite(payment.amount)
      ? payment.amount
      : null;
  const expected = new Decimal(intent.amount.toString());
  let bookedAmount = expected;
  let amountNote: string | null = null;
  if (capturedPaise !== null) {
    const captured = new Decimal(capturedPaise).div(100);
    if (!captured.eq(expected)) {
      bookedAmount = captured;
      amountNote =
        `Gateway captured ${captured.toFixed(2)} against an intent of ${expected.toFixed(2)}.`;
      console.warn(`[razorpay] amount mismatch on ${paymentId}: ${amountNote}`);
    }
  }

  const donationId = await prismaUnsafe.$transaction(async (tx) => {
    const claimed = await tx.paymentIntent.updateMany({
      where: { id: intent.id, razorpayPaymentId: null },
      data: { razorpayPaymentId: paymentId, status: "PAID" },
    });
    if (claimed.count === 0) return null;

    const donor = await resolveDonor(tx, intent);
    const paidAt = new Date();
    const allocated = await allocateReceiptNumber(tx, {
      organisationId: intent.organisationId,
      isFcra: false,
      financialYear: getFinancialYear(paidAt),
    });

    const donation = await tx.donation.create({
      data: {
        organisationId: intent.organisationId,
        donorId: donor.id,
        receiptNumber: allocated.receiptNumber,
        receiptSeriesId: allocated.seriesId,
        donationDate: paidAt,
        amount: bookedAmount.toFixed(2),
        mode: "ONLINE_GATEWAY",
        paymentRef: paymentId,
        paymentDate: paidAt,
        purpose: intent.purpose,
        is80GEligible: true,
        // A log line is not an audit trail — if the captured amount differed
        // from what was requested, that has to travel with the donation.
        ...(amountNote ? { remarks: amountNote } : {}),
        status: "RECEIVED",
      },
    });

    await tx.donor.update({
      where: { id: donor.id },
      data: {
        totalDonatedLifetime: { increment: new Prisma.Decimal(bookedAmount.toFixed(2)) },
        lastDonationDate: paidAt,
      },
    });

    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: { donationId: donation.id },
    });

    return donation.id;
  });

  if (!donationId) return { status: "duplicate" };

  // Same post-commit sequence as `recordDonation`: PDF first (the dispatch
  // attaches it), then fire-and-forget the notification so Razorpay isn't
  // kept waiting on SMTP.
  await generate80GReceipt(donationId);
  queueMicrotask(() => {
    dispatchDonationReceipt(donationId).catch((err) => {
      console.error("[razorpay] receipt dispatch failed", err);
    });
  });

  return { status: "converted", donationId };
}

/**
 * Resolve the intent from whichever entity the event carries: a payment
 * link / order id matches `razorpayOrderId`; a QR carries our own id in
 * notes because `qr_code.credited` has no order to key off.
 */
async function findIntent(event: RazorpayWebhookEvent) {
  const p = event.payload;
  const gatewayIds = [p?.payment_link?.entity?.id, p?.payment?.entity?.order_id].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const noteIds = [p?.qr_code?.entity?.notes, p?.payment?.entity?.notes]
    .map((n) => n?.["paymentIntentId"])
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  if (gatewayIds.length === 0 && noteIds.length === 0) return null;

  return prismaUnsafe.paymentIntent.findFirst({
    where: {
      OR: [{ razorpayOrderId: { in: gatewayIds } }, { id: { in: noteIds } }],
    },
  });
}

type IntentRow = NonNullable<Awaited<ReturnType<typeof findIntent>>>;

/** Match an existing donor on phone/email within the org, else create one. */
async function resolveDonor(tx: TxClient, intent: IntentRow) {
  const phone = intent.donorPhone?.trim() || null;
  const email = intent.donorEmail?.trim() || null;

  const match = [
    ...(phone ? [{ phone }] : []),
    ...(email ? [{ email }] : []),
  ];
  if (match.length > 0) {
    const existing = await tx.donor.findFirst({
      where: { organisationId: intent.organisationId, OR: match },
    });
    if (existing) return existing;
  }

  return tx.donor.create({
    data: {
      organisationId: intent.organisationId,
      donorType: "INDIVIDUAL",
      name: intent.donorName?.trim() || "Online donor",
      phone,
      whatsapp: phone,
      email,
    },
  });
}
