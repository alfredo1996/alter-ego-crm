import { eur } from "@alter-ego/kernel/currency"
import { describe, expect, it } from "vitest"

import { monthsFrom } from "@/lib/engagement-burndown"
import {
  allocationsAfterEnd,
  amendContract,
  closingEndDate,
  contractDays,
  contractEndDate,
  contractRemaining,
  contractUsage,
  conversionTerm,
  endBeforeAmendmentError,
  endFields,
  engagementLabel,
  engagementNameFromTitle,
  engagementRateLabel,
  formatContractQuantity,
  fromContractUnit,
  hoursToDays,
  inContractUnit,
  isOverBudget,
  normalizeAmendments,
  runOutMonth,
  timecardsAfterEnd,
  toContractUnit,
} from "@/lib/engagements"
import { contractAmendmentSchema, createEngagementSchema, createOpportunitySchema, updateEngagementSchema, updateOpportunitySchema } from "@/types/schemas"

import type { Allocation, ContractAmendment, Engagement, Timecard } from "@/types"

const base = { defaultDaysPerMonth: 10, dailyRate: 700 }

describe("engagementLabel", () => {
  it("uses the name when set", () => {
    expect(engagementLabel({ ...base, name: "Migrazione cloud" })).toBe("Migrazione cloud")
  })

  it.each([null, "", "   "])("falls back to the rate label for name %j", (name) => {
    expect(engagementLabel({ ...base, name })).toBe(`10 days/month × ${eur(700)}`)
    expect(engagementLabel({ ...base, name })).toBe(engagementRateLabel(base))
  })
})

describe("engagementNameFromTitle", () => {
  it("takes the trimmed title", () => {
    expect(engagementNameFromTitle("  Nuovo portale ")).toBe("Nuovo portale")
  })

  it("cuts a long title to the 120-character name limit", () => {
    expect(engagementNameFromTitle("a".repeat(150))).toBe("a".repeat(120))
    // No trailing space, and no half an emoji, at the cut.
    expect(engagementNameFromTitle(`${"a".repeat(119)} bbb`)).toBe("a".repeat(119))
    expect(engagementNameFromTitle(`${"a".repeat(119)}😀`)).toBe("a".repeat(119))
  })

  it("is null for a blank title", () => {
    expect(engagementNameFromTitle("   ")).toBeNull()
  })
})

describe("engagement endMonth schema", () => {
  const contract = { clientId: "c1", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 10 }

  it.each([undefined, null, "2026-06"])("accepts endMonth %j", (endMonth) => {
    expect(createEngagementSchema.safeParse({ ...contract, endMonth }).success).toBe(true)
  })

  it("rejects a malformed month", () => {
    expect(createEngagementSchema.safeParse({ ...contract, endMonth: "2026-6" }).success).toBe(false)
  })

  it("rejects an end before the start, on create and on update, under the End date field", () => {
    const months = { startMonth: "2026-06", endMonth: "2026-05" }
    expect(createEngagementSchema.safeParse({ ...contract, ...months }).error?.issues[0].path).toEqual(["endDate"])
    expect(updateEngagementSchema.safeParse(months).success).toBe(false)
    const day = { startMonth: "2026-06", endMonth: "2026-05", endDate: "2026-05-31" }
    expect(createEngagementSchema.safeParse({ ...contract, ...day }).error?.issues[0]).toMatchObject({
      path: ["endDate"],
      message: "The end date cannot be before the start month",
    })
  })

  it("accepts an end equal to the start, and an end alone on update", () => {
    expect(createEngagementSchema.safeParse({ ...contract, startMonth: "2026-06", endMonth: "2026-06" }).success).toBe(true)
    expect(updateEngagementSchema.safeParse({ endMonth: "2026-05", isActive: false }).success).toBe(true)
    const day = { startMonth: "2026-06", endMonth: "2026-06", endDate: "2026-06-01" }
    expect(createEngagementSchema.safeParse({ ...contract, ...day }).success).toBe(true)
  })

  it.each([undefined, null, "2026-06-15", "2028-02-29"])("accepts endDate %j", (endDate) => {
    expect(createEngagementSchema.safeParse({ ...contract, endDate }).success).toBe(true)
  })

  it.each(["2026-6-1", "2026-06", "2026-02-30", "2027-02-29"])("rejects endDate %j", (endDate) => {
    expect(updateEngagementSchema.safeParse({ endDate }).error?.issues[0].message).toBe("Invalid date: use YYYY-MM-DD")
  })
})

describe("contractEndDate", () => {
  it("is null with no end", () => {
    expect(contractEndDate({ endMonth: null, endDate: null })).toBeNull()
  })

  it("is the day when the contract ends on one", () => {
    expect(contractEndDate({ endMonth: "2026-08", endDate: "2026-08-20" })).toBe("2026-08-20")
  })

  it("is the month's last day for an end by month (legacy, conversions), leap years included", () => {
    expect(contractEndDate({ endMonth: "2026-09", endDate: null })).toBe("2026-09-30")
    expect(contractEndDate({ endMonth: "2027-02", endDate: null })).toBe("2027-02-28")
    expect(contractEndDate({ endMonth: "2028-02", endDate: null })).toBe("2028-02-29")
  })

  it("ignores an endDate outside endMonth, which an older bundle left behind", () => {
    expect(contractEndDate({ endMonth: "2026-10", endDate: "2026-08-20" })).toBe("2026-10-31")
  })
})

describe("endFields", () => {
  it("writes the day and its month together", () => {
    expect(endFields("2026-08-20")).toEqual({ endDate: "2026-08-20", endMonth: "2026-08" })
    expect(endFields(null)).toEqual({ endDate: null, endMonth: null })
  })
})

