import { addMonths, format } from "date-fns"

import { getCategoryAmount } from "./splits"

import type { CreateTransactionInput, MonthlyTotal, Transaction, UpdateTransactionInput } from "../types"

/**
 * Per-month expense totals (`users/{uid}/monthly_totals/{yyyy-MM}`), the rollup that lets
 * a rollover budget read its carried-over months without the transactions.
 *
 * Months are local calendar months, like every date in the app (servers pin Europe/Rome,
 * see `pinServerTimeZone`), so a writer and a reader agree on which month a day is in.
 * Counts what `budgetsWithSpending` counts: expenses, splits on their own categories,
 * `excludeFromReports` and all (the budgets never skipped them). Transfers and income: no.
 */

export const monthKey = (date: Date): string => format(date, "yyyy-MM")

/** Every month from `from` to `to`, inclusive. */
export function monthKeysBetween(from: string, to: string): string[] {
  const keys: string[] = []
  for (let d = new Date(`${from}-01T12:00:00`); monthKey(d) <= to; d = addMonths(d, 1)) keys.push(monthKey(d))
  return keys
}

/** [start, end] of a "yyyy-MM" month, as the rollover walks it. */
export function monthBounds(key: string): { start: Date; end: Date } {
  const [y, m] = key.split("-").map(Number)
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59, 59, 999) }
}

/** The fields of a transaction the totals depend on. */
export type CountedTransaction = Pick<Transaction, "type" | "date" | "amount" | "categoryId" | "splits">

/** The part of a new transaction the totals depend on. */
export function afterCreate(input: CreateTransactionInput): CountedTransaction {
  return { type: input.type, date: input.date, amount: input.amount, categoryId: input.categoryId ?? null, splits: input.splits ?? [] }
}

/** `before` with an update applied, as far as the totals can tell. */
export function afterUpdate(before: CountedTransaction, input: UpdateTransactionInput): CountedTransaction {
  return {
    type: input.type ?? before.type,
    date: input.date ?? before.date,
    amount: input.amount ?? before.amount,
    categoryId: input.categoryId !== undefined ? input.categoryId : before.categoryId,
    splits: input.splits ?? before.splits,
  }
}

/** What a change adds to one month: a delta on the total and on each category. */
export interface MonthDelta {
  total: number
  byCategory: Record<string, number>
}

/**
 * The net change to the monthly totals when `before` becomes `after` (null = absent: a
 * create has no before, a delete no after). Months and categories that cancel are left out,
 * so a write that changes nothing the budgets count touches no document.
 */
export function totalsDelta(before: CountedTransaction | null, after: CountedTransaction | null): Map<string, MonthDelta> {
  const out = new Map<string, MonthDelta>()
  const add = (tx: CountedTransaction | null, sign: 1 | -1) => {
    if (!tx || tx.type !== "expense") return
    const key = monthKey(tx.date)
    const month = out.get(key) ?? { total: 0, byCategory: {} }
    out.set(key, month)
    month.total += sign * tx.amount
    for (const [categoryId, amount] of getCategoryAmount(tx)) {
      month.byCategory[categoryId] = (month.byCategory[categoryId] ?? 0) + sign * amount
    }
  }
  add(before, -1)
  add(after, 1)
  for (const [key, month] of out) {
    for (const [categoryId, amount] of Object.entries(month.byCategory)) {
      if (amount === 0) delete month.byCategory[categoryId]
    }
    if (month.total === 0 && Object.keys(month.byCategory).length === 0) out.delete(key)
  }
  return out
}

/** One month's totals from its transactions: what the lazy fill stores. */
export function totalsFromTransactions(transactions: Transaction[]): MonthlyTotal {
  const result: MonthlyTotal = { total: 0, expenseByCategory: {} }
  for (const tx of transactions) {
    for (const month of totalsDelta(null, tx).values()) {
      result.total += month.total
      for (const [categoryId, amount] of Object.entries(month.byCategory)) {
        result.expenseByCategory[categoryId] = (result.expenseByCategory[categoryId] ?? 0) + amount
      }
    }
  }
  return result
}
