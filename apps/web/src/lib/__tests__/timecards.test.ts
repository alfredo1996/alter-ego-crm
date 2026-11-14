import { describe, expect, it } from "vitest"

import {
  cellLimits,
  hoursAction,
  hoursEdit,
  hoursLine,
  hoursRefusal,
  hoursRoom,
  planWarning,
  lastLoggableDay,
  limitMessage,
  limitRefusal,
  monthHours,
  monthPlanDays,
  noteEdit,
  parseHours,
  planCells,
  shiftDays,
  weekContracts,
  weekDays,
  weekLabel,
  weekPeople,
  weekMonday,
  weekResult,
} from "@/lib/timecards"
import { setTimecardSchema } from "@/types/schemas"

import type { Allocation, Assignment, Collaborator, Engagement } from "@/types"

const noLimits = { collaborator: false, otherHours: 0, contractLeft: null, planHours: null, monthOthers: 0 }
const valid = { engagementId: "e1", date: "2026-09-24", hours: 6, notes: null }
const ok = (over: Record<string, unknown>) => setTimecardSchema.safeParse({ ...valid, ...over }).success

describe("setTimecardSchema", () => {
  it("keeps the collaborator a timecard is for, and takes null or none for the owner's own", () => {
    expect(setTimecardSchema.parse({ ...valid, collaboratorId: "g" }).collaboratorId).toBe("g")
    expect(setTimecardSchema.parse({ ...valid, collaboratorId: null }).collaboratorId).toBeNull()
    expect(setTimecardSchema.parse(valid).collaboratorId).toBeUndefined()
    expect(ok({ collaboratorId: "" })).toBe(false)
  })

  it("accepts a day, a quarter hour, exactly 24 hours and omitted notes", () => {
    expect(ok({})).toBe(true)
    expect(ok({ hours: 0.25 })).toBe(true)
    expect(ok({ hours: 24 })).toBe(true)
    expect(setTimecardSchema.safeParse({ engagementId: "e1", date: "2026-09-24", hours: 6 }).success).toBe(true)
  })

  it.each([0, -1, 24.25, 24.5, Infinity])("rejects %s hours", (hours) => {
    expect(ok({ hours })).toBe(false)
  })

  it("accepts a real leap day", () => {
    expect(ok({ date: "2028-02-29" })).toBe(true)
  })

  it.each(["2026-02-30", "2026-02-29", "2026-04-31", "2026-13-01", "2026-9-24", "24/09/2026", "2026-09-24T10:00"])(
    "rejects the date %s",
    (date) => {
      expect(ok({ date })).toBe(false)
    },
  )

  it("caps notes at 1000 characters", () => {
    expect(ok({ notes: "x".repeat(1000) })).toBe(true)
    expect(ok({ notes: "x".repeat(1001) })).toBe(false)
  })

  it("requires a contract", () => {
    expect(ok({ engagementId: "" })).toBe(false)
  })
})

// The week of hours on /plan. vitest.config.ts pins TZ to Europe/Rome, so the DST cases are real.
describe("weeks", () => {
  const sunday = new Date(2026, 8, 27, 23, 30)

  it("names a week by its ISO Monday, from ?week= or today", () => {
    expect(weekMonday(null, sunday)).toBe("2026-09-21")
    expect(weekMonday("2026-09-24", sunday)).toBe("2026-09-21")
    expect(weekMonday("2026-09-21", sunday)).toBe("2026-09-21")
    expect(weekMonday("2026-09-28", sunday)).toBe("2026-09-28")
  })

  it.each(["2026-02-30", "abc", ""])("falls back to this week for ?week=%s", (param) => {
    expect(weekMonday(param, sunday)).toBe("2026-09-21")
  })

  it("keeps a New Year week whole: 31 December is in ISO week 53 with 3 January", () => {
    expect(weekMonday("2026-12-31", sunday)).toBe("2026-12-28")
    expect(weekMonday("2027-01-03", sunday)).toBe("2026-12-28")
    expect(weekDays("2026-12-28")).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ])
    expect(weekLabel("2026-12-28")).toBe("Week 53 · 28 Dec 2026 – 3 Jan 2027")
  })

  it("labels a week and steps over the clock changes without losing a day", () => {
    expect(weekLabel("2026-09-21")).toBe("Week 39 · 21 Sep – 27 Sep 2026")
    expect(weekDays("2026-10-19").at(-1)).toBe("2026-10-25")
    expect(shiftDays("2026-10-19", 7)).toBe("2026-10-26")
    expect(shiftDays("2026-03-30", -7)).toBe("2026-03-23")
    expect(shiftDays("2026-01-05", -7)).toBe("2025-12-29")
  })
})

describe("parseHours", () => {
  it.each([
    ["7,5", 7.5],
    ["7.5", 7.5],
    [" 8 ", 8],
    [".5", 0.5],
    ["7.", 7],
    ["24", 24],
    ["0", 0],
    ["", 0],
  ])("reads %j as %s", (text, hours) => {
    expect(parseHours(text)).toBe(hours)
  })

  it.each(["25", "24.01", "-1", "abc", "1e1", "7,5,5", "0x10", "Infinity"])("refuses %j", (text) => {
    expect(parseHours(text)).toBeNull()
  })
})

