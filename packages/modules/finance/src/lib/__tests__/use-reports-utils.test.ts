/**
 * Unit tests for the pure utility functions exported from use-reports.ts.
 * These functions have no React or TanStack Query dependencies and can be
 * tested directly without a provider setup.
 */
import { describe, it, expect } from "vitest"

import {
  analysisPeriodToDateRange,
  defaultAnalysisPeriod,
  deltaText,
  effectiveComparisonMode,
  netDetail,
  getComparisonPeriod,
  getPreviousPeriod,
  legacyPeriodToAnalysis,
  fillMonths,
  periodEyebrow,
  periodLabel,
  periodSubtitle,
  serializePeriod,
  deserializePeriod,
  trendMonths,
  trendPeriod,
} from "../../hooks/use-reports"

// ─── analysisPeriodToDateRange ────────────────────────────────────────────────

describe("analysisPeriodToDateRange", () => {
  it("monthly: from = first day of the month, to = last day of the month", () => {
    const { from, to } = analysisPeriodToDateRange({ mode: "monthly", year: 2024, month: 3 })
    expect(from.getFullYear()).toBe(2024)
    expect(from.getMonth()).toBe(2) // 0-indexed
    expect(from.getDate()).toBe(1)
    expect(to.getMonth()).toBe(2)
    expect(to.getDate()).toBe(31) // March has 31 days
  })

  it("monthly: February end-of-month respects leap year", () => {
    const { to } = analysisPeriodToDateRange({ mode: "monthly", year: 2024, month: 2 })
    expect(to.getDate()).toBe(29) // 2024 is a leap year
  })

  it("monthly: February in non-leap year ends on 28th", () => {
    const { to } = analysisPeriodToDateRange({ mode: "monthly", year: 2023, month: 2 })
    expect(to.getDate()).toBe(28)
  })

  it("yearly: from = Jan 1, to = Dec 31 of the given year", () => {
    const { from, to } = analysisPeriodToDateRange({ mode: "yearly", year: 2024 })
    expect(from.getFullYear()).toBe(2024)
    expect(from.getMonth()).toBe(0)
    expect(from.getDate()).toBe(1)
    expect(to.getFullYear()).toBe(2024)
    expect(to.getMonth()).toBe(11)
    expect(to.getDate()).toBe(31)
  })

  it("last12months: to is in the current month", () => {
    const now = new Date()
    const { to } = analysisPeriodToDateRange({ mode: "last12months" })
    expect(to.getMonth()).toBe(now.getMonth())
    expect(to.getFullYear()).toBe(now.getFullYear())
  })

  it("last12months: from is ~12 months before to", () => {
    const { from, to } = analysisPeriodToDateRange({ mode: "last12months" })
    expect(from.getTime()).toBeLessThan(to.getTime())
  })

  it("rolling 6 months covers a wider window than rolling 3 months", () => {
    const r3 = analysisPeriodToDateRange({ mode: "rolling", months: 3 })
    const r6 = analysisPeriodToDateRange({ mode: "rolling", months: 6 })
    expect(r6.from.getTime()).toBeLessThan(r3.from.getTime())
  })

  it("rolling 12 months covers a wider window than rolling 6 months", () => {
    const r6 = analysisPeriodToDateRange({ mode: "rolling", months: 6 })
    const r12 = analysisPeriodToDateRange({ mode: "rolling", months: 12 })
    expect(r12.from.getTime()).toBeLessThan(r6.from.getTime())
  })
})

// ─── defaultAnalysisPeriod ────────────────────────────────────────────────────

describe("defaultAnalysisPeriod", () => {
  it("returns mode=monthly for the current year and month", () => {
    const now = new Date()
    const period = defaultAnalysisPeriod()
    expect(period.mode).toBe("monthly")
    if (period.mode === "monthly") {
      expect(period.year).toBe(now.getFullYear())
      expect(period.month).toBe(now.getMonth() + 1)
    }
  })
})

// ─── legacyPeriodToAnalysis ───────────────────────────────────────────────────

