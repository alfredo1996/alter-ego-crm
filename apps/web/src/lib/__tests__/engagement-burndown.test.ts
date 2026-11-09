import { describe, it, expect } from "vitest"

import {
  addedDaysBy,
  computeBurnDown,
  computeRevenueCliffs,
  monthsFrom,
  rateAt,
  resolveAllocationGrid,
  toRevenueSources,
  walkGrid,
  type RevenueSource,
} from "../engagement-burndown"
import { conversionTerm } from "../engagements"
import { buildProjection } from "../projection"

import type { Allocation, Client, ContractAmendment, Engagement, Opportunity } from "@/types"

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date("2026-01-01")

function client(o: Partial<Client> = {}): Client {
  return {
    id: "c1", userId: "u1", name: "Acme", vatNumber: null, email: null, contactName: null, contactPhone: null, notes: null,
    isActive: true, createdAt: NOW, updatedAt: NOW, ...o,
  }
}

function engagement(o: Partial<Engagement> = {}): Engagement {
  return {
    id: "e1", userId: "u1", clientId: "c1", name: null, opportunityId: null,
    dailyRate: 500, vatApplicable: true,
    contractedDays: null, defaultDaysPerMonth: 10, startMonth: null, endMonth: null, endDate: null,
    isActive: true, notes: null, createdAt: NOW, updatedAt: NOW, ...o,
  }
}

function opportunity(o: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "o1", userId: "u1", clientId: "c1", title: "Deal", stage: "proposal",
    probability: 50, dailyRate: 400, estimatedDaysPerMonth: 5,
    estimatedDurationMonths: 4, expectedStartMonth: null, vatApplicable: true,
    nextActionDate: null, nextActionNote: null, notes: null, lostReason: null,
    closedAt: null, engagementId: null, createdAt: NOW, updatedAt: NOW, ...o,
  }
}

function allocation(engagementId: string, yearMonth: string, days: number): Allocation {
  return {
    id: `${engagementId}-${yearMonth}`, userId: "u1", engagementId, yearMonth, days,
    createdAt: NOW, updatedAt: NOW,
  }
}

function source(o: Partial<RevenueSource> = {}): RevenueSource {
  return {
    kind: "engagement", id: "e1", clientName: "Acme", dailyRate: 500,
    vatApplicable: true, daysPerMonth: 10, startMonth: null, budgetDays: null,
    weight: 1, ...o,
  }
}

// ─── monthsFrom ──────────────────────────────────────────────────────────────

