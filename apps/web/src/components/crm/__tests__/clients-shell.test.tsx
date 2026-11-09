/**
 * The Clients page (Clients.dc) over a fixed clock, 15 Oct 2026, with the boards' four clients plus
 * an inactive one: the line on top, a card per client, the Status tabs (?status=) and the search,
 * and the More menu's Edit Client and Delete Client. Contracts, tasks and meetings are worked on
 * the client's page (client-page.test.tsx, contract-card.test.tsx).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { ClientsShell, describeClientDeletion } from "../clients-shell"
import { solution } from "./solution-fixtures"

const url = vi.hoisted(() => {
  const subs = new Set<() => void>()
  return {
    search: "",
    set(search: string) {
      this.search = search
      subs.forEach((f) => f())
    },
    subscribe: (f: () => void) => (subs.add(f), () => void subs.delete(f)),
  }
})
const replace = vi.fn((href: string) => url.set(new URL(href, "http://localhost").search))
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    useRouter: () => ({ replace, push: vi.fn() }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(url.subscribe, () => url.search)),
  }
})
const off = vi.hoisted(() => new Set<string>())
vi.mock("@/modules", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  isModuleOn: (id: string) => !off.has(id),
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
const DATA: Record<string, unknown> = {}
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ db: new Proxy({}, { get: (_db, method) => () => Promise.resolve(DATA[String(method)] ?? []) }) }),
}))

const at = new Date(2026, 0, 1)
const day = (iso: string) => new Date(`${iso}T00:00:00`)
const client = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, userId: "u1", name, vatNumber: null, email: null, contactName: null, contactPhone: null, notes: null,
  isActive: true, createdAt: at, updatedAt: at, ...extra,
})
const contract = (id: string, clientId: string, name: string, extra: Record<string, unknown>) => ({
  id, userId: "u1", clientId, name, opportunityId: null, vatApplicable: true, contractedDays: null, startMonth: null,
  endMonth: null, endDate: null, isActive: true, notes: null, createdAt: at, updatedAt: at, ...extra,
})
const invoice = (id: string, clientId: string, extra: Record<string, unknown>) => ({
  id, userId: "u1", clientId, engagementId: null, number: id, fromMonth: null, yearMonth: "2026-09", dueDate: null,
  paidDate: null, createdAt: at, updatedAt: at, ...extra,
})
const deal = (id: string, clientId: string, title: string, extra: Record<string, unknown>) => ({
  id, userId: "u1", clientId, title, dailyRate: 500, estimatedDaysPerMonth: 10, estimatedDurationMonths: 3,
  expectedStartMonth: null, vatApplicable: true, nextActionDate: null, nextActionNote: null, notes: null,
  lostReason: null, closedAt: null, engagementId: null, createdAt: at, updatedAt: at, ...extra,
})
const task = (id: string, clientId: string, due: string, isDone = false) => ({
  id, userId: "u1", clientId, engagementId: null, title: `Task ${id}`, dueDate: day(due), notes: null, isDone,
  startedAt: null, labels: [], createdAt: at, updatedAt: at,
})
const meeting = (id: string, clientId: string, date: string, health: string | null, engagementId: string | null = null) => ({
  id, userId: "u1", clientId, engagementId, date, time: null, health, text: "Status call", createdAt: at, updatedAt: at,
})

beforeAll(() => vi.setSystemTime(new Date(2026, 9, 15)))
afterAll(() => vi.useRealTimers())
afterEach(() => off.clear())
beforeEach(() => {
  DATA.getTimecards = []
  url.search = ""
  replace.mockClear()
  DATA.getClients = [
    client("lumen", "Lumen Srl", { contactName: "Paolo Neri", email: "admin@lumen.example", vatNumber: "IT09317460961" }),
    client("nordwind", "Nordwind Retail S.p.A.", { contactName: "Marta Keller, procurement", vatNumber: "IT04821930157" }),
    client("orto", "Orto Foods Srl", { contactName: "Luca Ferraro" }),
    client("vela", "Vela Analytics Srl", { contactName: "Chiara Bassi", email: "ops@vela.example" }),
    client("ostwind", "Ostwind Foods", { isActive: false, email: "info@ostwind.example" }),
  ]
  DATA.getEngagements = [
    contract("retainer", "lumen", "Retainer", { dailyRate: 450, defaultDaysPerMonth: 10, startMonth: "2026-06" }),
    contract("graph", "nordwind", "Product Graph", { dailyRate: 520, defaultDaysPerMonth: 8, contractedDays: 80, startMonth: "2026-07", endMonth: "2027-04" }),
    contract("support", "vela", "Data Platform Support", { dailyRate: 480, defaultDaysPerMonth: 4, contractedDays: 30, startMonth: "2026-08", endMonth: "2027-01" }),
    contract("old", "ostwind", "Audit", { dailyRate: 500, defaultDaysPerMonth: 5, isActive: false, endMonth: "2026-03" }),
  ]
  DATA.getInvoices = [
    invoice("9/2026", "lumen", { amount: 4500, vat: 990, paidDate: day("2026-10-10") }),
    invoice("10/2026", "nordwind", { amount: 4160, vat: 915.2, dueDate: day("2026-10-31") }),
    invoice("11/2026", "vela", { amount: 1440, vat: 316.8, dueDate: day("2026-10-05") }),
  ]
  DATA.getOpportunities = [
    deal("o1", "lumen", "BI Dashboard Refresh", { stage: "lead", probability: 20, dailyRate: 450, estimatedDaysPerMonth: 4 }),
    deal("o2", "nordwind", "Store Analytics Phase 2", { stage: "negotiation", probability: 70 }),
    deal("o3", "orto", "Demand Forecasting PoC", {
      stage: "lead", probability: 15, estimatedDaysPerMonth: 6, nextActionDate: day("2026-10-20"), nextActionNote: "Intro call with Luca",
    }),
    deal("o4", "vela", "Graph RAG Assistant", { stage: "proposal", probability: 40 }),
    deal("o5", "vela", "Warehouse Dashboard", { stage: "lost", probability: 0, closedAt: day("2026-08-08") }),
  ]
  DATA.getTasks = [
    task("t1", "lumen", "2026-10-28"),
    task("t2", "lumen", "2026-10-03", true),
    task("t3", "nordwind", "2026-10-18"),
    task("t4", "nordwind", "2026-10-21"),
    task("t5", "orto", "2026-10-12"),
    task("t6", "vela", "2026-10-16"),
    task("t7", "vela", "2026-10-17"),
  ]
  DATA.getMeetings = [
    meeting("m1", "lumen", "2026-10-06", "green", "retainer"),
    meeting("m2", "nordwind", "2026-09-25", "yellow", "graph"),
    meeting("m3", "nordwind", "2026-10-09", "green", "graph"),
    meeting("m4", "vela", "2026-10-02", null),
  ]
  DATA.getSolutions = [
    solution({ id: "s1", clientId: "lumen", name: "Customer 360" }),
    solution({ id: "s2", clientId: "nordwind", name: "Product knowledge graph" }),
    solution({ id: "s3", clientId: "vela", name: "Support ticket RAG" }),
  ]
})

async function show(search = "") {
  cleanup()
  url.search = search
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ClientsShell />
    </QueryClientProvider>,
  )
  await screen.findByRole("heading", { name: "Clients", level: 1 })
}

/** The cards' names, in order. */
const cards = () => screen.queryAllByRole("article").map((card) => within(card).getByRole("heading", { level: 2 }).textContent)
const card = (name: string) => screen.getByRole("article", { name })

