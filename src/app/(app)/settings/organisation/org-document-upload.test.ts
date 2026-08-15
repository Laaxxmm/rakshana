import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What `uploadOrgDocument` refuses, and what the person who picked the file is
 * told about it.
 *
 * A trust deed or an 80G certificate is stored byte-for-byte — see the
 * ORG_DOC_PDF_MAX comment in ./actions.ts — so the size cap is the only thing
 * standing between the bucket and a 40 MB colour scan, and the refusal is the
 * only instruction the uploader gets. Both have to survive production, where
 * `handleServerError` replaces every message that is not a `UserFacingError`.
 *
 * No database: the ceiling is checked before the first query, and the one test
 * that needs a query to fail gets a rejecting stub.
 */

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

const create = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: { orgDocument: { create, update } },
  prismaUnsafe: { storageObject: {} },
}));

const put = vi.fn();
vi.mock("@/lib/storage", () => ({
  storage: { put },
  storageKey: { orgDocument: () => "o-test/docs/x.pdf" },
}));

const { uploadOrgDocument } = await import("./actions");

/** A buffer that starts with the PDF magic bytes and is exactly `size` long. */
function pdfOf(size: number): Buffer {
  const buf = Buffer.alloc(size, 0x20);
  Buffer.from("%PDF-1.7\n").copy(buf);
  return buf;
}

const META = {
  category: "TRUST_DEED" as const,
  title: "Trust Deed (registered 2024)",
  issueDate: null,
  expiryDate: null,
  remarks: null,
};

function upload(buf: Buffer) {
  return uploadOrgDocument({
    ...META,
    fileBytes: buf.toString("base64"),
    filename: "trust-deed.pdf",
    claimedMime: "application/pdf",
  });
}

const MB = 1024 * 1024;

beforeEach(() => {
  create.mockReset();
  update.mockReset();
  put.mockReset();
  create.mockResolvedValue({ id: "doc-1" });
  update.mockResolvedValue({ id: "doc-1" });
  put.mockResolvedValue({ url: "/api/files/o-test/docs/x.pdf" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("uploadOrgDocument size ceiling", () => {
  it("refuses a PDF above the cap, naming what was sent and what fits", async () => {
    const result = await upload(pdfOf(6 * MB));

    expect(result.data).toBeUndefined();
    expect(result.serverError).toContain("6.0 MB");
    expect(result.serverError).toContain("5.0 MB");
    // Nothing was written: no row, no object in the bucket.
    expect(create).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("keeps that refusal legible in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const result = await upload(pdfOf(6 * MB));

    expect(result.serverError).toContain("6.0 MB");
    expect(result.serverError).toContain("5.0 MB");
    expect(result.serverError).not.toContain("Something went wrong");
  });

  it("stores a PDF at the cap without compressing it", async () => {
    const deed = pdfOf(5 * MB);

    const result = await upload(deed);

    expect(result.serverError).toBeUndefined();
    // The bytes that were uploaded are the bytes that are stored — this path
    // has no compression step, so the stored size is the uploaded size.
    const [, body, opts] = put.mock.calls[0]!;
    expect((body as Buffer).equals(deed)).toBe(true);
    expect(opts).toMatchObject({ contentType: "application/pdf", size: 5 * MB });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mimeType: "application/pdf", fileSize: 5 * MB }),
      }),
    );
  });

  it("still masks an unexpected failure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    create.mockRejectedValue(new Error('column "fileSize" does not exist'));

    const result = await upload(pdfOf(1 * MB));

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBe("Something went wrong. Please try again.");
    expect(result.serverError).not.toContain("fileSize");
  });
});

describe("browser and server ceilings", () => {
  // LegalDocsPanel cannot import the numbers: ./actions.ts is a "use server"
  // module, whose exports must all be async functions. A drift here is a user
  // waiting out an upload the action was always going to refuse.
  const read = (f: string) => readFileSync(path.join(import.meta.dirname, f), "utf8");
  const ceilings = (src: string) =>
    [...src.matchAll(/ORG_DOC(?:_PDF)?_MAX = ([^;]+);/g)].map((m) => m[1]);

  it("agree on both caps", () => {
    expect(ceilings(read("LegalDocsPanel.tsx"))).toEqual(ceilings(read("actions.ts")));
    expect(ceilings(read("actions.ts"))).toHaveLength(2);
  });
});
