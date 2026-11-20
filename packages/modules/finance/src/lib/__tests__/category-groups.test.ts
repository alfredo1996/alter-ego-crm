import { describe, expect, it } from "vitest"

import { categoryGroups, kindCounts } from "../category-groups"

import type { Category, CategoryGroup } from "../../types"

function cat(id: string, name: string, group: CategoryGroup, parentId: string | null = null): Category {
  return { id, userId: null, name, group, icon: "HelpCircle", color: "#000", parentId, isDefault: true, createdAt: new Date(0), updatedAt: new Date(0) }
}

const all = [
  cat("sal", "Salary", "income"),
  cat("job", "Primary Job", "income", "sal"),
  cat("rent", "Rent", "housing"),
  cat("mort", "Mortgage", "housing"),
  cat("gas", "Gas", "transportation"),
  cat("zzz", "Zeta", "other"),
]
const names = (g: ReturnType<typeof categoryGroups>) => g.map((x) => [x.group, x.roots.map((r) => [r.category.name, ...r.children.map((c) => c.name)])])

describe("categoryGroups", () => {
  it("lists the groups in their own order, children under their parent", () => {
    expect(names(categoryGroups(all, {}))).toEqual([
      ["income", [["Salary", "Primary Job"]]],
      ["housing", [["Rent"], ["Mortgage"]]],
      ["transportation", [["Gas"]]],
      ["other", [["Zeta"]]],
    ])
  })

  it("sums the month's spend per group, children included, and counts the rows", () => {
    const spend = new Map([["rent", 950], ["mort", 10], ["job", 5]])
    const g = categoryGroups(all, { spend })
    expect(g.map((x) => [x.group, x.total, x.count])).toEqual([["income", 5, 2], ["housing", 960, 2], ["transportation", 0, 1], ["other", 0, 1]])
  })

  it("keeps the group's month total whatever the search hides", () => {
    const g = categoryGroups(all, { query: "mort", spend: new Map([["rent", 950]]) })
    expect(g.map((x) => [x.group, x.total, x.count])).toEqual([["housing", 950, 1]])
  })

  it("keeps the expense kind to everything but income and the income kind to income", () => {
    expect(categoryGroups(all, { kind: "income" }).map((x) => x.group)).toEqual(["income"])
    expect(categoryGroups(all, { kind: "expenses" }).map((x) => x.group)).toEqual(["housing", "transportation", "other"])
  })

  it("searches by name: a parent that matches keeps its children, a child that matches keeps its parent", () => {
    expect(names(categoryGroups(all, { query: " sal" }))).toEqual([["income", [["Salary", "Primary Job"]]]])
    expect(names(categoryGroups(all, { query: "PRIMARY" }))).toEqual([["income", [["Salary", "Primary Job"]]]])
    expect(names(categoryGroups(all, { query: "rent" }))).toEqual([["housing", [["Rent"]]]])
    expect(categoryGroups(all, { query: "nothing" })).toEqual([])
  })

  it("counts the kinds over every category, whatever the search", () => {
    expect(kindCounts(all)).toEqual({ all: 6, income: 2, expenses: 4 })
  })
})