// Closing must end the future without adding a month the plan never billed (#156).
describe("closingEndDate", () => {
  const TODAY = "2026-09-17"

  it("is today for a running contract with no end", () => {
    expect(closingEndDate({ startMonth: "2026-01", endMonth: null, endDate: null }, TODAY)).toBe(TODAY)
    expect(closingEndDate({ startMonth: null, endMonth: null, endDate: null }, TODAY)).toBe(TODAY)
  })

  it("keeps a planned end already past, instead of billing the months after it again", () => {
    expect(closingEndDate({ startMonth: "2026-01", endMonth: "2026-06", endDate: null }, TODAY)).toBe("2026-06-30")
    expect(closingEndDate({ startMonth: "2026-01", endMonth: "2026-09", endDate: "2026-09-10" }, TODAY)).toBe(
      "2026-09-10",
    )
  })

  it("cuts a planned end still ahead to today, in a later month or later this month", () => {
    expect(closingEndDate({ startMonth: "2026-01", endMonth: "2026-12", endDate: null }, TODAY)).toBe(TODAY)
    expect(closingEndDate({ startMonth: "2026-01", endMonth: "2026-09", endDate: null }, TODAY)).toBe(TODAY)
    expect(closingEndDate({ startMonth: "2026-01", endMonth: "2026-09", endDate: "2026-09-25" }, TODAY)).toBe(TODAY)
  })

  it("is null for a contract that has not started, so it bills nothing", () => {
    expect(closingEndDate({ startMonth: "2026-11", endMonth: null, endDate: null }, TODAY)).toBeNull()
    expect(closingEndDate({ startMonth: "2026-11", endMonth: "2027-02", endDate: null }, TODAY)).toBeNull()
    expect(closingEndDate({ startMonth: "2026-09", endMonth: null, endDate: null }, TODAY)).toBe(TODAY)
  })

  // Closing moves no number: its month is the one closingEndMonth used to write.
  it.each([
    [null, null, "2026-09"],
    ["2026-01", "2026-06", "2026-06"],
    ["2026-01", "2026-12", "2026-09"],
    ["2026-01", "2026-09", "2026-09"],
  ])("from start %j and end %j, closes in %s", (startMonth, endMonth, month) => {
    expect(closingEndDate({ startMonth, endMonth, endDate: null }, TODAY)?.slice(0, 7)).toBe(month)
  })
})

// Every conversion is born bounded, so a zeroed month cannot slide its days (#154).
describe("conversionTerm", () => {
  const deal = (expectedStartMonth: string | null, estimatedDurationMonths: number) => ({ expectedStartMonth, estimatedDurationMonths })

  it("runs from the expected start through start + duration − 1", () => {
    expect(conversionTerm(deal("2026-11", 4), "2026-09")).toEqual({ startMonth: "2026-11", endMonth: "2027-02" })
    expect(conversionTerm(deal("2026-12", 1), "2026-09")).toEqual({ startMonth: "2026-12", endMonth: "2026-12" })
    expect(conversionTerm(deal("2026-11", 14), "2026-09")).toEqual({ startMonth: "2026-11", endMonth: "2027-12" })
  })

  it("starts this month when the deal has no expected start", () => {
    expect(conversionTerm(deal(null, 6), "2026-09")).toEqual({ startMonth: "2026-09", endMonth: "2027-02" })
  })

  // Won late: at f71315f it kept 2026-03..2026-08, so the symmetric fill spent the
  // whole budget before today and winning the deal erased its revenue.
  it("starts this month when the expected start has passed", () => {
    expect(conversionTerm(deal("2026-03", 6), "2026-09")).toEqual({ startMonth: "2026-09", endMonth: "2027-02" })
    expect(conversionTerm(deal("2026-09", 6), "2026-09")).toEqual({ startMonth: "2026-09", endMonth: "2027-02" })
    expect(conversionTerm(deal("2026-03", 6), "2026-09", "2026-03")).toEqual({ startMonth: "2026-03", endMonth: "2026-08" })
  })

  it("counts the duration from an overriding start", () => {
    expect(conversionTerm(deal("2026-11", 6), "2026-09", "2027-04")).toEqual({ startMonth: "2027-04", endMonth: "2027-09" })
  })

  it("gives a legacy zero-month deal no end", () => {
    expect(conversionTerm(deal("2026-11", 0), "2026-09")).toEqual({ startMonth: "2026-11", endMonth: null })
  })
})

describe("allocationsAfterEnd", () => {
  const row = (engagementId: string, yearMonth: string, days: number) =>
    ({ id: `${engagementId}-${yearMonth}`, userId: "u", engagementId, yearMonth, days }) as Allocation

  it("lists this contract's non-zero days after the end, oldest first", () => {
    const rows = [
      row("e1", "2026-12", 10),
      row("e1", "2026-09", 5), // the end month itself still belongs to the contract
      row("e1", "2026-10", 0), // a stored 0 bills nothing
      row("e2", "2026-11", 8),
      row("e1", "2026-11", 3),
    ]
    expect(allocationsAfterEnd(rows, "e1", "2026-09").map((a) => [a.yearMonth, a.days])).toEqual([
      ["2026-11", 3],
      ["2026-12", 10],
    ])
  })
})

describe("timecardsAfterEnd", () => {
  const card = (engagementId: string, date: string, hours: number) =>
    ({ id: `${engagementId}-${date}`, userId: "u", engagementId, date, hours }) as Timecard

  it("lists this contract's hours after the last day, oldest first", () => {
    const cards = [
      card("e1", "2026-10-02", 4),
      card("e1", "2026-09-30", 8), // the last day itself still belongs to the contract
      card("e2", "2026-10-01", 8),
      card("e1", "2026-10-01", 3),
    ]
    expect(timecardsAfterEnd(cards, "e1", "2026-09-30").map((t) => [t.date, t.hours])).toEqual([
      ["2026-10-01", 3],
      ["2026-10-02", 4],
    ])
  })
})

describe("hoursToDays", () => {
  it("divides by an 8-hour day, unrounded", () => {
    expect(hoursToDays(6)).toBe(0.75)
    expect(hoursToDays(8)).toBe(1)
  })

  // Quarter hours over 8 are exact binary fractions, so sums need no rounding.
  it("adds three 2.5 h entries to exactly 0.9375 gg", () => {
    expect([2.5, 2.5, 2.5].reduce((sum, h) => sum + hoursToDays(h), 0)).toBe(0.9375)
  })
})

