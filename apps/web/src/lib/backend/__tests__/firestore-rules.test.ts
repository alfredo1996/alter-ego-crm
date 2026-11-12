/**
 * Firestore Security Rules — negative/positive tests (emulator).
 *
 * The adapter contract only ever sends valid, owner-scoped data, so the rules'
 * field validation, ownership, and business constraints were untested. Here the
 * client SDK runs with rules ENFORCED: we assert that invalid writes and
 * cross-user access are rejected, and that valid writes succeed.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts).
 */
import { MAX_PROPERTY, MAX_RENT } from "@alter-ego/rent/schemas"
import { createUserWithEmailAndPassword } from "firebase/auth"
import {
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore"
import { beforeAll, describe, it, expect } from "vitest"

import { getAdminFirestore } from "@/lib/firebase-admin-client"
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase-client"
import {
  MAX_AMENDMENTS,
  MAX_FEE,
  MAX_FEE_CHANGES,
  JOURNAL_LINE_MAX,
  JOURNAL_SOURCE_MAX,
  JOURNAL_TEXT_MAX,
  MAX_JOURNAL_DECISIONS,
  MAX_JOURNAL_LINKS,
  MAX_SOLUTION_ENTITIES,
  MAX_SOLUTION_RELATIONS,
  MAX_SOLUTION_STACK,
  MAX_SOLUTION_STEPS,
  MEETING_TEXT_MAX,
  SOLUTION_SECTION_MAX,
  SOLUTION_TARGET_MAX,
  SOLUTION_SECTIONS,
} from "@/types/schemas"

import { emulatorHosts, firestoreRestBase } from "./emulator-hosts"

let uid = ""
const OTHER = "some-other-user-uid"
const db = () => getFirebaseDb()

// A doc id counter so each create targets a fresh path (avoids update-vs-create ambiguity).
let n = 0
const freshId = () => `r${++n}`

const validClient = (o: Record<string, unknown> = {}) => ({
  userId: uid, name: "Acme", vatNumber: null, email: null,
  contactName: null, contactPhone: null, notes: null,
  isActive: true, ...o,
})
const validOpportunity = (o: Record<string, unknown> = {}) => ({
  userId: uid, clientId: "c1", title: "Retainer", stage: "lead", probability: 20,
  dailyRate: 600, estimatedDaysPerMonth: 10, estimatedDurationMonths: 6,
  expectedStartMonth: null, vatApplicable: true, ...o,
})
const validEngagement = (o: Record<string, unknown> = {}) => ({
  userId: uid, clientId: "c1", dailyRate: 600, vatApplicable: true,
  contractedDays: null, defaultDaysPerMonth: 10, startMonth: null, isActive: true, ...o,
})
const validAllocation = (o: Record<string, unknown> = {}) => ({
  userId: uid, engagementId: "e1", yearMonth: "2026-09", days: 10, ...o,
})
const validDeadline = (o: Record<string, unknown> = {}) => ({
  userId: uid, title: "Parcella", date: new Date(), kind: "admin",
  amount: 1200, notes: null, isDone: false, ...o,
})
// The pre-#164 shape — a contract, no clientId — which the old app bundle still writes.
const validTask = (o: Record<string, unknown> = {}) => ({
  userId: uid, engagementId: "e1", title: "Kickoff", dueDate: new Date(),
  notes: null, isDone: false, ...o,
})
/** A task with no engagementId field at all. */
const taskWithoutContract = (o: Record<string, unknown> = {}) => {
  const task: Record<string, unknown> = validTask(o)
  delete task.engagementId
  return task
}

// The old-bundle shape — a contract, no clientId — which an open tab can still write.
const validInvoice = (o: Record<string, unknown> = {}) => ({
  userId: uid, engagementId: "e1", number: "2026/14", yearMonth: "2026-09",
  amount: 5000, vat: 1100, dueDate: new Date(), paidDate: null, ...o,
})
/** An invoice naming its client, with no engagementId field at all. */
const clientInvoice = (o: Record<string, unknown> = {}) => {
  const invoice: Record<string, unknown> = validInvoice({ clientId: "c1", ...o })
  if (!("engagementId" in o)) delete invoice.engagementId
  return invoice
}

const validTimecard = (o: Record<string, unknown> = {}) => ({
  userId: uid, engagementId: "e1", date: "2026-09-24", hours: 6, notes: null, ...o,
})
/** A timecard's id is `${engagementId}_${date}`; the rules refuse any other. */
const timecardAt = (t: { engagementId: unknown; date: unknown }) =>
  doc(db(), `users/${uid}/timecards/${t.engagementId}_${t.date}`)
const setTimecard = (o: Record<string, unknown> = {}) => {
  const t = validTimecard(o)
  return setDoc(timecardAt(t), t)
}

const validMeeting = (o: Record<string, unknown> = {}) => ({
  userId: uid, clientId: "c1", engagementId: "e1", date: "2026-09-12", time: "10:30",
  health: "yellow", text: "Test slittati di due settimane.", createdAt: new Date(), updatedAt: new Date(), ...o,
})
/** A verbale lacking one field entirely (not null: absent). */
const meetingWithout = (field: string) => {
  const m: Record<string, unknown> = validMeeting()
  delete m[field]
  return m
}

// Every field, as every writer writes them: the Nordwind fixture, sections all null.
const validSolution = (o: Record<string, unknown> = {}) => ({
  userId: uid, clientId: "c1", engagementId: "e1", name: "Product knowledge graph", status: "delivered",
  domain: "retail", stack: ["neo4j", "kafka"], kind: "product", target: null, steps: [],
  sections: Object.fromEntries(SOLUTION_SECTIONS.map((s) => [s.key, null])),
  entities: [{ name: "Product", source: "SAP MARA", notes: null }, { name: "Category", source: "Akeneo", notes: null }],
  relations: [{ from: "Product", to: "Category", type: "IN_CATEGORY" }],
  createdAt: new Date(), updatedAt: new Date(), ...o,
})
/** A solution lacking one field entirely (not null: absent). */
const solutionWithout = (field: string) => {
  const d: Record<string, unknown> = validSolution()
  delete d[field]
  return d
}
const listOf = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`)

const validJournalEntry = (o: Record<string, unknown> = {}) => ({
  userId: uid, solutionId: "s1", clientId: "c1", kind: "work", date: "2026-11-07", stepTitle: "MVP",
  text: "Loading rewritten.", decisions: ["Spend goes to the booking holder"], links: ["PR #7"], next: null, source: null,
  createdAt: new Date(), updatedAt: new Date(), ...o,
})

const validCompanyAccount = (o: Record<string, unknown> = {}) => ({
  userId: uid, name: "Bank A", openingBalance: 1000, openingDate: new Date(),
  statementBalance: null, statementDate: null, importRef: null, ...o,
})
const validMovement = (o: Record<string, unknown> = {}) => ({
  userId: uid, kind: "income", direction: "in", amount: 100, date: new Date(),
  accountId: "acc-a", toAccountId: null, expenseId: null, description: "Room A rent",
  documentRef: null, project: null, counterparty: null, notes: null,
  dateEstimated: false, importRef: null, ...o,
})
/** A document carrying only the required fields: every optional key absent. */
const bare = (d: Record<string, unknown>, keep: string[]) =>
  Object.fromEntries(Object.entries(d).filter(([k]) => keep.includes(k)))

const mine = (col: string) => doc(db(), `users/${uid}/${col}/${freshId()}`)
const theirs = (col: string) => doc(db(), `users/${OTHER}/${col}/${freshId()}`)

beforeAll(async () => {
  const auth = getFirebaseAuth()
  const email = `rules-${Date.now()}@example.com`
  const { user } = await createUserWithEmailAndPassword(auth, email, "Test1234!")
  uid = user.uid
})

describe("cross-user isolation", () => {
  it("cannot read another user's client", async () => {
    await expect(getDoc(theirs("clients"))).rejects.toThrow()
  })
  it("cannot write to another user's company account", async () => {
    await expect(setDoc(theirs("company_accounts"), validCompanyAccount({ userId: OTHER }))).rejects.toThrow()
  })
  it("cannot delete another user's cost", async () => {
    await expect(deleteDoc(theirs("company_expenses"))).rejects.toThrow()
  })
})

describe("userId immutability on update", () => {
  it("cannot change userId to another user", async () => {
    const ref = mine("clients")
    await setDoc(ref, validClient())
    await expect(updateDoc(ref, { userId: OTHER })).rejects.toThrow()
  })
})

// The Firebase adapter swallows permission-denied and returns [], so a missing or
// wrong rules block on a CRM collection shows an empty screen with no error at all.
// These are the tripwire for that.

describe("client validation", () => {
  it("accepts a valid client", async () => {
    await setDoc(mine("clients"), validClient())
  })
  it("rejects an empty-path user's client", async () => {
    await expect(setDoc(theirs("clients"), validClient({ userId: OTHER }))).rejects.toThrow()
  })
  it("rejects an oversized name", async () => {
    await expect(setDoc(mine("clients"), validClient({ name: "x".repeat(201) }))).rejects.toThrow()
  })
  it("rejects a non-bool isActive", async () => {
    await expect(setDoc(mine("clients"), validClient({ isActive: "yes" }))).rejects.toThrow()
  })
  it("accepts a named contact person", async () => {
    await setDoc(mine("clients"), validClient({ contactName: "Maria Rossi", contactPhone: "+39 340 1234567" }))
  })
  it("rejects an oversized contact name", async () => {
    await expect(
      setDoc(mine("clients"), validClient({ contactName: "x".repeat(201) })),
    ).rejects.toThrow()
  })
  it("rejects an oversized contact phone", async () => {
    await expect(
      setDoc(mine("clients"), validClient({ contactPhone: "9".repeat(41) })),
    ).rejects.toThrow()
  })
})

describe("opportunity validation", () => {
  it("accepts a valid opportunity", async () => {
    await setDoc(mine("opportunities"), validOpportunity())
  })
  it("rejects an unknown stage", async () => {
    await expect(setDoc(mine("opportunities"), validOpportunity({ stage: "closed" }))).rejects.toThrow()
  })
  it("rejects a probability above 100", async () => {
    await expect(setDoc(mine("opportunities"), validOpportunity({ probability: 120 }))).rejects.toThrow()
  })
  it("rejects a negative probability", async () => {
    await expect(setDoc(mine("opportunities"), validOpportunity({ probability: -1 }))).rejects.toThrow()
  })
  it("rejects a malformed expectedStartMonth", async () => {
    await expect(setDoc(mine("opportunities"), validOpportunity({ expectedStartMonth: "2026" }))).rejects.toThrow()
  })
  it("rejects a zero-month duration", async () => {
    await expect(setDoc(mine("opportunities"), validOpportunity({ estimatedDurationMonths: 0 }))).rejects.toThrow()
  })
})

describe("engagement validation", () => {
  it("accepts a valid engagement", async () => {
    await setDoc(mine("engagements"), validEngagement())
  })
  it("accepts a null contractedDays (open-ended contract)", async () => {
    await setDoc(mine("engagements"), validEngagement({ contractedDays: null }))
  })
  it("rejects a zero contractedDays", async () => {
    await expect(setDoc(mine("engagements"), validEngagement({ contractedDays: 0 }))).rejects.toThrow()
  })
  it("rejects more than 31 days per month", async () => {
    await expect(setDoc(mine("engagements"), validEngagement({ defaultDaysPerMonth: 32 }))).rejects.toThrow()
  })
  it("accepts unit day or hour, and none (a contract from before units)", async () => {
    await setDoc(mine("engagements"), validEngagement({ unit: "hour" }))
    await setDoc(mine("engagements"), validEngagement({ unit: "day" }))
    await setDoc(mine("engagements"), validEngagement())
  })
  it.each(["week", 8, null])("rejects unit %j on a contract, created and updated", async (unit) => {
    await expect(setDoc(mine("engagements"), validEngagement({ unit }))).rejects.toThrow()
    const ref = mine("engagements")
    await setDoc(ref, validEngagement())
    await expect(updateDoc(ref, { unit })).rejects.toThrow()
    await updateDoc(ref, { unit: "hour" })
  })
  it("accepts unit hour on an opportunity, refuses week, and still takes none", async () => {
    await setDoc(mine("opportunities"), validOpportunity({ unit: "hour" }))
    await setDoc(mine("opportunities"), validOpportunity())
    await expect(setDoc(mine("opportunities"), validOpportunity({ unit: "week" }))).rejects.toThrow()
    const ref = mine("opportunities")
    await setDoc(ref, validOpportunity())
    await expect(updateDoc(ref, { unit: "week" })).rejects.toThrow()
    await updateDoc(ref, { unit: "hour" })
  })
  it("accepts a name, a null name, and no name field at all", async () => {
    await setDoc(mine("engagements"), validEngagement({ name: "Migrazione cloud" }))
    await setDoc(mine("engagements"), validEngagement({ name: null }))
    await setDoc(mine("engagements"), validEngagement())
  })
  it("rejects a non-string name", async () => {
    await expect(setDoc(mine("engagements"), validEngagement({ name: 42 }))).rejects.toThrow()
  })
  it("rejects a name over 120 characters", async () => {
    await expect(setDoc(mine("engagements"), validEngagement({ name: "x".repeat(121) }))).rejects.toThrow()
  })
  it("validates the name on update too", async () => {
    const ref = mine("engagements")
    await setDoc(ref, validEngagement())
    await updateDoc(ref, { name: "x".repeat(120) })
    await expect(updateDoc(ref, { name: 42 })).rejects.toThrow()
    await expect(updateDoc(ref, { name: "x".repeat(121) })).rejects.toThrow()
  })
  it("accepts an endMonth, a null one, and none at all", async () => {
    await setDoc(mine("engagements"), validEngagement({ endMonth: "2026-06" }))
    await setDoc(mine("engagements"), validEngagement({ endMonth: null }))
    await setDoc(mine("engagements"), validEngagement())
  })
  it("rejects an endMonth that is not YYYY-MM sized", async () => {
    await expect(setDoc(mine("engagements"), validEngagement({ endMonth: "2026-6" }))).rejects.toThrow()
    await expect(setDoc(mine("engagements"), validEngagement({ endMonth: 202606 }))).rejects.toThrow()
  })
  it("validates endMonth on update too", async () => {
    const ref = mine("engagements")
    await setDoc(ref, validEngagement())
    await updateDoc(ref, { endMonth: "2026-06", isActive: false })
    await updateDoc(ref, { endMonth: null })
    await expect(updateDoc(ref, { endMonth: "2026-006" })).rejects.toThrow()
  })
  it("accepts an endDate, a null one, and none at all", async () => {
    await setDoc(mine("engagements"), validEngagement({ endMonth: "2026-06", endDate: "2026-06-12" }))
    await setDoc(mine("engagements"), validEngagement({ endMonth: "2026-06", endDate: null }))
    await setDoc(mine("engagements"), validEngagement({ endMonth: "2026-06" }))
  })
  it("rejects an endDate that is not YYYY-MM-DD sized", async () => {
    await expect(setDoc(mine("engagements"), validEngagement({ endDate: "2026-6-1" }))).rejects.toThrow()
    await expect(setDoc(mine("engagements"), validEngagement({ endDate: 20260601 }))).rejects.toThrow()
  })
  it("validates endDate on update too", async () => {
    const ref = mine("engagements")
    await setDoc(ref, validEngagement())
    await updateDoc(ref, { endMonth: "2026-06", endDate: "2026-06-12", isActive: false })
    await updateDoc(ref, { endMonth: null, endDate: null })
    await expect(updateDoc(ref, { endDate: "2026-6-1" })).rejects.toThrow()
    await expect(updateDoc(ref, { endDate: 20260601 })).rejects.toThrow()
  })

  describe("amendments", () => {
    const amendments = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        from: `${2027 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
        dailyRate: 800 + i, addedDays: null, lastDay: null, lastDayBefore: null, note: null,
      }))

    it("accepts none, an empty list and a full one on create", async () => {
      await setDoc(mine("engagements"), validEngagement())
      await setDoc(mine("engagements"), validEngagement({ amendments: [] }))
      await setDoc(mine("engagements"), validEngagement({ amendments: amendments(MAX_AMENDMENTS) }))
    })
    it("rejects a non-list and one entry too many on create", async () => {
      await expect(setDoc(mine("engagements"), validEngagement({ amendments: "800 from Jan" }))).rejects.toThrow()
      await expect(setDoc(mine("engagements"), validEngagement({ amendments: amendments(MAX_AMENDMENTS + 1) }))).rejects.toThrow()
    })
    it("validates them on update too, and leaves a contract holding them editable", async () => {
      const ref = mine("engagements")
      await setDoc(ref, validEngagement())
      await updateDoc(ref, { amendments: amendments(2), endMonth: "2027-06", endDate: "2027-06-30" })
      await updateDoc(ref, { name: "Platform" })
      await updateDoc(ref, { amendments: amendments(MAX_AMENDMENTS) })
      await updateDoc(ref, { amendments: [] })
      await expect(updateDoc(ref, { amendments: { from: "2027-01" } })).rejects.toThrow()
      await expect(updateDoc(ref, { amendments: amendments(MAX_AMENDMENTS + 1) })).rejects.toThrow()
    })
  })
})

