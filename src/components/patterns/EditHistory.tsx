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
 * each clickable to open a side drawer with the detail of that change.
 *
 * History is loaded server-side and passed in as a prop — no client fetch.
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
            <SheetTitle>{active ? humanizeAction(active.action) : "Change"}</SheetTitle>
            <SheetDescription>
              {active ? (
                <>
                  <span className="font-medium">{active.userName ?? "Unknown user"}</span>{" "}
                  · {formatISTDateTime(active.createdAt)}
                </>
              ) : null}
            </SheetDescription>
          </SheetHeader>
          {active ? <AuditDetail entry={active} /> : null}
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

/**
 * Columns every row carries and nobody audits by hand: the surrogate key, the
 * tenant key, and the two timestamps Prisma maintains itself.
 */
const NOISE_KEYS = new Set(["id", "organisationId", "createdAt", "updatedAt"]);

/**
 * Detail body of one audit entry.
 *
 * `writeAuditEntry` in src/lib/db/prisma.ts stores the row as it stood after
 * the write and leaves `before` as SQL NULL, so most entries have one side
 * only. With one side there is nothing to diff: the panel lists the fields
 * that hold a value and says which side of the change they describe. When an
 * entry does carry both sides — an audit row written by hand — only the
 * fields whose value differs are shown.
 */
export function AuditDetail({ entry }: { entry: EditHistoryEntry }) {
  const before = populatedFields(entry.before);
  const after = populatedFields(entry.after);
  const isDelete = entry.action.endsWith(".delete") || entry.action.endsWith(".deleteMany");

  if (before.length > 0) {
    const changed = changedFields(entry.before, entry.after);
    if (changed.length === 0) {
      return <p className="mt-4 text-sm text-ink-muted">No field-level changes recorded.</p>;
    }
    return (
      <div className="mt-4 space-y-2">
        {changed.map((r) => (
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

  if (isDelete || after.length === 0) {
    return (
      <p className="mt-4 text-sm text-ink-muted">
        {isDelete ? "The record was deleted. No field values were kept." : "No field values recorded."}
      </p>
    );
  }

  const created = entry.action.endsWith(".create") || entry.action.endsWith(".createMany");
  return (
    <div className="mt-4">
      <p className="text-xs text-ink-subtle">
        {created ? "Created with" : "Values after this change"}
      </p>
      <dl className="mt-2 divide-y divide-border rounded-md border border-border bg-surface">
        {after.map(([key, value]) => (
          <div key={key} className="flex gap-3 px-3 py-2 text-sm">
            <dt className="w-2/5 shrink-0 font-mono text-[11px] text-ink-subtle">{key}</dt>
            <dd className="min-w-0 flex-1 break-words">{format(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Fields worth showing: an audit row carries the whole record, and a donor
 * has thirty-odd columns of which a given donor fills in eight. Blanks and
 * flags left off say nothing about what happened, so they are dropped.
 */
function populatedFields(value: unknown): [string, unknown][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).filter(
    ([key, v]) => !NOISE_KEYS.has(key) && !isEmpty(v),
  );
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === "" || v === false) return true;
  return Array.isArray(v) && v.length === 0;
}

function changedFields(
  before: unknown,
  after: unknown,
): { key: string; before: unknown; after: unknown }[] {
  const beforeObj = (before ?? {}) as Record<string, unknown>;
  const afterObj = (after ?? {}) as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  return [...keys]
    .filter((k) => !NOISE_KEYS.has(k))
    .sort()
    .map((k) => ({ key: k, before: beforeObj[k], after: afterObj[k] }))
    .filter((r) => !sameValue(r.before, r.after));
}

function sameValue(a: unknown, b: unknown): boolean {
  // A field absent from one side and null on the other is not an edit — that
  // pairing is what filled the panel with rows reading "before — / after —".
  if (isBlank(a) && isBlank(b)) return true;
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function format(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 2);
}
