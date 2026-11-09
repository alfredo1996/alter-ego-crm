"use client"

import { eur } from "@alter-ego/kernel/currency"

import { useElementWidth } from "@/hooks/use-element-width"

import type { ProjectionMonth } from "@/lib/projection"

const PAD = { top: 16, right: 16, bottom: 30, left: 44 }
/** Drawn at the container's width, so 11 px text stays 11 px on a phone; this until measured. */
const DEFAULT_W = 700
const CHART_H = 180
/** Room for one month label ("09") and a gap, in px. */
const LABEL_ROOM = 28

function abbreviate(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(v % 1_000 === 0 || v >= 10_000 ? 0 : 1)}k`
  return v.toFixed(0)
}

/** The smallest tidy step (1, 2, 2.5, 4, 5 × 10ⁿ) that three of cover `max`: ticks at €4k, €8k, €12k, not €3,527. */
function tickStep(max: number): number {
  const base = 10 ** Math.floor(Math.log10(max / 3))
  return base * [1, 2, 2.5, 4, 5, 10].find((m) => base * m * 3 >= max)!
}

interface ProjectionChartProps {
  timeline: ProjectionMonth[]
}

/**
 * One bar a month, the whole bar the Gross: Net dark below, Costs light above (Plan.dc). A month whose
 * costs pass its gross is all Costs (ponytail: the table below carries the negative Net).
 */
export function ProjectionChart({ timeline }: ProjectionChartProps) {
  const [measure, width] = useElementWidth<HTMLDivElement>()

  if (timeline.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border text-sm text-muted-foreground">
        No data. Allocate days to clients to see the projection.
      </div>
    )
  }

  const step = tickStep(Math.max(...timeline.map((m) => m.revenue), 1))
  const maxValue = step * 3

  const totalW = Math.round(width) || DEFAULT_W
  const CHART_W = totalW - PAD.left - PAD.right
  const totalH = PAD.top + CHART_H + PAD.bottom
  // As many month labels as the width holds: every k-th month.
  const labelStep = Math.ceil(timeline.length / Math.max(1, Math.floor(CHART_W / LABEL_ROOM)))

  const toY = (v: number) => PAD.top + CHART_H - (v / maxValue) * CHART_H
  const slot = CHART_W / timeline.length
  const barW = Math.min(40, slot * 0.62)
  const toX = (i: number) => PAD.left + (i + 0.5) * slot
  const bars = timeline.map((month, i) => {
    const costs = Math.min(month.costs, month.revenue)
    const net = month.revenue - costs
    return { month, x: toX(i) - barW / 2, netTop: toY(net), costTop: toY(net + costs), base: toY(0) }
  })

  return (
    <figure className="space-y-3 rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[17px] font-semibold tracking-tight">Monthly Projection</h3>
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-subtle-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-[9px] rounded-[2px] bg-primary" />
            Net
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-[9px] rounded-[2px] bg-border-strong" />
            Costs
          </span>
          <span>The whole bar is Gross</span>
        </figcaption>
      </div>

      <div ref={measure}>
        <svg viewBox={`0 0 ${totalW} ${totalH}`} className="block w-full">
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <line
                x1={PAD.left}
                y1={toY(step * i)}
                x2={PAD.left + CHART_W}
                y2={toY(step * i)}
                strokeWidth={i === 0 ? 1 : 0.5}
                strokeDasharray={i > 0 ? "4 4" : undefined}
                className="stroke-border"
              />
              <text x={PAD.left - 8} y={toY(step * i) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                €{abbreviate(step * i)}
              </text>
            </g>
          ))}

          {bars.map((b, i) => (
            <g key={b.month.yearMonth}>
              <title>
                {b.month.yearMonth}: {eur(b.month.revenue)} gross, {eur(b.month.costs)} costs, {eur(b.month.revenue - b.month.costs)} net
              </title>
              <rect x={b.x} y={b.costTop} width={barW} height={Math.max(0, b.netTop - b.costTop)} rx={2} className="fill-border-strong" />
              <rect x={b.x} y={b.netTop} width={barW} height={Math.max(0, b.base - b.netTop)} rx={2} className="fill-primary" />
              {i % labelStep === 0 && (
                <text x={b.x + barW / 2} y={totalH - 14} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {b.month.yearMonth.slice(5)}
                </text>
              )}
            </g>
          ))}

          {/* Year labels at January */}
          {bars
            .filter((b) => b.month.yearMonth.endsWith("-01"))
            .map((b) => (
              <text
                key={b.month.yearMonth}
                x={b.x + barW / 2}
                y={totalH - 1}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px] font-medium"
              >
                {b.month.yearMonth.slice(0, 4)}
              </text>
            ))}
        </svg>
      </div>
    </figure>
  )
}
