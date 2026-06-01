import { z } from "zod";
import { stateCodeForName } from "@/lib/constants/states";

// ---------------------------------------------------------------------------
// Regex primitives
// ---------------------------------------------------------------------------

const PAN_RE   = /^[A-Z]{5}\d{4}[A-Z]$/;
const TAN_RE   = /^[A-Z]{4}\d{5}[A-Z]$/;
const CIN_RE   = /^[LUu]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/i;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d][Zz][A-Z\d]$/;
const IFSC_RE  = /^[A-Z]{4}0[A-Z\d]{6}$/;
const PIN_RE   = /^\d{6}$/;

// ---------------------------------------------------------------------------
// Reusable field schemas
// ---------------------------------------------------------------------------

/**
 * Helper: a field that accepts a non-empty trimmed string, an empty string,
 * null, or undefined — and normalises any of those to `string | null`.
 * Always safe to use as a default for "optional text" fields.
 */
const optionalTrimmed = z
  .preprocess(
    (v) => {
      if (v === undefined || v === null) return null;
      if (typeof v !== "string") return v;
      const t = v.trim();
      return t.length === 0 ? null : t;
    },
    z.union([z.string(), z.null()]),
  )
  .optional()
  .transform((v) => v ?? null);

/**
 * Helper: wrap a strict schema (e.g. PAN regex) so an empty string / null /
 * undefined become null, while a real value still goes through the strict
 * check.
 */
function nullableOptional<T extends z.ZodType<string>>(schema: T) {
  return z
    .preprocess(
      (v) => {
        if (v === undefined || v === null) return null;
        if (typeof v === "string" && v.trim().length === 0) return null;
        return v;
      },
      z.union([schema, z.null()]),
    )
    .optional()
    .transform((v) => v ?? null);
}

export const panSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => PAN_RE.test(s), "PAN should look like ABCDE1234F (5 letters, 4 digits, 1 letter)");

export const tanSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => TAN_RE.test(s), "TAN should look like ABCD12345E (4 letters, 5 digits, 1 letter)");

export const cinSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => CIN_RE.test(s), "CIN should be 21 characters, e.g. U85100KA2024NPL123456");

export const gstinSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => GSTIN_RE.test(s), "GSTIN should be 15 characters (state code + PAN + 3 chars)");

export const ifscSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => IFSC_RE.test(s), "IFSC should be 11 chars, e.g. HDFC0000301");

export const pincodeSchema = z
  .string()
  .trim()
  .refine((s) => PIN_RE.test(s), "Pincode must be 6 digits");

/** Indian phone normaliser: accepts "+91 98xx", "98xx", "+919xxx", "98xx-xxx-xxxx". */
export const indianPhoneSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, ""))
  .transform((s) => (s.startsWith("+91") ? s : s.startsWith("91") && s.length === 12 ? `+${s}` : `+91${s}`))
  .refine((s) => /^\+91\d{10}$/.test(s), "Enter a 10-digit Indian phone (with or without +91)");

export const urlSchema = z
  .string()
  .trim()
  .transform((s) => (s.length === 0 ? null : s))
  .nullable()
  .refine(
    (s) => s === null || /^https?:\/\//.test(s),
    "Website must start with http:// or https://",
  );

// ---------------------------------------------------------------------------
// Identity tab
// ---------------------------------------------------------------------------

const SUB_CATEGORIES = [
  "Education",
  "Healthcare",
  "Rural Development",
  "Women & Child",
  "Environment",
  "Disability",
  "Senior Citizens",
  "Animal Welfare",
  "Disaster Relief",
  "Skill Development",
  "Other",
] as const;
export type OrgSubCategory = (typeof SUB_CATEGORIES)[number];
export const SUB_CATEGORY_OPTIONS = SUB_CATEGORIES;

const REGISTRATION_TYPES = ["TRUST", "SOCIETY", "SECTION_8_COMPANY", "OTHER"] as const;
export const REGISTRATION_TYPE_OPTIONS = REGISTRATION_TYPES;

export const identitySchema = z
  .object({
    name: z.string().trim().min(1, "Trust name is required").max(160),
    legalName: optionalTrimmed,
    charitablePurpose: z.string().trim().max(500).optional().transform((s) => s ?? null),
    subCategory: z.enum(SUB_CATEGORIES).nullable().optional().transform((s) => s ?? null),
    phone: nullableOptional(indianPhoneSchema),
    email: nullableOptional(z.string().trim().email("Enter a valid email")),
    website: urlSchema.optional().transform((v) => v ?? null),

    addressLine1: optionalTrimmed,
    addressLine2: optionalTrimmed,
    city: optionalTrimmed,
    district: optionalTrimmed,
    state: optionalTrimmed,
    pincode: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => (v == null ? null : v.trim()))
      .refine((v) => v === "" || v === null || PIN_RE.test(v), "Pincode must be 6 digits")
      .transform((v) => (v === "" ? null : v)),
    country: z.string().trim().default("India"),

    registrationType: z.enum(REGISTRATION_TYPES),
    registrationNumber: optionalTrimmed,
    registrationDate: z.coerce.date().nullable().optional().transform((d) => d ?? null),
    pan: nullableOptional(panSchema),
    tan: nullableOptional(tanSchema),
    cin: nullableOptional(cinSchema),

    authorisedSignatoryName: optionalTrimmed,
    authorisedSignatoryDesignation: optionalTrimmed,

    fyStartMonth: z.coerce.number().int().min(1).max(12).default(4),
    fyStartDay: z.coerce.number().int().min(1).max(31).default(1),
  })
  .transform((v) => ({
    ...v,
    // Auto-derive GST state code from the state name. Stored alongside.
    stateCode: v.state ? (stateCodeForName(v.state) ?? null) : null,
  }))
  .refine(
    (v) => v.registrationType !== "SECTION_8_COMPANY" || !!v.cin,
    { message: "Section 8 companies must record a CIN", path: ["cin"] },
  );

