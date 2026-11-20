import { format } from "date-fns"

import { CSV_BOM, escapeCsvValue } from "./export"

import type { Account, Transaction, TransactionSplit } from "../types"

export interface BuildTransactionsCsvInput {
  transactions: Transaction[]
  accounts: Account[]
  dateFrom: Date
  dateTo: Date
  expandSplits?: boolean
}

const HEADERS = [
  "Date",
  "Status",
  "Type",
  "Description",
  "Amount",
  "Currency",
  "Account",
  "Category",
  "Notes",
] as const

interface CsvRow {
  date: string
  status: string
  type: string
  description: string
  amount: string
  currency: string
  account: string
  category: string
  notes: string
}

/**
 * Build a CSV string of transactions over a custom date range.
 *
 * Range is inclusive on both endpoints (day granularity).
 * `expandSplits = true` emits one row per split for transactions with non-empty splits[];
 * otherwise such transactions emit a single row with empty Category and the parent amount.
 * Rows are sorted by (date asc, description asc) for deterministic output.
 */
export function buildTransactionsCsv(input: BuildTransactionsCsvInput): string {
  const { transactions, accounts, dateFrom, dateTo, expandSplits = false } = input
  if (dateFrom > dateTo) {
    throw new Error("buildTransactionsCsv: dateFrom must be <= dateTo")
  }

  const accountMap = new Map(accounts.map((a) => [a.id, a]))
  const rangeStart = startOfDay(dateFrom)
  const rangeEnd = endOfDay(dateTo)

  const inRange = transactions
    .filter((t) => t.date >= rangeStart && t.date <= rangeEnd)
    .slice()
    .sort((a, b) => {
      const dt = a.date.getTime() - b.date.getTime()
      if (dt !== 0) return dt
      return a.description.localeCompare(b.description)
    })

  const lines: string[] = [HEADERS.join(",")]

  for (const tx of inRange) {
    const accountName = accountMap.get(tx.accountId)?.name ?? tx.accountId
    if (expandSplits && tx.splits.length > 0) {
      for (const split of tx.splits) {
        lines.push(rowToCsv(buildSplitRow(tx, split, accountName)))
      }
    } else {
      lines.push(rowToCsv(buildParentRow(tx, accountName)))
    }
  }

  return CSV_BOM + lines.join("\n")
}

function buildParentRow(tx: Transaction, accountName: string): CsvRow {
  return {
    date: format(tx.date, "yyyy-MM-dd"),
    status: tx.status,
    type: tx.type,
    description: tx.description,
    amount: tx.amount.toFixed(2),
    currency: tx.currency,
    account: accountName,
    category: tx.categoryId ?? "",
    notes: tx.notes ?? "",
  }
}

function buildSplitRow(tx: Transaction, split: TransactionSplit, accountName: string): CsvRow {
  const description = split.note ? `${tx.description} — ${split.note}` : tx.description
  return {
    date: format(tx.date, "yyyy-MM-dd"),
    status: tx.status,
    type: tx.type,
    description,
    amount: split.amount.toFixed(2),
    currency: tx.currency,
    account: accountName,
    category: split.categoryId,
    notes: tx.notes ?? "",
  }
}

/** The amount is a number, never text: a negative one must not get a quote prefix. */
const AMOUNT_COLUMN = 4

function rowToCsv(row: CsvRow): string {
  return [
    row.date,
    row.status,
    row.type,
    row.description,
    row.amount,
    row.currency,
    row.account,
    row.category,
    row.notes,
  ]
    .map((cell, i) => (i === AMOUNT_COLUMN ? cell : escapeCsvValue(cell)))
    .join(",")
}

export function transactionsCsvFileName(
  dateFrom: Date,
  dateTo: Date,
  expandSplits: boolean,
): string {
  const from = format(dateFrom, "yyyy-MM-dd")
  const to = format(dateTo, "yyyy-MM-dd")
  return `transactions-${from}_to_${to}${expandSplits ? "-expanded" : ""}.csv`
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function endOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(23, 59, 59, 999)
  return out
}