describe("company deadline validation", () => {
  it("accepts a valid deadline", async () => {
    await setDoc(mine("company_deadlines"), validDeadline())
  })
  it("accepts a null amount", async () => {
    await setDoc(mine("company_deadlines"), validDeadline({ amount: null }))
  })
  it("rejects an unknown kind", async () => {
    await expect(setDoc(mine("company_deadlines"), validDeadline({ kind: "invoice" }))).rejects.toThrow()
  })
  it("rejects a negative amount", async () => {
    await expect(setDoc(mine("company_deadlines"), validDeadline({ amount: -1 }))).rejects.toThrow()
  })
  it("rejects a non-timestamp date", async () => {
    await expect(setDoc(mine("company_deadlines"), validDeadline({ date: "2026-10-20" }))).rejects.toThrow()
  })
  it("rejects another user's deadline", async () => {
    await expect(setDoc(theirs("company_deadlines"), validDeadline({ userId: OTHER }))).rejects.toThrow()
  })
})

describe("task validation", () => {
  it("accepts a valid task", async () => {
    await setDoc(mine("tasks"), validTask())
  })
  it("accepts a null dueDate", async () => {
    await setDoc(mine("tasks"), validTask({ dueDate: null }))
  })
  it("rejects a non-timestamp dueDate", async () => {
    await expect(setDoc(mine("tasks"), validTask({ dueDate: "2027-01-10" }))).rejects.toThrow()
  })
  it("rejects a missing title", async () => {
    await expect(setDoc(mine("tasks"), validTask({ title: "" }))).rejects.toThrow()
  })
  it("rejects a non-bool isDone", async () => {
    await expect(setDoc(mine("tasks"), validTask({ isDone: "yes" }))).rejects.toThrow()
  })
  it("accepts a startedAt timestamp, a null one, and none at all", async () => {
    await setDoc(mine("tasks"), validTask({ startedAt: new Date() }))
    await setDoc(mine("tasks"), validTask({ startedAt: null }))
    await setDoc(mine("tasks"), validTask())
  })
  it("rejects a non-timestamp startedAt", async () => {
    await expect(setDoc(mine("tasks"), validTask({ startedAt: "2026-09-24" }))).rejects.toThrow()
  })
  it("validates startedAt on update too", async () => {
    const ref = mine("tasks")
    await setDoc(ref, validTask())
    await updateDoc(ref, { startedAt: new Date() })
    await updateDoc(ref, { startedAt: null })
    await expect(updateDoc(ref, { startedAt: "2026-09-24" })).rejects.toThrow()
  })
  it("accepts absent, empty and valid labels", async () => {
    await setDoc(mine("tasks"), validTask())
    await setDoc(mine("tasks"), validTask({ labels: [] }))
    await setDoc(mine("tasks"), validTask({ labels: ["Urgente", "Cliente"] }))
  })
  it("rejects labels that are not a list, or more than 10", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `l${i}`)
    await expect(setDoc(mine("tasks"), validTask({ labels: "Urgente" }))).rejects.toThrow()
    await expect(setDoc(mine("tasks"), validTask({ labels: eleven }))).rejects.toThrow()
  })
  it("validates labels on update too", async () => {
    const ref = mine("tasks")
    await setDoc(ref, validTask())
    await updateDoc(ref, { labels: ["Bug"] })
    await updateDoc(ref, { labels: [] })
    await expect(updateDoc(ref, { labels: "Bug" })).rejects.toThrow()
    await expect(updateDoc(ref, { labels: Array.from({ length: 11 }, (_, i) => `l${i}`) })).rejects.toThrow()
  })
  it("rejects another user's task", async () => {
    await expect(setDoc(theirs("tasks"), validTask({ userId: OTHER }))).rejects.toThrow()
  })
  it("accepts a task naming only a client, only a contract (the old bundle), or both", async () => {
    await setDoc(mine("tasks"), taskWithoutContract({ clientId: "c1" }))
    await setDoc(mine("tasks"), validTask())
    await setDoc(mine("tasks"), validTask({ clientId: "c1" }))
  })
  it("accepts a null engagementId next to a clientId", async () => {
    await setDoc(mine("tasks"), validTask({ clientId: "c1", engagementId: null }))
  })
  it("rejects a task naming neither a client nor a contract", async () => {
    await expect(setDoc(mine("tasks"), taskWithoutContract())).rejects.toThrow()
    await expect(setDoc(mine("tasks"), validTask({ engagementId: null }))).rejects.toThrow()
    await expect(setDoc(mine("tasks"), validTask({ engagementId: "" }))).rejects.toThrow()
  })
  it("rejects an empty or non-string clientId", async () => {
    await expect(setDoc(mine("tasks"), validTask({ clientId: "" }))).rejects.toThrow()
    await expect(setDoc(mine("tasks"), validTask({ clientId: null }))).rejects.toThrow()
    await expect(setDoc(mine("tasks"), validTask({ clientId: 42 }))).rejects.toThrow()
  })
  it("attaches and detaches on update, but never leaves a task naming neither", async () => {
    const ref = mine("tasks")
    await setDoc(ref, validTask({ clientId: "c1" }))
    await updateDoc(ref, { engagementId: null })
    await updateDoc(ref, { engagementId: "e2" })
    await expect(updateDoc(ref, { clientId: "" })).rejects.toThrow()

    // An old document has only its contract: detaching it must name the client.
    const legacy = mine("tasks")
    await setDoc(legacy, validTask())
    await expect(updateDoc(legacy, { engagementId: null })).rejects.toThrow()
    await updateDoc(legacy, { engagementId: null, clientId: "c1" })
  })
})

