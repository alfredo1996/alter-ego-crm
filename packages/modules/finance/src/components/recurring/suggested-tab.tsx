"use client"

import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { StatusPill, TagChip } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { format as formatDate } from "date-fns"
import { Check } from "lucide-react"
import { useState } from "react"

import { MarkAsRecurringDialog } from "./mark-as-recurring-dialog"
import { useAccounts } from "../../hooks/use-accounts"
import { useCategories } from "../../hooks/use-categories"
import { useCurrency } from "../../hooks/use-currency"
import { useCreateDismissedSubscriptionPattern } from "../../hooks/use-dismissed-subscriptions"
import { useAuth } from "../../host"
import { CategoryChip } from "../categories/category-chip"

import type { SuspectedSubscription, Transaction } from "../../types"

const CADENCE: Record<SuspectedSubscription["cadence"], string> = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" }

function ordinal(n: number) {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`
}

/** "Seen 4 times, always on the 6th": the day only when a monthly charge never moved. */
function seenLine(sub: SuspectedSubscription, dates: Date[]) {
  const times = `Seen ${sub.observationCount} ${sub.observationCount === 1 ? "time" : "times"}`
  const days = new Set(dates.map((d) => d.getDate()))
  return sub.cadence === "monthly" && days.size === 1 ? `${times}, always on the ${ordinal([...days][0]!)}` : times
}

interface SuggestedTabProps {
  data: SuspectedSubscription[]
  transactions: Transaction[]
}

/** Repeating charges no rule covers yet (what Reports used to list as suspected subscriptions). */
export function SuggestedTab({ data, transactions }: SuggestedTabProps) {
  const { user } = useAuth()
  const { format } = useCurrency()
  const { data: accounts } = useAccounts(user?.id)
  const { data: categories } = useCategories(user?.id)
  const dismiss = useCreateDismissedSubscriptionPattern(user?.id)
  const [marking, setMarking] = useState<SuspectedSubscription | null>(null)

  if (data.length === 0) {
    return <EmptyPrompt title="Nothing to suggest" description="No repeating expense patterns found in the last 13 months." />
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-subtle-foreground">
        These charges repeat on your accounts, but no rule covers them yet. Confirm one to turn it into a rule. A dismissed
        charge is not suggested again.
      </p>
      <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
        {data.map((sub) => {
          const dates = transactions
            .filter((t) => sub.transactionIds.includes(t.id))
            .map((t) => t.date)
            .sort((a, b) => a.getTime() - b.getTime())
          const category = categories?.find((c) => c.id === sub.suggestedCategoryId)
          const account = accounts?.find((a) => a.id === sub.accountId)?.name
          const titleId = `suggested-${sub.id}`
          return (
            <ContentCard key={sub.id} labelledBy={titleId} className="flex flex-col gap-3 max-sm:p-[18px]">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id={titleId} className="text-[17px] font-semibold tracking-tight capitalize">
                  {sub.merchantName}
                </h2>
                <SignedAmount amount={sub.estimatedAmount} kind="out" format={(v) => format(v, sub.currency)} className="text-base" />
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-meta text-subtle-foreground">
                <TagChip>{CADENCE[sub.cadence]}</TagChip>
                {category && <CategoryChip category={category} plain />}
                {category && account && <span aria-hidden>·</span>}
                {account && <span>{account}</span>}
                {sub.looksCancelled && <StatusPill tone="warning">Cancelled?</StatusPill>}
                {sub.confidence === "low" && <StatusPill>Low confidence</StatusPill>}
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-[13px] text-foreground/80">{seenLine(sub, dates)}</p>
                <ul aria-label="Dates seen" className="flex flex-wrap gap-1.5">
                  {dates.map((d) => (
                    <li key={d.getTime()}>
                      <TagChip>{formatDate(d, "d MMM")}</TagChip>
                    </li>
                  ))}
                </ul>
              </div>
              <hr className="border-hairline" />
              <p className="text-[13px] leading-normal text-foreground/80">
                Confirm opens a new rule already filled in: {CADENCE[sub.cadence].toLowerCase()}
                {account ? ` from ${account}` : ""}, next on{" "}
                <span className="font-mono text-[12.5px]">{formatDate(sub.suggestedStartDate, "d MMM")}</span>.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="lg" className="flex-1" onClick={() => setMarking(sub)} aria-label={`Confirm ${sub.merchantName} as recurring`} aria-haspopup="dialog">
                  <Check /> Confirm
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  className="flex-1 text-subtle-foreground"
                  onClick={() => dismiss.mutate({ patternKey: sub.id })}
                  disabled={dismiss.isPending}
                  aria-label={`Dismiss ${sub.merchantName}`}
                >
                  Dismiss
                </Button>
              </div>
            </ContentCard>
          )
        })}
      </div>
      {/* Mounted per choice: the dialog fills its fields once, from the subscription it is born with. */}
      {marking && <MarkAsRecurringDialog key={marking.id} subscription={marking} onClose={() => setMarking(null)} />}
    </div>
  )
}
