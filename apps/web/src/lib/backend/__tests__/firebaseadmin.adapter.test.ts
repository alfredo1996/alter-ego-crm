/**
 * firebase-admin (server) adapter — emulator integration tests for the API keys and Personal Finance.
 *
 * The admin module is a *partial* adapter (see server-db.ts ServerDb), so it can't
 * run the full describeAdapterContract; its company-side writes are covered by
 * firebaseadmin.crm.test.ts, and finance's runs the package's describeFinanceAdminContract round
 * trip (the transfer, balance and incoming-transfer cases live there) plus the cases below.
 *
 * Runs under the Firebase emulator (see vitest.emulator.ts).
 */
import { describeFinanceAdminContract } from "@alter-ego/finance/contract"
import { afterEach, describe, it, expect } from "vitest"

import * as admin from "@/lib/backend/firebase-admin"
import { getAdminFirestore } from "@/lib/firebase-admin-client"

import { describeMonthlyTotalPaths, type PathsDb } from "./monthly-totals-paths"

const userId = "admin-contract-user"

// FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST come from vitest.emulator.setup.ts.

const userSub = (name: string) => getAdminFirestore().collection("users").doc(userId).collection(name)

const accountsCol = () => userSub("accounts")
const txCol = () => userSub("transactions")

// Seeds a doc directly to set a balance without a transaction.
async function seedAccount(name: string, balance = 0): Promise<string> {
  const ref = await accountsCol().add({
    userId,
    name,
    type: "checking",
    kind: null,
    currency: "USD",
    balance,
    openingBalance: balance,
    icon: null,
    color: null,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return ref.id
}

afterEach(async () => {
  for (const col of [accountsCol(), txCol(), userSub("budgets"), userSub("tags"), userSub("recurring")]) {
    const snap = await col.get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
})

// The finance package's own cases, over the surface the Admin SDK implements.
describeFinanceAdminContract(() => ({ db: admin, userId }))

describe("firebase-admin finance adapter (emulator)", () => {
  // The Admin SDK bypasses the rules, so the #219 close guard has to hold here too.
  it("updateAccount archives only at zero, reopens always, and stores nothing when it refuses", async () => {
    const full = await seedAccount("Still Full", 12.5)
    await expect(admin.updateAccount(userId, full, { isArchived: true })).rejects.toThrow(/not at zero/)
    expect((await admin.getAccount(userId, full))!.isArchived).toBe(false)

    const empty = await seedAccount("Empty", 0)
    expect((await admin.updateAccount(userId, empty, { isArchived: true })).isArchived).toBe(true)
    expect((await admin.getAccount(userId, empty))!.isArchived).toBe(true)
    const reopened = await admin.updateAccount(userId, empty, { isArchived: false })
    expect(reopened).toMatchObject({ isArchived: false, name: "Empty", balance: 0 })
  })

  it("updateAccount archives a floating-point remainder below half a cent (#314)", async () => {
    const id = await seedAccount("Cent Zero", 0.1 + 0.2 - 0.3)
    expect((await admin.updateAccount(userId, id, { isArchived: true })).isArchived).toBe(true)
  })

  it("getLastActivity gives the newest date per account, an incoming transfer counted, null for none", async () => {
    const [a, b, c] = [await seedAccount("A"), await seedAccount("B"), await seedAccount("C")]
    const tx = (accountId: string, date: string, extra: object = {}) =>
      admin.createTransaction(userId, { accountId, type: "expense", amount: 1, currency: "USD", description: "x", date: new Date(date), ...extra })
    await tx(a, "2026-03-01")
    await tx(b, "2026-03-02")
    await tx(a, "2026-03-20", { type: "transfer", transferToAccountId: b })
    await tx(a, "2026-03-25", { transferToAccountId: b }) // stray destination on an expense
    expect(await admin.getLastActivity(userId, [a, b, c])).toEqual({
      [a]: new Date("2026-03-25"),
      [b]: new Date("2026-03-20"),
      [c]: null,
    })
  })

  it("getAccount returns a single account by id (and null when missing)", async () => {
    const a = await seedAccount("Solo", 42)
    expect((await admin.getAccount(userId, a))!.balance).toBe(42)
    expect(await admin.getAccount(userId, "nope")).toBeNull()
  })

  it("getBudgets / getTags / getRecurringTransactions map their collections (#35)", async () => {
    await userSub("budgets").add({
      userId, name: "Groceries", categoryId: null, amount: 300, currency: "USD",
      period: "monthly", rolloverMode: "reset", createdAt: new Date(), updatedAt: new Date(),
    })
    await userSub("tags").add({ userId, name: "work", color: "#f00", createdAt: new Date() })
    await userSub("recurring").add({
      userId, accountId: "acc1", type: "expense", amount: 9.99, currency: "USD",
      categoryId: null, description: "Netflix", notes: null, frequency: "monthly", interval: 1,
      startDate: new Date("2026-01-01"), endDate: null, nextDueDate: new Date("2026-02-01"),
      isActive: true, loanMeta: null, createdAt: new Date(), updatedAt: new Date(),
    })

    const budgets = await admin.getBudgets(userId)
    expect(budgets).toHaveLength(1)
    expect(budgets[0]).toMatchObject({ name: "Groceries", amount: 300, period: "monthly" })

    const tags = await admin.getTags(userId)
    expect(tags).toHaveLength(1)
    expect(tags[0]).toMatchObject({ name: "work", color: "#f00" })

    const recurring = await admin.getRecurringTransactions(userId)
    expect(recurring).toHaveLength(1)
    expect(recurring[0]).toMatchObject({ description: "Netflix", amount: 9.99, interval: 1, isActive: true })
  })
})

// What MCP writes through: the same paths, the same totals.
let totalsUsers = 0
describeMonthlyTotalPaths("firebase-admin", admin as unknown as PathsDb, async () => `admin-totals-${Date.now()}-${++totalsUsers}`)

describe("API keys (#342)", () => {
  const hashOf = async (key: string) => {
    const { hashApiKey } = await import("@/lib/api-auth")
    return hashApiKey(key)
  }
  const keyDocs = () => userSub("api_keys")
  const index = () => getAdminFirestore().collection("api_keys_index")

  afterEach(async () => {
    for (const col of [keyDocs(), index().where("userId", "==", userId)]) {
      const snap = await col.get()
      await Promise.all(snap.docs.map((d) => d.ref.delete()))
    }
  })

  it("a created key validates, is listed, and stops validating once deleted", async () => {
    const { key, id } = await admin.createApiKey(userId)
    const hash = await hashOf(key)
    expect(await admin.validateApiKey(hash)).toBe(userId)
    expect((await keyDocs().doc(id).get()).data()?.keyHash).toBe(hash)

    await admin.deleteApiKey(userId, id)
    expect(await admin.validateApiKey(hash)).toBeNull()
    expect((await keyDocs().doc(id).get()).exists).toBe(false)
    expect((await index().doc(hash).get()).exists).toBe(false)
  })

  it("an index entry with no visible key document validates as null", async () => {
    await index().doc("orphan-hash").set({ userId, keyHash: "orphan-hash", apiKeyDocId: "ghost" })
    expect(await admin.validateApiKey("orphan-hash")).toBeNull()
  })

  it("an index entry whose visible document holds another hash validates as null", async () => {
    await keyDocs().doc("k1").set({ userId, keyHash: "other", prefix: "ak_x..." })
    await index().doc("forged").set({ userId, keyHash: "forged", apiKeyDocId: "k1" })
    expect(await admin.validateApiKey("forged")).toBeNull()
  })

  it("deleting another user's key id removes nothing", async () => {
    const { key, id } = await admin.createApiKey(userId)
    await admin.deleteApiKey("someone-else", id)
    expect(await admin.validateApiKey(await hashOf(key))).toBe(userId)
  })

  it("a key indexed under a random id (made before #342) still validates, and delete removes its index row", async () => {
    const { key } = await admin.createApiKey(userId)
    const hash = await hashOf(key)
    const visibleId = (await keyDocs().get()).docs[0]!.id
    // Re-key the index row the way the old client did: random id.
    await index().doc(hash).delete()
    await index().doc("legacy-random-id").set({ userId, keyHash: hash, apiKeyDocId: visibleId })

    expect(await admin.validateApiKey(hash)).toBe(userId)
    await admin.deleteApiKey(userId, visibleId)
    expect(await admin.validateApiKey(hash)).toBeNull()
    expect((await index().doc("legacy-random-id").get()).exists).toBe(false)
  })
})
