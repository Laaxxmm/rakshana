import { promises as fs, createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { StorageAdapter, StorageKey, PutOptions, PutResult } from "./types";
import { fileUrl } from "./keys";

const META_SUFFIX = ".meta.json";

/**
 * Local filesystem adapter. Used for dev + tests + CI. Files live under
 * `<repo>/.uploads/<key>`. Content-type is persisted alongside as a small
 * `.meta.json` file so reads can return the right MIME without sniffing.
 *
 * Out of scope for this adapter:
 *  - Signed URLs (we use a session-checked API route instead)
 *  - Replication / object lifecycle
 *  - Concurrency control (last-write-wins is fine for our usage)
 */
export class LocalFsAdapter implements StorageAdapter {
  readonly name = "local-fs";

  constructor(private readonly root: string) {}

  private absPath(key: StorageKey): string {
    // Defence-in-depth: reject path traversal attempts.
    const safe = key.replace(/\\/g, "/").replace(/^\/+/, "");
    if (safe.includes("..")) {
      throw new Error(`[storage] rejected unsafe key: ${key}`);
    }
    return path.join(this.root, safe);
  }

  async put(key: StorageKey, data: Buffer, opts: PutOptions): Promise<PutResult> {
    const full = this.absPath(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    await fs.writeFile(
      full + META_SUFFIX,
      JSON.stringify({ contentType: opts.contentType, size: data.length }),
      "utf8",
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
    const full = this.absPath(key);
    try {
      const stat = await fs.stat(full);
      let contentType = "application/octet-stream";
      try {
        const meta = JSON.parse(await fs.readFile(full + META_SUFFIX, "utf8"));
        if (typeof meta.contentType === "string") contentType = meta.contentType;
      } catch {
        // No meta sidecar — that's fine, fall back to octet-stream.
      }
      const nodeStream = createReadStream(full);
      // Node 22+: Readable.toWeb gives us a ReadableStream the Web Fetch API can consume.
      const stream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
      return { stream, contentType, size: stat.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async remove(key: StorageKey): Promise<void> {
    const full = this.absPath(key);
    await fs.rm(full, { force: true });
    await fs.rm(full + META_SUFFIX, { force: true });
  }

  async stat(key: StorageKey): Promise<{ size: number; contentType: string } | null> {
    const full = this.absPath(key);
    try {
      const s = statSync(full);
      let contentType = "application/octet-stream";
      try {
        const meta = JSON.parse(await fs.readFile(full + META_SUFFIX, "utf8"));
        if (typeof meta.contentType === "string") contentType = meta.contentType;
      } catch {
        /* sidecar missing — ok */
      }
      return { size: s.size, contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}
