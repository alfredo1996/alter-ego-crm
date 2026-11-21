/**
 * What opening the Dashboard reads — runs against the Firebase Emulator Suite.
 *
 * Own file: one user, signed in once and never signed out (see firebase.freshness.test.ts).
 */
import { createUserWithEmailAndPassword } from "firebase/auth"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { createFirebaseAdapter } from "@/lib/backend/firebase"
import { createMockAdapter } from "@/lib/backend/mock"
import { getFirebaseAuth } from "@/lib/firebase-client"

import type * as FirestoreSdk from "firebase/firestore"

const reads = vi.hoisted(() => ({ transactionDocs: 0, counts: 0 }))
vi.mock("firebase/firestore", async (importOriginal) => {
  const fs = await importOriginal<typeof FirestoreSdk>()
  return {
    ...fs,
    getDocsFromServer: (async (q) => {
      const snap = await fs.getDocsFromServer(q)
      reads.transactionDocs += snap.docs.filter((d) => d.ref.path.includes("/transactions/")).length
      return snap
    }) as typeof fs.getDocsFromServer,
    getCountFromServer: ((q) => (reads.counts++, fs.getCountFromServer(q))) as typeof fs.getCountFromServer,
  }
})

const db = createFirebaseAdapter().db
const mock = createMockAdapter().db
const MOCK_USER = "dash-mock"
let uid: string

// Six rows a month for 24 months, one per distinct day, newest first by construction.
const now = new Date()
const rows = Array.from({ length: 24 * 6 }, (_, i) => {
  const back = Math.floor(i / 6)
  return {
    type: i % 5 === 0 ? ("income" as const) : ("expense" as const),
    amount: 10 + i,
    description: `row ${i}`,
    date: new Date(now.getFullYear(), now.getMonth() - back, 2 + (i % 6) * 4),
  }
})
const windowStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

// Seeding is thousands of emulator writes: 120 s was not enough with several containers up.
beforeAll(async () => {
  uid = (await createUserWithEmailAndPassword(getFirebaseAuth(), `dash-${Date.now()}@example.com`, "Test1234!")).user.uid
  for (const [adapter, id] of [[db, uid], [mock, MOCK_USER]] as const) {
    const acc = await adapter.createAccount(id, { name: "Checking", type: "checking", currency: "USD", balance: 1000 })
    for (const r of rows) await adapter.createTransaction(id, { accountId: acc.id, currency: "USD", ...r })
  }
}, 300_000)

describe("firebase — opening the Dashboard", () => {
  it("reads from the first day of last month, with no count, and shows what the mock shows", async () => {
    reads.transactionDocs = 0
    reads.counts = 0
    const dash = await db.getDashboardData(uid)
    expect(reads.transactionDocs).toBe(rows.filter((r) => r.date >= windowStart).length)
    expect(reads.counts).toBe(0)

    const expected = await mock.getDashboardData(MOCK_USER)
    expect(dash.monthlySummary).toHaveLength(2)
    expect(dash.monthlySummary).toEqual(expected.monthlySummary)
    expect(dash.recentTransactions.map((t) => t.description)).toEqual(expected.recentTransactions.map((t) => t.description))
    for (const k of ["netWorth", "monthlyIncome", "monthlyExpenses", "monthlySavingsRate", "categorySpending"] as const) {
      expect(dash[k]).toEqual(expected[k])
    }
    expect(dash.accounts.map((a) => a.name)).toEqual(["Checking"])
  })

  it("a paged list still counts the whole collection", async () => {
    reads.counts = 0
    expect((await db.getTransactions(uid, { limit: 10 })).total).toBe(rows.length)
    expect(reads.counts).toBe(1)
  })

  it("a quiet two months lists the newest rows on their own, still with no count", async () => {
    const quiet = (await createUserWithEmailAndPassword(getFirebaseAuth(), `quiet-${Date.now()}@example.com`, "Test1234!")).user.uid
    const acc = await db.createAccount(quiet, { name: "Checking", type: "checking", currency: "USD", balance: 0 })
    await db.createTransaction(quiet, {
      accountId: acc.id, type: "expense", amount: 7, currency: "USD", description: "old row",
      date: new Date(now.getFullYear(), now.getMonth() - 6, 3),
    })
    reads.counts = 0
    const dash = await db.getDashboardData(quiet)
    expect(dash.recentTransactions.map((t) => t.description)).toEqual(["old row"])
    expect(reads.counts).toBe(0)
  })
})