describe("invoice validation", () => {
  it("accepts a valid invoice", async () => {
    await setDoc(mine("invoices"), validInvoice())
  })
  it("accepts null dueDate and paidDate", async () => {
    await setDoc(mine("invoices"), validInvoice({ dueDate: null, paidDate: null }))
  })
  // A nota di credito IS a negative invoice — that is the whole credit-note
  // feature, for no extra code. This test exists so nobody "fixes" the rules
  // (or the Zod schema) into a > 0 check. Keep it accepting.
  it("accepts a negative amount and vat (nota di credito)", async () => {
    await setDoc(mine("invoices"), validInvoice({ amount: -5000, vat: -1100 }))
  })
  it("rejects an empty number", async () => {
    await expect(setDoc(mine("invoices"), validInvoice({ number: "" }))).rejects.toThrow()
  })
  it("rejects a number over 50 chars", async () => {
    await expect(setDoc(mine("invoices"), validInvoice({ number: "9".repeat(51) }))).rejects.toThrow()
  })
  it("rejects a 6-character yearMonth", async () => {
    await expect(setDoc(mine("invoices"), validInvoice({ yearMonth: "2026-9" }))).rejects.toThrow()
  })
  it("rejects another user's invoice", async () => {
    await expect(setDoc(theirs("invoices"), validInvoice({ userId: OTHER }))).rejects.toThrow()
  })
  it("accepts an invoice naming only a contract (the old bundle), only a client, or both", async () => {
    await setDoc(mine("invoices"), validInvoice())
    await setDoc(mine("invoices"), clientInvoice())
    await setDoc(mine("invoices"), validInvoice({ clientId: "c1" }))
    await setDoc(mine("invoices"), clientInvoice({ engagementId: null }))
  })
  it("rejects an invoice naming neither a client nor a contract", async () => {
    const neither: Record<string, unknown> = validInvoice()
    delete neither.engagementId
    await expect(setDoc(mine("invoices"), neither)).rejects.toThrow()
    await expect(setDoc(mine("invoices"), validInvoice({ engagementId: null }))).rejects.toThrow()
  })
  it("rejects an empty or non-string clientId", async () => {
    await expect(setDoc(mine("invoices"), clientInvoice({ clientId: "" }))).rejects.toThrow()
    await expect(setDoc(mine("invoices"), validInvoice({ clientId: null }))).rejects.toThrow()
    await expect(setDoc(mine("invoices"), validInvoice({ clientId: 42 }))).rejects.toThrow()
  })
  it("accepts a first month for an invoice covering several, or none", async () => {
    await setDoc(mine("invoices"), clientInvoice({ fromMonth: "2026-04" }))
    await setDoc(mine("invoices"), clientInvoice({ fromMonth: null }))
  })
  it("rejects a malformed fromMonth", async () => {
    await expect(setDoc(mine("invoices"), clientInvoice({ fromMonth: "2026-4" }))).rejects.toThrow()
    await expect(setDoc(mine("invoices"), clientInvoice({ fromMonth: 202604 }))).rejects.toThrow()
  })
  it("keeps updating old and new invoices, and never leaves one naming neither", async () => {
    // The old bundle stamps paidDate on the documents it wrote.
    const legacy = mine("invoices")
    await setDoc(legacy, validInvoice())
    await updateDoc(legacy, { paidDate: new Date() })
    // Deleting a contract hands its invoice to the client: detaching must name it.
    await expect(updateDoc(legacy, { engagementId: null })).rejects.toThrow()
    await updateDoc(legacy, { engagementId: null, clientId: "c1" })

    const ref = mine("invoices")
    await setDoc(ref, clientInvoice())
    await updateDoc(ref, { paidDate: new Date() })
    await updateDoc(ref, { fromMonth: "2026-04", yearMonth: "2026-06" })
    await updateDoc(ref, { fromMonth: null })
    await expect(updateDoc(ref, { fromMonth: "x" })).rejects.toThrow()
    await expect(updateDoc(ref, { clientId: "" })).rejects.toThrow()
  })
  it("accepts a paid account id or null, and refuses any other type", async () => {
    await setDoc(mine("invoices"), clientInvoice({ paidDate: new Date(), paidAccountId: "acc-a" }))
    await setDoc(mine("invoices"), clientInvoice({ paidAccountId: null }))
    await expect(setDoc(mine("invoices"), clientInvoice({ paidAccountId: 5 }))).rejects.toThrow()
    await expect(setDoc(mine("invoices"), clientInvoice({ paidAccountId: "" }))).rejects.toThrow()
    await expect(setDoc(mine("invoices"), clientInvoice({ paidAccountId: "x".repeat(201) }))).rejects.toThrow()
  })
  // Invoices and Deadlines untick with {paidDate: null} alone, and Undo puts the
  // date back alone: no rule may tie the account to the date.
  it("keeps marking paid and unpaid with the date alone, an account set or not", async () => {
    const ref = mine("invoices")
    await setDoc(ref, clientInvoice({ paidDate: new Date(), paidAccountId: "acc-a" }))
    await updateDoc(ref, { paidDate: null })
    await updateDoc(ref, { paidDate: new Date() })
    await updateDoc(ref, { paidDate: new Date(), paidAccountId: "acc-b" })
    await updateDoc(ref, { paidDate: null, paidAccountId: null })
    await expect(updateDoc(ref, { paidAccountId: 5 })).rejects.toThrow()

    // A document written before the field existed takes it on update.
    const legacy = mine("invoices")
    await setDoc(legacy, clientInvoice())
    await updateDoc(legacy, { paidDate: new Date() })
    await updateDoc(legacy, { paidDate: null })
    await updateDoc(legacy, { paidDate: new Date(), paidAccountId: "acc-a" })
  })
})

// A cost or loan written before the cash book lacks every field it added: it
// must still update, and each field is checked once sent, on create and update.
describe("company expense validation", () => {
  // The shape every cost had before the cash book.
  const legacyExpense = (o: Record<string, unknown> = {}) => ({
    userId: uid, description: "Bank fee", category: "bank_fees", amount: 25, date: new Date(),
    isRecurring: false, recurrenceMonths: null, notes: null, ...o,
  })
  const full = {
    accountId: "acc-a", paidByOwner: false, vat: 5.5, documentRef: "FPR 40/26", project: "Flat Rental",
    recurringExpenseId: "est-1", dateEstimated: true, importRef: "2026:S1!4",
  }
  const estimateFields = { endMonth: "2027-12", priceChanges: [{ from: "2027-07", amount: 1350 }], countedWhenPaid: true }
  it("accepts a cost before the cash book, a paid one with every field, an owner-paid one and a refund", async () => {
    await setDoc(mine("company_expenses"), legacyExpense())
    await setDoc(mine("company_expenses"), legacyExpense(full))
    await setDoc(mine("company_expenses"), legacyExpense({ accountId: null, paidByOwner: true, vat: 0 }))
    await setDoc(mine("company_expenses"), legacyExpense({ amount: -40, vat: -8.8, accountId: "acc-a" }))
    await setDoc(mine("company_expenses"), legacyExpense({ isRecurring: true, recurrenceMonths: 1, vat: 0 }))
    await setDoc(mine("company_expenses"), legacyExpense({ category: "collaborators", collaboratorId: "c1", engagementId: "e1", forMonth: "2026-09" }))
    await setDoc(mine("company_expenses"), legacyExpense({ collaboratorId: null, engagementId: null, forMonth: null }))
    await setDoc(mine("company_expenses"), legacyExpense({ isRecurring: true, recurrenceMonths: 3, vat: 0, ...estimateFields }))
    await setDoc(mine("company_expenses"), legacyExpense({ isRecurring: true, endMonth: null, priceChanges: [], countedWhenPaid: false }))
  })
  it.each([
    ["an account of another type", { accountId: 5 }],
    ["an empty account", { accountId: "" }],
    ["an account over 200", { accountId: "x".repeat(201) }],
    ["a zero amount", { amount: 0 }],
    ["a negative amount not paid back into an account", { amount: -40 }],
    ["a negative recurring amount", { amount: -40, isRecurring: true }],
    ["a string category", { category: "food" }],
    ["a string date", { date: "2026-06-02" }],
    ["a string isRecurring", { isRecurring: "no" }],
    ["a string recurrence", { recurrenceMonths: "1" }],
    ["an end with a day", { endMonth: "2027-12-01" }],
    ["an end in month 13", { endMonth: "2027-13" }],
    ["a numeric end", { endMonth: 202712 }],
    ["price changes that are not a list", { priceChanges: "1350" }],
    ["more than 24 price changes", { priceChanges: Array.from({ length: 25 }, (_, i) => ({ from: `2027-${String((i % 12) + 1).padStart(2, "0")}`, amount: 1 })) }],
    ["a string countedWhenPaid", { countedWhenPaid: "yes" }],
    ["notes over 500", { notes: "x".repeat(501) }],
    ["a string paidByOwner", { paidByOwner: "yes" }],
    ["a string VAT", { vat: "22" }],
    ["VAT of the other sign", { vat: -5 }],
    ["a document over 100", { documentRef: "x".repeat(101) }],
    ["a cost centre over 60", { project: "x".repeat(61) }],
    ["an empty estimate link", { recurringExpenseId: "" }],
    ["a string dateEstimated", { dateEstimated: "yes" }],
    ["an import ref over 40", { importRef: "x".repeat(41) }],
    ["an empty collaborator", { collaboratorId: "" }],
    ["a numeric contract", { engagementId: 5 }],
    ["a month with a day", { forMonth: "2026-09-01" }],
    ["month 13", { forMonth: "2026-13" }],
    ["a numeric month", { forMonth: 202609 }],
    ["an account and the owner's card together", { accountId: "acc-a", paidByOwner: true }],
    ["a recurring estimate paid from an account", { isRecurring: true, accountId: "acc-a" }],
    ["a recurring estimate paid by the owner", { isRecurring: true, paidByOwner: true }],
    ["a recurring estimate standing for another", { isRecurring: true, recurringExpenseId: "est-1" }],
  ])("rejects %s", async (_, over) => {
    await expect(setDoc(mine("company_expenses"), legacyExpense(over))).rejects.toThrow()
  })
  it("rejects another user's cost", async () => {
    await expect(setDoc(theirs("company_expenses"), legacyExpense({ userId: OTHER }))).rejects.toThrow()
  })
  it("keeps updating a cost written before the cash book, and checks the merged document", async () => {
    const legacy = mine("company_expenses")
    await setDoc(legacy, legacyExpense())
    await updateDoc(legacy, { amount: 30 })
    await updateDoc(legacy, { notes: "kept" })
    await updateDoc(legacy, full)
    await updateDoc(legacy, { category: "collaborators", collaboratorId: "c1", forMonth: "2026-09" })
    await expect(updateDoc(legacy, { forMonth: "2026-9" })).rejects.toThrow()
    await updateDoc(legacy, { collaboratorId: null, forMonth: null })
    await updateDoc(legacy, { accountId: null, paidByOwner: true })
    // Fields that were never checked on update before: now they are.
    await expect(updateDoc(legacy, { category: "food" })).rejects.toThrow()
    await expect(updateDoc(legacy, { date: "2026-06-02" })).rejects.toThrow()
    await expect(updateDoc(legacy, { isRecurring: "no" })).rejects.toThrow()
    await expect(updateDoc(legacy, { recurrenceMonths: "1" })).rejects.toThrow()
    await updateDoc(legacy, estimateFields)
    await updateDoc(legacy, { endMonth: null, priceChanges: [], countedWhenPaid: false })
    await expect(updateDoc(legacy, { endMonth: "2027-13" })).rejects.toThrow()
    await expect(updateDoc(legacy, { countedWhenPaid: "yes" })).rejects.toThrow()
    await expect(updateDoc(legacy, { notes: 5 })).rejects.toThrow()
    // Cross-field checks see the stored fields: owner-paid now, so no account; one-off, so not recurring.
    await expect(updateDoc(legacy, { accountId: "acc-a" })).rejects.toThrow()
    await expect(updateDoc(legacy, { isRecurring: true })).rejects.toThrow()
    await expect(updateDoc(legacy, { amount: -10 })).rejects.toThrow()
    await expect(updateDoc(legacy, { userId: OTHER })).rejects.toThrow()

    // A bare legacy cost (no notes, no recurrence) still updates.
    const bareCost = mine("company_expenses")
    await setDoc(bareCost, bare(legacyExpense(), ["userId", "description", "category", "amount", "date", "isRecurring"]))
    await updateDoc(bareCost, { description: "Renamed" })
  })
})

