/**
 * This drives the real TanStack hooks against a backend whose reads hang, fail
 * or resolve, because the bug lived in TanStack's isPending/isLoading split.
 *
 * Budgets and savings goals derive their list from the query, so a failed first
 * load used to read as an empty list ("No budgets yet") instead of an error.
 *
 * Some finance pages rendered once their main query landed and let the rest pop
 * in: the dashboard's budget, bill and goal cards, the reports' lower sections,
 * and transaction rows whose account read "Unknown" until accounts arrived.
 * `reads.hang` holds back just those reads while every other one resolves.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest"

import { BudgetsShell } from "../budgets/budgets-shell"
import { DashboardShell } from "../dashboard/dashboard-shell"
import { ReportsShell } from "../reports/reports-shell"
import { SavingsGoalsShell } from "../savings-goals/savings-goals-shell"
import { TransactionsShell } from "../transactions/transactions-shell"

import type { ComponentType } from "react"

const reads = vi.hoisted(() => ({
  mode: "pending" as "pending" | "error" | "data",
  /** Reads that never resolve, whatever the mode. */
  hang: [] as string[],
}))
beforeEach(() => {
  reads.hang = []
})

const now = new Date()
const DATA: Record<string, unknown> = {
  getAccounts: [
    {
      id: "a1", userId: "u1", name: "Conto Corrente", type: "checking", currency: "EUR", balance: 100,
      openingBalance: 100, icon: null, color: null, isArchived: false, createdAt: now, updatedAt: now,
    },
  ],
  getTransactions: {
    data: [
      {
        id: "t1", userId: "u1", accountId: "a1", type: "expense", amount: 5, currency: "EUR",
        categoryId: null, description: "Coffee", rawDescription: null, date: now, notes: null,
        tagIds: [], transferToAccountId: null, linkedTransactionId: null, isRecurring: false,
        splits: [], attachments: [], status: "cleared", importHash: null, excludeFromReports: false,
        createdAt: now, updatedAt: now,
      },
    ],
    total: 1,
  },
  getDashboardData: { accountBalances: [], recentTransactions: [], accounts: [], categories: [] },
  getReportData: { categorySpending: [], monthlySummary: [], totalIncome: 0, totalExpenses: 0, netSavings: 0, topExpenses: [] },
}


vi.mock("../../host", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: "u1" } }),
  getBackend: () => ({
    db: new Proxy(
      {},
      {
        get: (_db, method) => () => {
          const name = String(method)
          if (reads.mode === "pending" || reads.hang.includes(name)) return new Promise(() => {})
          if (reads.mode === "error") return Promise.reject(new Error("Firestore irraggiungibile"))
          return Promise.resolve(DATA[name] ?? (name.endsWith("Settings") ? null : []))
        },
      },
    ),
  }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}))

function renderShell(Shell: ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>,
  )
}

describe.each([
  { name: "budgets", Shell: BudgetsShell, failed: "Failed to load budgets", empty: "No budgets yet" },
  { name: "savings goals", Shell: SavingsGoalsShell, failed: "Failed to load savings goals", empty: "No savings goals yet" },
])("$name page", ({ Shell, failed, empty }) => {
  it("shows the error card, not the empty state, when its first load fails", async () => {
    reads.mode = "error"
    renderShell(Shell)
    await screen.findByText(failed)
    expect(screen.queryByText(empty)).toBeNull()
  })

  it("shows the empty state once an empty list has loaded", async () => {
    reads.mode = "data"
    renderShell(Shell)
    await screen.findByText(empty)
  })
})

/** Lets every read that is not held back land and render. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))

// Whole finance pages render here, charts and dialogs included. Under a loaded
// machine (the pre-commit hook runs files in parallel) one render took 9 s.
describe("finance sections that used to pop in after their page", { timeout: 30_000 }, () => {
  it("transactions wait for accounts, so no row reads 'Unknown'", async () => {
    reads.mode = "data"
    reads.hang = ["getAccounts"]
    renderShell(TransactionsShell)
    await settle()
    expect(screen.queryByText("Coffee")).toBeNull()
    expect(screen.queryByText("Unknown")).toBeNull()
  })

  it("transactions wait for categories, so no row reads 'Uncategorized'", async () => {
    reads.mode = "data"
    reads.hang = ["getCategories"]
    renderShell(TransactionsShell)
    await settle()
    expect(screen.queryByText("Coffee")).toBeNull()
    expect(screen.queryByText("Uncategorized")).toBeNull()
  })

  it("transactions name each row's account once both have loaded", async () => {
    reads.mode = "data"
    renderShell(TransactionsShell)
    await screen.findAllByText("Conto Corrente")
    expect(screen.queryByText("Unknown")).toBeNull()
  })

  it("the dashboard keeps its skeleton while getDashboardData loads", async () => {
    reads.mode = "data"
    reads.hang = ["getDashboardData"]
    renderShell(DashboardShell)
    await settle()
    expect(screen.queryByRole("heading", { name: "Dashboard" })).toBeNull()
  })

  // The page no longer waits for these; each holds a slot of its own.
  it.each([
    ["getBudgets", "budgets"],
    ["getRecurringTransactions", "upcoming bills"],
    ["getSavingsGoals", "savings goals"],
  ])("the dashboard renders while %s loads, with a slot held for it", async (method, label) => {
    reads.mode = "data"
    reads.hang = [method]
    // One account, or the page is the get-started prompt and has no cards.
    const saved = DATA.getDashboardData
    onTestFinished(() => { DATA.getDashboardData = saved })
    DATA.getDashboardData = {
      totalAssets: 0, totalLiabilities: 0, netWorth: 0, monthlyIncome: 0, monthlyExpenses: 0,
      monthlySavingsRate: 0, monthlySummary: [], categorySpending: [], recentTransactions: [], accounts: [], categories: [],
      accountBalances: [{ accountId: "a1", accountName: "Everyday", balance: 0, currency: "USD", type: "checking" }],
    }
    renderShell(DashboardShell)
    await screen.findByRole("heading", { name: "Dashboard" })
    expect(screen.getByRole("status", { name: `Loading ${label}` })).toBeInTheDocument()
  })

  it("a held slot resolves to its card once the data is in", async () => {
    reads.mode = "data"
    renderShell(DashboardShell)
    await screen.findByRole("heading", { name: "Dashboard" })
    await waitFor(() => expect(screen.queryByRole("status", { name: /^Loading (budgets|upcoming bills|savings goals)$/ })).toBeNull())
  })

  it.each(["getNetWorthHistory", "getBudgets", "getCategories"])(
    "reports keep their skeleton while %s loads",
    async (method) => {
      reads.mode = "data"
      reads.hang = [method]
      renderShell(ReportsShell)
      await settle()
      expect(screen.queryByRole("heading", { name: "Reports" })).toBeNull()
      expect(screen.queryByText(/No net worth history yet/)).toBeNull()
    },
  )

  it("reports render once every section has its data", async () => {
    reads.mode = "data"
    renderShell(ReportsShell)
    await screen.findByRole("heading", { name: "Reports" })
    // The suspected subscriptions are a tab on Recurring now; Reports points there.
    expect(screen.getByRole("link", { name: "Recurring, under Suggested" })).toHaveAttribute("href", "/recurring?tab=suggested")
  })
})