describe("lastLoggableDay", () => {
  it("is today plus 3 calendar months, clamped to the month's end", () => {
    expect(lastLoggableDay("2026-09-30")).toBe("2026-12-30")
    expect(lastLoggableDay("2026-11-30")).toBe("2027-02-28")
    expect(lastLoggableDay("2027-11-30")).toBe("2028-02-29")
  })
})

describe("hoursRefusal", () => {
  const today = "2026-09-30"
  const open = { isActive: true, startMonth: "2026-09", endMonth: null, endDate: null }

  it("takes today, tomorrow and every day up to the limit, inclusive", () => {
    expect(hoursRefusal(open, today, today)).toBeNull()
    expect(hoursRefusal(open, "2026-10-01", today)).toBeNull()
    expect(hoursRefusal(open, "2026-12-30", today)).toBeNull()
    expect(hoursRefusal(open, "2026-12-31", today)).toBe("tooFar")
  })

  it("refuses a day before the start month", () => {
    expect(hoursRefusal(open, "2026-08-31", today)).toBe("beforeStart")
    expect(hoursRefusal({ ...open, startMonth: null }, "2020-01-01", today)).toBeNull()
  })

  it("refuses a day after the end date", () => {
    const ended = { ...open, endMonth: "2026-09", endDate: "2026-09-16" }
    expect(hoursRefusal(ended, "2026-09-16", today)).toBeNull()
    expect(hoursRefusal(ended, "2026-09-17", today)).toBe("afterEnd")
  })

  it("ends a legacy contract, closed by month alone, on that month's last day", () => {
    const legacy = { ...open, endMonth: "2026-09", endDate: null }
    expect(hoursRefusal(legacy, "2026-09-30", today)).toBeNull()
    expect(hoursRefusal(legacy, "2026-10-01", today)).toBe("afterEnd")
  })

  it("refuses every day on a contract closed with no end, before or after its start", () => {
    // Closed before it started (closingEndDate gives no end), or legacy closed without one.
    const closed = { isActive: false, startMonth: "2026-11", endMonth: null, endDate: null }
    expect(hoursRefusal(closed, "2026-11-05", today)).toBe("closed")
    expect(hoursRefusal({ ...closed, startMonth: null }, today, today)).toBe("closed")
    // Closed on a date: its days up to the end still take hours.
    expect(hoursRefusal({ ...open, isActive: false, endMonth: "2026-09", endDate: "2026-09-29" }, "2026-09-29", today)).toBeNull()
  })
})

describe("hoursEdit", () => {
  const cell = { stored: 0, refusal: null, ...noLimits }

  it("writes new hours, and does nothing when they match what is stored", () => {
    expect(hoursEdit("6", cell)).toEqual({ kind: "set", hours: 6 })
    expect(hoursEdit("6,0", { ...cell, stored: 6 })).toEqual({ kind: "same" })
    expect(hoursEdit("", cell)).toEqual({ kind: "same" })
  })

  it("clears the day with 0 or nothing, even before the contract starts", () => {
    expect(hoursEdit("0", { ...cell, stored: 6 })).toEqual({ kind: "delete" })
    expect(hoursEdit("", { ...cell, stored: 6, refusal: "beforeStart" })).toEqual({ kind: "delete" })
    expect(hoursEdit("0", { ...cell, stored: 6, refusal: "afterEnd" })).toEqual({ kind: "delete" })
  })

  it("refuses text that is not 0 to 24 hours", () => {
    expect(hoursEdit("25", cell).kind).toBe("invalid")
    expect(hoursEdit("otto", cell).kind).toBe("invalid")
  })

  it("refuses new hours on a refused day, saying why", () => {
    expect(hoursEdit("6", { ...cell, refusal: "beforeStart" })).toEqual({
      kind: "invalid",
      message: "The contract has not started on this day.",
    })
    expect(hoursEdit("6", { ...cell, refusal: "afterEnd" })).toEqual({
      kind: "invalid",
      message: "The contract has ended before this day.",
    })
    expect(hoursEdit("6", { ...cell, refusal: "closed" })).toEqual({
      kind: "invalid",
      message: "The contract is closed.",
    })
    expect(hoursEdit("6", { ...cell, refusal: "tooFar" })).toEqual({
      kind: "invalid",
      message: "Hours go at most 3 months ahead.",
    })
  })

  it("caps a future day at 8 hours too", () => {
    const tomorrow = hoursRefusal({ isActive: true, startMonth: null, endMonth: null, endDate: null }, "2026-10-01", "2026-09-30")
    expect(hoursEdit("5", { ...cell, otherHours: 4, refusal: tomorrow }).kind).toBe("invalid")
  })
})

describe("limitRefusal", () => {
  const room = { collaborator: false, otherHours: 0, contractLeft: 4 }

  it("tells a day's limit from the contract's, so each caller names its own tool", () => {
    expect(limitRefusal(9, 0, room)).toEqual({ kind: "day", reason: "That makes 9 h on this client in one day: more than 8." })
    const contract = limitRefusal(5, 0, room)!
    expect(contract).toEqual({ kind: "contract", reason: "The contract has 4 h left." })
    expect(limitMessage(contract)).toBe("The contract has 4 h left. To go past its days, use Amend Contract.")
    expect(limitMessage(contract, "amend_contract")).toBe("The contract has 4 h left. To go past its days, use amend_contract.")
    expect(limitMessage(limitRefusal(9, 0, room)!, "amend_contract")).toBe("That makes 9 h on this client in one day: more than 8.")
  })
})

