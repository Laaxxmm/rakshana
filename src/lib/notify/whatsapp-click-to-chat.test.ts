import { Decimal } from "decimal.js";
import { describe, expect, it, vi } from "vitest";

/**
 * What the donor actually receives when a volunteer presses the WhatsApp
 * button — the click-to-chat half of the same question
 * `whatsapp-message.test.ts` asks of the dispatch half.
 *
 * The button calls `prepareWhatsAppLink`, which returns a `wa.me` URL. That
 * URL carries `?text=` and nothing else: no file rides along, and no receipt
 * URL this app can mint is reachable by a donor, because `/api/files/[...key]`
 * calls `requireOrgScope` and answers 401 without a session in the owning
 * organisation. So the assertions are about honesty. An 80G receipt is what a
 * donor files with their return; one told it is attached when nothing is will
 * not chase the document they need.
 *
 * The action is driven for real and the text is read back out of the returned
 * URL the way WhatsApp would, rather than compared against a second copy of
 * the template.
 */

const SCOPE = {
  userId: "user-1",
  organisationId: "org-1",
  organisationName: "Rakshana Trust",
  role: "OWNER" as const,
};

vi.mock("@/lib/auth/scope", () => ({
  getOrgScope: async () => SCOPE,
  requireOrgScope: async () => SCOPE,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

/**
 * An amount that formats to something other than its own `toString()`, so a
 * message built straight off the Decimal is distinguishable from one put
 * through the rupee formatter.
 */
const DONATION = {
  id: "don-1",
  receiptNumber: "RKS/2025-26/0042",
  amount: new Decimal("1234567.5"),
  donationDate: new Date("2025-05-03T00:00:00.000Z"),
  donor: { id: "donor-1", name: "Anitha Rao", whatsapp: "+91 98450 00000" },
  organisation: { id: "org-1", name: "Rakshana Trust" },
};

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    donation: {
      findUniqueOrThrow: async () => DONATION,
    },
  },
  prismaUnsafe: {},
}));

const { prepareWhatsAppLink } = await import("@/app/(app)/donations/actions");
const { renderDonationReceiptWhatsApp } = await import(
  "./templates/donation-receipt-whatsapp"
);

/** The message as WhatsApp shows it, read back out of the `wa.me` URL. */
async function messageText(): Promise<string> {
  const res = await prepareWhatsAppLink({ donationId: "don-1" });
  expect(res?.serverError).toBeUndefined();
  const url = res?.data?.url;
  expect(url).toBeTruthy();
  return new URL(url!).searchParams.get("text") ?? "";
}

describe("prepareWhatsAppLink — the prefilled click-to-chat message", () => {
  it("claims no attachment, because a wa.me message carries none", async () => {
    const text = await messageText();

    // The claim that started this: the link is a plain `?text=` URL, so a line
    // saying the receipt is attached describes something that cannot be there.
    expect(text).not.toMatch(/attach/i);
  });

  it("hands out no link the donor cannot open", async () => {
    const text = await messageText();

    // Every receipt URL this app mints is `/api/files/…`, which is 401 to a
    // donor. A relative path is not even a link once it is text in WhatsApp.
    expect(text).not.toContain("/api/files");
    expect(text).not.toMatch(/https?:\/\//);
  });

  it("names the receipt number and how to obtain the PDF", async () => {
    const text = await messageText();

    expect(text).toContain("Anitha Rao");
    expect(text).toContain("Rakshana Trust");
    expect(text).toContain("RKS/2025-26/0042");
    expect(text).toContain("03 May 2025");
    // Without this the donor is told a receipt exists and never told how to
    // get it — the dead end the "is attached" line used to hide.
    expect(text).toContain("Reply to this message and we will send you the PDF");
  });

  it("formats rupees through the Decimal formatter rather than the raw amount", async () => {
    const text = await messageText();

    expect(text).toContain("₹12,34,567.50");
    expect(text).not.toContain("1234567.5");
  });

  it("sends the same words as the dispatch layer", async () => {
    const text = await messageText();

    expect(text).toBe(
      renderDonationReceiptWhatsApp({
        orgName: "Rakshana Trust",
        donorName: "Anitha Rao",
        amount: "1234567.5",
        receiptNumber: "RKS/2025-26/0042",
        donationDate: new Date("2025-05-03T00:00:00.000Z"),
      }),
    );
  });

  it("addresses the number on the donor profile", async () => {
    const res = await prepareWhatsAppLink({ donationId: "don-1" });

    expect(res?.data?.url).toMatch(/^https:\/\/wa\.me\/919845000000\?text=/);
    expect(res?.data?.donorName).toBe("Anitha Rao");
  });
});
