/**
 * The cash book's read model on the plan's worked examples (§3), with made-up
 * names and amounts: Main Bank and Second Bank, a tenant called Room 2.
 */
import { describe, expect, it } from "vitest"

import {
  NON_CASH,
  accountInUse,
  balancesAt,
  bookRows,
  cashRows,
  chaseDay,
  checkAgainst,
  checkDetail,
  clientsOwe,
  CSV_NOTICE,
  costCentreTotals,
  deposits,
  exportCsv,
  exportFileName,
  importOrder,
  monthEnds,
  monthSheet,
  negativeDays,
  ownerLoanBalance,
  ownerLoanLedger,
  pickEstimate,
  resultLabel,
  rowTypeLabel,
  rowsSinceCheck,
  splitRows,
  statementCheck,
  statementLabel,
  supplierDocuments,
  toChase,
} from "@/lib/cash-book"
import { eurCents } from "@/lib/invoices"

import type { CompanyAccount, CompanyExpense, CompanyLoan, CompanyMovement, Invoice } from "@/types"

const at = new Date(2026, 4, 1)
const d = (day: string) => new Date(`${day}T00:00:00`)

const account = (o: Partial<CompanyAccount> & Pick<CompanyAccount, "id" | "name">): CompanyAccount => ({
  userId: "u", openingBalance: 0, openingDate: d("2026-05-01"), statementBalance: null, statementDate: null,
  importRef: null, createdAt: at, updatedAt: at, ...o,
})
const MAIN = account({ id: "main", name: "Main Bank", openingBalance: 1000 })
const SECOND = account({ id: "second", name: "Second Bank" })

let seq = 0
const movement = (o: Partial<CompanyMovement> & Pick<CompanyMovement, "kind" | "direction" | "amount">): CompanyMovement => ({
  id: `m${++seq}`, userId: "u", date: d("2026-10-01"), accountId: "main", toAccountId: null, expenseId: null,
  description: "Row", documentRef: null, project: null, counterparty: null, notes: null, dateEstimated: false,
  importRef: null, createdAt: new Date(2026, 4, 1, 0, 0, seq), updatedAt: at, ...o,
})
const invoice = (o: Partial<Invoice> & Pick<Invoice, "id" | "number" | "amount" | "vat">): Invoice => ({
  userId: "u", clientId: "c1", engagementId: null, fromMonth: null, yearMonth: "2026-10", dueDate: null,
  paidDate: null, paidAccountId: null, createdAt: at, updatedAt: at, ...o,
})
const expense = (o: Partial<CompanyExpense> & Pick<CompanyExpense, "id" | "amount">): CompanyExpense => ({
  userId: "u", description: "Bank fee", category: "bank_fees", date: d("2026-10-05"), isRecurring: false,
  recurrenceMonths: null, notes: null, accountId: null, paidByOwner: false, vat: null, documentRef: null, project: null,
  recurringExpenseId: null, dateEstimated: false, importRef: null, collaboratorId: null, engagementId: null, forMonth: null, createdAt: at, updatedAt: at, ...o,
})

const loan = (o: Partial<CompanyLoan> & Pick<CompanyLoan, "id" | "direction" | "amount">): CompanyLoan => ({
  userId: "u", description: "Shareholder loan", date: d("2026-10-02"), notes: null, accountId: null,
  dateEstimated: false, importRef: null, createdAt: at, updatedAt: at, ...o,
})

const rowsOf = (input: Partial<Parameters<typeof cashRows>[0]>) =>
  cashRows({ invoices: [], expenses: [], loans: [], movements: [], ...input })
const sumOf = (rows: { delta: number }[]) => rows.reduce((s, r) => s + r.delta, 0)

