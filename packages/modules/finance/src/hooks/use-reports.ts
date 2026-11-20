"use client"

import {
  getLastNMonthsRange,
  type DateRange,
} from "@alter-ego/kernel/dates"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import {
  addMonths,
  endOfYear,
  endOfMonth,
  startOfMonth,
  format as formatDate,
  subMonths,
  differenceInDays,
  getDaysInMonth,
} from "date-fns"

import { getBackend } from "../host"

import type { AnalysisPeriod, MonthlySummary } from "../types"

export function analysisPeriodToDateRange(period: AnalysisPeriod): DateRange {
  const now = new Date()
  switch (period.mode) {
    case "monthly": {
      const start = new Date(period.year, period.month - 1, 1)
      return { from: start, to: endOfMonth(start) }
    }
    case "yearly": {
      const start = new Date(period.year, 0, 1)
      return { from: start, to: endOfYear(start) }
    }
    case "last12months":
      return getLastNMonthsRange(12, now)
    case "rolling":
      return getLastNMonthsRange(period.months, now)
    case "custom":
      return { from: period.from, to: period.to }
  }
}

export function defaultAnalysisPeriod(): AnalysisPeriod {
  const now = new Date()
  return { mode: "monthly", year: now.getFullYear(), month: now.getMonth() + 1 }
}

export interface ReportFilters {
  accountIds?: string[]
  categoryIds?: string[]
}

export function useReports(
  userId: string | undefined,
  period: AnalysisPeriod,
  filters?: ReportFilters
) {
  const dateRange = analysisPeriodToDateRange(period)

  return useQuery({
    queryKey: ["reports", userId, period, filters],
    queryFn: () => getBackend().db.getReportData(userId!, dateRange, filters),
    enabled: !!userId,
    placeholderData: keepPreviousData,
  })
}

/** Backwards-compatible helper for the old ReportPeriod string union. */
export function legacyPeriodToAnalysis(period: string): AnalysisPeriod {
  const now = new Date()
  switch (period) {
    case "this-month":
      return { mode: "monthly", year: now.getFullYear(), month: now.getMonth() + 1 }
    case "last-month": {
      const d = subMonths(now, 1)
      return { mode: "monthly", year: d.getFullYear(), month: d.getMonth() + 1 }
    }
    case "last-3-months":
      return { mode: "rolling", months: 3 }
    case "last-6-months":
      return { mode: "rolling", months: 6 }
    case "this-year":
      return { mode: "yearly", year: now.getFullYear() }
    default:
      return defaultAnalysisPeriod()
  }
}

export type ComparisonMode = "previous" | "year-ago" | "none"

/** Get the previous period for comparison */
export function getPreviousPeriod(period: AnalysisPeriod, mode: ComparisonMode): AnalysisPeriod | null {
  if (mode === "none") return null

  if (mode === "year-ago") {
    if (period.mode === "monthly") {
      return { mode: "monthly", year: period.year - 1, month: period.month }
    }
    if (period.mode === "yearly") {
      return { mode: "yearly", year: period.year - 1 }
    }
    // For rolling/last12, year-ago doesn't make sense
    return null
  }

  // mode === "previous"
  if (period.mode === "monthly") {
    const d = subMonths(new Date(period.year, period.month - 1, 1), 1)
    return { mode: "monthly", year: d.getFullYear(), month: d.getMonth() + 1 }
  }
  if (period.mode === "yearly") {
    return { mode: "yearly", year: period.year - 1 }
  }
  if (period.mode === "rolling") {
    const range = analysisPeriodToDateRange(period)
    const days = differenceInDays(range.to, range.from)
    const from = new Date(range.from)
    from.setDate(from.getDate() - days - 1)
    const to = new Date(range.from)
    to.setDate(to.getDate() - 1)
    to.setHours(23, 59, 59)
    return { mode: "rolling", months: period.months }
  }
  return null
}

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** "October 2026", "2026", "the last 12 months": what a period is called in a sentence. */
export function periodLabel(period: AnalysisPeriod): string {
  switch (period.mode) {
    case "monthly":
      return `${FULL_MONTHS[period.month - 1]} ${period.year}`
    case "yearly":
      return String(period.year)
    case "last12months":
      return "the last 12 months"
    case "rolling":
      return `the last ${period.months} months`
    case "custom":
      return `${formatDate(period.from, "d MMM yyyy")} to ${formatDate(period.to, "d MMM yyyy")}`
  }
}