describe("contract amendments: schema and read guard", () => {
  const entry = { from: "2027-01", dailyRate: null, addedDays: null, lastDay: null, lastDayBefore: null, note: null }
  const parses = (o: Record<string, unknown>) => contractAmendmentSchema.safeParse({ ...entry, ...o }).success

  it("accepts a rate, days or an end alone, and all of them together", () => {
    expect(parses({ dailyRate: 800 })).toBe(true)
    expect(parses({ addedDays: 2.5 })).toBe(true)
    expect(parses({ lastDay: "2027-06-30", lastDayBefore: "2026-12-31" })).toBe(true)
    expect(parses({ dailyRate: 800, addedDays: 40, lastDay: "2027-06-30", lastDayBefore: "2026-12-31", note: "Addendum 2" })).toBe(true)
  })

  it.each([
    ["changes nothing", {}],
    ["has a zero rate", { dailyRate: 0 }],
    ["adds negative days", { addedDays: -5 }],
    ["has a bad month", { from: "2027-1", dailyRate: 800 }],
    ["has a bad last day", { lastDay: "30/06/2027" }],
    ["has a note over 200 characters", { dailyRate: 800, note: "x".repeat(201) }],
  ])("refuses an entry that %s", (_, o) => {
    expect(parses(o)).toBe(false)
  })

  it("is not a field the Edit form can send", () => {
    expect(updateEngagementSchema.parse({ amendments: [{ ...entry, dailyRate: 800 }] })).toEqual({})
  })

  it("keeps the entries that parse, as a copy without stray keys", () => {
    const good = { ...entry, dailyRate: 800 }
    const raw = [
      { ...good, extra: "dropped" },
      { ...entry, dailyRate: "800" },
      { ...entry, from: "January", dailyRate: 800 },
      { dailyRate: 800, addedDays: null, lastDay: null, lastDayBefore: null, note: null },
      entry,
      null,
    ]
    const read = normalizeAmendments(raw)
    expect(read).toEqual([good])
    expect(read[0]).not.toBe(raw[0])
  })

  it.each([undefined, null, "[]", { from: "2027-01" }])("reads %j as no amendments", (raw) => {
    expect(normalizeAmendments(raw)).toEqual([])
  })
})

// ─── Amend Contract: the one rule set for the dialog and amend_contract ──────

const amendment = (o: Partial<ContractAmendment> = {}): ContractAmendment => ({
  from: "2026-11", dailyRate: null, addedDays: null, lastDay: null, lastDayBefore: null, note: null, ...o,
})

describe("contractDays", () => {
  it("is null with no budget, the signed days with no amendments", () => {
    expect(contractDays({ contractedDays: null, amendments: [amendment({ addedDays: 10 })] })).toBeNull()
    expect(contractDays({ contractedDays: 80 })).toBe(80)
  })

  it("adds every amendment's days, whatever its month", () => {
    const amendments = [amendment({ from: "2027-01", addedDays: 8 }), amendment({ dailyRate: 800 }), amendment({ from: "2026-10", addedDays: 40 })]
    expect(contractDays({ contractedDays: 80, amendments })).toBe(128)
    expect(contractDays({ contractedDays: 7.5, amendments: [amendment({ addedDays: 2.25 })] })).toBe(9.75)
  })
})

