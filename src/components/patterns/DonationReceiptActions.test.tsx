// @vitest-environment happy-dom
// The drawer previews the receipt in an iframe; without this happy-dom tries
// to fetch it over the network and logs the failure.
// @vitest-environment-options { "settings": { "disableIframePageLoading": true } }
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The receipt hand-off, at every point a volunteer reaches it: the moment a
 * donation is recorded, the collection screen when the payment clears, and the
 * drawer on an old donation.
 *
 * The load-bearing assertion is that none of them link at the stored
 * `Donation.receiptUrl`. Every one goes through `prepareReceiptDownload`,
 * which rebuilds the PDF when storage has lost it — covered server-side by
 * "regenerates when the stored file is gone" in
 * src/app/(app)/donors/[id]/receipt-actions.test.ts. A plain link 404s on
 * exactly the receipts written before the storage volume existed.
 */

const h = vi.hoisted(() => ({
  /** Every server action the rendered tree fired, in order. */
  executed: [] as Array<{ action: string; input: unknown }>,
  /** `useAction(...).result.data` per action name. */
  hookData: {} as Record<string, unknown>,
  /** What `onSuccess` is handed when that action is executed. */
  successData: {} as Record<string, unknown>,
  stub: (name: string) => Object.assign(() => {}, { $name: name }),
}));

vi.mock("next-safe-action/hooks", () => ({
  useAction: (
    action: { $name: string },
    opts?: { onSuccess?: (args: { data: unknown }) => void },
  ) => ({
    execute: (input: unknown) => {
      h.executed.push({ action: action.$name, input });
      const data = h.successData[action.$name];
      if (data !== undefined) opts?.onSuccess?.({ data });
    },
    isExecuting: false,
    result: { data: h.hookData[action.$name] },
  }),
}));

