"use client";

import * as React from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { IconTrash, IconExternalLink, IconCalendar } from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileUpload } from "@/components/patterns/file-upload";
import { EditableField } from "@/components/patterns/EditableField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { uploadOrgDocument, deleteOrgDocument } from "./actions";
import { fileToActionPayload } from "./_upload";
import { formatIST } from "@/lib/format/date";

type Doc = {
  id: string;
  category: string;
  title: string;
  fileUrl: string;
  mimeType: string | null;
  fileSize: number | null;
  issueDate: string | null;
  expiryDate: string | null;
};

const CATEGORY_OPTIONS = [
  { value: "REGISTRATION_CERT", label: "Registration Certificate" },
  { value: "TRUST_DEED", label: "Trust Deed" },
  { value: "PAN", label: "PAN" },
  { value: "AUTHORISED_SIGNATORY", label: "Authorised Signatory" },
  { value: "OTHER", label: "Other" },
] as const;

export function LegalDocsPanel({ canEdit, docs }: { canEdit: boolean; docs: Doc[] }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Documents on file</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {docs.filter(isLegalCategory).length === 0 ? (
            <p className="text-sm text-ink-muted">
              No legal documents uploaded yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {docs.filter(isLegalCategory).map((d) => (
                <li key={d.id} className="flex items-center gap-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.title}</p>
                    <p className="text-xs text-ink-subtle">
                      <Badge variant="outline" className="mr-2">
                        {categoryLabel(d.category)}
                      </Badge>
                      {d.expiryDate ? (
                        <>
                          <IconCalendar size={11} className="inline" /> expires {formatIST(d.expiryDate)}
                        </>
                      ) : (
                        "No expiry"
                      )}
                    </p>
                  </div>
                  <a
                    href={d.fileUrl}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-ink-muted hover:bg-surface-sunken hover:text-ink"
                  >
                    <IconExternalLink size={12} />
                    Open
                  </a>
                  {canEdit ? <DeleteButton id={d.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canEdit ? <UploadCard /> : null}
    </div>
  );
}

function categoryLabel(value: string): string {
  const o = CATEGORY_OPTIONS.find((c) => c.value === value);
  return o?.label ?? value;
}
function isLegalCategory(d: Doc): boolean {
  return CATEGORY_OPTIONS.some((c) => c.value === d.category);
}

function DeleteButton({ id }: { id: string }) {
  const { execute, isExecuting } = useAction(deleteOrgDocument, {
    onSuccess: () => toast.success("Document removed"),
    onError: ({ error }) => toast.error(error.serverError ?? "Could not delete"),
  });
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Delete"
      disabled={isExecuting}
      onClick={() => execute({ id })}
    >
      <IconTrash size={14} />
    </Button>
  );
}

function UploadCard() {
  const [category, setCategory] = React.useState<string>("TRUST_DEED");
  const [title, setTitle] = React.useState("");
  const [issueDate, setIssueDate] = React.useState("");
  const [expiryDate, setExpiryDate] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const upload = useAction(uploadOrgDocument, {
    onSuccess: () => {
      toast.success("Uploaded");
      setTitle("");
      setIssueDate("");
      setExpiryDate("");
      setError(null);
    },
    onError: ({ error: e }) => {
      setError(e.serverError ?? "Could not upload");
    },
    onSettled: () => setPending(false),
  });

  async function handleSelect(file: File) {
    if (!title) {
      setError("Please enter a title before uploading.");
      return;
    }
    setError(null);
    setPending(true);
    const payload = await fileToActionPayload(file);
    upload.execute({
      category: category as Parameters<typeof upload.execute>[0]["category"],
      title,
      issueDate: issueDate ? new Date(issueDate) : null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      remarks: null,
      ...payload,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a document</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <EditableField
            label="Title"
            placeholder="e.g. Trust Deed (registered 2024)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Category</p>
            <Select value={category} onValueChange={(v) => v && setCategory(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <EditableField
            label="Issue date"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
          <EditableField
            label="Expiry date"
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            hint="Leave blank for documents without an expiry"
          />
        </div>
        <FileUpload
          onSelect={handleSelect}
          pending={pending}
          error={error}
          hint="PDF, JPEG, or PNG · max 10 MB"
        />
      </CardContent>
    </Card>
  );
}
