/** What a tenant or a lease still lacks, in words. A detail is optional to save and shown as "not set" until it is known. */
import type { Lease, Tenant } from "./types"

type TenantDetails = Pick<Tenant, "taxId" | "street" | "postcode" | "city" | "country">

/**
 * The tenant's missing invoice details, in the order the page prints them. A half-filled address is still
 * "residence": it is incomplete for an invoice. Province never counts, it is optional by nature.
 */
export function tenantNotSet(t: TenantDetails): ("tax ID" | "residence")[] {
  const out: ("tax ID" | "residence")[] = []
  if (!t.taxId) out.push("tax ID")
  if (!t.street || !t.postcode || !t.city || !t.country) out.push("residence")
  return out
}

/** The lease's room first, then the tenant's details. */
export const leaseNotSet = (l: Pick<Lease, "room">, t: TenantDetails | undefined): string[] => [...(l.room ? [] : ["room"]), ...(t ? tenantNotSet(t) : [])]

/** "Not set: room, tax ID", or null when nothing is missing. */
export const notSetLine = (items: string[]) => (items.length ? `Not set: ${items.join(", ")}` : null)

/** "Tax ID and residence not set" for the lease dialog's Edit Tenant link; null when nothing is missing. */
export function notSetWords(items: string[]): string | null {
  if (!items.length) return null
  const [first, ...rest] = items
  const list = rest.length ? `${[first, ...rest.slice(0, -1)].join(", ")} and ${rest[rest.length - 1]}` : first
  return `${list[0].toUpperCase()}${list.slice(1)} not set`
}

/** " · Room 2" for a room, "" for none: the joiner of subtitles and labels that must never print null. */
export const roomPart = (room: string | null | undefined, sep = " · ") => (room ? `${sep}${room}` : "")

/** A house header's room count: "2 rooms, 1 not set", "rooms not set", "1 room". Only rooms that are set are counted; a tenant with no room counts once. */
export function roomsText(leases: Pick<Lease, "tenantId" | "room">[]): string {
  const rooms = new Set(leases.flatMap((l) => (l.room ? [l.room] : [])))
  const unset = new Set(leases.filter((l) => !l.room).map((l) => l.tenantId)).size
  if (rooms.size === 0) return leases.length === 1 ? "room not set" : "rooms not set"
  return `${rooms.size === 1 ? "1 room" : `${rooms.size} rooms`}${unset ? `, ${unset} not set` : ""}`
}
