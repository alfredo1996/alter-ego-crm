import { readFileSync } from "node:fs"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InvoiceFileView } from "@/components/company-files/invoice-file-view"
import { rememberOpenedFromApp } from "@/lib/back-navigation"

import type { InvoiceFile } from "@/types"



const stored = vi.hoisted(() => ({ blob: new Blob([]) as Blob }))
const save = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const saveBlob = vi.hoisted(() => vi.fn())
const back = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-company-files", () => ({
  downloadInvoiceFile: async () => stored.blob,
  saveInvoiceFile: save,
  saveBlob,
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ back }) }))

const bytes = (name: string) => readFileSync(`src/lib/__tests__/fixtures/fattura-pa/${name}`)

function show(fixture: string, kind: InvoiceFile["kind"], name = fixture) {
  stored.blob = new Blob([bytes(fixture)])
  const file: InvoiceFile = { path: `users/u/company-files/${name}`, name, kind, size: 1, uploadedAt: new Date("2026-10-01") }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <InvoiceFileView file={file} title="Studio costs" back={{ href: "/costs?open=c1", label: "Open the Cost" }} />
    </QueryClientProvider>,
  )
  return file
}

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  saveBlob.mockClear()
  back.mockClear()
})

describe("InvoiceFileView", () => {
  it("lays out the invoice a signed file holds, with the figures the XML states", async () => {
    const file = show("standard-stream.xml.p7m", "p7m", "IT09999999990_0b7Q2.xml.p7m")
    expect(await screen.findByRole("heading", { level: 1, name: "Invoice 112/2026 · Studio Esempio S.r.l." })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: "Invoice" })).toBeTruthy()
    expect(screen.getByText("TD01 · fattura")).toBeTruthy()
    expect(screen.getByText("30 Sep 2026")).toBeTruthy()
    expect(screen.getByText("VAT IT09999999990")).toBeTruthy()
    expect(screen.getByText("Cliente Prova S.r.l.")).toBeTruthy()
    const lines = screen.getByRole("table", { name: "Lines" })
    expect(within(lines).getAllByRole("row")).toHaveLength(4)
    expect(within(lines).getByText("Consulenza straordinaria")).toBeTruthy()
    expect(within(lines).getByText("Discount 10%")).toBeTruthy()
    const summary = screen.getByRole("table", { name: "VAT summary" })
    expect(within(summary).getAllByRole("row")).toHaveLength(3)
    expect(within(summary).getByText("€204.60")).toBeTruthy()
    expect(screen.getByText("€1,354.60", { selector: "dd" })).toBeTruthy()
    expect(screen.getByText("Bank transfer (MP05) · due 30 Oct 2026 · €1,354.60")).toBeTruthy()
    expect(screen.getByText("IBAN IT00X0000000000000000000000")).toBeTruthy()
    expect(
      screen.getByText(`Read from ${file.name} (FatturaPA FPR12). The signed file is the original; this page is a readable copy, and the signature is not verified.`),
    ).toBeTruthy()
  })

  it("names a credit note by its type and says which file it was read from", async () => {
    show("credit-note.xml", "xml")
    expect(await screen.findByRole("heading", { level: 2, name: "Credit Note" })).toBeTruthy()
    expect(screen.getByText("TD04 · nota di credito")).toBeTruthy()
    expect(screen.getByText("Read from credit-note.xml (FatturaPA FPR12). The XML file is the original; this page is a readable copy.")).toBeTruthy()
  })

  it("shows the stated withholding, stamp duty, pension fund and rounding, and the invoices a credit note corrects, as the file states them", async () => {
    show("stated-rows.xml", "xml")
    const totals = (await screen.findByText("Taxable", { selector: "dt" })).parentElement!
    const rows = [...totals.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent])
    expect(rows).toEqual([
      ["Taxable", "€208.00"],
      ["VAT", "€45.76"],
      ["Pension FundTC22 · 4% · on €200.00", "€8.00"],
      ["Stamp Duty", "€2.00"],
      ["Rounding", "€0.01"],
      ["Total", "€254.00"],
      ["WithholdingRT01 · 20%", "€40.00"],
    ])
    expect(within(screen.getByRole("table", { name: "VAT summary" })).getByRole("columnheader", { name: "Rounding" })).toBeTruthy()
    expect(screen.getByText("Corrects")).toBeTruthy()
    expect(screen.getByText("Invoice 112/2026 of 30 Sep 2026")).toBeTruthy()
    expect(screen.getByText("Invoice 113/2026")).toBeTruthy()
    expect(screen.getByText("Storno parziale")).toBeTruthy()
  })

  it("lists attachments with their size and saves one under a safe name, decoded, without rendering it", async () => {
    show("stated-rows.xml", "xml")
    expect(await screen.findByText("../nota:1.txt")).toBeTruthy()
    expect(screen.getByText(/TXT · 1 KB/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Download ../nota:1.txt" }))
    expect(saveBlob).toHaveBeenCalledTimes(1)
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string]
    expect(name).toBe("nota_1.txt")
    expect(await blob.text()).toBe("hello attachment")
    expect(document.querySelector("iframe, embed, object, a[href^='data:']")).toBeNull()
  })

  it("labels a total the file does not state as derived from the stated amounts", async () => {
    show("reverse-charge.xml", "xml")
    expect(await screen.findByText("Total (from the stated amounts)")).toBeTruthy()
    cleanup()
    show("standard.xml", "xml")
    expect(await screen.findByText("Total", { selector: "dt" })).toBeTruthy()
  })

  it("goes back through the history when the app opened this page, and by its link otherwise", async () => {
    show("standard.xml", "xml")
    await screen.findByRole("heading", { level: 1 })
    fireEvent.click(screen.getByRole("link", { name: "Back" }))
    expect(back).not.toHaveBeenCalled()
    cleanup()

    rememberOpenedFromApp()
    window.history.pushState(null, "", "/costs/c1/file")
    show("standard.xml", "xml")
    await screen.findByRole("heading", { level: 1 })
    fireEvent.click(screen.getByRole("link", { name: "Back" }))
    expect(back).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem("alter-ego:opened-from-app")).toBeNull()
  })

  it("shows N6.3 with the rate", async () => {
    show("reverse-charge.xml", "xml")
    const summary = await screen.findByRole("table", { name: "VAT summary" })
    expect(within(summary).getByText("0% · N6.3")).toBeTruthy()
    expect(within(summary).getByText("Immediately")).toBeTruthy()
  })

  it("shows markup in the file as text and adds no element", async () => {
    show("injection.xml", "xml")
    expect(await screen.findByText("<script>window.__pwned = true</script><b>bold</b>")).toBeTruthy()
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Invoice 1 · <img src=x onerror=alert(1)> Evil S.r.l.")
    expect(document.querySelector("img, script, b")).toBeNull()
  })

  it("prints and downloads the original from the toolbar", async () => {
    const file = show("standard.xml", "xml")
    const print = vi.fn()
    window.print = print
    await screen.findByRole("heading", { level: 1 })
    fireEvent.click(screen.getByRole("button", { name: "Print" }))
    expect(print).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Download Original" }))
    expect(save).toHaveBeenCalledWith(file)
    expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/costs?open=c1")
  })

  it("explains a file with no XML inside, names it, and offers the original and the cost", async () => {
    stored.blob = new Blob(["not a signature"])
    const file: InvoiceFile = { path: "p", name: "IT03456789012_00c9X.xml.p7m", kind: "p7m", size: 1, uploadedAt: new Date() }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InvoiceFileView file={file} title="Studio costs" back={{ href: "/costs?open=c1", label: "Open the Cost" }} />
      </QueryClientProvider>,
    )
    const alert = await screen.findByRole("alert")
    expect(within(alert).getByRole("heading", { name: "This file can't be read as an invoice" })).toBeTruthy()
    expect(alert.textContent).toContain(
      "IT03456789012_00c9X.xml.p7m has no FatturaPA XML inside the signature. The file is kept as you uploaded it: download it to open it elsewhere, or replace it on the cost.",
    )
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Studio costs")
    expect(within(alert).getByRole("link", { name: "Open the Cost" }).getAttribute("href")).toBe("/costs?open=c1")
    fireEvent.click(within(alert).getByRole("button", { name: "Download Original" }))
    expect(save).toHaveBeenCalledWith(file)
  })
})
