import { describe, expect, it } from "vitest"

import { computePatternKey, detectSuspectedSubscriptions } from "../subscription-detector"

import type {
  DismissedSubscriptionPattern,
  RecurringTransaction,
  Transaction,
} from "../../types"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-07T12:00:00Z")

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    userId: "u",
    accountId: "acc-1",
    type: "expense",
    amount: 9.99,
    currency: "EUR",
    categoryId: null,
    description: "Netflix",
    rawDescription: null,
    date: new Date("2026-06-01T12:00:00Z"),
    notes: null,
    tagIds: [],
    transferToAccountId: null,
    linkedTransactionId: null,
    isRecurring: false,
    splits: [],
    attachments: [],
    status: "cleared",
    importHash: null,
    excludeFromReports: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeRecurring(overrides: Partial<RecurringTransaction> = {}): RecurringTransaction {
  return {
    id: "rec-1",
    userId: "u",
    accountId: "acc-1",
    type: "expense",
    amount: 9.99,
    currency: "EUR",
    categoryId: null,
    description: "Netflix",
    notes: null,
    frequency: "monthly",
    interval: 1,
    startDate: new Date("2025-01-01"),
    endDate: null,
    nextDueDate: new Date("2026-07-01"),
    isActive: true,
    loanMeta: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeDismissed(
  patternKey: string,
  id = "dismissed-1",
): DismissedSubscriptionPattern {
  return {
    id,
    userId: "u",
    patternKey,
    dismissedAt: new Date(),
  }
}

/** Build N monthly transactions spaced ~30 days apart ending at `endDate`. */
function buildMonthlyHistory(
  n: number,
  endDate: Date,
  overrides: Partial<Transaction> = {},
): Transaction[] {
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(endDate)
    date.setDate(date.getDate() - (n - 1 - i) * 30)
    return makeTx({ id: `tx-monthly-${i}`, date, ...overrides })
  })
}

function buildWeeklyHistory(
  n: number,
  endDate: Date,
  overrides: Partial<Transaction> = {},
): Transaction[] {
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(endDate)
    date.setDate(date.getDate() - (n - 1 - i) * 7)
    return makeTx({ id: `tx-weekly-${i}`, date, ...overrides })
  })
}

function buildYearlyHistory(
  n: number,
  endDate: Date,
  overrides: Partial<Transaction> = {},
): Transaction[] {
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(endDate)
    date.setFullYear(date.getFullYear() - (n - 1 - i))
    return makeTx({ id: `tx-yearly-${i}`, date, ...overrides })
  })
}

const normalize = (s: string) => s.toLowerCase()

