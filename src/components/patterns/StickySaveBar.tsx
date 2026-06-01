"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

/**
 * Sticky footer for tabbed edit forms. Becomes visible only when the form is
 * dirty. The pattern: stay quiet by default, declare itself when there's
 * something to save.
 */
export function StickySaveBar({
  dirty,
  pending,
  onReset,
  label = "Save changes",
}: {
  dirty: boolean;
  pending: boolean;
  onReset?: () => void;
  label?: string;
}) {
  if (!dirty && !pending) return null;
  return (
    <div
      aria-live="polite"
      className="sticky bottom-0 inset-x-0 mt-6 -mx-8 border-t border-border bg-surface/95 backdrop-blur-sm px-8 py-3 flex items-center gap-3 shadow-[var(--shadow-md)]"
    >
      <IconAlertTriangle size={16} className="text-[color:var(--warning)]" />
      <p className="text-sm text-ink-muted">You have unsaved changes.</p>
      <div className="ml-auto flex items-center gap-2">
        {onReset ? (
          <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={pending}>
            Discard
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : label}
        </Button>
      </div>
    </div>
  );
}
