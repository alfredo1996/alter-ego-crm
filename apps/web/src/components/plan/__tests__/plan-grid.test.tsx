/**
 * Days by month's second line, over pure props: what each contract-month's hours
 * offer the plan. The rule is hoursAction's (lib/__tests__/timecards.test.ts); this
 * checks the grid shows it and hands Use the right writes. The flow end to end,
 * Undo included, is in e2e/hours.spec.ts.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toRevenueSources } from "@/lib/engagement-burndown"
import { monthHours, planCells } from "@/lib/timecards"

import { PlanGrid } from "../plan-grid"

import type { Allocation, Assignment, Client, Engagement } from "@/types"

const contract = (id: string, clientId: string, name: string, startMonth: string) =>
  ({
    id, userId: "u1", clientId, name, opportunityId: null, dailyRate: 500, vatApplicable: true, contractedDays: null,
    defaultDaysPerMonth: 10, startMonth, endMonth: null, endDate: null, isActive: true, notes: null,
  }) as Engagement
const engagements = [
  contract("e1", "c1", "Platform", "2026-07"),
  contract("e2", "c2", "Support", "2026-07"),
  contract("e3", "c3", "Later", "2026-11"),
]
const clients = [["c1", "Acme"], ["c2", "Beta"], ["c3", "Gamma"]].map(([id, name]) => ({ id, name }) as Client)
const tc = (engagementId: string, date: string, hours: number) => ({ engagementId, date, hours })
const timecards = [
  tc("e1", "2026-08-03", 80), // 10 d, as planned
  tc("e2", "2026-08-03", 264), // 33 d: more than a month holds
  tc("e1", "2026-09-01", 20), // closed month: 2.5 d against 10
  tc("e2", "2026-09-01", 4), // and 0.5 d against 10
  tc("e1", "2026-10-01", 88), // open month, above plan: raised any time
  tc("e2", "2026-10-01", 88),
  tc("e3", "2026-10-02", 8), // before its start: outside the plan
  tc("e1", "2026-11-02", 16), // open month, below plan, 1 weekday covered: pace
]
const months = ["2026-08", "2026-09", "2026-10", "2026-11"]
const rowsOf = (list: Engagement[]) =>
  toRevenueSources({ engagements: list, opportunities: [], clients, scenario: "committed" }).map((source, i) => ({
    source,
    label: `${source.clientName} · ${list[i].name}`,
    end: null,
  }))
const rows = rowsOf(engagements)

function renderGrid({ pending = false }: { pending?: boolean } = {}) {
  const onUse = vi.fn()
  render(
    <PlanGrid
      rows={rows}
      cells={planCells(engagements, [], "2026-10")}
      allocations={[]}
      hours={monthHours(timecards, "2026-10-15")}
      timecards={timecards}
      months={months}
      today="2026-10-15"
      pending={pending}
      onSet={vi.fn()}
      onUse={onUse}
    />,
  )
  return onUse
}

/** The cell of `label`'s row in month `i` of `months`. */
const cell = (label: string, i: number) =>
  within(screen.getByRole("rowheader", { name: new RegExp(`^${label}`) }).closest("tr")!).getAllByRole("cell")[i]

