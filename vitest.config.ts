import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Next.js loads `.env` on its own; vitest does not. Without this the
// DB-backed tests fail with "Environment variable not found: DATABASE_URL"
// unless the caller happened to export it in their shell.
Object.assign(process.env, loadEnv("test", process.cwd(), ""));

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
