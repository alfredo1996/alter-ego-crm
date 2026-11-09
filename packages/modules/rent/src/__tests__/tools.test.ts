import { beforeEach, describe, expect, it } from "vitest"

import { createMockRent } from "../adapter-mock"
import { rent } from "../manifest"
import { rentTools } from "../tools"

import type { RentMovement } from "../rent"
import type { RentToolContext, RentToolDb } from "../tools"

const U = "u1"
const TAX_ID = "IT-TAX-4455"
const STREET = "Via Segreta 99"

let n = 0
const { rent: slice, clear } = createMockRent(() => `id${++n}`)
let movements: RentMovement[] = []

const ctx = (today = "2026-10-26"): RentToolContext => ({
  db: { ...slice, getCompanyMovements: async () => movements, getCompanyExpenses: async () => [] } as RentToolDb,
  userId: U,
  today,
  refuse: (m) => {
    throw new Error(m)
  },
})
const call = (name: string, input: object, c = ctx()) => rentTools.find((t) => t.name === name)!.run(input as never, c)
const payload = async (name: string, input: object) => (await call(name, input)).payload as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const tenant = { firstName: "Anna", surname: "Test", taxId: TAX_ID, street: STREET, postcode: "10100", city: "Turin", country: "Italy" }
const lease = { tenant: "Anna Test", property: "Via Aurora 7", room: "Room 2", rent: 800, contribution: 100, startDate: "2026-09-01", endDate: "2027-08-31" }

beforeEach(() => {
  clear()
  movements = []
})

it("the manifest lists exactly the tools the package serves", () => {
  expect(rent.tools).toEqual(rentTools.map((t) => t.name))
})

describe("get_rent", () => {
  it("shows Owed and the month's status, and never a tax ID or an address", async () => {
    await call("create_tenant", tenant)
    const l = (await call("create_lease", lease)).documentIds![0]
    const p = await payload("get_rent", {})
    expect(p.properties).toEqual([
      expect.objectContaining({ property: "Via Aurora 7", owed: 900 }),
    ])
    expect(p.properties[0].rooms[0]).toMatchObject({ room: "Room 2", tenant: "Anna Test", leaseId: l, status: "Not yet", due: 900, owed: 900 })
    const text = JSON.stringify(p)
    expect(text).not.toContain(TAX_ID)
    expect(text).not.toContain(STREET)
  })

  it("reads Paid once a payment is linked to the lease", async () => {
    await call("create_tenant", tenant)
    const l = (await call("create_lease", lease)).documentIds![0]
    movements = (["rent", "contribution"] as const).map((part, i) => ({
      id: `m${i}`, leaseId: l, rentMonth: "2026-10", rentPart: part, amount: part === "rent" ? 800 : 100, documentRef: null, date: new Date(2026, 9, 5),
    }))
    const room = (await payload("get_rent", { month: "2026-10" })).properties[0].rooms[0]
    expect(room).toMatchObject({ status: "Paid", paid: 900, notInvoiced: true, owed: 900 }) // September is still Missing
  })
})

describe("get_rent across years", () => {
  it("reports every earlier month of a lease that ended last year, with no arguments", async () => {
    await call("create_tenant", tenant)
    await call("create_lease", { ...lease, rent: 500, contribution: null, startDate: "2026-01-01", endDate: "2026-12-31" })
    const p = (await call("get_rent", {}, ctx("2027-01-10"))).payload as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(p.owed).toBe(6000)
    expect(p.summary).toBe("Rent for 2027-01: Owed €6,000, by Anna Test (Via Aurora 7, Room 2).")
    expect(p.properties[0].rooms[0]).toMatchObject({ status: "No lease this month", owed: 6000 })
    const dec = (await call("get_rent", { month: "2026-12" }, ctx("2027-01-10"))).payload as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(dec.owed).toBe(6000)
  })
})

describe("get_tenant", () => {
  it("is the one tool that returns the tax ID and the address", async () => {
    await call("create_tenant", tenant)
    const p = await payload("get_tenant", { tenant: "test" })
    expect(p.tenant).toMatchObject({ taxId: TAX_ID, street: STREET })
  })
})

