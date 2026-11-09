"use client"

import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth, isoDate } from "@alter-ego/kernel/dates"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { MonthStepper } from "@alter-ego/ui/page/month-stepper"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { StatCard } from "@alter-ego/ui/page/stat-card"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { cn } from "@alter-ego/ui/utils"
import { ChevronRight } from "lucide-react"
import { Fragment, useState } from "react"

import { periodMonths } from "@/lib/invoices"
import { margin, quarterRows } from "@/lib/quarters"

import type { ProjectionMonth } from "@/lib/projection"
import type { QuarterMonth, QuarterRow, Totals } from "@/lib/quarters"
import type { Assignment, Collaborator, CompanyExpense, Invoice } from "@/types"

type Billing = Pick<Parameters<typeof quarterRows>[0], "engagements" | "timecards">

const STATUS = {
  closed: { label: "Closed", tone: "neutral" },
  "in-progress": { label: "In progress", tone: "warning" },
  planned: { label: "Planned", tone: "neutral" },
} as const

const QUARTER_SPAN = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"]

const pct = (t: Totals) => {
  const m = margin(t)
  return m === null ? "–" : `${m}%`
}

/**
 * Under a Collaborators figure: the plan to set beside what was invoiced. Warning tone when invoices
 * are missing, neutral when over; `who` (a month row) names the missing ones.
 */
function PlanNote({ plan, invoiced, missing, who, atPlan }: { plan: number | null; invoiced: number; missing: number; who?: string; atPlan?: boolean }) {
  const note = "block text-meta font-normal"
  // A quarter in progress mixes months invoiced with months at plan: say the figure is partly plan.
  if (!plan) return atPlan ? <span className={cn(note, "text-muted-foreground")}>plan</span> : null
  if (missing > 0) return <span className={cn(note, "text-warning-soft-foreground")}>plan {eur(plan)}{who ? ` · ${who}` : ""}</span>
  if (invoiced > plan) return <span className={cn(note, "text-muted-foreground")}>{eur(invoiced - plan)} over plan</span>
  return <span className={cn(note, "text-muted-foreground")}>plan {eur(plan)} ✓</span>
}

const missingWho = (m: QuarterMonth) => m.missing.map((x) => `${x.name} ${eur(x.amount)} missing`).join(", ")

const netClass = (t: Totals) => cn("font-medium", t.net < 0 && "text-danger")

interface QuartersSectionProps extends Billing {
  today: Date
  invoices: Invoice[]
  expenses: CompanyExpense[]
  /** For the ended months' invoiced against plan. */
  collaborators?: Collaborator[]
  assignments?: Assignment[]
  /** The timeline the Projection shows, from this month on. */
  plan: ProjectionMonth[]
  /** The Projection counts the weighted pipeline: say so. */
  weighted?: boolean
}

