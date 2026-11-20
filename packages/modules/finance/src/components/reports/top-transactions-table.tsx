"use client"

import { isoDate, type DateRange } from "@alter-ego/kernel/dates"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { Button } from "@alter-ego/ui/ui/button"
import { format as fmtDate } from "date-fns"
import { ChevronRight } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { CategoryChip } from "../categories/category-chip"

import type { Account, Category, Currency, Transaction } from "../../types"

interface TopTransactionsTableProps {
  /** Largest first; the report holds at most 15. */
  transactions: Transaction[]
  categories: Category[]
  accounts: Pick<Account, "id" | "name">[]
  format: (amount: number, currency?: Currency) => string
  /** "October 2026". */
  period: string
  /** The report's dates: "Open in Transactions" opens the same ones. */
  range: DateRange
  /** Everything spent in the period: what the shown rows are a share of. */
  totalExpenses: number
}

const FIRST = 10
/** What the report returns: a list this long may be cut short. */
const CAP = 15

/** "Top Expenses": the largest ten, a table that stays a table on a phone; the rest on request. */
export function TopTransactionsTable({ transactions, categories, accounts, format, period, range, totalExpenses }: TopTransactionsTableProps) {
  const [all, setAll] = useState(false)
  if (transactions.length === 0) return null

  const categoryMap = new Map(categories.map((c) => [c.id, c]))
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]))
  const n = transactions.length
  const rows = all ? transactions : transactions.slice(0, FIRST)
  const sum = rows.reduce((s, t) => s + t.amount, 0)
  const share = totalExpenses > 0 ? ((sum / totalExpenses) * 100).toFixed(1) : "0.0"
  // The report stops at 15: at that length there may be more, so the list is "the 15 largest", not "all".
  const set = n >= CAP ? `the ${n} largest` : `${n} expenses`
  const lead = rows.length < n ? `Top ${rows.length} of ${set}` : n >= CAP ? `The ${n} largest` : `All ${set}`

  return (
    <DataTableCard id="top" role="region" aria-labelledby="top-title" className="scroll-mt-20">
      <div className="p-(--card-padding) pb-3">
        <SectionHeader
          variant="card"
          id="top-title"
          title="Top Expenses"
          description={`${period}, largest first`}
          actions={
            <Link href={`/transactions?dateFrom=${isoDate(range.from)}&dateTo=${isoDate(range.to)}`} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-subtle-foreground hover:text-foreground">
              Open in Transactions
              <ChevronRight aria-hidden className="size-3.5" />
            </Link>
          }
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-hairline text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              <th scope="col" className="hidden py-2 pr-4 pl-[22px] text-left font-semibold sm:table-cell">Date</th>
              <th scope="col" className="py-2 pr-4 pl-[18px] text-left font-semibold sm:pl-0">
                <span className="sm:hidden">Expense</span>
                <span className="max-sm:hidden">Description</span>
              </th>
              <th scope="col" className="hidden py-2 pr-4 text-left font-semibold sm:table-cell">Category</th>
              <th scope="col" className="py-2 pr-[18px] text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tx) => {
              const cat = tx.categoryId ? categoryMap.get(tx.categoryId) : null
              return (
                <tr key={tx.id} className="border-b border-hairline last:border-b-0">
                  <td className="hidden py-3 pr-4 whitespace-nowrap text-subtle-foreground tabular-nums sm:table-cell">{fmtDate(tx.date, "d MMM")}</td>
                  {/* A phone drops the Date and Category columns into a line under the description, which
                      takes what the Amount leaves (w-full max-w-0) instead of a fixed 200 px. */}
                  <td className="w-full max-w-0 py-3 pr-4 pl-[18px] sm:w-auto sm:max-w-[260px] sm:pl-0">
                    <span className="block truncate font-medium">{tx.description}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      <span className="sm:hidden">
                        {fmtDate(tx.date, "d MMM")} · <CategoryChip category={cat} plain />
                      </span>
                      <span className="max-sm:hidden">{accountMap.get(tx.accountId)}</span>
                    </span>
                  </td>
                  <td className="hidden py-3 pr-4 sm:table-cell">
                    <CategoryChip category={cat} />
                  </td>
                  <td className="py-3 pr-[18px] text-right whitespace-nowrap">
                    <SignedAmount amount={tx.amount} kind="out" format={(v) => format(v, tx.currency)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-hairline px-(--card-padding) py-2 text-[13px] text-subtle-foreground tabular-nums">
        <span>{`${lead} · −${format(sum)}, ${share}% of spending in ${period}`}</span>
        {n > FIRST && (
          <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" onClick={() => setAll((v) => !v)}>
            {all ? "Show Fewer" : `Show All ${n}`}
          </Button>
        )}
      </div>
    </DataTableCard>
  )
}
