import { describe, expect, it } from "vitest"

import { cellOf, depositOf, owedFamilies, propertyGrid, splitPayment } from "../rent"

import type { RentCost, RentMovement } from "../rent"
import type { Lease } from "../types"

const lease = (o: Partial<Lease> = {}): Lease => ({
  id: "l1",
  userId: "u1",
  tenantId: "t1",
  property: "Via Aurora 7",
  room: "Room 4",
  rent: 950,
  contribution: 150,
  startDate: "2026-09-01",
  endDate: "2027-08-31",
  paidBy: null,
  agreedMonths: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...o,
})

let n = 0
const pay = (o: Partial<RentMovement> = {}): RentMovement => ({
  id: `m${++n}`,
  leaseId: "l1",
  rentMonth: "2026-09",
  rentPart: "rent",
  amount: 950,
  documentRef: "14/26",
  date: new Date(2026, 8, 7),
  ...o,
})
const both = (month: string, o: Partial<RentMovement> = {}) => [
  pay({ rentMonth: month, rentPart: "rent", amount: 950, ...o }),
  pay({ rentMonth: month, rentPart: "contribution", amount: 150, ...o }),
]
const offset = (o: Partial<RentCost> = {}): RentCost => ({ id: "c1", leaseId: "l1", forMonth: "2026-10", amount: 520, ...o })

const TODAY = "2026-10-26"
const cell = (month: string, movements: RentMovement[] = [], costs: RentCost[] = [], l = lease()) => cellOf(l, month, { movements, costs }, TODAY)

describe("cellOf: status", () => {
  it.each([
    ["Paid: rent and contribution cover the month", "2026-09", both("2026-09"), "paid", 0],
    ["Partial: the shortfall is what is missing", "2026-09", [pay({ amount: 950 }), pay({ rentPart: "contribution", amount: 50 })], "partial", 100],
    ["Missing: a past month with nothing", "2026-09", [], "missing", 1100],
    ["Not yet: the current month, nothing paid", "2026-10", [], "not-yet", 0],
    ["Partial in the current month is not owed yet", "2026-10", [pay({ rentMonth: "2026-10", amount: 500 })], "partial", 0],
    ["Due later: a month after the current one", "2026-11", [], "due-later", 0],
  ])("%s", (_name, month, movements, status, owed) => {
    expect(cell(month, movements)).toMatchObject({ status, owed, due: 1100 })
  })

  it("is blank before the start and after the end, and shows the months a lease starts or ends in", () => {
    expect(cell("2026-08").status).toBe("outside")
    expect(cell("2027-09").status).toBe("outside")
    expect(cell("2026-09", [], [], lease({ startDate: "2026-09-26" })).status).toBe("missing")
    expect(cell("2027-08", [], [], lease({ endDate: "2027-08-10" })).status).toBe("due-later")
  })

  it("counts a payment for the month it covers, not the month it arrived", () => {
    const november2 = new Date(2026, 10, 2)
    const octoberPaid = both("2026-10", { date: november2 })
    expect(cellOf(lease(), "2026-10", { movements: octoberPaid, costs: [] }, "2026-11-20").status).toBe("paid")
    expect(cellOf(lease(), "2026-11", { movements: octoberPaid, costs: [] }, "2026-11-20").status).toBe("not-yet")
    expect(cellOf(lease(), "2026-11", { movements: octoberPaid, costs: [] }, "2026-12-02").status).toBe("missing")
  })

  it("ignores another lease's payments and rows with no lease", () => {
    const other = both("2026-09", { leaseId: "l2" })
    const loose = both("2026-09", { leaseId: null, rentMonth: null, rentPart: null })
    expect(cell("2026-09", [...other, ...loose]).status).toBe("missing")
  })
})

describe("cellOf: an agreed amount", () => {
  const agreed = lease({ agreedMonths: { "2026-09": { amount: 800, note: "Moved in on 26 Sep" } } })

  it("replaces rent + contribution for that month only", () => {
    const sep = cell("2026-09", [pay({ amount: 800 })], [], agreed)
    expect(sep).toMatchObject({ status: "paid", due: 800, agreed: { amount: 800, note: "Moved in on 26 Sep" } })
    expect(cell("2026-10", [], [], agreed)).toMatchObject({ due: 1100, agreed: null })
  })
})

