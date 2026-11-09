import { describe, expect, it } from "vitest"

import { assignedDays, countedDays, marginPct, ownerDays, plannedIn, planOver } from "../assignment-plan"
import { assignmentUsage, loggedDays, marginTable } from "../assignments"

import type { Assignment } from "@/types"

const NOW = new Date("2026-01-01")
const assign = (o: Partial<Assignment> = {}): Assignment => ({
  id: "a1", userId: "u1", collaboratorId: "g", engagementId: "e1", dailyRate: 320, from: "2026-09",
  until: "2027-02", defaultDays: 4, monthDays: { "2026-11": 6 }, createdAt: NOW, updatedAt: NOW, ...o,
})

describe("assignedDays", () => {
  it.each([
    ["before it starts", "2026-08", 0],
    ["the default", "2026-10", 4],
    ["an override", "2026-11", 6],
    ["its last month", "2027-02", 4],
    ["after it ends", "2027-03", 0],
  ])("%s", (_, month, expected) => expect(assignedDays(assign(), month)).toBe(expected))

  it("a stored 0 is no days that month, not the default", () => {
    expect(assignedDays(assign({ monthDays: { "2026-10": 0 } }), "2026-10")).toBe(0)
  })
})

describe("ownerDays: the contract's days less hers", () => {
  it.each([
    ["November: 10 planned, she does 6", "2026-11", 10, 4],
    ["October: 8 planned, she does 4", "2026-10", 8, 4],
    ["she is planned more than the contract", "2026-11", 5, 0],
    ["no assignment that month", "2026-08", 8, 8],
  ])("%s", (_, month, planned, owner) => expect(ownerDays([assign()], month, planned)).toBe(owner))
})

describe("marginTable", () => {
  const engagement = { id: "e1", dailyRate: 520, amendments: [] }
  const cells = new Map([
    ["2026-10", { billableDays: 8 }],
    ["2026-11", { billableDays: 10 }],
    ["2026-12", { billableDays: 8 }],
  ])
  const run = (timecards: Parameters<typeof marginTable>[0]["timecards"] = []) =>
    marginTable({ engagement, assignments: [assign()], cells, timecards, months: ["2026-10", "2026-11", "2026-12"], today: "2026-10-24" })

  it("plans the current and later months: revenue less her days × rate, and the quarter's total", () => {
    const { rows, total } = run()
    expect(rows.map((r) => [r.days, r.revenue, r.herDays, r.cost, r.margin])).toEqual([
      [8, 4160, 4, 1280, 2880],
      [10, 5200, 6, 1920, 3280],
      [8, 4160, 4, 1280, 2880],
    ])
    expect(total).toEqual({ days: 26, revenue: 13520, herDays: 14, cost: 4480, margin: 9040 })
    expect(marginPct(total.margin, total.revenue)).toBe(67)
  })

  it("a month that has ended uses the days logged: everyone's for the revenue, hers for the cost", () => {
    const hours = (collaboratorId: string | null, date: string, h = 8) => ({ engagementId: "e1", collaboratorId, date, hours: h })
    const { rows } = marginTable({
      engagement, assignments: [assign()], cells, months: ["2026-09", "2026-10"], today: "2026-10-24",
      timecards: [hours(null, "2026-09-02"), hours("g", "2026-09-02"), hours("g", "2026-09-03", 4), hours(null, "2026-10-05")],
    })
    expect(rows[0]).toMatchObject({ logged: true, days: 2.5, revenue: 1300, herDays: 1.5, cost: 480, margin: 820 })
    expect(rows[1]).toMatchObject({ logged: false, days: 8, herDays: 4 })
  })
})

describe("loggedDays", () => {
  const tc = [
    { engagementId: "e1", collaboratorId: null, date: "2026-10-05", hours: 8 },
    { engagementId: "e1", collaboratorId: "g", date: "2026-10-05", hours: 4 },
    { engagementId: "e2", collaboratorId: "g", date: "2026-10-05", hours: 8 },
  ]
  it.each([
    ["everyone", undefined, 1.5],
    ["the owner", null, 1],
    ["her", "g", 0.5],
  ])("%s", (_, who, days) => expect(loggedDays(tc, "e1", who)).toBe(days))
})

