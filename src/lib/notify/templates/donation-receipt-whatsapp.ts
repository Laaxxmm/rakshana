import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";

export type ReceiptWhatsAppInput = {
  orgName: string;
  donorName: string;
  /** Rupees as a decimal string — `Donation.amount.toString()`. */
  amount: string;
  receiptNumber: string;
  donationDate: Date;
};

/**
 * The WhatsApp receipt message, shared by the click-to-chat action and the
 * dispatch layer so a donor gets the same words either way.
 *
 * It claims no attachment and carries no link, because neither is possible on
 * this channel:
 *
 *  - WhatsApp is reached through a `wa.me` URL, which carries `?text=` and
 *    nothing else. There is no file in a click-to-chat message unless the
 *    volunteer attaches one by hand after the tab opens, which is not
 *    something the text may assert in advance.
 *  - The PDF is served by `/api/files/[...key]`, which calls `requireOrgScope`
 *    and answers 401 without a session, then 404 when the session's
 *    organisation is not the one in the key. A donor is not a user of this
 *    app, so that URL is a dead end for them. Nothing else serves receipts:
 *    both storage adapters are deliberately private (`src/lib/storage/
 *    r2-adapter.ts` — "no public bucket URLs, no presigned links").
 *
 * So the message confirms the donation, names the receipt number the donor
 * needs when the PDF is chased, and names the way to get the document: reply,
 * and the volunteer sends it. An 80G receipt is tax evidence — a donor told it
 * is attached when it is not will not chase it.
 */
export function renderDonationReceiptWhatsApp(v: ReceiptWhatsAppInput): string {
  const amount = formatINRWithSymbol(v.amount, { paise: true });
  const date = formatIST(v.donationDate, "dd MMM yyyy");

  return [
    `Namaste ${v.donorName},`,
    ``,
    `Thank you for your donation of ${amount} to ${v.orgName} on ${date}.`,
    ``,
    `Your 80G receipt no. ${v.receiptNumber} has been issued. Reply to this message and we will send you the PDF for your tax records.`,
    ``,
    `— ${v.orgName}`,
  ].join("\n");
}
