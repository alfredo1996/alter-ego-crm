import type { Transaction } from "../types"

/**
 * Returns a map of categoryId → amount for a transaction.
 * If the transaction has splits, returns split amounts per category.
 * Otherwise, returns the single category → full amount.
 */
export function getCategoryAmount(tx: Pick<Transaction, "splits" | "categoryId" | "amount">): Map<string, number> {
  const result = new Map<string, number>()

  if (tx.splits.length > 0) {
    for (const split of tx.splits) {
      result.set(split.categoryId, (result.get(split.categoryId) ?? 0) + split.amount)
    }
  } else {
    const catId = tx.categoryId ?? "uncategorized"
    result.set(catId, tx.amount)
  }

  return result
}

/**
 * Accumulates category spending totals from a list of expense transactions,
 * respecting splits.
 */
export function accumulateCategorySpending(expenses: Transaction[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const tx of expenses) {
    const amounts = getCategoryAmount(tx)
    for (const [catId, amount] of amounts) {
      totals.set(catId, (totals.get(catId) ?? 0) + amount)
    }
  }
  return totals
}
