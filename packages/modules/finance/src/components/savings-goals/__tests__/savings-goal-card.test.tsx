import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SavingsGoalCard } from "../savings-goal-card"

import type { SavingsGoalWithProgress } from "../../../types"

const day = new Date("2026-10-01")
const format = (n: number) => `€${n.toFixed(2)}`
const noop = vi.fn()

function goal(over: Partial<SavingsGoalWithProgress>): SavingsGoalWithProgress {
  return {
    id: "g1", userId: "u", name: "Japan Trip", targetAmount: 4000, currentAmount: 1350, currency: "EUR",
    targetDate: new Date("2027-04-15"), icon: "🗾", color: "#10b981", isCompleted: false, createdAt: day, updatedAt: day,
    percentage: 33.75, remaining: 2650, daysRemaining: 183, ...over,
  }
}

function renderCard(g: SavingsGoalWithProgress, onAddFunds = noop) {
  render(<SavingsGoalCard goal={g} format={format} onEdit={noop} onDelete={noop} onAddFunds={onAddFunds} />)
}

describe("SavingsGoalCard", () => {
  it("has a visible Add Funds button that opens the dialog for this goal", () => {
    const onAddFunds = vi.fn()
    const g = goal({})
    renderCard(g, onAddFunds)
    fireEvent.click(screen.getByRole("button", { name: "Add Funds to Japan Trip" }))
    expect(onAddFunds).toHaveBeenCalledWith(g)
  })

  it("leads with the saved amount, the pace and the days left", () => {
    renderCard(goal({}))
    const card = screen.getByRole("article", { name: "Japan Trip" })
    expect(card).toHaveTextContent("Saving")
    expect(card).toHaveTextContent("€1350.00of €4000.00")
    expect(card).toHaveTextContent("34% saved · €2650.00 to go · €441.00 a month gets you there")
    expect(card).toHaveTextContent("183 days left")
    expect(screen.getByRole("progressbar", { name: "Japan Trip, 34% saved" })).toHaveAttribute("aria-valuenow", "34")
  })

  it("says Overdue past the target date, with no monthly pace", () => {
    renderCard(goal({ daysRemaining: -3 }))
    const card = screen.getByRole("article", { name: "Japan Trip" })
    expect(card).toHaveTextContent("Overdue")
    expect(card).toHaveTextContent("3 days overdue")
    expect(card).not.toHaveTextContent("a month")
  })

  it("on its target date it is due today, not overdue", () => {
    renderCard(goal({ daysRemaining: -0 }))
    const card = screen.getByRole("article", { name: "Japan Trip" })
    expect(card).toHaveTextContent("Due today")
    expect(card).not.toHaveTextContent("Overdue")
    expect(card).not.toHaveTextContent("overdue")
  })

  it("hides the monthly pace in the last month, where it would exceed what is left", () => {
    renderCard(goal({ daysRemaining: 10, remaining: 1000 }))
    const card = screen.getByRole("article", { name: "Japan Trip" })
    expect(card).toHaveTextContent("10 days left")
    expect(card).not.toHaveTextContent("a month")
  })

  it("a reached goal says Reached, keeps Goal reached! and has no Add Funds", () => {
    renderCard(goal({ isCompleted: true, currentAmount: 4000, remaining: 0, percentage: 100 }))
    const card = screen.getByRole("article", { name: "Japan Trip" })
    expect(card).toHaveTextContent("Reached")
    expect(card).toHaveTextContent("Goal reached!")
    expect(screen.queryByRole("button", { name: /Add Funds/ })).not.toBeInTheDocument()
  })

  it("tints the icon tile with the goal colour at 12%", () => {
    renderCard(goal({ color: "#10b981" }))
    expect(screen.getByText("🗾")).toHaveStyle({ backgroundColor: "rgba(16, 185, 129, 0.12)" })
  })

  it("a goal with no target date has no pace and no days", () => {
    renderCard(goal({ targetDate: null, daysRemaining: null }))
    const card = screen.getByRole("article", { name: "Japan Trip" })
    expect(card).toHaveTextContent("34% saved · €2650.00 to go")
    expect(card).not.toHaveTextContent("a month")
    expect(card).toHaveTextContent("No target date")
  })
})