describe("legacyPeriodToAnalysis", () => {
  it("'this-month' → current month in monthly mode", () => {
    const now = new Date()
    const period = legacyPeriodToAnalysis("this-month")
    expect(period.mode).toBe("monthly")
    if (period.mode === "monthly") {
      expect(period.year).toBe(now.getFullYear())
      expect(period.month).toBe(now.getMonth() + 1)
    }
  })

  it("'last-month' → previous month in monthly mode", () => {
    const period = legacyPeriodToAnalysis("last-month")
    expect(period.mode).toBe("monthly")
  })

  it("'last-3-months' → rolling 3 months", () => {
    const period = legacyPeriodToAnalysis("last-3-months")
    expect(period.mode).toBe("rolling")
    if (period.mode === "rolling") expect(period.months).toBe(3)
  })

  it("'last-6-months' → rolling 6 months", () => {
    const period = legacyPeriodToAnalysis("last-6-months")
    expect(period.mode).toBe("rolling")
    if (period.mode === "rolling") expect(period.months).toBe(6)
  })

  it("'this-year' → current year in yearly mode", () => {
    const now = new Date()
    const period = legacyPeriodToAnalysis("this-year")
    expect(period.mode).toBe("yearly")
    if (period.mode === "yearly") expect(period.year).toBe(now.getFullYear())
  })

  it("unknown value falls back to current month (monthly mode)", () => {
    const period = legacyPeriodToAnalysis("unknown-period")
    expect(period.mode).toBe("monthly")
  })
})

// ─── serializePeriod ──────────────────────────────────────────────────────────

describe("serializePeriod", () => {
  it("serializes a monthly period to p/y/m params", () => {
    expect(serializePeriod({ mode: "monthly", year: 2024, month: 3 })).toEqual({
      p: "monthly",
      y: "2024",
      m: "3",
    })
  })

  it("serializes a yearly period to p/y params", () => {
    expect(serializePeriod({ mode: "yearly", year: 2024 })).toEqual({
      p: "yearly",
      y: "2024",
    })
  })

  it("serializes last12months to { p: 'last12' }", () => {
    expect(serializePeriod({ mode: "last12months" })).toEqual({ p: "last12" })
  })

  it("serializes rolling 3 months to p/n params", () => {
    expect(serializePeriod({ mode: "rolling", months: 3 })).toEqual({ p: "rolling", n: "3" })
  })

  it("serializes rolling 6 months to p/n params", () => {
    expect(serializePeriod({ mode: "rolling", months: 6 })).toEqual({ p: "rolling", n: "6" })
  })

  it("serializes rolling 12 months to p/n params", () => {
    expect(serializePeriod({ mode: "rolling", months: 12 })).toEqual({ p: "rolling", n: "12" })
  })

  it("round-trips: serialize then deserialize returns the same period", () => {
    const original = { mode: "monthly" as const, year: 2025, month: 7 }
    const params = new URLSearchParams(serializePeriod(original))
    const result = deserializePeriod(params)
    expect(result).toEqual(original)
  })
})

// ─── deserializePeriod ────────────────────────────────────────────────────────

function p(obj: Record<string, string>): URLSearchParams {
  return new URLSearchParams(obj)
}

