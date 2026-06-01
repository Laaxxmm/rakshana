/**
 * Centralised tax constants. **Valid for FY 2025-26 and FY 2026-27** —
 * review on every Finance Act / Budget announcement. Phase 5 will surface
 * an OWNER-editable UI for these per-FY; for now they live as code.
 */

export const FY_START_MONTH = 4;
export const FY_START_DAY = 1;

// ---------------------------------------------------------------------------
// TDS sections (Phase 3 + 5)
// ---------------------------------------------------------------------------

/**
 * Section code → metadata. The `defaultRate` is what most NGOs encounter;
 * `threshold` is the per-FY cumulative payment below which TDS is not
 * mandatory (we surface this as a warning, not a hard skip — auditors want
 * visibility).
 *
 * "194C_OTH" / "194I_L" are split-codes for the two-rate sections.
 */
export const TDS_SECTIONS = {
  "192":     { name: "Salary",                            defaultRate: null, threshold: 0,      description: "Computed per slab" },
  "194A":    { name: "Interest (other than securities)",  defaultRate: 10,   threshold: 40000 },
  "194C":    { name: "Contractor — individual/HUF",       defaultRate: 1,    threshold: 30000 },
  "194C_OTH":{ name: "Contractor — others",               defaultRate: 2,    threshold: 30000 },
  "194H":    { name: "Commission / Brokerage",            defaultRate: 5,    threshold: 15000 },
  "194I":    { name: "Rent — plant / machinery",          defaultRate: 2,    threshold: 240000 },
  "194I_L":  { name: "Rent — land / building / furniture",defaultRate: 10,   threshold: 240000 },
  "194J":    { name: "Professional / Technical",          defaultRate: 10,   threshold: 30000 },
} as const;

export type TdsSection = keyof typeof TDS_SECTIONS;
export const TDS_SECTION_KEYS = Object.keys(TDS_SECTIONS) as TdsSection[];

export function tdsSection(section: string): typeof TDS_SECTIONS[TdsSection] | null {
  return (TDS_SECTIONS as Record<string, typeof TDS_SECTIONS[TdsSection]>)[section] ?? null;
}

// ---------------------------------------------------------------------------
// GST slabs (Phase 3 + 5)
// ---------------------------------------------------------------------------

/** GST percentage rates. 0.1 / 3 are special low-rate categories. */
export const GST_RATES = [0, 0.1, 3, 5, 12, 18, 28] as const;
export type GstRate = (typeof GST_RATES)[number];

// ---------------------------------------------------------------------------
// TDS quarter mapping
// ---------------------------------------------------------------------------

/** Map a calendar month (1-12) to its TDS quarter, treating April as Q1. */
export function tdsQuarterForMonth(month: number): "Q1" | "Q2" | "Q3" | "Q4" {
  if (month >= 4 && month <= 6) return "Q1";
  if (month >= 7 && month <= 9) return "Q2";
  if (month >= 10 && month <= 12) return "Q3";
  return "Q4";
}

export const TDS_QUARTER_DUE = {
  Q1: { period: "Apr–Jun", returnDueDay: 31, returnDueMonth: 7 },
  Q2: { period: "Jul–Sep", returnDueDay: 31, returnDueMonth: 10 },
  Q3: { period: "Oct–Dec", returnDueDay: 31, returnDueMonth: 1 },
  Q4: { period: "Jan–Mar", returnDueDay: 31, returnDueMonth: 5 },
} as const;

// ---------------------------------------------------------------------------
// Anonymous-donation thresholds (Section 115BBC)
// ---------------------------------------------------------------------------

export const ANON_DONATION_FIXED_FLOOR = 100_000;
export const ANON_DONATION_PERCENT_FLOOR = 5;

// ---------------------------------------------------------------------------
// 80G + application-of-income thresholds
// ---------------------------------------------------------------------------

export const APPLICATION_RULE_THRESHOLD = 85;
export const MANDATORY_PAN_THRESHOLD = 2_000;
