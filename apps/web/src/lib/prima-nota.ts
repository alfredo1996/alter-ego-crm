/**
 * The prima nota workbook import (docs/plans/prima-nota.md §4, §8.7). Pure, no
 * I/O. detect() reads the sheets the owner kept (Saldo, one sheet per month,
 * Verifica skipped) into dated rows; planImport() turns them, the app's data and
 * the owner's decisions into the writes, the rows to decide, the overlaps with
 * Costs and Loans, the estimate links, the report and the acceptance check. The
 * import dialog runs the writes, in order.
 *
 * The import writes the records the screens write: invoices marked paid into an
 * account, costs, shareholder loans and movements, each tagged with the workbook
 * row (importRef) so Undo Import finds them. The Italian words are the
 * workbook's own: user data the parser reads (CLAUDE.md allows it here). Errors
 * cite sheet, row and column, never a cell's content.
 */

import { isoDate } from "@alter-ego/kernel/dates"
import { addMonths, differenceInCalendarMonths, format } from "date-fns"

import {
  COST_CATEGORY_LABELS,
  INVOICE_PROJECT,
  MAX_BANK_FEE,
  MONTH_SHEETS,
  NON_CASH,
  accountInUse,
  balancesAt,
  cashRows,
  dayLabel,
  kindLabel,
  pickEstimate,
  round2,
  splitRows,
} from "@/lib/cash-book"
import { eurCents, invoiceTotal } from "@/lib/invoices"
import { countedWhenPaid, priceIn } from "@/lib/projection"
import { excelSerialToDate } from "@/lib/xlsx"
import {
  createCompanyAccountSchema,
  createCompanyExpenseSchema,
  createCompanyLoanSchema,
  createCompanyMovementSchema,
  createInvoiceSchema,
} from "@/types/schemas"

import type { XlsxCell, XlsxSheet } from "@/lib/xlsx"
import type {
  Assignment,
  Collaborator,
  CompanyAccount,
  CompanyExpense,
  CompanyExpenseCategory,
  CompanyLoan,
  CompanyMovement,
  CreateCompanyAccountInput,
  CreateCompanyExpenseInput,
  CreateCompanyLoanInput,
  CreateCompanyMovementInput,
  CreateInvoiceInput,
  Invoice,
  UpdateCompanyAccountInput,
  UpdateCompanyExpenseInput,
  UpdateInvoiceInput,
} from "@/types"

/** A workbook the import can't read: the message names the sheet, row and column. */
export class PrimaNotaError extends Error {}

// ─── Reading the workbook ───────────────────────────────────────────────────

export type SheetAccount = {
  /** The id the writes use until the account exists ("new-account:0"), or the matched account's id. */
  key: string
  /** From the column headers: "Entrata Main Bank" → "Main Bank". */
  name: string
  saldoRow: number
  /** "yyyy-MM-dd": the Saldo sheet's date for it. */
  statementDay: string
  statementBalance: number
}

/** Money on one account: + in, − out. */
export type Leg = { account: string; amount: number }

export type SourceRow = {
  /** "2026:Luglio!12": the sheet's year, name and row number. */
  ref: string
  sheet: string
  row: number
  /** The sheet's month, "yyyy-MM". */
  ym: string
  description: string
  documentRef: string | null
  cashIn: number | null
  cashOut: number | null
  legs: Leg[]
  credit: number | null
  debit: number | null
  notes: string | null
  /** Column M = X: a cost of the cost centre the last header names. */
  flagged: boolean
  /** "yyyy-MM-dd". */
  day: string
  /** No date in the note: the 1st of the sheet's month. */
  dateEstimated: boolean
  /** Why the row can't be read; it blocks the import. */
  rejected: string | null
}

export type Workbook = {
  year: number
  /** The latest Saldo date, "yyyy-MM-dd". */
  saldoDay: string
  /** The 1st of the first month sheet: the accounts open on it at 0. */
  openingDay: string
  accounts: SheetAccount[]
  /** The cost centre of column M ("Spesa per Casa Via Esempio" → "Via Esempio"). */
  project: string | null
  /** rows: the rows with an amount, as `rows` holds them. */
  sheets: { name: string; ym: string; rows: number }[]
  /** Every row with an amount, in sheet order. */
  rows: SourceRow[]
  /** Rows with no amount at all (a movement removed): the report lists them. */
  empty: { ref: string; where: string; description: string }[]
}

const clean = (v: XlsxCell | undefined) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim())
const lower = (v: XlsxCell | undefined) => clean(v).toLowerCase()
const pad = (n: number) => String(n).padStart(2, "0")
const where = (sheet: string, row: number) => `${sheet}, row ${row}`

const REQUIRED = ["Numero Transazione", "Descrizione", "Numero Fattura", "Entrata di Cassa", "Uscita di Cassa", "Credito", "Debito", "Note"]

/** A real calendar day near the sheet's month: dd/mm with no year takes the one within six months. */
function dayOf(dd: number, mm: number, yyyy: number | null, ym: string): string | null {
  if (mm < 1 || mm > 12 || dd < 1) return null
  let year = yyyy ?? Number(ym.slice(0, 4))
  if (yyyy === null) {
    const diff = mm - Number(ym.slice(5, 7))
    if (diff > 6) year--
    else if (diff < -6) year++
  }
  if (new Date(Date.UTC(year, mm - 1, dd)).getUTCDate() !== dd) return null
  return `${year}-${pad(mm)}-${pad(dd)}`
}

/** Rule 1: the bank's date in the note, kept even outside the sheet's month. */
const BANK_DATE = /\b(?:bonifico|addebito|addebitati|accredito|giroconto|rimborso|pagat[oi])\b[^.|;]*?\b(?:del|il)\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/gi
/** Rule 2: the document's date in the note, only inside the sheet's month. */
const DOCUMENT_DATE = /\b(?:fattura|ricevuta)\b[^.|;]*?\bdel\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/gi

function dateOf(notes: string | null, ym: string, money: boolean): { day: string; estimated: boolean } {
  if (notes && money) {
    for (const m of notes.matchAll(BANK_DATE)) {
      const day = dayOf(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, ym)
      if (day) return { day, estimated: false }
    }
  }
  // A document row never takes a bank date: its note may carry a payment's.
  for (const m of notes?.matchAll(DOCUMENT_DATE) ?? []) {
    const day = dayOf(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, ym)
    if (day?.startsWith(ym)) return { day, estimated: false }
  }
  // Never the month's last day: a row would land after a mid-month Saldo date.
  return { day: `${ym}-01`, estimated: true }
}

/** A Saldo date: a serial number, or dd/mm/yyyy text. */
function saldoDay(v: XlsxCell): string | null {
  if (typeof v === "number") return v > 0 ? excelSerialToDate(v).toISOString().slice(0, 10) : null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(clean(v))
  return m ? dayOf(Number(m[1]), Number(m[2]), Number(m[3]), `${m[3]}-01`) : null
}

const sameName = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()]
  return x.startsWith(y) || y.startsWith(x)
}

/**
 * The workbook's sheets and rows, dated. Throws PrimaNotaError on anything it
 * would have to guess: no Saldo, an unknown sheet, a missing column. A row it
 * can't read (a number that isn't one, Cassa columns that don't add up) is kept
 * with the reason: it is shown and blocks the import.
 */
