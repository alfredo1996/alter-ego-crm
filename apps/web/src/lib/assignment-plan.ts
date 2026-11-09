/**
 * The planned half of a collaborator on a contract: their days a month inside what the contract bills,
 * and what those cost. Pure plan, no logged hours, so the projection may import it.
 * Their days are part of the contract's days, never on top, and never past the days the contract
 * bills that month (so none after its end), all collaborators together.
 */

import type { Assignment, Collaborator } from "@/types"

export const round2 = (n: number) => Math.round(n * 100) / 100 + 0

/** The days planned for them in `yearMonth`: 0 outside from..until, else the month's override or the default. Not yet limited by the contract. */
export function assignedDays(a: Assignment, yearMonth: string): number {
  if (yearMonth < a.from || (a.until && yearMonth > a.until)) return 0
  return a.monthDays[yearMonth] ?? a.defaultDays
}

/**
 * The days each assignment counts in a contract month that bills `billableDays`, by assignment id.
 * They share what the contract bills: taken in order (created first, then id) until it is used up.
 */
export function countedDays(assignments: readonly Assignment[], yearMonth: string, billableDays: number): Map<string, number> {
  let left = Math.max(0, billableDays)
  const out = new Map<string, number>()
  const ordered = [...assignments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  for (const a of ordered) {
    const d = Math.min(assignedDays(a, yearMonth), left)
    left -= d
    out.set(a.id, d)
  }
  return out
}

/** The days an assignment counts in each month, given its contract's siblings: before `currentMonth` (no plan cells) its own days. */
export function countedIn(
  a: Assignment,
  siblings: readonly Assignment[],
  cells: ReadonlyMap<string, { billableDays: number }>,
  currentMonth: string,
): (yearMonth: string) => number {
  const group = siblings.some((s) => s.id === a.id) ? siblings : [...siblings, a]
  return (m) => (m < currentMonth ? assignedDays(a, m) : (countedDays(group, m, cells.get(`${a.engagementId}:${m}`)?.billableDays ?? 0).get(a.id) ?? 0))
}

/** The assignments that count in the plan: those of an active collaborator. */
export function liveAssignments(assignments: readonly Assignment[], collaborators: readonly Collaborator[]): Assignment[] {
  const active = new Set(collaborators.filter((c) => c.isActive).map((c) => c.id))
  return assignments.filter((a) => active.has(a.collaboratorId))
}

/** The assignments on one contract. */
export const onContract = (assignments: readonly Assignment[], engagementId: string) =>
  assignments.filter((a) => a.engagementId === engagementId)

/** Their planned days and cost in one contract month. */
export function plannedIn(
  assignments: readonly Assignment[],
  yearMonth: string,
  billableDays: number,
): { days: number; cost: number } {
  let days = 0
  let cost = 0
  const counted = countedDays(assignments, yearMonth, billableDays)
  for (const a of assignments) {
    const d = counted.get(a.id) ?? 0
    days += d
    cost += d * a.dailyRate
  }
  return { days: round2(days), cost: round2(cost) }
}

/** The owner's own planned days in a month: the contract's, less what the assignments take (never below 0). */
export function ownerDays(assignments: readonly Assignment[], yearMonth: string, plannedDays: number): number {
  return round2(Math.max(0, plannedDays) - plannedIn(assignments, yearMonth, plannedDays).days)
}

/** A margin over revenue as a whole percent; 0 with no revenue. */
export const marginPct = (margin: number, revenue: number) => (revenue > 0 ? Math.round((margin / revenue) * 100) : 0)

/**
 * Their planned days over `months`, inside what each contract bills (`cells` by `${engagementId}:${yearMonth}`),
 * what those days cost, and what the client is billed for them at `rate` (the contract's rate in the month).
 * `everyone` is all the assignments sharing those contracts (default: `assignments`), whose days come first in the cap.
 */
export function planOver(
  assignments: readonly Assignment[],
  cells: ReadonlyMap<string, { billableDays: number }>,
  months: readonly string[],
  rate: (a: Assignment, yearMonth: string) => number,
  everyone: readonly Assignment[] = assignments,
): { days: number; cost: number; billed: number } {
  let days = 0
  let cost = 0
  let billed = 0
  const engagementIds = new Set(assignments.map((a) => a.engagementId))
  for (const engagementId of engagementIds) {
    const group = onContract(everyone, engagementId)
    for (const m of months) {
      const counted = countedDays(group, m, cells.get(`${engagementId}:${m}`)?.billableDays ?? 0)
      for (const a of onContract(assignments, engagementId)) {
        const d = counted.get(a.id) ?? 0
        days += d
        cost += d * a.dailyRate
        billed += d * rate(a, m)
      }
    }
  }
  return { days: round2(days), cost: round2(cost), billed: round2(billed) }
}
