"use client"

import { eurShort } from "@alter-ego/kernel/currency"
import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { format } from "date-fns"
import { useId, useState } from "react"

import { roomPart } from "../details"
import { withoutMonth } from "../rent"
import { Field, dayLabel, toAmount, useSubmit } from "./form-kit"
import { fullMonth } from "./payment-dialog"
import { StatusBadge } from "./status-badge"

import type { Cell } from "../rent"
import type { AgreedMonth, Lease } from "../types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  lease: Lease
  tenant: string
  month: string
  cell: Cell
  /** Replaces the lease's agreed months. */
  onSaveAgreed: (agreedMonths: Record<string, AgreedMonth>) => Promise<unknown>
  onRecordPayment: () => void
}

export function CellDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">{open && <CellForm {...rest} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function CellForm({ lease, tenant, month, cell, onSaveAgreed, onRecordPayment, onClose }: Omit<Props, "open" | "onOpenChange"> & { onClose: () => void }) {
  const id = useId()
  const [amount, setAmount] = useState(cell.agreed ? String(cell.agreed.amount) : "")
  const [note, setNote] = useState(cell.agreed?.note ?? "")
  const [problem, setProblem] = useState<string | null>(null)
  const { busy, error, run } = useSubmit(onClose)
  const standard = Math.round((lease.rent + (lease.contribution ?? 0)) * 100) / 100

  const save = (ev: React.FormEvent) => {
    ev.preventDefault()
    const value = toAmount(amount)
    const others = withoutMonth(lease.agreedMonths, month)
    if (value === undefined) return void run(() => (cell.agreed ? onSaveAgreed(others) : Promise.resolve()))
    if (!(value >= 0)) return setProblem("The agreed amount cannot be negative")
    setProblem(null)
    void run(() => onSaveAgreed({ ...others, [month]: { amount: value, note: note.trim() } }))
  }
  const remove = () => {
    const others = withoutMonth(lease.agreedMonths, month)
    void run(() => onSaveAgreed(others))
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{fullMonth(month)}</DialogTitle>
        <DialogDescription>
          {tenant}{roomPart(lease.room)}
        </DialogDescription>
      </DialogHeader>
      <StatusBadge cell={cell} />
      <dl className="grid grid-cols-3 gap-2 text-sm">
        {[
          ["Lease", standard],
          ...(cell.agreed ? [["Agreed", cell.agreed.amount] as const] : []),
          ["Paid", cell.paid],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-muted p-2">
            <dt className="text-meta text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums">{eurShort(value as number)}</dd>
          </div>
        ))}
      </dl>

      <section aria-label="Payments for This Month" className="space-y-1">
        <h3 className="text-sm font-medium">Payments for This Month</h3>
        {cell.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded for this month.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {cell.payments.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 px-3 py-2">
                <span>
                  {dayLabel(format(p.date, "yyyy-MM-dd"))} · {p.rentPart === "contribution" ? "Contribution" : "Rent"}
                  <span className="block text-meta text-muted-foreground">{p.documentRef?.trim() ? `invoice ${p.documentRef.trim()}` : "No invoice number"}</span>
                </span>
                <b className="tabular-nums">{eurShort(p.amount)}</b>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={save} className="space-y-3" noValidate>
        <h3 className="text-sm font-medium">Agreed Amount</h3>
        <Field id={`${id}-amount`} label="For This Month" error={problem ?? undefined}>
          <Input id={`${id}-amount`} type="number" inputMode="decimal" min="0" step="any" value={amount} placeholder={String(standard)} aria-invalid={!!problem} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id={`${id}-note`} label="Note" hint={`Replaces rent and contribution for ${fullMonth(month).split(" ")[0]} only.`}>
          <Input id={`${id}-note`} value={note} aria-describedby={`${id}-note-hint`} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" onClick={onRecordPayment}>
            Record Payment
          </Button>
          <span className="flex flex-col-reverse gap-2 sm:flex-row">
            {cell.agreed && (
              <Button type="button" variant="outline" disabled={busy} onClick={remove}>
                Remove Agreed
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </span>
        </DialogFooter>
      </form>
    </>
  )
}
