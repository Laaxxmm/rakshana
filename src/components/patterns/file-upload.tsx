"use client";

import * as React from "react";
import {
  IconUpload,
  IconX,
  IconFile,
  IconAlertCircle,
  IconLoader2,
  IconCamera,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { humanBytes, tooLargeMessage } from "@/lib/images/limits";
import { cn } from "@/lib/utils";

/**
 * File upload. Used across every document-bearing screen in Phase 1+. The
 * actual upload is delegated to a parent-supplied `onSelect` callback — this
 * component is purely UI + client-side validation.
 *
 * Two tap targets, plus drop-anywhere for a mouse. "Take photo" points a
 * second input at the camera with the `capture` attribute, because the bill
 * being attached is usually still lying on the table in front of the person
 * holding the phone, and a drop zone does nothing on a touch screen.
 *
 * Server-side validation (magic-byte check) lives in
 * `src/lib/storage/validate.ts` and is enforced again in the Server Action,
 * not here. The browser check is not only for speed: an oversized file sent
 * to a Server Action is base64-encoded, and Next.js rejects a body over its
 * own limit with a framework error the user cannot act on. Refusing here is
 * what turns that into a sentence naming the limit.
 */

const DEFAULT_ALLOWED = ["application/pdf", "image/png", "image/jpeg"] as const;
const DEFAULT_MAX = 10 * 1024 * 1024;

export type FileUploadProps = {
  onSelect: (file: File) => Promise<void> | void;
  /**
   * Accept several files per pick/drop. `onSelect` is still called once per
   * file; the caller owns the resulting list (see the expense form, where the
   * bills stay client-side until the voucher is submitted).
   */
  multiple?: boolean;
  /** Existing file metadata to show in the "currently attached" state. */
  current?: { name: string; url?: string; size?: number; mime?: string } | null;
  accept?: readonly string[];
  maxBytes?: number;
  /**
   * Tighter ceiling applied to PDFs only, for screens whose Server Action
   * caps them separately — the expense bill upload does, because a photo is
   * reliably shrunk to WebP on arrival while a PDF is only shrunk if
   * ghostscript can improve it (PDF_MAX_BYTES in `@/lib/images/limits`).
   * Left unset, PDFs share `maxBytes`.
   */
  maxPdfBytes?: number;
  label?: string;
  hint?: string;
  pending?: boolean;
  /** Custom error to display (typically from server-side rejection). */
  error?: string | null;
  /** Called when the user removes the current file. */
  onRemove?: () => void | Promise<void>;
};

function useDropzone(onFiles: (files: FileList) => void) {
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
        if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
      },
    }),
    [onFiles],
  );
  return { dragging, handlers };
}

/**
 * Shared by every screen that lists attached files. Same formatter the
 * refusal messages use, so a file listed as "2.4 MB" is refused as "2.4 MB".
 */
export const humanSize = humanBytes;

export function FileUpload({
  onSelect,
  multiple = false,
  current,
  accept = DEFAULT_ALLOWED,
  maxBytes = DEFAULT_MAX,
  maxPdfBytes,
  label = "Upload file",
  hint,
  pending,
  error,
  onRemove,
}: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const handleFiles = React.useCallback(
    async (files: FileList) => {
      setClientError(null);
      for (const file of multiple ? Array.from(files) : files[0] ? [files[0]] : []) {
        if (!accept.includes(file.type as (typeof accept)[number])) {
          setClientError(`File type ${file.type || "unknown"} is not allowed. Use ${accept.join(", ")}.`);
          continue;
        }
        const limit =
          file.type === "application/pdf" && maxPdfBytes ? maxPdfBytes : maxBytes;
        if (file.size > limit) {
          setClientError(tooLargeMessage(file.name, file.size, limit));
          continue;
        }
        await onSelect(file);
      }
    },
    [accept, maxBytes, maxPdfBytes, multiple, onSelect],
  );

  const { dragging, handlers } = useDropzone(handleFiles);

  const displayedError = error ?? clientError;
  const acceptAttr = accept.join(",");
  // The camera can only ever hand back a photo, so it is offered where photos
  // are allowed and its own accept list is narrowed to them — a camera input
  // that also advertises application/pdf opens the file browser on some
  // Androids instead of the lens.
  const cameraAccept = accept.filter((m) => m.startsWith("image/"));

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    // Allow re-uploading the same file
    e.target.value = "";
  };

  return (
    <div className="space-y-2">
      {label ? (
        <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">
          {label}
        </p>
      ) : null}

      {current ? (
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface p-3">
          {current.mime?.startsWith("image/") && current.url ? (
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
            className="h-11 sm:h-7"
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
              className="size-11 sm:size-8"
              aria-label="Remove"
              onClick={onRemove}
              disabled={pending}
            >
              <IconX size={14} />
            </Button>
          ) : null}
        </div>
      ) : (
        <div
          {...handlers}
          className={cn(
            "space-y-2 rounded-md border-2 border-dashed border-border-strong bg-surface-sunken/40 p-3 text-center transition-colors",
            dragging && "border-primary bg-primary-soft/60",
            pending && "opacity-60",
          )}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            {cameraAccept.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 flex-1 sm:h-9"
                onClick={() => cameraRef.current?.click()}
                disabled={pending}
              >
                <IconCamera size={18} />
                Take photo
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 sm:h-9"
              onClick={() => inputRef.current?.click()}
              disabled={pending}
            >
              {pending ? (
                <IconLoader2 size={18} className="animate-spin" />
              ) : (
                <IconUpload size={18} />
              )}
              {pending ? "Uploading…" : multiple ? "Choose files" : "Choose file"}
            </Button>
          </div>
          {/* Drag-and-drop is still wired on the whole box, but only a pointer
              can use it, so only a wide viewport is told about it. */}
          <p className="hidden text-xs text-ink-muted sm:block">
            or drop {multiple ? "files" : "a file"} here
          </p>
          <p className="text-xs text-ink-subtle">
            {accept.map((m) => m.replace("application/", "").replace("image/", "")).join(" · ")}
            {` · max ${humanBytes(maxBytes)}`}
            {maxPdfBytes ? ` (PDF ${humanBytes(maxPdfBytes)})` : null}
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={acceptAttr}
        multiple={multiple}
        disabled={pending}
        onChange={onInputChange}
      />

      {cameraAccept.length > 0 ? (
        <input
          ref={cameraRef}
          type="file"
          className="hidden"
          accept={cameraAccept.join(",")}
          capture="environment"
          multiple={multiple}
          disabled={pending}
          onChange={onInputChange}
        />
      ) : null}

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