describe("amendContract", () => {
  // Lumon PCM: €700/day, 80 days from Jan 2026, ends 31 Dec 2026.
  type Contract = Parameters<typeof amendContract>[0]
  const pcm = (o: Partial<Contract> = {}): Contract => ({
    id: "e1", dailyRate: 700, contractedDays: 80, startMonth: "2026-01", endMonth: "2026-12", endDate: null,
    isActive: true, amendments: [], ...o,
  })
  const today = "2026-10-07"
  const amend = (o: Partial<Contract>, input: Parameters<typeof amendContract>[1], allocations: Pick<Allocation, "engagementId">[] = []) =>
    amendContract(pcm(o), input, { today, allocations })
  const ok = (result: ReturnType<typeof amendContract>) => {
    if ("error" in result) throw new Error(result.error)
    return result
  }
  // Every month from Jan 2025 to the end taken, on a contract signed in 2024.
  const full = { startMonth: "2024-01", amendments: monthsFrom("2025-01", 24).map((from) => amendment({ from, dailyRate: 700 })) }

  it.each<[string, Partial<Contract>, Parameters<typeof amendContract>[1], string]>([
    ["nothing to amend", {}, { from: "2026-11" }, "Nothing to amend"],
    ["a note alone", {}, { from: "2026-11", note: "Addendum 2" }, "A note alone changes nothing"],
    ["no month for a rate", {}, { dailyRate: 800 }, "Pass from (YYYY-MM)"],
    ["month 00", {}, { from: "2026-00", dailyRate: 800 }, '"2026-00" is not one'],
    ["month 13", {}, { from: "2026-13", dailyRate: 800 }, '"2026-13" is not one'],
    ["from before the start", {}, { from: "2025-12", dailyRate: 800 }, "Dec 2025 is before the contract's start (Jan 2026)"],
    ["a rate over the cap", {}, { from: "2026-11", dailyRate: 100_001 }, "at most 100000 €/day"],
    ["a zero rate", {}, { from: "2026-11", dailyRate: 0 }, "dailyRate is more than 0"],
    ["a NaN rate", {}, { from: "2026-11", dailyRate: NaN }, "dailyRate is more than 0"],
    ["days over the cap", {}, { from: "2026-11", addDays: 1001 }, "addDays is more than 0 and at most 1000"],
    ["an hourly rate over the cap", { unit: "hour" }, { from: "2026-11", dailyRate: 100_001 }, "The hourly rate is more than 0 and at most €12,500/h"],
    ["hours over the cap", { unit: "hour" }, { from: "2026-11", addDays: 1001 }, "The hours added are more than 0 and at most 8000."],
    ["the rate already in force, hourly", { unit: "hour", dailyRate: 600 }, { from: "2026-11", dailyRate: 600 }, "The hourly rate in force in Nov 2026 is already €75/h"],
    ["negative days", {}, { from: "2026-11", addDays: -5 }, "To cut days, set an earlier end"],
    ["days on time and materials", { contractedDays: null }, { from: "2026-11", addDays: 10 }, "a budget would cap months already past"],
    ["days on an unanchored contract", { startMonth: null }, { from: "2026-11", addDays: 10 }, "Set the contract's Start first, in the web app's Edit Contract"],
    ["the rate already in force", {}, { from: "2026-11", dailyRate: 700 }, "already €700/day: nothing to amend"],
    [
      "the rate before that month's own amendment",
      { amendments: [amendment({ dailyRate: 800 })] },
      { from: "2026-11", dailyRate: 700 },
      "€700/day is the rate in force before the Nov 2026 amendment: to undo that amendment use remove",
    ],
    ["no end to extend", { endMonth: null }, { lastDay: "2027-06-30" }, "no end to extend"],
    ["the same end", {}, { lastDay: "2026-12-31" }, "not later than the current one (2026-12-31)"],
    ["an earlier end", {}, { lastDay: "2026-11-30" }, "To shorten it use update_engagement"],
    ["a gap after the old end", {}, { from: "2027-03", lastDay: "2027-06-30" }, "Start the renewal from 2027-01"],
    ["a new end before from", { endDate: "2026-12-15" }, { from: "2027-01", lastDay: "2026-12-31" }, "before Jan 2027, the amendment's first month"],
    ["from after the end without a new end", {}, { from: "2027-01", dailyRate: 800 }, "would never apply"],
    ["remove with nothing that month", { amendments: [amendment({ dailyRate: 800 })] }, { from: "2026-12", remove: true }, "No amendment from Dec 2026 to remove. Amendments: Nov 2026."],
    ["remove on a contract with none", {}, { from: "2026-12", remove: true }, "This contract has none."],
    ["remove with a term", { amendments: [amendment({ dailyRate: 800 })] }, { from: "2026-11", remove: true, dailyRate: 800 }, "remove takes only from"],
    ["the same month saying the same", { amendments: [amendment({ dailyRate: 800 })] }, { from: "2026-11", dailyRate: 800 }, "already says this"],
    ["a 25th entry", full, { from: "2024-06", dailyRate: 800 }, "at most 24 amendments"],
    ["a note over 200 characters", {}, { from: "2026-11", dailyRate: 800, note: "x".repeat(201) }, "200"],
  ])("refuses %s", (_, o, input, message) => {
    const result = amend(o, input)
    expect("error" in result && result.error).toContain(message)
  })

  it("records a rate alone, the end untouched", () => {
    expect(ok(amend({}, { from: "2026-11", dailyRate: 800 }))).toEqual({
      changes: { amendments: [amendment({ dailyRate: 800 })] },
      entry: amendment({ dailyRate: 800 }),
      before: null,
    })
  })

  it("records days alone on a contract anchored by a stored row", () => {
    const { changes } = ok(amend({ startMonth: null }, { from: "2026-10", addDays: 40, note: "Addendum 2" }, [{ engagementId: "e1" }]))
    expect(changes).toEqual({ amendments: [amendment({ from: "2026-10", addedDays: 40, note: "Addendum 2" })] })
  })

  it("dates an end alone from the month after the current last day, and writes the end through", () => {
    expect(ok(amend({}, { lastDay: "2027-06-30" }))).toMatchObject({
      changes: { endMonth: "2027-06", endDate: "2027-06-30" },
      entry: amendment({ from: "2027-01", lastDay: "2027-06-30", lastDayBefore: "2026-12-31" }),
    })
    // A last day moved inside its own month dates the entry in that month.
    expect(ok(amend({ endDate: "2026-12-15" }, { lastDay: "2026-12-31" })).entry).toMatchObject({ from: "2026-12", lastDayBefore: "2026-12-15" })
  })

  it("records a renewal with days, and an expansion with a later end (examples 2 and 3)", () => {
    const renewal = ok(amend({}, { lastDay: "2027-06-30", addDays: 48, note: "Renewal 2027" }))
    expect(renewal.entry).toEqual(amendment({ from: "2027-01", addedDays: 48, lastDay: "2027-06-30", lastDayBefore: "2026-12-31", note: "Renewal 2027" }))
    const expansion = ok(amend({}, { from: "2026-10", addDays: 40, lastDay: "2027-01-31", dailyRate: 800 }))
    expect(expansion.changes).toEqual({
      amendments: [amendment({ from: "2026-10", dailyRate: 800, addedDays: 40, lastDay: "2027-01-31", lastDayBefore: "2026-12-31" })],
      endMonth: "2027-01",
      endDate: "2027-01-31",
    })
  })

  it("takes the rate in force re-sent beside days or an end as no rate change", () => {
    const renewal = ok(amend({ dailyRate: 1000 }, { lastDay: "2027-06-30", dailyRate: 1000, addDays: 48 }))
    expect(renewal.entry).toEqual(amendment({ from: "2027-01", addedDays: 48, lastDay: "2027-06-30", lastDayBefore: "2026-12-31" }))
    // Into a month holding a rise, the rate before it undoes the rise and keeps the days.
    const undone = ok(amend({ amendments: [amendment({ dailyRate: 800 })] }, { from: "2026-11", dailyRate: 700, addDays: 10 }))
    expect(undone.entry).toEqual(amendment({ addedDays: 10 }))
    // Alone it is still nothing to amend, the rate printed as money.
    const alone = amend({ dailyRate: 1000 }, { from: "2026-11", dailyRate: 1000 })
    expect("error" in alone && alone.error).toBe("The day rate in force in Nov 2026 is already €1,000/day: nothing to amend.")
  })

  it("merges a second call for the same month: the fields passed replace, days are never added", () => {
    const prev = amendment({ from: "2026-10", addedDays: 40, note: "Addendum 2" })
    const { changes, entry, before } = ok(amend({ amendments: [prev] }, { from: "2026-10", addDays: 20, dailyRate: 800 }))
    expect(entry).toEqual({ ...prev, addedDays: 20, dailyRate: 800 })
    expect(before).toBe(prev)
    expect(changes.amendments).toHaveLength(1)
  })

  it("keeps the end before a month's first extension when that month extends again", () => {
    const prev = amendment({ from: "2027-01", lastDay: "2027-06-30", lastDayBefore: "2026-12-31" })
    const { entry } = ok(amend({ endMonth: "2027-06", amendments: [prev] }, { from: "2027-01", lastDay: "2027-09-30" }))
    expect(entry).toMatchObject({ lastDay: "2027-09-30", lastDayBefore: "2026-12-31" })
  })

  it("merges into a full list, which only refuses a new month", () => {
    expect(ok(amend(full, { from: "2025-03", dailyRate: 800 })).changes.amendments).toHaveLength(24)
  })

  it("removes an amendment and puts back the end it set while the end is still its lastDay", () => {
    const renewal = amendment({ from: "2027-01", addedDays: 48, lastDay: "2027-06-30", lastDayBefore: "2026-12-31" })
    const rate = amendment({ dailyRate: 800 })
    expect(ok(amend({ endMonth: "2027-06", amendments: [rate, renewal] }, { from: "2027-01", remove: true }))).toEqual({
      changes: { amendments: [rate], endDate: "2026-12-31", endMonth: "2026-12" },
      entry: null,
      before: renewal,
    })
    // The end moved since (shortened in Edit): only the entry goes.
    expect(ok(amend({ endMonth: "2027-03", amendments: [renewal] }, { from: "2027-01", remove: true })).changes).toEqual({ amendments: [] })
  })

  it("refuses a remove whose restored end would leave a later amendment that never applies", () => {
    const renewal = amendment({ from: "2027-01", lastDay: "2027-06-30", lastDayBefore: "2026-12-31" })
    const later = amendment({ from: "2027-03", dailyRate: 1100, addedDays: 20 })
    const result = amend({ endMonth: "2027-06", amendments: [renewal, later] }, { from: "2027-01", remove: true })
    expect("error" in result && result.error).toBe(
      "Removing it puts the end back to 2026-12-31, and the Mar 2027 amendment would then never apply: remove it first.",
    )
    // Removed first, the renewal then goes with its end.
    const { changes } = ok(amend({ endMonth: "2027-06", amendments: [renewal] }, { from: "2027-01", remove: true }))
    expect(changes).toMatchObject({ amendments: [], endMonth: "2026-12" })
    // An end that moved since stays, so nothing is stranded.
    expect(ok(amend({ endMonth: "2027-09", amendments: [renewal, later] }, { from: "2027-01", remove: true })).changes).toEqual({ amendments: [later] })
  })

  it("keeps a closed contract closed for history, and reopens it when extended past today", () => {
    const closed = { isActive: false, endMonth: "2026-09", endDate: "2026-09-30" }
    expect(ok(amend(closed, { from: "2026-09", dailyRate: 800 })).changes).not.toHaveProperty("isActive")
    expect(ok(amend(closed, { lastDay: "2026-12-31" })).changes).toMatchObject({ isActive: true, endMonth: "2026-12" })
    // Extended to a day already past: still closed.
    expect(ok(amend({ ...closed, endMonth: "2026-06", endDate: "2026-06-30" }, { lastDay: "2026-08-31" })).changes).not.toHaveProperty("isActive")
  })

  it("writes the list sorted and never touches the stored one", () => {
    const stored = Object.freeze([amendment({ from: "2026-12", dailyRate: 820 }), amendment({ from: "2026-08", dailyRate: 790 })])
    const { changes } = ok(amend({ amendments: stored as ContractAmendment[] }, { from: "2026-10", dailyRate: 800 }))
    expect(changes.amendments?.map((a) => a.from)).toEqual(["2026-08", "2026-10", "2026-12"])
    expect(stored.map((a) => a.from)).toEqual(["2026-12", "2026-08"])
  })

  it("accepts a whole Engagement", () => {
    const e: Engagement = {
      ...pcm(), userId: "u", clientId: "c", name: null, opportunityId: null, vatApplicable: true,
      defaultDaysPerMonth: 10, notes: null, createdAt: new Date(), updatedAt: new Date(),
    }
    expect("error" in amendContract(e, { from: "2026-11", dailyRate: 800 }, { today, allocations: [] })).toBe(false)
  })
})