export function detect(sheets: XlsxSheet[]): Workbook {
  const saldo = sheets.find((s) => lower(s.name) === "saldo")
  if (!saldo) throw new PrimaNotaError("No Saldo sheet: the workbook needs one with each bank balance (columns Conto, Data, Saldo).")
  const months: { sheet: XlsxSheet; month: number }[] = []
  for (const s of sheets) {
    const name = lower(s.name)
    if (name === "saldo" || name === "verifica") continue
    const month = MONTH_SHEETS.findIndex((m) => m.toLowerCase() === name)
    if (month < 0) {
      throw new PrimaNotaError(`Sheet “${clean(s.name)}” is not a month (Gennaio to Dicembre), Saldo or Verifica: rename it or remove it.`)
    }
    if (months.some((m) => m.month === month)) throw new PrimaNotaError(`Two sheets are called ${MONTH_SHEETS[month]}: keep one.`)
    months.push({ sheet: s, month })
  }
  if (months.length === 0) throw new PrimaNotaError("No month sheet (Gennaio to Dicembre) in the workbook.")

  // The Saldo sheet: one row per account.
  const head = (saldo.rows[0] ?? []).map(lower)
  const [conto, data, balance] = ["conto", "data", "saldo"].map((h) => head.indexOf(h))
  ;[conto, data, balance].forEach((k, n) => {
    if (k < 0) throw new PrimaNotaError(`Saldo, row 1: the column “${["Conto", "Data", "Saldo"][n]}” is missing.`)
  })
  const balances: { name: string; row: number; day: string; balance: number }[] = []
  saldo.rows.slice(1).forEach((cells, k) => {
    const row = k + 2
    if (cells.every((c) => clean(c) === "")) return
    const day = saldoDay(cells[data] ?? null)
    if (!clean(cells[conto])) throw new PrimaNotaError(`Saldo, row ${row}, column Conto: the account's name is empty.`)
    if (!day) throw new PrimaNotaError(`Saldo, row ${row}, column Data: not a date.`)
    const b = cells[balance]
    if (typeof b !== "number") throw new PrimaNotaError(`Saldo, row ${row}, column Saldo: not a number.`)
    balances.push({ name: clean(cells[conto]), row, day, balance: round2(b) })
  })
  if (balances.length === 0) throw new PrimaNotaError("Saldo: no account row under the headers.")
  const lastDay = balances.map((b) => b.day).sort().at(-1)!
  const year = Number(lastDay.slice(0, 4))
  const saldoMonth = Number(lastDay.slice(5, 7)) - 1
  // A month after the Saldo's is the year before only in a file that runs from December into January: those
  // months reach Dicembre without a gap, and Gennaio is there. Otherwise the owner wrote on after the Saldo.
  const late = months.filter((m) => m.month > saldoMonth).sort((a, b) => a.month - b.month)
  if (late.length > 0 && !(months.some((m) => m.month === 0) && late.every((m, k) => m.month === 12 - late.length + k))) {
    throw new PrimaNotaError(
      `Sheet ${MONTH_SHEETS[late[0].month]} comes after the Saldo date ${dayLabel(lastDay)}: update the Saldo sheet to today's balances and choose the file again.`,
    )
  }
  const sorted = months
    .map((m) => ({ ...m, ym: `${m.month > saldoMonth ? year - 1 : year}-${pad(m.month + 1)}` }))
    .sort((a, b) => a.ym.localeCompare(b.ym))

  // Each month sheet's columns, by name.
  const accounts: SheetAccount[] = []
  let project: string | null = null
  const layouts = sorted.map(({ sheet }) => {
    const names = (sheet.rows[0] ?? []).map(clean)
    const col = (n: string) => names.findIndex((h) => h.toLowerCase() === n.toLowerCase())
    for (const n of REQUIRED) {
      if (col(n) < 0) throw new PrimaNotaError(`${clean(sheet.name)}, row 1: the column “${n}” is missing.`)
    }
    const centre = names.findIndex((h) => /^spesa per\b/i.test(h))
    if (centre < 0) throw new PrimaNotaError(`${clean(sheet.name)}, row 1: no column starting “Spesa per” (the cost centre).`)
    project ??= names[centre].replace(/^spesa per\s*/i, "").replace(/^casa\s+/i, "").trim() || null
    const legs = names.flatMap((h, k) => {
      const m = /^entrata\s+(.+)$/i.exec(h)
      if (!m || m[1].toLowerCase() === "di cassa") return []
      const out = col(`Uscita ${m[1]}`)
      if (out < 0) throw new PrimaNotaError(`${clean(sheet.name)}, row 1: the column “Uscita ${m[1]}” is missing.`)
      let account = accounts.find((a) => a.name.toLowerCase() === m[1].toLowerCase())
      if (!account) {
        const found = balances.filter((b) => sameName(b.name, m[1]))
        if (found.length !== 1) {
          throw new PrimaNotaError(
            found.length === 0
              ? `Saldo: no row for the account of the columns Entrata/Uscita ${m[1]}.`
              : `Saldo: more than one row matches the columns Entrata/Uscita ${m[1]}.`,
          )
        }
        account = {
          key: `new-account:${accounts.length}`,
          name: m[1],
          saldoRow: found[0].row,
          statementDay: found[0].day,
          statementBalance: found[0].balance,
        }
        accounts.push(account)
      }
      return [{ account: account.key, name: m[1], inCol: k, outCol: out }]
    })
    if (legs.length === 0) throw new PrimaNotaError(`${clean(sheet.name)}, row 1: no Entrata/Uscita columns for a bank account.`)
    return { col, centre, legs }
  })
  for (const b of balances) {
    if (!accounts.some((a) => a.saldoRow === b.row)) {
      throw new PrimaNotaError(`Saldo, row ${b.row}: its account matches no Entrata/Uscita columns in the month sheets.`)
    }
  }

  const rows: SourceRow[] = []
  const empty: Workbook["empty"] = []
  const read: Workbook["sheets"] = []
  sorted.forEach(({ sheet, month, ym }, s) => {
    const { col, centre, legs: legCols } = layouts[s]
    const name = MONTH_SHEETS[month]
    const [b, c, d, e, j, k, l] = ["Descrizione", "Numero Fattura", "Entrata di Cassa", "Uscita di Cassa", "Credito", "Debito", "Note"].map(col)
    const used = [col("Numero Transazione"), b, c, d, e, j, k, l, centre, ...legCols.flatMap((x) => [x.inCol, x.outCol])]
    let count = 0
    sheet.rows.forEach((cells, r) => {
      if (r === 0 || used.every((x) => clean(cells[x]) === "")) return
      const row = r + 1
      const ref = `${ym.slice(0, 4)}:${name}!${row}`
      let rejected: string | null = null
      const num = (x: number, header: string): number | null => {
        const v = cells[x] ?? null
        if (v === null || clean(v) === "") return null
        if (typeof v === "number") return v === 0 ? null : round2(v)
        rejected ??= `the column “${header}” is not a number`
        return null
      }
      const cashIn = num(d, "Entrata di Cassa")
      const cashOut = num(e, "Uscita di Cassa")
      const legs: Leg[] = []
      for (const x of legCols) {
        const i = num(x.inCol, `Entrata ${x.name}`)
        const o = num(x.outCol, `Uscita ${x.name}`)
        if (i !== null) legs.push({ account: x.account, amount: i })
        if (o !== null) legs.push({ account: x.account, amount: -o })
      }
      const credit = num(j, "Credito")
      const debit = num(k, "Debito")
      const description = clean(cells[b])
      if (!rejected && cashIn === null && cashOut === null && legs.length === 0 && credit === null && debit === null) {
        empty.push({ ref, where: where(name, row), description })
        return
      }
      count++
      const ins = round2(legs.filter((x) => x.amount > 0).reduce((t, x) => t + x.amount, 0))
      const outs = round2(legs.filter((x) => x.amount < 0).reduce((t, x) => t - x.amount, 0))
      if (cashIn !== null || cashOut !== null) {
        if ((cashIn ?? 0) !== ins || (cashOut ?? 0) !== outs) {
          rejected ??= "Entrata di Cassa must equal the accounts' Entrata, and Uscita di Cassa their Uscita"
        } else if (legs.length > 1) {
          rejected ??= "money on two accounts in one row: write two rows, or a transfer with the Cassa columns empty"
        }
      } else if (legs.length > 0) {
        const transfer = legs.length === 2 && legs[0].account !== legs[1].account && round2(legs[0].amount + legs[1].amount) === 0
        if (!transfer) rejected ??= "the Cassa columns are empty, so it reads as a transfer, but it is not one IN and one OUT of the same amount on two accounts"
      }
      const notes = clean(cells[l]) || null
      const { day, estimated } = dateOf(notes, ym, legs.length > 0)
      rows.push({
        ref,
        sheet: name,
        row,
        ym,
        description,
        documentRef: clean(cells[c]) || null,
        cashIn,
        cashOut,
        legs,
        credit,
        debit,
        notes,
        flagged: lower(cells[centre]) === "x",
        day,
        dateEstimated: estimated,
        rejected,
      })
    })
    read.push({ name, ym, rows: count })
  })

  return {
    year,
    saldoDay: lastDay,
    openingDay: `${sorted[0].ym}-01`,
    accounts,
    project,
    sheets: read,
    rows,
    empty,
  }
}

// ─── What each row becomes ──────────────────────────────────────────────────

/** How a row (or a part of one) is booked: a cost (a refund when in), a shareholder loan, or a movement kind. */
export type BookAs = "cost" | "loan" | "income" | "client_income" | "deposit_held" | "deposit_paid" | "capital" | "vat" | "tax" | "compensation"

/** A part of a split row: signed like the bank (+ in, − out). */
export type Part = { as: BookAs; amount: number; description: string }

export const IN_KINDS: BookAs[] = ["income", "client_income", "deposit_held", "deposit_paid", "loan", "capital", "cost"]
export const OUT_KINDS: BookAs[] = ["cost", "deposit_held", "deposit_paid", "loan", "vat", "tax", "compensation", "income"]

/** "Cost", "Refund", "Deposit Received"…: the names Add Movement uses. */
export function bookAsLabel(as: BookAs, amount: number): string {
  const dir = amount >= 0 ? "in" : "out"
  if (as === "cost") return dir === "in" ? "Refund" : "Cost"
  if (as === "loan") return dir === "in" ? "Shareholder Loan" : "Shareholder Loan Repayment"
  return kindLabel(as, dir)
}

/** The plain words that propose a cost's category. ponytail: generic words only, never a supplier's name. */
const CATEGORY_WORDS: [RegExp, CompanyExpenseCategory][] = [
  [/^commissione/i, "bank_fees"],
  [/commercialista/i, "accountant"],
  [/^affitto/i, "rent"],
  [/\b(?:vol[oi]|aere[oa]|taxi|noleggio|treno|trasferta|albergo|hotel)\b/i, "travel"],
  [/\b(?:law firm|avvocat[oi]|legale|notaio)\b/i, "legal"],
  [/\b(?:cena|pranzo|rappresentanza|ristorante)\b/i, "marketing"],
  [/\b(?:software|abbonamento|licenza|hosting|dominio|cloud|firma digitale|sottoscrizione)\b/i, "software"],
]

export function suggestCategory(description: string): CompanyExpenseCategory {
  return CATEGORY_WORDS.find(([re]) => re.test(description))?.[1] ?? "other"
}

/** The note says the document is missing: no documentRef, the column C text goes in the notes. */
const MISSING_DOCUMENT = /fattura assente|fattura da recuperare|nessuna fattura|non ancora ricevuta|da richiedere|serve ricevuta|non una fattura/i
/** The row asks to be checked: the review list. */
const NEEDS_REVIEW = /da verificare|da chiarire|differenza|documenti non corretti|persona fisica|manca srls|per errore|erroneamente/i
/** For the accountant: the report lists these rows. */
const FOR_ACCOUNTANT = /reverse charge|inversione contabile|autofattura|senza iva|bollo|intracomunitaria|elargizione|donazione|ristrutturazione/i

