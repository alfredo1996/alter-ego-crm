"use client"

import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth, parseYearMonth } from "@alter-ego/kernel/dates"
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { format, subMonths } from "date-fns"
import { ArrowRight, TrendingDown } from "lucide-react"
import { Fragment } from "react"


import type { RevenueCliff } from "@/lib/engagement-burndown"

interface Props {
  cliffs: RevenueCliff[]
  /** What the weighted pipeline would put back in the first cliff's month, per month. */
  pipelineRecovery: number;
  /** What the month before the first cliff really bills (the projection's row), or null when the timeline has no such month. */
  levelBefore: number | null;
}

/**
 * Which month the billing drops, by how much, what is left, and what the pipeline could put back:
 * a headline and the steps down (Plan.dc, "When billing drops"). The first cliff month is the first
 * month at zero, so it is the month the loss starts, not the month the budget was used up.
 */
export function RevenueCliffPanel({
  cliffs,
  pipelineRecovery,
  levelBefore,
}: Props) {
  if (cliffs.length === 0) {
    return <p className="text-sm text-muted-foreground">No budget runs out in the next 12 months.</p>
  }

  const [first] = cliffs
  const names = (c: RevenueCliff) => c.sources.map((s) => s.clientName).join(", ")
  const before = format(subMonths(parseYearMonth(first.yearMonth), 1), "MMMM yyyy")
  const steps = [
    ...(levelBefore === null
      ? []
      : [
          {
            key: "before",
            month: before,
            level: levelBefore,
            detail: "Before billing stops",
          },
        ]),
    ...cliffs.map((c) => ({
      key: c.yearMonth,
      month: formatYearMonth(c.yearMonth),
      level: c.grossRemainingPerMonth,
      detail: `−${eur(c.grossLostPerMonth)} · ${names(c)}, billing stops`,
    })),
  ]

  return (
    <ContentCard as="section" variant="warning" aria-label="When billing drops" className="space-y-4">
      <div className="flex items-start gap-3">
        <TrendingDown aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div className="space-y-1">
          <p className="text-[17px] font-semibold tracking-tight">
            From {formatYearMonth(first.yearMonth)} you bill {eur(first.grossLostPerMonth)} a month less
          </p>
          <p className="text-sm text-subtle-foreground">
            Billing stops for {names(first)}.
            {pipelineRecovery > 0 && ` The weighted pipeline could win back ${eur(pipelineRecovery)} a month.`}
          </p>
        </div>
      </div>
      <ol className="flex flex-wrap items-stretch gap-2.5 sm:ml-8">
        {steps.map((step, i) => (
          <Fragment key={step.key}>
            {i > 0 && <li aria-hidden className="hidden items-center text-muted-foreground sm:flex"><ArrowRight className="size-4" /></li>}
            <li className="flex min-w-48 flex-1 flex-col gap-0.5 rounded-[10px] border border-warning/25 bg-card px-3.5 py-3 text-card-foreground">
              <span className="text-[12.5px] text-muted-foreground">{step.month}</span>
              <span className="text-lg font-semibold tracking-tight tabular-nums">{eur(step.level)} a month</span>
              <span className="text-[12.5px] text-subtle-foreground tabular-nums">{step.detail}</span>
            </li>
          </Fragment>
        ))}
      </ol>
    </ContentCard>
  )
}