describe("assignmentUsage: days logged for her against her planned days", () => {
  const today = "2026-10-24"
  const at = (collaboratorId: string | null, date: string, hours: number) => ({ engagementId: "e1", collaboratorId, date, hours })
  it("counts only her rows, over the whole run Sep to Feb: 26 planned", () => {
    const u = assignmentUsage(assign(), { endMonth: null }, [at("g", "2026-09-02", 32), at("g", "2026-10-05", 24), at(null, "2026-10-05", 80)], today)
    expect(u).toEqual({ planned: 26, used: 7, left: 19, month: { used: 3, planned: 4 }, over: [] })
  })

  it("stops at the contract's end, and flags a month logged above its plan as over", () => {
    const u = assignmentUsage(assign(), { endMonth: "2026-11" }, [at("g", "2026-10-05", 40), at("g", "2026-10-06", 8)], today)
    expect(u).toMatchObject({ planned: 14, used: 6, left: 8, over: ["2026-10"] })
  })
})

describe("assignmentUsage with no end anywhere", () => {
  it("has no total to be used up: planned and left are null, this month still reads", () => {
    const u = assignmentUsage(assign({ until: null }), { endMonth: null }, [{ engagementId: "e1", collaboratorId: "g", date: "2026-10-05", hours: 24 }], "2026-10-24")
    expect(u).toEqual({ planned: null, used: 3, left: null, month: { used: 3, planned: 4 }, over: [] })
  })
})

describe("assignmentUsage with the plan the caller counts", () => {
  it("plans what the contract leaves her, not her own days", () => {
    const u = assignmentUsage(assign({ until: "2026-11" }), { endMonth: null }, [], "2026-10-24", (m) => (m === "2026-11" ? 2 : 0))
    expect(u).toMatchObject({ planned: 2, month: { planned: 0 } })
  })
})

describe("two collaborators on one contract share its days", () => {
  const giulia = assign({ id: "a1", collaboratorId: "g", defaultDays: 6, monthDays: {}, createdAt: new Date("2026-01-01") })
  const marco = assign({ id: "a2", collaboratorId: "m", defaultDays: 6, monthDays: {}, createdAt: new Date("2026-01-02") })
  const both = [marco, giulia] // out of order on purpose: the first created is counted first

  it("counts the first 6, then what is left of 10", () => {
    expect([...countedDays(both, "2026-11", 10)]).toEqual([["a1", 6], ["a2", 4]])
  })
  it("plannedIn: 10 days and their cost, not 12", () => {
    expect(plannedIn(both, "2026-11", 10)).toEqual({ days: 10, cost: 3200 })
  })
  it("ownerDays: nothing left for the owner", () => {
    expect(ownerDays(both, "2026-11", 10)).toBe(0)
  })
  it("planOver sums the same 10, and counts one collaborator's against the other's", () => {
    const cells = new Map([["e1:2026-11", { billableDays: 10 }]])
    expect(planOver(both, cells, ["2026-11"], () => 520)).toEqual({ days: 10, cost: 3200, billed: 5200 })
    expect(planOver([marco], cells, ["2026-11"], () => 520, both)).toEqual({ days: 4, cost: 1280, billed: 2080 })
  })
})

describe("marginTable: a month that has ended costs an inactive collaborator too", () => {
  it("her logged days cost her rate in the ended month, though only the live ones cost the plan", () => {
    const engagement = { id: "e1", dailyRate: 520, amendments: [] }
    const hours = (collaboratorId: string | null, date: string) => ({ engagementId: "e1", collaboratorId, date, hours: 8 })
    const cells = new Map([["2026-10", { billableDays: 8 }]])
    const { rows } = marginTable({
      engagement, assignments: [assign()], live: [], cells, months: ["2026-09", "2026-10"], today: "2026-10-24",
      timecards: [hours("g", "2026-09-02"), hours("g", "2026-09-03")],
    })
    expect(rows[0]).toMatchObject({ logged: true, revenue: 1040, herDays: 2, cost: 640, margin: 400 })
    expect(rows[1]).toMatchObject({ logged: false, herDays: 0, cost: 0 })
  })
})

describe("planOver", () => {
  it("counts her days inside each month's billed days, none where the contract bills nothing", () => {
    const cells = new Map([["e1:2026-10", { billableDays: 8 }], ["e1:2026-11", { billableDays: 5 }]])
    expect(planOver([assign()], cells, ["2026-10", "2026-11", "2026-12"], () => 520)).toEqual({ days: 9, cost: 2880, billed: 4680 })
  })
})
