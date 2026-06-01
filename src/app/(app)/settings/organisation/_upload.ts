"use client";

/**
 * Browser-side file → base64 helper, shared by every upload form.
 * Yes, base64 is wasteful (~33% bloat), but for ≤10 MB docs it's the
 * simplest way to send a binary through a Server Action's typed input.
 * Phase 2 will switch to multipart-form uploads via a dedicated route
 * handler if doc sizes grow.
 */
export async function fileToActionPayload(file: File): Promise<{
  fileBytes: string;
  filename: string;
  claimedMime: string;
}> {
  const buf = await file.arrayBuffer();
  // btoa with TypedArray chunks
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return {
    fileBytes: btoa(binary),
    filename: file.name,
    claimedMime: file.type || "application/octet-stream",
  };
}
