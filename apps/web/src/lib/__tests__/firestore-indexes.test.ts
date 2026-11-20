/**
 * The root firestore.indexes.json is the file this app's firebase.json deploys. It holds the company's
 * own index and each module package's (the registry test checks that containment): none is lost, none is listed twice.
 */
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

type Index = { collectionGroup: string; queryScope: string; fields: { fieldPath: string; order: string }[] }

const read = (file: string): Index[] => JSON.parse(readFileSync(file, "utf8")).indexes
const root = read("../../firestore.indexes.json")
const key = (i: Index) => JSON.stringify(i)

describe("firestore indexes", () => {
  it("keeps the company's own index and lists none twice", () => {
    expect(root.filter((i) => i.collectionGroup === "allocations")).toHaveLength(1)
    expect(new Set(root.map(key)).size).toBe(root.length)
  })
})