describe("company loan validation", () => {
  const legacyLoan = (o: Record<string, unknown> = {}) => ({
    userId: uid, description: "Loan to SRL", direction: "to_company", amount: 5000, date: new Date(), notes: null, ...o,
  })
  it("accepts a loan before the cash book and one with its account", async () => {
    await setDoc(mine("company_loans"), legacyLoan())
    await setDoc(mine("company_loans"), legacyLoan({ accountId: "acc-a", dateEstimated: true, importRef: "2026:S1!2" }))
    await setDoc(mine("company_loans"), bare(legacyLoan(), ["userId", "description", "direction", "amount", "date"]))
  })
  it.each([
    ["an unknown direction", { direction: "withdrawal" }],
    ["a zero amount", { amount: 0 }],
    ["an empty description", { description: "" }],
    ["a string date", { date: "2026-06-02" }],
    ["notes over 500", { notes: "x".repeat(501) }],
    ["an account of another type", { accountId: 5 }],
    ["an empty account", { accountId: "" }],
    ["a string dateEstimated", { dateEstimated: "yes" }],
    ["an import ref over 40", { importRef: "x".repeat(41) }],
  ])("rejects %s", async (_, over) => {
    await expect(setDoc(mine("company_loans"), legacyLoan(over))).rejects.toThrow()
  })
  it("rejects another user's loan", async () => {
    await expect(setDoc(theirs("company_loans"), legacyLoan({ userId: OTHER }))).rejects.toThrow()
  })
  it("keeps updating a loan written before the cash book, and checks every field on update", async () => {
    const legacy = mine("company_loans")
    await setDoc(legacy, legacyLoan())
    await updateDoc(legacy, { amount: 6000 })
    await updateDoc(legacy, { accountId: "acc-a", date: new Date(), description: "Lend to SRL" })
    await updateDoc(legacy, { accountId: null })
    await expect(updateDoc(legacy, { description: "" })).rejects.toThrow()
    await expect(updateDoc(legacy, { date: "2026-06-02" })).rejects.toThrow()
    await expect(updateDoc(legacy, { notes: 5 })).rejects.toThrow()
    await expect(updateDoc(legacy, { accountId: 5 })).rejects.toThrow()
  })
})

describe("company account validation", () => {
  it("accepts a valid account, with or without its optional fields", async () => {
    await setDoc(mine("company_accounts"), validCompanyAccount())
    await setDoc(mine("company_accounts"), validCompanyAccount({ openingBalance: -20, importRef: "imp-1" }))
    await setDoc(mine("company_accounts"), bare(validCompanyAccount(), ["userId", "name", "openingBalance", "openingDate"]))
    await setDoc(mine("company_accounts"), validCompanyAccount({ statementBalance: 1200, statementDate: new Date() }))
  })
  it.each([
    ["an empty name", { name: "" }],
    ["a name over 100", { name: "x".repeat(101) }],
    ["a string opening balance", { openingBalance: "1000" }],
    ["a string opening date", { openingDate: "2026-05-01" }],
    ["a bank balance without its date", { statementBalance: 10 }],
    ["a statement date without its balance", { statementDate: new Date() }],
    ["a string bank balance", { statementBalance: "10", statementDate: new Date() }],
    ["an import ref over 40", { importRef: "x".repeat(41) }],
  ])("rejects %s", async (_, over) => {
    await expect(setDoc(mine("company_accounts"), validCompanyAccount(over))).rejects.toThrow()
  })
  it("rejects another user's account", async () => {
    await expect(setDoc(theirs("company_accounts"), validCompanyAccount({ userId: OTHER }))).rejects.toThrow()
    await expect(getDoc(theirs("company_accounts"))).rejects.toThrow()
  })
  it("checks the merged document on update", async () => {
    const ref = mine("company_accounts")
    await setDoc(ref, bare(validCompanyAccount(), ["userId", "name", "openingBalance", "openingDate"]))
    await updateDoc(ref, { statementBalance: 900, statementDate: new Date() })
    await updateDoc(ref, { name: "Bank B" })
    await expect(updateDoc(ref, { statementBalance: null })).rejects.toThrow()
    await expect(updateDoc(ref, { name: "" })).rejects.toThrow()
    await expect(updateDoc(ref, { userId: OTHER })).rejects.toThrow()
    await updateDoc(ref, { statementBalance: null, statementDate: null })
  })
})

describe("company settings validation", () => {
  const settings = (id = "main") => doc(db(), `users/${uid}/company_settings/${id}`)
  const valid = (o: Record<string, unknown> = {}) => ({ userId: uid, cashFloor: 10000, updatedAt: new Date(), ...o })
  it("accepts a floor, zero, and none", async () => {
    await setDoc(settings(), valid())
    await setDoc(settings(), valid({ cashFloor: 0 }))
    await setDoc(settings(), valid({ cashFloor: null }))
  })
  it.each([
    ["a negative floor", { cashFloor: -1 }],
    ["a string floor", { cashFloor: "100" }],
    ["NaN", { cashFloor: Number.NaN }],
    ["an unknown field", { note: "x" }],
    ["another user's id", { userId: OTHER }],
  ])("rejects %s", async (_, over) => {
    await expect(setDoc(settings(), valid(over))).rejects.toThrow()
  })
  it("accepts only the one document, main", async () => {
    await expect(setDoc(settings("other"), valid())).rejects.toThrow()
  })
  it("rejects another user's settings", async () => {
    const ref = doc(db(), `users/${OTHER}/company_settings/main`)
    await expect(setDoc(ref, valid({ userId: OTHER }))).rejects.toThrow()
    await expect(getDoc(ref)).rejects.toThrow()
  })
})

describe("time off validation", () => {
  const month = (id = "2026-08") => doc(db(), `users/${uid}/capacity/${id}`)
  const valid = (o: Record<string, unknown> = {}) => ({
    userId: uid, yearMonth: "2026-08", daysOff: 5, availableDays: 16, reason: "vacation", note: null, updatedAt: new Date(), ...o,
  })
  it("lets the owner write, read, change and clear a month", async () => {
    await setDoc(month(), valid())
    expect((await getDoc(month())).data()).toMatchObject({ daysOff: 5, availableDays: 16, reason: "vacation" })
    await setDoc(month(), valid({ daysOff: 0, availableDays: 21, reason: "training", note: "AWS" }))
    await deleteDoc(month())
  })
  it("lets the owner update a month the connector wrote (no userId on it)", async () => {
    await getAdminFirestore().doc(`users/${uid}/capacity/2026-09`).set({ yearMonth: "2026-09", daysOff: 3, availableDays: 19, reason: "vacation", note: null })
    expect((await getDoc(month("2026-09"))).data()?.daysOff).toBe(3)
    await setDoc(month("2026-09"), valid({ yearMonth: "2026-09", daysOff: 4, availableDays: 18 }))
  })
  it.each([
    ["more than 31 days off", { daysOff: 32 }],
    ["a negative number", { daysOff: -1 }],
    ["a string", { daysOff: "5" }],
    ["NaN", { daysOff: Number.NaN }],
    ["available days over 31", { availableDays: 40 }],
    ["a reason that is not one of the four", { reason: "holiday" }],
    ["a long note", { note: "x".repeat(501) }],
    ["a month that does not match the document", { yearMonth: "2026-09" }],
    ["a month that is not a month", { yearMonth: "2026-13" }],
    ["an unknown field", { extra: 1 }],
    ["another user's id", { userId: OTHER }],
  ])("rejects %s", async (_, over) => {
    await expect(setDoc(month(), valid(over))).rejects.toThrow()
  })
  it("lets the owner write a month with no reason, and still refuses an unknown one", async () => {
    const bare: Record<string, unknown> = valid()
    delete bare.reason
    await setDoc(month(), bare)
    await expect(setDoc(month(), valid({ reason: "holiday" }))).rejects.toThrow()
  })
  it.each(["daysOff", "availableDays"])("rejects a month with no %s", async (key) => {
    const without = valid()
    delete without[key as keyof typeof without]
    await expect(setDoc(month(), without)).rejects.toThrow()
  })
  it("rejects another user's months", async () => {
    const ref = doc(db(), `users/${OTHER}/capacity/2026-08`)
    await expect(setDoc(ref, valid({ userId: OTHER }))).rejects.toThrow()
    await expect(getDoc(ref)).rejects.toThrow()
  })
})

