import { parseDDMMYYYY } from "./money-manager-import"

export interface ParsedCSV {
  headers: string[]
  rows: string[][]
}

// Most frequent of , ; and tab outside quotes; a tie goes to comma
function detectDelimiter(header: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 }
  let inQuotes = false

  for (let i = 0; i < header.length; i++) {
    const ch = header[i]
    if (ch === '"') {
      if (inQuotes && header[i + 1] === '"') {
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (!inQuotes && ch in counts) {
      counts[ch]++
    }
  }

  let delimiter = ","
  let max = counts[","]
  for (const d of [";", "\t"]) {
    if (counts[d] > max) {
      max = counts[d]
      delimiter = d
    }
  }
  return delimiter
}

function parseLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (inQuotes) {
        inQuotes = false
      } else if (current.trim() === "") {
        // a quote opens a quoted section only at the start of a field; elsewhere it is literal
        inQuotes = true
        current = ""
      } else {
        current += ch
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

export function parseCSV(text: string): ParsedCSV {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

  // Split into records on newlines outside quotes, so a quoted line break stays in its field
  // (a quote opens a quoted section only at the start of a field, so a stray one stays on its line)
  const delimiter = detectDelimiter(normalized.split("\n")[0])
  const records: string[] = []
  let current = ""
  let fieldStart = 0
  let inQuotes = false
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        current += '""'
        i++
      } else if (inQuotes) {
        inQuotes = false
        current += ch
      } else {
        if (current.slice(fieldStart).trim() === "") inQuotes = true
        current += ch
      }
    } else if (ch === "\n" && !inQuotes) {
      records.push(current)
      current = ""
      fieldStart = 0
    } else if (ch === delimiter && !inQuotes) {
      current += ch
      fieldStart = current.length
    } else {
      current += ch
    }
  }
  records.push(current)

  const lines = records.filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }

  const headers = parseLine(lines[0], delimiter)
  const rows = lines.slice(1).map((l) => parseLine(l, delimiter))
  return { headers, rows }
}

// ─── Date Parsing ─────────────────────────────────────────────────────────────

export type DateOrder = "dmy" | "mdy"

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?.*)?$/
const SLASH_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/
const DASH_PATTERN = /^(\d{1,2})-(\d{1,2})-(\d{4})$/
const COMPACT_PATTERN = /^\d{8}$/

// Build a Date and reject impossible values (month 13, Feb 30) instead of letting
// Date roll them over into the next month
function makeDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month - 1, day)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return d
}

