import { describe, it, expect } from "vitest"

import {
  STAGE_PROBABILITY,
  closestToSigning,
  isActionOverdue,
  isOpen,
  monthlyValue,
  nextFollowUp,
  opportunityValue,
  weightedByStage,
  weightedMonthlyValue,
  weightedPipelineMonthly,
} from "../opportunities"

import type { Opportunity } from "@/types"

const NOW = new Date("2026-01-01")

function opportunity(o: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "o1", userId: "u1", clientId: "c1", title: "Deal", stage: "proposal",
    probability: 50, dailyRate: 500, estimatedDaysPerMonth: 10,
    estimatedDurationMonths: 6, expectedStartMonth: null, vatApplicable: true,
    nextActionDate: null, nextActionNote: null, notes: null, lostReason: null,
    closedAt: null, engagementId: null, createdAt: NOW, updatedAt: NOW, ...o,
  }
}

describe("isOpen", () => {
  it.each([
    ["lead", true],
    ["proposal", true],
    ["negotiation", true],
    ["won", false],
    ["lost", false],
  ] as const)("%s → %s", (stage, expected) => {
    expect(isOpen(opportunity({ stage }))).toBe(expected)
  })
})

describe("value arithmetic", () => {
  it("prices the whole engagement", () => {
    expect(opportunityValue(opportunity())).toBe(30_000)
  })

  it("prices a single month", () => {
    expect(monthlyValue(opportunity())).toBe(5000)
  })

  it("discounts the monthly figure by probability", () => {
    expect(weightedMonthlyValue(opportunity({ probability: 75 }))).toBe(3750)
    expect(weightedMonthlyValue(opportunity({ probability: 0 }))).toBe(0)
  })

  it("rounds to cents rather than carrying float noise", () => {
    expect(weightedMonthlyValue(opportunity({ dailyRate: 333.33, probability: 33 }))).toBe(1099.99)
  })
})

describe("weightedPipelineMonthly", () => {
  it("sums only the open deals", () => {
    const total = weightedPipelineMonthly([
      opportunity({ id: "a", stage: "lead", probability: 20 }), // 1000
      opportunity({ id: "b", stage: "negotiation", probability: 75 }), // 3750
      opportunity({ id: "c", stage: "won", probability: 100 }), // excluded
      opportunity({ id: "d", stage: "lost", probability: 0 }), // excluded
    ])
    expect(total).toBe(4750)
  })

  it("is zero for an empty pipeline", () => {
    expect(weightedPipelineMonthly([])).toBe(0)
  })
})

describe("isActionOverdue", () => {
  const today = new Date("2026-06-15")

  it("flags a past follow-up on an open deal", () => {
    expect(isActionOverdue(opportunity({ nextActionDate: new Date("2026-06-01") }), today)).toBe(true)
  })

  // Dates are stored as midnight: compared to the clock, today's would be overdue from 00:00.
  it("calls a follow-up dated today due, not overdue, at any hour", () => {
    const evening = new Date(2026, 5, 15, 18, 30)
    expect(isActionOverdue(opportunity({ nextActionDate: new Date(2026, 5, 15) }), evening)).toBe(false)
    expect(isActionOverdue(opportunity({ nextActionDate: new Date(2026, 5, 14) }), evening)).toBe(true)
  })

  it("ignores a future follow-up", () => {
    expect(isActionOverdue(opportunity({ nextActionDate: new Date("2026-07-01") }), today)).toBe(false)
  })

  it("ignores a deal with no follow-up set", () => {
    expect(isActionOverdue(opportunity({ nextActionDate: null }), today)).toBe(false)
  })

  // A closed deal cannot be chased, so an old date on it is not a to-do.
  it("ignores closed deals even with a stale date", () => {
    expect(isActionOverdue(opportunity({ stage: "won", nextActionDate: new Date("2026-01-01") }), today)).toBe(false)
    expect(isActionOverdue(opportunity({ stage: "lost", nextActionDate: new Date("2026-01-01") }), today)).toBe(false)
  })
})

describe("STAGE_PROBABILITY", () => {
  it("rises monotonically through the open stages and pins the closed ones", () => {
    expect(STAGE_PROBABILITY.lead).toBeLessThan(STAGE_PROBABILITY.proposal)
    expect(STAGE_PROBABILITY.proposal).toBeLessThan(STAGE_PROBABILITY.negotiation)
    expect(STAGE_PROBABILITY.won).toBe(100)
    expect(STAGE_PROBABILITY.lost).toBe(0)
  })
})

describe("closestToSigning", () => {
  it("puts the likelier deal first, then the later stage, then the one worth more", () => {
    const deals = [
      opportunity({ id: "lead-small", stage: "lead", probability: 20, dailyRate: 400 }),
      opportunity({ id: "likely", stage: "lead", probability: 70 }),
      opportunity({ id: "lead-big", stage: "lead", probability: 20, dailyRate: 600 }),
      opportunity({ id: "proposal", stage: "proposal", probability: 20, dailyRate: 100 }),
    ]
    expect(deals.sort(closestToSigning).map((o) => o.id)).toEqual(["likely", "proposal", "lead-big", "lead-small"])
  })
})

describe("weightedByStage", () => {
  it("sums each open stage at its odds, the furthest along first, and leaves closed deals out", () => {
    const deals = [
      opportunity({ stage: "negotiation", probability: 70, dailyRate: 540, estimatedDaysPerMonth: 10 }),
      opportunity({ stage: "lead", probability: 20, dailyRate: 450, estimatedDaysPerMonth: 4 }),
      opportunity({ stage: "lead", probability: 15, dailyRate: 500, estimatedDaysPerMonth: 6 }),
      opportunity({ stage: "won", probability: 100 }),
    ]
    expect(weightedByStage(deals)).toEqual([
      { stage: "negotiation", value: 3780 },
      { stage: "proposal", value: 0 },
      { stage: "lead", value: 810 },
    ])
  })
})

describe("nextFollowUp", () => {
  it("is the earliest follow-up among open deals, an overdue one included", () => {
    const deals = [
      opportunity({ id: "later", nextActionDate: new Date("2026-06-20") }),
      opportunity({ id: "overdue", nextActionDate: new Date("2026-06-01") }),
      opportunity({ id: "none" }),
      opportunity({ id: "closed", stage: "won", nextActionDate: new Date("2026-05-01") }),
    ]
    expect(nextFollowUp(deals)?.id).toBe("overdue")
  })

  it("is null when no open deal has one", () => {
    expect(nextFollowUp([opportunity(), opportunity({ stage: "lost", nextActionDate: NOW })])).toBeNull()
  })
})
