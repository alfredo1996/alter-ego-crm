/**
 * The Summary tab's maths on made-up data: Main Bank and Second Bank opened on
 * 1 Sep 2026, a tenant called Room 2, a renovation invoice paid in part. Each
 * figure is worked out by hand in the comments, then held against the tab it
 * must equal.
 */
import { describe, expect, it } from "vitest"

import { bookRows, monthEnds, monthSheet } from "@/lib/cash-book"
import { cashFlowSummary } from "@/lib/cash-flow-summary"

import type { CompanyAccount, CompanyExpense, CompanyLoan, CompanyMovement, Invoice } from "@/types"

const at = new Date(2026, 4, 1)
const d = (day: string) => new Date(`${day}T00:00:00`)
let seq = 0

const account = (o: Partial<CompanyAccount> & Pick<CompanyAccount, "id" | "name">): CompanyAccount => ({
  userId: "u", openingBalance: 0, openingDate: d("2026-09-01"), statementBalance: null, statementDate: null,
  importRef: null, createdAt: at, updatedAt: at, ...o,
})
const movement = (o: Partial<CompanyMovement> & Pick<CompanyMovement, "kind" | "direction" | "amount" | "date">): CompanyMovement => ({
  id: `m${++seq}`, userId: "u", accountId: "main", toAccountId: null, expenseId: null, description: "Row",
  documentRef: null, project: null, counterparty: null, notes: null, dateEstimated: false, importRef: null,
  createdAt: new Date(2026, 4, 1, 0, 0, seq), updatedAt: at, ...o,
})
const expense = (o: Partial<CompanyExpense> & Pick<CompanyExpense, "id" | "amount" | "date" | "description">): CompanyExpense => ({
  userId: "u", category: "software", isRecurring: false, recurrenceMonths: null, notes: null, accountId: null,
  paidByOwner: false, vat: null, documentRef: null, project: null, recurringExpenseId: null, dateEstimated: false,
  importRef: null, collaboratorId: null, engagementId: null, forMonth: null, createdAt: at, updatedAt: at, ...o,
})

const accounts = [account({ id: "main", name: "Main Bank", openingBalance: 1000 }), account({ id: "second", name: "Second Bank" })]
const invoices: Invoice[] = [
  {
    id: "i15", userId: "u", clientId: "c1", engagementId: null, fromMonth: null, yearMonth: "2026-09", number: "15/2026",
    amount: 1000, vat: 220, dueDate: null, paidDate: d("2026-09-20"), paidAccountId: "main", createdAt: at, updatedAt: at,
  },
]
const expenses: CompanyExpense[] = [
  expense({ id: "g1", description: "Google Workspace", amount: 100, vat: 22, date: d("2026-10-03"), accountId: "main", project: "Consulting" }),
  expense({ id: "g2", description: "Google Workspace", amount: 100, vat: 22, date: d("2026-10-04"), accountId: "main", project: "Consulting" }),
  // Paid back into the account: money in.
  expense({ id: "refund", description: "Refund Google", amount: -50, date: d("2026-10-05"), accountId: "main", project: "Consulting" }),
  // The owner's card: a cost, no company money moved.
  expense({ id: "fridge", description: "Fridge", category: "office_supplies", amount: 480, vat: 0, date: d("2026-10-06"), paidByOwner: true, documentRef: "R 9", project: "Flat Rental" }),
  // A supplier invoice: only its payments move money.
  expense({ id: "bill", description: "Renovation", category: "other", amount: 4000, vat: 0, date: d("2026-10-07"), documentRef: "INV 40", project: "Flat Rental" }),
  // Recorded as not paid yet, with no supplier's document: no money moved.
  expense({ id: "ins", description: "Insurance", category: "insurance", amount: 300, date: d("2026-10-11"), project: "Flat Rental" }),
  // An estimate: never cash, never a cost of the period.
  expense({ id: "est", description: "Google Workspace", amount: 12, date: d("2026-01-01"), isRecurring: true, recurrenceMonths: 1 }),
]
const loans: CompanyLoan[] = [
  { id: "l1", userId: "u", description: "Shareholder loan", direction: "to_company", amount: 500, date: d("2026-10-08"), accountId: "main", notes: null, dateEstimated: false, importRef: null, createdAt: at, updatedAt: at },
]
const movements: CompanyMovement[] = [
  movement({ kind: "capital", direction: "in", amount: 2000, date: d("2026-09-10"), description: "Share capital" }),
  movement({ kind: "transfer", direction: "out", amount: 300, date: d("2026-10-01"), toAccountId: "second", description: "Transfer to Second Bank" }),
  movement({ kind: "income", direction: "in", amount: 650, date: d("2026-10-01"), accountId: "second", description: "Rent October", counterparty: "Room 2", project: "Flat Rental" }),
  movement({ kind: "deposit_held", direction: "in", amount: 700, date: d("2026-10-01"), accountId: "second", description: "Deposit", counterparty: "Room 2" }),
  movement({ kind: "vat", direction: "out", amount: 220, date: d("2026-10-02"), description: "VAT Q3", documentRef: "F24 02/10" }),
  movement({ kind: "supplier_payment", direction: "out", amount: 1500, date: d("2026-10-09"), expenseId: "bill", description: "Payment of INV 40", project: "Flat Rental" }),
  movement({ kind: "deposit_held", direction: "out", amount: 100, date: d("2026-10-10"), accountId: "second", description: "Part of the deposit back", counterparty: "Room 2" }),
]

