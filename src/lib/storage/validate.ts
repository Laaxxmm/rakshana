/**
 * Magic-byte validation for uploaded files.
 *
 * We never trust the browser-provided MIME header alone — a renamed `.exe`
 * happily declares itself `application/pdf`. Instead we peek at the actual
 * file bytes for a known signature, then compare to the claimed MIME.
 *
 * Coverage: PDF, JPEG, PNG, WebP. Add more as needed; centralise the table
 * here so every upload path uses the same check.
 */

export type AllowedMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

type Signature = {
  mime: AllowedMime;
  /** Each entry is a sequence of bytes to match at the given offset. */
  patterns: { offset: number; bytes: number[] }[];
};

const SIGNATURES: Signature[] = [
  // PDF: "%PDF-"
  { mime: "application/pdf", patterns: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }] },
  // JPEG: FF D8 FF
  { mime: "image/jpeg", patterns: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  {
    mime: "image/png",
    patterns: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  // WebP: "RIFF" .... "WEBP"
  {
    mime: "image/webp",
    patterns: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
];

function matches(buf: Buffer, sig: Signature): boolean {
  return sig.patterns.every((p) => {
    for (let i = 0; i < p.bytes.length; i++) {
      if (buf[p.offset + i] !== p.bytes[i]) return false;
    }
    return true;
  });
}

export function detectMimeByBytes(buf: Buffer): AllowedMime | null {
  for (const sig of SIGNATURES) {
    if (matches(buf, sig)) return sig.mime;
  }
  return null;
}

export type ValidateOptions = {
  /** Bytes. Default 10 MB. */
  maxSize?: number;
  allowed: AllowedMime[];
  /** The MIME header the browser claimed — only used to surface a mismatch
   *  in the error message; never trusted for the actual decision. */
  claimedMime?: string;
};

export type ValidationResult =
  | { ok: true; detectedMime: AllowedMime; size: number }
  | { ok: false; error: string };

export function validateUpload(buf: Buffer, opts: ValidateOptions): ValidationResult {
  const maxSize = opts.maxSize ?? 10 * 1024 * 1024;
  if (buf.length === 0) return { ok: false, error: "File is empty." };
  if (buf.length > maxSize) {
    return {
      ok: false,
      error: `File is ${(buf.length / 1024 / 1024).toFixed(1)} MB — maximum is ${Math.round(maxSize / 1024 / 1024)} MB.`,
    };
  }

  const detected = detectMimeByBytes(buf);
  if (!detected) {
    return {
      ok: false,
      error: `Couldn't recognise this file. Allowed: ${opts.allowed.join(", ")}.`,
    };
  }
  if (!opts.allowed.includes(detected)) {
    return {
      ok: false,
      error: `File type ${detected} is not allowed here. Allowed: ${opts.allowed.join(", ")}.`,
    };
  }
  if (opts.claimedMime && opts.claimedMime !== detected) {
    // Strict mismatch: the browser said one thing, the bytes say another.
    return {
      ok: false,
      error: `File header says "${opts.claimedMime}" but the bytes are ${detected}. Refusing for safety.`,
    };
  }
  return { ok: true, detectedMime: detected, size: buf.length };
}
