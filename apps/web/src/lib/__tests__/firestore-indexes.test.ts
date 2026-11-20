/**
 * A module package keeps its own Firestore indexes (finance's are src/firestore.indexes.json); the root
 * firestore.indexes.json is the file this app's firebase.json deploys, so it holds every one of them
 * beside the company's own. A missing index shows here, not as a query that fails with "requires an
 * index" in production. (The registry test checks the same containment for every package.)
 */
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

type Index = { collectionGroup: string; queryScope: string; fields: { fieldPath: string; order: string }[] }

const read = (file: string): Index[] => JSON.parse(readFileSync(file, "utf8")).indexes
const root = read("../../firestore.indexes.json")
const finance = read("../../packages/modules/finance/src/firestore.indexes.json")
const key = (i: Index) => JSON.stringify(i)

describe("firestore indexes", () => {
  it("the root file holds each of finance's 13 indexes", () => {
    expect(finance).toHaveLength(13)
    expect(finance.filter((i) => !root.map(key).includes(key(i))).map(key)).toEqual([])
  })

  it("keeps the company's own index and lists none twice", () => {
    expect(root.filter((i) => i.collectionGroup === "allocations")).toHaveLength(1)
    expect(root).toHaveLength(14)
    expect(new Set(root.map(key)).size).toBe(root.length)
  })
})
