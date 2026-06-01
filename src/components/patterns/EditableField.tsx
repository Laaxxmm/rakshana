"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type BaseProps = {
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
};

/**
 * Label + input + help text + error message. The single rendering primitive
 * for editable form fields across the settings screens. Forms wire RHF into
 * the inner input via `{...register("name")}`.
 *
 * For exotic inputs (select / file / textarea) use `<EditableFieldShell>`
 * and place your own control in the children slot.
 */
export const EditableField = React.forwardRef<HTMLInputElement, BaseProps & React.ComponentProps<typeof Input>>(
  function EditableField({ id, label, hint, error, required, className, ...inputProps }, ref) {
    const reactId = React.useId();
    const fieldId = id ?? reactId;
    return (
      <EditableFieldShell
        id={fieldId}
        label={label}
        hint={hint}
        error={error}
        required={required}
        className={className}
      >
        <Input
          id={fieldId}
          aria-invalid={!!error || undefined}
          ref={ref}
          {...inputProps}
        />
      </EditableFieldShell>
    );
  },
);

export function EditableFieldShell({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: BaseProps & { children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="flex items-center gap-1">
        {label}
        {required ? <span className="text-[color:var(--danger)]">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-[color:var(--danger)]">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