describe("deserializePeriod", () => {
  it("deserializes valid monthly params", () => {
    expect(deserializePeriod(p({ p: "monthly", y: "2024", m: "3" }))).toEqual({
      mode: "monthly",
      year: 2024,
      month: 3,
    })
  })

  it("deserializes valid yearly params", () => {
    expect(deserializePeriod(p({ p: "yearly", y: "2024" }))).toEqual({
      mode: "yearly",
      year: 2024,
    })
  })

  it("deserializes last12 param", () => {
    expect(deserializePeriod(p({ p: "last12" }))).toEqual({ mode: "last12months" })
  })

  it("deserializes valid rolling params (3)", () => {
    expect(deserializePeriod(p({ p: "rolling", n: "3" }))).toEqual({ mode: "rolling", months: 3 })
  })

  it("deserializes valid rolling params (6)", () => {
    expect(deserializePeriod(p({ p: "rolling", n: "6" }))).toEqual({ mode: "rolling", months: 6 })
  })

  it("deserializes valid rolling params (12)", () => {
    expect(deserializePeriod(p({ p: "rolling", n: "12" }))).toEqual({ mode: "rolling", months: 12 })
  })

  it("defaults to current month for empty params", () => {
    const now = new Date()
    const period = deserializePeriod(new URLSearchParams())
    expect(period.mode).toBe("monthly")
    if (period.mode === "monthly") {
      expect(period.year).toBe(now.getFullYear())
      expect(period.month).toBe(now.getMonth() + 1)
    }
  })

  it("defaults to current month when monthly params are invalid (year <= 2000)", () => {
    const now = new Date()
    const period = deserializePeriod(p({ p: "monthly", y: "1999", m: "5" }))
    expect(period.mode).toBe("monthly")
    if (period.mode === "monthly") expect(period.year).toBe(now.getFullYear())
  })

  it("defaults to current month when monthly month param is out of range", () => {
    const now = new Date()
    const period = deserializePeriod(p({ p: "monthly", y: "2024", m: "13" }))
    expect(period.mode).toBe("monthly")
    if (period.mode === "monthly") expect(period.year).toBe(now.getFullYear())
  })

  it("defaults to current year when yearly params are invalid", () => {
    const now = new Date()
    const period = deserializePeriod(p({ p: "yearly", y: "500" }))
    expect(period.mode).toBe("yearly")
    if (period.mode === "yearly") expect(period.year).toBe(now.getFullYear())
  })

  it("defaults rolling n to 6 for unrecognised n values", () => {
    const period = deserializePeriod(p({ p: "rolling", n: "99" }))
    expect(period.mode).toBe("rolling")
    if (period.mode === "rolling") expect(period.months).toBe(6)
  })

  it("deserializes valid custom params", () => {
    const period = deserializePeriod(p({ p: "custom", f: "2025-01-15", t: "2025-03-20" }))
    expect(period.mode).toBe("custom")
    if (period.mode === "custom") {
      expect(period.from.getFullYear()).toBe(2025)
      expect(period.from.getMonth()).toBe(0)
      expect(period.from.getDate()).toBe(15)
      expect(period.to.getFullYear()).toBe(2025)
      expect(period.to.getMonth()).toBe(2)
      expect(period.to.getDate()).toBe(20)
    }
  })

  it("defaults to current month for custom with missing dates", () => {
    const now = new Date()
    const period = deserializePeriod(p({ p: "custom" }))
    expect(period.mode).toBe("monthly")
    if (period.mode === "monthly") {
      expect(period.year).toBe(now.getFullYear())
    }
  })

  it("defaults to current month for custom with invalid dates", () => {
    const now = new Date()
    const period = deserializePeriod(p({ p: "custom", f: "not-a-date", t: "also-bad" }))
    expect(period.mode).toBe("monthly")
    if (period.mode === "monthly") {
      expect(period.year).toBe(now.getFullYear())
    }
  })
})

// ─── custom period in analysisPeriodToDateRange ─────────────────────────────

describe("analysisPeriodToDateRange – custom mode", () => {
  it("returns the exact from/to dates for custom mode", () => {
    const from = new Date(2025, 0, 15)
    const to = new Date(2025, 2, 20, 23, 59, 59)
    const range = analysisPeriodToDateRange({ mode: "custom", from, to })
    expect(range.from).toEqual(from)
    expect(range.to).toEqual(to)
  })
})

// ─── custom period serialization ─────────────────────────────────────────────

describe("serializePeriod – custom mode", () => {
  it("serializes custom period to p/f/t params", () => {
    const from = new Date(2025, 0, 15)
    const to = new Date(2025, 2, 20)
    const serialized = serializePeriod({ mode: "custom", from, to })
    expect(serialized.p).toBe("custom")
    expect(serialized.f).toBe("2025-01-15")
    expect(serialized.t).toBe("2025-03-20")
  })

  it("round-trips custom period through serialize/deserialize", () => {
    const from = new Date("2025-03-01T00:00:00")
    const to = new Date("2025-03-31T23:59:59")
    const params = new URLSearchParams(serializePeriod({ mode: "custom", from, to }))
    const result = deserializePeriod(params)
    expect(result.mode).toBe("custom")
    if (result.mode === "custom") {
      expect(result.from.getDate()).toBe(1)
      expect(result.to.getDate()).toBe(31)
    }
  })
})

// ─── getPreviousPeriod ──────────────────────────────────────────────────────

