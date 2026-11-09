/**
 * Monthly revenue and cost projection: what the plan bills and what the Costs
 * page spends, month by month. No taxes: those are the accountant's.
 *
 * Deterministic by construction: every month comes from an explicit day allocation,
 * never from an average of the past. The old cash-flow simulation guessed future
 * months from a 3-month rolling average of logged hours, which meant an empty
 * timesheet produced an empty future — exactly the failure this replaces.
 */

import { format, parse, subMonths } from "date-fns"

import { plannedIn, liveAssignments, onContract } from "./assignment-plan"
import { feeIn, fixedCostFor } from "./collaborators"
import { monthsFrom, walkGrid, type AllocationCell, type RevenueSource, type RevenueSourceKind } from "./engagement-burndown"

import type { Allocation, Assignment, Collaborator, CompanyExpense } from "@/types"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProjectedLine {
  sourceId: string
  kind: RevenueSourceKind
  clientName: string
  plannedDays: number
  billableDays: number
  weight: number
  /** billableDays × weight × dailyRate, net of VAT. */
  revenue: number
  capped: boolean
  /** Collaborators' planned days inside billableDays, and what they cost. Revenue is not reduced by them. */
  collaboratorDays: number
  collaboratorCost: number
}

export interface ProjectionMonth {
  yearMonth: string
  lines: ProjectedLine[]
  /** The lines' revenue, net of VAT. */
  revenue: number
  /** Everything the month costs, net of VAT: collaborators + otherCosts. */
  costs: number
  /** The active collaborators' cost that month: fixed fees in force plus planned days × rate on contracts. */
  collaborators: number
  /** The month's costs from the Costs page (costsFor). */
  otherCosts: number
}

export interface ProjectionInput {
  sources: RevenueSource[]
  allocations: Allocation[]
  /** "YYYY-MM", first month of the horizon, inclusive. */
  fromMonth: string
  months: number
  companyExpenses?: CompanyExpense[]
  collaborators?: Collaborator[]
  assignments?: Assignment[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * A recurring estimate's period in months. The form lets isRecurring be saved
 * without a cadence. Treating that as a one-off made the expense vanish from every
 * month but its own — and from a view starting after it, entirely. Monthly is the
 * only sane reading of "recurring, period unspecified". Guard 0 explicitly:
 * `0 ?? 1` is 0, and dividing by it yields Infinity.
 */
function cadence(e: CompanyExpense): number {
  return e.recurrenceMonths && e.recurrenceMonths > 0 ? e.recurrenceMonths : 1
}

const monthOf = (d: Date) => format(d, "yyyy-MM")

/** Whole months from a to b, "YYYY-MM" (negative when b is earlier). */
function monthsBetween(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)))
}

