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
    {
      id: "e0", userId: "u1", clientId: "c1", name: "Retainer", opportunityId: null, dailyRate: 500, vatApplicable: true,
      contractedDays: null, defaultDaysPerMonth: 2, startMonth: ym(-2), endMonth: null, endDate: null, isActive: true,
      notes: null, createdAt: at, updatedAt: at,
    },
  ],
  getSolutions: [{ id: "s1", userId: "u1", clientId: "c1", engagementId: "e1", name: "Guest 360", steps: [] }],
  getOpportunities: [
    {
      id: "o1", userId: "u1", clientId: "c1", title: "Front-desk card", stage: "proposal", probability: 50, dailyRate: 800,
      estimatedDaysPerMonth: 5, estimatedDurationMonths: 2, expectedStartMonth: ym(2), vatApplicable: true,
      nextActionDate: null, nextActionNote: null, notes: null, lostReason: null, closedAt: null, engagementId: null,
      createdAt: at, updatedAt: at,
    },
  ],
}

const initial = { ...DATA }

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy({}, { get: (_db, method) => () => { calls.push(String(method)); return Promise.resolve(DATA[String(method)] ?? []) } }),
  }),
}))
const off = vi.hoisted(() => new Set<string>())
const calls = vi.hoisted(() => [] as string[])
vi.mock("@/modules", async (actual) => ({ ...(await actual<Record<string, unknown>>()), isModuleOn: (id: string) => !off.has(id) }))

afterEach(() => {
  cleanup()
  off.clear()
  calls.length = 0
  Object.assign(DATA, initial)
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
  expect(t.getByRole("button", { name: /^Guest MVP, Acme Retail: .*Active, \w{3} \d{4} – \w{3} \d{4}$/ })).toBeInTheDocument()
  expect(t.getByRole("button", { name: /^Front-desk card, Acme Retail: Proposal · 10 days.*Not signed yet, \w{3} \d{4} – \w{3} \d{4}$/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Hide Pipeline" }))
  expect(t.queryByRole("button", { name: /Front-desk card/ })).toBeNull()
  expect(t.getByRole("button", { name: /Guest MVP/ })).toBeInTheDocument()
  // The label says the state, so the button is not also a pressed toggle.
  expect(screen.getByRole("button", { name: "Show Pipeline" })).not.toHaveAttribute("aria-pressed")
})

it("a click on another bar swaps the detail to it, with its quarter rows and figures", async () => {
  const t = timeline(await show())
  const detail = within(screen.getByRole("region", { name: "Contract detail" }))
  // The open-ended Retainer starts first, so it is the one shown until a click.
  expect(detail.getByRole("heading", { name: "Retainer" })).toBeInTheDocument()
  fireEvent.click(t.getByRole("button", { name: /^Guest MVP/ }))
  expect(detail.getByRole("heading", { name: "Guest MVP" })).toBeInTheDocument()
  expect(detail.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Quarter", "Planned", "Logged", "Invoiced", "Fill"])
  const rows = detail.getAllByRole("row").slice(1)
  expect(rows.length).toBeGreaterThanOrEqual(2)
  expect(rows[0]).toHaveAccessibleName(/^Q\d \d{4}/)
  // Five months at 5 days, nothing logged, nothing invoiced.
  expect(rows.at(-1)).toHaveTextContent("Total25" + "0" + "€0" + "0%")
})

it("with invoicing off there is no Invoiced column and no invoice is read", async () => {
  off.add("invoicing")
  const t = timeline(await show())
  fireEvent.click(t.getByRole("button", { name: /^Guest MVP/ }))
  const detail = within(screen.getByRole("region", { name: "Contract detail" }))
  expect(detail.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Quarter", "Planned", "Logged", "Fill"])
  expect(calls).toContain("getSolutions")
  expect(calls).not.toContain("getInvoices")
})

it("names the solution and links to it; with solutions off, neither, and none is read", async () => {
  const t = timeline(await show())
  fireEvent.click(t.getByRole("button", { name: /^Guest MVP/ }))
  let detail = within(screen.getByRole("region", { name: "Contract detail" }))
  expect(detail.getByText("Solution")).toBeInTheDocument()
  expect(detail.getByRole("link", { name: "Open Solution" })).toHaveAttribute("href", "/solutions/s1")
  cleanup()
  calls.length = 0
  off.add("solutions")
  const t2 = timeline(await show())
  fireEvent.click(t2.getByRole("button", { name: /^Guest MVP/ }))
  detail = within(screen.getByRole("region", { name: "Contract detail" }))
  expect(detail.queryByText("Solution")).toBeNull()
  expect(detail.queryByRole("link", { name: "Open Solution" })).toBeNull()
  expect(calls).not.toContain("getSolutions")
  expect(calls).toContain("getInvoices")
})

it("a new user with nothing is not told to page Earlier or Later", async () => {
  for (const k of ["getEngagements", "getOpportunities", "getSolutions"]) DATA[k] = []
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ContractTimeline />
    </QueryClientProvider>,
  )
  expect(await screen.findByRole("heading", { name: "No contracts yet" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Open Clients" })).toHaveAttribute("href", "/clients")
  expect(screen.queryByText(/Try Earlier or Later/)).toBeNull()
})

it("a window with nothing in it, over data elsewhere, says to try Earlier or Later", async () => {
  await show()
  for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole("button", { name: "Earlier" }))
  expect(await screen.findByRole("heading", { name: "Nothing on the timeline in these months" })).toBeInTheDocument()
  expect(screen.getByText(/Try Earlier or Later/)).toBeInTheDocument()
})

it("a deal's detail says it is not signed yet", async () => {
  const t = timeline(await show())
  fireEvent.click(t.getByRole("button", { name: /^Front-desk card/ }))
  const detail = within(screen.getByRole("region", { name: "Contract detail" }))
  expect(detail.getByRole("heading", { name: "Not Signed Yet" })).toBeInTheDocument()
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

it("a contract with no ceiling says its days logged to date over planned to date, and the percentage agrees", async () => {
  // The Retainer starts two months back at 2 days a month: 6 planned days to date; 3 days logged today.
  DATA.getTimecards = [{ id: "t1", userId: "u1", engagementId: "e0", date: format(today, "yyyy-MM-dd"), hours: 24 }]
  await show()
  const detail = within(screen.getByRole("region", { name: "Contract detail" }))
  expect(detail.getByText("No ceiling: 3 of 6 planned days logged")).toBeInTheDocument()
  expect(detail.getByText("50%", { selector: "span" })).toBeInTheDocument()
})
