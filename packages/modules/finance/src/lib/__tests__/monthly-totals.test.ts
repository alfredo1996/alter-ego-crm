import { describe, expect, it } from "vitest"

import { mockFinance } from "../../adapter-mock"
import { budgetsWithSpending, loadBudgetsWithSpending } from "../budgets"
import { afterUpdate, totalsDelta, type CountedTransaction } from "../monthly-totals"

import type { Transaction } from "../../types"

const U = "u-loader"
const db = mockFinance

describe("totalsDelta", () => {
  const tx = (over: Partial<Transaction>) =>
    ({ type: "expense", date: new Date(2026, 2, 10), amount: 10, categoryId: "a", splits: [], ...over }) as Transaction

  it("is empty when nothing the budgets count changes", () => {
    expect(totalsDelta(tx({}), tx({ description: "renamed" } as Partial<Transaction>)).size).toBe(0)
    expect(totalsDelta(null, tx({ type: "income" })).size).toBe(0)
  })

  it("moves an amount between months and categories", () => {
    const d = totalsDelta(tx({}), tx({ date: new Date(2026, 3, 1), categoryId: "b" }))
    expect(Object.fromEntries(d)).toEqual({
      "2026-03": { total: -10, byCategory: { a: -10 } },
      "2026-04": { total: 10, byCategory: { b: 10 } },
    })
  })
})

describe("afterUpdate", () => {
  const before = { type: "expense", date: new Date(2026, 2, 10), amount: 10, categoryId: "a", splits: [] } satisfies CountedTransaction

  it.each([
    ["null uncategorizes", { categoryId: null }, null],
    ["a new id replaces it", { categoryId: "b" }, "b"],
    ["absent keeps it", {}, "a"],
  ])("categoryId: %s", (_, input, expected) => {
    expect(afterUpdate(before, input).categoryId).toBe(expected)
  })
})

describe("loading the budgets", () => {
  it("reads only this month's transactions and the stored months before", async () => {
    const now = new Date(2026, 5, 15)
    const acc = (await db.createAccount(U, { name: "A", type: "checking", currency: "EUR", balance: 0 })).id
    for (const [month, amount] of [[1, 40], [2, 80], [3, 250], [4, 10], [5, 70]]) {
      await db.createTransaction(U, { accountId: acc, type: "expense", amount, currency: "EUR", description: "x", categoryId: "food", date: new Date(2026, month, 9) })
    }
    const budget = await db.createBudget(U, { name: "Food", categoryId: "food", amount: 100, currency: "EUR", period: "monthly", rolloverMode: "full" })
    const spy = { tx: [] as unknown[], months: [] as string[] }
    const wrapped = {
      getTransactions: (u: string, f?: Parameters<typeof db.getTransactions>[1]) => (spy.tx.push(f), db.getTransactions(u, f)),
      getMonthlyTotals: (u: string, a: string, b: string) => (spy.months.push(`${a}..${b}`), db.getMonthlyTotals(u, a, b)),
    }
    const [row] = await loadBudgetsWithSpending(wrapped, U, [{ ...budget, createdAt: new Date(2026, 0, 1) }], now)
    expect(spy.tx).toEqual([{ dateFrom: new Date(2026, 5, 1) }])
    expect(spy.months).toEqual(["2026-01..2026-05"])
    const raw = budgetsWithSpending([{ ...budget, createdAt: new Date(2026, 0, 1) }], (await db.getTransactions(U)).data, now)
    expect(row).toEqual(raw[0])
    expect(row.rolloverAmount).not.toBe(0)
  })
})