describe("cellOf: an offset", () => {
  it("is reported when linked to the lease and month, never when unlinked or for another month", () => {
    const full = both("2026-10")
    expect(cell("2026-10", full, [offset()]).offset).toBe(520)
    expect(cell("2026-10", full, [offset({ leaseId: null })]).offset).toBe(0)
    expect(cell("2026-10", full, [offset({ leaseId: "l2" })]).offset).toBe(0)
    expect(cell("2026-10", full, [offset({ forMonth: "2026-09" })]).offset).toBe(0)
  })

  it("keeps Paid at what the payments cover: the full payment is recorded beside the cost (no double count)", () => {
    expect(cell("2026-10", both("2026-10"), [offset()])).toMatchObject({ status: "paid", paid: 1100, offset: 520 })
  })
})

describe("cellOf: Not invoiced", () => {
  it("shows when any payment of a paid month has no invoice number", () => {
    expect(cell("2026-09", both("2026-09")).invoiced).toBe(true)
    expect(cell("2026-09", [pay(), pay({ rentPart: "contribution", amount: 150, documentRef: null })]).invoiced).toBe(false)
    expect(cell("2026-09", [pay(), pay({ rentPart: "contribution", amount: 150, documentRef: "  " })]).invoiced).toBe(false)
  })
})

describe("propertyGrid", () => {
  const renewal = lease({ id: "l2", startDate: "2027-09-01", endDate: "2028-08-31", rent: 1000 })
  const elena = lease({ id: "l3", tenantId: "t2", room: "Room 1" })

  it("has a row per tenant and room, a renewal continuing on the same row, ordered by room", () => {
    const g = propertyGrid({ leases: [elena, renewal, lease()], year: 2027, movements: [], costs: [], today: TODAY })
    expect(g.rows.map((r) => [r.tenantId, r.room])).toEqual([["t2", "Room 1"], ["t1", "Room 4"]])
    const row = g.rows[1]
    expect(row.cells["2027-08"]?.due).toBe(1100)
    expect(row.cells["2027-09"]?.due).toBe(1150)
  })

  it("hides the months before the year's first lease and keeps the rest", () => {
    const g = propertyGrid({ leases: [lease()], year: 2026, movements: [], costs: [], today: TODAY })
    expect(g.months[0]).toBe("2026-09")
    expect(g.months).toHaveLength(4)
    expect(g.hiddenBefore).toBe(8)
  })

  it("totals Owed per tenant and a footer per month: due, paid, owed, and not-yet kept apart", () => {
    const movements = [...both("2026-09"), pay({ leaseId: "l3", rentMonth: "2026-09", amount: 1050 })]
    const g = propertyGrid({ leases: [lease(), elena], year: 2026, movements, costs: [], today: TODAY })
    expect(g.rows.find((r) => r.tenantId === "t2")?.owed).toBe(50)
    expect(g.rows.find((r) => r.tenantId === "t1")?.owed).toBe(0)
    expect(g.footer["2026-09"]).toEqual({ due: 2200, paid: 2150, owed: 50, notYet: 0 })
    expect(g.footer["2026-10"]).toEqual({ due: 2200, paid: 0, owed: 0, notYet: 2200 })
    expect(g.footer["2026-11"]).toEqual({ due: 2200, paid: 0, owed: 0, notYet: 0 })
    expect(g.owed).toBe(50)
  })
})

describe("propertyGrid: across years and renewals", () => {
  const months = ["2026-09", "2026-10", "2026-11", "2027-01"]
  it("keeps an earlier year's missing month in Owed when another year is shown", () => {
    const movements = months.flatMap((m) => both(m))
    const g = propertyGrid({ leases: [lease()], year: 2027, movements, costs: [], today: "2027-01-15" })
    expect(g.rows[0].owed).toBe(1100)
    expect(g.owed).toBe(1100)
  })

  it("counts a payment linked to the old lease in the month a renewal starts mid-month", () => {
    const old = lease({ startDate: "2026-09-26", endDate: "2027-09-25" })
    const renewed = lease({ id: "l2", startDate: "2027-09-26", endDate: "2028-09-25" })
    const movements = both("2027-09") // linked to l1
    const g = propertyGrid({ leases: [old, renewed], year: 2027, movements, costs: [offset({ forMonth: "2027-09" })], today: "2027-11-01" })
    expect(g.rows[0].cells["2027-09"]).toMatchObject({ leaseId: "l2", status: "paid", paid: 1100, offset: 520 })
    const direct = cellOf(renewed, "2027-09", { movements, costs: [] }, "2027-11-01", [old, renewed])
    expect(direct.status).toBe("paid")
  })
})

