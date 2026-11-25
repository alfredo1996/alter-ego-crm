import { describe, it, expect } from "vitest"

import {
  parseCSV,
  tryParseDate,
  tryParseAmount,
  detectDateOrder,
  detectDecimalSeparator,
  autoSuggestColumns,
  inferTransactionType,
  typeFromString,
  computeImportHash,
} from "../csv-import"

// ─── parseCSV ─────────────────────────────────────────────────────────────────

describe("parseCSV", () => {
  it("keeps a stray quote inside a field on its own line", () => {
    const result = parseCSV('Date,Description,Amount\n2024-01-15,TV 55" SCREEN,-500\n2024-01-16,COFFEE,-3\n2024-01-17,BOOKS,-20\n2024-01-18,RENT,-900')
    expect(result.rows).toHaveLength(4)
    expect(result.rows.slice(1)).toEqual([
      ["2024-01-16", "COFFEE", "-3"],
      ["2024-01-17", "BOOKS", "-20"],
      ["2024-01-18", "RENT", "-900"],
    ])
  })

  it("parses a simple CSV with one data row", () => {
    const result = parseCSV("date,amount,description\n2024-01-15,100.00,Salary")
    expect(result.headers).toEqual(["date", "amount", "description"])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toEqual(["2024-01-15", "100.00", "Salary"])
  })

  it("parses quoted fields containing commas", () => {
    const result = parseCSV('date,description\n2024-01-15,"Coffee, Tea"')
    expect(result.rows[0]).toEqual(["2024-01-15", "Coffee, Tea"])
  })

  it("parses escaped double-quotes inside quoted fields", () => {
    const result = parseCSV('name\n"He said ""hello"""')
    expect(result.rows[0]).toEqual(['He said "hello"'])
  })

  it("handles CRLF line endings", () => {
    const result = parseCSV("date,amount\r\n2024-01-15,100\r\n2024-01-16,200")
    expect(result.headers).toEqual(["date", "amount"])
    expect(result.rows).toHaveLength(2)
  })

  it("handles CR-only line endings", () => {
    const result = parseCSV("date,amount\r2024-01-15,100")
    expect(result.headers).toEqual(["date", "amount"])
    expect(result.rows).toHaveLength(1)
  })

  it("skips blank lines between rows", () => {
    const result = parseCSV("date,amount\n2024-01-15,100\n\n2024-01-16,200")
    expect(result.rows).toHaveLength(2)
  })

  it("returns empty result for an empty string", () => {
    const result = parseCSV("")
    expect(result.headers).toEqual([])
    expect(result.rows).toHaveLength(0)
  })

  it("returns empty result for whitespace-only input", () => {
    const result = parseCSV("   \n  \n")
    expect(result.headers).toEqual([])
    expect(result.rows).toHaveLength(0)
  })

  it("trims whitespace from field values", () => {
    const result = parseCSV(" date , amount \n 2024-01-15 , 100 ")
    expect(result.headers).toEqual(["date", "amount"])
    expect(result.rows[0]).toEqual(["2024-01-15", "100"])
  })

  it("handles header-only CSV with no data rows", () => {
    const result = parseCSV("date,amount,description")
    expect(result.headers).toEqual(["date", "amount", "description"])
    expect(result.rows).toHaveLength(0)
  })

  it("handles a single-column CSV", () => {
    const result = parseCSV("name\nAlice\nBob")
    expect(result.headers).toEqual(["name"])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual(["Alice"])
  })

  it("preserves whitespace inside quoted fields", () => {
    const result = parseCSV('note\n"  spaced  "')
    expect(result.rows[0]).toEqual(["spaced"])
  })

  it("parses semicolon-delimited CSV and keeps the decimal comma in its field", () => {
    const result = parseCSV("Data;Importo\n15/01/2024;-12,50")
    expect(result.headers).toEqual(["Data", "Importo"])
    expect(result.rows).toEqual([["15/01/2024", "-12,50"]])
  })

  it("parses tab-delimited CSV", () => {
    const result = parseCSV("Date\tAmount\n2024-01-15\t-5")
    expect(result.headers).toEqual(["Date", "Amount"])
    expect(result.rows).toEqual([["2024-01-15", "-5"]])
  })

  it("keeps a line break inside a quoted field in a single row", () => {
    const result = parseCSV('date,desc,amount\n2024-01-15,"line one\nline two",-5')
    expect(result.rows).toEqual([["2024-01-15", "line one\nline two", "-5"]])
  })

  it("keeps a comma inside quotes in a semicolon-delimited file", () => {
    const result = parseCSV('Data;Note\n2024-01-15;"a, b"')
    expect(result.rows).toEqual([["2024-01-15", "a, b"]])
  })
})

