import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ResolvedPeriod } from "@/lib/format/date";

const PRESETS = [
  { period: "week", label: "This week" },
  { period: "month", label: "This month" },
  { period: "quarter", label: "This quarter" },
  { period: "fy", label: "This FY" },
] as const;

/**
 * The period filter on the money screens — a row of presets and a from/to
 * pair, filtering whatever list sits under it.
 *
 * State lives entirely in the URL: each preset is a plain link and the custom
 * range is a GET form, so a filtered view can be shared, bookmarked and
 * reloaded, and the page stays a server component with no client state to
 * fall out of step with the query. `resolvePeriod` in `@/lib/format/date`
 * reads the same params back and is what decides the window; this component
 * only writes them and shows which one is on.
 *
 * The two date inputs always carry the active window, preset or not, so the
 * exact days are on screen and switching to a custom range starts from where
 * the reader already is. They are native `<input type="date">` — a calendar
 * that works with the keyboard, without a picker library.
 *
 * `keep` carries a screen's other filters (the expense `status`, say) through
 * a period change; anything empty is dropped. `open`, deliberately, is not
 * carried: changing the period closes an open row's drawer.
 */
export function DateRangeFilter({
  basePath,
  range,
  keep,
}: {
  basePath: string;
  range: ResolvedPeriod;
  keep?: Record<string, string | undefined>;
}) {
  const carried = Object.entries(keep ?? {}).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );

  const presetHref = (period: string) =>
    `${basePath}?${new URLSearchParams([["period", period], ...carried]).toString()}`;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
      {PRESETS.map((preset) => {
        const active = preset.period === range.preset;
        return (
          <Link
            key={preset.period}
            href={presetHref(preset.period)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-[10px] border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-transparent bg-primary-soft font-medium text-primary"
                : "border-border text-ink-muted hover:bg-surface-sunken hover:text-ink",
            )}
          >
            {preset.label}
          </Link>
        );
      })}

      {/* Keyed on the window so the inputs are remounted by a period change:
          an uncontrolled input the reader has already touched would otherwise
          keep showing the days it was left on. */}
      <form
        key={`${range.from}..${range.to}`}
        action={basePath}
        className="flex flex-wrap items-center gap-2 sm:ml-2"
      >
        <input type="hidden" name="period" value="custom" />
        {carried.map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Input
          type="date"
          name="from"
          defaultValue={range.from}
          aria-label="From date"
          className="w-[9.5rem]"
        />
        <span className="text-sm text-ink-subtle">to</span>
        <Input
          type="date"
          name="to"
          defaultValue={range.to}
          aria-label="To date"
          className="w-[9.5rem]"
        />
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Apply
        </button>
      </form>
    </div>
  );
}