describe("monthPlanDays", () => {
  const e = { id: "e1", clientId: "A", name: "P", dailyRate: 500, vatApplicable: true, contractedDays: null, defaultDaysPerMonth: 1, startMonth: null, endMonth: null, endDate: null, isActive: true, amendments: [] } as unknown as Engagement

  it("gives a contract with no start its default in a past month, as log_time does", () => {
    expect(monthPlanDays(e, [], "2026-10", "2026-11")).toBe(1)
    expect(monthPlanDays(e, [], "2026-11", "2026-11")).toBe(1)
  })
})

describe("the 8-hour day", () => {
  const day = "2026-09-24"
  const eng = (id: string, clientId: string, contractedDays: number | null = null) => ({ id, clientId, contractedDays, amendments: [] })
  const A1 = eng("a1", "A")
  const A2 = eng("a2", "A")
  const B1 = eng("b1", "B")
  const tc = (engagementId: string, hours: number, collaboratorId: string | null = null) => ({ engagementId, date: day, hours, collaboratorId })
  const edit = (text: string, e: typeof A1, timecards: ReturnType<typeof tc>[], who: string | null = null, plannedDays: number | null = null, stored = 0) =>
    hoursEdit(text, {
      stored,
      refusal: null,
      ...cellLimits({ timecards, engagements: [A1, A2, B1, e], engagement: e, date: day, who, plannedDays }),
    })

  it("takes 8 h on one client and 8 h on another the same day (the owner)", () => {
    expect(edit("8", B1, [tc("a1", 8)])).toEqual({ kind: "set", hours: 8 })
  })

  it("refuses 5 + 4 on two contracts of the same client (the owner)", () => {
    expect(edit("4", A2, [tc("a1", 5)])).toEqual({
      kind: "invalid",
      message: "That makes 9 h on this client in one day: more than 8.",
    })
  })

  it("refuses a collaborator's 5 + 4 on two clients, and takes exactly 8", () => {
    expect(edit("4", B1, [tc("a1", 5, "c1")], "c1")).toEqual({
      kind: "invalid",
      message: "That makes 9 h on this day across clients: more than 8.",
    })
    expect(edit("3", B1, [tc("a1", 5, "c1")], "c1")).toEqual({ kind: "set", hours: 3 })
    // The owner's hours are not the collaborator's day.
    expect(edit("8", B1, [tc("a1", 8)], "c1")).toEqual({ kind: "set", hours: 8 })
  })

  it("lowers a stored 10 to 9, and refuses raising it", () => {
    expect(edit("9", A1, [tc("a1", 10)], null, null, 10)).toEqual({ kind: "set", hours: 9 })
    expect(edit("11", A1, [tc("a1", 10)], null, null, 10).kind).toBe("invalid")
  })

  it("takes 4 h on a contract with half a day left, and refuses 5", () => {
    const e = eng("a1", "A", 1)
    const others = [{ engagementId: "a1", date: "2026-09-01", hours: 4, collaboratorId: null }]
    expect(edit("4", e, others)).toEqual({ kind: "set", hours: 4 })
    expect(edit("5", e, others)).toEqual({
      kind: "invalid",
      message: "The contract has 4 h left. To go past its days, use Amend Contract.",
    })
    // Everyone's hours count toward the contract.
    expect(edit("1", e, [...others, tc("a1", 3, "c1")]).kind).toBe("set")
    expect(edit("2", e, [...others, tc("a1", 3, "c1")]).kind).toBe("invalid")
  })

  it("lowers hours on a contract already past its days", () => {
    const e = eng("a1", "A", 1)
    expect(edit("7", e, [tc("a1", 8), { engagementId: "a1", date: "2026-09-01", hours: 4, collaboratorId: null }], null, null, 8)).toEqual({ kind: "set", hours: 7 })
  })

  it("warns past the month's plan, without refusing", () => {
    const month = [{ engagementId: "a1", date: "2026-09-01", hours: 14, collaboratorId: null }]
    expect(edit("2", A1, month, null, 2)).toEqual({ kind: "set", hours: 2 })
    expect(edit("3", A1, month, null, 2)).toEqual({
      kind: "set",
      hours: 3,
      warning: "That is 17 h this month: past the plan's 16 h.",
    })
  })
})