// ─── tryParseDate ─────────────────────────────────────────────────────────────

describe("tryParseDate", () => {
  it("parses ISO 8601 date (yyyy-MM-dd)", () => {
    const d = tryParseDate("2024-01-15")
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2024)
    expect(d!.getMonth()).toBe(0) // January = 0
    expect(d!.getDate()).toBe(15)
  })

  it("parses ISO 8601 datetime with T separator", () => {
    const d = tryParseDate("2024-03-01T10:30:00")
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2024)
    expect(d!.getMonth()).toBe(2)
  })

  it("parses MM/DD/YYYY format", () => {
    const d = tryParseDate("01/15/2024")
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2024)
    expect(d!.getMonth()).toBe(0)
    expect(d!.getDate()).toBe(15)
  })

  it("parses M/D/YYYY without zero-padding", () => {
    const d = tryParseDate("1/5/2024")
    expect(d).not.toBeNull()
    expect(d!.getMonth()).toBe(0)
    expect(d!.getDate()).toBe(5)
  })

  it("parses MM/DD/YY two-digit year", () => {
    const d = tryParseDate("01/15/24")
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2024)
    expect(d!.getDate()).toBe(15)
  })

  it("parses MM-DD-YYYY format", () => {
    const d = tryParseDate("01-15-2024")
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2024)
    expect(d!.getDate()).toBe(15)
  })

  it("parses YYYYMMDD compact format", () => {
    const d = tryParseDate("20240115")
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2024)
    expect(d!.getMonth()).toBe(0)
    expect(d!.getDate()).toBe(15)
  })

  it("returns null for an invalid date string", () => {
    expect(tryParseDate("not-a-date")).toBeNull()
  })

  it("returns null for an empty string", () => {
    expect(tryParseDate("")).toBeNull()
  })

  it("trims surrounding whitespace before parsing", () => {
    const d = tryParseDate("  2024-01-15  ")
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2024)
  })

  it("returns null for a string with only numbers that isn't a valid compact date", () => {
    // 7-digit number doesn't match any pattern
    expect(tryParseDate("2024011")).toBeNull()
  })

  it.each([
    ["15/01/2024", "dmy", new Date(2024, 0, 15)],
    ["05/01/2024", "dmy", new Date(2024, 0, 5)],
    ["05/01/24", "dmy", new Date(2024, 0, 5)],
    ["01/15/2024", "mdy", new Date(2024, 0, 15)],
    ["2024-01-15", "dmy", new Date(2024, 0, 15)],
    ["20240115", "dmy", new Date(2024, 0, 15)],
    ["2024-01-15", "mdy", new Date(2024, 0, 15)],
    ["20240115", "mdy", new Date(2024, 0, 15)],
    ["05-01-2024", "dmy", new Date(2024, 0, 5)],
    ["15-01-2024", "dmy", new Date(2024, 0, 15)],
    ["05-01-2024", "mdy", new Date(2024, 4, 1)],
    ["05-01-2024", undefined, new Date(2024, 4, 1)],
    ["01-15-2024", "mdy", new Date(2024, 0, 15)],
  ] as const)("parses %s in %s order as %s", (value, order, expected) => {
    expect(tryParseDate(value, order)).toEqual(expected)
  })

  it.each([
    ["15/01/2024", "mdy"],
    ["31/02/2024", "dmy"],
    ["02/30/2024", "mdy"],
    ["02/30/2024", undefined],
    ["15/01/2024", undefined],
    ["13-45-2024", undefined],
    ["02-30-2024", undefined],
    ["02-30-2024", "mdy"],
    ["2024-02-30", undefined],
    ["15-01-2024", "mdy"],
    ["31-02-2024", "dmy"],
  ] as const)("returns null for the impossible date %s (order %s)", (value, order) => {
    expect(tryParseDate(value, order)).toBeNull()
  })
})

