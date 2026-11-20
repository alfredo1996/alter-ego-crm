import { describe, expect, it } from "vitest"

import {
  monthSpan,
  normalizeMonth,
  resolveDateWindow,
  ToolInputError,
} from "../helpers"

/**
 * The tool helpers: month arithmetic, the response envelope, and the account and
 * category resolvers.
 */

describe("normalizeMonth", () => {
  it("keeps YYYY-MM", () => {
    expect(normalizeMonth("2026-08")).toBe("2026-08")
  })

  it("truncates a full date to its month", () => {
    expect(normalizeMonth("2026-08-19")).toBe("2026-08")
  })

  it("rejects month 00 and 13", () => {
    expect(() => normalizeMonth("2026-00")).toThrow(ToolInputError)
    expect(() => normalizeMonth("2026-13")).toThrow(ToolInputError)
  })

  it("rejects everything else with a readable message", () => {
    for (const bad of ["agosto", "2026/08", "08-2026", "2026-8", ""]) {
      expect(() => normalizeMonth(bad)).toThrow(/Invalid date/)
    }
  })
})

describe("resolveDateWindow", () => {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

  // The whole reason this exists next to normalizeMonth: asking for one day must
  // not silently answer for the month around it.
  it("keeps a single day to that day", () => {
    const { from, to } = resolveDateWindow({ from: "2026-07-05" })
    expect(iso(from)).toBe("2026-07-05")
    expect(iso(to)).toBe("2026-07-05")
    expect(to.getHours()).toBe(23)
    expect(to.getMinutes()).toBe(59)
  })

  it("widens a bare month to the whole month", () => {
    const { from, to } = resolveDateWindow({ from: "2026-07" })
    expect(iso(from)).toBe("2026-07-01")
    expect(iso(to)).toBe("2026-07-31")
  })

  it("mixes precisions: from a day, to a month", () => {
    const { from, to } = resolveDateWindow({ from: "2026-07-05", to: "2026-08" })
    expect(iso(from)).toBe("2026-07-05")
    expect(iso(to)).toBe("2026-08-31")
  })

  it("mixes the other way: from a month, to a day", () => {
    const { from, to } = resolveDateWindow({ from: "2026-07", to: "2026-08-10" })
    expect(iso(from)).toBe("2026-07-01")
    expect(iso(to)).toBe("2026-08-10")
  })

  it("handles February in a leap year", () => {
    expect(iso(resolveDateWindow({ from: "2028-02" }).to)).toBe("2028-02-29")
  })

  // new Date(2026, 1, 30) rolls into March rather than throwing.
  it("rejects a day that does not exist instead of rolling it forward", () => {
    expect(() => resolveDateWindow({ from: "2026-02-30" })).toThrow(ToolInputError)
  })

  it("rejects a reversed window", () => {
    expect(() => resolveDateWindow({ from: "2026-08-10", to: "2026-08-01" })).toThrow(ToolInputError)
  })

  // Same day both ends is a window, not a reversal.
  it("accepts from and to on the same day", () => {
    const { from, to } = resolveDateWindow({ from: "2026-07-05", to: "2026-07-05" })
    expect(to.getTime()).toBeGreaterThan(from.getTime())
  })

  it("rejects a malformed bound", () => {
    expect(() => resolveDateWindow({ from: "luglio" })).toThrow(ToolInputError)
    expect(() => resolveDateWindow({ from: "2026-13" })).toThrow(ToolInputError)
  })
})

describe("monthSpan", () => {
  it("is inclusive", () => {
    expect(monthSpan("2026-04", "2026-06")).toBe(3)
    expect(monthSpan("2026-08", "2026-08")).toBe(1)
  })

  it("crosses year boundaries", () => {
    expect(monthSpan("2026-11", "2027-02")).toBe(4)
  })

  it("rejects inverted windows", () => {
    expect(() => monthSpan("2026-09", "2026-08")).toThrow(ToolInputError)
  })
})
