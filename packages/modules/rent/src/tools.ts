/**
 * The Rent module's connector tools, as plain data: a name, a description, a zod input
 * shape and a handler that gets its dependencies in `ctx`. The package holds no MCP SDK
 * and no database: the app registers each one on the server and hands in the server-side
 * database, the user and a `refuse` that raises its own input error.
 *
 * Privacy: `get_rent` answers with names only. A tenant's tax ID and address leave through
 * `get_tenant` and nowhere else.
 */
import { eurShort } from "@alter-ego/kernel/currency"
import { z } from "zod"

import { roomPart, tenantNotSet } from "./details"
import { canonicalProperty, compareRooms, groupByProperty, renewalOf } from "./lease"
import { monthOf, owedFamilies, propertyGrid, runsIn, withoutMonth } from "./rent"
import { createLeaseSchema, createTenantSchema } from "./schemas"

import type { RentAdapter } from "./adapter"
import type { CellStatus, GridRow, RentCost, RentMovement } from "./rent"
import type { Lease, Tenant } from "./types"

/** The rent slice plus the two cash-book reads the figures need; the app's server db has both. */
export interface RentToolDb extends RentAdapter {
  getCompanyMovements(userId: string): Promise<RentMovement[]>
  getCompanyExpenses(userId: string): Promise<RentCost[]>
}

export interface RentToolContext {
  db: RentToolDb
  userId: string
  /** yyyy-MM-dd. */
  today: string
  /** Stops the call with a message for the caller (the app's input error). */
  refuse(message: string): never
}

export interface RentToolResult {
  payload: unknown
  documentIds?: string[]
}

export interface RentTool {
  name: string
  title: string
  description: string
  /** Needs the write scope. */
  write: boolean
  input: z.ZodRawShape
  /** A write tool previews until `confirm: true`; the app audits that call as a preview. */
  edits: boolean
  run(input: never, ctx: RentToolContext): Promise<RentToolResult>
}

