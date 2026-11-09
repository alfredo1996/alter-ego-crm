/**
 * A collaborator on a contract, the half that reads logged hours: margin of the months that have
 * ended, usage, the timecard ids. The planned half (days, cost, the cap) is in `assignment-plan`,
 * which the projection imports and which never touches timecards.
 */

import { assignedDays, plannedIn, round2 } from "@/lib/assignment-plan"
import { rateAt } from "@/lib/engagement-burndown"
import { hoursToDays } from "@/lib/engagements"

import type { Assignment, Engagement, Timecard } from "@/types"

export interface MarginRow {
  yearMonth: string
  /** Days the client is billed for: the plan, or the days logged once the month has ended. */
  days: number
  revenue: number
  /** Their days in it, and what those cost. */
  herDays: number
  cost: number
  margin: number
  /** The month has ended: its figures are the days logged. */
  logged: boolean
}

type LoggedHours = Pick<Timecard, "engagementId" | "collaboratorId" | "date" | "hours">

/**
 * A contract's margin month by month: revenue less the collaborators' cost. A month that has ended
 * uses the days logged (everyone's for the revenue, each assignment's own person for the cost, active
 * or not); the current and later months use the plan (`cells`, the burn-down's) of the `live` ones.
 * Then the total of the rows.
 */
export function marginTable(input: {
  engagement: Pick<Engagement, "id" | "dailyRate" | "amendments">
  /** Every assignment on the contract, active or not: a month that has ended costs all of them. */
  assignments: readonly Assignment[]
  /** The active collaborators' assignments: the only ones the planned months cost. */
  live?: readonly Assignment[]
  cells: ReadonlyMap<string, { billableDays: number }>
  timecards: readonly LoggedHours[]
  months: readonly string[]
  today: string
}): { rows: MarginRow[]; total: Omit<MarginRow, "yearMonth" | "logged"> } {
  const { engagement: e, today } = input
  const mine = input.assignments.filter((a) => a.engagementId === e.id)
  const planned = (input.live ?? input.assignments).filter((a) => a.engagementId === e.id)
  const rows = input.months.map((yearMonth): MarginRow => {
    const logged = yearMonth < today.slice(0, 7)
    const rate = rateAt(e, yearMonth)
    if (!logged) {
      const days = input.cells.get(yearMonth)?.billableDays ?? 0
      const her = plannedIn(planned, yearMonth, days)
      const revenue = round2(days * rate)
      return { yearMonth, days, revenue, herDays: her.days, cost: her.cost, margin: round2(revenue - her.cost), logged }
    }
    let hours = 0
    let herHours = 0
    let cost = 0
    for (const t of input.timecards) {
      if (t.engagementId !== e.id || t.date.slice(0, 7) !== yearMonth) continue
      hours += t.hours
      const a = t.collaboratorId ? mine.find((x) => x.collaboratorId === t.collaboratorId) : undefined
      if (a) {
        herHours += t.hours
        cost += hoursToDays(t.hours) * a.dailyRate
      }
    }
    const revenue = round2(hoursToDays(hours) * rate)
    return { yearMonth, days: round2(hoursToDays(hours)), revenue, herDays: round2(hoursToDays(herHours)), cost: round2(cost), margin: round2(revenue - cost), logged }
  })
  const sum = (f: (r: MarginRow) => number) => round2(rows.reduce((s, r) => s + f(r), 0))
  return {
    rows,
    total: { days: sum((r) => r.days), revenue: sum((r) => r.revenue), herDays: sum((r) => r.herDays), cost: sum((r) => r.cost), margin: sum((r) => r.margin) },
  }
}

/**
 * Days logged on a contract, unrounded: everyone's when `collaboratorId` is undefined, the owner's
 * own with null, one collaborator's with an id.
 */
export function loggedDays(
  timecards: readonly LoggedHours[],
  engagementId: string,
  collaboratorId?: string | null,
  range?: { from?: string; to?: string },
): number {
  return hoursToDays(
    timecards
      .filter(
        (t) =>
          t.engagementId === engagementId &&
          (collaboratorId === undefined || (t.collaboratorId ?? null) === collaboratorId) &&
          (!range?.from || t.date >= range.from) &&
          (!range?.to || t.date <= range.to),
      )
      .reduce((sum, t) => sum + t.hours, 0),
  )
}

export const COLLABORATOR_HAS_DAYS = "This collaborator has days logged: make them Inactive instead of deleting them."
export const ASSIGNMENT_EXISTS = "This collaborator is already assigned to this contract: edit that assignment instead."

/** An assignment's document id: one per collaborator per contract. */
export const assignmentId = (collaboratorId: string, engagementId: string) => `${collaboratorId}_${engagementId}`

export const ASSIGNMENT_HAS_DAYS = "This collaborator has days logged on this contract: set the assignment's Until instead of removing it."

/** A timecard's document id: the owner's keeps the old key, a collaborator's adds their id. */
export const timecardId = (engagementId: string, date: string, collaboratorId?: string | null) =>
  `${engagementId}_${date}${collaboratorId ? `_${collaboratorId}` : ""}`

/** The months of an assignment's run: from its start to its own until or the contract's end; null when neither ends. */
function runMonths(a: Assignment, endMonth: string | null): string[] | null {
  const last = [a.until, endMonth].filter((m): m is string => !!m).sort()[0]
  if (!last) return null
  const out: string[] = []
  for (let m = a.from; m <= last && out.length < 120; m = nextMonth(m)) out.push(m)
  return out
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number)
  const total = y * 12 + m
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`
}

export interface AssignmentUsage {
  /** Days planned over the whole run, and the days logged for them on the contract. null planned and left: neither the assignment nor the contract ends. */
  planned: number | null
  used: number
  left: number | null
  /** This month's days logged against this month's plan. */
  month: { used: number; planned: number }
  /** Months where more was logged than planned. */
  over: string[]
}

/**
 * What an assignment has used: their days logged on the contract against their planned days.
 * `planned(month)` is what counts that month (default: their own days; the caller passes the capped ones).
 */
export function assignmentUsage(
  a: Assignment,
  engagement: Pick<Engagement, "endMonth">,
  timecards: readonly LoggedHours[],
  today: string,
  planned: (yearMonth: string) => number = (m) => assignedDays(a, m),
): AssignmentUsage {
  const months = runMonths(a, engagement.endMonth ?? null)
  const total = months ? round2(months.reduce((s, m) => s + planned(m), 0)) : null
  const mine = timecards.filter((t) => t.engagementId === a.engagementId && t.collaboratorId === a.collaboratorId)
  const byMonth = new Map<string, number>()
  for (const t of mine) byMonth.set(t.date.slice(0, 7), (byMonth.get(t.date.slice(0, 7)) ?? 0) + t.hours)
  const used = round2(hoursToDays([...byMonth.values()].reduce((s, h) => s + h, 0)))
  const ym = today.slice(0, 7)
  return {
    planned: total,
    used,
    left: total === null ? null : round2(Math.max(0, total - used)),
    month: { used: round2(hoursToDays(byMonth.get(ym) ?? 0)), planned: planned(ym) },
    over: [...byMonth].filter(([m, h]) => hoursToDays(h) - planned(m) > 0.005).map(([m]) => m).sort(),
  }
}
