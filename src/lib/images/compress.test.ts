import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { compressBill, MAX_EDGE } from "./compress";

// Fixtures are generated here rather than committed — a binary blob in git is
// a blob nobody can review.
function photo(width: number, height: number) {
  // Noise, not flat colour: a flat image compresses to nothing and would make
  // the "gets smaller" assertion meaningless.
  const px = Buffer.alloc(width * height * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37) % 251;
  return sharp(px, { raw: { width, height, channels: 3 } });
}

describe("compressBill", () => {
  it("converts a JPEG to WebP and shrinks it", async () => {
    const jpeg = await photo(1200, 900).jpeg({ quality: 95 }).toBuffer();
    const out = await compressBill(jpeg);

    expect(out.contentType).toBe("image/webp");
    expect(out.compressedSize).toBeLessThan(out.originalSize);
    expect(out.originalSize).toBe(jpeg.length);
    expect((await sharp(out.buffer).metadata()).format).toBe("webp");
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

  it("passes a PDF through byte-identical", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n", "latin1");
    const out = await compressBill(pdf);

    expect(out.contentType).toBe("application/pdf");
    expect(out.buffer.equals(pdf)).toBe(true);
    expect(out.compressedSize).toBe(pdf.length);
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
