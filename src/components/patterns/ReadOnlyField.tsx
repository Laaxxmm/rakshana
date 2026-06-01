export function ReadOnlyField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  const isEmpty = value === null || value === undefined || value === "";
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">
        {label}
      </p>
      <p
        className={`text-sm ${mono ? "font-mono tabular-nums" : ""} ${isEmpty ? "italic text-ink-subtle" : "text-ink"}`}
      >
        {isEmpty ? "—" : value}
      </p>
    </div>
  );
}
