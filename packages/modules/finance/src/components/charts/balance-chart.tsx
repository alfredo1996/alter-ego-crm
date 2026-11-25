"use client"

import { differenceInDays, format as fmtDate } from "date-fns"
import { useRef, useState } from "react"

import { useElementWidth } from "../../hooks/use-element-width"
import { reconstructBalanceSeries } from "../../lib/balance-series"

import type { Transaction } from "../../types"

/** Drawn at the container's width, so 11 px text stays 11 px on a phone; this until measured. */
const DEFAULT_W = 628
const CHART_H = 190
const PAD = { top: 10, right: 16, bottom: 20, left: 44 }
/** Room for one "MMM d" tick label and a gap, in px. */
const TICK_ROOM = 64

/** Round y ticks (…, 2K, 4K, 6K) that enclose [min, max], about `count` intervals. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1
  const rough = span / count
  const pow = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((st) => st >= rough) ?? 10 * pow
  const ticks: number[] = []
  for (let v = Math.floor(min / step) * step; v < max + step - 1e-9 * step; v += step) ticks.push(Math.round(v / step) * step)
  return ticks.length > 1 ? ticks : [ticks[0], ticks[0] + step]
}

function abbreviate(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`
  return value.toFixed(0)
}

interface BalanceChartProps {
  transactions: Transaction[]
  currentBalance: number
  /** The account this chart belongs to — needed to sign transfers correctly. */
  accountId: string
  dateRange?: { from: Date; to: Date }
  onBrushSelect?: (range: { from: Date; to: Date }) => void
}

export function BalanceChart({
  transactions,
  currentBalance,
  accountId,
  dateRange,
  onBrushSelect,
}: BalanceChartProps) {
  // Reconstruct the running balance series (transfer-aware; see balance-series.ts).
  const fullPoints = reconstructBalanceSeries(transactions, currentBalance, accountId)

  if (fullPoints.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No transactions yet for this account.
      </div>
    )
  }

  // Filter to dateRange if provided
  let displayPoints = fullPoints
  if (dateRange) {
    const fromTime = dateRange.from.getTime()
    const toTime = dateRange.to.getTime()

    // Find the balance just before the range starts (opening balance for the range)
    const inRange = fullPoints.filter(
      (p) => p.date.getTime() >= fromTime && p.date.getTime() <= toTime
    )

    if (inRange.length > 0) {
      // Find the last point before the range to use as opening balance
      const beforeRange = fullPoints.filter((p) => p.date.getTime() < fromTime)
      if (beforeRange.length > 0) {
        const openBal = beforeRange[beforeRange.length - 1]
        displayPoints = [{ date: dateRange.from, balance: openBal.balance }, ...inRange]
      } else {
        displayPoints = inRange
      }
    }
  }

  if (displayPoints.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No data in selected range.
      </div>
    )
  }

  // Extend the chart to the end of the date range so the line
  // reaches "today" instead of stopping at the last transaction.
  if (dateRange) {
    const lastPoint = displayPoints[displayPoints.length - 1]
    if (lastPoint.date.getTime() < dateRange.to.getTime()) {
      displayPoints = [
        ...displayPoints,
        { date: dateRange.to, balance: lastPoint.balance },
      ]
    }
  }

  return (
    <BalanceChartInner
      points={displayPoints}
      onBrushSelect={onBrushSelect}
    />
  )
}

interface Point {
  date: Date
  balance: number
}

