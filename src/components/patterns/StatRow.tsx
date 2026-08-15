/**
 * A row of headline figures — the line that sits under a page title and
 * summarises what the screen is showing ("14 vouchers", "Gross ₹1,20,000").
 *
 * Written as separated label/value pairs rather than one interpuncted
 * sentence: run together, a reader cannot tell where one figure ends and the
 * next begins. Labels are small and muted, values large and tabular, so the
 * numbers are what the eye lands on and each one has a visible edge.
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
    <dl className="flex flex-wrap items-start gap-x-10 gap-y-4">
      {stats.map(({ label, value }) => {
        const isEmpty = value === null || value === undefined || value === "";
        return (
          <div key={label}>
            <dt className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">{label}</dt>
            <dd
              className={`mt-0.5 font-mono text-lg tabular-nums ${isEmpty ? "text-ink-subtle" : "text-ink"}`}
            >
              {isEmpty ? "—" : value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
