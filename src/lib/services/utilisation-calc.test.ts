import { describe, expect, it } from "vitest";
import { computeUtilisationShare, type DonorBreakdown } from "./utilisation-calc";

describe("computeUtilisationShare", () => {
  it("PRD acceptance: three donors (corpus, project-specific, CSR) → correct shares", () => {
    // Total funding: 30k corpus (A) + 70k project-specific (B) + 50k CSR (C) = 150k
    // Total expenses: 100k. Earmarked total = 120k (B + C). Pooled = 30k (A).
    //
    // Earmarked total (120k) > expenses (100k) → earmarked donors share pro-rata.
    // earmarkedRatio = 100k / 120k = 0.8333...
    // B's share = 70k × 0.8333 = 58,333.33
    // C's share = 50k × 0.8333 = 41,666.67
    // A's share = 0 (no pooled remaining)
    //
    // Conservation check: 58,333.33 + 41,666.67 + 0 = 100,000 ✓
    const funders: DonorBreakdown[] = [
      { donorId: "A", donations: [{ purpose: "CORPUS", amount: 30000 }] },
      { donorId: "B", donations: [{ purpose: "PROJECT_SPECIFIC", amount: 70000 }] },
      { donorId: "C", donations: [{ purpose: "CSR", amount: 50000 }] },
    ];

    const b = computeUtilisationShare({ funders, totalExpenses: 100000, donorId: "B" });
    expect(b.donorContribution.toString()).toBe("70000");
    expect(b.donorShareOfExpenses.toString()).toBe("58333.33");
    expect(b.unutilisedBalance.toString()).toBe("11666.67");

    const c = computeUtilisationShare({ funders, totalExpenses: 100000, donorId: "C" });
    expect(c.donorShareOfExpenses.toString()).toBe("41666.67");

    const a = computeUtilisationShare({ funders, totalExpenses: 100000, donorId: "A" });
    expect(a.donorShareOfExpenses.toString()).toBe("0");
    expect(a.unutilisedBalance.toString()).toBe("30000");

    // Conservation: total of donor shares ≤ total expenses
    const total = b.donorShareOfExpenses.plus(c.donorShareOfExpenses).plus(a.donorShareOfExpenses);
    expect(total.toString()).toBe("100000");
  });

  it("PRD-style: earmarked donations get 100% when expenses ≥ earmarked total", () => {
    // 70k project-specific + 30k corpus = 100k funding; 120k expenses
    // Earmarked total = 70k ≤ 120k → earmarkedRatio = 1.0 → B gets full 70k
    // Pooled remaining = 120k - 70k = 50k; A gets all of it (capped at A's 30k)
    const funders: DonorBreakdown[] = [
      { donorId: "A", donations: [{ purpose: "CORPUS", amount: 30000 }] },
      { donorId: "B", donations: [{ purpose: "PROJECT_SPECIFIC", amount: 70000 }] },
    ];
    const b = computeUtilisationShare({ funders, totalExpenses: 120000, donorId: "B" });
    expect(b.donorShareOfExpenses.toString()).toBe("70000");
    expect(b.utilisationPercent.toString()).toBe("100");
    const a = computeUtilisationShare({ funders, totalExpenses: 120000, donorId: "A" });
    expect(a.donorShareOfExpenses.toString()).toBe("30000");
  });

  it("pooled-only project: proportionate sharing", () => {
    // Two corpus donors equally — each gets 50% of expenses
    const funders: DonorBreakdown[] = [
      { donorId: "A", donations: [{ purpose: "CORPUS", amount: 50000 }] },
      { donorId: "B", donations: [{ purpose: "CORPUS", amount: 50000 }] },
    ];
    const a = computeUtilisationShare({ funders, totalExpenses: 40000, donorId: "A" });
    expect(a.donorShareOfExpenses.toString()).toBe("20000");
    expect(a.utilisationPercent.toString()).toBe("40");
  });

  it("project has zero expenses → 0% utilisation", () => {
    const funders: DonorBreakdown[] = [
      { donorId: "A", donations: [{ purpose: "PROJECT_SPECIFIC", amount: 100000 }] },
    ];
    const r = computeUtilisationShare({ funders, totalExpenses: 0, donorId: "A" });
    expect(r.donorShareOfExpenses.toString()).toBe("0");
    expect(r.unutilisedBalance.toString()).toBe("100000");
    expect(r.utilisationPercent.toString()).toBe("0");
  });

  it("project has no funding yet → returns zeros", () => {
    const r = computeUtilisationShare({ funders: [], totalExpenses: 100000, donorId: "A" });
    expect(r.donorContribution.toString()).toBe("0");
    expect(r.donorShareOfExpenses.toString()).toBe("0");
  });

  it("donor with mixed corpus + project-specific donations", () => {
    // A: 10k corpus + 50k project-specific = 60k. B: 40k corpus.
    // Total funding 100k; totalEarmarked = 50k; totalPooled = 50k (A 10k + B 40k)
    // Expenses 80k. earmarkedConsumed = 50k (covers all earmarked). pooledRem = 30k.
    // A's earmarked share = 50k × 1.0 = 50k
    // A's pooled share = (10000 / 50000) × 30000 = 6000
    // A total share = 56k → unutilised = 60k - 56k = 4k
    const funders: DonorBreakdown[] = [
      {
        donorId: "A",
        donations: [
          { purpose: "CORPUS", amount: 10000 },
          { purpose: "PROJECT_SPECIFIC", amount: 50000 },
        ],
      },
      { donorId: "B", donations: [{ purpose: "CORPUS", amount: 40000 }] },
    ];
    const a = computeUtilisationShare({ funders, totalExpenses: 80000, donorId: "A" });
    expect(a.donorShareOfExpenses.toString()).toBe("56000");
    expect(a.unutilisedBalance.toString()).toBe("4000");
  });

  it("expenses exceed earmarked but pool covers the rest", () => {
    // A: 100k project-specific. B: 50k corpus. Expenses: 120k.
    // Earmarked 100k ≤ 120k → earmarkedRatio = 1.0; A share = 100k → 100% utilisation
    const funders: DonorBreakdown[] = [
      { donorId: "A", donations: [{ purpose: "PROJECT_SPECIFIC", amount: 100000 }] },
      { donorId: "B", donations: [{ purpose: "CORPUS", amount: 50000 }] },
    ];
    const a = computeUtilisationShare({ funders, totalExpenses: 120000, donorId: "A" });
    expect(a.donorShareOfExpenses.toString()).toBe("100000");
    expect(a.utilisationPercent.toString()).toBe("100");
  });

  it("donor not in funders returns zero contribution + zero share", () => {
    const funders: DonorBreakdown[] = [
      { donorId: "A", donations: [{ purpose: "PROJECT_SPECIFIC", amount: 100000 }] },
    ];
    const x = computeUtilisationShare({ funders, totalExpenses: 50000, donorId: "X" });
    expect(x.donorContribution.toString()).toBe("0");
    expect(x.donorShareOfExpenses.toString()).toBe("0");
  });
});
