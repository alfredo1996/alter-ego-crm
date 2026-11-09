"use client"

import { formatYearMonth } from "@alter-ego/kernel/dates"
import { cn } from "@alter-ego/ui/utils"
import { useId } from "react"

import { useElementWidth } from "@/hooks/use-element-width"
import { eurCents } from "@/lib/invoices"

import type { SummaryMonth } from "@/lib/cash-flow-summary"

/**
 * Each account's line, in the balance hero's neutral order (#171717, then #d4d4d4, plan §1.5): the
 * chart and the hero's swatches name an account alike. Full class strings: Tailwind only sees literals.
 */
export const SERIES = [
  { stroke: "stroke-foreground", bg: "bg-foreground", dash: undefined },
  { stroke: "stroke-border-strong", bg: "bg-border-strong", dash: undefined },
  { stroke: "stroke-muted-foreground", bg: "bg-muted-foreground", dash: undefined },
  { stroke: "stroke-foreground", bg: "bg-foreground", dash: "4 3" },
] as const

// ponytail: four lines; a fifth account reuses the first, the legend and the table still name it.
export const seriesOf = (index: number) => SERIES[Math.max(0, index) % SERIES.length]

const compact = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 })
/** Each month is 10 units wide; the marks stretch, the text stays HTML so it never shrinks on a phone. */
const COLUMN = 10
/** A plot widens with its columns, up to the page: a single month is not two giant bars. */
const maxWidth = (columns: number) => ({ maxWidth: 64 + columns * 96 })

function scale(values: number[]) {
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  // All zero: the baseline sits at the bottom, not the top.
  return { max, min, y: (v: number) => (max === min ? 100 : ((max - v) / (max - min)) * 100) }
}

