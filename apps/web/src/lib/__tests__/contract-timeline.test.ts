import { describe, expect, it } from "vitest"

import {
  barSpan,
  contractTimeline,
  groupByClient,
  todayAt,
  windowFrom,
  windowLabel,
  type TimelineInput,
} from "../contract-timeline"
import { monthsFrom, resolveAllocationGrid, toRevenueSources } from "../engagement-burndown"
import { hoursToDays } from "../engagements"
import { clientBilling } from "../invoices"

import type { Allocation, Client, Engagement, Invoice, Opportunity, Solution, Timecard } from "@/types"

const at = new Date(2026, 0, 1)
const client = (id: string, name: string) => ({ id, name }) as Client
const contract = (o: Partial<Engagement> & Pick<Engagement, "id">): Engagement => ({
  userId: "u", clientId: "c1", name: o.id, opportunityId: null, dailyRate: 1000, vatApplicable: true, contractedDays: null,
  defaultDaysPerMonth: 4, startMonth: null, endMonth: null, endDate: null, isActive: true, notes: null, createdAt: at, updatedAt: at, ...o,
})
const opportunity = (o: Partial<Opportunity> & Pick<Opportunity, "id">): Opportunity => ({
  userId: "u", clientId: "c1", title: o.id, stage: "proposal", probability: 50, dailyRate: 800, estimatedDaysPerMonth: 5,
  estimatedDurationMonths: 2, expectedStartMonth: "2027-01", vatApplicable: true, nextActionDate: null, nextActionNote: null,
  notes: null, lostReason: null, closedAt: null, engagementId: null, createdAt: at, updatedAt: at, ...o,
})
const hours = (engagementId: string, date: string, h: number) => ({ engagementId, date, hours: h }) as Timecard
const invoice = (o: Partial<Invoice>): Invoice =>
  ({ id: "i", clientId: "c1", engagementId: null, createdAt: at, yearMonth: "2026-10", fromMonth: null, amount: 1000, vat: 220, ...o }) as Invoice

// Today is 2026-11-13, so the window is Jul 2026 – Jun 2027.
const TODAY = "2026-11-13"
const FROM = "2026-07"
const input = (o: Partial<TimelineInput> = {}): TimelineInput => ({
  today: TODAY, from: FROM, clients: [client("c1", "Alpine"), client("c2", "Brenta")], engagements: [], opportunities: [],
  allocations: [], timecards: [], invoices: [], solutions: [], ...o,
})
const bar = (o: Partial<TimelineInput>, id: string) => contractTimeline(input(o)).bars.find((b) => b.id === id)!

describe("the window", () => {
  it.each([
    ["2026-11-13", 0, "2026-07"],
    ["2026-07-01", 0, "2026-04"],
    ["2026-01-31", 0, "2025-10"],
    ["2026-11-13", 1, "2026-10"],
    ["2026-11-13", -1, "2026-04"],
  ])("today %s shifted %i quarters starts in %s", (today, shift, from) => expect(windowFrom(today, shift)).toBe(from))

  it("reads Jul 2026 – Jun 2027", () => expect(windowLabel("2026-07")).toBe("Jul 2026 – Jun 2027"))

  it("puts Today a day-fraction into its month", () => {
    // November is month 4 of 12; the 13th is 12 days into 30.
    expect(todayAt("2026-11-13", "2026-07")).toBeCloseTo((4 + 12 / 30) / 12, 10)
    expect(todayAt("2027-08-01", "2026-07")).toBeNull()
  })
})

describe("barSpan", () => {
  const months = monthsFrom(FROM, 12)
  it("a July–December contract sits at 0% and spans 50%", () =>
    expect(barSpan("2026-07", "2026-12", months)).toEqual({ left: 0, width: 0.5, fromEdge: false, toEdge: false }))
  it("no end runs to the window's edge", () =>
    expect(barSpan("2026-10", null, months)).toEqual({ left: 0.25, width: 0.75, fromEdge: false, toEdge: true }))
  it("clips what began before the window and ends after it", () =>
    expect(barSpan("2026-01", "2028-01", months)).toEqual({ left: 0, width: 1, fromEdge: true, toEdge: true }))
  it("no start reads as already running", () => expect(barSpan(null, "2026-09", months)?.width).toBe(0.25))
  it.each([["2025-01", "2026-06"], ["2027-07", null]])("is not drawn outside the window (%s – %s)", (s, e) =>
    expect(barSpan(s, e, months)).toBeNull())
})

