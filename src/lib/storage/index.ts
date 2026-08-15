import path from "node:path";
import type { StorageAdapter } from "./types";
import { LocalFsAdapter } from "./local-fs-adapter";
import { PostgresAdapter } from "./postgres-adapter";
import { R2Adapter } from "./r2-adapter";

export type StorageBackend = "postgres" | "local" | "r2";

declare global {
  var __rakshanaStorage: StorageAdapter | undefined;
}

function buildAdapter(): StorageAdapter {
  const backend = (process.env["STORAGE_BACKEND"] ?? "postgres") as StorageBackend;
  // R2Adapter builds its S3 client on first call, so this stays cheap and
  // never touches R2_* env unless that backend is chosen.
  if (backend === "r2") return new R2Adapter();
  if (backend === "local") {
    const root = process.env["LOCAL_STORAGE_ROOT"];
    // An explicit root is someone pointing at a disk they know persists.
    if (root) return new LocalFsAdapter(root);
    // Without one it means <cwd>/.uploads. On a dev machine that is a
    // gitignored folder that survives restarts; in a container it is a
    // directory that is thrown away on the next deploy, taking every
    // receipt with it. Refuse to honour it there.
    if (process.env.NODE_ENV !== "production") {
      return new LocalFsAdapter(path.join(process.cwd(), ".uploads"));
    }
    console.error(
      "[storage] Ignoring STORAGE_BACKEND=local: no LOCAL_STORAGE_ROOT is set, so " +
        "files would be written inside the container and lost on the next deploy. " +
        "Using the postgres backend. Unset STORAGE_BACKEND to silence this.",
    );
  }
  // Default: the database, which is the only store here that outlives a deploy.
  return new PostgresAdapter();
}

/** App-wide storage singleton. */
export const storage: StorageAdapter =
  globalThis.__rakshanaStorage ?? (globalThis.__rakshanaStorage = buildAdapter());

export { storageKey, fileUrl, parseStorageKey } from "./keys";
export type { StorageAdapter, PutResult, PutOptions } from "./types";