/** Revenue, costs and net per quarter: ended months as invoiced and spent, the rest at plan. */
export function QuartersSection({ today, invoices, engagements, timecards, expenses, plan, weighted, collaborators, assignments }: QuartersSectionProps) {
  const thisYear = today.getFullYear()
  // An invoice's first month, not its last: a Dec-Jan one puts a share on the earlier year.
  const earliest = Math.min(thisYear, ...invoices.map((i) => Number(periodMonths(i)[0].slice(0, 4))), ...expenses.flatMap((e) => [e.date.getFullYear(), ...(e.forMonth ? [Number(e.forMonth.slice(0, 4))] : [])]))
  const [year, setYear] = useState(thisYear)
  // The table and the phone cards open independently; the phone opens this quarter's card.
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [cardsOpen, setCardsOpen] = useState<Set<number>>(new Set([Math.floor(today.getMonth() / 3) + 1]))
  const toggler = (set: (f: (prev: Set<number>) => Set<number>) => void) => (q: number) =>
    set((prev) => {
      const next = new Set(prev)
      if (!next.delete(q)) next.add(q)
      return next
    })
  const toggle = toggler(setOpen)

  const { rows, year: total, soFar } = quarterRows({ year, today: isoDate(today), invoices, engagements, timecards, expenses, plan, collaborators, assignments })
  const empty = total.revenue === 0 && total.costs === 0
  const focus = rows.find((r) => r.status === "in-progress") ?? rows.find((r) => r.status === "planned") ?? rows[3]
  const yearClosed = rows.every((r) => r.status === "closed")
  // On a phone the quarter in progress leads, then the newest first.
  const cards = [...rows].reverse().sort((a, b) => Number(b === focus) - Number(a === focus))
  const th = "px-2 py-3 sm:px-4 text-[12.5px] font-medium text-muted-foreground"
  const monthLabel = (m: QuarterMonth) => (
    <>
      {formatYearMonth(m.yearMonth, "MMMM")}
      <span className="text-muted-foreground"> · {m.source}</span>
    </>
  )

  return (
    <section className="space-y-4 [&_h2]:scroll-mt-20">
      <SectionHeader
        id="quarters"
        title="Quarters"
        description={`${year} · net of VAT.${weighted ? " Planned months include the weighted pipeline." : ""} Cash flow only: no pay, no taxes.`}
        actions={
          <MonthStepper
            groupLabel="Year"
            label={year}
            prevLabel="Previous year"
            nextLabel="Next year"
            prev={year > earliest ? () => setYear(year - 1) : undefined}
            next={year < thisYear + 1 ? () => setYear(year + 1) : undefined}
          />
        }
      />

      <div role="region" aria-label={`Quarters of ${year}`} className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <StatCard
          label={`Q${focus.quarter} · ${STATUS[focus.status].label.toLowerCase()}`}
          value={eur(focus.net)}
          tone={focus.net < 0 ? "danger" : undefined}
          detail={focus.status === "closed" ? "Net, as invoiced and spent" : focus.status === "planned" ? "Net at plan" : "Net at plan, months to come included"}
        />
        <StatCard label="Year so far" value={eur(soFar.net)} tone={soFar.net < 0 ? "danger" : undefined} detail="Net, months that have ended" />
        <StatCard
          label={yearClosed ? "Year" : "Year at plan"}
          value={eur(total.net)}
          tone={total.net < 0 ? "danger" : undefined}
          detail={`Net${margin(total) === null ? "" : `, margin ${pct(total)}`} on ${eur(total.revenue)} revenue`}
        />
      </div>

      {empty ? (
        <p className="text-sm text-muted-foreground">Nothing invoiced, spent or planned in {year} yet.</p>
      ) : (
        <>
          <DataTableCard className="max-lg:hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <caption className="sr-only">Quarters of {year}: revenue minus costs equals net</caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className={cn(th, "text-left")}>Quarter</th>
                  <th scope="col" className={cn(th, "text-right")}>Revenue</th>
                  <th scope="col" className={cn(th, "text-right")}>Collaborators</th>
                  <th scope="col" className={cn(th, "text-right")}>Other costs</th>
                  <th scope="col" className={cn(th, "text-right")}>Net</th>
                  <th scope="col" className={cn(th, "text-right")}>Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.quarter}>
                    <tr className="border-b border-hairline">
                      <th scope="row" className="px-2 py-2.5 text-left font-normal sm:px-4">
                        <button
                          type="button"
                          aria-expanded={open.has(r.quarter)}
                          onClick={() => toggle(r.quarter)}
                          className="flex min-h-9 items-center pointer-coarse:min-h-11 gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronRight aria-hidden className={cn("size-4 text-muted-foreground transition-transform", open.has(r.quarter) && "rotate-90")} />
                          <span className="font-medium">Q{r.quarter}</span>
                          <span className="text-muted-foreground">{QUARTER_SPAN[r.quarter - 1]}</span>
                          <StatusPill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusPill>
                          {r.notInvoiced > 0 && <StatusPill tone="warning">{eur(r.notInvoiced)} not invoiced yet</StatusPill>}
                        </button>
                      </th>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right sm:px-4">{eur(r.revenue)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right text-subtle-foreground sm:px-4">
                        {eur(r.collaborators)}
                        <PlanNote plan={r.plan} invoiced={r.collaborators} missing={r.notInvoiced} atPlan={r.status === "in-progress"} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right text-subtle-foreground sm:px-4">{eur(r.otherCosts)}</td>
                      <td className={cn("whitespace-nowrap px-2 py-2.5 text-right sm:px-4", netClass(r))}>{eur(r.net)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right sm:px-4">{pct(r)}</td>
                    </tr>
                    {open.has(r.quarter) &&
                      r.months.map((m) => {
                        const t = { revenue: m.revenue, costs: m.costs, net: m.revenue - m.costs }
                        return (
                          <tr key={m.yearMonth} className="border-b border-hairline bg-surface-subtle text-subtle-foreground">
                            <th scope="row" className="py-2 pl-10 pr-2 text-left font-normal sm:pr-4">{monthLabel(m)}</th>
                            <td className="whitespace-nowrap px-2 py-2 text-right sm:px-4">{eur(m.revenue)}</td>
                            <td className="whitespace-nowrap px-2 py-2 text-right sm:px-4">
                              {eur(m.collaborators)}
                              <PlanNote plan={m.plan} invoiced={m.collaborators} missing={m.missing.length} who={missingWho(m)} />
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-right sm:px-4">{eur(m.otherCosts)}</td>
                            <td className={cn("whitespace-nowrap px-2 py-2 text-right sm:px-4", t.net < 0 && "text-danger")}>{eur(t.net)}</td>
                            <td className="whitespace-nowrap px-2 py-2 text-right sm:px-4">{pct(t)}</td>
                          </tr>
                        )
                      })}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-subtle font-medium">
                  <th scope="row" className="px-2 py-3 text-left font-medium sm:px-4">{year}</th>
                  <td className="whitespace-nowrap px-2 py-3 text-right sm:px-4">{eur(total.revenue)}</td>
                  <td className="whitespace-nowrap px-2 py-3 text-right sm:px-4">{eur(total.collaborators)}</td>
                  <td className="whitespace-nowrap px-2 py-3 text-right sm:px-4">{eur(total.otherCosts)}</td>
                  <td className={cn("whitespace-nowrap px-2 py-3 text-right sm:px-4", total.net < 0 && "text-danger")}>{eur(total.net)}</td>
                  <td className="whitespace-nowrap px-2 py-3 text-right sm:px-4">{pct(total)}</td>
                </tr>
              </tfoot>
            </table>
            </div>
          </DataTableCard>

          <ul aria-label="Quarters" className="space-y-3 lg:hidden">
            {cards.map((r) => (
              <QuarterCard key={r.quarter} row={r} open={cardsOpen.has(r.quarter)} onToggle={() => toggler(setCardsOpen)(r.quarter)} monthLabel={monthLabel} />
            ))}
          </ul>
        </>
      )}

      <p className="text-meta text-muted-foreground">
        Revenue is what you invoiced for each month that has ended. Collaborators is what they invoiced for it, with the plan
        beside it: a missing invoice shows as a gap, nothing is guessed. Other costs are the costs dated in the month. The
        current month and later come from the plan, estimates included. Pay is in the Cash Book; taxes are your accountant&apos;s.
      </p>
    </section>
  )
}