describe("owedFamilies", () => {
  const last = lease({ rent: 500, contribution: 0, startDate: "2026-01-01", endDate: "2026-12-31" })
  const at = (leases: Lease[], movements: RentMovement[] = []) => owedFamilies({ leases, movements, costs: [], today: "2027-01-10" })
  const paidMonths = (ms: string[]) => ms.map((m) => pay({ rentMonth: `2026-${m}`, amount: 500 }))

  it("counts a lease that ended last year in full, though no lease runs this year", () => {
    expect(at([last]).map((r) => [r.tenantId, r.room, r.owed, r.missed.length])).toEqual([["t1", "Room 4", 6000, 12]])
  })

  it("leaves out a family that is paid up", () => {
    expect(at([last], paidMonths(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]))).toEqual([])
  })

  it("counts a renewal family's months once, on one row headed by the latest lease", () => {
    const first = lease({ rent: 500, contribution: 0, startDate: "2026-01-01", endDate: "2026-06-15" })
    const renewed = lease({ id: "l2", rent: 500, contribution: 0, startDate: "2026-06-16", endDate: "2026-12-31" })
    const rows = at([first, renewed], paidMonths(["01", "02", "03"]))
    expect(rows.map((r) => [r.owed, r.missed.length, r.lease.id])).toEqual([[4500, 9, "l2"]])
  })
})

describe("splitPayment", () => {
  it("makes a rent row and a contribution row, leaving out a part that is 0", () => {
    expect(splitPayment({ rent: 950, contribution: 150 })).toEqual([{ part: "rent", amount: 950 }, { part: "contribution", amount: 150 }])
    expect(splitPayment({ rent: 1000, contribution: 0 })).toEqual([{ part: "rent", amount: 1000 }])
  })
})

describe("depositOf: the deposit held for a tenant's room", () => {
  const dep = (o: Partial<RentMovement>): RentMovement => ({ ...pay(), rentMonth: null, rentPart: null, kind: "deposit_held", direction: "in", amount: 1500, ...o })
  const renewal = lease({ id: "l2", startDate: "2027-09-01", endDate: "2028-08-31" })
  const other = lease({ id: "l3", tenantId: "t2", room: "Room 2" })

  it("is received less given back, linked by lease", () => {
    const income = { ...pay(), leaseId: "l1", rentMonth: "2026-09", rentPart: "rent" as const, kind: "income", direction: "in", amount: 700 } // a rent row on the same lease is not a deposit
    expect(depositOf(lease(), [lease()], [dep({}), income, dep({ id: "r", direction: "out", amount: 400 })])).toEqual({ held: 1100, accountId: undefined, counterparty: undefined })
    expect(depositOf(lease(), [lease()], [])).toBeNull()
  })

  it("hands over the name the deposit came in under, the latest received", () => {
    const rows = [dep({ counterparty: "Room 4", date: new Date(2026, 0, 2) }), dep({ id: "r2", counterparty: "Room 4 B", amount: 100, date: new Date(2026, 2, 2) }), dep({ id: "r3", direction: "out", amount: 50, counterparty: "Someone", date: new Date(2026, 4, 2) })]
    expect(depositOf(lease(), [lease()], rows)?.counterparty).toBe("Room 4 B")
  })

  it("never shows a negative deposit: giving back more than was linked as received leaves 0", () => {
    expect(depositOf(lease(), [lease()], [dep({ direction: "out", amount: 1500 })])?.held).toBe(0)
    expect(depositOf(lease(), [lease()], [dep({ amount: 500 }), dep({ id: "r", direction: "out", amount: 1500 })])?.held).toBe(0)
  })

  it("counts each room of a tenant on its own", () => {
    const room2 = lease({ id: "l4", room: "Room 2" })
    const rows = [dep({}), dep({ id: "r2", leaseId: "l4", amount: 900 })]
    expect(depositOf(lease(), [lease(), room2], rows)?.held).toBe(1500)
    expect(depositOf(room2, [lease(), room2], rows)?.held).toBe(900)
  })

  it("ignores another lease's deposit, even to the same counterparty", () => {
    expect(depositOf(lease(), [lease(), other], [dep({ leaseId: "l3" }), dep({ leaseId: null })])).toBeNull()
  })

  it("carries over a renewal and counts once, on the current lease only", () => {
    const all = [lease(), renewal]
    const rows = [dep({ accountId: "a1" })]
    expect(depositOf(renewal, all, rows)).toEqual({ held: 1500, accountId: "a1" })
    expect(depositOf(lease(), all, rows)).toBeNull()
  })

  it("keeps the deposit when it was given back on the renewal", () => {
    expect(depositOf(renewal, [lease(), renewal], [dep({}), dep({ id: "r", leaseId: "l2", direction: "out", amount: 1500 })])).toEqual({ held: 0, accountId: undefined })
  })
})
