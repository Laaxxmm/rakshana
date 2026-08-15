import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The file endpoint is the one place bytes leave the app, and the only thing
 * standing between a caller and another trust's trust deed is the comparison
 * between the session's organisation and the `org/{orgId}/` segment of the key.
 *
 * Two things are proved here: a file written through the storage adapter comes
 * back through the route byte-for-byte, and a key naming another organisation
 * is refused even though the bytes exist and the caller is signed in.
 *
 * The storage singleton is the real one (`STORAGE_BACKEND=local` in .env, so a
 * temp directory of its own here) — a mocked adapter would prove the route
 * calls it, not that the round trip works.
 */

const scope = vi.fn();
vi.mock("@/lib/auth/scope", () => ({
  getOrgScope: scope,
  requireOrgScope: async () => {
    const v = await scope();
    if (!v) throw new Error("Authentication required");
    return v;
  },
}));

const { mkdtemp, rm } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const path = await import("node:path");

const root = await mkdtemp(path.join(tmpdir(), "rakshana-files-"));
const { LocalFsAdapter } = await import("@/lib/storage/local-fs-adapter");
const adapter = new LocalFsAdapter(root);
vi.mock("@/lib/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/storage")>();
  return { ...original, storage: adapter };
});

const { GET } = await import("./route");

const ORG_A = "test-org-files-a";
const ORG_B = "test-org-files-b";
const BYTES = Buffer.from("%PDF-1.4 trust deed of the other trust");

function scopeFor(organisationId: string) {
  return {
    userId: "test-user-files",
    organisationId,
    organisationName: "Test Trust",
    role: "OWNER" as const,
  };
}

/** The route takes its key as the catch-all segments, exactly as Next passes them. */
function get(key: string) {
  return GET(new Request(`http://localhost/api/files/${key}`), {
    params: Promise.resolve({ key: key.split("/") }),
  });
}

const VICTIM_KEY = `org/${ORG_B}/documents/deed-1.pdf`;

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  scope.mockReset();
  scope.mockResolvedValue(scopeFor(ORG_A));
});

describe("/api/files", () => {
  it("round-trips a file the caller's own organisation owns", async () => {
    const key = `org/${ORG_A}/documents/deed-own.pdf`;
    await adapter.put(key, BYTES, { contentType: "application/pdf", size: BYTES.length });

    const res = await get(key);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES)).toBe(true);
  });

  it("refuses a key naming another organisation, and streams nothing", async () => {
    await adapter.put(VICTIM_KEY, BYTES, {
      contentType: "application/pdf",
      size: BYTES.length,
    });

    const res = await get(VICTIM_KEY);

    expect(res.status).toBe(404);
    // Not 403: the answer must not tell the caller the file is there.
    const body = await res.text();
    expect(body).toBe("Not found");
    expect(body).not.toContain(ORG_B);
  });

  it("refuses when there is no session at all", async () => {
    scope.mockResolvedValue(null);
    const res = await get(`org/${ORG_A}/documents/deed-own.pdf`);
    expect(res.status).toBe(401);
  });

  it("refuses a key that climbs out of its organisation prefix", async () => {
    const res = await get(`org/${ORG_A}/../${ORG_B}/documents/deed-1.pdf`);
    expect(res.status).not.toBe(200);
  });
});
