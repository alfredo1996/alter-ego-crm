/**
 * What opening Budgets reads, and the monthly totals behind it — runs against the
 * Firebase Emulator Suite.
 *
 * Own file: the users are signed in and never signed out (see firebase.freshness.test.ts).
 */
import { budgetsWindowStart, budgetsWithSpending, loadBudgetsWithSpending } from "@alter-ego/finance/lib/budgets"
import { createUserWithEmailAndPassword } from "firebase/auth"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { createFirebaseAdapter } from "@/lib/backend/firebase"
import { getAdminFirestore } from "@/lib/firebase-admin-client"
import { getFirebaseAuth } from "@/lib/firebase-client"

import { describeMonthlyTotalPaths } from "./monthly-totals-paths"

import type * as FirestoreSdk from "firebase/firestore"

const reads = vi.hoisted(() => ({
  docs: {} as Record<string, number>,
  /** Runs after a transactions query returned, before the caller sees it. */
  afterTransactionsRead: null as null | (() => Promise<void>),
}))
const countReads = () => {
  reads.docs = {}
}
vi.mock("firebase/firestore", async (importOriginal) => {
  const fs = await importOriginal<typeof FirestoreSdk>()
  return {
    ...fs,
    getDocsFromServer: (async (q) => {
      const snap = await fs.getDocsFromServer(q)
      for (const d of snap.docs) {
        const kind = d.ref.parent.id
        reads.docs[kind] = (reads.docs[kind] ?? 0) + 1
      }
      if (snap.docs.length && snap.docs[0].ref.parent.id === "transactions" && reads.afterTransactionsRead) {
        const hook = reads.afterTransactionsRead
        reads.afterTransactionsRead = null
        await hook()
      }
      return snap
    }) as typeof fs.getDocsFromServer,
  }
})

const db = createFirebaseAdapter().db
const admin = () => getAdminFirestore()
const signUp = async (prefix: string) =>
  (await createUserWithEmailAndPassword(getFirebaseAuth(), `${prefix}-${Date.now()}-${Math.random()}@example.com`, "Test1234!")).user.uid

describeMonthlyTotalPaths("firebase", db, () => signUp("totals"))

const totalsDoc = (uid: string, month: string) => admin().doc(`users/${uid}/monthly_totals/${month}`)
const seedExpense = (uid: string, amount: number, date: Date, categoryId = "food") =>
  admin().collection(`users/${uid}/transactions`).add({
    userId: uid, accountId: "a", type: "expense", amount, currency: "USD", categoryId, description: "x",
    rawDescription: null, date, notes: null, tagIds: [], splits: [], attachments: [], status: "cleared",
    isRecurring: false, importHash: null, excludeFromReports: false, transferToAccountId: null,
    linkedTransactionId: null, createdAt: new Date(), updatedAt: new Date(),
  })

describe("firebase — the lazy fill", () => {
  it("computes a month that has no document once, stores it, and never reads its transactions again", async () => {
    const uid = await signUp("fill")
    await seedExpense(uid, 40, new Date(2026, 0, 5))
    await seedExpense(uid, 60, new Date(2026, 0, 28), "fun")
    await seedExpense(uid, 7, new Date(2026, 1, 1)) // the next month: not in January

    countReads()
    expect(await db.getMonthlyTotals(uid, "2026-01", "2026-01")).toEqual({
      "2026-01": { total: 100, expenseByCategory: { food: 40, fun: 60 } },
    })
    expect(reads.docs.transactions).toBe(2)
    expect((await totalsDoc(uid, "2026-01").get()).data()).toEqual({
      total: 100, expenseByCategory: { food: 40, fun: 60 }, n: 0, ready: true,
    })

    countReads()
    expect((await db.getMonthlyTotals(uid, "2026-01", "2026-01"))["2026-01"].total).toBe(100)
    expect(reads.docs.transactions).toBeUndefined()
    expect(reads.docs.monthly_totals).toBe(1)
  })

  it("fills a month with no transactions with zeros, once", async () => {
    const uid = await signUp("empty")
    expect(await db.getMonthlyTotals(uid, "2026-04", "2026-04")).toEqual({ "2026-04": { total: 0, expenseByCategory: {} } })
    expect((await totalsDoc(uid, "2026-04").get()).data()).toMatchObject({ ready: true })
  })

  it("completes a month a write reached before anyone read it", async () => {
    const uid = await signUp("partial")
    await seedExpense(uid, 40, new Date(2026, 2, 5))
    // what a create does to a month that was never stored: a partial document, not ready
    await totalsDoc(uid, "2026-03").set({ total: 25, expenseByCategory: { food: 25 }, n: 1 })
    await seedExpense(uid, 25, new Date(2026, 2, 6))
    expect((await db.getMonthlyTotals(uid, "2026-03", "2026-03"))["2026-03"]).toEqual({ total: 65, expenseByCategory: { food: 65 } })
    expect((await totalsDoc(uid, "2026-03").get()).data()).toMatchObject({ ready: true, n: 1 })
  })

  it("does not lose a write that lands while it computes", async () => {
    const uid = await signUp("race")
    await seedExpense(uid, 40, new Date(2026, 4, 5))
    reads.afterTransactionsRead = async () => {
      // a writer commits the way the adapters do: the row and its increments in one batch
      const batch = admin().batch()
      batch.set(admin().collection(`users/${uid}/transactions`).doc(), {
        userId: uid, accountId: "a", type: "expense", amount: 11, currency: "USD", categoryId: "food", description: "late",
        date: new Date(2026, 4, 9), tagIds: [], splits: [], isRecurring: false, excludeFromReports: false,
      })
      batch.set(totalsDoc(uid, "2026-05"), { total: 11, expenseByCategory: { food: 11 }, n: 1 }, { merge: true })
      await batch.commit()
    }
    expect((await db.getMonthlyTotals(uid, "2026-05", "2026-05"))["2026-05"].total).toBe(51)
    expect((await totalsDoc(uid, "2026-05").get()).data()).toMatchObject({ total: 51, ready: true })
  })
})