export function tryParseDate(value: string, order: DateOrder = "mdy"): Date | null {
  const v = value.trim()

  // ISO 8601: 2024-01-15 or 2024-01-15T10:30:00
  if (ISO_PATTERN.test(v)) {
    if (!makeDate(parseInt(v.slice(0, 4), 10), parseInt(v.slice(5, 7), 10), parseInt(v.slice(8, 10), 10))) return null
    const d = new Date(v.includes("T") || v.includes(" ") ? v : v + "T00:00:00")
    return isNaN(d.getTime()) ? null : d
  }

  // a/b/yyyy or a/b/yy: the order is ambiguous, so it depends on `order`. An impossible
  // date returns null here and must not reach the native fallback, which rolls it over too
  const slash = v.match(SLASH_PATTERN)
  if (slash) {
    const a = parseInt(slash[1], 10)
    const b = parseInt(slash[2], 10)
    const year = slash[3].length === 4 ? parseInt(slash[3], 10) : 2000 + parseInt(slash[3], 10)
    if (order === "dmy" && slash[3].length === 4) return parseDDMMYYYY(v)
    return order === "dmy" ? makeDate(year, b, a) : makeDate(year, a, b)
  }

  // MM-DD-YYYY
  const dash = v.match(DASH_PATTERN)
  if (dash) {
    return makeDate(parseInt(dash[3], 10), parseInt(dash[1], 10), parseInt(dash[2], 10))
  }

  // YYYYMMDD
  if (COMPACT_PATTERN.test(v)) {
    return makeDate(
      parseInt(v.slice(0, 4), 10),
      parseInt(v.slice(4, 6), 10),
      parseInt(v.slice(6, 8), 10),
    )
  }

  // Fallback to native Date parsing
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

// ─── Amount Parsing ───────────────────────────────────────────────────────────

export type DecimalSeparator = "." | ","

export function tryParseAmount(value: string, decimalSeparator: DecimalSeparator = "."): number | null {
  // Handle parentheses as negatives: (1,234.56) → -1234.56
  const withParens = value.trim().replace(/^\((.+)\)$/, "-$1")
  // Remove currency symbols and thousand separators; with a comma decimal the
  // period and spaces are the thousand separators
  const cleaned =
    decimalSeparator === ","
      ? withParens.replace(/[$€£¥₹.\s]/g, "").replace(",", ".").trim()
      : withParens.replace(/[$€£¥₹,\s]/g, "").trim()
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

// ─── Format Auto-Detection ────────────────────────────────────────────────────

// a/b/yyyy or a/b/yy values: a first part over 12 means day-first, a second part over 12 means
// month-first. null when nothing decides it.
export function detectDateOrder(values: string[]): DateOrder | null {
  for (const raw of values) {
    const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
    if (!m) continue
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    if (a > 12 && b <= 12) return "dmy"
    if (b > 12 && a <= 12) return "mdy"
  }
  return null
}

// Values ending in ",dd" with none ending in ".dd" mean a comma decimal. null otherwise.
export function detectDecimalSeparator(values: string[]): DecimalSeparator | null {
  let endsComma = false
  let endsPeriod = false
  for (const raw of values) {
    const v = raw.trim()
    if (/,\d{1,2}$/.test(v)) endsComma = true
    if (/\.\d{1,2}$/.test(v)) endsPeriod = true
  }
  return endsComma && !endsPeriod ? "," : null
}

// ─── Auto-Suggest Column Mapping ──────────────────────────────────────────────

const COLUMN_HINTS: Record<string, string[]> = {
  date: ["date", "trans date", "transaction date", "posted", "value date", "booking date"],
  description: ["description", "desc", "memo", "payee", "merchant", "name", "narration", "particulars", "details"],
  amount: ["amount", "total", "value", "sum", "net amount", "debit/credit"],
  type: ["type", "transaction type", "kind", "dr/cr", "cr/dr", "debit/credit"],
  notes: ["note", "notes", "comment", "reference", "ref", "remark"],
}

export function autoSuggestColumns(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  const normalized = headers.map((h) => h.toLowerCase().trim())

  for (const [field, hints] of Object.entries(COLUMN_HINTS)) {
    for (const hint of hints) {
      const idx = normalized.findIndex((h) => h.includes(hint))
      if (idx !== -1) {
        result[field] = headers[idx]
        break
      }
    }
  }

  return result
}

// ─── Type Inference ───────────────────────────────────────────────────────────

// ─── Import Hash ──────────────────────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 hash for a CSV row to enable idempotent imports.
 * Input string: "accountId|yyyy-MM-dd|amount.toFixed(2)|description.toLowerCase().trim()"
 */
export async function computeImportHash(
  accountId: string,
  date: Date,
  amount: number,
  description: string
): Promise<string> {
  const raw = [
    accountId,
    date.toISOString().slice(0, 10),
    amount.toFixed(2),
    description.toLowerCase().trim(),
  ].join("|")
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

import type { TransactionType } from "../types"

/**
 * Infer transaction type from amount sign.
 * @param amount Raw (signed) amount from CSV
 * @param flipped When true, positive amounts are treated as expenses
 */
export function inferTransactionType(amount: number, flipped: boolean): TransactionType {
  const isPositive = amount > 0
  return (flipped ? !isPositive : isPositive) ? "income" : "expense"
}

/**
 * Parse a type string from a CSV column value into TransactionType.
 * Defaults to "expense" for unrecognized values.
 */
export function typeFromString(value: string): TransactionType {
  const v = value.toLowerCase().trim()
  if (
    v.includes("credit") ||
    v.includes("income") ||
    v.includes("deposit") ||
    v === "cr" ||
    v === "in"
  ) {
    return "income"
  }
  return "expense"
}
