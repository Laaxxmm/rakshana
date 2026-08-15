/**
 * Upload size limits and the wording used to refuse an oversized file.
 *
 * Shared by the browser (`src/components/patterns/file-upload.tsx`) and the
 * server (`compressBill` in ./compress.ts) so a file refused before the
 * request is refused with the same sentence as one refused after it.
 *
 * Nothing here may import sharp or anything else Node-only: this module is
 * bundled into a client component.
 */

/**
 * Ceiling for a PDF bill, checked on the raw upload.
 *
 * Unlike a photo, a PDF is only shrunk when ghostscript is available and its
 * output is smaller — `compressPdf` in ./compress.ts stores the upload itself
 * otherwise — so this is the real worst case for what the trust pays to keep
 * forever. 2 MB fits a multi-page scan at 200 DPI grayscale, which is what
 * every scanner app produces on its default setting.
 */
export const PDF_MAX_BYTES = 2 * 1024 * 1024;

/** "512 KB", "1.4 MB" — the units a person would use out loud. */
export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Refusal text for an oversized upload. Always names both numbers — "too
 * large" alone leaves the user guessing how much they have to save.
 *
 * `subject` is the filename in the browser (where it is known) and the file
 * type on the server (where `compressBill` receives bytes and nothing else).
 */
export function tooLargeMessage(subject: string, size: number, limit: number): string {
  return `${subject} is ${humanBytes(size)} — the limit is ${humanBytes(limit)}.`;
}
