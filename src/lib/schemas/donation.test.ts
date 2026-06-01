import { describe, expect, it } from "vitest";
import { recordDonationSchema } from "./donation";

const base = {
  donorId: "donor-1",
  donationDate: new Date(),
  amount: "1000",
  mode: "NEFT" as const,
  paymentRef: "UTR123",
  bankAccountId: "bank-1",
  purpose: "GENERAL" as const,
};

describe("recordDonationSchema", () => {
  it("accepts a complete NEFT donation", () => {
    const v = recordDonationSchema.parse(base);
    expect(v.amount.toString()).toBe("1000");
  });

  it("requires payment reference for NEFT", () => {
    expect(() =>
      recordDonationSchema.parse({ ...base, paymentRef: null }),
    ).toThrow();
  });

  it("requires bank account for NEFT", () => {
    expect(() =>
      recordDonationSchema.parse({ ...base, bankAccountId: null }),
    ).toThrow();
  });

  it("does not require bank account / ref for cash", () => {
    const v = recordDonationSchema.parse({
      ...base,
      mode: "CASH",
      paymentRef: null,
      bankAccountId: null,
    });
    expect(v.mode).toBe("CASH");
  });

  it("requires goods description + valuation for in-kind", () => {
    expect(() =>
      recordDonationSchema.parse({
        ...base,
        mode: "IN_KIND",
        bankAccountId: null,
        paymentRef: null,
      }),
    ).toThrow();
    const v = recordDonationSchema.parse({
      ...base,
      mode: "IN_KIND",
      bankAccountId: null,
      paymentRef: null,
      inKindDescription: "1 desktop computer",
      inKindValuationMethod: "FAIR_MARKET_VALUE",
    });
    expect(v.inKindValuationMethod).toBe("FAIR_MARKET_VALUE");
  });

  it("requires project when purpose is PROJECT_SPECIFIC", () => {
    expect(() =>
      recordDonationSchema.parse({ ...base, purpose: "PROJECT_SPECIFIC" }),
    ).toThrow();
  });

  it("requires CSR CIN when purpose = CSR", () => {
    expect(() =>
      recordDonationSchema.parse({ ...base, purpose: "CSR", projectId: "p1" }),
    ).toThrow();
    const v = recordDonationSchema.parse({
      ...base,
      purpose: "CSR",
      projectId: "p1",
      csrCompanyCin: "U85100KA2024NPL123456",
    });
    expect(v.csrCompanyCin).toBe("U85100KA2024NPL123456");
  });

  it("rejects zero or negative amounts", () => {
    expect(() => recordDonationSchema.parse({ ...base, amount: "0" })).toThrow();
    expect(() => recordDonationSchema.parse({ ...base, amount: "-100" })).toThrow();
  });

  it("rejects amounts with more than 2 decimal places", () => {
    expect(() => recordDonationSchema.parse({ ...base, amount: "100.123" })).toThrow();
  });
});
