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
      } else {
        inQuotes = !inQuotes
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
  const records: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        current += '""'
        i++
      } else {
        inQuotes = !inQuotes
        current += ch
      }
    } else if (ch === "\n" && !inQuotes) {
      records.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  records.push(current)

  const lines = records.filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }

  const delimiter = detectDelimiter(lines[0])
  const headers = parseLine(lines[0], delimiter)
  const rows = lines.slice(1).map((l) => parseLine(l, delimiter))
  return { headers, rows }
}

// ─── Date Parsing ─────────────────────────────────────────────────────────────

const DATE_PARSERS: Array<{ pattern: RegExp; parse: (s: string) => Date }> = [
  // ISO 8601: 2024-01-15 or 2024-01-15T10:30:00
  {
    pattern: /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?.*)?$/,
    parse: (s) => new Date(s.includes("T") || s.includes(" ") ? s : s + "T00:00:00"),
  },
  // MM/DD/YYYY
  {
    pattern: /^\d{1,2}\/\d{1,2}\/\d{4}$/,
    parse: (s) => {
      const [m, d, y] = s.split("/").map(Number)
      return new Date(y, m - 1, d)
    },
  },
  // MM/DD/YY
  {
    pattern: /^\d{1,2}\/\d{1,2}\/\d{2}$/,
    parse: (s) => {
      const [m, d, y] = s.split("/").map(Number)
      return new Date(2000 + y, m - 1, d)
    },
  },
  // MM-DD-YYYY
  {
    pattern: /^\d{1,2}-\d{1,2}-\d{4}$/,
    parse: (s) => {
      const [m, d, y] = s.split("-").map(Number)
      return new Date(y, m - 1, d)
    },
  },
  // YYYYMMDD
  {
    pattern: /^\d{8}$/,
    parse: (s) =>
      new Date(parseInt(s.slice(0, 4)), parseInt(s.slice(4, 6)) - 1, parseInt(s.slice(6, 8))),
  },
]

export function tryParseDate(value: string): Date | null {
  const v = value.trim()
  for (const { pattern, parse } of DATE_PARSERS) {
    if (pattern.test(v)) {
      const d = parse(v)
      if (!isNaN(d.getTime())) return d
    }
  }
  // Fallback to native Date parsing
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

// ─── Amount Parsing ───────────────────────────────────────────────────────────

export function tryParseAmount(value: string): number | null {
  // Handle parentheses as negatives: (1,234.56) → -1234.56
  const withParens = value.trim().replace(/^\((.+)\)$/, "-$1")
  // Remove currency symbols and thousand separators
  const cleaned = withParens.replace(/[$€£¥₹,\s]/g, "").trim()
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
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
