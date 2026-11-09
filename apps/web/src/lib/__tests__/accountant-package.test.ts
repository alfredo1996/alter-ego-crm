import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it } from "vitest"

import { buildPackage, packageFileName, packagePeriod, packageSummary, paymentsCsv, quarterBounds } from "../accountant-package"
import { bookRows, exportCsv } from "../cash-book"

import type { CompanyAccount, CompanyExpense, CompanyMovement, Invoice } from "@/types"

const at = new Date(2026, 0, 1)
const d = (s: string) => new Date(`${s}T12:00:00`)
const account = (id: string, name: string): CompanyAccount => ({
  id, name, userId: "u", openingBalance: 1000, openingDate: d("2026-01-01"), statementBalance: null, statementDate: null, importRef: null, createdAt: at, updatedAt: at,
})
const ACCOUNTS = [account("main", "Main Bank"), account("second", "Second Bank")]
const file = (name: string) => ({ path: `f/${name}`, name, kind: "xml" as const, size: 3, uploadedAt: at })
const expense = (o: Partial<CompanyExpense> & Pick<CompanyExpense, "id" | "amount">): CompanyExpense => ({
  userId: "u", description: "Hosting", category: "bank_fees", date: d("2026-08-03"), isRecurring: false, recurrenceMonths: null, notes: null,
  accountId: "main", paidByOwner: false, vat: null, documentRef: null, project: null, recurringExpenseId: null, dateEstimated: false,
  importRef: null, collaboratorId: null, engagementId: null, forMonth: null, createdAt: at, updatedAt: at, ...o,
})
const movement = (o: Partial<CompanyMovement> & Pick<CompanyMovement, "id" | "kind" | "direction" | "amount">): CompanyMovement => ({
  userId: "u", date: d("2026-08-10"), accountId: "main", toAccountId: null, expenseId: null, description: "Row", documentRef: null,
  project: null, counterparty: null, notes: null, dateEstimated: false, importRef: null, createdAt: at, updatedAt: at, ...o,
})
const invoice = (o: Partial<Invoice> & Pick<Invoice, "id" | "number">): Invoice => ({
  userId: "u", clientId: "c1", engagementId: null, fromMonth: null, yearMonth: "2026-08", amount: 100, vat: 0, dueDate: null,
  paidDate: null, paidAccountId: null, createdAt: at, updatedAt: at, ...o,
})

const base = {
  expenses: [
    expense({ id: "e1", amount: 100, vat: 22, documentRef: "INV-1", description: "Hosting", file: file("e1.xml") }),
    expense({ id: "e2", amount: 5, description: "Bank fee", date: d("2026-09-30") }),
    expense({ id: "bill", amount: 1000, accountId: null, documentRef: "41/26", description: "Chairs", date: d("2026-07-15"), file: file("bill.xml") }),
    expense({ id: "old", amount: 9, description: "June cost", date: d("2026-06-30") }),
  ],
  movements: [
    movement({ id: "t", kind: "transfer", direction: "out", amount: 300, toAccountId: "second", description: "Top up" }),
    movement({ id: "tax", kind: "tax", direction: "out", amount: 50, description: "F24", counterparty: "Agenzia" }),
    movement({ id: "sp", kind: "supplier_payment", direction: "out", amount: 400, expenseId: "bill", counterparty: "Rossi", description: "Chairs, first part", date: d("2026-07-20") }),
    movement({ id: "in", kind: "income", direction: "in", amount: 70, description: "Refund in" }),
  ],
  invoices: [invoice({ id: "i1", number: "7" }), invoice({ id: "i2", number: "8", yearMonth: "2026-07", file: file("i2.xml") })],
  loans: [],
  clients: [],
  engagements: [],
}
const data = { accounts: ACCOUNTS, ...base, ...bookRows({ accounts: ACCOUNTS, ...base }) }
const q3 = { ...quarterBounds("2026", 3), accountId: null }

describe("paymentsCsv", () => {
  it("lists money out except transfers, with what each pays and its file", () => {
    const { csv, payments } = paymentsCsv(data, q3)
    expect(csv.replace("﻿", "").trim().split("\r\n")).toEqual([
      "Date;Account;Paid To;Description;Amount;VAT;Pays;File",
      "20/07/2026;Main Bank;Rossi;\"Chairs, first part\";400,00;;Supplier invoice 41/26;Yes",
      "03/08/2026;Main Bank;;Hosting;122,00;22,00;Cost INV-1;Yes",
      "10/08/2026;Main Bank;Agenzia;F24;50,00;;Tax (F24);No document",
      "30/09/2026;Main Bank;;Bank fee;5,00;0,00;Cost;Missing",
    ])
    expect(payments).toBe(4)
  })

  it("keeps one account, and the period's days", () => {
    expect(paymentsCsv(data, { ...q3, accountId: "second" }).payments).toBe(0)
    expect(paymentsCsv(data, { from: "2026-09-01", to: "2026-09-30", accountId: null }).payments).toBe(1)
  })
})

