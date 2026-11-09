"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import { cn } from "@alter-ego/ui/utils"
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { Check, ChevronLeft, ChevronRight, CircleAlert } from "lucide-react"
import { useMemo, useState } from "react"


import type { CalendarItem, CalendarItemSource } from "@/lib/company-calendar"

/** Weeks start on Monday, as in Italy — the grid would be off by a day otherwise. */
const WEEK_OPTS = { weekStartsOn: 1 } as const

/** Chips beyond this are collapsed into "+N"; the day panel shows them all. */
const MAX_CHIPS = 3

/** Where an item comes from: the Source filter's words, and the calendar's dot colours. */
export const SOURCES: Record<CalendarItemSource, { label: string; dot: string }> = {
  manual: { label: "Yours", dot: "bg-foreground" },
  crm: { label: "Follow-ups", dot: "bg-warning" },
  invoice: { label: "Invoices", dot: "bg-success" },
  task: { label: "Tasks", dot: "bg-info" },
  milestone: { label: "Budgets", dot: "bg-violet-500" },
}

/**
 * Month grid over the same CalendarItem list the Deadlines list renders. Purely
 * presentational: picking a day hands the date back so the shell can list it
 * with the rows it already owns.
 */
export function CalendarMonth({
  items,
  today,
  selectedDate,
  onSelectDate,
}: {
  items: CalendarItem[]
  /** ISO "YYYY-MM-DD". */
  today: string
  selectedDate: string | null
  onSelectDate: (date: string) => void
}) {
  const [month, setMonth] = useState(() => startOfMonth(new Date(`${selectedDate ?? today}T00:00:00`)))

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>()
    for (const item of items) {
      const day = map.get(item.date)
      if (day) day.push(item)
      else map.set(item.date, [item])
    }
    return map
  }, [items])

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), WEEK_OPTS),
        end: endOfWeek(endOfMonth(month), WEEK_OPTS),
      }),
    [month],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-lg font-semibold tracking-tight">{format(month, "MMMM yyyy")}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => {
            const now = new Date(`${today}T00:00:00`)
            setMonth(startOfMonth(now))
            onSelectDate(today)
          }}
        >
          Today
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.slice(0, 7).map((day) => (
          <div
            key={`head-${isoDate(day)}`}
            className="pb-1 text-center text-xs font-medium uppercase text-muted-foreground"
          >
            {format(day, "EEEEEE")}
          </div>
        ))}

        {days.map((day) => {
          const date = isoDate(day)
          const dayItems = byDate.get(date) ?? []
          const overdueCount = dayItems.filter((i) => !i.isDone && i.date < today).length
          const outside = !isSameMonth(day, month)
          return (
            <button
              key={date}
              type="button"
              aria-label={`${format(day, "d MMMM yyyy")}, ${dayItems.length} ${dayItems.length === 1 ? "item" : "items"}${
                overdueCount ? `, ${overdueCount} overdue` : ""
              }`}
              aria-pressed={selectedDate === date}
              onClick={() => onSelectDate(date)}
              className={cn(
                // Never faded: another month's days are told apart by their muted number and fill.
                "flex min-h-12 min-w-0 flex-col gap-1 rounded-lg border border-hairline bg-card p-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:min-h-24 sm:p-1.5",
                outside && "bg-surface-subtle",
                date === today && "border-foreground",
                selectedDate === date && "ring-2 ring-foreground",
              )}
            >
              <span
                className={cn(
                  "text-xs tabular-nums",
                  date === today ? "font-semibold text-foreground" : outside ? "text-muted-foreground" : "text-subtle-foreground",
                )}
              >
                {format(day, "d")}
              </span>

              {/* A phone has room for a dot per item, coloured by source (the legend below); sm up, the
                  title beside its dot, two lines at most. Done and overdue are shapes, never colour alone. */}
              <span className="flex flex-wrap gap-0.5 sm:flex-col sm:flex-nowrap sm:gap-1">
                {dayItems.slice(0, MAX_CHIPS).map((item, i) => {
                  const overdue = !item.isDone && item.date < today
                  return (
                    <span key={`${date}-${i}`} title={item.label} className="flex min-w-0 items-start gap-1">
                      {item.isDone ? (
                        <Check aria-hidden className="mt-px size-2.5 shrink-0 text-muted-foreground max-sm:hidden" />
                      ) : overdue ? (
                        <CircleAlert aria-hidden className="mt-px size-2.5 shrink-0 text-danger max-sm:hidden" />
                      ) : null}
                      <span
                        aria-hidden
                        className={cn(
                          "mt-[3px] size-1.5 shrink-0 rounded-full",
                          SOURCES[item.source].dot,
                          (item.isDone || overdue) && "sm:hidden",
                          item.isDone && "max-sm:bg-transparent max-sm:ring-1 max-sm:ring-muted-foreground max-sm:ring-inset",
                        )}
                      />
                      <span
                        className={cn(
                          "hidden text-[11px] leading-[14px] sm:line-clamp-2",
                          item.isDone ? "text-muted-foreground" : "text-foreground",
                        )}
                      >
                        {item.label}
                      </span>
                    </span>
                  )
                })}
              </span>

              {dayItems.length > MAX_CHIPS && (
                <span className="text-[10px] text-muted-foreground sm:text-[11px]">+{dayItems.length - MAX_CHIPS}</span>
              )}
            </button>
          )
        })}
      </div>

      <ul aria-label="Sources" className="flex flex-wrap gap-x-4 gap-y-1.5 text-meta text-subtle-foreground">
        {Object.values(SOURCES).map((s) => (
          <li key={s.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-full", s.dot)} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
