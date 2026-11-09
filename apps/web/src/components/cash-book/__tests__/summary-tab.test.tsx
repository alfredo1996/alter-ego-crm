/**
 * The Summary tab on made-up data (October 2026, today the 20th): Main Bank and
 * Second Bank, a tenant called Room 2, a supplier invoice paid in part, a fridge
 * on the owner's card. The maths is lib/__tests__/cash-flow-summary.test.ts; this
 * checks each figure is on screen with its label, and that the period and the
 * account change them.
 */
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { bookRows } from "@/lib/cash-book"

import { SummaryTab } from "../summary-tab"

import type { CompanyAccount, CompanyExpense, CompanyMovement } from "@/types"

const at = new Date(2026, 4, 1)
const d = (day: string) => new Date(`${day}T00:00:00`)
let seq = 0
const account = (id: string, name: string, openingBalance: number): CompanyAccount => ({
  id, name, userId: "u1", openingBalance, openingDate: d("2026-09-01"), statementBalance: null, statementDate: null,
  importRef: null, createdAt: at, updatedAt: at,
})
const movement = (o: Partial<CompanyMovement> & Pick<CompanyMovement, "kind" | "direction" | "amount" | "date">): CompanyMovement => ({
  id: `m${++seq}`, userId: "u1", accountId: "main", toAccountId: null, expenseId: null, description: "Row",
  documentRef: null, project: null, counterparty: null, notes: null, dateEstimated: false, importRef: null,
  createdAt: new Date(2026, 4, 1, 0, 0, seq), updatedAt: at, ...o,
})
const expense = (o: Partial<CompanyExpense> & Pick<CompanyExpense, "id" | "amount" | "date" | "description">): CompanyExpense => ({
  userId: "u1", category: "software", isRecurring: false, recurrenceMonths: null, notes: null, accountId: null,
  paidByOwner: false, vat: null, documentRef: null, project: null, recurringExpenseId: null, dateEstimated: false,
  importRef: null, collaboratorId: null, engagementId: null, forMonth: null, createdAt: at, updatedAt: at, ...o,
})

const accounts = [account("main", "Main Bank", 1000), account("second", "Second Bank", 0)]
const expenses = [
  expense({ id: "g", description: "Google Workspace", amount: 100, vat: 22, date: d("2026-10-03"), accountId: "main", project: "Consulting" }),
  expense({ id: "fridge", description: "Fridge", category: "office_supplies", amount: 480, vat: 0, date: d("2026-10-06"), paidByOwner: true, documentRef: "R 9", project: "Flat Rental" }),
  expense({ id: "bill", description: "Renovation", category: "other", amount: 4000, vat: 0, date: d("2026-10-07"), documentRef: "INV 40", project: "Flat Rental" }),
]
const movements = [
  movement({ kind: "capital", direction: "in", amount: 2000, date: d("2026-09-10"), description: "Share capital" }),
  movement({ kind: "transfer", direction: "out", amount: 300, date: d("2026-10-01"), toAccountId: "second", description: "Transfer to Second Bank" }),
  movement({ kind: "income", direction: "in", amount: 650, date: d("2026-10-01"), accountId: "second", description: "Rent October", counterparty: "Room 2", project: "Flat Rental" }),
  movement({ kind: "deposit_held", direction: "in", amount: 700, date: d("2026-10-01"), accountId: "second", description: "Deposit", counterparty: "Room 2" }),
  movement({ kind: "vat", direction: "out", amount: 220, date: d("2026-10-02"), description: "VAT Q3" }),
  movement({ kind: "supplier_payment", direction: "out", amount: 1500, date: d("2026-10-09"), expenseId: "bill", description: "Payment of INV 40" }),
]
const data = { invoices: [], expenses, loans: [], movements }
const { counted } = bookRows({ accounts, ...data, clients: [], engagements: [] })

const tab = (ym: string, accountId: string | null, onMonth: (ym: string) => void, onShowMonth = vi.fn()) => (
  <SummaryTab
    accounts={accounts}
    counted={counted}
    data={data}
    today="2026-10-20"
    ym={ym}
    onMonth={onMonth}
    onShowMonth={onShowMonth}
    accountId={accountId}
  />
)

function show(accountId: string | null = null, onMonth = vi.fn(), ym = "2026-10", onShowMonth = vi.fn()) {
  const { rerender } = render(tab(ym, accountId, onMonth, onShowMonth))
  return { onMonth, onShowMonth, rerender }
}

const section = (name: string) => within(screen.getByRole("region", { name }))
const total = (label: string) => section("Period totals").getByText(label).nextSibling

/** Radix Select by keyboard: happy-dom has no pointer capture. */
async function pick(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" })
  fireEvent.keyDown(await screen.findByRole("option", { name: option }), { key: "Enter" })
}

