/**
 * Pure rent logic: what each month of a lease is, from the leases, the payments and the
 * offsets. The page and the MCP tools read it. Months are "YYYY-MM", days "yyyy-MM-dd".
 *
 * The package declares the few fields it reads of the cash book as its own structural
 * types; the app's records fit them without an import.
 */
import { compareRooms } from "./lease"

import type { AgreedMonth, Lease } from "./types"

export type RentPart = "rent" | "contribution"

/** An income movement of the cash book, as far as rent reads it. */
export interface RentMovement {
  id: string
  leaseId?: string | null
  rentMonth?: string | null
  rentPart?: RentPart | null
  amount: number
  documentRef?: string | null
  date: Date
  /** The cash book's kind and direction: a deposit is `deposit_held`, in when received and out when given back. */
  kind?: string | null
  direction?: string | null
  accountId?: string | null
  /** Whose deposit it is, as the cash book names it (Owed & Held groups by this). */
  counterparty?: string | null
}

/** A cost of the cash book. A rent offset is one with a leaseId and a month (`forMonth`). */
export interface RentCost {
  id: string
  leaseId?: string | null
  forMonth?: string | null
  amount: number
}

export interface RentData {
  movements: readonly RentMovement[]
  costs: readonly RentCost[]
}

export type CellStatus = "paid" | "partial" | "missing" | "not-yet" | "due-later" | "outside"

export interface Cell {
  /** The lease the month belongs to: after a renewal, a row's cells come from different leases. */
  leaseId: string
  status: CellStatus
  /** Rent + contribution, or the agreed amount. */
  due: number
  /** What the month's payments add up to. */
  paid: number
  /** The offset costs linked to this month: shown beside Paid, never added to it (the full payment is recorded too). */
  offset: number
  /** Owed to date: the shortfall of a month that has ended. 0 for the current month and later ones. */
  owed: number
  agreed: AgreedMonth | null
  /** Every payment of a paid month has an invoice number. Meaningful for Paid only. */
  invoiced: boolean
  payments: RentMovement[]
}

const round2 = (n: number) => Math.round(n * 100) / 100 + 0

/** "2026-09" from a day. */
export const monthOf = (day: string) => day.slice(0, 7)

/** The agreed months without one. */
export const withoutMonth = <T,>(agreed: Record<string, T>, month: string): Record<string, T> =>
  Object.fromEntries(Object.entries(agreed).filter(([m]) => m !== month))

/** The twelve months of a year. */
export const monthsOfYear = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`)

/** What a lease asks for in a month: the agreed amount, else rent + contribution. */
export const dueIn = (l: Lease, month: string) => l.agreedMonths[month]?.amount ?? round2(l.rent + (l.contribution ?? 0))

/** A lease runs in every month it has a day in. */
export const runsIn = (l: Lease, month: string) => monthOf(l.startDate) <= month && month <= monthOf(l.endDate)

/** The months from one to another, both included ("YYYY-MM"). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let y = Number(from.slice(0, 4)), m = Number(from.slice(5)); `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? (y++, (m = 1)) : m++) out.push(`${y}-${String(m).padStart(2, "0")}`)
  return out
}

/**
 * One month of a lease. `family` is every lease of the row (same tenant and room): a renewal that starts
 * mid-month shares its first month with the old lease, so payments, offsets and an agreed amount count across all of them.
 */