function tool<S extends z.ZodRawShape>(t: {
  name: string
  title: string
  description: string
  write: boolean
  edits?: boolean
  input: S
  run(input: z.infer<z.ZodObject<S>>, ctx: RentToolContext): Promise<RentToolResult>
}): RentTool {
  return { ...t, edits: t.edits ?? false } as unknown as RentTool
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

const CONFIRM_RULE =
  "Preview, then confirm: called without confirm it changes nothing and returns what would change. " +
  "Show that preview to the owner and ask; only once they agree call again, the same arguments, with confirm: true."

const confirmInput = z.boolean().optional()
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM")
const day = z.iso.date("Use YYYY-MM-DD")

const fullName = (t: Tenant) => `${t.firstName} ${t.surname}`

const STATUS: Record<CellStatus, string> = {
  paid: "Paid",
  partial: "Partial",
  missing: "Missing",
  "not-yet": "Not yet",
  "due-later": "Due later",
  outside: "No lease this month",
}

/** A tenant by id or by name ("Anna Rossi", "Rossi Anna", or the surname when it is one person). */
function findTenant(tenants: Tenant[], query: string, refuse: RentToolContext["refuse"]): Tenant {
  const q = query.trim().toLowerCase()
  const byId = tenants.find((t) => t.id === query.trim())
  if (byId) return byId
  const exact = tenants.filter((t) => [fullName(t), `${t.surname} ${t.firstName}`, t.surname].some((n) => n.toLowerCase() === q))
  const hits = exact.length ? exact : tenants.filter((t) => fullName(t).toLowerCase().includes(q))
  if (hits.length === 1) return hits[0]
  const list = (ts: Tenant[]) => ts.map((t) => `${fullName(t)} (${t.id})`).join(", ")
  return refuse(
    hits.length
      ? `More than one tenant matches "${query}": ${list(hits)}. Pass the id or the full name.`
      : `No tenant matches "${query}".${tenants.length ? ` Tenants: ${list(tenants)}.` : " There are no tenants yet: create_tenant adds one."}`,
  )
}

/** A lease by id, or by its tenant when they have one row: a renewal chain is one, its latest lease. */
function findLease(leases: Lease[], tenants: Tenant[], a: { lease?: string; tenant?: string }, refuse: RentToolContext["refuse"]): Lease {
  if (a.lease) {
    return leases.find((l) => l.id === a.lease!.trim()) ?? refuse(`No lease with id "${a.lease}". get_rent lists the leases with their ids.`)
  }
  if (!a.tenant) return refuse("Say which lease: pass lease (its id) or tenant (their name).")
  const t = findTenant(tenants, a.tenant, refuse)
  const mine = leases.filter((l) => l.tenantId === t.id)
  if (mine.length === 0) return refuse(`${fullName(t)} has no lease.`)
  const rooms = new Set(mine.map((l) => `${l.property.trim()}|${(l.room ?? "").trim().toLowerCase()}`))
  if (rooms.size > 1) return refuse(`${fullName(t)} has leases in more than one room: ${mine.map((l) => `${l.property}${roomPart(l.room, ", ")} (${l.id})`).join("; ")}. Pass the lease id.`)
  return [...mine].sort((x, y) => y.startDate.localeCompare(x.startDate))[0]
}

/** The tenant with this name, other than `except`: create_tenant and update_tenant refuse a second one. */
const sameName = (tenants: Tenant[], firstName: string, surname: string, except?: string) =>
  tenants.find((t) => t.id !== except && fullName(t).toLowerCase() === `${firstName} ${surname}`.toLowerCase())

/** A lease with no room is compared by tenant only: it matches any room. */
const sameRoom = (x: string | null, y: string | null) => !x || !y || x.trim().toLowerCase() === y.trim().toLowerCase()

/** A lease of the tenant in the same room that shares days with these, other than `except`. */
const overlapping = (leases: Lease[], a: { tenantId: string; property: string; room: string | null; startDate: string; endDate: string }, except?: string) =>
  leases.find(
    (l) => l.id !== except && l.tenantId === a.tenantId && l.property.trim().toLowerCase() === a.property.trim().toLowerCase() && sameRoom(l.room, a.room) && l.startDate <= a.endDate && a.startDate <= l.endDate,
  )

const leaseLine = (l: Lease, t?: Tenant) => `${t ? `${fullName(t)}, ` : ""}${l.property}, ${l.room ? `${l.room}, ` : ""}${l.startDate} to ${l.endDate}`

/** The fields an edit changes, "field before → after", from the stored record to the new one. */
function diff<T extends object>(before: T, after: T): string[] {
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "none" : typeof v === "string" ? `"${v}"` : typeof v === "object" ? JSON.stringify(v) : String(v))
  return (Object.keys(after) as (keyof T)[])
    .filter((k) => !["updatedAt", "createdAt"].includes(k as string) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => `${String(k)} ${show(before[k])} → ${show(after[k])}`)
}

/** Preview, or write: the same shape for tenants and leases. */
async function previewOrWrite<T extends { id: string }>(a: {
  confirm: boolean | undefined
  what: string
  before: T
  after: T
  write: () => Promise<unknown>
}): Promise<RentToolResult> {
  const changes = diff(a.before, a.after)
  if (changes.length === 0) return { payload: { summary: `Nothing to change on ${a.what}: it already reads so.`, changes } }
  if (!a.confirm) {
    return {
      payload: {
        preview: true,
        summary: `Preview, nothing changed yet: ${a.what}. Changes: ${changes.join(", ")}. Show this to the owner and ask; if they agree, call again with the same arguments and confirm: true.`,
        changes,
      },
      documentIds: [],
    }
  }
  await a.write()
  return { payload: { summary: `Updated ${a.what}. Changes: ${changes.join(", ")}.`, changes }, documentIds: [a.before.id] }
}

const read = async (ctx: RentToolContext) => {
  const [tenants, leases, movements, costs] = await Promise.all([
    ctx.db.getTenants(ctx.userId),
    ctx.db.getLeases(ctx.userId),
    ctx.db.getCompanyMovements(ctx.userId),
    ctx.db.getCompanyExpenses(ctx.userId),
  ])
  return { tenants, leases, movements, costs }
}

// ─── Reads ───────────────────────────────────────────────────────────────────

