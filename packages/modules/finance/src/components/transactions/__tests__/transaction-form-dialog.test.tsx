import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { TransactionFormDialog } from "../transaction-form-dialog"

import type { Account, Transaction } from "../../../types"


vi.mock("../../../host", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: "u1" } }),
}))
vi.mock("../../../hooks/use-category-suggestion", () => ({
  useCategorySuggestion: () => ({ suggestedCategoryId: null, clearSuggestion: () => {} }),
}))
vi.mock("../../../hooks/use-merchant-normalization", () => ({ useMerchantNormalization: () => ({ normalize: (s: string) => s }) }))
vi.mock("../../../hooks/use-transactions", () => ({ useDescriptionSuggestions: () => ({ data: [] }) }))

const at = new Date(2026, 9, 1)
const account = { id: "a1", name: "Main Checking", currency: "EUR", isArchived: false } as Account
const tx: Transaction = {
  id: "t1", userId: "u1", accountId: "a1", type: "expense", amount: 60, currency: "EUR", categoryId: null,
  description: "Lumen Srl market", rawDescription: null, date: at, notes: null, tagIds: [],
  transferToAccountId: null, linkedTransactionId: null, isRecurring: false, splits: [],
  attachments: [], status: "cleared", importHash: null, excludeFromReports: false, createdAt: at, updatedAt: at,
}

function renderDialog(props: Partial<React.ComponentProps<typeof TransactionFormDialog>>) {
  render(
    <TransactionFormDialog open onOpenChange={() => {}} accounts={[account]} categories={[]} onSubmit={() => {}} isPending={false} {...props} />,
  )
}

describe("TransactionFormDialog's Delete", () => {
  it("is in the footer of an edit, and hands over the transaction being edited", () => {
    const onDelete = vi.fn()
    renderDialog({ transaction: tx, onDelete })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(tx)
  })

  it.each([
    ["adding", { transaction: null, onDelete: () => {} }],
    ["the caller cannot delete", { transaction: tx }],
  ])("is not there when %s", (_, props) => {
    renderDialog(props)
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
  })
})

describe("TransactionFormDialog's opening account", () => {
  const savings = { id: "a2", name: "Rainy Day Savings", currency: "EUR", isArchived: false } as Account
  const closed = { id: "a3", name: "Closed Card", currency: "EUR", isArchived: true } as Account
  const opensOn = (defaultAccountId: string | undefined) => {
    renderDialog({ accounts: [account, savings, closed], defaultAccountId })
    return screen.getAllByRole("combobox").map((c) => c.textContent).join("|")
  }

  it("is the first open account without a default", () => {
    expect(opensOn(undefined)).toContain("Main Checking")
  })

  it("is the account whose page it was opened from", () => {
    const text = opensOn("a2")
    expect(text).toContain("Rainy Day Savings")
    expect(text).not.toContain("Main Checking")
  })

  it("is not an archived account, which cannot take a transaction", () => {
    expect(opensOn("a3")).toContain("Main Checking")
  })
})
