import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { vendorSchema } from "@/lib/schemas/vendor";

/**
 * What this file checks, exactly:
 *
 * 1. No source file under `src` names a GSTIN.
 * 2. No source file under `src` names GST at all, apart from the files in
 *    `DORMANT`, each of which names it because a table, column, enum value or
 *    permission key is called after it.
 * 3. Two paths that take a GST value from a caller refuse to store it:
 *    `vendorSchema` drops a `gstin`, and an org document upload refuses the
 *    `GST` category.
 *
 * The scan is the whole of `src` — every earlier version named a shorter list
 * of directories while claiming the whole app, and live GSTIN surfaces sat
 * outside the list both times. Compiling is no defence: a re-added
 * `<EditableField label="GSTIN" />` is a string, so neither tsc nor the build
 * would notice it. Comment-only lines are skipped; a comment renders nothing
 * to a trustee, and the dormant plumbing is where GST gets explained.
 *
 * Three things this deliberately does not claim.
 *
 * `prisma/` is outside the scan: `schema.prisma` keeps the GST tables and
 * `Vendor.gstin` so historical rows read back, and `prisma/seed.ts` still
 * writes a demo vendor with a GSTIN.
 *
 * A stored value is not unreachable. `OrgDocument.category` still accepts the
 * dormant `GST` enum value at the database, and the document detail page prints
 * `doc.category` verbatim, so a row filed under it before the module was
 * dropped still shows a "GST" badge. What the third group asserts is only that
 * no new such row can be created through the app.
 *
 * And one write path is still open: `expenseSchema` accepts `gstApplicable`,
 * `gstRate` and `isItcEligible`, and `submitExpense` stores the resulting
 * cgst/sgst/igst on the Expense row. No form sends those fields, but a Server
 * Action is an HTTP endpoint and a payload that names them is honoured. The
 * voucher prints no split (`src/lib/pdf/voucher.test.ts`), so nothing renders
 * it — but "dormant" below means unrendered, not unwritable.
 */

const SRC = path.join(process.cwd(), "src");

const SCANNED = [SRC];

// The action import below needs a session, a database and a bucket; the last
// group of tests never reaches a real one. `create` and `put` are asserted
// against, so a refusal that still wrote something would be caught.
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth/scope", () => ({
  requireOrgScope: async () => ({
    userId: "u-test",
    organisationId: "o-test",
    organisationName: "Test Trust",
    role: "OWNER" as const,
  }),
}));
const create = vi.fn(async () => ({ id: "doc-1" }));
const update = vi.fn(async () => ({ id: "doc-1" }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { orgDocument: { create, update } },
  prismaUnsafe: {},
}));
const put = vi.fn(async () => ({ url: "/api/files/o-test/docs/x.png" }));
vi.mock("@/lib/storage", () => ({
  storage: { put },
  storageKey: { orgDocument: () => "o-test/docs/x.png" },
}));

const { uploadOrgDocument } = await import("./actions");

/**
 * Files that still name GST because a dormant table, column, enum value or
 * permission key is named after it. None of them renders GST to a user; each
 * is listed with what keeps the name alive. A new GST surface lands outside
 * this map and fails the scan.
 *
 * This map governs the broad scan only. The GSTIN scan below admits nothing.
 */
const DORMANT: Record<string, string> = {
  "app/(app)/page.tsx": 'excludes category "GST" from the dashboard compliance list',
  "app/(app)/compliance/calendar/page.tsx": 'excludes category "GST" from the calendar',
  "app/(app)/notifications/page.tsx": "maps the dormant GstRegistration model name to a tab",
  "app/(app)/expenses/actions.ts":
    "stores cgst/sgst/igst on the Expense row whenever a payload sets gstApplicable — the open write path named above",
  "app/(app)/settings/organisation/actions.ts":
    'names the dormant "GST" document category in order to refuse it; the refusal is asserted below rather than taken on trust',
  "lib/auth/permissions.ts": "gst.* permission keys, checked by no route",
  "lib/compliance/expiry.ts": 'ComplianceCategory includes the "GST" enum value',
  "lib/constants/tax.ts": "GST_RATES, read only by the dormant expense fields",
  "lib/db/scoped-models.ts": "Prisma model names of the dormant GST tables",
  "lib/pdf/receipt-80g.ts": "includes the dormant gstRegistration relation",
  "lib/schemas/expense.ts": "dormant gstApplicable/gstRate inputs, sent by no form",
  "lib/schemas/organisation.ts": 'OrgDocumentCategory includes the stored "GST" value',
  "lib/services/tax-calc.ts": "computeGst, called only from the dormant expense path",
  "lib/storage/keys.ts": "gstrExport key builder, called by no export",
};

