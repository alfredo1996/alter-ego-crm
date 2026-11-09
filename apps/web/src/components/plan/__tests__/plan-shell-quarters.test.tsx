import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"

import { PlanShell } from "../plan-shell"

const now = new Date()
const DATA: Record<string, unknown> = {
  getClients: [{ id: "c1", userId: "u1", name: "Acme", isActive: true, createdAt: now, updatedAt: now }],
  getEngagements: [
    {
      id: "e1", userId: "u1", clientId: "c1", name: null, opportunityId: null, dailyRate: 500, vatApplicable: true,
      contractedDays: null, defaultDaysPerMonth: 10, startMonth: null, endMonth: null, endDate: null, isActive: true,
      notes: null, createdAt: now, updatedAt: now,
    },
  ],
  getOpportunities: [
    {
      id: "o1", userId: "u1", clientId: "c1", title: "Next", stage: "proposal", probability: 100, dailyRate: 1000,
      estimatedDaysPerMonth: 10, estimatedDurationMonths: 36, expectedStartMonth: null, vatApplicable: true,
      createdAt: now, updatedAt: now,
    },
  ],
}

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy({}, { get: (_db, method) => () => (DATA[String(method)] instanceof Error ? Promise.reject(DATA[String(method)]) : Promise.resolve(DATA[String(method)] ?? (String(method).endsWith("Settings") ? null : []))) }),
  }),
}))
const off = vi.hoisted(() => new Set<string>())
vi.mock("@/modules", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  isModuleOn: (id: string) => !off.has(id),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}))

afterEach(() => off.clear())

// The Quarters read the timeline the Projection shows, so the switch moves both (the approved mockup).
it("the planned months of the Quarters follow the Projection's scenario switch", async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PlanShell />
    </QueryClientProvider>,
  )
  const region = await screen.findByRole("region", { name: /^Quarters of/ })
  const yearAtPlan = () => within(region).getByText("Year at plan").nextElementSibling!.textContent
  const left = 12 - now.getMonth() // this month to December, all at plan
  expect(yearAtPlan()).toBe(`€${(left * 5000).toLocaleString("en-IE")}`)
  fireEvent.click(screen.getByText("With Weighted Pipeline"))
  expect(yearAtPlan()).toBe(`€${(left * 15000).toLocaleString("en-IE")}`)
})

it("with no company account the Runway asks for one and offers no floor", async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PlanShell />
    </QueryClientProvider>,
  )
  expect(await screen.findByRole("link", { name: "Add one in the Cash Book" })).toHaveAttribute("href", "/cash-book")
  expect(screen.queryByRole("button", { name: /Floor/ })).toBeNull()
})

it("the Runway counts the scenario the Projection switch shows, and its balances follow", async () => {
  DATA.getCompanyAccounts = [
    { id: "a1", userId: "u1", name: "Bank", openingBalance: 8000, openingDate: new Date(2020, 0, 1), statementBalance: null, statementDate: null, importRef: null, createdAt: now, updatedAt: now },
  ]
  try {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PlanShell />
      </QueryClientProvider>,
    )
    const table = await screen.findByRole("table", { name: /^Runway by month/ })
    const firstMonthBalance = () => within(within(table).getAllByRole("row")[2]).getAllByRole("cell")[1].textContent
    expect(screen.getByText(/Counting: Contracts Only/)).toBeInTheDocument()
    expect(firstMonthBalance()).toBe("€13,000")
    fireEvent.click(screen.getByText("With Weighted Pipeline"))
    expect(screen.getByText(/Counting: With Weighted Pipeline/)).toBeInTheDocument()
    expect(firstMonthBalance()).toBe("€23,000")
  } finally {
    delete DATA.getCompanyAccounts
  }
})

it("a failing time-off read still renders the Plan, without Your time", async () => {
  DATA.getCapacityDocs = new Error("permission-denied")
  try {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PlanShell />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole("region", { name: /^Quarters of/ })).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: "Plan" })).toBeInTheDocument()
    expect(screen.queryByRole("rowheader", { name: /^Time off/ })).toBeNull()
  } finally {
    delete DATA.getCapacityDocs
  }
})

const renderPlan = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PlanShell />
    </QueryClientProvider>,
  )

// Ended quarters are read off invoices and costs: without either they would all say €0, so the section is not shown.
it.each([["books"], ["invoicing"]])("without %s the Plan has no Quarters section or chip, and keeps the Projection", async (module) => {
  off.add(module)
  renderPlan()
  await screen.findByRole("region", { name: /^Next \d+ months/ })
  expect(screen.queryByRole("region", { name: /^Quarters of/ })).toBeNull()
  expect(screen.queryByText("Loading quarters…")).toBeNull()
  expect(screen.queryByRole("link", { name: "Quarters" })).toBeNull()
})

it("without books the Plan has no Runway section, chip or loading line, and keeps the rest", async () => {
  off.add("books")
  renderPlan()
  await screen.findByRole("region", { name: /^Next \d+ months/ })
  expect(screen.queryByText("Runway")).toBeNull()
  expect(screen.queryByRole("link", { name: "Add one in the Cash Book" })).toBeNull()
  expect(screen.queryByText("Loading runway…")).toBeNull()
})
