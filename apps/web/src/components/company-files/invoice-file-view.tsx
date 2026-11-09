"use client"

import { PageLoader } from "@alter-ego/ui/page/page-state"
import { Button } from "@alter-ego/ui/ui/button"
import { toast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { useQuery } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import { AlertCircle, ArrowLeft, Download, Printer } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { downloadInvoiceFile, saveBlob, saveInvoiceFile } from "@/hooks/use-company-files"
import { forgetOpenedFromApp, canGoBackInApp } from "@/lib/back-navigation"
import { attachmentBlob, attachmentFileName, DOC_TYPES, InvoiceReadError, readInvoiceBytes, sumStated, type FatturaParty, type FatturaPA } from "@/lib/fattura-pa"
import { formatFileSize } from "@/lib/invoice-files"


import type { InvoiceFile } from "@/types"

const PAYMENT_METHODS: Record<string, string> = {
  MP01: "Cash",
  MP02: "Cheque",
  MP05: "Bank transfer",
  MP08: "Payment card",
  MP12: "RIBA",
  MP19: "SEPA direct debit",
}

const COLLECTABILITY: Record<string, string> = { I: "Immediately", D: "Deferred", S: "Split payment" }

const LABEL = "text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500"
const TH = "py-2 pl-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-600 first:pl-0 first:text-left"
const TD = "border-b border-neutral-200 py-2.5 pl-3 text-right first:pl-0 first:text-left"

function date(iso: string) {
  const d = parseISO(iso)
  return Number.isNaN(d.getTime()) ? iso : format(d, "d MMM yyyy")
}

function moneyFormatter(currency: string) {
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency })
  } catch {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" })
  }
}

/**
 * The bar above a viewer page: Back, the page's h1 and its actions. Back returns to the page the
 * user came from when the app opened this one; otherwise (a bookmark, a new tab) it follows `back`.
 */
export function ViewerToolbar({ heading, back, children }: { heading: string; back: { href: string }; children?: React.ReactNode }) {
  const router = useRouter()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-background px-4 py-2 print:hidden sm:px-6">
      <Link
        href={back.href}
        onClick={(e) => {
          if (!canGoBackInApp()) return
          e.preventDefault()
          forgetOpenedFromApp()
          router.back()
        }}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back
      </Link>
      <h1 className="min-w-0 flex-1 basis-48 truncate text-[15px] font-semibold" title={heading}>
        {heading}
      </h1>
      {children}
    </div>
  )
}

