/**
 * Storage abstraction. The interface is the contract; adapters implement it.
 *
 * Phase 1 ships with the LocalFsAdapter for dev. R2 (Cloudflare) lands when
 * we deploy — the call sites do not change.
 */

export type StorageKey = string;

export interface PutOptions {
  contentType: string;
  /** Size in bytes — used by adapters that need to set Content-Length. */
  size?: number;
}

export interface PutResult {
  /** URL the app uses to render the file. Always served through `/api/files/[...]`
   *  so the org scope is enforced — never a direct CDN URL. */
  url: string;
  key: StorageKey;
  size: number;
  contentType: string;
}

export interface StorageAdapter {
  readonly name: string;

  /**
   * Persist a file. Implementations MUST overwrite if the key already exists
   * (callers control replacement explicitly by choosing a new key for "new
   * version" cases).
   */
  put(key: StorageKey, data: Buffer, opts: PutOptions): Promise<PutResult>;

  /** Stream a file for the /api/files route. */
  get(key: StorageKey): Promise<{ stream: ReadableStream; contentType: string; size: number } | null>;

  /** Hard delete — only called from admin tooling, never from feature code. */
  remove(key: StorageKey): Promise<void>;

  /** Bytes-on-disk style size check, used by debug tooling. */
  stat(key: StorageKey): Promise<{ size: number; contentType: string } | null>;
}
