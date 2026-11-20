"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@alter-ego/ui/ui/card"
import { cn } from "@alter-ego/ui/utils"
import Link from "next/link"
import { useMemo } from "react"

import { loanBuckets } from "../../lib/loan-buckets"


import type { LoanBucket } from "../../lib/loan-buckets"
import type { Account, Currency, Transaction } from "../../types"

/**
 * Who owes what on a loan account, one row per person, read off the
 * description ("Soldi Alice"). Nothing on any other account type.
 */
export function LoanBucketsCard({
  account,
  transactions,
  format,
}: {
  account: Pick<Account, "id" | "type" | "currency">
  transactions: Transaction[]
  format: (amount: number, currency?: Currency) => string
}) {
  const buckets = useMemo(() => loanBuckets(transactions, account.id), [transactions, account.id])
  if (account.type !== "loan" || buckets.length === 0) return null

  const open = buckets.filter((b) => b.balance !== 0)
  const settled = buckets.filter((b) => b.balance === 0)
  // A bucket runs both ways: above 0 they owe you, below 0 you owe them.
  const owedToYou = open.reduce((s, b) => s + Math.max(0, b.balance), 0)
  const youOwe = open.reduce((s, b) => s + Math.max(0, -b.balance), 0)
  const money = (n: number) => format(n, account.currency)
  const totals = [owedToYou > 0 && `${money(owedToYou)} owed to you`, youOwe > 0 && `${money(youOwe)} you owe`]
    .filter(Boolean)
    .join(" · ")
  const row = (b: LoanBucket) => (
    <li key={b.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
      <Link
        href={`/transactions?accountId=${account.id}&search=${encodeURIComponent(b.name)}`}
        className="min-w-0 truncate font-medium hover:underline pointer-coarse:-my-2 pointer-coarse:py-2"
      >
        {b.name}
      </Link>
      <span className={cn("shrink-0 tabular-nums", b.balance < 0 && "text-muted-foreground")}>{money(b.balance)}</span>
      <span className="basis-full text-xs text-muted-foreground tabular-nums">
        {b.balance < 0
          ? `${money(b.repaid)} borrowed · ${money(b.lent)} given back`
          : `${money(b.lent)} lent · ${money(b.repaid)} paid back`}
      </span>
    </li>
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-baseline justify-between gap-3 pb-2">
        <CardTitle className="text-base">By Person</CardTitle>
        <span className="text-sm text-muted-foreground tabular-nums">{totals}</span>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">{open.map(row)}</ul>
        {settled.length > 0 && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Settled ({settled.length})</summary>
            <ul className="divide-y">{settled.map(row)}</ul>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
