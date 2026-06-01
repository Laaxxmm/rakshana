import { describe, expect, it } from "vitest";
import { donorSchema } from "./donor";

const base = {
  donorType: "INDIVIDUAL" as const,
  name: "Test Donor",
  country: "India",
};

describe("donorSchema", () => {
  it("accepts a minimal individual donor", () => {
    const v = donorSchema.parse(base);
    expect(v.name).toBe("Test Donor");
    expect(v.is80GEligible).toBe(true);
  });

  it("forces 80G off for anonymous donors", () => {
    const v = donorSchema.parse({ ...base, donorType: "ANONYMOUS", is80GEligible: true });
    expect(v.is80GEligible).toBe(false);
  });

  it("requires CSR CIN when isCsrDonor is true", () => {
    expect(() =>
      donorSchema.parse({ ...base, donorType: "CORPORATE", isCsrDonor: true }),
    ).toThrow();
  });

  it("forces FCRA flag for foreign-source / NRI donors", () => {
    expect(() =>
      donorSchema.parse({ ...base, donorType: "FOREIGN_SOURCE", isFcraEligible: false }),
    ).toThrow();
    expect(() =>
      donorSchema.parse({ ...base, donorType: "NRI", isFcraEligible: false }),
    ).toThrow();
    // Setting the flag clears the error
    expect(
      donorSchema.parse({ ...base, donorType: "FOREIGN_SOURCE", isFcraEligible: true }).isFcraEligible,
    ).toBe(true);
  });

  it("requires pincode when an address is present", () => {
    expect(() =>
      donorSchema.parse({ ...base, addressLine1: "1 Test Road" }),
    ).toThrow();
    expect(
      donorSchema.parse({ ...base, addressLine1: "1 Test Road", pincode: "560001" }).pincode,
    ).toBe("560001");
  });

  it("auto-derives state code from state name", () => {
    const v = donorSchema.parse({ ...base, state: "Tamil Nadu" });
    expect(v.stateCode).toBe("33");
  });
});
