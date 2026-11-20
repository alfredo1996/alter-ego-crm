
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { ProgressBar } from "@alter-ego/ui/page/progress"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { ChevronRight } from "lucide-react"
import Link from "next/link"

import { byUrgency } from "../../lib/budgets"
import { budgetState, overLabel } from "../budgets/budget-card"

import type { BudgetWithSpending, Currency } from "../../types"

interface BudgetsCardProps {
  budgets: BudgetWithSpending[]
  /** The total adds only the budgets in this currency: mixed ones are not one sum. */
  currency: Currency
  format: (amount: number, currency?: Currency) => string
}

/** "Budgets This Period": every budget as a bar, the fullest first. The Budgets page has the detail. */
export function BudgetsCard({ budgets, currency, format }: BudgetsCardProps) {
  const sorted = [...budgets].sort(byUrgency)
  const count = (state: ReturnType<typeof budgetState>) => budgets.filter((b) => budgetState(b) === state).length
  const near = count("near")
  const over = count("over")
  const same = budgets.filter((b) => b.currency === currency)
  const spent = same.reduce((sum, b) => sum + b.spent, 0)
  const limit = same.reduce((sum, b) => sum + b.effectiveAmount, 0)

  return (
    <ContentCard as="section" id="budgets" labelledBy="budgets-title" className="flex min-w-0 scroll-mt-20 flex-col gap-5">
      <SectionHeader
        variant="card"
        id="budgets-title"
        title="Budgets This Period"
        actions={
          <Link href="/budgets" className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-subtle-foreground hover:text-foreground">
            Open Budgets
            <ChevronRight aria-hidden className="size-3.5" />
          </Link>
        }
      />
      <ul className="flex flex-col gap-4">
        {sorted.map((b) => {
          const state = budgetState(b)
          const used = Math.round(b.percentage)
          return (
            <li key={b.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{b.name}</span>
                  {state === "over" ? (
                    <StatusPill tone="danger">{overLabel(b, format)}</StatusPill>
                  ) : state === "near" ? (
                    <StatusPill tone="warning">Near limit</StatusPill>
                  ) : null}
                </span>
                <span className="shrink-0 text-subtle-foreground tabular-nums">
                  {format(b.spent, b.currency)} of {format(b.effectiveAmount, b.currency)}
                </span>
              </div>
              <ProgressBar
                value={b.percentage / 100}
                tone={state === "over" ? "danger" : state === "near" ? "warning" : "default"}
                label={b.spent === 0 ? `${b.name}, nothing spent yet` : `${b.name}, ${used}% of the limit used`}
              />
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-hairline pt-3.5 text-[13px] text-subtle-foreground tabular-nums">
        <span>
          {budgets.length} {budgets.length === 1 ? "budget" : "budgets"}
          {near > 0 && ` · ${near} near limit`}
          {over > 0 && ` · ${over} over`}
        </span>
        <span>
          {format(spent, currency)} of {format(limit, currency)} spent
        </span>
      </div>
    </ContentCard>
  )
}
