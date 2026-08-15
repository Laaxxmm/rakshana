import { describe, expect, it } from "vitest";
import { TEST_DB_PARAMS, withTestDbParams } from "../../../vitest.db-url";

/**
 * The suite runs every file at once, so each worker opens its own Prisma pool
 * against one Postgres. Prisma's defaults are sized for a single web request
 * and give up long before a contended machine gets round to the connection —
 * which surfaces as `Can't reach database server` in whichever suites started
 * during the crunch, while Postgres is still healthy and still accepting.
 *
 * `vitest.config.ts` rewrites DATABASE_URL to widen those limits before any
 * worker spawns. These cover that the rewrite reaches the workers and that it
 * leaves a value already in the URL alone.
 */

const BASE = "postgresql://user:pw@localhost:5433/rakshana?schema=public";

describe("DATABASE_URL rewrite for the test suite", () => {
  it("gives Prisma room to wait out a loaded machine", () => {
    expect(withTestDbParams(BASE)).toContain("connect_timeout=30");
    expect(withTestDbParams(BASE)).toContain("pool_timeout=30");
    expect(withTestDbParams(BASE)).toContain("connection_limit=5");
  });

  it("reaches the worker actually running this test", () => {
    // Guards the wiring, not just the helper: a rewrite the workers never see
    // is the bug this whole file exists for.
    const live = process.env["DATABASE_URL"] ?? "";
    for (const key of Object.keys(TEST_DB_PARAMS)) {
      expect(live).toMatch(new RegExp(`[?&]${key}=`));
    }
  });

  it("keeps a value the developer already tuned in .env", () => {
    const tuned = withTestDbParams(`${BASE}&connect_timeout=90`);

    expect(tuned).toContain("connect_timeout=90");
    expect(tuned).not.toContain("connect_timeout=30");
    // One tuned value must not cost the other two.
    expect(tuned).toContain("pool_timeout=30");
    expect(tuned).toContain("connection_limit=5");
  });

  it("adds each parameter once, however many times it is applied", () => {
    const once = withTestDbParams(BASE);

    expect(withTestDbParams(once)).toBe(once);
    expect(once.match(/connection_limit=/g)).toHaveLength(1);
  });

  it("starts the query string when the URL has none", () => {
    expect(withTestDbParams("postgresql://user:pw@localhost:5433/rakshana")).toContain(
      "?connection_limit=5",
    );
  });
});
