import { describe, expect, it } from "vitest"

import { collaboratorFields, createCollaboratorSchema, MAX_FEE_CHANGES, normalizeCollaboratorFee } from "@/types/schemas"

import { feeChangeEvents, feeIn, quarterNote, fixedCostFor, monthlyFees, quarterCost, summarizeFee } from "../collaborators"

import type { Collaborator, CollaboratorFee } from "@/types"

const NOW = new Date("2026-01-01")
const fee = (o: Partial<CollaboratorFee> = {}): CollaboratorFee => ({
  amount: 2400, from: "2026-01", until: null, changes: [], ...o,
})
const collab = (o: Partial<Collaborator> = {}): Collaborator => ({
  id: "c1", userId: "u1", name: "Studio Verdi", type: "company", notes: null, isActive: true,
  fee: fee(), createdAt: NOW, updatedAt: NOW, ...o,
})

describe("feeIn: the fee in force in a month", () => {
  const f = fee({ until: "2027-06", changes: [{ from: "2027-03", amount: 2600 }, { from: "2027-05", amount: 2800 }] })
  it.each([
    ["before it starts", "2025-12", 0],
    ["its first month", "2026-01", 2400],
    ["the month before a change", "2027-02", 2400],
    ["the month of a change", "2027-03", 2600],
    ["after the first change, before the second", "2027-04", 2600],
    ["after the second change", "2027-05", 2800],
    ["its last month", "2027-06", 2800],
    ["the month after it ends", "2027-07", 0],
  ])("%s", (_, month, expected) => {
    expect(feeIn(f, month)).toBe(expected)
  })

  it("is 0 with no fee, and runs on with no end", () => {
    expect(feeIn(null, "2026-05")).toBe(0)
    expect(feeIn(fee(), "2040-01")).toBe(2400)
  })

  it("reads changes in any order", () => {
    const shuffled = fee({ changes: [{ from: "2027-05", amount: 2800 }, { from: "2027-03", amount: 2600 }] })
    expect(feeIn(shuffled, "2027-04")).toBe(2600)
  })
})

describe("fixedCostFor / monthlyFees: only active collaborators count", () => {
  const list = [
    collab(),
    collab({ id: "c2", name: "Lab Nove", isActive: false, fee: fee({ amount: 900 }) }),
    collab({ id: "c3", name: "Giulia", fee: null }),
  ]
  it("sums the fees of the active ones", () => {
    expect(fixedCostFor(list, "2026-05")).toBe(2400)
    expect(fixedCostFor(list, "2025-12")).toBe(0)
  })
  it("monthlyFees is the same figure for the strip", () => {
    expect(monthlyFees(list, "2026-05")).toBe(2400)
  })
})

describe("quarterCost", () => {
  it("adds the three months, the change inside the quarter included", () => {
    const c = collab({ fee: fee({ changes: [{ from: "2026-12", amount: 3000 }] }) })
    expect(quarterCost(c, 2026, 4)).toBe(2400 + 2400 + 3000)
  })
  it("is 0 for an inactive collaborator, or one with no fee", () => {
    expect(quarterCost(collab({ isActive: false }), 2026, 4)).toBe(0)
    expect(quarterCost(collab({ fee: null }), 2026, 4)).toBe(0)
  })
})

describe("feeChangeEvents: the markers on the Projection", () => {
  const list = [
    collab({ fee: fee({ changes: [{ from: "2027-03", amount: 2600 }] }) }),
    collab({ id: "c2", name: "Marco Bianchi", fee: fee({ amount: 1500, from: "2026-10", until: "2027-03" }) }),
  ]
  it("marks a change in its month and the stop in the first month without the fee", () => {
    expect(feeChangeEvents(list, "2027-03")).toEqual([{ kind: "changes", name: "Studio Verdi" }])
    expect(feeChangeEvents(list, "2027-04")).toEqual([{ kind: "stops", name: "Marco Bianchi" }])
    expect(feeChangeEvents(list, "2027-02")).toEqual([])
  })
  it("marks the stop in January when the fee ends in December", () => {
    const c = collab({ fee: fee({ from: "2026-10", until: "2026-12" }) })
    expect(feeChangeEvents([c], "2027-01")).toEqual([{ kind: "stops", name: "Studio Verdi" }])
    expect(feeChangeEvents([c], "2026-12")).toEqual([])
  })
  it("ignores inactive collaborators", () => {
    expect(feeChangeEvents(list.map((c) => ({ ...c, isActive: false })), "2027-03")).toEqual([])
  })
})

describe("summarizeFee: the card's line", () => {
  it.each([
    ["no fee", null, "2026-10", { today: 0, next: null, ends: null }],
    ["a change ahead", fee({ changes: [{ from: "2027-03", amount: 2600 }] }), "2026-10", { today: 2400, next: { from: "2027-03", amount: 2600 }, ends: null }],
    ["an end ahead", fee({ until: "2027-03" }), "2026-10", { today: 2400, next: null, ends: "2027-03" }],
    ["not started", fee({ from: "2027-01" }), "2026-10", { today: 0, next: null, ends: null }],
    ["ended", fee({ until: "2026-06" }), "2026-10", { today: 0, next: null, ends: "2026-06" }],
  ])("%s", (_, f, month, expected) => {
    expect(summarizeFee(f, month)).toEqual(expected)
  })
})

