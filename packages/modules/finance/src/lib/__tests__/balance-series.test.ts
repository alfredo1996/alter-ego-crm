import { describe, it, expect } from "vitest"

import { txDelta, reconstructBalanceSeries } from "../balance-series"

import type { Transaction } from "../../types"

const ACC = "acc-1"
const OTHER = "acc-2"

// Minimal transaction factory — reconstruction only reads type/amount/date/accountId/transferToAccountId.
function tx(p: Partial<Transaction> & Pick<Transaction, "type" | "amount">): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    userId: "u1",
    accountId: ACC,
    transferToAccountId: null,
    linkedTransactionId: null,
    currency: "EUR",
    categoryId: null,
    description: "t",
    rawDescription: null,
    date: new Date("2026-01-01"),
    notes: null,
    tagIds: [],
    splits: [],
    attachments: [],
    status: "cleared",
    isRecurring: false,
    importHash: null,
    excludeFromReports: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...p,
  } as Transaction
}

describe("txDelta", () => {
  it("income adds, expense subtracts", () => {
    expect(txDelta(tx({ type: "income", amount: 50 }), ACC)).toBe(50)
    expect(txDelta(tx({ type: "expense", amount: 50 }), ACC)).toBe(-50)
  })

  it("transfer INTO this account is positive", () => {
    expect(txDelta(tx({ type: "transfer", amount: 30, accountId: OTHER, transferToAccountId: ACC }), ACC)).toBe(30)
  })

  it("transfer OUT of this account is negative", () => {
    expect(txDelta(tx({ type: "transfer", amount: 30, accountId: ACC, transferToAccountId: OTHER }), ACC)).toBe(-30)
  })
})

describe("reconstructBalanceSeries", () => {
  it("returns [] with no transactions", () => {
    expect(reconstructBalanceSeries([], 100, ACC)).toEqual([])
  })

  it("anchors the final point to currentBalance and derives the opening balance", () => {
    // one +30 income, current balance 100 → opening was 70
    const series = reconstructBalanceSeries([tx({ type: "income", amount: 30 })], 100, ACC)
    expect(series).toHaveLength(2) // opening + one per tx
    expect(series[0].balance).toBe(70) // before the tx
    expect(series[1].balance).toBe(100) // == currentBalance
  })

  it("opening balance = currentBalance minus the sum of all deltas", () => {
    const txs = [
      tx({ type: "income", amount: 1000, date: new Date("2026-01-01") }),
      tx({ type: "expense", amount: 250, date: new Date("2026-01-02") }),
      tx({ type: "transfer", amount: 100, accountId: OTHER, transferToAccountId: ACC, date: new Date("2026-01-03") }), // +100 in
      tx({ type: "transfer", amount: 40, accountId: ACC, transferToAccountId: OTHER, date: new Date("2026-01-04") }), // -40 out
    ]
    const current = 5000
    const series = reconstructBalanceSeries(txs, current, ACC)
    const totalDelta = 1000 - 250 + 100 - 40 // = 810
    expect(series[0].balance).toBe(current - totalDelta) // 4190
    expect(series[series.length - 1].balance).toBe(current)
    // each step applies exactly its delta
    expect(series[1].balance).toBe(4190 + 1000)
    expect(series[2].balance).toBe(5190 - 250)
    expect(series[3].balance).toBe(4940 + 100)
    expect(series[4].balance).toBe(5040 - 40)
  })

  it("sorts unsorted input by date before reconstructing", () => {
    const txs = [
      tx({ type: "expense", amount: 10, date: new Date("2026-03-01") }),
      tx({ type: "income", amount: 100, date: new Date("2026-01-01") }),
    ]
    const series = reconstructBalanceSeries(txs, 500, ACC)
    // dates must be ascending
    expect(series.map((p) => p.date.getTime())).toEqual([...series.map((p) => p.date.getTime())].sort((a, b) => a - b))
  })

  it("counts transfers (regression for the #86 chart bug)", () => {
    // A transfer-heavy account: ignoring transfers would put the opening point far off.
    const txs = [
      tx({ type: "transfer", amount: 1000, accountId: OTHER, transferToAccountId: ACC, date: new Date("2026-01-01") }), // top-up +1000
      tx({ type: "expense", amount: 200, date: new Date("2026-01-02") }),
    ]
    const series = reconstructBalanceSeries(txs, 800, ACC)
    // opening = 800 - (1000 - 200) = 0
    expect(series[0].balance).toBe(0)
  })
})