describe("company movement validation", () => {
  it("accepts an income, a transfer, a supplier payment, and a bare document", async () => {
    await setDoc(mine("company_movements"), validMovement())
    await setDoc(mine("company_movements"), validMovement({ kind: "transfer", direction: "out", toAccountId: "acc-b" }))
    await setDoc(mine("company_movements"), validMovement({ kind: "supplier_payment", direction: "out", expenseId: "exp-1" }))
    await setDoc(
      mine("company_movements"),
      validMovement({ kind: "deposit_held", documentRef: "R-1", project: "Project X", counterparty: "Room A", notes: "n", dateEstimated: true, importRef: "2026:S1!2" }),
    )
    await setDoc(
      mine("company_movements"),
      bare(validMovement(), ["userId", "kind", "direction", "amount", "date", "accountId", "description"]),
    )
  })
  it("accepts a rent payment on income, and refuses rent fields where they do not belong", async () => {
    await setDoc(mine("company_movements"), validMovement({ leaseId: "l1", rentMonth: "2026-10", rentPart: "contribution" }))
    await setDoc(mine("company_movements"), validMovement({ kind: "deposit_held", leaseId: "l1" }))
    for (const bad of [
      { kind: "deposit_held", rentPart: "rent" },
      { kind: "vat", direction: "out", rentPart: "rent" },
      { kind: "deposit_held", rentMonth: "2026-10" },
      { rentPart: "deposit" },
      { rentMonth: "2026-13" },
      { rentMonth: "2026-10-01" },
      { leaseId: "" },
      { leaseId: "x".repeat(201) },
    ])
      await expect(setDoc(mine("company_movements"), validMovement(bad))).rejects.toThrow()
  })
  it.each([
    ["an unknown kind", { kind: "withdrawal" }],
    ["an unknown direction", { direction: "sideways" }],
    ["a zero amount", { amount: 0 }],
    ["a negative amount", { amount: -5 }],
    ["a string date", { date: "2026-06-02" }],
    ["no account", { accountId: "" }],
    ["an empty description", { description: "" }],
    ["a description over 300", { description: "x".repeat(301) }],
    ["a document ref over 100", { documentRef: "x".repeat(101) }],
    ["a project over 60", { project: "x".repeat(61) }],
    ["a counterparty over 100", { counterparty: "x".repeat(101) }],
    ["notes over 1000", { notes: "x".repeat(1001) }],
    ["a non-boolean dateEstimated", { dateEstimated: "yes" }],
    ["an import ref over 40", { importRef: "x".repeat(41) }],
    ["a stray destination on a non-transfer", { toAccountId: "acc-b" }],
    ["a supplier document on a non-payment", { expenseId: "exp-1" }],
    ["a supplier payment without its document", { kind: "supplier_payment", direction: "out" }],
    ["a transfer to the same account", { kind: "transfer", direction: "out", toAccountId: "acc-a" }],
    ["a transfer with no destination", { kind: "transfer", direction: "out" }],
    ["a transfer coming in", { kind: "transfer", direction: "in", toAccountId: "acc-b" }],
  ])("rejects %s", async (_, over) => {
    await expect(setDoc(mine("company_movements"), validMovement(over))).rejects.toThrow()
  })
  it("rejects another user's movement", async () => {
    await expect(setDoc(theirs("company_movements"), validMovement({ userId: OTHER }))).rejects.toThrow()
    await expect(getDoc(theirs("company_movements"))).rejects.toThrow()
  })
  it("checks the merged document on update", async () => {
    const ref = mine("company_movements")
    await setDoc(ref, bare(validMovement(), ["userId", "kind", "direction", "amount", "date", "accountId", "description"]))
    await updateDoc(ref, { description: "Room B rent", dateEstimated: false })
    // Becoming a transfer needs a destination in the same write.
    await expect(updateDoc(ref, { kind: "transfer", direction: "out" })).rejects.toThrow()
    await updateDoc(ref, { kind: "transfer", direction: "out", toAccountId: "acc-b" })
    await expect(updateDoc(ref, { toAccountId: "acc-a" })).rejects.toThrow()
    await expect(updateDoc(ref, { kind: "income" })).rejects.toThrow()
    await updateDoc(ref, { kind: "income", direction: "in", toAccountId: null })
    await expect(updateDoc(ref, { amount: 0 })).rejects.toThrow()
    await deleteDoc(ref)
  })
})

describe("allocation validation", () => {
  it("accepts a valid allocation", async () => {
    await setDoc(mine("allocations"), validAllocation())
  })
  // Zero is a real value ("this month is deliberately empty"), not a missing one.
  it("accepts an explicit zero", async () => {
    await setDoc(mine("allocations"), validAllocation({ days: 0 }))
  })
  it("rejects negative days", async () => {
    await expect(setDoc(mine("allocations"), validAllocation({ days: -1 }))).rejects.toThrow()
  })
  it("rejects a malformed yearMonth", async () => {
    await expect(setDoc(mine("allocations"), validAllocation({ yearMonth: "2026-9" }))).rejects.toThrow()
  })
})

describe("timecard validation", () => {
  it("accepts a valid timecard, up to 24 hours", async () => {
    await setTimecard()
    await setTimecard({ date: "2026-09-25", hours: 24, notes: "rilascio" })
  })
  it("rejects zero hours", async () => {
    await expect(setTimecard({ hours: 0 })).rejects.toThrow()
  })
  it("rejects more than 24 hours", async () => {
    await expect(setTimecard({ hours: 24.5 })).rejects.toThrow()
  })
  it("rejects a date that is not 10 characters", async () => {
    await expect(setTimecard({ date: "2026-9-24" })).rejects.toThrow()
  })
  it("rejects notes over 1000 characters", async () => {
    await expect(setTimecard({ notes: "x".repeat(1001) })).rejects.toThrow()
  })
  it("rejects a userId that is not the owner", async () => {
    await expect(setTimecard({ userId: OTHER })).rejects.toThrow()
  })
  it("takes a collaborator's hours at engagementId_date_collaboratorId, and the owner's with null or no field", async () => {
    await setDoc(doc(db(), `users/${uid}/timecards/e1_2026-09-24_g1`), validTimecard({ collaboratorId: "g1" }))
    await setDoc(timecardAt(validTimecard()), validTimecard({ collaboratorId: null }))
    await setDoc(timecardAt(validTimecard({ date: "2026-09-25" })), validTimecard({ date: "2026-09-25" }))
  })
  it("rejects a collaborator's hours at the owner's id, and the owner's at a collaborator's id", async () => {
    await expect(setDoc(timecardAt(validTimecard()), validTimecard({ collaboratorId: "g1" }))).rejects.toThrow()
    await expect(setDoc(doc(db(), `users/${uid}/timecards/e1_2026-09-24_g1`), validTimecard({ collaboratorId: null }))).rejects.toThrow()
    await expect(setDoc(doc(db(), `users/${uid}/timecards/e1_2026-09-24_g1`), validTimecard({ collaboratorId: 7 }))).rejects.toThrow()
  })
  it("rejects an id that is not engagementId_date", async () => {
    const ref = doc(db(), `users/${uid}/timecards/e1_2026-09-23`)
    await expect(setDoc(ref, validTimecard())).rejects.toThrow()
  })
  it("rejects another user's timecard", async () => {
    const t = validTimecard({ userId: OTHER })
    await expect(setDoc(doc(db(), `users/${OTHER}/timecards/e1_2026-09-24`), t)).rejects.toThrow()
  })
})

describe("meeting validation", () => {
  it("accepts a valid verbale, a client-level one, and one with no time or health", async () => {
    await setDoc(mine("meetings"), validMeeting())
    await setDoc(mine("meetings"), validMeeting({ engagementId: null }))
    await setDoc(mine("meetings"), validMeeting({ time: null, health: null }))
  })
  it("accepts every light", async () => {
    for (const health of ["green", "yellow", "red"]) await setDoc(mine("meetings"), validMeeting({ health }))
  })
  it("accepts an update that changes, clears and re-points fields", async () => {
    const ref = mine("meetings")
    await setDoc(ref, validMeeting())
    await updateDoc(ref, { health: "red", time: "11:00", date: "2026-09-11", text: "Corretto" })
    await updateDoc(ref, { health: null, time: null, engagementId: null })
    await updateDoc(ref, { engagementId: "e2" })
  })
  it("rejects another user's verbale", async () => {
    await expect(setDoc(theirs("meetings"), validMeeting({ userId: OTHER }))).rejects.toThrow()
    await expect(setDoc(mine("meetings"), validMeeting({ userId: OTHER }))).rejects.toThrow()
  })
  // Every writer writes every field, so an absent one is a bug to refuse, not a default.
  it.each(["clientId", "engagementId", "time", "health", "date", "text"])("rejects a verbale with no %s field", async (field) => {
    await expect(setDoc(mine("meetings"), meetingWithout(field))).rejects.toThrow()
  })
  it("rejects an empty or null clientId, and an empty engagementId", async () => {
    await expect(setDoc(mine("meetings"), validMeeting({ clientId: "" }))).rejects.toThrow()
    await expect(setDoc(mine("meetings"), validMeeting({ clientId: null }))).rejects.toThrow()
    await expect(setDoc(mine("meetings"), validMeeting({ engagementId: "" }))).rejects.toThrow()
  })
  it("rejects a date or time of the wrong shape", async () => {
    await expect(setDoc(mine("meetings"), validMeeting({ date: "2026-9-1" }))).rejects.toThrow()
    await expect(setDoc(mine("meetings"), validMeeting({ date: new Date() }))).rejects.toThrow()
    await expect(setDoc(mine("meetings"), validMeeting({ time: "9:30" }))).rejects.toThrow()
    await expect(setDoc(mine("meetings"), validMeeting({ time: "10:30:00" }))).rejects.toThrow()
  })
  it("rejects an unknown health, on create and on update", async () => {
    await expect(setDoc(mine("meetings"), validMeeting({ health: "blue" }))).rejects.toThrow()
    const ref = mine("meetings")
    await setDoc(ref, validMeeting())
    await expect(updateDoc(ref, { health: "blue" })).rejects.toThrow()
  })
  // Written with the app's constant, so changing it without the rule fails here.
  it("caps the text at MEETING_TEXT_MAX characters and refuses an empty one", async () => {
    await setDoc(mine("meetings"), validMeeting({ text: "x".repeat(MEETING_TEXT_MAX) }))
    await expect(setDoc(mine("meetings"), validMeeting({ text: "x".repeat(MEETING_TEXT_MAX + 1) }))).rejects.toThrow()
    await expect(setDoc(mine("meetings"), validMeeting({ text: "" }))).rejects.toThrow()
    const ref = mine("meetings")
    await setDoc(ref, validMeeting())
    await expect(updateDoc(ref, { text: "" })).rejects.toThrow()
  })
})