describe("endBeforeAmendmentError", () => {
  // Signed to Mar 2027, amended from Jan 2027 (a new rate) and Mar 2027 (an extension).
  const jan = amendment({ from: "2027-01", dailyRate: 800 })
  const mar = amendment({ from: "2027-03", lastDay: "2027-03-31", lastDayBefore: "2027-02-28" })
  const both = { amendments: [jan, mar] }

  it.each<[string, { amendments?: ContractAmendment[] }, string | null, string | null]>([
    ["no amendments", {}, "2026-10", null],
    ["an empty list", { amendments: [] }, "2026-10", null],
    ["no end", both, null, null],
    ["an end in the last amendment's month", both, "2027-03", null],
    ["an end after every amendment", both, "2027-06", null],
    ["an end in an amendment's own month", { amendments: [jan] }, "2027-01", null],
    ["an end the month before one", { amendments: [jan] }, "2026-12", "the Jan 2027 amendment: it would never apply"],
    ["an end between two", both, "2027-02", "the Mar 2027 amendment: it would never apply"],
    ["an end before both", both, "2026-10", "the Jan 2027, Mar 2027 amendments: they would never apply"],
  ])("%s → %j", (_label, e, endMonth, expected) => {
    const error = endBeforeAmendmentError(e, endMonth, "app")
    if (expected === null) expect(error).toBeNull()
    else expect(error).toContain(expected)
  })

  it("names the fix where the owner is: the dialog, or amend_contract latest first", () => {
    expect(endBeforeAmendmentError({ amendments: [jan] }, "2026-10", "app")).toBe(
      "The end moves before the Jan 2027 amendment: it would never apply. Remove it with Amend Contract first.",
    )
    expect(endBeforeAmendmentError(both, "2026-10", "app")).toBe(
      "The end moves before the Jan 2027, Mar 2027 amendments: they would never apply. Remove them with Amend Contract first.",
    )
    expect(endBeforeAmendmentError({ amendments: [jan] }, "2026-10", "chat")).toBe(
      "The end moves before the Jan 2027 amendment: it would never apply. Remove it first: amend_contract remove with from 2027-01.",
    )
    expect(endBeforeAmendmentError(both, "2026-10", "chat")).toBe(
      "The end moves before the Jan 2027, Mar 2027 amendments: they would never apply. " +
        "Remove them first, the latest first: amend_contract remove with from 2027-03, then 2027-01.",
    )
  })
})

