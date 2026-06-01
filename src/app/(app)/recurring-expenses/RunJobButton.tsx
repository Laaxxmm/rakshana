"use client";

import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { IconBolt } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { runRecurringJob } from "./actions";

export function RunJobButton() {
  const run = useAction(runRecurringJob, {
    onSuccess: ({ data }) => {
      if (!data?.ok) return;
      toast.success(
        `Considered ${data.consideredTemplates} · created ${data.draftsCreated} ${data.draftsCreated === 1 ? "draft" : "drafts"}`,
      );
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Run failed"),
  });
  return (
    <Button size="sm" variant="outline" onClick={() => run.execute({})} disabled={run.isExecuting}>
      <IconBolt size={14} />
      {run.isExecuting ? "Running…" : "Run now"}
    </Button>
  );
}