/** "1.234,56" or "1234,5" or "220": an amount written in an Italian note. */
const italianNumber = (s: string) => Number(s.replace(/\./g, "").replace(",", "."))
const AMOUNT = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)`

/** "N/YYYY" tokens: the app's invoice numbers. */
function invoiceNumbers(text: string | null): string[] {
  return [...(text ?? "").matchAll(/(\d+)\s*\/\s*(\d{4})\b/g)].map((m) => `${Number(m[1])}/${m[2]}`)
}

/** An app invoice's number as "N/YYYY": "7/2030", "2030/7", or "7" in its year. */
function appNumber(i: Invoice): string | null {
  const t = i.number.trim()
  let m = /^(\d+)\s*\/\s*(\d{4})$/.exec(t)
  if (m) return `${Number(m[1])}/${m[2]}`
  m = /^(\d{4})\s*\/\s*(\d+)$/.exec(t)
  if (m) return `${Number(m[2])}/${m[1]}`
  if (/^\d+$/.test(t)) return `${Number(t)}/${i.yearMonth.slice(0, 4)}`
  return invoiceNumbers(t)[0] ?? null
}

/** "Di cui IVA € 1.234,56", "di cui € 1.100 IVA". */
function vatInNote(note: string | null): number | null {
  const m = new RegExp(String.raw`di cui\s+(iva\s*)?(?:€\s*)?${AMOUNT}\s*(?:€\s*)?(iva)?`, "i").exec(note ?? "")
  return m && (m[1] || m[3]) ? italianNumber(m[2]) : null
}

/** Who a deposit or a tenant row is from: the description up to "(" or a dash. Replaceable in the app. */
const counterpartyOf = (description: string) => description.split(/\s[(–-]|\(/)[0].trim().slice(0, 100) || null

const firstToken = (description: string) => description.match(/[\p{L}\p{N}][\p{L}\p{N}.&'-]*/u)?.[0].toLowerCase().replace(/\.$/, "") ?? ""

type Plan =
  | { kind: "transfer"; from: string; to: string; amount: number }
  /** property: a tenant's, a deposit's or the landlord's row, in the cost centre without an X. */
  | { kind: "book"; as: BookAs; why: string | null; property: boolean }
  | { kind: "split"; parts: Part[]; why: string }
  | { kind: "receipt"; numbers: string[] }
  | { kind: "platform" }
  | { kind: "supplier_payment"; doc: string }
  | { kind: "supplier_doc"; amount: number; credits: SourceRow[] }
  | { kind: "cancelled_doc"; credits: SourceRow[] }
  | { kind: "owner_card" }
  | { kind: "issued" }
  | { kind: "client_credit" }
  | { kind: "supplier_credit"; doc: string }
  | { kind: "store_credit" }
  | { kind: "rejected"; reason: string }

const amountOf = (r: SourceRow) => round2(r.legs.reduce((t, l) => t + l.amount, 0))

/** The signed parts a mixed tenant row is likely made of, summing to the bank amount; 0 where the owner must say. */
function splitParts(r: SourceRow): Part[] {
  const amount = amountOf(r)
  const text = `${r.description} ${r.notes ?? ""}`
  const ofWhich = new RegExp(String.raw`di cui\s+${AMOUNT}\s+(?!iva)`, "i").exec(text)
  const plus = new RegExp(String.raw`\+\s*spese\s+${AMOUNT}`, "i").exec(text)
  const less = new RegExp(String.raw`decurtat[oai]\s+${AMOUNT}`, "i").exec(text)
  const deposit = /deposito cauzionale/i.test(text)
  const parts: Part[] = []
  const extra = ofWhich ?? plus
  if (less) {
    const off = italianNumber(less[1])
    parts.push({ as: "income", amount: round2(amount + off), description: `${r.description} (rent and contributions)` })
    parts.push({ as: "cost", amount: -off, description: `${r.description} (refund deducted)` })
    return parts
  }
  const contribution = extra ? italianNumber(extra[1]) : 0
  if (contribution) parts.push({ as: "income", amount: contribution, description: `${r.description} (expense contribution)` })
  parts.push({ as: "income", amount: round2(amount - contribution), description: `${r.description} (rent)` })
  if (deposit) parts.push({ as: "deposit_held", amount: 0, description: `${r.description} (deposit)` })
  return parts
}

/**
 * The plan's mapping table, first match wins: what each row becomes before the
 * owner decides anything. Cross-row: a supplier invoice in Debito is netted by
 * the credit notes naming it and paid by the rows with its number and supplier.
 */
function classify(wb: Workbook): Map<string, Plan> {
  const plans = new Map<string, Plan>()
  const docs = wb.rows.filter(
    (r) => !r.rejected && r.legs.length === 0 && r.debit !== null && !/^emessa fattura/i.test(r.description) && !isOwnerCard(r),
  )
  const credits = new Map<string, SourceRow[]>()
  for (const r of wb.rows) {
    if (r.rejected) {
      plans.set(r.ref, { kind: "rejected", reason: r.rejected })
      continue
    }
    if (r.legs.length > 0) continue
    const text = `${r.description} ${r.notes ?? ""}`.toLowerCase()
    if (r.debit !== null) {
      if (/^emessa fattura/i.test(r.description)) plans.set(r.ref, { kind: "issued" })
      else if (isOwnerCard(r)) plans.set(r.ref, { kind: "owner_card" })
    } else if (r.credit !== null) {
      if (/^nota di credito a storno/i.test(r.description)) plans.set(r.ref, { kind: "client_credit" })
      else {
        const doc = docs.find((d) => d.documentRef && text.includes(d.documentRef.toLowerCase()))
        if (doc) {
          plans.set(r.ref, { kind: "supplier_credit", doc: doc.ref })
          credits.set(doc.ref, [...(credits.get(doc.ref) ?? []), r])
        } else plans.set(r.ref, { kind: "store_credit" })
      }
    }
  }
  const owed = new Map<string, number>()
  for (const d of docs) {
    const net = round2(d.debit! - (credits.get(d.ref) ?? []).reduce((t, c) => t + c.credit!, 0))
    plans.set(d.ref, net > 0 ? { kind: "supplier_doc", amount: net, credits: credits.get(d.ref) ?? [] } : { kind: "cancelled_doc", credits: credits.get(d.ref) ?? [] })
    if (net > 0) owed.set(d.ref, net)
  }

  const project = wb.project?.toLowerCase() ?? null
  for (const r of wb.rows) {
    if (plans.has(r.ref) || r.legs.length === 0) continue
    if (r.cashIn === null && r.cashOut === null) {
      plans.set(r.ref, { kind: "transfer", from: r.legs.find((l) => l.amount < 0)!.account, to: r.legs.find((l) => l.amount > 0)!.account, amount: Math.abs(r.legs[0].amount) })
      continue
    }
    const into = amountOf(r) > 0
    const b = r.description.toLowerCase()
    const all = `${b} ${(r.notes ?? "").toLowerCase()}`
    const book = (as: BookAs, why: string | null = null, property = false): Plan => ({ kind: "book", as, why, property })
    let plan: Plan
    if (into && /^incasso fattura/.test(b)) plan = { kind: "receipt", numbers: invoiceNumbers(r.documentRef ?? r.description) }
    else if (into && /^incasso\b/.test(b)) plan = { kind: "platform" }
    else if (into && /^finanziamento soci/.test(b)) plan = book("loan")
    else if (!into && (/(prelievo|rimborso) finanziamento soci/.test(b) || (/rimborso/.test(all) && /\bsoci[oa]?\b|carta personale/.test(all)))) {
      plan = book("loan")
    } else if (into && /deposito capitale/.test(b)) plan = book("capital", "Share capital is neither income nor a loan: confirm it is capital.")
    else if (!into && /^commissione/.test(b)) plan = book("cost")
    else if (!into && /caparra/.test(b)) plan = book("deposit_paid", null, true)
    else if (into && /deposito cauzionale/.test(b) && !/affitto/.test(b)) plan = book("deposit_held", null, true)
    else if (into && (/di cui .*rimborso spese/.test(all) || /\+\s*spese\s+\d/.test(all) || /decurtat/.test(all) || (/deposito cauzionale/.test(b) && /affitto/.test(b)))) {
      plan = { kind: "split", parts: splitParts(r), why: "Several things in one bank amount (rent, contributions, a deposit or a refund): say how much each is." }
    } else if (into && /affitto|canone|contributo spese/.test(b)) plan = book("income", null, true)
    else if (!into && /^affitto/.test(b) && project && b.includes(project)) plan = book("cost", null, true)
    else if (!into && /^rimborso/i.test(r.notes ?? "")) {
      plan = book("cost", "Money given back to someone: a cost, or part of a deposit returned?", true)
    } else if (into && /\(rimborso\)/.test(b)) plan = book("cost")
    else if (into) plan = book("income", "Money in that is not rent, a loan or an invoice: say what it is.")
    else {
      const doc = docs.find(
        (d) => owed.has(d.ref) && d.documentRef?.toLowerCase() === r.documentRef?.toLowerCase() && firstToken(d.description) === firstToken(r.description),
      )
      const left = doc ? owed.get(doc.ref)! : 0
      if (doc && -amountOf(r) <= left + 0.005) {
        owed.set(doc.ref, round2(left + amountOf(r)))
        plan = { kind: "supplier_payment", doc: doc.ref }
      } else plan = book("cost")
    }
    plans.set(r.ref, plan)
  }
  return plans
}

function isOwnerCard(r: SourceRow): boolean {
  return /carta personale/i.test(`${r.description} ${r.notes ?? ""}`)
}

// ─── The plan ───────────────────────────────────────────────────────────────

/** What the app holds: read through the same hooks the Cash Book uses. */
export type AppData = {
  accounts: CompanyAccount[]
  invoices: Invoice[]
  expenses: CompanyExpense[]
  loans: CompanyLoan[]
  movements: CompanyMovement[]
  clients: { id: string; name: string }[]
  /** The customer of an invoice: invoiceClientId over the engagements. */
  clientOf: (invoice: Invoice) => string | null
  /** A cost whose description names one of the active ones becomes their invoice. */
  collaborators?: Collaborator[]
  assignments?: Assignment[]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Case, accents and the curly apostrophe set aside, so "Nicolò" and "D’Angelo" match "Nicolo" and "D'Angelo". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")

const hasName = (text: string, name: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu").test(text)

/**
 * The one active collaborator whose name is in a description, as whole words, ignoring case and accents. When
 * two names hit and one holds the other ("Verdi" in "Studio Verdi"), the longest wins; two unrelated names, or
 * none, match nobody: the owner picks the collaborator in the Costs form.
 */
export function matchCollaborator(description: string, list: readonly Collaborator[]): Collaborator | null {
  const text = fold(description)
  const hits = list
    .filter((c) => c.isActive && c.name.trim() !== "" && hasName(text, fold(c.name.trim())))
    .sort((a, b) => b.name.trim().length - a.name.trim().length)
  const [longest, ...rest] = hits
  return longest && rest.every((c) => hasName(fold(longest.name.trim()), fold(c.name.trim()))) ? longest : null
}

/** The owner's answer to one review item. */
export type Decision = {
  option: string
  /** "split": the parts, signed, summing to the bank amount. */
  parts?: Part[]
  /** "create_invoice" / "platform_invoice". */
  clientId?: string
  /** "create_invoice": the invoice's amount net of VAT, and its VAT. */
  amount?: number
  vat?: number
  /** "platform_invoice": what the client paid before the platform's commission. */
  gross?: number
  /** "platform_existing": the open app invoice it pays. */
  invoiceId?: string
}

export type Choices = {
  decisions: Record<string, Decision>
  /** Overlap pairs to keep both rows of, by the existing row's id: the others are replaced by the workbook's row. */
  keep: string[]
  /** By EstimateLink key: link the payments to the estimate, start it on the opening day. */
  estimates: Record<string, { link: boolean; moveStart: boolean }>
  /** By workbook row ref: the month of work a collaborator's invoice pays, where it is not the date's month. */
  forMonths?: Record<string, string>
}

export const NO_CHOICES: Choices = { decisions: {}, keep: [], estimates: {} }

export type ReviewItem = {
  id: string
  ref: string | null
  /** "Luglio, row 12". */
  where: string
  what: string
  /** Signed, as on the bank. */
  amount: number | null
  account: string | null
  day: string | null
  why: string
  options: { id: string; label: string }[]
  suggested: string
  /** The split's parts as the note suggests them. */
  parts?: Part[]
  /** A new invoice's prefill. */
  invoice?: { number: string; clientId: string | null; amount: number; vat: number }
  /** The platform's gross, when the note says it. */
  gross?: number | null
  openInvoices?: { id: string; label: string }[]
  /** The invoice the suggestion pays: the payout's own invoice, already in the app. */
  invoiceId?: string
  clients?: { id: string; name: string }[]
  /** The decision in force: the owner's, or null while the item waits for one. */
  decision: Decision | null
  /** Why that decision can't be used yet. */
  problem: string | null
}

export type Write =
  | { op: "create_account"; key: string; input: CreateCompanyAccountInput }
  | { op: "update_account"; id: string; input: UpdateCompanyAccountInput }
  | { op: "delete_expense"; id: string }
  | { op: "delete_loan"; id: string }
  | { op: "expense"; key: string; ref: string; input: CreateCompanyExpenseInput }
  | { op: "loan"; key: string; ref: string; input: CreateCompanyLoanInput }
  | { op: "movement"; key: string; ref: string; input: CreateCompanyMovementInput }
  | { op: "create_invoice"; key: string; ref: string; input: CreateInvoiceInput }
  | { op: "update_invoice"; id: string; ref: string | null; input: UpdateInvoiceInput }
  | { op: "update_estimate"; id: string; input: UpdateCompanyExpenseInput }

export type Overlap = {
  kind: "expense" | "loan"
  id: string
  /** details: what Replace loses that the card would not show (category, VAT, document, cost centre). */
  existing: { description: string; day: string; amount: number; details: string[] }
  /**
   * day: the workbook's, ~ when dateEstimated (no day in the workbook). appDay: Replace keeps the app's
   * day instead, an estimated workbook day in the same month.
   */
  imported: { ref: string; where: string; description: string; day: string; dateEstimated: boolean; appDay: string | null; amount: number }
  replace: boolean
}

export type EstimateLink = {
  /** The owner's choice is kept under it (Choices.estimates). */
  key: string
  estimate: CompanyExpense
  /** A word of the estimate's name is in the payments; otherwise it only shares their category: ticked by the owner. */
  sure: boolean
  /** The first payment's description, to tell what was grouped. */
  sample: string
  payments: number
  total: number
  /** The estimate starts before the opening day: it would charge the months before the company had a bank. */
  startsEarly: boolean
  link: boolean
  moveStart: boolean
}

export type AccountCheck = { name: string; day: string; bank: number; book: number; difference: number; ok: boolean; label: string }

export type Check = { ok: boolean; accounts: AccountCheck[]; problems: string[] }

export type ImportPlan = {
  workbook: Workbook
  accounts: { key: string; name: string; matched: CompanyAccount | null }[]
  writes: Write[]
  review: ReviewItem[]
  /** Review ids still waiting for a usable decision. */
  unresolved: string[]
  overlaps: Overlap[]
  estimates: EstimateLink[]
  /** The cost rows that name a collaborator, to show in the preview. */
  collaboratorRows: { ref: string; where: string; description: string; day: string; name: string; forMonth: string }[]
  counts: {
    rows: number
    perSheet: { sheet: string; rows: number }[]
    /** written: becomes a record or changes an invoice; else only checked or reported. */
    byKind: { label: string; count: number; written: boolean }[]
    /** Rows booked as several parts (each part counted under its kind). */
    splitRows: number
    byAccount: { name: string; rows: number; in: number; out: number }[]
    estimatedDates: number
  }
  check: Check
  /** What stops the import whatever the owner decides. */
  blockers: string[]
  /** Records in the app with an importRef: the workbook is already in. */
  alreadyImported: number
  report: string
}

const clip = (s: string | null | undefined, max: number) => {
  const t = s?.trim() ?? ""
  return !t ? null : t.length <= max ? t : `${t.slice(0, max - 1)}…`
}
/** A record's description: the text given, else the row's, never empty (the backend refuses that). */
const titleOf = (r: SourceRow, text?: string | null) => clip(text?.trim() || r.description || r.documentRef || `${r.sheet} row ${r.row}`, 300)!
/** "Deposit Received" → "Deposit received": the counts are sentence case; VAT and F24 stay. */
const sentence = (label: string) => label.replace(/(?<=\s)[A-Z](?=[a-z])/g, (c) => c.toLowerCase())
const joinNotes = (...parts: (string | null | undefined)[]) => parts.filter((p) => p && p.trim()).join(" · ") || null
const toDate = (day: string) => new Date(`${day}T00:00:00`)
const daysBetween = (a: string, b: string) => Math.abs(toDate(a).getTime() - toDate(b).getTime()) / 86400000
const letter = (k: number) => String.fromCharCode(97 + k)

/** The backend's checks on each record it creates: run before Import, so a refusal never stops it halfway. */
const CREATE_SCHEMAS: Partial<Record<Write["op"], { safeParse: (v: unknown) => { error?: { issues: { path: PropertyKey[]; message: string }[] } } }>> = {
  create_account: createCompanyAccountSchema,
  expense: createCompanyExpenseSchema,
  loan: createCompanyLoanSchema,
  movement: createCompanyMovementSchema,
  create_invoice: createInvoiceSchema,
}

/** Records the import wrote, found by their importRef: derived from the data, so a reload or a crash keeps it. */
export function importedRecords(app: Pick<AppData, "accounts" | "expenses" | "loans" | "movements">) {
  return {
    accounts: app.accounts.filter((a) => a.importRef),
    expenses: app.expenses.filter((e) => e.importRef),
    loans: app.loans.filter((l) => l.importRef),
    movements: app.movements.filter((m) => m.importRef),
  }
}

/**
 * The writes, the review list, the overlaps, the estimate links, the counts,
 * the acceptance check and the report for this workbook over this app, given
 * the owner's decisions. Undecided items count as their suggestion in the
 * check (kinds never change a balance) and keep Import disabled.
 */
export function planImport(wb: Workbook, app: AppData, choices: Choices = NO_CHOICES): ImportPlan {
  const plans = classify(wb)
  const project = wb.project
  const byRef = new Map(wb.rows.map((r) => [r.ref, r]))
  const blockers: string[] = []
  const report: { title: string; lines: string[] }[] = []
  const section = (title: string) => {
    const s = { title, lines: [] as string[] }
    report.push(s)
    return s.lines
  }
  const accountsReport = section("Accounts")
  const reviewReport = section("Rows decided in the review")
  const replacedReport = section("Rows already in the app, replaced by the workbook's (their data, to restore by hand if needed)")
  const estimatedReport = section("Estimated dates: the 1st of the month, marked ~ (fix them from To Chase)")
  const missingReport = section("Missing documents")
  const accountantReport = section("For the accountant")
  const invoiceReport = section("Invoices")
  const changedReport = section("Records already in the app that the import changes (Undo Import keeps these changes)")
  const cancelledReport = section("Cancelled invoices and credit notes")
  const emptyReport = section("Rows with no amount, not imported")

  const imported = importedRecords(app)
  const alreadyImported = imported.accounts.length + imported.expenses.length + imported.loans.length + imported.movements.length
  if (alreadyImported > 0) blockers.push("This workbook is already imported. Undo Import first to import it again.")
  const rejected = wb.rows.filter((r) => r.rejected)
  if (rejected.length > 0) {
    blockers.push(
      `${rejected.length} ${rejected.length === 1 ? "row" : "rows"} can't be read: ${rejected
        .map((r) => `${where(r.sheet, r.row)}: ${r.rejected}`)
        .join("; ")}. Fix the workbook and choose it again.`,
    )
  }

  // Accounts: an empty account of the app with the same name, or a new one.
  const sheetAccounts = wb.accounts.map((a) => {
    const same = app.accounts.filter((x) => sameName(x.name, a.name))
    const matched = same.length === 1 ? same[0] : null
    if (same.length > 1) blockers.push(`More than one account in the app matches ${a.name}: rename one so the import knows which.`)
    if (matched && accountInUse(matched.id, app)) {
      blockers.push(`${matched.name} already has rows in the Cash Book: the import needs it empty. Move or delete its rows, or rename it to create a new account.`)
    }
    return { ...a, source: a.key, key: matched?.id ?? a.key, matched }
  })
  const accountKey = new Map(wb.accounts.map((a, k) => [a.key, sheetAccounts[k].key]))
  const acc = (key: string) => accountKey.get(key) ?? key
  const accountName = new Map(sheetAccounts.map((a) => [a.key, a.name]))

  const writes: Write[] = []
  const accountWrites: Write[] = []
  for (const a of sheetAccounts) {
    const statement = { openingBalance: 0, openingDate: toDate(wb.openingDay), statementBalance: a.statementBalance, statementDate: toDate(a.statementDay) }
    if (a.matched) {
      accountWrites.push({ op: "update_account", id: a.matched.id, input: statement })
      accountsReport.push(
        `${a.matched.name}: your account, used as it was empty. Before the import it opened on ${dayLabel(isoDate(a.matched.openingDate))} with ${eurCents(a.matched.openingBalance)}${
          a.matched.statementBalance !== null && a.matched.statementDate ? `, bank balance ${eurCents(a.matched.statementBalance)} on ${dayLabel(isoDate(a.matched.statementDate))}` : ""
        }.`,
      )
    } else {
      accountWrites.push({ op: "create_account", key: a.key, input: { name: a.name, ...statement, importRef: `${wb.year}:Saldo!${a.saldoRow}` } })
      accountsReport.push(`${a.name}: created, opening balance ${eurCents(0)} on ${dayLabel(wb.openingDay)}.`)
    }
    accountsReport.push(`${a.name}: bank balance ${eurCents(a.statementBalance)} on ${dayLabel(a.statementDay)}, from the Saldo sheet.`)
  }

  // ── The review list ──
  const review: ReviewItem[] = []
  const decisionOf = (item: Omit<ReviewItem, "decision" | "problem">, check: (d: Decision) => string | null): Decision => {
    const owner = choices.decisions[item.id] ?? null
    const problem = owner ? check(owner) : null
    review.push({ ...item, decision: owner, problem })
    if (owner && !problem) reviewReport.push(`${item.where}, ${item.what}: ${item.options.find((o) => o.id === owner.option)?.label ?? owner.option}.`)
    // Undecided, or not usable yet: the suggestion stands in, for the counts and the check.
    return owner && !problem
      ? owner
      : { option: item.suggested, parts: item.parts, clientId: item.invoice?.clientId ?? undefined, amount: item.invoice?.amount, vat: item.invoice?.vat, gross: item.gross ?? undefined, invoiceId: item.invoiceId }
  }
  const kindOptions = (amount: number) => [
    ...(amount >= 0 ? IN_KINDS : OUT_KINDS).map((as) => ({ id: as, label: bookAsLabel(as, amount) })),
    { id: "split", label: "Split Into Parts" },
  ]
  const partsProblem = (parts: Part[] | undefined, amount: number): string | null => {
    if (!parts || parts.length < 2) return "Add at least two parts."
    if (parts.some((p) => !Number.isFinite(p.amount) || round2(p.amount) === 0)) return "Enter every part's amount (none can be 0)."
    const total = round2(parts.reduce((t, p) => t + p.amount, 0))
    if (total !== amount) return `The parts add up to ${eurCents(total)}, the bank amount is ${eurCents(amount)}.`
    const allowed = (p: Part) => (p.amount > 0 ? IN_KINDS : OUT_KINDS).includes(p.as)
    if (!parts.every(allowed)) return "A part's type doesn't fit its sign: money in or money out."
    return null
  }
  const clientsIn = (text: string) => app.clients.filter((c) => c.name.trim().length >= 3 && text.toLowerCase().includes(c.name.trim().toLowerCase()))

  // ── Rows → records ──
  const docWrites: Write[] = []
  const costWrites: Write[] = []
  const loanWrites: Write[] = []
  const movementWrites: Write[] = []
  const invoiceWrites: Write[] = []
  const counted = new Map<string, { count: number; written: boolean }>()
  const count = (label: string, written = true) => counted.set(label, { count: (counted.get(label)?.count ?? 0) + 1, written })
  let splitRows = 0
  const invoiceById = new Map(app.invoices.map((i) => [i.id, i]))
  const byNumber = new Map<string, Invoice[]>()
  for (const i of app.invoices) {
    const n = i.amount > 0 ? appNumber(i) : null
    if (n) byNumber.set(n, [...(byNumber.get(n) ?? []), i])
  }
  const issued = new Map<string, SourceRow>()
  for (const r of wb.rows) if (plans.get(r.ref)?.kind === "issued") for (const n of invoiceNumbers(r.documentRef ?? r.description)) issued.set(n, r)
  const touched = new Set<string>()
  const invoiceUpdates = new Map<string, UpdateInvoiceInput>()
  const updateInvoice = (i: Invoice, input: UpdateInvoiceInput, ref: string | null) => {
    touched.add(i.id)
    invoiceUpdates.set(i.id, { ...invoiceUpdates.get(i.id), ...input })
    invoiceWrites.push({ op: "update_invoice", id: i.id, ref, input })
  }

  const documentOf = (r: SourceRow) => (MISSING_DOCUMENT.test(r.notes ?? "") ? null : clip(r.documentRef, 100))
  const notesOf = (r: SourceRow, max: number, ...extra: (string | null)[]) =>
    clip(joinNotes(r.notes, MISSING_DOCUMENT.test(r.notes ?? "") && r.documentRef ? `Excel ref: ${r.documentRef}` : null, ...extra), max)
  /** Cost centre: column M, or a row that is clearly the property's (tenants, deposits, its rent), or that names it. */
  const projectOf = (r: SourceRow, property: boolean) =>
    project && (r.flagged || property || r.description.toLowerCase().includes(project.toLowerCase())) ? clip(project, 60) : null
  const dated = (r: SourceRow) => ({ date: toDate(r.day), dateEstimated: r.dateEstimated })

  /** One booking on an account: the record the screens would write for it. */
  const book = (r: SourceRow, as: BookAs, amount: number, account: string, opts: { ref: string; description?: string; property?: boolean }) => {
    const description = titleOf(r, opts.description)
    const base = { ref: opts.ref, key: `${as}:${opts.ref}` }
    if (as === "cost") {
      count(amount < 0 ? "Costs" : "Refunds")
      costWrites.push({
        op: "expense",
        ...base,
        input: {
          description,
          category: amount < 0 ? suggestCategory(r.description) : "other",
          amount: -amount,
          vat: 0,
          ...dated(r),
          isRecurring: false,
          accountId: acc(account),
          documentRef: documentOf(r),
          project: projectOf(r, !!opts.property),
          notes: notesOf(r, 500),
          importRef: opts.ref,
        },
      })
    } else if (as === "loan") {
      count(amount > 0 ? "Shareholder loans" : "Shareholder loan repayments")
      loanWrites.push({
        op: "loan",
        ...base,
        input: { description, direction: amount > 0 ? "to_company" : "from_company", amount: Math.abs(amount), ...dated(r), accountId: acc(account), notes: notesOf(r, 500), importRef: opts.ref },
      })
    } else {
      const deposit = as === "deposit_held" || as === "deposit_paid"
      count(sentence(bookAsLabel(as, amount)))
      movementWrites.push({
        op: "movement",
        ...base,
        input: {
          kind: as,
          direction: amount > 0 ? "in" : "out",
          amount: Math.abs(amount),
          ...dated(r),
          accountId: acc(account),
          description,
          documentRef: documentOf(r),
          project: as === "client_income" ? INVOICE_PROJECT : projectOf(r, deposit || !!opts.property),
          counterparty: deposit ? (as === "deposit_paid" && /caparra/i.test(r.description) ? "Landlord" : counterpartyOf(r.description)) : null,
          notes: notesOf(r, 1000),
          importRef: opts.ref,
        },
      })
    }
  }
  const fee = (r: SourceRow, account: string, amount: number, numbers: string) => {
    count("Bank fees on invoice payments")
    costWrites.push({
      op: "expense",
      key: `fee:${r.ref}`,
      ref: r.ref,
      input: { description: `Bank fee on invoice ${numbers}`, category: "bank_fees", amount, vat: 0, ...dated(r), accountId: acc(account), importRef: r.ref },
    })
    invoiceReport.push(`${where(r.sheet, r.row)}: ${eurCents(amount)} short of invoice ${numbers}, booked as a bank fee.`)
  }
  const clientIncome = (r: SourceRow, account: string, amount: number, description: string) => {
    count("Client payments without invoice")
    movementWrites.push({
      op: "movement",
      key: `client_income:${r.ref}:${amount}`,
      ref: r.ref,
      input: {
        kind: "client_income",
        direction: "in",
        amount,
        ...dated(r),
        accountId: acc(account),
        description: titleOf(r, description),
        documentRef: clip(r.documentRef, 100),
        project: INVOICE_PROJECT,
        notes: notesOf(r, 1000),
        importRef: r.ref,
      },
    })
  }

  const sourceNumbers = new Set<string>()
  for (const r of wb.rows) {
    const plan = plans.get(r.ref)
    if (!plan || plan.kind === "rejected") continue
    const amount = amountOf(r)
    const account = r.legs[0]?.account ?? ""
    const at = where(r.sheet, r.row)
    if (r.legs.length > 0 && MISSING_DOCUMENT.test(r.notes ?? "")) missingReport.push(`${at}, ${r.description}${r.documentRef ? ` (Excel ref ${r.documentRef})` : ""}.`)
    if (FOR_ACCOUNTANT.test(`${r.description} ${r.notes ?? ""}`)) accountantReport.push(`${at}, ${r.description}${r.notes ? `: ${r.notes}` : ""}`)
    const base = { ref: r.ref, where: at, what: r.description, amount: r.legs.length ? amount : null, account: accountName.get(account) ?? null, day: r.day }

    switch (plan.kind) {
      case "transfer": {
        count("Transfers between accounts")
        movementWrites.push({
          op: "movement",
          key: `transfer:${r.ref}`,
          ref: r.ref,
          input: {
            kind: "transfer",
            direction: "out",
            amount: plan.amount,
            ...dated(r),
            accountId: acc(plan.from),
            toAccountId: acc(plan.to),
            description: clip(r.description || `Transfer to ${accountName.get(plan.to)}`, 300)!,
            documentRef: clip(r.documentRef, 100),
            project: null,
            notes: notesOf(r, 1000),
            importRef: r.ref,
          },
        })
        break
      }
      case "book":
      case "split": {
        const flag = NEEDS_REVIEW.exec(`${r.description} ${r.notes ?? ""}`)
        const why = plan.kind === "split" ? plan.why : (plan.why ?? (flag ? `The workbook says “${flag[0]}”: check what it is before it goes in.` : null))
        const property = plan.kind === "split" || plan.property
        if (!why) {
          if (plan.kind === "book") book(r, plan.as, amount, account, { ref: r.ref, property })
          break
        }
        const suggested = plan.kind === "split" ? "split" : plan.as
        const decision = decisionOf(
          { ...base, id: r.ref, why, options: kindOptions(amount), suggested, parts: plan.kind === "split" ? plan.parts : [{ as: plan.as, amount, description: r.description }] },
          (d) => (d.option === "split" ? partsProblem(d.parts, amount) : null),
        )
        if (decision.option === "split") {
          const parts = partsProblem(decision.parts, amount) ? [{ as: (amount > 0 ? "income" : "cost") as BookAs, amount, description: r.description }] : decision.parts!
          splitRows++
          parts.forEach((p, k) => book(r, p.as, round2(p.amount), account, { ref: parts.length > 1 ? `${r.ref}${letter(k)}` : r.ref, description: p.description, property: true }))
        } else book(r, decision.option as BookAs, amount, account, { ref: r.ref, property })
        break
      }
      case "supplier_payment": {
        const doc = byRef.get(plan.doc)!
        count("Supplier invoice payments")
        movementWrites.push({
          op: "movement",
          key: `supplier_payment:${r.ref}`,
          ref: r.ref,
          input: {
            kind: "supplier_payment",
            direction: "out",
            amount: -amount,
            ...dated(r),
            accountId: acc(account),
            expenseId: `doc:${doc.ref}`,
            description: titleOf(r),
            documentRef: clip(r.documentRef, 100),
            project: projectOf(r, false),
            notes: notesOf(r, 1000),
            importRef: r.ref,
          },
        })
        break
      }
      case "supplier_doc": {
        count("Supplier invoices, Not Paid Yet")
        const netted = plan.credits.map((c) => c.documentRef ?? where(c.sheet, c.row))
        docWrites.push({
          op: "expense",
          key: `doc:${r.ref}`,
          ref: r.ref,
          input: {
            description: titleOf(r),
            category: suggestCategory(r.description),
            amount: plan.amount,
            vat: 0,
            ...dated(r),
            isRecurring: false,
            documentRef: clip(r.documentRef, 100),
            project: projectOf(r, false),
            notes: notesOf(r, 500, netted.length ? `Net of credit note ${netted.join(", ")}` : null),
            importRef: r.ref,
          },
        })
        if (netted.length) cancelledReport.push(`${at}, ${r.description}: ${eurCents(r.debit!)} less credit note ${netted.join(", ")} = ${eurCents(plan.amount)}.`)
        break
      }
      case "cancelled_doc":
        count("Cancelled supplier invoices", false)
        cancelledReport.push(`${at}, ${r.description}: cancelled by credit note ${plan.credits.map((c) => c.documentRef ?? where(c.sheet, c.row)).join(", ")}, not created.`)
        break
      case "supplier_credit":
        count("Supplier credit notes, netted", false)
        break
      case "store_credit":
        count("Credit notes with no money", false)
        cancelledReport.push(`${at}, ${r.description}: ${eurCents(r.credit!)} with no money on an account, not imported.`)
        break
      case "owner_card": {
        count("Costs paid with your card")
        costWrites.push({
          op: "expense",
          key: `card:${r.ref}`,
          ref: r.ref,
          input: {
            description: titleOf(r),
            category: suggestCategory(r.description),
            amount: r.debit!,
            vat: 0,
            ...dated(r),
            isRecurring: false,
            paidByOwner: true,
            documentRef: documentOf(r),
            project: projectOf(r, false),
            notes: notesOf(r, 500),
            importRef: r.ref,
          },
        })
        break
      }
      case "issued": {
        count("Invoices issued, checked against the app", false)
        for (const n of invoiceNumbers(r.documentRef ?? r.description)) {
          sourceNumbers.add(n)
          const app = byNumber.get(n)?.[0]
          if (!app) invoiceReport.push(`${at}: invoice ${n} is in the workbook, not in the app.`)
          else if (round2(invoiceTotal(app)) !== r.debit) {
            invoiceReport.push(`${at}: invoice ${n} is ${eurCents(r.debit!)} in the workbook, ${eurCents(invoiceTotal(app))} in the app. The app's figures are kept.`)
          }
        }
        break
      }
      case "client_credit": {
        const reported = () => count("Credit notes on your invoices, reported only", false)
        const n = invoiceNumbers(r.documentRef ?? r.description)[0]
        const original = n ? byNumber.get(n)?.find((i) => !touched.has(i.id)) : undefined
        if (!original) {
          invoiceReport.push(`${at}: credit note on invoice ${n ?? "with no number"}, which is not in the app.`)
          reported()
          break
        }
        if (original.paidDate) {
          invoiceReport.push(`${at}: invoice ${original.number} is already settled in the app, left as it is.`)
          reported()
          break
        }
        const client = app.clientOf(original)
        const note = app.invoices.find(
          (i) => i.amount < 0 && !i.paidDate && !touched.has(i.id) && app.clientOf(i) === client && round2(invoiceTotal(i)) === round2(-r.credit!),
        )
        if (!note) {
          invoiceReport.push(`${at}: invoice ${original.number} reads as owed: add its credit note on Invoices, then mark it paid as an offset.`)
          reported()
          break
        }
        count("Credit notes on your invoices")
        const settle = { paidDate: toDate(r.day), paidAccountId: NON_CASH }
        updateInvoice(original, settle, r.ref)
        updateInvoice(note, settle, r.ref)
        cancelledReport.push(`${at}: invoice ${original.number} settled with credit note ${note.number} on ${dayLabel(r.day)}, no money moved.`)
        changedReport.push(`Invoice ${original.number} and credit note ${note.number}: settled on ${dayLabel(r.day)} with no money; both were unpaid.`)
        break
      }
      case "receipt":
        receipt(r, plan.numbers, base)
        break
      case "platform":
        platform(r, base)
        break
    }
  }

  function receipt(r: SourceRow, numbers: string[], base: Omit<ReviewItem, "id" | "why" | "options" | "suggested" | "decision" | "problem">) {
    const amount = amountOf(r)
    const account = r.legs[0].account
    const found = numbers.map((n) => byNumber.get(n)?.find((i) => !touched.has(i.id)))
    const label = numbers.join(", ") || "with no number"
    if (numbers.length === 0 || found.some((i) => !i)) {
      const missing = numbers.filter((_n, k) => !found[k])
      const single = numbers.length === 1
      const doc = single ? issued.get(numbers[0]) : undefined
      const vat = vatInNote(doc?.notes ?? null) ?? vatInNote(r.notes) ?? 0
      const total = doc?.debit ?? amount
      const candidates = clientsIn(`${r.description} ${doc?.description ?? ""}`)
      const options = [
        ...(single && app.clients.length > 0 ? [{ id: "create_invoice", label: `Create Invoice ${numbers[0]}` }] : []),
        { id: "client_income", label: "Client Payment Without Invoice" },
      ]
      const d = decisionOf(
        {
          ...base,
          id: r.ref,
          why: `Invoice ${missing.join(", ") || label} is not in the app. Create it, paid into ${accountName.get(account)}, or record the money without an invoice (the Plan doesn't count it again).`,
          options,
          suggested: options[0].id,
          invoice: single ? { number: numbers[0], clientId: candidates[0]?.id ?? null, amount: round2(total - vat), vat } : undefined,
          clients: app.clients,
        },
        (x) => {
          if (x.option !== "create_invoice") return null
          if (!x.clientId) return "Pick the client."
          const t = round2((x.amount ?? 0) + (x.vat ?? 0))
          if (!(t > 0)) return "Enter the invoice's amount."
          if (round2(t - amount) > MAX_BANK_FEE) return `The invoice is ${eurCents(t)}, ${eurCents(round2(t - amount))} more than the payment: at most ${eurCents(MAX_BANK_FEE)} can be a bank fee.`
          return null
        },
      )
      if (d.option === "create_invoice" && d.clientId) {
        const total = round2((d.amount ?? 0) + (d.vat ?? 0))
        count("Invoices created and paid")
        invoiceWrites.push({
          op: "create_invoice",
          key: `invoice:${r.ref}`,
          ref: r.ref,
          input: {
            clientId: d.clientId,
            number: numbers[0],
            yearMonth: (doc ?? r).ym,
            amount: round2(d.amount ?? 0),
            vat: round2(d.vat ?? 0),
            paidDate: toDate(r.day),
            paidAccountId: acc(account),
          },
        })
        invoiceReport.push(`${where(r.sheet, r.row)}: invoice ${numbers[0]} created, paid on ${dayLabel(r.day)}${r.dateEstimated ? " (estimated)" : ""}.`)
        const gap = round2(total - amount)
        if (gap > 0) fee(r, account, gap, numbers[0])
        else if (gap < 0) clientIncome(r, account, -gap, `Overpayment on invoice ${numbers[0]}, to review`)
      } else clientIncome(r, account, amount, r.description)
      return
    }
    const invoices = found as Invoice[]
    const expected = round2(invoices.reduce((t, i) => t + invoiceTotal(i), 0))
    const gap = round2(expected - amount)
    let option = "paid"
    if (gap !== 0) {
      const autoFee = gap > 0 && gap <= MAX_BANK_FEE && invoices.every((i) => issued.get(appNumber(i) ?? "")?.debit === round2(invoiceTotal(i)))
      if (!autoFee) {
        const options =
          gap > 0
            ? [
                { id: "paid", label: `Mark Paid, ${eurCents(gap)} as a Bank Fee` },
                { id: "client_income", label: "Client Payment Without Invoice, Invoice Stays Unpaid" },
              ]
            : [
                { id: "paid", label: `Mark Paid, the ${eurCents(-gap)} Extra as Client Payment Without Invoice` },
                { id: "client_income", label: "Client Payment Without Invoice, Invoice Stays Unpaid" },
              ]
        option = decisionOf(
          {
            ...base,
            id: r.ref,
            why:
              gap > 0
                ? `${eurCents(amount)} arrived for invoice ${label}, which is ${eurCents(expected)} in the app: ${eurCents(gap)} less.`
                : `${eurCents(amount)} arrived for invoice ${label}, which is ${eurCents(expected)} in the app: ${eurCents(-gap)} more.`,
            options,
            suggested: gap > 0 && gap > MAX_BANK_FEE ? "client_income" : "paid",
          },
          () => null,
        ).option
      }
    }
    if (option === "client_income") {
      clientIncome(r, account, amount, r.description)
      return
    }
    count("Client invoice payments")
    for (const i of invoices) {
      let day = r.day
      const appDay = i.paidDate ? isoDate(i.paidDate) : null
      if (appDay && appDay !== r.day && r.dateEstimated) {
        if (appDay.slice(0, 7) === r.day.slice(0, 7)) day = appDay
        else {
          const pick = decisionOf(
            {
              ...base,
              id: `${r.ref}#date:${i.id}`,
              why: `Invoice ${i.number} is paid on ${dayLabel(appDay)} in the app; the workbook has it in ${r.sheet} with no day.`,
              options: [
                { id: "app", label: `Keep ${dayLabel(appDay)} From the App` },
                { id: "excel", label: `Use ~${dayLabel(r.day)} From the Workbook` },
              ],
              suggested: "app",
            },
            () => null,
          )
          if (pick.option === "app") day = appDay
        }
      }
      if (appDay && appDay !== day) invoiceReport.push(`${where(r.sheet, r.row)}: invoice ${i.number} paid on ${dayLabel(day)}; the app had ${dayLabel(appDay)}.`)
      updateInvoice(i, { paidDate: toDate(day), paidAccountId: acc(account) }, r.ref)
    }
    if (gap > 0) fee(r, account, gap, label)
    else if (gap < 0) clientIncome(r, account, -gap, `Overpayment on invoice ${label}, to review`)
  }

  function platform(r: SourceRow, base: Omit<ReviewItem, "id" | "why" | "options" | "suggested" | "decision" | "problem">) {
    const amount = amountOf(r)
    const account = r.legs[0].account
    const commission = new RegExp(String.raw`commission[ei]\s+(?:\p{L}+\s+){0,3}?${AMOUNT}`, "iu").exec(r.notes ?? "")
    const gross = commission ? round2(amount + italianNumber(commission[1])) : null
    const commissionRef = /commission[^()]*\(fattura\s+([^\s)]+)\)/i.exec(r.notes ?? "")?.[1] ?? null
    const number = clip(r.documentRef, 50)
    // The payout's own invoice already in the app (typed, or left by an import since undone): never created twice.
    const same = number ? app.invoices.find((i) => i.amount > 0 && !touched.has(i.id) && i.number.trim().toLowerCase() === number.toLowerCase()) : undefined
    // Unpaid, or paid with no account (an import undone leaves its invoices so): the payout can be what paid it.
    const open = app.invoices
      .filter((i) => i.amount > 0 && !touched.has(i.id) && (!i.paidDate || i.paidAccountId === null) && invoiceTotal(i) >= amount)
      .sort((a, b) => Number(b === same) - Number(a === same))
    const own = same && open.includes(same) ? same : undefined
    const candidates = clientsIn(`${r.description} ${r.notes ?? ""}`)
    const options = [
      ...(app.clients.length > 0 && !same ? [{ id: "platform_invoice", label: "Invoice at Gross + Platform Commission" }] : []),
      ...(open.length > 0 ? [{ id: "platform_existing", label: own ? `Mark Invoice ${own.number} Paid + Platform Commission` : "Mark an Invoice in the App Paid + Platform Commission" }] : []),
      { id: "client_income", label: "Client Payment Without Invoice, Net" },
    ]
    const d = decisionOf(
      {
        ...base,
        id: r.ref,
        why: own
          ? `A platform paid you net of its commission, and its invoice ${own.number} is already in the app. Suggested: mark it paid into ${accountName.get(account)} and book the ${eurCents(round2(invoiceTotal(own) - amount))} difference as the platform's commission (reverse charge, VAT 0).`
          : `A platform paid you net of its commission. Suggested: an invoice at the gross with the platform's number, paid into ${accountName.get(account)}, and the commission as a cost (reverse charge, VAT 0), so the Plan counts the commission.`,
        options,
        suggested: own ? "platform_existing" : options[0].id,
        gross,
        invoice: { number: number ?? `Payout ${where(r.sheet, r.row)}`, clientId: candidates[0]?.id ?? null, amount: gross ?? amount, vat: 0 },
        invoiceId: own?.id,
        clients: app.clients,
        openInvoices: open.map((i) => ({ id: i.id, label: `${i.number}, ${eurCents(invoiceTotal(i))}${i.paidDate ? ", paid with no account" : ""}` })),
      },
      (x) => {
        if (x.option === "platform_invoice") {
          if (!x.clientId) return "Pick the client the invoice is in the name of."
          if (!(x.gross !== undefined && x.gross >= amount)) return `Enter the gross: at least the ${eurCents(amount)} that arrived.`
        }
        if (x.option === "platform_existing" && !open.some((i) => i.id === x.invoiceId)) return "Pick the invoice it pays."
        return null
      },
    )
    const commissionCost = (value: number) => {
      if (value <= 0) return
      count("Platform commissions")
      costWrites.push({
        op: "expense",
        key: `commission:${r.ref}`,
        ref: r.ref,
        input: {
          description: "Platform commission",
          category: "other",
          amount: value,
          vat: 0,
          ...dated(r),
          isRecurring: false,
          accountId: acc(account),
          documentRef: clip(commissionRef, 100),
          project: INVOICE_PROJECT,
          notes: clip(joinNotes("Reverse charge", r.notes), 500),
          importRef: r.ref,
        },
      })
    }
    if (d.option === "platform_invoice" && d.clientId && d.gross !== undefined && d.gross >= amount) {
      count("Invoices created and paid")
      invoiceWrites.push({
        op: "create_invoice",
        key: `invoice:${r.ref}`,
        ref: r.ref,
        input: {
          clientId: d.clientId,
          number: number ?? `Payout ${r.sheet} ${r.row}`,
          yearMonth: r.ym,
          amount: round2(d.gross),
          vat: 0,
          paidDate: toDate(r.day),
          paidAccountId: acc(account),
        },
      })
      commissionCost(round2(d.gross - amount))
      invoiceReport.push(`${where(r.sheet, r.row)}: platform invoice ${r.documentRef ?? ""} created at ${eurCents(d.gross)}, commission ${eurCents(round2(d.gross - amount))}.`)
    } else if (d.option === "platform_existing" && d.invoiceId && invoiceById.get(d.invoiceId)) {
      const i = invoiceById.get(d.invoiceId)!
      count("Client invoice payments")
      if (i.paidDate && isoDate(i.paidDate) !== r.day) invoiceReport.push(`${where(r.sheet, r.row)}: invoice ${i.number} paid on ${dayLabel(r.day)}; the app had ${dayLabel(isoDate(i.paidDate))}.`)
      updateInvoice(i, { paidDate: toDate(r.day), paidAccountId: acc(account) }, r.ref)
      commissionCost(round2(invoiceTotal(i) - amount))
    } else clientIncome(r, account, amount, r.description)
  }

  for (const e of wb.empty) emptyReport.push(`${e.where}, ${e.description || "no description"}.`)

  // Numbering: the gaps among the invoices the workbook issued.
  const byYear = new Map<string, number[]>()
  for (const n of sourceNumbers) {
    const [num, year] = n.split("/")
    byYear.set(year, [...(byYear.get(year) ?? []), Number(num)])
  }
  for (const [year, nums] of byYear) {
    const missing: number[] = []
    for (let n = Math.min(...nums); n <= Math.max(...nums); n++) if (!nums.includes(n)) missing.push(n)
    if (missing.length) invoiceReport.push(`Invoice numbers missing from the workbook: ${missing.map((n) => `${n}/${year}`).join(", ")}.`)
  }

  // (c) Paid in the app in the workbook's months, with no money in the workbook: never an invented bank payment.
  for (const i of app.invoices) {
    if (i.amount <= 0 || !i.paidDate || i.paidAccountId !== null || touched.has(i.id)) continue
    const day = isoDate(i.paidDate)
    if (day < wb.openingDay || day > wb.saldoDay) continue
    const d = decisionOf(
      {
        id: `invoice:${i.id}`,
        ref: null,
        where: "Invoices",
        what: `Invoice ${i.number}`,
        amount: invoiceTotal(i),
        account: null,
        day,
        why: `The app has it paid on ${dayLabel(day)}, but no row of the workbook received it. The import never invents a bank payment.`,
        options: [
          { id: "keep", label: "Keep Paid, No Account (To Chase Lists It)" },
          { id: "unpaid", label: "Mark Unpaid" },
          { id: "offset", label: "Offset, No Bank Payment" },
        ],
        suggested: "keep",
      },
      () => null,
    )
    if (d.option === "unpaid") {
      updateInvoice(i, { paidDate: null }, null)
      changedReport.push(`Invoice ${i.number}: marked unpaid; it was paid on ${dayLabel(day)} with no account.`)
    } else if (d.option === "offset") {
      updateInvoice(i, { paidAccountId: NON_CASH }, null)
      changedReport.push(`Invoice ${i.number}: settled as an offset, no bank payment; it was paid on ${dayLabel(day)} with no account.`)
    }
  }

  // ── Overlaps: a cost or loan already in the app that looks like a workbook row ──
  const candidates = [...docWrites, ...costWrites, ...loanWrites].filter(
    (w): w is Extract<Write, { op: "expense" | "loan" }> => (w.op === "expense" || w.op === "loan") && w.input.amount > 0,
  )
  const paired = new Set<string>()
  const overlaps: Overlap[] = []
  const appDated = new Set<string>()
  const busy = new Set(app.movements.map((m) => m.expenseId).filter(Boolean))
  // Only rows with no account can be the workbook's bank payment: an account of the workbook's must be empty,
  // so a row on an account is on another one (a cash box), which the import never touches.
  const existing = [
    ...app.expenses
      .filter((e) => !e.isRecurring && !e.importRef && e.amount > 0 && !busy.has(e.id) && !e.accountId)
      .map((e) => ({ kind: "expense" as const, row: e, cash: [round2(e.amount + (e.vat ?? 0)), e.amount], direction: null })),
    ...app.loans.filter((l) => !l.importRef && !l.accountId).map((l) => ({ kind: "loan" as const, row: l, cash: [l.amount], direction: l.direction })),
  ].sort((a, b) => a.row.date.getTime() - b.row.date.getTime())
  for (const x of existing) {
    const day = isoDate(x.row.date)
    const cost = x.kind === "expense" ? (x.row as CompanyExpense) : null
    const match = candidates
      .filter(
        (w) =>
          !paired.has(w.key) &&
          (cost ? w.op === "expense" && (!cost.paidByOwner || w.input.paidByOwner === true) : w.op === "loan" && w.input.direction === x.direction) &&
          x.cash.includes(round2(w.input.amount + (w.op === "expense" ? (w.input.vat ?? 0) : 0))) &&
          daysBetween(day, isoDate(w.input.date)) <= 31,
      )
      .sort((a, b) => daysBetween(day, isoDate(a.input.date)) - daysBetween(day, isoDate(b.input.date)))[0]
    if (!match) continue
    paired.add(match.key)
    const src = byRef.get(match.ref.replace(/[a-z]+$/, ""))
    const at = src ? where(src.sheet, src.row) : match.ref
    const replace = !choices.keep.includes(x.row.id)
    const workbookDay = isoDate(match.input.date)
    const limit = sheetAccounts.find((a) => a.key === match.input.accountId)?.statementDay ?? wb.saldoDay
    // No day in the workbook: Replace keeps the app's, as for an invoice (an estimated day in the same month).
    const appDay = match.input.dateEstimated && day.slice(0, 7) === workbookDay.slice(0, 7) && day >= wb.openingDay && day <= limit ? day : null
    const details = cost
      ? [
          `category ${COST_CATEGORY_LABELS[cost.category] ?? cost.category}`,
          cost.vat ? `VAT ${eurCents(cost.vat)}` : cost.vat === 0 ? "VAT 0" : "VAT not stated",
          cost.documentRef && `document ${cost.documentRef}`,
          cost.project && `cost centre ${cost.project}`,
          cost.paidByOwner && "paid with your card",
          cost.recurringExpenseId && `pays the recurring cost “${app.expenses.find((e) => e.id === cost.recurringExpenseId)?.description ?? "deleted"}”`,
        ].filter((d): d is string => !!d)
      : [(x.row as CompanyLoan).direction === "to_company" ? "lent to the SRL" : "repaid to you"]
    overlaps.push({
      kind: x.kind,
      id: x.row.id,
      existing: { description: x.row.description, day, amount: x.cash[0], details },
      imported: { ref: match.ref, where: at, description: match.input.description, day: workbookDay, dateEstimated: !!match.input.dateEstimated, appDay, amount: match.input.amount },
      replace,
    })
    if (replace) {
      if (appDay) {
        match.input = { ...match.input, date: toDate(appDay), dateEstimated: false }
        appDated.add(match.ref)
      }
      const cash = cost && cost.vat ? `${eurCents(x.cash[0])} (${eurCents(cost.amount)} + VAT)` : eurCents(x.cash[0])
      replacedReport.push(
        [
          `${cost ? "Cost" : "Loan"} “${x.row.description}”, ${dayLabel(day)}${x.row.dateEstimated ? " (estimated)" : ""}, ${cash}`,
          ...details,
          x.row.notes && `notes: ${x.row.notes}`,
        ]
          .filter(Boolean)
          .join(", ") + `. Replaced by ${at}${appDay ? `, on the app's ${dayLabel(appDay)}` : ""}.`,
      )
    }
  }
  const deletions: Write[] = overlaps.filter((o) => o.replace).map((o) => (o.kind === "expense" ? { op: "delete_expense", id: o.id } : { op: "delete_loan", id: o.id }))
  const estimatedRows = wb.rows.filter((r) => r.legs.length > 0 && r.dateEstimated && !appDated.has(r.ref))
  for (const r of estimatedRows) estimatedReport.push(`${where(r.sheet, r.row)}, ${r.description}: ~${dayLabel(r.day)}.`)

  // ── Recurring estimates: the payments that stand for one ──
  const estimates = app.expenses.filter((e) => e.isRecurring)
  type Payment = Extract<Write, { op: "expense" }>
  /**
   * By key: the estimate's id when a word of its name is in the payments (ticked); else "id~" for the payments that
   * only share its category, left to the owner. "Other" holds any cost, so there "id~word" by the payments' first word.
   */
  const groups = new Map<string, { estimate: CompanyExpense; sure: boolean; payments: Payment[] }>()
  const add = (key: string, estimate: CompanyExpense, sure: boolean, w: Payment) =>
    groups.set(key, { estimate, sure, payments: [...(groups.get(key)?.payments ?? []), w] })
  for (const w of costWrites) {
    if (w.op !== "expense" || w.input.amount <= 0) continue
    const found = estimates.filter((e) => {
      const word = e.description.toLowerCase().match(/\p{L}{3,}/u)?.[0]
      return e.category === w.input.category && word && w.input.description.toLowerCase().includes(word)
    })
    if (found.length === 1) add(found[0].id, found[0], true, w)
    else if (found.length === 0) {
      const { candidates } = pickEstimate(w.input, estimates)
      const e = candidates.length === 1 ? candidates[0] : null
      if (e) add(`${e.id}~${e.category === "other" ? firstToken(w.input.description) : ""}`, e, false, w)
    }
  }
  const estimateWrites: Write[] = []
  const edits = new Map<string, { estimate: CompanyExpense; input: UpdateCompanyExpenseInput }>()
  const months = (g: { payments: Payment[] }) => new Set(g.payments.map((w) => isoDate(w.input.date).slice(0, 7))).size
  const gap = (g: { estimate: CompanyExpense; payments: Payment[] }) => Math.abs(g.payments.reduce((t, w) => t + w.input.amount, 0) / g.payments.length - g.estimate.amount)
  // One card per estimate. A word links it: that group. Else the payments of its category; for "other", the group
  // paid in two months or more whose average is nearest the estimate. ponytail: a guess the owner ticks or not;
  // a picker of payments if owners keep several "other" estimates.
  const best = new Map<string, string>()
  for (const [key, g] of groups) {
    if (g.sure || groups.has(g.estimate.id) || (g.estimate.category === "other" && months(g) < 2)) continue
    const was = groups.get(best.get(g.estimate.id) ?? "")
    if (!was || gap(g) < gap(was)) best.set(g.estimate.id, key)
  }
  const links: EstimateLink[] = [...groups]
    .filter(([key, g]) => g.sure || best.get(g.estimate.id) === key)
    .map(([key, { estimate, sure, payments }]) => {
      // Where "Start it on the opening day" puts it: that day, or for a counted-when-paid estimate the first payment
      // month on or after it, keeping the phase so its payment months do not move. Not when it has ended by then.
      const opening = toDate(wb.openingDay)
      const every = estimate.recurrenceMonths && estimate.recurrenceMonths > 0 ? estimate.recurrenceMonths : 1
      const to = countedWhenPaid(estimate)
        ? addMonths(estimate.date, Math.ceil(differenceInCalendarMonths(opening, estimate.date) / every) * every)
        : opening
      const toMonth = format(to, "yyyy-MM")
      const startsEarly = isoDate(estimate.date) < wb.openingDay && !(estimate.endMonth && estimate.endMonth < toMonth)
      const c = choices.estimates[key] ?? { link: sure, moveStart: startsEarly }
      if (c.link) {
        for (const w of payments) w.input = { ...w.input, recurringExpenseId: estimate.id }
        const was = edits.get(estimate.id)?.input
        // Price changes on or before the new start fold into the amount (the price there): a change cannot start with the cost.
        const changes = estimate.priceChanges ?? []
        const fold = changes.some((x) => x.from <= toMonth)
        edits.set(estimate.id, {
          estimate,
          input: {
            ...was,
            ...(c.moveStart && startsEarly && {
              date: to,
              ...(fold && { amount: priceIn(estimate, toMonth), priceChanges: changes.filter((x) => x.from > toMonth) }),
            }),
          },
        })
      }
      return {
        key,
        estimate,
        sure,
        sample: payments[0].input.description,
        payments: payments.length,
        total: round2(payments.reduce((t, w) => t + w.input.amount, 0)),
        startsEarly,
        link: c.link,
        moveStart: c.link && c.moveStart && startsEarly,
      }
    })
  for (const [id, { estimate, input }] of edits) {
    if (Object.keys(input).length === 0) continue
    estimateWrites.push({ op: "update_estimate", id, input })
    changedReport.push(`Recurring cost “${estimate.description}”: start moved from ${dayLabel(isoDate(estimate.date))} to ${dayLabel(isoDate(input.date ?? estimate.date))}.`)
  }

  // A cost that names an active collaborator is their invoice. Last, so the estimate links above see the workbook's category.
  const collaboratorRows: ImportPlan["collaboratorRows"] = []
  for (const w of [...docWrites, ...costWrites]) {
    if (w.op !== "expense" || w.input.isRecurring) continue
    const c = matchCollaborator(w.input.description, app.collaborators ?? [])
    if (!c) continue
    const day = isoDate(w.input.date)
    const forMonth = choices.forMonths?.[w.ref] ?? day.slice(0, 7)
    const mine = (app.assignments ?? []).filter((a) => a.collaboratorId === c.id)
    w.input = { ...w.input, category: "collaborators", collaboratorId: c.id, engagementId: mine.length === 1 ? mine[0].engagementId : null, forMonth }
    const r = byRef.get(w.ref)
    collaboratorRows.push({ ref: w.ref, where: r ? where(r.sheet, r.row) : w.ref, description: w.input.description, day, name: c.name, forMonth })
  }

  // The owner's rows go last: an import that stops halfway has deleted nothing of theirs.
  writes.push(...accountWrites, ...docWrites, ...costWrites, ...loanWrites, ...movementWrites, ...invoiceWrites, ...estimateWrites, ...deletions)

  // Every record as the backend checks it: a refusal shows here, never halfway through the writes.
  for (const w of writes) {
    const schema = CREATE_SCHEMAS[w.op]
    const issue = schema && "input" in w ? schema.safeParse(w.input).error?.issues[0] : undefined
    if (!issue) continue
    const src = "ref" in w && w.ref ? byRef.get(w.ref.replace(/[a-z]+$/, "")) : undefined
    const saldo = w.op === "create_account" ? sheetAccounts.find((a) => a.key === w.key)?.saldoRow : undefined
    const at = src ? where(src.sheet, src.row) : saldo ? `Saldo, row ${saldo}` : "The workbook"
    blockers.push(`${at}: the app would refuse what it becomes (${issue.path.join(".") || "record"}: ${issue.message}).`)
  }

  // ── The acceptance check, on the state the writes would leave ──
  const check = acceptance(wb, sheetAccounts, writes, app.invoices, invoiceUpdates)

  const unresolved = review.filter((i) => !i.decision || i.problem).map((i) => i.id)
  const money = wb.rows.filter((r) => r.legs.length > 0)
  return {
    workbook: wb,
    accounts: sheetAccounts.map((a) => ({ key: a.key, name: a.name, matched: a.matched })),
    writes,
    review,
    unresolved,
    overlaps,
    estimates: links,
    collaboratorRows,
    counts: {
      rows: wb.rows.length,
      perSheet: wb.sheets.map((s) => ({ sheet: s.name, rows: s.rows })),
      byKind: [...counted].map(([label, c]) => ({ label, ...c })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      splitRows,
      byAccount: sheetAccounts.map((a) => {
        const legs = money.flatMap((r) => r.legs.filter((l) => acc(l.account) === a.key))
        return {
          name: a.name,
          rows: legs.length,
          in: round2(legs.filter((l) => l.amount > 0).reduce((t, l) => t + l.amount, 0)),
          out: round2(legs.filter((l) => l.amount < 0).reduce((t, l) => t - l.amount, 0)),
        }
      }),
      estimatedDates: estimatedRows.length,
    },
    check,
    blockers,
    alreadyImported,
    report: report
      .filter((s) => s.lines.length > 0)
      .map((s) => [s.title, ...s.lines.map((l) => `- ${l}`)].join("\n"))
      .join("\n\n"),
  }
}