/** Source files under `target`, tests excluded — a test may name GST to assert its absence. */
function sourceFiles(target: string, out: string[] = []): string[] {
  if (!statSync(target).isDirectory()) {
    out.push(target);
    return out;
  }
  for (const entry of readdirSync(target)) {
    const p = path.join(target, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/** `src`-relative, forward-slashed — the shape `DORMANT` is keyed by. */
function rel(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/");
}

/** Every scanned line that matches, minus comment-only lines, as "path:line: text". */
function scan(re: RegExp, skip: (file: string) => boolean = () => false): string[] {
  const hits: string[] = [];
  for (const target of SCANNED) {
    for (const file of sourceFiles(target)) {
      if (skip(file)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const text = line.trim();
          if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) return;
          if (re.test(line)) hits.push(`${rel(file)}:${i + 1}: ${text}`);
        });
    }
  }
  return hits;
}

describe("GST has no surface left", () => {
  it("names no GSTIN anywhere in src", () => {
    // Any casing of the five letters, as long as a lowercase letter does not
    // follow: that covers the column (`gstin: true`), the filter, the label
    // ("GSTIN"), `GSTIN_RE` and `gstinSchema`, and excludes the dormant
    // `GstInvoice` / `GstInput`, whose "GstIn" is Gst + In. Spelling the
    // prefix out is what lets the lookahead stay case-sensitive.
    expect(scan(/[Gg][Ss][Tt][Ii][Nn](?![a-z])/)).toEqual([]);
  });

  it("mentions GST only where a dormant table, column or key is named after it", () => {
    // Anchored on a word start so `filingStatus` ("…ngSt…") is not a hit.
    expect(scan(/\b(gst\w*|cgst|sgst|igst|itc)\b/i, (f) => rel(f) in DORMANT)).toEqual([]);
  });

  it("drops a GSTIN handed to the vendor schema instead of storing it", () => {
    const parsed = vendorSchema.parse({ name: "Acme Supplies", gstin: "29ABCDE1234F1Z5" });
    expect(parsed).not.toHaveProperty("gstin");
  });
});

/**
 * The one GST value a caller could still get stored: `OrgDocumentCategory` in
 * Prisma keeps `GST`, and `uploadOrgDocument` is an HTTP endpoint that reads
 * `category` off the payload. `LegalDocsPanel` offers five categories and GST
 * is not one of them, so a browser cannot send it — which is exactly why a
 * source scan cannot see the hole, and why the refusal is exercised here
 * rather than read off the schema.
 *
 * A category the panel does offer runs through the same call to prove the
 * refusal is about the value and not about a malformed payload.
 */
describe("uploadOrgDocument and the dormant GST category", () => {
  const META = {
    title: "Filed before the GST module was dropped",
    issueDate: null,
    expiryDate: null,
    remarks: null,
    filename: "certificate.png",
    claimedMime: "image/png",
    // 1x1 PNG — `validateUpload` reads the magic bytes, so a stub will not do.
    fileBytes:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  };

  /** The type forbids "GST"; HTTP does not. That gap is what is under test. */
  const upload = (category: string) =>
    uploadOrgDocument({ ...META, category } as Parameters<typeof uploadOrgDocument>[0]);

  it("refuses a document filed under GST, storing neither row nor file", async () => {
    create.mockClear();
    put.mockClear();

    const result = await upload("GST");

    expect(result.validationErrors).toBeDefined();
    expect(result.data).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("accepts a category the panel offers, on the same call", async () => {
    create.mockClear();
    put.mockClear();

    const result = await upload("TRUST_DEED");

    expect(result.validationErrors).toBeUndefined();
    expect(result.data).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
  });
});
