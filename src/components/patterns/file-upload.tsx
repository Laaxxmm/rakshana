"use client";

import * as React from "react";
import { IconUpload, IconX, IconFile, IconAlertCircle, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Drag-and-drop file upload. Used across every document-bearing screen in
 * Phase 1+. The actual upload is delegated to a parent-supplied `onSelect`
 * callback — this component is purely UI + client-side validation.
 *
 * Server-side validation (magic-byte check) lives in
 * `src/lib/storage/validate.ts` and is enforced again in the Server Action,
 * not here. The browser check is for fast feedback only.
 */

const DEFAULT_ALLOWED = ["application/pdf", "image/png", "image/jpeg"] as const;
const DEFAULT_MAX = 10 * 1024 * 1024;

export type FileUploadProps = {
  onSelect: (file: File) => Promise<void> | void;
  /** Existing file metadata to show in the "currently attached" state. */
  current?: { name: string; url?: string; size?: number; mime?: string } | null;
  accept?: readonly string[];
  maxBytes?: number;
  label?: string;
  hint?: string;
  pending?: boolean;
  /** Custom error to display (typically from server-side rejection). */
  error?: string | null;
  /** Called when the user removes the current file. */
  onRemove?: () => void | Promise<void>;
};

function useDropzone(onFile: (file: File) => void) {
  const [dragging, setDragging] = React.useState(false);
  const handlers = React.useMemo(
    () => ({
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(true);
      },
      onDragLeave: (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      },
    }),
    [onFile],
  );
  return { dragging, handlers };
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileUpload({
  onSelect,
  current,
  accept = DEFAULT_ALLOWED,
  maxBytes = DEFAULT_MAX,
  label = "Upload file",
  hint,
  pending,
  error,
  onRemove,
}: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [clientError, setClientError] = React.useState<string | null>(null);
  const [pdfThumb, setPdfThumb] = React.useState<string | null>(null);

  const handleFile = React.useCallback(
    async (file: File) => {
      setClientError(null);
      if (!accept.includes(file.type as (typeof accept)[number])) {
        setClientError(`File type ${file.type || "unknown"} is not allowed. Use ${accept.join(", ")}.`);
        return;
      }
      if (file.size > maxBytes) {
        setClientError(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — maximum is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`,
        );
        return;
      }
      await onSelect(file);
    },
    [accept, maxBytes, onSelect],
  );

  const { dragging, handlers } = useDropzone(handleFile);

  // Lazy PDF thumbnail
  React.useEffect(() => {
    if (!current?.url || current.mime !== "application/pdf") {
      setPdfThumb(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Worker source — use a CDN fallback for now; replace with a copied
        // worker when we audit bundle size in Phase 6.
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
        const doc = await pdfjs.getDocument(current.url).promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 0.4 });
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (!cancelled) setPdfThumb(canvas.toDataURL("image/png"));
      } catch {
        if (!cancelled) setPdfThumb(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current?.url, current?.mime]);

  const displayedError = error ?? clientError;
  const acceptAttr = accept.join(",");

  return (
    <div className="space-y-2">
      {label ? (
        <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">
          {label}
        </p>
      ) : null}

      {current ? (
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface p-3">
          {pdfThumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pdfThumb} alt="" className="h-14 w-10 rounded border border-border" />
          ) : current.mime?.startsWith("image/") && current.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.url} alt="" className="h-14 w-14 rounded object-cover border border-border" />
          ) : (
            <div className="h-14 w-10 rounded border border-border bg-surface-sunken flex items-center justify-center">
              <IconFile size={20} className="text-ink-subtle" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm">{current.name}</p>
            {current.size ? (
              <p className="text-xs text-ink-subtle">{humanSize(current.size)}</p>
            ) : null}
            {current.url ? (
              <a
                href={current.url}
                target="_blank"
                rel="noopener"
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                Open
              </a>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
          >
            Replace
          </Button>
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove"
              onClick={onRemove}
              disabled={pending}
            >
              <IconX size={14} />
            </Button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          {...handlers}
          className={cn(
            "w-full rounded-md border-2 border-dashed border-border-strong bg-surface-sunken/40 px-4 py-6 text-center transition-colors",
            dragging ? "border-primary bg-primary-soft/60" : "hover:bg-surface-sunken",
            pending && "opacity-60 cursor-wait",
          )}
          disabled={pending}
        >
          <div className="flex flex-col items-center gap-1.5 text-sm text-ink-muted">
            {pending ? (
              <IconLoader2 size={20} className="animate-spin" />
            ) : (
              <IconUpload size={20} />
            )}
            <span>
              {pending ? "Uploading…" : "Drag a file here, or click to choose"}
            </span>
            <span className="text-xs text-ink-subtle">
              {accept.map((m) => m.replace("application/", "").replace("image/", "")).join(" · ")}
              {" · max "} {(maxBytes / 1024 / 1024).toFixed(0)} MB
            </span>
          </div>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={acceptAttr}
        disabled={pending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          // Allow re-uploading the same file
          e.target.value = "";
        }}
      />

      {displayedError ? (
        <p className="flex items-start gap-1.5 text-xs text-[color:var(--danger)]">
          <IconAlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{displayedError}</span>
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