/** "October so far" for a month still running, "September 2026" for one that is over: the In and Out eyebrow. */
export function periodEyebrow(period: AnalysisPeriod, now: Date = new Date()): string {
  const running =
    (period.mode === "monthly" && period.year === now.getFullYear() && period.month === now.getMonth() + 1) ||
    (period.mode === "yearly" && period.year === now.getFullYear())
  if (period.mode === "monthly") return running ? `${FULL_MONTHS[period.month - 1]} so far` : periodLabel(period)
  if (period.mode === "yearly") return running ? `${period.year} so far` : String(period.year)
  const label = periodLabel(period)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** A month is drawn with the three before it: one bar is not a trend. */
const TREND_MONTHS = 4

/** What the In and Out chart reads: a month's own report holds one month, so it asks for its trailing window. */
export function trendPeriod(period: AnalysisPeriod): AnalysisPeriod {
  if (period.mode !== "monthly") return period
  return {
    mode: "custom",
    from: new Date(period.year, period.month - TREND_MONTHS, 1),
    to: endOfMonth(new Date(period.year, period.month - 1, 1)),
  }
}

/** Every month the chart has a column for ("2026-07"), up to today: a month with no transactions still gets one. */
export function trendMonths(period: AnalysisPeriod, now: Date = new Date()): string[] {
  const { from, to } = analysisPeriodToDateRange(trendPeriod(period))
  const last = to > now ? now : to
  const months: string[] = []
  for (let d = startOfMonth(from); d <= last; d = addMonths(d, 1)) months.push(formatDate(d, "yyyy-MM"))
  return months
}

/** `months` in order, each with its summary or zeros. */
export function fillMonths(summary: MonthlySummary[], months: string[]): MonthlySummary[] {
  const byMonth = new Map(summary.map((m) => [m.month, m]))
  return months.map((month) => byMonth.get(month) ?? { month, income: 0, expenses: 0, net: 0 })
}

/** The line under the Reports title, following the period. */
export function periodSubtitle(period: AnalysisPeriod): string {
  const label = periodLabel(period)
  return period.mode === "custom" ? `Where your money went from ${label}` : `Where your money went in ${label}`
}

/**
 * What to compare a period with. A month or year still running is set against the same stretch of the
 * one before ("by 15 September"), not its whole length: October so far against all of September would
 * read as a saving that is only the calendar.
 */
export function getComparisonPeriod(
  period: AnalysisPeriod,
  mode: ComparisonMode,
  now: Date = new Date(),
): { period: AnalysisPeriod; label: string } | null {
  const prev = getPreviousPeriod(period, mode)
  if (!prev) return null
  const running =
    (period.mode === "monthly" && period.year === now.getFullYear() && period.month === now.getMonth() + 1) ||
    (period.mode === "yearly" && period.year === now.getFullYear())
  if (!running || (prev.mode !== "monthly" && prev.mode !== "yearly")) {
    return { period: prev, label: periodLabel(prev) }
  }
  const month = prev.mode === "monthly" ? prev.month - 1 : now.getMonth()
  const from = new Date(prev.year, prev.mode === "monthly" ? month : 0, 1)
  const day = Math.min(now.getDate(), getDaysInMonth(new Date(prev.year, month, 1)))
  const to = new Date(prev.year, month, day, 23, 59, 59)
  const label = `by ${formatDate(to, "d MMMM")}${prev.year === now.getFullYear() ? "" : ` ${prev.year}`}`
  return { period: { mode: "custom", from, to }, label }
}

/** "€94.10 less than September 2026": how a figure moved since the comparison period. */
export function deltaText(current: number, previous: number, since: string, format: (n: number) => string): string {
  if (previous === 0) return "No prior data"
  const diff = current - previous
  if (Math.abs(diff) < 0.005) return `Same as ${since}`
  return `${format(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${since}`
}

/** The sentence under Net: what the period left, in words that fit a negative net too. */
export function netDetail(income: number, expenses: number, format: (n: number) => string): string {
  const net = income - expenses
  if (income === 0 && expenses === 0) return "Nothing recorded in this period"
  if (net < 0) return `Spent ${format(-net)} more than earned`
  return `You kept ${income > 0 ? ((net / income) * 100).toFixed(1) : "0.0"}% of what came in`
}

/** Only a month or a year has a period before it, and a year has no "same month last year". */
export function effectiveComparisonMode(period: AnalysisPeriod, picked: ComparisonMode): ComparisonMode {
  if (period.mode !== "monthly" && period.mode !== "yearly") return "none"
  return period.mode === "yearly" && picked === "year-ago" ? "previous" : picked
}

/** Hook to fetch comparison report data */
export function useReportComparison(
  userId: string | undefined,
  currentPeriod: AnalysisPeriod,
  comparisonMode: ComparisonMode,
  filters?: ReportFilters
) {
  const comparisonPeriod = getComparisonPeriod(currentPeriod, comparisonMode)?.period ?? null
  const dateRange = comparisonPeriod ? analysisPeriodToDateRange(comparisonPeriod) : null

  return useQuery({
    queryKey: ["reports-comparison", userId, comparisonPeriod, filters],
    queryFn: () => getBackend().db.getReportData(userId!, dateRange!, filters),
    enabled: !!userId && !!dateRange && comparisonMode !== "none",
    placeholderData: keepPreviousData,
  })
}

/** Serialize an AnalysisPeriod to URL search params */
export function serializePeriod(period: AnalysisPeriod): Record<string, string> {
  switch (period.mode) {
    case "monthly":
      return { p: "monthly", y: String(period.year), m: String(period.month) }
    case "yearly":
      return { p: "yearly", y: String(period.year) }
    case "last12months":
      return { p: "last12" }
    case "rolling":
      return { p: "rolling", n: String(period.months) }
    case "custom":
      return { p: "custom", f: formatDate(period.from, "yyyy-MM-dd"), t: formatDate(period.to, "yyyy-MM-dd") }
  }
}

/** Deserialize URL search params to an AnalysisPeriod (falls back to current month) */
export function deserializePeriod(params: URLSearchParams): AnalysisPeriod {
  const p = params.get("p")
  const y = Number(params.get("y"))
  const m = Number(params.get("m"))
  const n = Number(params.get("n"))
  const now = new Date()

  switch (p) {
    case "monthly":
      if (y > 2000 && m >= 1 && m <= 12) return { mode: "monthly", year: y, month: m }
      return { mode: "monthly", year: now.getFullYear(), month: now.getMonth() + 1 }
    case "yearly":
      if (y > 2000) return { mode: "yearly", year: y }
      return { mode: "yearly", year: now.getFullYear() }
    case "last12":
      return { mode: "last12months" }
    case "rolling":
      if (n === 3 || n === 6 || n === 12) return { mode: "rolling", months: n }
      return { mode: "rolling", months: 6 }
    case "custom": {
      const f = params.get("f")
      const t = params.get("t")
      if (f && t) {
        const from = new Date(f + "T00:00:00")
        const to = new Date(t + "T23:59:59")
        if (!isNaN(from.getTime()) && !isNaN(to.getTime())) return { mode: "custom", from, to }
      }
      return { mode: "monthly", year: now.getFullYear(), month: now.getMonth() + 1 }
    }
    default:
      return { mode: "monthly", year: now.getFullYear(), month: now.getMonth() + 1 }
  }
}