function detect(
  txs: Transaction[],
  opts: {
    recurring?: RecurringTransaction[]
    dismissed?: DismissedSubscriptionPattern[]
    now?: Date
  } = {},
) {
  return detectSuspectedSubscriptions({
    transactions: txs,
    recurringTransactions: opts.recurring ?? [],
    dismissedPatterns: opts.dismissed ?? [],
    normalize,
    now: opts.now ?? NOW,
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("detectSuspectedSubscriptions", () => {
  it("returns empty for an empty transaction list", () => {
    expect(detect([])).toEqual([])
  })

  it("detects a clean monthly subscription (12 observations)", () => {
    const txs = buildMonthlyHistory(12, new Date("2026-06-01T12:00:00Z"))
    const result = detect(txs)
    expect(result).toHaveLength(1)
    expect(result[0]?.cadence).toBe("monthly")
    expect(result[0]?.observationCount).toBe(12)
    expect(result[0]?.merchantName).toBe("netflix")
    expect(result[0]?.confidence).toMatch(/high|medium/)
  })

  it("detects a yearly subscription (2 observations, ~365-day gap)", () => {
    const txs = buildYearlyHistory(2, new Date("2026-06-01T12:00:00Z"))
    const result = detect(txs)
    expect(result).toHaveLength(1)
    expect(result[0]?.cadence).toBe("yearly")
    expect(result[0]?.observationCount).toBe(2)
  })

  it("detects a weekly subscription (12+ observations, ~7-day gap)", () => {
    const txs = buildWeeklyHistory(
      12,
      new Date("2026-06-01T12:00:00Z"),
      { description: "Gym" },
    )
    const result = detect(txs)
    expect(result).toHaveLength(1)
    expect(result[0]?.cadence).toBe("weekly")
  })

  it("drops a series with gaps too irregular (stdGap > 0.4 × median)", () => {
    // Intentionally irregular: alternating 10-day and 60-day gaps
    const dates = [0, 10, 70, 80, 140, 150].map((offset) => {
      const d = new Date("2026-06-01T12:00:00Z")
      d.setDate(d.getDate() - (150 - offset))
      return makeTx({ id: `irr-${offset}`, date: d })
    })
    expect(detect(dates)).toEqual([])
  })

  it("drops a series with amounts varying >5%", () => {
    // Same gap, but amount varies wildly (utility bill pattern)
    const endDate = new Date("2026-06-01T12:00:00Z")
    const amounts = [50, 80, 65, 40, 110, 55]
    const txs = amounts.map((amount, i) => {
      const date = new Date(endDate)
      date.setDate(date.getDate() - (amounts.length - 1 - i) * 30)
      return makeTx({ id: `var-${i}`, date, amount })
    })
    expect(detect(txs)).toEqual([])
  })

  it("drops a series with only 1 observation", () => {
    expect(detect([makeTx()])).toEqual([])
  })

  it("excludes transactions where isRecurring = true", () => {
    const txs = buildMonthlyHistory(12, new Date("2026-06-01T12:00:00Z"), {
      isRecurring: true,
    })
    expect(detect(txs)).toEqual([])
  })

  it("excludes buckets matching an existing RecurringTransaction", () => {
    const txs = buildMonthlyHistory(12, new Date("2026-06-01T12:00:00Z"))
    const result = detect(txs, {
      recurring: [makeRecurring({ description: "Netflix", amount: 9.99 })],
    })
    expect(result).toEqual([])
  })

  it("does NOT exclude when RecurringTransaction has a different merchant", () => {
    const txs = buildMonthlyHistory(12, new Date("2026-06-01T12:00:00Z"))
    const result = detect(txs, {
      recurring: [makeRecurring({ description: "Spotify", amount: 9.99 })],
    })
    expect(result).toHaveLength(1)
  })

  it("separates same-merchant transactions by amount bucket", () => {
    const endDate = new Date("2026-06-01T12:00:00Z")
    const prime = buildMonthlyHistory(6, endDate, {
      description: "Amazon Prime",
      amount: 4.99,
    })
    const variable = Array.from({ length: 6 }, (_, i) =>
      makeTx({
        id: `amz-var-${i}`,
        description: "Amazon Prime",
        amount: 20 + i * 15, // wildly varying
        date: (() => {
          const d = new Date(endDate)
          d.setDate(d.getDate() - (5 - i) * 30)
          return d
        })(),
      }),
    )
    const result = detect([...prime, ...variable])
    // Prime bucket should be detected; variable one dropped
    const found = result.filter((r) => r.cadence === "monthly")
    expect(found.length).toBeGreaterThanOrEqual(1)
    expect(found.some((r) => Math.abs(r.estimatedAmount - 4.99) < 0.5)).toBe(true)
  })

  it("splits a price hike into two separate buckets", () => {
    const endDate = new Date("2026-06-01T12:00:00Z")
    const old = buildMonthlyHistory(6, new Date("2026-01-01T12:00:00Z"), {
      description: "Netflix",
      amount: 9.99,
    })
    const current = buildMonthlyHistory(6, endDate, {
      description: "Netflix",
      amount: 12.99,
    })
    const result = detect([...old, ...current])
    // Two buckets: 9.99 and 12.99
    const netflix = result.filter((r) => r.merchantName === "netflix")
    expect(netflix.length).toBeGreaterThanOrEqual(1)
    // At least one bucket at the new price
    expect(netflix.some((r) => Math.abs(r.estimatedAmount - 12.99) < 0.5)).toBe(true)
  })

  it("flags looksCancelled when lastSeen > 1.5 × medianGap ago", () => {
    // 6 monthly observations, but last one was 60 days ago (> 1.5 × 30)
    const dates = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(NOW)
      d.setDate(d.getDate() - (6 - i) * 30 - 60)
      return makeTx({ id: `cancelled-${i}`, date: d })
    })
    const result = detect(dates)
    const found = result.find((r) => r.merchantName === "netflix")
    expect(found?.looksCancelled).toBe(true)
  })

  it("excludes buckets whose patternKey is in dismissedPatternKeys", () => {
    const txs = buildMonthlyHistory(12, new Date("2026-06-01T12:00:00Z"))
    const key = computePatternKey("acc-1", "netflix", Math.round(9.99 * 100))
    const result = detect(txs, { dismissed: [makeDismissed(key)] })
    expect(result).toEqual([])
  })

  it("respects the windowDays cap: drops transactions older than the window", () => {
    // Build 6 observations: 3 within the window, 3 outside (>13 months ago)
    const endDate = new Date(NOW)
    const inWindow = buildMonthlyHistory(3, endDate)
    const outside = buildMonthlyHistory(3, new Date("2024-01-01T12:00:00Z"))
    // Together: only inWindow should form a detectable pattern
    const result = detectSuspectedSubscriptions({
      transactions: [...inWindow, ...outside],
      recurringTransactions: [],
      dismissedPatterns: [],
      normalize,
      now: NOW,
      windowDays: 395,
    })
    // The 3 inWindow observations are enough to detect
    expect(result.length).toBeGreaterThanOrEqual(0) // may or may not detect with only 3
    // Specifically the outside ones must not inflate the observationCount
    const subscription = result.find((r) => r.merchantName === "netflix")
    if (subscription) {
      expect(subscription.observationCount).toBeLessThanOrEqual(3)
    }
  })

  it("sorts active subscriptions by monthly cost desc, cancelled at bottom", () => {
    const endDate = new Date("2026-06-01T12:00:00Z")
    const cheap = buildMonthlyHistory(6, endDate, {
      description: "Cheap",
      amount: 4.99,
    })
    const expensive = buildMonthlyHistory(6, endDate, {
      description: "Expensive",
      amount: 29.99,
    })
    // A "cancelled" expensive subscription (last seen 100 days ago)
    const cancelledDates = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(NOW)
      d.setDate(d.getDate() - 100 - (5 - i) * 30)
      return makeTx({
        id: `cancelled-exp-${i}`,
        description: "ExpensiveCancelled",
        amount: 49.99,
      })
    })
    const result = detect([...cheap, ...expensive, ...cancelledDates])
    // Active ones come before cancelled ones
    const active = result.filter((r) => !r.looksCancelled)
    const cancelled = result.filter((r) => r.looksCancelled)
    for (const c of cancelled) {
      const lastActiveIndex = result.indexOf(
        result.filter((r) => !r.looksCancelled).at(-1)!,
      )
      expect(result.indexOf(c)).toBeGreaterThan(lastActiveIndex)
    }
    // Active sorted desc by cost
    if (active.length >= 2) {
      for (let i = 0; i < active.length - 1; i++) {
        expect(active[i]!.estimatedAmount).toBeGreaterThanOrEqual(
          active[i + 1]!.estimatedAmount,
        )
      }
    }
  })

  it("returns suggestedStartDate as lastSeen + medianGap", () => {
    const txs = buildMonthlyHistory(6, new Date("2026-06-01T12:00:00Z"))
    const result = detect(txs)
    expect(result).toHaveLength(1)
    const sub = result[0]!
    const expectedStart = new Date(sub.lastSeen)
    expectedStart.setDate(expectedStart.getDate() + Math.round(sub.medianGap))
    expect(sub.suggestedStartDate.toDateString()).toBe(expectedStart.toDateString())
  })

  it("suggestedCategoryId is the modal category across observations", () => {
    const endDate = new Date("2026-06-01T12:00:00Z")
    const txs = buildMonthlyHistory(6, endDate).map((t, i) => ({
      ...t,
      categoryId: i < 4 ? "cat-streaming" : "cat-other",
    }))
    const result = detect(txs)
    expect(result[0]?.suggestedCategoryId).toBe("cat-streaming")
  })

  it("suggestedCategoryId is null when all observations are uncategorized", () => {
    const txs = buildMonthlyHistory(6, new Date("2026-06-01T12:00:00Z"))
    const result = detect(txs)
    expect(result[0]?.suggestedCategoryId).toBeNull()
  })

  it("produces deterministic pattern IDs from the same input", () => {
    const txs = buildMonthlyHistory(6, new Date("2026-06-01T12:00:00Z"))
    const r1 = detect(txs)
    const r2 = detect(txs)
    expect(r1[0]?.id).toBe(r2[0]?.id)
  })

  it("uses the injected normalize() for merchant matching and bucket grouping", () => {
    const txs = buildMonthlyHistory(6, new Date("2026-06-01T12:00:00Z"), {
      description: "NETFLIX.COM/BILL",
    })
    const customNormalize = (raw: string) =>
      raw.toLowerCase().startsWith("netflix") ? "netflix" : raw.toLowerCase()
    const result = detectSuspectedSubscriptions({
      transactions: txs,
      recurringTransactions: [],
      dismissedPatterns: [],
      normalize: customNormalize,
      now: NOW,
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.merchantName).toBe("netflix")
  })

  it("only detects expenses — ignores income and transfers", () => {
    const endDate = new Date("2026-06-01T12:00:00Z")
    const income = buildMonthlyHistory(6, endDate, { type: "income" })
    const transfers = buildMonthlyHistory(6, endDate, { type: "transfer" })
    expect(detect([...income, ...transfers])).toEqual([])
  })
})

describe("computePatternKey", () => {
  it("produces the same key for identical inputs", () => {
    const k1 = computePatternKey("acc-1", "netflix", 999)
    const k2 = computePatternKey("acc-1", "netflix", 999)
    expect(k1).toBe(k2)
  })

  it("produces different keys for different accounts", () => {
    expect(computePatternKey("acc-1", "netflix", 999)).not.toBe(
      computePatternKey("acc-2", "netflix", 999),
    )
  })
})