const validCollaborator = (o: Record<string, unknown> = {}) => ({
  userId: uid, name: "Studio Verdi", type: "company", notes: null, isActive: true,
  fee: { amount: 2400, from: "2026-01", until: null, changes: [{ from: "2027-03", amount: 2600 }] },
  createdAt: new Date(), updatedAt: new Date(), ...o,
})
const fee = (o: Record<string, unknown> = {}) => ({ amount: 2400, from: "2026-01", until: null, changes: [], ...o })
const feeChanges = (n: number) => Array.from({ length: n }, (_, i) => ({ from: `${2027 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, amount: 1 }))

describe("collaborator validation", () => {
  it("accepts one with a fee, with no fee, and an inactive one", async () => {
    await setDoc(mine("collaborators"), validCollaborator())
    await setDoc(mine("collaborators"), validCollaborator({ fee: null, notes: "Design", type: "freelancer" }))
    await setDoc(mine("collaborators"), validCollaborator({ isActive: false, fee: fee({ until: "2026-06" }) }))
  })
  it("accepts a fee and a change at the cap, and as many changes as the cap", async () => {
    await setDoc(mine("collaborators"), validCollaborator({ fee: fee({ amount: MAX_FEE, changes: feeChanges(MAX_FEE_CHANGES) }) }))
  })
  it("lets the owner change the fee and delete it", async () => {
    const ref = mine("collaborators")
    await setDoc(ref, validCollaborator())
    await updateDoc(ref, { fee: fee({ amount: 3000 }) })
    await deleteDoc(ref)
  })
  it("rejects another user's collaborator", async () => {
    await expect(setDoc(theirs("collaborators"), validCollaborator({ userId: OTHER }))).rejects.toThrow()
    await expect(setDoc(mine("collaborators"), validCollaborator({ userId: OTHER }))).rejects.toThrow()
  })
  it.each(["name", "type", "notes", "isActive", "fee"])("rejects one with no %s field", async (field) => {
    const d: Record<string, unknown> = validCollaborator()
    delete d[field]
    await expect(setDoc(mine("collaborators"), d)).rejects.toThrow()
  })
  it("rejects a bad name, type, notes or active flag", async () => {
    for (const bad of [{ name: "" }, { name: "x".repeat(201) }, { type: "employee" }, { notes: "x".repeat(2001) }, { isActive: "yes" }]) {
      await expect(setDoc(mine("collaborators"), validCollaborator(bad)), JSON.stringify(bad)).rejects.toThrow()
    }
  })
  it("rejects a bad fee, on create and on update", async () => {
    for (const bad of [
      fee({ amount: 0 }), fee({ amount: MAX_FEE + 1 }), fee({ amount: "2400" }), fee({ from: "2026-13" }), fee({ from: "Jan 2026" }),
      fee({ until: "2025-12" }), fee({ until: "2026-6" }), fee({ changes: "none" }),
      fee({ changes: feeChanges(MAX_FEE_CHANGES + 1) }),
      { amount: 1, from: "2026-01", until: null }, { ...fee(), extra: 1 },
    ]) {
      await expect(setDoc(mine("collaborators"), validCollaborator({ fee: bad })), JSON.stringify(bad)).rejects.toThrow()
    }
    const ref = mine("collaborators")
    await setDoc(ref, validCollaborator())
    await expect(updateDoc(ref, { fee: fee({ until: "2025-01" }) })).rejects.toThrow()
  })
})

/** An assignment's id is `${collaboratorId}_${engagementId}`; the rules refuse any other. */
const assignmentAt = (a: { collaboratorId: unknown; engagementId: unknown }) =>
  doc(db(), `users/${uid}/collaborator_assignments/${a.collaboratorId}_${a.engagementId}`)
const setAssignment = (o: Record<string, unknown> = {}) => {
  const a = validAssignment(o)
  return setDoc(assignmentAt(a), a)
}
const validAssignment = (o: Record<string, unknown> = {}) => ({
  userId: uid, collaboratorId: "c1", engagementId: "e1", dailyRate: 320, from: "2026-09", until: "2027-02",
  defaultDays: 4, monthDays: { "2026-11": 6 }, createdAt: new Date(), updatedAt: new Date(), ...o,
})

describe("assignment validation", () => {
  it("accepts one with and without an end, a zero-day default, and an empty map", async () => {
    await setAssignment()
    await setAssignment({ until: null, defaultDays: 0, monthDays: {} })
    await setAssignment({ dailyRate: 1000000, defaultDays: 31 })
  })
  it("lets the owner update and delete it", async () => {
    const a = validAssignment({ collaboratorId: freshId() })
    const ref = assignmentAt(a)
    await setDoc(ref, a)
    await updateDoc(ref, { monthDays: { "2026-12": 2 } })
    await deleteDoc(ref)
  })
  it("keeps an assignment on its collaborator and contract: they cannot be moved by an update", async () => {
    const a = validAssignment({ collaboratorId: freshId() })
    const ref = assignmentAt(a)
    await setDoc(ref, a)
    await expect(updateDoc(ref, { engagementId: "e2" })).rejects.toThrow()
    await expect(updateDoc(ref, { collaboratorId: "g2" })).rejects.toThrow()
    await updateDoc(ref, { dailyRate: 300 })
  })
  it("rejects another user's assignment", async () => {
    await expect(setDoc(theirs("collaborator_assignments"), validAssignment({ userId: OTHER }))).rejects.toThrow()
    await expect(setAssignment({ userId: OTHER })).rejects.toThrow()
  })
  it.each(["collaboratorId", "engagementId", "dailyRate", "from", "until", "defaultDays", "monthDays"])("rejects one with no %s field", async (field) => {
    const d: Record<string, unknown> = validAssignment()
    delete d[field]
    await expect(setDoc(assignmentAt(validAssignment()), d)).rejects.toThrow()
  })
  it("rejects a bad rate, month, end, days or map", async () => {
    const tooMany = Object.fromEntries(Array.from({ length: 121 }, (_, i) => [`${2030 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, 1]))
    for (const bad of [
      { dailyRate: 0 }, { dailyRate: 1000001 }, { dailyRate: "320" }, { from: "2026-13" }, { from: "Sep 2026" },
      { until: "2026-08" }, { until: "2027-2" }, { defaultDays: -1 }, { defaultDays: 32 }, { defaultDays: "4" },
      { monthDays: "none" }, { monthDays: tooMany }, { collaboratorId: "" },
    ]) {
      await expect(setAssignment(bad), JSON.stringify(bad)).rejects.toThrow()
    }
  })
})

describe("journal validation", () => {
  it("accepts a work session, a decision and an entry with every optional field empty", async () => {
    await setDoc(mine("journal"), validJournalEntry())
    await setDoc(mine("journal"), validJournalEntry({ kind: "decision", decisions: [] }))
    await setDoc(mine("journal"), validJournalEntry({ stepTitle: null, decisions: [], links: [], next: null, source: "Claude Code" }))
  })
  it.each(["solutionId", "clientId", "kind", "date", "text", "decisions", "links"])("rejects an entry with no %s field", async (field) => {
    const d: Record<string, unknown> = validJournalEntry()
    delete d[field]
    await expect(setDoc(mine("journal"), d)).rejects.toThrow()
  })
  it("rejects an unknown kind, a blank or over-long id, a bad date and another user's entry", async () => {
    for (const bad of [
      { kind: "call" }, { kind: null }, { solutionId: "" }, { solutionId: null }, { clientId: "" },
      { date: "2026-02-30x" }, { date: "7 Nov" }, { userId: OTHER },
    ]) {
      await expect(setDoc(mine("journal"), validJournalEntry(bad)), JSON.stringify(bad)).rejects.toThrow()
    }
    await expect(setDoc(theirs("journal"), validJournalEntry({ userId: OTHER }))).rejects.toThrow()
  })
  it("pins the text caps and the list sizes", async () => {
    await setDoc(mine("journal"), validJournalEntry({ text: "x".repeat(JOURNAL_TEXT_MAX), next: "x".repeat(JOURNAL_LINE_MAX) }))
    for (const bad of [
      { text: "x".repeat(JOURNAL_TEXT_MAX + 1) }, { text: "" }, { next: "x".repeat(JOURNAL_LINE_MAX + 1) },
      { stepTitle: "x".repeat(201) }, { source: "x".repeat(JOURNAL_SOURCE_MAX + 1) },
      { decisions: listOf(MAX_JOURNAL_DECISIONS + 1) }, { links: listOf(MAX_JOURNAL_LINKS + 1) },
    ]) {
      await expect(setDoc(mine("journal"), validJournalEntry(bad)), JSON.stringify(bad).slice(0, 80)).rejects.toThrow()
    }
    await setDoc(mine("journal"), validJournalEntry({ decisions: listOf(MAX_JOURNAL_DECISIONS), links: listOf(MAX_JOURNAL_LINKS) }))
  })
  it("never lets an update change the solution or the kind", async () => {
    const ref = mine("journal")
    await setDoc(ref, validJournalEntry())
    await updateDoc(ref, { text: "Edited" })
    await expect(updateDoc(ref, { solutionId: "s2" })).rejects.toThrow()
    await expect(updateDoc(ref, { kind: "decision" })).rejects.toThrow()
    await expect(updateDoc(ref, { text: "x".repeat(JOURNAL_TEXT_MAX + 1) })).rejects.toThrow()
  })
})

