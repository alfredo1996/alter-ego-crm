/**
 * The Contracts page on made-up data, dated from today so the window always holds it. The bars' maths is
 * lib/__tests__/contract-timeline.test.ts; this is what the page shows and what its buttons do.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { addMonths, format } from "date-fns"
import { afterEach, expect, it, vi } from "vitest"

import { windowFrom, windowLabel } from "@/lib/contract-timeline"

import { ContractTimeline } from "../contract-timeline"

const at = new Date(2026, 0, 1)
const today = new Date()
const ym = (n: number) => format(addMonths(today, n), "yyyy-MM")
const DATA: Record<string, unknown> = {
  getClients: [{ id: "c1", userId: "u1", name: "Acme Retail", isActive: true, createdAt: at, updatedAt: at }],
  getEngagements: [
    {
      id: "e1", userId: "u1", clientId: "c1", name: "Guest MVP", opportunityId: null, dailyRate: 1000, vatApplicable: true,
      contractedDays: 20, defaultDaysPerMonth: 5, startMonth: ym(-1), endMonth: ym(3), endDate: null, isActive: true,
      notes: null, createdAt: at, updatedAt: at,
    },
  ],
  getOpportunities: [
    {
      id: "o1", userId: "u1", clientId: "c1", title: "Front-desk card", stage: "proposal", probability: 50, dailyRate: 800,
      estimatedDaysPerMonth: 5, estimatedDurationMonths: 2, expectedStartMonth: ym(2), vatApplicable: true,
      nextActionDate: null, nextActionNote: null, notes: null, lostReason: null, closedAt: null, engagementId: null,
      createdAt: at, updatedAt: at,
    },
  ],
}

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy({}, { get: (_db, method) => () => Promise.resolve(DATA[String(method)] ?? []) }),
  }),
}))
const off = vi.hoisted(() => new Set<string>())
vi.mock("@/modules", async (actual) => ({ ...(await actual<Record<string, unknown>>()), isModuleOn: (id: string) => !off.has(id) }))

afterEach(() => {
  cleanup()
  off.clear()
})

async function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ContractTimeline />
    </QueryClientProvider>,
  )
  return screen.findByRole("region", { name: "Timeline" })
}
const timeline = (t: HTMLElement) => within(t)

it("draws the contract and the deal under their client; Hide Pipeline takes the deal away", async () => {
  const t = timeline(await show())
  expect(t.getByRole("button", { name: /^Guest MVP, Acme Retail: .*Active$/ })).toBeInTheDocument()
  expect(t.getByRole("button", { name: /^Front-desk card, Acme Retail: Proposal · 10 days.*Not signed yet$/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Hide Pipeline" }))
  expect(t.queryByRole("button", { name: /Front-desk card/ })).toBeNull()
  expect(t.getByRole("button", { name: /Guest MVP/ })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Show Pipeline" })).toHaveAttribute("aria-pressed", "false")
})

it("a click on a bar shows its quarters with an Invoiced column", async () => {
  const t = timeline(await show())
  fireEvent.click(t.getByRole("button", { name: /^Guest MVP/ }))
  const detail = within(screen.getByRole("region", { name: "Contract detail" }))
  expect(detail.getByRole("heading", { name: "Guest MVP" })).toBeInTheDocument()
  expect(detail.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Quarter", "Planned", "Logged", "Invoiced", "Fill"])
  expect(detail.getAllByRole("row").at(-1)).toHaveTextContent(/^Total/)
})

it("with invoicing off there is no Invoiced column", async () => {
  off.add("invoicing")
  const t = timeline(await show())
  fireEvent.click(t.getByRole("button", { name: /^Guest MVP/ }))
  const detail = within(screen.getByRole("region", { name: "Contract detail" }))
  expect(detail.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Quarter", "Planned", "Logged", "Fill"])
})

it("a deal's detail says it is not signed yet", async () => {
  const t = timeline(await show())
  fireEvent.click(t.getByRole("button", { name: /^Front-desk card/ }))
  const detail = within(screen.getByRole("region", { name: "Contract detail" }))
  expect(detail.getByRole("heading", { name: "Not signed yet" })).toBeInTheDocument()
  expect(detail.getByRole("link", { name: "Open Opportunity" })).toHaveAttribute("href", "/pipeline")
})

it("Earlier and Later move the window by a quarter", async () => {
  await show()
  const now = windowFrom(format(today, "yyyy-MM-dd"))
  expect(screen.getByText(windowLabel(now))).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Earlier" }))
  expect(screen.getByText(windowLabel(windowFrom(format(today, "yyyy-MM-dd"), -1)))).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Later" }))
  fireEvent.click(screen.getByRole("button", { name: "Later" }))
  expect(screen.getByText(windowLabel(windowFrom(format(today, "yyyy-MM-dd"), 1)))).toBeInTheDocument()
})