vi.mock("@/app/(app)/donations/actions", () => ({
  recordDonation: h.stub("recordDonation"),
  cancelDonation: h.stub("cancelDonation"),
  regenerateReceipt: h.stub("regenerateReceipt"),
  prepareReceiptDownload: h.stub("prepareReceiptDownload"),
  resendReceipt: h.stub("resendReceipt"),
  prepareWhatsAppLink: h.stub("prepareWhatsAppLink"),
  markWhatsAppSent: h.stub("markWhatsAppSent"),
}));
vi.mock("@/app/(app)/donations/collect/actions", () => ({
  createCollectionLink: h.stub("createCollectionLink"),
  getCollectionStatus: h.stub("getCollectionStatus"),
}));
vi.mock("@/app/(app)/donations/new/donor-search", () => ({
  searchDonors: h.stub("searchDonors"),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { DonationReceiptActions } = await import("./DonationReceiptActions");
const { RecordDonationForm } = await import(
  "@/app/(app)/donations/new/RecordDonationForm"
);
const { CollectionPanel } = await import(
  "@/app/(app)/donations/collect/CollectionPanel"
);
const { DonationDrawer } = await import("@/app/(app)/donations/DonationDrawer");

/** Where a receipt PDF is served from, and what a stale link points at. */
const RECEIPT_URL = "/api/files/org/org-1/donations/don-1/receipt.pdf";

// ---- A root, a click, a query. Enough of a harness for four components. ----
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}

/** Buttons are matched on their text, which is what the volunteer reads. */
function buttons(pattern: RegExp): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")].filter((b) =>
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

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function text(): string {
  return document.body.textContent ?? "";
}

/** Anchors pointing straight at a stored receipt — the thing that 404s. */
function fileLinks(): Element[] {
  return [...document.body.querySelectorAll("a")].filter((a) =>
    (a.getAttribute("href") ?? "").includes("/api/files/"),
  );
}

function actionNames() {
  return h.executed.map((e) => e.action);
}

beforeEach(() => {
  h.executed.length = 0;
  for (const key of Object.keys(h.hookData)) delete h.hookData[key];
  for (const key of Object.keys(h.successData)) delete h.successData[key];
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("DonationReceiptActions", () => {
  it("offers download, email and WhatsApp in one row, each naming where it goes", () => {
    mount(
      <DonationReceiptActions
        donationId="don-1"
        donorEmail="anitha@example.org"
        donorWhatsApp="+919845000000"
      />,
    );

    // Three buttons, straight away — no "Send" that has to be opened first.
    expect(buttons(/./)).toHaveLength(3);
    expect(button(/^Download$/)).toBeTruthy();
    expect(button(/Email anitha@example\.org/)).toBeTruthy();
    expect(button(/WhatsApp \+919845000000/)).toBeTruthy();
  });

  it("downloads through the action rather than a link at the stored file", () => {
    mount(<DonationReceiptActions donationId="don-1" />);

    // The "no stale link" assertions below are only worth anything if the
    // query finds one when it is there.
    const planted = document.createElement("a");
    planted.setAttribute("href", RECEIPT_URL);
    document.body.appendChild(planted);
    expect(fileLinks()).toHaveLength(1);
    planted.remove();

    expect(fileLinks()).toHaveLength(0);
    click(button(/Download/));

    expect(h.executed).toEqual([
      { action: "prepareReceiptDownload", input: { donationId: "don-1" } },
    ]);
  });

  it("sends the email only on the second click, with the address on the button", () => {
    mount(<DonationReceiptActions donationId="don-1" donorEmail="anitha@example.org" />);

    click(button(/Email anitha@example\.org/));
    expect(actionNames()).not.toContain("resendReceipt");

    // The armed button still names the address, so the destination is visible
    // at the click that commits.
    click(button(/Confirm · anitha@example\.org/));
    expect(h.executed).toEqual([
      { action: "resendReceipt", input: { donationId: "don-1" } },
    ]);
  });

  it("kills the button and says why when the donor has no address on file", () => {
    mount(
      <DonationReceiptActions donationId="don-1" donorEmail={null} donorWhatsApp={null} />,
    );

    expect(button(/Email/).disabled).toBe(true);
    expect(button(/WhatsApp/).disabled).toBe(true);
    expect(text()).toContain("an email address and a WhatsApp number");
  });
});

describe("recording a donation", () => {
  function mountForm() {
    mount(
      <RecordDonationForm
        fy="2025-26"
        bankAccounts={[
          {
            id: "bank-1",
            bankName: "SBI",
            accountNumber: "000123456789",
            purpose: "GENERAL",
            isPrimary: true,
          },
        ]}
        projects={[]}
        sponsorshipItems={[
          {
            id: "item-1",
            category: "CHILDREN_EDUCATION",
            label: "One child, one year",
            amount: "5000.00",
            unitNoun: "child",
            allowsQuantity: true,
          },
        ]}
        anonymous={null}
        initialDonor={{
          id: "donor-1",
          name: "Anitha Rao",
          donorType: "INDIVIDUAL",
          pan: "ABCPR1234K",
          is80GEligible: true,
          isFcraEligible: false,
          lastDonationDate: null,
          lifetime: "0",
        }}
      />,
    );
  }

  function submitForm() {
    // Picking the catalogue row fills the amount, so the form is valid.
    click(button(/One child, one year/));
    act(() => {
      document.body
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  it("hands over the receipt where the volunteer is standing", () => {
    h.successData["recordDonation"] = {
      ok: true,
      donationId: "don-1",
      receiptNumber: "RKS/2025-26/0042",
    };
    mountForm();

    submitForm();

    // The receipt exists now, so the ways to hand it over are on screen.
    expect(actionNames()).toContain("recordDonation");
    expect(text()).toContain("RKS/2025-26/0042");
    expect(text()).toContain("Anitha Rao");
    click(button(/Download/));
    expect(actionNames()).toContain("prepareReceiptDownload");
    expect(buttons(/Email/)).toHaveLength(1);
    expect(buttons(/WhatsApp/)).toHaveLength(1);
    expect(fileLinks()).toHaveLength(0);
  });

  it("shows nothing to hand over until a donation is actually recorded", () => {
    mountForm();

    expect(buttons(/Download/)).toHaveLength(0);
  });
});

describe("collecting online", () => {
  it("routes the ready receipt through the action, not its stored URL", () => {
    h.hookData["getCollectionStatus"] = {
      state: "RECEIPT_READY",
      donationId: "don-1",
      receiptNumber: "RKS/2025-26/0042",
      receiptUrl: RECEIPT_URL,
      donorName: "Anitha Rao",
      donorEmail: "anitha@example.org",
      donorWhatsApp: "+919845000000",
    };
    mount(
      <CollectionPanel
        collection={{
          paymentIntentId: "pi-1",
          amount: "5000.00",
          paymentUrl: "https://rzp.io/i/abc",
          qrImageUrl: null,
          donorName: "Anitha Rao",
          donorPhone: "+919845000000",
        }}
        onReset={() => {}}
      />,
    );

    expect(fileLinks()).toHaveLength(0);
    click(button(/Download/));
    expect(actionNames()).toContain("prepareReceiptDownload");
    expect(button(/Email anitha@example\.org/)).toBeTruthy();
  });
});

describe("the donation drawer", () => {
  it("routes an old receipt through the action, not its stored URL", () => {
    mount(
      <DonationDrawer
        fy="2025-26"
        donation={{
          id: "don-1",
          receiptNumber: "RKS/2025-26/0042",
          receiptUrl: RECEIPT_URL,
          donationDate: "2025-05-03T00:00:00.000Z",
          amount: "5000.00",
          mode: "CASH",
          paymentRef: null,
          is80GEligible: true,
          status: "RECEIVED",
          cancellationReason: null,
          donor: {
            id: "donor-1",
            name: "Anitha Rao",
            pan: "ABCPR1234K",
            isAnonymousBucket: false,
            email: "anitha@example.org",
            whatsapp: "+919845000000",
          },
        }}
      />,
    );

    expect(fileLinks()).toHaveLength(0);
    click(button(/Download/));
    expect(actionNames()).toContain("prepareReceiptDownload");
    expect(button(/Email anitha@example\.org/)).toBeTruthy();
  });
});