describe("solution validation", () => {
  it("accepts a full solution, a pre-sales one, and one with nothing filled in yet", async () => {
    await setDoc(mine("solutions"), validSolution())
    await setDoc(mine("solutions"), validSolution({ engagementId: null, domain: null }))
    await setDoc(mine("solutions"), validSolution({ stack: [], entities: [], relations: [], sections: {} }))
    await setDoc(mine("solutions"), validSolution({ sections: Object.fromEntries(SOLUTION_SECTIONS.map((s) => [s.key, "Text"])) }))
  })
  it("accepts every status", async () => {
    for (const status of ["proposed", "building", "delivered", "retired"]) await setDoc(mine("solutions"), validSolution({ status }))
  })
  it("accepts an update of each kind the app makes", async () => {
    const ref = mine("solutions")
    await setDoc(ref, validSolution())
    await updateDoc(ref, { name: "Product graph", status: "retired", domain: null, stack: ["neo4j"] })
    await updateDoc(ref, { "sections.history": "2026-05-12 From nightly CSV to Debezium CDC", "sections.kpis": null })
    await updateDoc(ref, { entities: [{ name: "Order", source: null, notes: null }], relations: [] })
    // A deleted contract leaves the solution on its client.
    await updateDoc(ref, { engagementId: null, clientId: "c1" })
    await updateDoc(ref, { engagementId: "e2" })
  })
  // incoming() is the merged document: a stored solution must stay editable as it is.
  it("still updates a stored solution whose sections map lacks keys", async () => {
    const ref = mine("solutions")
    await setDoc(ref, validSolution({ sections: { purpose: "Why" } }))
    await updateDoc(ref, { name: "Renamed" })
    await updateDoc(ref, { "sections.results": "Zero-result searches from 12% to 4%" })
  })
  it("rejects another user's solution", async () => {
    await expect(setDoc(theirs("solutions"), validSolution({ userId: OTHER }))).rejects.toThrow()
    await expect(setDoc(mine("solutions"), validSolution({ userId: OTHER }))).rejects.toThrow()
    const ref = mine("solutions")
    await setDoc(ref, validSolution())
    await expect(updateDoc(ref, { userId: OTHER })).rejects.toThrow()
  })
  it.each(["clientId", "engagementId", "name", "status", "domain", "stack", "sections", "entities", "relations"])(
    "rejects a solution with no %s field",
    async (field) => {
      await expect(setDoc(mine("solutions"), solutionWithout(field))).rejects.toThrow()
    },
  )
  it("rejects an empty or null client, an empty contract, and a bad name or domain", async () => {
    for (const bad of [
      { clientId: "" }, { clientId: null }, { engagementId: "" }, { name: "" }, { name: "x".repeat(201) },
      { domain: "" }, { domain: "x".repeat(61) }, { domain: 3 },
    ]) {
      await expect(setDoc(mine("solutions"), validSolution(bad)), JSON.stringify(bad)).rejects.toThrow()
    }
  })
  it("rejects an unknown status, on create and on update", async () => {
    await expect(setDoc(mine("solutions"), validSolution({ status: "archived" }))).rejects.toThrow()
    const ref = mine("solutions")
    await setDoc(ref, validSolution())
    await expect(updateDoc(ref, { status: "archived" })).rejects.toThrow()
  })
  // kind, target and steps came later: a solution stored without them must stay editable, and an old bundle can still create one.
  it("accepts a solution with no kind, target or steps, and updates it", async () => {
    const legacy: Record<string, unknown> = validSolution()
    for (const k of ["kind", "target", "steps"]) delete legacy[k]
    const ref = mine("solutions")
    await setDoc(ref, legacy)
    await updateDoc(ref, { name: "Renamed" })
    await updateDoc(ref, { kind: "advisory", target: "Every report under 2 s", steps: [] })
  })
  it("rejects an unknown kind, on create and on update", async () => {
    await expect(setDoc(mine("solutions"), validSolution({ kind: "service" }))).rejects.toThrow()
    const ref = mine("solutions")
    await setDoc(ref, validSolution())
    await expect(updateDoc(ref, { kind: "service" })).rejects.toThrow()
    await updateDoc(ref, { kind: "advisory" })
  })
  it("checks the target is text of at most its cap or null, on create and on update", async () => {
    await setDoc(mine("solutions"), validSolution({ target: "x".repeat(SOLUTION_TARGET_MAX) }))
    await expect(setDoc(mine("solutions"), validSolution({ target: "x".repeat(SOLUTION_TARGET_MAX + 1) }))).rejects.toThrow()
    await expect(setDoc(mine("solutions"), validSolution({ target: 3 }))).rejects.toThrow()
    const ref = mine("solutions")
    await setDoc(ref, validSolution())
    await expect(updateDoc(ref, { target: "x".repeat(SOLUTION_TARGET_MAX + 1) })).rejects.toThrow()
  })
  it("checks steps is a list of at most its cap, on create and on update", async () => {
    const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `S${i}`, state: "next", fromMonth: "2026-03" }))
    await setDoc(mine("solutions"), validSolution({ steps: steps(MAX_SOLUTION_STEPS) }))
    await expect(setDoc(mine("solutions"), validSolution({ steps: steps(MAX_SOLUTION_STEPS + 1) }))).rejects.toThrow()
    await expect(setDoc(mine("solutions"), validSolution({ steps: "Audit, tune" }))).rejects.toThrow()
    const ref = mine("solutions")
    await setDoc(ref, validSolution())
    await updateDoc(ref, { steps: steps(MAX_SOLUTION_STEPS) })
    await expect(updateDoc(ref, { steps: steps(MAX_SOLUTION_STEPS + 1) })).rejects.toThrow()
  })
  // Written with the app's constants, so changing one without the rule fails here.
  it.each([
    ["stack", MAX_SOLUTION_STACK, listOf],
    ["entities", MAX_SOLUTION_ENTITIES, (n: number) => listOf(n).map((name) => ({ name, source: null, notes: null }))],
    ["relations", MAX_SOLUTION_RELATIONS, (n: number) => listOf(n).map(() => ({ from: "Product", to: "Category", type: "X" }))],
  ] as const)("checks %s is a list of at most its cap, on create and on update", async (field, cap, make) => {
    await setDoc(mine("solutions"), validSolution({ [field]: make(cap) }))
    await expect(setDoc(mine("solutions"), validSolution({ [field]: make(cap + 1) }))).rejects.toThrow()
    await expect(setDoc(mine("solutions"), validSolution({ [field]: "neo4j, kafka" }))).rejects.toThrow()
    const ref = mine("solutions")
    await setDoc(ref, validSolution())
    await updateDoc(ref, { [field]: make(cap) })
    await expect(updateDoc(ref, { [field]: make(cap + 1) })).rejects.toThrow()
    await expect(updateDoc(ref, { [field]: { 0: "x" } })).rejects.toThrow()
  })
  it.each(SOLUTION_SECTIONS.map((s) => s.key))(
    "takes %s up to SOLUTION_SECTION_MAX characters, on create and on update",
    async (key) => {
      await setDoc(mine("solutions"), validSolution({ sections: { [key]: "x".repeat(SOLUTION_SECTION_MAX) } }))
      await expect(setDoc(mine("solutions"), validSolution({ sections: { [key]: "x".repeat(SOLUTION_SECTION_MAX + 1) } }))).rejects.toThrow()
      const ref = mine("solutions")
      await setDoc(ref, validSolution())
      await expect(updateDoc(ref, { [`sections.${key}`]: "x".repeat(SOLUTION_SECTION_MAX + 1) })).rejects.toThrow()
      await expect(updateDoc(ref, { [`sections.${key}`]: 42 })).rejects.toThrow()
    },
  )
  it("rejects a section key outside the nine, and sections that are not a map", async () => {
    await expect(setDoc(mine("solutions"), validSolution({ sections: { purpose: "Why", appendix: "No" } }))).rejects.toThrow()
    await expect(setDoc(mine("solutions"), validSolution({ sections: "Why" }))).rejects.toThrow()
    await expect(setDoc(mine("solutions"), validSolution({ sections: null }))).rejects.toThrow()
    const ref = mine("solutions")
    await setDoc(ref, validSolution())
    await expect(updateDoc(ref, { "sections.appendix": "No" })).rejects.toThrow()
  })
})

/**
 * api_keys_index maps a key hash to a userId and is queried server-side by the
 * Admin SDK, which bypasses rules. It used to be `allow read: if true`, which
 * published the whole hash set — enough to confirm guessed API keys offline,
 * with no rate limit and no trace. These tests pin it shut.
 */
describe("api_keys_index read scoping", () => {
  /** Writes a doc as the emulator owner, bypassing rules — the only way to plant another user's row. */
  async function seedIndexDoc(docId: string, ownerUid: string) {
    const res = await fetch(
      `${firestoreRestBase(emulatorHosts().firestore)}/api_keys_index?documentId=${docId}`,
      {
        method: "POST",
        headers: { Authorization: "Bearer owner", "content-type": "application/json" },
        body: JSON.stringify({
          fields: { userId: { stringValue: ownerUid }, keyHash: { stringValue: `hash-${docId}` } },
        }),
      }
    )
    if (!res.ok) throw new Error(`seed failed: ${res.status}`)
  }

  it("can read its own index entry", async () => {
    const id = `idx-mine-${freshId()}`
    await seedIndexDoc(id, uid)
    const snap = await getDoc(doc(db(), `api_keys_index/${id}`))
    expect(snap.data()?.userId).toBe(uid)
  })

  it("cannot read another user's index entry", async () => {
    const id = `idx-theirs-${freshId()}`
    await seedIndexDoc(id, OTHER)
    await expect(getDoc(doc(db(), `api_keys_index/${id}`))).rejects.toThrow()
  })

  it("cannot create an index entry pointing at another user", async () => {
    await expect(
      setDoc(doc(db(), `api_keys_index/idx-forged-${freshId()}`), {
        userId: OTHER,
        keyHash: "forged",
      })
    ).rejects.toThrow()
  })
})

describe("api_keys_index is server-written (#342)", () => {
  // A client-made index row was a working key that Settings never listed.
  it("refuses a client create with no matching api_keys doc", async () => {
    await expect(
      setDoc(doc(db(), `api_keys_index/idx-bare-${freshId()}`), { userId: uid, keyHash: "x" })
    ).rejects.toThrow()
  })

  it("refuses a client create even with a matching api_keys doc", async () => {
    const keyId = `k-${freshId()}`
    // The owner bearer bypasses the rules, as the server does.
    const seed = await fetch(
      `${firestoreRestBase(emulatorHosts().firestore)}/users/${uid}/api_keys?documentId=${keyId}`,
      {
        method: "POST",
        headers: { Authorization: "Bearer owner", "content-type": "application/json" },
        body: JSON.stringify({ fields: { keyHash: { stringValue: "h" } } }),
      }
    )
    expect(seed.ok).toBe(true)
    await expect(
      setDoc(doc(db(), `api_keys_index/idx-paired-${freshId()}`), {
        userId: uid,
        keyHash: "h",
        apiKeyDocId: keyId,
      })
    ).rejects.toThrow()
  })
})

describe("users/{uid}/api_keys is server-created (#342)", () => {
  it("refuses a client create", async () => {
    await expect(
      setDoc(doc(db(), `users/${uid}/api_keys/decoy-${freshId()}`), { userId: uid, keyHash: "x" })
    ).rejects.toThrow()
  })
})

describe("oauth collections are server-only", () => {
  // These hold authorization codes and token hashes. The Admin SDK bypasses
  // rules, so a client has no reason to reach them — and every reason not to.
  for (const col of ["oauth_clients", "oauth_codes", "oauth_tokens"]) {
    it(`rejects reading ${col}`, async () => {
      await expect(getDoc(doc(db(), `${col}/anything`))).rejects.toThrow()
    })
    it(`rejects writing ${col}`, async () => {
      await expect(setDoc(doc(db(), `${col}/anything`), { x: 1 })).rejects.toThrow()
    })
  }
})

