import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SuggestedTab } from "../suggested-tab"

import type { SuspectedSubscription, Transaction } from "../../../types"

const dismiss = vi.fn()
const createRule = vi.fn()

vi.mock("../../../host", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: "u" } }),
}))
vi.mock("../../../hooks/use-currency", () => ({ useCurrency: () => ({ format: (n: number) => `€${n.toFixed(2)}`, defaultCurrency: "EUR" }) }))
vi.mock("../../../hooks/use-accounts", () => ({ useAccounts: () => ({ data: [{ id: "a1", name: "Main Checking", isArchived: false }] }) }))
vi.mock("../../../hooks/use-categories", () => ({ useCategories: () => ({ data: [{ id: "c1", name: "Electricity", color: "#009e73", group: "bills" }] }) }))
vi.mock("../../../hooks/use-recurring", () => ({ useCreateRecurring: () => ({ mutate: createRule, isPending: false }) }))
vi.mock("../../../hooks/use-dismissed-subscriptions", () => ({ useCreateDismissedSubscriptionPattern: () => ({ mutate: dismiss, isPending: false }) }))

const at = (m: number, d: number) => new Date(2026, m, d)
const sub = (o: Partial<SuspectedSubscription> = {}): SuspectedSubscription => ({
  id: "lumina", merchantName: "lumina energia bill", accountId: "a1", estimatedAmount: 68.4, currency: "EUR",
  cadence: "monthly", interval: 1, observationCount: 4, firstSeen: at(6, 6), lastSeen: at(9, 6), daysSinceLastSeen: 10,
  looksCancelled: false, confidence: "high", transactionIds: ["t1", "t2", "t3", "t4"], suggestedCategoryId: "c1",
  suggestedStartDate: at(10, 6), medianGapDays: 31, ...o,
} as SuspectedSubscription)
const txs = [6, 7, 8, 9].map((m, i) => ({ id: `t${i + 1}`, date: at(m, 6) })) as Transaction[]

describe("SuggestedTab", () => {
  it("tells what was seen, the dates, and what Confirm will fill in", () => {
    render(<SuggestedTab data={[sub()]} transactions={txs} />)
    const card = screen.getByRole("article", { name: "lumina energia bill" })
    expect(within(card).getByText("−€68.40")).toBeInTheDocument()
    expect(within(card).getByText("Seen 4 times, always on the 6th")).toBeInTheDocument()
    const dates = within(within(card).getByRole("list", { name: "Dates seen" })).getAllByRole("listitem")
    expect(dates.map((li) => li.textContent)).toEqual(["6 Jul", "6 Aug", "6 Sep", "6 Oct"])
    expect(card).toHaveTextContent("monthly from Main Checking, next on 6 Nov.")
  })

  it("Dismiss ignores the pattern for good", () => {
    render(<SuggestedTab data={[sub()]} transactions={txs} />)
    fireEvent.click(screen.getByRole("button", { name: "Dismiss lumina energia bill" }))
    expect(dismiss).toHaveBeenCalledWith({ patternKey: "lumina" })
  })

  it("Confirm opens the rule dialog", () => {
    render(<SuggestedTab data={[sub()]} transactions={txs} />)
    fireEvent.click(screen.getByRole("button", { name: "Confirm lumina energia bill as recurring" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("Mark as recurring")
  })

  it("Confirm opens the dialog filled in, and Create makes the rule", () => {
    render(<SuggestedTab data={[sub()]} transactions={txs} />)
    fireEvent.click(screen.getByRole("button", { name: "Confirm lumina energia bill as recurring" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByDisplayValue("68.40")).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue("2026-11-06")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }))
    expect(createRule).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "a1", amount: 68.4, description: "lumina energia bill", categoryId: "c1" }),
      expect.anything(),
    )
  })

  it("says so when there is nothing to suggest", () => {
    render(<SuggestedTab data={[]} transactions={[]} />)
    expect(screen.getByText("Nothing to suggest")).toBeInTheDocument()
  })
})
