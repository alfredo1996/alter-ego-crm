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
import { addDoc, collection } from "firebase/firestore"

import { createFirebaseAdapter } from "@/lib/backend/firebase"
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
    cleanup: async () => {
      // Delete the test user — Firestore subcollection docs are cleaned by
      // the globalSetup teardown at the end of the full run
      await deleteUser(user).catch(() => {})
    },
  }
})