function shiftMonth(yearMonth: string, by: number): string {
  const n = Number(yearMonth.slice(0, 4)) * 12 + Number(yearMonth.slice(5, 7)) - 1 + by
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`
}

/**
 * The estimate counts whole in its payment months (the start month and every Nth after it), not spread. Only the
 * owner's explicit choice, and only when it is paid less often than monthly: a monthly one reads the same either way.
 */
export const countedWhenPaid = (e: CompanyExpense) => e.countedWhenPaid === true && cadence(e) > 1

/**
 * The price each time in force in `yearMonth`: the latest dated change that has started, else the amount.
 * A month outside start..end reads the nearest month inside it: the first price before, the last after.
 */
export function priceIn(e: CompanyExpense, yearMonth: string): number {
  const start = monthOf(e.date)
  const at = yearMonth < start ? start : e.endMonth && yearMonth > e.endMonth ? e.endMonth : yearMonth
  return feeIn({ amount: e.amount, from: start, until: e.endMonth ?? null, changes: e.priceChanges ?? [] }, at)
}

/** What the estimate averages a month at the price in force in `yearMonth`: 0 once it has ended. For headings, not the Plan. */
export function perMonthIn(e: CompanyExpense, yearMonth: string): number {
  return e.endMonth && yearMonth > e.endMonth ? 0 : priceIn(e, yearMonth) / cadence(e)
}

/** Whether the estimate has something to count in `yearMonth`: started, not ended, and a payment month if counted when paid. */
export function estimateRuns(e: CompanyExpense, yearMonth: string): boolean {
  const start = monthOf(e.date)
  if (yearMonth < start || (e.endMonth && yearMonth > e.endMonth)) return false
  return !countedWhenPaid(e) || monthsBetween(start, yearMonth) % cadence(e) === 0
}

/** The payment month a payment made in `paidMonth` stands for: the nearest one, a tie to the earlier, none before the start. */
export function nearestPaymentMonth(e: CompanyExpense, paidMonth: string): string {
  const start = monthOf(e.date)
  const k = monthsBetween(start, paidMonth)
  if (k <= 0) return start
  const every = cadence(e)
  const down = k - (k % every)
  const round = (k % every) * 2 > every ? down + every : down
  // No payment month past the end: if rounding up lands there, the one below stands for it.
  const last = e.endMonth ? Math.max(0, monthsBetween(start, e.endMonth)) : Infinity
  return shiftMonth(start, round > last ? Math.floor(last / every) * every : round)
}

/**
 * Whether a payment stands for the estimate in `yearMonth`: a one-off linked to
 * it (recurringExpenseId). A spread estimate: dated in the period ending that month,
 * (yearMonth − every, yearMonth]. A counted-when-paid one: dated nearest that payment month.
 * The payment counts in its own month, so the estimate's share is skipped there: never twice.
 * A refund never stands for it: it lowers the costs, it pays nothing.
 */
// ponytail: scans every cost per estimate and month; index by recurringExpenseId if the Plan slows.
export function estimateCovered(estimate: CompanyExpense, yearMonth: string, expenses: CompanyExpense[]): boolean {
  const after = format(subMonths(parse(yearMonth, "yyyy-MM", new Date()), cadence(estimate)), "yyyy-MM")
  const whenPaid = countedWhenPaid(estimate)
  return expenses.some((e) => {
    if (e.isRecurring || e.amount <= 0 || e.recurringExpenseId !== estimate.id) return false
    const paid = monthOf(e.date)
    return whenPaid ? nearestPaymentMonth(estimate, paid) === yearMonth : paid > after && paid <= yearMonth
  })
}

/**
 * A one-off cost that is a collaborator's invoice: the Collaborators category, or linked to one. It pays
 * work the plan already counts as the fee and the days, so the month's costs skip it.
 */
export const isCollaboratorCost = (e: CompanyExpense) => !e.isRecurring && (e.category === "collaborators" || !!e.collaboratorId)

/**
 * The costs of a month: one-off items dated in it, plus every recurring item at the price in force:
 * a share of it (amount / every) once it has started and until its end, or all of it in its payment months
 * when counted when paid; unless a payment linked to it covers the month.
 */
export function costsFor(expenses: CompanyExpense[], yearMonth: string): number {
  let cost = 0
  for (const e of expenses) {
    if (isCollaboratorCost(e)) continue
    if (e.isRecurring) {
      if (!estimateRuns(e, yearMonth) || estimateCovered(e, yearMonth, expenses)) continue
      cost += priceIn(e, yearMonth) * (countedWhenPaid(e) ? 1 : 1 / cadence(e))
    } else if (monthOf(e.date) === yearMonth) {
      cost += e.amount
    }
  }
  return round2(cost)
}

// ─── Core ────────────────────────────────────────────────────────────────────

export function buildProjection(input: ProjectionInput): ProjectionMonth[] {
  const { sources, allocations, fromMonth, months, companyExpenses = [], collaborators = [], assignments = [] } = input
  const live = liveAssignments(assignments, collaborators)
  const cellsByMonth = new Map<string, AllocationCell[]>()
  for (const cell of walkGrid({ sources, allocations, fromMonth, months })) {
    const arr = cellsByMonth.get(cell.yearMonth) ?? []
    arr.push(cell)
    cellsByMonth.set(cell.yearMonth, arr)
  }

  return monthsFrom(fromMonth, months).map((yearMonth) => {
    const variable = (c: AllocationCell) => {
      const p = plannedIn(onContract(live, c.sourceId), yearMonth, c.billableDays)
      return { collaboratorDays: p.days, collaboratorCost: p.cost }
    }
    const lines: ProjectedLine[] = (cellsByMonth.get(yearMonth) ?? [])
      .filter((c) => c.billableDays > 0 && c.weight > 0)
      .map((c) => ({
        sourceId: c.sourceId,
        kind: c.kind,
        clientName: c.clientName,
        plannedDays: c.plannedDays,
        billableDays: c.billableDays,
        weight: c.weight,
        // Round once, at the money: the month's total is the sum of these rows.
        revenue: round2(c.billableDays * c.weight * c.dailyRate),
        capped: c.capped,
        ...variable(c),
      }))
    const variableCost = round2(lines.reduce((sum, l) => sum + l.collaboratorCost, 0))
    const fees = round2(fixedCostFor(collaborators, yearMonth) + variableCost)
    const otherCosts = costsFor(companyExpenses, yearMonth)
    return {
      yearMonth,
      lines,
      revenue: round2(lines.reduce((sum, l) => sum + l.revenue, 0)),
      costs: round2(fees + otherCosts),
      collaborators: fees,
      otherCosts,
    }
  })
}
