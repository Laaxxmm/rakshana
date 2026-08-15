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
 * Every choice stays on screen at every width. On a phone the four presets
 * become a two-by-two grid and the custom range takes the line below it, so
 * which window is on is still readable off the highlighted button — a
 * dropdown would fit, but it would hide the one thing this control exists to
 * say. Above `sm` the grid dissolves (`sm:contents`) and the presets are back
 * in the same wrapping row as the form.
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
    <div className="space-y-2 sm:flex sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-3 sm:space-y-0">
      <div className="grid grid-cols-2 gap-2 sm:contents">
        {PRESETS.map((preset) => {
          const active = preset.period === range.preset;
          return (
            <Link
              key={preset.period}
              href={presetHref(preset.period)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-[10px] border px-3 py-1.5 text-center text-sm transition-colors",
                active
                  ? "border-transparent bg-primary-soft font-medium text-primary"
                  : "border-border text-ink-muted hover:bg-surface-sunken hover:text-ink",
              )}
            >
              {preset.label}
            </Link>
          );
        })}
      </div>

      {/* Keyed on the window so the inputs are remounted by a period change:
          an uncontrolled input the reader has already touched would otherwise
          keep showing the days it was left on.

          The three grid columns are from / "to" / to, with Apply spanning
          them underneath; the hidden inputs are `display:none` and take no
          cell of their own. */}
      <form
        key={`${range.from}..${range.to}`}
        action={basePath}
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:ml-2 sm:flex sm:flex-wrap"
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
          className="w-full sm:w-[9.5rem]"
        />
        <span className="text-sm text-ink-subtle">to</span>
        <Input
          type="date"
          name="to"
          defaultValue={range.to}
          aria-label="To date"
          className="w-full sm:w-[9.5rem]"
        />
        <button
          type="submit"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "col-span-3 w-full sm:col-auto sm:w-auto",
          )}
        >
          Apply
        </button>
      </form>
    </div>
  );
}
