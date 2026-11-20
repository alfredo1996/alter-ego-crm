import { txDelta } from "./account-ledger"

import type { Transaction } from "../types"

export { txDelta }

export interface BalancePoint {
  date: Date
  balance: number
}

/**
 * Reconstruct the historical balance series for `accountId` by walking backward
 * from `currentBalance`, subtracting each transaction's delta (newest → oldest).
 *
 * Returns points oldest → newest: an opening point (the balance *before* the
 * first transaction) followed by one point per transaction. Empty array when
 * there are no transactions.
 */
export function reconstructBalanceSeries(
  transactions: Transaction[],
  currentBalance: number,
  accountId: string,
): BalancePoint[] {
  const sorted = [...transactions].sort((a, b) => a.date.getTime() - b.date.getTime())
  if (sorted.length === 0) return []

  // running[0] = opening balance, running[i+1] = balance after sorted[i]
  const running: number[] = new Array(sorted.length + 1)
  running[sorted.length] = currentBalance
  for (let i = sorted.length - 1; i >= 0; i--) {
    running[i] = running[i + 1] - txDelta(sorted[i], accountId)
  }

  return [
    { date: sorted[0].date, balance: running[0] },
    ...sorted.map((tx, i) => ({ date: tx.date, balance: running[i + 1] })),
  ]
}
