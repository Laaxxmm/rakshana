"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { brandingTextSchema, type BrandingTextInput } from "@/lib/schemas/organisation";
import { updateBrandingText, uploadBrandingAsset } from "./actions";
import { fileToActionPayload } from "./_upload";
import { FileUpload } from "@/components/patterns/file-upload";
import { EditableFieldShell } from "@/components/patterns/EditableField";
import { StickySaveBar } from "@/components/patterns/StickySaveBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatINRWithSymbol, inrInWords } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";

export function BrandingPanel({
  canEdit,
  logoUrl,
  signatureUrl,
  headerText,
  footerText,
  orgName,
}: {
  canEdit: boolean;
  logoUrl: string | null;
  signatureUrl: string | null;
  headerText: string;
  footerText: string;
  orgName: string;
}) {
  const [logoPreview, setLogoPreview] = React.useState<string | null>(logoUrl);
  const [sigPreview, setSigPreview] = React.useState<string | null>(signatureUrl);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <AssetCard
          title="Logo"
          hint="PNG or JPEG · max 2 MB · square at least 256×256, transparent PNG preferred."
          target="logo"
          currentUrl={logoPreview}
          onChange={setLogoPreview}
          canEdit={canEdit}
        />
        <AssetCard
          title="Authorised signature"
          hint="PNG or JPEG · max 2 MB · black ink on white background, ~600×200 px."
          target="signature"
          currentUrl={sigPreview}
          onChange={setSigPreview}
          canEdit={canEdit}
        />
        <BrandingTextCard
          canEdit={canEdit}
          defaults={{ receiptHeaderText: headerText, receiptFooterText: footerText }}
        />
      </div>

      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle mb-2">
          Live preview · 80G receipt
        </p>
        <ReceiptPreview
          logoUrl={logoPreview}
          signatureUrl={sigPreview}
          orgName={orgName}
          headerText={headerText}
          footerText={footerText}
        />
      </div>
    </div>
  );
}

function AssetCard({
  title,
  hint,
  target,
  currentUrl,
  onChange,
  canEdit,
}: {
  title: string;
  hint: string;
  target: "logo" | "signature";
  currentUrl: string | null;
  onChange: (url: string | null) => void;
  canEdit: boolean;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const upload = useAction(uploadBrandingAsset, {
    onSuccess: ({ data }) => {
      toast.success(`${title} updated`);
      if (data?.url) onChange(data.url);
    },
    onError: ({ error: e }) => setError(e.serverError ?? "Could not upload"),
    onSettled: () => setPending(false),
  });

  async function handleSelect(file: File) {
    setError(null);
    setPending(true);
    const payload = await fileToActionPayload(file);
    upload.execute({ target, ...payload });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <FileUpload
          onSelect={handleSelect}
          current={
            currentUrl
              ? {
                  name: target === "logo" ? "Trust logo" : "Authorised signature",
                  url: currentUrl,
                  mime: "image/png",
                }
              : null
          }
          accept={["image/png", "image/jpeg"]}
          maxBytes={2 * 1024 * 1024}
          pending={pending || !canEdit}
          error={error}
          hint={hint}
        />
      </CardContent>
    </Card>
  );
}

function BrandingTextCard({
  canEdit,
  defaults,
}: {
  canEdit: boolean;
  defaults: { receiptHeaderText: string; receiptFooterText: string };
}) {
  const form = useForm<BrandingTextInput>({
    resolver: zodResolver(brandingTextSchema) as unknown as never,
    defaultValues: {
      receiptHeaderText: defaults.receiptHeaderText || "",
      receiptFooterText: defaults.receiptFooterText || "",
    },
  });
  const { register, handleSubmit, formState: { errors, isDirty }, reset } = form;
  const { execute, isExecuting } = useAction(updateBrandingText, {
    onSuccess: ({ input }) => {
      toast.success("Receipt text saved");
      reset(input as unknown as BrandingTextInput);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });
  return (
    <form onSubmit={handleSubmit((vals) => execute(vals))}>
      <fieldset disabled={!canEdit || isExecuting}>
        <Card>
          <CardHeader>
            <CardTitle>Receipt text</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <EditableFieldShell
              label="Header text"
              hint="Top of every 80G receipt (max 200 chars)"
              error={errors.receiptHeaderText?.message}
            >
              <Textarea rows={2} {...register("receiptHeaderText")} />
            </EditableFieldShell>
            <EditableFieldShell
              label="Footer text"
              hint="Bottom of every 80G receipt (max 300 chars)"
              error={errors.receiptFooterText?.message}
            >
              <Textarea rows={3} {...register("receiptFooterText")} />
            </EditableFieldShell>
          </CardContent>
        </Card>
        {canEdit ? (
          <StickySaveBar dirty={isDirty} pending={isExecuting} onReset={() => reset()} />
        ) : null}
      </fieldset>
    </form>
  );
}

function ReceiptPreview({
  logoUrl,
  signatureUrl,
  orgName,
  headerText,
  footerText,
}: {
  logoUrl: string | null;
  signatureUrl: string | null;
  orgName: string;
  headerText: string;
  footerText: string;
}) {
  return (
    <div className="rounded-lg border border-border-strong bg-surface p-6 shadow-[var(--shadow-md)]">
      <div className="flex items-start gap-4 border-b border-dashed border-border pb-4">
        <div className="h-14 w-14 shrink-0 rounded border border-border bg-canvas flex items-center justify-center overflow-hidden">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="max-h-12 max-w-12 object-contain" />
          ) : (
            <span className="text-[10px] text-ink-subtle">Logo</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display text-lg">{orgName}</p>
          {headerText ? (
            <p className="mt-1 text-xs text-ink-muted whitespace-pre-line">
              {headerText}
            </p>
          ) : (
            <p className="mt-1 text-xs italic text-ink-subtle">
              Add header text in the panel on the left
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle">Receipt</p>
          <p className="font-mono text-sm">RKS/2025-26/0001</p>
          <p className="font-mono text-[10px] text-ink-subtle">
            {formatIST(new Date(), "dd MMM yyyy")}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3 text-sm">
        <p>
          <span className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">
            Received with thanks from
          </span>
          <br />
          [Donor Name] · PAN ABCDE1234F
        </p>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">Amount</p>
          <p className="font-mono text-2xl tabular-nums">
            {formatINRWithSymbol(11_000)}
          </p>
          <p className="text-xs italic text-ink-muted">{inrInWords(11_000)}</p>
        </div>
      </div>

      <div className="mt-6 flex items-end justify-end">
        <div className="text-right">
          {signatureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={signatureUrl} alt="" className="h-10 w-32 object-contain ml-auto" />
          ) : (
            <p className="text-[10px] italic text-ink-subtle">
              Authorised signature appears here
            </p>
          )}
          <p className="mt-1 text-xs text-ink-muted border-t border-border pt-1">
            Authorised signatory
          </p>
        </div>
      </div>

      {footerText ? (
        <p className="mt-5 text-[11px] text-ink-muted whitespace-pre-line">
          {footerText}
        </p>
      ) : null}
    </div>
  );
}