// ─── tryParseAmount ───────────────────────────────────────────────────────────

describe("tryParseAmount", () => {
  it("parses a plain positive decimal", () => {
    expect(tryParseAmount("100.50")).toBe(100.5)
  })

  it("parses a negative number", () => {
    expect(tryParseAmount("-50.00")).toBe(-50)
  })

  it("strips leading $ symbol", () => {
    expect(tryParseAmount("$1,234.56")).toBe(1234.56)
  })

  it("strips € symbol", () => {
    expect(tryParseAmount("€99.99")).toBe(99.99)
  })

  it("strips £ symbol", () => {
    expect(tryParseAmount("£500")).toBe(500)
  })

  it("handles parentheses as negative (accounting format)", () => {
    expect(tryParseAmount("(1,234.56)")).toBe(-1234.56)
  })

  it("strips thousand-separator commas", () => {
    expect(tryParseAmount("1,000,000.00")).toBe(1_000_000)
  })

  it("parses zero", () => {
    expect(tryParseAmount("0")).toBe(0)
  })

  it("parses an integer without decimal", () => {
    expect(tryParseAmount("250")).toBe(250)
  })

  it("returns null for an empty string", () => {
    expect(tryParseAmount("")).toBeNull()
  })

  it("returns null for a non-numeric string", () => {
    expect(tryParseAmount("N/A")).toBeNull()
  })

  it("returns null for whitespace-only string", () => {
    expect(tryParseAmount("   ")).toBeNull()
  })

  it("handles negative with currency symbol", () => {
    expect(tryParseAmount("-$42.00")).toBe(-42)
  })

  it.each([
    ["12,50", 12.5],
    ["1.234,56", 1234.56],
    ["-3,50", -3.5],
    ["1 234,56", 1234.56],
    ["€12,50", 12.5],
    ["(1.234,56)", -1234.56],
  ])("parses %s as %s with a comma decimal separator", (value, expected) => {
    expect(tryParseAmount(value, ",")).toBe(expected)
  })

  it("keeps the period default: 12,50 reads as 1250", () => {
    expect(tryParseAmount("12,50")).toBe(1250)
  })
})

// ─── detectDateOrder ──────────────────────────────────────────────────────────

describe("detectDateOrder", () => {
  it.each([
    ["a day-first column", ["15/01/2024", "20/12/2024", "03/11/2024"], "dmy"],
    ["a two-digit-year day-first column", ["15/01/24"], "dmy"],
    ["a month-first column", ["01/15/2024", "12/20/2024", "11/03/2024"], "mdy"],
    ["an ambiguous column", ["05/01/2024", "12/11/2024"], null],
    ["a column without slash dates", ["2024-01-15", "20240115"], null],
    ["a day-first dash column", ["15-01-2024", "05-01-2024"], "dmy"],
    ["a month-first dash column", ["01-15-2024"], "mdy"],
    ["an ambiguous dash column", ["05-01-2024", "12-11-2024"], null],
    ["a mixed-separator value", ["15/01-2024"], null],
    ["an empty column", [], null],
  ])("%s", (_name, values, expected) => {
    expect(detectDateOrder(values)).toBe(expected)
  })
})

// ─── detectDecimalSeparator ───────────────────────────────────────────────────

describe("detectDecimalSeparator", () => {
  it.each([
    ["a comma column", ["-3,50", "1.234,56", "12,00"], ","],
    ["a period column", ["3.50", "1,234.56", "12.00"], null],
    ["a mixed column", ["3,50", "4.20"], null],
    ["integers only", ["100", "250"], null],
    ["an empty column", [], null],
  ])("%s", (_name, values, expected) => {
    expect(detectDecimalSeparator(values)).toBe(expected)
  })
})

