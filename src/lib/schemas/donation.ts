import { z } from "zod";
import { Decimal } from "decimal.js";

// ---------------------------------------------------------------------------
// Enums (mirrors prisma)
// ---------------------------------------------------------------------------

export const DONATION_MODES = [
  "CASH",
  "CHEQUE",
  "DD",
  "NEFT",
  "RTGS",
  "IMPS",
  "UPI",
  "CARD",
  "ONLINE_GATEWAY",
  "IN_KIND",
  "OTHER",
] as const;
export type DonationMode = (typeof DONATION_MODES)[number];

export const IN_KIND_VALUATION_METHODS = [
  "FAIR_MARKET_VALUE",
  "COST",
  "APPRAISED",
  "ESTIMATED",
] as const;

export const DONATION_PURPOSES = [
  "GENERAL",
  "CORPUS",
  "PROJECT_SPECIFIC",
  "CSR",
  "RELIEF",
  "EARMARKED_GRANT",
] as const;
export type DonationPurpose = (typeof DONATION_PURPOSES)[number];

const optionalText = z
  .preprocess(
    (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v !== "string") return v;
      const t = v.trim();
      return t.length === 0 ? null : t;
    },
    z.union([z.string(), z.null()]),
  )
  .optional()
  .transform((v) => v ?? null);

const CIN_RE = /^[LUu]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/i;

/**
 * Modes that require a payment reference (UTR / cheque no / UPI ref).
 * Cash and In-kind do not.
 */
const MODES_NEED_REF = new Set<DonationMode>([
  "CHEQUE",
  "DD",
  "NEFT",
  "RTGS",
  "IMPS",
  "UPI",
  "CARD",
  "ONLINE_GATEWAY",
]);
/** Modes that need a bank account credited. Cash + In-kind do not. */
const MODES_NEED_BANK = new Set<DonationMode>([
  "CHEQUE",
  "DD",
  "NEFT",
  "RTGS",
  "IMPS",
  "UPI",
  "CARD",
  "ONLINE_GATEWAY",
]);

// Money parser — accept string / number / Decimal, store as Decimal-compatible string.
export const moneySchema = z
  .preprocess(
    (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "number" || typeof v === "string") return v;
      return v;
    },
    z.union([z.string(), z.number()]),
  )
  .transform((v) => new Decimal(String(v)))
  .refine((d) => d.isFinite() && d.gt(0), "Amount must be greater than zero")
  .refine((d) => d.precision() <= 18, "Amount has too many digits")
  .refine((d) => d.decimalPlaces() <= 2, "Amount can have at most 2 decimal places");

// ---------------------------------------------------------------------------
// recordDonation input — used by the 30-second form
// ---------------------------------------------------------------------------

export const recordDonationSchema = z
  .object({
    donorId: z.string().min(1, "Pick a donor"),
    donationDate: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 24 * 3600 * 1000, {
      message: "Donation date can't be in the future",
    }),
    amount: moneySchema,
    mode: z.enum(DONATION_MODES),

    bankAccountId: optionalText,
    paymentRef: optionalText,
    paymentDate: z.coerce.date().nullable().optional().transform((d) => d ?? null),

    isInKind: z.coerce.boolean().default(false),
    inKindDescription: optionalText,
    inKindValuationMethod: z
      .enum(IN_KIND_VALUATION_METHODS)
      .nullable()
      .optional()
      .transform((v) => v ?? null),

    purpose: z.enum(DONATION_PURPOSES).default("GENERAL"),
    projectId: optionalText,

    isCsr: z.coerce.boolean().default(false),
    csrCompanyCin: optionalText,

    isFcra: z.coerce.boolean().default(false),
    is80GEligible: z.coerce.boolean().default(true),

    remarks: optionalText,
  })
  // ---- Cross-field rules ----
  .superRefine((v, ctx) => {
    if (MODES_NEED_REF.has(v.mode) && !v.paymentRef) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentRef"],
        message: "Payment reference is required for this mode",
      });
    }
    if (MODES_NEED_BANK.has(v.mode) && !v.bankAccountId) {
      ctx.addIssue({
        code: "custom",
        path: ["bankAccountId"],
        message: "Bank account is required for this mode",
      });
    }
    if (v.mode === "IN_KIND") {
      if (!v.inKindDescription) {
        ctx.addIssue({
          code: "custom",
          path: ["inKindDescription"],
          message: "Describe what was donated",
        });
      }
      if (!v.inKindValuationMethod) {
        ctx.addIssue({
          code: "custom",
          path: ["inKindValuationMethod"],
          message: "Pick a valuation method",
        });
      }
    }
    if (
      (v.purpose === "PROJECT_SPECIFIC" || v.purpose === "CSR" || v.purpose === "EARMARKED_GRANT") &&
      !v.projectId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Project is required for this purpose",
      });
    }
    if (v.purpose === "CSR" || v.isCsr) {
      if (!v.csrCompanyCin) {
        ctx.addIssue({
          code: "custom",
          path: ["csrCompanyCin"],
          message: "CSR company CIN is required",
        });
      } else if (!CIN_RE.test(v.csrCompanyCin)) {
        ctx.addIssue({
          code: "custom",
          path: ["csrCompanyCin"],
          message: "CIN should be 21 characters",
        });
      }
    }
  });

export type RecordDonationInput = z.infer<typeof recordDonationSchema>;

// ---------------------------------------------------------------------------
// Cancel donation input
// ---------------------------------------------------------------------------

export const cancelDonationSchema = z.object({
  donationId: z.string().min(1),
  reason: z.string().trim().min(3, "Provide a brief reason for the cancellation").max(500),
});
export type CancelDonationInput = z.infer<typeof cancelDonationSchema>;
