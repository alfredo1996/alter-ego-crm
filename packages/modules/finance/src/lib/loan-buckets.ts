import { txBelongsToAccount, txDelta } from "./account-ledger"

import type { Transaction } from "../types"

/**
 * Who owes what on a loan account, one bucket per person.
 *
 * The person is read off the description: money lent to people is written
 * "Soldi Alice", so the remainder after a leading "Soldi" is the name, and a
 * description with no such prefix ("Capodanno") is a bucket of its own. No
 * fuzzy matching: a typo makes a second bucket the owner fixes by editing the
 * description. ponytail: a counterparty field is the upgrade path, if the
 * description ever proves too noisy.
 *
 * Every row of the account counts, transfers or not, through `txDelta`, so the
 * buckets' balances add up to the account's balance less its opening one: an
 * adjustment or an expense gets its own bucket instead of breaking that sum.
 */
export interface LoanBucket {
  /** Grouping key: the name, lower-cased. */
  key: string
  /** The name as last written ("Alice"), or the whole description when nothing follows "Soldi". */
  name: string
  /** Σ txDelta: above 0 they owe you (money sits in the account), below 0 you owe them. */
  balance: number
  /** Money that went into the account: lent. */
  lent: number
  /** Money that left the account: paid back. */
  repaid: number
  count: number
  lastDate: Date
}

type BucketTx = Pick<Transaction, "type" | "amount" | "accountId" | "transferToAccountId" | "description" | "date">

const round2 = (n: number) => Math.round(n * 100) / 100

/** "Soldi Alice" → Alice; "Capodanno" → Capodanno; "" → Unnamed. */
export function bucketName(description: string): string {
  const whole = description.trim()
  return whole.replace(/^soldi\s+/i, "").trim() || whole || "Unnamed"
}

export function loanBuckets(transactions: BucketTx[], accountId: string): LoanBucket[] {
  const byKey = new Map<string, LoanBucket>()
  for (const tx of transactions) {
    if (!txBelongsToAccount(tx, accountId)) continue
    const name = bucketName(tx.description)
    const key = name.toLowerCase()
    const delta = txDelta(tx, accountId)
    const b = byKey.get(key) ?? { key, name, balance: 0, lent: 0, repaid: 0, count: 0, lastDate: tx.date }
    b.balance += delta
    if (delta > 0) b.lent += delta
    else b.repaid -= delta
    b.count += 1
    if (tx.date >= b.lastDate) {
      b.lastDate = tx.date
      b.name = name
    }
    byKey.set(key, b)
  }
  return [...byKey.values()]
    .map((b) => ({ ...b, balance: round2(b.balance), lent: round2(b.lent), repaid: round2(b.repaid) }))
    .sort(
      (a, b) =>
        Number(a.balance === 0) - Number(b.balance === 0) || // open before settled
        b.balance - a.balance ||
        b.lastDate.getTime() - a.lastDate.getTime(),
    )
}
