import { describe, it, expect } from "vitest"

import { partitionByImportHash } from "../import-dedup"

const h = (row: string, hash: string) => ({ row, hash })

describe("partitionByImportHash", () => {
  it("keeps all rows when nothing matches", () => {
    const { newItems, duplicates } = partitionByImportHash(
      [h("a", "1"), h("b", "2")],
      new Set(),
    )
    expect(newItems.map((i) => i.row)).toEqual(["a", "b"])
    expect(duplicates).toEqual([])
  })

  it("flags rows already imported (hash in existing set)", () => {
    const { newItems, duplicates } = partitionByImportHash(
      [h("a", "1"), h("b", "2")],
      new Set(["2"]),
    )
    expect(newItems.map((i) => i.row)).toEqual(["a"])
    expect(duplicates).toEqual(["b"])
  })

  it("flags in-file duplicates (same hash appears twice) — keeps the first", () => {
    const { newItems, duplicates } = partitionByImportHash(
      [h("a", "1"), h("a-again", "1"), h("c", "3")],
      new Set(),
    )
    expect(newItems.map((i) => i.row)).toEqual(["a", "c"])
    expect(duplicates).toEqual(["a-again"])
  })

  it("surfaces duplicates (does not silently drop) and preserves order", () => {
    const { newItems, duplicates } = partitionByImportHash(
      [h("keep1", "1"), h("dupExisting", "9"), h("keep2", "2"), h("dupInFile", "1")],
      new Set(["9"]),
    )
    expect(newItems.map((i) => i.row)).toEqual(["keep1", "keep2"])
    expect(duplicates).toEqual(["dupExisting", "dupInFile"])
  })
})
