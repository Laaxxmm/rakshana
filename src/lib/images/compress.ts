import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { UserFacingError } from "@/lib/actions/safe-action";
import { detectMimeByBytes, type AllowedMime } from "@/lib/storage/validate";
import { PDF_MAX_BYTES, tooLargeMessage } from "./limits";

/**
 * Bill compression: what the trust stores for a photo or PDF of a bill.
 *
 * The trust files 60-80 bill photos a month. Raw phone photos are 3-6 MB,
 * which is ~5 GB a year of storage nobody will ever page through. WebP at
 * q82 with a 2000px longest edge lands the same bill at 200-400 KB and is
 * still legible enough for an auditor to read the printed numbers off a
 * print-out — that legibility is the floor, so neither constant may drop.
 *
 * The encode is lossy on purpose. Lossless WebP of a phone photo is routinely
 * LARGER than the JPEG it came from — the camera already spent its loss budget
 * — so lossless would grow the archive rather than shrink it. At q82 the
 * difference is invisible at print size and the file is roughly a tenth of the
 * original. The WebP is the only copy kept: the source JPEG is not written
 * anywhere, because a second copy doubles the bucket for a file no auditor has
 * ever asked to see in its camera-original form.
 *
 * A PDF over PDF_TARGET_BYTES is re-distilled by ghostscript (see
 * `compressPdf`), on the same single-copy rule: what comes back is what is
 * stored, and the upload is capped at PDF_MAX_BYTES either way. Everything
 * about that step can fail — no ghostscript on the box, a PDF it will not
 * parse, output bigger than the input — and every one of those outcomes stores
 * the bytes that were uploaded.
 */

/** Longest edge, in pixels. Below this an auditor can't read a printed total. */
export const MAX_EDGE = 2000;
/** WebP quality. Below ~80 the numerals on thermal-printed bills smear. */
export const WEBP_QUALITY = 82;
/**
 * Decompression-bomb ceiling. A 12 KB PNG can declare 30000x30000 and make
 * sharp allocate gigabytes; we read the header first and refuse. 80 MP clears
 * every real phone camera (108 MP sensors bin down well below it in practice).
 */
export const MAX_PIXELS = 80_000_000;
/**
 * Size a PDF bill is squeezed towards. A PDF already under it is left alone —
 * re-distilling it would spend image quality to save nothing worth having.
 */
export const PDF_TARGET_BYTES = 500 * 1024;

export type CompressedUpload = {
  buffer: Buffer;
  contentType: AllowedMime;
  originalSize: number;
  compressedSize: number;
};

/**
 * Normalise an uploaded bill for storage. MIME comes from the magic bytes,
 * never from the caller — see `@/lib/storage/validate`.
 *
 * Refusals are `UserFacingError`s, which `handleServerError` in
 * `src/lib/actions/safe-action.ts` forwards to the client unmasked in
 * production — so each one names the numbers and the way out. This is the
 * enforcement boundary; the matching check in the upload component is what
 * saves the user the round trip. The only caller is `uploadExpenseBill` in
 * `src/app/(app)/expenses/actions.ts`.
 */
export async function compressBill(input: Buffer): Promise<CompressedUpload> {
  const mime = detectMimeByBytes(input);
  if (!mime) {
    throw new UserFacingError("Unrecognised file — expected a PDF, JPEG, PNG or WebP bill.");
  }
  if (mime === "application/pdf") {
    if (input.length > PDF_MAX_BYTES) {
      throw new UserFacingError(
        `${tooLargeMessage("PDF", input.length, PDF_MAX_BYTES)} Re-scan it in black-and-white or at a lower DPI, or photograph the bill instead — photos are compressed automatically.`,
      );
    }
    const buffer = await compressPdf(input);
    return {
      buffer,
      contentType: mime,
      originalSize: input.length,
      compressedSize: buffer.length,
    };
  }

  const { width = 0, height = 0 } = await sharp(input).metadata();
  const pixels = width * height;
  if (pixels <= 0) throw new UserFacingError("Could not read the image dimensions.");
  if (pixels > MAX_PIXELS) {
    throw new UserFacingError(
      `Image is ${Math.round(pixels / 1_000_000)} MP — refusing anything above ${MAX_PIXELS / 1_000_000} MP.`,
    );
  }

  // Already the target format and within the cap: re-encoding would only
  // throw away quality for no size win.
  if (mime === "image/webp" && Math.max(width, height) <= MAX_EDGE) {
    return unchanged(input, mime);
  }

  const buffer = await sharp(input, { limitInputPixels: MAX_PIXELS })
    // .rotate() with no argument bakes in the EXIF orientation flag. sharp
    // drops all metadata on output, so without this half the photos taken in
    // portrait would be stored sideways.
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  return {
    buffer,
    contentType: "image/webp",
    originalSize: input.length,
    compressedSize: buffer.length,
  };
}

const run = promisify(execFile);

/**
 * Re-distil a PDF at ghostscript's /ebook profile: images resampled to 150 dpi,
 * fonts subset and re-embedded, the text layer kept as text. A 1.8 MB scanned
 * bill typically lands around 300 KB.
 *
 * This is LOSSY. The embedded scan of a bill is downsampled, so the finest
 * print softens — the same trade the photo path makes at WEBP_QUALITY, and as
 * there, the compressed file is the only copy kept: this codebase stores no
 * pre-compression original for any bill, so /ebook is the floor for what an
 * auditor will ever see. Do not lower it.
 *
 * `input` comes back untouched whenever the compressed copy cannot be trusted:
 * ghostscript missing (it is in `nixpacks.toml` for the deployed image, and
 * routinely absent in local dev), a non-zero exit, a timeout, output that is
 * not a PDF, or output no smaller than what went in. A bill is the evidence
 * behind a payment — storing 2 MB is always better than losing it to a
 * compressor.
 */
async function compressPdf(input: Buffer): Promise<Buffer> {
  if (input.length <= PDF_TARGET_BYTES) return input;

  const dir = await mkdtemp(join(tmpdir(), "rakshana-pdf-"));
  const src = join(dir, "in.pdf");
  const out = join(dir, "out.pdf");
  try {
    await writeFile(src, input);
    // execFile, not exec: argv is handed to the process as an array, so no
    // filename is ever parsed by a shell. -dSAFER blocks the file operators a
    // hostile PDF could otherwise ask ghostscript to run for it.
    await run(
      process.env["GHOSTSCRIPT_BIN"] || "gs",
      [
        "-sDEVICE=pdfwrite",
        "-dPDFSETTINGS=/ebook",
        "-dCompatibilityLevel=1.4",
        "-dSAFER",
        "-dNOPAUSE",
        "-dBATCH",
        "-dQUIET",
        `-sOutputFile=${out}`,
        src,
      ],
      { timeout: 30_000 },
    );
    const compressed = await readFile(out);
    const usable =
      compressed.length < input.length &&
      detectMimeByBytes(compressed) === "application/pdf";
    return usable ? compressed : input;
  } catch {
    return input;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function unchanged(input: Buffer, contentType: AllowedMime): CompressedUpload {
  return {
    buffer: input,
    contentType,
    originalSize: input.length,
    compressedSize: input.length,
  };
}
