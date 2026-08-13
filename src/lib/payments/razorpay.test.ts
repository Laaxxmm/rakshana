import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getOrgScopeMock = vi.fn();
vi.mock("@/lib/auth/scope", () => ({
  getOrgScope: getOrgScopeMock,
  requireOrgScope: async () => {
    const v = await getOrgScopeMock();
    if (!v) throw new Error("Authentication required");
    return v;
  },
}));
vi.mock("@/auth", () => ({ auth: async () => null }));
// The PDF + notify layers are exercised by their own tests; here we only
// care that the webhook converts a payment exactly once.
vi.mock("@/lib/pdf/receipt-80g", () => ({ generate80GReceipt: vi.fn(async () => undefined) }));
vi.mock("@/lib/notify", () => ({ dispatchDonationReceipt: vi.fn(async () => undefined) }));

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { verifyWebhookSignature } = await import("./razorpay");
const { processRazorpayEvent } = await import("./process-payment");

const SECRET = "test-webhook-secret";
const TEST_ORG = "test-org-razorpay";
const PLINK = "plink_test_rzp";
const PAYMENT_ID = "pay_test_rzp";

function sign(body: string, secret = SECRET) {
  return createHmac("sha256", secret).update(body).digest("hex");
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
  await prismaUnsafe.organisation.create({ data: { id: TEST_ORG, name: "Razorpay Org" } });
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ event: "payment.captured" });

  it("accepts a signature computed over the raw body", () => {
    expect(verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = sign(body);
    const tampered = JSON.stringify({ event: "payment.captured", extra: "evil" });
    expect(verifyWebhookSignature(tampered, signature)).toBe(false);
  });

  it("rejects a signature from a different secret, a missing one, and garbage", () => {
    expect(verifyWebhookSignature(body, sign(body, "other-secret"))).toBe(false);
    expect(verifyWebhookSignature(body, null)).toBe(false);
    expect(verifyWebhookSignature(body, "not-hex")).toBe(false);
  });
});

describe("processRazorpayEvent", () => {
  beforeEach(async () => {
    await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
    await prismaUnsafe.paymentIntent.deleteMany({ where: { organisationId: TEST_ORG } });
    await prismaUnsafe.paymentIntent.create({
      data: {
        organisationId: TEST_ORG,
        razorpayOrderId: PLINK,
        amount: "5000.00",
        donorName: "Test Donor",
        donorPhone: "9876500001",
      },
    });
  });

  const event = {
    event: "payment_link.paid",
    payload: {
      payment: { entity: { id: PAYMENT_ID } },
      payment_link: { entity: { id: PLINK } },
    },
  };

  it("creates exactly one Donation when the same payment id is delivered twice", async () => {
    const first = await processRazorpayEvent(event);
    const second = await processRazorpayEvent(event);

    expect(first.status).toBe("converted");
    expect(second.status).toBe("duplicate");

    const donations = await prismaUnsafe.donation.findMany({
      where: { organisationId: TEST_ORG },
    });
    expect(donations).toHaveLength(1);
    expect(donations[0]!.paymentRef).toBe(PAYMENT_ID);
    expect(donations[0]!.amount.toString()).toBe("5000");

    const intent = await prismaUnsafe.paymentIntent.findUnique({
      where: { razorpayOrderId: PLINK },
    });
    expect(intent?.status).toBe("PAID");
    expect(intent?.donationId).toBe(donations[0]!.id);
  });

  it("ignores an event that matches no payment intent", async () => {
    const result = await processRazorpayEvent({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_unknown", order_id: "order_unknown" } } },
    });
    expect(result.status).toBe("ignored");
    expect(await prismaUnsafe.donation.count({ where: { organisationId: TEST_ORG } })).toBe(0);
  });
});
