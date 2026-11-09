import { parseYearMonth, weekdaysInMonth } from "@alter-ego/kernel/dates"
import { addMonths, differenceInCalendarMonths, format } from "date-fns"

import { liveAssignments, onContract, plannedIn } from "@/lib/assignment-plan"
import { resolveAllocationGrid, toRevenueSources } from "@/lib/engagement-burndown"

import type { Allocation, Assignment, CapacityDoc, Collaborator, Engagement } from "@/types"

/**
 * The owner's days: what a month holds (weekdays less time off) against what the contracts plan.
 * One calculation for the Plan page and the connector's capacity tools (the MCP helpers import it).
 */

const round2 = (n: number) => Math.round(n * 100) / 100 + 0

export type CapacityMonth = {
  yearMonth: string
  availableDays: number
  daysOff: number
  reason: NonNullable<CapacityDoc["reason"]> | null
  note: string | null
  allocatedDays: number
  remaining: number
  overbooked: boolean
}

const LEGACY_REASON: Record<string, CapacityDoc["reason"]> = { ferie: "vacation", formazione: "training", altro: "other" }

/** A stored record as the app reads it. Docs written before the reasons were English say "ferie"; the next write fixes them. */
export function readCapacityDoc(data: Record<string, unknown>): CapacityDoc {
  return {
    yearMonth: data.yearMonth as string,
    daysOff: data.daysOff as number,
    availableDays: data.availableDays as number,
    ...(data.reason != null && { reason: LEGACY_REASON[data.reason as string] ?? (data.reason as NonNullable<CapacityDoc["reason"]>) }),
    note: (data.note as string | null) ?? null,
  }
}

/** What a month's time off record holds: the days, with the available days derived and the reason kept. */
export function timeOffDoc(input: {
  yearMonth: string
  daysOff: number
  reason?: CapacityDoc["reason"]
  note?: string | null
  /** The month's record as stored: its reason and note stay when only the days change. */
  prev?: Pick<CapacityDoc, "reason" | "note"> | null
}): CapacityDoc {
  const weekdays = weekdaysInMonth(input.yearMonth)
  const daysOff = Math.max(0, Math.min(weekdays, input.daysOff))
  const reason = input.reason ?? input.prev?.reason
  return {
    yearMonth: input.yearMonth,
    daysOff,
    availableDays: weekdays - daysOff,
    ...(reason && { reason }),
    note: input.note ?? input.prev?.note ?? null,
  }
}

/** A month's load in words: "5 over", "full" or "2 free" (colour is never the only signal). */
export function loadWord(planned: number, available: number): { kind: "over" | "full" | "free"; text: string } {
  const gap = round2(planned - available)
  if (gap > 0) return { kind: "over", text: `${gap} over` }
  if (gap === 0) return { kind: "full", text: "full" }
  return { kind: "free", text: `${-gap} free` }
}

/**
 * Workload per month, read off the plan's grid (#159), over the same contracts as
 * toRevenueSources. A stored row counts as typed — work on the calendar, even past the
 * budget or the end month. A month with no row counts the default days the plan still
 * bills, so a spent or ended contract stops taking capacity.
 *
 * `allocations` must hold EVERY row, not the months': the budget burns from each
 * contract's start (#155), and without the earlier rows it looks untouched. One walk
 * for all the months, from the Plan's origin.
 */
function allocatedDays(
  engagements: Engagement[],
  allocations: Allocation[],
  from: string,
  months: number,
  people: { collaborators?: Collaborator[]; assignments?: Assignment[] } = {},
) {
  // The owner's own load: the contract's days less what the active collaborators count in them (the Plan's "you" row).
  const live = liveAssignments(people.assignments ?? [], people.collaborators ?? [])
  const sources = toRevenueSources({ engagements, opportunities: [], clients: [], scenario: "committed" })
  const stored = new Set(allocations.map((a) => `${a.engagementId}:${a.yearMonth}`))
  // Walked from this month when the window starts later: the Plan's origin (a contract with no start
  // and no row before the walk would otherwise get a fresh budget in every future month, #159).
  const thisMonth = format(new Date(), "yyyy-MM")
  const origin = from < thisMonth ? from : thisMonth
  const last = format(addMonths(parseYearMonth(from), months - 1), "yyyy-MM")
  const cells = resolveAllocationGrid({
    sources,
    allocations,
    fromMonth: origin,
    months: differenceInCalendarMonths(parseYearMonth(last), parseYearMonth(origin)) + 1,
  }).filter((c) => c.yearMonth >= from)
  const byMonth = new Map<string, number>()
  for (const c of cells) {
    const days = stored.has(`${c.sourceId}:${c.yearMonth}`) ? c.plannedDays : c.billableDays
    const theirs = plannedIn(onContract(live, c.sourceId), c.yearMonth, c.billableDays).days
    byMonth.set(c.yearMonth, round2((byMonth.get(c.yearMonth) ?? 0) + Math.max(0, days - theirs)))
  }
  return byMonth
}

export function allocatedDaysForMonth(engagements: Engagement[], allocations: Allocation[], yearMonth: string): number {
  return allocatedDays(engagements, allocations, yearMonth, 1).get(yearMonth) ?? 0
}

export function capacityForMonths(input: {
  engagements: Engagement[]
  allocations: Allocation[]
  capacityDocs: CapacityDoc[]
  from: string
  months: number
  /** Whose days are in the contracts' days: left out, everything counts as the owner's. */
  collaborators?: Collaborator[]
  assignments?: Assignment[]
}): CapacityMonth[] {
  const docs = new Map(input.capacityDocs.map((d) => [d.yearMonth, d]))
  const allocated = allocatedDays(input.engagements, input.allocations, input.from, input.months, input)
  return Array.from({ length: input.months }, (_, i) => {
    const yearMonth = format(addMonths(parseYearMonth(input.from), i), "yyyy-MM")
    const doc = docs.get(yearMonth)
    // Derived, never read from the stored pair: the app and the connector both write daysOff.
    const daysOff = doc?.daysOff ?? 0
    const availableDays = Math.max(0, weekdaysInMonth(yearMonth) - daysOff)
    const allocatedDays = allocated.get(yearMonth) ?? 0
    return {
      yearMonth,
      availableDays,
      daysOff,
      reason: doc?.reason ?? null,
      note: doc?.note ?? null,
      allocatedDays,
      remaining: availableDays - allocatedDays,
      overbooked: allocatedDays > availableDays,
    }
  })
}
