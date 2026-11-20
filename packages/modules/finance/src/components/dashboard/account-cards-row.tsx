"use client"

import { cn } from "@alter-ego/ui/utils"
import { Plus } from "lucide-react"
import Link from "next/link"

import { DashboardCard } from "./dashboard-card"
import { isAtZero } from "../../lib/account-ledger"
import { balanceOwing } from "../../lib/net-worth"
import { accountTypeLabel } from "../../lib/options"

import type { Account, AccountBalance, Currency } from "../../types"

interface AccountCardsRowProps {
  accountBalances: AccountBalance[]
  /** The full accounts, for each one's colour and whether it is a liability. */
  accounts?: Account[]
  format: (amount: number, currency?: Currency) => string
  onNewAccount: () => void
  className?: string
}

// ponytail: an account without a colour of its own gets slate; the account form always sets one.
const NO_COLOUR = "#64748b"

const ROWS = 6

// ponytail: sorts on the raw balance; AccountBalance carries no base-currency value, so mixed currencies compare unconverted.
function largestFirst(a: AccountBalance, b: AccountBalance): number {
  return Math.abs(b.balance) - Math.abs(a.balance) || a.accountName.localeCompare(b.accountName)
}

function typeLine(balance: AccountBalance, account: Account | undefined): string {
  const label = accountTypeLabel(balance.type)
  const owing = balanceOwing({ type: balance.type, kind: account?.kind, balance: balance.balance })
  if (owing === "owe") return `${label} · you owe this`
  if (owing === "owed") return `${label} · owed to you`
  return label
}

/** The accounts as tiles that wrap, each a link to its page: the six largest by absolute balance, with New Account as the last tile when fewer than six are shown. */
export function AccountCardsRow({ accountBalances, accounts = [], format, onNewAccount, className }: AccountCardsRowProps) {
  const count = accountBalances.length
  const shown = [...accountBalances].sort(largestFirst).slice(0, ROWS)
  return (
    <DashboardCard
      id="accounts-title"
      title="Accounts"
      description={`${count} ${count === 1 ? "account" : "accounts"}`}
      href="/accounts"
      what="accounts"
      bareOnPhone
      className={className}
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-3">
        {shown.map((balance) => {
          const account = accounts.find((a) => a.id === balance.accountId)
          return (
            <Link
              key={balance.accountId}
              href={`/accounts/${balance.accountId}`}
              className={cn(
                "flex min-h-24 flex-col gap-1.5 rounded-xl border border-hairline bg-surface-subtle p-3.5 max-sm:grid max-sm:min-h-16 max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-0.5 max-sm:bg-card max-sm:px-3.5 max-sm:py-3 max-sm:shadow-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium max-sm:col-start-1 max-sm:row-start-1 max-sm:text-[15px]">
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: account?.color ?? NO_COLOUR }} />
                <span className="truncate">{balance.accountName}</span>
              </span>
              <span className="text-xl font-semibold tracking-tight tabular-nums max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1 max-sm:whitespace-nowrap max-sm:text-[17px]">
                {balance.balance < 0 && !isAtZero(balance.balance) ? "−" : ""}
                {format(Math.abs(balance.balance), balance.currency)}
              </span>
              <span className="text-[12.5px] text-muted-foreground max-sm:col-start-1 max-sm:row-start-2 max-sm:pl-4 max-sm:text-[13px]">{typeLine(balance, account)}</span>
            </Link>
          )
        })}
        {shown.length < ROWS && (
          <button
            type="button"
            onClick={onNewAccount}
            className="flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-xl max-sm:min-h-12 max-sm:flex-row max-sm:gap-2 border-[1.5px] border-dashed border-border-strong bg-surface-subtle p-3.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus aria-hidden className="size-4" />
            New Account
          </button>
        )}
      </div>
    </DashboardCard>
  )
}
