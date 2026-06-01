import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { formatINR, formatINRWithSymbol, inrInWords } from "./inr";

describe("formatINR — Indian grouping ##,##,##,###", () => {
  it("groups small numbers without commas", () => {
    expect(formatINR(0)).toBe("0");
    expect(formatINR(1)).toBe("1");
    expect(formatINR(100)).toBe("100");
    expect(formatINR(999)).toBe("999");
  });

  it("groups thousands", () => {
    expect(formatINR(1_000)).toBe("1,000");
    expect(formatINR(12_345)).toBe("12,345");
    expect(formatINR(99_999)).toBe("99,999");
  });

  it("groups lakhs", () => {
    expect(formatINR(100_000)).toBe("1,00,000");
    expect(formatINR(123_456)).toBe("1,23,456");
    expect(formatINR(9_99_999)).toBe("9,99,999");
  });

  it("groups crores", () => {
    expect(formatINR(1_00_00_000)).toBe("1,00,00,000");
    expect(formatINR(12_34_56_789)).toBe("12,34,56,789");
    expect(formatINR(1_84_32_500)).toBe("1,84,32,500");
  });

  it("handles negatives", () => {
    expect(formatINR(-1234)).toBe("-1,234");
    expect(formatINR(-100000)).toBe("-1,00,000");
    expect(formatINR(-1_84_32_500)).toBe("-1,84,32,500");
  });

  it("renders paise when opts.paise = true", () => {
    expect(formatINR(100, { paise: true })).toBe("100.00");
    expect(formatINR(1234.5, { paise: true })).toBe("1,234.50");
    expect(formatINR(123_456.78, { paise: true })).toBe("1,23,456.78");
    expect(formatINR(-1234.5, { paise: true })).toBe("-1,234.50");
  });

  it("emits + when opts.sign = true on positive non-zero", () => {
    expect(formatINR(123, { sign: true })).toBe("+123");
    expect(formatINR(0, { sign: true })).toBe("0");
    expect(formatINR(-123, { sign: true })).toBe("-123");
  });

  it("accepts string and Decimal inputs", () => {
    expect(formatINR("123456")).toBe("1,23,456");
    expect(formatINR(new Decimal("9999999999"), { paise: true })).toBe(
      "9,99,99,99,999.00",
    );
  });

  it("rupee symbol helper places ₹ before the number", () => {
    expect(formatINRWithSymbol(1_23_45_678)).toBe("₹1,23,45,678");
    expect(formatINRWithSymbol(-1234, { paise: true })).toBe("-₹1,234.00");
    expect(formatINRWithSymbol(0)).toBe("₹0");
  });
});

describe("inrInWords — Indian lakhs/crores", () => {
  it("handles zero and small amounts", () => {
    expect(inrInWords(0)).toBe("Rupees Zero only");
    expect(inrInWords(1)).toBe("Rupees One only");
    expect(inrInWords(45)).toBe("Rupees Forty Five only");
  });

  it("handles hundreds and thousands", () => {
    expect(inrInWords(100)).toBe("Rupees One Hundred only");
    expect(inrInWords(999)).toBe("Rupees Nine Hundred Ninety Nine only");
    expect(inrInWords(1234)).toBe("Rupees One Thousand Two Hundred Thirty Four only");
  });

  it("handles lakhs", () => {
    expect(inrInWords(123456)).toBe(
      "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six only",
    );
    expect(inrInWords(100000)).toBe("Rupees One Lakh only");
  });

  it("handles crores", () => {
    expect(inrInWords(12345678)).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight only",
    );
    expect(inrInWords(10000000)).toBe("Rupees One Crore only");
  });

  it("can omit 'Rupees' prefix", () => {
    expect(inrInWords(45, { withRupees: false })).toBe("Forty Five");
  });

  it("handles negatives", () => {
    expect(inrInWords(-1234)).toBe(
      "Minus Rupees One Thousand Two Hundred Thirty Four only",
    );
  });
});
