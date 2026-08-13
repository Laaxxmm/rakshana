"use server";

import { z } from "zod";
import { Decimal } from "decimal.js";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";
import { createPaymentLink, createUpiQr } from "@/lib/payments/razorpay";

const collectSchema = z.object({
  amount: z
    .string()
    .refine((v) => {
      try {
        return new Decimal(v).greaterThan(0);
      } catch {
        return false;
      }
    }, "Enter a valid amount")
    .transform((v) => new Decimal(v).toFixed(2)),
  donorName: z.string().trim().min(1, "Donor name is required"),
  donorPhone: z.string().trim().min(6, "Phone number is required"),
  donorEmail: z.string().trim().email().optional().or(z.literal("")),
});

/**
 * One button, one link. Creates the Razorpay payment link (shareable) and a
 * single-use UPI QR (scannable), then records the PaymentIntent the webhook
 * will convert into a Donation once the money actually lands.
 */
export const createCollectionLink = safeAction
  .metadata({ requires: "payment.link.create" })
  .inputSchema(collectSchema)
  .action(async ({ parsedInput, ctx }) => {
    const link = await createPaymentLink({
      amountInRupees: parsedInput.amount,
      description: `Donation to ${ctx.scope.organisationName}`,
      donorName: parsedInput.donorName,
      donorPhone: parsedInput.donorPhone,
      donorEmail: parsedInput.donorEmail || null,
    });

    const intent = await prisma.paymentIntent.create({
      data: {
        organisationId: ctx.scope.organisationId,
        razorpayOrderId: link.id,
        amount: parsedInput.amount,
        donorName: parsedInput.donorName,
        donorPhone: parsedInput.donorPhone,
        donorEmail: parsedInput.donorEmail || null,
        purpose: "GENERAL",
      },
    });

    // QR is a bonus channel — accounts without the QR product enabled still
    // get a working payment link rather than an error.
    let qrImageUrl: string | null = null;
    try {
      const qr = await createUpiQr({
        amountInRupees: parsedInput.amount,
        name: parsedInput.donorName,
        paymentIntentId: intent.id,
      });
      qrImageUrl = qr.imageUrl;
    } catch (err) {
      console.error("[collect] UPI QR unavailable", err);
    }

    return { paymentUrl: link.shortUrl, orderId: link.id, qrImageUrl };
  });
