import { afterEach, describe, it, expect } from "vitest"

import {
  getCurrentMonthRange,
  getLastNMonthsRange,
  getDayRange,
  formatDate,
  formatMonthYear,
  formatShortDate,
  advanceDate,
  isoDate,
  pinServerTimeZone,
  daysLeftInMonth,
  weekdaysInMonth,
} from "../dates"

describe("getCurrentMonthRange", () => {
  it("returns range for current month", () => {
    const now = new Date(2024, 5, 15) // June 15, 2024
    const range = getCurrentMonthRange(now)

    expect(range.from.getFullYear()).toBe(2024)
    expect(range.from.getMonth()).toBe(5)
    expect(range.from.getDate()).toBe(1)
    expect(range.to.getMonth()).toBe(5)
    expect(range.to.getDate()).toBe(30) // June has 30 days
  })

  it("handles January correctly", () => {
    const now = new Date(2024, 0, 20) // Jan 20, 2024
    const range = getCurrentMonthRange(now)

    expect(range.from.getMonth()).toBe(0)
    expect(range.from.getDate()).toBe(1)
    expect(range.to.getDate()).toBe(31)
  })
})

describe("getLastNMonthsRange", () => {
  it("returns range for last 3 months", () => {
    const now = new Date(2024, 5, 15) // June 15, 2024
    const range = getLastNMonthsRange(3, now)

    expect(range.from.getMonth()).toBe(3) // April
    expect(range.from.getDate()).toBe(1)
    expect(range.to.getMonth()).toBe(5) // June
  })

  it("returns range for last 1 month (current)", () => {
    const now = new Date(2024, 5, 15)
    const range = getLastNMonthsRange(1, now)

    expect(range.from.getMonth()).toBe(5)
    expect(range.from.getDate()).toBe(1)
  })

  it("handles year boundary", () => {
    const now = new Date(2024, 1, 15) // Feb 15, 2024
    const range = getLastNMonthsRange(3, now)

    expect(range.from.getFullYear()).toBe(2023)
    expect(range.from.getMonth()).toBe(11) // December 2023
  })
})

describe("getDayRange", () => {
  it("returns start and end of day", () => {
    const date = new Date(2024, 5, 15, 14, 30)
    const range = getDayRange(date)

    expect(range.from.getHours()).toBe(0)
    expect(range.from.getMinutes()).toBe(0)
    expect(range.to.getHours()).toBe(23)
    expect(range.to.getMinutes()).toBe(59)
  })
})

describe("formatDate", () => {
  it("formats with default pattern", () => {
    const date = new Date(2024, 5, 15)
    expect(formatDate(date)).toBe("Jun 15, 2024")
  })

  it("formats with custom pattern", () => {
    const date = new Date(2024, 5, 15)
    expect(formatDate(date, "yyyy-MM-dd")).toBe("2024-06-15")
  })
})

describe("formatMonthYear", () => {
  it("formats month and year", () => {
    const date = new Date(2024, 5, 15)
    expect(formatMonthYear(date)).toBe("June 2024")
  })
})

describe("formatShortDate", () => {
  const now = new Date(2026, 0, 1)
  it.each([
    ["this year drops the year", new Date(2026, 9, 13), "13 Oct"],
    ["another year keeps it", new Date(2024, 9, 13), "13 Oct 2024"],
    ["31 Dec of last year, seen on 1 Jan, keeps it", new Date(2025, 11, 31), "31 Dec 2025"],
  ])("%s", (_, date, expected) => {
    expect(formatShortDate(date, now)).toBe(expected)
  })

  // A fixed `now` in a year other than the real one, so ignoring `now` fails.
  it("compares against the now it is given, not today", () => {
    expect(formatShortDate(new Date(2024, 9, 13), new Date(2024, 5, 1))).toBe("13 Oct")
  })

  it("a date in the year after now keeps its year", () => {
    expect(formatShortDate(new Date(2027, 0, 1), new Date(2026, 11, 31))).toBe("1 Jan 2027")
  })
})

