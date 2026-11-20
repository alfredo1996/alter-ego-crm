import { describe, it, expect } from "vitest"

import { selectionSummary } from "../selection-summary"

import type { Transaction } from "../../types"

function tx(type: Transaction["type"], amount: number, currency = "EUR"): Transaction {
  return { id: `${type}${amount}`, type, amount, currency } as Transaction
}

describe("selectionSummary", () => {
  it("sums income and expenses, leaves a transfer out and counts it", () => {
    const s = selectionSummary([tx("expense", 82.4), tx("expense", 100), tx("income", 120), tx("expense", 40), tx("transfer", 210)])
    expect(s.count).toBe(5)
    expect(s.counted).toBe(4)
    expect(s.transfers).toBe(1)
    expect(s.in).toBeCloseTo(120)
    expect(s.out).toBeCloseTo(222.4)
    expect(s.net).toBeCloseTo(-102.4)
    expect(s.average).toBeCloseTo(-25.6)
  })

  it("takes largest and smallest by absolute amount, signed", () => {
    const s = selectionSummary([tx("expense", 82.4), tx("expense", 100), tx("income", 120), tx("expense", 40)])
    expect(s.largest).toBe(120)
    expect(s.smallest).toBe(-40)
  })

  it("gives zeros and nulls for an empty selection", () => {
    expect(selectionSummary([])).toEqual({
      count: 0, counted: 0, transfers: 0, net: 0, in: 0, out: 0,
      average: null, largest: null, smallest: null, mixedCurrencies: false, currency: null,
    })
  })

  it("has no average for transfers only", () => {
    const s = selectionSummary([tx("transfer", 50), tx("transfer", 70)])
    expect(s).toMatchObject({ count: 2, counted: 0, transfers: 2, net: 0, average: null, largest: null })
  })

  it("flags mixed currencies, and not a single one", () => {
    expect(selectionSummary([tx("income", 1, "EUR"), tx("expense", 1, "USD")]).mixedCurrencies).toBe(true)
    expect(selectionSummary([tx("income", 1, "EUR"), tx("expense", 1, "EUR")]).mixedCurrencies).toBe(false)
  })

  it("rounds to the cent, so a selection that nets to nothing is exactly zero", () => {
    const s = selectionSummary([tx("expense", 10.1), tx("expense", 20.2), tx("income", 30.3)])
    expect(s.net).toBe(0)
    expect(s.average).toBe(0)
    expect(selectionSummary([tx("expense", 0.1), tx("expense", 0.2), tx("income", 0.3)]).net).toBe(0)
  })

  it("names the single currency of the counted rows, null when mixed or empty", () => {
    expect(selectionSummary([tx("expense", 1, "USD"), tx("income", 2, "USD")]).currency).toBe("USD")
    expect(selectionSummary([tx("expense", 1, "USD"), tx("income", 2, "EUR")]).currency).toBeNull()
    expect(selectionSummary([]).currency).toBeNull()
  })
})