describe("details that are not known yet", () => {
  const bare = { firstName: "Bea", surname: "Nodetail" }

  it("creates a tenant from the names alone, stored as null, and get_tenant says what is not set", async () => {
    await call("create_tenant", bare)
    expect((await slice.getTenants(U))[0]).toMatchObject({ taxId: null, street: null, postcode: null, city: null, country: null })
    const p = await payload("get_tenant", { tenant: "Nodetail" })
    expect(p.summary).toBe("Bea Nodetail. Not set: tax ID, residence.")
    expect(p.notSet).toEqual(["tax ID", "residence"])
  })

  it("counts a half-filled address as residence not set, and nothing missing says nothing", async () => {
    await call("create_tenant", { ...bare, taxId: TAX_ID, street: STREET, city: "Turin" })
    expect((await payload("get_tenant", { tenant: "Nodetail" })).notSet).toEqual(["residence"])
    await call("update_tenant", { tenant: "Nodetail", postcode: "10100", country: "Italy", confirm: true })
    const p = await payload("get_tenant", { tenant: "Nodetail" })
    expect(p.notSet).toEqual([])
    expect(p.summary).toBe("Bea Nodetail.")
  })

  it("fills a detail in later, and clears one with an empty string", async () => {
    await call("create_tenant", bare)
    await call("update_tenant", { tenant: "Nodetail", taxId: TAX_ID, confirm: true })
    expect((await slice.getTenants(U))[0].taxId).toBe(TAX_ID)
    await call("update_tenant", { tenant: "Nodetail", taxId: "", confirm: true })
    expect((await slice.getTenants(U))[0].taxId).toBeNull()
  })

  it("creates a lease with no room, edits it without crashing, and sets and clears the room", async () => {
    await call("create_tenant", bare)
    const created = await call("create_lease", { ...lease, tenant: "Nodetail", room: undefined })
    expect((created.payload as { summary: string }).summary).toBe("Lease created: Bea Nodetail, Via Aurora 7, 2026-09-01 to 2027-08-31, rent €800 + €100 contribution a month.")
    expect((await slice.getLeases(U))[0].room).toBeNull()
    const preview = await payload("update_lease", { tenant: "Nodetail", rent: 810 })
    expect(preview.changes).toEqual(["rent 800 → 810"])
    await call("update_lease", { tenant: "Nodetail", room: "Room 7", confirm: true })
    expect((await slice.getLeases(U))[0].room).toBe("Room 7")
    await call("update_lease", { tenant: "Nodetail", room: "", confirm: true })
    expect((await slice.getLeases(U))[0].room).toBeNull()
  })

  it("still refuses the same tenant's overlapping leases when neither has a room", async () => {
    await call("create_tenant", bare)
    const noRoom = { ...lease, tenant: "Nodetail", room: undefined }
    await call("create_lease", noRoom)
    await expect(call("create_lease", { ...noRoom, startDate: "2027-08-01", endDate: "2028-07-31" })).rejects.toThrow("overlapping")
  })

  it("compares a lease with no room to the tenant's other leases there by tenant only", async () => {
    await call("create_tenant", bare)
    const noRoom = { ...lease, tenant: "Nodetail", room: undefined }
    const later = { startDate: "2027-08-01", endDate: "2028-07-31" }
    await call("create_lease", { ...noRoom, room: "Room 1" })
    await expect(call("create_lease", { ...noRoom, ...later })).rejects.toThrow("overlapping")
    await expect(call("create_lease", { ...noRoom, room: " ROOM 1 ", ...later })).rejects.toThrow("overlapping")
    await expect(call("create_lease", { ...noRoom, room: "Room 2", ...later })).resolves.toBeDefined()
  })

  it("renews a lease with no room", async () => {
    await call("create_tenant", bare)
    await call("create_lease", { ...lease, tenant: "Nodetail", room: undefined })
    await call("create_lease", { renews: "Nodetail" })
    expect((await slice.getLeases(U)).map((l) => [l.startDate, l.room])).toEqual([["2026-09-01", null], ["2027-09-01", null]])
  })
})

describe("tenants", () => {
  it("refuses a name that matches two tenants, and an unknown one", async () => {
    await call("create_tenant", tenant)
    await call("create_tenant", { ...tenant, firstName: "Hanna", surname: "Other" })
    await expect(call("get_tenant", { tenant: "ann" })).rejects.toThrow(/More than one tenant matches "ann": Hanna Other .*Anna Test/)
    await expect(call("get_tenant", { tenant: "zzz" })).rejects.toThrow('No tenant matches "zzz"')
  })

  it("refuses renaming a tenant to a name another one has", async () => {
    await call("create_tenant", tenant)
    await call("create_tenant", { ...tenant, firstName: "Hanna", surname: "Other" })
    await expect(call("update_tenant", { tenant: "Hanna Other", firstName: "anna", surname: "TEST", confirm: true })).rejects.toThrow('A tenant "Anna Test" already exists')
    await call("update_tenant", { tenant: "Hanna Other", firstName: "Hanna", surname: "OTHER", confirm: true }) // itself is no clash
  })

  it("refuses a second tenant with the same name", async () => {
    await call("create_tenant", tenant)
    await expect(call("create_tenant", { ...tenant, firstName: "ANNA" })).rejects.toThrow('A tenant "Anna Test" already exists')
  })

  it("previews an edit without writing, and writes on confirm", async () => {
    await call("create_tenant", tenant)
    const preview = await payload("update_tenant", { tenant: "Anna Test", city: "Milan" })
    expect(preview).toMatchObject({ preview: true, changes: ['city "Turin" → "Milan"'] })
    expect((await payload("get_tenant", { tenant: "Anna Test" })).tenant.city).toBe("Turin")
    await call("update_tenant", { tenant: "Anna Test", city: "Milan", confirm: true })
    expect((await payload("get_tenant", { tenant: "Anna Test" })).tenant.city).toBe("Milan")
  })
})

