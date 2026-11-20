import { isoDate } from "@alter-ego/kernel/dates"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import { endOfMonth, format, subMonths } from "date-fns"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { clearMockFinance, mockFinance } from "../../../adapter-mock"
import { QuickAddFab } from "../../quick-add-fab"
import { DashboardShell } from "../dashboard-shell"

const toast = vi.fn()
vi.mock("@alter-ego/ui/use-toast", () => ({ useToast: () => ({ toast }) }))
// The host's database is the finance mock itself, so a spy on it is what the page calls.
vi.mock("../../../host", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: "u1" } }),
  getBackend: () => ({ db: mockFinance }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}))

// The app's staleTime: a list the page was handed is fresh, so nothing re-reads it on mount.
const renderShell = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })}>
      {/* The app layout mounts the phone's + on this route too; its dialog must not read on its own. */}
      <DashboardShell />
      <QuickAddFab />
    </QueryClientProvider>,
  )

describe("DashboardShell, daily writes", () => {
  beforeEach(() => localStorage.clear())

  it("takes no account balance snapshot, remembers only the day's net worth one, and reads accounts and categories once each", async () => {
    const db = mockFinance
    const getAccounts = vi.spyOn(db, "getAccounts")
    const getCategories = vi.spyOn(db, "getCategories")
    // The once-a-day net worth snapshot reads the accounts itself; this test counts the page's reads.
    vi.spyOn(db, "takeSnapshot").mockResolvedValue({ id: "s", userId: "u1", date: new Date(), totalAssets: 0, totalLiabilities: 0, netWorth: 0 })
    renderShell()
    await screen.findByRole("heading", { name: "Dashboard" })
    // The dashboard read both; its own hooks and the dialogs reuse them.
    expect(getAccounts).toHaveBeenCalledTimes(1)
    expect(getCategories).toHaveBeenCalledTimes(1)
    expect(db).not.toHaveProperty("takeAccountBalanceSnapshots")
    // The only thing the page remembers is that today's net worth snapshot is taken.
    await waitFor(() => expect(Object.keys(localStorage)).toEqual([`alter-ego-snapshot-${isoDate(new Date())}`]))
  })
})

describe("DashboardShell, net worth", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    clearMockFinance()
  })

  it("takes one snapshot per day, whatever the flags, and says the change since last month end", async () => {
    const db = mockFinance
    await db.createAccount("u1", { name: "Everyday", type: "checking", currency: "USD", balance: 1000 })
    const takeSnapshot = vi.spyOn(db, "takeSnapshot")
    const lastMonthEnd = endOfMonth(subMonths(new Date(), 1))
    vi.spyOn(db, "getNetWorthAt").mockResolvedValue({
      id: "s", userId: "u1", date: lastMonthEnd, totalAssets: 850, totalLiabilities: 0, netWorth: 850,
    })
    const first = renderShell()
    expect(await screen.findByText("Net worth")).toBeInTheDocument()
    expect(await screen.findByText(new RegExp(`^Up .*150.* since ${format(lastMonthEnd, "d MMMM")}$`))).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem(`alter-ego-snapshot-${isoDate(new Date())}`)).toBe("1"))
    first.unmount()
    renderShell()
    await screen.findByText("Net worth")
    expect(takeSnapshot).toHaveBeenCalledTimes(1)
  })

  it("takes the snapshot only after the dashboard is in", async () => {
    const db = mockFinance
    await db.createAccount("u1", { name: "Everyday", type: "checking", currency: "USD", balance: 1000 })
    const real = db.getDashboardData.bind(db)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    vi.spyOn(db, "getDashboardData").mockImplementation(async (...a) => {
      await gate
      return real(...a)
    })
    const takeSnapshot = vi.spyOn(db, "takeSnapshot")
    renderShell()
    await new Promise((r) => setTimeout(r, 50))
    expect(takeSnapshot).not.toHaveBeenCalled()
    release()
    await waitFor(() => expect(takeSnapshot).toHaveBeenCalledTimes(1))
  })

  it("shows no change line for a new user with no snapshot", async () => {
    const db = mockFinance
    await db.createAccount("u1", { name: "Everyday", type: "checking", currency: "USD", balance: 1000 })
    const at = vi.spyOn(db, "getNetWorthAt")
    renderShell()
    await screen.findByText("Net worth")
    await waitFor(() => expect(at).toHaveBeenCalled())
    await at.mock.results[0].value
    expect(screen.queryByText(/since/)).toBeNull()
  })
})

describe("DashboardShell, slow budgets", () => {
  it("shows the page without waiting for budgets, then fills the card", async () => {
    const db = mockFinance
    const account = await db.createAccount("u1", { name: "Everyday", type: "checking", currency: "USD", balance: 100 })
    await db.createTransaction("u1", {
      accountId: account.id, type: "expense", amount: 5, currency: "USD", description: "Coffee beans", date: new Date(),
    })
    await db.createBudget("u1", { name: "Food", amount: 200, currency: "USD", period: "monthly" })
    const real = db.getBudgets.bind(db)
    let release!: () => void
    vi.spyOn(db, "getBudgets").mockImplementation(
      (userId) => new Promise((resolve) => { release = () => resolve(real(userId)) }),
    )

    renderShell()
    // The stat strip, the account tiles and Recent Activity are up while budgets are still out.
    expect(await screen.findByText("Net worth")).toBeInTheDocument()
    expect(screen.getAllByText("Coffee beans").length).toBeGreaterThan(0)
    expect(screen.getByRole("status", { name: "Loading budgets" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Budgets" })).not.toBeInTheDocument()

    await act(async () => release())
    expect(await screen.findByRole("heading", { name: "Budgets" })).toBeInTheDocument()
    expect(screen.queryByRole("status", { name: "Loading budgets" })).not.toBeInTheDocument()
  })
})

describe("DashboardShell, budget alerts", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    clearMockFinance()
    toast.mockClear()
  })

  it("toasts Budget exceeded for a zero-limit budget with spending, as the card says Over", async () => {
    const db = mockFinance
    const account = await db.createAccount("u1", { name: "Everyday", type: "checking", currency: "USD", balance: 100 })
    await db.createTransaction("u1", {
      accountId: account.id, type: "expense", amount: 20, currency: "USD", description: "Beans", date: new Date(),
    })
    await db.createBudget("u1", { name: "Zero", amount: 0, currency: "USD", period: "monthly" })
    renderShell()
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Budget exceeded", description: '"Zero" has exceeded its limit.' })),
    )
  })
})