/**
 * The Verifica sheet, redone with lib/cash-book on the planned state: each
 * account's balance on its Saldo date equals the Saldo's to the cent; each
 * sheet's rows move each account by what the sheet's columns say; and the Cassa
 * columns add up to the Saldo balances.
 */
function acceptance(
  wb: Workbook,
  accounts: (SheetAccount & { source: string })[],
  writes: Write[],
  invoices: Invoice[],
  updates: Map<string, UpdateInvoiceInput>,
): Check {
  const at = new Date(0)
  const stamp = { userId: "", createdAt: at, updatedAt: at }
  const ref = new Map<string, string>()
  const expenses: CompanyExpense[] = []
  const loans: CompanyLoan[] = []
  const movements: CompanyMovement[] = []
  const created: Invoice[] = []
  for (const w of writes) {
    if (w.op === "expense") {
      ref.set(w.key, w.ref)
      expenses.push({ id: w.key, isRecurring: false, recurrenceMonths: null, notes: null, accountId: null, paidByOwner: false, vat: null, documentRef: null, project: null, recurringExpenseId: null, dateEstimated: false, importRef: null, ...stamp, ...w.input } as CompanyExpense)
    } else if (w.op === "loan") {
      ref.set(w.key, w.ref)
      loans.push({ id: w.key, notes: null, accountId: null, dateEstimated: false, importRef: null, ...stamp, ...w.input } as CompanyLoan)
    } else if (w.op === "movement") {
      ref.set(w.key, w.ref)
      movements.push({ id: w.key, toAccountId: null, expenseId: null, documentRef: null, project: null, counterparty: null, notes: null, dateEstimated: false, importRef: null, ...stamp, ...w.input } as CompanyMovement)
    } else if (w.op === "create_invoice") {
      ref.set(w.key, w.ref)
      created.push({ id: w.key, engagementId: null, fromMonth: null, dueDate: null, paidDate: null, paidAccountId: null, ...stamp, ...w.input } as Invoice)
    } else if (w.op === "update_invoice" && w.ref) ref.set(w.id, w.ref)
  }
  const planned = [...invoices.map((i) => (updates.has(i.id) ? { ...i, ...updates.get(i.id) } : i)), ...created]
  const book: CompanyAccount[] = accounts.map((a) => ({
    id: a.key,
    name: a.name,
    openingBalance: 0,
    openingDate: toDate(wb.openingDay),
    statementBalance: a.statementBalance,
    statementDate: toDate(a.statementDay),
    importRef: null,
    ...stamp,
  }))
  const ids = new Set(book.map((a) => a.id))
  const rows = cashRows({ invoices: planned, expenses, loans, movements }).filter((r) => ids.has(r.accountId))
  const { counted } = splitRows(book, rows)
  const problems: string[] = []
  const results: AccountCheck[] = accounts.map((a) => {
    const value = balancesAt(book, counted, a.statementDay).get(a.key) ?? 0
    const difference = round2(a.statementBalance - value)
    const ok = difference === 0
    return {
      name: a.name,
      day: a.statementDay,
      bank: a.statementBalance,
      book: value,
      difference,
      ok,
      label: ok
        ? `${a.name}: matches ${eurCents(a.statementBalance)} on ${dayLabel(a.statementDay)}`
        : `${a.name}: missing ${difference > 0 ? "IN" : "OUT"} of ${eurCents(Math.abs(difference))} on ${dayLabel(a.statementDay)}`,
    }
  })
  // Per source sheet, so a row whose bank date is in the next month still counts where it was written.
  for (const s of wb.sheets) {
    for (const a of accounts) {
      const want = round2(
        wb.rows.filter((r) => r.sheet === s.name).flatMap((r) => r.legs).filter((l) => l.account === a.source).reduce((t, l) => t + l.amount, 0),
      )
      const got = round2(rows.filter((r) => r.accountId === a.key && byRefSheet(ref.get(r.sourceId)) === `${s.ym.slice(0, 4)}:${s.name}`).reduce((t, r) => t + r.delta, 0))
      if (want !== got) problems.push(`${s.name}, ${a.name}: the rows add up to ${eurCents(got)}, the sheet's columns to ${eurCents(want)}.`)
    }
  }
  const cassa = round2(wb.rows.reduce((t, r) => t + (r.cashIn ?? 0) - (r.cashOut ?? 0), 0))
  const saldo = round2(accounts.reduce((t, a) => t + a.statementBalance, 0))
  if (cassa !== saldo) problems.push(`The Cassa columns add up to ${eurCents(cassa)}, the Saldo balances to ${eurCents(saldo)}.`)
  // The workbook goes on after its Saldo: the balances would prove nothing about those rows.
  const late = rows.filter((r) => r.day > (accounts.find((a) => a.key === r.accountId)?.statementDay ?? r.day))
  if (late.length > 0) {
    problems.push(`${late.length} ${late.length === 1 ? "row is" : "rows are"} dated after ${dayLabel(wb.saldoDay)}: update the Saldo sheet to today's balance and import again.`)
  }
  return { ok: results.every((r) => r.ok) && problems.length === 0, accounts: results, problems }
}

