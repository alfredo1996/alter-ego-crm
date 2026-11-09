/**
 * firebase-admin (server) adapter — emulator integration tests for the API keys.
 *
 * The admin module is a *partial* adapter (see server-db.ts ServerDb), so it can't
 * run the full describeAdapterContract; its company-side writes are covered by
 * firebaseadmin.crm.test.ts.
 *
 * Runs under the Firebase emulator (see vitest.emulator.ts).
 */
import { afterEach, describe, it, expect } from "vitest"

import * as admin from "@/lib/backend/firebase-admin"
import { getAdminFirestore } from "@/lib/firebase-admin-client"

const userId = "admin-contract-user"

// FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST come from vitest.emulator.setup.ts.

const userSub = (name: string) => getAdminFirestore().collection("users").doc(userId).collection(name)

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
