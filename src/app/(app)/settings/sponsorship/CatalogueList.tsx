"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { IconArchive, IconArrowBackUp, IconPencil, IconPlus } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EditableField, EditableFieldShell } from "@/components/patterns/EditableField";
import { formatINRWithSymbol } from "@/lib/format/inr";
import {
  SPONSORSHIP_CATEGORIES,
  SPONSORSHIP_CATEGORY_LABELS,
  type SponsorshipCategoryValue,
} from "@/lib/schemas/sponsorship";
import {
  createSponsorshipItem,
  setSponsorshipItemActive,
  updateSponsorshipItem,
} from "./actions";

export type CatalogueRow = {
  id: string;
  category: SponsorshipCategoryValue;
  label: string;
  amount: string;
  unitNoun: string;
  sortOrder: number;
  isActive: boolean;
};

type ActionResult = {
  data?: unknown;
  serverError?: string;
  validationErrors?: Record<string, { _errors?: string[] }>;
};

/** The first field message a refused action came back with, if any. */
function firstFieldError(result: ActionResult): { field: string; message: string } | null {
  for (const [field, issue] of Object.entries(result.validationErrors ?? {})) {
    const message = issue?._errors?.[0];
    if (message) return { field, message };
  }
  return null;
}

export function CatalogueList({
  canEdit,
  items,
}: {
  canEdit: boolean;
  items: CatalogueRow[];
}) {
  return (
    <div className="space-y-4">
      {SPONSORSHIP_CATEGORIES.map((category) => {
        const rows = items.filter((i) => i.category === category);
        return (
          <Card key={category}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>{SPONSORSHIP_CATEGORY_LABELS[category]}</CardTitle>
              {canEdit ? <ItemDialog mode="create" category={category} /> : null}
            </CardHeader>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-ink-muted">Nothing on this part of the menu yet.</p>
              ) : (
                <ul className="divide-y divide-border border-t border-border">
                  {rows.map((item) => (
                    <ItemRow key={item.id} item={item} canEdit={canEdit} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * One brochure line. The label and the price stack above the controls under
 * 640px so a long label never squeezes the buttons off a phone, and the
 * controls keep an 11-unit (44px) height there.
 */
function ItemRow({ item, canEdit }: { item: CatalogueRow; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function toggle() {
    startTransition(async () => {
      const result = (await setSponsorshipItemActive({
        id: item.id,
        isActive: !item.isActive,
      })) as ActionResult;
      if (result.serverError) {
        toast.error(result.serverError);
        return;
      }
      toast.success(item.isActive ? "Taken off the menu" : "Back on the menu");
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 basis-full sm:flex-1">
        <p className={item.isActive ? "text-sm text-ink" : "text-sm text-ink-muted line-through"}>
          {item.label}
        </p>
        <p className="mt-0.5 text-xs text-ink-muted">
          <span className="font-mono tabular-nums">{formatINRWithSymbol(item.amount, { paise: true })}</span> per{" "}
          {item.unitNoun} · position {item.sortOrder}
        </p>
      </div>
      {item.isActive ? null : <Badge variant="outline">Off the menu</Badge>}
      {canEdit ? (
        <div className="flex items-center gap-2">
          <ItemDialog mode="edit" category={item.category} item={item} />
          <Button
            variant="outline"
            size="sm"
            className="h-11 sm:h-7"
            disabled={pending}
            onClick={toggle}
          >
            {item.isActive ? <IconArchive size={14} /> : <IconArrowBackUp size={14} />}
            {item.isActive ? "Take off menu" : "Put back"}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Add or edit one item. Five fields, one screen, no wizard: the name, the
 * price, the noun the quantity counts, the section it prints under and its
 * position within that section.
 */
function ItemDialog({
  mode,
  category,
  item,
}: {
  mode: "create" | "edit";
  category: SponsorshipCategoryValue;
  item?: CatalogueRow;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // Sent as typed. The schema parses the amount with decimal.js and coerces
    // the position; nothing here does arithmetic on a rupee.
    const values = {
      category: String(form.get("category")) as SponsorshipCategoryValue,
      label: String(form.get("label")),
      amount: String(form.get("amount")),
      unitNoun: String(form.get("unitNoun")),
      sortOrder: String(form.get("sortOrder")),
    };

    startTransition(async () => {
      setErrors({});
      const result = (await (item
        ? updateSponsorshipItem({ ...values, id: item.id })
        : createSponsorshipItem(values))) as ActionResult;

      if (result.serverError) {
        toast.error(result.serverError);
        return;
      }
      const failed = firstFieldError(result);
      if (failed) {
        setErrors({ [failed.field]: failed.message });
        return;
      }
      toast.success(item ? "Item updated" : "Item added");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          mode === "create" ? (
            <Button size="sm" className="h-11 sm:h-7">
              <IconPlus size={14} />
              Add item
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-11 sm:h-7" aria-label={`Edit ${item?.label}`}>
              <IconPencil size={14} />
              Edit
            </Button>
          )
        }
      />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Edit item" : "Add item"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <EditableField
            label="What the donor sees"
            name="label"
            required
            defaultValue={item?.label ?? ""}
            error={errors["label"]}
            className="[&_input]:h-11 sm:[&_input]:h-8"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <EditableField
              label="Price (₹)"
              name="amount"
              required
              inputMode="decimal"
              defaultValue={item?.amount ?? ""}
              error={errors["amount"]}
              className="[&_input]:h-11 sm:[&_input]:h-8"
            />
            <EditableField
              label="Counted in"
              name="unitNoun"
              required
              hint="Shown beside the quantity — child, woman, month"
              defaultValue={item?.unitNoun ?? ""}
              error={errors["unitNoun"]}
              className="[&_input]:h-11 sm:[&_input]:h-8"
            />
            <EditableFieldShell label="Section" required error={errors["category"]}>
              <select
                name="category"
                defaultValue={item?.category ?? category}
                className="h-11 w-full rounded-md border border-border bg-surface px-3 text-sm sm:h-8"
              >
                {SPONSORSHIP_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {SPONSORSHIP_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </EditableFieldShell>
            <EditableField
              label="Position"
              name="sortOrder"
              type="number"
              min={0}
              inputMode="numeric"
              hint="Lower prints first"
              defaultValue={item?.sortOrder ?? 0}
              error={errors["sortOrder"]}
              className="[&_input]:h-11 sm:[&_input]:h-8"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-8"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-8" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