describe("leases", () => {
  beforeEach(async () => {
    await call("create_tenant", tenant)
  })

  it("refuses an overlapping lease for the same room and renews from the day after", async () => {
    await call("create_lease", lease)
    await expect(call("create_lease", { ...lease, startDate: "2027-08-01", endDate: "2028-07-31" })).rejects.toThrow("overlapping")
    await call("create_lease", { renews: "Anna Test", rent: 850 })
    const leases = await slice.getLeases(U)
    expect(leases.map((l) => [l.startDate, l.endDate, l.rent, l.room])).toEqual([
      ["2026-09-01", "2027-08-31", 800, "Room 2"],
      ["2027-09-01", "2028-08-31", 850, "Room 2"],
    ])
  })

  it("previews ending a tenancy, writes on confirm, and sets and drops an agreed month", async () => {
    await call("create_lease", lease)
    const preview = await payload("update_lease", { tenant: "Anna Test", endDate: "2027-01-31" })
    expect(preview.changes).toEqual(['endDate "2027-08-31" → "2027-01-31"'])
    expect((await slice.getLeases(U))[0].endDate).toBe("2027-08-31")

    await call("update_lease", { tenant: "Anna Test", endDate: "2027-01-31", confirm: true })
    await call("update_lease", { tenant: "Anna Test", agreedMonth: "2026-09", agreedAmount: 500, agreedNote: "Moved in on 26 Sep", confirm: true })
    expect((await slice.getLeases(U))[0]).toMatchObject({ endDate: "2027-01-31", agreedMonths: { "2026-09": { amount: 500, note: "Moved in on 26 Sep" } } })
    await call("update_lease", { tenant: "Anna Test", agreedMonth: "2026-09", agreedAmount: null, confirm: true })
    expect((await slice.getLeases(U))[0].agreedMonths).toEqual({})
  })

  it("moves a tenant to another room: room is the new value, the lease is chosen by id", async () => {
    const id = (await call("create_lease", lease)).documentIds![0]
    await call("update_lease", { lease: id, room: "Room 3", confirm: true })
    expect((await slice.getLeases(U))[0].room).toBe("Room 3")
    await call("update_lease", { tenant: "Anna Test", room: "Room 4", confirm: true })
    expect((await slice.getLeases(U))[0].room).toBe("Room 4")
  })

  it("keeps the stored spelling when room comes in other casing, so a renewal is not split", async () => {
    await call("create_lease", lease)
    const preview = await payload("update_lease", { tenant: "Anna Test", room: "room 2", rent: 810 })
    expect(preview.changes).toEqual(["rent 800 → 810"])
  })

  it("refuses a tenant with leases in two rooms unless the lease id is passed", async () => {
    await call("create_lease", lease)
    await call("create_lease", { ...lease, room: "Room 5" })
    await expect(call("update_lease", { tenant: "Anna Test", rent: 1 })).rejects.toThrow("leases in more than one room")
    await expect(call("update_lease", { lease: "nope", rent: 1 })).rejects.toThrow('No lease with id "nope"')
    await expect(call("update_lease", { rent: 1 })).rejects.toThrow("Say which lease")
  })

  it("refuses an edit that makes it overlap the tenant's other lease in the room", async () => {
    await call("create_lease", lease)
    const renewal = (await call("create_lease", { renews: "Anna Test" })).documentIds![0]
    await expect(call("update_lease", { lease: renewal, startDate: "2027-06-01", confirm: true })).rejects.toThrow("overlap")
    expect((await slice.getLeases(U)).find((l) => l.id === renewal)!.startDate).toBe("2027-09-01")
  })

  it("refuses an agreed amount for a month the lease does not run, and still drops one", async () => {
    await call("create_lease", lease)
    await expect(call("update_lease", { tenant: "Anna Test", agreedMonth: "2025-01", agreedAmount: 5, confirm: true })).rejects.toThrow("does not run in 2025-01")
    await expect(call("update_lease", { tenant: "Anna Test", agreedMonth: "2026-09" })).rejects.toThrow("agreedMonth needs agreedAmount")
    await expect(call("update_lease", { tenant: "Anna Test", agreedAmount: 5 })).rejects.toThrow("need agreedMonth")
  })

  it("says money as euros", async () => {
    const created = await call("create_lease", lease)
    expect((created.payload as { summary: string }).summary).toBe("Lease created: Anna Test, Via Aurora 7, Room 2, 2026-09-01 to 2027-08-31, rent €800 + €100 contribution a month.")
  })

  it("refuses an end before the start", async () => {
    await call("create_lease", lease)
    await expect(call("update_lease", { tenant: "Anna Test", endDate: "2026-08-01", confirm: true })).rejects.toThrow("End cannot be before start")
  })
})
