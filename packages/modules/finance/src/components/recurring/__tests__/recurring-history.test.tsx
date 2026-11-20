import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { RecurringHistory } from "../recurring-history"

import type { RecurringTransaction } from "../../../types"


vi.mock("../../../host", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: "u" } }),
}))
vi.mock("../../../hooks/use-accounts", () => ({ useAccounts: () => ({ data: [{ id: "a1", name: "Main Checking" }] }) }))
const history = vi.fn()
vi.mock("../../../hooks/use-recurring-history", () => ({ useRecurringHistory: () => history() }))

const format = (n: number) => `€${n.toFixed(2)}`
const tx = (id: string, type: "income" | "expense", m: number) =>
  ({ id, type, amount: 100, currency: "EUR", accountId: "a1", date: new Date(2026, m, 1) })
const rule = (type: "income" | "expense") => ({ type, currency: "EUR" }) as RecurringTransaction

describe("RecurringHistory header", () => {
  it("says received for an income rule", () => {
    history.mockReturnValue({ data: [tx("1", "income", 8), tx("2", "income", 9)], isPending: false })
    render(<RecurringHistory rule={rule("income")} id="h" format={format} />)
    expect(screen.getByText("2 receipts · total received €200.00 · average €100.00")).toBeInTheDocument()
  })

  it("says paid for an expense rule", () => {
    history.mockReturnValue({ data: [tx("1", "expense", 8)], isPending: false })
    render(<RecurringHistory rule={rule("expense")} id="h" format={format} />)
    expect(screen.getByText("1 payment · total paid €100.00 · average €100.00")).toBeInTheDocument()
  })
})