/** The value axis: the top, zero and the bottom when below zero, in HTML beside the plot; a label too close to zero is left out. */
function Axis({ max, min, y }: ReturnType<typeof scale>) {
  const ticks = [0, ...[max, min].filter((v) => Math.abs(y(v) - y(0)) >= 12)]
  return (
    <div aria-hidden className="relative w-14 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
      {ticks.map((v) => (
        <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(v)}%` }}>
          {compact.format(v)}
        </span>
      ))}
    </div>
  )
}

/** "Sep", or "Sep 26" when the months cross a year: a long range never repeats a bare "Jan". */
export function shortMonths(yms: string[]): string[] {
  const crosses = yms.length > 0 && yms[0].slice(0, 4) !== yms[yms.length - 1].slice(0, 4)
  return yms.map((ym) => formatYearMonth(ym, crosses ? "MMM yy" : "MMM"))
}

/** Room for one label ("Start", "Sep 26") and a gap, in px. */
const LABEL_ROOM = 44

function ColumnLabels({ labels }: { labels: string[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  // As many labels as the width holds (twelve before it is measured), every k-th column.
  const step = Math.ceil(labels.length / (width > 0 ? Math.max(1, Math.floor(width / LABEL_ROOM)) : 12))
  return (
    <div ref={ref} aria-hidden className="relative ml-16 h-4 text-[11px] text-muted-foreground">
      {labels.map((label, i) => {
        if (i % step !== 0) return null
        // At its column's centre, pulled in by as much of its own width as its place: never past either edge.
        const at = ((i + 0.5) / labels.length) * 100
        return (
          <span key={i} className="absolute top-0 whitespace-nowrap" style={{ left: `${at}%`, transform: `translateX(-${at}%)` }}>
            {label}
          </span>
        )
      })}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; swatch: string; line?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("inline-block shrink-0", item.line ? "w-4 border-t-2 border-dashed" : "h-2.5 w-2.5 rounded-sm", item.swatch)} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/** In and Out side by side per month, the net as a tick across both. */
export function InOutChart({ months }: { months: Pick<SummaryMonth, "ym" | "in" | "out" | "net">[] }) {
  const id = useId()
  const s = scale(months.flatMap((m) => [m.in, m.out, m.net]))
  const width = months.length * COLUMN
  return (
    <figure className="space-y-3">
      <Legend
        items={[
          { label: "In", swatch: "bg-success" },
          { label: "Out", swatch: "bg-foreground" },
          { label: "Net (in less out)", swatch: "border-foreground", line: true },
        ]}
      />
      <div className="space-y-2" style={maxWidth(months.length)}>
        <div className="flex h-48 gap-2 pt-2">
          <Axis {...s} />
          <svg
            role="img"
            aria-labelledby={`${id}-t ${id}-d`}
            viewBox={`0 0 ${width} 100`}
            preserveAspectRatio="none"
            className="h-full min-w-0 flex-1 overflow-visible"
          >
            <title id={`${id}-t`}>Money in and out by month</title>
            <desc id={`${id}-d`}>
              {months.map((m) => `${formatYearMonth(m.ym)}: in ${eurCents(m.in)}, out ${eurCents(m.out)}, net ${eurCents(m.net)}.`).join(" ")}
            </desc>
            <line x1={0} x2={width} y1={s.y(0)} y2={s.y(0)} vectorEffect="non-scaling-stroke" className="stroke-muted-foreground/50" />
            {months.map((m, i) => {
              const x = i * COLUMN
              return (
                <g key={m.ym}>
                  <rect x={x + 1.2} width={3.4} y={s.y(m.in)} height={s.y(0) - s.y(m.in)} className="fill-success" />
                  <rect x={x + 5.4} width={3.4} y={s.y(m.out)} height={s.y(0) - s.y(m.out)} className="fill-foreground" />
                  {/* Dashed, on a halo in the page colour: it reads across the dark Out bar too. */}
                  {[
                    { width: 5, className: "stroke-background", dash: undefined },
                    { width: 2, className: "stroke-foreground", dash: "4 3" },
                  ].map((l) => (
                    <line
                      key={l.width}
                      x1={x + 0.6}
                      x2={x + 9.4}
                      y1={s.y(m.net)}
                      y2={s.y(m.net)}
                      strokeWidth={l.width}
                      strokeDasharray={l.dash}
                      vectorEffect="non-scaling-stroke"
                      className={l.className}
                    />
                  ))}
                  {/* The whole column answers a hover, not only the bars. */}
                  <rect x={x} width={COLUMN} y={0} height={100} fill="transparent">
                    <title>{`${formatYearMonth(m.ym)}: in ${eurCents(m.in)}, out ${eurCents(m.out)}, net ${eurCents(m.net)}`}</title>
                  </rect>
                </g>
              )
            })}
          </svg>
        </div>
        <ColumnLabels labels={shortMonths(months.map((m) => m.ym))} />
      </div>
    </figure>
  )
}

export type BalancePoint = {
  key: string
  /** Under the axis: "Start", "Sep". */
  label: string
  /** In words: "Start, 01/09/2026", "End of September 2026". */
  name: string
  ends: Map<string, number | null>
}

/** Each account's balance at the start, then at every month end: one line per account, a dot per point. */
export function BalancesChart({
  points,
  accounts,
}: {
  points: BalancePoint[]
  /** In legend order, each with its series colour. */
  accounts: { id: string; name: string; series: (typeof SERIES)[number] }[]
}) {
  const id = useId()
  const s = scale(points.flatMap((p) => [...p.ends.values()].filter((v): v is number => v !== null)))
  const width = points.length * COLUMN
  const x = (i: number) => i * COLUMN + COLUMN / 2
  return (
    <figure className="space-y-3">
      <Legend items={accounts.map((a) => ({ label: a.name, swatch: a.series.bg }))} />
      <div className="space-y-2" style={maxWidth(Math.max(points.length, 4))}>
        <div className="flex h-48 gap-2 pt-2">
          <Axis {...s} />
          <div className="relative min-w-0 flex-1">
            <svg
              role="img"
              aria-labelledby={`${id}-t ${id}-d`}
              viewBox={`0 0 ${width} 100`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
            >
              <title id={`${id}-t`}>Balance at the start and at each month end</title>
              <desc id={`${id}-d`}>
                {points.map((p) => `${p.name}: ${accounts.map((a) => `${a.name} ${balanceText(p.ends.get(a.id))}`).join(", ")}.`).join(" ")}
              </desc>
              <line x1={0} x2={width} y1={s.y(0)} y2={s.y(0)} vectorEffect="non-scaling-stroke" className="stroke-muted-foreground/50" />
              {accounts.map((a) => {
                // A month before the account opened breaks its line.
                const segments: string[][] = [[]]
                points.forEach((p, i) => {
                  const v = p.ends.get(a.id)
                  if (v === null || v === undefined) segments.push([])
                  else segments[segments.length - 1].push(`${x(i)},${s.y(v)}`)
                })
                return segments
                  .filter((points) => points.length > 1)
                  .map((points) => (
                    <polyline
                      key={`${a.id}-${points[0]}`}
                      points={points.join(" ")}
                      fill="none"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeDasharray={a.series.dash}
                      vectorEffect="non-scaling-stroke"
                      className={a.series.stroke}
                    />
                  ))
              })}
            </svg>
            {/* Dots in HTML: round at any width, each with its figure on hover. */}
            {accounts.flatMap((a) =>
              points.map((p, i) => {
                const v = p.ends.get(a.id)
                if (v === null || v === undefined) return null
                return (
                  <span
                    key={`${a.id}-${p.key}`}
                    title={`${a.name}, ${p.name}: ${eurCents(v)}`}
                    className={cn("absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background", a.series.bg)}
                    style={{ left: `${(x(i) / width) * 100}%`, top: `${s.y(v)}%` }}
                  />
                )
              }),
            )}
          </div>
        </div>
        <ColumnLabels labels={points.map((p) => p.label)} />
      </div>
    </figure>
  )
}

export const balanceText = (v: number | null | undefined) => (v === null || v === undefined ? "not open yet" : eurCents(v))