export function cellOf(l: Lease, month: string, data: RentData, today: string, family: readonly Lease[] = [l]): Cell {
  const ids = new Set([l.id, ...family.map((x) => x.id)])
  const agreed = [l, ...family].find((x) => x.agreedMonths[month])?.agreedMonths[month] ?? null
  const due = agreed?.amount ?? dueIn(l, month)
  if (!runsIn(l, month)) return { leaseId: l.id, status: "outside", due, paid: 0, offset: 0, owed: 0, agreed, invoiced: true, payments: [] }

  const payments = data.movements.filter((m) => m.leaseId && ids.has(m.leaseId) && m.rentMonth === month && m.rentPart)
  const paid = round2(payments.reduce((s, m) => s + m.amount, 0))
  const offset = round2(data.costs.filter((c) => c.leaseId && ids.has(c.leaseId) && c.forMonth === month).reduce((s, c) => s + c.amount, 0))
  const now = monthOf(today)
  const invoiced = payments.every((m) => !!m.documentRef?.trim())
  const short = round2(due - paid)

  let status: CellStatus
  if (paid >= due) status = "paid"
  else if (paid > 0) status = "partial"
  else if (month > now) status = "due-later"
  else status = month === now ? "not-yet" : "missing"
  return { leaseId: l.id, status, due, paid, offset, owed: month < now && short > 0 ? short : 0, agreed, invoiced, payments }
}

export interface GridRow {
  key: string
  tenantId: string
  room: string | null
  /** The lease in force latest in the year: its rent, contribution and payer head the row. */
  lease: Lease
  cells: Record<string, Cell>
  /** Missing plus shortfalls to date. */
  owed: number
  /** The months behind Owed, from the row's first lease: not only the year shown. */
  missed: { month: string; owed: number }[]
  /** The deposit held for the row (once, across renewals); null when none was recorded. */
  deposit: number | null
}

export interface Footer {
  due: number
  paid: number
  owed: number
  /** The current month's unpaid part: kept apart from Owed until the month ends. */
  notYet: number
}

export interface Grid {
  rows: GridRow[]
  /** The months to show: the year from the month of its first lease. */
  months: string[]
  /** How many months at the start of the year are hidden because no lease ran. */
  hiddenBefore: number
  footer: Record<string, Footer>
  owed: number
}

/** The months behind Owed for one tenant-and-room family, from its first lease to its last. */
function missedOf(sorted: Lease[], a: { today: string } & RentData): { month: string; owed: number }[] {
  const now = monthOf(a.today)
  return monthsBetween(monthOf(sorted[0].startDate), monthOf(sorted[sorted.length - 1].endDate))
    .filter((m) => m < now)
    .flatMap((m) => {
      const l = [...sorted].reverse().find((x) => runsIn(x, m))
      const owed = l ? cellOf(l, m, a, a.today, sorted).owed : 0
      return owed > 0 ? [{ month: m, owed }] : []
    })
}

/**
 * The tenant-and-room families of one property that owe anything, whatever year they ran in (no cells: a row of
 * the year shown has those). The one rule behind the Rent page's Owed total and get_rent.
 */
export function owedFamilies(a: { leases: Lease[]; today: string } & RentData): GridRow[] {
  const byKey = new Map<string, Lease[]>()
  for (const l of a.leases) byKey.set(`${l.tenantId}|${l.room ?? ""}`, [...(byKey.get(`${l.tenantId}|${l.room ?? ""}`) ?? []), l])
  return [...byKey]
    .flatMap(([key, list]) => {
      const sorted = [...list].sort((x, y) => x.startDate.localeCompare(y.startDate))
      const missed = missedOf(sorted, a)
      if (missed.length === 0) return []
      const lease = sorted[sorted.length - 1]
      return [{ key, tenantId: lease.tenantId, room: lease.room, lease, cells: {}, missed, deposit: depositOf(lease, sorted, a.movements)?.held ?? null, owed: round2(missed.reduce((s, x) => s + x.owed, 0)) }]
    })
    .sort((x, y) => compareRooms(x.room, y.room))
}