describe("a contract's state and fill", () => {
  const e = (o: Partial<Engagement> = {}) => contract({ id: "e1", startMonth: "2026-07", endMonth: "2026-12", contractedDays: 10, ...o })
  const logged = (days: number) => [hours("e1", "2026-10-05", days * 8)]

  it("90% of its days logged is nearly full", () => {
    const b = bar({ engagements: [e()], timecards: logged(9) }, "e1")
    expect(b).toMatchObject({ state: "full", used: 9, total: 10, fill: 0.9 })
  })
  it("just under 90% is active", () => expect(bar({ engagements: [e()], timecards: logged(8.5) }, "e1").state).toBe("active"))
  it("past its end month it is ended, even at 100%", () => {
    const b = bar({ engagements: [e({ endMonth: "2026-09" })], timecards: logged(10) }, "e1")
    expect(b).toMatchObject({ state: "ended", fill: 1 })
  })
  it("a closed contract is ended", () => expect(bar({ engagements: [e({ isActive: false })] }, "e1").state).toBe("ended"))
  it("with no end month it is open, drawn to the edge", () => {
    const b = bar({ engagements: [e({ endMonth: null, contractedDays: null })] }, "e1")
    expect(b).toMatchObject({ state: "open", left: 0, width: 1, total: null })
  })
  it("counts amendments in the days it is contracted for", () => {
    const amended = e({ amendments: [{ from: "2026-09", addedDays: 10, dailyRate: null }] as Engagement["amendments"] })
    expect(bar({ engagements: [amended], timecards: logged(9) }, "e1")).toMatchObject({ total: 20, fill: 0.45 })
  })
  it("leaves out a contract that lies wholly outside the window", () =>
    expect(contractTimeline(input({ engagements: [e({ startMonth: "2025-01", endMonth: "2025-06" })] })).bars).toEqual([]))
})

describe("the quarter breakdown", () => {
  const e = contract({ id: "e1", startMonth: "2026-09", endMonth: "2026-12", defaultDaysPerMonth: 5, contractedDays: 40 })
  const allocations = [{ id: "a", userId: "u", engagementId: "e1", yearMonth: "2026-11", days: 7, createdAt: at, updatedAt: at }] as Allocation[]
  const timecards = [hours("e1", "2026-09-10", 16), hours("e1", "2026-10-10", 8), hours("e1", "2026-11-03", 12), hours("e1", "2026-11-20", 8)]

  it("planned is the Plan's grid and logged is the hours up to today, in days", () => {
    const b = bar({ engagements: [e], allocations, timecards }, "e1")
    const grid = resolveAllocationGrid({
      sources: toRevenueSources({ engagements: [e], opportunities: [], clients: [], scenario: "committed" }),
      allocations, fromMonth: FROM, months: 12,
    })
    const planned = (months: string[]) => grid.filter((c) => months.includes(c.yearMonth)).reduce((s, c) => s + c.plannedDays, 0)
    expect(b.quarters.map((q) => [q.label, q.planned, q.logged])).toEqual([
      ["Q3 2026", planned(["2026-07", "2026-08", "2026-09"]), hoursToDays(16)],
      ["Q4 2026", planned(["2026-10", "2026-11", "2026-12"]), hoursToDays(8 + 12)],
    ])
    expect(b.quarters.map((q) => q.planned)).toEqual([5, 17])
    // The 20 Nov hours are scheduled, not logged.
    expect(b.sum).toMatchObject({ label: "Total", planned: 22, logged: 4.5 })
  })

  it("fill is logged over planned", () => {
    const b = bar({ engagements: [e], allocations, timecards }, "e1")
    expect(b.quarters.map((q) => q.fill)).toEqual([0.4, 20 / 8 / 17])
    expect(b.sum.fill).toBeCloseTo(4.5 / 22, 10)
  })

  it("invoiced is what clientBilling says for the months", () => {
    const invoices = [invoice({ yearMonth: "2026-09", amount: 2000 }), invoice({ id: "j", yearMonth: "2026-10", amount: 1000 })]
    const billing = clientBilling({ clientId: "c1", engagements: [e], timecards, invoices, today: TODAY })
    const of = (ym: string[]) => billing.months.filter((m) => ym.includes(m.yearMonth)).reduce((s, m) => s + m.invoiced, 0)
    const b = bar({ engagements: [e], allocations, timecards, invoices }, "e1")
    expect(b.quarters.map((q) => q.invoiced)).toEqual([of(["2026-09"]), of(["2026-10", "2026-11"])])
    expect(b.quarters.map((q) => q.invoiced)).toEqual([2000, 1000])
  })

  it("splits a month's invoice between a client's contracts by what each logged", () => {
    const f = contract({ id: "e2", startMonth: "2026-10", endMonth: "2026-12" })
    const two = [hours("e1", "2026-10-02", 24), hours("e2", "2026-10-03", 8)]
    const invoices = [invoice({ yearMonth: "2026-10", amount: 4000 })]
    const q4 = (id: string) => bar({ engagements: [e, f], timecards: two, invoices }, id).quarters.find((q) => q.label === "Q4 2026")!.invoiced
    expect([q4("e1"), q4("e2")]).toEqual([3000, 1000])
  })

  it("has no Invoiced figure without invoices to read", () =>
    expect(bar({ engagements: [e], invoices: null }, "e1").quarters.map((q) => q.invoiced)).toEqual([null, null]))
})

