/**
 * The web adapter's invoice-file edges the shared contract cannot reach —
 * emulator integration tests (vitest.emulator.ts).
 */
import { createUserWithEmailAndPassword } from "firebase/auth"
import { deleteObject } from "firebase/storage"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { createFirebaseAdapter } from "@/lib/backend/firebase"
import { getFirebaseAuth } from "@/lib/firebase-client"

import type * as FirebaseStorage from "firebase/storage"

// Passes through; one test makes the object delete fail.
vi.mock("firebase/storage", async (orig) => {
  const actual = await orig<typeof FirebaseStorage>()
  return { ...actual, deleteObject: vi.fn(actual.deleteObject) }
})

const adapter = createFirebaseAdapter()
let userId: string

beforeAll(async () => {
  const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), `files-${Date.now()}@example.com`, "Test1234!")
  userId = user.uid
})

afterEach(() => vi.unstubAllGlobals())

describe("invoice files on the web adapter", () => {
  it("a failed object delete does not undo the cost delete: one unreferenced object is left", async () => {
    const file = await adapter.files.upload(userId, new Blob(["<a/>"]), "stuck.xml")
    const cost = await adapter.db.createCompanyExpense(userId, { description: "Stuck", category: "other", amount: 10, date: new Date(), file })
    vi.mocked(deleteObject).mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "storage/retry-limit-exceeded" }))
    await expect(adapter.db.deleteCompanyExpense(userId, cost.id)).resolves.toBeUndefined()
    expect((await adapter.db.getCompanyExpenses(userId)).find((e) => e.id === cost.id)).toBeUndefined()
    await adapter.files.remove(file.path)
  })

  it("uploads outside a secure context, where crypto.randomUUID does not exist", async () => {
    vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: undefined })
    const file = await adapter.files.upload(userId, new Blob(["<a/>"]), "lan.xml")
    expect(file.path).toMatch(new RegExp(`^users/${userId}/company-files/[A-Za-z0-9]{20}\\.xml$`))
    await adapter.files.remove(file.path)
  })
})
