import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CategoryChip } from "../category-chip"

import type { Category } from "../../../types"

const at = new Date(2026, 9, 1)
const groceries: Category = {
  id: "c1", userId: null, name: "Groceries", group: "food", icon: "ShoppingCart",
  color: "#eab308", parentId: null, isDefault: true, createdAt: at, updatedAt: at,
}

describe("CategoryChip", () => {
  it("shows the name beside a dot in the category's colour, never the icon name", () => {
    const { container } = render(<CategoryChip category={groceries} />)
    expect(container).toHaveTextContent(/^Groceries$/)
    expect(screen.queryByText(/ShoppingCart/)).toBeNull()
    const dot = container.querySelector("[aria-hidden]") as HTMLElement
    expect(dot).toHaveStyle({ backgroundColor: "#eab308" })
  })

  it("says Uncategorized when there is no category", () => {
    const { container } = render(<CategoryChip category={null} />)
    expect(container).toHaveTextContent(/^Uncategorized$/)
  })

  it("plain drops the chip background, for option lists and inline text", () => {
    const { container } = render(<CategoryChip category={groceries} plain />)
    expect(container.firstElementChild).not.toHaveClass("bg-muted")
    expect(container).toHaveTextContent(/^Groceries$/)
  })
})
