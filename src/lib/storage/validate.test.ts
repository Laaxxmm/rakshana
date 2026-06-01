import { describe, expect, it } from "vitest";
import { validateUpload, detectMimeByBytes } from "./validate";

const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const EXE_HEADER = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]); // "MZ" — Windows PE
const RENAMED_EXE_PRETENDING_PDF_LABEL = "application/pdf";

describe("detectMimeByBytes", () => {
  it("recognises PDF", () => {
    expect(detectMimeByBytes(PDF_HEADER)).toBe("application/pdf");
  });
  it("recognises PNG", () => {
    expect(detectMimeByBytes(PNG_HEADER)).toBe("image/png");
  });
  it("recognises JPEG", () => {
    expect(detectMimeByBytes(JPEG_HEADER)).toBe("image/jpeg");
  });
  it("returns null for an exe", () => {
    expect(detectMimeByBytes(EXE_HEADER)).toBeNull();
  });
});

describe("validateUpload", () => {
  it("accepts a real PDF when claimedMime matches", () => {
    const r = validateUpload(PDF_HEADER, {
      allowed: ["application/pdf"],
      claimedMime: "application/pdf",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a renamed .exe even when claimedMime says PDF", () => {
    const r = validateUpload(EXE_HEADER, {
      allowed: ["application/pdf"],
      claimedMime: RENAMED_EXE_PRETENDING_PDF_LABEL,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/recognise/i);
    }
  });

  it("rejects when claimed MIME diverges from bytes", () => {
    // Real PNG bytes but claimed as PDF
    const r = validateUpload(PNG_HEADER, {
      allowed: ["application/pdf", "image/png"],
      claimedMime: "application/pdf",
    });
    expect(r.ok).toBe(false);
  });

  it("enforces size limit", () => {
    const big = Buffer.concat([PDF_HEADER, Buffer.alloc(11 * 1024 * 1024)]);
    const r = validateUpload(big, {
      allowed: ["application/pdf"],
      maxSize: 10 * 1024 * 1024,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty file", () => {
    const r = validateUpload(Buffer.alloc(0), { allowed: ["application/pdf"] });
    expect(r.ok).toBe(false);
  });
});