/** One property's year: a row per tenant and room (a renewal continues on its row), a column per month. */
export function propertyGrid(a: { leases: Lease[]; year: number; today: string } & RentData): Grid {
  const all = monthsOfYear(a.year)
  const inYear = a.leases.filter((l) => all.some((m) => runsIn(l, m)))
  const first = all.findIndex((m) => inYear.some((l) => runsIn(l, m)))
  const months = first < 0 ? [] : all.slice(first)
  const now = monthOf(a.today)

  // Rows come from the leases of the year; a row's Owed reads all its leases, whatever year is shown.
  const byKey = new Map<string, Lease[]>()
  for (const l of a.leases) byKey.set(`${l.tenantId}|${l.room ?? ""}`, [...(byKey.get(`${l.tenantId}|${l.room ?? ""}`) ?? []), l])
  for (const key of [...byKey.keys()]) if (!inYear.some((l) => `${l.tenantId}|${l.room ?? ""}` === key)) byKey.delete(key)

  const rows: GridRow[] = [...byKey]
    .map(([key, list]) => {
      const sorted = [...list].sort((x, y) => x.startDate.localeCompare(y.startDate))
      const cells: Record<string, Cell> = {}
      for (const m of months) {
        // A renewal takes over the month it starts in.
        const l = [...sorted].reverse().find((x) => runsIn(x, m))
        if (l) cells[m] = cellOf(l, m, a, a.today, sorted)
      }
      // The lease in force latest in the year heads the row.
      const lease = [...sorted].reverse().find((x) => inYear.includes(x)) ?? sorted[sorted.length - 1]
      const missed = missedOf(sorted, a)
      return { key, tenantId: lease.tenantId, room: lease.room, lease, cells, missed, deposit: depositOf(sorted[sorted.length - 1], sorted, a.movements)?.held ?? null, owed: round2(missed.reduce((s, x) => s + x.owed, 0)) }
    })
    .sort((x, y) => compareRooms(x.room, y.room) || x.lease.startDate.localeCompare(y.lease.startDate))

  const footer: Record<string, Footer> = {}
  for (const m of months) {
    const cells = rows.flatMap((r) => (r.cells[m] ? [r.cells[m]] : []))
    const due = round2(cells.reduce((s, c) => s + c.due, 0))
    const paid = round2(cells.reduce((s, c) => s + c.paid, 0))
    footer[m] = {
      due,
      paid,
      owed: round2(cells.reduce((s, c) => s + c.owed, 0)),
      notYet: m === now ? round2(cells.reduce((s, c) => s + Math.max(0, c.due - c.paid), 0)) : 0,
    }
  }
  return { rows, months, hiddenBefore: first < 0 ? 12 : first, footer, owed: round2(rows.reduce((s, r) => s + r.owed, 0)) }
}

/** The movements one transfer saves: a row per part, a part of 0 left out. */
export function splitPayment(a: { rent: number; contribution: number }): { part: RentPart; amount: number }[] {
  return [
    { part: "rent" as const, amount: a.rent },
    { part: "contribution" as const, amount: a.contribution },
  ].filter((p) => p.amount > 0)
}

/** Same tenant, property and room: a lease and the ones it renews. */
const familyOf = (l: Lease, leases: readonly Lease[]) =>
  leases.filter((x) => x.tenantId === l.tenantId && x.room === l.room && x.property.trim() === l.property.trim())

/**
 * The deposit held for a row: received less given back, over the movements linked to any lease of the family,
 * so a renewal carries it over and it is counted once. Null when nothing is linked, or when `l` is not the family's
 * current (latest) lease: it shows once, on that one. `accountId` and `counterparty` are where and under whom the latest deposit came in; never below 0.
 */
export function depositOf(l: Lease, leases: readonly Lease[], movements: readonly RentMovement[]): { held: number; accountId?: string; counterparty?: string } | null {
  const family = familyOf(l, leases)
  if (family.some((x) => x.startDate > l.startDate)) return null
  const ids = new Set(family.map((x) => x.id))
  const rows = movements.filter((m) => m.kind === "deposit_held" && m.leaseId && ids.has(m.leaseId))
  if (rows.length === 0) return null
  const held = Math.max(0, round2(rows.reduce((s, m) => s + (m.direction === "out" ? -m.amount : m.amount), 0)))
  const received = rows.filter((m) => m.direction === "in").sort((a, b) => b.date.getTime() - a.date.getTime())
  return { held, accountId: received.find((m) => m.accountId)?.accountId ?? undefined, counterparty: received[0]?.counterparty ?? undefined }
}
