import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { RecurringRow } from "../recurring-row"

import type { RecurringTransaction } from "../../../types"

const day = new Date(2026, 9, 20)
const rule = (o: Partial<RecurringTransaction> = {}): RecurringTransaction => ({
  id: "r1", userId: "u", accountId: "a", type: "expense", amount: 12.99, currency: "EUR", categoryId: "c1",
  description: "Mobilo phone plan", notes: null, frequency: "monthly", interval: 1, startDate: day, endDate: null,
  nextDueDate: day, isActive: true, loanMeta: null, createdAt: day, updatedAt: day, ...o,
})
const categories = [{ id: "c1", name: "Phone", color: "#009e73" }] as never[]
const format = (n: number) => `€${n.toFixed(2)}`
const noop = vi.fn()
const row = (r: RecurringTransaction, extra = {}) =>
  render(
    <ul>
      <RecurringRow rule={r} categories={categories} accountName="Main Checking" format={format} onEdit={noop} onDelete={noop} onToggle={noop} onHistory={noop} {...extra} />
    </ul>,
  )

describe("RecurringRow", () => {
  it("reads name, category, account, cadence and a minus amount in the text colour", () => {
    row(rule())
    expect(screen.getByText("Mobilo phone plan")).toBeInTheDocument()
    expect(screen.getByText("Phone")).toBeInTheDocument()
    expect(screen.getByText("Main Checking")).toBeInTheDocument()
    expect(screen.getByText("Monthly")).toBeInTheDocument()
    const amount = screen.getByText("−€12.99")
    expect(amount.className).not.toMatch(/red|green/)
  })

  it("an income is a green plus", () => {
    row(rule({ type: "income", amount: 2850 }))
    expect(screen.getByText("+€2850.00").className).toMatch(/green/)
  })

  it("a loan says its rate and term", () => {
    row(rule({ loanMeta: { annualRate: 3.1, termMonths: 240 } as never }))
    expect(screen.getByText("Loan 3.1% · 20 yr")).toBeInTheDocument()
  })

  it("keeps the four actions' names, each tied to its rule; only Delete turns red, and only on hover or focus", () => {
    row(rule())
    for (const name of ["Pause", "History", "Edit", "Delete"]) {
      expect(screen.getByRole("button", { name })).toHaveAccessibleDescription("Mobilo phone plan")
    }
    expect(screen.getByRole("button", { name: "Delete" }).className).toMatch(/hover:text-destructive/)
    expect(screen.getByRole("button", { name: "Delete" }).className).not.toMatch(/(^|\s)text-destructive/)
    expect(screen.getByRole("button", { name: "Edit" }).className).not.toMatch(/destructive/)
  })

  it("a paused rule offers Resume and says Paused in words", () => {
    row(rule({ isActive: false }))
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument()
    expect(screen.getByText("Paused")).toBeInTheDocument()
  })

  it("History is a toggle: collapsed it is aria-expanded=false and a click asks to open it", () => {
    const onHistory = vi.fn()
    row(rule(), { onHistory })
    const history = screen.getByRole("button", { name: "History" })
    expect(history).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(history)
    expect(onHistory).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }))
  })
})