describe("noteEdit", () => {
  const cell = { stored: 6, note: null, refusal: null }

  it("writes a new or changed note, trimmed, and does nothing when it matches", () => {
    expect(noteEdit("  Sprint review ", cell)).toEqual({ kind: "set", notes: "Sprint review" })
    expect(noteEdit("Retro", { ...cell, note: "Sprint review" })).toEqual({ kind: "set", notes: "Retro" })
    expect(noteEdit("Retro ", { ...cell, note: "Retro" })).toEqual({ kind: "same" })
    expect(noteEdit("  ", cell)).toEqual({ kind: "same" })
    // log_time can store "": it reads as no note.
    expect(noteEdit("", { ...cell, note: "" })).toEqual({ kind: "same" })
  })

  it("clears with blank text, as null, even on a refused day", () => {
    expect(noteEdit(" ", { ...cell, note: "Retro" })).toEqual({ kind: "set", notes: null })
    expect(noteEdit("", { ...cell, note: "Retro", refusal: "afterEnd" })).toEqual({ kind: "set", notes: null })
  })

  it("needs hours on the day", () => {
    expect(noteEdit("Retro", { ...cell, stored: 0 })).toEqual({ kind: "invalid", message: "Log hours first." })
  })

  it("refuses adding or changing a note on a refused day, as log_time does", () => {
    expect(noteEdit("Retro", { ...cell, refusal: "afterEnd" })).toEqual({
      kind: "invalid",
      message: "The contract has ended before this day.",
    })
    expect(noteEdit("New", { ...cell, note: "Retro", refusal: "closed" })).toEqual({
      kind: "invalid",
      message: "The contract is closed.",
    })
  })

  it("holds at most 1000 characters", () => {
    expect(noteEdit("x".repeat(1000), cell).kind).toBe("set")
    expect(noteEdit("x".repeat(1001), cell)).toEqual({ kind: "invalid", message: "A note holds at most 1000 characters." })
  })
})

describe("weekContracts", () => {
  // The week of 28 Sep 2026 runs into October.
  const days = weekDays("2026-09-28")
  const contract = (id: string, over: Record<string, unknown> = {}) => ({
    id, isActive: true, startMonth: null as string | null, endMonth: null as string | null,
    endDate: null as string | null, ...over,
  })
  const ids = (
    engagements: ReturnType<typeof contract>[],
    timecards: { engagementId: string; date: string }[] = [],
    weekDaysList = days,
  ) => weekContracts(engagements, timecards, weekDaysList, "2026-09-30").map((e) => e.id)

  it("lists the active contracts running in the week", () => {
    expect(
      ids([
        contract("running"),
        contract("starts-in-october", { startMonth: "2026-10" }),
        contract("starts-later", { startMonth: "2026-11" }),
        contract("ended-in-september", { endMonth: "2026-09" }),
        contract("ended-before", { endMonth: "2026-08" }),
        contract("closed", { isActive: false }),
      ]),
    ).toEqual(["running", "starts-in-october", "ended-in-september"])
  })

  it("keeps any contract with hours in the week, closed or not yet started", () => {
    const hours = [
      { engagementId: "closed", date: "2026-10-04" },
      { engagementId: "starts-later", date: "2026-09-28" },
      { engagementId: "closed-long-ago", date: "2026-09-27" },
    ]
    expect(
      ids(
        [
          contract("closed", { isActive: false }),
          contract("starts-later", { startMonth: "2026-11" }),
          contract("closed-long-ago", { isActive: false }),
        ],
        hours,
      ),
    ).toEqual(["closed", "starts-later"])
  })

  it("shows a contract closed on a date inside the week, for its days up to the end", () => {
    expect(
      ids([
        contract("closed-on-tuesday", { isActive: false, endMonth: "2026-09", endDate: "2026-09-29" }),
        contract("closed-with-no-end", { isActive: false }),
      ]),
    ).toEqual(["closed-on-tuesday"])
  })

  it("hides an active contract whose end is before the week", () => {
    expect(ids([contract("ended-sunday", { endMonth: "2026-09", endDate: "2026-09-27" })])).toEqual([])
  })

  it("is empty past the 3-month limit, unless hours are there", () => {
    const past = weekDays("2027-01-04")
    expect(ids([contract("running")], [], past)).toEqual([])
    expect(ids([contract("running")], [{ engagementId: "running", date: "2027-01-05" }], past)).toEqual(["running"])
  })
})

