import { describe, expect, it } from "vitest"

import { collaboratorMonth, collaboratorsMonth, costMonth, earlierGapBlock, lastQuarterBlock } from "../collaborator-invoices"
import { isCollaboratorCost } from "../projection"

import type { Assignment, Collaborator, CompanyExpense } from "@/types"

const NOW = new Date("2026-01-01")
const verdi: Collaborator = {
  id: "verdi", userId: "u", name: "Studio Verdi", type: "company", notes: null, isActive: true, createdAt: NOW, updatedAt: NOW,
  fee: { amount: 2400, from: "2026-01", until: null, changes: [] },
}
const giulia: Collaborator = { ...verdi, id: "giulia", name: "Giulia Neri", type: "freelancer", fee: null }
const assignment: Assignment = {
  id: "a1", userId: "u", collaboratorId: "giulia", engagementId: "e1", dailyRate: 320, from: "2026-09", until: null,
  defaultDays: 4, monthDays: {}, createdAt: NOW, updatedAt: NOW,
}
const cost = (o: Partial<CompanyExpense> = {}): CompanyExpense =>
  ({
    id: "x", userId: "u", description: "x", category: "collaborators", amount: 2400, date: new Date("2026-10-05"),
    isRecurring: false, recurrenceMonths: null, notes: null, accountId: null, paidByOwner: false, vat: null,
    documentRef: null, project: null, recurringExpenseId: null, dateEstimated: false, importRef: null,
    collaboratorId: "verdi", engagementId: null, forMonth: "2026-09", createdAt: NOW, updatedAt: NOW, ...o,
  }) as CompanyExpense
// 4 days logged by Giulia in September (8 hours a day).
const logged = [1, 2, 3, 4].map((d) => ({ engagementId: "e1", collaboratorId: "giulia", date: `2026-09-0${d}`, hours: 8 }))
const input = { collaborators: [verdi, giulia], assignments: [assignment], timecards: logged, expenses: [] as CompanyExpense[] }

describe("what counts as a collaborator cost, and its month", () => {
  it.each([
    ["the category", cost({ collaboratorId: null }), true],
    ["a collaborator on another category", cost({ category: "other" }), true],
    ["neither", cost({ category: "other", collaboratorId: null }), false],
    ["a recurring estimate", cost({ isRecurring: true }), false],
  ])("%s", (_, e, expected) => expect(isCollaboratorCost(e)).toBe(expected))

  it("For Month, else the date's month", () => {
    expect(costMonth(cost())).toBe("2026-09")
    expect(costMonth(cost({ forMonth: null }))).toBe("2026-10")
  })
})

describe("collaboratorMonth", () => {
  it("plans the fixed fee in force, invoiced by For Month and not by date", () => {
    const m = collaboratorMonth(verdi, { ...input, expenses: [cost({ documentRef: "14/2026" })], yearMonth: "2026-09" })
    expect(m).toMatchObject({ plan: 2400, invoiced: 2400, gap: 0, invoices: [{ ref: "14/2026", amount: 2400 }] })
  })

  it("plans logged days times the rate, not the planned days", () => {
    expect(collaboratorMonth(giulia, { ...input, yearMonth: "2026-09" })).toMatchObject({ plan: 1280, invoiced: 0, gap: 1280, days: 4 })
    expect(collaboratorMonth(giulia, { ...input, timecards: logged.slice(0, 2), yearMonth: "2026-09" }).plan).toBe(640)
  })

  it.each([
    ["no end", null, [0, 0, 0]],
    ["an end", "2026-08", [2400, 2400, 0]],
  ])("an inactive collaborator's fee with %s counts only up to an explicit Until", (_, until, plans) => {
    const off = { ...verdi, isActive: false, fee: { amount: 2400, from: "2026-01", until, changes: [] } }
    const months = ["2026-07", "2026-08", "2026-09"].map((yearMonth) => collaboratorMonth(off, { ...input, yearMonth }).plan)
    expect(months).toEqual(plans)
  })

  it("an inactive collaborator's logged days still count: it is real work", () => {
    expect(collaboratorMonth({ ...giulia, isActive: false }, { ...input, yearMonth: "2026-09" }).plan).toBe(1280)
  })

  it("a refund is negative and an invoice over the plan is no gap", () => {
    const m = collaboratorMonth(verdi, { ...input, expenses: [cost({ amount: 2600 }), cost({ id: "r", amount: -100 })], yearMonth: "2026-09" })
    expect(m).toMatchObject({ invoiced: 2500, gap: 0 })
  })
})

