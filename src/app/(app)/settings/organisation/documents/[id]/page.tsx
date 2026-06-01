import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft, IconExternalLink, IconDownload } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReadOnlyField } from "@/components/patterns/ReadOnlyField";
import { prisma } from "@/lib/db/prisma";
import { formatIST } from "@/lib/format/date";
import { loadEditHistory } from "@/lib/audit/history";
import { EditHistory } from "@/components/patterns/EditHistory";
import { DocumentActions } from "./DocumentActions";

export const metadata: Metadata = { title: "Document — Rakshana" };

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const doc = await prisma.orgDocument.findFirst({
    where: { id },
  });
  if (!doc) notFound();

  const history = await loadEditHistory("OrgDocument", id);

  const isPdf = doc.mimeType === "application/pdf";
  const isImage = doc.mimeType?.startsWith("image/");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/settings/organisation"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
        >
          <IconArrowLeft size={14} />
          Back to organisation
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
            Document
          </p>
          <h1 className="mt-1 font-display text-3xl text-ink">{doc.title}</h1>
          <p className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
            <Badge variant="outline">{doc.category}</Badge>
            {doc.deletedAt ? <Badge variant="destructive">Deleted</Badge> : null}
            {doc.replacedById ? <Badge>Replaced</Badge> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={doc.fileUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken"
          >
            <IconExternalLink size={14} />
            Open
          </a>
          <a
            href={doc.fileUrl}
            download
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken"
          >
            <IconDownload size={14} />
            Download
          </a>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent>
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={doc.fileUrl}
              alt={doc.title}
              className="max-h-[500px] w-auto rounded-md border border-border"
            />
          ) : isPdf ? (
            <iframe
              src={doc.fileUrl}
              className="h-[640px] w-full rounded-md border border-border bg-canvas"
              title={doc.title}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              Preview not available for {doc.mimeType ?? "this file type"}.{" "}
              <a className="text-primary underline-offset-4 hover:underline" href={doc.fileUrl}>
                Open it directly
              </a>
              .
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <ReadOnlyField label="Issue date" value={doc.issueDate ? formatIST(doc.issueDate) : null} />
          <ReadOnlyField label="Expiry date" value={doc.expiryDate ? formatIST(doc.expiryDate) : null} />
          <ReadOnlyField label="MIME type" value={doc.mimeType} mono />
          <ReadOnlyField
            label="File size"
            value={doc.fileSize ? `${(doc.fileSize / 1024).toFixed(0)} KB` : null}
            mono
          />
          <ReadOnlyField label="Uploaded" value={formatIST(doc.createdAt, "dd MMM yyyy, HH:mm")} />
          <ReadOnlyField label="Remarks" value={doc.remarks} />
        </CardContent>
      </Card>

      {!doc.deletedAt ? <DocumentActions id={doc.id} /> : null}

      <EditHistory entries={history} />
    </div>
  );
}