describe("isOverBudget", () => {
  it("treats half a hundredth of a day as rounding, not an overrun", () => {
    expect(isOverBudget({ total: 10, used: 10.004 })).toBe(false)
    expect(isOverBudget({ total: 10, used: 10.006 })).toBe(true)
  })
})

describe("runOutMonth", () => {
  it.each([
    ["no cap", null, "2026-12"],
    ["under budget", { total: 10, used: 3 }, "2026-12"],
    ["rounding is not an overrun", { total: 10, used: 10.004 }, "2026-12"],
    ["over budget", { total: 10, used: 10.006 }, null],
    ["15 of 10 days", { total: 10, used: 15 }, null],
  ])("%s", (_, usage, expected) => {
    expect(runOutMonth(usage, "2026-12")).toBe(expected)
  })
  it("passes a null month through", () => {
    expect(runOutMonth({ total: 10, used: 3 }, null)).toBeNull()
  })
})

describe("contractUsage", () => {
  const contract = { id: "e1", contractedDays: 80, amendments: [{ from: "2026-12", dailyRate: null, addedDays: 10 }] }
  const tc = (date: string, hours: number, engagementId = "e1") => ({ engagementId, date, hours })
  const cells = [
    { yearMonth: "2026-10", billableDays: 8 },
    { yearMonth: "2026-11", billableDays: 10 },
    { yearMonth: "2026-12", billableDays: 0 },
    { yearMonth: "2027-01", billableDays: 6 },
  ]

  it("is the hours up to today against every amendment's days, then the plan from this month on", () => {
    const usage = contractUsage({
      engagement: contract,
      timecards: [tc("2026-08-04", 64), tc("2026-09-10", 60), tc("2026-10-02", 32), tc("2026-10-20", 8), tc("2026-09-01", 99, "e2")],
      cells,
      today: "2026-10-15",
    })
    // 64 + 60 + 32 h = 19.5 days; the 20 Oct hours are scheduled, another contract's are not its own.
    expect(usage).toEqual({
      total: 90,
      used: 19.5,
      left: 70.5,
      months: [
        { yearMonth: "2026-08", used: 8, planned: 0 },
        { yearMonth: "2026-09", used: 7.5, planned: 0 },
        { yearMonth: "2026-10", used: 4, planned: 8 },
        { yearMonth: "2026-11", used: 0, planned: 10 },
        { yearMonth: "2027-01", used: 0, planned: 6 },
      ],
    })
  })

  it("3 h of a 100 h contract leaves 97 h, the Plan's figure, not 96.96", () => {
    const hourly = { id: "e1", contractedDays: 12.5 }
    const usage = contractUsage({ engagement: hourly, timecards: [tc("2026-10-02", 3)], cells: [], today: "2026-10-15" })!
    expect(inContractUnit(usage.left, "hour")).toBe(97)
    expect(inContractUnit(usage.used, "hour")).toBe(3)
    expect(inContractUnit(usage.months[0].used, "hour")).toBe(3)
    const plan = contractRemaining({ engagement: hourly, timecards: [tc("2026-10-02", 3)], cells: [], today: "2026-10-15" })
    expect(plan.cap && inContractUnit(plan.left, "hour")).toBe(inContractUnit(usage.left, "hour"))
  })

  it("a day contract still reads whole hundredths of a day: 1 d of 10 leaves 9 d", () => {
    const usage = contractUsage({ engagement: { id: "e1", contractedDays: 10 }, timecards: [tc("2026-10-02", 8)], cells: [], today: "2026-10-15" })!
    expect([inContractUnit(usage.used, "day"), inContractUnit(usage.left, "day")]).toEqual([1, 9])
  })

  it("is null with no cap, never below zero left, and stops `ahead` months on", () => {
    expect(contractUsage({ engagement: { ...contract, contractedDays: null }, timecards: [], cells, today: "2026-10-15" })).toBeNull()
    const over = contractUsage({ engagement: { id: "e1", contractedDays: 2 }, timecards: [tc("2026-10-01", 40)], cells, today: "2026-10-15", ahead: 1 })
    expect(over?.left).toBe(0)
    expect(over?.months.map((m) => m.yearMonth)).toEqual(["2026-10", "2026-11"])
  })
})

