/**
 * Form 10BD IT-portal code mapping (FY 2024-25 schema).
 *
 * If the IT portal updates the schema, this file is the only one that
 * changes. Every other Phase 5 module reads codes through these mappers.
 *
 * CSV column order documented at the top of `csv-exporter.ts`.
 */

import type { DonorType, DonationMode, DonationPurpose } from "@prisma/client";

// ---------------------------------------------------------------------------
// Donor type → string (IT portal accepts free-text from this set)
// ---------------------------------------------------------------------------

const DONOR_TYPE_TO_CSV: Record<DonorType, "Individual" | "Trust" | "Company" | "Others"> = {
  INDIVIDUAL: "Individual",
  TRUST: "Trust",
  CORPORATE: "Company",
  HUF: "Others",
  NRI: "Others",
  FOREIGN_SOURCE: "Others",
  GOVERNMENT: "Others",
  ANONYMOUS: "Others",
};
export function donorTypeForCsv(t: DonorType): string {
  return DONOR_TYPE_TO_CSV[t] ?? "Others";
}

// ---------------------------------------------------------------------------
// ID code (1 = PAN, 2 = Aadhaar, 3 = Tax Identification (foreign), …)
// ---------------------------------------------------------------------------

export const ID_CODES = {
  PAN: "1",
  AADHAAR: "2",
  TAX_ID: "3",
  DRIVING_LICENSE: "4",
  VOTER_ID: "5",
  RATION_CARD: "6",
  PASSPORT: "7",
} as const;

/**
 * Pick the ID code + value for a donor. PAN preferred; Tax Identification
 * for foreign donors when PAN absent. Aadhaar fallback fails validation in
 * Rakshana — we only store last 4. Returns null if no usable identifier.
 */
export function donorIdForCsv(donor: {
  donorType: DonorType;
  pan: string | null;
}): { idCode: string; idNumber: string } | null {
  if (donor.pan) return { idCode: ID_CODES.PAN, idNumber: donor.pan };
  if (donor.donorType === "FOREIGN_SOURCE" || donor.donorType === "NRI") {
    // We don't have a separate field for foreign tax ID yet — Phase 7
    // will introduce one. For Phase 5 these donors must collect a PAN
    // OR be excluded from 10BD.
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Section code (always "1" for Sec 80G(5)(iii))
// ---------------------------------------------------------------------------

export const SECTION_CODE = "1";

// ---------------------------------------------------------------------------
// Donation type code with dominance precedence.
// When a donor has multiple donations of different purposes, the
// dominant type wins per IT portal aggregation rules:
//   Corpus > Specific Grant > Others > Foreign Source
// Documented in CODE-HEALTH.md.
// ---------------------------------------------------------------------------

export const DONATION_TYPE_CODES = {
  CORPUS: "1",
  SPECIFIC_GRANT: "2",
  OTHERS: "3",
  FOREIGN_SOURCE: "4",
} as const;

const PURPOSE_TO_TYPE: Record<DonationPurpose, keyof typeof DONATION_TYPE_CODES> = {
  CORPUS: "CORPUS",
  PROJECT_SPECIFIC: "SPECIFIC_GRANT",
  CSR: "SPECIFIC_GRANT",
  EARMARKED_GRANT: "SPECIFIC_GRANT",
  GENERAL: "OTHERS",
  RELIEF: "OTHERS",
};

const DOMINANCE_ORDER: (keyof typeof DONATION_TYPE_CODES)[] = [
  "CORPUS",
  "SPECIFIC_GRANT",
  "OTHERS",
  "FOREIGN_SOURCE",
];

/**
 * Returns the dominant donation type for a donor's collection of donations.
 * `isFcra` is checked on every donation; if any donation is FCRA, the
 * donor's whole reported type becomes "Foreign Source" (lowest precedence,
 * but FCRA always wins over the FCRA-only set).
 *
 * Actually per IT portal rules: Foreign Source is its own bucket. If ANY
 * of the donor's donations is FCRA, the entire reported row becomes
 * Foreign Source. Otherwise apply the standard dominance order.
 */
export function dominantDonationType(
  donations: { purpose: DonationPurpose; isFcra: boolean }[],
): keyof typeof DONATION_TYPE_CODES {
  if (donations.some((d) => d.isFcra)) return "FOREIGN_SOURCE";
  const types = new Set(donations.map((d) => PURPOSE_TO_TYPE[d.purpose]));
  for (const t of DOMINANCE_ORDER) {
    if (types.has(t)) return t;
  }
  return "OTHERS";
}

export function donationTypeCode(t: keyof typeof DONATION_TYPE_CODES): string {
  return DONATION_TYPE_CODES[t];
}

// ---------------------------------------------------------------------------
// Mode of receipt code
// ---------------------------------------------------------------------------

export const MODE_CODES = {
  CASH: "1",
  KIND: "2", // excluded from 10BD anyway, listed for completeness
  ELECTRONIC: "3",
  OTHERS: "4", // cheque, DD, etc.
} as const;

const MODE_TO_CODE: Record<DonationMode, keyof typeof MODE_CODES> = {
  CASH: "CASH",
  CHEQUE: "OTHERS",
  DD: "OTHERS",
  NEFT: "ELECTRONIC",
  RTGS: "ELECTRONIC",
  IMPS: "ELECTRONIC",
  UPI: "ELECTRONIC",
  CARD: "ELECTRONIC",
  ONLINE_GATEWAY: "ELECTRONIC",
  IN_KIND: "KIND",
  OTHER: "OTHERS",
};

/**
 * Returns the dominant mode of receipt for a set of donations. The IT
 * portal expects one mode per donor row; we pick the one most donations
 * fall under, breaking ties by amount.
 */
export function dominantModeCode(
  donations: { mode: DonationMode; amount: string | number }[],
): string {
  if (donations.length === 0) return MODE_CODES.OTHERS;
  const totals = new Map<keyof typeof MODE_CODES, number>();
  for (const d of donations) {
    const k = MODE_TO_CODE[d.mode];
    totals.set(k, (totals.get(k) ?? 0) + Number(d.amount));
  }
  let winner: keyof typeof MODE_CODES = "OTHERS";
  let winnerAmt = -1;
  for (const [k, amt] of totals) {
    if (amt > winnerAmt) {
      winnerAmt = amt;
      winner = k;
    }
  }
  return MODE_CODES[winner];
}
