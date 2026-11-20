import { describe, it, expect } from "vitest"

import { budgetsWindowStart, budgetsWithSpending, getBudgetStatus, periodStartFor } from "../budgets"
import { monthKey, totalsFromTransactions } from "../monthly-totals"

import type { Budget, MonthlyTotals, Transaction } from "../../types"

/**
 * `budgetsWithSpending` is the one implementation behind both the budgets page
 * and the MCP `get_budget_status` tool, so these cases pin the arithmetic that
 * chat and UI now share.
 */

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: "b1",
    userId: "u1",
    name: "Spesa",
    categoryId: null,
    amount: 500,
    currency: "EUR",
    period: "monthly",
    rolloverMode: "reset",
    createdAt: new Date(2026, 0, 1),
    updatedAt: new Date(2026, 0, 1),
    ...overrides,
  }
}

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx1",
    userId: "u1",
    accountId: "a1",
    type: "expense",
    amount: 100,
    currency: "EUR",
    categoryId: null,
    description: "Test",
    rawDescription: null,
    date: new Date(2026, 2, 15), // March 2026
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

const march = new Date(2026, 2, 20) // "now" — inside March 2026

describe("periodStartFor", () => {
  it("monthly starts on the 1st of the current month", () => {
    expect(periodStartFor(makeBudget(), march)).toEqual(new Date(2026, 2, 1))
  })

  it("yearly starts on January 1st", () => {
    expect(periodStartFor(makeBudget({ period: "yearly" }), march)).toEqual(new Date(2026, 0, 1))
  })
})

describe("budgetsWithSpending", () => {
  it("sums only current-period expenses, ignoring income and earlier months", () => {
    const [row] = budgetsWithSpending(
      [makeBudget()],
      [
        makeTx({ id: "t1", amount: 120 }),
        makeTx({ id: "t2", amount: 80 }),
        makeTx({ id: "t3", amount: 999, type: "income" }),
        makeTx({ id: "t4", amount: 400, date: new Date(2026, 1, 10) }), // February
      ],
      march
    )
    expect(row.spent).toBe(200)
    expect(row.remaining).toBe(300)
    expect(row.percentage).toBe(40)
  })

  it("a category budget counts only its own share of a split transaction", () => {
    const split = makeTx({
      amount: 100,
      categoryId: null,
      splits: [
        { id: "s1", categoryId: "food", amount: 70, note: null },
        { id: "s2", categoryId: "home", amount: 30, note: null },
      ],
    })
    const [food] = budgetsWithSpending([makeBudget({ categoryId: "food" })], [split], march)
    expect(food.spent).toBe(70)
  })

  it("an uncategorised budget counts every expense in full", () => {
    const [row] = budgetsWithSpending(
      [makeBudget({ categoryId: null })],
      [makeTx({ amount: 250, categoryId: "food" })],
      march
    )
    expect(row.spent).toBe(250)
  })

  it("rollover raises the effective amount that remaining is measured against", () => {
    // February was a 500 budget with 300 spent → 200 surplus carried into March.
    const budget = makeBudget({ rolloverMode: "surplus", createdAt: new Date(2026, 1, 1) })
    const [row] = budgetsWithSpending(
      [budget],
      [
        makeTx({ id: "feb", amount: 300, date: new Date(2026, 1, 10) }),
        makeTx({ id: "mar", amount: 100 }),
      ],
      march
    )
    expect(row.rolloverAmount).toBe(200)
    expect(row.effectiveAmount).toBe(700)
    expect(row.spent).toBe(100)
    expect(row.remaining).toBe(600)
  })

  it("clamps an overspent budget at 100% and never reports negative remaining", () => {
    const [row] = budgetsWithSpending([makeBudget()], [makeTx({ amount: 800 })], march)
    expect(row.spent).toBe(800)
    expect(row.remaining).toBe(0)
    expect(row.percentage).toBe(100)
    expect(getBudgetStatus(row)).toBe("danger")
  })

  it("a zero-amount budget reports 0% rather than dividing by zero", () => {
    const [row] = budgetsWithSpending([makeBudget({ amount: 0 })], [makeTx({ amount: 50 })], march)
    expect(row.percentage).toBe(0)
    expect(Number.isFinite(row.percentage)).toBe(true)
  })
})