describe("PlanGrid", () => {
  // A cell's number and its input take turns in the same td: if their boxes differ, the table jumps on every edit.
  // The browser-measured proof is e2e/plan-stable.spec.ts; this one fails first, and without a build.
  it("opens a cell into a field of the same size", () => {
    renderGrid()
    const size = (el: HTMLElement) => [...el.classList].filter((c) => /^(pointer-coarse:)?[hw]-/.test(c)).sort()
    for (const name of ["Acme · Platform, September 2026: 10 d planned", "Beta · Support, August 2026: 10 d planned"]) {
      const button = screen.getByRole("button", { name })
      fireEvent.click(button)
      const field = screen.getByRole("spinbutton")
      expect(size(field)).toEqual(size(button))
      expect(size(field)).toContain("h-10")
      fireEvent.keyDown(field, { key: "Escape" })
    }
  })

  it("shows each cell's plan days, then what its hours offer", () => {
    renderGrid()
    expect(screen.getByRole("table", { name: "Days by Month" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Acme · Platform, September 2026: 10 d planned" })).toHaveTextContent("10")
    expect(screen.getByRole("button", { name: "Use hours: Acme · Platform, September 2026, 10 d → 2.5 d" })).toHaveTextContent(
      "Use 2.5 d",
    )
    expect(cell("Acme · Platform", 0)).toHaveTextContent("10✓")
    expect(cell("Beta · Support", 0)).toHaveTextContent("33 d: over 31")
    expect(cell("Acme · Platform", 3)).toHaveTextContent("2 of 10 d")
    expect(within(cell("Acme · Platform", 3)).getAllByRole("button")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Use hours: Acme · Platform, October 2026, 10 d → 11 d" })).toBeEnabled()
  })

  it("shows hours outside the plan muted, with no plan button and no Use", () => {
    renderGrid()
    const outside = cell("Gamma · Later", 2)
    expect(outside).toHaveTextContent("–1 d")
    expect(within(outside).queryByRole("button")).toBeNull()
    expect(within(outside).getByTitle("Not in the plan this month: set the contract's start month on Clients.")).toHaveTextContent(
      "1 d",
    )
  })

  it("offers Use All on a column whose cells offer Use, counting them", () => {
    renderGrid()
    const all = screen.getAllByRole("button", { name: /^Use All/ })
    expect(all.map((b) => b.textContent)).toEqual(["Use All (2)", "Use All (2)"])
    expect(screen.getByRole("columnheader", { name: /^Sep '26/ })).toContainElement(all[0])
    expect(screen.getByRole("columnheader", { name: /^Oct '26/ })).toContainElement(all[1])
  })

  it("offers no Use All on the open month while its hours cover under 80% of the weekdays", () => {
    const few = [tc("e1", "2026-10-01", 8), tc("e2", "2026-10-01", 8)] // 1 d against 10, hours on 1 of 22 weekdays: pace
    render(
      <PlanGrid
        rows={rows} cells={planCells(engagements, [], "2026-10")} allocations={[]} hours={monthHours(few, "2026-10-15")}
        timecards={few} months={months} today="2026-10-15" pending={false} onSet={vi.fn()} onUse={vi.fn()}
      />,
    )
    expect(within(screen.getByRole("columnheader", { name: /^Oct '26/ })).queryByRole("button")).toBeNull()
  })

  it("hands Use its contract-month's days, and Use All every one in the column", () => {
    const onUse = renderGrid()
    fireEvent.click(screen.getByRole("button", { name: /^Use hours: Acme · Platform, September 2026/ }))
    expect(onUse).toHaveBeenLastCalledWith([{ engagementId: "e1", yearMonth: "2026-09", days: 2.5 }], expect.any(String))
    fireEvent.click(within(screen.getByRole("columnheader", { name: /^Sep '26/ })).getByRole("button", { name: "Use All (2)" }))
    expect(onUse).toHaveBeenLastCalledWith(
      [
        { engagementId: "e1", yearMonth: "2026-09", days: 2.5 },
        { engagementId: "e2", yearMonth: "2026-09", days: 0.5 },
      ],
      expect.any(String),
    )
  })

  // With no start month, a contract's plan starts at its first row (contractAnchors):
  // deleting that row would drop August and September out of the plan, not back to 10.
  it("clears a contract's first closed row to the default, as a number, so its plan still starts there", () => {
    const loose = { ...engagements[0], startMonth: null }
    const allocations = [{ id: "a1", userId: "u1", engagementId: "e1", yearMonth: "2026-08", days: 12 }] as Allocation[]
    const onSet = vi.fn()
    const props = { rows: rowsOf([loose]), cells: planCells([loose], allocations, "2026-10"), hours: monthHours([], "2026-10-15"), timecards: [] }
    const { rerender } = render(
      <PlanGrid {...props} allocations={allocations} months={months} today="2026-10-15" pending={false} onSet={onSet} onUse={vi.fn()} />,
    )
    const clear = (name: string) => {
      fireEvent.click(screen.getByRole("button", { name }))
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } })
      fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "Enter" })
    }
    clear("Acme · Platform, August 2026: 12 d planned")
    expect(onSet).toHaveBeenLastCalledWith("e1", "2026-08", 10)

    // A later row is no anchor: clearing it deletes it, and the default applies again.
    const two = [...allocations, { ...allocations[0], id: "a2", yearMonth: "2026-09", days: 4 }]
    rerender(
      <PlanGrid {...props} cells={planCells([loose], two, "2026-10")} allocations={two} months={months} today="2026-10-15" pending={false} onSet={onSet} onUse={vi.fn()} />,
    )
    clear("Acme · Platform, September 2026: 4 d planned")
    expect(onSet).toHaveBeenLastCalledWith("e1", "2026-09", null)
  })

  it("heads an amended contract with the rate in force now, the next one, and the whole budget", () => {
    const amended = {
      ...engagements[0],
      contractedDays: 80,
      endMonth: "2027-01",
      amendments: [
        { from: "2026-09", dailyRate: 700, addedDays: 40, lastDay: null, lastDayBefore: null, note: null },
        { from: "2027-01", dailyRate: 800, addedDays: null, lastDay: null, lastDayBefore: null, note: null },
      ],
    }
    render(
      <PlanGrid
        rows={rowsOf([amended])}
        cells={planCells([amended], [], "2026-10")}
        allocations={[]}
        hours={monthHours([], "2026-10-15")}
        timecards={[]}
        months={months}
        today="2026-10-15"
        pending={false}
        onSet={vi.fn()}
        onUse={vi.fn()}
      />,
    )
    expect(screen.getByRole("rowheader", { name: /^Acme · Platform/ })).toHaveTextContent(
      // The next rate says why January's total moves.
      "€700/day · €800 from Jan 2027 · 120 days · until Jan 2027",
    )
  })

  // The plan is cash flow: what a month bills is days × rate, VAT not counted (Plan.dc, "net of VAT").
  it("totals each contract from this month on, and each month, net of VAT", () => {
    const only = engagements.slice(0, 1)
    render(
      <PlanGrid
        rows={rowsOf(only)}
        cells={planCells(only, [], "2026-10")}
        allocations={[]}
        hours={monthHours([], "2026-10-15")}
        timecards={[]}
        months={months}
        today="2026-10-15"
        pending={false}
        onSet={vi.fn()}
        onUse={vi.fn()}
      />,
    )
    // October and November, 10 d at €500: the Total column, the last cell of the row.
    const row = within(screen.getByRole("rowheader", { name: /^Acme · Platform/ }).closest("tr")!).getAllByRole("cell")
    expect(row[row.length - 1]).toHaveTextContent("€10,000")
    expect(row[row.length - 1]).toHaveTextContent("20 d")
    const foot = within(screen.getByRole("rowheader", { name: /^Planned billing/ }).closest("tr")!).getAllByRole("cell")
    expect(foot[2]).toHaveTextContent("€5,000")
    expect(foot[2]).toHaveTextContent("10 d")
    expect(screen.getByRole("columnheader", { name: /^Total/ })).toHaveTextContent("from Oct")
    expect(screen.getByRole("columnheader", { name: /^Oct '26/ })).toHaveTextContent("This month")
  })

  it("marks days past the contract budget with a dot, how many, and a word for a screen reader", () => {
    const capped = [{ ...engagements[0], contractedDays: 25 }]
    render(
      <PlanGrid
        rows={rowsOf(capped)}
        cells={planCells(capped, [], "2026-10")}
        allocations={[]}
        hours={monthHours([], "2026-10-15")}
        timecards={[]}
        months={months}
        today="2026-10-15"
        pending={false}
        onSet={vi.fn()}
        onUse={vi.fn()}
      />,
    )
    // 25 days over Jul, Aug, Sep... leaves 5 d for the third month: the next ones bill nothing.
    const over = screen.getAllByRole("button", { name: /, over the contract budget$/ })
    expect(over.length).toBeGreaterThan(0)
    expect(over[0]).toHaveTextContent(/\d+ over/)
  })

  it("holds Use while a plan write is in flight", () => {
    renderGrid({ pending: true })
    for (const button of screen.getAllByRole("button", { name: /^Use / })) expect(button).toBeDisabled()
  })

  it("draws a month after the contract ended as a dash a screen reader calls ended, not as a planned 0", () => {
    const ended = [{ ...engagements[0], endMonth: "2026-09" }];
    render(
      <PlanGrid
        rows={rowsOf(ended)}
        cells={planCells(ended, [], "2026-10")}
        allocations={[]}
        hours={monthHours([], "2026-10-15")}
        timecards={[]}
        months={months}
        today="2026-10-15"
        pending={false}
        onSet={vi.fn()}
        onUse={vi.fn()}
      />,
    );
    expect(cell("Acme · Platform", 2)).toHaveTextContent("—Contract ended");
    expect(within(cell("Acme · Platform", 2)).queryByRole("button")).toBeNull();
    expect(
      within(cell("Acme · Platform", 1)).getByRole("button"),
    ).toBeInTheDocument();
  });

  it("says a typed value differs from the default in words, and keeps a legend for every mark", () => {
    const allocations = [
      {
        id: "a1",
        userId: "u1",
        engagementId: "e1",
        yearMonth: "2026-08",
        days: 12,
      },
    ] as Allocation[];
    const only = engagements.slice(0, 1);
    render(
      <PlanGrid
        rows={rowsOf(only)}
        cells={planCells(only, allocations, "2026-10")}
        allocations={allocations}
        hours={monthHours([], "2026-10-15")}
        timecards={[]}
        months={months}
        today="2026-10-15"
        pending={false}
        onSet={vi.fn()}
        onUse={vi.fn()}
      />,
    );
    const changed = screen.getByRole("button", {
      name: "Acme · Platform, August 2026: 12 d planned",
    });
    expect(changed).toHaveAccessibleDescription("changed from the default");
    expect(changed).toHaveClass("font-semibold");
    expect(
      screen.getByRole("button", {
        name: "Acme · Platform, September 2026: 10 d planned",
      }),
    ).toHaveAccessibleDescription("Contract default");
    const legend = screen.getByRole("list", { name: "Legend" });
    for (const text of [
      "Taken from logged hours",
      "Changed from the contract default",
      "Over the contract budget, or planned days over the days available",
      "Contract ended",
    ])
      expect(within(legend).getByText(text)).toBeInTheDocument();
  });

  describe("on a phone", () => {
    afterEach(() => vi.unstubAllGlobals());
    const phone = (matches: boolean) =>
      vi.stubGlobal("matchMedia", () => ({
        matches,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));

    it("shows a month strip and one card per contract for the chosen month, not the table", () => {
      phone(true);
      const onSet = vi.fn();
      render(
        <PlanGrid
          rows={rows}
          cells={planCells(engagements, [], "2026-10")}
          allocations={[]}
          hours={monthHours(timecards, "2026-10-15")}
          timecards={timecards}
          months={months}
          today="2026-10-15"
          pending={false}
          onSet={onSet}
          onUse={vi.fn()}
        />,
      );
      expect(screen.queryByRole("table")).toBeNull();
      const strip = screen.getByRole("tablist", { name: "Month" });
      expect(within(strip).getAllByRole("tab")).toHaveLength(months.length);
      // The open month is chosen; its card holds the contracts that bill in it.
      expect(within(strip).getByRole("tab", { name: /^Oct/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(
        screen.getByRole("tabpanel", { name: "October 2026" }),
      ).toBeInTheDocument();
      const days = screen.getByRole("textbox", {
        name: "Acme · Platform, October 2026, days",
      });
      expect(days).toHaveAttribute("placeholder", "10");
      fireEvent.change(days, { target: { value: "7" } });
      fireEvent.blur(days);
      expect(onSet).toHaveBeenLastCalledWith("e1", "2026-10", 7);
      fireEvent.click(within(strip).getByRole("tab", { name: /^Sep/ }));
      expect(
        screen.getByRole("tabpanel", { name: "September 2026" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: /^Use hours: Acme · Platform, September 2026/,
        }),
      ).toBeInTheDocument();
    });
  });

  describe("where it opens", () => {
    // happy-dom never lays out: a 128 px Contract column, then 96 px months.
    const layout = (scrollerWidth: number) => [
      vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
        const ym = this.dataset.month
        return ym ? 128 + months.indexOf(ym) * 96 : 0
      }),
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(128),
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(scrollerWidth),
    ]
    const scroller = () => screen.getByRole("table", { name: "Days by Month" }).parentElement!

    it("on a phone, with the month just closed first: its hours are the ones Use takes", () => {
      const restore = layout(343)
      renderGrid()
      // October, the third month, is off screen: August scrolls off, September (Use) stays.
      expect(scroller().scrollLeft).toBe(96)
      restore.forEach((spy) => spy.mockRestore())
    })

    it("where it is when the current month is already in view", () => {
      const restore = layout(1200)
      renderGrid()
      expect(scroller().scrollLeft).toBe(0)
      restore.forEach((spy) => spy.mockRestore())
    })
  })
})

describe("PlanGrid, an hourly contract", () => {
  // €75/h, 40 h a month: stored as €600/day, 5 days. 20 h logged in September.
  const hourly = { ...contract("e4", "c1", "Hourly", "2026-07"), unit: "hour", dailyRate: 600, defaultDaysPerMonth: 5 } as Engagement
  function renderHourly() {
    const onUse = vi.fn()
    const onSet = vi.fn()
    render(
      <PlanGrid
        rows={rowsOf([hourly])}
        cells={planCells([hourly], [], "2026-10")}
        allocations={[]}
        hours={monthHours([tc("e4", "2026-09-01", 20)], "2026-10-15")}
        timecards={[tc("e4", "2026-09-01", 20)]}
        months={["2026-09", "2026-10"]}
        today="2026-10-15"
        pending={false}
        onSet={onSet}
        onUse={onUse}
      />,
    )
    return { onUse, onSet }
  }

  it("plans and shows its months in hours, with its terms in €/h", () => {
    renderHourly()
    expect(screen.getByRole("rowheader", { name: /^Acme · Hourly/ })).toHaveTextContent("€75/h")
    expect(screen.getByRole("button", { name: "Acme · Hourly, September 2026: 40 h planned" })).toHaveTextContent("40")
    expect(screen.getByRole("button", { name: "Use hours: Acme · Hourly, September 2026, 40 h → 20 h" })).toHaveTextContent("Use 20 h")
  })

  it("hands Use the days, and takes a typed number as hours", () => {
    const { onUse, onSet } = renderHourly()
    fireEvent.click(screen.getByRole("button", { name: /^Use hours: Acme · Hourly, September 2026/ }))
    expect(onUse).toHaveBeenCalledWith([{ engagementId: "e4", yearMonth: "2026-09", days: 2.5 }], "20 h used: Acme · Hourly, September 2026")
    fireEvent.click(screen.getByRole("button", { name: /^Acme · Hourly, October 2026/ }))
    const input = screen.getByRole("spinbutton")
    expect(input).toHaveAttribute("max", "248")
    fireEvent.change(input, { target: { value: "24" } })
    fireEvent.blur(input)
    // 24 h is 3 days: what the plan, the projection and the invoices read.
    expect(onSet).toHaveBeenCalledWith("e4", "2026-10", 3)
  })
})

describe("what is left on a contract", () => {
  // 60 d, 23.5 d worked by 15 Oct (188 h), 10 d planned in Nov and Dec, nothing after.
  const capped = { ...engagements[0], contractedDays: 60, endMonth: "2026-12" }
  const row = () => screen.getByRole("rowheader", { name: /Acme · Platform/ })
  const renderCapped = (extra: Partial<Parameters<typeof PlanGrid>[0]> = {}) =>
    render(
      <PlanGrid
        rows={rowsOf([capped])}
        cells={planCells([capped], [], "2026-10")}
        allocations={[]}
        hours={monthHours(timecards, "2026-10-15")}
        timecards={timecards}
        months={months}
        today="2026-10-15"
        pending={false}
        onSet={vi.fn()}
        onUse={vi.fn()}
        {...extra}
      />,
    )

  it("says what is left and what is not planned, and moves not planned while a month is typed", () => {
    const december = [{ id: "a1", userId: "u1", engagementId: capped.id, yearMonth: "2026-12", days: 10 }] as Allocation[]
    renderCapped({ cells: planCells([capped], december, "2026-10"), allocations: december })
    expect(row()).toHaveTextContent("36.5 d left of 60")
    expect(row()).toHaveTextContent("16.5 d not planned")
    fireEvent.click(screen.getByRole("button", { name: /^Acme · Platform, November 2026/ }))
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "14" } })
    expect(row()).toHaveTextContent("36.5 d left of 60") // typed, not saved
    expect(row()).toHaveTextContent("12.5 d not planned")
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "30" } })
    expect(row()).toHaveTextContent("3.5 d over plan") // December was typed, so it counts in full
  })

  it("clearing an explicit month after the contract's end previews 0, as saving does", () => {
    const ended = { ...capped, endMonth: "2026-10" }
    const allocations = [{ id: "a9", userId: "u1", engagementId: ended.id, yearMonth: "2026-11", days: 5 }] as Allocation[]
    renderCapped({ rows: rowsOf([ended]), cells: planCells([ended], allocations, "2026-10"), allocations })
    fireEvent.click(screen.getByRole("button", { name: /^Acme · Platform, November 2026/ }))
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } })
    const zero = row().textContent
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } })
    expect(row().textContent).not.toBe(zero)
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } })
    expect(row().textContent).toBe(zero)
  })

  describe("a month going back to its default previews what saving does", () => {
    // December (past the visible months) typed at 40 d: 5.5 d over plan, and a default November has no room left.
    const dec = { id: "a1", userId: "u1", engagementId: capped.id, yearMonth: "2026-12", days: 40 }
    const nov = { id: "a2", userId: "u1", engagementId: capped.id, yearMonth: "2026-11", days: 5 }
    const open = (stored: Allocation[], rest: string) => {
      renderCapped({ cells: planCells([capped], stored, "2026-10"), allocations: stored })
      expect(row()).toHaveTextContent(rest)
      fireEvent.click(screen.getByRole("button", { name: /^Acme · Platform, November 2026/ }))
    }

    it("opening a default cell changes nothing", () => {
      open([dec] as Allocation[], "5.5 d over plan")
      expect(row()).toHaveTextContent("5.5 d over plan")
    })

    it("clearing a stored month previews the default, capped by the room", () => {
      open([dec, nov] as Allocation[], "8.5 d over plan")
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } })
      expect(row()).toHaveTextContent("5.5 d over plan")
    })
  })

  it("reads an hourly contract in hours and a contract with no budget as no cap", () => {
    renderCapped({ rows: rowsOf([{ ...capped, unit: "hour", contractedDays: 12.5 }, { ...engagements[1], name: "Support" }]) })
    expect(screen.getByRole("rowheader", { name: /Acme · Platform/ })).toHaveTextContent("88 h over budget of 100")
    expect(screen.getByRole("rowheader", { name: /Beta · Support/ })).toHaveTextContent("No cap · 44.5 d worked")
  })
})

