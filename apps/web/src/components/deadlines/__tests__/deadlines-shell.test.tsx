/**
 * The Deadlines page on made-up data, on Thursday 15 October 2026 as the mockups
 * draw it: one list card grouped by period, a row's single action, the Next 30
 * days strip, Done's last three, the search, and edit and delete in the dialog.
 */
import { Toaster } from "@alter-ego/ui/ui/toaster"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { client, contract } from "@/components/crm/__tests__/solution-fixtures"
import { DeadlinesShell } from "@/components/deadlines/deadlines-shell"

import type { CompanyDeadline, Invoice, Opportunity, Task } from "@/types"

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
const DATA: Record<string, unknown> = {}
const CALLS: [string, unknown[]][] = []
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy(
      {},
      {
        get: (_db, method) =>
          (...args: unknown[]) => {
            CALLS.push([String(method), args])
            return Promise.resolve(DATA[String(method)] ?? [])
          },
      },
    ),
  }),
}))

const off = vi.hoisted(() => new Set<string>())
vi.mock("@/modules", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  isModuleOn: (id: string) => !off.has(id),
}))

const at = new Date(2026, 0, 1)
const oct = (d: number) => new Date(2026, 9, d)

const invoice = (o: Partial<Invoice> & Pick<Invoice, "id" | "clientId" | "number" | "amount" | "vat">) =>
  ({
    userId: "u1", engagementId: null, fromMonth: null, yearMonth: "2026-09", dueDate: null, paidDate: null,
    paidAccountId: null, createdAt: at, updatedAt: at, ...o,
  }) as Invoice
const task = (o: Partial<Task> & Pick<Task, "id" | "clientId" | "title">): Task => ({
  userId: "u1", engagementId: null, dueDate: null, notes: null, isDone: false, startedAt: null, labels: [],
  createdAt: at, updatedAt: at, ...o,
})
const deadline = (o: Partial<CompanyDeadline> & Pick<CompanyDeadline, "id" | "title" | "date">): CompanyDeadline => ({
  userId: "u1", kind: "admin", amount: null, notes: null, isDone: false, createdAt: at, updatedAt: at, ...o,
})
const deal: Opportunity = {
  id: "o1", userId: "u1", clientId: "c3", title: "Graph RAG Assistant", stage: "proposal", probability: 40,
  dailyRate: 520, estimatedDaysPerMonth: 8, estimatedDurationMonths: 4, expectedStartMonth: null, vatApplicable: true,
  nextActionDate: oct(17), nextActionNote: "Send revised proposal", notes: null, lostReason: null, closedAt: null,
  engagementId: null, createdAt: at, updatedAt: at,
}

beforeAll(() => {
  // Only Date: the queries' timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 9, 15, 10))
})
afterAll(() => vi.useRealTimers())

afterEach(() => off.clear())
beforeEach(() => {
  CALLS.length = 0
  DATA.getClients = [client("c1", "Nordwind Retail S.p.A."), client("c2", "Lumen Srl"), client("c3", "Vela Analytics Srl")]
  DATA.getEngagements = [contract("e1", "c1", "Product Graph")]
  DATA.getOpportunities = [deal]
  DATA.getInvoices = [
    invoice({ id: "i27", clientId: "c3", number: "27/2026", amount: 1440, vat: 316.8, dueDate: oct(5) }),
    invoice({ id: "i25", clientId: "c1", number: "25/2026", amount: 4160, vat: 915.2, dueDate: oct(31) }),
    invoice({ id: "i26", clientId: "c2", number: "26/2026", amount: 4500, vat: 990, dueDate: oct(31), paidDate: oct(9) }),
  ]
  DATA.getTasks = [
    task({ id: "t1", clientId: "c2", title: "Book forecasting intro call", dueDate: oct(12) }),
    task({ id: "t2", clientId: "c3", title: "Draft Graph RAG proposal", dueDate: oct(17) }),
    task({ id: "t3", clientId: "c2", title: "Send September timesheet", dueDate: oct(3), isDone: true }),
  ]
  DATA.getCompanyDeadlines = [
    deadline({ id: "d1", title: "File F24 for withholding", date: oct(16), kind: "tax", amount: 480 }),
    deadline({ id: "d2", title: "Renew professional insurance", date: new Date(2026, 10, 1), amount: 620 }),
    deadline({ id: "d3", title: "Annual accounts filing", date: new Date(2026, 8, 30), amount: 150, isDone: true }),
    deadline({ id: "d4", title: "Register the trademark", date: new Date(2026, 7, 3), isDone: true }),
  ]
})

