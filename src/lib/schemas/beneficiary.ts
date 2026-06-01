import { z } from "zod";
import { Decimal } from "decimal.js";
import { stateCodeForName } from "@/lib/constants/states";

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

const positiveMoney = z
  .preprocess(
    (v) => (v === null || v === undefined ? null : v),
    z.union([z.string(), z.number()]),
  )
  .transform((v) => new Decimal(String(v)))
  .refine((d) => d.isFinite() && d.gte(0), "Amount must be ≥ 0")
  .refine((d) => d.decimalPlaces() <= 2, "At most 2 decimal places");

export const GENDERS = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"] as const;
export const BENEFICIARY_STATUSES = ["ACTIVE", "EXITED", "INACTIVE"] as const;
export const DISBURSEMENT_TYPES = [
  "CASH",
  "KIND",
  "SERVICE",
  "SCHOLARSHIP",
  "MEDICAL",
  "OTHER",
] as const;
export type DisbursementType = (typeof DISBURSEMENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Beneficiary
// ---------------------------------------------------------------------------

export const beneficiarySchema = z
  .object({
    code: optionalText,
    name: z.string().trim().min(1, "Name is required").max(160),
    dob: z.coerce.date().nullable().optional().transform((d) => d ?? null),
    gender: z.enum(GENDERS).nullable().optional().transform((v) => v ?? null),
    category: optionalText,
    phone: optionalText,
    email: optionalText,
    addressLine1: optionalText,
    city: optionalText,
    state: optionalText,
    pincode: z
      .preprocess(
        (v) => (v === null || v === undefined ? null : typeof v === "string" ? v.trim() : v),
        z.union([z.string(), z.null()]),
      )
      .optional()
      .transform((v) => v ?? null)
      .refine((v) => v === null || /^\d{6}$/.test(v), "Pincode must be 6 digits"),
    internalNotes: optionalText,
  })
  .transform((v) => ({
    ...v,
    stateCode: v.state ? stateCodeForName(v.state) ?? null : null,
  }));

export type BeneficiaryInput = z.infer<typeof beneficiarySchema>;

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export const beneficiaryEnrolmentSchema = z.object({
  beneficiaryId: z.string().min(1),
  projectId: z.string().min(1),
  enrolledOn: z.coerce.date().default(() => new Date()),
  remarks: optionalText,
});
export type BeneficiaryEnrolmentInput = z.infer<typeof beneficiaryEnrolmentSchema>;

export const exitEnrolmentSchema = z.object({
  enrolmentId: z.string().min(1),
  exitedOn: z.coerce.date().default(() => new Date()),
  reason: optionalText,
});

// ---------------------------------------------------------------------------
// Disbursement
// ---------------------------------------------------------------------------

const ACK_REQUIRED_TYPES = new Set<DisbursementType>(["CASH", "SCHOLARSHIP", "MEDICAL"]);

export const disbursementSchema = z
  .object({
    beneficiaryId: z.string().min(1),
    disbursementDate: z.coerce.date(),
    type: z.enum(DISBURSEMENT_TYPES),
    value: positiveMoney,
    description: z.string().trim().min(1, "Describe the disbursement").max(500),
    expenseId: optionalText,
    ackUrl: optionalText,
    /** Org-configurable threshold; the form supplies this from Organisation.disbursementAckThreshold */
    ackThreshold: positiveMoney.default(new Decimal(1000)),
  })
  .superRefine((v, ctx) => {
    // SERVICE allowed to be 0; everything else must be > 0
    if (v.type !== "SERVICE" && v.value.lte(0)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Value must be greater than zero",
      });
    }
    // ACK required for cash/scholarship/medical above threshold
    if (ACK_REQUIRED_TYPES.has(v.type) && v.value.gt(v.ackThreshold) && !v.ackUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["ackUrl"],
        message: `Acknowledgement proof required for ${v.type} disbursements above ₹${v.ackThreshold.toString()}`,
      });
    }
  });

export type DisbursementInput = z.infer<typeof disbursementSchema>;

// ---------------------------------------------------------------------------
// Impact metric
// ---------------------------------------------------------------------------

export const impactRecordSchema = z.object({
  beneficiaryId: z.string().min(1),
  recordDate: z.coerce.date().default(() => new Date()),
  metricName: z.string().trim().min(1).max(120),
  metricValue: z.string().trim().min(1).max(500),
  notes: optionalText,
});
export type ImpactRecordInput = z.infer<typeof impactRecordSchema>;
