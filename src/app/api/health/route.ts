import { NextResponse } from "next/server";
import { prismaUnsafe } from "@/lib/db/prisma";

/**
 * Liveness + readiness combined into one endpoint Railway polls during
 * deploy and continuously after. Two priorities:
 *
 *   1. Always return 200 if the Next.js process is alive — even if the
 *      DB is slow or briefly unreachable. Otherwise Railway will refuse
 *      to mark the deploy live and the trust gets 503s during cold
 *      start (Prisma can take 20-40s on first query).
 *
 *   2. Always include the DB status in the body, so an external uptime
 *      monitor (UptimeRobot, BetterStack) can alert when the DB is
 *      down even though the app is "up".
 *
 * Net effect: Railway sees 200 immediately, app is considered live;
 * a separate monitor watches for `checks.db === "error"` and pages
 * the operator if it stays that way for more than ~5 minutes.
 */
export async function GET(): Promise<NextResponse> {
  const checks: Record<string, "ok" | "error"> = {
    app: "ok",
    db: "unknown" as "ok" | "error",
  };

  // 3-second budget — long enough to clear a cold-start, short enough
  // that Railway's prober doesn't time out the request itself.
  try {
    await Promise.race([
      prismaUnsafe.$queryRaw`SELECT 1`,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("db-timeout")), 3000),
      ),
    ]);
    checks.db = "ok";
  } catch {
    checks.db = "error";
  }

  // Always 200 as long as the process is responding. DB status is in
  // the body for external monitors to read.
  return NextResponse.json(
    {
      status: checks.db === "ok" ? "ok" : "degraded",
      checks,
      uptime: Math.round(process.uptime()),
      version: process.env["RAILWAY_GIT_COMMIT_SHA"] ?? "local",
      now: new Date().toISOString(),
    },
    { status: 200 },
  );
}