describe("day-first CSV with decimal-comma amounts (Auto detection)", () => {
  it("imports 15/01/2024,Coffee,\"-3,50\" as one 3.50 expense on 15 January 2024", () => {
    const parsed = parseCSV('Date,Description,Amount\n15/01/2024,Coffee,"-3,50"')
    const dates = parsed.rows.map((r) => r[parsed.headers.indexOf("Date")])
    const amounts = parsed.rows.map((r) => r[parsed.headers.indexOf("Amount")])
    const order = detectDateOrder(dates) ?? "mdy"
    const sep = detectDecimalSeparator(amounts) ?? "."
    const amount = tryParseAmount(amounts[0], sep)

    expect(tryParseDate(dates[0], order)).toEqual(new Date(2024, 0, 15))
    expect(amount).toBe(-3.5)
    expect(inferTransactionType(amount!, false)).toBe("expense")
  })
})

// ─── autoSuggestColumns ───────────────────────────────────────────────────────

describe("autoSuggestColumns", () => {
  it("suggests date column from 'Date' header", () => {
    const r = autoSuggestColumns(["Date", "Amount", "Description"])
    expect(r.date).toBe("Date")
  })

  it("suggests description from 'Memo' header", () => {
    const r = autoSuggestColumns(["Date", "Amount", "Memo"])
    expect(r.description).toBe("Memo")
  })

  it("suggests amount from 'Amount' header", () => {
    const r = autoSuggestColumns(["Date", "Amount", "Memo"])
    expect(r.amount).toBe("Amount")
  })

  it("suggests type from 'Transaction Type' header", () => {
    const r = autoSuggestColumns(["Date", "Amount", "Memo", "Transaction Type"])
    expect(r.type).toBe("Transaction Type")
  })

  it("suggests notes from 'Notes' header", () => {
    const r = autoSuggestColumns(["Date", "Amount", "Memo", "Notes"])
    expect(r.notes).toBe("Notes")
  })

  it("uses case-insensitive partial matching", () => {
    const r = autoSuggestColumns(["TRANSACTION DATE", "AMOUNT", "PAYEE"])
    expect(r.date).toBe("TRANSACTION DATE")
    expect(r.description).toBe("PAYEE")
    expect(r.amount).toBe("AMOUNT")
  })

  it("returns empty object for fully unrecognized headers", () => {
    const r = autoSuggestColumns(["col1", "col2", "col3"])
    expect(r.date).toBeUndefined()
    expect(r.description).toBeUndefined()
    expect(r.amount).toBeUndefined()
  })

  it("suggests from partial matches like 'Posted Date'", () => {
    const r = autoSuggestColumns(["Posted Date", "Net Amount", "Merchant Name"])
    expect(r.date).toBe("Posted Date")
    expect(r.description).toBe("Merchant Name")
    expect(r.amount).toBe("Net Amount")
  })

  it("suggests notes from 'Reference' header", () => {
    const r = autoSuggestColumns(["Date", "Amount", "Payee", "Reference"])
    expect(r.notes).toBe("Reference")
  })
})

// ─── inferTransactionType ─────────────────────────────────────────────────────

describe("inferTransactionType", () => {
  it("positive amount is income by default", () => {
    expect(inferTransactionType(100, false)).toBe("income")
  })

  it("negative amount is expense by default", () => {
    expect(inferTransactionType(-50, false)).toBe("expense")
  })

  it("positive amount is expense when signs are flipped", () => {
    expect(inferTransactionType(100, true)).toBe("expense")
  })

  it("negative amount is income when signs are flipped", () => {
    expect(inferTransactionType(-50, true)).toBe("income")
  })

  it("zero amount is treated as expense (not positive)", () => {
    expect(inferTransactionType(0, false)).toBe("expense")
  })

  it("zero amount is treated as income when flipped", () => {
    expect(inferTransactionType(0, true)).toBe("income")
  })
})

