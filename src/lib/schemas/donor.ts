import { z } from "zod";
import {
  panSchema,
  ifscSchema,
  indianPhoneSchema,
} from "@/lib/schemas/organisation";
import { stateCodeForName } from "@/lib/constants/states";

// ---------------------------------------------------------------------------
// Shared primitives
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

function nullableOptional<T extends z.ZodType<string>>(schema: T) {
  return z
    .preprocess(
      (v) => {
        if (v === null || v === undefined) return null;
        if (typeof v === "string" && v.trim().length === 0) return null;
        return v;
      },
      z.union([schema, z.null()]),
    )
    .optional()
    .transform((v) => v ?? null);
}

export const aadhaarLast4Schema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "Last 4 digits of Aadhaar only");

// ---------------------------------------------------------------------------
// Donor types & enums (mirrors prisma)
// ---------------------------------------------------------------------------

export const DONOR_TYPES = [
  "INDIVIDUAL",
  "CORPORATE",
  "NRI",
  "ANONYMOUS",
  "TRUST",
  "HUF",
  "GOVERNMENT",
  "FOREIGN_SOURCE",
] as const;
export type DonorTypeKey = (typeof DONOR_TYPES)[number];

// CIN regex for CSR company (same as org's CIN)
const CIN_RE = /^[LUu]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/i;
const cinSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => CIN_RE.test(s), "CIN should be 21 chars (e.g. U85100KA2024NPL123456)");

// ---------------------------------------------------------------------------
// Donor schema — used by /donors/new and /donors/[id]/edit forms
// ---------------------------------------------------------------------------

export const donorSchema = z
  .object({
    donorType: z.enum(DONOR_TYPES),
    name: z.string().trim().min(1, "Name is required").max(200),
    pan: nullableOptional(panSchema),
    aadhaarLast4: nullableOptional(aadhaarLast4Schema),

    phone: nullableOptional(indianPhoneSchema),
    whatsapp: nullableOptional(indianPhoneSchema),
    email: nullableOptional(z.string().trim().email("Enter a valid email")),

    addressLine1: optionalText,
    addressLine2: optionalText,
    city: optionalText,
    district: optionalText,
    state: optionalText,
    pincode: z
      .preprocess(
        (v) => (v === null || v === undefined ? null : typeof v === "string" ? v.trim() : v),
        z.union([z.string(), z.null()]),
      )
      .optional()
      .transform((v) => v ?? null)
      .refine((v) => v === null || /^\d{6}$/.test(v), "Pincode must be 6 digits"),
    country: z.string().trim().default("India"),

    is80GEligible: z.coerce.boolean().default(true),
    isFcraEligible: z.coerce.boolean().default(false),
    isCsrDonor: z.coerce.boolean().default(false),
    csrCompanyCin: nullableOptional(cinSchema),
    whatsappOptIn: z.coerce.boolean().default(true),

    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    internalNotes: optionalText,
  })
  .transform((v) => ({
    ...v,
    stateCode: v.state ? stateCodeForName(v.state) ?? null : null,
    // Anonymous donors never 80G-eligible
    is80GEligible: v.donorType === "ANONYMOUS" ? false : v.is80GEligible,
  }))
  .refine((v) => !v.isCsrDonor || !!v.csrCompanyCin, {
    message: "CSR donors must record the company CIN",
    path: ["csrCompanyCin"],
  })
  .refine((v) => v.addressLine1 === null || v.pincode !== null, {
    message: "Pincode is required when an address is provided",
    path: ["pincode"],
  })
  .refine(
    (v) => !(v.donorType === "FOREIGN_SOURCE" || v.donorType === "NRI") || v.isFcraEligible,
    {
      message: "Foreign-source / NRI donors must be FCRA-eligible",
      path: ["isFcraEligible"],
    },
  );

export type DonorInput = z.infer<typeof donorSchema>;

// ---------------------------------------------------------------------------
// Mini-donor schema (the inline +Add donor from the donation form)
// ---------------------------------------------------------------------------

export const miniDonorSchema = z.object({
  donorType: z.enum(DONOR_TYPES),
  name: z.string().trim().min(1).max(200),
  pan: nullableOptional(panSchema),
  phone: nullableOptional(indianPhoneSchema),
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
});
export type MiniDonorInput = z.infer<typeof miniDonorSchema>;

// ---------------------------------------------------------------------------
// Communication log entry
// ---------------------------------------------------------------------------

export const COMMUNICATION_CHANNELS = [
  "EMAIL",
  "WHATSAPP",
  "SMS",
  "CALL",
  "IN_PERSON",
  "LETTER",
] as const;
export const COMMUNICATION_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;

export const communicationSchema = z.object({
  donorId: z.string().min(1),
  channel: z.enum(COMMUNICATION_CHANNELS),
  direction: z.enum(COMMUNICATION_DIRECTIONS).default("OUTBOUND"),
  subject: optionalText,
  body: optionalText,
  occurredAt: z.coerce.date().default(() => new Date()),
});
export type CommunicationInput = z.infer<typeof communicationSchema>;

// ---------------------------------------------------------------------------
// Donor document upload metadata
// ---------------------------------------------------------------------------

export const DONOR_DOCUMENT_CATEGORIES = [
  "PAN_CARD",
  "AADHAAR",
  "ID_PROOF",
  "CSR_FORM",
  "OTHER",
] as const;
export const donorDocumentMetaSchema = z.object({
  donorId: z.string().min(1),
  category: z.enum(DONOR_DOCUMENT_CATEGORIES),
  title: z.string().trim().min(1).max(160),
});
export type DonorDocumentMetaInput = z.infer<typeof donorDocumentMetaSchema>;

// Re-export for import service convenience
export const IFSC = ifscSchema;
