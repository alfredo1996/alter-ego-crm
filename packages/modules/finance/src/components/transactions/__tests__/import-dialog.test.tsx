import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { ImportDialog } from "../import-dialog"

import type { Account } from "../../../types"

const createTransaction = vi.fn()
vi.mock("../../../host", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: "u1" } }),
  getBackend: () => ({ db: { createTransaction } }),
}))
vi.mock("../../../hooks/use-categories", () => ({
  useCategories: () => ({ data: [{ id: "cat-food", name: "Eating Out" }] }),
}))
vi.mock("../../../hooks/use-merchant-normalization", () => ({
  useMerchantNormalization: () => ({
    normalize: (s: string) => s,
    rules: [
      { id: "r1", pattern: "COFFEE", isActive: true, categoryId: "cat-food" },
      { id: "r2", pattern: "GHOST", isActive: true, categoryId: "cat-deleted" },
    ],
  }),
}))

const account = { id: "a1", name: "Main Checking", currency: "EUR", isArchived: false } as Account
const CSV = 'Date,Description,Amount\n15/01/2024,COFFEE BAR,"-3,50"\n20/01/2024,GHOST SHOP,"-10,00"\n'

beforeAll(() => {
  // Radix Select needs these in jsdom
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.scrollIntoView = () => {}
})
beforeEach(() => createTransaction.mockReset().mockResolvedValue({ id: "t" }))

function pick(trigger: HTMLElement, option: string | RegExp) {
  fireEvent.keyDown(trigger, { key: "Enter" })
  fireEvent.click(screen.getByRole("option", { name: option }))
}

async function toMapStep() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ImportDialog open onOpenChange={() => {}} accounts={[account]} />
    </QueryClientProvider>,
  )
  pick(screen.getByRole("combobox"), "Main Checking")
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([CSV], "bank.csv", { type: "text/csv" })] } })
  await screen.findByText("2 rows · 3 columns")
  fireEvent.click(screen.getByRole("button", { name: /Next/ }))
  await screen.findByText("Map CSV Columns")
}

describe("ImportDialog, a day-first file with decimal-comma amounts", () => {
  it("previews the right date, amount and category on Auto, and ignores a rule whose category is gone", async () => {
    await toMapStep()
    const rows = screen.getAllByRole("row")
    expect(rows[1]).toHaveTextContent(new Date(2024, 0, 15).toLocaleDateString())
    expect(rows[1]).toHaveTextContent("3.50")
    expect(rows[1]).toHaveTextContent("Eating Out")
    expect(rows[2]).toHaveTextContent("10.00")
    expect(rows[2]).not.toHaveTextContent("Eating Out")
  })

  it("imports 3.50 as an expense dated 15 January with the rule's category, and null for the unknown one", async () => {
    await toMapStep()
    fireEvent.click(screen.getByRole("button", { name: /Next/ }))
    fireEvent.click(await screen.findByRole("button", { name: /Import 2 transactions/ }))
    await waitFor(() => expect(createTransaction).toHaveBeenCalledTimes(2))
    const calls = createTransaction.mock.calls.map(([, tx]) => tx)
    expect(calls[0]).toMatchObject({ amount: 3.5, type: "expense", date: new Date(2024, 0, 15), categoryId: "cat-food" })
    expect(calls[1]).toMatchObject({ amount: 10, type: "expense", date: new Date(2024, 0, 20), categoryId: null })
  })

  it("reads the date as month-first once Month first is chosen, and the label names the control", async () => {
    await toMapStep()
    pick(screen.getByRole("combobox", { name: "Date format" }), /Month first/)
    expect(screen.getAllByText("Invalid")).toHaveLength(2) // neither 15/01 nor 20/01 has a month 15 or 20
    expect(screen.getByRole("combobox", { name: "Decimal separator" })).toBeInTheDocument()
  })
})