describe("the Clients page", () => {
  it("heads the catalog with where the work stands: contracts, money owed and open tasks", async () => {
    await show()
    const line = screen.getByText("a month at plan", { exact: false }).closest("div")!
    expect(line).toHaveTextContent("3 active contracts · €10,580.00 a month at plan")
    expect(line).toHaveTextContent("€6,832.00 unpaid, 1 overdue · See Invoices")
    expect(within(line).getByRole("link", { name: "See Invoices" })).toHaveAttribute("href", "/invoices")
    expect(line).toHaveTextContent("6 open tasks")
  })

  it("draws a client as a card: contact, status, the name as its link, the last meeting, the main contract", async () => {
    await show()
    expect(cards()).toEqual(["Lumen Srl", "Nordwind Retail S.p.A.", "Orto Foods Srl", "Vela Analytics Srl", "Ostwind Foods"])
    const nordwind = card("Nordwind Retail S.p.A.")
    expect(nordwind).toHaveTextContent("Marta Keller, procurement")
    expect(within(nordwind).getByText("Active")).toBeInTheDocument()
    expect(within(nordwind).getByRole("link", { name: "Nordwind Retail S.p.A." })).toHaveAttribute("href", "/clients/nordwind")
    // The newest meeting, not the first logged.
    expect(nordwind).toHaveTextContent("Last meeting green · 9 Oct")
    // 80 days at 8 a month from July: they run out in April, the contract's last month.
    expect(within(nordwind).getByText("Product Graph").parentElement).toHaveTextContent(
      /^Product Graph · 8 days\/month × €520 · runs out Apr 2027$/,
    )
    expect(card("Lumen Srl")).toHaveTextContent("Retainer · 10 days/month × €450 · no end date")
    expect(card("Vela Analytics Srl")).toHaveTextContent("Data Platform Support · 4 days/month × €480 · ends Jan 2027")
    // A newest meeting that set no light says so, beside a hollow dot.
    expect(card("Vela Analytics Srl")).toHaveTextContent("Last meeting 2 Oct · no health set")
    // No contract work on the list: that is the client's page.
    expect(screen.queryByRole("button", { name: "Amend Contract" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Log Meeting" })).toBeNull()
  })

  it("says when the main contract runs out only while it has budget left", async () => {
    // 80 days = 640 h: 100 h leaves budget, 700 h is worked past it.
    const hours = (h: number) => [{ id: "t1", userId: "u1", engagementId: "graph", date: "2026-10-01", hours: h, notes: null, createdAt: at, updatedAt: at }]
    DATA.getTimecards = hours(100)
    await show()
    expect(card("Nordwind Retail S.p.A.")).toHaveTextContent("Product Graph · 8 days/month × €520 · runs out Apr 2027")
    DATA.getTimecards = hours(700)
    await show()
    expect(card("Nordwind Retail S.p.A.")).toHaveTextContent("Product Graph · 8 days/month × €520 · ends Apr 2027")
    expect(card("Nordwind Retail S.p.A.")).not.toHaveTextContent("runs out")
  })

  it.each([
    [640.032, "runs out"],
    [640.048, "ends"],
  ])("draws the over-budget line at isOverBudget's rounding: %s h on 80 days shows %s", async (h, word) => {
    DATA.getTimecards = [{ id: "t1", userId: "u1", engagementId: "graph", date: "2026-10-01", hours: h, notes: null, createdAt: at, updatedAt: at }]
    await show()
    expect(card("Nordwind Retail S.p.A.")).toHaveTextContent(`Product Graph · 8 days/month × €520 · ${word} Apr 2027`)
  })

  it("gives each card what it brings a month and what it owes, linked to the client's invoices", async () => {
    await show()
    const nordwind = card("Nordwind Retail S.p.A.")
    expect(within(nordwind).getByText("Monthly").nextElementSibling).toHaveTextContent("€4,160.00")
    expect(nordwind).toHaveTextContent("1 active contract")
    const owes = within(nordwind).getByRole("link", { name: "Invoices: €5,075.20 unpaid, due 31 Oct" })
    expect(owes).toHaveAttribute("href", "/clients/nordwind#invoices")
    expect(owes).toHaveTextContent("Unpaid€5,075.20Due 31 Oct")
    expect(within(card("Vela Analytics Srl")).getByRole("link", { name: "Invoices: €1,756.80 unpaid · 1 overdue" })).toHaveTextContent(
      "Overdue · due 5 Oct",
    )
    expect(within(card("Lumen Srl")).getByRole("link", { name: "Invoices: nothing unpaid" })).toHaveTextContent("€0.00All paid")
    // The footer: open tasks, the client's solutions, and the deal closest to signing.
    expect(nordwind).toHaveTextContent("2 open tasks · 1 solution · Open deal: Store Analytics Phase 2, 70%")
    expect(within(nordwind).getByRole("link", { name: "1 solution" })).toHaveAttribute("href", "/solutions?client=nordwind")
  })

  it("tells a prospect by its deal and next step, and a late task by its date", async () => {
    await show()
    const orto = card("Orto Foods Srl")
    expect(within(orto).getByText("Prospect")).toBeInTheDocument()
    expect(orto).toHaveTextContent("No meetings yet")
    expect(orto).toHaveTextContent("No contract yet · 1 deal in the pipeline")
    // 6 days × €500 at 15%.
    const weighted = within(orto).getByText("Weighted").parentElement!
    expect(weighted).toHaveAttribute("href", "/pipeline?client=orto")
    expect(weighted).toHaveTextContent("€450.00/month")
    expect(weighted).toHaveTextContent("Demand Forecasting PoC · Lead 15%")
    expect(within(orto).getByText("Next step").nextElementSibling).toHaveTextContent("20 Oct")
    expect(orto).toHaveTextContent("Intro call with Luca")
    expect(orto).toHaveTextContent("1 open task Overdue since 12 Oct · No solutions · Nothing invoiced yet")
    expect(within(orto).queryByRole("link", { name: /^Invoices/ })).toBeNull()
    expect(within(card("Ostwind Foods")).getByText("Inactive")).toBeInTheDocument()
  })

  it("calls a client whose contracts have all closed a prospect, not active", async () => {
    DATA.getEngagements = [
      ...(DATA.getEngagements as unknown[]),
      contract("pilot", "orto", "Pilot", { dailyRate: 500, defaultDaysPerMonth: 4, isActive: false, endMonth: "2026-06" }),
    ]
    await show()
    const orto = card("Orto Foods Srl")
    expect(within(orto).getByText("Prospect")).toBeInTheDocument()
    expect(within(orto).queryByText("Active")).toBeNull()
    expect(orto).toHaveTextContent("No active contract · 1 deal in the pipeline")
    // The tabs agree with the pill, and with the line on top, which counts active contracts only.
    expect(screen.getByRole("tab", { name: "Active 3" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Prospects 1" })).toBeInTheDocument()
  })

  it("narrows by status through ?status=, and by a search over name, VAT number, contact and email", async () => {
    await show()
    expect(screen.getByRole("tab", { name: "All 5", selected: true })).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Prospects 1" }), { button: 0 })
    expect(replace).toHaveBeenLastCalledWith("/clients?status=prospect", { scroll: false })
    expect(await screen.findByRole("tab", { name: "Prospects 1", selected: true })).toBeInTheDocument()
    expect(cards()).toEqual(["Orto Foods Srl"])

    await show("?status=inactive")
    expect(cards()).toEqual(["Ostwind Foods"])
    await show("?status=active")
    expect(cards()).toEqual(["Lumen Srl", "Nordwind Retail S.p.A.", "Vela Analytics Srl"])

    await show()
    const search = screen.getByRole("searchbox", { name: "Search clients" })
    for (const [query, found] of [
      ["IT0482", "Nordwind Retail S.p.A."],
      ["chiara", "Vela Analytics Srl"],
      ["info@ostwind", "Ostwind Foods"],
      ["lumen", "Lumen Srl"],
    ]) {
      fireEvent.change(search, { target: { value: query } })
      expect(cards()).toEqual([found])
    }
    // The tabs count what the search leaves.
    expect(screen.getByRole("tab", { name: "All 1" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Active 1" })).toBeInTheDocument()
    fireEvent.change(search, { target: { value: "nothing like it" } })
    expect(screen.getByText("No clients match these filters.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show All" }))
    expect(cards()).toHaveLength(5)
  })

  it("keeps Edit Client and Delete Client behind a card's More, and focus comes back to it", async () => {
    await show()
    const more = within(card("Nordwind Retail S.p.A.")).getByRole("button", { name: "More actions for Nordwind Retail S.p.A." })
    const open = async (item: string) => {
      more.focus()
      fireEvent.keyDown(more, { key: "Enter" })
      fireEvent.click(await screen.findByRole("menuitem", { name: item }))
    }
    await open("Edit Client")
    const edit = await screen.findByRole("dialog", { name: "Edit Client" })
    expect(within(edit).getByLabelText("Name")).toHaveValue("Nordwind Retail S.p.A.")
    fireEvent.click(within(edit).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(more).toHaveFocus())

    await open("Delete Client")
    const confirm = await screen.findByRole("alertdialog", { name: "Delete Client" })
    expect(confirm).toHaveTextContent(
      '"Nordwind Retail S.p.A." is deleted along with 1 contract, 1 opportunity, 2 tasks, 2 meetings, 1 invoice, and 1 solution, plus the contract allocations.',
    )
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(more).toHaveFocus())
  })

  it("says so when there are no clients yet, with one New Client button", async () => {
    DATA.getClients = []
    await show()
    expect(screen.getByRole("heading", { name: "No clients yet" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "New Client" })).toHaveLength(1)
    expect(screen.queryByRole("tablist")).toBeNull()
  })
})

/**
 * This sentence is the only warning before a cascade that takes contracts,
 * opportunities, every allocation and the client's tasks and verbali with it.
 * Getting the count or the plural wrong makes a destructive action read like a
 * harmless one.
 */
describe("describeClientDeletion", () => {
  it("says only the client goes when nothing hangs off it", () => {
    const text = describeClientDeletion("Acme", 0, 0, 0, 0)
    expect(text).toBe('"Acme" is deleted. Nothing else depends on it.')
    expect(text).not.toContain("contract")
    expect(text).not.toContain("allocations")
  })

  it("uses the singular for one contract", () => {
    expect(describeClientDeletion("Acme", 1, 0, 0, 0)).toContain("1 contract,")
  })

  it("uses the plural beyond one", () => {
    expect(describeClientDeletion("Acme", 2, 0, 0, 0)).toContain("2 contracts")
  })

  it("names the allocations only when a contract carries them", () => {
    expect(describeClientDeletion("Acme", 1, 0, 0, 0)).toContain("the contract allocations")
    // Opportunities have no allocations, so promising their loss would be a lie.
    expect(describeClientDeletion("Acme", 0, 3, 0, 0)).not.toContain("allocations")
  })

  it("lists both kinds when both exist", () => {
    const text = describeClientDeletion("Acme", 2, 3, 0, 0)
    expect(text).toContain("2 contracts and 3 opportunities")
    expect(text).toContain("The plan loses the revenue")
  })

  // #164: a prospect can have tasks and nothing else; they go with it.
  it("warns about tasks even when nothing else hangs off the client", () => {
    const text = describeClientDeletion("Acme", 0, 0, 3, 0)
    expect(text).toBe('"Acme" is deleted along with 3 tasks.')
    // Tasks carry no revenue, so the plan loses nothing.
    expect(text).not.toContain("The plan")
  })

  it("counts tasks alongside contracts and opportunities", () => {
    const text = describeClientDeletion("Acme", 1, 2, 4, 0)
    expect(text).toContain("1 contract, 2 opportunities, and 4 tasks")
    expect(text).toContain("The plan loses the revenue")
  })

  // Verbali go with the client for good: the call history is lost, so it is counted.
  it("counts verbali, singular and plural", () => {
    expect(describeClientDeletion("Acme", 1, 0, 2, 1)).toContain("1 contract, 2 tasks, and 1 meeting,")
    expect(describeClientDeletion("Acme", 0, 0, 0, 5)).toContain("5 meetings")
  })

  it("does not call a client with only verbali harmless, nor charge the plan for them", () => {
    const text = describeClientDeletion("Acme", 0, 0, 0, 2)
    expect(text).toBe('"Acme" is deleted along with 2 meetings.')
    expect(text).not.toContain("Nothing else")
  })

  // A solution's nine sections and data model go with it: counted, and no charge to the plan.
  it("counts solutions", () => {
    expect(describeClientDeletion("Acme", 1, 0, 0, 0, 0, 2)).toContain("1 contract and 2 solutions")
    expect(describeClientDeletion("Acme", 0, 0, 0, 0, 0, 1)).toBe('"Acme" is deleted along with 1 solution.')
  })

  // The one path that still deletes invoices, so it counts them.
  it("counts invoices", () => {
    expect(describeClientDeletion("Acme", 1, 0, 0, 0, 2)).toContain("2 invoices")
    expect(describeClientDeletion("Acme", 0, 0, 0, 0, 1)).toBe('"Acme" is deleted along with 1 invoice.')
  })
})

describe("the Clients page with modules left out", () => {
  it("without invoicing has no owed line, no See Invoices link and no Unpaid figure on a card", async () => {
    off.add("invoicing")
    await show()
    expect(screen.queryByRole("link", { name: "See Invoices" })).toBeNull()
    expect(screen.queryByText(/unpaid|Nothing owed/i)).toBeNull()
    expect(card("Nordwind Retail S.p.A.")).toHaveTextContent("Next step")
    expect(card("Nordwind Retail S.p.A.")).not.toHaveTextContent(/Unpaid|invoiced/)
    expect(within(card("Nordwind Retail S.p.A.")).queryByRole("link", { name: /^Invoices:/ })).toBeNull()
  })

  it("without solutions has no solutions line or link on a card", async () => {
    off.add("solutions")
    await show()
    expect(card("Nordwind Retail S.p.A.")).toHaveTextContent("2 open tasks · Open deal: Store Analytics Phase 2, 70%")
    expect(screen.queryByText(/solution/i)).toBeNull()
  })
})
