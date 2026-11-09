/**
 * The Costs page over a fixed clock (8 Oct 2026) and made-up data: Main Bank, a
 * Google estimate paid in October, a supplier invoice half paid, a fridge on the
 * owner's card and a loan. The maths is lib/__tests__/cash-book.test.ts; this
 * checks the figures are labelled and each dialog writes what it says.
 */
import { Toaster } from "@alter-ego/ui/ui/toaster"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"


import { CompanyExpensesShell } from "../company-expenses-shell"

import type { Assignment, Client, Collaborator, CompanyAccount, CompanyExpense, CompanyLoan, CompanyMovement, Engagement } from "@/types"

const at = new Date(2026, 4, 1)
const d = (day: string) => new Date(`${day}T00:00:00`)

const MAIN: CompanyAccount = {
  id: "main", userId: "u1", name: "Main Bank", openingBalance: 1000, openingDate: d("2026-09-01"), statementBalance: null,
  statementDate: null, importRef: null, createdAt: at, updatedAt: at,
}
const cost = (o: Partial<CompanyExpense> & Pick<CompanyExpense, "id" | "description" | "amount">): CompanyExpense => ({
  userId: "u1", category: "other", date: d("2026-10-05"), isRecurring: false, recurrenceMonths: null, notes: null,
  accountId: null, paidByOwner: false, vat: 0, documentRef: null, project: null, recurringExpenseId: null,
  dateEstimated: false, importRef: null, collaboratorId: null, engagementId: null, forMonth: null, createdAt: at, updatedAt: at, ...o,
})
const GOOGLE = cost({ id: "google", description: "Google Workspace", category: "software", amount: 12, vat: null, isRecurring: true, recurrenceMonths: 1, date: d("2026-01-01") })
const PAID = cost({ id: "oct", description: "Google, October", category: "software", amount: 12, vat: 2.64, accountId: "main", recurringExpenseId: "google" })
const BILL = cost({ id: "bill", description: "Renovation", amount: 12000, documentRef: "FPR 40/26", project: "Flat Rental", date: d("2026-10-03") })
const FRIDGE = cost({ id: "fridge", description: "Fridge", category: "office_supplies", amount: 480, paidByOwner: true })
const LOAN: CompanyLoan = {
  id: "l1", userId: "u1", description: "Shareholder loan", direction: "to_company", amount: 5000, date: d("2026-10-02"),
  notes: null, accountId: "main", dateEstimated: false, importRef: null, createdAt: at, updatedAt: at,
}
const PAYMENT: CompanyMovement = {
  id: "m1", userId: "u1", kind: "supplier_payment", direction: "out", amount: 5000, date: d("2026-10-07"), accountId: "main",
  toAccountId: null, expenseId: "bill", description: "Payment", documentRef: null, project: null, counterparty: null, notes: null,
  dateEstimated: false, importRef: null, createdAt: at, updatedAt: at,
}

const collaborator = (o: Partial<Collaborator> & Pick<Collaborator, "id" | "name">): Collaborator => ({
  userId: "u1", type: "company", notes: null, isActive: true, fee: { amount: 2400, from: "2026-01", until: null, changes: [] },
  createdAt: at, updatedAt: at, ...o,
})
const VERDI = collaborator({ id: "verdi", name: "Studio Verdi" })
const GIULIA = collaborator({ id: "giulia", name: "Giulia Neri", type: "freelancer", fee: null })
const OLD = collaborator({ id: "old", name: "Old Co", isActive: false })
const CONTRACT = { id: "e1", userId: "u1", clientId: "nw", name: "Product Graph", dailyRate: 520 } as Engagement
const NORDWIND = { id: "nw", userId: "u1", name: "Nordwind" } as Client
const GIULIA_ON_E1 = {
  id: "a1", userId: "u1", collaboratorId: "giulia", engagementId: "e1", dailyRate: 320, from: "2026-09", until: null,
  defaultDays: 4, monthDays: {}, createdAt: at, updatedAt: at,
} as Assignment

const DATA: Record<string, unknown> = {}
const createCompanyExpense = vi.fn()
const createCompanyLoan = vi.fn()
const updateCompanyExpense = vi.fn()
const WRITES: Record<string, unknown> = { createCompanyExpense, createCompanyLoan, updateCompanyExpense }
const upload = vi.fn()
const removeFile = vi.fn()
const download = vi.fn()
vi.mock("@/modules", async (actual) => ({ ...(await actual<Record<string, unknown>>()), isModuleOn: (id: string) => id === "rent" || (actual as never as { isModuleOn: (i: string) => boolean }).isModuleOn?.(id) }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy({}, { get: (_db, method) => WRITES[String(method)] ?? (() => Promise.resolve(DATA[String(method)] ?? [])) }),
    files: { upload, remove: removeFile, download },
  }),
}))

beforeAll(() => vi.setSystemTime(new Date(2026, 9, 8, 12)))
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  Object.assign(DATA, {
    getCompanyAccounts: [MAIN],
    getCompanyExpenses: [GOOGLE, PAID, BILL, FRIDGE],
    getCompanyLoans: [LOAN],
    getCompanyMovements: [PAYMENT],
    getCollaborators: [VERDI, GIULIA, OLD],
    getAssignments: [GIULIA_ON_E1],
    getEngagements: [CONTRACT],
    getClients: [NORDWIND],
    getTenants: [{ id: "t1", firstName: "Marco", surname: "Gallo" }],
    getLeases: [{ id: "l1", tenantId: "t1", property: "Via Aurora 7", room: "Room 4", startDate: "2026-09-01", endDate: "2027-08-31" }],
  })
  localStorage.clear()
  createCompanyExpense.mockReset().mockResolvedValue({ id: "new" })
  createCompanyLoan.mockReset().mockResolvedValue({ id: "new" })
  updateCompanyExpense.mockReset().mockResolvedValue({ id: "edited" })
  upload.mockReset()
  removeFile.mockReset().mockResolvedValue(undefined)
  download.mockReset()
})

async function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyExpensesShell />
      <Toaster />
    </QueryClientProvider>,
  )
  await screen.findByRole("heading", { name: "Costs", level: 1 })
}

/** Radix Select by keyboard: jsdom has no pointer capture. */
async function pick(scope: HTMLElement, label: string, option: string) {
  fireEvent.keyDown(within(scope).getByRole("combobox", { name: label }), { key: "Enter" })
  fireEvent.keyDown(await screen.findByRole("option", { name: option }), { key: "Enter" })
}

