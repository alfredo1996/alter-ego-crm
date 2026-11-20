import { isAtZero } from "./account-ledger"

import type { Account, AccountKind, AccountType } from "../types"

export const ASSET_ACCOUNT_TYPES: AccountType[] = ["checking", "savings", "cash", "investment", "other"]
export const LIABILITY_ACCOUNT_TYPES: AccountType[] = ["credit_card", "loan"]

/** Built-in classification for a type literal. Custom (unknown) types default to asset. */
export function defaultKindForType(type: AccountType): AccountKind {
  return LIABILITY_ACCOUNT_TYPES.includes(type) ? "liability" : "asset"
}

type Classifiable = Pick<Account, "type" | "kind">

/** Explicit `kind` wins; otherwise fall back to the built-in classification of `type`. */
export function accountKind(account: Classifiable): AccountKind {
  return account.kind ?? defaultKindForType(account.type)
}

export function isAsset(account: Classifiable): boolean {
  return accountKind(account) === "asset"
}

export function isLiability(account: Classifiable): boolean {
  return accountKind(account) === "liability"
}

/**
 * Net worth from the balances' signs, not the accounts' kinds: assets are the positive balances,
 * liabilities the negative ones (as a positive figure), net worth the sum. An overpaid card is money
 * owed to you and an overdrawn checking account is money you owe; a balance of 0 counts on neither
 * side. Callers pass the accounts that count (archived ones left out).
 */
export function netWorthTotals(accounts: Pick<Account, "balance">[]): {
  totalAssets: number
  totalLiabilities: number
  netWorth: number
} {
  let totalAssets = 0
  let totalLiabilities = 0
  for (const { balance } of accounts) {
    if (balance > 0) totalAssets += balance
    else totalLiabilities -= balance
  }
  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities }
}

/**
 * What an account's balance says about who owes whom, from its sign: below 0 you owe it, above 0 on a
 * loan, a card or any liability the other side owes you (an overpaid card, money lent out). A balance
 * can go either way whatever the kind, so the words follow the number, never the kind.
 */
export function balanceOwing(account: Pick<Account, "type" | "kind" | "balance">): "owe" | "owed" | null {
  if (isAtZero(account.balance)) return null
  if (account.balance < 0) return "owe"
  if (account.balance > 0 && (account.type === "loan" || isLiability(account))) return "owed"
  return null
}