export type IdentityInput = z.infer<typeof identitySchema>;

// ---------------------------------------------------------------------------
// 12A / 80G / GST / FCRA / Darpan / CSR-1
// ---------------------------------------------------------------------------

export const twelveASchema = z.object({
  number: z.string().trim().min(1, "Registration number is required").max(120),
  registrationDate: z.coerce.date(),
  validityEndDate: z.coerce.date().nullable().optional().transform((d) => d ?? null),
  isProvisional: z.coerce.boolean().default(false),
  remarks: optionalTrimmed,
});
export type TwelveAInput = z.infer<typeof twelveASchema>;

export const eightyGSchema = z.object({
  number: z.string().trim().min(1, "Approval number is required").max(120),
  approvalDate: z.coerce.date(),
  validityEndDate: z.coerce.date().nullable().optional().transform((d) => d ?? null),
  isProvisional: z.coerce.boolean().default(false),
  remarks: optionalTrimmed,
});
export type EightyGInput = z.infer<typeof eightyGSchema>;

export const gstSchema = z.object({
  gstin: gstinSchema,
  registrationDate: z.coerce.date(),
  remarks: optionalTrimmed,
});
export type GstInput = z.infer<typeof gstSchema>;

export const fcraSchema = z.object({
  number: z.string().trim().min(1, "FCRA registration number is required"),
  registrationDate: z.coerce.date(),
  validityEndDate: z.coerce.date().nullable().optional().transform((d) => d ?? null),
  fcraBankName: z.string().trim().min(1, "FCRA bank name is required"),
  fcraBankAccountNumber: z.string().trim().regex(/^\d{9,18}$/, "9–18 digit account number"),
  fcraBankBranch: optionalTrimmed,
  fcraBankIfsc: ifscSchema,
  remarks: optionalTrimmed,
});
export type FcraInput = z.infer<typeof fcraSchema>;

export const darpanSchema = z.object({
  darpanId: z.string().trim().min(1, "Darpan ID is required"),
  registrationDate: z.coerce.date().nullable().optional().transform((d) => d ?? null),
});
export type DarpanInput = z.infer<typeof darpanSchema>;

export const csrOneSchema = z.object({
  csrOneRef: z.string().trim().min(1, "CSR-1 reference is required"),
  registrationDate: z.coerce.date().nullable().optional().transform((d) => d ?? null),
});
export type CsrOneInput = z.infer<typeof csrOneSchema>;

// ---------------------------------------------------------------------------
// Banking
// ---------------------------------------------------------------------------

const ACCOUNT_TYPES = ["SAVINGS", "CURRENT", "OD", "CC"] as const;
const ACCOUNT_PURPOSES = ["GENERAL", "FCRA_ONLY", "CORPUS", "PROJECT_SPECIFIC"] as const;

export const bankAccountSchema = z.object({
  bankName: z.string().trim().min(1, "Bank name is required").max(120),
  branch: optionalTrimmed,
  accountNumber: z.string().trim().regex(/^\d{9,18}$/, "Account number must be 9–18 digits"),
  accountHolder: optionalTrimmed,
  ifsc: ifscSchema,
  accountType: z.enum(ACCOUNT_TYPES),
  purpose: z.enum(ACCOUNT_PURPOSES),
  openingBalance: z.coerce.number().nonnegative().default(0),
  isPrimary: z.coerce.boolean().default(false),
});
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

export const brandingTextSchema = z.object({
  receiptHeaderText: z.string().trim().max(200).nullable().optional().transform((s) => (s ? s : null)),
  receiptFooterText: z.string().trim().max(300).nullable().optional().transform((s) => (s ? s : null)),
});
export type BrandingTextInput = z.infer<typeof brandingTextSchema>;

// ---------------------------------------------------------------------------
// Document upload metadata (the actual file is handled out-of-band)
// ---------------------------------------------------------------------------

const ORG_DOC_CATEGORIES = [
  "REGISTRATION_CERT",
  "TRUST_DEED",
  "PAN",
  "TWELVE_A",
  "EIGHTY_G",
  "FCRA",
  "DARPAN",
  "CSR_ONE",
  "GST",
  "AUTHORISED_SIGNATORY",
  "OTHER",
] as const;

export const orgDocumentMetaSchema = z.object({
  category: z.enum(ORG_DOC_CATEGORIES),
  title: z.string().trim().min(1, "Title is required").max(160),
  issueDate: z.coerce.date().nullable().optional().transform((d) => d ?? null),
  expiryDate: z.coerce.date().nullable().optional().transform((d) => d ?? null),
  remarks: optionalTrimmed,
});
export type OrgDocumentMetaInput = z.infer<typeof orgDocumentMetaSchema>;
