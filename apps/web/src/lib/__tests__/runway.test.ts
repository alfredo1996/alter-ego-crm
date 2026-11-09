import { describe, expect, it } from "vitest"

import { buildRunway } from "../runway"

import type { ProjectionMonth } from "../projection"

/** A timeline from the current month (2026-07, left out of the runway) with one net per month after it. */
function timeline(nets: number[]): ProjectionMonth[] {
  return [0, ...nets].map((net, i) => {
    const yearMonth = `2026-${String(7 + i).padStart(2, "0")}`
    return { yearMonth, lines: [], revenue: Math.max(net, 0) + 50, costs: Math.max(-net, 0) + 50, collaborators: 0, otherCosts: 50 }
  })
}

describe("buildRunway", () => {
  it("adds each month's net to today's balance, leaving the current month out", () => {
    const r = buildRunway({ start: 1000, floor: null, timeline: timeline([100, -250, 50]) })
    expect(r.rows).toEqual([
      { yearMonth: "2026-08", net: 100, balance: 1100 },
      { yearMonth: "2026-09", net: -250, balance: 850 },
      { yearMonth: "2026-10", net: 50, balance: 900 },
    ])
  })

  it("never runs out when the balance stays at or above zero", () => {
    const r = buildRunway({ start: 1000, floor: null, timeline: timeline([100, 100]) })
    expect(r).toMatchObject({ coveredUntil: "beyond", runsOut: null, floorState: "none" })
  })

  it("runs out mid-year: covered until the month before the first negative balance", () => {
    const r = buildRunway({ start: 1000, floor: null, timeline: timeline([-400, -400, -400, -400]) })
    expect(r).toMatchObject({ runsOut: "2026-10", coveredUntil: "2026-09" })
  })

  it("is covered only until this month when the first month goes under zero", () => {
    const r = buildRunway({ start: 100, floor: null, timeline: timeline([-400, 900]) })
    expect(r).toMatchObject({ runsOut: "2026-08", coveredUntil: "2026-07" })
  })

  it("starts below zero: not covered today, then back above and covered until", () => {
    const r = buildRunway({ start: -300, floor: null, timeline: timeline([200, 200, 200, -900]) })
    expect(r).toMatchObject({ coveredUntil: null, runsOut: null, backAboveZero: "2026-09", thenUntil: "2026-10" })
    expect(buildRunway({ start: -300, floor: null, timeline: timeline([200, 200, 200]) }).thenUntil).toBe("beyond")
  })

  it("finds the first month under a floor, and its balance", () => {
    const r = buildRunway({ start: 1000, floor: 500, timeline: timeline([-300, -300, -300]) })
    expect(r).toMatchObject({ floorState: "will", belowFloor: "2026-09", belowFloorBalance: 400 })
  })

  it("stays above the floor: never", () => {
    expect(buildRunway({ start: 1000, floor: 500, timeline: timeline([100, -100]) }).floorState).toBe("never")
  })

  it("starts under the floor, recovers, and goes under it again", () => {
    const r = buildRunway({ start: 300, floor: 500, timeline: timeline([100, 100, 100, -300]) })
    expect(r).toMatchObject({ floorState: "now", backAboveFloor: "2026-09", belowFloorAgain: "2026-11" })
  })

  it("never gets back above a floor it starts under", () => {
    const r = buildRunway({ start: 300, floor: 500, timeline: timeline([10, 10]) })
    expect(r).toMatchObject({ floorState: "now", backAboveFloor: null, belowFloorAgain: null })
  })

  it("a floor of 0 counts: a balance at the floor is not under it", () => {
    expect(buildRunway({ start: 100, floor: 0, timeline: timeline([-100, -1]) })).toMatchObject({ floorState: "will", belowFloor: "2026-09" })
  })
})
