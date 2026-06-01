import { Decimal } from "decimal.js";
import { tdsSection, type TdsSection } from "@/lib/constants/tax";

/**
 * Pure TDS + GST calculators. Server validation re-runs these on every
 * expense save — user-entered TDS / GST values are recomputed and any
 * mismatch is rejected. The UI also calls these for the live preview, so
 * a single source of truth.
 */

export type TdsInput = {
  /** Gross amount before TDS, in rupees. Accepts string / number / Decimal. */
  grossAmount: Decimal | string | number;
  /** Section code from `TDS_SECTIONS`. */
  section: TdsSection | null;
  /**
   * Optional LDC override rate. When the vendor has an active LDC for this
   * section, pass the LDC's `lowerRate` here — it overrides the default
   * section rate.
   */
  ldcRate?: Decimal | string | number | null;
  /**
   * Cumulative FY-to-date payment to this vendor under this section. Used
   * to surface a "threshold not met" warning. Defaults to 0 (assume the
   * caller doesn't have the data yet).
   */
  fyToDateForSection?: Decimal | string | number;
};

export type TdsResult = {
  applicable: boolean;
  /** Effective rate used (LDC if present, else section default). */
  rate: Decimal;
  /** Computed TDS amount. */
  amount: Decimal;
  /** Net payable = gross − amount. */
  netPayable: Decimal;
  /** Section meta for the receipt block. */
  sectionMeta: ReturnType<typeof tdsSection>;
  /**
   * Warning surfaces when the cumulative FY payment is below the section's
   * threshold. NGOs deduct anyway and let the auditor reclaim if needed —
   * see PRD §7.10.
   */
  warnings: string[];
};

function toDecimal(v: Decimal | string | number | null | undefined): Decimal {
  if (v === null || v === undefined) return new Decimal(0);
  if (v instanceof Decimal) return v;
  return new Decimal(String(v));
}

export function computeTds(input: TdsInput): TdsResult {
  const gross = toDecimal(input.grossAmount);
  const sectionMeta = input.section ? tdsSection(input.section) : null;

  if (!input.section || !sectionMeta) {
    return {
      applicable: false,
      rate: new Decimal(0),
      amount: new Decimal(0),
      netPayable: gross,
      sectionMeta: null,
      warnings: [],
    };
  }

  // 192 (salary) has no defaultRate — caller must compute slab-wise; we
  // surface a warning and skip auto-deduction.
  if (sectionMeta.defaultRate === null) {
    return {
      applicable: true,
      rate: new Decimal(0),
      amount: new Decimal(0),
      netPayable: gross,
      sectionMeta,
      warnings: ["Salary TDS is computed per slab — enter the deduction manually."],
    };
  }

  const ldc = input.ldcRate !== undefined && input.ldcRate !== null ? toDecimal(input.ldcRate) : null;
  const rate = ldc !== null ? ldc : new Decimal(sectionMeta.defaultRate);
  const amount = gross.mul(rate).div(100).toDecimalPlaces(2);
  const netPayable = gross.sub(amount).toDecimalPlaces(2);

  const warnings: string[] = [];
  const fyToDate = input.fyToDateForSection !== undefined ? toDecimal(input.fyToDateForSection) : new Decimal(0);
  if (fyToDate.plus(gross).lt(sectionMeta.threshold)) {
    warnings.push(
      `Cumulative FY payment under section ${input.section} is below the threshold (₹${sectionMeta.threshold.toLocaleString("en-IN")}). Deduction recorded anyway — auditor may reclaim.`,
    );
  }

  return { applicable: true, rate, amount, netPayable, sectionMeta, warnings };
}

// ---------------------------------------------------------------------------
// GST math
// ---------------------------------------------------------------------------

export type GstInput = {
  /** The taxable value the GST percentage is applied to. */
  taxableValue: Decimal | string | number;
  /** GST percentage. Must be in `GST_RATES`. */
  rate: number;
  /** True when the supply is inter-state (vendor stateCode ≠ org stateCode). */
  isInterState: boolean;
};

export type GstResult = {
  taxableValue: Decimal;
  rate: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  total: Decimal;
};

export function computeGst(input: GstInput): GstResult {
  const taxable = toDecimal(input.taxableValue);
  const rate = new Decimal(input.rate);
  const totalTax = taxable.mul(rate).div(100).toDecimalPlaces(2);

  if (input.isInterState) {
    return {
      taxableValue: taxable,
      rate,
      cgst: new Decimal(0),
      sgst: new Decimal(0),
      igst: totalTax,
      total: taxable.plus(totalTax).toDecimalPlaces(2),
    };
  }
  const half = totalTax.div(2).toDecimalPlaces(2);
  // CGST + SGST may not exactly equal totalTax on odd-paise splits; align by
  // assigning the remainder (≤1 paisa) to SGST so the sum is always exact.
  const cgst = half;
  const sgst = totalTax.minus(half);
  return {
    taxableValue: taxable,
    rate,
    cgst,
    sgst,
    igst: new Decimal(0),
    total: taxable.plus(totalTax).toDecimalPlaces(2),
  };
}
