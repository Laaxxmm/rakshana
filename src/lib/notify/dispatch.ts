import "server-only";
import type { NotificationChannel } from "@prisma/client";
import { email, whatsapp } from "./index";
import { renderDonationReceiptEmail } from "./templates/donation-receipt-email";
import { renderDonationReceiptWhatsApp } from "./templates/donation-receipt-whatsapp";
import { prismaUnsafe } from "@/lib/db/prisma";
import { storage } from "@/lib/storage";
import { generate80GReceipt } from "@/lib/pdf/receipt-80g";

type SendResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * What a dispatch actually did, in words fit to put in front of an operator.
 *
 * `sent` empty means nothing left the building. Callers must check it: no
 * exception is thrown for a donor who simply has no address or number on
 * file, so "it didn't throw" is not evidence that anything was delivered.
 */
export type ReceiptDispatchResult = {
  /** Destinations a channel accepted, e.g. `Email to ram@example.org`. */
  sent: string[];
  /**
   * Messages built but not delivered — the click-to-chat adapter returns a
   * wa.me URL a human still has to open. Never fold these into `sent`: the
   * donor has received nothing yet.
   */
  prepared: string[];
  /** Channels that were tried and refused, reason included. */
  failed: string[];
  /** Channels with no destination on the donor profile, reason included. */
  skipped: string[];
};

/**
 * Dispatch the receipt for a single donation over every channel the donor has
 * a destination for. Reads everything fresh from the DB so callers can
 * fire-and-forget once the Donation row commits.
 *
 * `donationId` is trusted here — this reads and writes through the unscoped
 * client, so a caller holding an id that came off a request must resolve it
 * through the scoped `prisma` client first.
 *
 * A Notification row is created up-front per channel so the operator sees the
 * queue even before the adapter fires; `sentAt` flips on success,
 * `errorMessage` on failure. One dead channel never halts the other, and every
 * outcome comes back in the result instead of as an exception.
 */
export async function dispatchDonationReceipt(
  donationId: string,
): Promise<ReceiptDispatchResult> {
  const result: ReceiptDispatchResult = { sent: [], prepared: [], failed: [], skipped: [] };

  const donation = await prismaUnsafe.donation.findUnique({
    where: { id: donationId },
    include: { donor: true, organisation: true },
  });
  if (!donation) {
    result.failed.push(`Donation ${donationId} no longer exists.`);
    return result;
  }
  const { organisation: org, donor } = donation;

  // A mail that says "your 80G receipt is attached" with nothing attached is
  // worse than no mail at all, so the PDF is materialised before either
  // channel runs.
  const receipt = await ensureReceiptPdf(donation.id);

  const audit = {
    organisationId: org.id,
    title: `Donation receipt ${donation.receiptNumber}`,
    body: `Receipt for ${donor.name} (${donation.receiptNumber})`,
  };

  const donorEmail = donor.email;
  if (!donorEmail) {
    result.skipped.push("Email — no address on the donor profile");
  } else {
    const error = await deliver({ ...audit, channel: "EMAIL" }, () => {
      const tpl = renderDonationReceiptEmail({
        orgName: org.name,
        orgEmail: org.email,
        donorName: donor.name,
        amount: donation.amount.toString(),
        receiptNumber: donation.receiptNumber,
        donationDate: donation.donationDate,
      });
      return email.send({
        to: donorEmail,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        attachments: [
          {
            filename: `${donation.receiptNumber.replace(/\//g, "-")}.pdf`,
            content: receipt.buffer,
            contentType: "application/pdf",
          },
        ],
      });
    });
    if (error) result.failed.push(`Email to ${donorEmail} — ${error}`);
    else result.sent.push(`Email to ${donorEmail}`);
  }

  const donorWhatsApp = donor.whatsapp;
  if (!donorWhatsApp) {
    result.skipped.push("WhatsApp — no number on the donor profile");
  } else if (!donor.whatsappOptIn) {
    result.skipped.push(`WhatsApp — ${donor.name} has not opted in`);
  } else {
    // No file and no link ride along: WhatsApp is reached over `wa.me`, which
    // carries text only, and `/api/files` refuses anyone without a session in
    // the owning organisation. `body` says so in words the donor can act on.
    const error = await deliver({ ...audit, channel: "WHATSAPP" }, () =>
      whatsapp.send({
        to: donorWhatsApp,
        templateName: "donation_receipt",
        params: {
          body: renderDonationReceiptWhatsApp({
            orgName: org.name,
            donorName: donor.name,
            amount: donation.amount.toString(),
            receiptNumber: donation.receiptNumber,
            donationDate: donation.donationDate,
          }),
          donor_name: donor.name,
          amount: donation.amount.toString(),
          receipt_number: donation.receiptNumber,
        },
      }),
    );
    if (error) result.failed.push(`WhatsApp to ${donorWhatsApp} — ${error}`);
    else if (whatsapp.delivers) result.sent.push(`WhatsApp to ${donorWhatsApp}`);
    else result.prepared.push(`WhatsApp to ${donorWhatsApp} — open the link to send it`);
  }

  return result;
}

/**
 * The stored 80G receipt PDF for a donation, generated on the spot when
 * storage holds no object for it. That covers a donation whose PDF was never
 * generated, and one whose bytes are gone — receipts written to a container
 * filesystem did not survive the deploy that replaced it.
 *
 * Reads and writes through the unscoped client, so callers must resolve
 * `donationId` through the scoped `prisma` client first.
 */
export async function ensureReceiptPdf(
  donationId: string,
): Promise<{ url: string; buffer: Buffer }> {
  const donation = await prismaUnsafe.donation.findUnique({
    where: { id: donationId },
    select: { receiptUrl: true },
  });
  if (!donation) throw new Error(`Donation ${donationId} not found`);

  if (donation.receiptUrl) {
    const buffer = await loadReceiptPdf(donation.receiptUrl);
    if (buffer) return { url: donation.receiptUrl, buffer };
  }

  const generated = await generate80GReceipt(donationId);
  return { url: generated.url, buffer: generated.buffer };
}

/**
 * Queue the Notification row, run the adapter, stamp the outcome. Returns the
 * failure message, or null when the adapter accepted the message. Never
 * throws — one dead channel must not take the other down with it.
 */
async function deliver(
  row: { organisationId: string; channel: NotificationChannel; title: string; body: string },
  send: () => Promise<SendResult>,
): Promise<string | null> {
  const notif = await prismaUnsafe.notification.create({ data: row });
  let errorMessage: string | null = null;
  try {
    const res = await send();
    if (!res.ok) errorMessage = res.error;
  } catch (err) {
    errorMessage = (err as Error).message;
  }
  await prismaUnsafe.notification.update({
    where: { id: notif.id },
    data: errorMessage ? { errorMessage } : { sentAt: new Date() },
  });
  return errorMessage;
}

/** Pull the stored receipt PDF back into memory for the email attachment. */
async function loadReceiptPdf(receiptUrl: string): Promise<Buffer | null> {
  const obj = await storage.get(receiptUrl.replace(/^\/api\/files\//, ""));
  if (!obj) return null;

  const reader = obj.stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}
