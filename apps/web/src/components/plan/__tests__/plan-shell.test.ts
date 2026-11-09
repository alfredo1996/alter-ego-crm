import { describe, expect, it } from "vitest"

import { plannableSources } from "../plan-shell"

import type { RevenueSource } from "@/lib/engagement-burndown"
import type { Allocation } from "@/types"

const source = (id: string, endMonth: string | null) =>
  ({ kind: "engagement", id, clientName: id, dailyRate: 500, vatApplicable: true, daysPerMonth: 10,
    startMonth: null, endMonth, budgetDays: null, weight: 1 }) as RevenueSource
const row = (engagementId: string, yearMonth: string, days: number) =>
  ({ id: `${engagementId}-${yearMonth}`, engagementId, yearMonth, days }) as Allocation

// A contract closed through the dialog must not stay on /plan as a row of zeros (#156).
describe("plannableSources", () => {
  it("keeps open-ended contracts and those ending this month or later", () => {
    const sources = [source("open", null), source("now", "2026-09"), source("later", "2026-12")]
    expect(plannableSources(sources, [], "2026-09").map((s) => s.id)).toEqual(["open", "now", "later"])
  })

  it("drops a contract ended before the grid, unless days are typed from the grid's first month", () => {
    const sources = [source("ended", "2026-06"), source("stale", "2026-06"), source("zeroed", "2026-06")]
    const allocations = [
      row("ended", "2026-05", 8), // before the grid: its past, not the plan's
      row("stale", "2026-10", 5), // still bills, so it must stay visible and editable
      row("zeroed", "2026-10", 0), // already cleared
    ]
    expect(plannableSources(sources, allocations, "2026-09").map((s) => s.id)).toEqual(["stale"])
  })
})
