"use client"


import { Button } from "@alter-ego/ui/ui/button"
import { Checkbox } from "@alter-ego/ui/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Label } from "@alter-ego/ui/ui/label"
import { toast } from "@alter-ego/ui/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { IMPORT_QUERY_KEYS, Progress } from "@/components/cash-book/import-dialog"
import { getBackend } from "@/lib/backend"
import { dayLabel } from "@/lib/cash-book"
import { planUndo } from "@/lib/prima-nota"

import type { DatabaseAdapter } from "@/lib/backend"
import type { AppData, UndoStep } from "@/lib/prima-nota"

const LIST = 8

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Undo Import: removes what the workbook import created, found by its importRef,
 * so it works after a reload or a half-finished import. Rows changed since are
 * listed and kept unless the owner ticks them too.
 */
export function UndoImportDialog({
  userId,
  open,
  onOpenChange,
  onCloseAutoFocus,
  data,
}: {
  userId: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
  data: Pick<AppData, "accounts" | "invoices" | "expenses" | "loans" | "movements">
}) {
  const queryClient = useQueryClient()
  const [deleteEdited, setDeleteEdited] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const undo = planUndo(data, deleteEdited)
  const { counts, edited, keptAccounts, invoiceNumbers, stays } = undo
  const busy = progress !== null && error === null

  async function run() {
    const steps = undo.steps
    setError(null)
    setProgress({ done: 0, total: steps.length })
    let done = 0
    try {
      for (const step of steps) {
        await apply(getBackend().db, userId!, step)
        setProgress({ done: ++done, total: steps.length })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "A delete was refused.")
    }
    await Promise.all(IMPORT_QUERY_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
    if (done === steps.length) {
      toast({ title: `Import undone: ${undone}.` })
      setProgress(null)
      onOpenChange(false)
    }
  }

  const records = counts.costs + counts.loans + counts.movements
  const undone = [
    plural(records, "record", "records") + " deleted",
    counts.invoices && `${plural(counts.invoices, "invoice", "invoices")} without the account`,
    counts.accounts && `${plural(counts.accounts, "account", "accounts")} deleted`,
  ]
    .filter(Boolean)
    .join(", ")
  const kept = [
    stays.createdInvoices && `${plural(stays.createdInvoices, "invoice", "invoices")} it created, real ${stays.createdInvoices === 1 ? "document" : "documents"}`,
    stays.settled && `${plural(stays.settled, "invoice or credit note", "invoices and credit notes")} it settled with no money`,
    stays.unpaid && `${plural(stays.unpaid, "invoice", "invoices")} it marked unpaid`,
    stays.estimates && `its change to the start date or VAT of ${plural(stays.estimates, "recurring cost", "recurring costs")}`,
  ].filter(Boolean)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        setProgress(null)
        setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent size="md" onCloseAutoFocus={onCloseAutoFocus} onEscapeKeyDown={(e) => busy && e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Undo Import</DialogTitle>
          <DialogDescription>
            Removes the records and accounts the workbook import created and the account on the invoices it marked paid,
            so you can import the workbook again.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            Deletes {plural(records, "record", "records")}
            {records > 0 &&
              `: ${[
                counts.costs && plural(counts.costs, "cost", "costs"),
                counts.loans && plural(counts.loans, "shareholder loan", "shareholder loans"),
                counts.movements && plural(counts.movements, "movement", "movements"),
              ]
                .filter(Boolean)
                .join(", ")}`}
            .
          </li>
          {counts.invoices > 0 && (
            <li className="[overflow-wrap:anywhere]">
              {counts.invoices} {counts.invoices === 1 ? "invoice it marked paid loses" : "invoices it marked paid lose"} the
              account; the payment date stays, the workbook proved it: {invoiceNumbers.slice(0, LIST).join(", ")}
              {invoiceNumbers.length > LIST ? ` and ${invoiceNumbers.length - LIST} more` : ""}.
            </li>
          )}
          {counts.accounts > 0 && (
            <li>
              Deletes the {counts.accounts} {counts.accounts === 1 ? "account" : "accounts"} it created.
            </li>
          )}
          {keptAccounts.length > 0 && (
            <li>
              Keeps {keptAccounts.join(" and ")}: {keptAccounts.length === 1 ? "it holds" : "they hold"} rows that did not come
              from the workbook.
            </li>
          )}
          {kept.length > 0 && <li>Stays as the import left it: {kept.join("; ")}.</li>}
          <li className="text-muted-foreground">
            Rows it replaced are not brought back. Their data, and the values from before of what stays, are in the import
            report: Import saved it to your downloads when it replaced rows.
          </li>
        </ul>
        {edited.length > 0 && (
          <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
            <p className="font-medium">Changed since the import: kept, unless you tick the box.</p>
            <ul className="space-y-0.5">
              {edited.slice(0, LIST).map((e) => (
                <li key={e.id} className="[overflow-wrap:anywhere]">
                  {e.description}, {dayLabel(e.day)}
                </li>
              ))}
              {edited.length > LIST && <li className="text-muted-foreground">and {edited.length - LIST} more</li>}
            </ul>
            <div className="flex items-start gap-2">
              <Checkbox id="undo-edited" checked={deleteEdited} disabled={busy} onCheckedChange={(v) => setDeleteEdited(v === true)} className="mt-0.5" />
              <Label htmlFor="undo-edited" className="font-normal leading-snug">
                {edited.length === 1 ? "Also delete this row" : `Also delete these ${edited.length} rows`}
              </Label>
            </div>
          </div>
        )}
        {progress && (
          <div className="space-y-2 text-sm">
            <p aria-live="polite">
              {progress.done} of {progress.total} done…
            </p>
            <Progress value={progress.done} max={progress.total} label="Undo progress" />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            Stopped: {error} Try again: Undo goes on from what is left.
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy || undo.steps.length === 0} onClick={() => void run()}>
            {error ? "Try Again" : "Undo Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

async function apply(db: DatabaseAdapter, userId: string, step: UndoStep) {
  switch (step.op) {
    case "delete_movement":
      return db.deleteCompanyMovement(userId, step.id)
    case "delete_loan":
      return db.deleteCompanyLoan(userId, step.id)
    case "delete_expense":
      return db.deleteCompanyExpense(userId, step.id)
    case "clear_invoice":
      await db.updateInvoice(userId, step.id, { paidAccountId: null })
      return
    case "delete_account":
      return db.deleteCompanyAccount(userId, step.id)
  }
}