const getRent = tool({
  name: "get_rent",
  title: "Rent",
  description:
    "Rent for a month, per property and room: who is Paid, Partial, Missing, Not yet or Due later, what is due and paid, " +
    "Owed (the shortfall of months that have ended, with the months), payments with no invoice number (notInvoiced) and the " +
    "deposit held. «chi non ha pagato l'affitto?» → no arguments (the current month; Owed covers earlier months too); " +
    "«com'è l'affitto di settembre?» → month 2026-09. property narrows to one house. Names only: no tax ID and no address " +
    "(get_tenant has those). Payments are linked to a lease with add_movement's leaseId, rentMonth and rentPart.",
  write: false,
  input: { month: month.optional(), property: z.string().trim().min(1).max(60).optional() },
  async run(i, ctx) {
    const { tenants, leases, movements, costs } = await read(ctx)
    const m = i.month ?? monthOf(ctx.today)
    const name = new Map(tenants.map((t) => [t.id, fullName(t)]))
    const wanted = i.property?.toLowerCase()
    const properties = groupByProperty(leases)
      .filter((g) => !wanted || g.property.toLowerCase() === wanted)
      .map((g) => {
        // The month's year gives the cells; every other family that owes comes from owedFamilies, whatever year it ran in.
        const byRow = new Map<string, GridRow>()
        const shown = propertyGrid({ leases: g.leases, year: Number(m.slice(0, 4)), today: ctx.today, movements, costs }).rows
        for (const r of [...shown, ...owedFamilies({ leases: g.leases, today: ctx.today, movements, costs })]) if (!byRow.has(r.key)) byRow.set(r.key, r)
        const all = [...byRow.values()].sort((x, y) => compareRooms(x.room, y.room))
        const grid = { rows: all, owed: Math.round(all.reduce((s, r) => s + r.owed, 0) * 100) / 100 }
        const rooms = grid.rows.flatMap((r) => {
          const cell = r.cells[m]
          if (!cell && r.owed === 0) return []
          return [
            {
              room: r.room,
              tenant: name.get(r.tenantId) ?? "Unknown tenant",
              leaseId: cell?.leaseId ?? r.lease.id,
              paidBy: r.lease.paidBy,
              status: STATUS[cell?.status ?? "outside"],
              due: cell?.due ?? 0,
              paid: cell?.paid ?? 0,
              offset: cell?.offset ?? 0,
              notInvoiced: cell ? cell.status === "paid" && !cell.invoiced : false,
              owed: r.owed,
              owedMonths: r.missed,
              depositHeld: r.deposit,
            },
          ]
        })
        return { property: g.property, owed: grid.owed, rooms }
      })
      .filter((p) => p.rooms.length > 0)
    const owed = Math.round(properties.reduce((s, p) => s + p.owed, 0) * 100) / 100
    const missing = properties.flatMap((p) => p.rooms.filter((r) => r.owed > 0).map((r) => `${r.tenant} (${p.property}${roomPart(r.room, ", ")})`))
    return {
      payload: {
        summary: properties.length
          ? `Rent for ${m}: Owed ${eurShort(owed)}${missing.length ? `, by ${missing.join("; ")}` : ""}.`
          : `No lease runs in ${m}${i.property ? ` at ${i.property}` : ""}.`,
        month: m,
        owed,
        properties,
      },
    }
  },
})

const getTenantTool = tool({
  name: "get_tenant",
  title: "Tenant",
  description:
    "A tenant's details for an invoice: name, tax ID, street, postcode, city, province, country (null when not set), notSet (what is missing for an invoice), and their leases. " +
    "The only tool that returns a tax ID or an address. «dammi i dati dell'inquilino per la fattura» → tenant. " +
    "tenant is a name or an id; an unclear name is refused with the matches.",
  write: false,
  input: { tenant: z.string().trim().min(1).max(200) },
  async run(i, ctx) {
    const [tenants, leases] = await Promise.all([ctx.db.getTenants(ctx.userId), ctx.db.getLeases(ctx.userId)])
    const t = findTenant(tenants, i.tenant, ctx.refuse)
    const notSet = tenantNotSet(t)
    return {
      payload: {
        summary: `${fullName(t)}.${notSet.length ? ` Not set: ${notSet.join(", ")}.` : ""}`,
        notSet,
        tenant: {
          id: t.id,
          firstName: t.firstName,
          surname: t.surname,
          taxId: t.taxId,
          street: t.street,
          postcode: t.postcode,
          city: t.city,
          province: t.province,
          country: t.country,
        },
        leases: leases.filter((l) => l.tenantId === t.id).map((l) => ({ id: l.id, property: l.property, room: l.room, rent: l.rent, contribution: l.contribution, startDate: l.startDate, endDate: l.endDate, paidBy: l.paidBy })),
      },
    }
  },
})

