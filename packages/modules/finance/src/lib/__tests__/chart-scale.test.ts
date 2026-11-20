import { formatCompactCurrency, formatCurrency } from "@alter-ego/kernel/currency"
import { describe, expect, it } from "vitest"

import { niceScale } from "../chart-scale"

describe("niceScale", () => {
  it.each([
    // [min, max, wanted intervals, ticks]
    [0, 3450, 4, [0, 1000, 2000, 3000, 4000]],
    [0, 980, 4, [0, 250, 500, 750, 1000]],
    [0, 0, 4, [0, 1]],
    [12719.22, 16766.68, 3, [12000, 14000, 16000, 18000]],
    [-1200, 800, 4, [-1500, -1000, -500, 0, 500, 1000]],
  ])("%d to %d in about %d steps", (min, max, steps, ticks) => {
    expect(niceScale(min, max, steps)).toEqual(ticks)
  })

  it("always spans the data", () => {
    for (const [min, max] of [[0, 7], [3, 3.2], [-9, 1e6], [1500, 1501]]) {
      const t = niceScale(min, max, 4)
      expect(t[0]).toBeLessThanOrEqual(min)
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(max)
    }
  })
})

describe("formatCompactCurrency", () => {
  it.each([
    [0, "€0"],
    [4000, "€4K"],
    [14500, "€14.5K"],
    [-2000, "-€2K"],
    [1_200_000, "€1.2M"],
  ])("%d reads %s", (n, text) => expect(formatCompactCurrency(n, "EUR").replace("−", "-")).toBe(text))
})

describe("formatCurrency with whole units", () => {
  it("drops the cents for a chart label", () => {
    expect(formatCurrency(2850, "EUR", "en-IE", 0)).toBe("€2,850")
    expect(formatCurrency(1488.93, "EUR", "en-IE", 0)).toBe("€1,489")
  })
})
