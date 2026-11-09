/** Pure lease logic: renewal, the year filter, grouping by property. Dates are "yyyy-MM-dd" strings. */
import { addDays, addYears, format, parseISO } from "date-fns"

import type { CreateLeaseInput, Lease } from "./types"

const iso = (d: Date) => format(d, "yyyy-MM-dd")

/** Cost centres are trimmed; so is a property, or "Via Roma " would make a second house. */
export const trimProperty = (name: string) => name.trim()

/** What a typed property saves as: an existing house's spelling when the name matches one ignoring case, else the trimmed name. */
export function canonicalProperty(typed: string, houses: string[]) {
  const name = trimProperty(typed)
  return houses.find((h) => h.toLowerCase() === name.toLowerCase()) ?? name
}

/** The lease after this one: the day after the end, a year long, same tenant, property and room, rent pre-filled. */
export function renewalOf(l: Lease): CreateLeaseInput {
  const start = addDays(parseISO(l.endDate), 1)
  return {
    tenantId: l.tenantId,
    property: l.property,
    room: l.room,
    rent: l.rent,
    contribution: l.contribution,
    paidBy: l.paidBy,
    startDate: iso(start),
    endDate: iso(addDays(addYears(start, 1), -1)),
  }
}

/** A lease shows in every year it was active, first and last day included. */
export const leasesInYear = (leases: Lease[], year: number) =>
  leases.filter((l) => l.startDate <= `${year}-12-31` && l.endDate >= `${year}-01-01`)

/** Rooms in natural order ("Room 2" before "Room 10"); a lease with no room sorts after the named ones. */
export const compareRooms = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, "en", { numeric: true })

export interface PropertyGroup {
  property: string
  leases: Lease[]
}

/** One block per trimmed property name, by name; leases by room, then start. */
export function groupByProperty(leases: Lease[]): PropertyGroup[] {
  const byName = new Map<string, Lease[]>()
  for (const l of leases) {
    const name = trimProperty(l.property)
    byName.set(name, [...(byName.get(name) ?? []), l])
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true })
  return [...byName]
    .sort(([a], [b]) => cmp(a, b))
    .map(([property, list]) => ({
      property,
      leases: list.sort((a, b) => compareRooms(a.room, b.room) || a.startDate.localeCompare(b.startDate)),
    }))
}

/** Why a last day cannot end this lease, or null. End Tenancy only moves the end earlier. */
export function endTenancyError(l: Lease, lastDay: string): string | null {
  if (!lastDay) return "Last day is required"
  if (lastDay < l.startDate) return "The last day cannot be before the lease starts"
  if (lastDay >= l.endDate) return "The last day must be before the lease ends"
  return null
}
