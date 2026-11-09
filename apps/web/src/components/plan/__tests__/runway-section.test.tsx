import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { format } from "date-fns"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { buildRunway } from "@/lib/runway"

import { RunwaySection } from "../runway-section"

import type { ProjectionMonth } from "@/lib/projection"

// happy-dom never lays out: the chart measures nothing and draws at its default width.
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} })
})

/** 2026-07 (this month, left out) then one month per net. */
function timeline(nets: number[]): ProjectionMonth[] {
  return [0, ...nets].map((net, i) => ({
    yearMonth: format(new Date(2026, 6 + i, 1), "yyyy-MM"),
    lines: [], revenue: Math.max(net, 0), costs: Math.max(-net, 0), collaborators: 0, otherCosts: 0,
  }))
}

function setup(o: { start: number; floor: number | null; nets: number[]; accounts?: number; held?: number }) {
  const tl = timeline(o.nets)
  const onSaveFloor = vi.fn().mockResolvedValue(undefined)
  render(
    <RunwaySection
      runway={buildRunway({ start: o.start, floor: o.floor, timeline: tl })}
      horizon={tl.length}
      scenarioLabel="Contracts Only"
      today={new Date(2026, 6, 14)}
      accountCount={o.accounts ?? 2}
      heldDeposits={o.held ?? 0}
      onSaveFloor={onSaveFloor}
    />,
  )
  const headline = screen.getByRole("region", { name: "Runway headline" })
  const card = (label: string) => within(headline).getByText(label).parentElement!.textContent
  return { onSaveFloor, card }
}

describe("RunwaySection headline", () => {
  it("runs out: covered until the month before, the floor month with its balance, deposits named", () => {
    const { card } = setup({ start: 1000, floor: 500, nets: [-300, -300, -300, -300], held: 200 })
    expect(card("Covered Until")).toBe("Covered UntilOct 2026Then Nov 2026 would go under €0, before your pay, VAT and taxes.")
    expect(card("Money Today")).toBe("Money Today€1,0002 company accounts · 14 Jul. Includes €200 of tenants’ deposits you hold")
    expect(card("Under Your Floor")).toBe("Under Your FloorSep 2026First month under €500: the balance is €400.")
  })

  it("never runs out and never goes under the floor", () => {
    const { card } = setup({ start: 1000, floor: 500, nets: [100, 100], accounts: 1 })
    expect(card("Covered Until")).toBe("Covered UntilBeyond Sep 2026The balance stays at or above €0 for all 2 months the Plan looks ahead.")
    expect(card("Money Today")).toBe("Money Today€1,0001 company account · 14 Jul")
    expect(card("Under Your Floor")).toBe("Under Your FloorNeverStays at or above €500 for all 2 months.")
  })

  it("starts below zero and under the floor, then recovers", () => {
    const { card } = setup({ start: -300, floor: 500, nets: [400, 400, 400, -2000] })
    expect(card("Covered Until")).toBe("Covered UntilNot todayAccounts are €300 below €0. Back above it in Aug 2026, then covered until Oct 2026.")
    expect(card("Under Your Floor")).toBe("Under Your FloorNow-€300 is under €500. Back above it in Sep 2026, under it again from Nov 2026.")
  })

  it("has no floor set", () => {
    const { card } = setup({ start: 1000, floor: null, nets: [100] })
    expect(card("Under Your Floor")).toBe("Under Your FloorNo floor setSet a floor to see the first month the balance goes under it.")
  })
})

describe("RunwaySection table", () => {
  it("starts at today and tags the floor month and the month the money runs out, in words", () => {
    setup({ start: 1000, floor: 500, nets: [-300, -300, -300, -300] })
    const rows = screen.getAllByRole("row").slice(1).map((r) => r.textContent)
    expect(rows).toEqual([
      "Today14 Jul–€1,000",
      "Aug 2026August 2026-€300€700",
      "Sep 2026September 2026Under your floor-€300€400",
      "Oct 2026October 2026-€300€100",
      "Nov 2026November 2026Money runs out-€300-€200",
    ])
  })
})