describe("firebase — opening Budgets", () => {
  // The #272 dataset: 3,000 transactions over 24 months, 5 monthly budgets, 2 with full rollover.
  let uid = ""
  const now = new Date()
  const months = 24
  // Seeding is thousands of emulator writes: 120 s was not enough with several containers up.
  beforeAll(async () => {
    uid = await signUp("budgets")
    const writes = Array.from({ length: 3000 }, (_, i) => ({
      userId: uid, accountId: "a", type: i % 7 === 0 ? "income" : "expense", amount: 5 + ((i * 13) % 90), currency: "USD",
      categoryId: ["food", "fun", "rent"][i % 3], description: `row ${i}`, rawDescription: null,
      date: new Date(now.getFullYear(), now.getMonth() - (i % months), 1 + (i % 27)), notes: null, tagIds: [],
      splits: [], attachments: [], status: "cleared", isRecurring: false, importHash: null, excludeFromReports: false,
      transferToAccountId: null, linkedTransactionId: null, createdAt: new Date(i), updatedAt: new Date(i),
    }))
    for (let i = 0; i < writes.length; i += 500) {
      const batch = admin().batch()
      for (const w of writes.slice(i, i + 500)) batch.set(admin().collection(`users/${uid}/transactions`).doc(), w)
      await batch.commit()
    }
    const old = new Date(now.getFullYear() - 3, 0, 1)
    const budget = (name: string, categoryId: string | null, amount: number, rolloverMode: string) =>
      admin().collection(`users/${uid}/budgets`).add({
        userId: uid, name, categoryId, amount, currency: "USD", period: "monthly", rolloverMode, createdAt: old, updatedAt: old,
      })
    await Promise.all([
      budget("Food", "food", 400, "full"),
      budget("All", null, 8000, "surplus"),
      budget("Fun", "fun", 400, "reset"),
      budget("Rent", "rent", 400, "reset"),
      budget("Misc", null, 3000, "reset"),
    ])
  }, 300_000)

  it("reads the current month and a dozen small documents, and shows what the raw computation shows", async () => {
    const budgets = await db.getBudgets(uid)
    expect(budgets).toHaveLength(5)

    // Before: every transaction from the oldest rollover period on.
    countReads()
    const raw = await db.getTransactions(uid, { dateFrom: budgetsWindowStart(budgets, now) })
    const before = reads.docs.transactions
    const expected = budgetsWithSpending(budgets, raw.data, now)

    // After, the first visit (the months are stored as they are read) and the next one.
    countReads()
    const first = await loadBudgetsWithSpending(db, uid, budgets, now)
    const firstVisit = { ...reads.docs }
    countReads()
    const next = await loadBudgetsWithSpending(db, uid, budgets, now)
    const after = { ...reads.docs }

    console.log(`budgets read: before ${before} transactions; first visit ${JSON.stringify(firstVisit)}; next ${JSON.stringify(after)}`)
    expect(expected.filter((b) => b.rolloverAmount !== 0)).toHaveLength(2)
    expect(first).toEqual(expected)
    expect(next).toEqual(expected)
    expect(after.monthly_totals).toBe(12)
    expect(after.transactions).toBeLessThan(before / 5)
  })
})
