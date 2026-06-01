import "server-only";
import type { ExpenseStatus, Expense, Prisma } from "@prisma/client";

/**
 * Expense workflow state machine.
 *
 *   DRAFT → PENDING_APPROVAL | APPROVED
 *   PENDING_APPROVAL → APPROVED | REJECTED | CANCELLED
 *   APPROVED → PAID | CANCELLED
 *   REJECTED → DRAFT
 *   CANCELLED → (terminal)
 *   PAID → CANCELLED   (allowed — refund / void in error)
 *
 * The functions in this module are pure transition validators. They throw
 * `WorkflowError` for illegal transitions. Server Actions wrap them with
 * the Prisma write + audit + notification dispatch.
 */

export type WorkflowAction =
  | "submit"
  | "approve"
  | "reject"
  | "markPaid"
  | "cancel"
  | "reopen";

export class WorkflowError extends Error {
  readonly code = "WORKFLOW_ERROR";
  constructor(
    public readonly action: WorkflowAction,
    public readonly fromStatus: ExpenseStatus,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Legal transitions table. `auto` is the auto-approve shortcut from DRAFT
 * straight to APPROVED — only `submit` can use it, and only when the
 * Server Action says the actor's role clears the policy.
 */
const TRANSITIONS: Record<
  WorkflowAction,
  { from: ExpenseStatus[]; to: ExpenseStatus | "DERIVED" }
> = {
  submit:   { from: ["DRAFT"],             to: "DERIVED" }, // → PENDING_APPROVAL or APPROVED
  approve:  { from: ["PENDING_APPROVAL"],  to: "APPROVED" },
  reject:   { from: ["PENDING_APPROVAL"],  to: "REJECTED" },
  markPaid: { from: ["APPROVED"],          to: "PAID" },
  cancel:   { from: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PAID"], to: "CANCELLED" },
  reopen:   { from: ["REJECTED"],          to: "DRAFT" },
};

export function assertTransition(action: WorkflowAction, from: ExpenseStatus): void {
  const t = TRANSITIONS[action];
  if (!t.from.includes(from)) {
    throw new WorkflowError(
      action,
      from,
      `Cannot ${action} an expense currently in ${from} state.`,
    );
  }
}

/**
 * Pure resolver: given an action and the current status, returns the next
 * status. For `submit`, the caller supplies `autoApprove` to pick between
 * APPROVED and PENDING_APPROVAL.
 */
export function nextStatus(
  action: WorkflowAction,
  from: ExpenseStatus,
  opts?: { autoApprove?: boolean },
): ExpenseStatus {
  assertTransition(action, from);
  if (action === "submit") {
    return opts?.autoApprove ? "APPROVED" : "PENDING_APPROVAL";
  }
  const t = TRANSITIONS[action].to;
  if (t === "DERIVED") {
    throw new WorkflowError(action, from, "Derived transition requires a resolver");
  }
  return t;
}

/**
 * Helper used by tests + actions: shallow check whether `transition` is
 * structurally legal from `from`. Does NOT consider permissions.
 */
export function canTransition(action: WorkflowAction, from: ExpenseStatus): boolean {
  return TRANSITIONS[action].from.includes(from);
}

// ---------------------------------------------------------------------------
// Action helpers — pure data-shape transformations the caller can build on
// ---------------------------------------------------------------------------

export type SubmitInput = {
  expense: Pick<Expense, "id" | "status" | "grossAmount">;
  autoApprove: boolean;
};

/** Returns the Prisma update payload for the `submit` transition. */
export function submitUpdate(input: SubmitInput): Prisma.ExpenseUpdateInput {
  const next = nextStatus("submit", input.expense.status, { autoApprove: input.autoApprove });
  return { status: next };
}

export type ApproveInput = {
  expense: Pick<Expense, "id" | "status">;
};
export function approveUpdate(input: ApproveInput): Prisma.ExpenseUpdateInput {
  assertTransition("approve", input.expense.status);
  return { status: "APPROVED" };
}

export type RejectInput = {
  expense: Pick<Expense, "id" | "status">;
};
export function rejectUpdate(input: RejectInput): Prisma.ExpenseUpdateInput {
  assertTransition("reject", input.expense.status);
  return { status: "REJECTED" };
}

export type MarkPaidInput = {
  expense: Pick<Expense, "id" | "status">;
  paidAt: Date;
  paymentRef?: string | null;
};
export function markPaidUpdate(input: MarkPaidInput): Prisma.ExpenseUpdateInput {
  assertTransition("markPaid", input.expense.status);
  return {
    status: "PAID",
    paidAt: input.paidAt,
    paymentRef: input.paymentRef ?? null,
  };
}

export type CancelInput = {
  expense: Pick<Expense, "id" | "status">;
};
export function cancelUpdate(input: CancelInput): Prisma.ExpenseUpdateInput {
  assertTransition("cancel", input.expense.status);
  return { status: "CANCELLED" };
}

export type ReopenInput = {
  expense: Pick<Expense, "id" | "status">;
};
export function reopenUpdate(input: ReopenInput): Prisma.ExpenseUpdateInput {
  assertTransition("reopen", input.expense.status);
  return { status: "DRAFT" };
}
