import { describe, expect, it } from "vitest";
import {
  formatIST,
  formatISTInput,
  parseISTInput,
  getFinancialYear,
  getFinancialYearRange,
} from "./date";

describe("formatIST — UTC → IST formatting", () => {
  it("renders 1 April 2025 00:00 IST correctly", () => {
    // 31 March 2025 18:30 UTC === 1 April 2025 00:00 IST
    expect(formatIST("2025-03-31T18:30:00.000Z")).toBe("01 Apr 2025");
    expect(formatISTInput("2025-03-31T18:30:00.000Z")).toBe("01/04/2025");
  });

  it("uses the supplied pattern", () => {
    expect(formatIST("2026-05-20T00:00:00.000Z", "yyyy-MM-dd")).toBe("2026-05-20");
  });
});

describe("parseISTInput — DD/MM/YYYY → UTC", () => {
  it("round-trips through formatISTInput", () => {
    const d = parseISTInput("15/08/2025");
    expect(formatISTInput(d)).toBe("15/08/2025");
  });

  it("rejects bad formats", () => {
    expect(() => parseISTInput("2025-08-15")).toThrow();
    expect(() => parseISTInput("15-08-2025")).toThrow();
    expect(() => parseISTInput("")).toThrow();
  });
});

describe("getFinancialYear — Indian FY boundary at 1 April IST", () => {
  it("April → 1st-half FY", () => {
    expect(getFinancialYear("2025-04-01T00:00:00+05:30")).toBe("2025-26");
    expect(getFinancialYear("2025-12-31T23:59:59+05:30")).toBe("2025-26");
  });

  it("January–March → previous-year FY", () => {
    expect(getFinancialYear("2026-01-15T12:00:00+05:30")).toBe("2025-26");
    expect(getFinancialYear("2026-03-31T23:59:59+05:30")).toBe("2025-26");
  });

  it("flips on 1 April", () => {
    expect(getFinancialYear("2026-04-01T00:00:00+05:30")).toBe("2026-27");
  });
});

describe("getFinancialYearRange", () => {
  it("returns start = 1 April 00:00 IST, end = 1 April next year", () => {
    const { start, end } = getFinancialYearRange("2025-26");
    expect(formatIST(start, "yyyy-MM-dd HH:mm")).toBe("2025-04-01 00:00");
    expect(formatIST(end, "yyyy-MM-dd HH:mm")).toBe("2026-04-01 00:00");
  });

  it("rejects malformed FY strings", () => {
    expect(() => getFinancialYearRange("2025")).toThrow();
    expect(() => getFinancialYearRange("2025-2026")).toThrow();
  });
});
