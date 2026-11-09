import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth } from "@alter-ego/kernel/dates"
import { addMonths, differenceInCalendarMonths, format } from "date-fns"

import { eurCents } from "@/lib/invoices"
import { costsFor, countedWhenPaid, estimateCovered, estimateRuns, nearestPaymentMonth, priceIn } from "@/lib/projection"

import type { CompanyExpense } from "@/types"

const monthName = (yearMonth: string, pattern: string) => format(new Date(`${yearMonth}-01T00:00:00`), pattern)

/** What a recurring card says beyond the amount, only where it applies: the payment months, the price change, the end. */
export function estimateFacts(estimate: CompanyExpense, today: Date): string[] {
  const month = format(today, "yyyy-MM")
  const every = estimate.recurrenceMonths && estimate.recurrenceMonths > 0 ? estimate.recurrenceMonths : 1
  const facts: string[] = []
  if (countedWhenPaid(estimate) && 12 % every === 0) {
    const months = Array.from({ length: 12 / every }, (_, i) => addMonths(estimate.date, i * every)).sort((a, b) => a.getMonth() - b.getMonth())
    facts.push(`Pays in ${months.map((m) => format(m, months.length === 1 ? "MMMM" : "MMM")).join(", ")}`)
  }
  const changes = [...(estimate.priceChanges ?? [])].sort((a, b) => a.from.localeCompare(b.from))
  const next = changes.find((c) => c.from > month)
  const latest = changes.filter((c) => c.from <= month).pop()
  if (next) facts.push(`Price ${eurCents(next.amount)} from ${monthName(next.from, "MMM yyyy")}`)
  else if (latest) facts.push(`Price ${eurCents(latest.amount)} since ${monthName(latest.from, "MMM yyyy")}`)
  // Once the end month has passed the Ended card says so; until then this does.
  if (estimate.endMonth && estimate.endMonth >= month) facts.push(`Ends after ${monthName(estimate.endMonth, "MMM yyyy")}`)
  return facts
}

export type RecurringStatus =
  | { state: "due"; next: Date }
  | { state: "paid"; next: Date; paidFor: string; last?: true }
  | { state: "upcoming"; next: Date }
  /** Counted when paid, and this month is not a payment month: the next one is `next`. */
  | { state: "waiting"; next: Date; last?: true }
  /** Past its end month: nothing more to pay. `last`: the next payment would fall after the end, so there is none to show. */
  | { state: "ended"; next: Date }

/**
 * Where a recurring estimate stands this month: paid (a linked payment covers it, the Plan's own rule),
 * due (none does) or upcoming (it starts later). The next payment falls one cadence after the last.
 */
export function recurringStatus(estimate: CompanyExpense, expenses: CompanyExpense[], today: Date): RecurringStatus {
  const every = estimate.recurrenceMonths && estimate.recurrenceMonths > 0 ? estimate.recurrenceMonths : 1
  const last = expenses
    .filter((e) => !e.isRecurring && e.amount > 0 && e.recurringExpenseId === estimate.id)
    .sort((a, b) => b.date.getTime() - a.date.getTime())[0]
  const next = last ? addMonths(last.date, every) : estimate.date
  const month = format(today, "yyyy-MM")
  if (format(estimate.date, "yyyy-MM") > month) return { state: "upcoming", next }
  if (estimate.endMonth && estimate.endMonth < month) return { state: "ended", next }
  if (countedWhenPaid(estimate)) {
    // The start day in the first payment month after this one (the start month and every Nth after it).
    const gone = differenceInCalendarMonths(today, estimate.date)
    const onward = addMonths(estimate.date, gone - (gone % every) + every)
    const final = estimate.endMonth && format(onward, "yyyy-MM") > estimate.endMonth ? ({ last: true } as const) : {}
    if (estimateCovered(estimate, month, expenses)) return { state: "paid", next: onward, paidFor: format(last!.date, "yyyy-MM"), ...final }
    if (estimateRuns(estimate, month)) return { state: "due", next: addMonths(estimate.date, gone) }
    return { state: "waiting", next: onward, ...final }
  }
  if (estimateCovered(estimate, month, expenses)) {
    const final = estimate.endMonth && format(next, "yyyy-MM") > estimate.endMonth ? ({ last: true } as const) : {}
    return { state: "paid", next, paidFor: format(last!.date, "yyyy-MM"), ...final }
  }
  return { state: "due", next }
}

/** The line under Pays Recurring Cost: which of the Plan's months the payment, dated `date` ("YYYY-MM-DD" or ""), stands in for. */
export function payHint(linked: CompanyExpense, date: string): string {
  const month = date.slice(0, 7)
  const every = linked.recurrenceMonths ?? 1
  const instead = `The Plan counts this cost instead of "${linked.description}"`
  if (!month) return `${instead} in its month.`
  if (countedWhenPaid(linked)) return `${instead} in ${formatYearMonth(nearestPaymentMonth(linked, month))}, the payment month nearest this date.`
  return `${instead} ${every > 1 ? `for ${every} months from` : "in"} ${formatYearMonth(month)}.`
}

const shiftMonth = (yearMonth: string, by: number) => format(addMonths(new Date(`${yearMonth}-01T00:00:00`), by), "yyyy-MM")

/**
 * The dialog's preview of an estimate counted when paid: its next payment months from `from` ("YYYY-MM") with what
 * they add up to at the price in force, and the Plan's other costs in the first of them, against what is stored.
 * `expenses` is every stored cost, the estimate's stored version included when it is being edited.
 */
export function nextPaymentsLine(draft: CompanyExpense, expenses: CompanyExpense[], from: string): string | null {
  if (!countedWhenPaid(draft)) return null
  const months: string[] = []
  // 120 months reaches the 4th payment of any cadence the form allows (up to 60 months) and stops an endless scan.
  for (let k = 0; k < 120 && months.length < 4; k++) if (estimateRuns(draft, shiftMonth(from, k))) months.push(shiftMonth(from, k))
  if (months.length === 0) return "No payments ahead: it ends before the next payment month."
  const total = months.reduce((sum, m) => sum + priceIn(draft, m), 0)
  const first = months[0]
  const stored = expenses.some((e) => e.id === draft.id)
  const now = costsFor([...expenses.filter((e) => e.id !== draft.id), draft], first)
  const was = stored ? ` (was ${eur(costsFor(expenses, first))})` : ""
  return `Next payments: ${months.map((m) => formatYearMonth(m, "MMM yyyy")).join(", ")} · ${eurCents(total)} in all · Plan other costs in ${formatYearMonth(first, "MMM yyyy")} ${eur(now)}${was}`
}
