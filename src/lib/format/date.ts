import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
} from "date-fns";
import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";

export const IST = "Asia/Kolkata";

function asDate(input: Date | string): Date {
  return input instanceof Date ? input : new Date(input);
}

export function formatIST(input: Date | string, pattern = "dd MMM yyyy"): string {
  return formatInTimeZone(asDate(input), IST, pattern);
}

export function formatISTInput(input: Date | string): string {
  return formatInTimeZone(asDate(input), IST, "dd/MM/yyyy");
}

export function formatISTDateTime(input: Date | string): string {
  return formatInTimeZone(asDate(input), IST, "dd MMM yyyy, hh:mm a");
}

export function parseISTInput(value: string): Date {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!m) throw new Error(`Invalid date — expected DD/MM/YYYY, got "${value}"`);
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm}-${dd}T00:00:00`;
  return fromZonedTime(iso, IST);
}

export function getFinancialYear(input: Date | string = new Date()): string {
  const ist = toZonedTime(asDate(input), IST);
  const month = ist.getMonth();
  const year = ist.getFullYear();
  const fyStart = month >= 3 ? year : year - 1;
  const fyEnd = (fyStart + 1).toString().slice(-2);
  return `${fyStart}-${fyEnd}`;
}

export const getCurrentFY = (): string => getFinancialYear(new Date());

export function getFinancialYearRange(fy: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) throw new Error(`Invalid FY format: "${fy}" — expected "YYYY-YY"`);
  const startYear = Number(m[1]);
  const start = fromZonedTime(`${startYear}-04-01T00:00:00`, IST);
  const end = fromZonedTime(`${startYear + 1}-04-01T00:00:00`, IST);
  return { start, end };
}

export function todayInIST(): Date {
  const todayStr = formatInTimeZone(new Date(), IST, "yyyy-MM-dd");
  return fromZonedTime(`${todayStr}T00:00:00`, IST);
}

export { format };

// ---------------------------------------------------------------------------
// Period filtering
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const FY_STRING = /^\d{4}-\d{2}$/;

/**
 * The window a money screen is filtered to. `custom` is a fixed pair of days;
 * the rest roll forward with the calendar.
 */
export type PeriodPreset = "week" | "month" | "quarter" | "fy" | "custom";

export type ResolvedPeriod = {
  preset: PeriodPreset;
  /** First IST day inside the window, YYYY-MM-DD. Inclusive. */
  from: string;
  /** Last IST day inside the window, YYYY-MM-DD. Inclusive. */
  to: string;
  /** IST midnight opening `from` — the `gte:` bound of a query. */
  start: Date;
  /** IST midnight opening the day after `to` — the `lt:` bound. */
  endExclusive: Date;
  /** Names the window: "this quarter", "FY 2026-27", "custom range". */
  label: string;
  /** The days covered, spelled out: "01 Apr 2026 – 31 Mar 2027". */
  rangeLabel: string;
};

function istDayStart(day: string): Date {
  return fromZonedTime(`${day}T00:00:00`, IST);
}

function buildPeriod(
  preset: PeriodPreset,
  from: string,
  to: string,
  label: string,
): ResolvedPeriod {
  const start = istDayStart(from);
  const lastDayStart = istDayStart(to);
  return {
    preset,
    from,
    to,
    start,
    endExclusive: new Date(lastDayStart.getTime() + DAY_MS),
    label,
    rangeLabel: `${formatIST(start)} – ${formatIST(lastDayStart)}`,
  };
}

/** A usable custom pair, or null if either day is missing or unparseable. */
function customDays(from?: string, to?: string): { from: string; to: string } | null {
  if (!from || !to || !ISO_DAY.test(from) || !ISO_DAY.test(to)) return null;
  // The regex admits "2026-13-45"; only parsing rejects it.
  if (Number.isNaN(istDayStart(from).getTime())) return null;
  if (Number.isNaN(istDayStart(to).getTime())) return null;
  // ISO days sort chronologically, so a back-to-front pair just swaps.
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * Turn a screen's `?period=&from=&to=&fy=` search params into the window its
 * query runs over.
 *
 * Both ends are inclusive IST days, the convention the reports settled on:
 * `to` is the last day *inside* the window and `endExclusive` is the IST
 * midnight 24 hours after it, for `lt:` in a Prisma filter. IST has no DST, so
 * 24 hours after one IST midnight is always the next one, whatever timezone
 * the process itself runs in.
 *
 * Every calendar edge is cut in IST — `now` is converted before its week,
 * month, quarter and financial year are read — so a donation recorded at
 * 00:30 IST on 1 April falls in the new financial year for a viewer in any
 * timezone, and each instant belongs to exactly one window per preset.
 *
 * Unusable input (a hand-edited URL, half a custom range) falls back to the
 * current financial year rather than throwing: these values arrive from the
 * query string, where anything can appear.
 */
export function resolvePeriod(
  params: { period?: string; from?: string; to?: string; fy?: string },
  now: Date = new Date(),
): ResolvedPeriod {
  // Wall-clock IST carried in the fields date-fns reads, so the week, month
  // and quarter are cut where India cuts them.
  const ist = toZonedTime(now, IST);
  const day = (d: Date) => format(d, "yyyy-MM-dd");

  const custom = customDays(params.from, params.to);
  if (custom && (params.period === "custom" || !params.period)) {
    return buildPeriod("custom", custom.from, custom.to, "custom range");
  }

  switch (params.period) {
    // Weeks run Monday to Sunday.
    case "week":
      return buildPeriod(
        "week",
        day(startOfWeek(ist, { weekStartsOn: 1 })),
        day(endOfWeek(ist, { weekStartsOn: 1 })),
        "this week",
      );
    case "month":
      return buildPeriod("month", day(startOfMonth(ist)), day(endOfMonth(ist)), "this month");
    case "quarter":
      return buildPeriod(
        "quarter",
        day(startOfQuarter(ist)),
        day(endOfQuarter(ist)),
        "this quarter",
      );
    default: {
      const currentFy = getFinancialYear(now);
      const fy = params.fy && FY_STRING.test(params.fy) ? params.fy : currentFy;
      const { start, end } = getFinancialYearRange(fy);
      // `end` is the exclusive 1 April closing the year; the last day inside
      // it is the one before that.
      return buildPeriod(
        // A past FY reached by a `?fy=` link is a fixed window, not "this" one.
        fy === currentFy ? "fy" : "custom",
        formatIST(start, "yyyy-MM-dd"),
        formatIST(new Date(end.getTime() - DAY_MS), "yyyy-MM-dd"),
        `FY ${fy}`,
      );
    }
  }
}

/**
 * Whole days from now until `date` — negative once it has passed.
 *
 * Lives here rather than inline in the compliance pages because three of them
 * were each carrying their own copy of the same `/ 86_400_000`, and because
 * reading the clock inside a component body trips `react-hooks/purity`.
 */
export function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const target = typeof date === "string" ? new Date(date) : date;
  const ms = target.getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor((ms - Date.now()) / 86_400_000);
}