describe("contract unit", () => {
  // €75/h for 100 h, 40 h/month: stored as €600/day for 12.5 days, 5 days/month.
  const hourly = { unit: "hour" as const, rate: 75, contracted: 100, perMonth: 40 }
  const stored = { dailyRate: 600, contractedDays: 12.5, defaultDaysPerMonth: 5 }

  it("fromContractUnit stores an hourly contract in days", () => {
    expect(fromContractUnit(hourly)).toEqual(stored)
  })

  it("toContractUnit gives it back", () => {
    expect(toContractUnit({ unit: "hour", ...stored })).toEqual({ rate: 75, contracted: 100, perMonth: 40 })
  })

  it("a day contract passes through unchanged, and a missing unit reads as day", () => {
    expect(fromContractUnit({ unit: "day", rate: 600, contracted: 12.5, perMonth: 5 })).toEqual(stored)
    expect(toContractUnit({ unit: "day", ...stored })).toEqual({ rate: 600, contracted: 12.5, perMonth: 5 })
    expect(toContractUnit(stored)).toEqual({ rate: 600, contracted: 12.5, perMonth: 5 })
    expect(toContractUnit({ unit: null, ...stored }).rate).toBe(600)
  })

  it("keeps an open-ended budget open", () => {
    expect(fromContractUnit({ ...hourly, contracted: null }).contractedDays).toBeNull()
    expect(toContractUnit({ unit: "hour", ...stored, contractedDays: null }).contracted).toBeNull()
  })

  it("formats an amount in the contract's unit", () => {
    const hour = { unit: "hour" as const }
    expect(formatContractQuantity(hour, 12.5)).toBe("100 h")
    expect(formatContractQuantity({ unit: "day" }, 12.5)).toBe("12.5 d")
    expect(formatContractQuantity({}, 12.5)).toBe("12.5 d")
    expect(formatContractQuantity(hour, 1.25)).toBe("10 h")
    expect(formatContractQuantity({ unit: "day" }, 1.25)).toBe("1.25 d")
    expect(formatContractQuantity(hour, 0.375)).toBe("3 h")
  })

  it("keeps the cents of an hourly rate in the label", () => {
    expect(engagementRateLabel({ ...stored, dailyRate: 500, unit: "hour" })).toBe("40 hours/month × €62.50/h")
  })

  it("shows 10 logged hours as \"10 h\" of the contract's 100 h", () => {
    const usage = contractUsage({
      engagement: { id: "e", contractedDays: 12.5 },
      timecards: [{ engagementId: "e", date: "2026-09-10", hours: 10 }],
      cells: [],
      today: "2026-09-30",
    })!
    expect(`${formatContractQuantity({ unit: "hour" }, usage.used)} of ${formatContractQuantity({ unit: "hour" }, usage.total)}`).toBe("10 h of 100 h")
  })

  it("an hourly contract bills hours × rate: 10 h at €75/h is €750, not €93.75", () => {
    expect(hoursToDays(10) * fromContractUnit(hourly).dailyRate).toBe(750)
    // The form ignoring the unit stores the typed 75 as the day rate: that is the bug.
    expect(hoursToDays(10) * 75).toBe(93.75)
  })

  it("labels an unnamed hourly contract in hours", () => {
    expect(engagementRateLabel({ ...stored, unit: "hour" })).toBe(`40 hours/month × ${eur(75)}/h`)
    expect(engagementRateLabel(stored)).toBe(`5 days/month × ${eur(600)}`)
  })
})

describe("unit in the schemas", () => {
  const contract = { clientId: "c1", dailyRate: 600, vatApplicable: true, defaultDaysPerMonth: 5 }
  const deal = {
    clientId: "c1", title: "Deal", stage: "lead", probability: 10, dailyRate: 600,
    estimatedDaysPerMonth: 5, estimatedDurationMonths: 6, vatApplicable: true,
  }

  it.each([undefined, "day", "hour"])("accepts unit %j and round-trips it", (unit) => {
    expect(createEngagementSchema.parse({ ...contract, unit }).unit).toBe(unit)
    expect(updateEngagementSchema.parse({ unit }).unit).toBe(unit)
    expect(createOpportunitySchema.parse({ ...deal, unit }).unit).toBe(unit)
    expect(updateOpportunitySchema.parse({ unit }).unit).toBe(unit)
  })

  it.each(["week", "", null, "Hour"])("refuses unit %j", (unit) => {
    expect(createEngagementSchema.safeParse({ ...contract, unit }).success).toBe(false)
    expect(updateEngagementSchema.safeParse({ unit }).success).toBe(false)
    expect(createOpportunitySchema.safeParse({ ...deal, unit }).success).toBe(false)
    expect(updateOpportunitySchema.safeParse({ unit }).success).toBe(false)
  })
})

