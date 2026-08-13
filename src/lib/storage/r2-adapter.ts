import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { StorageAdapter, StorageKey, PutOptions, PutResult } from "./types";
import { fileUrl } from "./keys";

const REQUIRED_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
] as const;

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

let cached: { client: S3Client; bucket: string } | undefined;

/**
 * Built on first use, not at import time: the app must boot with
 * STORAGE_BACKEND=local and zero R2 vars set.
 */
function connection(): { client: S3Client; bucket: string } {
  if (cached) return cached;

  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[storage] STORAGE_BACKEND=r2 but missing env: ${missing.join(", ")}. ` +
        `Set ${missing.join(" and ")} in the deploy environment, or use STORAGE_BACKEND=local.`,
    );
  }

  cached = {
    client: new S3Client({
      region: "auto",
      endpoint: `https://${process.env["R2_ACCOUNT_ID"]}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env["R2_ACCESS_KEY_ID"] as string,
        secretAccessKey: process.env["R2_SECRET_ACCESS_KEY"] as string,
      },
    }),
    bucket: process.env["R2_BUCKET_NAME"] as string,
  };
  return cached;
}

/** R2 returns NoSuchKey for GET and a bare 404 (NotFound) for HEAD. */
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

/**
 * Cloudflare R2 adapter (S3-compatible). Behaviour matches LocalFsAdapter so
 * callers cannot tell the two apart — same keys, same return shapes, missing
 * object reads as `null` rather than throwing.
 *
 * Content-type rides along as native S3 object metadata; the local adapter's
 * `.meta.json` sidecar has no equivalent here and is not written.
 *
 * Reads stay proxied through `/api/files/[...]` so the org-scope check runs —
 * no public bucket URLs, no presigned links.
 */
export class R2Adapter implements StorageAdapter {
  readonly name = "r2";

  private objectKey(key: StorageKey): string {
    // Defence-in-depth: reject path traversal attempts.
    const safe = key.replace(/\\/g, "/").replace(/^\/+/, "");
    if (safe.includes("..")) {
      throw new Error(`[storage] rejected unsafe key: ${key}`);
    }
    return safe;
  }

  async put(key: StorageKey, data: Buffer, opts: PutOptions): Promise<PutResult> {
    const { client, bucket } = connection();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: this.objectKey(key),
        Body: data,
        ContentType: opts.contentType,
        ContentLength: data.length,
      }),
    );
    return {
      url: fileUrl(key),
      key,
      size: data.length,
      contentType: opts.contentType,
    };
  }

  async get(
    key: StorageKey,
  ): Promise<{ stream: ReadableStream; contentType: string; size: number } | null> {
    const { client, bucket } = connection();
    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: this.objectKey(key) }),
      );
      if (!res.Body) return null;
      return {
        stream: res.Body.transformToWebStream() as unknown as ReadableStream,
        contentType: res.ContentType ?? DEFAULT_CONTENT_TYPE,
        size: res.ContentLength ?? 0,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async remove(key: StorageKey): Promise<void> {
    const { client, bucket } = connection();
    // S3 delete is idempotent — deleting an absent key is a no-op, same as
    // the local adapter's `fs.rm(..., { force: true })`.
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: this.objectKey(key) }));
  }

  async stat(key: StorageKey): Promise<{ size: number; contentType: string } | null> {
    const { client, bucket } = connection();
    try {
      const res = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: this.objectKey(key) }),
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType ?? DEFAULT_CONTENT_TYPE,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

/** Test-only: drop the cached client so env changes take effect. */
export function __resetR2ClientForTests(): void {
  cached = undefined;
}
