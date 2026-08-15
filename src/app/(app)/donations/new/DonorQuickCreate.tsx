"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldError } from "@/components/patterns/FieldError";
import { miniDonorSchema, type DonorTypeKey } from "@/lib/schemas/donor";

/**
 * A donor the volunteer has filled in but that does not exist in the
 * database yet — `recordDonation` creates it in the same transaction as
 * the donation. Writing it on "Save donor" left an orphan behind every
 * time the form was abandoned, so there is deliberately no `id` here.
 */
export type QuickCreatedDonor = {
  id: null;
  name: string;
  donorType: string;
  pan: string | null;
  phone: string | null;
  draft: Record<string, unknown>;
};

// The long tail (address, FCRA, tags) belongs on /donors/new — this panel only
// carries what a receipt needs so recording a donation is not blocked.
const QUICK_TYPES: DonorTypeKey[] = ["INDIVIDUAL", "CORPORATE", "TRUST", "HUF", "NRI"];

export function DonorQuickCreate({
  initialName = "",
  onCancel,
  onCreated,
}: {
  initialName?: string;
  onCancel: () => void;
  onCreated: (donor: QuickCreatedDonor) => void;
}) {
  const [donorType, setDonorType] = React.useState<DonorTypeKey>("INDIVIDUAL");
  const [name, setName] = React.useState(initialName);
  const [pan, setPan] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const [submitting, setSubmitting] = React.useState(false);

  function submit() {
    setSubmitting(true);
    // Validate against the very same Zod schema the server uses, so the
    // volunteer sees a bad PAN immediately instead of after a round trip —
    // and crucially without writing anything yet.
    const parsed = miniDonorSchema.safeParse({
      donorType,
      name,
      pan: pan.trim() || null,
      phone: phone.trim() || null,
    });
    setSubmitting(false);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      toast.error(Object.values(next)[0] ?? "Check the donor details");
      return;
    }
    setErrors({});
    onCreated({
      id: null,
      name: parsed.data.name,
      donorType: parsed.data.donorType,
      pan: parsed.data.pan ?? null,
      phone: parsed.data.phone ?? null,
      draft: parsed.data as Record<string, unknown>,
    });
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary-soft/30 p-3 space-y-3 sm:p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-ink-subtle">Add donor</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Type</Label>
          <Select
            value={donorType}
            onValueChange={(v) => v && setDonorType(v as DonorTypeKey)}
          >
            <SelectTrigger className="min-h-11 w-full sm:min-h-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUICK_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError msg={errors.donorType} />
        </div>
        <div>
          <Label className="text-xs" htmlFor="quick-donor-name">
            Name
          </Label>
          <Input
            id="quick-donor-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoCapitalize="words"
            className="h-11 sm:h-8"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "quick-donor-name-error" : undefined}
          />
          <FieldError id="quick-donor-name-error" msg={errors.name} />
        </div>
        <div>
          <Label className="text-xs" htmlFor="quick-donor-pan">
            PAN
          </Label>
          <Input
            id="quick-donor-pan"
            value={pan}
            // Stored uppercase, so show it that way while typing rather than
            // letting the server silently rewrite what the user entered.
            onChange={(e) => setPan(e.target.value.toUpperCase())}
            placeholder="ABCDE1234F"
            maxLength={10}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono uppercase h-11 sm:h-8"
            aria-invalid={!!errors.pan}
            aria-describedby={errors.pan ? "quick-donor-pan-error" : undefined}
          />
          <FieldError id="quick-donor-pan-error" msg={errors.pan} />
        </div>
        <div>
          <Label className="text-xs" htmlFor="quick-donor-phone">
            Phone
          </Label>
          <Input
            id="quick-donor-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-11 sm:h-8"
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? "quick-donor-phone-error" : undefined}
          />
          <FieldError id="quick-donor-phone-error" msg={errors.phone} />
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 sm:h-7"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-11 sm:h-7"
          disabled={submitting || name.trim().length === 0}
          onClick={submit}
        >
          Use this donor
        </Button>
      </div>
    </div>
  );
}
