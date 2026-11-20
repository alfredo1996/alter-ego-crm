import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CategoryCombobox } from "../category-combobox"

import type { Category } from "../../../types"

const at = new Date(2026, 9, 1)
const cat = (id: string, name: string, group: Category["group"], icon: string): Category => ({
  id, userId: null, name, group, icon, color: "#64748b", parentId: null, isDefault: true, createdAt: at, updatedAt: at,
})
const categories = [
  cat("id-h7k2", "Housing", "housing", "Home"),
  cat("id-g3p9", "Groceries", "food", "ShoppingCart"),
  cat("id-c1", "Coffee", "food", "Coffee"),
  cat("id-c2", "Coffee", "personal", "Coffee"),
]

function open(value?: string) {
  const onChange = vi.fn()
  render(<CategoryCombobox categories={categories} value={value} onChange={onChange} />)
  fireEvent.click(screen.getByRole("combobox"))
  return onChange
}
const search = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText("Search categories..."), { target: { value: text } })

describe("CategoryCombobox", () => {
  it("finds a category by its name", () => {
    open()
    search("groc")
    expect(screen.getByRole("option", { name: "Groceries" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Housing" })).toBeNull()
  })

  it("does not match the icon name or the id", () => {
    open()
    search("ShoppingCart")
    expect(screen.getByText("No category found.")).toBeInTheDocument()
    search("h7k2")
    expect(screen.getByText("No category found.")).toBeInTheDocument()
  })

  it("keeps two categories with the same name apart", () => {
    const onChange = open()
    const coffees = screen.getAllByRole("option", { name: "Coffee" })
    expect(coffees).toHaveLength(2)
    fireEvent.click(coffees[1])
    expect(onChange).toHaveBeenCalledWith("id-c2")
  })

  it("picks the second same-name category from the keyboard", () => {
    // A click always runs the clicked item's own onSelect; only the keyboard shows an item value collision.
    const onChange = open()
    search("coffee")
    const input = screen.getByPlaceholderText("Search categories...")
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("id-c2")
  })

  it("shows the selected category's name, not its icon name", () => {
    render(<CategoryCombobox categories={categories} value="id-h7k2" onChange={() => {}} />)
    expect(screen.getByRole("combobox")).toHaveTextContent(/^Housing$/)
  })
})