describe("cashRows", () => {
  it("orders a day's imported rows as the workbook did: !2 before !12, sheets by month, parts by letter, then the rest", () => {
    expect(importOrder("2026:Luglio!12b")).toEqual([2026 * 12 + 6, 12, "b"])
    expect(importOrder("2026:Saldo!2")).toBeNull()
    const rows = rowsOf({
      movements: [
        movement({ kind: "income", direction: "in", amount: 1, importRef: null, description: "typed" }),
        movement({ kind: "income", direction: "in", amount: 1, importRef: "2026:Settembre!2", description: "september 2" }),
        movement({ kind: "income", direction: "in", amount: 1, importRef: "2026:Agosto!12", description: "august 12" }),
        movement({ kind: "income", direction: "in", amount: 1, importRef: "2026:Agosto!2b", description: "august 2b" }),
        movement({ kind: "income", direction: "in", amount: 1, importRef: "2026:Agosto!2a", description: "august 2a" }),
      ],
    })
    expect(rows.map((r) => r.description)).toEqual(["august 2a", "august 2b", "august 12", "september 2", "typed"])
  })


  it("counts an invoice only when it is paid into an account; a credit note is negative", () => {
    const rows = rowsOf({
      invoices: [
        invoice({ id: "paid", number: "15/2026", amount: 10000, vat: 2200, paidDate: d("2026-11-05"), paidAccountId: "main" }),
        invoice({ id: "offset", number: "16/2026", amount: 500, vat: 0, paidDate: d("2026-11-05"), paidAccountId: NON_CASH }),
        invoice({ id: "unknown", number: "17/2026", amount: 500, vat: 0, paidDate: d("2026-11-05") }),
        // An untick keeps the account: not paid, not cash.
        invoice({ id: "unticked", number: "18/2026", amount: 500, vat: 0, paidAccountId: "main" }),
        invoice({ id: "nc", number: "NC 1/2026", amount: -100, vat: -22, paidDate: d("2026-11-05"), paidAccountId: "main" }),
      ],
      customerName: (i) => (i.id === "paid" ? "Alpha Ltd" : null),
    })
    expect(rows.map((r) => [r.sourceId, r.delta, r.description, r.project])).toEqual([
      ["paid", 12200, "Invoice 15/2026 · Alpha Ltd", "Consulting"],
      ["nc", -122, "Credit note NC 1/2026", "Consulting"],
    ])
    expect(rows[0].vat).toBe(2200)
  })

  // §3 example 3: NC 1 ticked on Mark Paid of 15/2026, one €10,980 transfer. Not a refund.
  it("names a credit note deducted from its customer's payment that day, and calls it a Credit Note", () => {
    const rows = rowsOf({
      invoices: [
        invoice({ id: "i15", number: "15/2026", amount: 10000, vat: 2200, paidDate: d("2026-10-05"), paidAccountId: "main" }),
        invoice({ id: "nc1", number: "NC 1/2026", amount: -1000, vat: -220, paidDate: d("2026-10-05"), paidAccountId: "main" }),
        // Refunded on its own, another day: no payment to be deducted from.
        invoice({ id: "nc2", number: "NC 2/2026", amount: -100, vat: 0, paidDate: d("2026-10-06"), paidAccountId: "main" }),
      ],
      customerName: () => "Alpha Ltd",
    })
    expect(rows.map((r) => [r.description, r.delta, rowTypeLabel(r)])).toEqual([
      ["Invoice 15/2026 · Alpha Ltd", 12200, "Client Invoice Payment"],
      ["Credit note NC 1/2026 · Alpha Ltd, deducted from invoice 15/2026", -1220, "Credit Note"],
      ["Credit note NC 2/2026 · Alpha Ltd", -100, "Credit Note"],
    ])
    expect(sumOf(rows.slice(0, 2))).toBe(10980)
  })

  it("never calls a credit note deducted when it cannot tell the customers apart", () => {
    const rows = rowsOf({
      invoices: [
        invoice({ id: "i2", number: "2/2026", amount: 3000, vat: 0, paidDate: d("2026-10-02"), paidAccountId: "main" }),
        invoice({ id: "nc3", number: "3/2026", amount: -200, vat: 0, paidDate: d("2026-10-02"), paidAccountId: "main" }),
      ],
    })
    expect(rows.map((r) => r.description)).toEqual(["Invoice 2/2026", "Credit note 3/2026"])
  })

  it("counts a one-off cost paid from an account, never a recurring estimate or an unpaid one", () => {
    const rows = rowsOf({
      expenses: [
        expense({ id: "fee", amount: 25, accountId: "main" }),
        expense({ id: "estimate", amount: 30, isRecurring: true, recurrenceMonths: 1, accountId: "main" }),
        expense({ id: "legacy", amount: 40 }),
      ],
    })
    expect(rows.map((r) => [r.sourceId, r.delta, rowTypeLabel(r)])).toEqual([["fee", -25, "Cost: Bank Fees"]])
  })

  // §3 examples 3 and 5: a laptop with VAT, a refund, the owner's card, a supplier invoice not paid yet.
  it("pays a cost with its VAT, takes a refund back in, and keeps the owner's card and supplier invoices off the bank", () => {
    const rows = rowsOf({
      expenses: [
        expense({ id: "laptop", description: "Laptop", category: "office_supplies", amount: 1000, vat: 220, accountId: "main", documentRef: "FT 12", project: "Consulting" }),
        expense({ id: "refund", description: "Refund", category: "office_supplies", amount: -50, vat: -11, accountId: "main", date: d("2026-10-06") }),
        expense({ id: "fridge", amount: 480, paidByOwner: true }),
        expense({ id: "bill", amount: 12000, vat: 0, documentRef: "FPR 40/26" }),
      ],
      loans: [
        loan({ id: "lent", direction: "to_company", amount: 5000, accountId: "main", date: d("2026-10-01") }),
        loan({ id: "repaid", direction: "from_company", amount: 480, accountId: "second", date: d("2026-10-07") }),
        // Written before the cash book, with no account: only what the company owes the owner.
        loan({ id: "legacy", direction: "to_company", amount: 900 }),
      ],
    })
    expect(rows.map((r) => [r.sourceId, r.accountId, r.delta, r.vat, rowTypeLabel(r)])).toEqual([
      ["lent", "main", 5000, 0, "Shareholder Loan"],
      ["laptop", "main", -1220, 220, "Cost: Office Supplies"],
      ["refund", "main", 61, -11, "Refund: Office Supplies"],
      ["repaid", "second", -480, 0, "Shareholder Loan Repayment"],
    ])
    expect(rows[1]).toMatchObject({ documentRef: "FT 12", project: "Consulting", source: "expense" })
  })

  it("gives a transfer two legs that net to zero", () => {
    const t = movement({ kind: "transfer", direction: "out", amount: 3000, toAccountId: "second" })
    const rows = rowsOf({ movements: [t] })
    expect(rows.map((r) => [r.accountId, r.delta, r.otherAccountId])).toEqual([
      ["main", -3000, "second"],
      ["second", 3000, "main"],
    ])
  })

  it("sorts by day, then by when it was written", () => {
    const late = movement({ kind: "income", direction: "in", amount: 1, date: d("2026-10-02") })
    const first = movement({ kind: "income", direction: "in", amount: 2, date: d("2026-10-01") })
    const second = movement({ kind: "income", direction: "in", amount: 3, date: d("2026-10-01") })
    expect(rowsOf({ movements: [late, second, first] }).map((r) => r.delta)).toEqual([2, 3, 1])
  })
})

describe("balances", () => {
  it("start at the opening balance and leave out rows before the opening day or on no known account", () => {
    const rows = rowsOf({
      movements: [
        movement({ kind: "income", direction: "in", amount: 100, date: d("2026-04-30") }),
        movement({ kind: "income", direction: "in", amount: 50, date: d("2026-05-01") }),
        movement({ kind: "income", direction: "in", amount: 70, accountId: "gone" }),
      ],
    })
    const { counted, beforeOpening, unassigned } = splitRows([MAIN, SECOND], rows)
    expect(beforeOpening.map((r) => r.delta)).toEqual([100])
    expect(unassigned.map((r) => r.delta)).toEqual([70])
    expect(balancesAt([MAIN, SECOND], counted, "2026-12-31")).toEqual(new Map([["main", 1050], ["second", 0]]))
    // The opening balance is the start of the opening day: that day's €50 adds to it.
    expect(balancesAt([MAIN], counted, "2026-05-01").get("main")).toBe(1050)
    // Before its opening day the account has no balance in the book at all.
    expect(balancesAt([MAIN], counted, "2026-04-30").has("main")).toBe(false)
  })

  // §3 example 2: a foreign client pays €25 short; the fee is a cost on the same account.
  it("matches the bank when a short payment books its fee", () => {
    const rows = rowsOf({
      invoices: [invoice({ id: "i16", number: "16/2026", amount: 7650, vat: 0, paidDate: d("2026-10-05"), paidAccountId: "main" })],
      expenses: [expense({ id: "fee", amount: 25, accountId: "main", date: d("2026-10-05") })],
    })
    const { counted } = splitRows([MAIN], rows)
    expect(balancesAt([MAIN], counted, "2026-10-05").get("main")).toBe(1000 + 7625)
  })
})