/** "2026:Luglio!12b" → "2026:Luglio". */
const byRefSheet = (ref: string | undefined) => ref?.split("!")[0]

// ─── Undo Import ────────────────────────────────────────────────────────────

export type UndoStep =
  | { op: "delete_movement" | "delete_loan" | "delete_expense" | "delete_account"; id: string }
  | { op: "clear_invoice"; id: string }

export type ImportedRow = { kind: "cost" | "loan" | "movement"; id: string; description: string; day: string }

/** Changed more than a second after its creation: by the owner, since the import. */
const editedSince = (x: { createdAt: Date; updatedAt: Date }) => x.updatedAt.getTime() - x.createdAt.getTime() > 1000

/**
 * The import writes its invoices and recurring-cost edits right after its records: a change from the first
 * record's creation to this long after the last one is the import's. ponytail: a time window, because
 * invoices carry no importRef; an invoice the owner marks paid into an imported account within it is taken
 * for the import's. An importRef on invoices if that ever bites.
 */
const IMPORT_WINDOW = 10 * 60 * 1000

/**
 * What Undo Import does, from the data alone (so it works after a reload or a
 * half-finished import): delete what the import created, keeping the rows the
 * owner edited since unless `deleteEdited`; clear the account on the invoices it
 * paid (the payment date stays: the workbook proved it); delete the accounts it
 * created once nothing uses them. Rows it replaced are not restored, nor its
 * changes to records it did not create (invoices settled or marked unpaid,
 * recurring costs): the report holds the values from before.
 */
