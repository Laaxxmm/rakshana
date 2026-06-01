import { describe, expect, it } from "vitest";
import { computeTds, computeGst } from "./tax-calc";

describe("computeTds", () => {
  it("returns no TDS when section is null", () => {
    const r = computeTds({ grossAmount: 50000, section: null });
    expect(r.applicable).toBe(false);
    expect(r.amount.toString()).toBe("0");
    expect(r.netPayable.toString()).toBe("50000");
  });

  it("194C @ 1% on ₹50,000 → ₹500 TDS, ₹49,500 net (PRD acceptance test)", () => {
    const r = computeTds({ grossAmount: 50000, section: "194C" });
    expect(r.applicable).toBe(true);
    expect(r.amount.toString()).toBe("500");
    expect(r.netPayable.toString()).toBe("49500");
    expect(r.rate.toString()).toBe("1");
  });

  it("LDC override at 0.5% → ₹250 TDS, ₹49,750 net (PRD acceptance test)", () => {
    const r = computeTds({ grossAmount: 50000, section: "194C", ldcRate: 0.5 });
    expect(r.amount.toString()).toBe("250");
    expect(r.netPayable.toString()).toBe("49750");
    expect(r.rate.toString()).toBe("0.5");
  });

  it("194J @ 10% on ₹40,000 → ₹4,000 TDS", () => {
    const r = computeTds({ grossAmount: 40000, section: "194J" });
    expect(r.amount.toString()).toBe("4000");
    expect(r.netPayable.toString()).toBe("36000");
  });

  it("194I_L @ 10% on rent", () => {
    const r = computeTds({ grossAmount: 250000, section: "194I_L" });
    expect(r.amount.toString()).toBe("25000");
  });

  it("flags threshold-not-met as warning, still deducts", () => {
    const r = computeTds({ grossAmount: 5000, section: "194C", fyToDateForSection: 0 });
    // ₹5,000 < ₹30,000 threshold
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.amount.toString()).toBe("50"); // 1% of 5000
  });

  it("salary (Section 192) flags manual computation, returns 0", () => {
    const r = computeTds({ grossAmount: 50000, section: "192" });
    expect(r.applicable).toBe(true);
    expect(r.amount.toString()).toBe("0");
    expect(r.warnings.some((w) => w.toLowerCase().includes("slab"))).toBe(true);
  });
});

describe("computeGst", () => {
  it("intra-state split: 18% on ₹10,000 → CGST 900 + SGST 900", () => {
    const r = computeGst({ taxableValue: 10000, rate: 18, isInterState: false });
    expect(r.cgst.toString()).toBe("900");
    expect(r.sgst.toString()).toBe("900");
    expect(r.igst.toString()).toBe("0");
    expect(r.total.toString()).toBe("11800");
  });

  it("inter-state: 18% on ₹10,000 → IGST 1800", () => {
    const r = computeGst({ taxableValue: 10000, rate: 18, isInterState: true });
    expect(r.igst.toString()).toBe("1800");
    expect(r.cgst.toString()).toBe("0");
    expect(r.sgst.toString()).toBe("0");
  });

  it("5% on ₹1,847 → 92.35 total, CGST + SGST sums exactly", () => {
    const r = computeGst({ taxableValue: 1847, rate: 5, isInterState: false });
    // 5% of 1847 = 92.35
    expect(r.cgst.plus(r.sgst).toString()).toBe("92.35");
  });

  it("0% rate returns zero tax", () => {
    const r = computeGst({ taxableValue: 10000, rate: 0, isInterState: false });
    expect(r.total.toString()).toBe("10000");
    expect(r.cgst.toString()).toBe("0");
  });
});
