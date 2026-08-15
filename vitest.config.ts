import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Next.js loads `.env` on its own; vitest does not. Without this the
// DB-backed tests fail with "Environment variable not found: DATABASE_URL"
// unless the caller happened to export it in their shell.
Object.assign(process.env, loadEnv("test", process.cwd(), ""));

// Every worker builds its own Prisma pool, and Prisma's default is
// (2 * cores + 1) connections each — which on this machine multiplies past
// Postgres's max_connections and fails whichever suites happen to start last.
// It reads exactly like flakiness. Cap the pool per worker instead of the
// worker count, so the suite keeps its parallelism.
const dbUrl = process.env["DATABASE_URL"];
if (dbUrl && !dbUrl.includes("connection_limit")) {
  process.env["DATABASE_URL"] = `${dbUrl}${dbUrl.includes("?") ? "&" : "?"}connection_limit=5`;
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "tests-e2e/**"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` is a Next.js runtime guard; in test it's a no-op shim.
      "server-only": path.resolve(__dirname, "./vitest.server-only-shim.ts"),
    },
  },
});
