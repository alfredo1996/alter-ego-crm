import { monthKey } from "./monthly-totals"
import { getCategoryAmount } from "./splits"

import type { Budget, MonthlyTotals, Transaction, RolloverMode } from "../types"

/**
 * Computes the rollover amount for a budget based on historical spending.
 * Walks backwards from `currentPeriodStart` up to 12 months (or budget creation),
 * accumulating surplus/deficit per the rollover mode.
 */
export function computeRollover(
  budget: Budget,
  transactions: Transaction[],
  currentPeriodStart: Date,
): number {
  return rolloverFrom(budget, currentPeriodStart, (start, end) =>
    computePeriodSpending(budget, transactions, start, end),
  )
}

/**
 * The same walk over the stored monthly totals instead of the transactions: the periods
 * before the current one are read from one small document per month. A month missing from
 * `totals` counts as nothing spent (the loader fills every month the walk reaches).
 */
export function computeRolloverFromTotals(
  budget: Budget,
  totals: MonthlyTotals,
  currentPeriodStart: Date,
): number {
  return rolloverFrom(budget, currentPeriodStart, (start) => {
    const months = budget.period === "monthly" ? 1 : 12
    let spent = 0
    for (let i = 0; i < months; i++) {
      const month = totals[monthKey(new Date(start.getFullYear(), start.getMonth() + i, 1))]
      if (month) spent += budget.categoryId ? (month.expenseByCategory[budget.categoryId] ?? 0) : month.total
    }
    return spent
  })
}

function rolloverFrom(
  budget: Budget,
  currentPeriodStart: Date,
  periodSpent: (periodStart: Date, periodEnd: Date) => number,
): number {
  if (budget.rolloverMode === "reset") return 0

  const maxMonths = budget.period === "monthly" ? 12 : 2
  let accumulated = 0

  for (let i = 1; i <= maxMonths; i++) {
    const periodStart =
      budget.period === "monthly"
        ? new Date(currentPeriodStart.getFullYear(), currentPeriodStart.getMonth() - i, 1)
        : new Date(currentPeriodStart.getFullYear() - i, 0, 1)

    // Stop if we've gone past when the budget was created
    if (periodStart < budget.createdAt) break

    const periodEnd =
      budget.period === "monthly"
        ? new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0, 23, 59, 59, 999)
        : new Date(periodStart.getFullYear(), 11, 31, 23, 59, 59, 999)

    const spent = periodSpent(periodStart, periodEnd)
    const effectiveBudget = budget.amount + accumulated
    accumulated = effectiveBudget - spent
  }

  return clampByMode(accumulated, budget.rolloverMode)
}

function computePeriodSpending(
  budget: Budget,
  transactions: Transaction[],
  periodStart: Date,
  periodEnd: Date,
): number {
  return transactions
    .filter((tx) => tx.type === "expense" && tx.date >= periodStart && tx.date <= periodEnd)
    .reduce((sum, tx) => {
      if (!budget.categoryId) return sum + tx.amount
      const amounts = getCategoryAmount(tx)
      return sum + (amounts.get(budget.categoryId) ?? 0)
    }, 0)
}

function clampByMode(value: number, mode: RolloverMode): number {
  switch (mode) {
    case "surplus":
      return Math.max(0, value)
    case "deficit":
      return Math.min(0, value)
    case "full":
      return value
    default:
      return 0
  }
}