describe("statementCheck", () => {
  const rows = splitRows([MAIN], rowsOf({ movements: [movement({ kind: "vat", direction: "out", amount: 200, date: d("2026-10-03") })] })).counted

  it("reads Not checked with no statement", () => {
    expect(statementLabel(statementCheck(MAIN, rows), eurCents)).toBe("Not checked")
  })

  it("uses the Verifica wording for 0, + and −", () => {
    const at = (bank: number) =>
      statementLabel(statementCheck({ ...MAIN, statementBalance: bank, statementDate: d("2026-10-07") }, rows), eurCents)
    expect(at(800)).toBe("Matches the bank on 07/10/2026")
    expect(at(812.5)).toBe("Missing IN of €12.50 on 07/10/2026")
    expect(at(775)).toBe("Missing OUT of €25.00 on 07/10/2026")
  })

  it("compares at the statement's day, not today", () => {
    expect(checkAgainst(MAIN, rows, 1000, "2026-10-02")).toMatchObject({ status: "matches", book: 1000 })
    expect(checkAgainst(MAIN, rows, 1000, "2026-10-03")).toMatchObject({ status: "missing_in", book: 800, difference: 200 })
  })

  it("says what a difference means", () => {
    expect(checkDetail(checkAgainst(MAIN, rows, 1000, "2026-10-03"), eurCents)).toBe(
      "The bank has €200.00 more: money came in that the Cash Book doesn't have.",
    )
    expect(checkDetail(checkAgainst(MAIN, rows, 775, "2026-10-03"), eurCents)).toBe(
      "The bank has €25.00 less: money went out that the Cash Book doesn't have.",
    )
    expect(checkDetail(checkAgainst(MAIN, rows, 800, "2026-10-03"), eurCents)).toBeNull()
  })

  it("lists the rows since the last check, else the month so far, else since the account opened", () => {
    const more = splitRows(
      [MAIN],
      rowsOf({
        movements: [
          movement({ kind: "vat", direction: "out", amount: 50, date: d("2026-09-20") }),
          movement({ kind: "vat", direction: "out", amount: 200, date: d("2026-10-03") }),
          movement({ kind: "tax", direction: "out", amount: 30, date: d("2026-10-09") }),
        ],
      }),
    ).counted
    const checked = { ...MAIN, statementBalance: 950, statementDate: d("2026-09-20") }
    const after = rowsSinceCheck(checked, more, "2026-10-07")
    expect(after.since).toBe("since the last check (20/09/2026)")
    expect(after.rows.map((r) => r.delta)).toEqual([-200])
    // A day before the last check: that day's month, up to the day.
    const earlier = rowsSinceCheck({ ...checked, statementDate: d("2026-10-08") }, more, "2026-10-05")
    expect(earlier.since).toBe("from 01/10/2026 to 05/10/2026")
    expect(earlier.rows.map((r) => r.delta)).toEqual([-200])
    expect(rowsSinceCheck(MAIN, more, "2026-10-09")).toMatchObject({ since: "since the account opened" })
    expect(rowsSinceCheck(MAIN, more, "2026-10-09").rows).toHaveLength(3)
  })
})

describe("monthSheet", () => {
  // §3 examples 4 and 6 in October: a tenant's split transfer, then money moved between banks.
  const october = [
    movement({ kind: "income", direction: "in", amount: 650, accountId: "second", date: d("2026-10-01"), counterparty: "Room 2" }),
    movement({ kind: "income", direction: "in", amount: 100, accountId: "second", date: d("2026-10-01") }),
    movement({ kind: "deposit_held", direction: "in", amount: 700, accountId: "second", date: d("2026-10-01"), counterparty: "Room 2" }),
    movement({ kind: "transfer", direction: "out", amount: 300, accountId: "main", toAccountId: "second", date: d("2026-10-02") }),
    movement({ kind: "vat", direction: "out", amount: 200, date: d("2026-10-02") }),
    movement({ kind: "income", direction: "in", amount: 40, date: d("2026-09-20") }),
  ]
  const counted = splitRows([MAIN, SECOND], rowsOf({ movements: october })).counted

  it("opens with the balance before the 1st and closes each day once", () => {
    const sheet = monthSheet([MAIN, SECOND], counted, "2026-10", null)
    expect(sheet.opening).toBe(1040)
    // Each account's share of it, for the opening row.
    expect(sheet.openingByAccount).toEqual(new Map([["main", 1040], ["second", 0]]))
    // The transfer is one line under every account; its in leg is not repeated.
    expect(sheet.lines.map((l) => [l.row.kind, l.row.delta, l.endOfDay])).toEqual([
      ["income", 650, null],
      ["income", 100, null],
      ["deposit_held", 700, 2490],
      ["transfer", -300, null],
      ["vat", -200, 2290],
    ])
    expect([sheet.in, sheet.out, sheet.net, sheet.transfers]).toEqual([1450, 200, 1250, 0])
    expect(sheet.closing).toBe(2290)
    expect(sheet.closingByAccount).toEqual(new Map([["main", 540], ["second", 1750]]))
  })

  it("shows a transfer as money in or out of the one account, outside In and Out", () => {
    const sheet = monthSheet([MAIN, SECOND], counted, "2026-10", "second")
    expect(sheet.opening).toBe(0)
    expect(sheet.lines.map((l) => l.endOfDay)).toEqual([null, null, 1450, 1750])
    expect([sheet.in, sheet.out, sheet.transfers, sheet.closing]).toEqual([1450, 0, 300, 1750])
  })

  // Main opens 01/05 with €1,000, Later 15/06 with €10; €500 capital on 10/05, €100 moved to Later on 20/06.
  it("counts an account from its opening day, so each sheet opens where the Months tab closed the month before", () => {
    const later = account({ id: "later", name: "Later Bank", openingDate: d("2026-06-15"), openingBalance: 10 })
    const accounts = [MAIN, later]
    const counted = splitRows(
      accounts,
      rowsOf({
        movements: [
          movement({ kind: "capital", direction: "in", amount: 500, date: d("2026-05-10") }),
          movement({ kind: "transfer", direction: "out", amount: 100, toAccountId: "later", date: d("2026-06-20") }),
        ],
      }),
    ).counted
    const may = monthSheet(accounts, counted, "2026-05", null)
    expect([may.opening, may.closing, [...may.closingByAccount]]).toEqual([1000, 1500, [["main", 1500]]])
    const june = monthSheet(accounts, counted, "2026-06", null)
    const ends = monthEnds(accounts, counted, 2026, "2026-06", null)
    expect(june.opening).toBe(ends[0].total)
    expect(june.opened).toEqual([{ accountId: "later", day: "2026-06-15", balance: 10 }])
    // 1,500 + Later's 10 from 15/06; the transfer moves nothing.
    expect(june.lines.map((l) => [l.moved, l.endOfDay])).toEqual([[true, 1510]])
    expect(june.closing).toBe(ends[1].total)
    expect(monthSheet(accounts, counted, "2026-05", "later")).toMatchObject({ opening: 0, closing: 0, lines: [] })
  })

  // A €300 transfer from Late (opens 07/10) to Main on 03/10: the out leg is before Late opened.
  it("shows a transfer leg alone as money in, not as a hidden half of a move", () => {
    const late = account({ id: "late", name: "Late Bank", openingDate: d("2026-10-07") })
    const main = { ...MAIN, openingDate: d("2026-10-01") }
    const counted = splitRows(
      [main, late],
      rowsOf({ movements: [movement({ kind: "transfer", direction: "out", amount: 300, accountId: "late", toAccountId: "main", date: d("2026-10-03") })] }),
    ).counted
    const sheet = monthSheet([main, late], counted, "2026-10", null)
    expect(sheet.lines.map((l) => [l.row.accountId, l.row.delta, l.moved, l.endOfDay])).toEqual([["main", 300, false, 1300]])
    expect(sheet.closing).toBe(1300)
  })

  it("gives the same end-of-day balances whatever the order of a day's rows", () => {
    const endOfDays = (movements: CompanyMovement[]) =>
      monthSheet([MAIN, SECOND], splitRows([MAIN, SECOND], rowsOf({ movements })).counted, "2026-10", null)
        .lines.filter((l) => l.endOfDay !== null)
        .map((l) => [l.row.day, l.endOfDay])
    const reversed = october.map((m, k) => ({ ...m, createdAt: new Date(2026, 4, 1, 0, 0, 59 - k) }))
    expect(endOfDays(reversed)).toEqual(endOfDays(october))
  })
})

