/**
 * Revenue, costs and net per calendar quarter. A month that has ended counts what
 * happened: revenue invoiced for it and the costs dated in it, both net of VAT.
 * The current month and later come from the plan given in. Estimates
 * (recurring costs) only enter through the plan, never an ended month. No taxes.
 * Costs split in two: Collaborators (their invoices, counted by the month of work they pay, with the
 * plan beside them) and Other costs (everything else, by date).
 */

import { quarterMonths } from "@alter-ego/kernel/dates"
import { format } from "date-fns"

import { collaboratorsMonth } from "./collaborator-invoices"
import { clientBilling, invoiceClientId, periodMonths } from "./invoices"
import { isCollaboratorCost } from "./projection"

import type { ProjectionMonth } from "./projection"
import type { Assignment, Collaborator, CompanyExpense, Engagement, Invoice, Timecard } from "@/types"

export interface QuarterMonth {
  yearMonth: string
  /** Where the figures come from: an ended month is read off invoices and costs. */
  source: "invoiced" | "plan"
  revenue: number
  /** Collaborators + otherCosts. */
  costs: number
  /** Their invoices for the month (ended), or the plan's fees and days (current and later). */
  collaborators: number
  otherCosts: number
  /** Ended months: what the plan says the collaborators cost (fees in force + days logged × rate); null at plan. */
  plan: number | null
  /** Ended months: who has plan that no invoice covers. */
  missing: { name: string; amount: number }[]
}

export interface Totals {
  revenue: number
  costs: number
  net: number
}

export interface YearTotals extends Totals {
  collaborators: number
  otherCosts: number
}

export interface QuarterRow extends YearTotals {
  quarter: 1 | 2 | 3 | 4
  status: "closed" | "in-progress" | "planned"
  months: QuarterMonth[]
  /** A closed quarter: the collaborators' plan to set beside their invoices; null otherwise. */
  plan: number | null
  /** Sum of the ended months' gaps. */
  notInvoiced: number
}

const round2 = (n: number) => Math.round(n * 100) / 100 + 0

const totals = (months: QuarterMonth[]): YearTotals => {
  const sum = (f: (m: QuarterMonth) => number) => round2(months.reduce((s, m) => s + f(m), 0))
  const revenue = sum((m) => m.revenue)
  const costs = sum((m) => m.costs)
  return { revenue, costs, net: round2(revenue - costs), collaborators: sum((m) => m.collaborators), otherCosts: sum((m) => m.otherCosts) }
}

/** Net as a share of revenue, in whole percent; null with no revenue. */
export function margin(t: Totals): number | null {
  return t.revenue > 0 ? Math.round((t.net / t.revenue) * 100) : null
}

export function quarterRows(input: {
  year: number
  /** "YYYY-MM-DD": its month is the first one at plan. */
  today: string
  invoices: Invoice[]
  engagements: Pick<Engagement, "id" | "clientId" | "dailyRate" | "startMonth" | "vatApplicable" | "amendments">[]
  timecards: Pick<Timecard, "engagementId" | "collaboratorId" | "date" | "hours">[]
  expenses: CompanyExpense[]
  plan: ProjectionMonth[]
  /** For the ended months' comparison of invoices with plan; omitted = no plan to compare. */
  collaborators?: Collaborator[]
  assignments?: Assignment[]
}): { rows: QuarterRow[]; year: YearTotals; soFar: Totals } {
  const { today, invoices, engagements, timecards, expenses, plan } = input
  const collaborators = input.collaborators ?? []
  const assignments = input.assignments ?? []
  const currentMonth = today.slice(0, 7)
  // One engine for what a month was invoiced: clientBilling, as the client page, Billing and Month End read it.
  const invoiced = new Map<string, number>()
  const add = (ym: string, n: number) => invoiced.set(ym, (invoiced.get(ym) ?? 0) + n)
  const byClient = new Map<string, Invoice[]>()
  const unresolved: Invoice[] = []
  for (const i of invoices) {
    const clientId = invoiceClientId(i, engagements)
    if (clientId === null) unresolved.push(i)
    else byClient.set(clientId, [...(byClient.get(clientId) ?? []), i])
  }
  for (const [clientId, list] of byClient) {
    for (const m of clientBilling({ clientId, engagements, timecards, invoices: list, today }).months) add(m.yearMonth, m.invoiced)
  }
  // ponytail: an invoice whose client cannot be resolved (no clientId, contract gone) has no hours to
  // weigh by, so it spreads evenly, the remainder on the last month like clientBilling.
  for (const i of unresolved) {
    const covered = periodMonths(i)
    let rest = i.amount
    covered.forEach((ym, k) => {
      const share = k === covered.length - 1 ? round2(rest) : round2(i.amount / covered.length)
      rest -= share
      add(ym, share)
    })
  }
  const costs = new Map<string, number>()
  for (const e of expenses) {
    if (e.isRecurring || isCollaboratorCost(e)) continue
    const ym = format(e.date, "yyyy-MM")
    costs.set(ym, (costs.get(ym) ?? 0) + e.amount)
  }
  const planned = new Map(plan.map((m) => [m.yearMonth, m]))

  const monthOf = (yearMonth: string): QuarterMonth => {
    if (yearMonth >= currentMonth) {
      const p = planned.get(yearMonth)
      return { yearMonth, source: "plan", revenue: p?.revenue ?? 0, costs: p?.costs ?? 0, collaborators: p?.collaborators ?? 0, otherCosts: p?.otherCosts ?? 0, plan: null, missing: [] }
    }
    const c = collaboratorsMonth({ collaborators, assignments, timecards, expenses, yearMonth })
    const other = round2(costs.get(yearMonth) ?? 0)
    return {
      yearMonth, source: "invoiced", revenue: round2(invoiced.get(yearMonth) ?? 0), costs: round2(c.invoiced + other),
      collaborators: c.invoiced, otherCosts: other, plan: c.plan, missing: c.missing.map(({ name, amount }) => ({ name, amount })),
    }
  }

  const rows = ([1, 2, 3, 4] as const).map((quarter): QuarterRow => {
    const months = quarterMonths(input.year, quarter).map(monthOf)
    const ended = months.filter((m) => m.source === "invoiced").length
    const status = ended === 3 ? "closed" : ended > 0 || months.some((m) => m.yearMonth === currentMonth) ? "in-progress" : "planned"
    const gap = round2(months.reduce((s, m) => s + m.missing.reduce((x, y) => x + y.amount, 0), 0))
    const plan = status === "closed" ? round2(months.reduce((s, m) => s + (m.plan ?? 0), 0)) : null
    return { quarter, months, ...totals(months), status, plan, notInvoiced: gap }
  })
  const all = rows.flatMap((r) => r.months)
  return { rows, year: totals(all), soFar: totals(all.filter((m) => m.source === "invoiced")) }
}
