import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { withTestDbParams } from "./vitest.db-url";

// Next.js loads `.env` on its own; vitest does not. Without this the
// DB-backed tests fail with "Environment variable not found: DATABASE_URL"
// unless the caller happened to export it in their shell.
Object.assign(process.env, loadEnv("test", process.cwd(), ""));

// Cap the Prisma pool per worker and widen its timeouts, so the suite keeps
// its parallelism without workers giving up on a healthy Postgres. Reasoning
// in vitest.db-url.ts; this has to happen before any worker spawns.
const dbUrl = process.env["DATABASE_URL"];
if (dbUrl) {
  process.env["DATABASE_URL"] = withTestDbParams(dbUrl);
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
    // Above TEST_DB_PARAMS.pool_timeout, deliberately. A starved worker that
    // waits out the full 30s pool timeout inside a beforeAll would otherwise
    // trip the hook timeout at the same instant, turning an informative Prisma
    // error into "Hook timed out" — and three suites shell out to
    // `prisma migrate deploy` in that hook, which is the slowest thing in the
    // run and the first to be starved.
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` is a Next.js runtime guard; in test it's a no-op shim.
      "server-only": path.resolve(__dirname, "./vitest.server-only-shim.ts"),
    },
  },
});
