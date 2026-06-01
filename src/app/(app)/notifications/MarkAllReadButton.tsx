"use client";

import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markAllNotificationsRead } from "./actions";

export function MarkAllReadButton() {
  const { execute, isExecuting } = useAction(markAllNotificationsRead, {
    onSuccess: () => toast.success("All caught up"),
    onError: ({ error }) => toast.error(error.serverError ?? "Could not update"),
  });
  return (
    <Button variant="outline" size="sm" onClick={() => execute({})} disabled={isExecuting}>
      Mark all as read
    </Button>
  );
}
