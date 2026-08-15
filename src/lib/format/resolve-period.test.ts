import { describe, expect, it } from "vitest";
import { formatIST, resolvePeriod, type ResolvedPeriod } from "./date";

/**
 * The windows the money screens filter by. Every `now` here is written with an
 * explicit +05:30 offset so the instant under test is unambiguous: the suite
 * runs shuffled and on machines in any timezone, and the point of these cases
 * is that the answer never depends on either.
 */

const istStamp = (d: Date) => formatIST(d, "yyyy-MM-dd HH:mm");

/** Does an instant fall inside the window — `gte: start, lt: endExclusive`. */
function covers(period: ResolvedPeriod, instant: string): boolean {
  const t = new Date(instant).getTime();
  return t >= period.start.getTime() && t < period.endExclusive.getTime();
}

describe("resolvePeriod — presets", () => {
  // Friday, 14 August 2026.
  const now = new Date("2026-08-14T09:00:00+05:30");

  it("this week runs Monday to Sunday in IST", () => {
    const week = resolvePeriod({ period: "week" }, now);
    expect([week.from, week.to]).toEqual(["2026-08-10", "2026-08-16"]);
    expect(istStamp(week.start)).toBe("2026-08-10 00:00");
    expect(istStamp(week.endExclusive)).toBe("2026-08-17 00:00");
    expect(week.label).toBe("this week");
  });

  it("this month runs 1st to last day in IST", () => {
    const month = resolvePeriod({ period: "month" }, now);
    expect([month.from, month.to]).toEqual(["2026-08-01", "2026-08-31"]);
    expect(istStamp(month.start)).toBe("2026-08-01 00:00");
    expect(istStamp(month.endExclusive)).toBe("2026-09-01 00:00");
  });

  it("this quarter is the calendar quarter in IST", () => {
    const quarter = resolvePeriod({ period: "quarter" }, now);
    expect([quarter.from, quarter.to]).toEqual(["2026-07-01", "2026-09-30"]);
    expect(istStamp(quarter.endExclusive)).toBe("2026-10-01 00:00");
    expect(quarter.rangeLabel).toBe("01 Jul 2026 – 30 Sep 2026");
  });

  it("this financial year runs 1 April to 31 March", () => {
    const fy = resolvePeriod({ period: "fy" }, now);
    expect([fy.from, fy.to]).toEqual(["2026-04-01", "2027-03-31"]);
    expect(istStamp(fy.start)).toBe("2026-04-01 00:00");
    expect(fy.label).toBe("FY 2026-27");
    expect(fy.rangeLabel).toBe("01 Apr 2026 – 31 Mar 2027");
  });

  it("defaults to the current financial year", () => {
    expect(resolvePeriod({}, now)).toEqual(resolvePeriod({ period: "fy" }, now));
  });
});

describe("resolvePeriod — the 1 April boundary", () => {
  it("keeps 31 March in the closing year and 1 April in the new one", () => {
    const fy = resolvePeriod({ period: "fy" }, new Date("2026-08-14T09:00:00+05:30"));
    expect(covers(fy, "2027-03-31T23:59:59+05:30")).toBe(true);
    expect(covers(fy, "2027-04-01T00:00:00+05:30")).toBe(false);
    expect(covers(fy, "2026-03-31T23:59:59+05:30")).toBe(false);
    expect(covers(fy, "2026-04-01T00:00:00+05:30")).toBe(true);
  });

  it("reads the clock in IST, not UTC — 00:30 IST on 1 April is the new FY", () => {
    // The same instant is 31 March 19:00 UTC; a UTC reading would answer 2025-26.
    const fy = resolvePeriod({ period: "fy" }, new Date("2026-04-01T00:30:00+05:30"));
    expect(fy.label).toBe("FY 2026-27");
    expect(fy.from).toBe("2026-04-01");

    const month = resolvePeriod({ period: "month" }, new Date("2026-04-01T00:30:00+05:30"));
    expect([month.from, month.to]).toEqual(["2026-04-01", "2026-04-30"]);
  });

  it("puts a donation on the boundary in exactly one window per preset", () => {
    const donation = "2026-04-01T00:30:00+05:30";
    const sides = [
      new Date("2026-03-31T12:00:00+05:30"),
      new Date("2026-04-01T12:00:00+05:30"),
    ];

    for (const preset of ["week", "month", "quarter", "fy"]) {
      // The window as seen from either side of the boundary, deduplicated:
      // the week straddles 1 April, so its two readings are one window.
      const windows = new Map(
        sides
          .map((now) => resolvePeriod({ period: preset }, now))
          .map((w) => [w.rangeLabel, w] as const),
      );
      const hits = [...windows.values()].filter((w) => covers(w, donation));
      expect(hits.map((w) => `${preset}: ${w.rangeLabel}`)).toHaveLength(1);
    }
  });

  it("tiles consecutive windows without gap or overlap", () => {
    const closing = resolvePeriod({ period: "quarter" }, new Date("2026-03-31T12:00:00+05:30"));
    const opening = resolvePeriod({ period: "quarter" }, new Date("2026-04-01T12:00:00+05:30"));
    expect(closing.endExclusive.getTime()).toBe(opening.start.getTime());
  });
});

