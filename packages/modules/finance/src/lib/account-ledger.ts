import type { Account, Transaction } from "../types"

type LedgerTx = Pick<Transaction, "type" | "amount" | "accountId" | "transferToAccountId">

/**
 * Whether a transaction belongs to `accountId`'s ledger — i.e. it either
 * originates from the account, or is a transfer whose destination is the
 * account. Every adapter's `getTransactions` accountId filter must use this so
 * incoming transfers are never dropped (the divergence behind #95).
 */
export function txBelongsToAccount(tx: LedgerTx, accountId: string): boolean {
  return (
    tx.accountId === accountId ||
    (tx.type === "transfer" && tx.transferToAccountId === accountId)
  )
}

/**
 * Signed effect of a transaction on `accountId`'s balance. Must match
 * `recalculateBalances`:
 *   income  → +amount
 *   expense → −amount
 *   transfer → +amount if it lands in this account, −amount if it leaves it
 */
export function txDelta(tx: LedgerTx, accountId: string): number {
  if (tx.type === "income") return tx.amount
  if (tx.type === "expense") return -tx.amount
  return tx.transferToAccountId === accountId ? tx.amount : -tx.amount
}

/** What an account took in and paid out in `month`'s calendar month, each row signed from its side (transfers count). */
export function monthFlow(
  transactions: (LedgerTx & Pick<Transaction, "date">)[],
  accountId: string,
  month: Date,
): { in: number; out: number; countIn: number; countOut: number } {
  const flow = { in: 0, out: 0, countIn: 0, countOut: 0 }
  for (const tx of transactions) {
    if (tx.date.getFullYear() !== month.getFullYear() || tx.date.getMonth() !== month.getMonth()) continue
    const delta = txDelta(tx, accountId)
    if (delta > 0) {
      flow.in += delta
      flow.countIn++
    } else {
      flow.out -= delta
      flow.countOut++
    }
  }
  return flow
}

/**
 * Rejects a transaction whose balance effects would not be conservative.
 *
 * A transfer with no destination debits its source and credits nothing, so the
 * amount leaves the user's net worth without appearing anywhere — and because
 * `getReportData` only counts income and expense, it is invisible in spending
 * too. Neither the Zod schemas nor the Firestore rules used to require the
 * destination, which made this reachable from the transaction form and from
 * `/api/v1/transactions`.
 *
 * Called on the NEW state only, never the old one. A row already saved in the
 * broken state can therefore still be repaired — the edit has to supply the
 * destination or change the type, and `balanceEffectsDiff` reverses the old
 * broken effects correctly on the way. Validating the old state instead would
 * strand such a row permanently.
 */
export function assertLedgerValid(tx: LedgerTx): void {
  if (tx.type !== "transfer") return
  if (!tx.transferToAccountId) {
    throw new Error("A transfer needs a destination account, or the amount is lost.")
  }
  if (tx.transferToAccountId === tx.accountId) {
    throw new Error("A transfer cannot have the same source and destination account.")
  }
}

// Closing an account (#219): Archive is the close, Delete is for an account nothing points at.
// Thrown by every adapter's updateAccount / deleteAccount; the pages show the text as is.

export const ARCHIVE_REFUSAL = "Move the balance out before archiving: the account is not at zero."

/** "At zero" to the cent: float sums leave residue like 5.55e-17 on an account that reads 0.00. The stored balance is left as is. */
export const isAtZero = (balance: number): boolean => Math.abs(balance) < 0.005

/** Archiving a non-zero account would hide money from the totals. */
export function assertArchivable(account: Pick<Account, "balance" | "isArchived">, input: { isArchived?: boolean }): void {
  if (input.isArchived === true && !account.isArchived && !isAtZero(account.balance)) {
    throw new Error(ARCHIVE_REFUSAL)
  }
}

export const ACCOUNT_HAS_TRANSACTIONS = "The account still has transactions: archive it instead, or delete them first."

export interface BalanceEffect {
  accountId: string
  delta: number
}

/**
 * The per-account balance changes a transaction causes when created: its own
 * account always, plus the destination account for a transfer. Delete applies
 * the negation of these. Keeps inline balance updates complete (both sides of a
 * transfer) and consistent with `recalculateBalances`.
 */
export function balanceEffects(tx: LedgerTx): BalanceEffect[] {
  const effects: BalanceEffect[] = [{ accountId: tx.accountId, delta: txDelta(tx, tx.accountId) }]
  if (tx.type === "transfer" && tx.transferToAccountId) {
    effects.push({ accountId: tx.transferToAccountId, delta: txDelta(tx, tx.transferToAccountId) })
  }
  return effects
}

/**
 * Net per-account balance change for editing a transaction from `oldTx` to
 * `newTx`: reverse the old effects, apply the new ones. Handles amount, type,
 * account, and transfer-destination changes. Accounts with a net-zero change
 * are omitted.
 */
export function balanceEffectsDiff(oldTx: LedgerTx, newTx: LedgerTx): BalanceEffect[] {
  const net = new Map<string, number>()
  for (const e of balanceEffects(oldTx)) net.set(e.accountId, (net.get(e.accountId) ?? 0) - e.delta)
  for (const e of balanceEffects(newTx)) net.set(e.accountId, (net.get(e.accountId) ?? 0) + e.delta)
  return [...net.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([accountId, delta]) => ({ accountId, delta }))
}

/**
 * The first closed (archived) account among `ids` that a new write may not
 * touch, or undefined. `own` are a transaction's existing accounts: an edit
 * keeps them even when closed (#219). One rule for the REST API
 * and the MCP write tools (assertOpenAccount in mcp/finance-write.ts).
 */
export function closedTarget(
  accounts: Account[],
  ids: (string | null | undefined)[],
  own: (string | null | undefined)[] = [],
): Account | undefined {
  return accounts.find((a) => a.isArchived && ids.includes(a.id) && !own.includes(a.id))
}

/** The first id that names none of the user's accounts: a write naming it would leave a transaction on nothing. */
export function unknownTarget(
  accounts: Account[],
  ids: (string | null | undefined)[],
): string | undefined {
  return ids.find((id) => id && !accounts.some((a) => a.id === id)) ?? undefined
}