describe("mcp collections are server-only", () => {
  // The MCP audit trail is Admin-SDK-only: a client reading it would see tool params.
  // (Capacity, the time off the Plan sets, is the owner's: see "time off validation".)
  for (const col of ["mcp_audit"]) {
    it(`rejects reading own ${col}`, async () => {
      await expect(getDoc(doc(db(), `users/${uid}/${col}/anything`))).rejects.toThrow()
    })
    it(`rejects writing own ${col}`, async () => {
      await expect(setDoc(doc(db(), `users/${uid}/${col}/anything`), { x: 1 })).rejects.toThrow()
    })
  }
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
  { col: "clients", doc: () => validClient(), wrong: { name: 5 } },
  { col: "opportunities", doc: () => validOpportunity(), wrong: { title: 5 } },
  { col: "engagements", doc: () => validEngagement(), wrong: { startMonth: 202609 } },
  { col: "tasks", doc: () => validTask(), wrong: { title: 5 } },
  {
    col: "timecards",
    doc: () => validTimecard({ engagementId: freshId() }),
    wrong: { hours: "6" },
    id: (d) => `${d.engagementId}_${d.date}`,
  },
  { col: "meetings", doc: () => validMeeting(), wrong: { text: 5 } },
  { col: "solutions", doc: () => validSolution(), wrong: { name: 5 } },
  { col: "invoices", doc: () => validInvoice(), wrong: { number: 5 } },
  { col: "allocations", doc: () => validAllocation(), wrong: { days: "10" } },
  {
    col: "company_expenses",
    doc: () => ({ userId: uid, description: "Rent", category: "rent", amount: 100, date: ts() }),
    wrong: { description: 5 },
  },
  {
    col: "company_loans",
    doc: () => ({ userId: uid, description: "Loan", direction: "to_company", amount: 100, date: ts() }),
    wrong: { description: 5 },
  },
  { col: "company_accounts", doc: () => validCompanyAccount(), wrong: { name: 5 } },
  { col: "company_movements", doc: () => validMovement(), wrong: { description: 5 } },
  { col: "company_deadlines", doc: () => validDeadline(), wrong: { title: 5 } },
  {
    col: "collaborators",
    doc: () => ({ userId: uid, name: "Ada", type: "freelancer", notes: null, isActive: true, fee: null }),
    wrong: { name: 5 },
  },
  {
    col: "collaborator_assignments",
    doc: () => validAssignment({ collaboratorId: freshId() }),
    wrong: { dailyRate: "320" },
    id: (d) => `${d.collaboratorId}_${d.engagementId}`,
  },
]

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

describe("numbers and months (#352)", () => {
  it.each([NaN, Infinity, -Infinity, 1e15])("refuses %s as an amount", async (bad) => {
    await expect(setDoc(mine("company_accounts"), validCompanyAccount({ openingBalance: bad }))).rejects.toThrow()
    await expect(setDoc(mine("invoices"), validInvoice({ amount: bad }))).rejects.toThrow()
  })
  it("refuses a NaN on update", async () => {
    const ref = mine("invoices")
    await setDoc(ref, validInvoice())
    await expect(updateDoc(ref, { vat: NaN })).rejects.toThrow()
  })
  it.each(["abcdefg", "2026-13", "2026-00", "2026/09", "2026-9"])("refuses %s as an invoice month", async (ym) => {
    await expect(setDoc(mine("invoices"), validInvoice({ yearMonth: ym }))).rejects.toThrow()
    await expect(setDoc(mine("allocations"), validAllocation({ yearMonth: ym }))).rejects.toThrow()
  })
  it("refuses a malformed date string on a contract and a meeting", async () => {
    await expect(setDoc(mine("engagements"), validEngagement({ endDate: "2026-13-45" }))).rejects.toThrow()
    await expect(setDoc(mine("meetings"), validMeeting({ date: "yesterday!" }))).rejects.toThrow()
  })
})

describe("assignment id is the pair (#352)", () => {
  it("refuses a second assignment for the pair at another id", async () => {
    const a = validAssignment({ collaboratorId: freshId() })
    await setDoc(assignmentAt(a), a)
    await expect(setDoc(mine("collaborator_assignments"), a)).rejects.toThrow()
  })
})

describe("dead settings collections (#352)", () => {
  it("refuses a create of timesheet_settings and tax_regime_settings", async () => {
    await expect(setDoc(mine("timesheet_settings"), { userId: uid, yearlyGrossCompensation: 1 })).rejects.toThrow()
    await expect(
      setDoc(mine("tax_regime_settings"), {
        userId: uid, ivaCadence: "monthly", priorYearCorporateTax: 0, inpsRegime: "reduced",
        addizionaleRegionale: 0, addizionaleComunale: 0,
      }),
    ).rejects.toThrow()
  })
  it("still lets the owner read and delete a stored one", async () => {
    const id = freshId()
    const res = await fetch(`${firestoreRestBase(emulatorHosts().firestore)}/users/${uid}/timesheet_settings?documentId=${id}`, {
      method: "POST",
      headers: { Authorization: "Bearer owner", "content-type": "application/json" },
      body: JSON.stringify({ fields: { userId: { stringValue: uid } } }),
    })
    expect(res.ok).toBe(true)
    const ref = doc(db(), `users/${uid}/timesheet_settings/${id}`)
    expect((await getDoc(ref)).exists()).toBe(true)
    await deleteDoc(ref)
  })
})

describe("default deny (#352)", () => {
  it("refuses a collection-group query", async () => {
    await expect(getDocs(collectionGroup(db(), "company_expenses"))).rejects.toThrow()
  })
  it("refuses listing another user's collection", async () => {
    await expect(getDocs(collection(db(), `users/${OTHER}/clients`))).rejects.toThrow()
  })
  it("refuses the user document, an unknown subcollection and an unknown top-level path", async () => {
    await expect(getDoc(doc(db(), `users/${uid}`))).rejects.toThrow()
    await expect(getDoc(doc(db(), `users/${uid}/unknown/x`))).rejects.toThrow()
    await expect(setDoc(doc(db(), `users/${uid}/unknown/x`), { userId: uid })).rejects.toThrow()
    await expect(getDoc(doc(db(), "whatever/x"))).rejects.toThrow()
  })
  it("refuses a list and a collection-group query of the server-only collections", async () => {
    for (const col of ["mcp_audit"]) {
      await expect(getDocs(collection(db(), `users/${uid}/${col}`))).rejects.toThrow()
      await expect(getDocs(collectionGroup(db(), col))).rejects.toThrow()
    }
    for (const col of ["oauth_clients", "oauth_codes", "oauth_tokens"]) {
      await expect(getDocs(collection(db(), col))).rejects.toThrow()
    }
  })
})

describe("signed out (#352)", () => {
  const base = () => firestoreRestBase(emulatorHosts().firestore)
  it.each(["clients", "company_expenses", "capacity"])("refuses a read of %s", async (col) => {
    const res = await fetch(`${base()}/users/${uid}/${col}/x`)
    expect(res.status).toBe(403)
    const list = await fetch(`${base()}/users/${uid}/${col}`)
    expect(list.status).toBe(403)
  })
  it("refuses a write", async () => {
    const res = await fetch(`${base()}/users/${uid}/clients?documentId=signedout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: { userId: { stringValue: uid } } }),
    })
    expect(res.status).toBe(403)
  })
  it("refuses a collection-group query", async () => {
    const res = await fetch(`${base()}:runQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "company_expenses", allDescendants: true }] } }),
    })
    expect(res.status).toBe(403)
  })
})

describe("the invoice file on a cost and an invoice", () => {
  const file = (o: Record<string, unknown> = {}) => ({
    path: `users/${uid}/company-files/abc.xml`, name: "IT01_00001.xml", kind: "xml", size: 1234, uploadedAt: new Date(), ...o,
  })
  const cost = (o: Record<string, unknown> = {}) => ({
    userId: uid, description: "Bookkeeping", category: "accountant", amount: 900, date: new Date(),
    isRecurring: false, recurrenceMonths: null, notes: null, ...o,
  })
  const kinds = [
    { col: "company_expenses", make: cost },
    { col: "invoices", make: validInvoice },
  ]

  it.each(kinds)("$col: accepts a file, a null file and none", async ({ make, col }) => {
    await setDoc(mine(col), make({ file: file() }))
    await setDoc(mine(col), make({ file: file({ kind: "p7m", path: `users/${uid}/company-files/abc.xml.p7m`, size: 10485760 }) }))
    await setDoc(mine(col), make({ file: null }))
    await setDoc(mine(col), make({}))
  })

  it.each(kinds)("$col: refuses a file with another shape", async ({ make, col }) => {
    const bad: Record<string, unknown>[] = [
      file({ kind: "docx" }),
      file({ size: 10485761 }),
      file({ size: -1 }),
      file({ size: 1.5 }),
      file({ name: "" }),
      file({ uploadedAt: "yesterday" }),
      file({ path: `users/${OTHER}/company-files/abc.xml` }),
      file({ path: `users/${uid}/company-files/a/b.xml` }),
      file({ path: `users/${uid}/elsewhere/abc.xml` }),
      { ...file(), extra: 1 },
      { path: file().path, name: "x.xml", kind: "xml", size: 1 },
    ]
    for (const f of bad) await expect(setDoc(mine(col), make({ file: f }))).rejects.toThrow()
    await expect(setDoc(mine(col), make({ file: "IT01.xml" }))).rejects.toThrow()
  })

  it.each(kinds)("$col: an update replaces and clears the file, and refuses a bad one", async ({ make, col }) => {
    const ref = mine(col)
    await setDoc(ref, make({ file: file() }))
    await updateDoc(ref, { file: file({ name: "other.xml" }) })
    await updateDoc(ref, { file: null })
    await expect(updateDoc(ref, { file: file({ kind: "exe" }) })).rejects.toThrow()
  })
})

// The rent module's collections (packages/modules/rent/src/rent.rules).
describe("rent validation", () => {
  const stamp = { createdAt: new Date(), updatedAt: new Date() }
  const validTenant = (o: Record<string, unknown> = {}) => ({
    userId: uid, firstName: "Tomas", surname: "Vaitkus", taxId: "39501010000", street: "Gedimino pr. 12",
    postcode: "01103", city: "Vilnius", province: null, country: "Lithuania", ...stamp, ...o,
  })
  const validLease = (o: Record<string, unknown> = {}) => ({
    userId: uid, tenantId: "t1", property: "Via Aurora 7", room: "Room 2", rent: 1000, contribution: 150,
    startDate: "2026-09-01", endDate: "2027-08-31", paidBy: null, ...stamp, ...o,
  })

  it("accepts a tenant and a lease, and an update of each", async () => {
    const t = mine("tenants")
    await setDoc(t, validTenant())
    await updateDoc(t, { city: "Kaunas", province: "KA" })
    const l = mine("leases")
    await setDoc(l, validLease({ contribution: null, paidBy: "Darius" }))
    await updateDoc(l, { endDate: "2027-01-31" })
  })
  it("accepts a tenant and a lease whose tax ID, address and room are null, on create and on update", async () => {
    const t = mine("tenants")
    await setDoc(t, validTenant({ taxId: null, street: null, postcode: null, city: null, country: null }))
    await updateDoc(t, { taxId: "39501010000", city: null })
    const l = mine("leases")
    await setDoc(l, validLease({ room: null }))
    await updateDoc(l, { room: "Room 3" })
    await updateDoc(l, { room: null })
  })
  it.each([
    ["a tax ID that is a number", { taxId: 5 }],
    ["an empty street", { street: "" }],
    ["a city longer than 100", { city: "x".repeat(101) }],
    ["a country that is a map", { country: {} }],
  ])("still rejects a tenant with %s", async (_name, bad) => {
    await expect(setDoc(mine("tenants"), validTenant(bad))).rejects.toThrow()
  })
  it("still rejects a lease whose room is not a string", async () => {
    await expect(setDoc(mine("leases"), validLease({ room: 7 }))).rejects.toThrow()
  })
  it("refuses to delete either", async () => {
    const t = mine("tenants")
    await setDoc(t, validTenant())
    await expect(deleteDoc(t)).rejects.toThrow()
    const l = mine("leases")
    await setDoc(l, validLease())
    await expect(deleteDoc(l)).rejects.toThrow()
  })
  it.each([
    ["no end date", { endDate: null }],
    ["a missing end date", { endDate: undefined }],
    ["an end before its start", { endDate: "2026-08-31" }],
    ["a negative rent", { rent: -1 }],
    ["a rent over the cap", { rent: MAX_RENT + 1 }],
    ["a negative contribution", { contribution: -5 }],
    ["a start that is not a date", { startDate: "2026-9-1" }],
    ["an empty room", { room: "" }],
    ["a property longer than a cost centre", { property: "x".repeat(MAX_PROPERTY + 1) }],
  ])("rejects a lease with %s, on create and on update", async (_name, bad) => {
    const d: Record<string, unknown> = validLease(bad)
    if (d.endDate === undefined) delete d.endDate
    await expect(setDoc(mine("leases"), d)).rejects.toThrow()
    const ref = mine("leases")
    await setDoc(ref, validLease())
    await expect(setDoc(ref, d)).rejects.toThrow()
  })
  it("accepts agreed months, up to 24, and refuses more or a non-map", async () => {
    const months = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${2026 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, { amount: 800, note: "Moved in" }]))
    await setDoc(mine("leases"), validLease({ agreedMonths: months(24) }))
    await expect(setDoc(mine("leases"), validLease({ agreedMonths: months(25) }))).rejects.toThrow()
    await expect(setDoc(mine("leases"), validLease({ agreedMonths: "2026-09" }))).rejects.toThrow()
    const ref = mine("leases")
    await setDoc(ref, validLease())
    await updateDoc(ref, { agreedMonths: months(1) })
    await expect(updateDoc(ref, { agreedMonths: months(25) })).rejects.toThrow()
  })
  it("accepts a rent at the cap, a property at the cap and a one-day lease", async () => {
    await setDoc(mine("leases"), validLease({ rent: MAX_RENT, property: "x".repeat(MAX_PROPERTY), startDate: "2026-09-01", endDate: "2026-09-01" }))
  })
  it("rejects a tenant with no tax ID or surname, and another user's data", async () => {
    await expect(setDoc(mine("tenants"), validTenant({ taxId: "" }))).rejects.toThrow()
    await expect(setDoc(mine("tenants"), validTenant({ surname: "" }))).rejects.toThrow()
    await expect(setDoc(theirs("tenants"), validTenant({ userId: OTHER }))).rejects.toThrow()
    await expect(setDoc(theirs("leases"), validLease({ userId: OTHER }))).rejects.toThrow()
  })
})
