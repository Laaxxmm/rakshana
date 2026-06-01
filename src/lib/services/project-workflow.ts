import "server-only";
import type { ProjectStatus, Prisma } from "@prisma/client";

/**
 * Project workflow state machine. Same shape as the expense workflow from
 * Phase 3 — pure transition validators that throw `WorkflowError`.
 *
 * PLANNED   → ACTIVE | CANCELLED
 * ACTIVE    → ON_HOLD | COMPLETED | CANCELLED
 * ON_HOLD   → ACTIVE | CANCELLED
 * COMPLETED → (terminal — utilisation certs remain generatable)
 * CANCELLED → (terminal)
 */

export type ProjectAction = "activate" | "hold" | "complete" | "cancel" | "resume";

export class ProjectWorkflowError extends Error {
  readonly code = "PROJECT_WORKFLOW_ERROR";
  constructor(
    public readonly action: ProjectAction,
    public readonly fromStatus: ProjectStatus,
    message: string,
  ) {
    super(message);
  }
}

const TRANSITIONS: Record<ProjectAction, { from: ProjectStatus[]; to: ProjectStatus }> = {
  activate: { from: ["PLANNED", "ON_HOLD"],            to: "ACTIVE" },
  hold:     { from: ["ACTIVE"],                        to: "ON_HOLD" },
  complete: { from: ["ACTIVE"],                        to: "COMPLETED" },
  cancel:   { from: ["PLANNED", "ACTIVE", "ON_HOLD"],  to: "CANCELLED" },
  resume:   { from: ["ON_HOLD"],                       to: "ACTIVE" },
};

export function assertProjectTransition(action: ProjectAction, from: ProjectStatus): void {
  const t = TRANSITIONS[action];
  if (!t.from.includes(from)) {
    throw new ProjectWorkflowError(
      action,
      from,
      `Cannot ${action} a project currently in ${from} state.`,
    );
  }
}

export function nextProjectStatus(action: ProjectAction, from: ProjectStatus): ProjectStatus {
  assertProjectTransition(action, from);
  return TRANSITIONS[action].to;
}

export function canProjectTransition(action: ProjectAction, from: ProjectStatus): boolean {
  return TRANSITIONS[action].from.includes(from);
}

/**
 * Resolve the workflow action from a target status. Used by the
 * `transitionProject` Server Action so the UI can pass `toStatus` instead
 * of needing to know action names.
 */
export function actionForTargetStatus(
  from: ProjectStatus,
  to: ProjectStatus,
): ProjectAction | null {
  for (const [action, def] of Object.entries(TRANSITIONS) as [ProjectAction, typeof TRANSITIONS[ProjectAction]][]) {
    if (def.from.includes(from) && def.to === to) return action;
  }
  return null;
}

/**
 * Mark the transition into a Prisma update payload. Callers wrap with their
 * own DB write + audit + notification.
 */
export function projectTransitionUpdate(
  action: ProjectAction,
  from: ProjectStatus,
): Prisma.ProjectUpdateInput {
  const next = nextProjectStatus(action, from);
  return { status: next };
}