function computeXTicks(points: Point[], maxTicks: number): { date: Date; label: string }[] {
  if (points.length < 2) return []
  const first = points[0].date
  const last = points[points.length - 1].date
  const totalDays = differenceInDays(last, first)
  if (totalDays <= 0) return []

  // Pick format and step to keep ticks readable
  let fmt: string
  let stepDays: number

  if (totalDays >= 730) {
    // 2+ years → yearly ticks
    fmt = "yyyy"
    stepDays = 365
  } else if (totalDays >= 365) {
    // 1-2 years → quarterly
    fmt = "MMM ''yy"
    stepDays = 90
  } else if (totalDays >= 90) {
    // 3-12 months → monthly
    fmt = "MMM"
    stepDays = 30
  } else if (totalDays >= 30) {
    // 1-3 months → bi-weekly
    fmt = "MMM d"
    stepDays = 14
  } else {
    // < 1 month → weekly
    fmt = "MMM d"
    stepDays = 7
  }

  // Ensure we don't exceed maxTicks
  const estimatedCount = Math.floor(totalDays / stepDays)
  if (estimatedCount > maxTicks) {
    stepDays = Math.ceil(totalDays / maxTicks)
  }

  const ticks: { date: Date; label: string }[] = []
  let cursor = new Date(first.getTime() + stepDays * 86400000)
  while (cursor.getTime() < last.getTime() - stepDays * 86400000 * 0.3) {
    ticks.push({ date: new Date(cursor), label: fmtDate(cursor, fmt) })
    cursor = new Date(cursor.getTime() + stepDays * 86400000)
  }
  return ticks
}

