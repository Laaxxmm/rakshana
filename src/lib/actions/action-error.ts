/**
 * Reading `error.serverError` alone loses every Zod failure: next-safe-action
 * puts schema issues in `error.validationErrors` and leaves `serverError`
 * undefined, so a form that only renders `serverError` fails silently.
 *
 * Client-safe on purpose — `safe-action.ts` is server-only, these helpers are
 * for the `useAction` onError handlers.
 */

type ActionError = {
  serverError?: string;
  validationErrors?: unknown;
};

/**
 * next-safe-action hands back either the formatted (`{ _errors: [] }`) or the
 * flattened (`string[]`) shape depending on config — accept both so a schema
 * message never degrades into a generic failure toast.
 */
export function actionFieldErrors(error: ActionError | undefined): Record<string, string> {
  const raw = error?.validationErrors;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [field, issue] of Object.entries(raw as Record<string, unknown>)) {
    if (field === "_errors") continue;
    const msg = Array.isArray(issue)
      ? issue[0]
      : (issue as { _errors?: string[] })?._errors?.[0];
    if (typeof msg === "string") out[field] = msg;
  }
  return out;
}

/** Root-level issues — a schema-wide `.refine()` with no `path`. */
function formErrors(error: ActionError | undefined): string[] {
  const raw = error?.validationErrors as { _errors?: unknown } | undefined;
  return Array.isArray(raw?._errors) ? (raw._errors as string[]) : [];
}

/** One displayable line: first field error, then form error, then serverError. */
export function actionErrorMessage(error: ActionError | undefined, fallback: string): string {
  const fields = Object.values(actionFieldErrors(error));
  return fields[0] ?? formErrors(error)[0] ?? error?.serverError ?? fallback;
}