// What the Plan page shows and offers, and list_time with it: today is 1 October 2026.
describe("the plan against the hours", () => {
  const at = new Date(2026, 8, 1)
  const contract = (id: string, over: Partial<Engagement> = {}): Engagement => ({
    id, userId: "u1", clientId: "c1", name: null, opportunityId: null, dailyRate: 500, vatApplicable: true,
    contractedDays: null, defaultDaysPerMonth: 10, startMonth: null, endMonth: null, endDate: null, isActive: true, notes: null,
    createdAt: at, updatedAt: at, ...over,
  })
  const row = (engagementId: string, yearMonth: string, days: number): Allocation => ({
    id: `${engagementId}:${yearMonth}`, userId: "u1", engagementId, yearMonth, days, createdAt: at, updatedAt: at,
  })

  describe("hoursAction", () => {
    const action = (yearMonth: string, planned: number | null, days: number, covered = 0, end: string | null = null, daysOff = 0) =>
      hoursAction({ yearMonth, today: "2026-10-20", end, planned, days, covered, daysOff })

    it("offers nothing without hours or outside the plan: silence is not zero work", () => {
      expect(action("2026-09", 10, 0)).toBe("none")
      expect(action("2026-09", null, 5)).toBe("none")
    })

    it("uses a closed month's hours up or down, and is done when the plan holds them", () => {
      expect(action("2026-09", 10, 12)).toBe("use")
      expect(action("2026-09", 10, 2.5)).toBe("use")
      expect(action("2026-09", 0.9375, 0.9375)).toBe("same")
    })

    it("refuses more than 31 days, even on a closed month", () => {
      expect(action("2026-09", 10, 33)).toBe("over")
      expect(action("2026-11", 10, 33)).toBe("over")
    })

    // November 2026 has 21 weekdays: 80% is 16.8.
    it("raises an open month any time, and lowers it once 80% of its weekdays carry hours", () => {
      expect(action("2026-11", 10, 11)).toBe("use")
      expect(action("2026-11", 20, 16, 16)).toBe("pace")
      expect(action("2026-11", 20, 17, 17)).toBe("use")
      expect(action("2026-10", 20, 2, 17)).toBe("pace")
    })

    // November 2026 has 21 weekdays: with 5 off, 16 are available and 80% is 12.8.
    it("counts the 80% against the weekdays left after time off, on the open month only", () => {
      expect(action("2026-11", 20, 13, 13)).toBe("pace")
      expect(action("2026-11", 20, 13, 13, null, 5)).toBe("use")
      expect(action("2026-11", 20, 12, 12, null, 5)).toBe("pace")
      expect(action("2026-11", 20, 13, 13, null, 0)).toBe("pace")
    })

    it("regression guard, passes without the daysOff change: a closed month is used as it was, with or without time off", () => {
      expect(action("2026-09", 10, 12, 3, null, 5)).toBe("use")
      expect(action("2026-10", 20, 11, 11, "2026-10-15", 5)).toBe("use")
    })

    // October 2026 has 22 weekdays: 11 covered is short of 80%, yet nothing more can be logged.
    it("treats a month as closed once the contract's last day is behind today", () => {
      expect(action("2026-10", 20, 11, 11, "2026-10-15")).toBe("use")
      expect(action("2026-10", 20, 11, 11, "2026-10-20")).toBe("pace")
      expect(action("2026-10", 20, 11, 11, "2026-10-31")).toBe("pace")
    })

    it("never cuts a month for one stray hour", () => {
      const { byCell, covered } = monthHours([{ engagementId: "e1", date: "2026-11-30", hours: 1 }], "2026-10-01")
      expect(action("2026-11", 10, byCell.get("e1:2026-11")!.days, covered.get("2026-11"))).toBe("pace")
    })
  })

  describe("planCells", () => {
    const months = (cells: Map<string, unknown>, id = "e1") =>
      [...cells.keys()].filter((k) => k.startsWith(`${id}:`)).map((k) => k.slice(id.length + 1))

    it("starts an unanchored contract at the current month: the window never moves back (#155)", () => {
      const cells = planCells([contract("e1")], [], "2026-10")
      expect(months(cells)).toHaveLength(12)
      expect(months(cells)[0]).toBe("2026-10")
      expect(cells.get("e1:2026-10")).toMatchObject({ plannedDays: 10, billableDays: 10 })
    })

    it("adds the lead months from a start month or a first stored row, burned as the engine burns them", () => {
      const started = planCells([contract("e1", { startMonth: "2026-07", contractedDays: 25 })], [], "2026-10")
      expect(months(started).slice(0, 4)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"])
      expect(started.get("e1:2026-09")).toMatchObject({ plannedDays: 10, billableDays: 5, capped: true })
      expect(started.get("e1:2026-10")).toMatchObject({ billableDays: 0 })
      const stored = planCells([contract("e1")], [row("e1", "2026-08", 4)], "2026-10")
      expect(months(stored).slice(0, 3)).toEqual(["2026-08", "2026-09", "2026-10"])
      expect(stored.get("e1:2026-08")?.plannedDays).toBe(4)
    })

    it("leaves out the months before a future start, and a contract closed with no end", () => {
      const cells = planCells([contract("e1", { startMonth: "2026-12" }), contract("e2", { isActive: false })], [], "2026-10")
      expect(months(cells)[0]).toBe("2026-12")
      expect(cells.has("e1:2026-11")).toBe(false)
      expect(months(cells, "e2")).toEqual([])
    })
  })

  describe("hoursLine", () => {
    const today = "2026-10-20"
    const cells = planCells([contract("e1", { startMonth: "2026-09" })], [row("e1", "2026-09", 10)], "2026-10")
    const hours = monthHours(
      [
        { engagementId: "e1", date: "2026-09-01", hours: 8 },
        { engagementId: "e1", date: "2026-09-02", hours: 4 },
        { engagementId: "e1", date: "2026-08-31", hours: 8 },
      ],
      today,
    )
    const line = (yearMonth: string) => hoursLine({ engagementId: "e1", end: null, yearMonth, today, cells, hours, daysOff: 0 })

    it("reads nothing without hours", () => {
      expect(line("2026-10")).toBeNull()
    })

    it("offers a closed month's hours against its plan, saying where the days come from", () => {
      expect(line("2026-09")).toEqual({
        h: { worked: 12, scheduled: 0, days: 1.5 },
        planned: 10,
        action: "use",
        title: "1.5 d from 12 h; hours on 2 of 22 weekdays",
      })
    })

    it("counts an hourly contract's title in hours alone", () => {
      const l = hoursLine({ engagementId: "e1", end: null, yearMonth: "2026-09", today, cells, hours, unit: "hour", daysOff: 0 })
      expect(l?.title).toBe("12 h; hours on 2 of 22 weekdays")
      expect(l?.title).not.toMatch(/ d /)
    })

    it("calls hours on a month the plan does not count outside, and says how to fix it", () => {
      expect(line("2026-08")).toMatchObject({
        planned: null,
        action: "outside",
        title: "Not in the plan this month: set the contract's start month on Clients.",
      })
    })
  })

  describe("monthHours", () => {
    it("counts today's hours as worked and tomorrow's as scheduled, all of them in the days", () => {
      const { byCell } = monthHours(
        [
          { engagementId: "e1", date: "2026-10-01", hours: 7.5 },
          { engagementId: "e1", date: "2026-10-02", hours: 4 },
          { engagementId: "e1", date: "2026-09-30", hours: 8 },
        ],
        "2026-10-01",
      )
      expect(byCell.get("e1:2026-10")).toEqual({ worked: 7.5, scheduled: 4, days: 1.4375 })
      expect(byCell.get("e1:2026-09")).toEqual({ worked: 8, scheduled: 0, days: 1 })
    })

    it("covers a weekday once across contracts, and never a weekend", () => {
      const { covered } = monthHours(
        [
          { engagementId: "e1", date: "2026-10-01", hours: 4 },
          { engagementId: "e2", date: "2026-10-01", hours: 4 },
          { engagementId: "e1", date: "2026-10-02", hours: 8 },
          { engagementId: "e1", date: "2026-10-03", hours: 8 },
          { engagementId: "e1", date: "2026-10-04", hours: 8 },
        ],
        "2026-10-01",
      )
      expect(covered.get("2026-10")).toBe(2)
    })
  })

  // ISO week 40 of 2026: Mon 28 Sep to Sun 4 Oct. Three weekdays in September and two
  // in October, out of 22 each.
  describe("weekResult", () => {
    const days = weekDays("2026-09-28")
    const acme = contract("acme", { dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 20, startMonth: "2026-09" })
    const beta = contract("beta", { dailyRate: 600, vatApplicable: false, defaultDaysPerMonth: 4, startMonth: "2026-09" })
    const timecards = [
      ...["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"].map((date) => ({ engagementId: "acme", date, hours: 8 })),
      { engagementId: "beta", date: "2026-09-28", hours: 4 },
      // Outside the week.
      { engagementId: "acme", date: "2026-10-05", hours: 8 },
    ]
    const result = (engagements = [acme, beta]) =>
      weekResult({ engagements, timecards, cells: planCells(engagements, [], "2026-10"), days, today: "2026-10-01" })

    it("values an hourly contract's week as hours × its hourly rate", () => {
      const hourly = contract("hourly", { dailyRate: 600, vatApplicable: false, defaultDaysPerMonth: 5, startMonth: "2026-09" })
      const r = weekResult({
        engagements: [hourly],
        timecards: [{ engagementId: "hourly", date: "2026-09-28", hours: 10 }],
        cells: planCells([hourly], [], "2026-10"),
        days,
        today: "2026-10-01",
      })
      expect(r.worked).toEqual({ hours: 10, value: 750 })
    })

    it("values worked and scheduled hours apart, per contract, and the plan's share of the week", () => {
      const r = result()
      expect(r.worked).toEqual({ hours: 36, value: 2300 })
      expect(r.scheduled).toEqual({ hours: 8, value: 500 })
      // 20 × 5/22 + 4 × 5/22
      expect(r.plan.days).toBeCloseTo(5.4545, 4)
      expect(r.plan.value).toBe(2818.18)
      expect(r.workedVat).toBe(2740)
    })

    it("adds VAT only where the contract charges it, and nothing for a month outside the plan", () => {
      expect(result([acme, { ...beta, vatApplicable: true }]).workedVat).toBe(2806)
      // Unanchored: September is outside the plan, so only October's 2 of 22 weekdays count.
      const unanchored = { ...beta, startMonth: null }
      expect(result([unanchored]).plan.days).toBeCloseTo((4 * 2) / 22, 6)
    })

    // ISO week 53 of 2026: Mon 28 Dec to Sun 3 Jan, across a rate change from January.
    describe("across a rate change", () => {
      const newYear = weekDays("2026-12-28")
      const pcm = contract("pcm", {
        dailyRate: 700, vatApplicable: false, defaultDaysPerMonth: 20, startMonth: "2026-12",
        amendments: [{ from: "2027-01", dailyRate: 800, addedDays: null, lastDay: null, lastDayBefore: null, note: null }],
      })
      const hours = ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"].map((date) => ({
        engagementId: "pcm", date, hours: 8,
      }))
      const at = (today: string, engagements = [pcm]) =>
        weekResult({ engagements, timecards: hours, cells: planCells(engagements, [], "2026-12"), days: newYear, today })

      it("values each month's hours at the rate in force in that month", () => {
        const r = at("2027-01-01")
        expect(r.worked).toEqual({ hours: 40, value: 4 * 700 + 800 })
        const split = at("2026-12-30")
        expect(split.worked).toEqual({ hours: 24, value: 2100 })
        expect(split.scheduled).toEqual({ hours: 16, value: 700 + 800 })
      })

      it("values the plan's share at each cell's rate", () => {
        // 20 × 4/23 of December × €700 + 20 × 1/21 of January × €800 = 2,434.78 + 761.90 (3,196.68 as parts; the product rounds once, on the total)
        expect(at("2027-01-01").plan.value).toBe(3196.69)
      })

      it("changes nothing without a rate change", () => {
        const signed = { ...pcm, amendments: undefined }
        expect(at("2026-12-30", [{ ...signed, amendments: [] }])).toEqual(at("2026-12-30", [signed]))
        expect(at("2027-01-01", [signed]).worked.value).toBe(5 * 700)
      })
    })
  })
})