describe("opportunities", () => {
  it("draw from the expected start for the estimated months, with their stage", () => {
    const b = bar({ opportunities: [opportunity({ id: "o1" })] }, "o1")
    expect(b).toMatchObject({ kind: "opportunity", state: "opportunity", left: 0.5, width: 2 / 12, stage: "Proposal", estimate: 10 })
  })
  it("leave out won and lost deals", () =>
    expect(contractTimeline(input({ opportunities: [opportunity({ id: "w", stage: "won" }), opportunity({ id: "l", stage: "lost" })] })).bars).toEqual([]))
})

describe("the solution a bar pays for", () => {
  const solution = (o: Partial<Solution>) => ({ id: "s1", name: "Guest 360", engagementId: null, steps: [], ...o }) as unknown as Solution
  const step = (title: string, paidBy: Solution["steps"][number]["paidBy"]) => ({ title, state: "now", paidBy }) as Solution["steps"][number]

  it("names the solution and the step, following a won opportunity to its contract", () => {
    const solutions = [solution({ steps: [step("Proof", null), step("MVP", { type: "opportunity", id: "o1" })] })]
    const won = opportunity({ id: "o1", stage: "won", engagementId: "e1" })
    const b = bar({ engagements: [contract({ id: "e1", startMonth: "2026-09", endMonth: "2026-12" })], opportunities: [won], solutions }, "e1")
    expect(b.solution).toEqual({ id: "s1", name: "Guest 360", step: { number: 2, title: "MVP" } })
  })
  it("names an open opportunity's step too", () => {
    const solutions = [solution({ steps: [step("Card", { type: "opportunity", id: "o1" })] })]
    expect(bar({ opportunities: [opportunity({ id: "o1" })], solutions }, "o1").solution?.step).toEqual({ number: 1, title: "Card" })
  })
  it("falls back to the solution's own contract, with no step", () => {
    const solutions = [solution({ engagementId: "e1" })]
    expect(bar({ engagements: [contract({ id: "e1", startMonth: "2026-09", endMonth: "2026-12" })], solutions }, "e1").solution).toEqual({ id: "s1", name: "Guest 360", step: null })
  })
})

describe("the stat cards and the rows", () => {
  const es = [
    contract({ id: "e1", startMonth: "2026-10", endMonth: "2026-12", defaultDaysPerMonth: 5 }),
    contract({ id: "e2", clientId: "c2", startMonth: "2026-05", endMonth: "2026-08" }),
    contract({ id: "e3", clientId: "c2", startMonth: "2026-08", endMonth: null, defaultDaysPerMonth: 2 }),
  ]
  const timecards = [hours("e1", "2026-10-05", 40), hours("e3", "2026-11-05", 8), hours("e3", "2026-08-05", 8)]
  const opportunities = [opportunity({ id: "o1" }), opportunity({ id: "o2", clientId: "c2", estimatedDaysPerMonth: 10, estimatedDurationMonths: 3 })]

  it("counts the contracts that are not ended, this quarter's planned and logged days, and the open deals", () => {
    const { stats } = contractTimeline(input({ engagements: es, timecards, opportunities }))
    expect(stats).toEqual({ active: 2, quarter: "Q4 2026", planned: 5 * 3 + 2 * 3, logged: 6, openDeals: 2, dealDays: 40 })
  })
  it("keeps this quarter's figures when the window has moved on", () => {
    const { stats } = contractTimeline(input({ from: "2027-01", engagements: es, timecards, opportunities }))
    expect(stats).toMatchObject({ quarter: "Q4 2026", planned: 21, logged: 6 })
  })
  it("groups by client name and lists by start when not grouped", () => {
    const { bars } = contractTimeline(input({ engagements: es, opportunities }))
    expect(bars.map((b) => b.id)).toEqual(["e2", "e3", "e1", "o1", "o2"])
    expect(groupByClient(bars).map((g) => [g.clientName, g.bars.map((b) => b.id)])).toEqual([
      ["Alpine", ["e1", "o1"]],
      ["Brenta", ["e2", "e3", "o2"]],
    ])
  })
})
