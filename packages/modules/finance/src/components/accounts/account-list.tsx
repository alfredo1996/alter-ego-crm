"use client"

import { formatShortDate } from "@alter-ego/kernel/dates"
import { ContentCard, stretchedLink } from "@alter-ego/ui/page/content-card"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { StatusTabs } from "@alter-ego/ui/page/status-tabs"
import Link from "next/link"
import { useState } from "react"

import { AccountMenu } from "./account-actions"
import { isAtZero } from "../../lib/account-ledger"
import { accountKind, balanceOwing } from "../../lib/net-worth"
import { ACCOUNT_GROUPS, accountGroup, accountTypeLabel } from "../../lib/options"

import type { Account, Currency } from "../../types"
import type { ReactNode } from "react"

// ponytail: an account without a colour of its own gets slate; the account form always sets one.
const NO_COLOUR = "#64748b"

/** "−€511.96" for a negative balance, as the Dashboard's tiles write it. */
export function balanceText(balance: number, currency: Currency, format: AccountListProps["format"]) {
  return `${balance < 0 && !isAtZero(balance) ? "−" : ""}${format(Math.abs(balance), currency)}`
}

interface AccountListProps {
  accounts: Account[]
  format: (amount: number, currency?: Currency) => string
  /** The default currency: shown on a card only when the account's is another. */
  defaultCurrency?: Currency
  onEdit: (account: Account) => void
  onDelete: (account: Account) => void
  onArchive: (account: Account) => void
  /** On the tabs' row from sm up, above them on a phone: the page's "You own · you owe". */
  toolbar?: ReactNode
  /** Newest transaction date per account id; undefined while it loads (the line keeps its room). */
  lastActivity?: Record<string, Date | null>
}

function AccountCard({ account, format, defaultCurrency, onEdit, onDelete, onArchive, lastActivity }: Omit<AccountListProps, "accounts" | "toolbar"> & { account: Account }) {
  const last = lastActivity?.[account.id]
  const owing = balanceOwing(account)
  const titleId = `account-${account.id}`
  return (
    <ContentCard labelledBy={titleId} className="flex flex-col gap-3.5">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill>{accountTypeLabel(account.type)}</StatusPill>
          {account.isArchived && <StatusPill>Archived</StatusPill>}
          {owing === "owe" && <StatusPill tone="warning">You owe</StatusPill>}
        </div>
        <AccountMenu account={account} onEdit={onEdit} onArchive={onArchive} onDelete={onDelete} className="relative z-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Link
          id={titleId}
          href={`/accounts/${account.id}`}
          className={`${stretchedLink} flex w-fit max-w-full items-center gap-2 rounded-sm text-[19px] font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: account.color ?? NO_COLOUR }} />
          <span className="truncate">{account.name}</span>
        </Link>
        <span className="text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] tabular-nums">
          {balanceText(account.balance, account.currency, format)}
        </span>
        {/* Always rendered, so the date landing later moves nothing. */}
        <span className="min-h-5 text-[13px] text-subtle-foreground">
          {last !== undefined && (last ? `Last activity ${formatShortDate(last)}` : "No activity yet")}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-hairline pt-3.5 text-[13px] text-subtle-foreground">
        <span>
          {accountKind(account) === "liability" ? "Liability" : "Asset"}
          {owing === "owed" && " · owed to you"}
        </span>
        {defaultCurrency && account.currency !== defaultCurrency && <span>{account.currency}</span>}
      </div>
    </ContentCard>
  )
}

/**
 * The accounts as cards in a grid, under tabs made of the types actually present, plus Archived:
 * an archived account is out of every other tab, as it is out of the totals.
 */
export function AccountList({ accounts, toolbar, ...card }: AccountListProps) {
  const [tab, setTab] = useState("all")

  if (accounts.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">No accounts yet. Create your first account to get started.</p>
      </div>
    )
  }

  const live = accounts.filter((a) => !a.isArchived)
  const archived = accounts.filter((a) => a.isArchived)
  const groups = ACCOUNT_GROUPS.map((g) => ({ ...g, items: live.filter((a) => accountGroup(a.type) === g.value) })).filter((g) => g.items.length > 0)
  const items = [
    { value: "all", label: "All", count: live.length },
    ...groups.map((g) => ({ value: g.value, label: g.label, count: g.items.length })),
    ...(archived.length > 0 ? [{ value: "archived", label: "Archived", count: archived.length }] : []),
  ]
  // The tab you were on can empty out (the last archived account came back): fall back to All.
  const active = items.some((i) => i.value === tab) ? tab : "all"
  const shown = active === "archived" ? archived : active === "all" ? live : (groups.find((g) => g.value === active)?.items ?? [])
  // One order everywhere: the groups' own, a custom type last.
  const ordered = [...shown].sort((a, b) => ACCOUNT_GROUPS.findIndex((g) => g.value === accountGroup(a.type)) - ACCOUNT_GROUPS.findIndex((g) => g.value === accountGroup(b.type)))

  return (
    <StatusTabs items={items} value={active} onValueChange={setTab} aria-label="Account type" toolbar={toolbar}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 sm:gap-5">
        {ordered.map((account) => (
          <AccountCard key={account.id} account={account} {...card} />
        ))}
      </div>
    </StatusTabs>
  )
}
