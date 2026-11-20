"use client"

import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { differenceInCalendarDays, format as formatDate } from "date-fns"

import { DashboardCard } from "./dashboard-card"

import type { Currency, RecurringTransaction } from "../../types"

interface UpcomingBillsWidgetProps {
  rules: RecurringTransaction[]
  format: (amount: number, currency?: Currency) => string
  className?: string
}

const ROWS = 5

/** The bills (money out) due in the next 30 days; income is not a bill. A bill gets a pill only when it is due within the week. */
export function UpcomingBillsWidget({ rules, format, className }: UpcomingBillsWidgetProps) {
  const now = new Date()
  const due = rules
    .filter((r) => r.isActive && r.type !== "income" && differenceInCalendarDays(r.nextDueDate, now) <= 30)
    .sort((a, b) => a.nextDueDate.getTime() - b.nextDueDate.getTime())

  if (due.length === 0) return null

  const currency = due[0].currency
  const oneCurrency = due.every((r) => r.currency === currency)
  const total = due.reduce((sum, r) => sum + r.amount, 0)

  return (
    <DashboardCard
      id="bills-title"
      title="Upcoming Bills"
      description="Next 30 days"
      href="/recurring"
      what="recurring"
      className={className}
      footer={
        <>
          <span>
            {due.length} {due.length === 1 ? "bill" : "bills"}
          </span>
          {oneCurrency && (
            <span>
              <SignedAmount amount={total} kind="out" format={(n) => format(n, currency)} className="font-normal" /> in all
            </span>
          )}
        </>
      }
    >
      <ul className="flex flex-col">
        {due.slice(0, ROWS).map((rule) => {
          const days = differenceInCalendarDays(rule.nextDueDate, now)
          const soon = days <= 7
          return (
            <li key={rule.id} className="flex items-center justify-between gap-3 border-t border-hairline py-2 first:border-t-0">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{rule.description}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDate(rule.nextDueDate, "d MMM")}
                  {!soon && ` · in ${days} days`}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-sm">
                {soon && (
                  <StatusPill tone={days <= 3 ? "danger" : "warning"}>
                    {days <= 0 ? "Due today" : days === 1 ? "Tomorrow" : `In ${days} days`}
                  </StatusPill>
                )}
                <SignedAmount amount={rule.amount} kind="out" format={(n) => format(n, rule.currency)} />
              </div>
            </li>
          )
        })}
      </ul>
    </DashboardCard>
  )
}
