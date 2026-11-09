"use client"

import { formatYearMonth } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Plus } from "lucide-react"
import { useId, useState } from "react"

import { MoneyInput } from "@/components/money-input"
import { eurCents } from "@/lib/invoices"

import type { FeeChange } from "@/types"

const MAX_CHANGES = 24
const mon = (yearMonth: string) => formatYearMonth(yearMonth, "MMM yyyy")

/**
 * A recurring cost's dated price changes, in the shape of a collaborator's fee changes: the list, Add Change, and
 * an inline pair (month, new price) kept with Save Change. `onDraft` says a pair is typed and not kept, so the
 * dialog can refuse to save and lose it silently.
 */
export function PriceChangesField({
  changes,
  onChange,
  start,
  end,
  onDraft,
  error,
}: {
  changes: FeeChange[]
  onChange: (next: FeeChange[]) => void
  /** "YYYY-MM": the month the cost starts; a change falls after it. */
  start: string
  /** "YYYY-MM", or "" for no end; a change falls on or before it. */
  end: string
  onDraft: (dirty: boolean) => void
  error?: string
}) {
  const id = useId()
  const [adding, setAdding] = useState(false)
  const [from, setFrom] = useState("")
  const [amount, setAmount] = useState("")
  const [problem, setProblem] = useState<string | null>(null)

  const close = () => {
    setAdding(false)
    setFrom("")
    setAmount("")
    setProblem(null)
    onDraft(false)
  }
  const keep = () => {
    const price = Number(amount)
    const found = !/^\d{4}-(0[1-9]|1[0-2])$/.test(from)
      ? "Pick the month the new price starts."
      : !Number.isFinite(price) || price <= 0
        ? "Enter the new price, above 0."
        : start && from <= start
          ? "A change starts after the cost does."
          : end && from > end
            ? "A change falls after the end."
            : changes.some((c) => c.from === from)
              ? "Two changes start in the same month."
              : changes.length >= MAX_CHANGES
                ? `At most ${MAX_CHANGES} changes.`
                : null
    if (found) return setProblem(found)
    onChange([...changes, { from, amount: price }].sort((a, b) => a.from.localeCompare(b.from)))
    close()
  }
  const typing = (setter: (v: string) => void) => (e: { target: { value: string } }) => {
    setter(e.target.value)
    onDraft(true)
  }
  const shown = problem ?? error

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Price Changes</span>
        {!adding && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add Change
          </Button>
        )}
      </div>
      {changes.length > 0 && (
        <ul className="space-y-1.5">
          {changes.map((c) => (
            <li key={c.from} className="flex items-center gap-3 rounded-md bg-muted px-3 py-2 text-sm">
              <span className="font-medium">From {mon(c.from)}</span>
              <span className="flex-1 tabular-nums">{eurCents(c.amount)} each time</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove the change from ${mon(c.from)}`}
                onClick={() => onChange(changes.filter((x) => x !== c))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor={`${id}-from`}>Change From</Label>
            <Input id={`${id}-from`} type="month" value={from} aria-invalid={!!shown} aria-describedby={shown ? `${id}-error` : undefined} onChange={typing(setFrom)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-amount`}>New Amount Each Time</Label>
            <MoneyInput id={`${id}-amount`} min="0" value={amount} aria-invalid={!!shown} aria-describedby={shown ? `${id}-error` : undefined} onChange={typing(setAmount)} />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={keep}>
              Save Change
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel Change
            </Button>
          </div>
        </div>
      )}
      {shown && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {shown}
        </p>
      )}
      <p className="text-meta text-muted-foreground">A change applies from its month on, until the next change or the end.</p>
    </div>
  )
}
