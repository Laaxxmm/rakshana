import { z } from "zod";
import { Decimal } from "decimal.js";

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

export const PROJECT_STATUSES = [
  "PLANNED",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
] as const;
export type ProjectStatusKey = (typeof PROJECT_STATUSES)[number];

const PROJECT_CODE_RE = /^[A-Z0-9][A-Z0-9_\-/]*$/i;

export const projectSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, "Code is required")
      .max(40)
      .transform((s) => s.toUpperCase())
      .refine((s) => PROJECT_CODE_RE.test(s), "Code must be alphanumeric (slashes/dashes ok)"),
    name: z.string().trim().min(1, "Name is required").max(160),
    description: optionalText,
    startDate: z.coerce.date().nullable().optional().transform((d) => d ?? null),
    endDate: z.coerce.date().nullable().optional().transform((d) => d ?? null),
    managerId: optionalText,
    isCsr: z.coerce.boolean().default(false),
    totalBudget: positiveMoney.default(new Decimal(0)),
  })
  .refine(
    (v) => !v.startDate || !v.endDate || v.endDate.getTime() > v.startDate.getTime(),
    { message: "End date must be after start date", path: ["endDate"] },
  );

export type ProjectInput = z.infer<typeof projectSchema>;

// ---------------------------------------------------------------------------
// Budget head
// ---------------------------------------------------------------------------

export const budgetHeadSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(80),
  budgetedAmount: positiveMoney,
});
export type BudgetHeadInput = z.infer<typeof budgetHeadSchema>;

export const reallocateBudgetSchema = z
  .object({
    fromHeadId: z.string().min(1),
    toHeadId: z.string().min(1),
    amount: positiveMoney.refine((d) => d.gt(0), "Amount must be > 0"),
    reason: z.string().trim().min(3, "Reason is required").max(500),
  })
  .refine((v) => v.fromHeadId !== v.toHeadId, {
    message: "Source and target head must be different",
    path: ["toHeadId"],
  });
export type ReallocateBudgetInput = z.infer<typeof reallocateBudgetSchema>;

// ---------------------------------------------------------------------------
// Grant allocation
// ---------------------------------------------------------------------------

export const grantAllocationSchema = z.object({
  projectId: z.string().min(1),
  donorId: optionalText,
  description: z.string().trim().min(1).max(200),
  amount: positiveMoney.refine((d) => d.gt(0), "Amount must be > 0"),
  receivedOn: z.coerce.date().nullable().optional().transform((d) => d ?? null),
  remarks: optionalText,
});
export type GrantAllocationInput = z.infer<typeof grantAllocationSchema>;

// ---------------------------------------------------------------------------
// Utilisation certificate
// ---------------------------------------------------------------------------

export const generateUtilCertSchema = z.object({
  projectId: z.string().min(1),
  donorId: z.string().min(1),
  periodFrom: z.coerce.date(),
  periodTo: z.coerce.date(),
});
export type GenerateUtilCertInput = z.infer<typeof generateUtilCertSchema>;

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

export const projectTransitionSchema = z.object({
  projectId: z.string().min(1),
  toStatus: z.enum(PROJECT_STATUSES),
  reason: optionalText,
});
export type ProjectTransitionInput = z.infer<typeof projectTransitionSchema>;

// ---------------------------------------------------------------------------
// Migration tool
// ---------------------------------------------------------------------------

export const migrateFromPlaceholderSchema = z.object({
  targetProjectId: z.string().min(1),
  donationIds: z.array(z.string().min(1)).default([]),
  expenseIds: z.array(z.string().min(1)).default([]),
});
export type MigrateFromPlaceholderInput = z.infer<typeof migrateFromPlaceholderSchema>;
