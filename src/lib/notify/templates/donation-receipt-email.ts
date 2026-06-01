import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";

export type ReceiptEmailInput = {
  orgName: string;
  orgEmail: string | null;
  donorName: string;
  amount: string;
  receiptNumber: string;
  donationDate: Date;
};

/**
 * Plain-HTML receipt email. We deliberately avoid React Email here — the
 * template is read-only by design and the Phase 2 surface ships faster
 * without an extra build step. When Phase 6 deploy lands we can swap to
 * `@react-email/components` without changing the caller signature.
 */
export function renderDonationReceiptEmail(
  v: ReceiptEmailInput,
): { subject: string; html: string; text: string } {
  const amount = formatINRWithSymbol(v.amount, { paise: true });
  const date = formatIST(v.donationDate, "dd MMM yyyy");

  const subject = `Your donation receipt — ${v.orgName}`;
  const text = [
    `Dear ${v.donorName},`,
    ``,
    `Thank you for your contribution of ${amount} to ${v.orgName} on ${date}.`,
    `Receipt: ${v.receiptNumber}`,
    ``,
    `Your 80G receipt is attached. Keep it for your tax records.`,
    ``,
    `Warm regards,`,
    v.orgName,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Inter Tight', sans-serif; background:#FAF8F3; padding:24px; margin:0; color:#1A1814;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background:#FFFFFF; border:1px solid #E8E3D9; border-radius:8px;">
    <tr><td style="padding:32px 28px 12px;">
      <p style="margin:0; font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#8A857E;">Receipt</p>
      <h1 style="margin:6px 0 0; font-family:'Fraunces', Georgia, serif; font-size:28px; color:#1A1814;">${escape(v.orgName)}</h1>
    </td></tr>
    <tr><td style="padding:8px 28px 0;">
      <p style="margin:0 0 16px; color:#5C5852;">Dear ${escape(v.donorName)},</p>
      <p style="margin:0 0 16px; color:#5C5852;">Thank you for your contribution. Your 80G receipt is attached to this email — please keep it for your tax records.</p>
    </td></tr>
    <tr><td style="padding:0 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F3; border:1px solid #E8E3D9; border-radius:6px; padding:14px 18px;">
        <tr>
          <td style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#8A857E;">Amount</td>
          <td style="text-align:right; font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#8A857E;">Receipt</td>
        </tr>
        <tr>
          <td style="padding-top:4px; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:22px; color:#1A1814;">${escape(amount)}</td>
          <td style="padding-top:4px; text-align:right; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:14px; color:#1A1814;">${escape(v.receiptNumber)}</td>
        </tr>
        <tr>
          <td style="padding-top:8px; font-size:12px; color:#5C5852;">on ${escape(date)}</td>
          <td style="padding-top:8px; text-align:right; font-size:12px; color:#5C5852;">PDF attached</td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:24px 28px 32px;">
      <p style="margin:0; color:#5C5852; font-size:13px;">Eligible for deduction under Section 80G(5)(iii) of the Income Tax Act, 1961.</p>
      <p style="margin:18px 0 0; font-size:12px; color:#8A857E;">${escape(v.orgEmail ?? v.orgName)}</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
