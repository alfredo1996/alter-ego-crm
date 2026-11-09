/**
 * What collaborators invoiced against what the month cost: the plan (fixed fee in force plus the days
 * logged times the rate, the basis of the contract margin table) and the costs linked to them, counted
 * by For Month. Net of VAT; a missing invoice is a gap, never filled in from the plan. Reads timecards,
 * so the Projection does not import it; Quarters and the Collaborators page do. No taxes.
 */

import { formatYearMonth, quarterMonths } from "@alter-ego/kernel/dates"
import { format } from "date-fns"

import { loggedDays } from "./assignments"
import { feeIn } from "./collaborators"
import { isCollaboratorCost } from "./projection"

import type { Assignment, Collaborator, CompanyExpense, Timecard } from "@/types"

const round2 = (n: number) => Math.round(n * 100) / 100 + 0

type Logged = Pick<Timecard, "engagementId" | "collaboratorId" | "date" | "hours">

export interface InvoiceInputs {
  assignments: readonly Assignment[]
  timecards: readonly Logged[]
  expenses: readonly CompanyExpense[]
}

/** The month a collaborator's invoice pays: For Month, else the date's month. */
export const costMonth = (e: CompanyExpense) => e.forMonth ?? format(e.date, "yyyy-MM")

/** The Costs row's line: "Studio Verdi · fixed fee for Sep 2026", or the contract's name in place of "fixed fee". */
export function invoiceLine(e: CompanyExpense, collaborators: readonly Collaborator[], contractName: (engagementId: string) => string | null): string | null {
  if (!e.collaboratorId) return null
  const who = collaborators.find((c) => c.id === e.collaboratorId)?.name ?? "A collaborator who no longer exists"
  const what = e.engagementId ? (contractName(e.engagementId) ?? "a contract that no longer exists") : "fixed fee"
  return `${who} · ${what} for ${formatYearMonth(costMonth(e), "MMM yyyy")}`
}

export interface CollaboratorMonth {
  yearMonth: string
  /** The fixed fee in force plus the days logged times the daily rate. */
  plan: number
  /** Days logged on their contracts in the month. */
  days: number
  invoiced: number
  /** What the plan has that no invoice covers (0 when covered or over). */
  gap: number
  invoices: { ref: string | null; amount: number }[]
}

export function collaboratorMonth(c: Collaborator, input: InvoiceInputs & { yearMonth: string }): CollaboratorMonth {
  const { yearMonth } = input
  const range = { from: `${yearMonth}-01`, to: `${yearMonth}-31` }
  const logged = input.assignments
    .filter((a) => a.collaboratorId === c.id)
    .map((a) => ({ days: loggedDays(input.timecards, a.engagementId, c.id, range), rate: a.dailyRate }))
  const days = logged.reduce((sum, l) => sum + l.days * l.rate, 0)
  // An inactive collaborator is out of every figure, except a fee with an explicit Until: a finished fee still compares.
  const fee = c.isActive || c.fee?.until ? feeIn(c.fee, yearMonth) : 0
  const plan = round2(fee + days)
  const mine = input.expenses.filter((e) => isCollaboratorCost(e) && e.collaboratorId === c.id && costMonth(e) === yearMonth)
  const invoiced = round2(mine.reduce((s, e) => s + e.amount, 0))
  return {
    yearMonth,
    plan,
    days: round2(logged.reduce((sum, l) => sum + l.days, 0)),
    invoiced,
    gap: round2(Math.max(0, plan - invoiced)),
    invoices: mine.map((e) => ({ ref: e.documentRef, amount: e.amount })),
  }
}

export interface CollaboratorsMonth {
  /** Every collaborator cost For this month, linked to a known collaborator or not. */
  invoiced: number
  plan: number
  /** Who has plan that no invoice covers. */
  missing: { collaboratorId: string; name: string; amount: number }[]
}

export function collaboratorsMonth(input: InvoiceInputs & { collaborators: readonly Collaborator[]; yearMonth: string }): CollaboratorsMonth {
  const rows = input.collaborators.map((c) => ({ c, m: collaboratorMonth(c, input) }))
  return {
    invoiced: round2(input.expenses.filter((e) => isCollaboratorCost(e) && costMonth(e) === input.yearMonth).reduce((s, e) => s + e.amount, 0)),
    plan: round2(rows.reduce((s, r) => s + r.m.plan, 0)),
    missing: rows.filter((r) => r.m.gap > 0).map((r) => ({ collaboratorId: r.c.id, name: r.c.name, amount: r.m.gap })),
  }
}

export interface QuarterBlock {
  /** "Q4 so far" in a quarter with an ended month, else "Last quarter". */
  title: string
  months: CollaboratorMonth[]
  invoiced: number
  plan: number
  /** What the months' plans have that no invoice covers. */
  gap: number
  /** Months with a gap, "YYYY-MM". */
  missing: string[]
}

const quarterOf = (today: string) => {
  const current = today.slice(0, 7)
  const year = Number(current.slice(0, 4))
  const q = (Math.floor((Number(current.slice(5)) - 1) / 3) + 1) as 1 | 2 | 3 | 4
  const [py, pq] = q === 1 ? [year - 1, 4 as const] : [year, (q - 1) as 1 | 2 | 3]
  return { current, year, q, sofar: quarterMonths(year, q)[0] < current, previous: [py, pq] as const }
}

/** The ended months of one quarter, or null with nothing planned or invoiced in them. */
function blockOf(c: Collaborator, input: InvoiceInputs & { today: string }, [y, q]: readonly [number, 1 | 2 | 3 | 4], title: string): QuarterBlock | null {
  const months = quarterMonths(y, q)
    .filter((ym) => ym < input.today.slice(0, 7))
    .map((yearMonth) => collaboratorMonth(c, { ...input, yearMonth }))
    .filter((m) => m.plan !== 0 || m.invoiced !== 0)
  if (!months.length) return null
  return {
    title,
    months,
    invoiced: round2(months.reduce((s, m) => s + m.invoiced, 0)),
    plan: round2(months.reduce((s, m) => s + m.plan, 0)),
    gap: round2(months.reduce((s, m) => s + m.gap, 0)),
    missing: months.filter((m) => m.gap > 0).map((m) => m.yearMonth),
  }
}

/** One collaborator's ended months of the latest quarter that has any, or null with nothing planned or invoiced in them. */
export function lastQuarterBlock(c: Collaborator, input: InvoiceInputs & { today: string }): QuarterBlock | null {
  const { year, q, sofar, previous } = quarterOf(input.today)
  return blockOf(c, input, sofar ? [year, q] : previous, sofar ? `Q${q} so far` : "Last quarter")
}

/** In a quarter with an ended month, the quarter before it while it still has months not invoiced: a gap does not vanish on the 1st. */
export function earlierGapBlock(c: Collaborator, input: InvoiceInputs & { today: string }): QuarterBlock | null {
  const { sofar, previous } = quarterOf(input.today)
  const b = sofar ? blockOf(c, input, previous, `Q${previous[1]}`) : null
  return b && b.gap > 0 ? b : null
}