describe("monthEnds", () => {
  it("lists each month from the first opening to the last asked, with each account's end", () => {
    const later = account({ id: "later", name: "Second Bank", openingDate: d("2026-06-15"), openingBalance: 10 })
    const counted = splitRows(
      [MAIN, later],
      rowsOf({
        movements: [
          movement({ kind: "capital", direction: "in", amount: 500, date: d("2026-05-10") }),
          movement({ kind: "transfer", direction: "out", amount: 100, toAccountId: "later", date: d("2026-06-20") }),
          movement({ kind: "tax", direction: "out", amount: 60, accountId: "later", date: d("2026-07-16") }),
        ],
      }),
    ).counted
    const rows = monthEnds([MAIN, later], counted, 2026, "2026-07", null)
    expect(rows.map((r) => [r.ym, r.in, r.out, r.net, r.ends.get("main"), r.ends.get("later"), r.total])).toEqual([
      ["2026-05", 500, 0, 500, 1500, null, 1500],
      ["2026-06", 0, 0, 0, 1400, 110, 1510],
      ["2026-07", 0, 60, -60, 1400, 50, 1450],
    ])
  })
})

describe("negativeDays", () => {
  it("flags the first day an account ends below zero, not a dip within the day", () => {
    const counted = splitRows(
      [SECOND],
      rowsOf({
        movements: [
          movement({ kind: "vat", direction: "out", amount: 100, accountId: "second", date: d("2026-10-01") }),
          movement({ kind: "income", direction: "in", amount: 100, accountId: "second", date: d("2026-10-01") }),
          movement({ kind: "tax", direction: "out", amount: 5, accountId: "second", date: d("2026-10-02") }),
        ],
      }),
    ).counted
    expect(negativeDays([SECOND], counted)).toEqual([{ accountId: "second", day: "2026-10-02", balance: -5 }])
  })
})

describe("deposits", () => {
  // §3 example 4: Room 2's €700 deposit, €600 given back and €100 kept for damage.
  it("follows each tenant's deposit to zero, and keeps the caparra apart", () => {
    const list = [
      movement({ kind: "deposit_held", direction: "in", amount: 700, counterparty: "Room 2" }),
      movement({ kind: "deposit_held", direction: "in", amount: 900, counterparty: "Room 3" }),
      movement({ kind: "deposit_paid", direction: "out", amount: 1200, counterparty: "Landlord" }),
    ]
    expect(deposits(list)).toEqual([
      { kind: "deposit_held", counterparty: "Room 2", amount: 700 },
      { kind: "deposit_held", counterparty: "Room 3", amount: 900 },
      { kind: "deposit_paid", counterparty: "Landlord", amount: 1200 },
    ])
    const returned = [
      ...list,
      movement({ kind: "deposit_held", direction: "out", amount: 600, counterparty: "Room 2" }),
      movement({ kind: "deposit_held", direction: "out", amount: 100, counterparty: " room 2 " }),
    ]
    expect(deposits(returned).map((x) => x.counterparty)).toEqual(["Room 3", "Landlord"])
    // Room 4's €900 went back with no receipt in the book: nothing to give back, never −€900.
    const unknown = [...list, movement({ kind: "deposit_held", direction: "out", amount: 900, counterparty: "Room 4" })]
    expect(deposits(unknown).map((x) => x.counterparty)).toEqual(["Room 2", "Room 3", "Landlord"])
  })
})

describe("clientsOwe", () => {
  it("is each customer's unpaid total, a credit note netting only its own customer", () => {
    const list = [
      invoice({ id: "a", number: "1", amount: 10000, vat: 2200 }),
      invoice({ id: "b", number: "NC 1", amount: -1000, vat: -220 }),
      invoice({ id: "c", clientId: "c2", number: "2", amount: 500, vat: 0 }),
      invoice({ id: "d", clientId: "c3", number: "NC 2", amount: -300, vat: 0 }),
      invoice({ id: "e", number: "3", amount: 400, vat: 0, paidDate: d("2026-10-01") }),
    ]
    expect(clientsOwe(list, [])).toBe(10980 + 500)
  })
})

