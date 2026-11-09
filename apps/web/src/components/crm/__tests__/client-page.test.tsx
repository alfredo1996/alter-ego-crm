/**
 * A client's page over a fixed clock (15 Sep 2026): August is the last closed month. Acme and Beta
 * check the billing (moved here from the old BillingShell client branch: the maths is covered in
 * lib/__tests__/invoices.test.ts and the sheet in invoice-sheet.test.tsx); Delta, with one capped
 * contract, checks the rest of Client.dc: the summary line, the figures, the index, the days bar,
 * tasks, meetings, opportunities and solutions. The contract dialogs are contract-card.test.tsx's.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { ClientPage } from "../client-page"
import { solution } from "./solution-fixtures"

const at = new Date(2026, 8, 1)
const client = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, userId: "u1", name, vatNumber: null, email: null, contactName: null,
  contactPhone: null, notes: null, isActive: true, createdAt: at, updatedAt: at, ...extra,
})
const contract = (id: string, clientId: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, userId: "u1", clientId, name, opportunityId: null, dailyRate: 500, vatApplicable: true, contractedDays: null,
  defaultDaysPerMonth: 10, startMonth: null, endMonth: null, endDate: null, isActive: true, notes: null,
  createdAt: at, updatedAt: at, ...extra,
})
const hours = (engagementId: string, date: string, h: number) => (
  { id: `${engagementId}_${date}`, userId: "u1", engagementId, date, hours: h, notes: null, createdAt: at, updatedAt: at }
)
const invoice = (o: Record<string, unknown>) => ({
  userId: "u1", engagementId: null, fromMonth: null, dueDate: null, paidDate: null, createdAt: at, updatedAt: at, ...o,
})

const DATA: Record<string, unknown> = {
  getClients: [
    client("c1", "Acme"),
    client("c2", "Beta"),
    client("c4", "Delta", {
      contactName: "Marta Keller, procurement", email: "procurement@delta.example", contactPhone: "+39 02 5550 1180",
      vatNumber: "IT04821930157", notes: "Retail chain, 140 stores.", createdAt: new Date(2026, 5, 2),
    }),
    // Its one contract has closed: a prospect again, as the Clients catalog calls it.
    client("c5", "Echo"),
    client("c6", "Foxtrot"),
    client("c7", "Golf"),
    client("c8", "Hotel"),
    client("c9", "India"),
    client("c10", "Juliet"),
    client("c11", "Kilo"),
    client("c12", "Lima"),
    client("c13", "Mike"),
  ],
  getEngagements: [
    // €500/day, 16 h logged in August: €1,000, plus Audit's credit note back on the client's balance.
    contract("e1", "c1", "Platform"),
    // Never logged; its credit note (recorded before invoices named their customer) is Acme's.
    contract("e2", "c1", "Audit", { dailyRate: 600, defaultDaysPerMonth: 5 }),
    // Beta: a quarter logged on one contract and a retainer first logged late in August, invoiced
    // on the client: August's two invoices cover both contracts and run €8,000 ahead.
    contract("e3", "c2", "Quarterly"),
    contract("e4", "c2", "Retainer"),
    // Delta: 20 days from July at 5 a month, so the plan runs out in October.
    contract("e5", "c4", "Graph", { dailyRate: 520, contractedDays: 20, defaultDaysPerMonth: 5, startMonth: "2026-07" }),
    contract("e6", "c5", "Pilot", { isActive: false, endMonth: "2026-06" }),
    // Foxtrot: €75/h for 100 h, 40 h a month, stored as €600/day for 12.5 days, 5 a month.
    contract("e7", "c6", "Support", { unit: "hour", dailyRate: 600, contractedDays: 12.5, defaultDaysPerMonth: 5, startMonth: "2026-09" }),
    // Golf: 10 days plus two fractional amendments (0.1 + 0.2 sums to 0.30000000000000004), 1 day worked.
    contract("e8", "c7", "Retainer", {
      contractedDays: 10, defaultDaysPerMonth: 5, startMonth: "2026-09",
      amendments: [
        { from: "2026-09", dailyRate: null, addedDays: 0.1, lastDay: null, lastDayBefore: null, note: null },
        { from: "2026-10", dailyRate: null, addedDays: 0.2, lastDay: null, lastDayBefore: null, note: null },
      ],
    }),
    // Worked past the budget: Hotel 13 of 10 days, India 103 of 100 h, Juliet exactly 100 of 100 h.
    contract("e9", "c8", "Overrun", { contractedDays: 10, defaultDaysPerMonth: 5, startMonth: "2026-09" }),
    contract("e10", "c9", "Support", { unit: "hour", dailyRate: 600, contractedDays: 12.5, defaultDaysPerMonth: 5, startMonth: "2026-09" }),
    contract("e11", "c10", "Support", { unit: "hour", dailyRate: 600, contractedDays: 12.5, defaultDaysPerMonth: 5, startMonth: "2026-09" }),
    // Kilo: Golf's amendments (10 + 0.1 + 0.2 = 10.299999999999999), 82.4 h = 10.3 days worked, a float residue short of the total.
    contract("e12", "c11", "Retainer", {
      contractedDays: 10, defaultDaysPerMonth: 5, startMonth: "2026-09",
      amendments: [
        { from: "2026-09", dailyRate: null, addedDays: 0.1, lastDay: null, lastDayBefore: null, note: null },
        { from: "2026-10", dailyRate: null, addedDays: 0.2, lastDay: null, lastDayBefore: null, note: null },
      ],
    }),
    // Lima: two contracts planning 0.1 and 0.2 days in September (0.1 + 0.2 is 0.30000000000000004).
    // Mike: over budget (13 of 12 days) with a refill dated after the month it would have run out.
    contract("e15", "c13", "Refill", {
      contractedDays: 10,
      defaultDaysPerMonth: 5,
      startMonth: "2026-09",
      amendments: [{ from: "2026-12", dailyRate: null, addedDays: 2, lastDay: null, lastDayBefore: null, note: null }],
    }),
    contract("e13", "c12", "Alpha", { contractedDays: 10, defaultDaysPerMonth: 0.1, startMonth: "2026-09" }),
    contract("e14", "c12", "Beta", { contractedDays: 10, defaultDaysPerMonth: 0.2, startMonth: "2026-09" }),
  ],
  getTimecards: [
    hours("e1", "2026-08-10", 16),
    // Scheduled after today (15 Sep): it counts from its day on, never as logged in September.
    hours("e1", "2026-09-16", 8),
    ...["2026-06-15", "2026-07-15", "2026-08-15"].map((date) => hours("e3", date, 80)),
    hours("e4", "2026-08-25", 32),
    hours("e5", "2026-07-10", 40),
    hours("e5", "2026-08-10", 40),
    hours("e5", "2026-09-10", 16),
    hours("e7", "2026-09-10", 3),
    hours("e8", "2026-09-10", 8),
    hours("e9", "2026-09-10", 104),
    hours("e15", "2026-09-10", 104),
    hours("e10", "2026-09-10", 103),
    hours("e11", "2026-09-10", 100),
    hours("e12", "2026-09-10", 82.4),
  ],
  getInvoices: [
    invoice({ id: "i1", engagementId: "e2", number: "NC 1/2026", yearMonth: "2026-08", amount: -500, vat: -110 }),
    invoice({ id: "i2", clientId: "c2", number: "16/2026", yearMonth: "2026-08", amount: 15000, vat: 3300 }),
    invoice({ id: "i3", clientId: "c2", number: "17/2026", yearMonth: "2026-08", amount: 10000, vat: 2200 }),
    // Delta's July, unpaid past its due date; August is still to invoice.
    invoice({ id: "i5", clientId: "c4", number: "7/2026", yearMonth: "2026-07", amount: 2600, vat: 572, dueDate: new Date(2026, 7, 31) }),
  ],
  getTasks: [
    {
      id: "t1", userId: "u1", clientId: "c4", engagementId: "e5", title: "Load store hierarchy", dueDate: new Date(2026, 8, 10),
      notes: null, isDone: false, startedAt: null, labels: ["data", "graph"], createdAt: at, updatedAt: at,
    },
    {
      id: "t2", userId: "u1", clientId: "c4", engagementId: null, title: "Kickoff call", dueDate: null,
      notes: null, isDone: true, startedAt: null, labels: [], createdAt: at, updatedAt: at,
    },
  ],
  getMeetings: [
    {
      id: "m2", userId: "u1", clientId: "c4", engagementId: null, date: "2026-08-25", time: null, health: "yellow",
      text: "Duplicate SKUs", createdAt: at, updatedAt: at,
    },
    {
      id: "m1", userId: "u1", clientId: "c4", engagementId: "e5", date: "2026-09-09", time: "10:00", health: "green",
      text: "Weekly status: graph load on track\nStore hierarchy imported.", createdAt: at, updatedAt: at,
    },
  ],
  getOpportunities: [
    {
      id: "o1", userId: "u1", clientId: "c4", title: "Store Analytics Phase 2", stage: "negotiation", probability: 70,
      dailyRate: 540, estimatedDaysPerMonth: 10, estimatedDurationMonths: 6, expectedStartMonth: "2026-12", vatApplicable: true,
      nextActionDate: new Date(2026, 8, 22), nextActionNote: "agree on rate with procurement", notes: null, lostReason: null,
      closedAt: null, engagementId: null, createdAt: at, updatedAt: at,
    },
    {
      id: "o2", userId: "u1", clientId: "c4", title: "Graph", stage: "won", probability: 100, dailyRate: 520,
      estimatedDaysPerMonth: 5, estimatedDurationMonths: 4, expectedStartMonth: "2026-07", vatApplicable: true,
      nextActionDate: null, nextActionNote: null, notes: null, lostReason: null, closedAt: new Date(2026, 5, 20),
      engagementId: "e5", createdAt: at, updatedAt: at,
    },
  ],
  getSolutions: [
    solution({ id: "s1", clientId: "c4", engagementId: "e5", name: "Product knowledge graph", status: "delivered", domain: "retail" }),
  ],
}
// Papa: more than six of everything, for the summaries' cap. Meetings, deals and solutions are numbered 1..8.
const MANY = Array.from({ length: 8 }, (_, i) => i + 1)
const push = (key: string, ...rows: unknown[]) => (DATA[key] as unknown[]).push(...rows)
push("getClients", client("c14", "Papa"))
push("getEngagements", contract("e20", "c14", "Live"), ...[1, 2, 3].map((n) => contract(`e2${n}`, "c14", `Old ${n}`, { isActive: false, endMonth: "2026-06" })))
push(
  "getMeetings",
  ...MANY.map((n) => ({
    id: `pm${n}`, userId: "u1", clientId: "c14", engagementId: null, date: `2026-07-0${n}`, time: null, health: null,
    text: `Call ${n}`, createdAt: at, updatedAt: at,
  })),
)
// Deals 1-3 are open, 4-8 lost: six show, the open ones first.
push(
  "getOpportunities",
  ...MANY.map((n) => ({
    id: `po${n}`, userId: "u1", clientId: "c14", title: `Deal ${n}`, stage: n <= 3 ? "proposal" : "lost", probability: n <= 3 ? 40 : 0,
    dailyRate: 500, estimatedDaysPerMonth: 5, estimatedDurationMonths: 3, expectedStartMonth: null, vatApplicable: true,
    nextActionDate: null, nextActionNote: null, notes: null, lostReason: null, closedAt: n <= 3 ? null : new Date(2026, 5, n),
    engagementId: null, createdAt: at, updatedAt: at,
  })),
)
push("getSolutions", ...MANY.map((n) => solution({ id: `ps${n}`, clientId: "c14", name: `Solution ${n}`, updatedAt: new Date(2026, 0, n) })))
// Quebec: exactly six of everything, so no control appears. Romeo: its one contract has closed.
const SIX = [1, 2, 3, 4, 5, 6]
push("getClients", client("c15", "Quebec"), client("c16", "Romeo"))
push("getEngagements", contract("e30", "c16", "Gone", { isActive: false, endMonth: "2026-06" }))
push(
  "getMeetings",
  ...SIX.map((n) => ({
    id: `qm${n}`, userId: "u1", clientId: "c15", engagementId: null, date: `2026-07-0${n}`, time: null, health: null,
    text: `Call ${n}`, createdAt: at, updatedAt: at,
  })),
)
push(
  "getOpportunities",
  ...SIX.map((n) => ({
    id: `qo${n}`, userId: "u1", clientId: "c15", title: `Deal ${n}`, stage: "proposal", probability: 40,
    dailyRate: 500, estimatedDaysPerMonth: 5, estimatedDurationMonths: 3, expectedStartMonth: null, vatApplicable: true,
    nextActionDate: null, nextActionNote: null, notes: null, lostReason: null, closedAt: null,
    engagementId: null, createdAt: at, updatedAt: at,
  })),
)
push("getSolutions", ...SIX.map((n) => solution({ id: `qs${n}`, clientId: "c15", name: `Solution ${n}` })))

const writes = vi.hoisted(() => ({ createInvoice: vi.fn(), updateTask: vi.fn() }))

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy(
      {},
      {
        get: (_db, method) =>
          method in writes
            ? writes[method as keyof typeof writes]
            : () => Promise.resolve(DATA[String(method)] ?? (String(method).endsWith("Settings") ? null : [])),
      },
    ),
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

// Date only: fake timers would stall TanStack and findBy.
beforeAll(() => vi.setSystemTime(new Date(2026, 8, 15)))
afterAll(() => vi.useRealTimers())
afterEach(() => off.clear())
beforeEach(() => {
  writes.createInvoice.mockReset().mockResolvedValue({ id: "new1" })
  writes.updateTask.mockReset().mockResolvedValue(undefined)
})

async function renderPage(clientId: string, name: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ClientPage clientId={clientId} />
    </QueryClientProvider>,
  )
  await screen.findByRole("heading", { name, level: 1 })
}

const card = (id: string) => document.getElementById(id) as HTMLElement
const monthRow = (label: string) =>
  within(card("billing"))
    .getAllByRole("row")
    .find((r) => within(r).queryAllByText(label).length > 0) as HTMLElement
/** A figure's value: its label's next sibling (StatCard). */
const figure = (label: string) => within(screen.getByRole("region", { name: "Summary" })).getByText(label).nextElementSibling

