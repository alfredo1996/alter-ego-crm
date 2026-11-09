import { isoDate } from "@alter-ego/kernel/dates"

import type { CompanyExpense, Invoice, InvoiceFile, InvoiceFileKind } from "@/types"

/** Storage and the UI both enforce it (storage.rules holds the same figure). */
export const INVOICE_FILE_MAX_BYTES = 10 * 1024 * 1024

/** The longest file name the record accepts (schemas.ts and the rules hold the same figure). */
export const INVOICE_FILE_NAME_MAX = 255

export const INVOICE_FILE_CONTENT_TYPE: Record<InvoiceFileKind, string> = {
  xml: "application/xml",
  p7m: "application/pkcs7-mime",
  pdf: "application/pdf",
}

export const INVOICE_FILE_KIND_LABEL: Record<InvoiceFileKind, string> = {
  xml: "FatturaPA XML",
  p7m: "Signed FatturaPA XML",
  pdf: "PDF",
}

/** The kind a file name stands for, or null when it is none of the three. `.xml.p7m` is the signed XML. */
export function invoiceFileKind(name: string): InvoiceFileKind | null {
  const n = name.toLowerCase()
  if (n.endsWith(".xml.p7m")) return "p7m"
  if (n.endsWith(".xml")) return "xml"
  if (n.endsWith(".pdf")) return "pdf"
  return null
}

/** What a stored file is saved as: the signed XML keeps its double extension. */
export const INVOICE_FILE_EXTENSION: Record<InvoiceFileKind, string> = { xml: ".xml", p7m: ".xml.p7m", pdf: ".pdf" }

/** One cost or invoice of a period, with the file it keeps (null = none). */
export interface PeriodDocument {
  kind: "cost" | "invoice"
  id: string
  /** A cost's day "yyyy-MM-dd"; an invoice's month "yyyy-MM". */
  day: string
  /** A cost's description; an invoice's "Invoice N" ("Credit note N" below zero). */
  label: string
  /** The supplier's document number, or the invoice's. */
  number: string | null
  /** An invoice's customer. */
  customer: string | null
  amount: number
  file: InvoiceFile | null
}

/**
 * The one-off costs dated in `from`..`to` ("yyyy-MM-dd") and the invoices whose
 * month falls in it. A recurring estimate is not a document and is left out.
 * Month End's Invoice Files step and the files zip both read this.
 */
export function filesInPeriod(
  data: { expenses: CompanyExpense[]; invoices: Invoice[] },
  period: { from: string; to: string },
  customerOf: (invoice: Invoice) => string,
): PeriodDocument[] {
  const costs = data.expenses
    .filter((e) => !e.isRecurring && isoDate(e.date) >= period.from && isoDate(e.date) <= period.to)
    .map((e): PeriodDocument => ({
      kind: "cost", id: e.id, day: isoDate(e.date), label: e.description, number: e.documentRef, customer: null, amount: e.amount, file: e.file ?? null,
    }))
    .sort((a, b) => a.day.localeCompare(b.day))
  const invoices = data.invoices
    .filter((i) => i.yearMonth >= period.from.slice(0, 7) && i.yearMonth <= period.to.slice(0, 7))
    .map((i): PeriodDocument => ({
      kind: "invoice", id: i.id, day: i.yearMonth, label: `${i.amount < 0 ? "Credit note" : "Invoice"} ${i.number}`, number: i.number, customer: customerOf(i), amount: i.amount, file: i.file ?? null,
    }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.label.localeCompare(b.label))
  return [...costs, ...invoices]
}

/** `text` made safe as part of a file name on every OS, cut to `maxBytes` of UTF-8 (never mid-character). */
function fileNamePart(text: string, maxBytes: number): string {
  let out = text.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
  const enc = new TextEncoder()
  while (enc.encode(out).length > maxBytes) out = Array.from(out).slice(0, -1).join("")
  return out.replace(/[. ]+$/, "") // Windows drops a trailing dot or space.
}

/**
 * A zip entry's name without its extension. A slash would make a folder and
 * Windows refuses `: * ? " < > |`, so each becomes a dash; the description and the
 * number are cut so the whole name stays near 200 bytes, under every OS's 255.
 */
export function zipName(doc: PeriodDocument): string {
  const note = doc.kind === "cost" ? doc.number : doc.customer
  return `${doc.day} ${fileNamePart(doc.label, 120)}${note ? ` (${fileNamePart(note, 60)})` : ""}`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

export type InvoiceFileCheck = { ok: true; kind: InvoiceFileKind } | { ok: false; reason: string }

/** Why a picked file is refused, in the words the slot shows under it. */
export function checkInvoiceFile(file: { name: string; size: number }): InvoiceFileCheck {
  const kind = invoiceFileKind(file.name)
  if (!kind) return { ok: false, reason: `${file.name} can't be attached: use the XML, the signed .p7m, or a PDF.` }
  if (file.name.length > INVOICE_FILE_NAME_MAX) return { ok: false, reason: `The file name is too long: use ${INVOICE_FILE_NAME_MAX} characters or fewer.` }
  if (file.size > INVOICE_FILE_MAX_BYTES) return { ok: false, reason: `${file.name} is over the 10 MB limit.` }
  return { ok: true, kind }
}