// A StatCard: its label, value and detail are siblings under one parent.
const tile = (label: string) => within(screen.getByRole("region", { name: "Summary" })).getByText(label).parentElement!

describe("CompanyExpensesShell", () => {
  it("labels each figure and says how each cost was paid", async () => {
    await show()
    // 12 + 12,000 + 480: the estimate is no cost paid.
    expect(tile("One-Off Costs")).toHaveTextContent("€12,492.00")
    // 12 × 12 + the bill and the fridge; October's Google payment is inside its estimate.
    expect(tile("Annualized")).toHaveTextContent("€12,624.00")
    expect(tile("You Owe Suppliers")).toHaveTextContent("€7,000.00")
    expect(tile("SRL Owes You")).toHaveTextContent("€5,480.00")
    // jsdom has both layouts: the table is the wide one, the cards the phone's.
    const row = (name: string) => within(screen.getByRole("table")).getByText(name, { selector: "span.font-medium" }).closest("tr")!
    // The estimate is a card above the table, no row in it.
    expect(within(screen.getByRole("table")).queryByText("Google Workspace")).not.toBeInTheDocument()
    const recurring = within(screen.getByRole("region", { name: "Recurring" }))
    expect(recurring.getAllByRole("heading", { name: "Google Workspace" })[0]).toBeInTheDocument()
    expect(recurring.getByText("Every month · since Jan 2026")).toBeInTheDocument()
    // October's payment is on file: paid for the month, next one in November.
    expect(recurring.getByText("Paid for Oct")).toBeInTheDocument()
    expect(recurring.getByText("Next payment").nextSibling).toHaveTextContent("5 Nov 2026")
    expect(row("Google, October")).toHaveTextContent("Pays: Google Workspace")
    expect(row("Google, October")).toHaveTextContent("Main Bank")
    expect(row("Google, October")).toHaveTextContent("+ VAT €2.64")
    expect(row("Renovation")).toHaveTextContent("Owed €7,000.00")
    expect(row("Renovation")).toHaveTextContent("FPR 40/26")
    expect(row("Renovation")).toHaveTextContent("€5,000.00 paid on 07/10")
    expect(row("Fridge")).toHaveTextContent("Your card")
    // A month is a row group with its subtotal: 12 + 12,000 + 480 net.
    expect(within(screen.getByRole("table")).getByRole("rowgroup", { name: /October 2026/ })).toBeInTheDocument()
    expect(within(screen.getByRole("table")).getByText(/October 2026/).closest("tr")).toHaveTextContent("€12,492.00")
    // On a phone each cost is a card that still says how it was paid.
    const card = screen.getAllByText("Renovation", { selector: "span.font-medium" }).map((el) => el.closest("li")).find(Boolean)!
    expect(card).toHaveTextContent("Owed €7,000.00")
  })

  it("filters the costs by search and by how they were paid, and clears the filters", async () => {
    await show()
    const table = within(screen.getByRole("table"))
    fireEvent.change(screen.getAllByRole("searchbox", { name: "Search costs" })[0], { target: { value: "fpr 40" } })
    expect(table.getByText("Renovation")).toBeInTheDocument()
    expect(table.queryByText("Fridge")).not.toBeInTheDocument()
    fireEvent.change(screen.getAllByRole("searchbox", { name: "Search costs" })[0], { target: { value: "zzz" } })
    fireEvent.click(await screen.findByRole("button", { name: "Show All" }))
    expect(within(screen.getByRole("table")).getByText("Fridge")).toBeInTheDocument()
    await pick(screen.getAllByRole("combobox", { name: "Paid From" })[0].parentElement!, "Paid From", "Your card")
    expect(within(screen.getByRole("table")).queryByText("Renovation")).not.toBeInTheDocument()
    expect(within(screen.getByRole("table")).getByText("Fridge")).toBeInTheDocument()
  })

  it("adds a cost paid with the owner's card, with its VAT and cost centre", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Add Cost" }))
    const dialog = await screen.findByRole("dialog", { name: "New Cost" })
    // The amount and its VAT straight after the description: Amount was the sixth field, off a phone's screen.
    const fields = [...dialog.querySelectorAll("label")].map((l) => l.textContent)
    expect(fields.slice(0, 4)).toEqual(["Description", "Amount Before VAT", "VAT (€)", "Category"])
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Printer" } })
    await pick(dialog, "Paid From", "Owner's Personal Card")
    expect(within(dialog).getByText(/^Paid with your own card: the SRL owes it to you/)).toBeInTheDocument()
    // Recurring is for an estimate, never for a cost paid.
    expect(within(dialog).queryByText("Recurring Estimate")).not.toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Amount Before VAT"), { target: { value: "100" } })
    fireEvent.change(within(dialog).getByLabelText("VAT (€)"), { target: { value: "22" } })
    expect(within(dialog).getByText("Total paid:")).toHaveTextContent("€122.00")
    fireEvent.change(within(dialog).getByLabelText("Cost Centre (optional)"), { target: { value: "Flat Rental" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Cost" }))
    await waitFor(() =>
      expect(createCompanyExpense).toHaveBeenCalledWith("u1", {
        description: "Printer", category: "other", amount: 100, vat: 22, date: d("2026-10-08"), isRecurring: false,
        recurrenceMonths: null, accountId: null, paidByOwner: true, recurringExpenseId: null, documentRef: null,
        project: "Flat Rental", notes: null, collaboratorId: null, engagementId: null, forMonth: null,
      }),
    )
    expect(await screen.findByText("Added: Printer, €122.00 on your card: the SRL owes it to you.")).toBeInTheDocument()
  })

  it("records a payment of an estimate, and a refund into an account", async () => {
    await show()
    fireEvent.click(screen.getAllByRole("button", { name: "Record Payment of Google Workspace" })[0])
    let dialog = await screen.findByRole("dialog", { name: "Record Payment" })
    expect(within(dialog).getByLabelText("Description")).toHaveValue("Google Workspace")
    expect(within(dialog).getByRole("combobox", { name: "Pays Recurring Cost" })).toHaveTextContent("Google Workspace")
    expect(within(dialog).getByText('The Plan counts this cost instead of "Google Workspace" in October 2026.')).toBeInTheDocument()
    // The one account is the default.
    expect(within(dialog).getByRole("combobox", { name: "Paid From" })).toHaveTextContent("Main Bank")
    fireEvent.click(within(dialog).getByRole("button", { name: "Record Payment" }))
    await waitFor(() =>
      expect(createCompanyExpense).toHaveBeenCalledWith("u1", expect.objectContaining({
        description: "Google Workspace", amount: 12, vat: 0, accountId: "main", recurringExpenseId: "google", isRecurring: false,
      })),
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: "Add Cost" }))
    dialog = await screen.findByRole("dialog", { name: "New Cost" })
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Returned chair" } })
    fireEvent.click(within(dialog).getByRole("switch", { name: /Refund/ }))
    fireEvent.change(within(dialog).getByLabelText("Amount Refunded"), { target: { value: "50" } })
    fireEvent.change(within(dialog).getByLabelText("VAT (€)"), { target: { value: "11" } })
    expect(within(dialog).getByText("Total refunded:")).toHaveTextContent("€61.00")
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Cost" }))
    await waitFor(() =>
      expect(createCompanyExpense).toHaveBeenLastCalledWith("u1", expect.objectContaining({ amount: -50, vat: -11, accountId: "main" })),
    )
  })

  it("saves a rent offset with its lease and month", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Add Cost" }))
    const dialog = await screen.findByRole("dialog", { name: "New Cost" })
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Room during the works" } })
    fireEvent.change(within(dialog).getByLabelText("Amount Before VAT"), { target: { value: "520" } })
    expect(within(dialog).queryByRole("heading", { name: "Rent Offset" })).not.toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Cost Centre (optional)"), { target: { value: "Via Aurora 7" } })
    expect(await within(dialog).findByRole("heading", { name: "Rent Offset" })).toBeInTheDocument()
    await pick(dialog, "Lease (optional)", "Marco Gallo · Room 4 · Sep 2026 – Aug 2027")
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "For Month" })).toHaveTextContent("October 2026"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Cost" }))
    await waitFor(() =>
      expect(createCompanyExpense).toHaveBeenCalledWith("u1", expect.objectContaining({ amount: 520, project: "Via Aurora 7", leaseId: "l1", forMonth: "2026-10", collaboratorId: null })),
    )
  })

  it("adds a recurring cost as an estimate, paid by nothing", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Add Recurring Cost" }))
    const dialog = await screen.findByRole("dialog", { name: "New Recurring Cost" })
    expect(within(dialog).queryByRole("combobox", { name: "Paid From" })).not.toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Accountant" } })
    fireEvent.change(within(dialog).getByLabelText("Amount Each Time"), { target: { value: "300" } })
    fireEvent.change(within(dialog).getByLabelText("Every (Months)"), { target: { value: "3" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Recurring Cost" }))
    await waitFor(() =>
      expect(createCompanyExpense).toHaveBeenCalledWith("u1", expect.objectContaining({
        description: "Accountant", amount: 300, isRecurring: true, recurrenceMonths: 3, accountId: null, paidByOwner: false,
        recurringExpenseId: null,
      })),
    )
  })

  it("dates a shareholder loan on an account, and warns when a repayment exceeds what is owed", async () => {
    await show()
    const panel = within(screen.getByRole("region", { name: "Shareholder Loan" }))
    expect(screen.queryByText(/withdraw/i)).not.toBeInTheDocument()
    expect(panel.getByText("Lent to the SRL").nextSibling).toHaveTextContent("€5,000.00")
    expect(panel.getByText("Paid With Your Card").nextSibling).toHaveTextContent("€480.00")
    expect(panel.getByText("Paid Back to You").nextSibling).toHaveTextContent("€0.00")

    // The history: the loan and the fridge on the card, each with what the SRL owed you after it.
    expect(panel.getByText("Fridge").closest("li")).toHaveTextContent("Owes you €5,480.00")
    expect(panel.getByText("Shareholder loan").closest("li")).toHaveTextContent("Owes you €5,000.00")
    fireEvent.click(panel.getByRole("button", { name: "Repay Shareholder Loan" }))
    const dialog = await screen.findByRole("dialog", { name: "Repay Shareholder Loan" })
    expect(within(dialog).getByRole("combobox", { name: "From Account" })).toHaveTextContent("Main Bank")
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "6000" } })
    expect(within(dialog).getByRole("status")).toHaveTextContent(/^More than the SRL owes you \(€5,480.00\)/)
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "480" } })
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-10-06" } })
    expect(within(dialog).getByRole("status")).toHaveTextContent("The SRL owes you €5,480.00 now, €5,000.00 after this.")
    fireEvent.click(within(dialog).getByRole("button", { name: "Record Repayment" }))
    await waitFor(() =>
      expect(createCompanyLoan).toHaveBeenCalledWith("u1", {
        direction: "from_company", amount: 480, date: d("2026-10-06"), accountId: "main",
        description: "Shareholder loan repayment", notes: null,
      }),
    )
  })

  it("keeps a supplier invoice with payments Not Paid Yet, with its document", async () => {
    await show()
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Renovation" })[0])
    const dialog = await screen.findByRole("dialog", { name: "Edit Cost" })
    const paidFrom = within(dialog).getByRole("combobox", { name: "Paid From" })
    expect(paidFrom).toHaveTextContent("Not Paid Yet")
    expect(paidFrom).toBeDisabled()
    expect(within(dialog).getByText(/^Paid in the Cash Book by Supplier Invoice Payments: delete those payments/)).toBeInTheDocument()
    expect(within(dialog).queryByText("Recurring Estimate")).not.toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Document"), { target: { value: "" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
    expect(await within(dialog).findByText("Its payments in the Cash Book name this number: keep it.")).toBeInTheDocument()
    expect(updateCompanyExpense).not.toHaveBeenCalled()
  })

  it("never links a refund to a recurring cost", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Add Cost" }))
    const dialog = await screen.findByRole("dialog", { name: "New Cost" })
    await pick(dialog, "Category", "Software & Tools")
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Google refund" } })
    // A payment would take the Google estimate...
    expect(within(dialog).getByRole("combobox", { name: "Pays Recurring Cost" })).toHaveTextContent("Google Workspace")
    // ...a refund pays nothing.
    fireEvent.click(within(dialog).getByRole("switch", { name: /Refund/ }))
    expect(within(dialog).queryByRole("combobox", { name: "Pays Recurring Cost" })).not.toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Amount Refunded"), { target: { value: "20" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Cost" }))
    await waitFor(() =>
      expect(createCompanyExpense).toHaveBeenCalledWith("u1", expect.objectContaining({ amount: -20, accountId: "main", recurringExpenseId: null })),
    )
  })

  it("annualizes an estimate at the price in force, and not one that has ended", async () => {
    const accountant = cost({
      id: "acc", description: "Accountant", amount: 1200, isRecurring: true, recurrenceMonths: 3, date: d("2026-01-15"),
      countedWhenPaid: true, priceChanges: [{ from: "2026-07", amount: 1350 }],
    })
    const desk = cost({ id: "desk", description: "Coworking Desk", amount: 350, isRecurring: true, recurrenceMonths: 1, date: d("2026-01-03"), endMonth: "2026-06" })
    DATA.getCompanyExpenses = [accountant, desk]
    await show()
    expect(tile("Annualized")).toHaveTextContent("€5,400.00")
  })

  it("draws the recurring cards: what is paid each time, when, the price change and the end; a stored yearly one as a share", async () => {
    const accountant = cost({
      id: "acc", description: "Accountant", amount: 1200, isRecurring: true, recurrenceMonths: 3, date: d("2026-01-15"),
      countedWhenPaid: true, priceChanges: [{ from: "2026-07", amount: 1350 }], endMonth: "2027-12",
    })
    const hosting = cost({ id: "host", description: "Hosting", amount: 480, isRecurring: true, recurrenceMonths: 12, date: d("2026-02-20") })
    const desk = cost({ id: "desk", description: "Coworking Desk", amount: 350, isRecurring: true, recurrenceMonths: 1, date: d("2026-01-03"), endMonth: "2026-06" })
    DATA.getCompanyExpenses = [accountant, hosting, desk]
    await show()
    const card = (name: string) => screen.getAllByRole("article", { name }).at(-1)!
    expect(within(card("Accountant")).getByText("€1,350.00")).toBeInTheDocument()
    expect(within(card("Accountant")).getByText("every 3 months · about €450.00 a month")).toBeInTheDocument()
    expect(within(card("Accountant")).getByText("Pays in Jan, Apr, Jul, Oct")).toBeInTheDocument()
    expect(within(card("Accountant")).getByText("Price €1,350.00 since Jul 2026")).toBeInTheDocument()
    expect(within(card("Accountant")).getByText("Ends after Dec 2027")).toBeInTheDocument()
    expect(within(card("Hosting")).getByText("€40.00")).toBeInTheDocument()
    expect(within(card("Hosting")).getByText(/Counted as a share every month\. Edit it to count the full €480\.00/)).toBeInTheDocument()
    expect(within(card("Coworking Desk")).getByText("Ended")).toBeInTheDocument()
    expect(within(card("Coworking Desk")).getByText("Ended after Jun 2026")).toBeInTheDocument()
  })

  it("heads the recurring costs with the ones still running and an average, and says the last payment is made", async () => {
    const accountant = cost({
      id: "acc", description: "Accountant", amount: 1200, isRecurring: true, recurrenceMonths: 3, date: d("2026-02-10"),
      countedWhenPaid: true, endMonth: "2026-10",
    })
    const desk = cost({ id: "desk", description: "Coworking Desk", amount: 350, isRecurring: true, recurrenceMonths: 1, date: d("2026-01-03"), endMonth: "2026-06" })
    DATA.getCompanyExpenses = [accountant, desk]
    await show()
    const recurring = within(screen.getByRole("region", { name: "Recurring" }))
    expect(recurring.getByText("1 cost · About €400.00 a month, net of VAT")).toBeInTheDocument()
    const card = (name: string) => screen.getAllByRole("article", { name }).at(-1)!
    // October is its end month: not ended, and the next payment (November) would fall after it.
    expect(within(card("Accountant")).getByText("Ends after Oct 2026")).toBeInTheDocument()
    expect(within(card("Accountant")).getByText("No more payments")).toBeInTheDocument()
    expect(within(card("Accountant")).queryByText("Ended")).not.toBeInTheDocument()
    expect(within(card("Accountant")).queryByText("Next payment")).not.toBeInTheDocument()
    // Ended: said once.
    expect(within(card("Coworking Desk")).getAllByText(/Ended after Jun 2026|Ends after Jun 2026/)).toHaveLength(1)
  })

  it("counts a payment whose estimate was deleted, and drops the link on save", async () => {
    DATA.getCompanyExpenses = [PAID, BILL, FRIDGE]
    await show()
    // 12 + 12,000 + 480: no estimate holds October's Google payment any more.
    expect(tile("Annualized")).toHaveTextContent("€12,492.00")
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Google, October" })[0])
    const dialog = await screen.findByRole("dialog", { name: "Edit Cost" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
    await waitFor(() =>
      expect(updateCompanyExpense).toHaveBeenCalledWith("u1", "oct", expect.objectContaining({ recurringExpenseId: null, accountId: "main" })),
    )
  })

  it("warns when the SRL has paid the owner more than it owed", async () => {
    DATA.getCompanyLoans = [{ ...LOAN, direction: "from_company", amount: 600 }]
    await show()
    expect(screen.getAllByText("The SRL has paid you €120.00 more than it owed. Check the repayments.")[0]).toBeInTheDocument()
  })

  it("folds months beyond three until Show is clicked, and labels the old payment a recurring cost is due from", async () => {
    const months = ["2026-09-10", "2026-08-10", "2026-07-10", "2026-06-10"]
    DATA.getCompanyExpenses = [
      GOOGLE,
      BILL,
      ...months.map((day) => cost({ id: `c${day}`, description: `Cost ${day}`, amount: 10, date: d(day) })),
    ]
    await show()
    const table = () => within(screen.getByRole("table"))
    expect(table().getByText("Cost 2026-08-10")).toBeInTheDocument()
    expect(table().queryByText("Cost 2026-06-10")).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: "Show Jun 2026 to Jul 2026 · 2 costs" })[0])
    expect(table().getByText("Cost 2026-06-10")).toBeInTheDocument()
    // Never paid, started in January: the estimate says it was due, not that it is next.
    expect(within(screen.getByRole("region", { name: "Recurring" })).getAllByText("Was due").length).toBeGreaterThan(0)
  })

  describe("a collaborator's invoice", () => {
    const openNewCost = async () => {
      await show()
      fireEvent.click(screen.getByRole("button", { name: "Add Cost" }))
      return screen.findByRole("dialog", { name: "New Cost" })
    }

    it("picking a collaborator sets the category and reveals Contract and For Month", async () => {
      const dialog = await openNewCost()
      expect(within(dialog).queryByRole("combobox", { name: "Contract" })).not.toBeInTheDocument()
      await pick(dialog, "Collaborator", "Studio Verdi")
      expect(within(dialog).getByRole("combobox", { name: "Category" })).toHaveTextContent("Collaborators")
      // No contract of theirs: a fixed fee.
      expect(within(dialog).getByRole("combobox", { name: "Contract" })).toHaveTextContent("None, fixed fee")
      expect(within(dialog).getByLabelText("For Month")).toHaveValue("2026-10")
      expect(within(dialog).getByText("The month of work it pays: Quarters and the Collaborators page compare it with October's plan, €2,400.")).toBeInTheDocument()
    })

    it("picks the contract for a collaborator on exactly one, and offers only theirs", async () => {
      const dialog = await openNewCost()
      await pick(dialog, "Collaborator", "Giulia Neri")
      expect(within(dialog).getByRole("combobox", { name: "Contract" })).toHaveTextContent("Nordwind · Product Graph")
      fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Contract" }), { key: "Enter" })
      expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["None, fixed fee", "Nordwind · Product Graph"])
    })

    it("offers active collaborators only", async () => {
      const dialog = await openNewCost()
      fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Collaborator" }), { key: "Enter" })
      expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["None", "Giulia Neri", "Studio Verdi"])
    })

    it("For Month follows the Date until it is changed by hand", async () => {
      const dialog = await openNewCost()
      await pick(dialog, "Collaborator", "Studio Verdi")
      fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-11-05" } })
      expect(within(dialog).getByLabelText("For Month")).toHaveValue("2026-11")
      fireEvent.change(within(dialog).getByLabelText("For Month"), { target: { value: "2026-09" } })
      fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-12-01" } })
      expect(within(dialog).getByLabelText("For Month")).toHaveValue("2026-09")
    })

    it("needs the collaborator once the category is Collaborators", async () => {
      const dialog = await openNewCost()
      fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Invoice" } })
      fireEvent.change(within(dialog).getByLabelText("Amount Before VAT"), { target: { value: "100" } })
      await pick(dialog, "Category", "Collaborators")
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Cost" }))
      expect(await within(dialog).findByText("Choose the collaborator this invoice is from.")).toBeInTheDocument()
      expect(createCompanyExpense).not.toHaveBeenCalled()
    })

    it("saves the link, the contract and the month", async () => {
      const dialog = await openNewCost()
      fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Invoice 9/2026" } })
      fireEvent.change(within(dialog).getByLabelText("Amount Before VAT"), { target: { value: "1280" } })
      await pick(dialog, "Collaborator", "Giulia Neri")
      fireEvent.change(within(dialog).getByLabelText("For Month"), { target: { value: "2026-09" } })
      await pick(dialog, "Paid From", "Owner's Personal Card")
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Cost" }))
      await waitFor(() =>
        expect(createCompanyExpense).toHaveBeenCalledWith("u1", expect.objectContaining({
          category: "collaborators", amount: 1280, collaboratorId: "giulia", engagementId: "e1", forMonth: "2026-09",
        })),
      )
    })

    it.each([
      ["matches its date", "2026-10", "2026-11"],
      ["was set apart from its date", "2026-09", "2026-09"],
    ])("editing the date of a cost whose For Month %s", async (_, stored, expected) => {
      DATA.getCompanyExpenses = [cost({ id: "inv", description: "Invoice 14/2026", amount: 2400, category: "collaborators", collaboratorId: "verdi", forMonth: stored })]
      await show()
      fireEvent.click(screen.getAllByRole("button", { name: "Edit Invoice 14/2026" })[0])
      const dialog = await screen.findByRole("dialog", { name: "Edit Cost" })
      fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-11-05" } })
      expect(within(dialog).getByLabelText("For Month")).toHaveValue(expected)
    })

    it("offers Collaborators for a one-off cost only: a recurring estimate has no collaborator to name", async () => {
      const dialog = await openNewCost()
      await pick(dialog, "Category", "Collaborators")
      await pick(dialog, "Paid From", "Not Paid Yet")
      fireEvent.click(within(dialog).getByRole("switch"))
      expect(within(dialog).getByRole("combobox", { name: "Category" })).toHaveTextContent("Other")
      fireEvent.click(within(dialog).getByRole("combobox", { name: "Category" }))
      expect(screen.queryByRole("option", { name: "Collaborators" })).not.toBeInTheDocument()
    })

    it("clearing the collaborator clears the link", async () => {
      DATA.getCompanyExpenses = [cost({ id: "inv", description: "Invoice 14/2026", amount: 2400, category: "collaborators", collaboratorId: "old", forMonth: "2026-09" })]
      await show()
      fireEvent.click(screen.getAllByRole("button", { name: "Edit Invoice 14/2026" })[0])
      const dialog = await screen.findByRole("dialog", { name: "Edit Cost" })
      // An inactive collaborator still shows when it is the cost's current value.
      expect(within(dialog).getByRole("combobox", { name: "Collaborator" })).toHaveTextContent("Old Co")
      await pick(dialog, "Collaborator", "None")
      await pick(dialog, "Category", "Other")
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
      await waitFor(() =>
        expect(updateCompanyExpense).toHaveBeenCalledWith("u1", "inv", expect.objectContaining({ category: "other", collaboratorId: null, engagementId: null, forMonth: null })),
      )
    })

    it("shows the link on the Costs row", async () => {
      DATA.getCompanyExpenses = [
        cost({ id: "a", description: "Invoice 14/2026", amount: 2400, category: "collaborators", collaboratorId: "verdi", forMonth: "2026-09" }),
        cost({ id: "b", description: "Invoice 9/2026", amount: 1280, category: "collaborators", collaboratorId: "giulia", engagementId: "e1", forMonth: "2026-09" }),
      ]
      await show()
      const row = (name: string) => within(screen.getByRole("table")).getByText(name, { selector: "span.font-medium" }).closest("tr")!
      expect(row("Invoice 14/2026")).toHaveTextContent("Invoice 14/2026Studio Verdi · fixed fee for Sep 2026Collaborators")
      expect(row("Invoice 9/2026")).toHaveTextContent("Giulia Neri · Nordwind · Product Graph for Sep 2026")
    })
  })

  it("edits a recurring cost from its More menu", async () => {
    await show()
    const more = screen.getAllByRole("button", { name: "More for Google Workspace" })[0]
    more.focus()
    fireEvent.keyDown(more, { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: /Edit Recurring Cost/ }))
    const dialog = await screen.findByRole("dialog", { name: "Edit Recurring Cost" })
    expect(within(dialog).getByLabelText("Description")).toHaveValue("Google Workspace")
  })

  describe("a recurring cost's end, price changes and timing", () => {
    const ACCOUNTANT = cost({ id: "acc", description: "Accountant", amount: 1200, isRecurring: true, recurrenceMonths: 3, date: d("2026-01-15"), category: "accountant" })
    const counting = (dialog: HTMLElement) => within(dialog).getByRole("group", { name: "How the Plan Counts It" })

    async function edit(name: string) {
      const more = screen.getAllByRole("button", { name: `More for ${name}` })[0]
      more.focus()
      fireEvent.keyDown(more, { key: "Enter" })
      fireEvent.click(await screen.findByRole("menuitem", { name: /Edit Recurring Cost/ }))
      return screen.findByRole("dialog", { name: "Edit Recurring Cost" })
    }

    it("asks how the Plan counts it only when paid less often than monthly, and a new one counts when paid", async () => {
      await show()
      fireEvent.click(screen.getByRole("button", { name: "Add Recurring Cost" }))
      const dialog = await screen.findByRole("dialog", { name: "New Recurring Cost" })
      expect(within(dialog).queryByRole("group", { name: "How the Plan Counts It" })).not.toBeInTheDocument()
      fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Insurance" } })
      fireEvent.change(within(dialog).getByLabelText("Amount Each Time"), { target: { value: "2400" } })
      fireEvent.change(within(dialog).getByLabelText("Every (Months)"), { target: { value: "12" } })
      expect(within(counting(dialog)).getByRole("button", { name: "In the Months It Is Paid" })).toHaveAttribute("aria-pressed", "true")
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Recurring Cost" }))
      await waitFor(() =>
        expect(createCompanyExpense).toHaveBeenCalledWith("u1", expect.objectContaining({ countedWhenPaid: true, endMonth: null, priceChanges: [] })),
      )
    })

    it("keeps a stored quarterly estimate spread through a plain edit, and switches it only when chosen", async () => {
      DATA.getCompanyExpenses = [ACCOUNTANT]
      await show()
      let dialog = await edit("Accountant")
      expect(within(counting(dialog)).getByRole("button", { name: "A Share Every Month" })).toHaveAttribute("aria-pressed", "true")
      fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Accountant fee" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
      await waitFor(() =>
        expect(updateCompanyExpense).toHaveBeenLastCalledWith("u1", "acc", expect.objectContaining({ description: "Accountant fee", countedWhenPaid: false })),
      )
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Recurring Cost" })).not.toBeInTheDocument())

      dialog = await edit("Accountant")
      fireEvent.click(within(counting(dialog)).getByRole("button", { name: "In the Months It Is Paid" }))
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
      await waitFor(() => expect(updateCompanyExpense).toHaveBeenLastCalledWith("u1", "acc", expect.objectContaining({ countedWhenPaid: true })))
    })

    it("sets an end month and a list of dated price changes, and refuses a change that cannot apply", async () => {
      DATA.getCompanyExpenses = [ACCOUNTANT]
      await show()
      const dialog = await edit("Accountant")
      fireEvent.change(within(dialog).getByLabelText("Ends After (optional)"), { target: { value: "2027-12" } })
      const add = async (from: string, amount: string) => {
        if (!within(dialog).queryByLabelText("Change From")) fireEvent.click(within(dialog).getByRole("button", { name: "Add Change" }))
        fireEvent.change(within(dialog).getByLabelText("Change From"), { target: { value: from } })
        fireEvent.change(within(dialog).getByLabelText("New Amount Each Time"), { target: { value: amount } })
        fireEvent.click(within(dialog).getByRole("button", { name: "Save Change" }))
      }
      // In the start month (Jan 2026), and after the end (Dec 2027): neither is kept.
      await add("2026-01", "1300")
      expect(within(dialog).getByText("A change starts after the cost does.")).toBeInTheDocument()
      // Both fields point at the error, for a screen reader.
      expect(within(dialog).getByLabelText("Change From")).toHaveAccessibleDescription("A change starts after the cost does.")
      expect(within(dialog).getByLabelText("New Amount Each Time")).toHaveAccessibleDescription("A change starts after the cost does.")
      await add("2028-02", "1300")
      expect(within(dialog).getByText("A change falls after the end.")).toBeInTheDocument()
      await add("2027-07", "1400")
      await add("2026-07", "1350")
      expect(within(dialog).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "From Jul 2026€1,350.00 each timeRemove",
        "From Jul 2027€1,400.00 each timeRemove",
      ])
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove the change from Jul 2027" }))
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
      await waitFor(() =>
        expect(updateCompanyExpense).toHaveBeenLastCalledWith(
          "u1", "acc", expect.objectContaining({ endMonth: "2027-12", priceChanges: [{ from: "2026-07", amount: 1350 }] }),
        ),
      )
    })

    it("records a payment at the price in force, and says which payment month it stands in for", async () => {
      DATA.getCompanyExpenses = [{ ...ACCOUNTANT, countedWhenPaid: true, priceChanges: [{ from: "2026-07", amount: 1350 }] }]
      await show()
      fireEvent.click(screen.getAllByRole("button", { name: "Record Payment of Accountant" })[0])
      const dialog = await screen.findByRole("dialog", { name: "Record Payment" })
      expect(within(dialog).getByLabelText("Amount Before VAT")).toHaveValue(1350)
      expect(within(dialog).getByRole("combobox", { name: "Pays Recurring Cost" })).toHaveTextContent("Accountant · €1,350.00 every 3 months")
      // 8 Oct 2026 is a payment month of a quarterly cost from January.
      expect(within(dialog).getByText('The Plan counts this cost instead of "Accountant" in October 2026, the payment month nearest this date.')).toBeInTheDocument()
      fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-05-20" } })
      expect(within(dialog).getByText(/in April 2026, the payment month nearest/)).toBeInTheDocument()
      expect(within(dialog).getByRole("combobox", { name: "Pays Recurring Cost" })).toHaveTextContent("Accountant · €1,200.00 every 3 months")
    })

    it("previews the next payments as the end and the price changes are typed", async () => {
      DATA.getCompanyExpenses = [{ ...ACCOUNTANT, countedWhenPaid: true }]
      await show()
      const dialog = await edit("Accountant")
      // From October 2026: Oct, Jan, Apr, Jul at €1,200.
      expect(within(dialog).getByText(/^Next payments: Oct 2026, Jan 2027, Apr 2027, Jul 2027 · €4,800.00 in all · Plan other costs in Oct 2026 €.*\(was €/)).toBeInTheDocument()
      fireEvent.change(within(dialog).getByLabelText("Ends After (optional)"), { target: { value: "2027-02" } })
      expect(within(dialog).getByText(/^Next payments: Oct 2026, Jan 2027 · €2,400.00 in all/)).toBeInTheDocument()
      fireEvent.change(within(dialog).getByLabelText("Ends After (optional)"), { target: { value: "" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Change" }))
      fireEvent.change(within(dialog).getByLabelText("Change From"), { target: { value: "2027-04" } })
      fireEvent.change(within(dialog).getByLabelText("New Amount Each Time"), { target: { value: "1500" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Change" }))
      expect(within(dialog).getByText(/^Next payments: Oct 2026, Jan 2027, Apr 2027, Jul 2027 · €5,400.00 in all/)).toBeInTheDocument()
      fireEvent.click(within(counting(dialog)).getByRole("button", { name: "A Share Every Month" }))
      expect(within(dialog).queryByText(/^Next payments/)).not.toBeInTheDocument()
    })

    it("does not save while a change is typed and not kept, and clears the end when emptied", async () => {
      DATA.getCompanyExpenses = [{ ...ACCOUNTANT, endMonth: "2027-12" }]
      await show()
      const dialog = await edit("Accountant")
      expect(within(dialog).getByLabelText("Ends After (optional)")).toHaveValue("2027-12")
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Change" }))
      fireEvent.change(within(dialog).getByLabelText("Change From"), { target: { value: "2026-07" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
      expect(await within(dialog).findByText("Save or cancel the change first.")).toBeInTheDocument()
      expect(updateCompanyExpense).not.toHaveBeenCalled()
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel Change" }))
      fireEvent.change(within(dialog).getByLabelText("Ends After (optional)"), { target: { value: "" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
      await waitFor(() => expect(updateCompanyExpense).toHaveBeenLastCalledWith("u1", "acc", expect.objectContaining({ endMonth: null })))
    })
  })

  describe("the invoice file", () => {
    const stored = (name: string, path = `users/u1/company-files/${name}`) => ({
      path, name, kind: "xml" as const, size: 14 * 1024, uploadedAt: new Date(2026, 9, 1),
    })
    const xml = () => new File(["<a/>"], "IT01_00001.xml", { type: "application/xml" })
    const chooser = (dialog: HTMLElement) => within(dialog).getByLabelText("Choose invoice file")
    const choose = (dialog: HTMLElement, file: File) => fireEvent.change(chooser(dialog), { target: { files: [file] } })

    async function newCost() {
      await show()
      fireEvent.click(screen.getByRole("button", { name: "Add Cost" }))
      const dialog = await screen.findByRole("dialog", { name: "New Cost" })
      fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Accountant, October" } })
      fireEvent.change(within(dialog).getByLabelText("Amount Before VAT"), { target: { value: "900" } })
      return dialog
    }

    it("sits under Document, empty, saying what it takes", async () => {
      const dialog = await newCost()
      const slot = within(dialog).getByRole("group", { name: "Invoice File" })
      expect(within(slot).getByRole("button", { name: "Choose File" })).toBeInTheDocument()
      expect(slot).toHaveTextContent("XML, signed XML (.p7m) or PDF · up to 10 MB")
      const document = within(dialog).getByLabelText("Document (optional)")
      expect(document.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it("uploads a picked file when the cost is saved, and writes the cost pointing at it", async () => {
      const pointer = stored("IT01_00001.xml")
      upload.mockResolvedValue(pointer)
      const dialog = await newCost()
      choose(dialog, xml())
      expect(within(dialog).getByText("IT01_00001.xml")).toBeInTheDocument()
      expect(within(dialog).getByText("FatturaPA XML · 1 KB · saved with the cost")).toBeInTheDocument()
      expect(upload).not.toHaveBeenCalled()
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Cost" }))
      await waitFor(() => expect(createCompanyExpense).toHaveBeenCalledWith("u1", expect.objectContaining({ description: "Accountant, October", file: pointer })))
      expect(upload).toHaveBeenCalledWith("u1", expect.any(File), "IT01_00001.xml")
      expect(removeFile).not.toHaveBeenCalled()
    })

    it("leaves nothing behind on Cancel", async () => {
      const dialog = await newCost()
      choose(dialog, xml())
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "New Cost" })).not.toBeInTheDocument())
      expect(upload).not.toHaveBeenCalled()
      expect(createCompanyExpense).not.toHaveBeenCalled()
    })

    it("takes a picked file back with Remove, and saves with no file", async () => {
      const dialog = await newCost()
      choose(dialog, xml())
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }))
      expect(within(dialog).getByRole("button", { name: "Choose File" })).toBeInTheDocument()
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Cost" }))
      await waitFor(() => expect(createCompanyExpense).toHaveBeenCalled())
      expect(createCompanyExpense.mock.calls[0][1]).not.toHaveProperty("file")
      expect(upload).not.toHaveBeenCalled()
    })

    it.each([
      ["invoice.docx", 100, "invoice.docx can't be attached: use the XML, the signed .p7m, or a PDF."],
      ["scan.pdf", 14 * 1024 * 1024, "scan.pdf is over the 10 MB limit."],
    ])("refuses %s under the slot, and picks nothing", async (name, size, reason) => {
      const dialog = await newCost()
      const refused = new File([""], name)
      Object.defineProperty(refused, "size", { value: size })
      choose(dialog, refused)
      expect(within(dialog).getByRole("alert")).toHaveTextContent(reason)
      expect(within(dialog).getByRole("button", { name: "Choose File" })).toBeInTheDocument()
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Cost" }))
      await waitFor(() => expect(createCompanyExpense).toHaveBeenCalled())
      expect(upload).not.toHaveBeenCalled()
    })

    it("saves nothing when the upload fails, says why, and keeps the form to retry", async () => {
      upload.mockRejectedValue(new Error("Network down"))
      const dialog = await newCost()
      choose(dialog, xml())
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Cost" }))
      expect(await screen.findByText("IT01_00001.xml could not be uploaded: Network down.")).toBeInTheDocument()
      expect(createCompanyExpense).not.toHaveBeenCalled()
      expect(screen.getByRole("dialog", { name: "New Cost" })).toBeInTheDocument()
    })

    it("deletes the object it just uploaded when the cost is refused", async () => {
      const pointer = stored("IT01_00001.xml")
      upload.mockResolvedValue(pointer)
      createCompanyExpense.mockRejectedValue(new Error("Refused"))
      const dialog = await newCost()
      choose(dialog, xml())
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Cost" }))
      await waitFor(() => expect(removeFile).toHaveBeenCalledWith(pointer.path))
      expect(screen.getByRole("dialog", { name: "New Cost" })).toBeInTheDocument()
    })

    const KEPT_FILE = { ...stored("kept-host.xml"), kind: "xml" as const }

    describe("on a cost that keeps one", () => {
      const KEPT = stored("IT09876543210_00014.xml.p7m", "users/u1/company-files/kept.xml.p7m")
      async function edit() {
        DATA.getCompanyExpenses = [{ ...FRIDGE, file: { ...KEPT, kind: "p7m" as const } }]
        await show()
        fireEvent.click(screen.getAllByRole("button", { name: "Edit Fridge" })[0])
        return screen.findByRole("dialog", { name: "Edit Cost" })
      }

      it("shows its name, kind, size and date with Download and no View for an XML", async () => {
        const dialog = await edit()
        const slot = within(dialog).getByRole("group", { name: "Invoice File" })
        expect(within(slot).getByText("IT09876543210_00014.xml.p7m")).toBeInTheDocument()
        expect(within(slot).getByText("Signed FatturaPA XML · 14 KB · added 1 Oct")).toBeInTheDocument()
        expect(within(slot).getByRole("button", { name: "Download file" })).toBeInTheDocument()
        expect(within(slot).queryByRole("button", { name: "View" })).not.toBeInTheDocument()
      })

      it("replaces it on Save: uploads the new one, writes it, then deletes the old object", async () => {
        const next = stored("new.xml")
        upload.mockResolvedValue(next)
        const dialog = await edit()
        fireEvent.keyDown(within(dialog).getByRole("button", { name: "More file actions" }), { key: "Enter" })
        fireEvent.click(await screen.findByRole("menuitem", { name: "Replace File…" }))
        choose(dialog, xml())
        expect(removeFile).not.toHaveBeenCalled()
        fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
        await waitFor(() => expect(updateCompanyExpense).toHaveBeenCalledWith("u1", "fridge", expect.objectContaining({ file: next })))
        await waitFor(() => expect(removeFile).toHaveBeenCalledWith(KEPT.path))
        expect(removeFile).toHaveBeenCalledTimes(1)
      })

      it("removes it on Save, not before, and Undo keeps it", async () => {
        const dialog = await edit()
        fireEvent.keyDown(within(dialog).getByRole("button", { name: "More file actions" }), { key: "Enter" })
        fireEvent.click(await screen.findByRole("menuitem", { name: "Remove File" }))
        expect(within(dialog).getByText("IT09876543210_00014.xml.p7m is removed when you save.")).toBeInTheDocument()
        expect(removeFile).not.toHaveBeenCalled()
        fireEvent.click(within(dialog).getByRole("button", { name: "Undo" }))
        expect(within(dialog).getByRole("button", { name: "Download file" })).toBeInTheDocument()
        fireEvent.keyDown(within(dialog).getByRole("button", { name: "More file actions" }), { key: "Enter" })
        fireEvent.click(await screen.findByRole("menuitem", { name: "Remove File" }))
        fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
        await waitFor(() => expect(updateCompanyExpense).toHaveBeenCalledWith("u1", "fridge", expect.objectContaining({ file: null })))
        await waitFor(() => expect(removeFile).toHaveBeenCalledWith(KEPT.path))
      })

      it("leaves the file alone on a save that does not touch it", async () => {
        const dialog = await edit()
        fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Fridge, grey" } })
        fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
        await waitFor(() => expect(updateCompanyExpense).toHaveBeenCalled())
        expect(updateCompanyExpense.mock.calls[0][2]).not.toHaveProperty("file")
        expect(removeFile).not.toHaveBeenCalled()
      })

      it("keeps a PDF viewable: View opens it in a new tab", async () => {
        DATA.getCompanyExpenses = [{ ...FRIDGE, file: { ...stored("EU-1.pdf"), kind: "pdf" as const } }]
        download.mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" }))
        const tab = { location: { href: "" }, opener: {}, close: vi.fn() }
        const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
        URL.createObjectURL = vi.fn(() => "blob:pdf")
        await show()
        fireEvent.click(screen.getAllByRole("button", { name: "Edit Fridge" })[0])
        const dialog = await screen.findByRole("dialog", { name: "Edit Cost" })
        fireEvent.click(within(dialog).getByRole("button", { name: "View" }))
        expect(open).toHaveBeenCalledWith("about:blank", "_blank")
        await waitFor(() => expect(tab.location.href).toBe("blob:pdf"))
        open.mockRestore()
      })
    })

    it("switching a cost with a file to a Recurring Estimate removes the file on Save: an estimate is no document", async () => {
      DATA.getCompanyExpenses = [cost({ id: "host", description: "Hosting", amount: 50, file: { ...KEPT_FILE } })]
      await show()
      fireEvent.click(screen.getAllByRole("button", { name: "Edit Hosting" })[0])
      const dialog = await screen.findByRole("dialog", { name: "Edit Cost" })
      fireEvent.click(within(dialog).getByRole("switch"))
      expect(within(dialog).queryByRole("group", { name: "Invoice File" })).not.toBeInTheDocument()
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }))
      await waitFor(() => expect(updateCompanyExpense).toHaveBeenCalledWith("u1", "host", expect.objectContaining({ isRecurring: true, file: null })))
      await waitFor(() => expect(removeFile).toHaveBeenCalledWith(KEPT_FILE.path))
    })
  })
})