describe("collaboratorsMonth", () => {
  it("totals the plan and invoices, naming who is missing", () => {
    const m = collaboratorsMonth({ ...input, expenses: [cost({ collaboratorId: "giulia", amount: 1280 })], yearMonth: "2026-09" })
    expect(m).toMatchObject({ plan: 3680, invoiced: 1280, missing: [{ name: "Studio Verdi", amount: 2400 }] })
  })

  it("counts a collaborator cost with no collaborator as invoiced, against nobody", () => {
    const m = collaboratorsMonth({ ...input, expenses: [cost({ collaboratorId: null, amount: 500 })], yearMonth: "2026-09" })
    expect(m.invoiced).toBe(500)
    expect(m.missing.map((x) => x.name)).toEqual(["Studio Verdi", "Giulia Neri"])
  })
})

describe("lastQuarterBlock: the card's invoiced against plan", () => {
  const verdiInvoices = [
    cost({ id: "j", forMonth: "2026-07", documentRef: "11/2026" }),
    cost({ id: "a", forMonth: "2026-08", documentRef: "12/2026" }),
  ]

  it("in the quarter just ended, the previous quarter", () => {
    const b = lastQuarterBlock(verdi, { ...input, expenses: verdiInvoices, today: "2026-10-12" })
    expect(b).toMatchObject({ title: "Last quarter", invoiced: 4800, plan: 7200, gap: 2400, missing: ["2026-09"] })
    expect(b?.months.map((m) => [m.yearMonth, m.invoices.map((i) => i.ref), m.gap])).toEqual([
      ["2026-07", ["11/2026"], 0], ["2026-08", ["12/2026"], 0], ["2026-09", [], 2400],
    ])
  })

  it("in a quarter with an ended month, that quarter so far", () => {
    const b = lastQuarterBlock(verdi, { ...input, expenses: [cost({ forMonth: "2026-10" })], today: "2026-11-03" })
    expect(b).toMatchObject({ title: "Q4 so far", invoiced: 2400, plan: 2400, missing: [] })
    expect(b?.months.map((m) => m.yearMonth)).toEqual(["2026-10"])
  })

  it("on 2027-01-10, the previous year's Q4 and not an empty one", () => {
    const b = lastQuarterBlock(verdi, { ...input, expenses: [cost({ forMonth: "2026-10" })], today: "2027-01-10" })
    expect(b).toMatchObject({ title: "Last quarter", invoiced: 2400, plan: 7200, gap: 4800, missing: ["2026-11", "2026-12"] })
    expect(b?.months.map((m) => m.yearMonth)).toEqual(["2026-10", "2026-11", "2026-12"])
  })

  it("is null when nothing was planned or invoiced", () => {
    expect(lastQuarterBlock(giulia, { ...input, timecards: [], today: "2026-10-12" })).toBeNull()
  })
})

describe("earlierGapBlock: the quarter before one with an ended month, while it still has a gap", () => {
  const verdiInvoices = [cost({ id: "j", forMonth: "2026-07" }), cost({ id: "a", forMonth: "2026-08" })]

  it("keeps September's gap in view after 1 November", () => {
    const b = earlierGapBlock(verdi, { ...input, expenses: verdiInvoices, today: "2026-11-03" })
    expect(b).toMatchObject({ title: "Q3", invoiced: 4800, plan: 7200, gap: 2400, missing: ["2026-09"] })
  })

  it("on 2027-02-10, the Q4 December gap shows against January's ended quarter", () => {
    // January is ended, so Q1 so far is the card's block and the earlier gap is last year's Q4.
    const b = earlierGapBlock(verdi, { ...input, expenses: [cost({ forMonth: "2026-10" }), cost({ id: "n", forMonth: "2026-11" })], today: "2027-02-10" })
    expect(b).toMatchObject({ title: "Q4", gap: 2400, missing: ["2026-12"] })
  })

  it.each([
    ["the quarter just ended is the card's own block", "2026-10-12", [cost({ forMonth: "2026-07" })]],
    ["the earlier quarter is fully invoiced", "2026-11-03", [...verdiInvoices, cost({ id: "s", forMonth: "2026-09" })]],
  ])("is null when %s", (_, today, expenses) => {
    expect(earlierGapBlock(verdi, { ...input, expenses, today })).toBeNull()
  })
})
