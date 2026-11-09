/**
 * Which reads may come from Firestore's cache — runs against the Firebase Emulator Suite.
 *
 * Its own file, with one user signed in before any read and never signed out:
 * switching the signed-in user (sign-in or sign-out) while a listen stream is still
 * delivering trips a Firestore SDK assertion
 * (4.12.0, "handleTargetChange" of undefined) that poisons the shared instance for
 * every test after it.
 */
import { createUserWithEmailAndPassword, type User } from "firebase/auth"
import { disableNetwork, enableNetwork } from "firebase/firestore"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { createFirebaseAdapter } from "@/lib/backend/firebase"
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase-client"

import type * as FirestoreSdk from "firebase/firestore"

// Records which read each doc path went through; otherwise the real SDK.
const reads = vi.hoisted(() => ({ anySource: [] as string[], server: [] as string[] }))
vi.mock("firebase/firestore", async (importOriginal) => {
  const fs = await importOriginal<typeof FirestoreSdk>()
  return {
    ...fs,
    getDoc: ((ref) => (reads.anySource.push(ref.path), fs.getDoc(ref))) as typeof fs.getDoc,
    getDocFromServer: ((ref) => (reads.server.push(ref.path), fs.getDocFromServer(ref))) as typeof fs.getDocFromServer,
  }
})

const db = createFirebaseAdapter().db
let user: User

beforeAll(async () => {
  user = (await createUserWithEmailAndPassword(getFirebaseAuth(), `freshness-${Date.now()}@example.com`, "Test1234!")).user
})

// No afterAll deleting the user: that is a sign-out, the same credential change,
// and it tripped the assertion in CI after both tests had passed. The global
// setup wipes emulator data at the start of every run, and each file runs in its
// own worker, so nothing leaks.

// The adapter re-reads each doc it writes. A server-only re-read failed whenever
// the connection dropped after the write committed: a saved expense or contract
// was reported as failed, and saving again created it twice. The re-read may come
// from the cache, which holds the committed doc; every other read stays server-only.
describe("firebase — reading back a write", () => {
  it("re-reads the doc it just wrote from any source, and reads everything else from the server", async () => {
    const reset = () => { reads.anySource.length = 0; reads.server.length = 0 }
    reset()
    const client = await db.createClient(user.uid, { name: "Acme" })
    const path = `users/${user.uid}/clients/${client.id}`
    expect(reads.anySource).toContain(path)
    expect(reads.server).not.toContain(path)

    reset()
    expect(await db.updateClient(user.uid, client.id, { name: "Acme SRL" })).toMatchObject({ name: "Acme SRL" })
    expect(reads.anySource).toContain(path)
    expect(reads.server).not.toContain(path)

    reset()
    await db.getCompanySettings(user.uid)
    expect(reads.anySource).toEqual([])
    expect(reads.server).toHaveLength(1)
  })
})

// A reopened tab whose Firestore connection had lapsed got its reads answered from
// the SDK's memory cache (this session's docs, or [] for a query never fetched) as
// if fresh, and TanStack held them for a minute. Offline, a read must reject, so the query stays stale and retries.
// Last in the file: it cuts the network.
describe("firebase — reads while offline", () => {
  it("rejects with 'unavailable' instead of answering from the cache, and reads again once online", async () => {
    const accountId = (await db.createCompanyAccount(user.uid, { name: "Offline", openingBalance: 10, openingDate: new Date("2026-01-01") })).id
    // Fill the SDK cache: these are exactly what the old reads served back offline.
    await Promise.all([db.getCompanyAccounts(user.uid), db.getCompanySettings(user.uid), db.getClients(user.uid)])

    await disableNetwork(getFirebaseDb())
    try {
      for (const read of [
        () => db.getCompanyAccounts(user.uid),
        () => db.getCompanySettings(user.uid),
        () => db.getClients(user.uid),
      ]) {
        await expect(read()).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/^Can.t reach the server/) })
      }
    } finally {
      await enableNetwork(getFirebaseDb())
    }
    expect((await db.getCompanyAccounts(user.uid)).map((a) => a.id)).toEqual([accountId])
  })
})