describe("toChase", () => {
  it("lists what to fix, and never an offset", () => {
    const accounts = [MAIN, SECOND]
    const rows = rowsOf({
      movements: [
        movement({ kind: "income", direction: "in", amount: 10, dateEstimated: true }),
        movement({ kind: "transfer", direction: "out", amount: 5, toAccountId: "second", dateEstimated: true }),
        movement({ kind: "income", direction: "in", amount: 10, date: d("2026-04-01") }),
        movement({ kind: "tax", direction: "out", amount: 50, accountId: "second", date: d("2026-10-02") }),
      ],
    })
    const invoices = [
      invoice({ id: "noacc", number: "5/2026", amount: 100, vat: 0, paidDate: d("2026-06-01") }),
      invoice({ id: "old", number: "1/2026", amount: 100, vat: 0, paidDate: d("2026-03-01") }),
      invoice({ id: "off", number: "6/2026", amount: 100, vat: 0, paidDate: d("2026-06-01"), paidAccountId: NON_CASH }),
    ]
    expect(toChase({ accounts, rows, invoices, expenses: [] }).map((c) => c.kind)).toEqual([
      "negative",
      "no_account",
      "estimated",
      "estimated",
      "before_opening",
    ])
  })

  it("never chases a deposit dated before the opening: that is a deposit held when the book began", () => {
    const late = account({ id: "late", name: "Late Bank", openingDate: d("2026-10-07") })
    const rows = rowsOf({
      movements: [
        movement({ kind: "deposit_held", direction: "in", amount: 700, counterparty: "Room 2", date: d("2026-04-01") }),
        // Into an account not open yet: the in leg alone is before its opening, and still listed.
        movement({ id: "t", kind: "transfer", direction: "out", amount: 300, toAccountId: "late", date: d("2026-10-03") }),
      ],
    })
    expect(toChase({ accounts: [MAIN, late], rows, invoices: [], expenses: [] }).map((c) => [c.kind, "row" in c ? c.row.delta : null])).toEqual([
      ["before_opening", 300],
    ])
  })
})

describe("toChase without invoicing", () => {
  it("lists no paid-with-no-account invoice, and still the rest", () => {
    const invoices = [invoice({ id: "noacc", number: "5/2026", amount: 100, vat: 0, paidDate: d("2026-06-01") })]
    const rows = rowsOf({ movements: [movement({ kind: "income", direction: "in", amount: 10, dateEstimated: true })] })
    expect(toChase({ accounts: [MAIN], rows, invoices, expenses: [] }).map((c) => c.kind)).toEqual(["no_account", "estimated"])
    expect(toChase({ accounts: [MAIN], rows, invoices, expenses: [], invoicing: false }).map((c) => c.kind)).toEqual(["estimated"])
  })
})

describe("toChase, costs", () => {
  it("asks for the document of a cost paid from an account or by card, never of a bank fee", () => {
    const expenses = [
      expense({ id: "paid", description: "Plumber", category: "other", amount: 90, accountId: "main" }),
      expense({ id: "card", description: "Fridge", category: "office_supplies", amount: 480, paidByOwner: true }),
      expense({ id: "fee", amount: 2, accountId: "main" }),
      expense({ id: "documented", category: "other", amount: 90, accountId: "main", documentRef: "R 7" }),
      expense({ id: "bill", category: "other", amount: 900 }),
      expense({ id: "estimate", category: "software", amount: 30, isRecurring: true, recurrenceMonths: 1 }),
    ]
    const items = toChase({ accounts: [MAIN], rows: [], invoices: [], expenses })
    expect(items.map((c) => (c.kind === "no_document" ? c.expense.id : c.kind))).toEqual(["paid", "card"])
  })
})

describe("chaseDay", () => {
  it("dates each item by what it is about: the day below zero, the payment, the cost, the row", () => {
    const rows = rowsOf({
      movements: [
        movement({ kind: "tax", direction: "out", amount: 50, accountId: "second", date: d("2026-10-02") }),
        movement({ kind: "income", direction: "in", amount: 10, date: d("2026-09-14"), dateEstimated: true }),
        movement({ kind: "income", direction: "in", amount: 10, date: d("2026-04-01") }),
        movement({ kind: "income", direction: "in", amount: 10, accountId: "gone", date: d("2026-08-20") }),
      ],
    })
    const items = toChase({
      accounts: [MAIN, SECOND],
      rows,
      invoices: [invoice({ id: "noacc", number: "5/2026", amount: 100, vat: 0, paidDate: d("2026-06-01") })],
      expenses: [expense({ id: "paid", description: "Plumber", category: "other", amount: 90, accountId: "main", date: d("2026-07-09") })],
    })
    expect(items.map((c) => [c.kind, chaseDay(c)])).toEqual([
      ["negative", "2026-10-02"],
      ["no_account", "2026-06-01"],
      ["no_document", "2026-07-09"],
      ["estimated", "2026-09-14"],
      ["before_opening", "2026-04-01"],
      ["unassigned", "2026-08-20"],
    ])
  })
})

describe("bookRows", () => {
  const book = {
    accounts: [MAIN],
    invoices: [
      invoice({ id: "i1", clientId: "c1", number: "2/2026", amount: 3000, vat: 0, paidDate: d("2026-10-02"), paidAccountId: "main" }),
      invoice({ id: "i2", clientId: "c2", number: "3/2026", amount: -200, vat: 0, paidDate: d("2026-10-02"), paidAccountId: "main" }),
    ],
    expenses: [], loans: [], movements: [],
    clients: [{ id: "c1", name: "Acme" }, { id: "c2", name: "Beta" }],
    engagements: [],
  }

  // Without the names, any credit note read as deducted from any invoice paid the same day.
  it("names each invoice's customer, as the page does, so another customer's credit note is never deducted", () => {
    expect(bookRows(book).rows.map((r) => r.description)).toEqual(["Invoice 2/2026 · Acme", "Credit note 3/2026 · Beta"])
    expect(bookRows(book).counted).toHaveLength(2)
  })
})

describe("accountInUse", () => {
  it("mirrors the delete guard: movements either side, costs, loans, paid invoices", () => {
    const none = { invoices: [], expenses: [], loans: [], movements: [] }
    expect(accountInUse("main", none)).toBe(false)
    expect(accountInUse("second", { ...none, movements: [movement({ kind: "transfer", direction: "out", amount: 1, toAccountId: "second" })] })).toBe(true)
    expect(accountInUse("main", { ...none, expenses: [expense({ id: "f", amount: 1, accountId: "main" })] })).toBe(true)
    expect(accountInUse("main", { ...none, loans: [loan({ id: "l", direction: "to_company", amount: 1, accountId: "main" })] })).toBe(true)
    expect(accountInUse("main", { ...none, invoices: [invoice({ id: "u", number: "1", amount: 1, vat: 0, paidAccountId: "main" })] })).toBe(false)
  })
})

