import type { AccountType, CategoryGroup, Currency, TransactionType } from "../types"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MoneyManagerRow {
  date: Date
  accountName: string
  type: TransactionType
  categoryName: string | null
  destAccountName: string | null
  description: string
  amount: number
  currency: Currency
  notes: string | null
  excludeFromReports: boolean
}

export interface ParseResult {
  rows: MoneyManagerRow[]
  errors: Array<{ line: number; message: string }>
  skippedIngresso: number        // count of "Trasferimento ingresso" rows dropped
  accountNames: string[]         // unique normalized, sorted
  categoryNames: string[]        // unique, sorted
}

export interface ResolvedAccount {
  sourceName: string
  displayName: string
  existingId: string | null
  type: AccountType
  enabled: boolean
}

export interface ResolvedCategory {
  sourceName: string
  displayName: string
  existingId: string | null
  group: CategoryGroup
}

// ─── Real Money Manager Column Layout (11 columns, TSV) ─────────────────────
//
//  Col 0: Periodo          → date (DD/MM/YYYY)
//  Col 1: Conto            → account name
//  Col 2: Categoria        → category name  —OR—  counterpart account (transfers)
//  Col 3: Sotto-categoria  → sub-category (usually empty)
//  Col 4: Nota             → description (merchant/payee)
//  Col 5: EUR              → amount (comma decimal)
//  Col 6: Guadagni/Spese   → type
//  Col 7: Descrizione      → notes
//  Col 8: Importo          → amount (duplicate, ignored)
//  Col 9: Valuta           → currency string (e.g. "EUR")
//  Col 10: Conto           → account name (duplicate, ignored)
//
// Type values:
//   "Spese"                   → expense
//   "In"                      → income
//   "Trasferimento uscita"    → transfer (we keep this one)
//   "Trasferimento ingresso"  → SKIP (symmetric duplicate)

// ─── Italian Type Mapping ────────────────────────────────────────────────────

type MMRawType = TransactionType | "skip"

interface MMTypeResult {
  type: MMRawType
  excludeFromReports: boolean
}

function mapType(raw: string): MMTypeResult | null {
  const v = raw.trim().toLowerCase()
  if (v === "spese" || v === "spesa") return { type: "expense", excludeFromReports: false }
  if (v === "in" || v === "entrata") return { type: "income", excludeFromReports: false }
  if (v === "trasferimento uscita") return { type: "transfer", excludeFromReports: false }
  if (v === "trasferimento ingresso") return { type: "skip", excludeFromReports: false }
  if (v === "trasferimento") return { type: "transfer", excludeFromReports: false }
  // Balance adjustments — manual account corrections, excluded from reports
  if (v === "aumento saldo") return { type: "income", excludeFromReports: true }
  if (v === "decremento saldo") return { type: "expense", excludeFromReports: true }
  return null
}

// ─── Account Type Inference from Italian Names ───────────────────────────────

const ACCOUNT_TYPE_HINTS: Array<{ pattern: RegExp; type: AccountType }> = [
  { pattern: /conto\s*in\s*banca/i, type: "checking" },
  { pattern: /portafoglio/i, type: "cash" },
  { pattern: /carta/i, type: "credit_card" },
  { pattern: /prestit/i, type: "loan" },
  { pattern: /revolut/i, type: "checking" },
  { pattern: /spese\s*aziendal/i, type: "other" },
  { pattern: /risparm/i, type: "savings" },
  { pattern: /invest/i, type: "investment" },
]

export function inferAccountType(name: string): AccountType {
  for (const { pattern, type } of ACCOUNT_TYPE_HINTS) {
    if (pattern.test(name)) return type
  }
  return "checking"
}

// ─── Date Parsing (DD/MM/YYYY, optional " HH:mm[:ss]") ──────────────────────
// Newer exports carry a time. ponytail: time is dropped on purpose — the import
// hash keys on the day, so keeping it would shift the hash and re-import rows
// already brought in from date-only exports.

export function parseDDMMYYYY(value: string): Date | null {
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const year = parseInt(m[3], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month - 1, day)
  if (isNaN(d.getTime())) return null
  // Round-trip check: reject impossible dates like 31/02/2024 that Date would roll over
  if (d.getDate() !== day || d.getMonth() !== month - 1) return null
  return d
}

// ─── Amount Parsing (comma decimal: "412,37" → 412.37) ──────────────────────

function parseAmount(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, ".")
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : Math.abs(n)
}

// ─── Currency Parsing ────────────────────────────────────────────────────────

const VALID_CURRENCIES: Set<string> = new Set([
  "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "MXN", "BRL", "ARS",
])