describe("SummaryTab", () => {
  it("sums up October: totals, where it went and came from, deposits apart, how it was paid", () => {
    show()
    expect(screen.getByText(/Every account, 01\/10\/2026 to 31\/10\/2026 \(so far\)/)).toBeInTheDocument()
    // In: rent 650 + deposit 700. Out: supplier 1,500 + VAT 220 + Google 122. One money convention: + in, − out.
    expect(total("Money In")).toHaveTextContent(/^\+€1,350\.00$/)
    expect(total("Money Out")).toHaveTextContent(/^−€1,842\.00$/)
    expect(total("Net")).toHaveTextContent(/^−€492\.00$/)
    expect(section("Period totals").getByText("€492.00 more went out than came in.")).toBeInTheDocument()

    const went = section("Where the Money Went")
    const items = went.getAllByRole("listitem").map((li) => li.textContent)
    // The payment names what it bought: the renovation invoice, category Other.
    expect(items).toEqual([
      "Supplier Invoice: Other · 1 row€1,500.00 81%",
      "VAT (F24) · 1 row€220.00 12%",
      "Cost: Software & Tools · 1 row€122.00 7%",
    ])
    expect(section("Where It Came From").getByText("Deposits, Apart")).toBeInTheDocument()
    expect(section("Where It Came From").getByText("Deposit Received")).toBeInTheDocument()

    const paid = section("How It Was Paid")
    expect(paid.getByText("Out of Main Bank").nextSibling).toHaveTextContent("€1,842.00")
    expect(paid.getByText("Also moved €300.00 to your other accounts: not spending.")).toBeInTheDocument()
    expect(paid.getByText("Received €300.00 from your other accounts: not income.")).toBeInTheDocument()
    expect(paid.getByText("Your personal card").nextSibling).toHaveTextContent("€480.00")
    // What happened, not a debt: the repayment may already have settled it.
    expect(paid.getByText(/^1 cost you paid with your own card, dated in the period\./)).toBeInTheDocument()
    expect(paid.queryByText(/owes it to you/)).toBeNull()
    expect(paid.getByText("Supplier invoices not paid yet").nextSibling).toHaveTextContent("€2,500.00")
    expect(paid.getByText("Still owed today on 1 supplier invoice dated in the period.")).toBeInTheDocument()

    // The same money out by cost centre, in full: the payment takes its invoice's; the F24 has none.
    expect(section("Money Out by Cost Centre").getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Flat Rental€1,500.00 81%",
      "Untagged€220.00 12%",
      "Consulting€122.00 7%",
    ])
    expect(section("Biggest Costs").getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Renovation (INV 40) · 1 payment€1,500.00",
      "Google Workspace · 1 payment€122.00",
    ])
    // Every account together: transfers net to nothing, no tile.
    expect(section("Period totals").queryByText("Transfers (Net)")).toBeNull()
    // No tax estimate of any kind.
    expect(screen.queryByText(/Available|Not Yet Paid|Estimate/)).toBeNull()
  })

  it("draws both charts with a title, and gives their figures as a table", () => {
    show()
    expect(screen.getByRole("img", { name: /Money in and out by month/ })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /Balance at the start and at each month end/ })).toBeInTheDocument()

    const [inOut, balances] = screen.getAllByRole("button", { name: "Show as Table" })
    fireEvent.click(inOut)
    // The button says what it does next.
    expect(inOut).toHaveTextContent("Show as Chart")
    const rows = within(section("Money In and Out by Month").getByRole("table")).getAllByRole("row")
    expect(rows[1]).toHaveTextContent("October 2026 (so far)€1,350.00€1,842.00−€492.00")

    fireEvent.click(balances)
    // The start of October, as on Movements: Main 1,000 + 2,000; Second not a cent yet.
    const rows2 = within(section("Balances Over Time").getByRole("table")).getAllByRole("row")
    expect(rows2[1]).toHaveTextContent("Start, 01/10/2026€3,000.00€0.00€3,000.00")
    // Main: 3,000 − 300 − 220 − 122 − 1,500. Second: 300 + 650 + 700.
    expect(rows2[2]).toHaveTextContent("End of October 2026 (so far)€858.00€1,650.00€2,508.00")
    fireEvent.click(inOut)
    expect(screen.getByRole("img", { name: /Money in and out by month/ })).toBeInTheDocument()
  })

  it("takes the year to date, and A Month moves the page's month", async () => {
    const { onMonth, rerender } = show()
    await pick("Period", "This Year (2026)")
    // September's capital joins October.
    expect(total("Money In")).toHaveTextContent("€3,350.00")
    fireEvent.click(screen.getAllByRole("button", { name: "Show as Table" })[0])
    const months = within(section("Money In and Out by Month").getByRole("table")).getAllByRole("row").map((r) => r.textContent)
    expect(months.slice(1, 3)).toEqual(["September 2026€2,000.00€0.00+€2,000.00", "October 2026 (so far)€1,350.00€1,842.00−€492.00"])

    await pick("Period", "A Month")
    expect(onMonth).toHaveBeenCalledWith("2026-09")

    // The page's arrows, pressed in year mode: the Summary follows them into that month.
    await pick("Period", "This Year (2026)")
    rerender(tab("2026-09", null, onMonth))
    expect(screen.getByRole("combobox", { name: "Period" })).toHaveTextContent("A Month")
    expect(screen.getByRole("combobox", { name: "Month" })).toHaveTextContent("September 2026")
    expect(total("Money In")).toHaveTextContent("€2,000.00")
  })

  it("lists the year month by month, the old Months tab, and opens a month in Movements", () => {
    const { onShowMonth } = show()
    const months = within(screen.getByRole("region", { name: "Months" }))
    const rows = months.getAllByRole("row").map((r) => r.textContent)
    // Month, In, Out, Net, Main, Second, Total. September: the capital; Second Bank opened on 1 September with nothing.
    expect(rows.slice(1)).toEqual([
      "September€2,000.00€0.00+€2,000.00€3,000.00€0.00€3,000.00",
      "October (so far)€1,350.00€1,842.00−€492.00€858.00€1,650.00€2,508.00",
    ])
    fireEvent.click(months.getByRole("button", { name: "September" }))
    expect(onShowMonth).toHaveBeenCalledWith("2026-09")
    // Its help is with the rest, in one disclosure.
    expect(screen.getByText("How this is counted").closest("details")).toHaveTextContent("Months: each balance is the one at the month's last day")
  })

  it("lists the months of the period's year, not the page month's, in a book across two years", async () => {
    // February 2027: the book runs from September 2026, so A Year opens on 2026.
    render(<SummaryTab accounts={accounts} counted={counted} data={data} today="2027-02-10" ym="2027-02" onMonth={vi.fn()} onShowMonth={vi.fn()} accountId={null} />)
    const monthsCard = () => within(screen.getByRole("region", { name: "Months" }))
    const monthNames = () => monthsCard().getAllByRole("row").slice(1).map((r) => r.firstChild?.textContent)
    expect(monthNames()).toEqual(["January", "February (so far)"])

    await pick("Period", "A Year")
    expect(screen.getByRole("combobox", { name: "Year" })).toHaveTextContent("2026")
    expect(monthsCard().getByText("2026, each balance on the month's last day")).toBeInTheDocument()
    expect(monthNames()).toEqual(["September", "October", "November", "December"])

    // A range takes the year of its last day.
    await pick("Period", "A Date Range")
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-01" } })
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-12-31" } })
    expect(monthNames()).toEqual(["September", "October", "November", "December"])
  })

  it("names a month the arrows reach after today, and says it has not started", () => {
    show(null, vi.fn(), "2026-11")
    expect(screen.getByRole("combobox", { name: "Month" })).toHaveTextContent("November 2026")
    expect(screen.getByText("This period has not started yet: nothing to sum up.")).toBeInTheDocument()
  })

  it("names a range's last balance by its day, not the month's end", async () => {
    show()
    await pick("Period", "A Date Range")
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-02" } })
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-05" } })
    fireEvent.click(within(screen.getByRole("region", { name: "Balances Over Time" })).getByRole("button", { name: "Show as Table" }))
    const rows = within(section("Balances Over Time").getByRole("table")).getAllByRole("row")
    // Main on 5 Oct: 3,000 − 300 − 220 − 122. Second: 300 + 650 + 700.
    expect(rows[2]).toHaveTextContent("End, 05/10/2026€2,358.00€1,650.00€4,008.00")
  })

  it("keeps to the account chosen on the page, and says where the off-bank costs went", () => {
    show("second")
    expect(screen.getByText(/^Second Bank, 01\/10\/2026/)).toBeInTheDocument()
    // The transfer in is no income: rent 650 + deposit 700.
    expect(total("Money In")).toHaveTextContent("€1,350.00")
    expect(total("Money Out")).toHaveTextContent("€0.00")
    // Yet the €300 from Main Bank is in its balance: shown apart, as on Movements.
    expect(total("Transfers (Net)")).toHaveTextContent("€300.00")
    expect(section("How It Was Paid").getByText(/choose All Accounts to see them/)).toBeInTheDocument()
    expect(section("Where the Money Went").getByText("Nothing went out.")).toBeInTheDocument()
  })
})
