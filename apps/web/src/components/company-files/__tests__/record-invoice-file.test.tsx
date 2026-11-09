import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CostInvoiceFile, InvoiceInvoiceFile } from "../record-invoice-file"

const costs = vi.hoisted(() => ({ result: {} as Record<string, unknown> }))
const invoices = vi.hoisted(() => ({ result: {} as Record<string, unknown> }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/hooks/use-company-expenses", () => ({ useCompanyExpenses: () => costs.result }))
vi.mock("@/hooks/use-invoices", () => ({ useInvoices: () => invoices.result }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }))

describe("the invoice file page of a record", () => {
  it.each([
    ["the cost could not be loaded", { isPending: false, isError: true }, "Cost", "The cost could not be loaded. Go back and try again."],
    ["the cost is not there", { isPending: false, isError: false, data: [] }, "Cost", "This cost was not found. It may have been deleted."],
    ["the cost has no file", { isPending: false, isError: false, data: [{ id: "c1", description: "Hosting" }] }, "Hosting", "Hosting has no invoice file."],
  ])("says so when %s, under the toolbar's h1", (_, result, title, message) => {
    costs.result = result
    render(<CostInvoiceFile id="c1" />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title)
    expect(screen.getByRole("alert").textContent).toBe(message)
    expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/costs")
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