// ─── Tenants ─────────────────────────────────────────────────────────────────

const tenantShape = {
  firstName: z.string().trim().min(1).max(100),
  surname: z.string().trim().min(1).max(100),
  // Optional: only the names are needed to save a tenant. On an edit "" clears a field.
  taxId: z.string().trim().max(50).optional(),
  street: z.string().trim().max(200).optional(),
  postcode: z.string().trim().max(20).optional(),
  city: z.string().trim().max(100).optional(),
  province: z.string().trim().max(50).optional(),
  country: z.string().trim().max(100).optional(),
}

const createTenant = tool({
  name: "create_tenant",
  title: "New Tenant",
  description:
    "Adds a tenant: a person who rents a room, not a CRM client (never in revenue or the pipeline). Fails on the same " +
    "first name and surname (case-insensitive): use get_tenant first when unsure. Only firstName and surname are " +
    "needed; taxId, street, postcode, city, province and country are optional and stored as not set until update_tenant " +
    "fills them (get_tenant lists what is missing). taxId is free text, foreign tenants carry foreign IDs. Then create_lease gives them a room. «aggiungi un inquilino» → this.",
  write: true,
  input: tenantShape,
  async run(i, ctx) {
    const tenants = await ctx.db.getTenants(ctx.userId)
    const dup = sameName(tenants, i.firstName, i.surname)
    if (dup) ctx.refuse(`A tenant "${fullName(dup)}" already exists (${dup.id}): update_tenant changes it.`)
    const input = createTenantSchema.safeParse(i)
    if (!input.success) ctx.refuse(input.error.issues.map((x) => x.message).join("; "))
    const t = await ctx.db.createTenant(ctx.userId, i)
    return { payload: { summary: `Tenant "${fullName(t)}" created.`, tenant: { id: t.id, name: fullName(t) } }, documentIds: [t.id] }
  },
})

const updateTenant = tool({
  name: "update_tenant",
  title: "Edit Tenant",
  description:
    "Corrects a tenant's details: pass only what changes (firstName, surname, taxId, street, postcode, city, province, " +
    "country; \"\" clears any of them, they are optional). tenant is a name or an id. " +
    CONFIRM_RULE,
  write: true,
  edits: true,
  input: { tenant: z.string().trim().min(1).max(200), ...Object.fromEntries(Object.entries(tenantShape).map(([k, v]) => [k, v.optional()])), confirm: confirmInput },
  async run(i: { tenant: string; confirm?: boolean } & Partial<Record<keyof typeof tenantShape, string>>, ctx) {
    const { tenant, confirm, ...changes } = i
    if (Object.values(changes).every((v) => v === undefined)) ctx.refuse("Nothing to change: pass firstName, surname, taxId, street, postcode, city, province or country.")
    const all = await ctx.db.getTenants(ctx.userId)
    const t = findTenant(all, tenant, ctx.refuse)
    const set = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined))
    const parsed = createTenantSchema.safeParse({ ...t, ...set })
    if (!parsed.success) return ctx.refuse(parsed.error.issues.map((x) => x.message).join("; "))
    const dup = sameName(all, parsed.data.firstName, parsed.data.surname, t.id)
    if (dup) ctx.refuse(`A tenant "${fullName(dup)}" already exists (${dup.id}): pick another name.`)
    const after = { id: t.id, ...parsed.data }
    // Only the changed fields are shown: a tax ID or an address appears here only when it is being edited.
    return previewOrWrite({
      confirm,
      what: `tenant ${fullName(t)}`,
      before: { id: t.id, firstName: t.firstName, surname: t.surname, taxId: t.taxId, street: t.street, postcode: t.postcode, city: t.city, province: t.province, country: t.country },
      after,
      write: () => ctx.db.updateTenant(ctx.userId, t.id, set),
    })
  },
})