describe("contractRemaining", () => {
  const today = "2026-10-19"
  const engagement = { id: "e1", contractedDays: 60 }
  const day = (date: string, hours: number) => ({ engagementId: "e1", date, hours })
  // 27.5 d worked in September: 220 h.
  const worked = [day("2026-09-01", 220)]
  const plan = (...p: [string, number][]) => p.map(([yearMonth, plannedDays]) => ({ yearMonth, plannedDays }))
  const run = (over: Partial<Parameters<typeof contractRemaining>[0]> = {}) =>
    contractRemaining({ engagement, timecards: worked, cells: [], today, ...over })

  it("a 60 d contract with 27.5 d worked and 28.5 d planned ahead has 32.5 left and 4 not planned", () => {
    expect(run({ cells: plan(["2026-11", 20], ["2026-12", 8.5]) })).toEqual({
      cap: true, total: 60, worked: 27.5, left: 32.5, plannedAhead: 28.5, notPlanned: 4,
    })
  })

  it("a plan beyond what is left is a negative not planned", () => {
    const typed = [{ engagementId: "e1", yearMonth: "2026-11" }, { engagementId: "e1", yearMonth: "2026-12" }]
    expect(run({ cells: plan(["2026-11", 30], ["2026-12", 12.5]), allocations: typed })).toMatchObject({ left: 32.5, notPlanned: -10 })
  })

  it("an amendment adding days raises the total", () => {
    const amended = { ...engagement, amendments: [{ addedDays: 10 }] }
    expect(run({ engagement: amended })).toMatchObject({ total: 70, left: 42.5 })
  })

  it("an hourly contract is the same days, in hours once shown", () => {
    // 100 h contract = 12.5 d; 40 h worked = 5 d; 20 h planned = 2.5 d.
    const r = contractRemaining({
      engagement: { id: "e1", contractedDays: 12.5 }, timecards: [day("2026-10-05", 40)],
      cells: plan(["2026-11", 2.5]), today,
    })
    expect(r).toMatchObject({ left: 7.5, notPlanned: 5 })
  })

  it("keeps odd hours exact: 3 h of 100 h leaves 97 h, not 97.04", () => {
    // 100 h = 12.5 d; 3 h = 0.375 d. Unrounded, so the one display rounding in hours gives 97 and 3.
    const r = contractRemaining({ engagement: { id: "e1", contractedDays: 12.5 }, timecards: [day("2026-10-05", 3)], cells: [], today })
    expect(r).toMatchObject({ cap: true, left: 12.125, worked: 0.375 })
    expect(inContractUnit(r.cap ? r.left : 0, "hour")).toBe(97)
    expect(contractRemaining({ engagement: { id: "e1", contractedDays: null }, timecards: [day("2026-10-05", 3)], cells: [], today })).toEqual({ cap: false, worked: 0.375 })
  })

  it("no budget has no cap and the worked days", () => {
    expect(run({ engagement: { id: "e1", contractedDays: null } })).toEqual({ cap: false, worked: 27.5 })
  })

  it("the current month's plan counts only what is not worked yet", () => {
    const tc = [...worked, day("2026-10-05", 16)] // 2 d this month
    expect(run({ timecards: tc, cells: plan(["2026-10", 10]) })).toMatchObject({ left: 30.5, plannedAhead: 8, notPlanned: 22.5 })
    expect(run({ timecards: tc, cells: plan(["2026-10", 1]) })).toMatchObject({ plannedAhead: 0 })
  })

  it("a past month's plan and hours after today do not count as worked", () => {
    const tc = [...worked, day("2026-10-23", 8)]
    expect(run({ timecards: tc, cells: plan(["2026-09", 20]) })).toMatchObject({ worked: 27.5, plannedAhead: 1 })
  })

  it("a draft replaces its stored value", () => {
    const tc = [day("2026-10-19", 8)]
    const base = { timecards: tc, cells: plan(["2026-11", 10]) }
    expect(run({ ...base, drafts: { hours: { "2026-10-19": 16 } } })).toMatchObject({ worked: 2, left: 58 })
    expect(run({ ...base, drafts: { hours: { "2026-11-02": 8 } } })).toMatchObject({ worked: 1, plannedAhead: 10 })
    expect(run({ ...base, drafts: { hours: { "2026-11-02": 120 } } })).toMatchObject({ plannedAhead: 15 })
    expect(run({ ...base, drafts: { months: { "2026-11": 4 } } })).toMatchObject({ plannedAhead: 4 })
  })

  describe("the default plan up to the budget", () => {
    // Nothing worked: 60 d left. The default 22 d a month over 12 months would be 264 d.
    const untouched = (mo: string) => ({ yearMonth: mo, plannedDays: 22 })
    const cells = ["2026-11", "2026-12", "2027-01", "2027-02"].map(untouched)
    const none = { timecards: [], cells }

    it("an untouched capped contract is never over plan: the default fills only the budget", () => {
      expect(run({ ...none })).toMatchObject({ left: 60, plannedAhead: 60, notPlanned: 0 })
    })

    it("a typed month counts in full: over plan by exactly its excess", () => {
      const typed = [{ engagementId: "e1", yearMonth: "2026-11" }]
      expect(run({ ...none, cells: [{ yearMonth: "2026-11", plannedDays: 70 }, ...cells.slice(1)], allocations: typed })).toMatchObject({
        plannedAhead: 70, notPlanned: -10,
      })
      // A draft is typed too; another contract's allocation is not.
      expect(run({ ...none, drafts: { months: { "2026-11": 65 } } })).toMatchObject({ plannedAhead: 65, notPlanned: -5 })
      expect(run({ ...none, allocations: [{ engagementId: "other", yearMonth: "2026-11" }] })).toMatchObject({ notPlanned: 0 })
    })

    it("the default fills what the typed months leave", () => {
      const typed = [{ engagementId: "e1", yearMonth: "2026-11" }]
      expect(run({ ...none, allocations: typed })).toMatchObject({ plannedAhead: 60, notPlanned: 0 })
      expect(run({ ...none, drafts: { months: { "2026-11": 10 } } })).toMatchObject({ plannedAhead: 60, notPlanned: 0 })
      expect(run({ ...none, cells: cells.slice(0, 2), drafts: { months: { "2026-11": 10 } } })).toMatchObject({ plannedAhead: 32, notPlanned: 28 })
    })

    it("a month cleared back to its default is capped by the room, not typed", () => {
      const typed = [{ engagementId: "e1", yearMonth: "2026-11" }, { engagementId: "e1", yearMonth: "2026-12" }]
      const stored = [{ yearMonth: "2026-11", plannedDays: 70 }, { yearMonth: "2026-12", plannedDays: 5 }]
      expect(run({ ...none, cells: stored, allocations: typed })).toMatchObject({ notPlanned: -15 })
      expect(run({ ...none, cells: stored, allocations: typed, drafts: { defaults: { "2026-12": 22 } } })).toMatchObject({ notPlanned: -10 })
    })

    it("scheduled hours in a default month count fully even with no room", () => {
      // 100 d scheduled in November (800 h) exceeds the 60 d budget: the default months add nothing.
      const sched = [day("2026-11-02", 800)]
      expect(run({ timecards: sched, cells })).toMatchObject({ plannedAhead: 100, notPlanned: -40 })
    })
  })

  // A regression guard: the "over budget" figure itself is the component's (contract-remaining.test.tsx).
  it("worked beyond the budget: nothing left, and any plan ahead is over plan", () => {
    // 62 d worked of 60 d: 496 h.
    const over = [day("2026-09-01", 496)]
    expect(run({ timecards: over })).toMatchObject({ worked: 62, left: 0, notPlanned: 0 })
    expect(run({ timecards: over, cells: plan(["2026-11", 5]), drafts: { months: { "2026-11": 5 } } })).toMatchObject({ left: 0, notPlanned: -5 })
  })
})

describe("two people's hours on one contract", () => {
  const today = "2026-10-19"
  const engagement = { id: "e1", contractedDays: 60 }
  // The owner's 8 h and a collaborator's 8 h on the same day are 2 days, not 1.
  const both = [
    { engagementId: "e1", collaboratorId: null, date: "2026-10-05", hours: 8 },
    { engagementId: "e1", collaboratorId: "g", date: "2026-10-05", hours: 8 },
  ]

  it("contractRemaining counts both on a shared day", () => {
    expect(contractRemaining({ engagement, timecards: both, cells: [], today })).toMatchObject({ worked: 2, left: 58 })
  })

  it("a typed day replaces the day's total, everyone's", () => {
    const r = contractRemaining({ engagement, timecards: both, cells: [], today, drafts: { hours: { "2026-10-05": 24 } } })
    expect(r).toMatchObject({ worked: 3, left: 57 })
  })

  it("contractUsage and its run-out count both", () => {
    const u = contractUsage({ engagement, timecards: both, cells: [], today })
    expect(u).toMatchObject({ used: 2, left: 58 })
  })
})