describe("PlanGrid with a collaborator on a contract", () => {
  const giulia: { assignment: Assignment; name: string } = {
    assignment: {
      id: "a1", userId: "u1", collaboratorId: "g", engagementId: "e1", dailyRate: 320, from: "2026-09", until: "2026-11",
      defaultDays: 4, monthDays: { "2026-11": 6 }, createdAt: new Date(), updatedAt: new Date(),
    },
    name: "Giulia Neri",
  }
  const setup = () => {
    const onSetAssignment = vi.fn()
    render(
      <PlanGrid
        rows={rows}
        cells={planCells(engagements, [], "2026-10")}
        allocations={[]}
        hours={monthHours([], "2026-10-15")}
        timecards={[]}
        months={["2026-09", "2026-10", "2026-11", "2026-12"]}
        today="2026-10-15"
        pending={false}
        onSet={vi.fn()}
        onUse={vi.fn()}
        assignments={[giulia]}
        onSetAssignment={onSetAssignment}
      />,
    )
    return onSetAssignment
  }
  const row = (name: RegExp) => within(screen.getByRole("rowheader", { name }).closest("tr")!).getAllByRole("cell")

  it("puts an 'of which' row under the contract and the owner's row, the contract's days less hers, under it", () => {
    setup()
    // Platform plans 10 a month: she does 4 (6 in November), until November; you do the rest.
    expect(row(/^of which Giulia Neri · €320\/day/).map((c) => c.textContent)).toEqual(["4", "4", "6", "—Not assigned", ""])
    expect(row(/^you/).map((c) => c.textContent)).toEqual(["6", "6", "4", "10", ""])
    expect(screen.getByRole("button", { name: "Acme · Platform, October 2026: 10 d planned" })).toHaveTextContent("10")
  })

  it("saves her days for a month, and takes the override away when emptied", () => {
    const onSetAssignment = setup()
    fireEvent.click(screen.getByRole("button", { name: /^of which Giulia Neri · €320\/day, October 2026: 4 d planned/ }))
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } })
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "Enter" })
    expect(onSetAssignment).toHaveBeenLastCalledWith("a1", "2026-10", 5)
    fireEvent.click(screen.getByRole("button", { name: /November 2026: 6 d planned/ }))
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } })
    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "Enter" })
    expect(onSetAssignment).toHaveBeenLastCalledWith("a1", "2026-11", null)
  })

  const another = (o: Record<string, unknown>) => ({ assignment: { ...giulia.assignment, ...o }, name: "Marco Rossi" })
  const setupWith = (list: Engagement[], people: { assignment: Assignment; name: string }[]) => {
    const source = rowsOf(list)
    render(
      <PlanGrid
        rows={source}
        cells={planCells(list, [], "2026-10")}
        allocations={[]}
        hours={monthHours([], "2026-10-15")}
        timecards={[]}
        months={["2026-10", "2026-11", "2026-12"]}
        today="2026-10-15"
        pending={false}
        onSet={vi.fn()}
        onUse={vi.fn()}
        assignments={people}
        onSetAssignment={vi.fn()}
      />,
    )
  }

  it("after the contract's end her cells show a dash and cannot be edited, as the projection counts none", () => {
    setupWith([{ ...engagements[0], endMonth: "2026-11" }], [{ ...giulia, assignment: { ...giulia.assignment, until: null } }])
    expect(row(/^of which Giulia Neri/).map((c) => c.textContent)).toEqual(["4", "6", "—The contract plans no days", ""])
    expect(screen.queryByRole("button", { name: /Giulia Neri.*December 2026/ })).toBeNull()
    expect(row(/^you/).map((c) => c.textContent)).toEqual(["6", "4", "0", ""])
  })

  it("two collaborators past what the contract plans: the second is shown what is left, and the rest in words", () => {
    setupWith(
      [engagements[0]],
      [
        { ...giulia, assignment: { ...giulia.assignment, defaultDays: 6, monthDays: {}, until: null } },
        { ...another({ id: "a2", collaboratorId: "m", defaultDays: 6, monthDays: {}, until: null, createdAt: new Date(Date.now() + 1000) }) },
      ],
    )
    expect(row(/^of which Giulia Neri/).slice(0, 3).map((c) => c.textContent)).toEqual(["6", "6", "6"])
    expect(row(/^of which Marco Rossi/).slice(0, 3).map((c) => c.textContent)).toEqual(["4 2 over the plan", "4 2 over the plan", "4 2 over the plan"])
    expect(screen.getByRole("button", { name: /^of which Marco Rossi.*October 2026: 4 d planned, 2 d over the plan/ })).toBeInTheDocument()
    expect(row(/^you/).slice(0, 3).map((c) => c.textContent)).toEqual(["0", "0", "0"])
  })

  describe("Your time (#332)", () => {
    afterEach(() => vi.unstubAllGlobals())
    // 22 weekdays in each of August to October 2026. Platform and Support plan 10 days each: 20 a month.
    const cap = (yearMonth: string, daysOff: number, reason: "vacation" | "training" | null, allocatedDays = 20) => ({
      yearMonth, daysOff, reason, note: null, availableDays: 22 - daysOff, allocatedDays,
      remaining: 22 - daysOff - allocatedDays, overbooked: allocatedDays > 22 - daysOff,
    })
    const capacity = [cap("2026-08", 0, null), cap("2026-09", 5, "vacation"), cap("2026-10", 2, "training"), cap("2026-11", 0, null, 22)]
    const grid = (extra: Partial<React.ComponentProps<typeof PlanGrid>> = {}) => {
      const onSetTimeOff = vi.fn()
      render(
        <PlanGrid
          rows={rows} cells={planCells(engagements, [], "2026-10")} allocations={[]} hours={monthHours(timecards, "2026-10-15")}
          timecards={timecards} months={months} today="2026-10-15" pending={false} onSet={vi.fn()} onUse={vi.fn()}
          capacity={capacity} onSetTimeOff={onSetTimeOff} {...extra}
        />,
      )
      return onSetTimeOff
    }
    const row = (name: string) => within(screen.getByRole("rowheader", { name: new RegExp(`^${name}`) }).closest("tr")!).getAllByRole("cell").map((c) => c.textContent)

    it("shows the days off, the reason under them, the days available and what you plan in words", () => {
      grid()
      expect(row("Time off")).toEqual(["–", "5vacation", "2training", "–", "2 dfrom Oct"])
      expect(row("Available")).toEqual(["22", "17", "20", "22", ""])
      expect(row("You plan")).toEqual(["202 free", "203 over", "20full", "22full", ""])
    })

    it("shows no reason line for a month set from the app, and none in its name", () => {
      grid({ capacity: [cap("2026-08", 3, null), cap("2026-09", 5, "vacation"), cap("2026-10", 0, null), cap("2026-11", 0, null)] })
      expect(row("Time off").slice(0, 2)).toEqual(["3", "5vacation"])
      expect(screen.getByRole("button", { name: "Time off, August 2026: 3 days" })).toBeTruthy()
    })

    it("leaves the block out without capacity", () => {
      grid({ capacity: undefined })
      expect(screen.queryByRole("rowheader", { name: /^Time off/ })).toBeNull()
    })

    it("types a month's days off: Enter saves, empty clears, more than the weekdays is capped, no change writes nothing", () => {
      const onSet = grid()
      const type = (name: string, value: string) => {
        fireEvent.click(screen.getByRole("button", { name }))
        fireEvent.change(screen.getByRole("spinbutton", { name: /^Time off/ }), { target: { value } })
        fireEvent.keyDown(screen.getByRole("spinbutton", { name: /^Time off/ }), { key: "Enter" })
      }
      type("Time off, August 2026: none. Click to type days off", "3")
      expect(onSet).toHaveBeenLastCalledWith("2026-08", 3)
      type("Time off, September 2026: 5 days, vacation", "")
      expect(onSet).toHaveBeenLastCalledWith("2026-09", 0)
      type("Time off, October 2026: 2 days, training", "40")
      expect(onSet).toHaveBeenLastCalledWith("2026-10", 22)
      onSet.mockClear()
      type("Time off, November 2026: none. Click to type days off", "")
      type("Time off, September 2026: 5 days, vacation", "5")
      expect(onSet).not.toHaveBeenCalled()
    })

    const onAPhone = () =>
      vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }))

    it("takes a comma as the decimal separator on the phone field", () => {
      onAPhone()
      const onSet = grid()
      const input = screen.getByRole("textbox", { name: "Time off, October 2026, days" })
      fireEvent.change(input, { target: { value: "2,5" } })
      fireEvent.blur(input)
      expect(onSet).toHaveBeenLastCalledWith("2026-10", 2.5)
    })

    it("resets a phone entry that is not a number to the stored days and says why, writing nothing", () => {
      onAPhone()
      const onSet = grid()
      const input = screen.getByRole("textbox", { name: "Time off, October 2026, days" })
      fireEvent.change(input, { target: { value: "two" } })
      fireEvent.blur(input)
      expect(onSet).not.toHaveBeenCalled()
      const reset = screen.getByRole("textbox", { name: "Time off, October 2026, days" })
      expect(reset).toHaveValue("2")
      expect(reset).toHaveAttribute("aria-invalid", "true")
      expect(screen.getByText("Type a number of days, like 2 or 2.5.")).toBeInTheDocument()
    })

    it("explains the time off entry and both meanings of the red dot in the legend", () => {
      grid()
      const legend = within(screen.getByRole("list", { name: "Legend" }))
      expect(legend.getByText("Time off: type a number of days, empty clears it")).toBeInTheDocument()
      expect(legend.getByText("Over the contract budget, or planned days over the days available")).toBeInTheDocument()
    })

    it("counts the time off in Use: with every weekday off, one logged hour lowers the open month", () => {
      const oneDay = [tc("e1", "2026-10-01", 8)]
      const props = {
        rows, cells: planCells(engagements, [], "2026-10"), allocations: [], months, today: "2026-10-15", pending: false,
        onSet: vi.fn(), onUse: vi.fn(), hours: monthHours(oneDay, "2026-10-15"), timecards: oneDay,
      }
      const { unmount } = render(<PlanGrid {...props} />)
      expect(cell("Acme · Platform", 2)).toHaveTextContent("1 of 10 d")
      unmount()
      render(<PlanGrid {...props} capacity={[cap("2026-10", 22, "vacation", 0)]} />)
      expect(cell("Acme · Platform", 2)).toHaveTextContent("Use 1 d")
    })
  })
})
