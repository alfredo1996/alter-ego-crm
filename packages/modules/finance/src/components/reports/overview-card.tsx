"use client"


import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { SegmentedButtons } from "@alter-ego/ui/page/segmented-buttons"
import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { format as fmtDate, parse } from "date-fns"
import { useState } from "react"

import { InOutChart } from "./in-out-chart"

import type { MonthlySummary } from "../../types"

interface OverviewCardProps {
  /** "October so far": over the three figures. */
  eyebrow: string
  income: number
  expenses: number
  net: number
  /** How a figure moved against the comparison period; left out when nothing is compared. */
  incomeDetail?: string
  expensesDetail?: string
  netText: string
  months: MonthlySummary[]
  /** The period's mode: Yearly cannot be told to "switch to Yearly". */
  mode?: string
  /** The months' own read failed: say so, never draw zeros beside real figures. */
  monthsFailed?: boolean
  focusMonth?: string
  focusLabel?: string
  format: (amount: number) => string
  whole: (amount: number) => string
  compact: (amount: number) => string
}

type View = "chart" | "table"

function Figure({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  // Label, value, detail: a column on a desktop; on a phone the value sits to the right of the other two.
  return (
    <div className="grid items-baseline gap-x-3 gap-y-1 border-b border-hairline py-3.5 last:border-b-0 last:pb-0 max-sm:grid-cols-[minmax(0,1fr)_auto]">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="text-[17px] leading-tight font-semibold tracking-[-0.02em] tabular-nums max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1 sm:text-2xl">{value}</p>
      {detail && <p className="text-[13px] text-subtle-foreground">{detail}</p>}
    </div>
  )
}

/** "By month, July to October 2026". */
function span(months: MonthlySummary[]): string {
  const at = (m: MonthlySummary) => parse(m.month, "yyyy-MM", new Date())
  const first = at(months[0]!)
  const last = at(months[months.length - 1]!)
  const from = fmtDate(first, first.getFullYear() === last.getFullYear() ? "MMMM" : "MMMM yyyy")
  return `By month, ${from} to ${fmtDate(last, "MMMM yyyy")}`
}

/** "In and Out": the period's three figures beside the months they sit in, as a chart or a table. */
export function OverviewCard({ eyebrow, income, expenses, net, incomeDetail, expensesDetail, netText, months, mode, monthsFailed, focusMonth, focusLabel, format, whole, compact }: OverviewCardProps) {
  const [view, setView] = useState<View>("chart")
  // One bar is not a trend: a custom range inside one month has nothing to set side by side.
  const trend = months.length >= 2 && !monthsFailed
  const empty = months.every((m) => m.income === 0 && m.expenses === 0)

  return (
    <ContentCard as="section" id="overview" labelledBy="overview-title" className="flex min-w-0 scroll-mt-20 flex-col gap-5">
      <SectionHeader
        variant="card"
        id="overview-title"
        title="In and Out"
        description={trend ? span(months) : undefined}
        actions={
          trend && !empty && (
            <>
              <div aria-hidden className="flex items-center gap-3.5 text-[13px] text-subtle-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[3px] bg-income" />
                  In
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[3px] bg-foreground" />
                  Out
                </span>
              </div>
              <SegmentedButtons
                aria-label="In and out view"
                value={view}
                onChange={setView}
                options={[
                  { value: "chart", label: "Chart" },
                  { value: "table", label: "Table" },
                ]}
              />
            </>
          )
        }
      />
      <div className="flex flex-wrap gap-x-10 gap-y-5">
        <section aria-label="Money in, money out and net" className="flex min-w-0 flex-[1_1_240px] flex-col sm:max-w-[280px]">
          <p className="mb-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">{eyebrow}</p>
          <Figure label="Money in" value={<SignedAmount amount={income} kind="in" format={format} className="font-semibold" />} detail={incomeDetail} />
          <Figure label="Money out" value={<SignedAmount amount={expenses} kind="out" format={format} className="font-semibold" />} detail={expensesDetail} />
          <Figure label="Net" value={<SignedAmount amount={net} format={format} className="font-semibold" />} detail={netText} />
        </section>
        <div className="min-w-0 flex-[3_1_420px]">
          {monthsFailed ? (
            <p role="alert" className="text-sm text-destructive">The months could not be loaded.</p>
          ) : months.length === 0 ? (
            <p className="text-sm text-subtle-foreground">Nothing to chart yet.</p>
          ) : !trend ? (
            <p className="text-sm text-subtle-foreground">
              {mode === "yearly"
                ? "Only one month so far this year: the chart fills in as the months pass."
                : "Only one month in this period: switch to Yearly to see the months side by side."}
            </p>
          ) : empty ? (
            <EmptyPrompt variant="inline" title="No money in or out in these months." />
          ) : view === "chart" ? (
            <InOutChart months={months} focusMonth={focusMonth} focusLabel={focusLabel} format={format} whole={whole} compact={compact} />
          ) : (
            <div className="overflow-x-auto">
              <table aria-label="Money in and out by month" className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-hairline text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    <th scope="col" className="py-2 pr-4 text-left font-semibold">Month</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">In</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">Out</th>
                    <th scope="col" className="py-2 text-right font-semibold">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.month} className="min-h-11 border-b border-hairline last:border-0">
                      <td className="py-3 pr-4">{fmtDate(parse(m.month, "yyyy-MM", new Date()), "MMM yyyy")}</td>
                      <td className="py-3 pr-4 text-right"><SignedAmount amount={m.income} kind="in" format={format} /></td>
                      <td className="py-3 pr-4 text-right"><SignedAmount amount={m.expenses} kind="out" format={format} /></td>
                      <td className="py-3 text-right"><SignedAmount amount={m.net} format={format} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </ContentCard>
  )
}
