"use client"

import { daysLeftInMonth } from "@alter-ego/kernel/dates"
import { ProgressBar } from "@alter-ego/ui/page/progress"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { format as formatDate } from "date-fns"


import { DashboardCard } from "./dashboard-card"
import { byUrgency, getBudgetStatus } from "../../lib/budgets"

import type { BudgetWithSpending, Currency } from "../../types"

interface BudgetsAtRiskWidgetProps {
  budgets: BudgetWithSpending[]
  format: (amount: number, currency?: Currency) => string
  className?: string
}

const ROWS = 5

/** The five budgets nearest their limit, one line and one bar each; the rest are on the Budgets page. */
export function BudgetsAtRiskWidget({ budgets, format, className }: BudgetsAtRiskWidgetProps) {
  if (budgets.length === 0) return null

  const now = new Date()
  const daysLeft = daysLeftInMonth(now)
  const shown = [...budgets].sort(byUrgency).slice(0, ROWS)
  const near = budgets.filter((b) => getBudgetStatus(b) !== "ok").length
  const currency = budgets[0].currency
  const oneCurrency = budgets.every((b) => b.currency === currency)

  return (
    <DashboardCard
      id="budgets-title"
      title="Budgets"
      description={`${daysLeft} ${daysLeft === 1 ? "day" : "days"} left in ${formatDate(now, "MMMM")}`}
      href="/budgets"
      what="budgets"
      className={className}
      footer={
        <>
          <span>
            {budgets.length} {budgets.length === 1 ? "budget" : "budgets"} · {near} near limit
          </span>
          {oneCurrency && (
            <span>
              {format(budgets.reduce((sum, b) => sum + b.spent, 0), currency)} of{" "}
              {format(budgets.reduce((sum, b) => sum + b.effectiveAmount, 0), currency)} spent
            </span>
          )}
        </>
      }
    >
      <ul className="flex flex-col gap-3.5">
        {shown.map((budget) => {
          const status = getBudgetStatus(budget)
          return (
            <li key={budget.id} className="flex flex-col gap-[7px]">
              <div className="flex items-center justify-between gap-2.5">
                <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span className="truncate">{budget.name}</span>
                  {status === "danger" && <StatusPill tone="danger">Over limit</StatusPill>}
                  {status === "warning" && <StatusPill tone="warning">Near limit</StatusPill>}
                </span>
                <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
                  {format(budget.spent, budget.currency)} of {format(budget.effectiveAmount, budget.currency)}
                </span>
              </div>
              <ProgressBar
                label={budget.name}
                value={budget.percentage / 100}
                tone={status === "ok" ? "default" : status}
              />
            </li>
          )
        })}
      </ul>
    </DashboardCard>
  )
}
