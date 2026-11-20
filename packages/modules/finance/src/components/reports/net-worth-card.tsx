"use client"


import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { format as fmtDate } from "date-fns"

import { NetWorthChart } from "./net-worth-chart"

import type { NetWorthSnapshot } from "../../types"

interface NetWorthCardProps {
  /** Every snapshot, oldest first: one a day. */
  data: NetWorthSnapshot[]
  format: (amount: number) => string
  whole: (amount: number) => string
  compact: (amount: number) => string
}

/** The last snapshot of each month: a line through a year of daily ones would be noise. */
function monthEnds(data: NetWorthSnapshot[]): NetWorthSnapshot[] {
  const byMonth = new Map<string, NetWorthSnapshot>()
  for (const s of data) byMonth.set(fmtDate(s.date, "yyyy-MM"), s)
  return [...byMonth.values()]
}

/** "Net Worth": today's figure, how far it moved since the month before, and the line between. */
export function NetWorthCard({ data, format, whole, compact }: NetWorthCardProps) {
  const ends = monthEnds(data)
  const latest = data[data.length - 1]
  const before = ends.length > 1 ? ends[ends.length - 2]! : null
  const diff = latest && before ? latest.netWorth - before.netWorth : 0
  const since = before ? fmtDate(before.date, "d MMMM") : ""

  return (
    <ContentCard as="section" id="worth" labelledBy="worth-title" className="flex min-w-0 scroll-mt-20 flex-col gap-5">
      <SectionHeader variant="card" id="worth-title" title="Net Worth" description={latest ? "At each month end" : undefined} />
      {!latest ? (
        <EmptyPrompt variant="inline" title="No net worth history yet." />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-[26px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">{format(latest.netWorth)}</p>
            <p className="text-sm text-subtle-foreground tabular-nums">
              {!before
                ? "One snapshot so far: the line appears once there is a second."
                : Math.abs(diff) < 0.005
                  ? `Same as on ${since}`
                  : `${diff > 0 ? "Up" : "Down"} ${format(Math.abs(diff))} since ${since}`}
            </p>
          </div>
          {before && <NetWorthChart data={ends} format={format} whole={whole} compact={compact} />}
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-hairline pt-3.5 text-[13px] text-subtle-foreground tabular-nums">
            <span>
              Assets <span className="ml-1 font-medium text-foreground">{format(latest.totalAssets)}</span>
            </span>
            <span>
              Debts <span className="ml-1 font-medium text-foreground">{format(latest.totalLiabilities)}</span>
            </span>
          </div>
        </>
      )}
    </ContentCard>
  )
}
