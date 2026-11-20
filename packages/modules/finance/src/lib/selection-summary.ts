import type { Currency, Transaction } from "../types"

export interface SelectionSummary {
  /** Every selected row. */
  count: number
  /** Rows in the figures: income and expenses. */
  counted: number
  /** Selected transfers, which move money between your own accounts and so are left out. */
  transfers: number
  /** In minus out. */
  net: number
  /** Sum of income, positive. */
  in: number
  /** Sum of expenses, positive. */
  out: number
  /** Net per counted row; null when nothing is counted. */
  average: number | null
  /** Signed amount of the counted row with the biggest absolute amount. */
  largest: number | null
  /** Signed amount of the counted row with the smallest absolute amount. */
  smallest: number | null
  mixedCurrencies: boolean
  /** The one currency of the counted rows; null when they differ or nothing is counted. */
  currency: Currency | null
}

// + 0 turns -0 into 0.
const cents = (x: number) => Math.round(x * 100) / 100 + 0

// ponytail: currencies are summed as stored, like the rest of the app; no conversion.
export function selectionSummary(transactions: Iterable<Transaction>): SelectionSummary {
  let count = 0
  let transfers = 0
  let inSum = 0
  let outSum = 0
  const signed: number[] = []
  const currencies = new Set<Currency>()
  for (const tx of transactions) {
    count++
    if (tx.type === "transfer") {
      transfers++
      continue
    }
    const amount = tx.type === "income" ? tx.amount : -tx.amount
    if (amount > 0) inSum += amount
    else outSum -= amount
    signed.push(amount)
    currencies.add(tx.currency)
  }
  const net = cents(inSum - outSum)
  const byMagnitude = [...signed].sort((a, b) => Math.abs(a) - Math.abs(b))
  return {
    count,
    counted: signed.length,
    transfers,
    net,
    in: cents(inSum),
    out: cents(outSum),
    average: signed.length ? cents(net / signed.length) : null,
    largest: byMagnitude.at(-1) ?? null,
    smallest: byMagnitude[0] ?? null,
    mixedCurrencies: currencies.size > 1,
    currency: currencies.size === 1 ? [...currencies][0] : null,
  }
}
