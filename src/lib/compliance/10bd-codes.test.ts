import { describe, expect, it } from "vitest";
import {
  donorTypeForCsv,
  donorIdForCsv,
  dominantDonationType,
  dominantModeCode,
  donationTypeCode,
  ID_CODES,
  MODE_CODES,
} from "./10bd-codes";

describe("donorTypeForCsv", () => {
  it("maps INDIVIDUAL → Individual", () => {
    expect(donorTypeForCsv("INDIVIDUAL")).toBe("Individual");
  });
  it("maps CORPORATE → Company", () => {
    expect(donorTypeForCsv("CORPORATE")).toBe("Company");
  });
  it("maps NRI / HUF / FOREIGN_SOURCE → Others", () => {
    expect(donorTypeForCsv("NRI")).toBe("Others");
    expect(donorTypeForCsv("HUF")).toBe("Others");
    expect(donorTypeForCsv("FOREIGN_SOURCE")).toBe("Others");
  });
});

describe("donorIdForCsv", () => {
  it("returns PAN when present", () => {
    const id = donorIdForCsv({ donorType: "INDIVIDUAL", pan: "ABCDE1234F" });
    expect(id).toEqual({ idCode: ID_CODES.PAN, idNumber: "ABCDE1234F" });
  });
  it("returns null when PAN missing (Aadhaar last-4 isn't usable)", () => {
    const id = donorIdForCsv({ donorType: "INDIVIDUAL", pan: null });
    expect(id).toBeNull();
  });
  it("returns null for foreign donor without PAN (Phase 5 limitation)", () => {
    const id = donorIdForCsv({ donorType: "FOREIGN_SOURCE", pan: null });
    expect(id).toBeNull();
  });
});

describe("dominantDonationType (dominance precedence)", () => {
  it("Corpus > Specific Grant > Others", () => {
    expect(
      dominantDonationType([
        { purpose: "CORPUS", isFcra: false },
        { purpose: "PROJECT_SPECIFIC", isFcra: false },
        { purpose: "GENERAL", isFcra: false },
      ]),
    ).toBe("CORPUS");
  });
  it("PROJECT_SPECIFIC + CSR + GENERAL → SPECIFIC_GRANT (CSR maps to specific)", () => {
    expect(
      dominantDonationType([
        { purpose: "PROJECT_SPECIFIC", isFcra: false },
        { purpose: "CSR", isFcra: false },
        { purpose: "GENERAL", isFcra: false },
      ]),
    ).toBe("SPECIFIC_GRANT");
  });
  it("Any FCRA donation flips the whole row to FOREIGN_SOURCE", () => {
    expect(
      dominantDonationType([
        { purpose: "CORPUS", isFcra: false },
        { purpose: "PROJECT_SPECIFIC", isFcra: true },
      ]),
    ).toBe("FOREIGN_SOURCE");
  });
  it("Only GENERAL/RELIEF → OTHERS", () => {
    expect(
      dominantDonationType([
        { purpose: "GENERAL", isFcra: false },
        { purpose: "RELIEF", isFcra: false },
      ]),
    ).toBe("OTHERS");
  });
});

describe("dominantModeCode (amount-weighted)", () => {
  it("All electronic (NEFT + UPI) → Electronic", () => {
    expect(
      dominantModeCode([
        { mode: "NEFT", amount: "50000" },
        { mode: "UPI", amount: "20000" },
      ]),
    ).toBe(MODE_CODES.ELECTRONIC);
  });
  it("Mix where cash dominates by amount", () => {
    expect(
      dominantModeCode([
        { mode: "CASH", amount: "100000" },
        { mode: "UPI", amount: "5000" },
      ]),
    ).toBe(MODE_CODES.CASH);
  });
  it("Cheque/DD → Others (4)", () => {
    expect(
      dominantModeCode([
        { mode: "CHEQUE", amount: "10000" },
        { mode: "DD", amount: "2000" },
      ]),
    ).toBe(MODE_CODES.OTHERS);
  });
});

describe("donationTypeCode mapping", () => {
  it("matches the IT portal numeric codes", () => {
    expect(donationTypeCode("CORPUS")).toBe("1");
    expect(donationTypeCode("SPECIFIC_GRANT")).toBe("2");
    expect(donationTypeCode("OTHERS")).toBe("3");
    expect(donationTypeCode("FOREIGN_SOURCE")).toBe("4");
  });
});