describe("advanceDate", () => {
  it("advances by days", () => {
    const result = advanceDate(new Date(2024, 0, 1), "daily", 3)
    expect(result.getDate()).toBe(4)
  })

  it("advances by weeks", () => {
    const result = advanceDate(new Date(2024, 0, 1), "weekly", 2)
    expect(result.getDate()).toBe(15)
  })

  it("advances by months", () => {
    const result = advanceDate(new Date(2024, 0, 15), "monthly", 1)
    expect(result.getMonth()).toBe(1) // February
    expect(result.getDate()).toBe(15)
  })

  it("advances by months across year boundary", () => {
    const result = advanceDate(new Date(2024, 11, 1), "monthly", 2)
    expect(result.getFullYear()).toBe(2025)
    expect(result.getMonth()).toBe(1) // February
  })

  it("advances by years", () => {
    const result = advanceDate(new Date(2024, 5, 15), "yearly", 1)
    expect(result.getFullYear()).toBe(2025)
    expect(result.getMonth()).toBe(5)
    expect(result.getDate()).toBe(15)
  })

  it("advances by multiple years", () => {
    const result = advanceDate(new Date(2024, 0, 1), "yearly", 3)
    expect(result.getFullYear()).toBe(2027)
  })

  it("returns same date for unknown frequency", () => {
    const date = new Date(2024, 0, 1)
    const result = advanceDate(date, "unknown", 1)
    expect(result.getTime()).toBe(date.getTime())
  })
})

describe("isoDate", () => {
  // Regression: dates are stored as local midnight, and `toISOString().slice(0, 10)`
  // rendered the previous day at any positive UTC offset — 1 March showed as 28 Feb
  // in every `<input type="date">`. The test run pins TZ=Europe/Rome (vitest.config.ts).
  it("keeps the calendar day of a local-midnight date", () => {
    const march1 = new Date(2026, 2, 1)

    expect(isoDate(march1)).toBe("2026-03-01")
    expect(march1.toISOString().slice(0, 10)).toBe("2026-02-28") // what the bug rendered
  })

  it("round-trips the value a date input parses back", () => {
    expect(isoDate(new Date("2026-03-01T00:00:00"))).toBe("2026-03-01")
  })

  // Moved here from the MCP helpers' own dateOnly tests, deduplicated into this
  // helper: a stored date carrying a time-of-day must still report its local day.
  it("keeps the local calendar day late in the evening", () => {
    expect(isoDate(new Date(2027, 2, 1, 23, 30))).toBe("2027-03-01")
  })

  it("does not shift across a year boundary", () => {
    expect(isoDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31")
    expect(isoDate(new Date(2027, 0, 1, 0, 0))).toBe("2027-01-01")
  })
})

describe("pinServerTimeZone", () => {
  const original = process.env.TZ
  afterEach(() => {
    process.env.TZ = original
  })

  // Regression: a Money Manager row dated 04/09/2026, imported in a Rome browser,
  // came back from list_transactions as 2026-09-03 — the server ran in UTC.
  it("reads a date written at Rome midnight as that day on a UTC server", () => {
    const importedInRome = new Date(2026, 8, 4) // TZ=Europe/Rome for the run
    expect(importedInRome.toISOString()).toBe("2026-09-03T22:00:00.000Z")

    process.env.TZ = "UTC"
    expect(isoDate(importedInRome)).toBe("2026-09-03") // what production returned

    delete process.env.TZ
    pinServerTimeZone()
    expect(isoDate(importedInRome)).toBe("2026-09-04")
  })

  it("leaves an explicitly configured zone alone", () => {
    process.env.TZ = "America/New_York"
    pinServerTimeZone()
    expect(process.env.TZ).toBe("America/New_York")
  })
})

describe("weekdaysInMonth", () => {
  it("counts Mon-Fri", () => {
    expect(weekdaysInMonth("2026-08")).toBe(21) // August 2026: 21 weekdays
    expect(weekdaysInMonth("2026-02")).toBe(20) // February 2026: 20 weekdays
    expect(weekdaysInMonth("2024-02")).toBe(21) // leap February 2024
  })
})

describe("daysLeftInMonth", () => {
  it("counts today, so the last day of the month has 1 day left", () => {
    expect(daysLeftInMonth(new Date(2026, 9, 16))).toBe(16)
    expect(daysLeftInMonth(new Date(2026, 9, 31))).toBe(1)
    expect(daysLeftInMonth(new Date(2026, 9, 1))).toBe(31)
  })
})
