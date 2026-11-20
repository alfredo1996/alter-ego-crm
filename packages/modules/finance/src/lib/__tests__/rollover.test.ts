import { describe, it, expect } from "vitest"

import { computeRollover } from "../rollover"

import type { Budget, Transaction } from "../../types"

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: "b1",
    userId: "u1",
    name: "Test Budget",
    categoryId: null,
    amount: 500,
    currency: "USD",
    period: "monthly",
    rolloverMode: "reset",
    createdAt: new Date(2025, 1, 1), // Feb 1 — most tests use Feb transactions
    updatedAt: new Date(2025, 1, 1),
    ...overrides,
  }
}

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx1",
    userId: "u1",
    accountId: "a1",
    type: "expense",
    amount: 300,
    currency: "USD",
    categoryId: null,
    description: "Test",
    rawDescription: null,
    date: new Date(2025, 1, 15), // Feb 2025
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

describe("computeRollover", () => {
  const marchStart = new Date(2025, 2, 1) // current period = March 2025

  it("reset mode always returns 0", () => {
    const budget = makeBudget({ rolloverMode: "reset" })
    const txs = [makeTx({ amount: 300 })]
    expect(computeRollover(budget, txs, marchStart)).toBe(0)
  })

  it("surplus mode with under-spend returns positive rollover", () => {
    const budget = makeBudget({ rolloverMode: "surplus", amount: 500 })
    // Feb: spent 300 of 500 → surplus 200
    const txs = [makeTx({ amount: 300, date: new Date(2025, 1, 15) })]
    expect(computeRollover(budget, txs, marchStart)).toBe(200)
  })

  it("surplus mode with over-spend clamps to 0", () => {
    const budget = makeBudget({ rolloverMode: "surplus", amount: 500 })
    // Feb: spent 600 of 500 → deficit -100, clamped to 0
    const txs = [makeTx({ amount: 600, date: new Date(2025, 1, 15) })]
    expect(computeRollover(budget, txs, marchStart)).toBe(0)
  })

  it("deficit mode with over-spend returns negative rollover", () => {
    const budget = makeBudget({ rolloverMode: "deficit", amount: 500 })
    // Feb: spent 700 of 500 → deficit -200
    const txs = [makeTx({ amount: 700, date: new Date(2025, 1, 15) })]
    expect(computeRollover(budget, txs, marchStart)).toBe(-200)
  })

  it("deficit mode with under-spend clamps to 0", () => {
    const budget = makeBudget({ rolloverMode: "deficit", amount: 500 })
    // Feb: spent 300 of 500 → surplus 200, clamped to 0
    const txs = [makeTx({ amount: 300, date: new Date(2025, 1, 15) })]
    expect(computeRollover(budget, txs, marchStart)).toBe(0)
  })

  it("full mode with under-spend returns positive", () => {
    const budget = makeBudget({ rolloverMode: "full", amount: 500 })
    const txs = [makeTx({ amount: 300, date: new Date(2025, 1, 15) })]
    expect(computeRollover(budget, txs, marchStart)).toBe(200)
  })

  it("full mode with over-spend returns negative", () => {
    const budget = makeBudget({ rolloverMode: "full", amount: 500 })
    const txs = [makeTx({ amount: 700, date: new Date(2025, 1, 15) })]
    expect(computeRollover(budget, txs, marchStart)).toBe(-200)
  })

  it("multi-month accumulation compounds", () => {
    const budget = makeBudget({ rolloverMode: "full", amount: 500, createdAt: new Date(2025, 1, 1) })
    const aprilStart = new Date(2025, 3, 1)
    // Feb: spent 300 → surplus 200
    // March: effective = 500 + 200 = 700, spent 400 → surplus 300
    const txs = [
      makeTx({ id: "t1", amount: 300, date: new Date(2025, 1, 15) }),
      makeTx({ id: "t2", amount: 400, date: new Date(2025, 2, 15) }),
    ]
    expect(computeRollover(budget, txs, aprilStart)).toBe(300)
  })

  it("category-specific budget only counts that category", () => {
    const budget = makeBudget({ rolloverMode: "surplus", amount: 500, categoryId: "cat-food" })
    const txs = [
      // Food category expense
      makeTx({ id: "t1", amount: 200, date: new Date(2025, 1, 15), categoryId: "cat-food" }),
      // Different category — should be ignored
      makeTx({ id: "t2", amount: 1000, date: new Date(2025, 1, 16), categoryId: "cat-transport" }),
    ]
    // Only 200 of 500 spent on food → surplus 300
    expect(computeRollover(budget, txs, marchStart)).toBe(300)
  })

  it("overall budget (null category) counts all expenses", () => {
    const budget = makeBudget({ rolloverMode: "full", amount: 1000, categoryId: null })
    const txs = [
      makeTx({ id: "t1", amount: 300, date: new Date(2025, 1, 10), categoryId: "cat-food" }),
      makeTx({ id: "t2", amount: 200, date: new Date(2025, 1, 20), categoryId: "cat-transport" }),
    ]
    // Total spent = 500 of 1000 → surplus 500
    expect(computeRollover(budget, txs, marchStart)).toBe(500)
  })
})
