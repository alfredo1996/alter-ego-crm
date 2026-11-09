/**
 * The company's /invoices page (Invoices.dc) over a fixed clock (15 Sep 2026): August is the
 * last closed month. The maths is covered in lib/__tests__/invoices.test.ts, the
 * sheet in invoice-sheet.test.tsx and a client's page in client-page.test.tsx;
 * this checks the page shows the figures, the Ready cards and the invoice table,
 * that a Ready card opens the one sheet, and that the Status tabs (?status=), the
 * search and the Customer filter narrow the table.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { BillingShell } from "../billing-shell"

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

const at = new Date(2026, 8, 1)
const DATA: Record<string, unknown> = {
  getClients: [
    {
      id: "c1", userId: "u1", name: "Acme", vatNumber: null, email: null, contactName: null,
      contactPhone: null, notes: null, isActive: true, createdAt: at, updatedAt: at,
    },
    {
      id: "c2", userId: "u1", name: "Beta", vatNumber: null, email: null, contactName: null,
      contactPhone: null, notes: null, isActive: true, createdAt: at, updatedAt: at,
    },
    // No contract at all, one invoice still owed.
    {
      id: "c3", userId: "u1", name: "Gamma", vatNumber: null, email: null, contactName: null,
      contactPhone: null, notes: null, isActive: true, createdAt: at, updatedAt: at,
    },
  ],
  getEngagements: [
    // €500/day, 16 h logged in August: €1,000, plus Audit's credit note back on the client's balance.
    {
      id: "e1", userId: "u1", clientId: "c1", name: "Platform", opportunityId: null, dailyRate: 500,
      vatApplicable: true, contractedDays: null, defaultDaysPerMonth: 10, startMonth: null,
      endMonth: null, endDate: null, isActive: true, notes: null, createdAt: at, updatedAt: at,
    },
    // Never logged; its credit note (recorded before invoices named their customer) is Acme's.
    {
      id: "e2", userId: "u1", clientId: "c1", name: "Audit", opportunityId: null, dailyRate: 600,
      vatApplicable: true, contractedDays: null, defaultDaysPerMonth: 5, startMonth: null,
      endMonth: null, endDate: null, isActive: true, notes: null, createdAt: at, updatedAt: at,
    },
    // Beta: a quarter logged on one contract and a retainer first logged late in August, invoiced
    // on the client: August's two invoices cover both contracts and run €8,000 ahead.
    {
      id: "e3", userId: "u1", clientId: "c2", name: "Quarterly", opportunityId: null, dailyRate: 500,
      vatApplicable: true, contractedDays: null, defaultDaysPerMonth: 10, startMonth: null,
      endMonth: null, endDate: null, isActive: true, notes: null, createdAt: at, updatedAt: at,
    },
    {
      id: "e4", userId: "u1", clientId: "c2", name: "Retainer", opportunityId: null, dailyRate: 500,
      vatApplicable: true, contractedDays: null, defaultDaysPerMonth: 10, startMonth: null,
      endMonth: null, endDate: null, isActive: true, notes: null, createdAt: at, updatedAt: at,
    },
  ],
  getTimecards: [
    { id: "e1_2026-08-10", userId: "u1", engagementId: "e1", date: "2026-08-10", hours: 16, notes: null, createdAt: at, updatedAt: at },
    // Scheduled after today (15 Sep): it counts from its day on, never as logged in September.
    { id: "e1_2026-09-16", userId: "u1", engagementId: "e1", date: "2026-09-16", hours: 8, notes: null, createdAt: at, updatedAt: at },
    ...["2026-06-15", "2026-07-15", "2026-08-15"].map((date) => (
      { id: `e3_${date}`, userId: "u1", engagementId: "e3", date, hours: 80, notes: null, createdAt: at, updatedAt: at }
    )),
    { id: "e4_2026-08-25", userId: "u1", engagementId: "e4", date: "2026-08-25", hours: 32, notes: null, createdAt: at, updatedAt: at },
  ],
  getInvoices: [
    {
      id: "i1", userId: "u1", engagementId: "e2", number: "NC 1/2026", yearMonth: "2026-08", amount: -500, vat: -110,
      dueDate: null, paidDate: null, createdAt: at, updatedAt: at,
    },
    {
      id: "i2", userId: "u1", clientId: "c2", engagementId: null, number: "16/2026", yearMonth: "2026-08", amount: 15000, vat: 3300,
      dueDate: null, paidDate: null, createdAt: at, updatedAt: at,
    },
    {
      id: "i3", userId: "u1", clientId: "c2", engagementId: null, number: "17/2026", yearMonth: "2026-08", amount: 10000, vat: 2200,
      dueDate: null, paidDate: null, createdAt: at, updatedAt: at,
    },
    {
      id: "i4", userId: "u1", clientId: "c3", engagementId: null, number: "15/2026", yearMonth: "2026-07", amount: 1000, vat: 220,
      dueDate: new Date(2026, 7, 31), paidDate: null, createdAt: at, updatedAt: at,
    },
  ],
}

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy(
      {},
      {
        get: (_db, method) => () => Promise.resolve(DATA[String(method)] ?? []),
      },
    ),
  }),
}))

// Date only: fake timers would stall TanStack and findBy.
beforeAll(() => vi.setSystemTime(new Date(2026, 8, 15)))
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  url.set("")
  replace.mockClear()
})

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BillingShell />
    </QueryClientProvider>,
  )
}

const card = (id: string) => document.getElementById(id) as HTMLElement
/** A figure of the Summary strip: its label's card. */
const figure = (label: string) => within(screen.getByRole("region", { name: "Summary" })).getByText(label).parentElement!
/** The table body's rows, by their number. */
const numbers = () =>
  within(within(card("invoices")).getAllByRole("rowgroup")[1])
    .getAllByRole("row")
    .map((r) => within(r).getAllByRole("button")[0].textContent)

