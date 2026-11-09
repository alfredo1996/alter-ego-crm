import { isoDate } from "@alter-ego/kernel/dates"
import { strToU8 } from "fflate"

import { dayLabel, exportCsv, monthEnd, rowTypeLabel } from "@/lib/cash-book"
import { CSV_BOM, escapeCsvValue } from "@/lib/export"
import { filesInPeriod } from "@/lib/invoice-files"
import { zipInvoiceFiles } from "@/lib/invoice-files-zip"

import type { CashRow } from "@/lib/cash-book"
import type { CompanyAccount, CompanyExpense, CompanyLoan, CompanyMovement, Invoice, InvoiceFile } from "@/types"

type Data = {
  accounts: CompanyAccount[]
  rows: CashRow[]
  invoices: Invoice[]
  expenses: CompanyExpense[]
  loans: CompanyLoan[]
  movements: CompanyMovement[]
  /** Names for a cost's Paid To; without them it stays blank. */
  collaborators?: { id: string; name: string }[]
}

/** Whole months, "yyyy-MM-dd" both included, and the account (null = all). */
export type PackageSelection = { from: string; to: string; accountId: string | null }

/** The first and last day of quarter `q` (1 to 4) of `year`. */
export function quarterBounds(year: string, q: number): { from: string; to: string } {
  const first = `${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}`
  return { from: `${first}-01`, to: monthEnd(`${year}-${String(q * 3).padStart(2, "0")}`) }
}

/** "2026-10", "2026-Q3" or "2026": the whole months a period spans. */
export function packagePeriod(p: { from: string; to: string }): string {
  const year = p.from.slice(0, 4)
  if (p.from === `${year}-01-01` && p.to === `${year}-12-31`) return year
  const q = Math.floor((Number(p.from.slice(5, 7)) - 1) / 3) + 1
  const bounds = quarterBounds(year, q)
  if (p.from === bounds.from && p.to === bounds.to) return `${year}-Q${q}`
  return p.from.slice(0, 7)
}

export const packageFileName = (p: { from: string; to: string }) => `${packagePeriod(p)}-accountant-package.zip`

const line = (cells: string[]) => cells.join(";")
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const amount = (n: number) => n.toFixed(2).replace(".", ",")

/**
 * Every money-out row of the company accounts in the period, transfers between
 * them left out, with what it pays and whether that document's file is attached.
 * Same style as the prima nota: BOM, ";", decimal comma, formula-safe text.
 */
export function paymentsCsv(data: Data, sel: PackageSelection): { csv: string; payments: number } {
  const name = new Map(data.accounts.map((a) => [a.id, a.name]))
  const cost = new Map(data.expenses.map((e) => [e.id, e]))
  const invoice = new Map(data.invoices.map((i) => [i.id, i]))
  const movement = new Map(data.movements.map((m) => [m.id, m]))
  const paid = data.rows.filter(
    (r) => r.delta < 0 && r.kind !== "transfer" && r.day >= sel.from && r.day <= sel.to && (sel.accountId === null || r.accountId === sel.accountId),
  )
  const who = new Map((data.collaborators ?? []).map((c) => [c.id, c.name]))
  // Where the document's file travels: a cost by its day, an invoice by its month, as filesInPeriod does.
  const where = (day: string, whole: boolean): "this" | "earlier" | "later" => {
    const [a, b, x] = whole ? [sel.from.slice(0, 7), sel.to.slice(0, 7), day.slice(0, 7)] : [sel.from, sel.to, day]
    return x < a ? "earlier" : x > b ? "later" : "this"
  }
  const pays = (r: CashRow): { label: string; file: InvoiceFile | null | undefined; at: "this" | "earlier" | "later" } | null => {
    const ref = (text: string, number: string | null) => (number ? `${text} ${number}` : text)
    if (r.source === "expense") {
      const e = cost.get(r.sourceId)
      return e ? { label: ref("Cost", e.documentRef), file: e.file, at: where(isoDate(e.date), false) } : null
    }
    if (r.source === "invoice") {
      const i = invoice.get(r.sourceId)
      return i ? { label: ref("Credit note", i.number), file: i.file, at: where(i.yearMonth, true) } : null
    }
    const bill = r.source === "movement" && r.kind === "supplier_payment" ? cost.get(movement.get(r.sourceId)?.expenseId ?? "") : undefined
    return bill ? { label: ref("Supplier invoice", bill.documentRef), file: bill.file, at: where(isoDate(bill.date), false) } : null
  }
  const body = paid.map((r) => {
    const doc = pays(r)
    return line([
      dayLabel(r.day),
      escapeCsvValue(name.get(r.accountId) ?? "Unknown account"),
      escapeCsvValue(r.counterparty ?? (r.source === "expense" ? who.get(cost.get(r.sourceId)?.collaboratorId ?? "") : undefined) ?? ""),
      escapeCsvValue(r.description),
      amount(-r.delta),
      r.source === "invoice" ? amount(-r.vat) : r.vat > 0 || r.source === "expense" ? amount(r.vat) : "",
      escapeCsvValue(doc?.label ?? rowTypeLabel(r)),
      doc ? (doc.file ? (doc.at === "this" ? "Yes" : `Yes (${doc.at} period)`) : "Missing") : "No document",
    ])
  })
  const header = line(["Date", "Account", "Paid To", "Description", "Amount", "VAT", "Pays", "File"])
  return { csv: `${CSV_BOM}${[header, ...body].join("\r\n")}\r\n`, payments: paid.length }
}

/** What the dialog's status line counts, without loading a file. */
export function packageSummary(data: Data, sel: PackageSelection, customerOf: (i: Invoice) => string) {
  const docs = filesInPeriod(data, sel, customerOf)
  const bare = docs.filter((d) => !d.file)
  return {
    rows: exportCsv(data, { ...sel, costCentre: null }).rows,
    payments: paymentsCsv(data, sel).payments,
    files: docs.length - bare.length,
    costsWithout: bare.filter((d) => d.kind === "cost").length,
    invoicesWithout: bare.filter((d) => d.kind === "invoice").length,
  }
}

/** The zip: prima nota, payments, `costs/` and `invoices/`. `load` fetches one file's bytes. */
export async function buildPackage(
  data: Data,
  sel: PackageSelection,
  customerOf: (i: Invoice) => string,
  load: (file: InvoiceFile) => Promise<Uint8Array>,
) {
  const period = packagePeriod(sel)
  const nota = exportCsv(data, { ...sel, costCentre: null })
  const pay = paymentsCsv(data, sel)
  const docs = filesInPeriod(data, sel, customerOf)
  const zip = await zipInvoiceFiles(docs, load, {
    [`prima-nota-${period}.csv`]: strToU8(nota.csv),
    [`payments-${period}.csv`]: strToU8(pay.csv),
  })
  return { ...zip, name: packageFileName(sel), rows: nota.rows, payments: pay.payments }
}