/** The invoice file of a cost or an invoice, read and laid out; or why it cannot be. */
export function InvoiceFileView({
  file,
  title,
  back,
}: {
  file: InvoiceFile
  /** The h1 when the file cannot be read: the cost or the invoice it belongs to. */
  title: string
  /** Back, and "Open the Cost" / "Open the Invoice" on an unreadable file. */
  back: { href: string; label: string }
}) {
  const read = useQuery({
    queryKey: ["invoice-file-view", file.path],
    retry: false,
    queryFn: async (): Promise<FatturaPA> => {
      const blob = await downloadInvoiceFile(file)
      return readInvoiceBytes(new Uint8Array(await blob.arrayBuffer()), file.kind)
    },
  })

  const download = () =>
    saveInvoiceFile(file).catch((err: unknown) =>
      toast({ variant: "destructive", title: `${file.name} could not be downloaded`, description: err instanceof Error ? err.message : "Unknown error" }),
    )

  const downloadAttachment = (a: FatturaPA["attachments"][number]) => {
    try {
      saveBlob(attachmentBlob(a), attachmentFileName(a.name))
    } catch (err) {
      toast({ variant: "destructive", title: `${a.name} could not be downloaded`, description: err instanceof Error ? `The file ${err.message}` : "Unknown error" })
    }
  }

  const downloadButton = (
    <Button type="button" variant="outline" onClick={download}>
      <Download aria-hidden />
      Download Original
    </Button>
  )

  if (read.isPending) return <PageLoader />

  if (read.isError) {
    const reason = read.error instanceof InvoiceReadError ? read.error.message : "could not be opened."
    return (
      <div className="min-h-screen bg-muted">
        <ViewerToolbar heading={title} back={back} />
        <div className="mx-auto max-w-xl p-4 sm:p-6">
          <div role="alert" className="flex flex-col gap-3 rounded-xl border bg-background p-5">
            <div className="flex items-center gap-2.5">
              <AlertCircle aria-hidden className="size-[18px] text-destructive" />
              <h2 className="text-base font-semibold">This file can&apos;t be read as an invoice</h2>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {file.name} {reason} The file is kept as you uploaded it: download it to open it elsewhere, or replace it on the {back.label.split(" ").pop()?.toLowerCase()}.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {downloadButton}
              <Button asChild variant="outline">
                <Link href={back.href}>{back.label}</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const inv = read.data
  const [heading, italian] = DOC_TYPES[inv.docType] ?? ["Document", inv.docType]
  const money = moneyFormatter(inv.currency)
  const amount = (v: string) => (v === "" || Number.isNaN(Number(v)) ? v : money.format(Number(v)))
  const rate = (v: string, natura: string) => [v === "" ? "" : `${Number(v)}%`, natura].filter(Boolean).join(" · ")
  const signed = file.kind === "p7m"
  const percent = (v: string) => (v === "" ? "" : `${Number(v)}%`)
  const stated = (label: string, detail: string, value: string) => ({ label, detail, value: amount(value) })
  const added = [
    ...inv.pensionFunds.map((c) => stated("Pension Fund", [c.type, percent(c.rate), c.taxable && `on ${amount(c.taxable)}`].filter(Boolean).join(" · "), c.amount)),
    ...(inv.stampDuty ? [stated("Stamp Duty", "", inv.stampDuty)] : []),
    ...(inv.rounding ? [stated("Rounding", "", inv.rounding)] : []),
  ]
  const withheld = inv.withholding.map((w) => stated("Withholding", [w.type, percent(w.rate)].filter(Boolean).join(" · "), w.amount))
  const row = (r: { label: string; detail: string; value: string }, i: number, muted = false) => (
    <div key={`${r.label}${i}`} className="contents">
      <dt className="text-neutral-600">
        {r.label}
        {r.detail && <span className="block text-xs text-neutral-500">{r.detail}</span>}
      </dt>
      <dd className={cn("text-right", muted && "text-neutral-600")}>{r.value}</dd>
    </div>
  )

  return (
    <div className="min-h-screen bg-muted print:bg-white">
      <ViewerToolbar heading={`${heading} ${inv.number} · ${inv.supplier.name}`} back={back}>
        <div className="ml-auto flex gap-2">
          {downloadButton}
          <Button type="button" onClick={() => window.print()}>
            <Printer aria-hidden />
            Print
          </Button>
        </div>
      </ViewerToolbar>
      <div className="flex justify-center overflow-x-auto px-0 py-6 sm:px-6 print:p-0">
        <article className="flex min-h-[1123px] w-[794px] max-w-full shrink-0 flex-col gap-9 bg-white p-6 text-[13px] leading-normal text-neutral-900 shadow-lg sm:p-14 print:min-h-0 print:w-full print:p-0 print:shadow-none">
          <header className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-[28px] font-semibold tracking-tight">{heading}</h2>
              <span className="font-mono text-[11.5px] text-neutral-500">
                {inv.docType} · {italian}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-right tabular-nums">
              <dt className="text-neutral-500">Number</dt>
              <dd className="font-semibold">{inv.number}</dd>
              <dt className="text-neutral-500">Date</dt>
              <dd className="font-semibold">{date(inv.date)}</dd>
            </dl>
          </header>

          <div className="grid gap-8 sm:grid-cols-2">
            <Party label="From" party={inv.supplier} />
            <Party label="To" party={inv.customer} />
          </div>

          {inv.relatedInvoices.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className={LABEL}>{inv.docType === "TD04" || inv.docType === "TD08" ? "Corrects" : "Related Invoices"}</span>
              {inv.relatedInvoices.map((r, i) => (
                <span key={i}>{[`Invoice ${r.number}`, r.date && `of ${date(r.date)}`].filter(Boolean).join(" ")}</span>
              ))}
            </div>
          )}

          <table aria-label="Lines" className="w-full border-collapse tabular-nums">
            <thead>
              <tr className="border-b border-neutral-900">
                <th scope="col" className={TH}>Description</th>
                <th scope="col" className={TH}>Qty</th>
                <th scope="col" className={TH}>Unit price</th>
                <th scope="col" className={TH}>VAT</th>
                <th scope="col" className={TH}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i} className="break-inside-avoid">
                  <td className={TD}>
                    {l.description}
                    {l.adjustments.map((a, j) => (
                      <span key={j} className="block text-xs text-neutral-500">
                        {a.kind === "MG" ? "Surcharge" : "Discount"} {a.percent ? `${Number(a.percent)}%` : amount(a.amount)}
                      </span>
                    ))}
                  </td>
                  <td className={TD}>{l.quantity === "" ? "" : `${Number(l.quantity)}${l.unit ? ` ${l.unit}` : ""}`}</td>
                  <td className={TD}>{amount(l.unitPrice)}</td>
                  <td className={TD}>{rate(l.vatRate, l.natura)}</td>
                  <td className={TD}>{amount(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid gap-10 sm:grid-cols-[minmax(0,1fr)_260px] sm:items-start">
            <div className="flex flex-col gap-2">
              <span className={LABEL}>VAT summary</span>
              <table aria-label="VAT summary" className="w-full border-collapse tabular-nums">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs font-medium text-neutral-500">
                    <th scope="col" className="py-1.5 text-left font-medium">Rate</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Taxable</th>
                    <th scope="col" className="py-1.5 text-right font-medium">VAT</th>
                    {inv.summary.some((s) => s.rounding) && <th scope="col" className="py-1.5 text-right font-medium">Rounding</th>}
                    <th scope="col" className="py-1.5 text-right font-medium">Payable</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.summary.map((s, i) => (
                    <tr key={i}>
                      <td className="py-1.5">{rate(s.vatRate, s.natura)}</td>
                      <td className="py-1.5 text-right">{amount(s.taxable)}</td>
                      <td className="py-1.5 text-right">{amount(s.vat)}</td>
                      {inv.summary.some((x) => x.rounding) && <td className="py-1.5 text-right">{amount(s.rounding)}</td>}
                      <td className="py-1.5 text-right">{COLLECTABILITY[s.collectability] ?? s.collectability}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inv.summary.filter((s) => s.reference).map((s, i) => (
                <p key={i} className="text-xs text-neutral-500">{s.reference}</p>
              ))}
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 tabular-nums">
              <dt className="text-neutral-600">Taxable</dt>
              <dd className="text-right">{amount(sumStated(inv.summary.map((s) => s.taxable)))}</dd>
              <dt className="text-neutral-600">VAT</dt>
              <dd className="text-right">{amount(sumStated(inv.summary.map((s) => s.vat)))}</dd>
              {added.map((r, i) => row(r, i))}
              <dt className="border-t border-neutral-900 pt-2.5 text-[15px] font-semibold">{inv.totalStated ? "Total" : "Total (from the stated amounts)"}</dt>
              <dd className="border-t border-neutral-900 pt-2.5 text-right text-[15px] font-semibold">{amount(inv.total)}</dd>
              {withheld.map((r, i) => row(r, i, true))}
            </dl>
          </div>

          {inv.notes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Notes</span>
              {inv.notes.map((n, i) => (
                <span key={i}>{n}</span>
              ))}
            </div>
          )}

          {inv.payments.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Payment</span>
              {inv.payments.map((p, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <span>
                    {[PAYMENT_METHODS[p.method] ? `${PAYMENT_METHODS[p.method]} (${p.method})` : p.method, p.due && `due ${date(p.due)}`, p.amount && amount(p.amount)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {p.iban && <span className="font-mono text-[12.5px]">IBAN {p.iban}</span>}
                </div>
              ))}
            </div>
          )}

          {inv.attachments.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Attachments</span>
              {/* Listed, never shown: an attachment is the sender's file, so it only leaves this page as a download. */}
              <ul className="flex flex-col gap-1.5">
                {inv.attachments.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 break-all">
                      {a.name}
                      <span className="text-neutral-500"> · {[a.format, formatFileSize(a.size)].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Button type="button" variant="outline" size="sm" className="border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100 hover:text-neutral-900 print:hidden" aria-label={`Download ${a.name}`} onClick={() => downloadAttachment(a)}>
                      <Download aria-hidden className="size-4" />
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <footer className="mt-auto border-t border-neutral-200 pt-3.5 text-[11.5px] text-neutral-500">
            Read from {file.name} (FatturaPA {inv.format}).{" "}
            {signed ? "The signed file is the original; this page is a readable copy, and the signature is not verified." : "The XML file is the original; this page is a readable copy."}
            {inv.extraDocuments > 0 && ` The file holds ${inv.extraDocuments} more ${inv.extraDocuments === 1 ? "invoice" : "invoices"}; this is the first.`}
          </footer>
        </article>
      </div>
    </div>
  )
}

function Party({ label, party }: { label: string; party: FatturaParty }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL}>{label}</span>
      <span className="text-sm font-semibold">{party.name}</span>
      {party.address.length > 0 && (
        <span>
          {party.address.map((line, i) => (
            <span key={i} className="block">{line}</span>
          ))}
        </span>
      )}
      {party.vat && <span className="tabular-nums">VAT {party.vat}</span>}
    </div>
  )
}
