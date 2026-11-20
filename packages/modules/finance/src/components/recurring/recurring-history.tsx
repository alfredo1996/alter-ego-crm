"use client"


import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { Timeline } from "@alter-ego/ui/page/timeline"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { format as formatDate } from "date-fns"

import { useAccounts } from "../../hooks/use-accounts"
import { useRecurringHistory } from "../../hooks/use-recurring-history"
import { useAuth } from "../../host"

import type { Currency, RecurringTransaction } from "../../types"

interface RecurringHistoryProps {
  rule: RecurringTransaction
  /** The id the row's History button controls. */
  id: string
  format: (amount: number, currency?: Currency) => string
}

/** What a rule has generated so far, in place under its row (Recurring.dc). */
export function RecurringHistory({ rule, id, format }: RecurringHistoryProps) {
  const { user } = useAuth()
  const { data: accounts } = useAccounts(user?.id)
  const { data: history, isPending } = useRecurringHistory(user?.id, rule.id)

  const count = history?.length ?? 0
  const total = history?.reduce((sum, tx) => sum + tx.amount, 0) ?? 0
  const income = rule.type === "income"
  const noun = count === 1 ? (income ? "receipt" : "payment") : income ? "receipts" : "payments"

  return (
    <div id={id} className="px-[18px] pb-4 sm:px-[22px] sm:pb-[18px]">
      <div className="flex flex-col gap-3.5 rounded-xl border border-hairline bg-card p-4 sm:px-[18px]">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <h3 className="text-sm font-semibold">History</h3>
          {!isPending && count > 0 && (
            <span className="text-[13px] text-subtle-foreground tabular-nums">
              {count} {noun} · total {income ? "received" : "paid"} {format(total, rule.currency)} · average {format(total / count, rule.currency)}
            </span>
          )}
        </div>
        {isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : count === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions generated yet from this rule.</p>
        ) : (
          <Timeline
            className="max-w-[560px]"
            // Newest first whichever order the adapter reads them in (Firestore's is by id).
            items={[...history!].sort((a, b) => b.date.getTime() - a.date.getTime()).map((tx) => ({
              key: tx.id,
              date: formatDate(tx.date, "d MMM yyyy"),
              content: `${tx.type === "income" ? "Received in" : "Paid from"} ${accounts?.find((a) => a.id === tx.accountId)?.name ?? "an account"}`,
              actions: (
                <SignedAmount amount={tx.amount} kind={tx.type === "income" ? "in" : "out"} format={(v) => format(v, tx.currency)} className="text-sm" />
              ),
            }))}
          />
        )}
      </div>
    </div>
  )
}