const { counted } = bookRows({ accounts, invoices, expenses, loans, movements, clients: [{ id: "c1", name: "Alpha Ltd" }], engagements: [] })
const book = { accounts, counted, invoices, expenses, loans, movements }
const TODAY = "2026-10-20"
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" }

describe("cashFlowSummary", () => {
  it("adds up October under every account, transfers left out, deposits apart", () => {
    const s = cashFlowSummary(book, { ...OCTOBER, accountId: null }, TODAY)
    // In: rent 650 + loan 500 + refund 50 + deposit 700. Out: supplier 1,500 + Google 122 × 2 + VAT 220 + deposit back 100.
    expect([s.in, s.out, s.net]).toEqual([1900, 2064, -164])
    expect(s.income.map((g) => [g.label, g.amount, g.count])).toEqual([
      ["Rent & Other Income", 650, 1],
      ["Shareholder Loan", 500, 1],
      ["Refund: Software & Tools", 50, 1],
    ])
    expect(s.depositsIn.map((g) => [g.label, g.amount])).toEqual([["Deposit Received", 700]])
    // The payment says what it bought: the renovation invoice, category Other.
    expect(s.spending.map((g) => [g.label, g.amount, g.count])).toEqual([
      ["Supplier Invoice: Other", 1500, 1],
      ["Cost: Software & Tools", 244, 2],
      ["VAT (F24)", 220, 1],
    ])
    expect(s.depositsOut.map((g) => [g.label, g.amount])).toEqual([["Deposit Returned", 100]])
    // Shares are of all cash out, deposits included: together they make 100%.
    expect(s.spending[0].share).toBeCloseTo(1500 / 2064)
    expect([...s.spending, ...s.depositsOut].reduce((t, g) => t + g.share, 0)).toBeCloseTo(1)
    // The €300 transfer is in no total and no list, and nets to 0 under every account.
    expect([...s.spending, ...s.income].some((g) => g.label === "Transfer")).toBe(false)
    expect(s.transfers).toBe(0)
  })

  it("says how it was paid: each account moved money, the owner's card and unpaid supplier invoices did not", () => {
    const s = cashFlowSummary(book, { ...OCTOBER, accountId: null }, TODAY)
    // Main: 220 + 122 + 122 + 1,500 out, and the 300 moved to Second Bank apart, on both sides.
    expect(s.byAccount).toEqual([
      { accountId: "main", out: 1964, transfersOut: 300, transfersIn: 0 },
      { accountId: "second", out: 100, transfersOut: 0, transfersIn: 300 },
    ])
    // The fridge on the owner's card, €2,500 of the €4,000 renovation still owed on 31 Oct, the insurance on no account.
    expect(s.offBank).toEqual({
      ownerCard: { amount: 480, count: 1 },
      supplierOwed: { amount: 2500, count: 1 },
      noAccount: { amount: 300, count: 1 },
    })
    expect(s.out).not.toBe(2064 + 480)
    // On 8 Oct the payment was a day away: the whole invoice was owed.
    expect(cashFlowSummary(book, { from: "2026-10-01", to: "2026-10-08", accountId: null }, TODAY).offBank?.supplierOwed).toEqual({ amount: 4000, count: 1 })
  })

  it("splits the same money out by cost centre, in full, and names the biggest costs", () => {
    const s = cashFlowSummary(book, { ...OCTOBER, accountId: null }, TODAY)
    // Flat Rental: the 1,500 paid on the renovation. Consulting: Google 122 × 2, VAT included as paid. The F24 has none.
    expect(s.costCentres.map((c) => [c.name, c.amount])).toEqual([
      ["Flat Rental", 1500],
      ["Consulting", 244],
      ["Untagged", 220],
    ])
    // One basis: the cost centres add up to the money out listed above, deposits aside.
    const spent = s.spending.reduce((t, g) => t + g.amount, 0)
    expect(s.costCentres.reduce((t, c) => t + c.amount, 0)).toBe(spent)
    expect(spent).toBe(s.out - 100)
    expect(s.costCentres.reduce((t, c) => t + c.share, 0)).toBeCloseTo(1)
    // Costs and supplier invoices only, by what was bought: no F24, no loan, no deposit.
    expect(s.topCosts).toEqual([
      { name: "Renovation (INV 40)", amount: 1500, count: 1 },
      { name: "Google Workspace", amount: 244, count: 2 },
    ])
  })

  it("never makes a negative cost centre of a refund: it is money in", () => {
    // 5 Oct: the €50 refund into Main Bank, Consulting's only row that day.
    const s = cashFlowSummary(book, { from: "2026-10-05", to: "2026-10-05", accountId: null }, TODAY)
    expect(s.costCentres).toEqual([])
    expect(s.income).toEqual([{ label: "Refund: Software & Tools", amount: 50, count: 1, share: 1 }])
  })

  it("matches the Months tab month by month over a year, with no month before the opening or after today", () => {
    const s = cashFlowSummary(book, { from: "2026-01-01", to: "2026-12-31", accountId: null }, TODAY)
    const tab = monthEnds(accounts, counted, 2026, TODAY.slice(0, 7), null)
    expect(s.months.map((m) => m.ym)).toEqual(["2026-09", "2026-10"])
    expect(s.months.map((m) => [m.ym, m.in, m.out, m.net, [...m.ends]])).toEqual(tab.map((m) => [m.ym, m.in, m.out, m.net, [...m.ends]]))
    // September: capital 2,000 + invoice 1,220. Main at 31 Oct: 4,220 − 300 − 220 − 244 + 50 + 500 − 1,500.
    expect(s.months[0].in).toBe(3220)
    expect(s.months[1].ends).toEqual(new Map([["main", 2506], ["second", 1550]]))
    expect([s.in, s.out]).toEqual([5120, 2064])
    // The line starts at the opening, 1 Sep, not on 1 Jan before any account.
    expect(s.start).toEqual({ day: "2026-09-01", balances: new Map([["main", 1000], ["second", 0]]) })
  })

  it("keeps to one account: its transfer in is no income, yet it is counted, so the balance adds up", () => {
    const s = cashFlowSummary(book, { ...OCTOBER, accountId: "second" }, TODAY)
    expect([s.in, s.out]).toEqual([1350, 100])
    expect(s.income.map((g) => g.label)).toEqual(["Rent & Other Income"])
    expect(s.spending).toEqual([])
    expect(s.byAccount).toEqual([{ accountId: "second", out: 100, transfersOut: 0, transfersIn: 300 }])
    expect(s.offBank).toBeNull()
    // The deposit given back went to no cost centre.
    expect(s.costCentres).toEqual([])
    const tab = monthEnds(accounts, counted, 2026, "2026-10", "second")
    expect(s.months.map((m) => [m.in, m.out, [...m.ends]])).toEqual([[tab[1].in, tab[1].out, [...tab[1].ends]]])
    // The Movements tab's Transfers (net), and opening 0 + net 1,250 + transfers 300 = closing 1,550.
    expect(s.transfers).toBe(monthSheet(accounts, counted, "2026-10", "second").transfers)
    expect(s.start?.balances.get("second")).toBe(0)
    expect(s.start!.balances.get("second")! + s.net + s.transfers).toBe(s.months[0].ends.get("second"))
  })

  it("counts an account that only received a transfer", () => {
    const pair = [account({ id: "main", name: "Main Bank", openingBalance: 1000 }), account({ id: "second", name: "Second Bank" })]
    const moved = [movement({ kind: "transfer", direction: "out", amount: 300, date: d("2026-10-01"), toAccountId: "second", description: "Top up" })]
    const rows = bookRows({ accounts: pair, invoices: [], expenses: [], loans: [], movements: moved, clients: [], engagements: [] }).counted
    const s = cashFlowSummary({ accounts: pair, counted: rows, invoices: [], expenses: [], loans: [], movements: moved }, { ...OCTOBER, accountId: "second" }, TODAY)
    expect([s.in, s.out, s.net, s.transfers]).toEqual([0, 0, 0, 300])
    expect(s.byAccount).toEqual([{ accountId: "second", out: 0, transfersOut: 0, transfersIn: 300 }])
    expect(s.months[0].ends.get("second")).toBe(300)
  })

  it("never counts a row in a total that no month shows: a cost dated after today gets its month", () => {
    const later = [...expenses, expense({ id: "nov", description: "Chairs", category: "office_supplies", amount: 1000, vat: 220, date: d("2026-11-15"), accountId: "main", project: "Consulting" })]
    const rows = bookRows({ accounts, invoices, expenses: later, loans, movements, clients: [{ id: "c1", name: "Alpha Ltd" }], engagements: [] }).counted
    const s = cashFlowSummary({ ...book, counted: rows, expenses: later }, { from: "2026-01-01", to: "2026-12-31", accountId: null }, TODAY)
    expect(s.months.map((m) => m.ym)).toEqual(["2026-09", "2026-10", "2026-11"])
    expect(s.out).toBe(2064 + 1220)
    expect([s.in, s.out]).toEqual([s.months.reduce((t, m) => t + m.in, 0), s.months.reduce((t, m) => t + m.out, 0)])
    // Up to this month the Months tab is unchanged.
    expect(s.months.slice(0, 2).map((m) => [m.ym, m.in, m.out])).toEqual(monthEnds(accounts, rows, 2026, "2026-10", null).map((m) => [m.ym, m.in, m.out]))
    // A future month holding nothing shows no month at all.
    expect(cashFlowSummary(book, { from: "2026-12-01", to: "2026-12-31", accountId: null }, TODAY).months).toEqual([])
  })

  it("cuts a date range inside a month, its balances at the range's last day", () => {
    const s = cashFlowSummary(book, { from: "2026-10-02", to: "2026-10-05", accountId: null }, TODAY)
    // Refund 50 in; VAT 220 + Google 122 × 2 out. Main on 5 Oct: 4,220 − 300 − 220 − 244 + 50.
    expect([s.in, s.out]).toEqual([50, 464])
    expect(s.months).toHaveLength(1)
    expect(s.months[0].ends.get("main")).toBe(3506)
    // At the start of 2 Oct: Main 4,220 − 300; Second 300 + 650 + 700.
    expect(s.start).toEqual({ day: "2026-10-02", balances: new Map([["main", 3920], ["second", 1650]]) })
    // The renovation is dated after the range: nothing owed in it.
    expect(s.offBank?.supplierOwed).toEqual({ amount: 0, count: 0 })
  })

  it("is empty before the book began", () => {
    const s = cashFlowSummary(book, { from: "2026-03-01", to: "2026-03-31", accountId: null }, TODAY)
    expect([s.in, s.out, s.months, s.start, s.spending, s.topCosts]).toEqual([0, 0, [], null, [], []])
  })
})
