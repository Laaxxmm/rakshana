import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: async () => null }));
// The PDF + notify layers have their own tests; here we only care which
// events are allowed to mint a Donation and which close the intent.
vi.mock("@/lib/pdf/receipt-80g", () => ({ generate80GReceipt: vi.fn(async () => undefined) }));
vi.mock("@/lib/notify", () => ({ dispatchDonationReceipt: vi.fn(async () => undefined) }));

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { POST } = await import("./route");

const SECRET = "test-webhook-secret";
const TEST_ORG = "test-org-razorpay-route";
const PLINK = "plink_test_route";

function post(body: unknown) {
  const raw = JSON.stringify(body);
  return POST(
    new Request("http://localhost/api/webhooks/razorpay", {
      method: "POST",
      body: raw,
      headers: {
        "x-razorpay-signature": createHmac("sha256", SECRET).update(raw).digest("hex"),
      },
    }),
  );
}

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.receiptSeries.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.paymentIntent.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  process.env["RAZORPAY_WEBHOOK_SECRET"] = SECRET;
  await cleanup();
  await prismaUnsafe.organisation.create({ data: { id: TEST_ORG, name: "Razorpay Route Org" } });
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

describe("razorpay webhook route", () => {
  beforeEach(async () => {
    await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
    await prismaUnsafe.paymentIntent.deleteMany({ where: { organisationId: TEST_ORG } });
    await prismaUnsafe.paymentIntent.create({
      data: {
        organisationId: TEST_ORG,
        razorpayOrderId: PLINK,
        amount: "5000.00",
        donorName: "Route Donor",
        donorPhone: "9876500002",
      },
    });
  });

  it("rejects an unsigned body", async () => {
    const res = await POST(
      new Request("http://localhost/api/webhooks/razorpay", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(400);
  });

  it("closes the intent on payment.failed without booking a donation", async () => {
    const res = await post({
      event: "payment.failed",
      payload: {
        payment: { entity: { id: "pay_failed", order_id: PLINK } },
        payment_link: { entity: { id: PLINK } },
      },
    });

    expect(await res.json()).toEqual({ status: "failed" });
    const intent = await prismaUnsafe.paymentIntent.findUnique({
      where: { razorpayOrderId: PLINK },
    });
    expect(intent?.status).toBe("FAILED");
    expect(await prismaUnsafe.donation.count({ where: { organisationId: TEST_ORG } })).toBe(0);
  });

  it("still converts a paid link", async () => {
    const res = await post({
      event: "payment_link.paid",
      payload: {
        payment: { entity: { id: "pay_route_ok" } },
        payment_link: { entity: { id: PLINK } },
      },
    });

    expect((await res.json()).status).toBe("converted");
    expect(await prismaUnsafe.donation.count({ where: { organisationId: TEST_ORG } })).toBe(1);
  });

  it("books the amount the gateway captured, not the amount requested", async () => {
    // A variable-amount QR lets the donor decide. Receipting the requested
    // figure would put a number on an 80G certificate that the donor never
    // actually paid.
    const res = await post({
      event: "payment_link.paid",
      payload: {
        // 250.00 captured against an intent raised for a different figure.
        payment: { entity: { id: "pay_route_short", amount: 25_000 } },
        payment_link: { entity: { id: PLINK } },
      },
    });
    expect((await res.json()).status).toBe("converted");

    const donation = await prismaUnsafe.donation.findFirst({
      where: { organisationId: TEST_ORG, paymentRef: "pay_route_short" },
    });
    expect(donation).not.toBeNull();
    expect(donation!.amount.toString()).toBe("250");
    // The discrepancy has to be visible on the record, not only in a log.
    expect(donation!.remarks ?? "").toMatch(/captured/i);
  });

  it("never converts an event outside the success set", async () => {
    const res = await post({
      event: "payment.authorized",
      payload: { payment: { entity: { id: "pay_auth", order_id: PLINK } } },
    });

    expect((await res.json()).status).toBe("ignored");
    expect(await prismaUnsafe.donation.count({ where: { organisationId: TEST_ORG } })).toBe(0);
  });
});
