import { monthKey, monthKeysBetween, totalsFromTransactions } from "@alter-ego/finance/lib/monthly-totals"
import { beforeEach, describe, expect, it } from "vitest"


import type { DatabaseAdapter } from "../types"

/**
 * Every transaction write path must leave the stored monthly totals equal to a fresh
 * recomputation from the transactions. One definition, run against the mock, the Firebase
 * client adapter and firebase-admin (what MCP writes go through). Each case starts from a
 * new user whose months are all stored ("ready"), writes, then compares: so a path that
 * skips its adjustment cannot be rescued by the lazy fill.
 */

export type PathsDb = Pick<
  DatabaseAdapter,
  "createAccount" | "createTransaction" | "updateTransaction" | "deleteTransaction" | "getTransactions" | "getMonthlyTotals"
> &
  Partial<
    Pick<
      DatabaseAdapter,
      | "deleteTransactions"
      | "deleteAllTransactions"
      | "deleteAllAccountData"
      | "createRecurringTransaction"
      | "generateDue"
    >
  >

const FIRST = "2026-01"
const LAST = "2026-06"
const nonZero = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== 0))

export function describeMonthlyTotalPaths(name: string, db: PathsDb, newUser: () => Promise<string>) {
  describe(`${name} — monthly totals follow every transaction write`, () => {
    let u: string
    let acc: string

    const all = async () => (await db.getTransactions(u)).data
    const idOf = async (amount: number) => (await all()).find((t) => t.amount === amount)!.id
    const add = (over: Partial<Parameters<typeof db.createTransaction>[1]> = {}) =>
      db.createTransaction(u, {
        accountId: acc, type: "expense", amount: 100, currency: "USD", description: "x",
        categoryId: "food", date: new Date(2026, 2, 10), ...over,
      })

    async function expectInStep() {
      const stored = await db.getMonthlyTotals(u, FIRST, LAST)
      const txs = await all()
      for (const month of monthKeysBetween(FIRST, LAST)) {
        const fresh = totalsFromTransactions(txs.filter((t) => monthKey(t.date) === month))
        expect(stored[month].total, month).toBe(fresh.total)
        // a category that nets to 0 keeps its key at 0 in the store (increment), which reads the same
        expect(nonZero(stored[month].expenseByCategory), month).toEqual(fresh.expenseByCategory)
      }
      return stored["2026-03"].expenseByCategory
    }

    beforeEach(async () => {
      u = await newUser()
      acc = (await db.createAccount(u, { name: "A", type: "checking", currency: "USD", balance: 0 })).id
      await add({ amount: 40, date: new Date(2026, 1, 3) })
      await add({ amount: 60, categoryId: "fun" })
      await add({
        amount: 90, categoryId: null,
        splits: [{ id: "s1", categoryId: "food", amount: 50 }, { id: "s2", categoryId: "fun", amount: 40 }],
      })
      expect(await expectInStep()).toEqual({ fun: 100, food: 50 }) // stores every month from here on
    })

    // [case, write, March after: food, fun]. March starts as food 50, fun 100.
    const cases: [string, () => Promise<unknown>, [number, number]][] = [
      ["create", () => add({ amount: 25 }), [75, 100]],
      ["create an income: nothing counted", () => add({ type: "income", amount: 500 }), [50, 100]],
      ["create a transfer: nothing counted", async () => {
        const other = await db.createAccount(u, { name: "B", type: "savings", currency: "USD", balance: 0 })
        return add({ type: "transfer", transferToAccountId: other.id })
      }, [50, 100]],
      ["update the amount", async () => db.updateTransaction(u, await idOf(60), { amount: 70 }), [50, 110]],
      ["update the category", async () => db.updateTransaction(u, await idOf(60), { categoryId: "food" }), [110, 40]],
      ["uncategorize: the amount leaves the old category's totals", async () => db.updateTransaction(u, await idOf(60), { categoryId: null }), [50, 40]],
      ["update the date into another month", async () => db.updateTransaction(u, await idOf(60), { date: new Date(2026, 4, 2) }), [50, 40]],
      ["change a split row's amount, splits kept: the total moves, the categories do not", async () => db.updateTransaction(u, await idOf(90), { amount: 100 }), [50, 100]],
      ["edit the splits", async () => db.updateTransaction(u, await idOf(90), { splits: [{ id: "s1", categoryId: "fun", amount: 90 }] }), [0, 150]],
      ["turn an expense into income", async () => db.updateTransaction(u, await idOf(60), { type: "income" }), [50, 40]],
      ["update something the totals do not count", async () => db.updateTransaction(u, await idOf(60), { description: "renamed" }), [50, 100]],
      ["delete", async () => db.deleteTransaction(u, await idOf(60)), [50, 40]],
    ]
    if (db.deleteTransactions) {
      cases.push(["delete several", async () => db.deleteTransactions!(u, (await all()).map((t) => t.id)), [0, 0]])
    }
    if (db.deleteAllTransactions) cases.push(["delete all transactions", () => db.deleteAllTransactions!(u), [0, 0]])
    if (db.deleteAllAccountData) cases.push(["delete all account data", () => db.deleteAllAccountData!(u), [0, 0]])

    it.each(cases)("%s", async (_name, write, [food, fun]) => {
      await write()
      const march = await expectInStep()
      // exact figures too, so a path that skips the adjustment AND the recompute cannot pass
      expect({ food: march.food ?? 0, fun: march.fun ?? 0 }).toEqual({ food, fun })
    })

    if (db.createRecurringTransaction && db.generateDue) {
      it("a recurring rule generating its due rows goes through create", async () => {
        await db.createRecurringTransaction!(u, {
          accountId: acc, type: "expense", amount: 30, currency: "USD", categoryId: "food", description: "rent",
          frequency: "monthly", interval: 1, startDate: new Date(2026, 3, 5),
        } as Parameters<NonNullable<typeof db.createRecurringTransaction>>[1])
        await db.generateDue!(u, new Date(2026, 5, 20))
        const stored = await db.getMonthlyTotals(u, "2026-05", "2026-05")
        expect(stored["2026-05"].expenseByCategory.food).toBe(30)
        await expectInStep()
      })
    }

    it("parallel writes add up instead of overwriting each other", async () => {
      await Promise.all([30, 31, 32, 33, 34, 35, 36, 37].map((amount) => add({ amount, categoryId: "par" })))
      const march = await expectInStep()
      expect(march.par).toBe(30 + 31 + 32 + 33 + 34 + 35 + 36 + 37)
    })
  })
}