describe("getPreviousPeriod", () => {
  it("returns null for mode 'none'", () => {
    expect(getPreviousPeriod({ mode: "monthly", year: 2025, month: 3 }, "none")).toBeNull()
  })

  it("previous monthly: March 2025 → February 2025", () => {
    const result = getPreviousPeriod({ mode: "monthly", year: 2025, month: 3 }, "previous")
    expect(result).toEqual({ mode: "monthly", year: 2025, month: 2 })
  })

  it("previous monthly: January 2025 → December 2024", () => {
    const result = getPreviousPeriod({ mode: "monthly", year: 2025, month: 1 }, "previous")
    expect(result).toEqual({ mode: "monthly", year: 2024, month: 12 })
  })

  it("previous yearly: 2025 → 2024", () => {
    const result = getPreviousPeriod({ mode: "yearly", year: 2025 }, "previous")
    expect(result).toEqual({ mode: "yearly", year: 2024 })
  })

  it("year-ago monthly: March 2025 → March 2024", () => {
    const result = getPreviousPeriod({ mode: "monthly", year: 2025, month: 3 }, "year-ago")
    expect(result).toEqual({ mode: "monthly", year: 2024, month: 3 })
  })

  it("year-ago yearly: 2025 → 2024", () => {
    const result = getPreviousPeriod({ mode: "yearly", year: 2025 }, "year-ago")
    expect(result).toEqual({ mode: "yearly", year: 2024 })
  })

  it("year-ago returns null for rolling periods", () => {
    expect(getPreviousPeriod({ mode: "rolling", months: 3 }, "year-ago")).toBeNull()
  })

  it("year-ago returns null for last12months", () => {
    expect(getPreviousPeriod({ mode: "last12months" }, "year-ago")).toBeNull()
  })
})

// ─── The words around a period ──────────────────────────────────────────────

describe("periodLabel and periodSubtitle", () => {
  it.each([
    [{ mode: "monthly", year: 2026, month: 10 }, "October 2026", "Where your money went in October 2026"],
    [{ mode: "yearly", year: 2025 }, "2025", "Where your money went in 2025"],
    [{ mode: "last12months" }, "the last 12 months", "Where your money went in the last 12 months"],
    [{ mode: "rolling", months: 3 }, "the last 3 months", "Where your money went in the last 3 months"],
    [
      { mode: "custom", from: new Date(2026, 9, 1), to: new Date(2026, 9, 31) },
      "1 Oct 2026 to 31 Oct 2026",
      "Where your money went from 1 Oct 2026 to 31 Oct 2026",
    ],
  ] as const)("%j", (period, label, subtitle) => {
    expect(periodLabel(period)).toBe(label)
    expect(periodSubtitle(period)).toBe(subtitle)
  })
})

describe("getComparisonPeriod", () => {
  const now = new Date(2026, 9, 15, 10)
  const range = (p: ReturnType<typeof getComparisonPeriod>) => {
    const r = analysisPeriodToDateRange(p!.period)
    return [r.from.getMonth() + 1 + "/" + r.from.getDate() + "/" + r.from.getFullYear(), r.to.getMonth() + 1 + "/" + r.to.getDate() + "/" + r.to.getFullYear()]
  }

  it("sets the running month against the same days of the one before", () => {
    const c = getComparisonPeriod({ mode: "monthly", year: 2026, month: 10 }, "previous", now)
    expect(c!.label).toBe("by 15 September")
    expect(range(c)).toEqual(["9/1/2026", "9/15/2026"])
  })

  it("clamps the day to a shorter month and names the year of a year-ago comparison", () => {
    const c = getComparisonPeriod({ mode: "monthly", year: 2026, month: 3 }, "previous", new Date(2026, 2, 31))
    expect(c!.label).toBe("by 28 February")
    const y = getComparisonPeriod({ mode: "monthly", year: 2026, month: 10 }, "year-ago", now)
    expect(y!.label).toBe("by 15 October 2025")
    expect(range(y)).toEqual(["10/1/2025", "10/15/2025"])
  })

  it("sets a running year against the same stretch of the year before", () => {
    const c = getComparisonPeriod({ mode: "yearly", year: 2026 }, "previous", now)
    expect(c!.label).toBe("by 15 October 2025")
    expect(range(c)).toEqual(["1/1/2025", "10/15/2025"])
  })

  it("compares a finished month with the whole of the one before", () => {
    const c = getComparisonPeriod({ mode: "monthly", year: 2026, month: 9 }, "previous", now)
    expect(c).toEqual({ period: { mode: "monthly", year: 2026, month: 8 }, label: "August 2026" })
  })

  it("has nothing to compare for no comparison", () => {
    expect(getComparisonPeriod({ mode: "monthly", year: 2026, month: 10 }, "none", now)).toBeNull()
  })
})