function BalanceChartInner({
  points,
  onBrushSelect,
}: {
  points: Point[]
  onBrushSelect?: (range: { from: Date; to: Date }) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [measure, width] = useElementWidth<HTMLDivElement>()
  const [brushStart, setBrushStart] = useState<number | null>(null)
  const [brushEnd, setBrushEnd] = useState<number | null>(null)
  const [isBrushing, setIsBrushing] = useState(false)

  const values = points.map((p) => p.balance)
  const ticks = niceTicks(Math.min(...values), Math.max(...values))
  const minVal = ticks[0]
  const range = ticks[ticks.length - 1] - minVal

  const totalW = Math.round(width) || DEFAULT_W
  const CHART_W = totalW - PAD.left - PAD.right
  const totalH = PAD.top + CHART_H + PAD.bottom

  const minTime = points[0].date.getTime()
  const maxTime = points[points.length - 1].date.getTime()
  const timeSpan = maxTime - minTime

  const toX = (date: Date) =>
    PAD.left +
    (timeSpan > 0
      ? ((date.getTime() - minTime) / timeSpan) * CHART_W
      : CHART_W / 2)

  const toY = (v: number) =>
    PAD.top + CHART_H - ((v - minVal) / range) * CHART_H

  const svgPoints = points.map((p) => ({
    x: toX(p.date),
    y: toY(p.balance),
    date: p.date,
    balance: p.balance,
  }))

  const polyline = svgPoints.map((p) => `${p.x},${p.y}`).join(" ")

  const fillPath = [
    `M ${svgPoints[0].x} ${PAD.top + CHART_H}`,
    ...svgPoints.map((p) => `L ${p.x} ${p.y}`),
    `L ${svgPoints[svgPoints.length - 1].x} ${PAD.top + CHART_H}`,
    "Z",
  ].join(" ")

  const yTicks = ticks.map((value) => ({ value, y: toY(value) }))

  const firstPoint = svgPoints[0]
  const lastPoint = svgPoints[svgPoints.length - 1]

  // The text alternative for the picture: the range, the endpoints and the lowest month,
  // amounts in the same abbreviation as the y-axis ticks.
  const firstDate = points[0].date
  const lastDate = points[points.length - 1].date
  const lowest = points.reduce((a, b) => (b.balance < a.balance ? b : a))
  const span =
    firstDate.getFullYear() === lastDate.getFullYear()
      ? `${fmtDate(firstDate, "MMMM")} to ${fmtDate(lastDate, "MMMM yyyy")}`
      : `${fmtDate(firstDate, "MMMM yyyy")} to ${fmtDate(lastDate, "MMMM yyyy")}`
  const chartLabel = `Balance from ${span}: from ${abbreviate(points[0].balance)} to ${abbreviate(points[points.length - 1].balance)}, lowest ${abbreviate(lowest.balance)} in ${fmtDate(lowest.date, "MMMM")}.`

  // Convert client x-coord to a date on the timeline
  function xToDate(clientX: number): Date {
    if (!svgRef.current) return points[0].date
    const rect = svgRef.current.getBoundingClientRect()
    const svgX = ((clientX - rect.left) / rect.width) * totalW
    const ratio = Math.max(0, Math.min(1, (svgX - PAD.left) / CHART_W))
    return new Date(minTime + ratio * timeSpan)
  }

  function clientXToSvgX(clientX: number): number {
    if (!svgRef.current) return PAD.left
    const rect = svgRef.current.getBoundingClientRect()
    return ((clientX - rect.left) / rect.width) * totalW
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!onBrushSelect) return
    const svgX = clientXToSvgX(e.clientX)
    setBrushStart(svgX)
    setBrushEnd(svgX)
    setIsBrushing(true)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!isBrushing) return
    setBrushEnd(clientXToSvgX(e.clientX))
  }

  function handlePointerUp() {
    if (!isBrushing || brushStart === null || brushEnd === null) {
      setIsBrushing(false)
      return
    }
    setIsBrushing(false)

    const minX = Math.min(brushStart, brushEnd)
    const maxX = Math.max(brushStart, brushEnd)

    // Only trigger if brush is wide enough (> 10px in SVG coords)
    if (maxX - minX < 10) {
      setBrushStart(null)
      setBrushEnd(null)
      return
    }

    const fromDate = xToDate(
      svgRef.current!.getBoundingClientRect().left +
        (minX / totalW) * svgRef.current!.getBoundingClientRect().width
    )
    const toDate = xToDate(
      svgRef.current!.getBoundingClientRect().left +
        (maxX / totalW) * svgRef.current!.getBoundingClientRect().width
    )

    setBrushStart(null)
    setBrushEnd(null)

    if (fromDate.getTime() < toDate.getTime() && differenceInDays(toDate, fromDate) >= 5) {
      onBrushSelect?.({ from: fromDate, to: toDate })
    }
  }

  const brushX1 = brushStart !== null && brushEnd !== null ? Math.max(PAD.left, Math.min(brushStart, brushEnd)) : 0
  const brushX2 = brushStart !== null && brushEnd !== null ? Math.min(PAD.left + CHART_W, Math.max(brushStart, brushEnd)) : 0
  const showBrush = isBrushing && brushStart !== null && brushEnd !== null && Math.abs(brushEnd - brushStart) > 5

  return (
    <div ref={measure} className="w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${totalW} ${totalH}`}
        role="img"
        aria-label={chartLabel}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <defs>
          <linearGradient id="acct-balance-grad" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="hsl(var(--primary))"
              stopOpacity="0.25"
            />
            <stop
              offset="100%"
              stopColor="hsl(var(--primary))"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>

        {yTicks.map(({ value, y }, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              y1={y}
              x2={PAD.left + CHART_W}
              y2={y}
              strokeWidth={i === 0 ? 1 : 0.5}
              strokeDasharray={i > 0 ? "4 4" : undefined}
              className="stroke-border"
            />
            <text
              x={PAD.left - 6}
              y={y + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {abbreviate(value)}
            </text>
          </g>
        ))}

        <path d={fillPath} fill="url(#acct-balance-grad)" />

        <polyline
          points={polyline}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <circle
          cx={firstPoint.x}
          cy={firstPoint.y}
          r={3.5}
          className="fill-primary stroke-background"
          strokeWidth={2}
        />
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r={3.5}
          className="fill-primary stroke-background"
          strokeWidth={2}
        />

        {computeXTicks(points, Math.max(2, Math.floor(CHART_W / TICK_ROOM))).map((tick) => {
          const x = toX(tick.date)
          return (
            <text
              key={tick.label}
              x={x}
              y={totalH - 4}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {tick.label}
            </text>
          )
        })}

        {/* Brush overlay */}
        {showBrush && (
          <rect
            x={brushX1}
            y={PAD.top}
            width={brushX2 - brushX1}
            height={CHART_H}
            fill="hsl(var(--primary))"
            opacity={0.15}
            className="pointer-events-none"
          />
        )}

        {/* Invisible interaction area for brushing */}
        {onBrushSelect && (
          <rect
            x={PAD.left}
            y={PAD.top}
            width={CHART_W}
            height={CHART_H}
            fill="transparent"
            className="cursor-crosshair"
            style={{ touchAction: "none" }}
          />
        )}
      </svg>
    </div>
  )
}
