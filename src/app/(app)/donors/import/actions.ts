"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";
import { donorSchema } from "@/lib/schemas/donor";
import { parseCsv, rowsToObjects } from "@/lib/csv/parse";

/**
 * Donor bulk import.
 *
 * Two actions:
 *   1. `previewImport(csvText)` — parses + validates row by row, returns
 *      a report the user can review before committing. NO writes.
 *   2. `commitImport(rows)` — accepts the already-validated rows and
 *      inserts them. Skips rows that collide on PAN (idempotent re-runs).
 *
 * Both rely on the canonical `donorSchema` so the import path validates
 * identically to the single-donor create form.
 */

// The columns we expect in the CSV (case-insensitive header match)
const HEADERS = [
  "donorType",
  "name",
  "pan",
  "phone",
  "whatsapp",
  "email",
  "addressLine1",
  "addressLine2",
  "city",
  "district",
  "state",
  "pincode",
  "country",
  "is80GEligible",
  "isFcraEligible",
  "isCsrDonor",
  "csrCompanyCin",
  "internalNotes",
] as const;

export const SAMPLE_HEADERS = HEADERS;

export type PreviewRow = {
  rowNumber: number; // 1-indexed (1 = first data row, header doesn't count)
  raw: Record<string, string>;
  ok: boolean;
  errors: string[];
  parsed?: z.infer<typeof donorSchema>;
};

export type PreviewReport = {
  total: number;
  okCount: number;
  errorCount: number;
  unknownColumns: string[];
  rows: PreviewRow[];
};

export const previewImport = safeAction
  .metadata({ requires: "donor.import" })
  .inputSchema(z.object({ csvText: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const parsed = parseCsv(parsedInput.csvText);
    if (parsed.headers.length === 0) {
      throw new Error("CSV is empty or has no header row.");
    }
    const knownLower = new Set(HEADERS.map((h) => h.toLowerCase()));
    const unknown = parsed.headers.filter(
      (h) => !knownLower.has(h.toLowerCase()),
    );
    // Normalise header keys to the canonical camelCase versions
    const canonical: Record<string, string> = {};
    for (const h of HEADERS) canonical[h.toLowerCase()] = h;
    const normalised = parsed.rows.map((cells) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < parsed.headers.length; i += 1) {
        const key = canonical[parsed.headers[i].toLowerCase()] ?? parsed.headers[i];
        obj[key] = (cells[i] ?? "").trim();
      }
      return obj;
    });

    const rows: PreviewRow[] = normalised.map((raw, idx) => {
      // Coerce booleans (CSV gives strings). "" → default; "true"/"yes"/"1" → true.
      const boolish = (v: string | undefined): boolean | undefined => {
        if (v === undefined || v === "") return undefined;
        const lo = v.toLowerCase();
        if (["true", "yes", "y", "1"].includes(lo)) return true;
        if (["false", "no", "n", "0"].includes(lo)) return false;
        return undefined; // let zod reject
      };
      const candidate = {
        donorType: raw.donorType,
        name: raw.name,
        pan: raw.pan || null,
        phone: raw.phone || null,
        whatsapp: raw.whatsapp || null,
        email: raw.email || null,
        addressLine1: raw.addressLine1 || null,
        addressLine2: raw.addressLine2 || null,
        city: raw.city || null,
        district: raw.district || null,
        state: raw.state || null,
        pincode: raw.pincode || null,
        country: raw.country || "India",
        is80GEligible: boolish(raw.is80GEligible) ?? true,
        isFcraEligible: boolish(raw.isFcraEligible) ?? false,
        isCsrDonor: boolish(raw.isCsrDonor) ?? false,
        csrCompanyCin: raw.csrCompanyCin || null,
        whatsappOptIn: true,
        tags: [],
        internalNotes: raw.internalNotes || null,
      };
      const result = donorSchema.safeParse(candidate);
      if (result.success) {
        return {
          rowNumber: idx + 1,
          raw,
          ok: true,
          errors: [],
          parsed: result.data,
        };
      }
      const issues = result.error.issues.map((i) => {
        const path = i.path.join(".");
        return path ? `${path}: ${i.message}` : i.message;
      });
      return { rowNumber: idx + 1, raw, ok: false, errors: issues };
    });

    return {
      report: {
        total: rows.length,
        okCount: rows.filter((r) => r.ok).length,
        errorCount: rows.filter((r) => !r.ok).length,
        unknownColumns: unknown,
        rows,
      } satisfies PreviewReport,
    };
  });

export const commitImport = safeAction
  .metadata({ requires: "donor.import" })
  .inputSchema(z.object({ csvText: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    // Re-validate server-side using the same path as preview (never trust
    // the client to send pre-validated rows — replay validation on commit).
    const preview = parseCsv(parsedInput.csvText);
    const normalisedObjects = rowsToObjects(preview);
    const knownLower = new Set(HEADERS.map((h) => h.toLowerCase()));
    void knownLower;

    let created = 0;
    let skippedDuplicate = 0;
    let failed = 0;
    const failures: { rowNumber: number; reason: string }[] = [];

    for (let i = 0; i < normalisedObjects.length; i += 1) {
      const raw = normalisedObjects[i];
      const boolish = (v: string | undefined): boolean | undefined => {
        if (v === undefined || v === "") return undefined;
        const lo = v.toLowerCase();
        if (["true", "yes", "y", "1"].includes(lo)) return true;
        if (["false", "no", "n", "0"].includes(lo)) return false;
        return undefined;
      };
      // Match case-insensitively against canonical headers
      const get = (col: string): string => {
        for (const k of Object.keys(raw)) {
          if (k.toLowerCase() === col.toLowerCase()) return raw[k];
        }
        return "";
      };
      const candidate = {
        donorType: get("donorType"),
        name: get("name"),
        pan: get("pan") || null,
        phone: get("phone") || null,
        whatsapp: get("whatsapp") || null,
        email: get("email") || null,
        addressLine1: get("addressLine1") || null,
        addressLine2: get("addressLine2") || null,
        city: get("city") || null,
        district: get("district") || null,
        state: get("state") || null,
        pincode: get("pincode") || null,
        country: get("country") || "India",
        is80GEligible: boolish(get("is80GEligible")) ?? true,
        isFcraEligible: boolish(get("isFcraEligible")) ?? false,
        isCsrDonor: boolish(get("isCsrDonor")) ?? false,
        csrCompanyCin: get("csrCompanyCin") || null,
        whatsappOptIn: true,
        tags: [],
        internalNotes: get("internalNotes") || null,
      };
      const parsed = donorSchema.safeParse(candidate);
      if (!parsed.success) {
        failed += 1;
        failures.push({
          rowNumber: i + 1,
          reason: parsed.error.issues[0]?.message ?? "validation failed",
        });
        continue;
      }
      try {
        await prisma.donor.create({
          data: { ...parsed.data, createdById: ctx.scope.userId } as never,
        });
        created += 1;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          skippedDuplicate += 1;
        } else {
          failed += 1;
          failures.push({
            rowNumber: i + 1,
            reason: (err as Error).message,
          });
        }
      }
    }
    revalidatePath("/donors");
    return {
      created,
      skippedDuplicate,
      failed,
      failures,
    };
  });
