import { z } from "zod";
import {
  panSchema,
  gstinSchema,
  ifscSchema,
  indianPhoneSchema,
} from "@/lib/schemas/organisation";
import { stateCodeForName } from "@/lib/constants/states";
import { TDS_SECTION_KEYS } from "@/lib/constants/tax";

// ---------------------------------------------------------------------------
// Shared optional-text helper (mirror of donor schema)
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

// ---------------------------------------------------------------------------
// Vendor
// ---------------------------------------------------------------------------

export const vendorSchema = z
  .object({
    name: z.string().trim().min(1, "Vendor name is required").max(200),
    pan: nullableOptional(panSchema),
    gstin: nullableOptional(gstinSchema),
    defaultTdsSection: z
      .enum([...TDS_SECTION_KEYS] as [string, ...string[]])
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    addressLine1: optionalText,
    addressLine2: optionalText,
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
    phone: nullableOptional(indianPhoneSchema),
    email: nullableOptional(z.string().trim().email("Enter a valid email")),

    bankName: optionalText,
    bankAccountNumber: nullableOptional(z.string().regex(/^\d{9,18}$/, "9–18 digit account number")),
    bankIfsc: nullableOptional(ifscSchema),
  })
  .transform((v) => ({
    ...v,
    stateCode: v.state ? stateCodeForName(v.state) ?? null : null,
  }));

export type VendorInput = z.infer<typeof vendorSchema>;

// ---------------------------------------------------------------------------
// LDC (Lower Deduction Certificate)
// ---------------------------------------------------------------------------

export const ldcSchema = z
  .object({
    deducteeName: z.string().trim().min(1, "Deductee name is required"),
    deducteePan: panSchema,
    section: z.enum([...TDS_SECTION_KEYS] as [string, ...string[]]),
    certNumber: z.string().trim().min(1, "Certificate number is required"),
    lowerRate: z.coerce.number().nonnegative().max(30),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date(),
    remarks: optionalText,
  })
  .refine((v) => v.validTo.getTime() > v.validFrom.getTime(), {
    message: "Validity end must be after start",
    path: ["validTo"],
  });

export type LdcInput = z.infer<typeof ldcSchema>;
