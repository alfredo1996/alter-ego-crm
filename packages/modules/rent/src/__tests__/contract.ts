/**
 * The rent slice's contract, run by the app against every backend (the mock, and the
 * emulator through the Firestore adapter). It lives in the package so the slice and its
 * tests move together; apps/web/.../adapter-contract.ts calls it.
 */
import { describe, expect, it } from "vitest"

import type { RentAdapter } from "../adapter"
import type { CreateLeaseInput, CreateTenantInput } from "../types"

const tenantInput = (o: Partial<CreateTenantInput> = {}): CreateTenantInput => ({
  firstName: "Tomas",
  surname: "Vaitkus",
  taxId: "39501010000",
  street: "Gedimino pr. 12",
  postcode: "01103",
  city: "Vilnius",
  country: "Lithuania",
  ...o,
})

const leaseInput = (tenantId: string, o: Partial<CreateLeaseInput> = {}): CreateLeaseInput => ({
  tenantId,
  property: "Via Aurora 7",
  room: "Room 2",
  rent: 1000,
  contribution: 150,
  startDate: "2026-09-01",
  endDate: "2027-08-31",
  paidBy: null,
  ...o,
})

export function describeRentContract(get: () => { db: RentAdapter; userId: string; otherUserId: string }) {
  describe("rent", () => {
    it("creates, reads and updates a tenant; the province reads null when left out", async () => {
      const { db, userId, otherUserId } = get()
      const t = await db.createTenant(userId, tenantInput({ firstName: " Tomas ", province: "  " }))
      expect(t).toMatchObject({ userId, firstName: "Tomas", surname: "Vaitkus", province: null, country: "Lithuania" })
      expect(t.createdAt).toBeInstanceOf(Date)

      const moved = await db.updateTenant(userId, t.id, { city: "Kaunas", province: "KA" })
      expect(moved).toMatchObject({ id: t.id, city: "Kaunas", province: "KA", firstName: "Tomas", street: "Gedimino pr. 12" })

      expect((await db.getTenants(userId)).find((x) => x.id === t.id)).toMatchObject({ city: "Kaunas" })
      expect(await db.getTenants(otherUserId)).toEqual([])
    })

    it("stores a tenant and a lease with nothing but the names and no room as null, fills them in later and clears them again", async () => {
      const { db, userId } = get()
      const t = await db.createTenant(userId, { firstName: "Bea", surname: "Nodetail" })
      expect(t).toMatchObject({ taxId: null, street: null, postcode: null, city: null, province: null, country: null })
      const l = await db.createLease(userId, leaseInput(t.id, { room: undefined }))
      expect(l.room).toBeNull()

      const filled = await db.updateTenant(userId, t.id, { taxId: "39501010000", street: "Gedimino pr. 12" })
      expect(filled).toMatchObject({ taxId: "39501010000", street: "Gedimino pr. 12", city: null })
      expect(await db.updateTenant(userId, t.id, { taxId: "" })).toMatchObject({ taxId: null, street: "Gedimino pr. 12" })
      expect(await db.updateLease(userId, l.id, { room: "Room 3" })).toMatchObject({ room: "Room 3" })
      expect(await db.updateLease(userId, l.id, { room: "" })).toMatchObject({ room: null })
      expect((await db.getLeases(userId)).find((x) => x.id === l.id)).toMatchObject({ room: null })
    })

    it("lists tenants by surname, then first name", async () => {
      const { db, userId } = get()
      const [b, a1, a2] = await Promise.all([
        db.createTenant(userId, tenantInput({ surname: "Zz-order" })),
        db.createTenant(userId, tenantInput({ surname: "Aa-order", firstName: "Bea" })),
        db.createTenant(userId, tenantInput({ surname: "Aa-order", firstName: "Abe" })),
      ])
      const ids = (await db.getTenants(userId)).map((t) => t.id).filter((id) => [a1.id, a2.id, b.id].includes(id))
      expect(ids).toEqual([a2.id, a1.id, b.id])
    })

    it("creates and updates a lease; the property is stored trimmed and a missing contribution reads null", async () => {
      const { db, userId, otherUserId } = get()
      const t = await db.createTenant(userId, tenantInput())
      const l = await db.createLease(userId, leaseInput(t.id, { property: "  Via Roma 12 ", contribution: undefined, paidBy: "Darius" }))
      expect(l).toMatchObject({
        tenantId: t.id, property: "Via Roma 12", room: "Room 2", rent: 1000, contribution: null,
        startDate: "2026-09-01", endDate: "2027-08-31", paidBy: "Darius",
      })

      const ended = await db.updateLease(userId, l.id, { endDate: "2027-01-31" })
      expect(ended).toMatchObject({ id: l.id, endDate: "2027-01-31", startDate: "2026-09-01", rent: 1000, paidBy: "Darius" })

      expect((await db.getLeases(userId)).find((x) => x.id === l.id)).toMatchObject({ endDate: "2027-01-31" })
      expect(await db.getLeases(otherUserId)).toEqual([])
    })

    it("stores agreed months on a lease, reads none as an empty map, and refuses a bad month or amount", async () => {
      const { db, userId } = get()
      const t = await db.createTenant(userId, tenantInput())
      const plain = await db.createLease(userId, leaseInput(t.id))
      expect(plain.agreedMonths).toEqual({})
      const agreed = { "2026-09": { amount: 800, note: "Moved in on 26 Sep" } }
      const l = await db.updateLease(userId, plain.id, { agreedMonths: agreed })
      expect(l.agreedMonths).toEqual(agreed)
      expect((await db.getLeases(userId)).find((x) => x.id === l.id)?.agreedMonths).toEqual(agreed)
      expect((await db.updateLease(userId, l.id, { rent: 1100 })).agreedMonths).toEqual(agreed) // an edit keeps them
      expect((await db.updateLease(userId, l.id, { agreedMonths: {} })).agreedMonths).toEqual({})
      await expect(db.updateLease(userId, l.id, { agreedMonths: { "2026-13": { amount: 1, note: "" } } })).rejects.toThrow()
      await expect(db.updateLease(userId, l.id, { agreedMonths: { "2026-09": { amount: -1, note: "" } } })).rejects.toThrow()
    })

    it.each([
      ["no end date", { endDate: "" }],
      ["an end before its start", { endDate: "2026-08-31" }],
      ["a negative rent", { rent: -1 }],
    ])("refuses a lease with %s", async (_name, bad) => {
      const { db, userId } = get()
      const t = await db.createTenant(userId, tenantInput())
      await expect(db.createLease(userId, leaseInput(t.id, bad))).rejects.toThrow()
      const l = await db.createLease(userId, leaseInput(t.id))
      await expect(db.updateLease(userId, l.id, bad)).rejects.toThrow()
    })

    it("does not update another user's lease or tenant", async () => {
      const { db, userId, otherUserId } = get()
      const t = await db.createTenant(userId, tenantInput())
      const l = await db.createLease(userId, leaseInput(t.id))
      await expect(db.updateLease(otherUserId, l.id, { room: "Room 9" })).rejects.toThrow()
      await expect(db.updateTenant(otherUserId, t.id, { city: "Elsewhere" })).rejects.toThrow()
    })
  })
}
