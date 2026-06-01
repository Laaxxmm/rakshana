import { NextResponse } from "next/server";
import { prismaUnsafe } from "@/lib/db/prisma";

/**
 * Health-check endpoint Railway polls every few seconds. Returns 200 when
 * the app + database are reachable, 503 when either is down.
 *
 * Kept dependency-light — no auth, no per-org work. Logs are not emitted
 * here to avoid filling stdout with health-check noise.
 */
export async function GET(): Promise<NextResponse> {
  const checks: Record<string, "ok" | "error"> = {
    app: "ok",
    db: "error",
  };
  try {
    await prismaUnsafe.$queryRaw`SELECT 1`;
    checks.db = "ok";
  } catch {
    // checks.db stays "error"
  }
  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      uptime: Math.round(process.uptime()),
      version: process.env["RAILWAY_GIT_COMMIT_SHA"] ?? "local",
      now: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
