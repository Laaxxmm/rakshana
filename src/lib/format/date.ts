import { format } from "date-fns";
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
