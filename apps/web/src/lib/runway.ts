/**
 * Cash runway: the company accounts' balance today, then each later month adds the
 * plan's net (the Projection's own revenue − costs). The current month is left out:
 * what has happened in it is already in the balance.
 *
 * Cash flow only. Pay, loan repayments, VAT and taxes are not subtracted, so the
 * runway overstates cover; the page says so. The app never computes taxes.
 */

import type { ProjectionMonth } from "./projection"

export interface RunwayMonth {
  yearMonth: string
  net: number
  /** The balance at the end of the month. */
  balance: number
}

export interface Runway {
  start: number
  floor: number | null
  rows: RunwayMonth[]
  /** The first month the balance is below 0, when it starts at or above 0. */
  runsOut: string | null
  /** The last month before it: "beyond" = all months; the current month = the very first goes under; null = starts below 0. */
  coveredUntil: string | "beyond" | null
  /** Starting below 0: the first month back at or above it, and how long it then lasts. */
  backAboveZero: string | null
  thenUntil: string | "beyond" | null
  /** none: no floor set; now: starts under it; will: goes under it later; never. */
  floorState: "none" | "now" | "will" | "never"
  belowFloor: string | null
  belowFloorBalance: number | null
  backAboveFloor: string | null
  belowFloorAgain: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildRunway(input: { start: number; floor: number | null; timeline: ProjectionMonth[] }): Runway {
  const { start, floor, timeline } = input
  let balance = start
  const rows = timeline.slice(1).map((m) => {
    const net = round2(m.revenue - m.costs)
    return { yearMonth: m.yearMonth, net, balance: (balance = round2(balance + net)) }
  })
  const out = rows.findIndex((r) => r.balance < 0)
  const r: Runway = {
    start,
    floor,
    rows,
    runsOut: start >= 0 && out >= 0 ? rows[out].yearMonth : null,
    coveredUntil: start < 0 ? null : out === -1 ? "beyond" : out === 0 ? (timeline[0]?.yearMonth ?? null) : rows[out - 1].yearMonth,
    backAboveZero: null,
    thenUntil: null,
    floorState: "none",
    belowFloor: null,
    belowFloorBalance: null,
    backAboveFloor: null,
    belowFloorAgain: null,
  }
  if (start < 0) {
    const i0 = rows.findIndex((x) => x.balance >= 0)
    if (i0 >= 0) {
      r.backAboveZero = rows[i0].yearMonth
      const j = rows.findIndex((x, i) => i > i0 && x.balance < 0)
      r.thenUntil = j === -1 ? "beyond" : rows[j - 1].yearMonth
    }
  }
  return withFloor(r, floor)
}

/** The same runway read against another floor (the Set Floor dialog's preview). */
export function withFloor(r: Runway, floor: number | null): Runway {
  const { rows, start } = r
  const out: Runway = { ...r, floor, floorState: "none", belowFloor: null, belowFloorBalance: null, backAboveFloor: null, belowFloorAgain: null }
  if (floor == null) return out
  if (start < floor) {
    out.floorState = "now"
    const i0 = rows.findIndex((x) => x.balance >= floor)
    if (i0 >= 0) {
      out.backAboveFloor = rows[i0].yearMonth
      out.belowFloorAgain = rows.slice(i0).find((x) => x.balance < floor)?.yearMonth ?? null
    }
    return out
  }
  const f = rows.find((x) => x.balance < floor)
  out.floorState = f ? "will" : "never"
  out.belowFloor = f?.yearMonth ?? null
  out.belowFloorBalance = f?.balance ?? null
  return out
}
