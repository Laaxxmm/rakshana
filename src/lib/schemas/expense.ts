import { z } from "zod";
import { Decimal } from "decimal.js";
import { TDS_SECTION_KEYS, GST_RATES } from "@/lib/constants/tax";

// ---------------------------------------------------------------------------
// Enums (mirror prisma)
// ---------------------------------------------------------------------------

export const PAYMENT_MODES = [
  "CASH",
  "CHEQUE",
  "NEFT",
  "RTGS",
  "IMPS",
  "UPI",
  "CARD",
  "OTHER",
] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

const MODES_NEED_REF = new Set<PaymentMode>(["CHEQUE", "NEFT", "RTGS", "IMPS", "UPI", "CARD"]);
const MODES_NEED_BANK = new Set<PaymentMode>(["CHEQUE", "NEFT", "RTGS", "IMPS", "UPI", "CARD"]);

// ---------------------------------------------------------------------------
// Optional-text helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

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
  .refine((d) => d.isFinite(), "Amount must be a number")
  .refine((d) => d.decimalPlaces() <= 2, "At most 2 decimal places");

const positiveMoney = moneySchema.refine((d) => d.gt(0), "Amount must be > 0");
const nonNegMoney = moneySchema.refine((d) => d.gte(0), "Amount must be ≥ 0");

// ---------------------------------------------------------------------------
// Expense draft input (the "save draft" / "submit" form)
// ---------------------------------------------------------------------------

export const expenseDraftSchema = z
  .object({
    // Vendor or cash payee (one or the other; both null = warn at submit)
    vendorId: optionalText,
    cashPayeeName: optionalText,

    expenseDate: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 24 * 3600 * 1000, {
      message: "Expense date can't be in the future",
    }),

    categoryId: optionalText,
    projectId: optionalText,

    grossAmount: positiveMoney,

    // GST
    gstApplicable: z.coerce.boolean().default(false),
    gstRate: z.coerce.number().optional().refine(
      (n) => n === undefined || (GST_RATES as readonly number[]).includes(n),
      "Unknown GST rate",
    ),
    isInterState: z.coerce.boolean().default(false),
    isItcEligible: z.coerce.boolean().default(false),

    // TDS
    tdsApplicable: z.coerce.boolean().default(false),
    tdsSection: z
      .enum([...TDS_SECTION_KEYS] as [string, ...string[]])
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    tdsRate: nonNegMoney.nullable().optional().transform((v) => v ?? null),
    ldcCertificateId: optionalText,

    // Payment
    mode: z.enum(PAYMENT_MODES),
    bankAccountId: optionalText,
    paymentRef: optionalText,

    // Petty cash
    isPettyCash: z.coerce.boolean().default(false),
    pettyCashFloatId: optionalText,

    // Bill + description
    description: z.string().trim().min(5, "Description (5–500 chars)").max(500),
    billUrl: optionalText,
    billMimeType: optionalText,
    billSize: z.coerce.number().int().nonnegative().nullable().optional().transform((n) => n ?? null),
  })
  // ---- Cross-field rules ----
  .superRefine((v, ctx) => {
    if (!v.vendorId && !v.cashPayeeName) {
      ctx.addIssue({
        code: "custom",
        path: ["vendorId"],
        message: "Pick a vendor — or enter a one-off cash payee name",
      });
    }
    if (MODES_NEED_REF.has(v.mode) && !v.paymentRef) {
      ctx.addIssue({ code: "custom", path: ["paymentRef"], message: "Reference is required for this mode" });
    }
    if (MODES_NEED_BANK.has(v.mode) && !v.bankAccountId && !v.isPettyCash) {
      ctx.addIssue({ code: "custom", path: ["bankAccountId"], message: "Bank account is required for this mode" });
    }
    if (v.isPettyCash && !v.pettyCashFloatId) {
      ctx.addIssue({ code: "custom", path: ["pettyCashFloatId"], message: "Pick a petty cash float" });
    }
    if (v.tdsApplicable && !v.tdsSection) {
      ctx.addIssue({ code: "custom", path: ["tdsSection"], message: "Pick a TDS section" });
    }
    if (v.gstApplicable && (v.gstRate === undefined || v.gstRate === null)) {
      ctx.addIssue({ code: "custom", path: ["gstRate"], message: "Pick a GST rate" });
    }
  });

export type ExpenseDraftInput = z.infer<typeof expenseDraftSchema>;

// ---------------------------------------------------------------------------
// Workflow actions
// ---------------------------------------------------------------------------

export const approveExpenseSchema = z.object({
  expenseId: z.string().min(1),
  notes: optionalText,
});
export const rejectExpenseSchema = z.object({
  expenseId: z.string().min(1),
  notes: z.string().trim().min(3, "Provide a reason for rejection").max(500),
});
export const markPaidSchema = z.object({
  expenseId: z.string().min(1),
  paidAt: z.coerce.date().default(() => new Date()),
  modeOverride: z.enum(PAYMENT_MODES).nullable().optional(),
  paymentRef: optionalText,
});
export const cancelExpenseSchema = z.object({
  expenseId: z.string().min(1),
  reason: z.string().trim().min(3, "Reason required").max(500),
});

// ---------------------------------------------------------------------------
// Petty cash
// ---------------------------------------------------------------------------

export const pettyCashFloatSchema = z.object({
  name: z.string().trim().min(1).max(120),
  custodianId: z.string().min(1, "Custodian is required"),
  floatAmount: positiveMoney,
});
export type PettyCashFloatInput = z.infer<typeof pettyCashFloatSchema>;

export const pettyCashTopUpSchema = z.object({
  floatId: z.string().min(1),
  amount: positiveMoney,
  topUpDate: z.coerce.date().default(() => new Date()),
  sourceBankAccountId: z.string().min(1, "Source bank is required"),
  remarks: optionalText,
});
export type PettyCashTopUpInput = z.infer<typeof pettyCashTopUpSchema>;

// ---------------------------------------------------------------------------
// Recurring expense template
// ---------------------------------------------------------------------------

export const RECURRING_FREQUENCIES = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"] as const;

export const recurringExpenseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  vendorId: optionalText,
  categoryId: optionalText,
  projectId: optionalText,
  amount: positiveMoney,
  frequency: z.enum(RECURRING_FREQUENCIES),
  nextDueDate: z.coerce.date(),
  endDate: z.coerce.date().nullable().optional().transform((v) => v ?? null),
  remarks: optionalText,
});
export type RecurringExpenseInput = z.infer<typeof recurringExpenseSchema>;
