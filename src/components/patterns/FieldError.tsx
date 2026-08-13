/** Inline validation message under a field. Toasts vanish; this one stays. */
export function FieldError({ id, msg }: { id?: string; msg?: string }) {
  if (!msg) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-[color:var(--danger)]">
      {msg}
    </p>
  );
}