const rowTexts = () => screen.getAllByRole("row").slice(1).map((r) => r.textContent)

describe("RunwaySection condensed table", () => {
  // 12 rows, Aug 2026 to Jul 2027: under the floor in Jan 2027, under €0 in Jun 2027.
  const long = { start: 10000, floor: 5000, nets: Array<number>(12).fill(-1000) }

  it("shows the first two rows, the crossings with their neighbours and the last, the quiet stretches folded", () => {
    setup(long)
    expect(rowTexts()).toEqual([
      "Today14 Jul–€10,000",
      "Aug 2026August 2026-€1,000€9,000",
      "Sep 2026September 2026-€1,000€8,000",
      "… Oct 2026 to Nov 2026 …",
      "Dec 2026December 2026-€1,000€5,000",
      "Jan 2027January 2027Under your floor-€1,000€4,000",
      "Feb 2027February 2027-€1,000€3,000",
      "… Mar 2027 to Apr 2027 …",
      "May 2027May 2027-€1,000€0",
      "Jun 2027June 2027Money runs out-€1,000-€1,000",
      "Jul 2027July 2027-€1,000-€2,000",
    ])
  })

  it("expands to every month and folds back", () => {
    setup(long)
    fireEvent.click(screen.getByRole("button", { name: "Show 12 Months" }))
    expect(rowTexts()).toHaveLength(13)
    fireEvent.click(screen.getByRole("button", { name: "Show Fewer Months" }))
    expect(rowTexts()).toHaveLength(11)
  })

  it("tags the month the money runs out again after a start below zero", () => {
    setup({ start: -300, floor: null, nets: [400, 400, 400, -2000] })
    expect(rowTexts()).toEqual([
      "Today14 Jul–-€300",
      "Aug 2026August 2026Back above €0€400€100",
      "Sep 2026September 2026€400€500",
      "Oct 2026October 2026€400€900",
      "Nov 2026November 2026Money runs out-€2,000-€1,100",
    ])
  })

  it("tags the month back above the floor and the month under it again", () => {
    setup({ start: 200, floor: 500, nets: [400, -300] })
    expect(rowTexts()).toEqual([
      "Today14 Jul–€200",
      "Aug 2026August 2026Back above your floor€400€600",
      "Sep 2026September 2026Under your floor again-€300€300",
    ])
  })
})

describe("RunwaySection floor", () => {
  it("saves the typed amount", async () => {
    const { onSaveFloor } = setup({ start: 1000, floor: 500, nets: [100] })
    fireEvent.click(screen.getByRole("button", { name: "Floor €500" }))
    const dialog = screen.getByRole("dialog", { name: "Set Floor" })
    const input = within(dialog).getByLabelText("Floor")
    fireEvent.change(input, { target: { value: "750" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(onSaveFloor).toHaveBeenCalledWith(750))
  })

  it("removes the floor with an empty field", async () => {
    const { onSaveFloor } = setup({ start: 1000, floor: 500, nets: [100] })
    fireEvent.click(screen.getByRole("button", { name: "Floor €500" }))
    fireEvent.click(screen.getByRole("button", { name: "Remove Floor" }))
    await waitFor(() => expect(onSaveFloor).toHaveBeenCalledWith(null))
  })

  it("offers to set a floor when there is none, and refuses a negative one", async () => {
    const { onSaveFloor } = setup({ start: 1000, floor: null, nets: [100] })
    fireEvent.click(screen.getByRole("button", { name: "Set Floor" }))
    const dialog = screen.getByRole("dialog", { name: "Set Floor" })
    fireEvent.change(within(dialog).getByLabelText("Floor"), { target: { value: "-5" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    expect(onSaveFloor).not.toHaveBeenCalled()
    expect(within(dialog).getByText("Enter 0 or more, or leave it empty for no floor.")).toBeInTheDocument()
  })
})
