import { describe, expect, it } from "vitest"

import { leaseNotSet, notSetLine, notSetWords, roomsText, tenantNotSet } from "../details"
import { compareRooms } from "../lease"

const full = { taxId: "X1", street: "Via Test 1", postcode: "10100", city: "Turin", country: "Italy" }

describe("tenantNotSet", () => {
  it.each([
    ["nothing missing", full, []],
    ["no tax ID", { ...full, taxId: null }, ["tax ID"]],
    ["any one address part missing", { ...full, postcode: null }, ["residence"]],
    ["both", { taxId: null, street: null, postcode: null, city: null, country: null }, ["tax ID", "residence"]],
  ])("%s", (_name, t, expected) => {
    expect(tenantNotSet(t)).toEqual(expected)
  })
})

describe("leaseNotSet and its words", () => {
  it("puts the room first, then the tenant's details", () => {
    expect(leaseNotSet({ room: null }, { ...full, taxId: null, city: null })).toEqual(["room", "tax ID", "residence"])
    expect(leaseNotSet({ room: "Room 2" }, full)).toEqual([])
  })

  it("prints the amber line and the Edit Tenant words", () => {
    expect(notSetLine(["room", "tax ID"])).toBe("Not set: room, tax ID")
    expect(notSetLine([])).toBeNull()
    expect(notSetWords(["tax ID", "residence"])).toBe("Tax ID and residence not set")
    expect(notSetWords(["tax ID"])).toBe("Tax ID not set")
    expect(notSetWords([])).toBeNull()
  })
})

describe("roomsText", () => {
  const l = (tenantId: string, room: string | null) => ({ tenantId, room })
  it.each([
    ["every room set", [l("a", "Room 1"), l("b", "Room 2")], "2 rooms"],
    ["one room, renewed", [l("a", "Room 1"), l("a", "Room 1")], "1 room"],
    ["some not set", [l("a", "Room 1"), l("b", "Room 2"), l("c", null)], "2 rooms, 1 not set"],
    ["all not set", [l("a", null), l("b", null)], "rooms not set"],
    ["one lease, not set", [l("a", null)], "room not set"],
    ["a renewal with no room is one tenant", [l("a", "Room 1"), l("b", null), l("b", null)], "1 room, 1 not set"],
  ])("%s", (_name, leases, expected) => {
    expect(roomsText(leases)).toBe(expected)
  })
})

describe("compareRooms", () => {
  it("sorts naturally and puts no room last", () => {
    expect(["Room 10", null, "Room 2"].sort(compareRooms)).toEqual(["Room 2", "Room 10", null])
  })
})