// ─── Leases ──────────────────────────────────────────────────────────────────

const leaseShape = {
  property: z.string().trim().min(1).max(60),
  // Optional: a lease can be saved before its room is known. On an edit "" clears it.
  room: z.string().trim().max(100),
  rent: z.number().min(0).max(1_000_000),
  contribution: z.number().min(0).max(1_000_000).nullable(),
  startDate: day,
  endDate: day,
  paidBy: z.string().trim().max(100),
}

const createLease = tool({
  name: "create_lease",
  title: "New Lease",
  description:
    "Gives a tenant a room for a stretch of time (a year): room is optional (a lease can be saved before the room is " +
    "known, and update_lease sets it later), property is the house, the cost centre's name (existing spelling " +
    "kept), rent and contribution are € a month, startDate and endDate YYYY-MM-DD both inclusive, paidBy who sends the " +
    "money when it is not the tenant. «rinnovato per un anno» → renews: the lease being renewed (id, or its tenant's " +
    "name); the new one starts the day after it ends, a year long, with its property, room, rent, contribution and " +
    "paidBy, and anything else passed overrides. Refused when the tenant's room is already leased on those days.",
  write: true,
  input: {
    tenant: z.string().trim().min(1).max(200).optional(),
    renews: z.string().trim().min(1).max(200).optional(),
    ...Object.fromEntries(Object.entries(leaseShape).map(([k, v]) => [k, v.optional()])),
  },
  async run(i: { tenant?: string; renews?: string } & Partial<{ [K in keyof typeof leaseShape]: z.infer<(typeof leaseShape)[K]> }>, ctx) {
    const { tenants, leases } = await read(ctx)
    const { tenant: who, renews, ...fields } = i
    const old = renews ? findLease(leases, tenants, { lease: leases.some((l) => l.id === renews) ? renews : undefined, tenant: renews }, ctx.refuse) : null
    const t = who ? findTenant(tenants, who, ctx.refuse) : old ? tenants.find((x) => x.id === old.tenantId) : undefined
    if (!t) return ctx.refuse("Say whose lease it is: pass tenant (name or id), or renews.")
    const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
    const draft = { ...(old ? renewalOf(old) : {}), ...set, tenantId: t.id }
    const parsed = createLeaseSchema.safeParse(draft)
    if (!parsed.success) return ctx.refuse(parsed.error.issues.map((x) => `${x.path.join(".") || "lease"}: ${x.message}`).join("; "))
    const property = canonicalProperty(parsed.data.property, leases.map((l) => l.property))
    const clash = overlapping(leases, { ...parsed.data, property })
    if (clash) ctx.refuse(`${fullName(t)} already has ${leaseLine(clash)} (${clash.id}), overlapping these days: update_lease changes it, a renewal starts the day after it ends.`)
    const created = await ctx.db.createLease(ctx.userId, { ...parsed.data, property })
    return {
      payload: { summary: `Lease created: ${leaseLine(created, t)}, rent ${eurShort(created.rent)}${created.contribution ? ` + ${eurShort(created.contribution)} contribution` : ""} a month.`, lease: { id: created.id, tenant: fullName(t), property: created.property, room: created.room } },
      documentIds: [created.id],
    }
  },
})

