"use client"

import { format as fmtDate, isToday } from "date-fns"

import { useElementWidth } from "../../hooks/use-element-width"
import { niceScale } from "../../lib/chart-scale"

import type { NetWorthSnapshot } from "../../types"

interface NetWorthChartProps {
  /** One snapshot per month end, oldest first. */
  data: NetWorthSnapshot[]
  format: (amount: number) => string
  whole: (amount: number) => string
  compact: (amount: number) => string
}

const PAD = { top: 26, right: 24, bottom: 34, left: 52 }
const CHART_H = 96
/** Drawn at the container's width, so 12 px text stays 12 px on a phone; this until measured. */
const DEFAULT_W = 560
/** Room for one "28 Jul" label and a gap, in px. */
const LABEL_ROOM = 56

/** The line of net worth through its snapshots: a dot each, the first valued, the last called Today. */
export function NetWorthChart({ data, format: fmt, whole, compact }: NetWorthChartProps) {
  const [measure, width] = useElementWidth<HTMLDivElement>()
  const totalW = Math.round(width) || DEFAULT_W
  const innerW = totalW - PAD.left - PAD.right
  const values = data.map((d) => d.netWorth)
  const ticks = niceScale(Math.min(...values), Math.max(...values), 2)
  const lo = ticks[0]!
  const hi = ticks[ticks.length - 1]!
  const y = (v: number) => PAD.top + CHART_H - ((v - lo) / (hi - lo)) * CHART_H
  const x = (i: number) => PAD.left + (data.length > 1 ? (i / (data.length - 1)) * innerW : innerW / 2)
  const labelStep = Math.ceil(data.length / Math.max(1, Math.floor(innerW / LABEL_ROOM)))
  const last = data.length - 1
  const name = (d: NetWorthSnapshot, i: number) => (i === last && isToday(d.date) ? "Today" : fmtDate(d.date, "d MMM"))

  return (
    <div ref={measure} className="w-full">
      <svg
        viewBox={`0 0 ${totalW} ${PAD.top + CHART_H + PAD.bottom}`}
        role="img"
        aria-label={`Net worth: ${data.map((d, i) => `${name(d, i)} ${fmt(d.netWorth)}`).join(", ")}.`}
        className="block w-full"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t) + 0.5} y2={y(t) + 0.5} className={t === lo ? "stroke-border" : "stroke-hairline"} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-xs tabular-nums">
              {compact(t)}
            </text>
          </g>
        ))}
        <polyline
          points={data.map((d, i) => `${x(i)},${y(d.netWorth)}`).join(" ")}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-foreground"
        />
        {data.map((d, i) => (
          <g key={d.id}>
            <title>{`${name(d, i)}: ${fmt(d.netWorth)}`}</title>
            <circle cx={x(i)} cy={y(d.netWorth)} r={i === last ? 5 : 4.5} strokeWidth={2} className="fill-foreground stroke-background" />
            {(i % labelStep === 0 || i === last) && (
              <text x={x(i)} y={PAD.top + CHART_H + 24} textAnchor="middle" className={i === last ? "fill-foreground text-xs font-semibold" : "fill-subtle-foreground text-xs"}>
                {name(d, i)}
              </text>
            )}
          </g>
        ))}
        <text x={x(0)} y={y(data[0]!.netWorth) - 12} textAnchor="middle" className="fill-subtle-foreground text-xs tabular-nums">
          {whole(data[0]!.netWorth)}
        </text>
      </svg>
    </div>
  )
}
