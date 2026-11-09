import { describe, expect, it } from "vitest"

import { checkInvoiceFile, filesInPeriod, formatFileSize, INVOICE_FILE_MAX_BYTES, zipName } from "../invoice-files"

import type { PeriodDocument } from "../invoice-files"
import type { CompanyExpense, Invoice } from "@/types"

describe("filesInPeriod", () => {
  const cost = (o: Record<string, unknown>) =>
    ({ id: "x", description: "Hosting", amount: 10, date: new Date(2026, 8, 2), isRecurring: false, documentRef: null, file: null, ...o }) as unknown as CompanyExpense
  const inv = (o: Record<string, unknown>) => ({ id: "i", number: "13", yearMonth: "2026-09", amount: 100, file: null, ...o }) as unknown as Invoice
  const period = { from: "2026-09-01", to: "2026-09-30" }

  it("lists the period's one-off costs and invoices, never a recurring estimate or another month", () => {
    const docs = filesInPeriod(
      {
        expenses: [
          cost({ id: "a" }),
          cost({ id: "est", isRecurring: true }),
          cost({ id: "aug", date: new Date(2026, 7, 31) }),
          cost({ id: "oct", date: new Date(2026, 9, 1) }),
          cost({ id: "last", date: new Date(2026, 8, 30) }),
        ],
        invoices: [inv({ id: "i1" }), inv({ id: "i0", yearMonth: "2026-08" })],
      },
      period,
      () => "Acme",
    )
    expect(docs.map((d) => [d.kind, d.id])).toEqual([["cost", "a"], ["cost", "last"], ["invoice", "i1"]])
  })

  it("names a cost by date, description and number, an invoice by month, Invoice, number and customer", () => {
    const docs = filesInPeriod(
      { expenses: [cost({ documentRef: "40/26", description: "Studio Verdi" })], invoices: [inv({ number: "14/2026" })] },
      period,
      () => "Acme S.p.A.",
    )
    expect(docs.map(zipName)).toEqual(["2026-09-02 Studio Verdi (40-26)", "2026-09 Invoice 14-2026 (Acme S.p.A)"])
  })
})

describe("zipName", () => {
  const doc = (o: Partial<PeriodDocument>): PeriodDocument => ({ kind: "cost", id: "x", day: "2026-09-02", label: "Hosting", number: null, customer: null, amount: 1, file: null, ...o })

  it.each([
    ["a colon and the other Windows-reserved characters", doc({ label: 'Re: a*b?c"d<e>f|g' }), "2026-09-02 Re- a-b-c-d-e-f-g"],
    ["a control character", doc({ label: "a\u0007b\nc" }), "2026-09-02 a-b-c"],
    ["trailing dots and spaces on each part", doc({ label: "Hosting. . ", number: "26/1.. " }), "2026-09-02 Hosting (26-1)"],
  ])("replaces %s", (_, d, name) => expect(zipName(d)).toBe(name))

  it("keeps a 300-character description and a 100-character number under 200 bytes, cut on a whole character", () => {
    const name = zipName(doc({ label: "é".repeat(300), number: "9".repeat(100) }))
    expect(name).toBe(`2026-09-02 ${"é".repeat(60)} (${"9".repeat(60)})`)
    expect(new TextEncoder().encode(name).length).toBeLessThan(200)
  })

  it("labels a negative invoice a credit note", () => {
    const [d] = filesInPeriod({ expenses: [], invoices: [{ id: "n", number: "NC 2/2026", yearMonth: "2026-09", amount: -50, file: null } as unknown as Invoice] }, { from: "2026-09-01", to: "2026-09-30" }, () => "Acme")
    expect(zipName(d)).toBe("2026-09 Credit note NC 2-2026 (Acme)")
  })
})

describe("checkInvoiceFile", () => {
  it.each([
    ["IT01_00001.xml", "xml"],
    ["IT01_00001.XML", "xml"],
    ["IT01_00001.xml.p7m", "p7m"],
    ["IT01_00001.XML.P7M", "p7m"],
    ["EU-1234.pdf", "pdf"],
  ])("accepts %s as %s", (name, kind) => {
    expect(checkInvoiceFile({ name, size: 1000 })).toEqual({ ok: true, kind })
  })

  it.each(["invoice.docx", "scan.p7m", "xml", "notes.xml.txt", "a.pdf.exe"])("refuses %s as the wrong type", (name) => {
    expect(checkInvoiceFile({ name, size: 1000 })).toEqual({
      ok: false,
      reason: `${name} can't be attached: use the XML, the signed .p7m, or a PDF.`,
    })
  })

  it("accepts exactly 10 MB and refuses one byte more, naming the size", () => {
    expect(checkInvoiceFile({ name: "a.pdf", size: INVOICE_FILE_MAX_BYTES })).toEqual({ ok: true, kind: "pdf" })
    expect(checkInvoiceFile({ name: "scan.pdf", size: 14 * 1024 * 1024 })).toEqual({
      ok: false,
      reason: "scan.pdf is over the 10 MB limit.",
    })
  })

  it("refuses a name over 255 characters in words, and accepts exactly 255", () => {
    const name = (n: number) => "a".repeat(n - 4) + ".pdf"
    expect(checkInvoiceFile({ name: name(255), size: 1000 })).toEqual({ ok: true, kind: "pdf" })
    expect(checkInvoiceFile({ name: name(256), size: 1000 })).toEqual({
      ok: false,
      reason: "The file name is too long: use 255 characters or fewer.",
    })
  })

  it("says over the limit, not a rounded size, for 10.4 MB", () => {
    expect(checkInvoiceFile({ name: "a.pdf", size: Math.round(10.4 * 1024 * 1024) })).toEqual({
      ok: false,
      reason: "a.pdf is over the 10 MB limit.",
    })
  })

  it("formats a size in KB under a megabyte and MB above", () => {
    expect([formatFileSize(14 * 1024), formatFileSize(10), formatFileSize(3 * 1024 * 1024)]).toEqual(["14 KB", "1 KB", "3 MB"])
  })
})