describe("paymentsCsv documents", () => {
  const body = (extra: object) => {
    const b = { ...base, ...extra }
    const all = { accounts: ACCOUNTS, ...b, ...bookRows({ accounts: ACCOUNTS, ...b }) }
    return paymentsCsv(all, q3).csv.replace("\uFEFF", "").trim().split("\r\n").slice(1)
  }
  it("shows the VAT of a credit note paid out, and leaves a cost refund out", () => {
    const rows = body({
      expenses: [expense({ id: "refund", amount: -50, description: "Returned chair" })],
      movements: [],
      invoices: [invoice({ id: "cn", number: "9", amount: -100, vat: -22, paidDate: d("2026-08-12"), paidAccountId: "main", file: file("cn.xml") })],
    })
    expect(rows).toEqual(["12/08/2026;Main Bank;;Credit note 9;122,00;22,00;Credit note 9;Yes"])
  })
  it("names a collaborator's cost, and flags a file that sits in another period's zip", () => {
    const rows = body({
      expenses: [
        expense({ id: "fee", amount: 300, description: "Fee", collaboratorId: "c1", date: d("2026-08-05") }),
        expense({ id: "june", amount: 80, accountId: null, documentRef: "9/26", description: "June bill", date: d("2026-06-20"), file: file("june.xml") }),
      ],
      movements: [movement({ id: "sp2", kind: "supplier_payment", direction: "out", amount: 80, expenseId: "june", date: d("2026-07-05"), description: "June bill paid" })],
      invoices: [],
      collaborators: [{ id: "c1", name: "Mara Bianchi" }],
    })
    expect(rows).toEqual([
      "05/07/2026;Main Bank;;June bill paid;80,00;;Supplier invoice 9/26;Yes (earlier period)",
      "05/08/2026;Main Bank;Mara Bianchi;Fee;300,00;0,00;Cost;Missing",
    ])
  })
})

describe("period names", () => {
  it.each([
    [{ from: "2026-10-01", to: "2026-10-31" }, "2026-10"],
    [{ from: "2026-07-01", to: "2026-09-30" }, "2026-Q3"],
    [{ from: "2026-01-01", to: "2026-12-31" }, "2026"],
    [{ from: "2026-01-01", to: "2026-03-31" }, "2026-Q1"],
  ])("%j is %s", (p, name) => {
    expect(packagePeriod(p)).toBe(name)
    expect(packageFileName(p)).toBe(`${name}-accountant-package.zip`)
  })
  it("gives each quarter its bounds", () => {
    expect([1, 2, 3, 4].map((q) => quarterBounds("2026", q))).toEqual([
      { from: "2026-01-01", to: "2026-03-31" }, { from: "2026-04-01", to: "2026-06-30" },
      { from: "2026-07-01", to: "2026-09-30" }, { from: "2026-10-01", to: "2026-12-31" },
    ])
  })
})

describe("buildPackage", () => {
  const load = async (f: { name: string }) => new TextEncoder().encode(f.name)
  it("zips the CSVs and the files of a quarter spanning months, even when names clash", async () => {
    const clash = {
      ...data,
      expenses: [...data.expenses, expense({ id: "e3", amount: 1, description: "Hosting", documentRef: "INV-1", file: file("e3.xml") })],
    }
    const out = await buildPackage(clash, q3, () => "Acme", load)
    const zip = unzipSync(out.bytes)
    expect(Object.keys(zip).sort()).toEqual([
      "costs/2026-07-15 Chairs (41-26).xml",
      "costs/2026-08-03 Hosting (INV-1) (2).xml",
      "costs/2026-08-03 Hosting (INV-1).xml",
      "invoices/2026-07 Invoice 8 (Acme).xml",
      "payments-2026-Q3.csv",
      "prima-nota-2026-Q3.csv",
    ])
    expect(strFromU8(zip["payments-2026-Q3.csv"])).toBe(paymentsCsv(clash, q3).csv.replace("\uFEFF", ""))
    expect(strFromU8(zip["prima-nota-2026-Q3.csv"])).toBe(exportCsv(clash, { ...q3, costCentre: null }).csv.replace("\uFEFF", ""))
    expect([out.name, out.files, out.missing]).toEqual(["2026-Q3-accountant-package.zip", 4, 2])
  })
  it("counts for the status line", () => {
    expect(packageSummary(data, q3, () => "Acme")).toMatchObject({ rows: exportCsv(data, { ...q3, costCentre: null }).rows, payments: 4, files: 3, costsWithout: 1, invoicesWithout: 1 })
  })
})
