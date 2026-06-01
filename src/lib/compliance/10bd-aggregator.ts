import "server-only";
import type { DonationMode, DonationPurpose, DonorType } from "@prisma/client";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { getFinancialYearRange } from "@/lib/format/date";
import {
  dominantDonationType,
  dominantModeCode,
  donorIdForCsv,
  donorTypeForCsv,
  donationTypeCode,
  SECTION_CODE,
} from "./10bd-codes";

/**
 * Form 10BD aggregator.
 *
 * Inclusion rules (PRD §7.7 + Phase 5 prompt):
 *   - donationDate falls within the selected FY
 *   - donor is NOT anonymous (donorType ≠ ANONYMOUS AND donor.isAnonymousBucket = false)
 *   - mode ≠ IN_KIND
 *   - is80GEligible = true
 *   - status ∈ { RECEIVED, REALISED }
 *
 * Aggregation: one row per donor (sum of all qualifying donations). The
 * dominant donation type + dominant mode are picked per `10bd-codes.ts`.
 *
 * Returned rows include a `valid: boolean` flag plus the list of issues
 * blocking inclusion. The wizard renders these.
 */

export type DonorRow = {
  donorId: string;
  name: string;
  donorType: DonorType;
  pan: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  };
  donationCount: number;
  aggregateAmount: Decimal;
  donations: { purpose: DonationPurpose; mode: DonationMode; isFcra: boolean; amount: string }[];
  dominantType: ReturnType<typeof dominantDonationType>;
  dominantModeCode: string;
  identification: { idCode: string; idNumber: string } | null;
  /** True when the donor has every field 10BD needs. */
  valid: boolean;
  issues: string[]; // blocking issues (e.g. missing PAN, missing address)
  warnings: string[]; // non-blocking (e.g. single-day > 50k)
};

export type Aggregation = {
  organisationId: string;
  financialYear: string;
  totalDonations: Decimal;
  totalDonors: number;
  rows: DonorRow[];
  excluded: {
    anonymousCount: number;
    anonymousTotal: Decimal;
    inKindCount: number;
    cancelledCount: number;
    not80GEligibleCount: number;
  };
};

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

export async function aggregateFor10BD(
  organisationId: string,
  financialYear: string,
): Promise<Aggregation> {
  const { start, end } = getFinancialYearRange(financialYear);

  // Pull everything — including donations we'll explicitly exclude — so we
  // can produce useful summary counts in the validate panel.
  const all = await prismaUnsafe.donation.findMany({
    where: {
      organisationId,
      donationDate: { gte: start, lt: end },
    },
    include: {
      donor: true,
    },
  });

  const excluded = {
    anonymousCount: 0,
    anonymousTotal: new Decimal(0),
    inKindCount: 0,
    cancelledCount: 0,
    not80GEligibleCount: 0,
  };

  // Bucket per donor
  type Bucket = {
    donor: (typeof all)[number]["donor"];
    donations: (typeof all)[number][];
  };
  const buckets = new Map<string, Bucket>();
  for (const d of all) {
    if (d.status === "CANCELLED") {
      excluded.cancelledCount += 1;
      continue;
    }
    if (d.status === "BOUNCED" || d.status === "PENDING_REALISATION") continue;
    if (d.donor.isAnonymousBucket || d.donor.donorType === "ANONYMOUS") {
      excluded.anonymousCount += 1;
      excluded.anonymousTotal = excluded.anonymousTotal.plus(d.amount.toString());
      continue;
    }
    if (d.mode === "IN_KIND" || d.isInKind) {
      excluded.inKindCount += 1;
      continue;
    }
    if (!d.is80GEligible) {
      excluded.not80GEligibleCount += 1;
      continue;
    }
    const b = buckets.get(d.donorId) ?? { donor: d.donor, donations: [] };
    b.donations.push(d);
    buckets.set(d.donorId, b);
  }

  const rows: DonorRow[] = [];
  let totalDonations = new Decimal(0);
  for (const [donorId, b] of buckets) {
    const issues: string[] = [];
    const warnings: string[] = [];

    const ident = donorIdForCsv({ donorType: b.donor.donorType, pan: b.donor.pan });
    if (!ident) issues.push("Missing PAN (or Tax ID for foreign donors)");
    if (b.donor.pan && !PAN_RE.test(b.donor.pan)) {
      issues.push("PAN format mismatch");
    }
    if (!b.donor.addressLine1 || !b.donor.city || !b.donor.state || !b.donor.pincode) {
      issues.push("Address fields incomplete (line1, city, state, pincode required)");
    }

    // Single-day > 50k soft warning
    const byDay = new Map<string, Decimal>();
    for (const d of b.donations) {
      const day = d.donationDate.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? new Decimal(0)).plus(d.amount.toString()));
    }
    const splitDays = [...byDay.entries()].filter(([, v]) => v.gt(50000));
    if (splitDays.length > 0) {
      warnings.push(
        `${splitDays.length} day(s) with > ₹50,000 from this donor — confirm not split donations`,
      );
    }

    const donationsForCodes = b.donations.map((d) => ({
      purpose: d.purpose,
      mode: d.mode,
      isFcra: d.isFcra,
      amount: d.amount.toString(),
    }));
    const aggregate = b.donations.reduce(
      (acc, d) => acc.plus(d.amount.toString()),
      new Decimal(0),
    );
    totalDonations = totalDonations.plus(aggregate);
    const dominantType = dominantDonationType(donationsForCodes);
    const dominantMode = dominantModeCode(donationsForCodes);

    rows.push({
      donorId,
      name: b.donor.name,
      donorType: b.donor.donorType,
      pan: b.donor.pan,
      address: {
        line1: b.donor.addressLine1,
        line2: b.donor.addressLine2,
        city: b.donor.city,
        state: b.donor.state,
        pincode: b.donor.pincode,
      },
      donationCount: b.donations.length,
      aggregateAmount: aggregate,
      donations: donationsForCodes,
      dominantType,
      dominantModeCode: dominantMode,
      identification: ident,
      valid: issues.length === 0,
      issues,
      warnings,
    });
  }

  return {
    organisationId,
    financialYear,
    totalDonations,
    totalDonors: rows.length,
    rows,
    excluded,
  };
}