describe("ClientPage billing", () => {
  it("shows what the logged hours leave to invoice, in the figures, the Ready card and the month", async () => {
    await renderPage("c1", "Acme")
    expect(figure("Next invoice")).toHaveTextContent("€1,500.00")
    expect(figure("Next invoice")?.nextElementSibling).toHaveTextContent("Aug 2026 · 16 h · ready now")
    expect(figure("Billed in 2026")).toHaveTextContent("-€500.00")
    expect(figure("Unpaid")).toHaveTextContent("€0.00")
    expect(figure("Days left on contracts")).toHaveTextContent("—")
    expect(card("ready")).toHaveTextContent("Ready to invoice€1,500.00Aug 2026 · 16 h · + VAT €330.00")
    // Aligned columns: the month, its hours, their value, what was invoiced, one status.
    const august = monthRow("Aug 2026")
    expect(within(august).getByRole("rowheader")).toHaveTextContent("Aug 202616 h · €1,000.00 worked · -€500.00 invoiced")
    expect(within(august).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "16 h",
      "€1,000.00",
      "-€500.00",
      "€1,500.00 to invoiceNC 1/2026",
    ])
    expect(within(card("billing")).getByRole("row", { name: /^Since August/ })).toHaveTextContent(
      "Since August16 h€1,000.00-€500.00€1,500.00 still to invoice",
    )
    // A contract has no balance of its own: Audit, never logged, is a card with its plan.
    const audit = screen.getByRole("article", { name: "Audit" })
    expect(audit).toHaveTextContent("September in progress: 0 h · 0 d of 5 d planned")
    expect(audit).not.toHaveTextContent(/To invoice|invoiced|No hours logged/i)
  })

  it("scrolls to #invoices once the sections replace the spinner (the Clients card's link)", async () => {
    const scrolled: string[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    window.location.hash = "#invoices"
    try {
      await renderPage("c1", "Acme")
      await waitFor(() => expect(scrolled).toEqual(["invoices"]))
    } finally {
      window.location.hash = ""
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it("says so when the client does not exist", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ClientPage clientId="nope" />
      </QueryClientProvider>,
    )
    await screen.findByText("Client not found.")
  })

  it("labels a month netted negative by a credit note and draws it no bar", async () => {
    await renderPage("c1", "Acme")
    const august = screen.getByRole("img", { name: "Aug 2026: -€500.00" })
    expect(within(august).getByText("-€500")).toBeInTheDocument()
    expect(august.querySelector("div")).toBeNull()
    // Six months, as drawn on the client's Billing card.
    expect(screen.getAllByRole("img", { name: /^\w{3} \d{4}: / })).toHaveLength(6)
  })

  it("records the Ready line in two clicks: its months, net, VAT and the next number filled in", async () => {
    await renderPage("c1", "Acme")
    fireEvent.click(within(card("billing")).getByRole("button", { name: "Create Invoice" }))
    const sheet = await screen.findByRole("dialog", { name: "Record Invoice" })
    expect(within(sheet).getByLabelText("Invoice number")).toHaveValue("18/2026")
    expect(within(sheet).getByLabelText("Net amount")).toHaveValue(1500)
    expect(within(sheet).getByLabelText("VAT")).toHaveValue(330)
    expect(within(sheet).getByLabelText("Invoice number")).toHaveFocus()

    fireEvent.click(within(sheet).getByRole("button", { name: "Record Invoice" }))
    await waitFor(() =>
      expect(writes.createInvoice).toHaveBeenCalledWith("u1", {
        clientId: "c1", number: "18/2026", fromMonth: null, yearMonth: "2026-08", amount: 1500, vat: 330,
        dueDate: null, paidDate: null,
      }),
    )
  })

  it("nets the client's invoices against all its contracts; a month's number opens it with their lines", async () => {
    await renderPage("c2", "Beta")
    // Ahead of the hours: the card turns to the month being worked, and Create Invoice.
    expect(card("ready")).toHaveTextContent("Ready to invoice this month€0.00September 2026 · 0 h · 0 of 20 planned days")
    expect(card("ready")).toHaveTextContent(
      "Invoiced €8,000.00 more than the hours, usually an invoice in advance. At plan September closes at €10,000.00 on 30 Sep.",
    )
    expect(within(card("ready")).getByRole("button", { name: "Create Invoice" })).toBeInTheDocument()
    // Retainer's late start is not the client's first month, so it is money ahead, not unlogged days.
    expect(screen.queryByText("Started mid-month")).toBeNull()
    expect(within(monthRow("Jun 2026")).getByText("Invoiced")).toBeInTheDocument()
    expect(within(monthRow("Aug 2026")).getByText("€18,000.00 more than the hours")).toBeInTheDocument()
    expect(within(card("billing")).queryByText(/to invoice$/)).toBeNull()
    // The month being worked's Create Invoice only: no ended month's beside it.
    expect(within(card("billing")).getAllByRole("button", { name: "Create Invoice" })).toHaveLength(1)

    fireEvent.click(within(monthRow("Aug 2026")).getByRole("button", { name: "16/2026" }))
    const sheet = await screen.findByRole("dialog", { name: "Invoice 16/2026" })
    expect(within(sheet).getByTitle("Quarterly").parentElement).toHaveTextContent("Quarterly 80 h · €5,000.00")
    expect(within(sheet).getByTitle("Retainer").parentElement).toHaveTextContent("Retainer 32 h · €2,000.00")
  })
})

describe("ClientPage", () => {
  it("heads the page with who they are, a line on where things stand, and four figures", async () => {
    await renderPage("c4", "Delta")
    expect(screen.getByRole("link", { name: "Back to Clients" })).toHaveAttribute("href", "/clients")
    expect(screen.getByText("Client since Jun 2026").previousElementSibling).toHaveTextContent(/^Active$/)
    expect(screen.getByRole("link", { name: "procurement@delta.example" })).toHaveAttribute("href", "mailto:procurement@delta.example")
    expect(screen.getByRole("link", { name: "+39 02 5550 1180" })).toHaveAttribute("href", "tel:+390255501180")
    expect(screen.getByText("IT04821930157")).toHaveClass("font-mono")
    expect(screen.getByText("Retail chain, 140 stores.")).toBeInTheDocument()
    expect(screen.getByText("1 active contract").parentElement).toHaveTextContent("1 active contract · €2,600.00 a month at plan")
    expect(screen.getByText(/^1 invoice unpaid, 1 overdue/)).toHaveTextContent("1 invoice unpaid, 1 overdue · See Invoices")
    expect(screen.getByText(/^Last meeting/)).toHaveTextContent("Last meeting green · 9 Sep")

    expect(figure("Billed in 2026")).toHaveTextContent("€2,600.00")
    expect(figure("Billed in 2026")?.nextElementSibling).toHaveTextContent("net · 1 invoice, Jul")
    expect(figure("Unpaid")).toHaveTextContent("€3,172.00")
    expect(within(figure("Unpaid")!.parentElement!).getByRole("link", { name: "1 overdue" })).toHaveAttribute("href", "#invoices")
    expect(figure("Days left on contracts")).toHaveTextContent("8 days")
    expect(figure("Days left on contracts")?.nextElementSibling).toHaveTextContent("of 20 · runs out Oct 2026")
    expect(figure("Next invoice")).toHaveTextContent("€2,600.00")
  })

  it("tells an hourly contract in its own unit: 3 h of 100 h, and the month at €225", async () => {
    await renderPage("c6", "Foxtrot")
    const graph = within(card("contracts")).getByRole("article", { name: "Support" })
    expect(within(graph).getByText(/^40 hours\/month ×/)).toHaveTextContent("40 hours/month × €75/h · 100 hours · runs out Nov 2026")
    expect(graph).toHaveTextContent("3 h of 100 h used · 3%")
    expect(graph).toHaveTextContent("97 hours left at plan")
    expect(within(graph).getByRole("img")).toHaveAccessibleName(/^Contract hours by month\. Used: September 3 of 40 so far\./)
    expect(figure("Hours left on contracts")).toHaveTextContent("97 hours")
    // 3 h × €75 = €225. 3 h is 0.375 d: rounded to hundredths first it read 3.04 h used, 96.96 h left.
    expect(figure("Next invoice")).toHaveTextContent("€225.00")
    expect(card("billing")).toHaveTextContent("September 2026 · 3 h · 3 of 40 planned hours")
  })

  it("prints a day contract's total rounded once, however many fractional amendments add up", async () => {
    await renderPage("c7", "Golf")
    const graph = within(card("contracts")).getByRole("article", { name: "Retainer" })
    expect(graph).toHaveTextContent("1 of 10.3 days used · 10%")
    expect(within(graph).getByRole("img")).toHaveAccessibleName(/The 10\.3 days run out/)
  })

  it.each([
    ["c8", "Hotel", "Overrun", "3 days over budget"],
    ["c9", "India", "Support", "3 hours over budget"],
  ])("tells %s a contract worked past its budget: %s", async (id, name, contractName, line) => {
    await renderPage(id, name)
    const graph = within(card("contracts")).getByRole("article", { name: contractName })
    const over = within(graph).getByText(new RegExp(`^${line}`))
    expect(over).toHaveClass("font-medium", "text-danger")
    expect(graph).not.toHaveTextContent("left at plan")
  })

  it("says no month the days run out once the budget is spent, anywhere on the page", async () => {
    await renderPage("c8", "Hotel")
    const graph = within(card("contracts")).getByRole("article", { name: "Overrun" })
    expect(graph).not.toHaveTextContent(/runs? out|ran out/)
    expect(within(graph).getByRole("img")).not.toHaveAccessibleName(/run out|ran out/)
    expect(figure("Days left on contracts")?.nextElementSibling).toHaveTextContent(/^of 10$/)
  })

  it("keeps saying when the days run out while budget is left", async () => {
    await renderPage("c4", "Delta")
    const graph = within(card("contracts")).getByRole("article", { name: "Graph" })
    expect(graph).toHaveTextContent(/runs out Oct 2026/)
    expect(within(graph).getByRole("img")).toHaveAccessibleName(/The 20 days run out in October 2026\./)
  })

  it("still lists the refills of an over-budget contract", async () => {
    await renderPage("c13", "Mike")
    const graph = within(card("contracts")).getByRole("article", { name: "Refill" })
    expect(graph).toHaveTextContent("over budget")
    expect(graph).not.toHaveTextContent(/runs? out|ran out/)
    expect(graph).toHaveTextContent("+2 days from Dec 2026")
  })

  it("rounds the planned days of the month once", async () => {
    await renderPage("c12", "Lima")
    expect(card("ready")).toHaveTextContent("0 of 0.3 planned days")
  })

  it("at exactly the budget the contract still has 0 hours left at plan", async () => {
    await renderPage("c10", "Juliet")
    const graph = within(card("contracts")).getByRole("article", { name: "Support" })
    expect(graph).toHaveTextContent("0 hours left at plan")
    expect(graph).not.toHaveTextContent("over budget")
  })

  it("does not call a float residue an overrun", async () => {
    await renderPage("c11", "Kilo")
    const graph = within(card("contracts")).getByRole("article", { name: "Retainer" })
    expect(graph).toHaveTextContent("10.3 of 10.3 days used")
    expect(graph).toHaveTextContent("0 days left at plan")
    expect(graph).not.toHaveTextContent("over budget")
  })

  it("calls a client whose contracts have all closed a prospect, as its card in the catalog does", async () => {
    await renderPage("c5", "Echo")
    expect(screen.getByText("Client since Sep 2026").previousElementSibling).toHaveTextContent(/^Prospect$/)
  })

  it("indexes its sections in the board's order, the counts outside the links' names", async () => {
    await renderPage("c4", "Delta")
    const index = screen.getByRole("navigation", { name: "Sections" })
    expect(within(index).getAllByRole("link").map((l) => [l.getAttribute("href"), l.textContent])).toEqual([
      ["#contracts", "Contracts1"],
      ["#billing", "BillingSep"],
      ["#invoices", "Invoices1"],
      ["#tasks", "Tasks1"],
      ["#meetings", "Meetings2"],
      ["#opportunities", "Opportunities2"],
      ["#solutions", "Solutions1"],
    ])
    expect(within(index).getByRole("link", { name: "Meetings" })).toBeInTheDocument()
    for (const id of ["contracts", "billing", "invoices", "tasks", "meetings", "opportunities", "solutions"]) {
      expect(card(id).tagName).toBe("SECTION")
    }
  })

  it("draws a capped contract's days, used and planned, with its light and its actions", async () => {
    await renderPage("c4", "Delta")
    const graph = within(card("contracts")).getByRole("article", { name: "Graph" })
    expect(within(graph).getByText(/^5 days\/month × €520/)).toHaveTextContent(/^5 days\/month × €520 · 20 days · runs out Oct 2026$/)
    expect(within(graph).getByTitle("Status from the meeting on 9 Sep 2026")).toHaveTextContent("Green · 9 Sep")
    expect(graph).toHaveTextContent("12 of 20 days used · 60%")
    expect(graph).toHaveTextContent("8 days left at plan · runs out Oct 2026")
    expect(within(graph).getByRole("img")).toHaveAccessibleName(
      "Contract days by month. Used: July 5, August 5, September 2 of 5 so far. Planned: October 5. The 20 days run out in October 2026.",
    )
    expect(within(graph).getByRole("link", { name: "Log Time" })).toHaveAttribute("href", "/plan")
    expect(within(graph).getByRole("button", { name: "Amend Contract" })).toBeInTheDocument()
    expect(within(graph).getByRole("button", { name: "More actions for Graph" })).toBeInTheDocument()
  })

  it("lists open tasks as a checklist, done ones behind a toggle", async () => {
    await renderPage("c4", "Delta")
    const tasks = card("tasks")
    expect(within(tasks).getByText("1 open · 1 done")).toBeInTheDocument()
    const row = within(tasks).getAllByRole("listitem")
    expect(row).toHaveLength(1)
    expect(row[0]).toHaveTextContent("Load store hierarchydatagraphGraphOverdue · 10 SepTo do")
    expect(within(tasks).queryByText("Kickoff call")).toBeNull()

    fireEvent.click(within(tasks).getByRole("button", { name: "Show Done Tasks (1)" }))
    expect(within(tasks).getByRole("checkbox", { name: "Reopen task: Kickoff call" })).toBeChecked()
    fireEvent.click(within(tasks).getByRole("checkbox", { name: "Complete task: Load store hierarchy" }))
    await waitFor(() => expect(writes.updateTask).toHaveBeenCalledWith("u1", "t1", { isDone: true }))
  })

  it("keeps the meetings as a timeline, newest first, each with its light and Edit", async () => {
    await renderPage("c4", "Delta")
    const items = within(card("meetings")).getAllByRole("listitem")
    expect(items.map((i) => i.textContent)).toEqual([
      "2026-09-09 10:00Weekly status: graph load on trackGreenStore hierarchy imported.Graph",
      "2026-08-25Duplicate SKUsYellowAbout the client",
    ])
    fireEvent.click(within(items[1]).getByRole("button", { name: "Edit meeting of 25 Aug" }))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })

  it("shows its deals, open and won, and the solutions built for it", async () => {
    await renderPage("c4", "Delta")
    const open = screen.getByRole("article", { name: "Store Analytics Phase 2" })
    expect(open).toHaveTextContent("Starts Dec 2026 · 6 months")
    expect(open).toHaveTextContent("Next: agree on rate with procurement · 22 Sep")
    expect(open).toHaveTextContent("€3,780.00/month weighted")
    expect(open).toHaveTextContent("€540/day × 10 days/month = €5,400.00 × 70% · €32,400.00 over 6 months")
    const won = within(card("opportunities")).getByRole("article", { name: "Graph" })
    expect(won).toHaveTextContent("Closed 20 Jun 2026")
    // The title leads to the Pipeline; "Became the contract" to the contract above.
    expect(within(won).getAllByRole("link", { name: "Graph" }).map((l) => l.getAttribute("href"))).toEqual([
      "/pipeline?client=c4&stage=closed",
      "#contracts",
    ])
    const built = within(card("solutions")).getByRole("article", { name: "Product knowledge graph" })
    expect(built).toHaveTextContent("retail")
    expect(within(built).getByRole("heading", { level: 3 })).toHaveTextContent("Product knowledge graph")
  })

  it("asks before deleting the client, counting out what goes with it", async () => {
    await renderPage("c4", "Delta")
    const more = screen.getByRole("button", { name: "More actions" })
    more.focus()
    fireEvent.keyDown(more, { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Client" }))
    const confirm = await screen.findByRole("alertdialog", { name: "Delete Client" })
    expect(confirm).toHaveTextContent(
      '"Delta" is deleted along with 1 contract, 2 opportunities, 2 tasks, 2 meetings, 1 invoice, and 1 solution, plus the contract allocations.',
    )
  })
})

describe("ClientPage summaries", () => {
  const titles = (id: string) => within(card(id)).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)

  it("shows the six latest meetings and unfolds the older ones inline", async () => {
    await renderPage("c14", "Papa")
    const meetings = card("meetings")
    expect(within(meetings).getAllByRole("listitem")).toHaveLength(6)
    expect(within(meetings).queryByText("Call 2")).toBeNull()
    fireEvent.click(within(meetings).getByRole("button", { name: "Show 2 Older Meetings" }))
    expect(within(meetings).getAllByRole("listitem")).toHaveLength(8)
    expect(within(meetings).queryByRole("button", { name: /Older Meetings/ })).toBeNull()
  })

  it("shows six deals, open first, and links to the Pipeline filtered by the client", async () => {
    await renderPage("c14", "Papa")
    expect(titles("opportunities")).toEqual(["Deal 1", "Deal 2", "Deal 3", "Deal 8", "Deal 7", "Deal 6"])
    expect(within(card("opportunities")).getByRole("link", { name: "View All opportunities" })).toHaveAttribute("href", "/pipeline?client=c14")
  })

  it("shows six solutions and links to the Solutions page filtered by the client", async () => {
    await renderPage("c14", "Papa")
    // The most recently updated, as the Solutions page lists them: not the first six stored.
    expect(titles("solutions")).toEqual(["Solution 8", "Solution 7", "Solution 6", "Solution 5", "Solution 4", "Solution 3"])
    expect(within(card("solutions")).getByRole("link", { name: "View All solutions" })).toHaveAttribute("href", "/solutions?client=c14")
  })

  it("keeps active contracts and folds the closed ones behind a toggle", async () => {
    await renderPage("c14", "Papa")
    const contracts = card("contracts")
    expect(within(contracts).getAllByRole("article")).toHaveLength(1)
    fireEvent.click(within(contracts).getByRole("button", { name: "Show 3 Closed Contracts" }))
    expect(within(contracts).getAllByRole("article")).toHaveLength(4)
  })

  it.each([
    ["c4", "Delta"],
    ["c15", "Quebec"],
  ])("adds no control to %s (%s), with six items or fewer", async (id, name) => {
    await renderPage(id, name)
    expect(screen.queryByRole("link", { name: /View All/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Older Meetings|Closed Contracts/ })).toBeNull()
  })

  it("says there are no active contracts when every one has closed, above the toggle", async () => {
    await renderPage("c16", "Romeo")
    const contracts = card("contracts")
    expect(within(contracts).queryByRole("article")).toBeNull()
    expect(within(contracts).getByText("No active contracts.")).toBeInTheDocument()
    fireEvent.click(within(contracts).getByRole("button", { name: "Show 1 Closed Contract" }))
    expect(within(contracts).getAllByRole("article")).toHaveLength(1)
    expect(within(contracts).queryByText("No active contracts.")).toBeNull()
  })
})

describe("ClientPage with a collaborator on a contract", () => {
  // Delta's Graph: €520/day, 5 days a month. Giulia is on it from July at €300 a day, 2 days a month.
  // July: 5 days of the owner's hours and 2 of hers (16 h each day count: 56 h in all). August: 5. September, the
  // current month, uses the plan: 5 days billed, 2 of them hers.
  const added = { assignments: DATA.getAssignments, collaborators: DATA.getCollaborators, timecards: DATA.getTimecards }
  beforeAll(() => {
    DATA.getCollaborators = [{ id: "g", userId: "u1", name: "Giulia Neri", type: "freelancer", notes: null, isActive: true, fee: null, createdAt: at, updatedAt: at }]
    DATA.getAssignments = [
      { id: "a1", userId: "u1", collaboratorId: "g", engagementId: "e5", dailyRate: 300, from: "2026-07", until: null, defaultDays: 2, monthDays: {}, createdAt: at, updatedAt: at },
    ]
    DATA.getTimecards = [...(DATA.getTimecards as unknown[]), { ...hours("e5", "2026-07-11", 16), id: "e5_2026-07-11_g", collaboratorId: "g" }]
  })
  afterAll(() => {
    DATA.getAssignments = added.assignments
    DATA.getCollaborators = added.collaborators
    DATA.getTimecards = added.timecards
  })

  it("shows the contract's quarter: months logged then planned, her days and cost, the margin, and who used what", async () => {
    await renderPage("c4", "Delta")
    const contract = within(card("contracts")).getByRole("article")
    const table = within(contract).getByRole("table", { name: "Margin, Q3 2026" })
    const rows = within(table).getAllByRole("row").slice(1).map((r) => [...r.children].map((c) => c.textContent))
    expect(rows).toEqual([
      ["July 2026 · logged", "7", "€3,640", "2 d", "€600", "€3,040 · 84%"],
      ["August 2026 · logged", "5", "€2,600", "0 d", "€0", "€2,600 · 100%"],
      ["September 2026", "5", "€2,600", "2 d", "€600", "€2,000 · 77%"],
      ["Q3 2026", "17", "€8,840", "4 d", "€1,200", "€7,640 · 86%"],
    ])
    expect(within(table).getByRole("columnheader", { name: "Giulia Neri" })).toBeInTheDocument()
    expect(contract).toHaveTextContent("Used 14: you 12, Giulia Neri 2")
    expect(within(contract).getByText("Q3 margin 86%")).toBeInTheDocument()
  })

  it("rolls the margin up on the client's line", async () => {
    await renderPage("c4", "Delta")
    expect(screen.getByText("Q3 margin 86%", { selector: "span.font-medium" }).parentElement).toHaveTextContent(
      "Q3 margin 86% · €7,640.00 on €8,840.00 billed",
    )
  })

  it("shows no margin on a client with nobody assigned", async () => {
    await renderPage("c1", "Acme")
    expect(screen.queryByText(/margin/i)).toBeNull()
  })
})

describe("ClientPage margin with the collaborators out of the simple case", () => {
  const added = { assignments: DATA.getAssignments, collaborators: DATA.getCollaborators, timecards: DATA.getTimecards }
  const giulia = (isActive: boolean) => ({ id: "g", userId: "u1", name: "Giulia Neri", type: "freelancer", notes: null, isActive, fee: null, createdAt: at, updatedAt: at })
  const assignment = (engagementId: string, dailyRate: number) => ({
    id: `a-${engagementId}`, userId: "u1", collaboratorId: "g", engagementId, dailyRate, from: "2026-07", until: null, defaultDays: 2, monthDays: {}, createdAt: at, updatedAt: at,
  })
  const log = (engagementId: string, date: string, h: number) => ({ ...hours(engagementId, date, h), id: `${engagementId}_${date}_g`, collaboratorId: "g" })
  afterEach(() => {
    DATA.getAssignments = added.assignments
    DATA.getCollaborators = added.collaborators
    DATA.getTimecards = added.timecards
  })

  it("an inactive collaborator's logged days still cost in a month that has ended, and she is named in Used", async () => {
    DATA.getCollaborators = [giulia(false)]
    DATA.getAssignments = [assignment("e5", 300)]
    DATA.getTimecards = [...(added.timecards as unknown[]), log("e5", "2026-07-11", 16)]
    await renderPage("c4", "Delta")
    const contract = within(card("contracts")).getByRole("article")
    const table = within(contract).getByRole("table", { name: "Margin, Q3 2026" })
    const rows = within(table).getAllByRole("row").slice(1).map((r) => [...r.children].map((c) => c.textContent))
    expect(rows[0]).toEqual(["July 2026 · logged", "7", "€3,640", "2 d", "€600", "€3,040 · 84%"])
    expect(rows[2]).toEqual(["September 2026", "5", "€2,600", "0 d", "€0", "€2,600 · 100%"])
    expect(contract).toHaveTextContent("Used 14: you 12, Giulia Neri 2")
  })

  it("the client's line rolls up every contract: one with nobody on it adds its revenue", async () => {
    DATA.getCollaborators = [giulia(true)]
    DATA.getAssignments = [assignment("e3", 300)]
    DATA.getTimecards = [...(added.timecards as unknown[]), log("e3", "2026-07-11", 16)]
    await renderPage("c2", "Beta")
    // Quarterly (the one with Giulia) makes €16,000 and €14,800 margin; Retainer, with nobody on it, adds €7,000 of both.
    expect(screen.getByText("Q3 margin 95%", { selector: "span.font-medium" }).parentElement).toHaveTextContent(
      "Q3 margin 95% · €21,800.00 on €23,000.00 billed",
    )
    expect(within(card("contracts")).getAllByRole("table", { name: "Margin, Q3 2026" })).toHaveLength(1)
  })

  it("an hourly contract reads in hours: the column head, her column and the Used line", async () => {
    DATA.getCollaborators = [giulia(true)]
    DATA.getAssignments = [assignment("e7", 400)]
    await renderPage("c6", "Foxtrot")
    const contract = within(card("contracts")).getByRole("article")
    const table = within(contract).getByRole("table", { name: "Margin, Q3 2026" })
    expect(within(table).getByRole("columnheader", { name: "Hours billed" })).toBeInTheDocument()
    expect(within(table).getAllByRole("row").slice(1).map((r) => [...r.children].map((c) => c.textContent))).toEqual([
      ["July 2026 · logged", "0", "€0", "0 h", "€0", "€0 · —"],
      ["August 2026 · logged", "0", "€0", "0 h", "€0", "€0 · —"],
      ["September 2026", "40", "€3,000", "16 h", "€800", "€2,200 · 73%"],
      ["Q3 2026", "40", "€3,000", "16 h", "€800", "€2,200 · 73%"],
    ])
    expect(contract).toHaveTextContent("Used 3: you 3, Giulia Neri 0")
  })
})

describe("ClientPage with modules left out", () => {
  it("without solutions has no Solutions section, index link or New Solution button", async () => {
    off.add("solutions")
    await renderPage("c4", "Delta")
    expect(document.getElementById("solutions")).toBeNull()
    expect(screen.queryByRole("button", { name: /New Solution/ })).toBeNull()
    expect(within(screen.getByRole("navigation", { name: "Sections" })).queryByRole("link", { name: "Solutions" })).toBeNull()
    expect(document.getElementById("contracts")).not.toBeNull()
  })

  it("without invoicing has no Billing or Invoices section, no link to /invoices, no money-owed figures", async () => {
    off.add("invoicing")
    await renderPage("c4", "Delta")
    expect(document.getElementById("billing")).toBeNull()
    expect(document.getElementById("invoices")).toBeNull()
    expect(screen.queryByRole("link", { name: /Invoices/ })).toBeNull()
    expect(within(screen.getByRole("navigation", { name: "Sections" })).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
      "#contracts", "#tasks", "#meetings", "#opportunities", "#solutions",
    ])
    const summary = within(screen.getByRole("region", { name: "Summary" }))
    expect(summary.queryByText("Unpaid")).toBeNull()
    expect(summary.queryByText("Next invoice")).toBeNull()
    expect(summary.queryByText(/^Billed in/)).toBeNull()
    expect(summary.getByText("Days left on contracts")).toBeInTheDocument()
  })
})
