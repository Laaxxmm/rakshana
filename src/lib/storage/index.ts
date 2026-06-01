import path from "node:path";
import type { StorageAdapter } from "./types";
import { LocalFsAdapter } from "./local-fs-adapter";
import { R2Adapter } from "./r2-adapter";

export type StorageBackend = "local" | "r2";

declare global {
  var __rakshanaStorage: StorageAdapter | undefined;
}

function buildAdapter(): StorageAdapter {
  const backend = (process.env["STORAGE_BACKEND"] ?? "local") as StorageBackend;
  if (backend === "r2") return new R2Adapter();
  // Local FS lives under <repo>/.uploads — gitignored, persistent across dev restarts.
  const root = process.env["LOCAL_STORAGE_ROOT"] ?? path.join(process.cwd(), ".uploads");
  return new LocalFsAdapter(root);
}

/** App-wide storage singleton. */
export const storage: StorageAdapter =
  globalThis.__rakshanaStorage ?? (globalThis.__rakshanaStorage = buildAdapter());

export { storageKey, fileUrl, parseStorageKey } from "./keys";
export type { StorageAdapter, PutResult, PutOptions } from "./types";
