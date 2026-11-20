import { render, screen } from "@testing-library/react"
import { format, subMonths } from "date-fns"
import { describe, expect, it } from "vitest"

import { MonthlySummaryCard } from "../monthly-summary-card"

const eur = (n: number) => `€${n}`
const base = { netWorth: 5000, totalAssets: 5500, totalLiabilities: 500, monthlyIncome: 3200, monthlyExpenses: 1312, monthlySavingsRate: 0.59, format: eur }
const lastMonth = format(subMonths(new Date(), 1), "yyyy-MM")
const lastName = format(subMonths(new Date(), 1), "MMMM")

describe("MonthlySummaryCard", () => {
  it("prints the savings rate as a percentage: the backends hand over a fraction", () => {
    render(<MonthlySummaryCard {...base} />)
    expect(screen.getByText("Savings rate").nextSibling).toHaveTextContent("59.0%")
  })

  it("signs money in green and money out in the text colour", () => {
    render(<MonthlySummaryCard {...base} />)
    expect(screen.getByText("This month in").nextSibling).toHaveTextContent("+€3200")
    expect(screen.getByText("This month in").nextSibling!.firstChild).toHaveClass("text-green-700")
    expect(screen.getByText("This month out").nextSibling).toHaveTextContent("−€1312")
    expect(screen.getByText("This month out").nextSibling!.firstChild).not.toHaveClass("text-green-700")
  })

  it("says how last month closed, from its own totals", () => {
    render(<MonthlySummaryCard {...base} monthlySummary={[{ month: lastMonth, income: 2000, expenses: 1300, net: 700 }]} />)
    expect(screen.getByText(`€2000 in all of ${lastName}`)).toBeInTheDocument()
    expect(screen.getByText(`€1300 in all of ${lastName}`)).toBeInTheDocument()
    expect(screen.getByText(`${lastName} closed at 35.0%`)).toBeInTheDocument()
  })

  it("says nothing about a last month it has no totals for", () => {
    render(<MonthlySummaryCard {...base} monthlySummary={[]} />)
    expect(screen.queryByText(/in all of|closed at/)).toBeNull()
  })

  it("shows assets and liabilities under the net worth", () => {
    render(<MonthlySummaryCard {...base} />)
    expect(screen.getByText("Net worth").nextSibling).toHaveTextContent("€5000")
    expect(screen.getByText("Net worth").nextSibling!.nextSibling).toHaveTextContent("Assets €5500 · Liabilities €500")
  })

  it.each([
    [4850, "Up €150 since 30 September"],
    [5150, "Down €150 since 30 September"],
    [5000, "No change since 30 September"],
    // Float drift from increment() is not a change: 5000.004 rounds to the cent.
    [4999.996, "No change since 30 September"],
  ])("with %i at the end of last month it reads %s", (before, line) => {
    render(<MonthlySummaryCard {...base} lastMonthEnd={new Date(2026, 8, 30)} lastMonthNetWorth={before} />)
    expect(screen.getByText(line)).toBeInTheDocument()
  })

  it("hides the change line with no snapshot to compare with", () => {
    render(<MonthlySummaryCard {...base} lastMonthEnd={new Date(2026, 8, 30)} lastMonthNetWorth={null} />)
    expect(screen.queryByText(/since 30 September/)).toBeNull()
    expect(screen.getByText("Net worth").parentElement!.querySelectorAll('[data-slot="stat-detail"]')).toHaveLength(1)
  })

  it("holds the line's place while the snapshot is still loading", () => {
    render(<MonthlySummaryCard {...base} lastMonthEnd={new Date(2026, 8, 30)} />)
    expect(screen.queryByText(/since 30 September/)).toBeNull()
    expect(screen.getByText("Net worth").parentElement!.querySelectorAll('[data-slot="stat-detail"]')).toHaveLength(2)
  })
})
