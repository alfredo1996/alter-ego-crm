import { StatusDot } from "@alter-ego/ui/page/meta-row"
import { ProgressBar } from "@alter-ego/ui/page/progress"
import { Card } from "@alter-ego/ui/ui/card"

import { budgetState } from "./budget-card"

import type { BudgetWithSpending, Currency } from "../../types"

interface BudgetsSummaryProps {
  /** One period and one currency: the caller passes this month's budgets in the default currency. */
  budgets: BudgetWithSpending[]
  format: (amount: number, currency?: Currency) => string
  monthName: string
}

/** The month at a glance: spent against the total limit, and how many budgets sit in each state. */
export function BudgetsSummary({ budgets, format, monthName }: BudgetsSummaryProps) {
  if (budgets.length === 0) return null
  const spent = budgets.reduce((sum, b) => sum + b.spent, 0)
  const limit = budgets.reduce((sum, b) => sum + b.effectiveAmount, 0)
  const used = limit > 0 ? Math.round((spent / limit) * 100) : 0
  const count = (state: ReturnType<typeof budgetState>) => budgets.filter((b) => budgetState(b) === state).length
  const states = [
    { n: count("ok"), tone: "success", word: "On track" },
    { n: count("near"), tone: "warning", word: "Near limit" },
    { n: count("over"), tone: "danger", word: "Over" },
  ] as const

  return (
    <Card role="region" aria-labelledby="spent-title" className="flex flex-col gap-4 p-5 sm:p-[22px]">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-2">
          <h2 id="spent-title" className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Spent in {monthName}
          </h2>
          <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 tabular-nums">
            <span className="text-2xl font-semibold leading-tight tracking-tight sm:text-[28px]">{format(spent)}</span>
            <span className="text-sm text-muted-foreground sm:text-[15px]">
              of {format(limit)} across {budgets.length} {budgets.length === 1 ? "budget" : "budgets"}
            </span>
          </p>
        </div>
        <ul aria-label="Budgets by state" className="flex flex-wrap gap-x-[18px] gap-y-2 text-sm text-subtle-foreground">
          {states.filter((s) => s.n > 0).map((s) => (
            <li key={s.word}>
              <StatusDot tone={s.tone}>
                {s.n} {s.word}
              </StatusDot>
            </li>
          ))}
        </ul>
      </div>
      <ProgressBar className="h-2" value={limit > 0 ? spent / limit : 0} label={`All budgets, ${used}% of the total limit used`} />
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1.5 text-[13px] text-subtle-foreground tabular-nums">
        <span>{spent > limit ? `${format(spent - limit)} over in total` : `${format(limit - spent)} left for the rest of ${monthName}`}</span>
        <span>{used}% used</span>
      </div>
    </Card>
  )
}
