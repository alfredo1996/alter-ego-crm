import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { RecurringRow } from "../recurring/recurring-row"
import { SavingsGoalCard } from "../savings-goals/savings-goal-card"

import type { RecurringTransaction, SavingsGoalWithProgress } from "../../types"

// Plan 0.6: a state is a word, never a fade. Opacity on a row took its pills under AA
// (an Archived or Paused pill at 60% is under 3:1).
const faded = (el: Element) => [el, ...el.querySelectorAll("*")].some((n) => /(^|\s)opacity-\d/.test(n.getAttribute("class") ?? ""))
const day = new Date(2026, 9, 1)
const noop = vi.fn()
const format = (n: number) => `€${n.toFixed(2)}`

describe("a state shows as a word, not a faded row", () => {
  it("a paused recurring rule", () => {
    const rule: RecurringTransaction = {
      id: "r1", userId: "u", accountId: "a", type: "expense", amount: 12.99, currency: "EUR", categoryId: null,
      description: "Streaming", notes: null, frequency: "monthly", interval: 1, startDate: day, endDate: null,
      nextDueDate: day, isActive: false, loanMeta: null, createdAt: day, updatedAt: day,
    }
    const { container } = render(<ul><RecurringRow rule={rule} categories={[]} format={format} onEdit={noop} onDelete={noop} onToggle={noop} /></ul>)
    expect(screen.getByText("Paused")).toBeInTheDocument()
    expect(faded(container)).toBe(false)
  })

  it("a reached savings goal", () => {
    const goal: SavingsGoalWithProgress = {
      id: "g1", userId: "u", name: "New Bike", targetAmount: 800, currentAmount: 800, currency: "EUR", targetDate: null,
      icon: "🚲", color: "#10b981", isCompleted: true, createdAt: day, updatedAt: day, percentage: 100, remaining: 0, daysRemaining: null,
    }
    render(<SavingsGoalCard goal={goal} format={format} onEdit={noop} onDelete={noop} onAddFunds={noop} />)
    expect(screen.getByText("Goal reached!")).toBeInTheDocument()
    expect(faded(screen.getByRole("article", { name: "New Bike" }))).toBe(false)
  })
})
