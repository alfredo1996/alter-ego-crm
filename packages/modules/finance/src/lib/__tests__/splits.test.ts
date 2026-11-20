import { describe, it, expect } from "vitest"

import { getCategoryAmount, accumulateCategorySpending } from "../splits"

import type { Transaction } from "../../types"

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    userId: "u1",
    accountId: "acc-1",
    type: "expense",
    amount: 100,
    currency: "USD",
    categoryId: "cat-1",
    description: "Test",
    rawDescription: null,
    date: new Date("2026-03-01"),
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

describe("getCategoryAmount", () => {
  it("returns single category map when no splits", () => {
    const tx = makeTx({ categoryId: "cat-1", amount: 50 })
    const result = getCategoryAmount(tx)
    expect(result.size).toBe(1)
    expect(result.get("cat-1")).toBe(50)
  })

  it("returns 'uncategorized' when no splits and no categoryId", () => {
    const tx = makeTx({ categoryId: null, amount: 75 })
    const result = getCategoryAmount(tx)
    expect(result.size).toBe(1)
    expect(result.get("uncategorized")).toBe(75)
  })

  it("returns split amounts per category", () => {
    const tx = makeTx({
      amount: 100,
      categoryId: null,
      splits: [
        { id: "s1", categoryId: "cat-a", amount: 60 },
        { id: "s2", categoryId: "cat-b", amount: 25 },
        { id: "s3", categoryId: "cat-c", amount: 15 },
      ],
    })
    const result = getCategoryAmount(tx)
    expect(result.size).toBe(3)
    expect(result.get("cat-a")).toBe(60)
    expect(result.get("cat-b")).toBe(25)
    expect(result.get("cat-c")).toBe(15)
  })

  it("merges duplicate category splits", () => {
    const tx = makeTx({
      amount: 100,
      categoryId: null,
      splits: [
        { id: "s1", categoryId: "cat-a", amount: 40 },
        { id: "s2", categoryId: "cat-a", amount: 60 },
      ],
    })
    const result = getCategoryAmount(tx)
    expect(result.size).toBe(1)
    expect(result.get("cat-a")).toBe(100)
  })

  it("handles empty splits array as single-category", () => {
    const tx = makeTx({ categoryId: "cat-1", amount: 30, splits: [] })
    const result = getCategoryAmount(tx)
    expect(result.size).toBe(1)
    expect(result.get("cat-1")).toBe(30)
  })
})

describe("accumulateCategorySpending", () => {
  it("accumulates across multiple transactions with and without splits", () => {
    const txs = [
      makeTx({ id: "t1", categoryId: "cat-a", amount: 50 }),
      makeTx({
        id: "t2",
        categoryId: null,
        amount: 100,
        splits: [
          { id: "s1", categoryId: "cat-a", amount: 60 },
          { id: "s2", categoryId: "cat-b", amount: 40 },
        ],
      }),
    ]
    const result = accumulateCategorySpending(txs)
    expect(result.get("cat-a")).toBe(110)
    expect(result.get("cat-b")).toBe(40)
  })
})
