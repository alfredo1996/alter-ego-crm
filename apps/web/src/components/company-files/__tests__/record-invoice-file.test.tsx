import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CostInvoiceFile, InvoiceInvoiceFile } from "../record-invoice-file"

import type * as InvoiceFileViewModule from "@/components/company-files/invoice-file-view"

const costs = vi.hoisted(() => ({ result: {} as Record<string, unknown> }))
const invoices = vi.hoisted(() => ({ result: {} as Record<string, unknown> }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/hooks/use-company-expenses", () => ({ useCompanyExpenses: () => costs.result }))
vi.mock("@/hooks/use-invoices", () => ({ useInvoices: () => invoices.result }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }))
// The reader itself is tested on its own: here it only says which file it was given.
vi.mock("@/components/company-files/invoice-file-view", async (orig) => ({
  ...(await orig<typeof InvoiceFileViewModule>()),
  InvoiceFileView: ({ file, back }: { file: { name: string }; back: { href: string } }) => <p>Reading {file.name} · back to {back.href}</p>,
}))

const f = (id: string, name: string, kind: "xml" | "p7m" | "pdf" = "xml") => ({ path: `users/u1/company-files/${id}${kind === "p7m" ? ".xml.p7m" : `.${kind}`}`, name, kind, size: 1, uploadedAt: new Date(0) })
const cost = (files: ReturnType<typeof f>[]) => ({ isPending: false, isError: false, data: [{ id: "c1", description: "October print run", files }] })

describe("the invoice file page of a record", () => {
  it.each([
    ["the cost could not be loaded", { isPending: false, isError: true }, "Cost", "The cost could not be loaded. Go back and try again."],
    ["the cost is not there", { isPending: false, isError: false, data: [] }, "Cost", "This cost was not found. It may have been deleted."],
    ["the cost has no file", { isPending: false, isError: false, data: [{ id: "c1", description: "Hosting", files: [] }] }, "Hosting", "Hosting has no invoice file."],
  ])("says so when %s, under the toolbar's h1", (_, result, title, message) => {
    costs.result = result
    render(<CostInvoiceFile id="c1" />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title)
    expect(screen.getByRole("alert").textContent).toBe(message)
    expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/costs")
  })

  describe("with several files", () => {
    const files = [f("Q3vT", "00118.xml"), f("h8Ys", "00121.xml.p7m", "p7m"), f("Zt5L", "NC009.xml")]

    it("opens the file ?file names", () => {
      costs.result = cost(files)
      render(<CostInvoiceFile id="c1" fileId="h8Ys" />)
      expect(screen.getByText("Reading 00121.xml.p7m · back to /costs?open=c1")).toBeInTheDocument()
    })

    it("with none named opens the first XML or signed XML, as links from before several files did", () => {
      costs.result = cost([f("p1", "scan.pdf", "pdf"), ...files])
      render(<CostInvoiceFile id="c1" />)
      expect(screen.getByText(/^Reading 00118.xml ·/)).toBeInTheDocument()
    })

    it("with none named and only a PDF shows today's no-file notice", () => {
      costs.result = cost([f("p1", "scan.pdf", "pdf")])
      render(<CostInvoiceFile id="c1" />)
      expect(screen.getByRole("alert").textContent).toBe("October print run has no invoice file.")
    })

    it.each([
      ["a cost", () => { costs.result = cost(files); return <CostInvoiceFile id="c1" fileId="gone" /> }, "This file is no longer on the cost. It may have been removed.", "Open the Cost", "/costs?open=c1"],
      ["an invoice", () => { invoices.result = { isPending: false, isError: false, data: [{ id: "i1", number: "14", files }] }; return <InvoiceInvoiceFile id="i1" fileId="gone" /> }, "This file is no longer on the invoice. It may have been removed.", "Open the Invoice", "/invoices?open=i1"],
    ])("a file no longer on %s shows a notice with a way back to the record", (_who, page, message, link, href) => {
      render(page())
      expect(screen.getByRole("alert").textContent).toBe(message)
      expect(screen.getByRole("link", { name: link }).getAttribute("href")).toBe(href)
    })
  })

  it("tells an invoice that is not there from one that failed to load", () => {
    invoices.result = { isPending: false, isError: false, data: [] }
    const { unmount } = render(<InvoiceInvoiceFile id="i1" />)
    expect(screen.getByRole("alert").textContent).toBe("This invoice was not found. It may have been deleted.")
    unmount()
    invoices.result = { isPending: false, isError: true }
    render(<InvoiceInvoiceFile id="i1" />)
    expect(screen.getByRole("alert").textContent).toBe("The invoice could not be loaded. Go back and try again.")
    expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/invoices")
  })
})
