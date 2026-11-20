import { describe, expect, it } from "vitest"

import { UNCATEGORIZED, categoryFilterValue, categoryOptions, countFilters, countsAreCheap, withCategoryFilter } from "../transaction-filters"

import type { TransactionFilters } from "../../../types"

describe("the Category filter keeps the URL's two params apart", () => {
  it.each<[TransactionFilters, string | null]>([
    [{}, null],
    [{ categoryId: "c-groc" }, "c-groc"],
    [{ uncategorized: true }, UNCATEGORIZED],
  ])("%j reads as %j", (filters, value) => {
    expect(categoryFilterValue(filters)).toBe(value)
  })

  it.each<[string | null, TransactionFilters]>([
    [UNCATEGORIZED, { uncategorized: true }],
    ["c-groc", { categoryId: "c-groc" }],
    [null, {}],
  ])("picking %j sets %j and clears the other param", (value, expected) => {
    const next = withCategoryFilter({ categoryId: "old", uncategorized: true, search: "x" }, value)
    expect(next.search).toBe("x")
    expect(next.categoryId).toBe(expected.categoryId)
    expect(next.uncategorized).toBe(expected.uncategorized)
  })
})

describe("countFilters is the phone's Filters (n)", () => {
  it("counts what the sheet holds, not the search box or the type tabs", () => {
    expect(countFilters({ search: "rent", type: "expense" })).toBe(0)
  })

  it("counts each of account, category, dates, status, note, tags, min and max once", () => {
    expect(
      countFilters({
        accountId: "a",
        categoryId: "c",
        dateFrom: new Date(2026, 9, 1),
        dateTo: new Date(2026, 9, 2),
        status: "pending",
        hasNote: true,
        tagIds: ["t1", "t2"],
        minAmount: 0,
        maxAmount: 5,
      }),
    ).toBe(8)
    expect(countFilters({ uncategorized: true })).toBe(1)
  })
})

describe("the tab counts stay off the in-memory filters", () => {
  it.each<[TransactionFilters, boolean]>([
    [{}, true],
    [{ accountId: "a", categoryId: "c", dateFrom: new Date(2026, 9, 1), type: "income" }, true],
    [{ search: "a" }, false],
    [{ minAmount: 0 }, false],
    [{ maxAmount: 5 }, false],
    [{ tagIds: ["t"] }, false],
    [{ hasNote: true }, false],
    [{ status: "pending" }, false],
    [{ uncategorized: true }, false],
  ])("%j is cheap: %j", (filters, cheap) => {
    expect(countsAreCheap(filters)).toBe(cheap)
  })
})

describe("categoryOptions", () => {
  it("leads with Uncategorized and drops the default category of the same name", () => {
    const cat = (id: string, name: string) => ({ id, name }) as never
    expect(categoryOptions([cat("2", "Rent"), cat("u", "Uncategorized"), cat("1", "Coffee")])).toEqual([
      { value: UNCATEGORIZED, label: "Uncategorized" },
      { value: "1", label: "Coffee" },
      { value: "2", label: "Rent" },
    ])
  })
})