function QuarterCard({ row: r, open, onToggle, monthLabel }: { row: QuarterRow; open: boolean; onToggle: () => void; monthLabel: (m: QuarterMonth) => React.ReactNode }) {
  const line = (label: string, value: string, className?: string) => (
    <div className={cn("flex justify-between gap-3 py-1", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
  return (
    <li className="rounded-xl border bg-card px-[18px] py-3 text-sm shadow-xs">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-11 w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center gap-2">
          <ChevronRight aria-hidden className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className="font-medium">Q{r.quarter} · {QUARTER_SPAN[r.quarter - 1]}</span>
        </span>
        <span className="flex flex-wrap items-center justify-end gap-1">
          <StatusPill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusPill>
          {r.notInvoiced > 0 && <StatusPill tone="warning">{eur(r.notInvoiced)} not invoiced yet</StatusPill>}
        </span>
      </button>
      <p className={cn("py-1 text-base tabular-nums", netClass(r))}>{eur(r.net)} net</p>
      {line("Revenue", eur(r.revenue))}
      {line("Collaborators", eur(r.collaborators))}
      <PlanNote plan={r.plan} invoiced={r.collaborators} missing={r.notInvoiced} atPlan={r.status === "in-progress"} />
      {line("Other costs", eur(r.otherCosts))}
      {line("Margin", pct(r))}
      {open && (
        <ul className="mt-2 space-y-2 border-t border-hairline pt-2 text-subtle-foreground">
          {r.months.map((m) => (
            <li key={m.yearMonth}>
              <p>{monthLabel(m)}</p>
              <p className={cn("tabular-nums", m.revenue - m.costs < 0 && "text-danger")}>{eur(m.revenue - m.costs)} net</p>
              {line("Revenue", eur(m.revenue))}
              {line("Collaborators", eur(m.collaborators))}
              <PlanNote plan={m.plan} invoiced={m.collaborators} missing={m.missing.length} who={missingWho(m)} />
              {line("Other costs", eur(m.otherCosts))}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
