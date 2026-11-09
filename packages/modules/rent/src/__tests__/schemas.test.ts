import { describe, expect, it } from "vitest"

import { createLeaseSchema, createTenantSchema } from "../schemas"

const lease = { tenantId: "t1", property: "Via Aurora 7", rent: 800, startDate: "2026-09-01", endDate: "2027-08-31" }

describe("createTenantSchema", () => {
  it("takes a tenant with only the names, and reads every other detail as null", () => {
    expect(createTenantSchema.parse({ firstName: " Anna ", surname: "Test" })).toEqual({
      firstName: "Anna", surname: "Test", taxId: null, street: null, postcode: null, city: null, province: null, country: null,
    })
  })

  it.each(["taxId", "street", "postcode", "city", "country"])("reads a blank %s as null", (key) => {
    expect(createTenantSchema.parse({ firstName: "Anna", surname: "Test", [key]: "  " })).toMatchObject({ [key]: null })
  })

  it.each([
    ["taxId", 50],
    ["street", 200],
    ["postcode", 20],
    ["city", 100],
    ["country", 100],
  ])("keeps %s to %i characters", (key, max) => {
    expect(createTenantSchema.safeParse({ firstName: "A", surname: "T", [key]: "x".repeat(max) }).success).toBe(true)
    expect(createTenantSchema.safeParse({ firstName: "A", surname: "T", [key]: "x".repeat(max + 1) }).success).toBe(false)
  })

  it("still needs both names", () => {
    expect(createTenantSchema.safeParse({ firstName: "Anna" }).success).toBe(false)
    expect(createTenantSchema.safeParse({ surname: "Test" }).success).toBe(false)
  })
})

describe("createLeaseSchema", () => {
  it("takes a lease without a room, as null", () => {
    expect(createLeaseSchema.parse(lease)).toMatchObject({ room: null })
    expect(createLeaseSchema.parse({ ...lease, room: " " })).toMatchObject({ room: null })
  })

  it("keeps a room to 100 characters", () => {
    expect(createLeaseSchema.safeParse({ ...lease, room: "x".repeat(100) }).success).toBe(true)
    expect(createLeaseSchema.safeParse({ ...lease, room: "x".repeat(101) }).success).toBe(false)
  })
})