describe("BillingShell for the company", () => {
  it("lists what is ready to invoice and every invoice, with the overdue one a click from its figure", async () => {
    renderShell()
    await screen.findByRole("heading", { name: "Invoices", level: 1 })
    expect(screen.getByRole("button", { name: "Create Invoice" })).toHaveAttribute("aria-haspopup", "dialog")
    expect(figure("To invoice")).toHaveTextContent("€1,500.00")
    expect(figure("To invoice")).toHaveTextContent("net · from hours in ended months · See below")
    expect(within(figure("To invoice")).getByRole("link", { name: "See below" })).toHaveAttribute("href", "#ready")
    expect(figure("Unpaid")).toHaveTextContent("€31,720.00")
    expect(figure("Unpaid")).toHaveTextContent("incl. VAT · 3 invoices")
    // The detail's pill, and a phone's beside the figure (CSS shows one): both open the Overdue tab,
    // whatever tab or customer the table was on.
    const overdue = screen.getAllByRole("link", { name: "1 overdue" })
    expect(overdue).toHaveLength(2)
    for (const link of overdue) expect(link).toHaveAttribute("href", "/invoices?status=overdue#invoices")

    // Beta ran ahead: only Acme's August is ready, and it adds up to the figure.
    expect(card("ready")).toHaveTextContent("Ended months, net · from your logged hours")
    const ready = within(card("ready")).getAllByRole("listitem")
    expect(ready).toHaveLength(1)
    expect(within(ready[0]).getByRole("article", { name: "Acme" })).toHaveTextContent(
      "Acme€1,500.00 + VATAug 2026 · 16 h · Platform",
    )

    // Newest work month first; August's three were recorded together, so they keep their order.
    expect(numbers()).toEqual(["NC 1/2026", "16/2026", "17/2026", "15/2026"])
    const rows = within(within(card("invoices")).getAllByRole("rowgroup")[1]).getAllByRole("row")
    expect(rows[3]).toHaveTextContent("Gamma")
    expect(within(rows[3]).getAllByText("Overdue · due 31 Aug")).not.toHaveLength(0)

    fireEvent.click(within(ready[0]).getByRole("button", { name: "Create Invoice for Acme, August 2026" }))
    const sheet = await screen.findByRole("dialog", { name: "Record Invoice" })
    expect(within(sheet).getByLabelText("Invoice number")).toHaveValue("18/2026")
  })

  it("narrows the invoices by status tab (?status=), search and customer", async () => {
    renderShell()
    await screen.findByRole("heading", { name: "Invoices", level: 1 })
    expect(screen.getByRole("tab", { name: "All 4", selected: true })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Unpaid 4" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Paid 0" })).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Overdue 1" }), { button: 0 })
    expect(replace).toHaveBeenLastCalledWith("/invoices?status=overdue", { scroll: false })
    expect(screen.getByRole("tab", { name: "Overdue 1", selected: true })).toBeInTheDocument()
    expect(numbers()).toEqual(["15/2026"])

    // The search counts in every tab, so the tabs say where the matches are.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search invoices" }), { target: { value: "beta" } })
    expect(screen.getByRole("tab", { name: "All 2" })).toBeInTheDocument()
    expect(card("invoices")).toHaveTextContent("No invoices match these filters.")
    fireEvent.click(screen.getByRole("button", { name: "Show All" }))
    expect(replace).toHaveBeenLastCalledWith("/invoices", { scroll: false })
    expect(screen.getByRole("searchbox", { name: "Search invoices" })).toHaveValue("")
    expect(numbers()).toEqual(["NC 1/2026", "16/2026", "17/2026", "15/2026"])

    // A deep link to a customer: only its invoices, the select saying whose.
    url.set("?customer=c3")
    expect(await screen.findByRole("combobox", { name: "Customer" })).toHaveTextContent("Customer: Gamma")
    expect(numbers()).toEqual(["15/2026"])
  })

  it("offers the month being worked once the ended months are all invoiced", async () => {
    const saved = { ...DATA }
    const timecards = DATA.getTimecards as object[]
    DATA.getTimecards = [
      ...timecards,
      { id: "e1_2026-09-10", userId: "u1", engagementId: "e1", date: "2026-09-10", hours: 8, notes: null, createdAt: at, updatedAt: at },
    ]
    DATA.getInvoices = [
      ...(DATA.getInvoices as object[]),
      {
        id: "i5", userId: "u1", clientId: "c1", engagementId: null, number: "18/2026", yearMonth: "2026-08", amount: 1500,
        vat: 330, dueDate: null, paidDate: null, createdAt: at, updatedAt: at,
      },
    ]
    try {
      renderShell()
      await screen.findByRole("heading", { name: "Invoices", level: 1 })
      expect(figure("To invoice")).toHaveTextContent("€0.00net · ended months are all invoiced")
      expect(figure("Logged in September")).toHaveTextContent("net · 8 h across 1 customer · See below")
      expect(card("ready")).toHaveTextContent("September so far, net · ended months are all invoiced")
      const ready = within(card("ready")).getAllByRole("listitem")
      expect(ready).toHaveLength(1)
      expect(ready[0]).toHaveTextContent("Acme€500.00 + VATSep 2026 · 8 h · Platform")

      fireEvent.click(within(ready[0]).getByRole("button", { name: "Create Invoice for Acme, September 2026" }))
      const sheet = await screen.findByRole("dialog", { name: "Record Invoice" })
      expect(within(sheet).getByRole("combobox", { name: "From" })).toHaveTextContent("Sep 2026")
      expect(within(sheet).getByRole("combobox", { name: "To" })).toHaveTextContent("Sep 2026")
    } finally {
      Object.assign(DATA, saved)
    }
  })

  it("offers no month being worked that an invoice in advance already covers", async () => {
    const saved = { ...DATA }
    DATA.getTimecards = [
      ...(DATA.getTimecards as object[]),
      { id: "e1_2026-09-10", userId: "u1", engagementId: "e1", date: "2026-09-10", hours: 8, notes: null, createdAt: at, updatedAt: at },
    ]
    DATA.getInvoices = [
      ...(DATA.getInvoices as object[]),
      {
        id: "i5", userId: "u1", clientId: "c1", engagementId: null, number: "18/2026", yearMonth: "2026-08", amount: 1500,
        vat: 330, dueDate: null, paidDate: null, createdAt: at, updatedAt: at,
      },
      // September invoiced in advance: €5,000 against the €500 logged so far.
      {
        id: "i6", userId: "u1", clientId: "c1", engagementId: null, number: "19/2026", yearMonth: "2026-09", amount: 5000,
        vat: 1100, dueDate: null, paidDate: null, createdAt: at, updatedAt: at,
      },
    ]
    try {
      renderShell()
      await screen.findByRole("heading", { name: "Invoices", level: 1 })
      expect(figure("Logged in September")).toHaveTextContent("€500.00")
      expect(figure("Logged in September")).not.toHaveTextContent("See below")
      expect(card("ready")).toHaveTextContent("Nothing to invoice: every ended month with hours is invoiced.")
      expect(within(card("ready")).queryByRole("listitem")).toBeNull()
    } finally {
      Object.assign(DATA, saved)
    }
  })

  it("says so in one line when nothing is ready", async () => {
    const saved = { ...DATA }
    DATA.getTimecards = []
    try {
      renderShell()
      await screen.findByRole("heading", { name: "Invoices", level: 1 })
      expect(card("ready")).toHaveTextContent("Ready to InvoiceNothing to invoice: every ended month with hours is invoiced.")
      expect(within(card("ready")).queryByRole("listitem")).toBeNull()
    } finally {
      Object.assign(DATA, saved)
    }
  })
})
