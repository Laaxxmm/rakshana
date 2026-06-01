"use client";

import * as React from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUpload } from "@/components/patterns/file-upload";
import { fileToActionPayload } from "../../_upload";
import { replaceOrgDocument, deleteOrgDocument } from "../../actions";

export function DocumentActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const replace = useAction(replaceOrgDocument, {
    onSuccess: ({ data }) => {
      toast.success("Document replaced");
      if (data?.id) router.replace(`/settings/organisation/documents/${data.id}`);
    },
    onError: ({ error: e }) => setError(e.serverError ?? "Could not replace"),
    onSettled: () => setPending(false),
  });
  const remove = useAction(deleteOrgDocument, {
    onSuccess: () => {
      toast.success("Document removed");
      router.replace("/settings/organisation");
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not delete"),
  });

  async function onSelect(file: File) {
    setError(null);
    setPending(true);
    const payload = await fileToActionPayload(file);
    replace.execute({ id, ...payload });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FileUpload
          onSelect={onSelect}
          pending={pending}
          error={error}
          label="Replace with new version"
          hint="The current file becomes the previous version. PDF / JPEG / PNG · max 10 MB."
        />
        <div className="pt-2 border-t border-border">
          <Button
            variant="destructive"
            size="sm"
            disabled={remove.isExecuting}
            onClick={() => remove.execute({ id })}
          >
            Delete document
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
