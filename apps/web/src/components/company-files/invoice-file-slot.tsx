"use client"

import { Button } from "@alter-ego/ui/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@alter-ego/ui/ui/dropdown-menu"
import { toast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { format } from "date-fns"
import { Download, Eye, MoreHorizontal, Upload } from "lucide-react"
import Link from "next/link"
import { useId, useRef, useState } from "react"


import { downloadInvoiceFile, saveBlob, saveInvoiceFile, type FileDraft } from "@/hooks/use-company-files"
import { rememberOpenedFromApp } from "@/lib/back-navigation"
import { checkInvoiceFile, fileIdOf, formatFileSize, INVOICE_FILE_KIND_LABEL } from "@/lib/invoice-files"
import { INVOICE_FILES_MAX } from "@/types/schemas"


import type { InvoiceFile, InvoiceFileKind } from "@/types"

const KIND_BADGE: Record<InvoiceFileKind, string> = { xml: "XML", p7m: "XML", pdf: "PDF" }

/**
 * The invoice files of a cost or an invoice: one row each, with a zone to add another (one file
 * at a time). Each can be viewed, downloaded, replaced or removed on its own. It changes nothing
 * in storage itself: picked files wait in `draft` and the form uploads them on Save, so Cancel
 * leaves nothing behind (see writeWithInvoiceFiles).
 *
 * View opens a PDF in a tab; an XML or a signed XML opens as the readable invoice
 * at `viewHref` (the record's own page), with `?file=` naming which.
 */
export function InvoiceFileSlot({
  stored,
  draft,
  onDraftChange,
  noun,
  hint,
  disabled,
  viewHref,
  unsaved,
}: {
  /** The files the record keeps now. */
  stored: InvoiceFile[]
  draft: FileDraft
  onDraftChange: (draft: FileDraft) => void
  /** What the files are saved with: "cost" or "invoice". */
  noun: "cost" | "invoice"
  hint?: string
  disabled?: boolean
  /** Where an XML opens as an invoice; without it an XML has no View. */
  viewHref?: string
  /** The form has changes not saved yet: the page View opens reads the saved record, so View waits for Save. */
  unsaved?: boolean
}) {
  const waitId = useId()
  const input = useRef<HTMLInputElement>(null)
  /** The stored file Replace File… was chosen on: marked removed only once the new one is picked. */
  const replacing = useRef<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const kept = stored.filter((f) => !draft.removed.includes(f.path))
  const count = kept.length + draft.picked.length
  const full = count >= INVOICE_FILES_MAX
  const An = noun === "cost" ? "A cost" : "An invoice"

  /** `replaced` is the stored file Replace File… was chosen on; a drop never replaces. */
  function pick(file: File | undefined, replaced: string | null) {
    if (!file) return
    const check = checkInvoiceFile(file)
    if (!check.ok) return setRefused(check.reason)
    // Replacing takes one file away as it adds one, so it never passes the cap.
    if (!replaced && full) return setRefused(`${file.name} can't be attached: ${An.toLowerCase()} holds up to ${INVOICE_FILES_MAX} files.`)
    setRefused(null)
    onDraftChange({ picked: [...draft.picked, file], removed: replaced ? [...draft.removed, replaced] : draft.removed })
  }

  /** A PDF opens in a tab. */
  async function view(file: InvoiceFile) {
    // The tab opens on the click, before the await: Safari and iOS block a window.open that follows one.
    const tab = window.open("about:blank", "_blank")
    if (tab) tab.opener = null
    try {
      const blob = await downloadInvoiceFile(file)
      if (tab) {
        const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }))
        tab.location.href = url
        // The tab needs a moment to take the URL.
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } else {
        // The browser refused a tab: save it instead.
        saveBlob(blob, file.name)
      }
    } catch (err) {
      tab?.close()
      failed(file, err)
    }
  }

  const failed = (file: InvoiceFile, err: unknown) =>
    toast({
      variant: "destructive",
      title: `${file.name} could not be opened`,
      description: err instanceof Error ? err.message : "Unknown error",
    })

  const chooser = (
    <input
      ref={input}
      type="file"
      className="sr-only"
      tabIndex={-1}
      aria-label="Choose invoice file"
      accept=".xml,.p7m,.pdf,application/xml,text/xml,application/pdf"
      disabled={disabled}
      onChange={(e) => {
        const replaced = replacing.current
        replacing.current = null
        pick(e.target.files?.[0], replaced)
        e.target.value = "" // The same file can be chosen again.
      }}
    />
  )
  const choose = (replace: string | null = null) => {
    replacing.current = replace
    input.current?.click()
  }

  const waits = (f: InvoiceFile) => f.kind !== "pdf" && viewHref !== undefined && (disabled || unsaved)
  const waiting = stored.some((f) => !draft.removed.includes(f.path) && waits(f))
  const dropZone = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      if (!disabled) setDragging(true)
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      replacing.current = null
      if (!disabled) pick(e.dataTransfer.files[0], null)
    },
  }

  return (
    <div role="group" aria-label="Invoice Files" className="space-y-2">
      {chooser}
      {stored.map((file) =>
        draft.removed.includes(file.path) ? (
          <p key={file.path} className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{file.name} is removed when you save.</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => onDraftChange({ ...draft, removed: draft.removed.filter((p) => p !== file.path) })}
            >
              Undo
            </Button>
          </p>
        ) : (
          <FileRow
            key={file.path}
            kind={file.kind}
            name={file.name}
            meta={`${INVOICE_FILE_KIND_LABEL[file.kind]} · ${formatFileSize(file.size)} · added ${format(file.uploadedAt, "d MMM")}`}
          >
            {file.kind === "pdf" && (
              <Button type="button" variant="outline" size="sm" aria-label={`View ${file.name}`} onClick={() => view(file)}>
                <Eye aria-hidden className="size-4" />
                View
              </Button>
            )}
            {waits(file) && (
              <Button type="button" variant="outline" size="sm" disabled aria-label={`View ${file.name}`} aria-describedby={waitId}>
                <Eye aria-hidden className="size-4" />
                View
              </Button>
            )}
            {file.kind !== "pdf" && viewHref && !disabled && !unsaved && (
              <Button asChild variant="outline" size="sm">
                <Link href={`${viewHref}?file=${fileIdOf(file.path)}`} aria-label={`View ${file.name}`} onClick={rememberOpenedFromApp}>
                  <Eye aria-hidden className="size-4" />
                  View
                </Link>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={`Download ${file.name}`}
              onClick={() => saveInvoiceFile(file).catch((err: unknown) => failed(file, err))}
            >
              <Download aria-hidden className="size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label={`More actions for ${file.name}`} disabled={disabled}>
                  <MoreHorizontal aria-hidden className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => choose(file.path)}>Replace File…</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onDraftChange({ ...draft, removed: [...draft.removed, file.path] })}>
                  Remove File
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </FileRow>
        ),
      )}
      {draft.picked.map((file, i) => (
        <FileRow
          key={`${file.name}-${i}`}
          kind={checkedKind(file)}
          name={file.name}
          meta={`${INVOICE_FILE_KIND_LABEL[checkedKind(file)]} · ${formatFileSize(file.size)} · saved with the ${noun}`}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`Remove ${file.name}`}
            onClick={() => onDraftChange({ ...draft, picked: draft.picked.filter((_, n) => n !== i) })}
          >
            Remove
          </Button>
        </FileRow>
      ))}
      {waiting && (
        <p id={waitId} className="text-xs text-muted-foreground">
          Save first to view the invoice.
        </p>
      )}
      {count === 0 && (
        <div
          {...dropZone}
          className={cn(
            "flex flex-col items-center gap-2 rounded-[10px] border border-dashed bg-muted/40 p-4 text-center",
            dragging && "border-foreground bg-muted",
          )}
        >
          <Upload aria-hidden className="size-5 text-muted-foreground" />
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            <span>Drop the invoice file here, or</span>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => choose()}>
              Choose File
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">XML, signed XML (.p7m) or PDF · up to 10 MB</span>
        </div>
      )}
      {count > 0 && !full && (
        <>
          <div
            {...dropZone}
            className={cn(
              "flex flex-wrap items-center gap-x-2 gap-y-2 rounded-[10px] border border-dashed bg-muted/40 px-3 py-2.5 text-sm",
              dragging && "border-foreground bg-muted",
            )}
          >
            <Upload aria-hidden className="size-4 text-muted-foreground" />
            <span>Drop another file here, or</span>
            <Button type="button" variant="outline" size="sm" className="max-sm:w-full" disabled={disabled} onClick={() => choose()}>
              Add File
            </Button>
          </div>
          <span className="block text-xs text-muted-foreground">XML, signed XML (.p7m) or PDF · up to 10 MB</span>
        </>
      )}
      {full && (
        <p className="text-xs text-muted-foreground">
          {An} holds up to {INVOICE_FILES_MAX} files: remove one to add another.
        </p>
      )}
      {refused && (
        <p role="alert" className="text-xs leading-relaxed text-destructive">
          {refused}
        </p>
      )}
      {hint && !refused && (count === 0 || !full) && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** A picked file has passed checkInvoiceFile, so its kind is known. */
function checkedKind(file: File): InvoiceFileKind {
  const check = checkInvoiceFile(file)
  return check.ok ? check.kind : "pdf"
}

function FileRow({ kind, name, meta, children }: { kind: InvoiceFileKind; name: string; meta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border p-2.5">
      <div
        aria-hidden
        className="flex size-10 flex-none items-center justify-center rounded-lg bg-muted font-mono text-[10.5px] font-semibold text-muted-foreground"
      >
        {KIND_BADGE[kind]}
      </div>
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
        <span className="truncate text-sm font-medium" title={name}>
          {name}
        </span>
        <span className="text-xs text-muted-foreground">{meta}</span>
      </div>
      <div className="ml-auto flex items-center gap-1.5">{children}</div>
    </div>
  )
}
