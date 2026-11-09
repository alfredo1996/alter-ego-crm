/**
 * The Month End page over a fixed clock (10 Oct 2026) and made-up data. Lumen
 * Srl logged 9 days in September against 10 planned and has no September
 * invoice; Studio Verdi's August invoice went in as September, so August is
 * open too; Main Bank matches a check made on 5 October. The rules are
 * lib/__tests__/month-end.test.ts; this checks they reach the screen, in order,
 * each with its action. What the actions write is month-end-actions.test.tsx.
 */
import { Toaster } from "@alter-ego/ui/ui/toaster"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"


import { MonthEndShell } from "../month-end-shell"

import type { CompanyAccount, CompanyExpense, CompanyMovement, Engagement, Invoice, Timecard } from "@/types"

const at = new Date(2026, 4, 1)
const d = (day: string) => new Date(`${day}T00:00:00`)
let seq = 0

const engagement = (id: string, clientId: string, days: number): Engagement => ({
  id, userId: "u1", clientId, name: "Retainer", opportunityId: null, dailyRate: 450, vatApplicable: true,
  contractedDays: null, defaultDaysPerMonth: days, startMonth: "2026-07", endMonth: null, endDate: null,
  isActive: true, notes: null, createdAt: at, updatedAt: at,
})
const hoursIn = (engagementId: string, ym: string, days: number): Timecard[] =>
  Array.from({ length: days }, (_, k) => ({
    id: `t${++seq}`, userId: "u1", engagementId, collaboratorId: null, date: `${ym}-${String(k + 1).padStart(2, "0")}`, hours: 8,
    notes: null, createdAt: at, updatedAt: at,
  }))
const invoice = (o: Partial<Invoice> & Pick<Invoice, "clientId" | "number" | "yearMonth" | "amount">): Invoice => ({
  id: `i${++seq}`, userId: "u1", engagementId: null, fromMonth: null, vat: 0, dueDate: null, paidDate: null,
  paidAccountId: null, createdAt: new Date(2026, 4, 1, 0, 0, seq), updatedAt: at, ...o,
})
const MAIN: CompanyAccount = {
  id: "main", userId: "u1", name: "Main Bank", openingBalance: 1000, openingDate: d("2026-07-01"),
  // 1,000 + 4,500 + 2,700 in August + 4,500 in September.
  statementBalance: 12700, statementDate: d("2026-10-05"), importRef: null, createdAt: at, updatedAt: at,
}
const ESTIMATE: CompanyExpense = {
  id: "fee", userId: "u1", description: "Accountant fee", category: "accountant", amount: 250, date: d("2026-01-01"),
  isRecurring: true, recurrenceMonths: 1, notes: null, accountId: null, paidByOwner: false, vat: 0, documentRef: null,
  project: null, recurringExpenseId: null, dateEstimated: false, importRef: null, collaboratorId: null, engagementId: null, forMonth: null, createdAt: at, updatedAt: at,
}

const DATA: Record<string, unknown> = {}
function reset() {
  Object.assign(DATA, {
    getClients: [
      { id: "c1", userId: "u1", name: "Lumen Srl", isActive: true },
      { id: "c2", userId: "u1", name: "Studio Verdi", isActive: true },
    ],
    getEngagements: [engagement("e1", "c1", 10), engagement("e2", "c2", 6)],
    getAllocations: [],
    getTimecards: [
      ...hoursIn("e1", "2026-07", 10), ...hoursIn("e1", "2026-08", 10), ...hoursIn("e1", "2026-09", 9),
      ...hoursIn("e2", "2026-07", 6), ...hoursIn("e2", "2026-08", 6), ...hoursIn("e2", "2026-09", 6),
    ],
    getInvoices: [
      invoice({ clientId: "c1", number: "13/2026", yearMonth: "2026-07", amount: 4500, paidDate: d("2026-08-25"), paidAccountId: "main" }),
      invoice({ clientId: "c1", number: "14/2026", yearMonth: "2026-08", amount: 4500, paidDate: d("2026-09-25"), paidAccountId: "main" }),
      invoice({ clientId: "c2", number: "20/2026", yearMonth: "2026-07", amount: 2700, paidDate: d("2026-08-20"), paidAccountId: "main" }),
      invoice({ clientId: "c2", number: "21/2026", yearMonth: "2026-09", amount: 2700 }),
    ],
    getCompanyAccounts: [MAIN],
    getCompanyMovements: [],
    getCompanyExpenses: [ESTIMATE],
    getCompanyLoans: [],
    getCompanyDeadlines: [],
  })
}

