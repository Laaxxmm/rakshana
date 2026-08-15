// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The donation rows on a donor profile, from the volunteer's side.
 *
 * The row used to carry [Download] [Send], where Send opened a strip holding
 * Email / WhatsApp / Cancel — WhatsApp for one donation cost two clicks and a
 * panel. It now renders the shared
 * `src/components/patterns/DonationReceiptActions`, the same control the
 * record screen, the collection screen and the donation drawer use, so all
 * three destinations are on the row itself.
 */

const h = vi.hoisted(() => ({
  /** Every server action the rendered tree fired, in order. */
  executed: [] as Array<{ action: string; input: unknown }>,
  stub: (name: string) => Object.assign(() => {}, { $name: name }),
}));

vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: { $name: string }) => ({
    execute: (input: unknown) => h.executed.push({ action: action.$name, input }),
    isExecuting: false,
    result: {},
  }),
}));
vi.mock("@/app/(app)/donations/actions", () => ({
  prepareReceiptDownload: h.stub("prepareReceiptDownload"),
  resendReceipt: h.stub("resendReceipt"),
  prepareWhatsAppLink: h.stub("prepareWhatsAppLink"),
  markWhatsAppSent: h.stub("markWhatsAppSent"),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/auth/scope", () => ({
  requireOrgScope: async () => ({
    userId: "u",
    organisationId: "o",
    organisationName: "Test Trust",
    role: "OWNER",
  }),
}));
vi.mock("@/lib/audit/history", () => ({ loadEditHistory: async () => [] }));

const findUnique = vi.fn();
const donationFindMany = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    donor: { findUnique },
    donation: { findMany: donationFindMany },
    communication: { findMany: async () => [] },
  },
}));

const DonorProfilePage = (await import("./page")).default;

const DONOR = {
  id: "donor-1",
  name: "Anitha Rao",
  donorType: "INDIVIDUAL",
  status: "ACTIVE",
  isAnonymousBucket: false,
  is80GEligible: true,
  isFcraEligible: false,
  isCsrDonor: false,
  totalDonatedLifetime: new Decimal("5000.00"),
  phone: "+919845000000",
  whatsapp: "+919845000000",
  email: "anitha@example.org",
  pan: "ABCPR1234K",
  aadhaarLast4: null,
  addressLine1: "1 Donor Lane",
  addressLine2: null,
  city: "Bengaluru",
  district: null,
  state: "Karnataka",
  pincode: "560002",
  country: "India",
  csrCompanyCin: null,
  tags: [],
  internalNotes: null,
};

const DONATION = {
  id: "don-1",
  receiptNumber: "RKS/2025-26/0042",
  donationDate: new Date("2025-05-03T00:00:00.000Z"),
  amount: new Decimal("5000.00"),
  mode: "CASH",
  status: "RECEIVED",
};

// ---- A root, a click, a query. ----
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/**
 * Renders the profile and opens the Donations tab, which is where the rows
 * live. Everything asserted below is scoped to that table, so the page's own
 * buttons — the tab strip, the edit history — are never counted.
 */
async function openDonations(donations: unknown[] = [DONATION], donor = DONOR) {
  findUnique.mockResolvedValue(donor);
  donationFindMany.mockResolvedValue(donations);
  const ui = await DonorProfilePage({ params: Promise.resolve({ id: "donor-1" }) });
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));

  const tab = [...document.querySelectorAll("[data-slot='tabs-trigger']")].find((t) =>
    /Donations/.test(t.textContent ?? ""),
  );
  click(tab!);
}

/** Buttons of the donations table, matched on the text a volunteer reads. */
function buttons(pattern: RegExp): HTMLButtonElement[] {
  const table = document.querySelector("table");
  if (!table) throw new Error("The donations table did not render");
  return [...table.querySelectorAll("button")].filter((b) =>
    pattern.test(b.textContent ?? ""),
  );
}

function button(pattern: RegExp): HTMLButtonElement {
  const found = buttons(pattern);
  if (found.length !== 1) {
    throw new Error(`Expected 1 button matching ${pattern}, found ${found.length}`);
  }
  return found[0]!;
}

beforeEach(() => {
  h.executed.length = 0;
  findUnique.mockReset();
  donationFindMany.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("donor profile donation rows", () => {
  it("puts download, email and WhatsApp on the row, each naming where it goes", async () => {
    await openDonations();

    // Three controls, nothing else — no "Send" that has to be opened first,
    // and so no Cancel to close again.
    expect(buttons(/./)).toHaveLength(3);
    expect(button(/^Download$/)).toBeTruthy();
    expect(button(/Email anitha@example\.org/)).toBeTruthy();
    expect(button(/WhatsApp \+919845000000/)).toBeTruthy();
  });

  it("reaches the download and the WhatsApp hand-off in one click each", async () => {
    await openDonations();

    click(button(/^Download$/));
    expect(h.executed).toEqual([
      { action: "prepareReceiptDownload", input: { donationId: "don-1" } },
    ]);

    click(button(/WhatsApp/));
    expect(h.executed).toContainEqual({
      action: "prepareWhatsAppLink",
      input: { donationId: "don-1" },
    });
  });

  it("keeps the address on the button that commits the email", async () => {
    await openDonations();

    // One click reaches the send — the second commits it, because an email
    // cannot be recalled. Both name the address, so the destination is on
    // screen at the click that sends.
    click(button(/Email anitha@example\.org/));
    expect(h.executed).toEqual([]);

    click(button(/Confirm · anitha@example\.org/));
    expect(h.executed).toEqual([
      { action: "resendReceipt", input: { donationId: "don-1" } },
    ]);
  });

  it("gives every donation its own set of controls", async () => {
    await openDonations([DONATION, { ...DONATION, id: "don-2", receiptNumber: "RKS/2025-26/0043" }]);

    expect(buttons(/^Download$/)).toHaveLength(2);
    click(buttons(/^Download$/)[1]!);
    expect(h.executed).toEqual([
      { action: "prepareReceiptDownload", input: { donationId: "don-2" } },
    ]);
  });

  it("shows a role that cannot send nothing but the download", async () => {
    findUnique.mockResolvedValue(DONOR);
    donationFindMany.mockResolvedValue([DONATION]);
    // The anonymous bucket is nobody's inbox: canSend is false for it whatever
    // the role, which is the same branch a VIEWER takes.
    await openDonations([DONATION], { ...DONOR, isAnonymousBucket: true });

    expect(buttons(/./)).toHaveLength(1);
    expect(button(/^Download$/)).toBeTruthy();
  });
});