function parseCurrency(value: string): Currency {
  const v = value.trim().toUpperCase()
  if (VALID_CURRENCIES.has(v)) return v as Currency
  return "EUR"
}

// ─── Format Detection ───────────────────────────────────────────────────────
// Real MM exports: "Periodo  Conto  Categoria  Sotto-categoria  Nota  EUR  Guadagni/Spese  ..."
// Checks: col 0 = "periodo", col 1 = "conto", col 2 = "categoria"

export function isMoneyManagerFormat(headers: string[]): boolean {
  if (headers.length < 7) return false
  const n = headers.map((h) => h.trim().toLowerCase())
  // Real format (11 cols): periodo, conto, categoria, sotto-categoria, nota, eur, guadagni/spese, ...
  if (n[0] === "periodo" && n[1] === "conto" && n[2] === "categoria") return true
  return false
}

// ─── Detect Column Layout ───────────────────────────────────────────────────
// Two known layouts:
//   "real" (11 cols): Periodo, Conto, Categoria, Sotto-categoria, Nota, EUR, Guadagni/Spese, Descrizione, Importo, Valuta, Conto
//   Guadagni/Spese is at col 6 and Categoria doubles as dest-account for transfers.

interface ColumnLayout {
  date: number
  account: number
  categoryOrDest: number
  description: number
  amount: number
  type: number
  notes: number
  currency: number // -1 if not present → default EUR
}

function detectLayout(headers: string[]): ColumnLayout {
  // Find Guadagni/Spese column dynamically
  const n = headers.map((h) => h.trim().toLowerCase())
  const typeIdx = n.findIndex((h) => h.startsWith("guadagni"))
  return {
    date: 0,
    account: 1,
    categoryOrDest: 2,
    description: n.indexOf("nota") >= 0 ? n.indexOf("nota") : 4,
    amount: 5,
    type: typeIdx >= 0 ? typeIdx : 6,
    notes: n.indexOf("descrizione") >= 0 ? n.indexOf("descrizione") : 7,
    currency: n.indexOf("valuta") >= 0 ? n.indexOf("valuta") : -1,
  }
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

export function parseMoneyManagerCSV(text: string): ParseResult {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0)

  if (lines.length === 0) {
    return { rows: [], errors: [], skippedIngresso: 0, accountNames: [], categoryNames: [] }
  }

  // Detect separator: tab, semicolon, or comma
  const headerLine = lines[0]
  const sep = headerLine.includes("\t") ? "\t" : headerLine.includes(";") ? ";" : ","

  const headers = headerLine.split(sep).map((h) => h.trim())
  if (!isMoneyManagerFormat(headers)) {
    return {
      rows: [],
      errors: [{ line: 1, message: "Headers don't match Money Manager format" }],
      skippedIngresso: 0,
      accountNames: [],
      categoryNames: [],
    }
  }

  const layout = detectLayout(headers)
  const rows: MoneyManagerRow[] = []
  const errors: Array<{ line: number; message: string }> = []
  const accountNameSet = new Set<string>()
  const categoryNameSet = new Set<string>()
  let skippedIngresso = 0

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.trim())
    const lineNum = i + 1

    // Date
    const date = parseDDMMYYYY(cols[layout.date] ?? "")
    if (!date) {
      errors.push({ line: lineNum, message: `Invalid date: "${cols[layout.date]}"` })
      continue
    }

    // Account
    const accountName = cols[layout.account] ?? ""
    if (!accountName) {
      errors.push({ line: lineNum, message: "Missing account name" })
      continue
    }

    // Type
    const rawTypeStr = cols[layout.type] ?? ""
    const mappedResult = mapType(rawTypeStr)
    if (mappedResult === null) {
      errors.push({ line: lineNum, message: `Unknown type: "${rawTypeStr}"` })
      continue
    }
    if (mappedResult.type === "skip") {
      // Trasferimento ingresso — symmetric duplicate, skip
      skippedIngresso++
      continue
    }
    const type = mappedResult.type
    const excludeFromReports = mappedResult.excludeFromReports

    // Categoria column: category for expense/income, dest account for transfers
    const categoryOrDest = cols[layout.categoryOrDest] ?? ""

    let categoryName: string | null = null
    let destAccountName: string | null = null

    if (type === "transfer") {
      destAccountName = categoryOrDest || null
      categoryName = null
    } else {
      categoryName = categoryOrDest || null
      destAccountName = null
    }

    // Description (Nota) — default to "Unknown" if empty
    const description = (cols[layout.description] ?? "").trim() || "Unknown"

    // Amount (comma decimal)
    const amount = parseAmount(cols[layout.amount] ?? "")
    if (amount === null || amount === 0) {
      errors.push({ line: lineNum, message: `Invalid amount: "${cols[layout.amount]}"` })
      continue
    }

    // Currency (from Valuta column, default EUR)
    const currency = layout.currency >= 0
      ? parseCurrency(cols[layout.currency] ?? "EUR")
      : "EUR" as Currency

    // Notes (Descrizione)
    const notesRaw = cols[layout.notes] ?? ""
    const notes = notesRaw || null

    // Collect unique names
    accountNameSet.add(normalizeAccountName(accountName))
    if (type === "transfer" && destAccountName) {
      accountNameSet.add(normalizeAccountName(destAccountName))
    }
    if (categoryName && type !== "transfer") {
      categoryNameSet.add(categoryName)
    }

    rows.push({
      date, accountName, type, categoryName, destAccountName,
      description, amount, currency, notes, excludeFromReports,
    })
  }

  return {
    rows,
    errors,
    skippedIngresso,
    accountNames: Array.from(accountNameSet).sort(),
    categoryNames: Array.from(categoryNameSet).sort(),
  }
}

