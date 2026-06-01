"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  IconCheck,
  IconX,
  IconBan,
  IconReceipt,
  IconCircleCheck,
} from "@tabler/icons-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { formatINRWithSymbol, inrInWords } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";
import { approveExpense, rejectExpense, markExpensePaid, cancelExpense } from "./actions";

export type ExpenseDrawerData = {
  id: string;
  voucherNumber: string;
  expenseDate: string;
  vendorName: string;
  vendorId: string | null;
  categoryName: string | null;
  projectName: string | null;
  grossAmount: string;
  tdsAmount: string;
  tdsSection: string | null;
  netPayable: string;
  mode: string;
  paymentRef: string | null;
  status: string;
  description: string | null;
  isPettyCash: boolean;
};

export function ExpenseDrawer({
  expense,
  fy,
  canCancel,
  canApprove,
  canPay,
}: {
  expense: ExpenseDrawerData;
  fy: string;
  canCancel: boolean;
  canApprove: boolean;
  canPay: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(true);
  const [reason, setReason] = React.useState("");
  const [showReject, setShowReject] = React.useState(false);
  const [showCancel, setShowCancel] = React.useState(false);

  const approve = useAction(approveExpense, {
    onSuccess: () => {
      toast.success("Approved");
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not approve"),
  });
  const reject = useAction(rejectExpense, {
    onSuccess: () => {
      toast.success("Rejected");
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not reject"),
  });
  const pay = useAction(markExpensePaid, {
    onSuccess: () => {
      toast.success("Marked paid");
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not mark paid"),
  });
  const cancel = useAction(cancelExpense, {
    onSuccess: () => {
      toast.success("Cancelled");
      router.replace(`/expenses?fy=${fy}`);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not cancel"),
  });

  function dismiss(v: boolean) {
    setOpen(v);
    if (!v) router.replace(`/expenses?fy=${fy}`);
  }

  const isPending = expense.status === "PENDING_APPROVAL";
  const isApproved = expense.status === "APPROVED";
  const isLive = !["CANCELLED", "REJECTED"].includes(expense.status);

  return (
    <Sheet open={open} onOpenChange={dismiss}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
        {/* Header — pr-12 clears the absolute close-X */}
        <SheetHeader className="border-b border-border px-6 pt-6 pb-5 space-y-3 pr-12">
          <SheetTitle className="font-mono text-sm text-ink-muted font-normal">
            {expense.voucherNumber}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Expense voucher {expense.voucherNumber}
          </SheetDescription>
          <div className="space-y-1.5">
            <div
              className="font-display text-3xl leading-tight text-ink"
              style={{ fontVariationSettings: "'opsz' 28" }}
            >
              {formatINRWithSymbol(expense.grossAmount, { paise: true })}
            </div>
            <p className="text-sm text-ink-muted italic">
              {inrInWords(expense.grossAmount)}
            </p>
            <p className="text-sm text-ink-muted">
              to{" "}
              {expense.vendorId ? (
                <Link
                  href={`/vendors/${expense.vendorId}`}
                  className="text-primary hover:underline"
                >
                  {expense.vendorName}
                </Link>
              ) : (
                <span className="text-ink">{expense.vendorName}</span>
              )}{" "}
              on {formatIST(expense.expenseDate)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge
              variant={
                expense.status === "PAID"
                  ? "default"
                  : expense.status === "APPROVED"
                    ? "secondary"
                    : expense.status === "REJECTED" || expense.status === "CANCELLED"
                      ? "destructive"
                      : "outline"
              }
              className="text-[10px]"
            >
              {expense.status}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {expense.mode}
            </Badge>
            {expense.isPettyCash ? (
              <Badge variant="outline" className="text-[10px]">
                Petty cash
              </Badge>
            ) : null}
            {expense.categoryName ? (
              <Badge variant="outline" className="text-[10px]">
                {expense.categoryName}
              </Badge>
            ) : null}
            {expense.projectName ? (
              <Badge variant="outline" className="text-[10px]">
                {expense.projectName}
              </Badge>
            ) : null}
            {expense.paymentRef ? (
              <span className="font-mono text-[11px] text-ink-subtle">
                Ref · {expense.paymentRef}
              </span>
            ) : null}
          </div>
        </SheetHeader>

        {/* Body — voucher details: amounts, TDS, description */}
        <div className="flex-1 overflow-y-auto bg-surface-sunken/30 px-6 py-5 space-y-4">
          <div className="rounded-md border border-border bg-surface p-4 space-y-3">
            <h3 className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
              Voucher breakdown
            </h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-ink-muted">Gross amount</dt>
              <dd className="text-right font-mono tabular-nums">
                {formatINRWithSymbol(expense.grossAmount, { paise: true })}
              </dd>
              {expense.tdsSection ? (
                <>
                  <dt className="text-ink-muted">TDS · {expense.tdsSection}</dt>
                  <dd className="text-right font-mono tabular-nums text-warning">
                    − {formatINRWithSymbol(expense.tdsAmount, { paise: true })}
                  </dd>
                </>
              ) : null}
              <dt className="border-t border-border pt-2 text-ink-muted">
                Net payable
              </dt>
              <dd className="border-t border-border pt-2 text-right font-mono tabular-nums font-semibold">
                {formatINRWithSymbol(expense.netPayable, { paise: true })}
              </dd>
            </dl>
          </div>

          {expense.description ? (
            <div className="rounded-md border border-border bg-surface p-4">
              <h3 className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
                Description
              </h3>
              <p className="mt-2 whitespace-pre-line text-sm text-ink">
                {expense.description}
              </p>
            </div>
          ) : null}
        </div>

        {/* Footer — uniform 2-col grid */}
        <div className="border-t border-border bg-surface px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {canApprove && isPending ? (
              <Button
                size="sm"
                className="w-full"
                onClick={() => approve.execute({ expenseId: expense.id })}
                disabled={approve.isExecuting}
              >
                <IconCheck size={14} />
                Approve
              </Button>
            ) : null}
            {canApprove && isPending ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setShowReject((v) => !v)}
                disabled={reject.isExecuting}
              >
                <IconX size={14} />
                Reject
              </Button>
            ) : null}
            {canPay && isApproved ? (
              <Button
                size="sm"
                className="w-full"
                onClick={() =>
                  pay.execute({
                    expenseId: expense.id,
                    paidAt: new Date(),
                    paymentRef: null,
                    modeOverride: null,
                  })
                }
                disabled={pay.isExecuting}
              >
                <IconCircleCheck size={14} />
                Mark paid
              </Button>
            ) : null}
            {canCancel && isLive ? (
              <Button
                size="sm"
                variant="destructive"
                className="w-full"
                onClick={() => setShowCancel((v) => !v)}
                disabled={cancel.isExecuting}
              >
                <IconBan size={14} />
                Cancel
              </Button>
            ) : null}
            <Link
              href={`/expenses?fy=${fy}`}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-ink-muted hover:bg-surface-sunken"
            >
              <IconReceipt size={14} />
              Close
            </Link>
          </div>

          {showReject ? (
            <div className="space-y-2 rounded-md border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/5 p-3">
              <Textarea
                rows={2}
                placeholder="Reason for rejection (visible to creator)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowReject(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={reason.trim().length < 3 || reject.isExecuting}
                  onClick={() =>
                    reject.execute({ expenseId: expense.id, notes: reason.trim() })
                  }
                >
                  Confirm rejection
                </Button>
              </div>
            </div>
          ) : null}

          {showCancel ? (
            <div className="space-y-2 rounded-md border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/5 p-3">
              <Textarea
                rows={2}
                placeholder="Reason for cancellation"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowCancel(false)}>
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={reason.trim().length < 3 || cancel.isExecuting}
                  onClick={() =>
                    cancel.execute({ expenseId: expense.id, reason: reason.trim() })
                  }
                >
                  Confirm cancellation
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
