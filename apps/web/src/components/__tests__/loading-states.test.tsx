/**
 * The company pages rendered their empty state ("No clients yet", "+€0/month")
 * for the whole auth and Firestore wait, then popped the data in. Each shell now
 * waits on pageState. This drives
 * the real TanStack hooks against a backend whose reads hang, fail or resolve,
 * because the bug lived in TanStack's isPending/isLoading split.
 *
 * `reads.hang` holds back just some reads while every other one resolves.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CashBookShell } from "@/components/cash-book/cash-book-shell"
import { CompanyExpensesShell } from "@/components/company-expenses/company-expenses-shell"
import { BillingShell } from "@/components/crm/billing-shell"
import { ClientPage } from "@/components/crm/client-page"
import { ClientsShell } from "@/components/crm/clients-shell"
import { PipelineShell } from "@/components/crm/pipeline-shell"
import { SolutionCatalog } from "@/components/crm/solution-catalog"
import { TaskBoard } from "@/components/crm/task-board"
import { TimecardWeek } from "@/components/crm/timecard-week"
import { DeadlinesShell } from "@/components/deadlines/deadlines-shell"
import { MonthEndShell } from "@/components/month-end/month-end-shell"
import { PlanShell } from "@/components/plan/plan-shell"

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
  getClients: [
    {
      id: "c1", userId: "u1", name: "Acme", vatNumber: null, email: null, contactName: null,
      contactPhone: null, notes: null, isActive: true, createdAt: now, updatedAt: now,
    },
  ],
  getEngagements: [
    {
      id: "e1", userId: "u1", clientId: "c1", name: null, opportunityId: null, dailyRate: 500,
      vatApplicable: true, contractedDays: null, defaultDaysPerMonth: 10, startMonth: null,
      endMonth: null, endDate: null, isActive: true, notes: null, createdAt: now, updatedAt: now,
    },
  ],
}

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/backend", () => ({
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

const SHELLS: { name: string; Shell: ComponentType; loaded: () => void }[] = [
  { name: "pipeline", Shell: PipelineShell, loaded: () => screen.getByRole("heading", { name: "Pipeline" }) },
  { name: "clients", Shell: ClientsShell, loaded: () => screen.getByRole("heading", { name: "Acme" }) },
  {
    name: "client",
    Shell: () => <ClientPage clientId="c1" />,
    loaded: () => screen.getByRole("heading", { name: "Acme" }),
  },
  { name: "solutions", Shell: SolutionCatalog, loaded: () => screen.getByRole("heading", { name: "Solutions" }) },
  { name: "invoices", Shell: () => <BillingShell />, loaded: () => screen.getByRole("heading", { name: "Invoices", level: 1 }) },
  { name: "plan", Shell: PlanShell, loaded: () => screen.getByRole("heading", { name: "Plan" }) },
  { name: "deadlines", Shell: DeadlinesShell, loaded: () => screen.getByRole("heading", { name: "Deadlines" }) },
  { name: "tasks", Shell: TaskBoard, loaded: () => screen.getByText(/No tasks yet/) },
  // The week of hours on /plan, which also gates on its own reads (PlanShell's are a superset).
  { name: "week of hours", Shell: TimecardWeek, loaded: () => screen.getByRole("rowheader", { name: /^Acme · / }) },
  { name: "costs", Shell: CompanyExpensesShell, loaded: () => screen.getByRole("heading", { name: "Costs" }) },
  { name: "cash book", Shell: CashBookShell, loaded: () => screen.getByRole("heading", { name: "Cash Book" }) },
  { name: "month end", Shell: MonthEndShell, loaded: () => screen.getByRole("heading", { name: "Month End" }) },
]

describe.each(SHELLS)("$name page", ({ Shell, loaded }) => {
  it("shows the spinner, not an empty state or €0, while its data is pending", () => {
    reads.mode = "pending"
    const { container } = renderShell(Shell)
    expect(screen.getByRole("status")).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\bNo [a-z]|€/)
  })

  it("shows the error card when a read fails, and Try Again loads the page", async () => {
    reads.mode = "error"
    renderShell(Shell)
    const retry = await screen.findByRole("button", { name: "Try Again" })
    expect(screen.getByText("Firestore irraggiungibile")).toBeInTheDocument()

    reads.mode = "data"
    fireEvent.click(retry)
    await waitFor(loaded)
  })

  it("renders the page once its data is there", async () => {
    reads.mode = "data"
    renderShell(Shell)
    await waitFor(loaded)
    expect(screen.queryByRole("status")).toBeNull()
  })
})

/** Lets every read that is not held back land and render. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))

// A contract's light comes from its verbali, a read of its own.
it("clients keeps its spinner while the meetings load, so no status chip pops in", async () => {
  reads.mode = "data"
  reads.hang = ["getMeetings"]
  renderShell(ClientsShell)
  await settle()
  expect(screen.getByRole("status")).toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "Acme" })).toBeNull()
})

// The over-budget line on each contract card reads the hours: no card may show before them.
it("clients keeps its spinner while the timecards load", async () => {
  reads.mode = "data"
  reads.hang = ["getTimecards"]
  renderShell(ClientsShell)
  await settle()
  expect(screen.getByRole("status")).toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "Acme" })).toBeNull()
})

// Timecards are the client page's own read: "No hours logged" must not show before them.
it("the client page keeps its spinner while the timecards load", async () => {
  reads.mode = "data"
  reads.hang = ["getTimecards"]
  renderShell(() => <ClientPage clientId="c1" />)
  await settle()
  expect(screen.getByRole("status")).toBeInTheDocument()
  expect(screen.queryByText(/No hours logged/)).toBeNull()
})

// Days by month's second line and the week of hours are the timecards': nothing may show before them.
it("the plan page keeps its spinner while the timecards load", async () => {
  reads.mode = "data"
  reads.hang = ["getTimecards"]
  renderShell(PlanShell)
  await settle()
  expect(screen.getByRole("status")).toBeInTheDocument()
  expect(screen.queryByRole("table")).toBeNull()
})

// The week grid's rows and totals come from the timecards, and the week result's
// plan share from the allocations: no row may show before both.
it.each(["getTimecards", "getAllocations"])("the week of hours keeps its spinner while %s loads", async (read) => {
  reads.mode = "data"
  reads.hang = [read]
  renderShell(TimecardWeek)
  await settle()
  expect(screen.getByRole("status")).toBeInTheDocument()
  expect(screen.queryByRole("table")).toBeNull()
})
