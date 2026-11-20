import { describe, expect, it } from "vitest"

import { mergeCategoryCopies } from "../categories"

import type { Category } from "../../types"

const cat = (id: string, name: string, over: Partial<Category> = {}): Category => ({
  id, userId: null, name, group: "housing", icon: "Home", color: "#000", parentId: null,
  isDefault: true, createdAt: new Date(0), updatedAt: new Date(0), ...over,
})

describe("mergeCategoryCopies", () => {
  it("a copy replaces its built-in once, keeps the id and still counts as a built-in", () => {
    const out = mergeCategoryCopies(
      [cat("rent", "Rent"), cat("gas", "Gas")],
      [cat("rent", "Home", { userId: "u1", isDefault: false })],
    )
    expect(out.map((c) => [c.id, c.name])).toEqual([["rent", "Home"], ["gas", "Gas"]])
    expect(out[0]).toMatchObject({ isDefault: true, userId: "u1" })
  })

  it("appends an own category with an unrelated id unchanged", () => {
    const own = cat("mine", "Mine", { userId: "u1", isDefault: false })
    expect(mergeCategoryCopies([cat("rent", "Rent")], [own])).toEqual([cat("rent", "Rent"), own])
  })
})
