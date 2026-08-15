import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// compressBill throws UserFacingError, which lives in the server-action module;
// importing that pulls in next-auth, which does not load under vitest.
vi.mock("@/auth", () => ({ auth: async () => null }));

const { compressBill, MAX_EDGE, PDF_TARGET_BYTES } = await import("./compress");
const { handleServerError, UserFacingError } = await import("@/lib/actions/safe-action");
const { PDF_MAX_BYTES } = await import("./limits");
const { storageKey } = await import("@/lib/storage/keys");
const { parseISTInput } = await import("@/lib/format/date");

/** A `gs` that does not exist, so `compressPdf` takes its ENOENT path. */
const NO_GHOSTSCRIPT = join(tmpdir(), "rakshana-no-such-ghostscript");

const scratchDirs: string[] = [];

/**
 * A stand-in `gs` binary running `body`, so the compression branches can be
 * asserted on a machine with no ghostscript and without depending on how well
 * a real one happens to squeeze a given fixture.
 */
async function fakeGhostscript(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rakshana-gs-fake-"));
  scratchDirs.push(dir);
  const bin = join(dir, "gs.cjs");
  await writeFile(bin, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  return bin;
}

// Reads the path out of ghostscript's own `-sOutputFile=<path>` argument
// (13 characters of prefix), the way the real binary does.
const FAKE_GS_PREAMBLE = `
const fs = require("node:fs");
const out = process.argv.find((a) => a.startsWith("-sOutputFile=")).slice(13);
`;

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await Promise.all(scratchDirs.map((d) => rm(d, { recursive: true, force: true })));
});

// Fixtures are generated here rather than committed — a binary blob in git is
// a blob nobody can review.
function photo(width: number, height: number) {
  // Noise, not flat colour: a flat image compresses to nothing and would make
  // the "gets smaller" assertion meaningless.
  const px = Buffer.alloc(width * height * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37) % 251;
  return sharp(px, { raw: { width, height, channels: 3 } });
}

/**
 * A PDF of a given total size. Only the "%PDF-" signature is inspected, so
 * the padding stands in for the embedded scan that makes a real bill heavy.
 */
function pdf(totalBytes?: number) {
  const doc = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n", "latin1");
  if (totalBytes === undefined) return doc;
  return Buffer.concat([doc, Buffer.alloc(totalBytes - doc.length, 0x20)]);
}

describe("compressBill", () => {
  it("converts a JPEG to WebP and shrinks it, keeping its dimensions", async () => {
    const jpeg = await photo(1200, 900).jpeg({ quality: 95 }).toBuffer();
    const out = await compressBill(jpeg);

    expect(out.contentType).toBe("image/webp");
    expect(out.compressedSize).toBeLessThan(out.originalSize);
    expect(out.originalSize).toBe(jpeg.length);

    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe("webp");
    // Under MAX_EDGE, so nothing is resized — cropping a bill loses the
    // corner the invoice number is printed in.
    expect([meta.width, meta.height]).toEqual([1200, 900]);
  });

  it("caps the longest edge at 2000px", async () => {
    const big = await photo(4032, 3024).jpeg().toBuffer();
    const meta = await sharp((await compressBill(big)).buffer).metadata();

    expect(Math.max(meta.width!, meta.height!)).toBe(MAX_EDGE);
    // Aspect ratio preserved — a squashed bill is an unreadable bill.
    expect(meta.height).toBe(Math.round((MAX_EDGE * 3024) / 4032));
  });

  it("leaves a small WebP alone", async () => {
    const webp = await photo(800, 600).webp().toBuffer();
    const out = await compressBill(webp);

    expect(out.buffer.equals(webp)).toBe(true);
    expect(out.contentType).toBe("image/webp");
  });

  it("leaves a PDF already under the target untouched", async () => {
    const out = await compressBill(pdf());

    expect(out.contentType).toBe("application/pdf");
    expect(out.buffer.equals(pdf())).toBe(true);
    expect(out.compressedSize).toBe(pdf().length);
  });

  it("rejects a 3 MB PDF, naming both the limit and the file's size", async () => {
    const err = await compressBill(pdf(3 * 1024 * 1024)).catch((e: Error) => e.message);

    expect(err).toContain("3.0 MB");
    expect(err).toContain("2.0 MB");
    // The user has to be told what to do about it, not just that it failed.
    expect(err).toMatch(/re-scan/i);
  });

  it("accepts a PDF right on the limit", async () => {
    vi.stubEnv("GHOSTSCRIPT_BIN", NO_GHOSTSCRIPT);
    const out = await compressBill(pdf(PDF_MAX_BYTES));
    expect(out.contentType).toBe("application/pdf");
    expect(out.compressedSize).toBe(PDF_MAX_BYTES);
  });

  it("files an accepted PDF under the month of its expense", async () => {
    const out = await compressBill(pdf());
    const key = storageKey.expenseBill(
      "org1",
      parseISTInput("01/03/2027"),
      "att1",
      out.contentType,
    );

    expect(key).toBe("org/org1/bills/2027/03/att1.pdf");
  });

  it("applies the EXIF orientation before stripping it", async () => {
    // Orientation 6 = rotate 90° clockwise on display, so a stored 600x400
    // frame is really a 400x600 portrait photo.
    const sideways = await photo(600, 400)
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(sideways).metadata()).orientation).toBe(6);

    const meta = await sharp((await compressBill(sideways)).buffer).metadata();
    expect([meta.width, meta.height]).toEqual([400, 600]);
    expect(meta.exif).toBeUndefined();
  });

  it("refuses a file it cannot identify", async () => {
    await expect(compressBill(Buffer.from("not a bill"))).rejects.toThrow(/Unrecognised/);
  });
});