describe("people on a week of hours", () => {
  const at = new Date(2026, 8, 1)
  const eng = { id: "e1", endMonth: null as string | null }
  const collaborator = (id: string, name: string, isActive = true) =>
    ({ id, userId: "u1", name, type: "freelancer", notes: null, isActive, fee: null, createdAt: at, updatedAt: at }) as Collaborator
  const assignment = (collaboratorId: string, over: Partial<Assignment> = {}): Assignment => ({
    id: `a-${collaboratorId}`, userId: "u1", collaboratorId, engagementId: "e1", dailyRate: 320, from: "2026-09", until: null,
    defaultDays: 4, monthDays: {}, createdAt: at, updatedAt: at, ...over,
  })
  // The week of 28 Sep runs into October.
  const days = weekDays("2026-09-28")
  const people = (a: Assignment[], c: Collaborator[], timecards: { engagementId: string; date: string; collaboratorId: string | null }[] = []) =>
    weekPeople({ engagement: eng, assignments: a, collaborators: c, timecards, days }).map((p) => [p.id, p.name])

  it("a contract with nobody assigned keeps its single row", () => {
    expect(people([], [collaborator("g", "Giulia Neri")])).toEqual([])
  })

  it("lists You first, then each collaborator with an assignment covering the week, by name", () => {
    expect(people([assignment("m"), assignment("g")], [collaborator("g", "Giulia Neri"), collaborator("m", "Marco Bianchi")])).toEqual([
      [null, "You"], ["g", "Giulia Neri"], ["m", "Marco Bianchi"],
    ])
  })

  it.each([
    ["starts after the week", { from: "2026-11" }],
    ["ended before the week", { from: "2026-06", until: "2026-08" }],
  ])("leaves out one whose assignment %s", (_, over) => {
    expect(people([assignment("g", over)], [collaborator("g", "Giulia Neri")])).toEqual([])
  })

  it("appears from the assignment's From month: the week crossing into it already shows her", () => {
    expect(people([assignment("g", { from: "2026-10" })], [collaborator("g", "Giulia Neri")])).toEqual([[null, "You"], ["g", "Giulia Neri"]])
  })

  it("stops at the contract's end", () => {
    const ended = weekPeople({ engagement: { id: "e1", endMonth: "2026-08" }, assignments: [assignment("g")], collaborators: [collaborator("g", "Giulia Neri")], timecards: [], days })
    expect(ended).toEqual([])
  })

  it("keeps a person with hours in the week even when their assignment is over or they are inactive", () => {
    const logged = [{ engagementId: "e1", date: "2026-09-29", collaboratorId: "g" }]
    expect(people([assignment("g", { until: "2026-08" })], [collaborator("g", "Giulia Neri", false)], logged)).toEqual([[null, "You"], ["g", "Giulia Neri"]])
  })

  it("leaves out an inactive collaborator with no hours in the week", () => {
    expect(people([assignment("g")], [collaborator("g", "Giulia Neri", false)])).toEqual([])
  })
})

