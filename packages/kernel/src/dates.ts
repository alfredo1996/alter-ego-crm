import {
  startOfMonth,
  endOfMonth,
  subMonths,
  format,
  startOfDay,
  endOfDay,
} from "date-fns"

export interface DateRange {
  from: Date
  to: Date
}

export function getCurrentMonthRange(now: Date = new Date()): DateRange {
  return {
    from: startOfMonth(now),
    to: endOfMonth(now),
  }
}

export function getLastNMonthsRange(n: number, now: Date = new Date()): DateRange {
  return {
    from: startOfMonth(subMonths(now, n - 1)),
    to: endOfMonth(now),
  }
}

/** Days left in the month `now` falls in, today included (the last day has 1). */
export function daysLeftInMonth(now: Date = new Date()): number {
  return endOfMonth(now).getDate() - now.getDate() + 1
}

export function getDayRange(date: Date): DateRange {
  return {
    from: startOfDay(date),
    to: endOfDay(date),
  }
}

export function formatDate(date: Date, pattern: string = "MMM d, yyyy"): string {
  return format(date, pattern)
}

export function formatMonthYear(date: Date): string {
  return format(date, "MMMM yyyy")
}

/** "13 Oct" this year, "13 Oct 2024" any other year. */
export function formatShortDate(date: Date, now: Date = new Date()): string {
  return format(date, date.getFullYear() === now.getFullYear() ? "d MMM" : "d MMM yyyy")
}

/** Parse the "YYYY-MM" the company plan uses for months into a local Date. */
export function parseYearMonth(yearMonth: string): Date {
  const [year, month] = yearMonth.split("-").map(Number)
  return new Date(year, month - 1, 1)
}

/** Render a "YYYY-MM" the company plan uses, "August 2026" by default. `formatMonthYear` takes a Date. */
export function formatYearMonth(yearMonth: string, pattern = "MMMM yyyy"): string {
  return format(parseYearMonth(yearMonth), pattern)
}

/** Mon–Fri count for a month — the default working capacity when no doc overrides it. */
export function weekdaysInMonth(yearMonth: string): number {
  const year = Number(yearMonth.slice(0, 4))
  const month = Number(yearMonth.slice(5, 7))
  let count = 0
  for (let day = new Date(year, month - 1, 1); day.getMonth() === month - 1; day.setDate(day.getDate() + 1)) {
    const dow = day.getDay()
    if (dow >= 1 && dow <= 5) count++
  }
  return count
}

/** Advance a date by the given interval according to the recurrence frequency. */
export function advanceDate(date: Date, frequency: string, interval: number): Date {
  const d = new Date(date)
  switch (frequency) {
    case "daily":
      d.setDate(d.getDate() + interval)
      break
    case "weekly":
      d.setDate(d.getDate() + interval * 7)
      break
    case "monthly":
      d.setMonth(d.getMonth() + interval)
      break
    case "yearly":
      d.setFullYear(d.getFullYear() + interval)
      break
  }
  return d
}

/**
 * "YYYY-MM-DD" from a Date's *local* components — the value shape
 * `<input type="date">` expects.
 *
 * Deliberately not `toISOString().slice(0, 10)`: dates here are stored as local
 * midnight, which serialises to the previous day at any positive UTC offset
 * (Europe/Rome included), so a date saved as 1 March would render as 28 February.
 */
export function isoDate(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

/** The calendar day of an instant in Rome, whatever zone the process runs in ("YYYY-MM-DD"). */
export function isoDateInRome(date: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}

/**
 * Makes "local" on the server mean what it means in the browser that wrote the
 * date. Stored dates are instants at the writer's local midnight, so a server
 * left in UTC (App Hosting, Docker) reads 04/09 written in Rome — 03/09 22:00Z —
 * as 3 September: every `isoDate`, day window and month bound drifts a day.
 *
 * Called once from each server entry point, never per caller. An explicit TZ wins.
 */
// ponytail: one zone per deployment; a per-user timezone setting is the upgrade
// path if users outside it ever share a server.
export function pinServerTimeZone(): void {
  process.env.TZ ||= "Europe/Rome"
}

/** The three "YYYY-MM" months of a calendar quarter (q is 1 to 4). */
export function quarterMonths(year: number, q: 1 | 2 | 3 | 4): string[] {
  return [0, 1, 2].map((i) => `${year}-${String((q - 1) * 3 + i + 1).padStart(2, "0")}`)
}