export function planUndo(app: Pick<AppData, "accounts" | "invoices" | "expenses" | "loans" | "movements">, deleteEdited: boolean) {
  const mine = importedRecords(app)
  const edited: ImportedRow[] = [
    ...mine.expenses.filter(editedSince).map((e) => ({ kind: "cost" as const, id: e.id, description: e.description, day: isoDate(e.date) })),
    ...mine.loans.filter(editedSince).map((l) => ({ kind: "loan" as const, id: l.id, description: l.description, day: isoDate(l.date) })),
    ...mine.movements.filter(editedSince).map((m) => ({ kind: "movement" as const, id: m.id, description: m.description, day: isoDate(m.date) })),
  ]
  const kept = new Set(deleteEdited ? [] : edited.map((e) => e.id))
  const movements = mine.movements.filter((m) => !kept.has(m.id))
  const loans = mine.loans.filter((l) => !kept.has(l.id))
  // A supplier invoice a kept payment still points at stays too (BILL_HAS_PAYMENTS).
  const paidDocs = new Set(app.movements.filter((m) => m.expenseId && !movements.includes(m)).map((m) => m.expenseId))
  const expenses = mine.expenses.filter((e) => !kept.has(e.id) && !paidDocs.has(e.id))

  const touched = new Set([
    ...mine.accounts.map((a) => a.id),
    ...[...mine.expenses, ...mine.loans].map((x) => x.accountId),
    ...mine.movements.flatMap((m) => [m.accountId, m.toAccountId]),
  ])
  const created = [...mine.accounts, ...mine.expenses, ...mine.loans, ...mine.movements].map((x) => x.createdAt.getTime())
  const [from, to] = [Math.min(...created), Math.max(...created) + IMPORT_WINDOW]
  const byImport = (at: Date) => at.getTime() >= from && at.getTime() <= to
  // The invoices the import paid into its accounts: one paid by the owner since keeps its account.
  const invoices = app.invoices.filter((i) => i.paidDate && i.paidAccountId && touched.has(i.paidAccountId) && byImport(i.updatedAt))

  const gone = new Set([...movements, ...loans, ...expenses].map((x) => x.id))
  const rest = {
    invoices: app.invoices.filter((i) => !invoices.includes(i)),
    expenses: app.expenses.filter((e) => !gone.has(e.id)),
    loans: app.loans.filter((l) => !gone.has(l.id)),
    movements: app.movements.filter((m) => !gone.has(m.id)),
  }
  const accounts = mine.accounts.filter((a) => !accountInUse(a.id, rest))
  const steps: UndoStep[] = [
    // Payments before the supplier invoices they pay.
    ...[...movements].sort((a, b) => Number(b.kind === "supplier_payment") - Number(a.kind === "supplier_payment")).map((m) => ({ op: "delete_movement" as const, id: m.id })),
    ...loans.map((l) => ({ op: "delete_loan" as const, id: l.id })),
    ...expenses.map((e) => ({ op: "delete_expense" as const, id: e.id })),
    ...invoices.map((i) => ({ op: "clear_invoice" as const, id: i.id })),
    ...accounts.map((a) => ({ op: "delete_account" as const, id: a.id })),
  ]
  return {
    steps,
    edited,
    /** Accounts it created that rows added since still use: they stay. */
    keptAccounts: mine.accounts.filter((a) => !accounts.includes(a)).map((a) => a.name),
    /** The invoices that lose the account, by number. */
    invoiceNumbers: invoices.map((i) => i.number),
    counts: { costs: expenses.length, loans: loans.length, movements: movements.length, invoices: invoices.length, accounts: accounts.length },
    /** What Undo leaves as the import made it: the report has the values from before. */
    stays: {
      createdInvoices: app.invoices.filter((i) => byImport(i.createdAt)).length,
      settled: app.invoices.filter((i) => i.paidAccountId === NON_CASH && byImport(i.updatedAt)).length,
      unpaid: app.invoices.filter((i) => !i.paidDate && byImport(i.updatedAt)).length,
      estimates: app.expenses.filter((e) => e.isRecurring && byImport(e.updatedAt)).length,
    },
  }
}