async function show() {
  cleanup()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeadlinesShell />
      <Toaster />
    </QueryClientProvider>,
  )
  await screen.findByRole("heading", { name: "Deadlines", level: 1 })
}

const region = (name: string) => screen.getByRole("region", { name })
const row = (name: string) => screen.getByRole("listitem", { name })
const rowNames = (name: string) =>
  within(region(name))
    .getAllByRole("listitem")
    .map((li) => document.getElementById(li.getAttribute("aria-labelledby")!)!.textContent)

describe("the Deadlines list", () => {
  it("is one list grouped by period, overdue first and done last, each period a region with its count and days", async () => {
    await show()
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Next 30 days", "Overdue", "This week", "This month", "Later", "Done",
    ])
    expect(rowNames("Overdue")).toEqual(["Invoice 27/2026", "Book forecasting intro call"])
    expect(region("Overdue")).toHaveTextContent(/^Overdue2before today/)
    expect(rowNames("This week")).toEqual(["File F24 for withholding", "Draft Graph RAG proposal", "Send revised proposal"])
    expect(region("This week")).toHaveTextContent(/^This week315–18 Oct/)
    expect(rowNames("This month")).toEqual(["Invoice 25/2026"])
    expect(rowNames("Later")).toEqual(["Renew professional insurance"])
  })

  it("gives each row one action, and says whose it is beside its kind", async () => {
    await show()
    const late = row("Invoice 27/2026")
    expect(late).toHaveTextContent("Overdue")
    expect(late).toHaveTextContent("InvoiceVela Analytics Srl")
    expect(late).toHaveTextContent("+€1,756.80")
    expect(within(late).getByRole("button", { name: "Mark Paid" })).toHaveAccessibleDescription("Invoice 27/2026")

    expect(within(row("Book forecasting intro call")).getByRole("button", { name: "Mark Done" })).toBeInTheDocument()

    const mine = row("File F24 for withholding")
    expect(mine).toHaveTextContent("TaxYours")
    expect(mine).toHaveTextContent("−€480.00")
    expect(within(mine).getByText("16 October 2026")).toHaveClass("sr-only")

    const followUp = row("Send revised proposal")
    expect(followUp).toHaveTextContent("Follow-upGraph RAG Assistant · Vela Analytics Srl")
    expect(within(followUp).getByRole("link", { name: "Open Deal" })).toHaveAttribute("href", "/pipeline?client=c3")
    // Derived from the pipeline: nothing to open.
    expect(within(followUp).queryByRole("button")).toBeNull()

    expect(row("Invoice 26/2026")).toHaveTextContent("Paid 9 Oct")
    expect(within(row("Invoice 26/2026")).getByRole("button", { name: "Mark Unpaid" })).toBeInTheDocument()
    expect(row("Send September timesheet")).toHaveTextContent("Done")
    expect(within(row("Send September timesheet")).getByRole("button", { name: "Reopen" })).toBeInTheDocument()
  })

  it("ticks a task done, and reopens a deadline", async () => {
    await show()
    fireEvent.click(within(row("Book forecasting intro call")).getByRole("button", { name: "Mark Done" }))
    fireEvent.click(within(row("Annual accounts filing")).getByRole("button", { name: "Reopen" }))
    await waitFor(() => {
      expect(CALLS).toContainEqual(["updateTask", ["u1", "t1", { isDone: true }]])
      expect(CALLS).toContainEqual(["updateCompanyDeadline", ["u1", "d3", { isDone: false }]])
    })
  })

  it("says a row was marked done, which can file it behind Show All Done, and Undo reopens it", async () => {
    await show()
    // A title no other test marks done: the toast store outlives a test.
    fireEvent.click(within(row("File F24 for withholding")).getByRole("button", { name: "Mark Done" }))
    expect(await screen.findByText("File F24 for withholding marked done.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() => expect(CALLS).toContainEqual(["updateCompanyDeadline", ["u1", "d1", { isDone: false }]]))
  })

  it("shows the newest three done, then all of them", async () => {
    await show()
    expect(rowNames("Done")).toEqual(["Invoice 26/2026", "Send September timesheet", "Annual accounts filing"])
    fireEvent.click(screen.getByRole("button", { name: "Show All 4 Done" }))
    expect(rowNames("Done")).toHaveLength(4)
    // Focus moves to the first row it brought in, not back to the top of the page.
    expect(within(row("Register the trademark")).getByRole("button", { name: "Register the trademark" })).toHaveFocus()
  })

  it("sums the next 30 days: what comes in, what goes out, and what is late", async () => {
    await show()
    const strip = region("Next 30 days")
    expect(strip).toHaveTextContent("To collect+€6,832.002 invoices")
    expect(strip).toHaveTextContent("To pay−€1,100.002 of your deadlines")
    expect(within(strip).getByRole("link", { name: /Overdue\s*2\s*1 invoice, 1 task/ })).toHaveAttribute("href", "#overdue")
    expect(strip).toHaveTextContent("15 Oct – 14 Nov")
  })

  it("takes the Overdue link to the overdue rows from the calendar, and past a search that hid them", async () => {
    await show()
    const overdueLink = () => within(region("Next 30 days")).getByRole("link", { name: /^Overdue/ })
    const search = () => screen.getByRole("searchbox", { name: "Search deadlines" })

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Calendar" }))
    expect(screen.queryByRole("region", { name: "Overdue" })).toBeNull()
    fireEvent.click(overdueLink())
    expect(screen.getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true")
    expect(rowNames("Overdue")).toHaveLength(2)

    fireEvent.change(search(), { target: { value: "insurance" } })
    expect(screen.queryByRole("region", { name: "Overdue" })).toBeNull()
    fireEvent.click(overdueLink())
    expect(search()).toHaveValue("")
    expect(rowNames("Overdue")).toHaveLength(2)
  })

  it("narrows to a search over titles and clients, and says when nothing matches", async () => {
    await show()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search deadlines" }), { target: { value: "lumen" } })
    expect(rowNames("Overdue")).toEqual(["Book forecasting intro call"])
    expect(screen.queryByRole("region", { name: "This week" })).toBeNull()
    // The strip still counts everything.
    expect(region("Next 30 days")).toHaveTextContent("+€6,832.00")

    fireEvent.change(screen.getByRole("searchbox", { name: "Search deadlines" }), { target: { value: "nothing like it" } })
    expect(screen.getByText("No deadlines match these filters.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show All" }))
    expect(rowNames("Overdue")).toHaveLength(2)
  })

  it("opens your own deadline to edit it, with Delete in the dialog", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "File F24 for withholding" }))
    const dialog = await screen.findByRole("dialog", { name: "Edit Deadline" })
    expect(within(dialog).getByLabelText("What's due")).toHaveValue("File F24 for withholding")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete Deadline" }))
    const confirm = await screen.findByRole("alertdialog", { name: "Delete Deadline" })
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(CALLS).toContainEqual(["deleteCompanyDeadline", ["u1", "d1"]]))
  })

  it("opens a task in the task dialog", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Draft Graph RAG proposal" }))
    expect(await screen.findByRole("dialog")).toHaveTextContent("Draft Graph RAG proposal")
  })
  it("names a run-out month only for a contract still inside its budget (#308)", async () => {
    const capped = (id: string, name: string) => ({
      ...contract(id, "c1", name), contractedDays: 10, startMonth: "2026-10",
    })
    DATA.getEngagements = [capped("over", "Over Budget"), capped("under", "Under Budget")]
    const hours = (engagementId: string, days: number) =>
      Array.from({ length: days }, (_, n) => ({
        id: `${engagementId}${n}`, userId: "u1", engagementId, date: `2026-09-${String(n + 1).padStart(2, "0")}`,
        hours: 8, notes: null, createdAt: at, updatedAt: at,
      }))
    DATA.getTimecards = [...hours("over", 15), ...hours("under", 3)]
    await show()
    expect(await screen.findByText("Under Budget budget used up")).toBeInTheDocument()
    expect(screen.queryByText("Over Budget budget used up")).toBeNull()
  })
})

describe("the Deadlines list without invoicing", () => {
  it("has no invoice rows, no Mark Paid, no To collect figure and no Invoice source, and keeps the rest", async () => {
    off.add("invoicing")
    await show()
    expect(rowNames("Overdue")).toEqual(["Book forecasting intro call"])
    expect(screen.queryByText("Invoice 25/2026")).toBeNull()
    expect(screen.queryByRole("button", { name: "Mark Paid" })).toBeNull()
    expect(region("Next 30 days")).not.toHaveTextContent("To collect")
    expect(region("Next 30 days")).toHaveTextContent("To pay−€1,100.002 of your deadlines")
    fireEvent.click(screen.getByRole("combobox", { name: "Source" }))
    expect(screen.queryByRole("option", { name: "Invoices" })).toBeNull()
    expect(screen.getByRole("option", { name: "Follow-ups" })).toBeInTheDocument()
  })
})
