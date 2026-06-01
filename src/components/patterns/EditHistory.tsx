"use client";

import * as React from "react";
import { IconHistory, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatISTDateTime } from "@/lib/format/date";

export type EditHistoryEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string | Date;
  userName: string | null;
  before: unknown;
  after: unknown;
};

/**
 * Collapsible "View history" block. Shows the last N audit entries inline,
 * each clickable to open a side drawer with a before/after JSON diff.
 *
 * History is loaded server-side and passed in as a prop — no client fetch.
 * Pattern carries over to every entity page in Phases 2+.
 */
export function EditHistory({ entries }: { entries: EditHistoryEntry[] }) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState<EditHistoryEntry | null>(null);

  if (entries.length === 0) {
    return (
      <p className="text-xs text-ink-subtle">No edits recorded yet.</p>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface-sunken/30 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-sm"
      >
        <IconHistory size={14} className="text-ink-muted" />
        <span className="font-medium">View history</span>
        <span className="text-xs text-ink-subtle">({entries.length} most recent)</span>
        <span className="ml-auto text-ink-subtle">
          {open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </span>
      </button>
      {open ? (
        <ul className="mt-3 space-y-1.5 border-t border-border pt-2">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setActive(e)}
                className="flex w-full items-baseline justify-between gap-3 rounded px-2 py-1 text-left text-sm hover:bg-surface"
              >
                <span className="truncate">
                  <span className="font-medium">{e.userName ?? "Unknown user"}</span>{" "}
                  <span className="text-ink-muted">· {humanizeAction(e.action)}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ink-subtle">
                  {formatISTDateTime(e.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Sheet open={!!active} onOpenChange={(v) => !v && setActive(null)}>
        <SheetContent className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Edit diff</SheetTitle>
            <SheetDescription>
              {active ? (
                <>
                  <span className="font-medium">{active.userName ?? "Unknown user"}</span>{" "}
                  · {humanizeAction(active.action)} · {formatISTDateTime(active.createdAt)}
                </>
              ) : null}
            </SheetDescription>
          </SheetHeader>
          {active ? <Diff before={active.before} after={active.after} /> : null}
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setActive(null)}>
              Close
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function humanizeAction(action: string): string {
  // "Organisation.update" → "Updated Organisation"
  const [entity, verb] = action.split(".");
  const map: Record<string, string> = {
    create: "Created",
    update: "Updated",
    delete: "Deleted",
    upsert: "Saved",
  };
  return `${map[verb] ?? verb} ${entity}`;
}

function Diff({ before, after }: { before: unknown; after: unknown }) {
  const beforeObj = (before ?? {}) as Record<string, unknown>;
  const afterObj = (after ?? {}) as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const rows = [...keys]
    .sort()
    .map((k) => ({ key: k, before: beforeObj[k], after: afterObj[k] }))
    .filter((r) => !sameValue(r.before, r.after));

  if (rows.length === 0) {
    return <p className="mt-4 text-sm text-ink-muted">No field-level changes recorded.</p>;
  }
  return (
    <div className="mt-4 space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="rounded-md border border-border bg-surface p-3 text-sm">
          <p className="font-mono text-[11px] text-ink-subtle">{r.key}</p>
          <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
            <div className="rounded bg-[color:var(--danger)]/8 px-2 py-1 text-[color:var(--danger)]">
              <p className="text-[10px] uppercase tracking-wider">before</p>
              <pre className="whitespace-pre-wrap break-words text-xs">{format(r.before)}</pre>
            </div>
            <div className="rounded bg-[color:var(--success)]/10 px-2 py-1 text-[color:var(--success)]">
              <p className="text-[10px] uppercase tracking-wider">after</p>
              <pre className="whitespace-pre-wrap break-words text-xs">{format(r.after)}</pre>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function format(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 2);
}