describe("monthsFrom", () => {
  it("returns consecutive months inclusive of the start", () => {
    expect(monthsFrom("2026-11", 4)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"])
  })
  it("returns an empty horizon for zero months", () => {
    expect(monthsFrom("2026-01", 0)).toEqual([])
  })
})

// ─── toRevenueSources ────────────────────────────────────────────────────────

describe("toRevenueSources", () => {
  const clients = [client(), client({ id: "c2", name: "Globex" })]

  it("resolves the client name through the id", () => {
    const [s] = toRevenueSources({
      engagements: [engagement({ clientId: "c2" })],
      opportunities: [],
      clients,
      scenario: "committed",
    })
    expect(s.clientName).toBe("Globex")
  })

  it("falls back to a placeholder when the client is gone", () => {
    const [s] = toRevenueSources({
      engagements: [engagement({ clientId: "missing" })],
      opportunities: [],
      clients,
      scenario: "committed",
    })
    expect(s.clientName).toBe("Unknown client")
  })

  it("skips inactive engagements", () => {
    const sources = toRevenueSources({
      engagements: [engagement({ isActive: false })],
      opportunities: [],
      clients,
      scenario: "committed",
    })
    expect(sources).toHaveLength(0)
  })

  // #156: closing must not erase the past — the end month keeps it a source.
  it("keeps a closed contract that has an end month, carrying the end", () => {
    const [s] = toRevenueSources({
      engagements: [engagement({ isActive: false, endMonth: "2026-06" })],
      opportunities: [],
      clients,
      scenario: "committed",
    })
    expect(s.endMonth).toBe("2026-06")
  })

  it("gives every signed contract full weight", () => {
    const [s] = toRevenueSources({
      engagements: [engagement()],
      opportunities: [],
      clients,
      scenario: "committed",
    })
    expect(s.weight).toBe(1)
    expect(s.kind).toBe("engagement")
  })

  it("ignores the pipeline entirely in the committed scenario", () => {
    const sources = toRevenueSources({
      engagements: [],
      opportunities: [opportunity()],
      clients,
      scenario: "committed",
    })
    expect(sources).toHaveLength(0)
  })

  it("discounts open opportunities by probability in the weighted scenario", () => {
    const [s] = toRevenueSources({
      engagements: [],
      opportunities: [opportunity({ probability: 75 })],
      clients,
      scenario: "weighted",
    })
    expect(s.kind).toBe("opportunity")
    expect(s.weight).toBe(0.75)
    // Budget = the whole estimated engagement: days/month × duration.
    expect(s.budgetDays).toBe(20)
  })

  it.each(["won", "lost"] as const)("excludes %s opportunities even when weighted", (stage) => {
    const sources = toRevenueSources({
      engagements: [],
      opportunities: [opportunity({ stage })],
      clients,
      scenario: "weighted",
    })
    expect(sources).toHaveLength(0)
  })

  it.each(["lead", "proposal", "negotiation"] as const)("includes %s opportunities", (stage) => {
    const sources = toRevenueSources({
      engagements: [],
      opportunities: [opportunity({ stage })],
      clients,
      scenario: "weighted",
    })
    expect(sources).toHaveLength(1)
  })
})

// ─── resolveAllocationGrid ───────────────────────────────────────────────────

describe("resolveAllocationGrid", () => {
  it("falls back to the contract default when no allocation exists", () => {
    const grid = resolveAllocationGrid({
      sources: [source({ daysPerMonth: 12 })],
      allocations: [],
      fromMonth: "2026-01",
      months: 3,
    })
    expect(grid.map((c) => c.plannedDays)).toEqual([12, 12, 12])
  })

  it("uses an explicit allocation over the default", () => {
    const grid = resolveAllocationGrid({
      sources: [source()],
      allocations: [allocation("e1", "2026-02", 3)],
      fromMonth: "2026-01",
      months: 3,
    })
    expect(grid.map((c) => c.plannedDays)).toEqual([10, 3, 10])
  })

  // The distinction the whole model rests on: no record ≠ a record holding zero.
  it("treats a stored zero as zero, not as missing", () => {
    const grid = resolveAllocationGrid({
      sources: [source()],
      allocations: [allocation("e1", "2026-02", 0)],
      fromMonth: "2026-01",
      months: 3,
    })
    expect(grid.map((c) => c.billableDays)).toEqual([10, 0, 10])
  })

  it("bills nothing before startMonth", () => {
    const grid = resolveAllocationGrid({
      sources: [source({ startMonth: "2026-03" })],
      allocations: [],
      fromMonth: "2026-01",
      months: 4,
    })
    expect(grid.map((c) => c.billableDays)).toEqual([0, 0, 10, 10])
  })

  it("never starts when startMonth is past the horizon", () => {
    const grid = resolveAllocationGrid({
      sources: [source({ startMonth: "2030-01" })],
      allocations: [],
      fromMonth: "2026-01",
      months: 3,
    })
    expect(grid.every((c) => c.billableDays === 0)).toBe(true)
  })

  it("caps the last month partway when the budget runs out mid-month", () => {
    const grid = resolveAllocationGrid({
      sources: [source({ daysPerMonth: 10, budgetDays: 25 })],
      allocations: [],
      fromMonth: "2026-01",
      months: 4,
    })
    expect(grid.map((c) => c.billableDays)).toEqual([10, 10, 5, 0])
    expect(grid.map((c) => c.capped)).toEqual([false, false, true, true])
    expect(grid.map((c) => c.remainingDays)).toEqual([15, 5, 0, 0])
  })

  it("never exhausts an open-ended contract", () => {
    const grid = resolveAllocationGrid({
      sources: [source({ budgetDays: null })],
      allocations: [],
      fromMonth: "2026-01",
      months: 6,
    })
    expect(grid.every((c) => c.billableDays === 10)).toBe(true)
    expect(grid.every((c) => c.remainingDays === Infinity)).toBe(true)
  })

  // Load-bearing: probability discounts revenue, it must not stretch the budget.
  // Capping weighted days would push the exhaustion date out by 1/weight.
  it("burns the budget with unweighted days regardless of probability", () => {
    const full = resolveAllocationGrid({
      sources: [source({ daysPerMonth: 10, budgetDays: 25, weight: 1 })],
      allocations: [],
      fromMonth: "2026-01",
      months: 4,
    })
    const half = resolveAllocationGrid({
      sources: [source({ daysPerMonth: 10, budgetDays: 25, weight: 0.5 })],
      allocations: [],
      fromMonth: "2026-01",
      months: 4,
    })
    expect(half.map((c) => c.billableDays)).toEqual(full.map((c) => c.billableDays))
  })

  it("bills a closed contract through its endMonth and nothing after", () => {
    const sources = toRevenueSources({
      engagements: [engagement({ isActive: false, endMonth: "2026-06" })],
      opportunities: [],
      clients: [client()],
      scenario: "committed",
    })
    const grid = resolveAllocationGrid({ sources, allocations: [], fromMonth: "2026-01", months: 12 })
    expect(grid.map((c) => c.billableDays)).toEqual([10, 10, 10, 10, 10, 10, 0, 0, 0, 0, 0, 0])
  })

  // The end gates the default fill, never a stored row: typed days are real competenza.
  it("still counts a stored allocation after endMonth", () => {
    const grid = resolveAllocationGrid({
      sources: [source({ endMonth: "2026-02" })],
      allocations: [allocation("e1", "2026-04", 3)],
      fromMonth: "2026-01",
      months: 5,
    })
    expect(grid.map((c) => c.billableDays)).toEqual([10, 10, 0, 3, 0])
  })

  it("keeps each source's budget independent", () => {
    const grid = resolveAllocationGrid({
      sources: [
        source({ id: "e1", budgetDays: 10 }),
        source({ id: "e2", budgetDays: 30 }),
      ],
      allocations: [],
      fromMonth: "2026-01",
      months: 3,
    })
    expect(grid.filter((c) => c.sourceId === "e1").map((c) => c.billableDays)).toEqual([10, 0, 0])
    expect(grid.filter((c) => c.sourceId === "e2").map((c) => c.billableDays)).toEqual([10, 10, 10])
  })
})

// ─── computeBurnDown ─────────────────────────────────────────────────────────

describe("computeBurnDown", () => {
  it("reports the exhaustion month and the cliff that follows it", () => {
    const [burn] = computeBurnDown({
      sources: [source({ daysPerMonth: 10, budgetDays: 25 })],
      allocations: [],
      fromMonth: "2026-01",
      months: 5,
    })
    expect(burn.exhaustionMonth).toBe("2026-03")
    expect(burn.cliffMonth).toBe("2026-04")
    // April would have billed 10 days at 500 had the budget held.
    expect(burn.monthlyRevenueAtRisk).toBe(5000)
  })

  it("reports no exhaustion for an open-ended contract", () => {
    const [burn] = computeBurnDown({
      sources: [source({ budgetDays: null })],
      allocations: [],
      fromMonth: "2026-01",
      months: 6,
    })
    expect(burn.exhaustionMonth).toBeNull()
    expect(burn.cliffMonth).toBeNull()
    expect(burn.monthlyRevenueAtRisk).toBe(0)
  })

  // Regression: exhaustionMonth was "the last month with billable days", which for a
  // budget that outlives the horizon is just the horizon edge — and the client card
  // printed that as "esaurimento <mese>", a statement that was simply false.
  it("reports no exhaustion when the budget outlives the horizon", () => {
    const [burn] = computeBurnDown({
      sources: [source({ daysPerMonth: 10, budgetDays: 500 })],
      allocations: [],
      fromMonth: "2026-01",
      months: 6,
    })
    // 6 months × 10 days spends 60 of 500 — nowhere near exhausted.
    expect(burn.cells.at(-1)!.remainingDays).toBe(440)
    expect(burn.exhaustionMonth).toBeNull()
    expect(burn.cliffMonth).toBeNull()
    expect(burn.monthlyRevenueAtRisk).toBe(0)
  })

  // Running out on the last month we can see is not evidence of a drop.
  it("reports no cliff when the budget ends exactly at the horizon edge", () => {
    const [burn] = computeBurnDown({
      sources: [source({ daysPerMonth: 10, budgetDays: 30 })],
      allocations: [],
      fromMonth: "2026-01",
      months: 3,
    })
    expect(burn.exhaustionMonth).toBe("2026-03")
    expect(burn.cliffMonth).toBeNull()
    expect(burn.monthlyRevenueAtRisk).toBe(0)
  })

  it("reports nothing for a contract that never starts in the horizon", () => {
    const [burn] = computeBurnDown({
      sources: [source({ startMonth: "2030-01", budgetDays: 30 })],
      allocations: [],
      fromMonth: "2026-01",
      months: 3,
    })
    expect(burn.exhaustionMonth).toBeNull()
    expect(burn.cliffMonth).toBeNull()
  })

  it("discounts the amount at risk by an opportunity's probability", () => {
    const [burn] = computeBurnDown({
      sources: [
        source({ kind: "opportunity", daysPerMonth: 10, budgetDays: 25, weight: 0.5 }),
      ],
      allocations: [],
      fromMonth: "2026-01",
      months: 5,
    })
    // Date is unweighted, money is weighted.
    expect(burn.exhaustionMonth).toBe("2026-03")
    expect(burn.monthlyRevenueAtRisk).toBe(2500)
  })

  it("uses the cliff month's own planned days, not the default", () => {
    const [burn] = computeBurnDown({
      sources: [source({ daysPerMonth: 10, budgetDays: 25 })],
      allocations: [allocation("e1", "2026-04", 4)],
      fromMonth: "2026-01",
      months: 5,
    })
    expect(burn.cliffMonth).toBe("2026-04")
    expect(burn.monthlyRevenueAtRisk).toBe(2000)
  })
})

// ─── computeRevenueCliffs ────────────────────────────────────────────────────

describe("computeRevenueCliffs", () => {
  it("groups simultaneous drops and reports what remains", () => {
    const sources = [
      source({ id: "e1", clientName: "Acme", daysPerMonth: 10, budgetDays: 25, dailyRate: 500 }),
      source({ id: "e2", clientName: "Globex", daysPerMonth: 10, budgetDays: 25, dailyRate: 300 }),
      source({ id: "e3", clientName: "Initech", daysPerMonth: 6, budgetDays: null, dailyRate: 400 }),
    ]
    const input = { sources, allocations: [], fromMonth: "2026-01", months: 6 }
    const burnDowns = computeBurnDown(input)
    const grid = resolveAllocationGrid(input)
    const cliffs = computeRevenueCliffs(burnDowns, grid)

    expect(cliffs).toHaveLength(1)
    expect(cliffs[0].yearMonth).toBe("2026-04")
    expect(cliffs[0].sources.map((s) => s.clientName).sort()).toEqual(["Acme", "Globex"])
    expect(cliffs[0].grossLostPerMonth).toBe(5000 + 3000)
    // Only the open-ended contract still bills in April: 6 × 400.
    expect(cliffs[0].grossRemainingPerMonth).toBe(2400)
  })

  it("orders multiple cliffs chronologically", () => {
    const sources = [
      source({ id: "e1", daysPerMonth: 10, budgetDays: 10 }),
      source({ id: "e2", daysPerMonth: 10, budgetDays: 30 }),
    ]
    const input = { sources, allocations: [], fromMonth: "2026-01", months: 6 }
    const cliffs = computeRevenueCliffs(computeBurnDown(input), resolveAllocationGrid(input))
    expect(cliffs.map((c) => c.yearMonth)).toEqual(["2026-02", "2026-04"])
  })

  it("returns nothing when no budget runs out", () => {
    const input = {
      sources: [source({ budgetDays: null })],
      allocations: [],
      fromMonth: "2026-01",
      months: 6,
    }
    expect(computeRevenueCliffs(computeBurnDown(input), resolveAllocationGrid(input))).toEqual([])
  })
})

// ─── Half-day allocations ────────────────────────────────────────────────────

/**
 * Nothing in the stack rounds days to integers — not the Zod schemas, the
 * Firestore rules, the grid input (step="0.5") nor the MCP log_allocation tool.
 * These pin that down, because half days are only ever one stray Math.round away
 * from being silently swallowed.
 */
describe("half-day allocations", () => {
  it("carries a fractional allocation through the grid untouched", () => {
    const cells = resolveAllocationGrid({
      sources: [source({ budgetDays: null })],
      allocations: [allocation("e1", "2026-02", 2.5)],
      fromMonth: "2026-01",
      months: 3,
    })
    expect(cells.map((c) => c.plannedDays)).toEqual([10, 2.5, 10])
    expect(cells[1].billableDays).toBe(2.5)
  })

  it("burns a budget down by halves and exhausts it exactly", () => {
    const cells = resolveAllocationGrid({
      sources: [source({ daysPerMonth: 0.5, budgetDays: 1.5 })],
      allocations: [],
      fromMonth: "2026-01",
      months: 4,
    })
    // 0.5 is exact in binary floating point, so the remainder lands on 0, not 1e-16.
    expect(cells.map((c) => c.remainingDays)).toEqual([1, 0.5, 0, 0])
    expect(cells.map((c) => c.billableDays)).toEqual([0.5, 0.5, 0.5, 0])
    expect(cells.some((c) => c.capped && c.yearMonth === "2026-04")).toBe(true)
  })

  it("caps a half day against a smaller remaining budget", () => {
    const [cell] = resolveAllocationGrid({
      sources: [source({ daysPerMonth: 0.5, budgetDays: 0.25 })],
      allocations: [],
      fromMonth: "2026-01",
      months: 1,
    })
    expect(cell.billableDays).toBe(0.25)
    expect(cell.capped).toBe(true)
  })

  it("prices half days as half money", () => {
    const input = {
      sources: [source({ dailyRate: 1000, daysPerMonth: 0.5, budgetDays: 0.5 })],
      allocations: [],
      fromMonth: "2026-01",
      months: 3,
    }
    const grid = resolveAllocationGrid(input)
    expect(grid[0].billableDays * grid[0].dailyRate).toBe(500)

    const [burn] = computeBurnDown(input)
    expect(burn.exhaustionMonth).toBe("2026-01")
    expect(burn.monthlyRevenueAtRisk).toBe(500)
  })

  it("reports a fractional cliff loss without rounding it to a whole day", () => {
    const input = {
      sources: [source({ dailyRate: 800, daysPerMonth: 1.5, budgetDays: 1.5 })],
      allocations: [],
      fromMonth: "2026-01",
      months: 3,
    }
    const cliffs = computeRevenueCliffs(computeBurnDown(input), resolveAllocationGrid(input))
    expect(cliffs[0].grossLostPerMonth).toBe(1200)
  })
})

// ─── endMonth regression ─────────────────────────────────────────────────────

// Production has no endMonth anywhere. This fixture exercises every path the end
// month touches — a budget, a late start, a stored zero, an explicit row, a legacy
// closed contract, the weighted pipeline — and pins what the engine produced
// before endMonth existed, so adding it cannot move a single number.
describe("projection with no endMonth set", () => {
  it("is unchanged", () => {
    const clients = [client(), client({ id: "c2", name: "Globex" })]
    const engagements = [
      engagement({ id: "e1", contractedDays: 45 }),
      engagement({ id: "e2", clientId: "c2", dailyRate: 420, defaultDaysPerMonth: 6, startMonth: "2026-04" }),
      engagement({ id: "e3", dailyRate: 300, defaultDaysPerMonth: 4, isActive: false }),
    ]
    const allocations = [
      allocation("e1", "2026-02", 0),
      allocation("e1", "2026-03", 14),
      allocation("e2", "2026-05", 2.5),
      allocation("e3", "2026-02", 8),
    ]
    const sources = toRevenueSources({
      engagements,
      opportunities: [opportunity({ probability: 40, expectedStartMonth: "2026-03" })],
      clients,
      scenario: "weighted",
    })
    const timeline = buildProjection({
      sources,
      allocations,
      fromMonth: "2026-01",
      months: 12,
    })
    const digest = timeline.map((m) => [
      m.yearMonth,
      m.lines.map((l) => `${l.sourceId}:${l.billableDays}`).join(" "),
      m.revenue,
    ])
    // Captured from the engine at 6634257, before endMonth. e3 is closed with no
    // end month: its February row stays out, as it always has.
    expect(digest).toEqual([
      ["2026-01", "e1:10", 5000],
      ["2026-02", "", 0],
      ["2026-03", "e1:14 o1:5", 7800],
      ["2026-04", "e1:10 e2:6 o1:5", 8320],
      ["2026-05", "e1:10 e2:2.5 o1:5", 6850],
      ["2026-06", "e1:1 e2:6 o1:5", 3820],
      ["2026-07", "e2:6", 2520],
      ["2026-08", "e2:6", 2520],
      ["2026-09", "e2:6", 2520],
      ["2026-10", "e2:6", 2520],
      ["2026-11", "e2:6", 2520],
      ["2026-12", "e2:6", 2520],
    ])
  })
})

// Every "was" below was captured from the engine at 7691d69, which seeded the
// budget at fromMonth and so handed the contract a fresh budget whenever the
// window moved.
describe("budget burns from the contract, not the window (#155)", () => {
  // The issue's own case: 100 days from 2026-01 at 10/month, 70 logged Jan–Jul.
  const F1 = {
    sources: [source({ startMonth: "2026-01", budgetDays: 100 })],
    allocations: ["01", "02", "03", "04", "05", "06", "07"].map((m) => allocation("e1", `2026-${m}`, 10)),
  }
  const burn = (fromMonth: string, input: Pick<typeof F1, "sources" | "allocations"> = F1, months = 36) =>
    computeBurnDown({ ...input, fromMonth, months })[0]

  it("reports the true exhaustion month for the issue fixture", () => {
    for (const from of ["2026-08", "2026-09"]) {
      // was 2027-05 from 2026-08 and 2027-06 from 2026-09
      expect(burn(from)).toMatchObject({ exhaustionMonth: "2026-10", cliffMonth: "2026-11", monthlyRevenueAtRisk: 5000 })
    }
  })

  it("gives two origins the same cells on the months they share", () => {
    const from08 = resolveAllocationGrid({ ...F1, fromMonth: "2026-08", months: 12 })
    const from09 = resolveAllocationGrid({ ...F1, fromMonth: "2026-09", months: 11 })
    // was unequal: each origin started from a full 100-day budget
    expect(from08.slice(1)).toEqual(from09)
    for (const from of ["2026-08", "2026-09", "2026-10", "2026-11", "2027-01"]) {
      // was 2027-05, 2027-06, 2027-07, 2027-08, 2027-10
      expect(burn(from).exhaustionMonth).toBe("2026-10")
    }
  })

  it("reports a budget spent before the window without leaking lead cells", () => {
    const grid = resolveAllocationGrid({ ...F1, fromMonth: "2027-01", months: 6 })
    expect(grid).toHaveLength(6)
    expect(grid[0].yearMonth).toBe("2027-01")
    // was billable 10, not capped, remaining 90 → 40
    expect(grid.every((c) => c.billableDays === 0 && c.capped && c.remainingDays === 0)).toBe(true)
    // was exhaustion null: the full budget outlived the 6-month window
    expect(burn("2027-01", F1, 6)).toMatchObject({ exhaustionMonth: "2026-10", cliffMonth: null, monthlyRevenueAtRisk: 0 })
    // The drop is still ahead when the window opens on it.
    expect(burn("2026-11").cliffMonth).toBe("2026-11") // was 2027-09
    expect(resolveAllocationGrid({ ...F1, fromMonth: "2027-01", months: 0 })).toEqual([])
  })

  // The owner's decision on #155 (24 Sep 2026): the fill is SYMMETRIC — a missing
  // row means the contract default in the past too. Reading a past month without a
  // row as zero work would make exhaustion slide one month per calendar month.
  it("fills past months without a row with the default (symmetric fill)", () => {
    const input = { sources: [source({ startMonth: "2026-08", budgetDays: 30 })], allocations: [] }
    for (const from of ["2026-08", "2026-09", "2026-10"]) {
      // was 2026-10, 2026-11, 2026-12: the owner's Nov → Dec → Jan drift
      expect(burn(from, input).exhaustionMonth).toBe("2026-10")
    }
  })

  it("lets a stored 0 before the window consume nothing", () => {
    const input = {
      sources: [source({ startMonth: "2026-01", budgetDays: 100 })],
      allocations: ["01", "02", "03"].map((m) => allocation("e1", `2026-${m}`, 0)),
    }
    expect(burn("2026-09", input).exhaustionMonth).toBe("2027-01") // was 2027-06
  })

  it("anchors a contract with no startMonth at its first stored row", () => {
    const input = { sources: [source({ budgetDays: 60 })], allocations: [allocation("e1", "2026-05", 5)] }
    const grid = resolveAllocationGrid({ ...input, fromMonth: "2026-09", months: 4 })
    expect(grid.map((c) => c.billableDays)).toEqual([10, 10, 5, 0]) // was [10, 10, 10, 10]
    expect(grid.map((c) => c.capped)).toEqual([false, false, true, true])
    expect(burn("2026-09", input).exhaustionMonth).toBe("2026-11") // was 2027-02
  })

  it("does not anchor an opportunity: an unsigned deal has worked nothing", () => {
    const input = {
      sources: [source({ kind: "opportunity", id: "o1", startMonth: "2026-03", budgetDays: 20, daysPerMonth: 5, weight: 0.5 })],
      allocations: [],
    }
    // same before and after
    expect(burn("2026-09", input)).toMatchObject({ exhaustionMonth: "2026-12", monthlyRevenueAtRisk: 1250 })
  })

  it("burns a closed contract's default months before a later stored row", () => {
    const input = {
      sources: [source({ startMonth: "2026-01", endMonth: "2026-06", budgetDays: 100 })],
      allocations: [allocation("e1", "2026-09", 50)],
    }
    const grid = resolveAllocationGrid({ ...input, fromMonth: "2026-09", months: 3 })
    // was [50, 0, 0]: the 60 default days of Jan–Jun were never subtracted
    expect(grid.map((c) => c.billableDays)).toEqual([40, 0, 0])
    expect(burn("2026-09", input, 3).exhaustionMonth).toBe("2026-09") // was null
  })

  it("moves the projection only from the new exhaustion month on", () => {
    const timeline = buildProjection({ ...F1, fromMonth: "2026-09", months: 6 })
    const digest = timeline.map((m) => [
      m.yearMonth,
      m.lines.map((l) => `${l.sourceId}:${l.billableDays}`).join(" "),
      m.revenue,
    ])
    // was ["e1:10", 5000] in all six months
    expect(digest).toEqual([
      ["2026-09", "e1:10", 5000],
      ["2026-10", "e1:10", 5000],
      ["2026-11", "", 0],
      ["2026-12", "", 0],
      ["2027-01", "", 0],
      ["2027-02", "", 0],
    ])
  })
})

// Every "was" below was captured from the engine at 9ee0d24, where an end month
// already gated the default fill but a budget running out in its end month lost
// its cliff, and conversions were born with no end.
describe("a contract ends at its endMonth (#154)", () => {
  const days = (cells: { billableDays: number }[]) => cells.reduce((s, c) => s + c.billableDays, 0)
  const zeros = (months: string[]) => months.map((m) => allocation("e1", m, 0))

  // Acceptance 1: 2026-01..06, 60 days at 10/month.
  const A1 = source({ startMonth: "2026-01", endMonth: "2026-06", budgetDays: 60 })

  it("plans and bills nothing after the end, and still warns of the drop", () => {
    const input = { sources: [A1], allocations: [], fromMonth: "2026-01", months: 12 }
    const grid = resolveAllocationGrid(input)
    const ten = [10, 10, 10, 10, 10, 10, 0, 0, 0, 0, 0, 0]
    expect(grid.map((c) => c.plannedDays)).toEqual(ten)
    expect(grid.map((c) => c.billableDays)).toEqual(ten)
    const burn = computeBurnDown(input)
    // was monthlyRevenueAtRisk 0: the gated fill planned 0 in July
    expect(burn[0]).toMatchObject({ exhaustionMonth: "2026-06", cliffMonth: "2026-07", monthlyRevenueAtRisk: 5000 })
    // was []: computeRevenueCliffs drops a zero loss
    expect(computeRevenueCliffs(burn, grid)).toEqual([
      { yearMonth: "2026-07", sources: [{ sourceId: "e1", clientName: "Acme", monthlyGrossLost: 5000 }], grossLostPerMonth: 5000, grossRemainingPerMonth: 0 },
    ])
    // was 0 from 2026-07 too; a drop already behind the window stays silent
    expect(computeBurnDown({ ...input, fromMonth: "2026-07" })[0]).toMatchObject({ cliffMonth: "2026-07", monthlyRevenueAtRisk: 5000 })
    expect(computeBurnDown({ ...input, fromMonth: "2026-08" })[0]).toMatchObject({ cliffMonth: null, monthlyRevenueAtRisk: 0 })
  })

  // Acceptance 2: the zeroed days are lost, not re-emitted after the end.
  it("bills nothing at all when every month of the term is zeroed", () => {
    const allocations = zeros(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"])
    for (const months of [12, 24, 36]) {
      expect(days(resolveAllocationGrid({ sources: [A1], allocations, fromMonth: "2026-01", months }))).toBe(0)
    }
    expect(computeBurnDown({ sources: [A1], allocations, fromMonth: "2026-01", months: 12 })[0]).toMatchObject({ exhaustionMonth: null, cliffMonth: null })
    // The slide it replaces: with no end the 60 days walk to Jul–Dec.
    const open = resolveAllocationGrid({ sources: [{ ...A1, endMonth: null }], allocations, fromMonth: "2026-01", months: 12 })
    expect(open.map((c) => c.billableDays)).toEqual([0, 0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 10])
    expect(computeBurnDown({ sources: [{ ...A1, endMonth: null }], allocations, fromMonth: "2026-01", months: 12 })[0].exhaustionMonth).toBe("2026-12")
  })

  // The Dunder repro: 40 days from 2026-11 at 10/month, Nov and Dec zeroed.
  const C1 = source({ startMonth: "2026-11", endMonth: "2027-02", budgetDays: 40 })
  const C1open = { ...C1, endMonth: null }
  const zeroed = zeros(["2026-11", "2026-12"])

  it("loses the zeroed days instead of sliding them, however long the horizon", () => {
    for (const months of [8, 12, 24, 36]) {
      const grid = resolveAllocationGrid({ sources: [C1], allocations: zeroed, fromMonth: "2026-11", months })
      expect(days(grid)).toBe(20)
      expect(grid.filter((c) => c.yearMonth > "2027-02").every((c) => c.billableDays === 0)).toBe(true)
    }
    const input = { sources: [C1], allocations: zeroed, fromMonth: "2026-11", months: 8 }
    // Jan and Feb still bill, then the contract ends: the drop is real. Was cliff null and
    // 0 at f71315f, which hid it because 20 days were left.
    expect(computeBurnDown(input)[0]).toMatchObject({ exhaustionMonth: null, cliffMonth: "2027-03", monthlyRevenueAtRisk: 5000 })
    // With no end it slid to Jan–Apr, and ran out in April.
    const open = { ...input, sources: [C1open] }
    expect(resolveAllocationGrid(open).map((c) => c.billableDays)).toEqual([0, 0, 10, 10, 10, 10, 0, 0])
    expect(computeBurnDown(open)[0]).toMatchObject({ exhaustionMonth: "2027-04", cliffMonth: "2027-05", monthlyRevenueAtRisk: 5000 })
    // The projection loses the slid months: was 5000 gross in Mar and Apr.
    const revenue = (sources: RevenueSource[]) =>
      buildProjection({ sources, allocations: zeroed, fromMonth: "2027-03", months: 2 }).map((m) => [m.yearMonth, m.revenue])
    expect(revenue([C1open])).toEqual([["2027-03", 5000], ["2027-04", 5000]])
    expect(revenue([C1])).toEqual([["2027-03", 0], ["2027-04", 0]])
  })

  // Acceptance 3: existing documents read back endMonth null, older fixtures omit it.
  it("treats endMonth null and absent alike", () => {
    const absent: RevenueSource = { ...C1open }
    delete absent.endMonth
    const input = { allocations: zeroed, fromMonth: "2026-11", months: 12 }
    expect(resolveAllocationGrid({ ...input, sources: [absent] })).toEqual(resolveAllocationGrid({ ...input, sources: [C1open] }))
    expect(computeBurnDown({ ...input, sources: [absent] })).toEqual(computeBurnDown({ ...input, sources: [C1open] }))
  })

  // A converted contract is born with end = start + duration − 1: while the plan is
  // followed, it must report exactly what the same contract with no end reports.
  it("moves no billed number or cliff for a converted contract that follows its plan", () => {
    for (const fromMonth of ["2026-11", "2027-01", "2027-03"]) {
      const bounded = { sources: [C1], allocations: [], fromMonth, months: 12 }
      const open = { ...bounded, sources: [C1open] }
      const pick = ({ exhaustionMonth, cliffMonth, monthlyRevenueAtRisk }: ReturnType<typeof computeBurnDown>[number]) =>
        ({ exhaustionMonth, cliffMonth, monthlyRevenueAtRisk })
      expect(resolveAllocationGrid(bounded).map((c) => c.billableDays)).toEqual(resolveAllocationGrid(open).map((c) => c.billableDays))
      expect(pick(computeBurnDown(bounded)[0])).toEqual(pick(computeBurnDown(open)[0]))
    }
    expect(computeBurnDown({ sources: [C1], allocations: [], fromMonth: "2026-11", months: 12 })[0]).toMatchObject({ exhaustionMonth: "2027-02", cliffMonth: "2027-03", monthlyRevenueAtRisk: 5000 })
    // Only the ask after the end differs: 10 capped with no end, 0 with one.
    const after = (s: RevenueSource) =>
      resolveAllocationGrid({ sources: [s], allocations: [], fromMonth: "2027-03", months: 1 }).map((c) => [c.plannedDays, c.capped])
    expect(after(C1open)).toEqual([[10, true]])
    expect(after(C1)).toEqual([[0, false]])
  })

  it("prices the drop at the default unless a row in the cliff month says otherwise", () => {
    const risk = (s: RevenueSource, allocations: Allocation[], fromMonth = "2026-11", months = 12) =>
      computeBurnDown({ sources: [s], allocations, fromMonth, months })[0]
    // A stored 0 after the end (what update_engagement advises) must not hide the drop.
    expect(risk(C1, [allocation("e1", "2027-03", 0)]).monthlyRevenueAtRisk).toBe(5000) // was 0
    expect(risk(C1, [allocation("e1", "2027-03", 4)]).monthlyRevenueAtRisk).toBe(2000)
    // A budget spent before its end: the cliff month plans the default anyway.
    expect(risk(source({ budgetDays: 25, endMonth: "2026-12" }), [], "2026-01")).toMatchObject({ cliffMonth: "2026-04", monthlyRevenueAtRisk: 5000 })
    // A budget spent on a row typed after a closed contract's end is no run-rate.
    const stray = { sources: [source({ startMonth: "2026-01", endMonth: "2026-06", budgetDays: 100 })], allocations: [allocation("e1", "2026-09", 50)], fromMonth: "2026-09", months: 3 }
    expect(computeBurnDown(stray)[0]).toMatchObject({ exhaustionMonth: "2026-09", cliffMonth: "2026-10", monthlyRevenueAtRisk: 0 })
    expect(computeRevenueCliffs(computeBurnDown(stray), resolveAllocationGrid(stray))).toEqual([])
  })

  // A budget left over at the end still stops billing: one day under plan hid a
  // 5,000/month drop that the same contract with no end reported. "was" = f71315f.
  it("warns of the drop when the contract ends with days left", () => {
    const nine = [allocation("e1", "2026-11", 9)]
    const input = { sources: [C1], allocations: nine, fromMonth: "2026-11", months: 8 }
    expect(resolveAllocationGrid(input).map((c) => c.billableDays)).toEqual([9, 10, 10, 10, 0, 0, 0, 0])
    const burn = computeBurnDown(input)
    // was cliff null, 0: exhaustion needs the budget at 0, and 1 day is left
    expect(burn[0]).toMatchObject({ exhaustionMonth: null, cliffMonth: "2027-03", monthlyRevenueAtRisk: 5000 })
    expect(computeRevenueCliffs(burn, resolveAllocationGrid(input))).toHaveLength(1) // was []
    // Unchanged: the no-end contract, an end already behind the window, and no budget at all.
    expect(computeBurnDown({ ...input, sources: [C1open] })[0]).toMatchObject({ cliffMonth: "2027-04", monthlyRevenueAtRisk: 5000 })
    expect(computeBurnDown({ ...input, fromMonth: "2027-04", months: 3 })[0]).toMatchObject({ cliffMonth: null, monthlyRevenueAtRisk: 0 })
    expect(computeBurnDown({ ...input, sources: [{ ...C1, budgetDays: null }] })[0]).toMatchObject({ cliffMonth: null, monthlyRevenueAtRisk: 0 })
  })

  // A deal with no expected start, 6 months × 10, converted in 2026-09.
  it("pins a converted deal with no start to a term, so its cliff stops drifting", () => {
    const term = conversionTerm({ expectedStartMonth: null, estimatedDurationMonths: 6 }, "2026-09")
    expect(term).toEqual({ startMonth: "2026-09", endMonth: "2027-02" })
    const sourcesFor = (t: { startMonth: string | null; endMonth: string | null }) =>
      toRevenueSources({ engagements: [engagement({ contractedDays: 60, ...t })], opportunities: [], clients: [client()], scenario: "committed" })
    const drift = { "2026-09": ["2027-02", "2027-03"], "2026-10": ["2027-03", "2027-04"], "2026-11": ["2027-04", "2027-05"] }
    for (const [fromMonth, [was, wasCliff]] of Object.entries(drift)) {
      const burn = (t: { startMonth: string | null; endMonth: string | null }) =>
        computeBurnDown({ sources: sourcesFor(t), allocations: [], fromMonth, months: 12 })[0]
      expect(burn(term)).toMatchObject({ exhaustionMonth: "2027-02", cliffMonth: "2027-03", monthlyRevenueAtRisk: 5000 })
      // How the same contract drifted when born with no start and no end.
      expect(burn({ startMonth: null, endMonth: null })).toMatchObject({ exhaustionMonth: was, cliffMonth: wasCliff, monthlyRevenueAtRisk: 5000 })
    }
  })
})

// ─── Dated terms (contract amendments) ───────────────────────────────────────

function amend(o: Partial<ContractAmendment> & { from: string }): ContractAmendment {
  return { dailyRate: null, addedDays: null, lastDay: null, lastDayBefore: null, note: null, ...o }
}

describe("rateAt", () => {
  it("returns the signed rate with no amendments", () => {
    expect(rateAt({ dailyRate: 700 }, "2027-01")).toBe(700)
    expect(rateAt({ dailyRate: 700, amendments: [] }, "2027-01")).toBe(700)
  })

  it("switches in the amendment's month, never before", () => {
    const c = { dailyRate: 700, amendments: [amend({ from: "2027-01", dailyRate: 800 })] }
    expect(rateAt(c, "2026-12")).toBe(700)
    expect(rateAt(c, "2027-01")).toBe(800)
    expect(rateAt(c, "2027-06")).toBe(800)
  })

  it("takes the latest month dated then or before, whatever the array order", () => {
    const list = [amend({ from: "2027-07", dailyRate: 900 }), amend({ from: "2027-01", dailyRate: 800 })]
    for (const amendments of [list, [...list].reverse()]) {
      expect(rateAt({ dailyRate: 700, amendments }, "2027-03")).toBe(800)
      expect(rateAt({ dailyRate: 700, amendments }, "2027-08")).toBe(900)
    }
  })

  it("skips entries that leave the rate alone", () => {
    const amendments = [amend({ from: "2027-01", dailyRate: 800 }), amend({ from: "2027-03", addedDays: 5 })]
    expect(rateAt({ dailyRate: 700, amendments }, "2027-04")).toBe(800)
  })
})

describe("addedDaysBy", () => {
  it("sums only the days dated on or before the month", () => {
    const amendments = [
      amend({ from: "2026-10", addedDays: 40 }),
      amend({ from: "2027-01", addedDays: 5 }),
      amend({ from: "2026-12", dailyRate: 800 }),
    ]
    expect(addedDaysBy(amendments, "2026-09")).toBe(0)
    expect(addedDaysBy(amendments, "2026-10")).toBe(40)
    expect(addedDaysBy(amendments, "2026-12")).toBe(40)
    expect(addedDaysBy(amendments, "2027-01")).toBe(45)
    expect(addedDaysBy(undefined, "2027-01")).toBe(0)
  })
})

describe("dated terms in the grid and the burn-down", () => {
  const byMonth = <T extends { yearMonth: string }>(cells: T[]) => new Map(cells.map((c) => [c.yearMonth, c]))

  it("carries the amendments from a contract to its source, and none on an opportunity", () => {
    const amendments = [amend({ from: "2027-01", dailyRate: 800 })]
    const sources = toRevenueSources({
      engagements: [engagement({ amendments })],
      opportunities: [opportunity()],
      clients: [client()],
      scenario: "weighted",
    })
    expect(sources.map((s) => s.amendments)).toEqual([amendments, undefined])
  })

  // The regression test for "never reprices the past".
  it("leaves every month before the amendment exactly as it was", () => {
    const signed = source({ startMonth: "2026-01", budgetDays: 80, dailyRate: 700 })
    const amended = { ...signed, amendments: [amend({ from: "2026-07", dailyRate: 800, addedDays: 20 })] }
    const walk = (s: RevenueSource) => walkGrid({ sources: [s], allocations: [], fromMonth: "2026-10", months: 6 })
    const [before, after] = [walk(signed), walk(amended)]
    expect(before.length).toBe(after.length)
    const cut = before.findIndex((c) => c.yearMonth === "2026-07")
    expect(cut).toBe(6)
    expect(after.slice(0, cut)).toEqual(before.slice(0, cut))
    expect(after.slice(cut).every((c) => c.dailyRate === 800)).toBe(true)
  })

  // Example 2, Lumon Migration: 80 days at 10/month from Jan 2026, ends Dec 2026, spent
  // in August. Addendum 2 on 7 Oct: +40 days from October, ending 31 Jan 2027.
  const migration = engagement({
    dailyRate: 700, contractedDays: 80, defaultDaysPerMonth: 10, startMonth: "2026-01", endMonth: "2026-12",
  })
  const run = (e: Engagement) => {
    const input = {
      sources: toRevenueSources({ engagements: [e], opportunities: [], clients: [client()], scenario: "committed" }),
      allocations: [],
      fromMonth: "2026-10",
      months: 12,
    }
    return { cells: byMonth(walkGrid(input)), burn: computeBurnDown(input)[0] }
  }

  it("spends added days from their month on, never on the capped months before (example 2)", () => {
    const { cells, burn } = run({
      ...migration,
      endMonth: "2027-01",
      amendments: [amend({ from: "2026-10", addedDays: 40, lastDay: "2027-01-31", lastDayBefore: "2026-12-31" })],
    })
    expect(cells.get("2026-09")).toMatchObject({ plannedDays: 10, billableDays: 0, capped: true })
    for (const m of ["2026-10", "2026-11", "2026-12", "2027-01"]) expect(cells.get(m)?.billableDays).toBe(10)
    expect(cells.get("2027-01")?.remainingDays).toBe(0)
    expect(cells.get("2027-02")?.billableDays).toBe(0)
    expect(burn).toMatchObject({ exhaustionMonth: "2027-01", cliffMonth: "2027-02", monthlyRevenueAtRisk: 7000 })
  })

  it("pins the defect: typing 120 signed days bills September and caps January", () => {
    const { cells } = run({ ...migration, contractedDays: 120, endMonth: "2027-01" })
    expect(cells.get("2026-09")?.billableDays).toBe(10)
    expect(cells.get("2027-01")).toMatchObject({ billableDays: 0, capped: true })
  })

  // Spent in Dec 2026, refilled with 30 days from Mar 2027, ending May 2027.
  const refilled = source({
    startMonth: "2026-01", budgetDays: 120, dailyRate: 700, endMonth: "2027-05",
    amendments: [amend({ from: "2027-03", addedDays: 30 })],
  })
  const burn = (s: RevenueSource, fromMonth: string) =>
    computeBurnDown({ sources: [s], allocations: [], fromMonth, months: 12 })[0]

  it("stops at the first drop still ahead, and at the refill's own end once past it", () => {
    expect(burn(refilled, "2026-10")).toMatchObject({
      exhaustionMonth: "2026-12", cliffMonth: "2027-01", monthlyRevenueAtRisk: 7000,
    })
    expect(burn(refilled, "2027-03")).toMatchObject({
      exhaustionMonth: "2027-05", cliffMonth: "2027-06", monthlyRevenueAtRisk: 7000,
    })
  })

  // Inside the gap the budget has run out: the refill's end must not hide the month
  // that bills nothing now, while the Plan still sees the refill's own cliff.
  it("keeps the spent month while today sits in the unpaid gap", () => {
    expect(burn(refilled, "2027-02")).toMatchObject({
      exhaustionMonth: "2026-12", cliffMonth: "2027-06", monthlyRevenueAtRisk: 7000,
    })
    const outlives = { ...refilled, endMonth: "2028-12", amendments: [amend({ from: "2027-03", addedDays: 400 })] }
    expect(burn(outlives, "2027-02")).toMatchObject({ exhaustionMonth: "2026-12", cliffMonth: null })
  })

  it("prices the cliff at the rate in force in the cliff month", () => {
    const rated = { ...refilled, amendments: [...refilled.amendments!, amend({ from: "2027-01", dailyRate: 800 })] }
    expect(burn(rated, "2026-10")).toMatchObject({ cliffMonth: "2027-01", monthlyRevenueAtRisk: 8000 })
    expect(burn(rated, "2027-03")).toMatchObject({ cliffMonth: "2027-06", monthlyRevenueAtRisk: 8000 })
  })

  it("runs a fractional budget plus fractional added days down to exactly 0", () => {
    const s = source({ startMonth: "2026-01", budgetDays: 7.5, daysPerMonth: 5, amendments: [amend({ from: "2026-04", addedDays: 2.25 })] })
    const cells = byMonth(walkGrid({ sources: [s], allocations: [], fromMonth: "2026-01", months: 6 }))
    expect([...cells.values()].map((c) => c.billableDays)).toEqual([5, 2.5, 0, 2.25, 0, 0])
    expect(cells.get("2026-02")?.remainingDays).toBe(0)
    expect(cells.get("2026-04")?.remainingDays).toBe(0)
    expect(burn(s, "2026-01")).toMatchObject({ exhaustionMonth: "2026-02", cliffMonth: "2026-03" })
    expect(burn(s, "2026-04")).toMatchObject({ exhaustionMonth: "2026-04", cliffMonth: "2026-05" })
  })

  it("adds no budget to an open-ended contract, and still steps its rate", () => {
    const s = source({ startMonth: "2026-01", amendments: [amend({ from: "2026-03", addedDays: 10, dailyRate: 600 })] })
    const cells = walkGrid({ sources: [s], allocations: [], fromMonth: "2026-01", months: 4 })
    expect(cells.every((c) => c.remainingDays === Infinity && c.billableDays === 10)).toBe(true)
    expect(cells.map((c) => c.dailyRate)).toEqual([500, 500, 600, 600])
  })

  it("changes nothing for a contract without amendments, absent or empty", () => {
    const e = engagement({ contractedDays: 45, startMonth: "2026-03", endMonth: "2026-12" })
    const outputs = (x: Engagement) => {
      const input = {
        sources: toRevenueSources({ engagements: [x], opportunities: [], clients: [client()], scenario: "committed" }),
        allocations: [allocation("e1", "2026-05", 3)],
        fromMonth: "2026-06",
        months: 12,
      }
      return JSON.stringify([walkGrid(input), computeBurnDown(input), buildProjection(input)])
    }
    expect(outputs({ ...e, amendments: [] })).toBe(outputs(e))
  })
})