// ─── typeFromString ───────────────────────────────────────────────────────────

describe("typeFromString", () => {
  it("returns income for 'credit'", () => {
    expect(typeFromString("credit")).toBe("income")
  })

  it("returns income for 'Credit' (mixed case)", () => {
    expect(typeFromString("Credit")).toBe("income")
  })

  it("returns income for 'CREDIT' (uppercase)", () => {
    expect(typeFromString("CREDIT")).toBe("income")
  })

  it("returns income for 'income'", () => {
    expect(typeFromString("income")).toBe("income")
  })

  it("returns income for 'deposit'", () => {
    expect(typeFromString("deposit")).toBe("income")
  })

  it("returns income for 'CR' abbreviation", () => {
    expect(typeFromString("CR")).toBe("income")
  })

  it("returns income for 'in'", () => {
    expect(typeFromString("in")).toBe("income")
  })

  it("returns expense for 'debit'", () => {
    expect(typeFromString("debit")).toBe("expense")
  })

  it("returns expense for 'payment'", () => {
    expect(typeFromString("payment")).toBe("expense")
  })

  it("returns expense for an unrecognised value", () => {
    expect(typeFromString("other")).toBe("expense")
  })

  it("returns expense for an empty string", () => {
    expect(typeFromString("")).toBe("expense")
  })

  it("returns expense for whitespace-only string", () => {
    expect(typeFromString("   ")).toBe("expense")
  })
})

// ─── computeImportHash ────────────────────────────────────────────────────────

describe("computeImportHash", () => {
  const ACCOUNT_ID = "acc-123"
  const DATE = new Date("2024-03-15T00:00:00")
  const AMOUNT = 42.5
  const DESCRIPTION = "Coffee Shop"

  it("is deterministic — same inputs always produce the same hash", async () => {
    const h1 = await computeImportHash(ACCOUNT_ID, DATE, AMOUNT, DESCRIPTION)
    const h2 = await computeImportHash(ACCOUNT_ID, DATE, AMOUNT, DESCRIPTION)
    expect(h1).toBe(h2)
  })

  it("produces a 64-character hex string (SHA-256)", async () => {
    const hash = await computeImportHash(ACCOUNT_ID, DATE, AMOUNT, DESCRIPTION)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("changing the date produces a different hash", async () => {
    const h1 = await computeImportHash(ACCOUNT_ID, DATE, AMOUNT, DESCRIPTION)
    const h2 = await computeImportHash(ACCOUNT_ID, new Date("2024-03-16T00:00:00"), AMOUNT, DESCRIPTION)
    expect(h1).not.toBe(h2)
  })

  it("changing the amount produces a different hash", async () => {
    const h1 = await computeImportHash(ACCOUNT_ID, DATE, AMOUNT, DESCRIPTION)
    const h2 = await computeImportHash(ACCOUNT_ID, DATE, 99.99, DESCRIPTION)
    expect(h1).not.toBe(h2)
  })

  it("description comparison is case-insensitive ('Coffee' and 'coffee' yield the same hash)", async () => {
    const h1 = await computeImportHash(ACCOUNT_ID, DATE, AMOUNT, "Coffee")
    const h2 = await computeImportHash(ACCOUNT_ID, DATE, AMOUNT, "coffee")
    expect(h1).toBe(h2)
  })

  it("different descriptions produce different hashes", async () => {
    const h1 = await computeImportHash(ACCOUNT_ID, DATE, AMOUNT, "Coffee")
    const h2 = await computeImportHash(ACCOUNT_ID, DATE, AMOUNT, "Tea")
    expect(h1).not.toBe(h2)
  })

  it("changing the accountId produces a different hash", async () => {
    const h1 = await computeImportHash("acc-1", DATE, AMOUNT, DESCRIPTION)
    const h2 = await computeImportHash("acc-2", DATE, AMOUNT, DESCRIPTION)
    expect(h1).not.toBe(h2)
  })
})
