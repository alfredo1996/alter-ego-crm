/**
 * Collaborators' fixed monthly fees: the amount in force in a month, and the
 * figures the page and the Projection read off it. Net of VAT, no payroll, no
 * taxes. Inactive collaborators are out of every figure here: "Active" is
 * "shown in the list and the plan".
 */

import { formatYearMonth, quarterMonths } from "@alter-ego/kernel/dates"

import type { Collaborator, CollaboratorFee, FeeChange } from "@/types"

const round2 = (n: number) => Math.round(n * 100) / 100 + 0

const byFrom = (a: FeeChange, b: FeeChange) => a.from.localeCompare(b.from)

/** The fee in force in `yearMonth` ("YYYY-MM"): the latest change that has started, else the base amount; 0 outside from..until. */
export function feeIn(fee: CollaboratorFee | null | undefined, yearMonth: string): number {
  if (!fee || yearMonth < fee.from || (fee.until && yearMonth > fee.until)) return 0
  const change = [...fee.changes].sort(byFrom).filter((c) => c.from <= yearMonth).pop()
  return change ? change.amount : fee.amount
}

/** The list's order: active first, then by name. */
export const byActiveThenName = (a: Collaborator, b: Collaborator) =>
  Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)

const active = (list: readonly Collaborator[]) => list.filter((c) => c.isActive)

/** What the active collaborators' fixed fees cost in a month. */
export function fixedCostFor(list: readonly Collaborator[], yearMonth: string): number {
  return round2(active(list).reduce((sum, c) => sum + feeIn(c.fee, yearMonth), 0))
}

/** The strip's "fixed fees a month": the same sum, named for where it is read. */
export const monthlyFees = fixedCostFor

/** One collaborator's fixed cost in a calendar quarter. */
export function quarterCost(c: Collaborator, year: number, q: 1 | 2 | 3 | 4): number {
  return c.isActive ? round2(quarterMonths(year, q).reduce((sum, m) => sum + feeIn(c.fee, m), 0)) : 0
}

/** The words under a card's quarter figure, as the mockup's frames have them: why it is what it is. */
export function quarterNote(c: Collaborator, year: number, q: 1 | 2 | 3 | 4): string {
  const months = quarterMonths(year, q)
  const f = c.fee
  if (!f) return "no fixed fee"
  if (f.until && f.until < months[0]) return "fee ended"
  if (!c.isActive) return "inactive, out of the plan"
  if (f.from > months[2]) return `starts ${formatYearMonth(f.from, "MMM yyyy")}`
  if (f.until && f.until <= months[2]) return "the last one"
  const change = [...f.changes].sort(byFrom).find((x) => months.includes(x.from))
  return change ? `the change in ${formatYearMonth(change.from, "MMMM")}` : "planned"
}

export interface FeeEvent {
  kind: "changes" | "stops"
  name: string
}

/** Markers for the Projection: a fee that changes in this month, or is the first month without it. */
export function feeChangeEvents(list: readonly Collaborator[], yearMonth: string): FeeEvent[] {
  return active(list).flatMap<FeeEvent>((c) => {
    const f = c.fee
    if (!f) return []
    if (f.changes.some((ch) => ch.from === yearMonth)) return [{ kind: "changes" as const, name: c.name }]
    if (f.until && addMonth(f.until) === yearMonth) return [{ kind: "stops" as const, name: c.name }]
    return []
  })
}

function addMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
}

/** The card's line: today's fee, the next change after `yearMonth`, and the end. */
export function summarizeFee(
  fee: CollaboratorFee | null,
  yearMonth: string,
): { today: number; next: FeeChange | null; ends: string | null } {
  if (!fee) return { today: 0, next: null, ends: null }
  const next = [...fee.changes].sort(byFrom).find((c) => c.from > yearMonth) ?? null
  return { today: feeIn(fee, yearMonth), next, ends: fee.until }
}
