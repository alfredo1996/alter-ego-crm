"use client"

import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { useId, useState } from "react"

import { roomPart } from "../details"
import { endTenancyError } from "../lease"
import { Field, dayLabel, useSubmit } from "./form-kit"
import { money } from "./status-badge"

import type { Lease } from "../types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  lease: Lease
  tenant: string
  /** The deposit held for the tenant's room and what the row owes; null when none was recorded. */
  deposit: { held: number; owed: number } | null
  /** Moves the lease's end to this day. */
  onSubmit: (lastDay: string) => Promise<unknown>
}

export function EndTenancyDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">{open && <EndTenancyForm {...rest} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function EndTenancyForm({ lease, tenant, deposit, onSubmit, onClose }: Omit<Props, "open" | "onOpenChange"> & { onClose: () => void }) {
  const id = useId()
  const [lastDay, setLastDay] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const { busy, error, run } = useSubmit(onClose)

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    const found = endTenancyError(lease, lastDay)
    setProblem(found)
    if (!found) void run(() => onSubmit(lastDay))
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>End Tenancy</DialogTitle>
        <DialogDescription>
          {tenant}{roomPart(lease.room)} · {lease.property} · lease until {dayLabel(lease.endDate)}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id={`${id}-last`} label="Last Day" hint={`The lease ends here instead of ${dayLabel(lease.endDate)}.`} error={problem ?? undefined}>
          <Input
            id={`${id}-last`}
            type="date"
            value={lastDay}
            aria-invalid={!!problem}
            aria-describedby={problem ? `${id}-last-error` : `${id}-last-hint`}
            onChange={(e) => setLastDay(e.target.value)}
          />
        </Field>
        {deposit && (
          <p className="text-meta text-muted-foreground tabular-nums">
            Deposit held {money(deposit.held)} · owed {money(deposit.owed)}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : deposit && deposit.held > 0 ? "End and Return Deposit" : "End Tenancy"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