const updateLease = tool({
  name: "update_lease",
  title: "Edit Lease",
  description:
    "Changes a lease: pass only what changes. lease is its id (get_rent lists them), or tenant (a name) for their " +
    "latest lease. «è andato via a fine mese» → endDate (YYYY-MM-DD, the last day); rent, contribution (null = none), " +
    "startDate, room (optional, \"\" clears it), property, paidBy (\"\" clears). A month's agreed amount in place of rent + contribution: " +
    "agreedMonth (YYYY-MM) with agreedAmount and agreedNote («moved in on 26 Sep»), or agreedMonth with agreedAmount null " +
    "to drop it. A renewal is create_lease with renews. A tenant with leases in several rooms is chosen by lease (the id), room is only ever the new room. " +
    CONFIRM_RULE,
  write: true,
  edits: true,
  input: {
    lease: z.string().trim().min(1).max(200).optional(),
    tenant: z.string().trim().min(1).max(200).optional(),
    ...Object.fromEntries(Object.entries(leaseShape).map(([k, v]) => [k, v.optional()])),
    agreedMonth: month.optional(),
    agreedAmount: z.number().min(0).max(1_000_000).nullable().optional(),
    agreedNote: z.string().trim().max(200).optional(),
    confirm: confirmInput,
  },
  async run(i: { lease?: string; tenant?: string; agreedMonth?: string; agreedAmount?: number | null; agreedNote?: string; confirm?: boolean } & Partial<{ [K in keyof typeof leaseShape]: z.infer<(typeof leaseShape)[K]> }>, ctx) {
    const { lease: leaseId, tenant, agreedMonth, agreedAmount, agreedNote, confirm, ...fields } = i
    const set: Record<string, unknown> = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
    if (agreedMonth === undefined && (agreedAmount !== undefined || agreedNote !== undefined)) ctx.refuse("agreedAmount and agreedNote need agreedMonth.")
    if (agreedMonth !== undefined && agreedAmount === undefined) ctx.refuse("agreedMonth needs agreedAmount: a number, or null to drop that month's agreed amount.")
    if (Object.keys(set).length === 0 && agreedMonth === undefined) ctx.refuse("Nothing to change: pass rent, contribution, startDate, endDate, room, property, paidBy or agreedMonth.")
    const { tenants, leases } = await read(ctx)
    const l = findLease(leases, tenants, { lease: leaseId, tenant }, ctx.refuse)
    if (set.property !== undefined) set.property = canonicalProperty(set.property as string, leases.map((x) => x.property))
    // The same room in other casing is the same room: the stored spelling stays, so a renewal's row is not split.
    if (typeof set.room === "string" && l.room !== null && set.room.toLowerCase() === l.room.trim().toLowerCase()) delete set.room
    if (agreedMonth !== undefined) {
      set.agreedMonths = agreedAmount === null ? withoutMonth(l.agreedMonths, agreedMonth) : { ...l.agreedMonths, [agreedMonth]: { amount: agreedAmount, note: agreedNote ?? l.agreedMonths[agreedMonth]?.note ?? "" } }
    }
    const parsed = createLeaseSchema.safeParse({ ...l, ...set })
    if (!parsed.success) return ctx.refuse(parsed.error.issues.map((x) => `${x.path.join(".") || "lease"}: ${x.message}`).join("; "))
    if (agreedMonth !== undefined && agreedAmount !== null && !runsIn(parsed.data as Lease, agreedMonth)) {
      ctx.refuse(`The lease does not run in ${agreedMonth} (${parsed.data.startDate} to ${parsed.data.endDate}): an agreed amount belongs to a month it runs.`)
    }
    const clash = overlapping(leases, parsed.data, l.id)
    if (clash) ctx.refuse(`These days overlap ${leaseLine(clash)} (${clash.id}) of the same tenant and room.`)
    const keys = ["tenantId", "property", "room", "rent", "contribution", "startDate", "endDate", "paidBy", "agreedMonths"] as const
    const shape = (x: Pick<Lease, (typeof keys)[number]>) => ({ id: l.id, ...Object.fromEntries(keys.map((k) => [k, x[k]])) }) as { id: string }
    const t = tenants.find((x) => x.id === l.tenantId)
    return previewOrWrite({
      confirm,
      what: `lease ${leaseLine(l, t)}`,
      before: shape(l),
      after: shape(parsed.data as Pick<Lease, (typeof keys)[number]>),
      write: () => ctx.db.updateLease(ctx.userId, l.id, set),
    })
  },
})

export const rentTools: RentTool[] = [getRent, getTenantTool, createTenant, updateTenant, createLease, updateLease]

export const RENT_TOOL_NAMES = rentTools.map((t) => t.name)
export const RENT_WRITE_TOOL_NAMES = rentTools.filter((t) => t.write).map((t) => t.name)

