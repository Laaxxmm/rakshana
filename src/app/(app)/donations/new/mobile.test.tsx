// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The money-entry screens as a phone renders them: what a thumb can hit and
 * what keyboard each field asks for.
 *
 * Only what the DOM actually declares is asserted here — attributes, structure
 * and which control sits inside which row. Nothing in this file measures a
 * pixel; vitest has no layout engine, and a test that "checked" a 375px
 * viewport would be checking a class string it wrote itself.
 */

const h = vi.hoisted(() => ({
  executed: [] as Array<{ action: string; input: unknown }>,
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
    result: { data: undefined },
  }),
}));

vi.mock("@/app/(app)/donations/actions", () => ({
  recordDonation: h.stub("recordDonation"),
  prepareReceiptDownload: h.stub("prepareReceiptDownload"),
  resendReceipt: h.stub("resendReceipt"),
  prepareWhatsAppLink: h.stub("prepareWhatsAppLink"),
  markWhatsAppSent: h.stub("markWhatsAppSent"),
}));
vi.mock("@/app/(app)/donations/new/donor-search", () => ({
  searchDonors: h.stub("searchDonors"),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { RecordDonationForm } = await import("./RecordDonationForm");
const { DonorQuickCreate } = await import("./DonorQuickCreate");
const { FileUpload } = await import("@/components/patterns/file-upload");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}

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

/** Controls are matched on the label a screen reader would read out. */
function labelled(label: string): HTMLElement | null {
  return document.body.querySelector(`[aria-label="${label}"]`);
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const ITEM = {
  id: "item-1",
  category: "CHILDREN_EDUCATION",
  label: "School bag & shoes per child",
  amount: "1500.00",
  unitNoun: "child",
  allowsQuantity: true,
};

function mountDonationForm(
  sponsorshipItems: (typeof ITEM)[] = [ITEM],
) {
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
      sponsorshipItems={sponsorshipItems}
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

beforeEach(() => {
  h.executed.length = 0;
  for (const key of Object.keys(h.successData)) delete h.successData[key];
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("the sponsorship picker on a phone", () => {
  it("keeps the quantity and the line total inside the row that was tapped", () => {
    mountDonationForm();

    click(button(new RegExp(ITEM.label)));
    click(button(new RegExp(ITEM.label)));

    // Two children at ₹1,500 is ₹3,000, and the volunteer reads all of it —
    // name, count, line total — without leaving the row their thumb is on.
    const stepper = labelled(`Quantity for ${ITEM.label}`);
    expect(stepper).toBeTruthy();
    const row = stepper!.closest("li");
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain(ITEM.label);
    // The row carrying the stepper is the catalogue row that was tapped, not a
    // second list of picked items below the brochure.
    expect(row!.querySelector("button")!.textContent).toContain(ITEM.label);
    expect(row!.textContent).toContain("2 × ₹1,500");
    expect(row!.textContent).toContain("₹3,000");
    expect((stepper as HTMLInputElement).value).toBe("2");
  });

  it("puts removal under the same thumb, as the minus at one", () => {
    mountDonationForm();
    click(button(new RegExp(ITEM.label)));

    // At one there is nothing to decrease to, so the control removes instead
    // of sitting there disabled next to a separate X.
    expect(labelled(`Decrease ${ITEM.label}`)).toBeNull();
    const remove = labelled(`Remove ${ITEM.label}`);
    expect(remove).toBeTruthy();

    click(remove!);
    expect(labelled(`Quantity for ${ITEM.label}`)).toBeNull();
    const amount = document.getElementById("amount") as HTMLInputElement;
    expect(amount.value).toBe("");
  });

  it("counts the picked items in the bar that does not scroll away", () => {
    mountDonationForm();
    click(button(new RegExp(ITEM.label)));
    click(button(new RegExp(ITEM.label)));

    const bar = document.querySelector("form > div.sticky");
    expect(bar).toBeTruthy();
    expect(bar!.textContent).toContain("₹3,000.00");
    expect(bar!.textContent).toContain("2 items");
    expect(bar!.querySelector("button[type=submit]")).toBeTruthy();
  });
});

describe("keyboards the money-entry fields ask for", () => {
  it("gives every field its own keypad", () => {
    mountDonationForm();
    click(button(new RegExp(ITEM.label)));

    const amount = document.getElementById("amount") as HTMLInputElement;
    expect(amount.getAttribute("inputmode")).toBe("decimal");
    expect(labelled(`Quantity for ${ITEM.label}`)!.getAttribute("inputmode")).toBe("numeric");

    act(() => root!.render(<DonorQuickCreate onCancel={() => {}} onCreated={() => {}} />));
    const phone = document.getElementById("quick-donor-phone") as HTMLInputElement;
    expect(phone.getAttribute("type")).toBe("tel");
    expect(phone.getAttribute("inputmode")).toBe("tel");
  });
});

describe("attaching a bill from a phone", () => {
  const BILL_ACCEPT = ["application/pdf", "image/jpeg", "image/png"] as const;

  it("offers the camera and the file browser, and no drag-and-drop instruction", () => {
    mount(<FileUpload multiple onSelect={() => {}} accept={BILL_ACCEPT} />);

    expect(button(/Take photo/)).toBeTruthy();
    expect(button(/Choose files/)).toBeTruthy();

    // `capture` is what opens the lens instead of the file browser, and the
    // camera can only return a photo — offering it application/pdf sends some
    // Androids to the file browser anyway.
    const camera = document.querySelector<HTMLInputElement>("input[capture]");
    expect(camera).toBeTruthy();
    expect(camera!.getAttribute("capture")).toBe("environment");
    expect(camera!.getAttribute("accept")).toBe("image/jpeg,image/png");
    expect(camera!.multiple).toBe(true);
  });

  it("validates a camera photo the same way as a chosen file", async () => {
    const picked: File[] = [];
    mount(<FileUpload onSelect={(f) => void picked.push(f)} accept={BILL_ACCEPT} />);

    const camera = document.querySelector<HTMLInputElement>("input[capture]")!;
    const photo = new File(["jpeg-bytes"], "bill.jpg", { type: "image/jpeg" });
    Object.defineProperty(camera, "files", { value: [photo], configurable: true });
    await act(async () => {
      camera.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(picked.map((f) => f.name)).toEqual(["bill.jpg"]);
  });

  it("leaves the camera out where a photo is not an allowed file", () => {
    mount(<FileUpload onSelect={() => {}} accept={["application/pdf"]} />);

    expect(buttons(/Take photo/)).toHaveLength(0);
    expect(document.querySelector("input[capture]")).toBeNull();
    expect(button(/Choose file/)).toBeTruthy();
  });
});