describe("ownerLoanBalance", () => {
  // §3 example 5: a €480 fridge on the owner's card, then paid back from the bank.
  it("adds the owner's card purchases to the loans, less what the company paid back, each on its own line", () => {
    const loans = [loan({ id: "l1", direction: "to_company", amount: 5000 })]
    const costs = [
      expense({ id: "fridge", amount: 480, vat: 0, paidByOwner: true }),
      expense({ id: "paid", amount: 100, accountId: "main" }),
      expense({ id: "printer", amount: 100, vat: 22, paidByOwner: true }),
    ]
    expect(ownerLoanBalance(loans, costs)).toEqual({ lent: 5000, card: 602, repaid: 0, total: 5602 })
    // Paying back the card purchases leaves the loan whole: never "loans, net 4,398".
    const repaid = [...loans, loan({ id: "l2", direction: "from_company", amount: 602, accountId: "main" })]
    expect(ownerLoanBalance(repaid, costs)).toEqual({ lent: 5000, card: 602, repaid: 602, total: 5000 })
    // No loan at all, a card purchase paid back: nothing owed, and no negative loan.
    expect(ownerLoanBalance([loan({ id: "l4", direction: "from_company", amount: 602 })], costs)).toEqual({ lent: 0, card: 602, repaid: 602, total: 0 })
    // Paid back more than it owed: below zero, which both pages warn about.
    expect(ownerLoanBalance([loan({ id: "l3", direction: "from_company", amount: 700 })], costs).total).toBe(-98)
  })
})

describe("ownerLoanLedger", () => {
  it("runs what the SRL owes the owner after each entry, newest first, ending at the balance", () => {
    const loans = [
      loan({ id: "l1", direction: "to_company", amount: 5000, date: d("2026-06-02") }),
      loan({ id: "l2", direction: "from_company", amount: 89, date: d("2026-10-03") }),
    ]
    const costs = [
      expense({ id: "train", amount: 89, vat: 0, paidByOwner: true, date: d("2026-09-10") }),
      expense({ id: "bank", amount: 100, accountId: "main", date: d("2026-09-11") }),
      expense({ id: "est", amount: 50, paidByOwner: true, isRecurring: true, date: d("2026-09-12") }),
    ]
    const ledger = ownerLoanLedger(loans, costs)
    // The bank cost and the estimate are no part of it, as in ownerLoanBalance.
    expect(ledger.map((e) => [e.key, e.delta, e.balance])).toEqual([
      ["loan-l2", -89, 5000],
      ["card-train", 89, 5089],
      ["loan-l1", 5000, 5000],
    ])
    expect(ledger[0].balance).toBe(ownerLoanBalance(loans, costs).total)
  })
})

describe("supplierDocuments", () => {
  // §3 example 3: a €12,000 invoice for the flat, paid €5,000 then €7,000.
  it("follows a supplier invoice paid in two parts to nothing owed, and lists a payment naming none", () => {
    const bill = expense({ id: "bill", description: "Renovation", category: "other", amount: 12000, vat: 0, documentRef: "FPR 40/26", project: "Flat Rental" })
    const first = movement({ kind: "supplier_payment", direction: "out", amount: 5000, expenseId: "bill" })
    expect(supplierDocuments([bill], [first])).toMatchObject({ owed: 7000, docs: [{ total: 12000, paid: 5000, owed: 7000 }], dangling: [] })

    const second = movement({ kind: "supplier_payment", direction: "out", amount: 7000, expenseId: "bill" })
    const stray = movement({ kind: "supplier_payment", direction: "out", amount: 200, expenseId: "gone" })
    const done = supplierDocuments([bill], [first, second, stray])
    expect(done.owed).toBe(0)
    expect(done.docs[0]).toMatchObject({ paid: 12000, owed: 0 })
    expect(done.dangling).toEqual([stray])
  })

  it("owes the VAT too, and never counts a cost paid from an account or by card", () => {
    const docs = supplierDocuments(
      [
        expense({ id: "a", amount: 1000, vat: 220, documentRef: "FT 9" }),
        expense({ id: "b", amount: 10, documentRef: "R1", accountId: "main" }),
        expense({ id: "c", amount: 10, documentRef: "R2", paidByOwner: true }),
        expense({ id: "d", amount: 10 }),
      ],
      [movement({ kind: "supplier_payment", direction: "out", amount: 1300, expenseId: "a" })],
    )
    // Paid more than the €1,220 total: nothing owed, never a negative debt.
    expect(docs.docs.map((x) => [x.expense.id, x.total, x.owed])).toEqual([["a", 1220, 0]])
  })
})

