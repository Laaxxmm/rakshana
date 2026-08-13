import sharp from "sharp";
import { detectMimeByBytes, type AllowedMime } from "@/lib/storage/validate";

/**
 * Bill-image compression.
 *
 * The trust files 60-80 bill photos a month. Raw phone photos are 3-6 MB,
 * which is ~5 GB a year of storage nobody will ever page through. WebP at
 * q82 with a 2000px longest edge lands the same bill at 200-400 KB and is
 * still legible enough for an auditor to read the printed numbers off a
 * print-out — that legibility is the floor, so neither constant may drop.
 *
 * PDFs are never rasterised: a scanned PDF bill is already the artefact the
 * auditor wants, and re-rendering it would lose its text layer.
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

export type CompressedUpload = {
  buffer: Buffer;
  contentType: AllowedMime;
  originalSize: number;
  compressedSize: number;
};

/**
 * Normalise an uploaded bill for storage. MIME comes from the magic bytes,
 * never from the caller — see `@/lib/storage/validate`.
 */
export async function compressBill(input: Buffer): Promise<CompressedUpload> {
  const mime = detectMimeByBytes(input);
  if (!mime) throw new Error("Unrecognised file — expected a PDF, JPEG, PNG or WebP bill.");
  if (mime === "application/pdf") return unchanged(input, mime);

  const { width = 0, height = 0 } = await sharp(input).metadata();
  const pixels = width * height;
  if (pixels <= 0) throw new Error("Could not read the image dimensions.");
  if (pixels > MAX_PIXELS) {
    throw new Error(
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

function unchanged(input: Buffer, contentType: AllowedMime): CompressedUpload {
  return {
    buffer: input,
    contentType,
    originalSize: input.length,
    compressedSize: input.length,
  };
}
