import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { rowAmount, TransactionList } from "../transaction-list"

import type { Account, Category, Tag, Transaction } from "../../../types"

const at = (day: number) => new Date(2026, 8, day, 12)
const fmt = (n: number) => `€${n.toFixed(2)}`

function tx(over: Partial<Transaction> & Pick<Transaction, "id" | "description">): Transaction {
  return {
    userId: "u", accountId: "main", type: "expense", amount: 10, currency: "EUR", categoryId: null,
    rawDescription: null, date: at(14), notes: null, tagIds: [], transferToAccountId: null,
    linkedTransactionId: null, isRecurring: false, splits: [], attachments: [], status: "cleared",
    importHash: null, excludeFromReports: false, createdAt: at(1), updatedAt: at(1), ...over,
  }
}

const account = (id: string, name: string) => ({ id, name }) as Account
const accounts = [account("main", "Main Checking"), account("save", "Rainy Day Savings")]
const groceries = { id: "g", name: "Groceries", color: "#eab308" } as Category
const shared = { id: "t1", name: "shared", color: "#000" } as Tag

const rows = [
  tx({ id: "1", description: "Salary", type: "income", amount: 2850, date: at(14), categoryId: "g" }),
  tx({ id: "2", description: "Mercato Verde", amount: 92.45, date: at(13), categoryId: "g", notes: "Weekly shop", tagIds: ["t1"] }),
  tx({ id: "3", description: "Farmacia", amount: 18.7, date: at(13) }),
  tx({ id: "4", description: "Monthly saving", type: "transfer", amount: 400, date: at(12), transferToAccountId: "save" }),
  tx({ id: "5", description: "Fuel", amount: 61, date: at(11), status: "pending" }),
]

function renderList(props: Partial<React.ComponentProps<typeof TransactionList>> = {}) {
  render(
    <TransactionList
      transactions={rows}
      accounts={accounts}
      categories={[groceries]}
      tags={[shared]}
      format={fmt}
      onDelete={() => {}}
      {...props}
    />,
  )
  // Both layouts are in the DOM (CSS picks one): the table is the desktop one.
  return within(screen.getByRole("table", { name: "Transactions" }))
}

describe("rowAmount (the sign on an account's own page)", () => {
  const name = (id: string) => ({ main: "Main Checking", save: "Rainy Day Savings" })[id] ?? "?"
  const out = tx({ id: "o", description: "o", type: "transfer", amount: 400, transferToAccountId: "save" })

  it.each([
    ["an expense is money out of its account", tx({ id: "e", description: "e", amount: 5 }), "main", { amount: -5, kind: "out" }],
    ["income is money into its account", tx({ id: "i", description: "i", type: "income", amount: 7 }), "main", { amount: 7, kind: "in" }],
    ["a transfer reads as leaving its source, towards the destination", out, "main", { amount: -400, kind: "transfer", counterpart: "Rainy Day Savings" }],
    ["the same transfer reads as arriving at its destination, from the source", out, "save", { amount: 400, kind: "transfer", counterpart: "Main Checking" }],
  ] as const)("%s", (_, row, accountId, expected) => {
    expect(rowAmount(row, accountId, name)).toEqual(expected)
  })

  it("without an account, a transfer is unsigned and an expense keeps its magnitude", () => {
    expect(rowAmount(out, undefined, name)).toEqual({ amount: 400, kind: "transfer" })
    expect(rowAmount(tx({ id: "e", description: "e", amount: 5 }), undefined, name)).toEqual({ amount: 5, kind: "out" })
  })
})

describe("TransactionList", () => {
  it("groups by day under a heading, with the day's net only where it adds up more than one line", () => {
    const table = renderList()
    const headings = table.getAllByRole("rowheader").map((h) => h.textContent)
    expect(headings).toEqual(["Mon 14 Sep", "Sun 13 Sep", "Sat 12 Sep", "Fri 11 Sep"].map((d) => expect.stringContaining(d)))
    // 13 Sep: two expenses, net −111.15. The single-line days carry none.
    expect(table.getAllByText(/^Net/)).toHaveLength(1)
    expect(table.getByText(/^Net/)).toHaveTextContent("Net −€111.15")
  })

  it("signs money in green with a plus, money out with a minus, and leaves a transfer unsigned with both accounts", () => {
    const table = renderList()
    expect(table.getByText("+€2850.00")).toHaveClass("text-green-700")
    expect(table.getByText("−€92.45")).not.toHaveClass("text-green-700")
    const transfer = table.getByText("Monthly saving").closest("tr")!
    expect(within(transfer).getByText("€400.00")).toBeInTheDocument()
    expect(transfer).toHaveTextContent("Main Checking")
    expect(transfer).toHaveTextContent("Rainy Day Savings")
    expect(transfer).not.toHaveTextContent("+€400.00")
  })

  it("shows a category chip, an amber Uncategorized one, the tags and the note, and the Pending pill", () => {
    const table = renderList()
    const shop = table.getByText("Mercato Verde").closest("tr")!
    expect(within(shop).getByText("Groceries")).toBeInTheDocument()
    expect(within(shop).getByText("Weekly shop")).toBeInTheDocument()
    expect(within(shop).getByText("shared")).toBeInTheDocument()
    const farmacia = table.getByText("Farmacia").closest("tr")!
    expect(within(farmacia).getByText("Uncategorized").parentElement).toHaveClass("bg-amber-100")
    expect(within(table.getByText("Fuel").closest("tr")!).getByText("Pending")).toBeInTheDocument()
  })

  it("has no Type column and no trash on a row: delete lives in the dialog", () => {
    const table = renderList({ onView: () => {} })
    expect(table.queryByRole("columnheader", { name: "Type" })).toBeNull()
    expect(table.queryByRole("button", { name: "Delete" })).toBeNull()
    expect(table.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Description", "Category", "Account", "Amount"])
  })

  it("opens a row from the keyboard: the description is a button", () => {
    const onView = vi.fn()
    const table = renderList({ onView })
    fireEvent.click(table.getByRole("button", { name: "Mercato Verde" }))
    expect(onView).toHaveBeenCalledOnce()
    expect(onView).toHaveBeenCalledWith(rows[1])
  })

  it("names each checkbox for its row and toggles without opening it", () => {
    const onView = vi.fn()
    const onToggleSelect = vi.fn()
    const table = renderList({ onView, selectedIds: new Set(["2"]), onToggleSelect, onToggleSelectAll: () => {} })
    const box = table.getByRole("checkbox", { name: "Select Mercato Verde, Sun 13 Sep" })
    expect(box).toBeChecked()
    fireEvent.click(table.getByRole("checkbox", { name: "Select Fuel, Fri 11 Sep" }))
    expect(onToggleSelect).toHaveBeenCalledWith("5")
    expect(onView).not.toHaveBeenCalled()
    expect(table.getByRole("checkbox", { name: "Select all on this page" })).toBeInTheDocument()
  })

  it("in an account's page, drops the Account column and puts a transfer's other end under its amount", () => {
    const table = renderList({ accountId: "save" })
    expect(table.queryByRole("columnheader", { name: "Account" })).toBeNull()
    const transfer = table.getByText("Monthly saving").closest("tr")!
    expect(transfer).toHaveTextContent("€400.00")
    expect(transfer).toHaveTextContent("Main Checking")
  })
})
