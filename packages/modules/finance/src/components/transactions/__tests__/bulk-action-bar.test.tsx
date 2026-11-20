import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { selectionSummary } from "../../../lib/selection-summary"
import { useFinanceSettingsStore } from "../../../stores/finance-settings-store"
import { BulkActionBar } from "../bulk-action-bar"


import type { Transaction } from "../../../types"

beforeEach(() => useFinanceSettingsStore.setState({ defaultCurrency: "EUR" }))
afterEach(cleanup)

const tx = (type: Transaction["type"], amount: number, currency = "EUR") => ({ type, amount, currency }) as Transaction
const noop = () => {}

function bar(rows: Transaction[]) {
  render(<BulkActionBar summary={selectionSummary(rows)} onDelete={noop} onChangeAccount={noop} onChangeDate={noop} onClear={noop} />)
}

const five = [tx("expense", 82.4), tx("expense", 100), tx("income", 120), tx("expense", 40), tx("transfer", 210)]

describe("BulkActionBar", () => {
  it("shows the count, every figure and the transfer note for five rows", () => {
    bar(five)
    expect(screen.getByText("5 selected")).toBeTruthy()
    const figures = Array.from(document.querySelectorAll("dl > div")).map((d) => d.textContent)
    expect(figures).toEqual([
      "Net −€102.40", "In +€120.00", "Out −€222.40", "Average −€25.60", "Largest +€120.00", "Smallest −€40.00",
    ])
    expect(screen.getByText("1 transfer not counted")).toBeTruthy()
  })

  it("keeps the figures out of any hidden wrapper, so a phone shows them", () => {
    bar(five)
    for (const d of document.querySelectorAll("dl")) expect(d.closest(".hidden, .max-sm\\:hidden")).toBeNull()
  })

  it("says transfers (plural) and mixed currencies", () => {
    bar([tx("income", 5), tx("expense", 5, "USD"), tx("transfer", 1), tx("transfer", 2)])
    expect(screen.getByText("2 transfers not counted · Mixed currencies")).toBeTruthy()
  })

  it("shows no figures for transfers only, and nothing for an empty selection", () => {
    bar([tx("transfer", 10)])
    expect(screen.getByText("1 selected")).toBeTruthy()
    expect(screen.queryByText("Net")).toBeNull()
    cleanup()
    bar([])
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it("formats in the rows' own currency", () => {
    bar([tx("expense", 80, "USD")])
    expect(screen.getByText("Out").parentElement?.textContent).toBe("Out −$80.00")
  })

  it("leaves room under the bar so the page can scroll its footer clear", () => {
    bar(five)
    expect(document.querySelector("[aria-hidden='true'].h-40")).toBeTruthy()
  })
})
