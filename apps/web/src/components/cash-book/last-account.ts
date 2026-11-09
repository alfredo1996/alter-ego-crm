import type { CompanyAccount } from "@/types"

const KEY = "cash-book:last-account"

/**
 * The account a payment goes to by default: the last one picked in Add Movement
 * or Mark Paid, else the only one. A per-browser convenience, so storage that
 * throws or is empty (a private window) just means no default.
 */
export function defaultAccountId(accounts: Pick<CompanyAccount, "id">[]): string {
  let last: string | null = null
  try {
    last = window.localStorage.getItem(KEY)
  } catch {
    // No storage: no remembered account.
  }
  if (last && accounts.some((a) => a.id === last)) return last
  return accounts.length === 1 ? accounts[0].id : ""
}

export function rememberAccount(accountId: string): void {
  try {
    window.localStorage.setItem(KEY, accountId)
  } catch {
    // No storage: the next form starts without a default.
  }
}
