import { quarterMonths } from "@alter-ego/kernel/dates"
import { describe, expect, it } from "vitest"

import { clientBilling } from "../invoices"
import { buildProjection } from "../projection"
import { quarterRows } from "../quarters"

import type { ProjectionMonth } from "../projection"
import type { Assignment, Collaborator, CompanyExpense, Invoice } from "@/types"

const NOW = new Date("2026-01-01")

function invoice(o: Partial<Invoice> = {}): Invoice {
  return { id: "i", clientId: null, engagementId: null, createdAt: NOW, yearMonth: "2026-01", fromMonth: null, amount: 1000, vat: 220, ...o } as Invoice
}
function expense(o: Partial<CompanyExpense> = {}): CompanyExpense {
  return {
    id: "x", userId: "u", description: "x", category: "accountant", amount: 100, date: new Date("2026-01-15"),
    isRecurring: false, recurrenceMonths: null, notes: null, accountId: null, paidByOwner: false, vat: null,
    documentRef: null, project: null, recurringExpenseId: null, dateEstimated: false, importRef: null,
    createdAt: NOW, updatedAt: NOW, ...o,
  } as CompanyExpense
}
const plan = (yearMonth: string, revenue: number, costs: number): ProjectionMonth => ({ yearMonth, lines: [], revenue, costs, collaborators: 0, otherCosts: costs })

describe("quarterMonths", () => {
  it.each([
    [1, ["2026-01", "2026-02", "2026-03"]],
    [4, ["2026-10", "2026-11", "2026-12"]],
  ] as const)("Q%i", (q, months) => expect(quarterMonths(2026, q)).toEqual(months))
})

describe("quarterRows", () => {
  const base = { year: 2026, today: "2026-05-10", invoices: [], engagements: [], timecards: [], expenses: [], plan: [] as ProjectionMonth[] }

  it("closes ended quarters on invoices net of VAT and the costs dated in them, ignoring estimates", () => {
    const { rows } = quarterRows({
      ...base,
      invoices: [invoice({ yearMonth: "2026-02" }), invoice({ yearMonth: "2026-03", amount: 500 })],
      expenses: [expense(), expense({ date: new Date("2026-03-02"), amount: 40 }), expense({ isRecurring: true, amount: 999, date: new Date("2025-12-01") })],
      plan: [plan("2026-01", 9999, 9999)],
    })
    expect(rows[0]).toMatchObject({ quarter: 1, status: "closed", revenue: 1500, costs: 140, net: 1360 })
    expect(rows[0].months.map((m) => [m.yearMonth, m.source, m.revenue, m.costs])).toEqual([
      ["2026-01", "invoiced", 0, 100],
      ["2026-02", "invoiced", 1000, 0],
      ["2026-03", "invoiced", 500, 40],
    ])
  })

  it("mixes actual and plan in the quarter in progress; the current month is plan", () => {
    const { rows, year, soFar } = quarterRows({
      ...base,
      invoices: [invoice({ yearMonth: "2026-04" }), invoice({ yearMonth: "2026-05", amount: 7 })],
      expenses: [expense({ date: new Date("2026-04-10") })],
      plan: [plan("2026-05", 2000, 300), plan("2026-06", 3000, 400)],
    })
    expect(rows[1]).toMatchObject({ status: "in-progress", revenue: 6000, costs: 800 })
    expect(rows[1].months.map((m) => m.source)).toEqual(["invoiced", "plan", "plan"])
    expect(soFar).toMatchObject({ revenue: 1000, costs: 100, net: 900 })
    expect(year).toMatchObject({ revenue: 6000, costs: 800, net: 5200 })
  })

  it("leaves a recurring template inside a closed month out of the costs", () => {
    const { rows } = quarterRows({ ...base, expenses: [expense({ isRecurring: true, amount: 999, date: new Date("2026-02-10") })] })
    expect(rows[0]).toMatchObject({ status: "closed", costs: 0 })
  })

  it("keeps a quarter in progress while its third month is the current one", () => {
    const { rows } = quarterRows({ ...base, today: "2026-06-10" })
    expect(rows[1].status).toBe("in-progress")
    expect(rows[0].status).toBe("closed")
  })

  it("marks later quarters planned, and an empty one as zeros", () => {
    const { rows } = quarterRows({ ...base, plan: [plan("2026-07", 100, 10)] })
    expect(rows[2]).toMatchObject({ status: "planned", revenue: 100, costs: 10 })
    expect(rows[3]).toMatchObject({ status: "planned", revenue: 0, costs: 0, net: 0 })
  })

  it("splits a multi-month invoice across a quarter exactly as the client page does", () => {
    const engagements = [{ id: "e1", clientId: "c1", dailyRate: 800, startMonth: "2026-03", vatApplicable: true, amendments: [] }]
    // March: 3 days logged, April: 1 day, so the weights are 3:1, not even.
    const timecards = [
      { engagementId: "e1", collaboratorId: null, date: "2026-03-10", hours: 24 },
      { engagementId: "e1", collaboratorId: null, date: "2026-04-10", hours: 8 },
    ]
    const invoices = [invoice({ clientId: "c1", fromMonth: "2026-03", yearMonth: "2026-04", amount: 1000.01 })]
    const today = "2026-06-10"
    const { rows } = quarterRows({ ...base, today, invoices, engagements, timecards })
    const billed = new Map(clientBilling({ clientId: "c1", engagements, timecards, invoices, today }).months.map((m) => [m.yearMonth, m.invoiced]))
    const mar = rows[0].months[2].revenue
    const apr = rows[1].months[0].revenue
    expect([mar, apr]).toEqual([billed.get("2026-03"), billed.get("2026-04")])
    expect([mar, apr]).toEqual([750.01, 250])
    expect(Math.round((mar + apr) * 100)).toBe(100001)
  })

  it("spreads an invoice whose client cannot be found evenly, the remainder on its last month", () => {
    const { rows } = quarterRows({ ...base, invoices: [invoice({ fromMonth: "2026-01", yearMonth: "2026-03" })] })
    expect(rows[0].months.map((m) => m.revenue)).toEqual([333.33, 333.33, 333.34])
    expect(rows[0].revenue).toBe(1000)
  })

  it("closes every quarter of a past year and plans every quarter of a later one", () => {
    expect(quarterRows({ ...base, year: 2025 }).rows.map((r) => r.status)).toEqual(Array(4).fill("closed"))
    expect(quarterRows({ ...base, year: 2027 }).rows.map((r) => r.status)).toEqual(Array(4).fill("planned"))
  })
})