describe("costCentreTotals", () => {
  // October: consulting through invoices, the flat's rent, costs and deposit; the rest in no result.
  const data = {
    invoices: [invoice({ id: "i1", number: "15/2026", amount: 2000, vat: 440, paidDate: d("2026-10-05"), paidAccountId: "main" })],
    expenses: [
      expense({ id: "rent", category: "rent", amount: 1200, vat: 0, accountId: "second", project: "Flat Rental", date: d("2026-10-02") }),
      expense({ id: "fridge", category: "office_supplies", amount: 480, paidByOwner: true, project: "Flat Rental", date: d("2026-10-03") }),
      expense({ id: "bill", category: "other", amount: 12000, vat: 0, documentRef: "FPR 40/26", project: " Flat Rental ", date: d("2026-10-04") }),
      expense({ id: "app", category: "software", amount: 100, vat: 22, accountId: "main", date: d("2026-10-06") }),
      expense({ id: "sept", category: "software", amount: 100, accountId: "main", date: d("2026-09-30") }),
      expense({ id: "estimate", category: "software", amount: 30, isRecurring: true, recurrenceMonths: 1, date: d("2026-01-01") }),
    ],
    loans: [loan({ id: "l1", direction: "to_company", amount: 5000, accountId: "main", date: d("2026-10-01") })],
    movements: [
      movement({ kind: "income", direction: "in", amount: 650, accountId: "second", project: "Flat Rental", counterparty: "Room 2" }),
      movement({ kind: "income", direction: "in", amount: 100, accountId: "second", project: "Flat Rental" }),
      movement({ kind: "deposit_held", direction: "in", amount: 700, accountId: "second", project: "Flat Rental", counterparty: "Room 2" }),
      movement({ kind: "supplier_payment", direction: "out", amount: 5000, expenseId: "bill", project: "Flat Rental", date: d("2026-10-10") }),
      movement({ kind: "transfer", direction: "out", amount: 300, toAccountId: "second" }),
      movement({ kind: "tax", direction: "out", amount: 50 }),
    ],
  }

  it("gives each cost centre its income, costs and result, deposits and loans apart", () => {
    const t = costCentreTotals(data, "2026-10-01", "2026-10-31")
    expect(t.centres.map((c) => [c.name, c.income, c.costs, c.result, c.depositsHeld])).toEqual([
      // The invoice net of VAT.
      ["Consulting", 2000, 0, 2000, 0],
      // 650 + 100 − (1,200 rent + 480 card + 12,000 invoice at its date); the €5,000 instalment is cash only.
      ["Flat Rental", 750, 13680, -12930, 700],
      // A cost with no cost centre, net of its VAT.
      ["Untagged", 0, 100, -100, 0],
    ])
    expect(t.total).toEqual({ name: "Total", income: 2750, costs: 13780, result: -11030, depositsHeld: 700, depositsPaid: 0 })
    expect(t.loans).toEqual({ lent: 5000, repaid: 0 })
    expect(resultLabel(-12930, eurCents)).toBe("Loss €12,930.00")
    expect(resultLabel(2000, eurCents)).toBe("Gain €2,000.00")
    expect(resultLabel(0, eurCents)).toBe("€0.00")
  })

  it("keeps to one account: what went through it, no card or supplier invoice", () => {
    const t = costCentreTotals(data, "2026-10-01", "2026-10-31", "second")
    expect(t.centres.map((c) => [c.name, c.income, c.costs, c.result, c.depositsHeld])).toEqual([["Flat Rental", 750, 1200, -450, 700]])
    expect(t.loans).toEqual({ lent: 0, repaid: 0 })
  })

  it("covers a whole year from its first day to its last", () => {
    const t = costCentreTotals(data, "2026-01-01", "2026-12-31")
    expect(t.centres.find((c) => c.name === "Untagged")?.costs).toBe(200)
  })
})

describe("pickEstimate", () => {
  const google = expense({ id: "g", description: "Google Workspace", category: "software", amount: 12, isRecurring: true, recurrenceMonths: 1 })
  const rent = expense({ id: "r", description: "Flat rent", category: "rent", amount: 1200, isRecurring: true, recurrenceMonths: 1 })

  it("picks the one estimate of the category whose first word is in the description", () => {
    expect(pickEstimate({ category: "software", description: "google invoice October" }, [google, rent])).toEqual({ picked: google, candidates: [google] })
  })

  it("asks when the word is missing or there are several, and has nothing for another category", () => {
    expect(pickEstimate({ category: "software", description: "Laptop licence" }, [google, rent])).toEqual({ picked: null, candidates: [google] })
    const other = { ...google, id: "o", description: "Other tools" }
    expect(pickEstimate({ category: "software", description: "Google" }, [google, other]).picked).toBeNull()
    expect(pickEstimate({ category: "travel", description: "Google" }, [google, rent])).toEqual({ picked: null, candidates: [] })
  })
})