describe("deltaText", () => {
  const eur = (n: number) => `€${n.toFixed(2)}`
  it.each([
    [1488.93, 1583.03, "€94.10 less than by 15 September"],
    [2000, 1500, "€500.00 more than by 15 September"],
    [2850, 2850, "Same as by 15 September"],
    [100, 0, "No prior data"],
  ])("%d against %d", (current, previous, text) => {
    expect(deltaText(current, previous, "by 15 September", eur)).toBe(text)
  })
})

describe("netDetail", () => {
  const eur = (n: number) => `€${n.toFixed(2)}`
  it("says nothing was recorded", () => expect(netDetail(0, 0, eur)).toBe("Nothing recorded in this period"))
  it("names a negative net as spending beyond income, not a budget", () =>
    expect(netDetail(1000, 2488.93, eur)).toBe("Spent €1488.93 more than earned"))
  it("gives the share kept for a positive net", () => expect(netDetail(2000, 1044, eur)).toBe("You kept 47.8% of what came in"))
})

describe("effectiveComparisonMode", () => {
  const month = { mode: "monthly", year: 2026, month: 10 } as const
  const year = { mode: "yearly", year: 2026 } as const
  it("keeps the pick for a month", () => expect(effectiveComparisonMode(month, "year-ago")).toBe("year-ago"))
  it("turns year-ago into previous for a year", () => expect(effectiveComparisonMode(year, "year-ago")).toBe("previous"))
  it.each([[{ mode: "last12months" }], [{ mode: "rolling", months: 3 }], [{ mode: "custom", from: new Date(2026, 0, 1), to: new Date(2026, 1, 1) }]] as const)(
    "has none for %o",
    (period) => expect(effectiveComparisonMode(period as never, "previous")).toBe("none")
  )
})

describe("the months a chart draws", () => {
  const oct15 = new Date(2026, 9, 15)
  it("a month draws it and the three before it, a year only its own months so far", () => {
    expect(trendMonths({ mode: "monthly", year: 2026, month: 10 }, oct15)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"])
    expect(trendMonths({ mode: "monthly", year: 2026, month: 2 }, oct15)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"])
    expect(trendMonths({ mode: "yearly", year: 2026 }, oct15)).toHaveLength(10)
    expect(trendMonths({ mode: "yearly", year: 2025 }, oct15)).toHaveLength(12)
  })

  it("a month asks for its trailing window; any other period asks for itself", () => {
    const { from, to } = analysisPeriodToDateRange(trendPeriod({ mode: "monthly", year: 2026, month: 10 }))
    expect([from.getFullYear(), from.getMonth(), from.getDate(), to.getMonth(), to.getDate()]).toEqual([2026, 6, 1, 9, 31])
    const year = { mode: "yearly", year: 2025 } as const
    expect(trendPeriod(year)).toBe(year)
  })

  it("fills the months with nothing in them, in order", () => {
    const got = fillMonths([{ month: "2026-09", income: 10, expenses: 4, net: 6 }], ["2026-08", "2026-09", "2026-10"])
    expect(got).toEqual([
      { month: "2026-08", income: 0, expenses: 0, net: 0 },
      { month: "2026-09", income: 10, expenses: 4, net: 6 },
      { month: "2026-10", income: 0, expenses: 0, net: 0 },
    ])
  })
})

describe("periodEyebrow", () => {
  const oct15 = new Date(2026, 9, 15)
  it.each([
    [{ mode: "monthly", year: 2026, month: 10 }, "October so far"],
    [{ mode: "monthly", year: 2026, month: 9 }, "September 2026"],
    [{ mode: "yearly", year: 2026 }, "2026 so far"],
    [{ mode: "yearly", year: 2025 }, "2025"],
    [{ mode: "last12months" }, "The last 12 months"],
  ] as const)("%o reads %s", (period, text) => expect(periodEyebrow(period as never, oct15)).toBe(text))
})
