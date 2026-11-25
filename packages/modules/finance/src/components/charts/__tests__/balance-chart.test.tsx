import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BalanceChart, niceTicks } from "../balance-chart"

import type { Transaction } from "../../../types"

// happy-dom never lays out: the observer is a no-op, the chart draws at DEFAULT_W.
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => vi.unstubAllGlobals())

const tx = (id: string, date: Date, type: "income" | "expense", amount: number): Transaction => ({
  id,
  userId: "u",
  accountId: "a1",
  type,
  amount,
  currency: "EUR",
  categoryId: null,
  description: id,
  rawDescription: null,
  date,
  notes: null,
  tagIds: [],
  transferToAccountId: null,
  linkedTransactionId: null,
  isRecurring: false,
  splits: [],
  attachments: [],
  status: "cleared",
  importHash: null,
  excludeFromReports: false,
  createdAt: date,
  updatedAt: date,
})

describe("BalanceChart", () => {
  // Balances walk 1,200 → 2,000 → 980 → 2,450, so the lowest is 980 in March.
  const halfYear = [
    tx("t1", new Date(2026, 0, 5), "income", 800),
    tx("t2", new Date(2026, 2, 15), "expense", 1020),
    tx("t3", new Date(2026, 5, 20), "income", 1470),
  ]

  it("is one picture named by its data: the range, the endpoints and the lowest month", () => {
    render(<BalanceChart transactions={halfYear} currentBalance={2450} accountId="a1" />)
    const img = screen.getByRole("img", { name: /Balance from January to June 2026/ })
    expect(img.getAttribute("aria-label")).toBe(
      "Balance from January to June 2026: from 1.2K to 2.5K, lowest 980 in March.",
    )
  })

  it("changes its name with the data", () => {
    const { unmount } = render(<BalanceChart transactions={halfYear} currentBalance={2450} accountId="a1" />)
    const first = screen.getByRole("img").getAttribute("aria-label")
    unmount()
    render(
      <BalanceChart
        transactions={[tx("t1", new Date(2025, 1, 10), "income", 500)]}
        currentBalance={500}
        accountId="a1"
      />,
    )
    const second = screen.getByRole("img").getAttribute("aria-label")
    expect(second).toBe("Balance from February to February 2025: from 0 to 500, lowest 0 in February.")
    expect(second).not.toBe(first)
  })

  it("names the year of the lowest month when the data spans two years", () => {
    // Balances walk 1,000 → 1,500 → 200 → 1,100: the lowest, 200, is December 2025.
    render(
      <BalanceChart
        transactions={[
          tx("t1", new Date(2025, 10, 5), "income", 500),
          tx("t2", new Date(2025, 11, 10), "expense", 1300),
          tx("t3", new Date(2026, 1, 3), "income", 900),
        ]}
        currentBalance={1100}
        accountId="a1"
      />,
    )
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Balance from November 2025 to February 2026: from 1.0K to 1.1K, lowest 200 in December 2025.",
    )
  })

  it("keeps the empty-data branch as plain text with no picture", () => {
    render(<BalanceChart transactions={[]} currentBalance={0} accountId="a1" />)
    expect(screen.getByText("No transactions yet for this account.")).toBeTruthy()
    expect(screen.queryByRole("img")).toBeNull()
  })
})


describe("niceTicks", () => {
  it.each([
    [788.86, 5294.48, [0, 2000, 4000, 6000]],
    [0, 450, [0, 200, 400, 600]],
    [-300, 200, [-400, -200, 0, 200]],
    [1000, 1000, [1000, 1250]],
  ])("rounds %d–%d to %j, enclosing the data", (min, max, want) => {
    const t = niceTicks(min, max)
    expect(t[0]).toBeLessThanOrEqual(min)
    expect(t.at(-1)).toBeGreaterThanOrEqual(max)
    expect(t).toEqual(want)
  })
})
