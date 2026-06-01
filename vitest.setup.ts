// Vitest setup — loaded once per test process.
if (!process.env["NODE_ENV"]) {
  (process.env as Record<string, string>)["NODE_ENV"] = "test";
}