// ---------------------------------------------------------------------------
// CSV generator
// ---------------------------------------------------------------------------

/**
 * Generate the IT-portal CSV.
 *
 * Column order (FY 2024-25 official schema):
 *   1. S.No
 *   2. Name of Donor
 *   3. Address of Donor
 *   4. Donor Type (Individual/Trust/Company/Others)
 *   5. ID Code (1=PAN, 2=Aadhaar, 3=Tax ID, 4=DL, 5=VID, 6=RC, 7=Passport)
 *   6. ID Number
 *   7. Section Code (always 1 for 80G(5)(iii))
 *   8. Unique Identification of Donation (blank for non-CSR)
 *   9. Donation Type (1=Corpus, 2=Specific, 3=Others, 4=Foreign Source)
 *  10. Mode of Receipt (1=Cash, 2=Kind, 3=Electronic, 4=Others)
 *  11. Amount of Donation (in Rs)
 *
 * `withHeader = true` produces a human-readable file for local audit.
 * The IT portal expects no header row.
 */
export function buildCsv(agg: Aggregation, opts: { withHeader: boolean }): string {
  const rows: string[] = [];
  if (opts.withHeader) {
    rows.push(
      [
        "S.No",
        "Name of Donor",
        "Address of Donor",
        "Donor Type",
        "ID Code",
        "ID Number",
        "Section Code",
        "Unique Identification of Donation",
        "Donation Type",
        "Mode of Receipt",
        "Amount of Donation",
      ].map(csvCell).join(","),
    );
  }
  let sn = 0;
  for (const row of agg.rows) {
    if (!row.valid) continue;
    if (!row.identification) continue;
    sn += 1;
    const addr = [
      row.address.line1,
      row.address.line2,
      row.address.city,
      row.address.state,
      row.address.pincode,
    ]
      .filter(Boolean)
      .join(", ");
    rows.push(
      [
        String(sn),
        row.name,
        addr,
        donorTypeForCsv(row.donorType),
        row.identification.idCode,
        row.identification.idNumber,
        SECTION_CODE,
        "", // Unique Identification of Donation — blank for non-CSR
        donationTypeCode(row.dominantType),
        row.dominantModeCode,
        row.aggregateAmount.toFixed(2),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return rows.join("\n");
}

function csvCell(v: string): string {
  if (v == null) return "";
  const needsQuote = /[",\n\r]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}
