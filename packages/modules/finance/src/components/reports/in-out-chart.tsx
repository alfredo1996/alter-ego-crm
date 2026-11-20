"use client"

import { format as fmtDate, parse } from "date-fns"

import { useElementWidth } from "../../hooks/use-element-width"
import { niceScale } from "../../lib/chart-scale"

import type { MonthlySummary } from "../../types"

interface InOutChartProps {
  months: MonthlySummary[]
  /** "2026-10": the month the page is about, drawn on a tinted column with its figures over the bars. */
  focusMonth?: string
  /** What the focus month's axis label says: "Oct · to 15th" while it is still running. */
  focusLabel?: string
  /** With cents: the name of the picture. */
  format: (amount: number) => string
  /** Without: "€2,850", for the labels. */
  whole: (amount: number) => string
  /** "€4K": the axis. */
  compact: (amount: number) => string
}

const PAD = { top: 22, right: 12, bottom: 56, left: 46 }
const CHART_H = 180
const BAR_W = 32
const GROUP_GAP = 4
/** Drawn at the container's width, so 12 px text stays 12 px on a phone; this until measured. */
const DEFAULT_W = 560
/** Room for one "MMM" label and a gap, in px. */
const LABEL_ROOM = 36
/** Room for "+€1,189" under a month, in px. */
const NET_ROOM = 52

/** Rounded at the top, flat on the axis: a bar that is not a pill. */
function bar(x: number, width: number, top: number, base: number): string {
  const r = Math.min(4, (base - top) / 2, width / 2)
  return `M${x} ${base}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + width - r}Q${x + width} ${top} ${x + width} ${top + r}V${base}Z`
}

/** Money in against money out, month by month, with the net under each month. */
export function InOutChart({ months, focusMonth, focusLabel, format: fmt, whole, compact }: InOutChartProps) {
  const [measure, width] = useElementWidth<HTMLDivElement>()
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${whole(Math.abs(n))}`
  const name = (month: string) => fmtDate(parse(month, "yyyy-MM", new Date()), "MMM")

  const ticks = niceScale(0, Math.max(...months.flatMap((m) => [m.income, m.expenses])), 4)
  const top = ticks[ticks.length - 1]!
  const totalW = Math.round(width) || DEFAULT_W
  const innerW = totalW - PAD.left - PAD.right
  const colW = innerW / months.length
  const barW = Math.max(3, Math.min(BAR_W, (colW - GROUP_GAP - 8) / 2))
  const labelStep = Math.ceil(months.length / Math.max(1, Math.floor(innerW / LABEL_ROOM)))
  const showNet = colW * labelStep >= NET_ROOM
  const base = PAD.top + CHART_H
  const y = (v: number) => base - (v / top) * CHART_H

  const story = months
    .map((m) => `${name(m.month)}: in ${fmt(m.income)}, out ${fmt(m.expenses)}, net ${m.net < 0 ? "−" : "+"}${fmt(Math.abs(m.net))}`)
    .join(". ")

  return (
    <div ref={measure} className="w-full">
      <svg viewBox={`0 0 ${totalW} ${base + PAD.bottom}`} role="img" aria-label={`Money in and out by month. ${story}.`} className="block w-full">
        {months.map((m, i) =>
          m.month === focusMonth ? (
            <rect key={m.month} x={PAD.left + i * colW + 4} y={4} width={colW - 8} height={base - 4} rx={8} className="fill-muted" />
          ) : null,
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t) + 0.5} y2={y(t) + 0.5} className={t === 0 ? "stroke-border" : "stroke-hairline"} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-xs tabular-nums">
              {compact(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const left = PAD.left + (i + 0.5) * colW - GROUP_GAP / 2 - barW
          const right = left + barW + GROUP_GAP
          const focus = m.month === focusMonth
          const label = focus && focusLabel ? focusLabel : name(m.month)
          const labelled = i % labelStep === 0 || focus
          return (
            <g key={m.month}>
              <title>{`${name(m.month)}: in ${fmt(m.income)}, out ${fmt(m.expenses)}`}</title>
              {m.income > 0 && <path d={bar(left, barW, y(m.income), base)} className="fill-income" />}
              {m.expenses > 0 && <path d={bar(right, barW, y(m.expenses), base)} className="fill-foreground" />}
              {focus && m.income > 0 && (
                <text x={left + barW / 2} y={y(m.income) - 6} textAnchor="middle" className="fill-subtle-foreground text-xs tabular-nums">
                  {whole(m.income)}
                </text>
              )}
              {focus && m.expenses > 0 && (
                <text x={right + barW / 2} y={y(m.expenses) - 6} textAnchor="middle" className="fill-subtle-foreground text-xs tabular-nums">
                  {whole(m.expenses)}
                </text>
              )}
              {labelled && (
                <text x={PAD.left + (i + 0.5) * colW} y={base + 20} textAnchor="middle" className={focus ? "fill-foreground text-[13px] font-semibold" : "fill-subtle-foreground text-[13px]"}>
                  {label}
                </text>
              )}
              {labelled && showNet && (
                <text x={PAD.left + (i + 0.5) * colW} y={base + 40} textAnchor="middle" className="fill-muted-foreground text-xs tabular-nums">
                  {signed(m.net)}
                </text>
              )}
            </g>
          )
        })}
        {showNet && (
          <text x={PAD.left - 8} y={base + 40} textAnchor="end" className="fill-muted-foreground text-xs">
            Net
          </text>
        )}
      </svg>
    </div>
  )
}
