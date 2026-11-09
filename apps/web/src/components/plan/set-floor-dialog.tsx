"use client"

import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { useState } from "react"

import { withFloor } from "@/lib/runway"

import type { Runway } from "@/lib/runway"

const month = (ym: string) => formatYearMonth(ym, "MMM yyyy")

/** What the typed floor would show, in a sentence: null while the field is empty or not a floor. */
function previewOf(runway: Runway, floor: number): string {
  const r = withFloor(runway, floor)
  const under =
    r.floorState === "now"
      ? "the balance is under it today"
      : r.belowFloor
        ? `under it from ${month(r.belowFloor)} (${eur(r.belowFloorBalance!)})`
        : "the balance never goes under it"
  const out = r.runsOut ? ` Money runs out in ${month(r.runsOut)}.` : ""
  return `With this floor: ${under}.${out}`
}

/** The floor is one amount, saved for the company. Empty removes it. */
export function SetFloorDialog({
  open,
  onOpenChange,
  runway,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  runway: Runway
  onSave: (floor: number | null) => Promise<unknown>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        {open && <FloorForm runway={runway} onSave={onSave} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function FloorForm({ runway, onSave, onClose }: { runway: Runway; onSave: (floor: number | null) => Promise<unknown>; onClose: () => void }) {
  const [typed, setTyped] = useState(runway.floor == null ? "" : String(runway.floor))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const empty = typed.trim() === ""
  const amount = Number(typed)
  const valid = empty || (Number.isFinite(amount) && amount >= 0)

  const save = async (floor: number | null) => {
    setSaving(true)
    try {
      await onSave(floor)
      onClose()
    } catch {
      setError("Could not save the floor. Try again.")
    } finally {
      setSaving(false)
    }
  }

  const submit = () => {
    if (!valid) return setError("Enter 0 or more, or leave it empty for no floor.")
    void save(empty ? null : amount)
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>Set Floor</DialogTitle>
        <DialogDescription>
          The Runway marks the first month the balance would go under this amount. Leave it empty for no floor.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="runway-floor">Floor</Label>
        <Input
          id="runway-floor"
          type="number"
          step="0.01"
          inputMode="decimal"
          className="text-right tabular-nums"
          value={typed}
          onChange={(e) => {
            setError(null)
            setTyped(e.target.value)
          }}
        />
        <p className="text-meta text-muted-foreground">Saved for the company, so the phone and the laptop agree.</p>
      </div>
      {/* Always mounted: a live region that arrives with its text is often not read. */}
      <div aria-live="polite" className="text-sm text-subtle-foreground">
        {!empty && valid && previewOf(runway, amount)}
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <DialogFooter className="gap-2 sm:justify-between">
        {runway.floor != null ? (
          <Button type="button" variant="ghost" className="text-danger" disabled={saving} onClick={() => void save(null)}>
            Remove Floor
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2 max-sm:flex-col-reverse">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={submit}>
            Save
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
