"use client"

import { eurShort } from "@alter-ego/kernel/currency"
import { Button } from "@alter-ego/ui/ui/button"
import { Checkbox } from "@alter-ego/ui/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { format, parseISO } from "date-fns"
import { useId, useState } from "react"

import { roomPart } from "../details"
import { runsIn, splitPayment } from "../rent"
import { Field, toAmount, useSubmit } from "./form-kit"

import type { RentCashBook } from "../adapter"
import type { Cell } from "../rent"
import type { Lease } from "../types"

export const fullMonth = (month: string) => format(parseISO(`${month}-01`), "MMMM yyyy")

export interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  lease: Lease
  tenant: string
  month: string
  /** The month as a cell, for the amounts a month asks for. */
  cellFor: (month: string) => Cell
  /** Every month the lease runs in, for the For Month list. */
  months: string[]
  accounts: { id: string; name: string }[]
  today: string
  userId: string
  db: RentCashBook
  /** After the rows are saved, so the app can refresh the cash book. */
  onSaved: () => void
}

export function PaymentDialog({ open, onOpenChange, ...rest }: PaymentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">{open && <PaymentForm {...rest} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function PaymentForm({ lease, tenant, month: opened, cellFor, months, accounts, today, userId, db, onSaved, onClose }: Omit<PaymentDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const id = useId()
  // An agreed month asks for one amount; a part-paid month asks for what is left.
  const amountsOf = (month: string) => {
    const cell = cellFor(month)
    const one = cell.agreed || cell.paid > 0
    return { rent: String(one ? Math.max(0, cell.due - cell.paid) : lease.rent), contribution: String(one ? 0 : (lease.contribution ?? 0)) }
  }
  const [v, setV] = useState({
    month: opened,
    accountId: accounts[0]?.id ?? "",
    date: today,
    ...amountsOf(opened),
    offsetOn: false,
    offset: "",
    what: "",
    invoice: "",
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  // Set once some rows are saved and others not: saving again would write the first ones twice.
  const [partial, setPartial] = useState(false)
  const { busy, error, run } = useSubmit(() => {
    onSaved()
    onClose()
  })
  const set = (patch: Partial<typeof v>) => setV((old) => ({ ...old, ...patch }))

  const rent = toAmount(v.rent) ?? 0
  const contribution = toAmount(v.contribution) ?? 0
  const offset = v.offsetOn ? (toAmount(v.offset) ?? 0) : 0
  const total = Math.round((rent + contribution) * 100) / 100

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    const found: Record<string, string> = {}
    if (!v.accountId) found.accountId = "Account is required"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) found.date = "Date is required"
    if (!(rent >= 0)) found.rent = "Rent cannot be negative"
    if (!(contribution >= 0)) found.contribution = "Contribution cannot be negative"
    if (!(total > 0)) found.rent = "Enter an amount to record"
    if (v.offsetOn) {
      if (!(offset > 0)) found.offset = "Enter the offset amount"
      else if (offset > total) found.offset = "The offset cannot be more than the payment"
      if (!v.what.trim()) found.what = "Say what the offset is for"
    }
    setErrors(found)
    if (Object.keys(found).length) return

    const date = parseISO(v.date)
    const invoice = v.invoice.trim() || null
    void run(async () => {
      const saved: string[] = []
      try {
        for (const p of splitPayment({ rent, contribution })) {
          await db.createCompanyMovement(userId, {
            kind: "income",
            direction: "in",
            amount: p.amount,
            date,
            accountId: v.accountId,
            description: `${p.part === "rent" ? "Rent" : "Contribution"} ${fullMonth(v.month)}${roomPart(lease.room, ", ")}`,
            documentRef: invoice,
            project: lease.property,
            counterparty: lease.paidBy,
            leaseId: lease.id,
            rentMonth: v.month,
            rentPart: p.part,
          })
          saved.push(p.part)
        }
        if (offset > 0) {
          await db.createCompanyExpense(userId, {
            description: `${v.what.trim()}, taken off ${tenant}'s rent`,
            category: "other",
            amount: offset,
            vat: 0,
            date,
            accountId: v.accountId,
            project: lease.property,
            leaseId: lease.id,
            forMonth: v.month,
          })
        }
      } catch (err) {
        if (saved.length === 0) throw err
        onSaved()
        setPartial(true)
        const left = [...splitPayment({ rent, contribution }).map((p) => p.part).filter((p) => !saved.includes(p)), ...(offset > 0 ? ["offset"] : [])]
        throw new Error(`The ${saved.join(" and ")} ${saved.length > 1 ? "are" : "is"} saved, but not the ${left.join(" and ")}: ${err instanceof Error ? err.message : "could not save"}`)
      }
    })
  }

  const money = (key: "rent" | "contribution", label: string) => (
    <Field id={`${id}-${key}`} label={label} error={errors[key]}>
      <Input
        id={`${id}-${key}`}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={v[key]}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  )

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record Payment</DialogTitle>
        <DialogDescription>
          {tenant}{roomPart(lease.room)} · {lease.property}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor={`${id}-month`}>For Month</Label>
          <Select value={v.month} onValueChange={(month) => month && set({ month, ...amountsOf(month) })}>
            <SelectTrigger id={`${id}-month`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.filter((m) => runsIn(lease, m)).map((m) => (
                <SelectItem key={m} value={m}>
                  {fullMonth(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-meta text-muted-foreground">The month this pays for, whatever day it arrived.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-account`}>Account</Label>
            <Select value={v.accountId} onValueChange={(accountId) => accountId && set({ accountId })}>
              <SelectTrigger id={`${id}-account`} aria-invalid={!!errors.accountId}>
                <SelectValue placeholder={accounts.length ? "Pick an account" : "Add an account in the Cash Book first"} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.accountId && <p role="alert" className="text-sm text-danger">{errors.accountId}</p>}
          </div>
          <Field id={`${id}-date`} label="Date" error={errors.date}>
            <Input id={`${id}-date`} type="date" value={v.date} aria-invalid={!!errors.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {money("rent", "Rent")}
          {money("contribution", "Contribution")}
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Checkbox id={`${id}-offon`} checked={v.offsetOn} onCheckedChange={(c) => set({ offsetOn: c === true })} />
            <Label htmlFor={`${id}-offon`}>Less an Offset</Label>
          </div>
          {v.offsetOn && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id={`${id}-offset`} label="Offset Amount" error={errors.offset}>
                <Input id={`${id}-offset`} type="number" inputMode="decimal" min="0" step="any" value={v.offset} aria-invalid={!!errors.offset} onChange={(e) => set({ offset: e.target.value })} />
              </Field>
              <Field id={`${id}-what`} label="What For" error={errors.what}>
                <Input id={`${id}-what`} value={v.what} aria-invalid={!!errors.what} onChange={(e) => set({ what: e.target.value })} />
              </Field>
            </div>
          )}
          <p className="text-meta text-muted-foreground">Money you owed the tenant, taken off what they sent. Record the full rent above: the offset is a cost of {lease.property}, shown beside the month.</p>
        </div>

        <Field id={`${id}-invoice`} label="Invoice Number (optional)" hint="Empty until you issue it: the month shows Not invoiced.">
          <Input id={`${id}-invoice`} value={v.invoice} placeholder="e.g. 21/26" aria-describedby={`${id}-invoice-hint`} onChange={(e) => set({ invoice: e.target.value })} />
        </Field>

        <div className="rounded-lg bg-muted p-3 text-sm" aria-live="polite">
          {offset > 0 ? (
            <p>
              On the bank: <b>{eurShort(total - offset)}</b> = {eurShort(rent)} + {eurShort(contribution)} − {eurShort(offset)}
            </p>
          ) : (
            <p>
              On the bank: <b>{eurShort(total)}</b>
            </p>
          )}
          <p className="text-meta text-muted-foreground">
            Saves {splitPayment({ rent, contribution }).map((p) => `${p.part} ${eurShort(p.amount)}`).join(" and ") || "nothing yet"} as Rent &amp; Other Income
            {offset > 0 && `, and a ${eurShort(offset)} cost`}, for {fullMonth(v.month)} in {lease.property}.
          </p>
        </div>

        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || partial}>
            {busy ? "Saving…" : "Record Payment"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
