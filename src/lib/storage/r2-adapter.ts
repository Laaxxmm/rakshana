import type { StorageAdapter, StorageKey, PutOptions, PutResult } from "./types";

/**
 * Cloudflare R2 adapter — stub for Phase 6 deploy.
 *
 * Implementation plan when we turn this on:
 *  - Use `@aws-sdk/client-s3` against `https://<accountId>.r2.cloudflarestorage.com`
 *  - Bucket: `rakshana-prod-files`
 *  - Reads: still proxied through `/api/files/[...]` to enforce org scope.
 *    Direct CDN URLs come later once we add signed-URL token generation.
 *  - Required env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
 *    `R2_BUCKET`, optional `R2_PUBLIC_BASE_URL`.
 *
 * Until then, calling any method on this stub throws — `LocalFsAdapter` is the
 * registered default.
 */
export class R2Adapter implements StorageAdapter {
  readonly name = "r2";

  private throwStub(method: string): never {
    throw new Error(
      `[storage] R2Adapter.${method}() not implemented — set STORAGE_BACKEND=local or implement R2 (Phase 6).`,
    );
  }

  async put(_key: StorageKey, _data: Buffer, _opts: PutOptions): Promise<PutResult> {
    this.throwStub("put");
  }
  async get(): Promise<null> {
    this.throwStub("get");
  }
  async remove(): Promise<void> {
    this.throwStub("remove");
  }
  async stat(): Promise<null> {
    this.throwStub("stat");
  }
}
