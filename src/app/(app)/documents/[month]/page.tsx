import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  IconArrowLeft,
  IconDownload,
  IconExternalLink,
  IconLink,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireOrgScope } from "@/lib/auth/scope";
import { roleHasPermission } from "@/lib/auth/permissions";
import { formatIST } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { isMonthKey, loadLibrary, monthLabel, type LibraryDoc } from "../library";

export const metadata: Metadata = { title: "Documents — Rakshana" };

export default async function DocumentMonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ month: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const { month } = await params;
  const { doc: selectedId } = await searchParams;

  if (!isMonthKey(month)) notFound();

  const scope = await requireOrgScope();
  // The plain-English refusal lives on /documents; sending them there beats
  // repeating it.
  if (!roleHasPermission(scope.role, "documents.view")) redirect("/documents");

  const docs = await loadLibrary(month);
  // Landing straight on the first document saves the auditor a click, and an
  // unknown ?doc (stale link, another month's file) falls back to it too.
  const selected = docs.find((d) => d.id === selectedId) ?? docs[0] ?? null;

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/documents"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
        >
          <IconArrowLeft size={14} />
          All months
        </Link>
      </div>

      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Audit</p>
        <h1 className="mt-1 font-display text-2xl text-ink sm:text-3xl">{monthLabel(month)}</h1>
        <p className="text-sm text-ink-muted">
          {docs.length} {docs.length === 1 ? "document" : "documents"}
        </p>
      </header>

      {docs.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="font-display text-xl text-ink">Nothing filed this month.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card>
            <CardContent className="p-2">
              <ul className="space-y-0.5">
                {docs.map((d) => (
                  <li key={d.id}>
                    {/*
                      Two rows, one visible at a time. Below `lg` the row is
                      the file: it hands the URL to whatever the phone opens
                      PDFs with, which is full screen and has zoom, search and
                      share — none of which a 375px iframe has. From `lg` up
                      the row selects into the preview beside it instead.
                    */}
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener"
                      className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-surface-sunken lg:hidden"
                    >
                      <span className="min-w-0 flex-1">
                        <DocLine doc={d} />
                      </span>
                      <IconExternalLink size={16} className="shrink-0 text-ink-subtle" />
                    </a>
                    <Link
                      href={`/documents/${month}?doc=${encodeURIComponent(d.id)}`}
                      aria-current={d.id === selected?.id ? "true" : undefined}
                      className={cn(
                        "hidden rounded-lg px-3 py-2 transition-colors lg:block",
                        d.id === selected?.id
                          ? "bg-primary-soft text-primary"
                          : "hover:bg-surface-sunken",
                      )}
                    >
                      <DocLine doc={d} />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {selected ? <DocumentPane doc={selected} /> : null}
        </div>
      )}
    </div>
  );
}

/** Title over kind and date — the same two lines in both rows above. */
function DocLine({ doc }: { doc: LibraryDoc }) {
  return (
    <>
      <p className="truncate text-sm font-medium text-ink">{doc.title}</p>
      <p className="truncate text-xs text-ink-muted">
        {doc.kind} · {formatIST(doc.date)}
      </p>
    </>
  );
}

/**
 * The preview beside the list, from `lg` up only — below that the list rows
 * open the file themselves, so nothing here is reachable and the iframe's
 * `loading="lazy"` keeps a phone from spending the download on a hidden one.
 */
function DocumentPane({ doc }: { doc: LibraryDoc }) {
  return (
    <Card className="hidden lg:flex">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl text-ink">{doc.title}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <Badge variant="outline">{doc.kind}</Badge>
              <span>{doc.attachedTo}</span>
              <span>· {formatIST(doc.date)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {doc.href ? (
              <Link
                href={doc.href}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken"
              >
                <IconLink size={14} />
                Source
              </Link>
            ) : null}
            <a
              href={doc.url}
              target="_blank"
              rel="noopener"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken"
            >
              <IconExternalLink size={14} />
              Open
            </a>
            <a
              href={doc.url}
              download
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken"
            >
              <IconDownload size={14} />
              Download
            </a>
          </div>
        </div>

        <Preview doc={doc} />
      </CardContent>
    </Card>
  );
}

/**
 * Images render inline; PDFs go to the browser's own viewer in an iframe, the
 * same pair as /settings/organisation/documents/[id]. Vendor bills are
 * attacker-supplied files, so nothing here parses them in the page — the
 * browser's sandboxed viewer is the only thing that opens a PDF.
 */
function Preview({ doc }: { doc: LibraryDoc }) {
  if (doc.contentType?.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={doc.url}
        alt={doc.title}
        className="max-h-[640px] w-auto max-w-full rounded-md border border-border"
      />
    );
  }
  if (doc.contentType === "application/pdf") {
    return (
      <iframe
        src={doc.url}
        loading="lazy"
        className="h-[640px] w-full rounded-md border border-border bg-canvas"
        title={doc.title}
      />
    );
  }
  return (
    <p className="text-sm text-ink-muted">
      No preview for {doc.contentType ?? "this file type"}.{" "}
      <a className="text-primary underline-offset-4 hover:underline" href={doc.url}>
        Open it directly
      </a>
      .
    </p>
  );
}
