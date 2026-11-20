import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useFinanceSettingsStore } from "../../../stores/finance-settings-store"
import { AccountDetailShell } from "../account-detail-shell"

import type { Transaction } from "../../../types"


vi.mock("../../../host", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: "u1" } }),
  getBackend: () => ({
    db: new Proxy({}, {
      get: (_db, method) => (...args: unknown[]) => {
        if (method === "getAccount") return Promise.resolve(account)
        if (method === "getAccounts") return Promise.resolve([account])
        if (method !== "getTransactions") return Promise.resolve([])
        calls.push(args)
        const f = (args[1] ?? {}) as { limit?: number; offset?: number }
        const from = f.offset ?? 0
        return Promise.resolve({ data: rows.slice(from, f.limit ? from + f.limit : undefined), total: rows.length })
      },
    }),
  }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }))

// 30 expenses of 1 to 30 euros, newest first: the first page of 25 holds 6 to 30.
const rows = Array.from({ length: 30 }, (_, i) => ({
  id: `t${30 - i}`, userId: "u1", accountId: "a", type: "expense", amount: 30 - i, currency: "EUR", categoryId: null,
  description: `Row ${30 - i}`, rawDescription: null, date: new Date(2026, 9, 18, 12, 0, 30 - i), notes: null, tagIds: [],
  transferToAccountId: null, linkedTransactionId: null, isRecurring: false, splits: [], attachments: [], status: "cleared",
  importHash: null, excludeFromReports: false, createdAt: new Date(), updatedAt: new Date(),
})) as Transaction[]
rows.sort((a, b) => b.date.getTime() - a.date.getTime())

const account = {
  id: "a", userId: "u1", name: "Main", type: "checking", currency: "EUR", balance: 0, color: null,
  isArchived: false, createdAt: new Date(), updatedAt: new Date(),
}
const calls: unknown[][] = []



beforeEach(() => useFinanceSettingsStore.setState({ defaultCurrency: "EUR" }))
afterEach(cleanup)

describe("AccountDetailShell selection", () => {
  it("sums every page of the account after Select all matching", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AccountDetailShell accountId="a" />
      </QueryClientProvider>,
    )
    const table = await screen.findByRole("table", { name: "Transactions" })
    fireEvent.click(within(table).getByRole("checkbox", { name: "Select all on this page" }))
    expect(await screen.findByText("25 selected")).toBeTruthy()
    expect(screen.getByText("Out").parentElement?.textContent).toBe("Out −€450.00")

    calls.length = 0
    fireEvent.click(screen.getByRole("button", { name: "Select all 30 matching" }))
    await waitFor(() => expect(screen.getByText("30 selected")).toBeTruthy())
    expect(screen.getByText("Out").parentElement?.textContent).toBe("Out −€465.00")
    // No read: the unpaginated account query the page already holds is reused.
    expect(calls).toEqual([])
  })

  it("shows the year of a Last activity that is not this year", async () => {
    const saved = rows.splice(0, rows.length, { ...rows[0], id: "old", date: new Date(2024, 9, 13, 12) })
    try {
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <AccountDetailShell accountId="a" />
        </QueryClientProvider>,
      )
      expect(await screen.findByText("Last activity 13 Oct 2024")).toBeTruthy()
    } finally {
      rows.splice(0, rows.length, ...saved)
    }
  })
})
