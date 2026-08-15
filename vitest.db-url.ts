/**
 * Connection parameters the test suite adds to DATABASE_URL. Applied by
 * `vitest.config.ts` before any worker spawns; covered by
 * `src/lib/db/test-db-url.test.ts`.
 *
 * Every worker builds its own Prisma pool, and Prisma's default is
 * (2 * cores + 1) connections each — which on a dev machine multiplies past
 * Postgres's max_connections and fails whichever suites happen to start last.
 * The two timeouts are the same problem seen from the other side: Prisma's
 * defaults are sized for one web request, giving up after 5s connecting and
 * after 10s waiting for a pooled connection, and a suite running every file at
 * once on a contended machine passes both marks while Postgres is still
 * healthy and still accepting. That surfaces as
 * `PrismaClientInitializationError: Can't reach database server`, which reads
 * as a dead database rather than as a busy laptop.
 *
 * Longer here means a starved worker waits instead of failing. A database that
 * really is unreachable still fails, just later. Production keeps Prisma's
 * defaults — nothing outside the test run reads this file.
 */
export const TEST_DB_PARAMS = {
  connection_limit: "5",
  connect_timeout: "30",
  pool_timeout: "30",
};

/**
 * Each parameter is added only if the URL does not already carry it, so a
 * value tuned in `.env` survives and does not cost the others.
 */
export function withTestDbParams(url: string): string {
  return Object.entries(TEST_DB_PARAMS).reduce(
    (acc, [key, value]) =>
      new RegExp(`[?&]${key}=`).test(acc)
        ? acc
        : `${acc}${acc.includes("?") ? "&" : "?"}${key}=${value}`,
    url,
  );
}
