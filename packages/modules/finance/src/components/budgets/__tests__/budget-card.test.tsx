import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { BudgetCard, budgetState } from "../budget-card"
import { BudgetsSummary } from "../budgets-summary"

import type { BudgetWithSpending, Category } from "../../../types"

const day = new Date("2026-10-01")
const format = (n: number) => `€${n.toFixed(2)}`
const noop = vi.fn()

function budget(over: Partial<BudgetWithSpending>): BudgetWithSpending {
  return {
    id: "b1", userId: "u", name: "Groceries", categoryId: "c1", amount: 240, currency: "EUR", period: "monthly",
    rolloverMode: "reset", createdAt: day, updatedAt: day, spent: 100, remaining: 140, percentage: (100 / 240) * 100,
    rolloverAmount: 0, effectiveAmount: 240, ...over,
  }
}
const gas = { id: "c1", name: "Gas", color: "#ef4444" } as Category
const groceries = { id: "c1", name: "groceries", color: "#10b981" } as Category

function renderCard(b: BudgetWithSpending, categories: Category[] = [gas]) {
  render(<BudgetCard budget={b} categories={categories} format={format} onEdit={noop} onDelete={noop} />)
}

describe("BudgetCard", () => {
  it.each([
    { name: "under 80%", spent: 100, pill: "On track" },
    { name: "from 80%", spent: 192, pill: "Near limit" },
    { name: "just under the limit", spent: 239.9, pill: "Near limit" },
    { name: "at the limit exactly", spent: 240, pill: "Over limit" },
    { name: "past the limit", spent: 250, pill: "Over by €10.00" },
  ])("$name says $pill", ({ spent, pill }) => {
    renderCard(budget({ spent, percentage: (spent / 240) * 100, remaining: Math.max(0, 240 - spent) }))
    const card = screen.getByRole("article", { name: "Groceries" })
    expect(card).toHaveTextContent(pill)
  })

  it.each([
    { name: "zero limit, nothing spent", limit: 0, spent: 0, pill: "On track" },
    { name: "zero limit, spending", limit: 0, spent: 20, pill: "Over by €20.00" },
    { name: "negative limit, nothing spent", limit: -50, spent: 0, pill: "On track" },
    { name: "negative limit, spending", limit: -50, spent: 1, pill: "Over by €51.00" },
  ])("$name says $pill", ({ limit, spent, pill }) => {
    renderCard(budget({ effectiveAmount: limit, spent, percentage: 0, remaining: 0 }))
    expect(screen.getByRole("article", { name: "Groceries" })).toHaveTextContent(pill)
  })

  it("leads with the spent amount and the limit, and names the bar", () => {
    renderCard(budget({ spent: 195.55, percentage: 81.4, remaining: 44.45 }))
    expect(screen.getByText("€195.55")).toBeInTheDocument()
    expect(screen.getByText("of €240.00")).toBeInTheDocument()
    expect(screen.getByText("€44.45 left")).toBeInTheDocument()
    expect(screen.getByText("81% used")).toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: "Groceries, 81% of the limit used" })).toHaveAttribute("aria-valuenow", "81")
  })

  it("shows the period and the category, but not a category that repeats the name", () => {
    renderCard(budget({ name: "Fuel" }))
    expect(screen.getByText("Gas")).toBeInTheDocument()
    expect(screen.getByText("monthly")).toBeInTheDocument()
  })

  it("hides a category equal to the name", () => {
    renderCard(budget({}), [groceries])
    expect(screen.queryByText("groceries")).not.toBeInTheDocument()
  })

  it("says what rolled over, and names its actions menu", () => {
    renderCard(budget({ rolloverAmount: 20 }))
    expect(screen.getByText(/\+€20\.00 rolled over/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Actions for Groceries" })).toBeInTheDocument()
  })
})

describe("BudgetsSummary", () => {
  it("totals the month, counts each state and says what is left", () => {
    const list = [
      budget({ id: "1", spent: 100, percentage: 41.7, effectiveAmount: 240 }),
      budget({ id: "2", spent: 192, percentage: 80, effectiveAmount: 240 }),
      budget({ id: "3", spent: 50, percentage: 125, effectiveAmount: 40 }),
    ]
    render(<BudgetsSummary budgets={list} format={format} monthName="October" />)
    expect(screen.getByText("€342.00")).toBeInTheDocument()
    expect(screen.getByText("of €520.00 across 3 budgets")).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Budgets by state" })).toHaveTextContent("1 On track1 Near limit1 Over")
    expect(screen.getByRole("progressbar", { name: "All budgets, 66% of the total limit used" })).toBeInTheDocument()
    expect(screen.getByText("€178.00 left for the rest of October")).toBeInTheDocument()
  })

  it("renders nothing without monthly budgets", () => {
    const { container } = render(<BudgetsSummary budgets={[]} format={format} monthName="October" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("budgetState", () => {
  it.each([
    { spent: 240, state: "over" },
    { spent: 239.9, state: "near" },
    { spent: 191, state: "ok" },
  ])("spent $spent of 240 is $state", ({ spent, state }) => {
    expect(budgetState({ spent, effectiveAmount: 240 })).toBe(state)
  })

  it.each([
    { limit: 0, spent: 0, state: "ok" },
    { limit: 0, spent: 20, state: "over" },
    { limit: -50, spent: 0, state: "ok" },
    { limit: -50, spent: 1, state: "over" },
  ])("limit $limit, spent $spent is $state", ({ limit, spent, state }) => {
    expect(budgetState({ spent, effectiveAmount: limit })).toBe(state)
  })
})