describe("PDF compression", () => {
  /** Over PDF_TARGET_BYTES, so `compressPdf` actually runs, and under the cap. */
  const oversized = () => pdf(PDF_TARGET_BYTES + 100 * 1024);

  it("stores what ghostscript hands back when it is smaller", async () => {
    vi.stubEnv(
      "GHOSTSCRIPT_BIN",
      await fakeGhostscript(
        `${FAKE_GS_PREAMBLE}
         fs.writeFileSync(out, Buffer.concat([Buffer.from("%PDF-1.4\\n"), Buffer.alloc(4096, 0x20)]));`,
      ),
    );

    const input = oversized();
    const out = await compressBill(input);

    expect(out.contentType).toBe("application/pdf");
    expect(out.originalSize).toBe(input.length);
    expect(out.compressedSize).toBeLessThan(input.length);
    expect(out.buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("keeps the upload when ghostscript is not installed", async () => {
    vi.stubEnv("GHOSTSCRIPT_BIN", NO_GHOSTSCRIPT);

    const input = oversized();
    const out = await compressBill(input);

    // Degrade, never fail: local dev has no `gs` and the bill still has to file.
    expect(out.buffer.equals(input)).toBe(true);
    expect(out.compressedSize).toBe(input.length);
  });

  it("keeps the upload when ghostscript exits non-zero", async () => {
    vi.stubEnv("GHOSTSCRIPT_BIN", await fakeGhostscript("process.exit(1);"));

    const input = oversized();
    expect((await compressBill(input)).buffer.equals(input)).toBe(true);
  });

  it("keeps the upload when the compressed copy comes back larger", async () => {
    vi.stubEnv(
      "GHOSTSCRIPT_BIN",
      await fakeGhostscript(
        `${FAKE_GS_PREAMBLE}
         fs.writeFileSync(out, Buffer.concat([Buffer.from("%PDF-1.4\\n"), Buffer.alloc(4 * 1024 * 1024, 0x20)]));`,
      ),
    );

    const input = oversized();
    expect((await compressBill(input)).buffer.equals(input)).toBe(true);
  });

  it("keeps the upload when the output is not a PDF", async () => {
    vi.stubEnv(
      "GHOSTSCRIPT_BIN",
      await fakeGhostscript(`${FAKE_GS_PREAMBLE}\nfs.writeFileSync(out, "truncated");`),
    );

    const input = oversized();
    expect((await compressBill(input)).buffer.equals(input)).toBe(true);
  });
});

/**
 * The refusal is only worth its wording if the user is the one who reads it.
 * `handleServerError` is what decides that, so the two are asserted together.
 */
describe("what an upload refusal looks like in production", () => {
  async function refusalFor(input: Buffer): Promise<Error> {
    return compressBill(input).then(
      () => {
        throw new Error("expected compressBill to refuse");
      },
      (e: Error) => e,
    );
  }

  it("sends the oversized-PDF message through unmasked", async () => {
    const err = await refusalFor(pdf(3 * 1024 * 1024));
    expect(err).toBeInstanceOf(UserFacingError);

    vi.stubEnv("NODE_ENV", "production");
    const shown = handleServerError(err);

    expect(shown).toContain("3.0 MB");
    expect(shown).toContain("2.0 MB");
    expect(shown).toMatch(/re-scan/i);
  });

  it("still masks an unexpected failure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const shown = handleServerError(
      new Error("Invalid `prisma.expenseAttachment.create()`: connect ECONNREFUSED 10.0.0.4:5432"),
    );

    expect(shown).toBe("Something went wrong. Please try again.");
    expect(shown).not.toContain("prisma");
    expect(shown).not.toContain("5432");
  });

  it("shows a developer the raw message outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(handleServerError(new Error("connect ECONNREFUSED"))).toBe("connect ECONNREFUSED");
  });
});
