/**
 * Firestore Security Rules for Personal Finance's collections — negative/positive tests (emulator).
 *
 * The adapter contract only ever sends valid, owner-scoped data, so the rules' field validation,
 * ownership and business constraints were untested. Here the client SDK runs with rules ENFORCED:
 * invalid writes and cross-user access are rejected, valid writes succeed. Finance's fragments
 * (finance.rules, finance-root.rules) are spliced into firestore.rules, which this suite loads;
 * the company's own collections are in firestore-rules.test.ts.
 *
 * Ported from the personal-finance app's rules suite; the cases of the shared collections (API keys,
 * OAuth, MCP audit, default deny, signed out) are not repeated: firestore-rules.test.ts has them.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts).
 */
import { createUserWithEmailAndPassword } from "firebase/auth"
import { deleteDoc, deleteField, doc, getDoc, increment, setDoc, updateDoc } from "firebase/firestore"
import { beforeAll, describe, it, expect } from "vitest"

import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase-client"

let uid = ""
const OTHER = "some-other-user-uid"
const db = () => getFirebaseDb()

// A doc id counter so each create targets a fresh path (avoids update-vs-create ambiguity).
let n = 0
const freshId = () => `r${++n}`

const validAccount = (o: Record<string, unknown> = {}) => ({
  userId: uid, name: "Checking", type: "checking", kind: null,
  currency: "USD", balance: 0, openingBalance: 0, isArchived: false, ...o,
})
const validTransaction = (o: Record<string, unknown> = {}) => ({
  userId: uid, accountId: "acc1", type: "expense", amount: 10, currency: "USD",
  description: "coffee", date: new Date(), tagIds: [], splits: [],
  isRecurring: false, excludeFromReports: false, ...o,
})
const validCategory = (o: Record<string, unknown> = {}) => ({
  userId: uid, name: "Fun", group: "entertainment", icon: "party", color: "#fff",
  isDefault: false, ...o,
})
const listOf = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`)

const mine = (col: string) => doc(db(), `users/${uid}/${col}/${freshId()}`)
const theirs = (col: string) => doc(db(), `users/${OTHER}/${col}/${freshId()}`)

beforeAll(async () => {
  const auth = getFirebaseAuth()
  const email = `rules-${Date.now()}@example.com`
  const { user } = await createUserWithEmailAndPassword(auth, email, "Test1234!")
  uid = user.uid
})


describe("cross-user isolation", () => {
  it("cannot read another user's account", async () => {
    await expect(getDoc(theirs("accounts"))).rejects.toThrow()
  })
  it("cannot read another user's category copy", async () => {
    await expect(getDoc(theirs("categories"))).rejects.toThrow()
  })
  it("cannot write to another user's account", async () => {
    await expect(setDoc(theirs("accounts"), validAccount({ userId: OTHER }))).rejects.toThrow()
  })
  it("cannot delete another user's transaction", async () => {
    await expect(deleteDoc(theirs("transactions"))).rejects.toThrow()
  })
})

describe("account validation", () => {
  it("accepts a valid account", async () => {
    await setDoc(mine("accounts"), validAccount())
  })
  it("rejects a mismatched userId", async () => {
    await expect(setDoc(mine("accounts"), validAccount({ userId: OTHER }))).rejects.toThrow()
  })
  it("rejects an oversized name", async () => {
    await expect(setDoc(mine("accounts"), validAccount({ name: "x".repeat(101) }))).rejects.toThrow()
  })
  it("rejects an invalid currency", async () => {
    await expect(setDoc(mine("accounts"), validAccount({ currency: "FAKE" }))).rejects.toThrow()
  })
  it("rejects a non-number balance", async () => {
    await expect(setDoc(mine("accounts"), validAccount({ balance: "100" }))).rejects.toThrow()
  })
  it("rejects a non-number openingBalance", async () => {
    await expect(setDoc(mine("accounts"), validAccount({ openingBalance: "0" }))).rejects.toThrow()
  })
  it("rejects an invalid kind", async () => {
    await expect(setDoc(mine("accounts"), validAccount({ kind: "hybrid" }))).rejects.toThrow()
  })
  it("accepts a custom (free-form) account type but rejects an oversized one", async () => {
    await setDoc(mine("accounts"), validAccount({ type: "Crypto Wallet" }))
    await expect(setDoc(mine("accounts"), validAccount({ type: "y".repeat(51) }))).rejects.toThrow()
  })
})

describe("transaction validation", () => {
  it("accepts a valid transaction", async () => {
    await setDoc(mine("transactions"), validTransaction())
  })
  it("keeps a long bank memo in rawDescription, as the importer writes it", async () => {
    await setDoc(mine("transactions"), validTransaction({ rawDescription: "m".repeat(3000) }))
  })
  it("rejects attachments, which the app never writes", async () => {
    await expect(setDoc(mine("transactions"), validTransaction({ attachments: ["junk"] }))).rejects.toThrow()
  })
  it("rejects an invalid type", async () => {
    await expect(setDoc(mine("transactions"), validTransaction({ type: "hacked" }))).rejects.toThrow()
  })
  it("rejects a negative amount", async () => {
    await expect(setDoc(mine("transactions"), validTransaction({ amount: -5 }))).rejects.toThrow()
  })
  it("rejects an oversized description", async () => {
    await expect(setDoc(mine("transactions"), validTransaction({ description: "z".repeat(501) }))).rejects.toThrow()
  })
  it("accepts a transfer that names a distinct destination", async () => {
    await setDoc(
      mine("transactions"),
      validTransaction({ type: "transfer", transferToAccountId: "acc2" })
    )
  })
  it("rejects a transfer with no destination — the amount would leave the ledger", async () => {
    await expect(
      setDoc(mine("transactions"), validTransaction({ type: "transfer" }))
    ).rejects.toThrow()
    await expect(
      setDoc(mine("transactions"), validTransaction({ type: "transfer", transferToAccountId: null }))
    ).rejects.toThrow()
  })
  it("rejects a transfer to its own source account", async () => {
    await expect(
      setDoc(mine("transactions"), validTransaction({ type: "transfer", transferToAccountId: "acc1" }))
    ).rejects.toThrow()
  })
  it("rejects an update whose merged result is a destinationless transfer", async () => {
    // request.resource.data is the merged document on update, so flipping type
    // alone on an expense must be caught even though the write omits the field.
    const ref = mine("transactions")
    await setDoc(ref, validTransaction())
    await expect(updateDoc(ref, { type: "transfer" })).rejects.toThrow()
  })
})

describe("monthly totals", () => {
  const month = (m: string, col = uid) => doc(db(), `users/${col}/monthly_totals/${m}`)
  const valid = (o: Record<string, unknown> = {}) => ({ total: 12.5, expenseByCategory: { food: 12.5 }, n: 1, ready: true, ...o })

  it("lets the owner write, read, increment and delete a month", async () => {
    await setDoc(month("2026-01"), valid())
    await setDoc(month("2026-01"), { total: increment(5), expenseByCategory: { food: increment(5) }, n: increment(1) }, { merge: true })
    const data = (await getDoc(month("2026-01"))).data()
    expect(data).toMatchObject({ total: 17.5, expenseByCategory: { food: 17.5 }, n: 2, ready: true })
    await deleteDoc(month("2026-01"))
  })
  it.each([
    ["a string total", { total: "12" }],
    ["a string write count", { n: "1" }],
    ["a non-boolean ready", { ready: "yes" }],
    ["a list for the categories", { expenseByCategory: [1, 2] }],
    ["a number for the categories", { expenseByCategory: 5 }],
    ["a field the app never writes", { extra: 1 }],
  ])("refuses %s", async (_name, over) => {
    await expect(setDoc(month("2026-02"), valid(over))).rejects.toThrow()
  })
  it("refuses a document id that is not a month", async () => {
    await expect(setDoc(month("february"), valid())).rejects.toThrow()
  })
  it("keeps another user's months out of reach", async () => {
    await expect(setDoc(month("2026-03", OTHER), valid())).rejects.toThrow()
    await expect(getDoc(month("2026-03", OTHER))).rejects.toThrow()
    await expect(deleteDoc(month("2026-03", OTHER))).rejects.toThrow()
  })
})

describe("category business rules", () => {
  it("accepts a user category", async () => {
    await setDoc(mine("categories"), validCategory())
  })
  it("accepts a user's own copy of a built-in, under the default's id", async () => {
    await setDoc(doc(db(), `users/${uid}/categories/some-default-id`), validCategory({ name: "Home" }))
  })
  it("accepts a copy of a built-in whose icon is the longest default (UtensilsCrossed)", async () => {
    await setDoc(doc(db(), `users/${uid}/categories/some-default-id`), validCategory({ icon: "UtensilsCrossed" }))
  })
  it("rejects a user category claiming isDefault: true", async () => {
    await expect(setDoc(mine("categories"), validCategory({ isDefault: true }))).rejects.toThrow()
  })
})

describe("system categories", () => {
  it("are readable by an authenticated user", async () => {
    // Seeded by globalSetup; a read must be permitted (missing doc resolves, not rejects).
    await getDoc(doc(db(), "categories/does-not-exist"))
  })
  it("cannot be written by a client", async () => {
    await expect(setDoc(doc(db(), "categories/hacked"), { name: "x" })).rejects.toThrow()
  })
})

describe("userId immutability on update", () => {
  it("cannot change userId to another user", async () => {
    const ref = mine("accounts")
    await setDoc(ref, validAccount())
    await expect(updateDoc(ref, { userId: OTHER })).rejects.toThrow()
  })
})


// ── Closed schemas (#352) ────────────────────────────────────────────────────
//
// Every collection takes only the fields the app writes, with a type for each.
// `wrong` is one field of the wrong type; `id` is for the collections whose
// document id is part of the key.

interface Closed {
  col: string
  doc: () => Record<string, unknown>
  wrong: Record<string, unknown>
  id?: (d: Record<string, unknown>) => string
  noUpdate?: boolean
}
const ts = () => new Date()
const CLOSED: Closed[] = [
  { col: "accounts", doc: () => validAccount(), wrong: { balance: "5" } },
  { col: "transactions", doc: () => validTransaction(), wrong: { date: "2026-01-01" } },
  { col: "categories", doc: () => validCategory(), wrong: { icon: 5 } },
  {
    col: "budgets",
    doc: () => ({ userId: uid, name: "Food", amount: 100, currency: "USD", period: "monthly", rolloverMode: "reset", categoryId: null }),
    wrong: { name: 5 },
  },
  {
    col: "savings_goals",
    doc: () => ({ userId: uid, name: "Trip", targetAmount: 100, currentAmount: 0, currency: "USD", isCompleted: false, targetDate: null }),
    wrong: { isCompleted: "no" },
  },
  {
    col: "recurring",
    doc: () => ({
      userId: uid, accountId: "a1", type: "expense", amount: 5, currency: "USD", description: "Gym", frequency: "monthly",
      interval: 1, startDate: ts(), nextDueDate: ts(), endDate: null, isActive: true, loanMeta: null, categoryId: null, notes: null,
    }),
    wrong: { startDate: "tomorrow" },
  },
  { col: "tags", doc: () => ({ userId: uid, name: "Trip", color: "#fff" }), wrong: { name: 5 } },
  {
    col: "categorization_rules",
    doc: () => ({ userId: uid, pattern: "coffee", categoryId: "c1", displayAs: null, isActive: true }),
    wrong: { categoryId: 5 },
  },
  {
    col: "dismissed_subscription_patterns",
    doc: () => ({ userId: uid, patternKey: "netflix", dismissedAt: ts() }),
    wrong: { patternKey: 5 },
    noUpdate: true,
  },
  {
    col: "account_balance_snapshots",
    doc: () => ({ userId: uid, accountId: "a1", balance: 10, date: ts() }),
    wrong: { balance: "10" },
  },
  {
    col: "net_worth_snapshots",
    doc: () => ({ userId: uid, date: ts(), totalAssets: 10, totalLiabilities: 2, netWorth: 8 }),
    wrong: { netWorth: "8" },
  },
]

describe("recurring loanMeta", () => {
  const rule = (loanMeta: unknown) => ({
    userId: uid, accountId: "a1", type: "expense", amount: 5, currency: "USD", description: "Loan", frequency: "monthly",
    interval: 1, startDate: ts(), nextDueDate: ts(), endDate: null, isActive: true, loanMeta, categoryId: null, notes: null,
  })
  const meta = { loanAmount: 1000, annualRate: 6.5, termMonths: 12, paymentStartMonth: 1 }
  it("accepts the loan shape the app writes", async () => {
    await setDoc(mine("recurring"), rule(meta))
  })
  it.each([
    ["an extra key", { ...meta, junk: "j" }],
    ["a string rate", { ...meta, annualRate: "6.5" }],
  ])("rejects %s", async (_n, loanMeta) => {
    await expect(setDoc(mine("recurring"), rule(loanMeta))).rejects.toThrow()
  })
})

describe.each(CLOSED)("$col has a closed schema", (c) => {
  const at = (d: Record<string, unknown>) => doc(db(), `users/${uid}/${c.col}/${c.id ? c.id(d) : freshId()}`)

  it("accepts a valid document", async () => {
    const d = c.doc()
    await setDoc(at(d), d)
  })
  it("refuses a create with an unknown field", async () => {
    const d = c.doc()
    await expect(setDoc(at(d), { ...d, isAdmin: true })).rejects.toThrow()
  })
  it("refuses a create with a wrong-typed field", async () => {
    const d = c.doc()
    await expect(setDoc(at(d), { ...d, ...c.wrong })).rejects.toThrow()
  })
  if (!c.noUpdate) {
    it("refuses an update that adds an unknown field", async () => {
      const d = c.doc()
      const ref = at(d)
      await setDoc(ref, d)
      await expect(updateDoc(ref, { isAdmin: true })).rejects.toThrow()
    })
    it("refuses an update that sets a field to the wrong type", async () => {
      const d = c.doc()
      const ref = at(d)
      await setDoc(ref, d)
      await expect(updateDoc(ref, c.wrong)).rejects.toThrow()
    })
    it("refuses an update that deletes userId", async () => {
      const d = c.doc()
      const ref = at(d)
      await setDoc(ref, d)
      await expect(updateDoc(ref, { userId: deleteField() })).rejects.toThrow()
    })
  }
})

describe("numbers (#352)", () => {
  it.each([NaN, Infinity, -Infinity, 1e15])("refuses %s as an amount", async (bad) => {
    await expect(setDoc(mine("accounts"), validAccount({ balance: bad }))).rejects.toThrow()
    await expect(setDoc(mine("transactions"), validTransaction({ amount: bad }))).rejects.toThrow()
  })
  it("refuses 20,000 tag ids", async () => {
    await expect(setDoc(mine("transactions"), validTransaction({ tagIds: listOf(20000) }))).rejects.toThrow()
  })
})

describe("dismissed pattern key length (#352)", () => {
  it("takes a key as long as the app builds and refuses one past 800", async () => {
    await setDoc(mine("dismissed_subscription_patterns"), { userId: uid, patternKey: "k".repeat(800), dismissedAt: ts() })
    await expect(
      setDoc(mine("dismissed_subscription_patterns"), { userId: uid, patternKey: "k".repeat(801), dismissedAt: ts() }),
    ).rejects.toThrow()
  })
})