describe("quarterRows: collaborators against invoices", () => {
  const verdi = { id: "verdi", userId: "u", name: "Studio Verdi", type: "company", notes: null, isActive: true, createdAt: NOW, updatedAt: NOW, fee: { amount: 2400, from: "2026-01", until: null, changes: [] } } as Collaborator
  const giulia = { ...verdi, id: "giulia", name: "Giulia Neri", type: "freelancer", fee: null } as Collaborator
  const assignments = [{ id: "a1", userId: "u", collaboratorId: "giulia", engagementId: "e1", dailyRate: 320, from: "2026-09", until: null, defaultDays: 4, monthDays: {}, createdAt: NOW, updatedAt: NOW }] as Assignment[]
  const timecards = [1, 2, 3, 4].map((d) => ({ engagementId: "e1", collaboratorId: "giulia", date: `2026-09-0${d}`, hours: 8 }))
  const link = (o: Partial<CompanyExpense>) => expense({ category: "collaborators", collaboratorId: "verdi", ...o })
  const expenses = [
    link({ id: "jul", amount: 2400, date: new Date("2026-08-03"), forMonth: "2026-07" }),
    link({ id: "aug", amount: 2500, date: new Date("2026-09-03"), forMonth: "2026-08" }),
    link({ id: "giulia", collaboratorId: "giulia", amount: 1280, date: new Date("2026-10-02"), forMonth: "2026-09" }),
    expense({ id: "rent", amount: 100, date: new Date("2026-09-10") }),
  ]
  const run = quarterRows({
    year: 2026, today: "2026-10-12", invoices: [], engagements: [], timecards, expenses, collaborators: [verdi, giulia], assignments,
    plan: [{ yearMonth: "2026-10", lines: [], revenue: 5000, costs: 3000, collaborators: 1000, otherCosts: 2000 }],
  })
  const [jul, aug, sep] = run.rows[2].months

  it("counts an invoice in the month it pays, dated in the next one", () => {
    expect([jul.collaborators, aug.collaborators, sep.collaborators]).toEqual([2400, 2500, 1280])
    // Dated 2 Oct, it is not October's cost.
    expect(run.rows[3].months[0].collaborators).toBe(1000)
  })

  it("keeps Other costs to the rest, so nothing is counted twice", () => {
    expect([jul.otherCosts, aug.otherCosts, sep.otherCosts]).toEqual([0, 0, 100])
    expect(sep.costs).toBe(1380)
  })

  it("shows a missing invoice as a gap naming who, never filled from the plan", () => {
    expect(sep).toMatchObject({ plan: 3680, missing: [{ name: "Studio Verdi", amount: 2400 }] })
    expect(run.rows[2]).toMatchObject({ collaborators: 6180, otherCosts: 100, costs: 6280, plan: 8480, notInvoiced: 2400 })
  })

  it("an invoice over the plan is no gap", () => {
    expect(aug).toMatchObject({ plan: 2400, missing: [] })
  })

  it("the current month stays at plan, without a comparison", () => {
    expect(run.rows[3].months[0]).toMatchObject({ source: "plan", collaborators: 1000, otherCosts: 2000, costs: 3000, plan: null, missing: [] })
    expect(run.rows[3]).toMatchObject({ plan: null, notInvoiced: 0 })
  })

  it("splits the year total too", () => {
    expect(run.year).toMatchObject({ collaborators: 7180, otherCosts: 2100, costs: 9280, net: 5000 - 9280 })
  })
})

describe("quarterRows: the plan built from the same costs", () => {
  it("shows a collaborator invoice dated in the current month once, not as Collaborators and Other costs", () => {
    const verdi = { id: "verdi", userId: "u", name: "Studio Verdi", type: "company", notes: null, isActive: true, createdAt: NOW, updatedAt: NOW, fee: { amount: 2400, from: "2026-01", until: null, changes: [] } } as Collaborator
    const expenses = [expense({ category: "collaborators", collaboratorId: "verdi", amount: 2400, date: new Date("2026-10-05"), forMonth: "2026-09" })]
    const plan = buildProjection({ sources: [], allocations: [], fromMonth: "2026-10", months: 3, companyExpenses: expenses, collaborators: [verdi], assignments: [] })
    const { rows } = quarterRows({ year: 2026, today: "2026-10-12", invoices: [], engagements: [], timecards: [], expenses, plan, collaborators: [verdi], assignments: [] })
    expect(rows[3].months[0]).toMatchObject({ source: "plan", collaborators: 2400, otherCosts: 0, costs: 2400 })
  })
})
