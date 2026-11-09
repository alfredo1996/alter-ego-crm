/**
 * The Cash Book page over a fixed clock (8 Oct 2026) and made-up data: Main Bank
 * and Second Bank, a tenant called Room 2, Alpha Ltd paying an invoice €25 short.
 * The maths is lib/__tests__/cash-book.test.ts; this checks every figure is on
 * screen with its label, and that each dialog writes what it says.
 */
import { Toaster } from "@alter-ego/ui/ui/toaster"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"


import { CashBookShell } from "../cash-book-shell"

import type { CompanyAccount, CompanyExpense, CompanyLoan, CompanyMovement, Invoice } from "@/types"

const at = new Date(2026, 4, 1)
const d = (day: string) => new Date(`${day}T00:00:00`)
let seq = 0

const account = (o: Partial<CompanyAccount> & Pick<CompanyAccount, "id" | "name">): CompanyAccount => ({
  userId: "u1", openingBalance: 0, openingDate: d("2026-09-01"), statementBalance: null, statementDate: null,
  importRef: null, createdAt: at, updatedAt: at, ...o,
})
const movement = (o: Partial<CompanyMovement> & Pick<CompanyMovement, "kind" | "direction" | "amount" | "date">): CompanyMovement => ({
  id: `m${++seq}`, userId: "u1", accountId: "main", toAccountId: null, expenseId: null, description: "Row",
  documentRef: null, project: null, counterparty: null, notes: null, dateEstimated: false, importRef: null,
  createdAt: new Date(2026, 4, 1, 0, 0, seq), updatedAt: at, ...o,
})
const invoice = (o: Partial<Invoice> & Pick<Invoice, "id" | "number" | "amount" | "vat">): Invoice => ({
  userId: "u1", clientId: "c1", engagementId: null, fromMonth: null, yearMonth: "2026-09", dueDate: null,
  paidDate: null, paidAccountId: null, createdAt: at, updatedAt: at, ...o,
})

const MAIN = account({ id: "main", name: "Main Bank", openingBalance: 1000, statementBalance: 9800, statementDate: d("2026-10-07") })
const SECOND = account({ id: "second", name: "Second Bank" })
const FEE: CompanyExpense = {
  id: "fee", userId: "u1", description: "Bank fee on invoice 16/2026", category: "bank_fees", amount: 25,
  date: d("2026-10-05"), isRecurring: false, recurrenceMonths: null, notes: null, accountId: "main", paidByOwner: false,
  vat: null, documentRef: null, project: null, recurringExpenseId: null, dateEstimated: false, importRef: null, collaboratorId: null, engagementId: null, forMonth: null, createdAt: at, updatedAt: at,
}

const DATA: Record<string, unknown> = {}
function reset() {
  Object.assign(DATA, {
    getCompanyAccounts: [MAIN, SECOND],
    getCompanyMovements: [
      movement({ kind: "capital", direction: "in", amount: 2000, date: d("2026-09-10"), description: "Share capital" }),
      movement({ kind: "transfer", direction: "out", amount: 300, toAccountId: "second", date: d("2026-10-01"), description: "Transfer to Second Bank" }),
      movement({ kind: "income", direction: "in", amount: 650, accountId: "second", date: d("2026-10-01"), description: "Rent October", counterparty: "Room 2", project: "Flat Rental" }),
      movement({ kind: "deposit_held", direction: "in", amount: 700, accountId: "second", date: d("2026-10-01"), description: "Deposit", counterparty: "Room 2" }),
      movement({ kind: "vat", direction: "out", amount: 220, date: d("2026-10-02"), description: "VAT Q3", documentRef: "F24 02/10" }),
    ],
    getInvoices: [
      // Alpha Ltd: €7,650, €25 short; Beta: €1,000 + €220 VAT paid; Gamma: unpaid €2,000 + €440 VAT.
      invoice({ id: "i16", number: "16/2026", amount: 7650, vat: 0, paidDate: d("2026-10-05"), paidAccountId: "main" }),
      invoice({ id: "i15", clientId: "c2", number: "15/2026", amount: 1000, vat: 220, paidDate: d("2026-09-20"), paidAccountId: "main" }),
      invoice({ id: "i17", clientId: "c3", number: "17/2026", amount: 2000, vat: 440 }),
      // Paid since the book began with no account: To Chase.
      invoice({ id: "i14", clientId: "c3", number: "14/2026", amount: 100, vat: 0, paidDate: d("2026-09-15") }),
    ],
    getCompanyExpenses: [FEE],
    getCompanyLoans: [],
    getTenants: [{ id: "t1", firstName: "Marco", surname: "Gallo" }],
    getLeases: [{ id: "l1", tenantId: "t1", property: "Via Aurora 7", room: "Room 4", startDate: "2026-09-01", endDate: "2027-08-31" }],
    getClients: [
      { id: "c1", userId: "u1", name: "Alpha Ltd", isActive: true },
      { id: "c2", userId: "u1", name: "Beta Srl", isActive: true },
      { id: "c3", userId: "u1", name: "Gamma Spa", isActive: true },
    ],
  })
}

const createCompanyMovement = vi.fn()
const updateCompanyAccount = vi.fn()
const createCompanyAccount = vi.fn()
const deleteCompanyAccount = vi.fn()
const createCompanyExpense = vi.fn()
const createCompanyLoan = vi.fn()
const WRITES: Record<string, unknown> = {
  createCompanyMovement, updateCompanyAccount, createCompanyAccount, deleteCompanyAccount, createCompanyExpense, createCompanyLoan,
}
const off = vi.hoisted(() => new Set<string>())
vi.mock("@/modules", async (actual) => ({ ...(await actual<Record<string, unknown>>()), isModuleOn: (id: string) => !off.has(id) }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
/** The page's query string: Month End links to ?tab= and ?month=. */
const url = vi.hoisted(() => ({ search: "" }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(url.search),
}))
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy({}, { get: (_db, method) => WRITES[String(method)] ?? (() => Promise.resolve(DATA[String(method)] ?? [])) }),
  }),
}))
const downloadCsv = vi.fn()
vi.mock("@/lib/export", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  downloadCsv: (...a: unknown[]) => downloadCsv(...a),
}))

