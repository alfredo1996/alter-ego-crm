import { monthKey } from "./monthly-totals"
import { computeRollover, computeRolloverFromTotals } from "./rollover"
import { getCategoryAmount } from "./splits"

import type { FinanceAdapter } from "../adapter"
import type { Budget, BudgetWithSpending, MonthlyTotals, Transaction } from "../types"

/**
 * Budget spending, shared by the web UI (`useBudgetsWithSpending`) and the MCP
 * `get_budget_status` tool. Kept pure so the server can call it — the numbers
 * chat reports and the numbers the budgets page shows come from here, and
 * cannot drift.
 */

export type BudgetStatus = "ok" | "warning" | "danger"

type Spend = Pick<BudgetWithSpending, "spent" | "effectiveAmount">

/**
 * The one budget state, for every page and the MCP tool. Danger: spent the limit, or any spending
 * against a limit of zero or less (rollover debt can push it below zero; `percentage` is 0 there
 * and cannot say so). Warning: from 80%.
 */
export function getBudgetStatus({ spent, effectiveAmount }: Spend): BudgetStatus {
  if (effectiveAmount <= 0) return spent > 0 ? "danger" : "ok"
  if (spent >= effectiveAmount) return "danger"
  // Whole cents, so exactly 80% is never lost to float error (12 * 0.8 is 9.600000000000001).
  return Math.round(spent * 100) * 5 >= Math.round(effectiveAmount * 100) * 4 ? "warning" : "ok"
}

/** Over budgets first, then the fullest: `percentage` alone sinks a zero-limit budget to the bottom. */
export function byUrgency(a: Spend & { percentage: number }, b: Spend & { percentage: number }): number {
  return Number(getBudgetStatus(b) === "danger") - Number(getBudgetStatus(a) === "danger") || b.percentage - a.percentage
}

/** Start of the period `now` falls in: the 1st for monthly, Jan 1st for yearly. */
export function periodStartFor(budget: Budget, now: Date): Date {
  return budget.period === "monthly"
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : new Date(now.getFullYear(), 0, 1)
}

/**
 * The earliest date `budgetsWithSpending` reads: the oldest rollover period any of the
 * budgets walks back to (12 months, 2 years for a yearly budget, never before the
 * budget existed). A caller can load transactions from here on and skip the rest.
 */
export function budgetsWindowStart(budgets: Budget[], now: Date): Date {
  let start = periodStartFor({ period: "monthly" } as Budget, now)
  for (const budget of budgets) {
    const periodStart = periodStartFor(budget, now)
    const earliest =
      budget.rolloverMode === "reset"
        ? periodStart
        : budget.period === "monthly"
          ? new Date(periodStart.getFullYear(), periodStart.getMonth() - 12, 1)
          : new Date(periodStart.getFullYear() - 2, 0, 1)
    const since = earliest < budget.createdAt ? budget.createdAt : earliest
    if (since < start) start = since
  }
  return start
}

/**
 * Enriches budgets with current-period spending, rollover and remaining.
 *
 * Spending has no upper date bound — a transaction dated in the future counts
 * against the current period. That is the behaviour the budgets page has always
 * had; it is preserved here deliberately rather than quietly changed during the
 * extraction.
 *
 * Carry-over comes from `totals` (the stored monthly totals) when given, from the
 * transactions otherwise; the two give the same figures. `transactions` then only
 * has to reach back to the current period.
 */
export function budgetsWithSpending(
  budgets: Budget[],
  transactions: Transaction[],
  now: Date,
  totals?: MonthlyTotals,
): BudgetWithSpending[] {
  return budgets.map((budget) => {
    const periodStart = periodStartFor(budget, now)

    const spent = transactions
      .filter((tx) => tx.type === "expense" && tx.date >= periodStart)
      .reduce((sum, tx) => {
        if (!budget.categoryId) return sum + tx.amount
        const amounts = getCategoryAmount(tx)
        return sum + (amounts.get(budget.categoryId) ?? 0)
      }, 0)

    const rolloverAmount = totals
      ? computeRolloverFromTotals(budget, totals, periodStart)
      : computeRollover(budget, transactions, periodStart)
    const effectiveAmount = budget.amount + rolloverAmount
    const remaining = Math.max(0, effectiveAmount - spent)
    const percentage = effectiveAmount > 0 ? Math.min(100, (spent / effectiveAmount) * 100) : 0

    return { ...budget, spent, remaining, percentage, rolloverAmount, effectiveAmount }
  })
}

/**
 * Loads what `budgetsWithSpending` needs and computes it: the transactions of the current
 * period(s) and, for rollover budgets, the stored totals of the months before. One
 * implementation for the budgets page, the Dashboard, Reports and MCP `get_budget_status`.
 * About a dozen small documents instead of a year of transactions.
 */
export async function loadBudgetsWithSpending(
  db: Pick<FinanceAdapter, "getTransactions" | "getMonthlyTotals">,
  userId: string,
  budgets: Budget[],
  now: Date,
): Promise<BudgetWithSpending[]> {
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const currentWindow = budgets.reduce((min, b) => {
    const start = periodStartFor(b, now)
    return start < min ? start : min
  }, thisMonth)
  const carriedFrom = budgetsWindowStart(budgets.filter((b) => b.rolloverMode !== "reset"), now)
  const [transactions, totals] = await Promise.all([
    db.getTransactions(userId, { dateFrom: currentWindow }),
    carriedFrom < thisMonth
      ? db.getMonthlyTotals(userId, monthKey(carriedFrom), monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)))
      : ({} as MonthlyTotals),
  ])
  return budgetsWithSpending(budgets, transactions.data, now, totals)
}
