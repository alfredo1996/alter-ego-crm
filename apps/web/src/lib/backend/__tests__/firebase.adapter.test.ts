/**
 * Firebase adapter contract tests — runs against the Firebase Emulator Suite.
 *
 * Requires (run before `pnpm test:firebase`):
 *   firebase emulators:start --only auth,firestore
 *
 * The vitest.emulator.ts config handles:
 *  - Setting fake NEXT_PUBLIC_FIREBASE_* env vars
 *  - Connecting the SDK to localhost:9099 (Auth) and localhost:8080 (Firestore)
 *  - Clearing all emulator data before the test run
 */
import { createUserWithEmailAndPassword, deleteUser } from "firebase/auth"
import { addDoc, collection, doc, getDocs, setDoc, Timestamp } from "firebase/firestore"
import { describe, expect, it } from "vitest"

import { createFirebaseAdapter } from "@/lib/backend/firebase"
import { getAdminFirestore } from "@/lib/firebase-admin-client"
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase-client"

import { describeAdapterContract } from "./adapter-contract"

describeAdapterContract("firebase", async () => {
  const email = `contract-${Date.now()}@example.com`
  const password = "Test1234!"

  const auth = getFirebaseAuth()
  const { user } = await createUserWithEmailAndPassword(auth, email, password)

  const adapter = createFirebaseAdapter()

  return {
    db: adapter.db,
    files: adapter.files,
    userId: user.uid,
    otherUserId: "nonexistent-user-isolation-test",
    // Through the client SDK with rules enforced: exactly what the old app bundle writes.
    seedLegacyTask: async (engagementId, title) =>
      (
        await addDoc(collection(getFirebaseDb(), `users/${user.uid}/tasks`), {
          userId: user.uid, engagementId, title, dueDate: null, notes: null, isDone: false,
          createdAt: new Date(), updatedAt: new Date(),
        })
      ).id,
    seedLegacyInvoice: async (engagementId, number) =>
      (
        await addDoc(collection(getFirebaseDb(), `users/${user.uid}/invoices`), {
          userId: user.uid, engagementId, number, yearMonth: "2027-01", amount: 1000, vat: 220,
          dueDate: null, paidDate: null, createdAt: new Date(), updatedAt: new Date(),
        })
      ).id,
    // A raw document with the one `file` key, written with the rules out of the way: what a row saved before several files holds.
    seedLegacyFile: async (target, file) => {
      const ref = getAdminFirestore().collection(`users/${user.uid}/${target === "cost" ? "company_expenses" : "invoices"}`).doc()
      const stored = { path: file.path, name: file.name, kind: file.kind, size: file.size, uploadedAt: file.uploadedAt }
      await ref.set(
        target === "cost"
          ? { userId: user.uid, description: "Legacy", category: "other", amount: 10, date: new Date(), isRecurring: false, file: stored, createdAt: new Date(), updatedAt: new Date() }
          : { userId: user.uid, clientId: "c1", number: "L1", yearMonth: "2027-01", amount: 100, vat: 22, file: stored, createdAt: new Date(), updatedAt: new Date() },
      )
      return ref.id
    },
    legacyBalanceSnapshots: {
      seed: async () => {
        await addDoc(collection(getFirebaseDb(), `users/${user.uid}/account_balance_snapshots`), {
          userId: user.uid, accountId: "gone", balance: 100, date: new Date(), createdAt: new Date(),
        })
      },
      count: async () =>
        (await getDocs(collection(getFirebaseDb(), `users/${user.uid}/account_balance_snapshots`))).size,
    },
    seedNetWorthSnapshot: async (date, netWorth) => {
      const id = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
      await setDoc(doc(getFirebaseDb(), `users/${user.uid}/net_worth_snapshots/${id}`), {
        userId: user.uid, date: Timestamp.fromDate(new Date(date.getFullYear(), date.getMonth(), date.getDate())),
        totalAssets: netWorth, totalLiabilities: 0, netWorth,
      })
    },
    cleanup: async () => {
      // Delete the test user — Firestore subcollection docs are cleaned by
      // the globalSetup teardown at the end of the full run
      await deleteUser(user).catch(() => {})
    },
  }
})

describe("firebase adapter, a document written before kind, target and steps existed", () => {
  it("reads as a product with no target and no steps", async () => {
    const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), `legacy-solution-${Date.now()}@example.com`, "Test1234!")
    // Through the client SDK with rules enforced: exactly what the old app bundle wrote.
    await addDoc(collection(getFirebaseDb(), `users/${user.uid}/solutions`), {
      userId: user.uid, clientId: "c1", engagementId: null, name: "Old graph", status: "building", domain: null,
      stack: [], sections: {}, entities: [], relations: [], createdAt: new Date(), updatedAt: new Date(),
    })
    const [old] = await createFirebaseAdapter().db.getSolutions(user.uid)
    expect(old).toMatchObject({ name: "Old graph", kind: "product", target: null, steps: [] })
    await deleteUser(user).catch(() => {})
  })
})
