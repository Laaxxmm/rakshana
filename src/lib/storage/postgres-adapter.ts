import { prismaUnsafe } from "@/lib/db/prisma";
import type { StorageAdapter, StorageKey, PutOptions, PutResult } from "./types";
import { fileUrl, normaliseKey, orgIdFromKey } from "./keys";

/**
 * Storage backed by the `StorageObject` table.
 *
 * This is the default backend, and the only one that survives a deploy on a
 * platform with an ephemeral filesystem. Anything the app writes to disk in
 * a container is discarded when that container is replaced; 80G receipts are
 * issued once and must still be readable years later, so they go where the
 * donor rows already are.
 *
 * Tenancy: `prismaUnsafe` is deliberate. `put` is reached from the Razorpay
 * webhook — via generate80GReceipt in src/lib/pdf/receipt-80g.ts — which has
 * no session, so the scoped client would throw. The tenant is not taken from
 * a session here: it is `orgIdFromKey`, the orgId segment of the key, and
 * keys are built server-side by ./keys.ts from an orgId the caller already
 * holds. The one path where the key is client-supplied is
 * /api/files/[...key], which compares that same segment against the session
 * and 404s on a mismatch before calling `get`.
 *
 * Objects are read whole rather than streamed out of the row. Every upload
 * path caps its bytes before calling `put` — 15 MB for an expense bill, the
 * largest of them — and this trust generates on the order of 80 documents a
 * month. Chunked reads (`substring(data …)` over a cursor) would only be
 * worth writing if either of those changed.
 */
export class PostgresAdapter implements StorageAdapter {
  readonly name = "postgres";

  async put(key: StorageKey, data: Buffer, opts: PutOptions): Promise<PutResult> {
    const safe = normaliseKey(key);
    const row = {
      organisationId: orgIdFromKey(safe),
      contentType: opts.contentType,
      size: data.length,
      // Prisma's Bytes input is a plain-ArrayBuffer Uint8Array; a Buffer can
      // be backed by a SharedArrayBuffer, which that type excludes.
      data: new Uint8Array(data),
    };
    await prismaUnsafe.storageObject.upsert({
      where: { key: safe },
      create: { key: safe, ...row },
      update: row,
    });
    return {
      url: fileUrl(safe),
      key: safe,
      size: data.length,
      contentType: opts.contentType,
    };
  }

  async get(
    key: StorageKey,
  ): Promise<{ stream: ReadableStream; contentType: string; size: number } | null> {
    const row = await prismaUnsafe.storageObject.findUnique({
      where: { key: normaliseKey(key) },
      select: { data: true, contentType: true, size: true },
    });
    if (!row) return null;
    return {
      stream: new Blob([row.data]).stream() as unknown as ReadableStream,
      contentType: row.contentType,
      size: row.size,
    };
  }

  async remove(key: StorageKey): Promise<void> {
    // Matches the other adapters: removing an absent key is a no-op, not an error.
    await prismaUnsafe.storageObject.deleteMany({ where: { key: normaliseKey(key) } });
  }

  async stat(key: StorageKey): Promise<{ size: number; contentType: string } | null> {
    const row = await prismaUnsafe.storageObject.findUnique({
      where: { key: normaliseKey(key) },
      select: { contentType: true, size: true },
    });
    return row ? { size: row.size, contentType: row.contentType } : null;
  }
}
