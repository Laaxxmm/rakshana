/**
 * A row of headline figures — the line that sits under a page title and
 * summarises what the screen is showing ("14 vouchers", "Gross ₹1,20,000").
 *
 * Written as separated label/value pairs rather than one interpuncted
 * sentence: run together, a reader cannot tell where one figure ends and the
 * next begins. Labels are small and muted, values large and tabular, so the
 * numbers are what the eye lands on and each one has a visible edge.
 *
 * Separation is what the two layouts here are for. Wide enough, the pairs sit
 * side by side with the label over its value. On a phone that same row wraps
 * into a ragged block where the eye cannot tell which value belongs to which
 * label, so each figure takes a line of its own instead — label at the left
 * edge, value at the right — and the values line up in a column. It also
 * cannot overflow: a lakh-sized figure lengthens its own line rather than
 * widening the page.
 *
 * Callers pass whatever figures the screen actually has; nothing is assumed
 * about which ones exist. A figure with no value shows an em dash, the same
 * as an empty field on a detail screen.
 */
export function StatRow({
  stats,
}: {
  stats: { label: string; value: React.ReactNode }[];
}) {
  return (
    <dl className="flex flex-col gap-y-1.5 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-10 sm:gap-y-4">
      {stats.map(({ label, value }) => {
        const isEmpty = value === null || value === undefined || value === "";
        return (
          <div
            key={label}
            className="flex flex-wrap items-baseline justify-between gap-x-3 sm:block"
          >
            <dt className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">{label}</dt>
            <dd
              className={`font-mono text-base tabular-nums sm:mt-0.5 sm:text-lg ${isEmpty ? "text-ink-subtle" : "text-ink"}`}
            >
              {isEmpty ? "—" : value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