describe("exportCsv", () => {
  const data = () => {
    const invoices = [invoice({ id: "i", number: "15/2026", amount: 1000, vat: 220, paidDate: d("2026-10-05"), paidAccountId: "main" })]
    const expenses = [
      expense({ id: "laptop", description: "Laptop", category: "office_supplies", amount: 800, vat: 176, accountId: "main", documentRef: "FT 12", project: "Consulting", notes: "Work laptop", date: d("2026-10-06") }),
      expense({ id: "fridge", description: "Fridge", category: "office_supplies", amount: 480, paidByOwner: true, project: "Flat Rental", date: d("2026-10-07") }),
    ]
    const movements = [
      movement({ kind: "income", direction: "in", amount: 100, date: d("2026-09-15"), description: "September rent" }),
      movement({ kind: "transfer", direction: "out", amount: 300, toAccountId: "second", description: "Transfer", date: d("2026-10-02") }),
      movement({ kind: "income", direction: "in", amount: 650, accountId: "second", description: "Rent; October", project: "Flat Rental", counterparty: "Room 2", date: d("2026-10-03"), dateEstimated: true }),
      movement({ kind: "deposit_held", direction: "in", amount: 700, accountId: "second", description: "=Deposit", project: "Flat Rental", counterparty: "Room 2", date: d("2026-10-03") }),
    ]
    const loans: CompanyLoan[] = []
    return { accounts: [MAIN, SECOND], rows: rowsOf({ invoices, expenses, loans, movements }), invoices, expenses, loans, movements }
  }
  const october = { from: "2026-10-01", to: "2026-10-31", accountId: null, costCentre: null }
  const linesOf = (csv: string) => csv.slice(1).trimEnd().split("\r\n")

  it("writes the month's rows, then each account and each cost centre, for Italian Excel", () => {
    const { csv, rows } = exportCsv(data(), october)
    expect(csv.startsWith("﻿Date;Account;Type;Description;Document;Cost Centre;Counterparty;In;Out;VAT;Notes;Flags\r\n")).toBe(true)
    expect(rows).toBe(6)
    expect(linesOf(csv).slice(1)).toEqual([
      "02/10/2026;Main Bank;Transfer;Transfer (to Second Bank);;;;;300,00;;;",
      "02/10/2026;Second Bank;Transfer;Transfer (from Main Bank);;;;300,00;;;;",
      `03/10/2026;Second Bank;Rent & Other Income;"Rent; October";;Flat Rental;Room 2;650,00;;;;Date estimated`,
      "03/10/2026;Second Bank;Deposit Received;'=Deposit;;Flat Rental;Room 2;700,00;;;;",
      "05/10/2026;Main Bank;Client Invoice Payment;Invoice 15/2026;15/2026;Consulting;;1220,00;;220,00;;",
      "06/10/2026;Main Bank;Cost: Office Supplies;Laptop;FT 12;Consulting;;;976,00;176,00;Work laptop;",
      "",
      '"Accounts from 01/10/2026 to 31/10/2026: every row whatever the cost centre, transfers included in In and Out"',
      "Account;Balance at Start;In;Out;Balance at End",
      // 1,000 opening + 100 September rent; 1,100 + 1,220 − 300 − 976.
      "Main Bank;1100,00;1220,00;1276,00;1044,00",
      "Second Bank;0,00;1650,00;0,00;1650,00",
      "",
      '"Cost Centres, net of VAT: income less costs is the result, a gain or a loss. Deposits are apart and never in it. Loans, transfers, VAT and taxes paid, administrator pay and supplier invoice payments are in none."',
      "Cost Centre;Income;Costs;Result;Gain or Loss;Tenant Deposits, Net (apart);Deposits Paid, Net (apart)",
      "Consulting;1000,00;800,00;200,00;Gain;0,00;0,00",
      "Flat Rental;650,00;480,00;170,00;Gain;700,00;0,00",
      "Total;1650,00;1280,00;370,00;Gain;700,00;0,00",
      "",
      `"Costs Paid by No Company Account, at their document date and counted in the cost centres above: the owner's card, and supplier invoices, whose payments are Supplier Invoice Payment rows"`,
      "Date;Paid By;Category;Description;Document;Cost Centre;Amount;VAT;Paid by 31/10/2026;Owed on 31/10/2026;Notes;Flags",
      "07/10/2026;Owner's personal card;Office Supplies;Fridge;;Flat Rental;480,00;;;;;",
      "",
      CSV_NOTICE,
    ])
  })

  it("keeps to one account and one cost centre, and says so in the file name", () => {
    const sel = { ...october, accountId: "second", costCentre: "Flat Rental" }
    const { csv, rows } = exportCsv(data(), sel)
    expect(rows).toBe(2)
    const lines = linesOf(csv)
    expect(lines.slice(1, 3)).toEqual([
      `03/10/2026;Second Bank;Rent & Other Income;"Rent; October";;Flat Rental;Room 2;650,00;;;;Date estimated`,
      "03/10/2026;Second Bank;Deposit Received;'=Deposit;;Flat Rental;Room 2;700,00;;;;",
    ])
    expect(lines).toContain("Second Bank;0,00;1650,00;0,00;1650,00")
    expect(lines).not.toContain("Main Bank;1100,00;1220,00;1276,00;1044,00")
    // Through Second Bank only: the card's fridge is in no account, and the header says so.
    expect(lines).toContain("Flat Rental;650,00;0,00;650,00;Gain;700,00;0,00")
    expect(lines.find((l) => l.startsWith(`"Cost Centres`))).toMatch(
      /Through Second Bank only: supplier invoices and costs paid with the owner's card went through no account, so they are left out\. Export All Accounts to see them\."$/,
    )
    expect(lines.some((l) => l.startsWith("Total;"))).toBe(false)
    expect(lines.some((l) => l.startsWith(`"Costs Not Paid From`))).toBe(false)

    expect(exportFileName(sel, [MAIN, SECOND])).toBe("cash-book_2026-10_second-bank_flat-rental.csv")
    expect(exportFileName({ ...october, from: "2026-01-01", to: "2026-12-31" }, [MAIN, SECOND])).toBe("cash-book_2026_all-accounts_all-cost-centres.csv")
    expect(exportFileName({ ...october, from: "2026-10-03", to: "2026-10-09", accountId: "main" }, [MAIN, SECOND])).toBe(
      "cash-book_2026-10-03_2026-10-09_main-bank_all-cost-centres.csv",
    )
  })

  it("says what was paid and owed on a supplier invoice by the period's end, its payment a row above", () => {
    const bill = expense({ id: "inv40", description: "Renovation", category: "other", amount: 4000, vat: 0, documentRef: "INV 40", project: "Flat Rental", date: d("2026-10-12") })
    const movements = [
      movement({ kind: "supplier_payment", direction: "out", amount: 1500, expenseId: "inv40", description: "INV 40, first part", documentRef: "INV 40", project: "Flat Rental", date: d("2026-10-20") }),
      // After the period: not paid by its end.
      movement({ kind: "supplier_payment", direction: "out", amount: 500, expenseId: "inv40", description: "INV 40, second part", documentRef: "INV 40", project: "Flat Rental", date: d("2026-11-03") }),
    ]
    const input = { accounts: [MAIN, SECOND], rows: rowsOf({ expenses: [bill], movements }), invoices: [], expenses: [bill], loans: [], movements }
    const lines = linesOf(exportCsv(input, october).csv)
    expect(lines).toContain('20/10/2026;Main Bank;Supplier Invoice Payment;"INV 40, first part";INV 40;Flat Rental;;;1500,00;;;')
    expect(lines).toContain("12/10/2026;Supplier invoice;Other;Renovation;INV 40;Flat Rental;4000,00;;1500,00;2500,00;;")
    // The invoice is the cost, once: the payment is in no result.
    expect(lines).toContain("Flat Rental;0,00;4000,00;-4000,00;Loss;0,00;0,00")
  })

  it("quotes a comma so an English-locale Excel keeps a payload in one cell", () => {
    const movements = [movement({ kind: "capital", direction: "in", amount: 50, description: "x,=1+1" })]
    const input = { accounts: [MAIN, SECOND], rows: rowsOf({ movements }), invoices: [], expenses: [], loans: [], movements }
    expect(linesOf(exportCsv(input, october).csv)).toContain('01/10/2026;Main Bank;Share Capital;"x,=1+1";;;;50,00;;;;')
  })

  it("keeps a credit note's VAT a number and lists the untagged rows under Untagged", () => {
    const invoices = [invoice({ id: "nc", number: "NC 1/2026", amount: -100, vat: -22, paidDate: d("2026-10-05"), paidAccountId: "main" })]
    const movements = [movement({ kind: "capital", direction: "in", amount: 50, description: "Capital" })]
    const input = { accounts: [MAIN, SECOND], rows: rowsOf({ invoices, movements }), invoices, expenses: [], loans: [], movements }
    // -22,00, never '-22,00: Excel would read the apostrophe as text and leave it out of a SUM.
    expect(exportCsv(input, october).csv).toContain("05/10/2026;Main Bank;Credit Note;Credit note NC 1/2026;NC 1/2026;Consulting;;;122,00;-22,00;;")
    const lines = linesOf(exportCsv(input, { ...october, costCentre: "Untagged" }).csv)
    expect(lines.slice(1, 3)).toEqual(["01/10/2026;Main Bank;Share Capital;Capital;;;;50,00;;;;", ""])
  })
})
