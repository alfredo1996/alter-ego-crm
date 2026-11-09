"use client"

import { eurShort } from "@alter-ego/kernel/currency"
import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { useId, useState } from "react"

import { roomPart } from "../details"
import { renewalOf } from "../lease"
import { createLeaseSchema } from "../schemas"
import { Field, dayLabel, fieldErrors, toAmount, useSubmit } from "./form-kit"

import type { CreateLeaseInput, Lease } from "../types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The lease being renewed. */
  lease: Lease
  tenant: string
  onSubmit: (input: CreateLeaseInput) => Promise<unknown>
}

export function RenewDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">{open && <RenewForm {...rest} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function RenewForm({ lease, tenant, onSubmit, onClose }: Omit<Props, "open" | "onOpenChange"> & { onClose: () => void }) {
  const id = useId()
  const next = renewalOf(lease)
  const [v, setV] = useState({
    startDate: next.startDate,
    endDate: next.endDate,
    rent: String(next.rent),
    contribution: next.contribution != null ? String(next.contribution) : "",
    paidBy: next.paidBy ?? "",
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { busy, error, run } = useSubmit(onClose)

  const field = (key: keyof typeof v, label: string, extra: { type?: string; hint?: string; placeholder?: string; money?: boolean } = {}) => (
    <Field id={`${id}-${key}`} label={label} hint={extra.hint} error={errors[key]}>
      <Input
        id={`${id}-${key}`}
        type={extra.money ? "number" : extra.type}
        inputMode={extra.money ? "decimal" : undefined}
        min={extra.money ? "0" : undefined}
        step={extra.money ? "any" : undefined}
        value={v[key]}
        placeholder={extra.placeholder}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `${id}-${key}-error` : extra.hint ? `${id}-${key}-hint` : undefined}
        onChange={(e) => setV({ ...v, [key]: e.target.value })}
      />
    </Field>
  )

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    const parsed = createLeaseSchema.safeParse({ ...next, ...v, rent: toAmount(v.rent), contribution: toAmount(v.contribution) })
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    void run(() => onSubmit(parsed.data))
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Renew Lease</DialogTitle>
        <DialogDescription>
          {tenant}{roomPart(lease.room)} · {lease.property}. The current lease ends on {dayLabel(lease.endDate)}.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("startDate", "Start", { type: "date", hint: "The day after the current end." })}
          {field("endDate", "End", { type: "date", hint: "A year on." })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("rent", "Rent a Month", { money: true, hint: `Was ${eurShort(lease.rent)}.` })}
          {field("contribution", "Contribution a Month (optional)", { money: true, placeholder: "None" })}
        </div>
        {field("paidBy", "Paid By (optional)", { placeholder: "The tenant" })}
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-subtle-foreground">A new lease from the day after this one ends. The current one stays as it was.</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Renew"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
