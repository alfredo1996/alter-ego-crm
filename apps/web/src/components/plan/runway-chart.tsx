"use client"

import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth } from "@alter-ego/kernel/dates"

import { useElementWidth } from "@/hooks/use-element-width"

const PAD = { top: 16, right: 16, bottom: 30, left: 52 }
const DEFAULT_W = 700
const CHART_H = 200
const LABEL_ROOM = 44

function abbreviate(v: number): string {
  const a = Math.abs(v)
  const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1)}M` : a >= 1_000 ? `${+(a / 1_000).toFixed(1)}k` : `${a}`
  return `${v < 0 ? "-" : ""}€${s}`
}

/** A tidy step (1, 2, 2.5, 5 × 10ⁿ) so the range holds about four gridlines. */
function niceStep(range: number): number {
  const base = 10 ** Math.floor(Math.log10(range / 4))
  return base * ([1, 2, 2.5, 5, 10].find((m) => base * m * 4 >= range) ?? 10)
}

export interface RunwayPoint {
  /** "YYYY-MM", or null for today. */
  yearMonth: string | null
  balance: number
}

/**
 * The balance at each month end as a line, today first: the zero line solid, the floor dashed. A point
 * under the floor is a hollow square, one under zero a cross; the table below says it in words.
 */
export function RunwayChart({ points, floor }: { points: RunwayPoint[]; floor: number | null }) {
  const [measure, width] = useElementWidth<HTMLDivElement>()
  const values = points.map((p) => p.balance)
  const lo = Math.min(0, ...values, floor ?? 0)
  const hi = Math.max(1, ...values, floor ?? 0)
  const step = niceStep(hi - lo)
  const yMin = Math.floor(lo / step) * step
  const yMax = Math.ceil(hi / step) * step
  const ticks = Array.from({ length: Math.round((yMax - yMin) / step) + 1 }, (_, i) => yMin + i * step)

  const totalW = Math.round(width) || DEFAULT_W
  const innerW = totalW - PAD.left - PAD.right
  const totalH = PAD.top + CHART_H + PAD.bottom
  const toY = (v: number) => PAD.top + CHART_H - ((v - yMin) / (yMax - yMin)) * CHART_H
  const toX = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const labelStep = Math.ceil(points.length / Math.max(1, Math.floor(innerW / LABEL_ROOM)))
  const label = (p: RunwayPoint) => (p.yearMonth ? formatYearMonth(p.yearMonth, "MMM yyyy") : "Today")
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)} ${toY(p.balance).toFixed(1)}`).join(" ")

  return (
    <div ref={measure}>
      <svg viewBox={`0 0 ${totalW} ${totalH}`} className="block w-full" role="img" aria-label="Balance at month end, today and each month ahead">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={toY(t)}
              y2={toY(t)}
              strokeWidth={t === 0 ? 1 : 0.5}
              strokeDasharray={t === 0 ? undefined : "4 4"}
              className={t === 0 ? "stroke-border-strong" : "stroke-border"}
            />
            <text x={PAD.left - 8} y={toY(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {abbreviate(t)}
            </text>
          </g>
        ))}
        {floor != null && (
          <line x1={PAD.left} x2={PAD.left + innerW} y1={toY(floor)} y2={toY(floor)} strokeWidth={1.5} strokeDasharray="6 4" className="stroke-warning" />
        )}
        <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-primary" />
        {points.map((p, i) => {
          const x = toX(i)
          const y = toY(p.balance)
          return (
            <g key={p.yearMonth ?? "today"}>
              <title>{`${label(p)}: ${eur(p.balance)}`}</title>
              {p.balance < 0 ? (
                <path d={`M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}`} strokeWidth={2} className="stroke-danger" />
              ) : floor != null && p.balance < floor ? (
                <rect x={x - 3.5} y={y - 3.5} width={7} height={7} strokeWidth={2} className="fill-card stroke-warning" />
              ) : (
                <circle cx={x} cy={y} r={2.5} className="fill-primary" />
              )}
              {i % labelStep === 0 && (
                <text x={x} y={totalH - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {p.yearMonth ? formatYearMonth(p.yearMonth, "MMM yy") : "Today"}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
