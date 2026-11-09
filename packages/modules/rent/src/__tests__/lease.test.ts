import { describe, expect, it } from "vitest"

import { endTenancyError, groupByProperty, leasesInYear, renewalOf, trimProperty, canonicalProperty } from "../lease"
import { createLeaseSchema, MAX_PROPERTY } from "../schemas"

import type { Lease } from "../types"

const lease = (o: Partial<Lease> = {}): Lease => ({
  id: "l1",
  userId: "u1",
  tenantId: "t1",
  property: "Via Aurora 7",
  room: "Room 5",
  rent: 1000,
  contribution: 150,
  startDate: "2026-09-26",
  endDate: "2027-09-25",
  paidBy: "Darius Petraitis",
  agreedMonths: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...o,
})

describe("renewalOf", () => {
  it("starts the day after the old end, a year long, same tenant, property and room, rent pre-filled", () => {
    expect(renewalOf(lease())).toEqual({
      tenantId: "t1",
      property: "Via Aurora 7",
      room: "Room 5",
      rent: 1000,
      contribution: 150,
      paidBy: "Darius Petraitis",
      startDate: "2027-09-26",
      endDate: "2028-09-25",
    })
  })

  it("steps over a leap day and a month end", () => {
    expect(renewalOf(lease({ endDate: "2027-02-28" }))).toMatchObject({ startDate: "2027-03-01", endDate: "2028-02-29" })
    expect(renewalOf(lease({ endDate: "2027-12-31" }))).toMatchObject({ startDate: "2028-01-01", endDate: "2028-12-31" })
  })
})

describe("leasesInYear", () => {
  const ended2026 = lease({ id: "a", startDate: "2025-09-01", endDate: "2026-08-31" })
  const spans = lease({ id: "b", startDate: "2026-09-26", endDate: "2027-09-25" })

  it.each([
    [2025, ["a"]],
    [2026, ["a", "b"]],
    [2027, ["b"]],
    [2028, []],
  ])("in %i shows %j", (year, ids) => {
    expect(leasesInYear([ended2026, spans], year).map((l) => l.id)).toEqual(ids)
  })

  it("counts the first and last day", () => {
    expect(leasesInYear([lease({ startDate: "2027-12-31", endDate: "2028-03-01" })], 2027)).toHaveLength(1)
    expect(leasesInYear([lease({ startDate: "2025-01-01", endDate: "2026-01-01" })], 2026)).toHaveLength(1)
    expect(leasesInYear([lease({ startDate: "2025-01-01", endDate: "2025-12-31" })], 2026)).toHaveLength(0)
  })
})

describe("groupByProperty", () => {
  it("makes one block for a name however it is spaced, ordered by name then room", () => {
    const groups = groupByProperty([
      lease({ id: "1", property: "Via Roma 12", room: "Room 1" }),
      lease({ id: "2", property: "Via Aurora 7", room: "Room 2" }),
      lease({ id: "3", property: "  Via Aurora 7 ", room: "Room 1" }),
    ])
    expect(groups.map((g) => [g.property, g.leases.map((l) => l.id)])).toEqual([
      ["Via Aurora 7", ["3", "2"]],
      ["Via Roma 12", ["1"]],
    ])
  })
})

describe("trimProperty", () => {
  it("trims the ends and leaves the inside", () => {
    expect(trimProperty("  Via  Roma 12 ")).toBe("Via  Roma 12")
  })
})

describe("canonicalProperty", () => {
  it.each([
    ["via roma 12", "Via Roma 12"],
    ["  VIA ROMA 12 ", "Via Roma 12"],
    [" Via Torino 3 ", "Via Torino 3"],
  ])("%j saves as %j", (typed, saved) => {
    expect(canonicalProperty(typed, ["Via Aurora 7", "Via Roma 12"])).toBe(saved)
  })
})

describe("endTenancyError", () => {
  const l = lease()
  it.each([
    ["2027-01-31", null],
    ["2026-09-26", null],
    ["2026-09-25", "The last day cannot be before the lease starts"],
    ["2027-09-25", "The last day must be before the lease ends"],
    ["", "Last day is required"],
  ])("%s -> %s", (day, message) => {
    expect(endTenancyError(l, day)).toBe(message)
  })
})

describe("createLeaseSchema", () => {
  const input = { tenantId: "t1", property: "Via Aurora 7", room: "Room 5", rent: 1000, startDate: "2026-09-26", endDate: "2027-09-25" }

  it("trims the property, the one place it is trimmed on the way in", () => {
    expect(createLeaseSchema.parse({ ...input, property: "  Via Roma 12 " }).property).toBe("Via Roma 12")
  })

  it.each([
    ["a property longer than a cost centre", { property: "x".repeat(MAX_PROPERTY + 1) }],
    ["a start day that does not exist", { startDate: "2026-02-31" }],
    ["an end day that does not exist", { endDate: "2027-04-31" }],
  ])("refuses %s", (_name, bad) => {
    expect(createLeaseSchema.safeParse({ ...input, ...bad }).success).toBe(false)
  })

  it("accepts a property at the cap and a leap day", () => {
    expect(createLeaseSchema.safeParse({ ...input, property: "x".repeat(MAX_PROPERTY), endDate: "2028-02-29" }).success).toBe(true)
  })
})
