"use client"


import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { Button } from "@alter-ego/ui/ui/button"
import { cn } from "@alter-ego/ui/utils"
import { format as formatDate } from "date-fns"
import { ArrowLeftRight } from "lucide-react"
import Link from "next/link"

import { CategoryChip } from "../categories/category-chip"

import type { Account, Category, Currency, Transaction } from "../../types"

interface RecentTransactionsCardProps {
  recentTransactions: Transaction[]
  accounts: Account[]
  categories: Category[]
  format: (amount: number, currency?: Currency) => string
  onNewTransaction: () => void
}

const ROWS = 8

function ViewAll() {
  return (
    <Link
      href="/transactions"
      className="-my-2.5 -mr-2 inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      View all<span className="sr-only"> transactions</span>
    </Link>
  )
}

/** The last eight transactions: a table on a desktop, a list on a phone. Read-only: a row's edit is on the Transactions page. */
export function RecentTransactionsCard({ recentTransactions, accounts, categories, format, onNewTransaction }: RecentTransactionsCardProps) {
  if (recentTransactions.length === 0) {
    return (
      <EmptyPrompt
        titleId="activity-title"
        title="No transactions yet"
        description="Add the first one and it shows up here."
        action={<Button onClick={onNewTransaction}>Add First Transaction</Button>}
      />
    )
  }

  const rows = recentTransactions.slice(0, ROWS)
  const nameOf = (id: string | null | undefined) => accounts.find((a) => a.id === id)?.name ?? "Unknown"
  const categoryOf = (tx: Transaction) => categories.find((c) => c.id === tx.categoryId) ?? null
  const category = (tx: Transaction) =>
    tx.type === "transfer" ? (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-subtle-foreground">
        <ArrowLeftRight aria-hidden className="size-3" />
        Transfer
      </span>
    ) : (
      <CategoryChip category={categoryOf(tx)} />
    )
  const amount = (tx: Transaction) => (
    <SignedAmount
      // A transfer is listed from its source account: money leaving it, so the arrow points to the other one.
      amount={tx.type === "transfer" ? -tx.amount : tx.amount}
      kind={tx.type === "income" ? "in" : tx.type === "expense" ? "out" : "transfer"}
      counterpart={tx.type === "transfer" ? nameOf(tx.transferToAccountId) : undefined}
      format={(n) => format(n, tx.currency)}
    />
  )
  const header = (
    <SectionHeader
      variant="card"
      id="activity-title"
      title="Recent Activity"
      description={`Last ${rows.length} ${rows.length === 1 ? "transaction" : "transactions"}`}
      actions={<ViewAll />}
    />
  )

  return (
    <ContentCard as="section" labelledBy="activity-title" padding="none" className="overflow-hidden">
      <div className="p-(--card-padding) pb-3 sm:pb-4">{header}</div>
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-y border-hairline text-left text-xs font-medium text-muted-foreground">
            <th scope="col" className="w-24 py-2 pl-[22px] font-medium">Date</th>
            <th scope="col" className="py-2 font-medium">Description</th>
            <th scope="col" className="py-2 font-medium">Category</th>
            <th scope="col" className="py-2 pr-[22px] text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((tx) => (
            <tr key={tx.id} className="border-b border-hairline last:border-b-0">
              <td className="py-3 pl-[22px] font-mono text-xs whitespace-nowrap text-muted-foreground">{formatDate(tx.date, "d MMM")}</td>
              <td className="max-w-0 py-3 pr-3">
                <span className="block truncate font-medium">{tx.description}</span>
                <span className="block truncate text-[12.5px] text-muted-foreground">{nameOf(tx.accountId)}</span>
              </td>
              <td className="py-3 pr-3">{category(tx)}</td>
              <td className="py-3 pr-[22px] text-right">{amount(tx)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="px-[18px] pb-1.5 sm:hidden">
        {rows.map((tx, i) => (
          <li key={tx.id} className={cn("flex justify-between gap-3 py-3", i > 0 && "border-t border-hairline")}>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="truncate text-[15px] font-medium">{tx.description}</span>
              <span className="flex items-center gap-2">
                {category(tx)}
                <span className="font-mono text-xs text-muted-foreground">{formatDate(tx.date, "d MMM")}</span>
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 text-[15px]">
              {amount(tx)}
              <span className="text-[12.5px] text-muted-foreground">{nameOf(tx.accountId)}</span>
            </div>
          </li>
        ))}
      </ul>
    </ContentCard>
  )
}
