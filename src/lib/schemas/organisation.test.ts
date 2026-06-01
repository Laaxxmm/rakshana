import { describe, expect, it } from "vitest";
import {
  panSchema,
  tanSchema,
  cinSchema,
  gstinSchema,
  ifscSchema,
  pincodeSchema,
  indianPhoneSchema,
  bankAccountSchema,
  identitySchema,
} from "./organisation";

describe("PAN", () => {
  it("accepts canonical PAN", () => {
    expect(panSchema.parse("ABCDE1234F")).toBe("ABCDE1234F");
  });
  it("uppercases lowercase input", () => {
    expect(panSchema.parse("abcde1234f")).toBe("ABCDE1234F");
  });
  it("rejects short / malformed", () => {
    expect(() => panSchema.parse("ABCDE")).toThrow();
    expect(() => panSchema.parse("12345ABCDE")).toThrow();
  });
});

describe("TAN", () => {
  it("accepts canonical TAN", () => {
    expect(tanSchema.parse("BLRR12345C")).toBe("BLRR12345C");
  });
  it("rejects 9-char input", () => {
    expect(() => tanSchema.parse("BLRR1234C")).toThrow();
  });
});

describe("CIN", () => {
  it("accepts a Sec-8 company CIN", () => {
    expect(cinSchema.parse("U85100KA2024NPL123456")).toBe("U85100KA2024NPL123456");
  });
  it("rejects garbage", () => {
    expect(() => cinSchema.parse("not-a-cin")).toThrow();
  });
});

describe("GSTIN", () => {
  it("accepts a canonical GSTIN", () => {
    expect(gstinSchema.parse("29ABCDE1234F1Z5")).toBe("29ABCDE1234F1Z5");
  });
  it("rejects bad checkdigit-slot characters", () => {
    expect(() => gstinSchema.parse("29ABCDE1234F1Y5")).toThrow();
  });
});

describe("IFSC", () => {
  it("accepts canonical IFSC", () => {
    expect(ifscSchema.parse("HDFC0000301")).toBe("HDFC0000301");
  });
  it("rejects non-zero 5th char", () => {
    expect(() => ifscSchema.parse("HDFC1000301")).toThrow();
  });
});

describe("Pincode", () => {
  it("accepts 6-digit", () => {
    expect(pincodeSchema.parse("560001")).toBe("560001");
  });
  it("rejects 5-digit", () => {
    expect(() => pincodeSchema.parse("56000")).toThrow();
  });
});

describe("Indian phone normaliser", () => {
  it("adds +91 to a 10-digit input", () => {
    expect(indianPhoneSchema.parse("9876543210")).toBe("+919876543210");
  });
  it("normalises +91 prefix with spaces", () => {
    expect(indianPhoneSchema.parse("+91 98765 43210")).toBe("+919876543210");
  });
  it("rejects 9-digit", () => {
    expect(() => indianPhoneSchema.parse("987654321")).toThrow();
  });
});

describe("Bank account", () => {
  it("validates a complete account", () => {
    const v = bankAccountSchema.parse({
      bankName: "HDFC",
      branch: "Lavelle",
      accountNumber: "00301234567890",
      accountHolder: "Rakshana Trust",
      ifsc: "HDFC0000301",
      accountType: "CURRENT",
      purpose: "GENERAL",
      openingBalance: "0",
      isPrimary: "true",
    });
    expect(v.ifsc).toBe("HDFC0000301");
    expect(v.openingBalance).toBe(0);
    expect(v.isPrimary).toBe(true);
  });
  it("rejects short account number", () => {
    expect(() =>
      bankAccountSchema.parse({
        bankName: "HDFC",
        accountNumber: "1234",
        ifsc: "HDFC0000301",
        accountType: "SAVINGS",
        purpose: "GENERAL",
      } as never),
    ).toThrow();
  });
});

describe("Identity schema", () => {
  it("auto-derives stateCode from state name", () => {
    const v = identitySchema.parse({
      name: "Rakshana Trust",
      registrationType: "TRUST",
      state: "Karnataka",
      country: "India",
      fyStartMonth: 4,
      fyStartDay: 1,
      pincode: "",
    } as never);
    expect(v.stateCode).toBe("29");
  });
  it("requires CIN when registrationType = SECTION_8_COMPANY", () => {
    expect(() =>
      identitySchema.parse({
        name: "X",
        registrationType: "SECTION_8_COMPANY",
        country: "India",
        fyStartMonth: 4,
        fyStartDay: 1,
        pincode: "",
      } as never),
    ).toThrow();
  });
});