// ─── Name Normalization & Matching ───────────────────────────────────────────

export function normalizeAccountName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

export function matchAccountName(
  sourceName: string,
  existingAccounts: Array<{ id: string; name: string }>,
): string | null {
  const norm = normalizeAccountName(sourceName)
  for (const acc of existingAccounts) {
    if (normalizeAccountName(acc.name) === norm) return acc.id
  }
  return null
}

export function matchCategoryName(
  sourceName: string,
  existingCategories: Array<{ id: string; name: string }>,
): string | null {
  const norm = sourceName.trim().toLowerCase()
  for (const cat of existingCategories) {
    if (cat.name.trim().toLowerCase() === norm) return cat.id
  }
  return null
}

// ─── Idempotent Import Hash ─────────────────────────────────────────────────
// Uses raw source data (account NAME, not ID) so the hash is deterministic
// regardless of account/category ID assignment. Prefix "mm|" prevents
// collisions with generic CSV import hashes.

function mmHashRaw(accountName: string, date: Date, amount: number, description: string): string {
  return [
    "mm",
    normalizeAccountName(accountName),
    date.toISOString().slice(0, 10),
    amount.toFixed(2),
    description.toLowerCase().trim(),
  ].join("|")
}

async function sha256Hex(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export function computeMMImportHash(
  accountName: string,
  date: Date,
  amount: number,
  description: string,
): Promise<string> {
  return sha256Hex(mmHashRaw(accountName, date, amount, description))
}

// Identical rows in one export are separate real transactions (two €15 gifts
// on the same day), not duplicates — dropping them skewed balances. Repeats get
// an occurrence suffix; the first keeps the plain hash so earlier imports still
// dedupe against it.
export function computeMMImportHashes(rows: MoneyManagerRow[]): Promise<string[]> {
  const seen = new Map<string, number>()
  return Promise.all(
    rows.map((r) => {
      const raw = mmHashRaw(r.accountName, r.date, r.amount, r.description)
      const n = seen.get(raw) ?? 0
      seen.set(raw, n + 1)
      return sha256Hex(n === 0 ? raw : `${raw}|${n}`)
    }),
  )
}

// ─── Ledger Resolution ──────────────────────────────────────────────────────
// A transfer whose other side isn't being imported can't stay a transfer: the
// ledger rejects a missing destination, and dropping the row leaves the
// tracked account's balance wrong. Money leaving to an untracked account is an
// expense on the tracked side; money arriving from one is income.

export interface ResolvedLedger {
  accountId: string
  type: TransactionType
  transferToAccountId: string | null
}

export function resolveLedger(
  row: Pick<MoneyManagerRow, "accountName" | "type" | "destAccountName">,
  accountIds: Map<string, string>, // normalized account name → id, imported accounts only
): ResolvedLedger | null {
  const source = accountIds.get(normalizeAccountName(row.accountName)) ?? null
  if (row.type !== "transfer") {
    return source ? { accountId: source, type: row.type, transferToAccountId: null } : null
  }
  const dest = row.destAccountName
    ? (accountIds.get(normalizeAccountName(row.destAccountName)) ?? null)
    : null
  if (source && dest) {
    return source === dest ? null : { accountId: source, type: "transfer", transferToAccountId: dest }
  }
  if (source) return { accountId: source, type: "expense", transferToAccountId: null }
  if (dest) return { accountId: dest, type: "income", transferToAccountId: null }
  return null
}