describe("budgetsWindowStart", () => {
  const now = new Date(2026, 9, 13)

  it("is the current period start with no budgets or reset budgets", () => {
    expect(budgetsWindowStart([], now)).toEqual(new Date(2026, 9, 1))
    expect(budgetsWindowStart([makeBudget({ rolloverMode: "reset" })], now)).toEqual(new Date(2026, 9, 1))
  })

  it("walks a rolling monthly budget back 12 months, no earlier than its creation", () => {
    const old = makeBudget({ rolloverMode: "full", createdAt: new Date(2020, 0, 1) })
    expect(budgetsWindowStart([old], now)).toEqual(new Date(2025, 9, 1))
    const young = makeBudget({ rolloverMode: "surplus", createdAt: new Date(2026, 5, 20) })
    expect(budgetsWindowStart([young], now)).toEqual(new Date(2026, 5, 20))
  })

  it("walks a rolling yearly budget back two years and keeps the earliest across budgets", () => {
    const yearly = makeBudget({ period: "yearly", rolloverMode: "deficit", createdAt: new Date(2020, 0, 1) })
    const reset = makeBudget({ id: "b2" })
    expect(budgetsWindowStart([reset, yearly], now)).toEqual(new Date(2024, 0, 1))
  })

  it("covers every transaction budgetsWithSpending reads", () => {
    const budget = makeBudget({ rolloverMode: "full", createdAt: new Date(2020, 0, 1) })
    const start = budgetsWindowStart([budget], now)
    const txs = [
      makeTx({ id: "in", amount: 100, date: new Date(2025, 9, 2) }),
      makeTx({ id: "out", amount: 999, date: new Date(2025, 8, 30) }),
    ]
    const windowed = txs.filter((t) => t.date >= start)
    expect(budgetsWithSpending([budget], windowed, now)).toEqual(budgetsWithSpending([budget], txs, now))
    expect(windowed.map((t) => t.id)).toEqual(["in"])
  })
})

describe("budgetsWithSpending from stored monthly totals", () => {
  // 24 months, 4 rows a month: plain, categorised, split, and one income that must not count.
  const now = new Date(2026, 9, 13)
  const txs = Array.from({ length: 24 * 4 }, (_, i) => {
    const date = new Date(2026, 9 - Math.floor(i / 4), 1 + (i % 4) * 6)
    return makeTx({
      id: `t${i}`,
      date,
      amount: 20 + ((i * 37) % 130),
      type: i % 4 === 3 ? "income" : "expense",
      categoryId: i % 4 === 1 ? "food" : null,
      splits: i % 4 === 2 ? [{ id: "s", categoryId: "food", amount: 7 }, { id: "t", categoryId: "fun", amount: 13 }] : [],
    })
  })
  const totals: MonthlyTotals = {}
  for (const tx of txs) totals[monthKey(tx.date)] ??= totalsFromTransactions(txs.filter((t) => monthKey(t.date) === monthKey(tx.date)))
  const old = new Date(2020, 0, 1)
  const budgets = [
    makeBudget({ id: "reset", rolloverMode: "reset", createdAt: old }),
    makeBudget({ id: "full", rolloverMode: "full", amount: 300, createdAt: old }),
    makeBudget({ id: "surplus", rolloverMode: "surplus", categoryId: "food", amount: 400, createdAt: old }),
    makeBudget({ id: "deficit", rolloverMode: "deficit", categoryId: "fun", amount: 5, createdAt: old }),
    makeBudget({ id: "young", rolloverMode: "full", amount: 300, createdAt: new Date(2026, 6, 20) }),
    makeBudget({ id: "yfull", period: "yearly", rolloverMode: "full", amount: 3000, createdAt: old }),
    makeBudget({ id: "ycat", period: "yearly", rolloverMode: "surplus", categoryId: "food", amount: 5000, createdAt: old }),
  ]

  it("gives the same spent, carried over and effective amount as the raw computation", () => {
    const raw = budgetsWithSpending(budgets, txs, now)
    // every rollover budget really carries something over, so equality is not 0 === 0
    expect(raw.filter((b) => b.rolloverMode !== "reset").map((b) => b.rolloverAmount !== 0)).toEqual(Array(6).fill(true))
    expect(budgetsWithSpending(budgets, txs.filter((t) => t.date >= new Date(2026, 0, 1)), now, totals)).toEqual(raw)
  })
})
