import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SplitEditor } from "../split-editor"

import type { Category, TransactionSplit } from "../../../types"

const at = new Date(2026, 9, 1)
const categories: Category[] = [
  { id: "id-food", userId: null, name: "Groceries", group: "food", icon: "ShoppingCart", color: "#64748b", parentId: null, isDefault: true, createdAt: at, updatedAt: at },
]

function split(id: string, amount: number): TransactionSplit {
  return { id, categoryId: "id-food", amount }
}

function renderEditor(splits: TransactionSplit[]) {
  const onChange = vi.fn()
  render(<SplitEditor splits={splits} totalAmount={100} onChange={onChange} categories={categories} />)
  return onChange
}

describe("SplitEditor", () => {
  it("names each remove button by its row", () => {
    renderEditor([split("s1", 40), split("s2", 60)])
    expect(screen.getByRole("button", { name: "Remove split 1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Remove split 2" })).toBeInTheDocument()
  })

  it("removes the row whose button was clicked", () => {
    const onChange = renderEditor([split("s1", 40), split("s2", 60)])
    fireEvent.click(screen.getByRole("button", { name: "Remove split 2" }))
    expect(onChange).toHaveBeenCalledWith([split("s1", 40)])
  })
})
