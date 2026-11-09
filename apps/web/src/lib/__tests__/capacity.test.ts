import { describe, expect, it } from "vitest"

import { capacityForMonths, loadWord, readCapacityDoc, timeOffDoc } from "@/lib/capacity"

import type { Engagement } from "@/types"



// 10 days a month from 2026-08, open-ended: the owner's load is 10 in every month.
const contract: Engagement = {
  id: "e1", userId: "u", clientId: "c1", name: null, opportunityId: null, dailyRate: 500, vatApplicable: true,
  contractedDays: null, defaultDaysPerMonth: 10, startMonth: null, endMonth: null, endDate: null, isActive: true,
  notes: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
}

describe("capacityForMonths with time off", () => {
  // 2026-08 has 21 weekdays.
  const run = (docs: Parameters<typeof capacityForMonths>[0]["capacityDocs"]) =>
    capacityForMonths({ engagements: [contract], allocations: [], capacityDocs: docs, from: "2026-08", months: 1 })[0]

  it("derives the available days from the weekdays less the days off, not from the stored pair", () => {
    const m = run([{ yearMonth: "2026-08", daysOff: 5, availableDays: 99, reason: "vacation", note: null }])
    expect(m).toMatchObject({ availableDays: 16, daysOff: 5, allocatedDays: 10, remaining: 6, overbooked: false })
  })

  it("never goes below zero", () => {
    expect(run([{ yearMonth: "2026-08", daysOff: 31, availableDays: 0, reason: "other", note: null }]).availableDays).toBe(0)
  })

  it("counts every weekday with no time off", () => {
    expect(run([])).toMatchObject({ availableDays: 21, daysOff: 0, reason: null })
  })
})

describe("readCapacityDoc", () => {
  it("reads a record with no reason as having none", () => {
    expect(readCapacityDoc({ yearMonth: "2026-08", daysOff: 1, availableDays: 20 })).toEqual({ yearMonth: "2026-08", daysOff: 1, availableDays: 20, note: null })
  })
})

describe("timeOffDoc", () => {
  it.each([
    ["a number, with no reason", { daysOff: 5 }, { daysOff: 5, availableDays: 16, note: null }],
    ["capped at the weekdays", { daysOff: 40 }, { daysOff: 21, availableDays: 0, note: null }],
    ["the connector's reason", { daysOff: 2, reason: "admin" as const }, { daysOff: 2, availableDays: 19, reason: "admin", note: null }],
    ["keeps what the connector set", { daysOff: 3, prev: { reason: "training" as const, note: "AWS" } }, { daysOff: 3, availableDays: 18, reason: "training", note: "AWS" }],
  ])("%s", (_name, input, expected) => {
    expect(timeOffDoc({ yearMonth: "2026-08", ...input })).toEqual({ yearMonth: "2026-08", ...expected })
  })

  it("writes no reason key at all when there is none (Firestore refuses undefined)", () => {
    expect("reason" in timeOffDoc({ yearMonth: "2026-08", daysOff: 1, prev: { note: null } })).toBe(false)
  })
})

describe("loadWord", () => {
  it.each([
    [22, 17, { kind: "over", text: "5 over" }],
    [17, 17, { kind: "full", text: "full" }],
    [16, 17, { kind: "free", text: "1 free" }],
    [0, 0, { kind: "full", text: "full" }],
    [2.5, 5, { kind: "free", text: "2.5 free" }],
  ])("%s planned against %s available", (planned, available, expected) => {
    expect(loadWord(planned, available)).toEqual(expected)
  })
})
