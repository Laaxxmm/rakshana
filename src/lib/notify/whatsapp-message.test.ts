import { Decimal } from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the donor actually receives on WhatsApp.
 *
 * An 80G receipt is the donor's tax evidence, and WhatsApp is reached here
 * through a `wa.me` URL, which carries `?text=` and nothing else. So the
 * assertions are about honesty, not formatting: the text claims no attachment,
 * and it hands out no receipt URL — every one this app can mint points at
 * `/api/files/[...key]`, which answers 401 to anyone without a session in the
 * owning organisation, and a donor is not a user of this app.
 *
 * The chain under test is the real one: dispatch builds the message, the real
 * `LinkWhatsAppAdapter` renders it into the `wa.me` URL, and the test reads
 * the text back out of that URL the way WhatsApp would.
 */

const h = vi.hoisted(() => ({
  /** `wa.me` URLs the link adapter produced, in order. */
  waUrls: [] as string[],
  /** Attachment filenames each email carried. */
  emailAttachments: [] as string[][],
}));

const DONATION = {
  id: "don-1",
  receiptNumber: "RKS/2025-26/0042",
  amount: new Decimal("5000"),
  donationDate: new Date("2025-05-03T00:00:00.000Z"),
  receiptUrl: null as string | null,
  donor: {
    name: "Anitha Rao",
    email: "anitha@example.org",
    whatsapp: "+91 98450 00000",
    whatsappOptIn: true,
  },
  organisation: { id: "org-1", name: "Rakshana Trust", email: "trust@example.org" },
};

/** Where a receipt PDF lands — session-gated, and useless to a donor. */
const RECEIPT_URL = "/api/files/org/org-1/donations/don-1/receipt.pdf";

vi.mock("@/lib/db/prisma", () => ({
  prismaUnsafe: {
    donation: { findUnique: async () => DONATION },
    notification: {
      create: async () => ({ id: "notif-1" }),
      update: async () => ({ id: "notif-1" }),
    },
  },
}));

vi.mock("@/lib/storage", () => ({ storage: { get: async () => null } }));

vi.mock("@/lib/pdf/receipt-80g", () => ({
  generate80GReceipt: async () => ({
    url: RECEIPT_URL,
    buffer: Buffer.from("%PDF-1.4 receipt"),
  }),
}));

// The real link adapter, so the URL under test is the one a volunteer opens.
vi.mock("./index", async () => {
  const { LinkWhatsAppAdapter } = await import("./channels/whatsapp-link");
  const link = new LinkWhatsAppAdapter();
  return {
    email: {
      name: "test",
      send: async (msg: { attachments?: { filename: string }[] }) => {
        h.emailAttachments.push((msg.attachments ?? []).map((a) => a.filename));
        return { ok: true as const, id: "email-1" };
      },
    },
    whatsapp: {
      name: "test",
      send: async (msg: Parameters<typeof link.send>[0]) => {
        const res = await link.send(msg);
        if (res.ok) h.waUrls.push(res.id);
        return res;
      },
    },
  };
});

const { dispatchDonationReceipt } = await import("./dispatch");
const { renderDonationReceiptWhatsApp } = await import(
  "./templates/donation-receipt-whatsapp"
);
const { LinkWhatsAppAdapter } = await import("./channels/whatsapp-link");

/** The message as WhatsApp shows it, read back out of the `wa.me` URL. */
function textOf(url: string): string {
  return new URL(url).searchParams.get("text") ?? "";
}

beforeEach(() => {
  h.waUrls.length = 0;
  h.emailAttachments.length = 0;
});

describe("the WhatsApp receipt message", () => {
  it("promises the donor no attachment and no link it cannot honour", async () => {
    const result = await dispatchDonationReceipt("don-1");
    // The click-to-chat adapter builds a URL somebody still has to open, so
    // the message is reported as prepared. Counting it as sent would tell a
    // volunteer the donor holds a receipt that is sitting in a log.
    expect(result.sent).not.toContain("WhatsApp to +91 98450 00000");
    expect(result.prepared.join(" ")).toContain("WhatsApp to +91 98450 00000");

    const text = textOf(h.waUrls[0]!);

    // The claim that started this: nothing is attached to a wa.me message.
    expect(text).not.toMatch(/attach/i);
    // And nothing links at a file only a signed-in member of this trust can
    // fetch — the donor would get a 401, or nothing at all from a relative path.
    expect(text).not.toContain("/api/files");
    expect(text).not.toContain(RECEIPT_URL);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain("📎");
  });

  it("gives the donor the receipt number and a way to get the PDF", async () => {
    await dispatchDonationReceipt("don-1");
    const text = textOf(h.waUrls[0]!);

    expect(text).toContain("Anitha Rao");
    expect(text).toContain("Rakshana Trust");
    expect(text).toContain("RKS/2025-26/0042");
    expect(text).toContain("₹5,000.00");
    expect(text).toContain("03 May 2025");
    // Without this sentence the message is a dead end: the donor is told a
    // receipt exists and never told how to obtain it.
    expect(text).toContain("Reply to this message and we will send you the PDF");
  });

  it("addresses the number on the donor profile", async () => {
    await dispatchDonationReceipt("don-1");
    expect(h.waUrls[0]).toMatch(/^https:\/\/wa\.me\/919845000000\?text=/);
  });

  it("still attaches the PDF on email, where an attachment is real", async () => {
    await dispatchDonationReceipt("don-1");
    expect(h.emailAttachments).toEqual([["RKS-2025-26-0042.pdf"]]);
  });
});

describe("renderDonationReceiptWhatsApp", () => {
  const message = renderDonationReceiptWhatsApp({
    orgName: "Rakshana Trust",
    donorName: "Anitha Rao",
    amount: "5000.00",
    receiptNumber: "RKS/2025-26/0042",
    donationDate: new Date("2025-05-03T00:00:00.000Z"),
  });

  it("states what it is — a confirmation carrying a receipt number", () => {
    expect(message).not.toMatch(/attach/i);
    expect(message).not.toMatch(/https?:\/\/|\/api\//);
    expect(message).toContain("Your 80G receipt no. RKS/2025-26/0042 has been issued.");
    expect(message).toContain("Reply to this message and we will send you the PDF");
  });

  it("formats rupees through the Decimal formatter, paise and all", () => {
    expect(message).toContain("₹5,000.00");
    expect(
      renderDonationReceiptWhatsApp({
        orgName: "Rakshana Trust",
        donorName: "Anitha Rao",
        amount: "1234567.5",
        receiptNumber: "RKS/2025-26/0043",
        donationDate: new Date("2025-05-03T00:00:00.000Z"),
      }),
    ).toContain("₹12,34,567.50");
  });

  it("reaches WhatsApp verbatim — the adapter appends nothing to it", async () => {
    const res = await new LinkWhatsAppAdapter().send({
      to: "+91 98450 00000",
      templateName: "donation_receipt",
      params: { body: message, receipt_number: "RKS/2025-26/0042" },
    });

    expect(res.ok).toBe(true);
    expect(res.ok && textOf(res.id)).toBe(message);
  });
});