// Date only: fake timers would stall TanStack and findBy.
beforeAll(() => vi.setSystemTime(new Date(2026, 9, 8, 12)))
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  off.clear()
  reset()
  url.search = ""
  localStorage.clear()
  createCompanyMovement.mockReset().mockResolvedValue({ id: "new" })
  updateCompanyAccount.mockReset().mockResolvedValue(undefined)
  createCompanyAccount.mockReset().mockResolvedValue({ id: "acc-new" })
  deleteCompanyAccount.mockReset().mockResolvedValue(undefined)
  createCompanyExpense.mockReset().mockResolvedValue({ id: "cost-new" })
  createCompanyLoan.mockReset().mockResolvedValue({ id: "loan-new" })
  downloadCsv.mockReset()
})

async function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CashBookShell />
      <Toaster />
    </QueryClientProvider>,
  )
  await screen.findByRole("heading", { name: "Cash Book", level: 1 })
}

/** Radix Select by keyboard: jsdom has no pointer capture. */
async function pick(scope: HTMLElement, label: string, option: string) {
  fireEvent.keyDown(within(scope).getByRole("combobox", { name: label }), { key: "Enter" })
  fireEvent.keyDown(await screen.findByRole("option", { name: option }), { key: "Enter" })
}

describe("CashBookShell", () => {
  it("heads the page with the balance today, a row per account with its bank check, then what is owed and held", async () => {
    await show()
    const hero = within(screen.getByRole("region", { name: "Accounts" }))
    expect(hero.getByRole("heading", { name: "Balance today" })).toBeInTheDocument()
    expect(hero.getByText("€12,975.00")).toBeInTheDocument()
    // October so far, In − Out of every account (9,000 − 245), transfers aside.
    expect(hero.getByText("+€8,755.00").parentElement).toHaveTextContent("+€8,755.00 since 1 Oct, across 2 company accounts")
    // Main: 1000 + 2000 + 1220 − 300 − 220 + 7650 − 25.
    const main = within(hero.getByRole("article", { name: "Main Bank" }))
    expect(main.getByText("€11,325.00")).toBeInTheDocument()
    // The statement says 9,800 on 7 Oct: 1,525 went out that the book doesn't know of.
    expect(main.getByText("Doesn't match")).toBeInTheDocument()
    expect(main.getByText(/^Missing OUT of €1,525.00 on 07\/10\/2026/)).toBeInTheDocument()
    const second = within(hero.getByRole("article", { name: "Second Bank" }))
    expect(second.getByText("€1,650.00")).toBeInTheDocument()
    expect(second.getByText("Not checked")).toBeInTheDocument()
    expect(second.getByText(/^No bank balance typed yet/)).toBeInTheDocument()

    const owed = within(screen.getByRole("region", { name: "Summary" }))
    expect(owed.getByText("Deposits to give back").nextSibling).toHaveTextContent("€700.00")
    // Gamma owes 17/2026 incl. VAT.
    expect(owed.getByText("Clients owe you").nextSibling).toHaveTextContent("€2,440.00")
    expect(owed.getByText("SRL owes you").nextSibling).toHaveTextContent("€0.00")
    expect(owed.queryByText(/more than it owed/)).not.toBeInTheDocument()
    // Their detail is the tab, and focus goes with it.
    fireEvent.click(owed.getByRole("button", { name: "See Owed & Held" }))
    await waitFor(() => expect(screen.getByRole("tab", { name: "Owed & Held" })).toHaveFocus())
    expect(screen.getByRole("tab", { name: "Owed & Held" })).toHaveAttribute("aria-selected", "true")
  })

  it("says so when the SRL has paid you more than it owed, in the Owed & Held line", async () => {
    DATA.getCompanyLoans = [
      { id: "l9", userId: "u1", description: "Paid to the owner", direction: "from_company", amount: 2000, date: d("2026-10-03"), notes: null, accountId: "main", dateEstimated: false, importRef: null, createdAt: at, updatedAt: at },
    ]
    await show()
    const owed = within(screen.getByRole("region", { name: "Summary" }))
    expect(owed.getByText("SRL owes you").nextSibling).toHaveTextContent("€0.00")
    expect(owed.getByText("The SRL has paid you €2,000.00 more than it owed. Check the repayments.")).toBeInTheDocument()
  })

  it("reads October as a sheet: opening row, end-of-day balances, totals without the transfer", async () => {
    await show()
    const table = screen.getAllByRole("table")[0]
    expect(table).toHaveAccessibleName("Movements, October 2026, all accounts")
    const rows = within(table).getAllByRole("row").slice(1)
    expect(rows[0]).toHaveTextContent("Opening balance")
    // 1,000 opening + 2,000 capital + 1,220 invoice in September, each account's part beside it.
    expect(rows[0]).toHaveTextContent("€4,220.00")
    expect(rows[0]).toHaveTextContent("Main Bank €4,220.00 · Second Bank €0.00")
    // Each day under its own heading.
    expect(rows[1]).toHaveTextContent("01/10 Thursday")
    // 1 Oct: the transfer is one muted line under every account, with where it went, and the day ends once.
    const cells = (row: HTMLElement) => within(row).getAllByRole("cell")
    expect(cells(rows[2])[2]).toHaveTextContent("Main Bank")
    expect(cells(rows[2])[4]).toHaveTextContent("€300.00 → moved to Second Bank")
    expect(rows[2]).toHaveTextContent("Main Bank → Second Bank")
    // Money in is signed and green; the day's balance on its last line only.
    expect(within(cells(rows[3])[4]).getByText("+€650.00")).toHaveClass("text-green-700")
    expect(cells(rows[3])[1]).toHaveTextContent("Flat Rental")
    expect(rows[3]).not.toHaveTextContent("€5,570.00")
    expect(cells(rows[4])[5]).toHaveTextContent("€5,570.00")
    expect(rows[5]).toHaveTextContent("02/10 Friday")
    // Out has a minus in the text colour, the type under the description, the document as a chip.
    expect(cells(rows[6])[0]).toHaveTextContent("VAT (F24)")
    expect(cells(rows[6])[3]).toHaveTextContent("F24 02/10")
    expect(within(cells(rows[6])[4]).getByText("−€220.00")).not.toHaveClass("text-green-700")
    expect(cells(rows[6])[5]).toHaveTextContent("€5,350.00")

    const totals = within(screen.getByRole("region", { name: "October 2026 totals" }))
    expect(totals.getByText("In").nextSibling).toHaveTextContent("+€9,000.00")
    expect(totals.getByText("Out").nextSibling).toHaveTextContent("−€245.00")
    expect(totals.getByText("Net").nextSibling).toHaveTextContent("+€8,755.00")
    expect(totals.getByText("Transfers (net)").nextSibling).toHaveTextContent("€0.00")
    // October has not ended on the 8th: the figure is the balance so far, not a month end.
    expect(totals.getByText("Balance so far, 08/10/2026").nextSibling).toHaveTextContent("€12,975.00")
    expect(totals.getByText("Main Bank, so far")).toBeInTheDocument()

    // One account: the transfer is money in, outside In and Out, and came from Main Bank.
    await pick(document.body, "Account", "Second Bank")
    expect(within(screen.getByRole("region", { name: "October 2026 totals" })).getByText("Transfers (net)").nextSibling).toHaveTextContent("€300.00")
    expect(screen.getAllByRole("table")[0]).toHaveAccessibleName("Movements, October 2026, Second Bank")
    expect(screen.getAllByRole("table")[0]).toHaveTextContent("← moved from Main Bank")
  })

  it("filters the ledger by its search and by type, and says how many rows show", async () => {
    await show()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search movements" }), { target: { value: "room 2" } })
    const panel = within(screen.getByRole("tabpanel", { name: "Movements" }))
    expect(panel.getByText(/^Showing 2 of 6 rows\./)).toBeInTheDocument()
    expect(panel.queryByText("VAT (F24)")).not.toBeInTheDocument()
    fireEvent.click(panel.getByRole("button", { name: "Clear Filters" }))
    expect(screen.getByRole("searchbox", { name: "Search movements" })).toHaveValue("")

    fireEvent.click(panel.getByRole("button", { name: "Filters" }))
    const filters = await screen.findByRole("dialog")
    await pick(filters, "Type", "VAT (F24)")
    expect(panel.getByText(/^Showing 1 of 6 rows\./)).toBeInTheDocument()
    expect(panel.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument()
    // Totals count every row of the month, filters aside.
    expect(within(screen.getByRole("region", { name: "October 2026 totals" })).getByText("In").nextSibling).toHaveTextContent("+€9,000.00")
  })

  it("lists the months like the Verifica sheet, in the Summary, and what to chase", async () => {
    await show()
    // Five views (CashBook.dc): the months fold into the Summary.
    expect(within(screen.getByRole("tablist", { name: "Cash book views" })).getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Movements", "Summary", "Cost Centres", "Owed & Held", "To Chase 1",
    ])
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Summary" }))
    const sheet = within(await screen.findByRole("region", { name: "Months" }))
    const months = sheet.getAllByRole("row")
    expect(months.map((r) => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("September"), expect.stringContaining("October")]),
    )
    const september = months.find((r) => r.textContent?.includes("September"))!
    // In 3,220 (capital + invoice 15/2026); 14/2026 has no account, so it is not cash.
    expect(september).toHaveTextContent("€3,220.00")
    expect(september).toHaveTextContent("€4,220.00")
    expect(months.find((r) => r.textContent?.includes("October"))).toHaveTextContent("October (so far)")
    // On a phone each month is a card that names every balance: Main 4,220 and Second 0 at 30/09.
    const card = sheet.getAllByRole("button", { name: /^September/ }).find((b) => b.closest("li"))!
    expect(card).toHaveTextContent("Main Bank, 30/09€4,220.00")
    expect(card).toHaveTextContent("Second Bank, 30/09€0.00")
    expect(card).toHaveTextContent("Total€4,220.00")
    fireEvent.click(card)
    // The card goes with its tab: focus lands on the Movements tab, not on the page.
    await waitFor(() => expect(screen.getByRole("tab", { name: "Movements" })).toHaveFocus())
    expect(screen.getByRole("region", { name: "September 2026 totals" })).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole("tab", { name: /To Chase/ }))
    const item = (await screen.findByText("Invoice 14/2026 paid on 15/09/2026, no account")).closest("li")!
    // What it is in a word, then why, then where to fix it.
    expect(item).toHaveTextContent(/^Invoice 14\/2026 paid on 15\/09\/2026, no accountNo accountPaid since the Cash Book began/)
    expect(within(item).getByRole("button", { name: "Open Invoice" })).toBeInTheDocument()
  })

  it("lists no paid-with-no-account invoice to chase, and so no Open Invoice, without invoicing", async () => {
    off.add("invoicing")
    await show()
    expect(within(screen.getByRole("tablist", { name: "Cash book views" })).getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Movements", "Summary", "Cost Centres", "Owed & Held", "To Chase",
    ])
    fireEvent.mouseDown(screen.getByRole("tab", { name: "To Chase" }))
    expect(await screen.findByText("Nothing to chase")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open Invoice" })).toBeNull()
  })

  it("adds a transfer, and Save & Add Another keeps the day and the account", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Add Movement" }))
    const dialog = await screen.findByRole("dialog", { name: "Add Movement" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Transfer" }))
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "500" } })
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-10-06" } })
    await pick(dialog, "From Account", "Main Bank")
    await pick(dialog, "To Account", "Main Bank")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save & Add Another" }))
    expect(await within(dialog).findByText("Pick a different account from the one it left.")).toBeInTheDocument()

    await pick(dialog, "To Account", "Second Bank")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save & Add Another" }))
    await waitFor(() => expect(createCompanyMovement).toHaveBeenCalledTimes(1))
    expect(createCompanyMovement).toHaveBeenCalledWith("u1", {
      kind: "transfer", direction: "out", amount: 500, date: d("2026-10-06"), accountId: "main", toAccountId: "second",
      description: "Transfer to Second Bank", documentRef: null, project: null, counterparty: null, notes: null,
    })
    // Still open, the amount empty and focused, the day and accounts kept; the account remembered.
    await waitFor(() => expect(within(dialog).getByLabelText("Amount")).toHaveValue(null))
    expect(within(dialog).getByLabelText("Amount")).toHaveFocus()
    expect(within(dialog).getByLabelText("Date")).toHaveValue("2026-10-06")
    expect(within(dialog).getByRole("combobox", { name: "From Account" })).toHaveTextContent("Main Bank")
    expect(localStorage.getItem("cash-book:last-account")).toBe("main")
    // Said in the dialog, not in a toast that Esc would close before the dialog.
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Added: Transfer €500.00 from Main Bank to Second Bank. 1 row so far, €500.00 in all.",
    )
  })

  // §3 example 4: Room 2 pays €1,450 in one transfer, split into rent and deposit.
  it("keeps who paid on Save & Add Another, and says what is held when a deposit goes back", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Add Movement" }))
    const dialog = await screen.findByRole("dialog", { name: "Add Movement" })
    fireEvent.click(within(dialog).getByRole("button", { name: "In" }))
    await pick(dialog, "Type", "Rent & Other Income")
    expect(within(dialog).getByText("Who paid, e.g. Room 2.")).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "650" } })
    await pick(dialog, "Into Account", "Second Bank")
    fireEvent.change(within(dialog).getByLabelText("Paid By (optional)"), { target: { value: "Room 2" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save & Add Another" }))
    await waitFor(() => expect(createCompanyMovement).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(within(dialog).getByLabelText("Amount")).toHaveValue(null))
    expect(within(dialog).getByLabelText("Paid By (optional)")).toHaveValue("Room 2")

    // Room 3's deposit was never received in the book: returning it says so.
    fireEvent.click(within(dialog).getByRole("button", { name: "Out" }))
    await pick(dialog, "Type", "Deposit Returned")
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "900" } })
    fireEvent.change(within(dialog).getByLabelText("Whose Deposit"), { target: { value: "Room 3" } })
    expect(within(dialog).getByText(/^Room 3: nothing in the Cash Book under this name\. If it began before the book/)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Whose Deposit"), { target: { value: "Room 2" } })
    expect(within(dialog).getByText("Room 2: only €700.00 in the Cash Book, less than this. Check the amount and the name.")).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "700" } })
    expect(within(dialog).getByText("Room 2: €700.00 held now.")).toBeInTheDocument()

    // Second Bank opened on 1 Sep: a day before it stays out of the balance, said before saving.
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-08-31" } })
    expect(
      within(dialog).getByText("Before Second Bank opened (01/09/2026): counted as a deposit, not in the balance, which already includes it."),
    ).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "In" }))
    await pick(dialog, "Type", "Rent & Other Income")
    expect(
      within(dialog).getByText(
        "Before Second Bank opened (01/09/2026): it stays out of the balance and shows in To Chase. Change the date, or the account's opening date.",
      ),
    ).toBeInTheDocument()
  })

  it("puts focus back on the button that opened a dialog, and moves it to an empty account field", async () => {
    await show()
    const add = screen.getByRole("button", { name: "Add Movement" })
    add.focus()
    fireEvent.click(add)
    const dialog = await screen.findByRole("dialog", { name: "Add Movement" })
    // Two accounts and none remembered: no account is picked, and Save goes to it.
    fireEvent.change(within(dialog).getByLabelText("Amount Paid, VAT Included"), { target: { value: "10" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    expect(await within(dialog).findByText("Pick the account.")).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "From Account" })).toHaveFocus())
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Movement" })).not.toBeInTheDocument())
    await waitFor(() => expect(add).toHaveFocus())
  })

  it("asks whose deposit it is, and files rent under its project", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Add Movement" }))
    const dialog = await screen.findByRole("dialog", { name: "Add Movement" })
    fireEvent.click(within(dialog).getByRole("button", { name: "In" }))
    await pick(dialog, "Type", "Deposit Received")
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "900" } })
    await pick(dialog, "Into Account", "Second Bank")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    expect(await within(dialog).findByText("Say whose deposit it is, e.g. Room 2.")).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Whose Deposit"), { target: { value: "Room 2" } })
    expect(within(dialog).getByText("Room 2: €700.00 held now.")).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Whose Deposit"), { target: { value: "Room 3" } })
    fireEvent.change(within(dialog).getByLabelText("Cost Centre (optional)"), { target: { value: "Flat Rental" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(createCompanyMovement).toHaveBeenCalledWith("u1", expect.objectContaining({
        kind: "deposit_held", direction: "in", amount: 900, accountId: "second", counterparty: "Room 3",
        project: "Flat Rental", description: "Deposit Received", date: d("2026-10-08"),
      })),
    )
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Movement" })).not.toBeInTheDocument())
  })

  describe("the Rent fields", () => {
    const openRentRow = async () => {
      await show()
      fireEvent.click(screen.getByRole("button", { name: "Add Movement" }))
      const dialog = await screen.findByRole("dialog", { name: "Add Movement" })
      fireEvent.click(within(dialog).getByRole("button", { name: "In" }))
      await pick(dialog, "Type", "Rent & Other Income")
      return dialog
    }

    it("shows for a cost centre with leases, and for no other", async () => {
      const dialog = await openRentRow()
      expect(within(dialog).queryByRole("heading", { name: "Rent" })).not.toBeInTheDocument()
      fireEvent.change(within(dialog).getByLabelText("Cost Centre (optional)"), { target: { value: "Flat Rental" } })
      expect(within(dialog).queryByRole("heading", { name: "Rent" })).not.toBeInTheDocument()
      fireEvent.change(within(dialog).getByLabelText("Cost Centre (optional)"), { target: { value: "via aurora 7 " } })
      expect(await within(dialog).findByRole("heading", { name: "Rent" })).toBeInTheDocument()
      expect(within(dialog).getByRole("combobox", { name: "Lease (optional)" })).toHaveTextContent("None")
    })

    it("is hidden when the Rent module is off", async () => {
      off.add("rent")
      const dialog = await openRentRow()
      fireEvent.change(within(dialog).getByLabelText("Cost Centre (optional)"), { target: { value: "Via Aurora 7" } })
      await waitFor(() => expect(within(dialog).getByLabelText("Cost Centre (optional)")).toHaveValue("Via Aurora 7"))
      expect(within(dialog).queryByRole("heading", { name: "Rent" })).not.toBeInTheDocument()
    })

    it("saves the lease, the month of the date and the part with the row", async () => {
      const dialog = await openRentRow()
      fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "950" } })
      await pick(dialog, "Into Account", "Second Bank")
      fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-10-02" } })
      fireEvent.change(within(dialog).getByLabelText("Cost Centre (optional)"), { target: { value: "Via Aurora 7" } })
      await pick(dialog, "Lease (optional)", "Marco Gallo · Room 4 · Sep 2026 – Aug 2027")
      await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "For Month" })).toHaveTextContent("October 2026"))
      await pick(dialog, "For Month", "September 2026") // paid on 2 Oct for September
      fireEvent.click(within(dialog).getByRole("button", { name: "Contribution" }))
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
      await waitFor(() =>
        expect(createCompanyMovement).toHaveBeenCalledWith("u1", expect.objectContaining({
          kind: "income", amount: 950, project: "Via Aurora 7", leaseId: "l1", rentMonth: "2026-09", rentPart: "contribution", date: d("2026-10-02"),
        })),
      )
    })

    it("links a deposit to a lease without a month, and says when nothing is held for it yet", async () => {
      const dialog = await openRentRow()
      fireEvent.click(within(dialog).getByRole("button", { name: "Out" }))
      await pick(dialog, "Type", "Deposit Returned")
      fireEvent.change(within(dialog).getByLabelText("Cost Centre (optional)"), { target: { value: "Via Aurora 7" } })
      expect(await within(dialog).findByText("Link it to the lease so the Rent page shows what is held.")).toBeInTheDocument()
      await pick(dialog, "Lease", "Marco Gallo · Room 4 · Sep 2026 – Aug 2027")
      expect(within(dialog).queryByLabelText("For Month")).not.toBeInTheDocument()
      expect(within(dialog).getByText("Nothing held for this lease yet. Link the deposit received to it first.")).toBeInTheDocument()
    })

    it("saves no rent keys on a row that has no lease", async () => {
      const dialog = await openRentRow()
      fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "950" } })
      await pick(dialog, "Into Account", "Second Bank")
      fireEvent.change(within(dialog).getByLabelText("Cost Centre (optional)"), { target: { value: "Via Aurora 7" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
      await waitFor(() => expect(createCompanyMovement).toHaveBeenCalled())
      expect(Object.keys(createCompanyMovement.mock.calls[0][1])).not.toContain("leaseId")
    })
  })

  it("checks a bank balance live and saves it on the account", async () => {
    await show()
    // From the account that does not match: its row offers the check.
    fireEvent.click(within(screen.getByRole("article", { name: "Main Bank" })).getByRole("button", { name: "Check Balance" }))
    const dialog = await screen.findByRole("dialog", { name: "Check Balance" })
    const main = within(within(dialog).getByRole("region", { name: "Main Bank" }))
    fireEvent.change(main.getByLabelText("Bank Balance"), { target: { value: "11300" } })
    fireEvent.change(main.getByLabelText("On"), { target: { value: "2026-10-07" } })
    expect(main.getByText("Missing OUT of €25.00 on 07/10/2026")).toBeInTheDocument()
    fireEvent.change(main.getByLabelText("Bank Balance"), { target: { value: "11325" } })
    expect(main.getByText("Matches the bank on 07/10/2026")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Check" }))
    await waitFor(() =>
      expect(updateCompanyAccount).toHaveBeenCalledWith("u1", "main", { statementBalance: 11325, statementDate: d("2026-10-07") }),
    )
    expect(updateCompanyAccount).toHaveBeenCalledTimes(1)
  })

  it("compares a day before the last check, lists that month's rows, and keeps the newer check", async () => {
    await show()
    fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Check Balance" }))
    const dialog = await screen.findByRole("dialog", { name: "Check Balance" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Check" }))
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Type at least one bank balance.")

    // Main was checked on 7 Oct; on 30 Sep the book says 4,220.
    const main = within(within(dialog).getByRole("region", { name: "Main Bank" }))
    fireEvent.change(main.getByLabelText("On"), { target: { value: "2026-09-30" } })
    fireEvent.change(main.getByLabelText("Bank Balance"), { target: { value: "4000" } })
    expect(main.getByText("Missing OUT of €220.00 on 30/09/2026")).toBeInTheDocument()
    expect(main.getByText("Earlier than the last check, on 07/10/2026: compared only. Save Check keeps that one.")).toBeInTheDocument()
    // September's rows explain the gap: capital and invoice 15/2026.
    expect(main.getByText("2 rows from 01/09/2026 to 30/09/2026")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Check" }))
    expect(
      await screen.findByText("Main Bank: Missing OUT of €220.00 on 30/09/2026, not saved: the 07/10/2026 check is newer."),
    ).toBeInTheDocument()
    expect(updateCompanyAccount).not.toHaveBeenCalled()
  })

  it("refuses to delete an account with entries, and adds a new one", async () => {
    await show()
    fireEvent.keyDown(screen.getByRole("button", { name: /More/ }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Accounts" }))
    const dialog = await screen.findByRole("dialog", { name: "Company Accounts" })
    expect(within(dialog).getByRole("button", { name: "Delete Main Bank" })).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Cash Box" } })
    fireEvent.change(within(dialog).getByLabelText("Opening Balance"), { target: { value: "50" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Account" }))
    await waitFor(() =>
      expect(createCompanyAccount).toHaveBeenCalledWith("u1", { name: "Cash Box", openingBalance: 50, openingDate: d("2026-10-08") }),
    )
    expect(await within(dialog).findByRole("status")).toHaveTextContent("Cash Box added. Add the next one, or close.")
  })

  it("asks before deleting an account", async () => {
    DATA.getCompanyAccounts = [MAIN, SECOND, account({ id: "spare", name: "Spare Bank" })]
    await show()
    fireEvent.keyDown(screen.getByRole("button", { name: /More/ }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Accounts" }))
    const dialog = await screen.findByRole("dialog", { name: "Company Accounts" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete Spare Bank" }))
    const confirm = await screen.findByRole("alertdialog", { name: "Delete Spare Bank?" })
    expect(deleteCompanyAccount).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete Account" }))
    await waitFor(() => expect(deleteCompanyAccount).toHaveBeenCalledWith("u1", "spare"))
    expect(await within(dialog).findByRole("status")).toHaveTextContent("Spare Bank deleted.")
  })

  it("exports a month of one account and one cost centre, rows and summaries, for the accountant", async () => {
    await show()
    fireEvent.keyDown(screen.getByRole("button", { name: /More/ }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Export" }))
    const dialog = await screen.findByRole("dialog", { name: "Export" })
    // This month, every account and cost centre by default.
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "7 rows from 01/10/2026 to 31/10/2026, then the summaries. File: cash-book_2026-10_all-accounts_all-cost-centres.csv",
    )
    await pick(dialog, "Period", "A Month")
    await pick(dialog, "Month", "September 2026")
    await pick(dialog, "Account", "Main Bank")
    await pick(dialog, "Cost Centre", "Consulting")
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "1 row from 01/09/2026 to 30/09/2026, then the summaries. One account: its cost centres leave out supplier invoices and costs paid with your card.",
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Download CSV" }))
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [csv, file] = downloadCsv.mock.calls[0] as [string, string]
    expect(file).toBe("cash-book_2026-09_main-bank_consulting.csv")
    const lines = csv.slice(1).trimEnd().split("\r\n")
    expect(lines[1]).toBe("20/09/2026;Main Bank;Client Invoice Payment;Invoice 15/2026 · Beta Srl;15/2026;Consulting;;1220,00;;220,00;;")
    // Main from 1,000: capital 2,000 and the invoice in, whatever the cost centre.
    expect(lines).toContain("Main Bank;1000,00;3220,00;0,00;4220,00")
    expect(lines).toContain("Consulting;1000,00;0,00;1000,00;Gain;0,00;0,00")
    expect(lines.at(-1)).toMatch(/^Management record/)
    expect(await screen.findByText("Exported 1 row, 01/09/2026 to 30/09/2026, Main Bank, Consulting.")).toBeInTheDocument()
  })

  it("starts with an empty book by asking for the first account, and keeps the dialog as the page fills in", async () => {
    DATA.getCompanyAccounts = []
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Add Your First Account" }))
    const dialog = await screen.findByRole("dialog", { name: "Company Accounts" })
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Main Bank" } })
    fireEvent.change(within(dialog).getByLabelText("Opening Balance"), { target: { value: "1000" } })
    createCompanyAccount.mockImplementation(async () => {
      DATA.getCompanyAccounts = [MAIN]
      return { id: "main" }
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Account" }))
    // The page swaps to the full book behind it; the dialog is the same one, not a remount.
    expect(await screen.findByRole("region", { name: "Accounts", hidden: true })).toBeInTheDocument()
    expect(screen.getByRole("dialog", { name: "Company Accounts" })).toBe(dialog)
    expect(within(dialog).getByRole("status")).toHaveTextContent("Main Bank added.")
    await act(async () => {})
  })

  it("offers Import Excel on an empty book and under More, and Undo Import only once something came from the workbook", async () => {
    DATA.getCompanyAccounts = []
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Import Excel" }))
    expect(await screen.findByRole("dialog", { name: "Import Excel" })).toHaveTextContent("The file stays in your browser")
    fireEvent.click(within(screen.getByRole("dialog", { name: "Import Excel" })).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    // Second Bank holds rows typed by hand: it stays. Third Bank holds nothing: it goes.
    DATA.getCompanyAccounts = [MAIN, { ...SECOND, importRef: "2026:Saldo!3" }, account({ id: "third", name: "Third Bank", importRef: "2026:Saldo!4" })]
    await act(async () => {})
    cleanup()
    await show()
    fireEvent.keyDown(screen.getByRole("button", { name: /More/ }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Undo Import" }))
    const undo = await screen.findByRole("dialog", { name: "Undo Import" })
    expect(undo).toHaveTextContent("Deletes the 1 account it created.")
    expect(undo).toHaveTextContent("Keeps Second Bank: it holds rows that did not come from the workbook.")
  })
})

// §3 examples 3 and 5: a €12,000 supplier invoice half paid, a fridge on the owner's
// card, a laptop from Main Bank, a €5,000 loan into it and a Google estimate.
describe("CashBookShell, costs and loans", () => {
  const cost = (o: Partial<CompanyExpense> & Pick<CompanyExpense, "id" | "description" | "amount">): CompanyExpense => ({
    ...FEE, accountId: null, vat: 0, ...o,
  })
  const BILL = cost({ id: "bill", description: "Renovation", category: "other", amount: 12000, documentRef: "FPR 40/26", project: "Flat Rental", date: d("2026-10-03") })
  const FRIDGE = cost({ id: "fridge", description: "Fridge", category: "office_supplies", amount: 480, paidByOwner: true, documentRef: "R 9", project: "Flat Rental", date: d("2026-10-04") })
  const LAPTOP = cost({ id: "laptop", description: "Laptop", category: "office_supplies", amount: 800, vat: 176, accountId: "main", documentRef: "FT 12", project: "Consulting", date: d("2026-10-06") })
  const GOOGLE = cost({ id: "google", description: "Google Workspace", category: "software", amount: 12, isRecurring: true, recurrenceMonths: 1, date: d("2026-01-01") })
  const LOAN: CompanyLoan = {
    id: "l1", userId: "u1", description: "Shareholder loan", direction: "to_company", amount: 5000, date: d("2026-10-02"),
    notes: null, accountId: "main", dateEstimated: false, importRef: null, createdAt: at, updatedAt: at,
  }

  beforeEach(() => {
    DATA.getCompanyExpenses = [FEE, BILL, FRIDGE, LAPTOP, GOOGLE]
    DATA.getCompanyLoans = [LOAN]
    DATA.getCompanyMovements = [
      ...(DATA.getCompanyMovements as CompanyMovement[]),
      movement({ kind: "supplier_payment", direction: "out", amount: 5000, expenseId: "bill", date: d("2026-10-07"), description: "Payment of FPR 40/26", documentRef: "FPR 40/26", project: "Flat Rental" }),
    ]
  })

  it("counts the laptop and the loan on Main Bank, and says what is owed both ways", async () => {
    await show()
    // 11,325 + 5,000 loan − 976 laptop − 5,000 to the supplier.
    expect(within(screen.getByRole("region", { name: "Accounts" })).getByText("€10,349.00")).toBeInTheDocument()
    const owed = within(screen.getByRole("region", { name: "Summary" }))
    expect(owed.getByText("You owe suppliers").nextSibling).toHaveTextContent("€7,000.00")
    // The loan and the fridge.
    expect(owed.getByText("SRL owes you").nextSibling).toHaveTextContent("€5,480.00")
    const sheet = within(screen.getByRole("tabpanel", { name: "Movements" }))
    const laptop = within(sheet.getAllByRole("row").find((r) => r.textContent?.startsWith("Laptop"))!).getAllByRole("cell")
    expect(laptop[0]).toHaveTextContent("Cost: Office Supplies")
    expect(laptop[1]).toHaveTextContent("Consulting")
    expect(laptop[3]).toHaveTextContent("FT 12")
    expect(laptop[4]).toHaveTextContent("−€976.00")
    // A phone reads the same in the row's two lines.
    expect(laptop[0]).toHaveTextContent("Main Bank · Consulting · FT 12")
    expect(sheet.getByText("Shareholder Loan")).toBeInTheDocument()
    // The card's fridge and the unpaid invoice move no account: not in the sheet.
    expect(sheet.queryByText("Fridge")).not.toBeInTheDocument()

    fireEvent.click(sheet.getByRole("button", { name: "Laptop" }))
    const edit = await screen.findByRole("dialog", { name: "Edit Cost" })
    expect(within(edit).getByRole("combobox", { name: "Paid From" })).toHaveTextContent("Main Bank")
    expect(within(edit).getByText("Total paid:")).toHaveTextContent("€976.00")
  })

  it("gives each cost centre its gain or loss, deposits and loans apart", async () => {
    await show()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Cost Centres" }))
    const panel = within(await screen.findByRole("tabpanel", { name: "Cost Centres" }))
    const card = (name: string) => panel.getByRole("heading", { name }).closest("li")!
    // Invoice 16/2026 net, less the laptop.
    expect(card("Consulting")).toHaveTextContent("Income€7,650.00Costs€800.00ResultGain €6,850.00")
    // Rent 650; the €12,000 invoice at its date and the fridge, never the €5,000 payment.
    expect(card("Flat Rental")).toHaveTextContent("Income€650.00Costs€12,480.00ResultLoss €11,830.00")
    expect(card("Untagged")).toHaveTextContent("ResultLoss €25.00")
    expect(card("Untagged")).toHaveTextContent("Apart, not in the result: tenants' deposits €700.00 (received less returned).")
    expect(card("All Cost Centres")).toHaveTextContent("ResultLoss €5,005.00")
    expect(panel.getByText(/Shareholder loans in October 2026: €5,000.00 lent to the SRL, €0.00 paid back to you\./)).toBeInTheDocument()

    expect(panel.getByText(/A supplier invoice counts at its date, never its payments; costs paid with your own card count too\./)).toBeInTheDocument()

    fireEvent.click(panel.getByRole("button", { name: "Year 2026" }))
    // September's invoices join Consulting: 15/2026, and 14/2026, paid with no account but paid.
    expect(card("Consulting")).toHaveTextContent("Income€8,750.00Costs€800.00ResultGain €7,950.00")

    // Through one account, the supplier invoice and the card's fridge are left out, and the help says so.
    await pick(document.body, "Account", "Main Bank")
    expect(panel.queryByRole("heading", { name: "Flat Rental" })).not.toBeInTheDocument()
    expect(panel.queryByText(/A supplier invoice counts at its date/)).not.toBeInTheDocument()
    expect(
      panel.getByText(/through Main Bank, net of VAT\. .*Supplier invoices and costs paid with your own card went through no account, so they are left out here: choose All Accounts to see them\./),
    ).toBeInTheDocument()
  })

  it("lists who owes what, and Pay fills in the supplier payment, never more than owed", async () => {
    await show()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Owed & Held" }))
    const panel = within(await screen.findByRole("tabpanel", { name: "Owed & Held" }))
    expect(within(panel.getByRole("region", { name: "Clients Owe You" })).getByText("Gamma Spa").nextSibling).toHaveTextContent("€2,440.00")
    expect(within(panel.getByRole("region", { name: "Deposits to Give Back" })).getByText("Room 2").nextSibling).toHaveTextContent("€700.00")
    const owner = within(panel.getByRole("region", { name: "SRL Owes You" }))
    expect(owner.getByText("Lent to the SRL").nextSibling).toHaveTextContent("€5,000.00")
    expect(owner.getByText("Costs paid with your card").nextSibling).toHaveTextContent("€480.00")
    expect(owner.getByText("Paid back to you").nextSibling).toHaveTextContent("€0.00")
    const suppliers = within(panel.getByRole("region", { name: "You Owe Suppliers" }))
    expect(suppliers.getByText("€7,000.00 owed")).toBeInTheDocument()

    fireEvent.click(suppliers.getByRole("button", { name: "Pay FPR 40/26" }))
    const dialog = await screen.findByRole("dialog", { name: "Add Movement" })
    expect(within(dialog).getByRole("combobox", { name: "Type" })).toHaveTextContent("Supplier Invoice Payment")
    expect(within(dialog).getByLabelText("Amount")).toHaveValue(7000)
    expect(within(dialog).getByText("€12,000.00 in all, €5,000.00 paid before: €0.00 owed after this.")).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "7500" } })
    await pick(dialog, "From Account", "Main Bank")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    expect(await within(dialog).findByText("Only €7,000.00 is owed on FPR 40/26. Record anything more as a Cost.")).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "7000" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(createCompanyMovement).toHaveBeenCalledWith("u1", {
        kind: "supplier_payment", direction: "out", amount: 7000, date: d("2026-10-08"), accountId: "main", toAccountId: null,
        description: "Supplier Invoice Payment", documentRef: "FPR 40/26", project: "Flat Rental", counterparty: null, notes: null,
        expenseId: "bill",
      }),
    )
  })

  it("does not offer Collaborators as a cost category: a collaborator's invoice is recorded from Costs", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Add Movement" }))
    const dialog = await screen.findByRole("dialog", { name: "Add Movement" })
    fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Category" }), { key: "Enter" })
    expect(await screen.findByRole("option", { name: "Software & Tools" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Collaborators" })).not.toBeInTheDocument()
  })

  it("adds a cost with its VAT, linked to the estimate it pays, and a repayment to the owner", async () => {
    localStorage.setItem("cash-book:last-account", "main")
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Add Movement" }))
    let dialog = await screen.findByRole("dialog", { name: "Add Movement" })
    expect(within(dialog).getByRole("combobox", { name: "Type" })).toHaveTextContent("Cost")
    fireEvent.change(within(dialog).getByLabelText("Amount Paid, VAT Included"), { target: { value: "14.64" } })
    fireEvent.change(within(dialog).getByLabelText("Of Which VAT (€)"), { target: { value: "2.64" } })
    await pick(dialog, "Category", "Software & Tools")
    fireEvent.change(within(dialog).getByLabelText("Description (optional)"), { target: { value: "Google, October" } })
    expect(within(dialog).getByRole("combobox", { name: "Pays Recurring Cost" })).toHaveTextContent("Google Workspace")
    expect(within(dialog).getByText('The Plan counts this cost instead of "Google Workspace" in October 2026.')).toBeInTheDocument()
    expect(within(dialog).getByText("€12.00")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(createCompanyExpense).toHaveBeenCalledWith("u1", {
        description: "Google, October", category: "software", amount: 12, vat: 2.64, date: d("2026-10-08"), isRecurring: false,
        accountId: "main", recurringExpenseId: "google", documentRef: null, project: null, notes: null,
      }),
    )
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Movement" })).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: "Add Movement" }))
    dialog = await screen.findByRole("dialog", { name: "Add Movement" })
    await pick(dialog, "Type", "Shareholder Loan Repayment")
    // Announced as it changes.
    expect(within(dialog).getByText("The SRL owes you €5,480.00 now.")).toHaveAttribute("role", "status")
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "6000" } })
    expect(within(dialog).getByText(/^More than the SRL owes you \(€5,480.00\)/)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "480" } })
    expect(within(dialog).getByText("The SRL owes you €5,480.00 now, €5,000.00 after this.")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(createCompanyLoan).toHaveBeenCalledWith("u1", {
        direction: "from_company", amount: 480, date: d("2026-10-08"), accountId: "main",
        description: "Shareholder Loan Repayment", notes: null,
      }),
    )
  })

  it("offers an estimate at the price in force on the payment date", async () => {
    DATA.getCompanyExpenses = [FEE, { ...GOOGLE, priceChanges: [{ from: "2026-10", amount: 15 }] }]
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Add Movement" }))
    const dialog = await screen.findByRole("dialog", { name: "Add Movement" })
    fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Pays Recurring Cost" }), { key: "Enter" })
    expect(await screen.findByRole("option", { name: "Google Workspace · €15.00" })).toBeInTheDocument()
  })

  it("stops a cost's or a loan's notes at 500 characters, as the records they become", async () => {
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Add Movement" }))
    const dialog = await screen.findByRole("dialog", { name: "Add Movement" })
    await pick(dialog, "Type", "Shareholder Loan Repayment")
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "100" } })
    await pick(dialog, "From Account", "Main Bank")
    fireEvent.change(within(dialog).getByLabelText("Notes (optional)"), { target: { value: "x".repeat(501) } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    expect(await within(dialog).findByText("Keep it under 500 characters.")).toBeInTheDocument()
    expect(createCompanyLoan).not.toHaveBeenCalled()
  })

  it("opens on the tab and month a link asks for, and ignores what it does not know", async () => {
    url.search = "?tab=chase&month=2026-09"
    await show()
    expect(screen.getByRole("tab", { name: /To Chase/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("Invoice 14/2026 paid on 15/09/2026, no account")).toBeInTheDocument()
    expect(screen.getByText("September 2026")).toBeInTheDocument()
    cleanup()

    url.search = "?tab=movements&month=2026-09"
    await show()
    expect(screen.getByRole("region", { name: "September 2026 totals" })).toBeInTheDocument()
    cleanup()

    // An unknown tab, a month that is not one, a month still to come: the page's own start.
    for (const search of ["?tab=ledger&month=2026-13", "?month=2026-11", "?month=sept"]) {
      url.search = search
      await show()
      expect(screen.getByRole("tab", { name: "Movements" })).toHaveAttribute("aria-selected", "true")
      expect(screen.getByRole("region", { name: "October 2026 totals" })).toBeInTheDocument()
      cleanup()
    }
  })
})