describe("weekResult with two people on a contract", () => {
  const acme = { id: "acme", dailyRate: 500, vatApplicable: false, amendments: [] }
  const days = weekDays("2026-09-28")
  const timecards = [
    { engagementId: "acme", collaboratorId: null, date: "2026-09-28", hours: 8 },
    { engagementId: "acme", collaboratorId: "g", date: "2026-09-28", hours: 8 },
    { engagementId: "acme", collaboratorId: "g", date: "2026-10-02", hours: 4 },
  ]
  const r = weekResult({ engagements: [acme], timecards, cells: new Map(), days, today: "2026-10-01" })

  it("bills everyone's hours at the contract's rate", () => {
    expect(r.worked).toEqual({ hours: 16, value: 1000 })
    expect(r.scheduled).toEqual({ hours: 4, value: 250 })
  })

  it("reports the owner's own hours apart", () => {
    expect(r.own).toEqual({ worked: 8, scheduled: 0, workedValue: 500, scheduledValue: 0 })
  })
})

describe("hoursRoom", () => {
  const day = "2026-11-12"
  const today = "2026-11-12"
  const eng = (id: string, clientId: string, over: Record<string, unknown> = {}) =>
    ({ id, clientId, contractedDays: null, amendments: [], unit: "day", isActive: true, startMonth: "2026-10", endMonth: null, endDate: null, ...over }) as unknown as Engagement
  const A1 = eng("a1", "A", { contractedDays: 11 })
  const A2 = eng("a2", "A")
  const B1 = eng("b1", "B")
  const tc = (engagementId: string, hours: number, date = day, collaboratorId: string | null = null) => ({ engagementId, date, hours, collaboratorId })
  const room = (timecards: ReturnType<typeof tc>[], e: Engagement = A1, plannedDays: number | null = 4) =>
    hoursRoom({ timecards, engagements: [A1, A2, B1], engagement: e, date: day, today, plannedDays })

  it("the board's day: 52 h before today, 20 of them in November, 2 h on another client today", () => {
    const r = room([tc("a1", 32, "2026-10-20"), tc("a1", 20, "2026-11-03"), tc("b1", 2)])
    expect(r).toMatchObject({
      refusal: null,
      day: { logged: 0, left: 8, of: 8, onThisContract: 0, onOtherContracts: 0, onOtherClients: 2 },
      contractLeft: { daysLeft: 4.5, hoursLeft: 36 },
      month: { yearMonth: "2026-11", plannedDays: 4, loggedHours: 20, leftHours: 12, leftDays: 1.5 },
      most: 8,
      binds: "day",
    })
  })

  it("another contract of the client takes 3 h of the day; a collaborator's hours reach the contract, not the owner's day", () => {
    const r = room([tc("a2", 3), tc("a1", 5, "2026-11-02", "c1")])
    expect(r.day).toMatchObject({ logged: 3, left: 5, onOtherContracts: 3 })
    expect(r.most).toBe(5)
    expect(r.contractLeft.hoursLeft).toBe(83)
  })

  it("a day already holding hours on the contract: most is what can still be added", () => {
    const r = room([tc("a1", 2), tc("a2", 3)])
    expect(r).toMatchObject({ day: { logged: 5, left: 3, onThisContract: 2 }, most: 3, binds: "day" })
  })

  it("the contract binds when its days run out before the day does", () => {
    const r = room([tc("a1", 86, "2026-10-20")])
    expect(r).toMatchObject({ contractLeft: { daysLeft: 0.25, hoursLeft: 2 }, most: 2, binds: "contract" })
  })

  it("a contract with no days has no ceiling and no plan has no month left", () => {
    const r = room([], A2, null)
    expect(r).toMatchObject({ contractLeft: { daysLeft: null, hoursLeft: null }, month: { plannedDays: null, leftHours: null, leftDays: null }, most: 8 })
  })

  it("an hourly contract reads in hours: no day fields, the plan in hours", () => {
    const r = room([], eng("h1", "A", { unit: "hour", contractedDays: 2 }), 1)
    expect(r.unit).toBe("hour")
    expect(r.contractLeft).toEqual({ daysLeft: null, hoursLeft: 16 })
    expect(r.month).toMatchObject({ plannedDays: null, plannedHours: 8, leftHours: 8, leftDays: null })
  })

  it("a daily contract's days are rounded to hundredths", () => {
    const r = room([tc("a1", 85.67, "2026-10-20")])
    expect(r.contractLeft).toEqual({ daysLeft: 0.29, hoursLeft: 2.33 })
  })

  it("lists the other clients' hours by client, orphan contracts included, summing to onOtherClients", () => {
    const r = room([tc("b1", 2), tc("b1", 1), tc("gone", 0.5), tc("a2", 3)])
    expect(r.otherClients).toEqual([{ clientId: "B", hours: 3 }, { clientId: "gone", hours: 0.5 }])
    expect(r.day.onOtherClients).toBe(3.5)
  })

  it("a plan nearly used up leaves the day's room alone and warns", () => {
    const timecards = [tc("a1", 30, "2026-11-03")]
    const r = room(timecards, A1, 4)
    expect(r).toMatchObject({ month: { leftHours: 2, leftDays: 0.25 }, most: 8, binds: "day" })
    const limits = cellLimits({ timecards, engagements: [A1, A2, B1], engagement: A1, date: day, who: null, plannedDays: 4 })
    expect(planWarning(r.most, limits)).toBe("That is 38 h this month: past the plan's 32 h.")
  })

  it("a date the contract refuses takes nothing", () => {
    const r = hoursRoom({ timecards: [], engagements: [A1], engagement: eng("a1", "A", { startMonth: "2026-12" }), date: day, today, plannedDays: null })
    expect(r).toMatchObject({ refusal: "beforeStart", most: 0, binds: "date" })
  })

  it.each([
    ["day", [tc("a2", 3)], 0],
    ["contract", [tc("a1", 86, "2026-10-20")], 0],
    ["day, hours already on the contract", [tc("a2", 3), tc("a1", 2)], 2],
    ["contract, hours already on the contract", [tc("a1", 86, "2026-10-20"), tc("a1", 1)], 1],
  ])("the most passes limitRefusal and a quarter hour more is refused with the same kind (%s)", (name, timecards, stored) => {
    const kind = name.split(",")[0]
    const r = room(timecards)
    const limits = cellLimits({ timecards, engagements: [A1, A2, B1], engagement: A1, date: day, who: null, plannedDays: 4 })
    expect(limitRefusal(stored + r.most, stored, limits)).toBeNull()
    expect(limitRefusal(stored + r.most + 0.25, stored, limits)?.kind).toBe(kind)
    expect(r.binds).toBe(kind)
  })
})