describe("resolvePeriod — custom range", () => {
  const now = new Date("2026-08-14T09:00:00+05:30");

  it("treats both ends as inclusive IST days", () => {
    const custom = resolvePeriod({ period: "custom", from: "2026-05-01", to: "2026-05-31" }, now);
    expect(custom.preset).toBe("custom");
    expect(istStamp(custom.start)).toBe("2026-05-01 00:00");
    expect(istStamp(custom.endExclusive)).toBe("2026-06-01 00:00");
    expect(covers(custom, "2026-05-31T23:59:59+05:30")).toBe(true);
    expect(covers(custom, "2026-06-01T00:00:00+05:30")).toBe(false);
  });

  it("covers the whole of a single day when from equals to", () => {
    const day = resolvePeriod({ period: "custom", from: "2026-05-01", to: "2026-05-01" }, now);
    expect(covers(day, "2026-05-01T00:00:00+05:30")).toBe(true);
    expect(covers(day, "2026-05-01T23:59:59+05:30")).toBe(true);
    expect(covers(day, "2026-04-30T23:59:59+05:30")).toBe(false);
    expect(day.rangeLabel).toBe("01 May 2026 – 01 May 2026");
  });

  it("swaps a back-to-front pair", () => {
    const custom = resolvePeriod({ period: "custom", from: "2026-05-31", to: "2026-05-01" }, now);
    expect([custom.from, custom.to]).toEqual(["2026-05-01", "2026-05-31"]);
  });

  it("falls back to the current FY on unusable input", () => {
    const fy = resolvePeriod({ period: "fy" }, now);
    expect(resolvePeriod({ period: "custom", from: "2026-05-01" }, now)).toEqual(fy);
    expect(resolvePeriod({ period: "custom", from: "yesterday", to: "today" }, now)).toEqual(fy);
    expect(resolvePeriod({ period: "custom", from: "2026-13-45", to: "2026-05-01" }, now)).toEqual(fy);
    expect(resolvePeriod({ period: "nonsense" }, now)).toEqual(fy);
  });

  it("honours a bare from/to pair, as a shared link carries", () => {
    const custom = resolvePeriod({ from: "2026-05-01", to: "2026-05-31" }, now);
    expect([custom.preset, custom.from, custom.to]).toEqual(["custom", "2026-05-01", "2026-05-31"]);
  });
});

describe("resolvePeriod — legacy ?fy= links", () => {
  const now = new Date("2026-08-14T09:00:00+05:30");

  it("shows the year the link names", () => {
    const past = resolvePeriod({ fy: "2024-25" }, now);
    expect([past.from, past.to]).toEqual(["2024-04-01", "2025-03-31"]);
    expect(past.label).toBe("FY 2024-25");
    // A past year is a fixed window, so the "this FY" preset is not lit up.
    expect(past.preset).toBe("custom");
  });

  it("lights up the preset when the link names the current year", () => {
    expect(resolvePeriod({ fy: "2026-27" }, now).preset).toBe("fy");
  });

  it("ignores a malformed year instead of throwing", () => {
    expect(resolvePeriod({ fy: "2024" }, now)).toEqual(resolvePeriod({ period: "fy" }, now));
  });
});
