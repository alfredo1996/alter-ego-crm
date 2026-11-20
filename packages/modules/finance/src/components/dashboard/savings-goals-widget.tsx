"use client"

import { ProgressBar } from "@alter-ego/ui/page/progress"
import { format as formatDate } from "date-fns"

import { DashboardCard } from "./dashboard-card"

import type { Currency, SavingsGoalWithProgress } from "../../types"

interface SavingsGoalsWidgetProps {
  goals: SavingsGoalWithProgress[]
  format: (amount: number, currency?: Currency) => string
  className?: string
}

const ROWS = 3

/** The goals still being saved for, the closest to done first. */
export function SavingsGoalsWidget({ goals, format, className }: SavingsGoalsWidgetProps) {
  const active = goals.filter((g) => !g.isCompleted).sort((a, b) => b.percentage - a.percentage)
  if (active.length === 0) return null

  const currency = active[0].currency
  const oneCurrency = active.every((g) => g.currency === currency)

  return (
    <DashboardCard
      id="goals-title"
      title="Goals"
      description={
        oneCurrency
          ? `${format(active.reduce((s, g) => s + g.currentAmount, 0), currency)} of ${format(active.reduce((s, g) => s + g.targetAmount, 0), currency)} saved`
          : `${active.length} in progress`
      }
      href="/goals"
      what="goals"
      className={className}
    >
      <ul className="flex flex-col gap-3.5">
        {active.slice(0, ROWS).map((goal) => (
          <li key={goal.id} className="flex flex-col gap-[7px]">
            <div className="flex items-center justify-between gap-2.5">
              <span className="truncate text-sm font-medium">{goal.name}</span>
              <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">{goal.percentage.toFixed(0)}%</span>
            </div>
            <ProgressBar label={goal.name} value={goal.percentage / 100} />
            <span className="text-[12.5px] text-muted-foreground tabular-nums">
              {format(goal.currentAmount, goal.currency)} of {format(goal.targetAmount, goal.currency)}
              {goal.targetDate && ` · by ${formatDate(goal.targetDate, "MMMM yyyy")}`}
            </span>
          </li>
        ))}
      </ul>
    </DashboardCard>
  )
}
