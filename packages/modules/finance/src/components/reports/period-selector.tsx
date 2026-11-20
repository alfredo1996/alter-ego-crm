"use client"


import { MonthStepper } from "@alter-ego/ui/page/month-stepper"
import { DateRangePicker } from "@alter-ego/ui/ui/date-range-picker"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alter-ego/ui/ui/select"
import { endOfMonth } from "date-fns"

import { periodLabel } from "../../hooks/use-reports"

import type { AnalysisPeriod } from "../../types"

interface PeriodSelectorProps {
  value: AnalysisPeriod
  onChange: (value: AnalysisPeriod) => void
}

function prevPeriod(period: AnalysisPeriod): AnalysisPeriod {
  if (period.mode === "monthly") {
    const m = period.month === 1 ? 12 : period.month - 1
    const y = period.month === 1 ? period.year - 1 : period.year
    return { mode: "monthly", year: y, month: m }
  }
  if (period.mode === "yearly") return { mode: "yearly", year: period.year - 1 }
  return period
}

function nextPeriod(period: AnalysisPeriod): AnalysisPeriod {
  if (period.mode === "monthly") {
    const m = period.month === 12 ? 1 : period.month + 1
    const y = period.month === 12 ? period.year + 1 : period.year
    return { mode: "monthly", year: y, month: m }
  }
  if (period.mode === "yearly") return { mode: "yearly", year: period.year + 1 }
  return period
}

function getModeKey(period: AnalysisPeriod): string {
  if (period.mode === "rolling") return `rolling-${period.months}`
  if (period.mode === "custom") return "custom"
  return period.mode
}

/** Nothing has happened in a month that has not begun: the stepper stops at this one. */
function isCurrent(period: AnalysisPeriod, now: Date): boolean {
  if (period.mode === "monthly") return period.year > now.getFullYear() || (period.year === now.getFullYear() && period.month >= now.getMonth() + 1)
  if (period.mode === "yearly") return period.year >= now.getFullYear()
  return false
}

/** The period type, then a 44px "‹ October 2026 ›" for a month or a year. */
export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const navigable = value.mode === "monthly" || value.mode === "yearly"
  const unit = value.mode === "yearly" ? "year" : "month"

  function handleModeChange(key: string) {
    const now = new Date()
    switch (key) {
      case "monthly":
        return onChange({ mode: "monthly", year: now.getFullYear(), month: now.getMonth() + 1 })
      case "yearly":
        return onChange({ mode: "yearly", year: now.getFullYear() })
      case "last12months":
        return onChange({ mode: "last12months" })
      case "rolling-3":
        return onChange({ mode: "rolling", months: 3 })
      case "rolling-6":
        return onChange({ mode: "rolling", months: 6 })
      case "rolling-12":
        return onChange({ mode: "rolling", months: 12 })
      case "custom": {
        const from = new Date(now.getFullYear(), now.getMonth(), 1)
        return onChange({ mode: "custom", from, to: endOfMonth(from) })
      }
    }
  }

  return (
    <div className="flex items-center gap-2.5 max-sm:w-full">
      <Select value={getModeKey(value)} onValueChange={handleModeChange}>
        <SelectTrigger aria-label="Period type" className="h-11 w-auto gap-2 px-3.5 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="monthly">Monthly</SelectItem>
          <SelectItem value="yearly">Yearly</SelectItem>
          <SelectItem value="last12months">Last 12 months</SelectItem>
          <SelectItem value="rolling-3">Last 3 months</SelectItem>
          <SelectItem value="rolling-6">Last 6 months</SelectItem>
          <SelectItem value="rolling-12">Rolling 12 months</SelectItem>
          <SelectItem value="custom">Custom range</SelectItem>
        </SelectContent>
      </Select>

      {value.mode === "custom" && (
        <DateRangePicker
          value={{ from: value.from, to: value.to }}
          onChange={(range) => {
            if (range?.from) {
              onChange({
                mode: "custom",
                from: range.from,
                to: range.to ? new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate(), 23, 59, 59) : range.from,
              })
            }
          }}
          placeholder="Select dates"
          className="h-11 w-[220px] max-sm:flex-1"
        />
      )}

      {navigable && (
        <MonthStepper
          className="max-sm:flex-1"
          groupLabel={value.mode === "yearly" ? "Year" : "Month"}
          label={periodLabel(value)}
          prev={() => onChange(prevPeriod(value))}
          next={isCurrent(value, new Date()) ? undefined : () => onChange(nextPeriod(value))}
          prevLabel={`Previous ${unit}, ${periodLabel(prevPeriod(value))}`}
          nextLabel={`Next ${unit}, ${periodLabel(nextPeriod(value))}`}
        />
      )}
    </div>
  )
}
