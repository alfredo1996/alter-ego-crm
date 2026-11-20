"use client"


import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { Button } from "@alter-ego/ui/ui/button"
import { CalendarDays, CreditCard, Trash2, X } from "lucide-react"

import { useCurrency } from "../../hooks/use-currency"

import type { SelectionSummary } from "../../lib/selection-summary"

interface BulkActionBarProps {
  summary: SelectionSummary
  onDelete: () => void
  onChangeAccount: () => void
  onChangeDate: () => void
  onClear: () => void
}

export function BulkActionBar({
  summary,
  onDelete,
  onChangeAccount,
  onChangeDate,
  onClear,
}: BulkActionBarProps) {
  const { format } = useCurrency()
  if (summary.count === 0) return null

  const { counted, transfers } = summary
  const figures: [string, number | null, "in" | "out" | undefined][] = [
    ["In", summary.in, "in"],
    ["Out", summary.out, "out"],
    ["Average", summary.average, undefined],
    ["Largest", summary.largest, undefined],
    ["Smallest", summary.smallest, undefined],
  ]
  // Mixed currencies fall back to the default one, with the note below.
  const inCurrency = (n: number) => format(n, summary.currency ?? undefined)
  const figure = (label: string, value: number | null, kind?: "in" | "out") => (
    <div key={label} className="flex items-baseline gap-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>{" "}
      <dd className="text-sm"><SignedAmount amount={value ?? 0} kind={kind} format={inCurrency} /></dd>
    </div>
  )
  const notes = [
    transfers > 0 && `${transfers} ${transfers === 1 ? "transfer" : "transfers"} not counted`,
    summary.mixedCurrencies && "Mixed currencies",
  ].filter(Boolean)

  // The bar is fixed and taller than main's bottom padding: the spacer lets the page
  // scroll its pagination footer and last row clear of it.
  return (
    <>
    <div aria-hidden="true" className="h-40 sm:h-24" />
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg">
      <div className="mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 sm:justify-start">
            <span className="text-sm font-medium">{summary.count} selected</span>
            {counted > 0 && <dl className="m-0">{figure("Net", summary.net)}</dl>}
          </div>
          {counted > 0 && (
            <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:flex sm:flex-wrap sm:gap-x-5">
              {figures.map(([label, value, kind]) => figure(label, value, kind))}
            </dl>
          )}
          {notes.length > 0 && <p className="text-xs text-muted-foreground">{notes.join(" · ")}</p>}
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="pointer-coarse:min-w-11" aria-label="Change Account" onClick={onChangeAccount}>
            <CreditCard className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Change Account</span>
          </Button>
          <Button variant="outline" size="sm" className="pointer-coarse:min-w-11" aria-label="Change Date" onClick={onChangeDate}>
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Change Date</span>
          </Button>
          <Button variant="destructive" size="sm" className="pointer-coarse:min-w-11" aria-label="Delete Selected" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Delete Selected</span>
          </Button>
          <Button variant="ghost" size="sm" className="pointer-coarse:min-w-11" aria-label="Clear" onClick={onClear}>
            <X className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>
      </div>
    </div>
    </>
  )
}