describe("the fee's validation", () => {
  const parse = (f: unknown) => createCollaboratorSchema.safeParse({ name: "A", type: "company", fee: f })
  const message = (f: unknown) => {
    const r = parse(f)
    return r.success ? null : r.error.issues[0].message
  }
  it.each([
    ["an end before the start", fee({ until: "2025-12" }), "The end is before the start"],
    ["a change on the start month", fee({ changes: [{ from: "2026-01", amount: 1 }] }), "A change starts after the fee does"],
    ["a change after the end", fee({ until: "2026-06", changes: [{ from: "2026-07", amount: 1 }] }), "A change falls after the end"],
    ["two changes in a month", fee({ changes: [{ from: "2026-03", amount: 1 }, { from: "2026-03", amount: 2 }] }), "Two changes start in the same month"],
    ["a zero amount", fee({ amount: 0 }), "The fee is more than 0"],
  ])("refuses %s", (_, f, msg) => {
    expect(message(f)).toBe(msg)
  })
  it("accepts a fee with no end and sorts the changes", () => {
    const stored = collaboratorFields({
      name: " Studio ", type: "company",
      fee: fee({ changes: [{ from: "2026-05", amount: 3 }, { from: "2026-03", amount: 2 }] }),
    })
    expect(stored.name).toBe("Studio")
    expect(stored.fee?.changes.map((c) => c.from)).toEqual(["2026-03", "2026-05"])
  })
  it("names an empty name in English", () => {
    const r = createCollaboratorSchema.safeParse({ name: " ", type: "company" })
    expect(r.success ? null : r.error.issues[0].message).toBe("Name is required")
  })
})

describe("normalizeCollaboratorFee: a stored fee, mended on read", () => {
  const base = { amount: 2400, from: "2026-01", until: "2026-12" }
  const bad = (x: unknown) => normalizeCollaboratorFee({ ...base, changes: x })

  it("keeps the good changes in order, drops the bad, the doubled and the out-of-range ones", () => {
    const fee = bad([
      { from: "2026-09", amount: 3000 },
      { from: "2026-05", amount: 2600 },
      { from: "2026-05", amount: 9999 }, // same month twice: the first stays
      { from: "2026-13", amount: 1 }, // not a month
      { from: "2026-06", amount: "x" }, // not a number
      { from: "2026-01", amount: 1 }, // not after the fee starts
      { from: "2027-01", amount: 1 }, // after the end
      "a".repeat(1000),
      { from: "2026-07", amount: 1, nested: { a: 1 } },
    ])
    expect(fee?.changes).toEqual([
      { from: "2026-05", amount: 2600 },
      { from: "2026-07", amount: 1 },
      { from: "2026-09", amount: 3000 },
    ])
    expect(fee).toMatchObject(base)
  })

  it("keeps the first 24 changes at most", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ from: `${2027 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, amount: 1 }))
    expect(normalizeCollaboratorFee({ amount: 1, from: "2026-01", until: null, changes: many })?.changes).toHaveLength(MAX_FEE_CHANGES)
  })

  it.each([
    ["no fee", null],
    ["a bad amount", { ...base, amount: 0, changes: [] }],
    ["a bad start", { ...base, from: "soon", changes: [] }],
    ["an end before the start", { ...base, until: "2025-12", changes: [] }],
  ])("is null for %s", (_n, raw) => {
    expect(normalizeCollaboratorFee(raw)).toBeNull()
  })

  it("reads a non-list changes as none", () => {
    expect(bad("oops")?.changes).toEqual([])
  })
})

describe("quarterNote: the words under a card's quarter figure", () => {
  const withChange = fee({ changes: [{ from: "2027-03", amount: 2600 }] })
  it.each<[string, Partial<Collaborator>, 2026 | 2027, 1 | 4, string]>([
    ["a plain quarter", { fee: withChange }, 2026, 4, "planned"],
    ["a quarter with a change", { fee: withChange }, 2027, 1, "the change in March"],
    ["the quarter the fee ends in", { fee: fee({ until: "2027-03" }) }, 2027, 1, "the last one"],
    ["a fee that ended before the quarter", { fee: fee({ until: "2026-06" }) }, 2026, 4, "fee ended"],
    ["a fee that ended, inactive", { isActive: false, fee: fee({ until: "2026-06" }) }, 2026, 4, "fee ended"],
    ["no fee", { fee: null }, 2026, 4, "no fixed fee"],
    ["inactive", { isActive: false, fee: withChange }, 2026, 4, "inactive, out of the plan"],
    ["a fee that starts later", { fee: fee({ from: "2027-02" }) }, 2026, 4, "starts Feb 2027"],
  ])("%s", (_n, o, year, q, want) => {
    expect(quarterNote(collab(o), year, q)).toBe(want)
  })
})