/** The URL's search, as the router keeps it: replace and a link both change it, and the page re-reads it. */
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
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ db: new Proxy({}, { get: (_db, method) => () => Promise.resolve(DATA[String(method)] ?? []) }) }),
}))
const downloadCsv = vi.fn()
vi.mock("@/lib/export", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  downloadCsv: (...a: unknown[]) => downloadCsv(...a),
}))

// Which modules the deployment runs: all, unless a test leaves some out.
const off = vi.hoisted(() => new Set<string>())
vi.mock("@/modules", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  isModuleOn: (id: string) => !off.has(id),
}))

// Date only: fake timers would stall TanStack and findBy.
beforeAll(() => vi.setSystemTime(new Date(2026, 9, 10, 12)))
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  reset()
  url.search = ""
  replace.mockClear()
  downloadCsv.mockReset()
  off.clear()
})

async function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MonthEndShell />
      <Toaster />
    </QueryClientProvider>,
  )
  await screen.findByRole("heading", { name: "Month End", level: 1 })
}
const verdict = () => screen.getByRole("region", { name: "Verdict" })
const stepCard = (name: string) => within(screen.getByRole("region", { name }))

describe("MonthEndShell", () => {
  it("has no Invoices, Waiting or Invoice Files step, and no verdict on them, without invoicing", async () => {
    off.add("invoicing")
    await show()
    expect(within(screen.getByRole("list", { name: "Month-end steps" })).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Hours", "Supplier Invoices Owed", "Recurring Costs", "Bank", "To Chase", "Deadlines",
    ])
    expect(verdict()).toHaveTextContent("September 2026: 1 step to do (Hours)")
    expect(verdict()).toHaveTextContent("3 of 4 required steps done")
    expect(within(verdict()).queryByText(/waiting for payment|invoice file/)).not.toBeInTheDocument()
  })

  it("opens on last month with the verdict, the older month still open, the amber line and the steps in order", async () => {
    await show()
    expect(verdict()).toHaveTextContent("September 2026: 2 steps to do (Hours, Invoices)")
    expect(verdict()).toHaveTextContent("Also open: 1 earlier month (oldest: August 2026)")
    // The blocking steps still open, and each reminder as a pill, link to their cards.
    const links = within(verdict()).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])
    expect(links).toEqual([
      ["Hours", "#hours"],
      ["Invoices", "#invoices"],
      ["1 invoice waiting for payment", "#waiting"],
      ["1 recurring cost not paid", "#recurring"],
      ["1 invoice file missing", "#files"],
    ])
    // The progress: required steps in words, every step's state in order for a screen reader.
    expect(verdict()).toHaveTextContent("3 of 5 required steps done")
    expect(verdict()).toHaveTextContent("2 to do3 reminders to check4 done")
    expect(within(verdict()).getByText(/^Steps in order:/)).toHaveTextContent(
      "Steps in order: Hours to do, Invoices to do, Waiting for Payment to check, Supplier Invoices Owed done, Recurring Costs to check, Invoice Files to check, Bank done, To Chase done, Deadlines done.",
    )
    // The month, its state and when it ended, under the title.
    expect(within(screen.getByRole("group", { name: "Month" })).getByText("September 2026")).toBeInTheDocument()
    expect(screen.getByText("Open")).toBeInTheDocument()
    expect(screen.getByText("Ended 30 Sep · October closes from 1 Nov")).toBeInTheDocument()
    // The index, one link per step, its state in its name; the steps' own list is named apart from it.
    expect(
      within(screen.getByRole("navigation", { name: "Steps" })).getAllByRole("link").map((a) => [a.getAttribute("href"), a.getAttribute("aria-label")]),
    ).toEqual([
      ["#hours", "Hours, to do"],
      ["#invoices", "Invoices, to do"],
      ["#waiting", "Waiting for Payment, to check"],
      ["#suppliers", "Supplier Invoices Owed, done"],
      ["#recurring", "Recurring Costs, to check"],
      ["#files", "Invoice Files, to check"],
      ["#bank", "Bank, done"],
      ["#chase", "To Chase, done"],
      ["#deadlines", "Deadlines, done"],
    ])
    expect(within(screen.getByRole("list", { name: "Month-end steps" })).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Hours", "Invoices", "Waiting for Payment", "Supplier Invoices Owed", "Recurring Costs", "Invoice Files", "Bank", "To Chase", "Deadlines",
    ])
    expect(stepCard("Hours").getByText("To Do")).toBeInTheDocument()
    expect(stepCard("Hours").getByText("1 to do")).toBeInTheDocument()
    expect(stepCard("Recurring Costs").getByText("Check")).toBeInTheDocument()
    expect(stepCard("Bank").getByText("Done")).toBeInTheDocument()
    // A done step folds to one row: what done means waits inside the fold, with what was checked.
    expect(stepCard("Bank").getByText(/^Done when every account open by the month end matches the bank/)).not.toBeVisible()
    fireEvent.click(stepCard("Bank").getByText("What was checked (1)"))
    expect(stepCard("Bank").getByText(/^Done when every account open by the month end matches the bank/)).toBeVisible()
    expect(stepCard("To Chase").getByText("Nothing to do")).toBeInTheDocument()
    expect(stepCard("Hours").getByText(/^Done when every contract planned in the month has its hours/)).toBeInTheDocument()
    expect(stepCard("Recurring Costs").getByText(/^Reminder, never blocking:/)).toBeInTheDocument()
  })

  it("reads an hourly contract in hours: 9 d logged is 72 h, and the button says Use 72 h", async () => {
    DATA.getEngagements = [{ ...engagement("e1", "c1", 10), unit: "hour" }, engagement("e2", "c2", 6)]
    await show()
    const hours = stepCard("Hours")
    expect(hours.getByText("Lumen Srl · Retainer: 72 h logged, 80 h planned")).toBeInTheDocument()
    expect(hours.getByRole("button", { name: "Use 72 h" })).toBeInTheDocument()
    expect(hours.queryByRole("button", { name: "Use 9 d" })).toBeNull()
  })

  it("gives each open item its action, and folds what was checked", async () => {
    await show()
    const hours = stepCard("Hours")
    // The icon is hidden from screen readers, so the status is said in words too.
    expect(hours.getByText("Lumen Srl · Retainer: 9 d logged, 10 d planned")).toHaveTextContent(/^To do: Lumen Srl/)
    expect(hours.getByRole("button", { name: "Use 9 d" })).toBeInTheDocument()
    // One Use waiting: no Use All beside it.
    expect(hours.queryByRole("button", { name: /^Use All/ })).toBeNull()
    expect(hours.getByText("Studio Verdi · Retainer: 6 d confirmed")).not.toBeVisible()

    const invoices = stepCard("Invoices")
    expect(invoices.getByText("Lumen Srl, September 2026: €4,050.00 not invoiced")).toBeInTheDocument()
    expect(invoices.getByText("Studio Verdi, August 2026: €2,700.00 not invoiced")).toBeInTheDocument()
    expect(invoices.getAllByRole("button", { name: "Record Invoice" })).toHaveLength(2)
    fireEvent.click(invoices.getByText("What was checked (1)"))
    expect(invoices.getByText("Studio Verdi: covered by 21/2026 (Sep 2026)")).toBeVisible()

    fireEvent.click(stepCard("Bank").getByText("What was checked (1)"))
    expect(stepCard("Bank").getByText("Main Bank: Matches the bank on 05/10/2026 (after month end)")).toBeVisible()
    expect(stepCard("Recurring Costs").getByRole("button", { name: "Record Payment" })).toBeInTheDocument()
    expect(stepCard("Waiting for Payment").getByRole("button", { name: "Mark Paid" })).toBeInTheDocument()
  })

  it("links the rest to the screen that fixes it: hours to log, a later check that doesn't match, To Chase", async () => {
    DATA.getTimecards = (DATA.getTimecards as Timecard[]).filter((t) => !(t.engagementId === "e2" && t.date.startsWith("2026-09")))
    await show()
    // The month's first Monday, not 31 August: the week shown is September's own.
    expect(stepCard("Hours").getByRole("link", { name: "Log Hours" })).toHaveAttribute("href", "/plan?week=2026-09-07")
    cleanup()

    DATA.getCompanyAccounts = [MAIN]
    DATA.getCompanyMovements = [
      {
        id: "m1", userId: "u1", kind: "income", direction: "in", amount: 100, date: d("2026-09-10"), accountId: "main",
        toAccountId: null, expenseId: null, description: "Rent Room 2", documentRef: null, project: null, counterparty: null,
        notes: null, dateEstimated: true, importRef: null, createdAt: at, updatedAt: at,
      } satisfies CompanyMovement,
    ]
    await show()
    expect(verdict()).toHaveTextContent("September 2026: 4 steps to do (Hours, Invoices, Bank, To Chase)")
    expect(stepCard("Bank").getByText("Main Bank: Missing OUT of €100.00 on 05/10/2026")).toBeInTheDocument()
    // Check Balance won't save a 30/09 check over the 05/10 one: that one is what to fix.
    expect(stepCard("Bank").getByText(/^The 05\/10\/2026 check doesn't match the bank: fix that first\./)).toBeInTheDocument()
    expect(stepCard("Bank").getByRole("link", { name: "Open Cash Book" })).toHaveAttribute("href", "/cash-book?tab=movements&month=2026-10")
    expect(stepCard("To Chase").getByText("Rent Room 2, ~10/09/2026, date estimated")).toBeInTheDocument()
    expect(stepCard("To Chase").getByRole("link", { name: "Open To Chase" })).toHaveAttribute("href", "/cash-book?tab=chase")
  })

  it("steps back to the first month with data and forward to last month, never further", async () => {
    await show()
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }))
    expect(verdict()).toHaveTextContent("August 2026: 1 step to do (Invoices)")
    expect(replace).toHaveBeenLastCalledWith("/month-end?month=2026-08", { scroll: false })
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }))
    expect(verdict()).toHaveTextContent("July 2026 is closed: every required step is done.")
    expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled()
    expect(verdict()).not.toHaveTextContent("Also open")
    expect(screen.getByText("Closed")).toBeInTheDocument()
    expect(verdict()).toHaveTextContent("5 of 5 required steps done")
  })

  it("keeps the index following the steps on screen after the month changes, from the first step again", async () => {
    // jsdom has no IntersectionObserver: a stand-in that records what each live observer watches.
    const live = new Set<{ targets: Element[] }>()
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        targets: Element[] = []
        constructor() {
          live.add(this)
        }
        observe(el: Element) {
          this.targets.push(el)
        }
        unobserve() {}
        takeRecords() {
          return []
        }
        disconnect() {
          live.delete(this)
        }
      },
    )
    try {
      await show()
      const index = () => within(screen.getByRole("navigation", { name: "Steps" }))
      fireEvent.click(index().getByRole("link", { name: "Deadlines, done" }))
      expect(index().getByRole("link", { name: "Deadlines, done" })).toHaveAttribute("aria-current", "location")
      fireEvent.click(screen.getByRole("button", { name: "Previous month" }))
      expect(verdict()).toHaveTextContent("August 2026")
      // Every step on screen is watched, none of last month's detached ones.
      const ids = ["hours", "invoices", "waiting", "suppliers", "recurring", "files", "bank", "chase", "deadlines"]
      expect([...live].flatMap((o) => o.targets)).toEqual(ids.map((id) => document.getElementById(id)))
      expect(index().getByRole("link", { name: /^Hours,/ })).toHaveAttribute("aria-current", "location")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("says why a step has nothing to check: no hours before the first month with hours", async () => {
    DATA.getCompanyAccounts = [{ ...MAIN, openingDate: d("2026-06-01") }]
    url.search = "?month=2026-06"
    await show()
    const hours = stepCard("Hours")
    expect(hours.getByText("Not Needed")).toBeInTheDocument()
    expect(hours.getByText("No hours were logged in this month or before it.")).toBeVisible()
    const link = within(screen.getByRole("navigation", { name: "Steps" })).getByRole("link", { name: "Hours, not needed" })
    expect(link).toHaveAttribute("href", "#hours")
    // One look for "not needed" in the legend, the bar's first segment and the index: hollow, in the muted text colour.
    expect(within(verdict()).getByText("1 not needed").firstElementChild).toHaveClass("border-muted-foreground")
    expect(within(verdict()).getByText("1 not needed").firstElementChild).not.toHaveClass("bg-muted-foreground")
    const bar = within(verdict()).getByText(/^Steps in order:/).previousElementSibling!
    expect(bar.firstElementChild).toHaveClass("border-muted-foreground")
    expect(link.querySelector("circle")).toHaveClass("stroke-muted-foreground")
  })

  it("follows the URL: Month End in the sidebar, with no month, shows last month again", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }))
    expect(verdict()).toHaveTextContent("August 2026")
    act(() => url.set(""))
    expect(verdict()).toHaveTextContent("September 2026: 2 steps to do (Hours, Invoices)")
  })

  it("counts a step's blocking and amber items apart", async () => {
    // Lumen's September is provisional on an invoice running into October; Studio Verdi's August is not invoiced.
    DATA.getInvoices = [
      ...(DATA.getInvoices as Invoice[]).filter((i) => i.number !== "14/2026"),
      invoice({ clientId: "c1", number: "14/2026", yearMonth: "2026-08", amount: 4500, paidDate: d("2026-09-25"), paidAccountId: "main" }),
      invoice({ clientId: "c1", number: "16/2026", fromMonth: "2026-09", yearMonth: "2026-10", amount: 6000 }),
    ]
    await show()
    const invoices = stepCard("Invoices")
    expect(invoices.getByText("1 to do · 1 to check")).toBeInTheDocument()
    expect(invoices.getByText("Lumen Srl, September 2026: provisional, €1,050.00 to come from 16/2026 (Sep–Oct 2026)")).toHaveTextContent(/^To check: /)
    expect(invoices.getByText("Studio Verdi, August 2026: €2,700.00 not invoiced")).toHaveTextContent(/^To do: /)
  })

  it("links Invoices from the reminders when it holds only items to check", async () => {
    // Lumen's September is provisional on an invoice running into October; Studio Verdi's August is now invoiced and paid.
    DATA.getInvoices = [
      ...(DATA.getInvoices as Invoice[]),
      invoice({ clientId: "c2", number: "22/2026", yearMonth: "2026-08", amount: 2700, paidDate: d("2026-09-28"), paidAccountId: "main" }),
      invoice({ clientId: "c1", number: "16/2026", fromMonth: "2026-09", yearMonth: "2026-10", amount: 6000 }),
    ]
    DATA.getCompanyAccounts = [{ ...MAIN, statementBalance: 15400 }]
    await show()
    expect(stepCard("Invoices").getByText("Check")).toBeInTheDocument()
    expect(verdict()).toHaveTextContent("September 2026: 1 step to do (Hours)")
    expect(verdict()).toHaveTextContent("4 reminders to check")
    const links = within(verdict()).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])
    expect(links).toEqual([
      ["Hours", "#hours"],
      ["1 invoice to check", "#invoices"],
      ["2 invoices waiting for payment", "#waiting"],
      ["1 recurring cost not paid", "#recurring"],
      ["1 invoice file missing", "#files"],
    ])
  })

  it("opens a supplier invoice on Costs while the Cash Book has no account", async () => {
    const office: CompanyExpense = {
      ...ESTIMATE, id: "office", description: "Office move", category: "other", amount: 1000, date: d("2026-09-12"),
      isRecurring: false, recurrenceMonths: null, documentRef: "INV 40",
    }
    DATA.getCompanyExpenses = [office]
    DATA.getCompanyAccounts = []
    await show()
    expect(stepCard("Supplier Invoices Owed").getByRole("link", { name: "Open Costs" })).toHaveAttribute("href", "/costs")
    cleanup()
    DATA.getCompanyAccounts = [MAIN]
    await show()
    expect(stepCard("Supplier Invoices Owed").getByRole("link", { name: "Open Owed & Held" })).toHaveAttribute("href", "/cash-book?tab=owed")
  })

  it("goes to the oldest month still open from the Also open line", async () => {
    await show()
    fireEvent.click(within(verdict()).getByRole("button", { name: "August 2026" }))
    expect(verdict()).toHaveTextContent("August 2026: 1 step to do (Invoices)")
  })

  it("opens on the month a link asks for, kept between the first month with data and last month", async () => {
    for (const [search, shown] of [
      ["?month=2026-08", "August 2026"],
      ["?month=2026-10", "September 2026"],
      ["?month=2026-01", "July 2026"],
      ["?month=garbage", "September 2026"],
    ]) {
      url.search = search
      await show()
      expect(verdict()).toHaveTextContent(shown)
      cleanup()
    }
  })

  it("downloads the month's CSV for the accountant without a dialog, and opens Export for other periods", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }))
    expect(downloadCsv).toHaveBeenCalledWith(expect.stringContaining("Date;Account;Type"), "cash-book_2026-09_all-accounts_all-cost-centres.csv")
    expect(await screen.findByText("Exported 1 row, 01/09/2026 to 30/09/2026, every account, every cost centre.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Other Periods" }))
    expect(await screen.findByRole("dialog", { name: "Export" })).toBeInTheDocument()
  })

  it("keeps both in a More menu on a phone, and hands focus back to it after Other Periods", async () => {
    await show()
    const more = screen.getByRole("button", { name: "More" })
    expect(more).toHaveClass("sm:hidden")
    expect(screen.getByRole("button", { name: "Download CSV" })).toHaveClass("max-sm:hidden")
    fireEvent.keyDown(more, { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download CSV" }))
    expect(downloadCsv).toHaveBeenCalledWith(expect.any(String), "cash-book_2026-09_all-accounts_all-cost-centres.csv")
    fireEvent.keyDown(more, { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Other Periods" }))
    const dialog = await screen.findByRole("dialog", { name: "Export" })
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(more).toHaveFocus())
  })

  it("says there is nothing to close before any hours or account", async () => {
    Object.assign(DATA, { getTimecards: [], getCompanyAccounts: [], getInvoices: [] })
    await show()
    expect(screen.getByText(/Nothing to close yet\. A month can be closed once it has hours on the Plan/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Download CSV" })).toBeNull()
  })

  it("says when the first month with data has not ended yet", async () => {
    Object.assign(DATA, { getTimecards: hoursIn("e1", "2026-10", 2), getCompanyAccounts: [], getInvoices: [] })
    await show()
    expect(screen.getByText("Nothing to close yet: October 2026, the first month with data, can be closed from 1 November 2026.")).toBeInTheDocument()
  })
})
