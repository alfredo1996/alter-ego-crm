"use client"

import { Button } from "@alter-ego/ui/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@alter-ego/ui/ui/dropdown-menu"
import { toast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { format } from "date-fns"
import { Download, Eye, MoreHorizontal, Upload } from "lucide-react"
import Link from "next/link"
import { useId, useRef, useState } from "react"


import { downloadInvoiceFile, NO_FILE_CHANGE, saveBlob, saveInvoiceFile, type FileDraft } from "@/hooks/use-company-files"
import { rememberOpenedFromApp } from "@/lib/back-navigation"
import { checkInvoiceFile, formatFileSize, INVOICE_FILE_KIND_LABEL } from "@/lib/invoice-files"


import type { InvoiceFile, InvoiceFileKind } from "@/types"

const KIND_BADGE: Record<InvoiceFileKind, string> = { xml: "XML", p7m: "XML", pdf: "PDF" }

/**
 * The invoice file of a cost or an invoice: choose or drop one, see it, view or
 * download it, replace or remove it. It changes nothing in storage itself: a
 * picked file waits in `draft` and the form uploads it on Save, so Cancel leaves
 * nothing behind (see writeWithInvoiceFile).
 *
 * View opens a PDF in a tab; an XML or a signed XML opens as the readable invoice
 * at `viewHref` (the record's own page).
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
  /** The file the record keeps now. */
  stored: InvoiceFile | null | undefined
  draft: FileDraft
  onDraftChange: (draft: FileDraft) => void
  /** What the file is saved with: "cost" or "invoice". */
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
  const [refused, setRefused] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  function pick(file: File | undefined) {
    if (!file) return
    const check = checkInvoiceFile(file)
    if (!check.ok) return setRefused(check.reason)
    setRefused(null)
    onDraftChange({ picked: file, removed: false })
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
        pick(e.target.files?.[0])
        e.target.value = "" // The same file can be chosen again.
      }}
    />
  )
  const choose = () => input.current?.click()

  const shown = draft.picked
    ? ({ kind: "picked", file: draft.picked } as const)
    : stored && !draft.removed
      ? ({ kind: "attached", file: stored } as const)
      : null

  return (
    <div role="group" aria-label="Invoice File" className="space-y-2">
      {chooser}
      {shown?.kind === "picked" && (
        <FileRow
          kind={checkedKind(shown.file)}
          name={shown.file.name}
          meta={`${INVOICE_FILE_KIND_LABEL[checkedKind(shown.file)]} · ${formatFileSize(shown.file.size)} · saved with the ${noun}`}
        >
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onDraftChange(NO_FILE_CHANGE)}>
            Remove
          </Button>
        </FileRow>
      )}
      {shown?.kind === "attached" && (
        <FileRow
          kind={shown.file.kind}
          name={shown.file.name}
          meta={`${INVOICE_FILE_KIND_LABEL[shown.file.kind]} · ${formatFileSize(shown.file.size)} · added ${format(shown.file.uploadedAt, "d MMM")}`}
        >
          {shown.file.kind === "pdf" && (
            <Button type="button" variant="outline" size="sm" onClick={() => view(shown.file)}>
              <Eye aria-hidden className="size-4" />
              View
            </Button>
          )}
          {shown.file.kind !== "pdf" && viewHref && (disabled || unsaved) && (
            <Button type="button" variant="outline" size="sm" disabled aria-describedby={waitId}>
              <Eye aria-hidden className="size-4" />
              View
            </Button>
          )}
          {shown.file.kind !== "pdf" && viewHref && !disabled && !unsaved && (
            <Button asChild variant="outline" size="sm">
              <Link href={viewHref} onClick={rememberOpenedFromApp}>
                <Eye aria-hidden className="size-4" />
                View
              </Link>
            </Button>
          )}
          <Button type="button" variant="outline" size="icon" aria-label="Download file" onClick={() => saveInvoiceFile(shown.file).catch((err: unknown) => failed(shown.file, err))}>
            <Download aria-hidden className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="More file actions" disabled={disabled}>
                <MoreHorizontal aria-hidden className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={choose}>Replace File…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onDraftChange({ picked: null, removed: true })}>
                Remove File
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </FileRow>
      )}
      {shown?.kind === "attached" && shown.file.kind !== "pdf" && viewHref && (disabled || unsaved) && (
        <p id={waitId} className="text-xs text-muted-foreground">
          Save first to view the invoice.
        </p>
      )}
      {!shown && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            if (!disabled) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (!disabled) pick(e.dataTransfer.files[0])
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-[10px] border border-dashed bg-muted/40 p-4 text-center",
            dragging && "border-foreground bg-muted",
          )}
        >
          <Upload aria-hidden className="size-5 text-muted-foreground" />
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            <span>Drop the invoice file here, or</span>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={choose}>
              Choose File
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">XML, signed XML (.p7m) or PDF · up to 10 MB</span>
        </div>
      )}
      {!shown && stored && draft.removed && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{stored.name} is removed when you save.</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onDraftChange(NO_FILE_CHANGE)}>
            Undo
          </Button>
        </p>
      )}
      {refused && (
        <p role="alert" className="text-xs leading-relaxed text-destructive">
          {refused}
        </p>
      )}
      {hint && !shown && !refused && <p className="text-xs text-muted-foreground">{hint}</p>}
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
