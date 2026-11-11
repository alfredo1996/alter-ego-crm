/**
 * firebase-admin CRM functions — emulator integration tests.
 *
 * Mirrors firebaseadmin.adapter.test.ts: direct Admin SDK seeding, fixed
 * userId, afterEach delete-all cleanup. Focus: filtered queries return exactly
 * what their filters promise, and Timestamp fields round-trip as Dates.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts).
 */
import { afterEach, describe, it, expect, vi } from "vitest"

import * as admin from "@/lib/backend/firebase-admin"
import { BILL_HAS_PAYMENTS } from "@/lib/cash-book"
import { getAdminBucket, getAdminFirestore } from "@/lib/firebase-admin-client"

import type * as AdminClient from "@/lib/firebase-admin-client"

// Passes through; one test swaps in a bucket whose delete fails.
vi.mock("@/lib/firebase-admin-client", async (orig) => {
  const actual = await orig<typeof AdminClient>()
  return { ...actual, getAdminBucket: vi.fn(actual.getAdminBucket) }
})

const userId = "admin-crm-user"

// FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST come from vitest.emulator.setup.ts.

const userSub = (name: string) =>
  getAdminFirestore().collection("users").doc(userId).collection(name)

afterEach(async () => {
  for (const col of ["clients", "opportunities", "engagements", "allocations", "tasks", "timecards", "meetings", "solutions", "invoices", "capacity", "mcp_audit",
    "company_accounts", "company_movements", "company_expenses", "company_loans"]) {
    const snap = await userSub(col).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
})

async function seedEngagement(over: Record<string, unknown> = {}): Promise<string> {
  const ref = await userSub("engagements").add({
    userId,
    clientId: "c1",
    opportunityId: null,
    dailyRate: 1000,
    vatApplicable: true,
    contractedDays: null,
    defaultDaysPerMonth: 10,
    startMonth: null,
    isActive: true,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  })
  return ref.id
}

describe("clients", () => {
  it("creates with defaults and reads back sorted by name", async () => {
    await admin.createClient(userId, { name: "Zeta" })
    await admin.createClient(userId, { name: "Acme", vatNumber: "IT123", email: "a@acme.it" })
    const clients = await admin.getClients(userId)
    expect(clients.map((c) => c.name)).toEqual(["Acme", "Zeta"])
    expect(clients[0]).toMatchObject({ vatNumber: "IT123", email: "a@acme.it", isActive: true })
    expect(clients[0].createdAt).toBeInstanceOf(Date)
  })

  it("activeOnly filters out archived clients", async () => {
    await admin.createClient(userId, { name: "Attivo" })
    await userSub("clients").add({
      userId, name: "Archiviato", vatNumber: null, email: null, notes: null,
      isActive: false, createdAt: new Date(), updatedAt: new Date(),
    })
    expect((await admin.getClients(userId)).length).toBe(2)
    expect((await admin.getClients(userId, { activeOnly: true })).map((c) => c.name)).toEqual(["Attivo"])
  })
})

describe("opportunities", () => {
  it("creates with closed fields nulled and round-trips dates", async () => {
    const next = new Date("2026-09-01T10:00:00Z")
    const opp = await admin.createOpportunity(userId, {
      clientId: "c1", title: "Retainer", stage: "lead", probability: 20, dailyRate: 1300,
      estimatedDaysPerMonth: 8, estimatedDurationMonths: 6, vatApplicable: true, nextActionDate: next,
    })
    expect(opp).toMatchObject({ stage: "lead", lostReason: null, closedAt: null, engagementId: null })
    expect(opp.nextActionDate).toEqual(next)
  })

  it("openOnly excludes won and lost", async () => {
    for (const stage of ["lead", "won", "lost"]) {
      await admin.createOpportunity(userId, {
        clientId: "c1", title: `Deal ${stage}`, stage: "lead", probability: 20, dailyRate: 1000,
        estimatedDaysPerMonth: 5, estimatedDurationMonths: 3, vatApplicable: true,
      }).then((o) => (stage === "lead" ? o : admin.updateOpportunity(userId, o.id, { stage: stage as "won" | "lost" })))
    }
    const open = await admin.getOpportunities(userId, { openOnly: true })
    expect(open.map((o) => o.stage)).toEqual(["lead"])
    expect((await admin.getOpportunities(userId)).length).toBe(3)
  })

  it("updates stage, closedAt and lostReason; clears closedAt with null", async () => {
    const opp = await admin.createOpportunity(userId, {
      clientId: "c1", title: "Deal", stage: "proposal", probability: 50, dailyRate: 1000,
      estimatedDaysPerMonth: 5, estimatedDurationMonths: 3, vatApplicable: true,
    })
    const closed = new Date("2026-08-21T12:00:00Z")
    const lost = await admin.updateOpportunity(userId, opp.id, {
      stage: "lost", lostReason: "prezzo", closedAt: closed,
    })
    expect(lost).toMatchObject({ stage: "lost", lostReason: "prezzo" })
    expect(lost.closedAt).toEqual(closed)

    const reopened = await admin.updateOpportunity(userId, opp.id, { stage: "proposal", closedAt: null })
    expect(reopened.closedAt).toBeNull()
  })

  it("update of a missing opportunity throws", async () => {
    await expect(admin.updateOpportunity(userId, "nope", { stage: "won" })).rejects.toThrow(/not found/)
  })
})

describe("engagements", () => {
  it("activeOnly filters", async () => {
    await seedEngagement({})
    await seedEngagement({ isActive: false })
    expect((await admin.getEngagements(userId)).length).toBe(2)
    expect((await admin.getEngagements(userId, { activeOnly: true })).length).toBe(1)
  })

  it("stores the name on create and reads a pre-name document as null", async () => {
    const legacy = await seedEngagement({}) // no name field, like production docs before it existed
    const named = await admin.createEngagement(userId, {
      clientId: "c1", name: "Migrazione cloud", dailyRate: 700, vatApplicable: true, defaultDaysPerMonth: 10,
    })
    const unnamed = await admin.createEngagement(userId, {
      clientId: "c1", dailyRate: 700, vatApplicable: true, defaultDaysPerMonth: 10,
    })
    const byId = new Map((await admin.getEngagements(userId)).map((e) => [e.id, e.name]))
    expect(byId.get(legacy)).toBeNull()
    expect(byId.get(named.id)).toBe("Migrazione cloud")
    expect(byId.get(unnamed.id)).toBeNull()
  })

  it("updates only the fields given: renames, clears the name to null, leaves the rest", async () => {
    const id = await seedEngagement({ name: "Vecchio nome", notes: "da tenere", contractedDays: 40 })
    const renamed = await admin.updateEngagement(userId, id, { name: "Migrazione cloud" })
    expect(renamed).toMatchObject({
      id, name: "Migrazione cloud", notes: "da tenere", dailyRate: 1000, contractedDays: 40,
      defaultDaysPerMonth: 10, isActive: true, clientId: "c1",
    })

    const cleared = await admin.updateEngagement(userId, id, { name: null })
    expect(cleared.name).toBeNull()
    expect(cleared.notes).toBe("da tenere")
    expect(cleared.updatedAt.getTime()).toBeGreaterThanOrEqual(renamed.updatedAt.getTime())
  })

  it("writes endMonth on create and update, and reads a pre-endMonth document as null", async () => {
    const legacy = await seedEngagement({}) // no endMonth field, like every production doc today
    const planned = await admin.createEngagement(userId, {
      clientId: "c1", dailyRate: 700, vatApplicable: true, defaultDaysPerMonth: 10, endMonth: "2027-06",
    })
    expect(planned.endMonth).toBe("2027-06")
    expect((await admin.getEngagements(userId)).find((e) => e.id === legacy)?.endMonth).toBeNull()

    const closed = await admin.updateEngagement(userId, legacy, { isActive: false, endMonth: "2026-06" })
    expect(closed).toMatchObject({ isActive: false, endMonth: "2026-06", dailyRate: 1000 })
    // A rename leaves the end alone; null clears it.
    expect((await admin.updateEngagement(userId, legacy, { name: "Chiuso" })).endMonth).toBe("2026-06")
    expect((await admin.updateEngagement(userId, legacy, { endMonth: null })).endMonth).toBeNull()
  })

  it("writes endDate on create and update, and reads a pre-endDate document as null", async () => {
    const legacy = await seedEngagement({ endMonth: "2026-06" }) // closed by month, before end dates
    expect((await admin.getEngagements(userId)).find((e) => e.id === legacy)).toMatchObject({
      endMonth: "2026-06",
      endDate: null,
    })
    const dated = await admin.createEngagement(userId, {
      clientId: "c1", dailyRate: 700, vatApplicable: true, defaultDaysPerMonth: 10,
      endMonth: "2026-08", endDate: "2026-08-20",
    })
    expect(dated.endDate).toBe("2026-08-20")

    const moved = await admin.updateEngagement(userId, legacy, { endMonth: "2026-07", endDate: "2026-07-15" })
    expect(moved).toMatchObject({ endMonth: "2026-07", endDate: "2026-07-15" })
    expect((await admin.updateEngagement(userId, legacy, { name: "Chiuso" })).endDate).toBe("2026-07-15")
    expect((await admin.updateEngagement(userId, legacy, { endMonth: null, endDate: null })).endDate).toBeNull()
  })

  it("reads a pre-amendments document as none, writes the list with the end, and drops malformed entries", async () => {
    const entry = {
      from: "2026-10", dailyRate: null, addedDays: 40, lastDay: "2027-01-31", lastDayBefore: "2026-12-31", note: "Addendum 2",
    }
    const legacy = await seedEngagement({ contractedDays: 80, startMonth: "2026-01", endMonth: "2026-12" })
    expect((await admin.getEngagements(userId)).find((e) => e.id === legacy)?.amendments).toEqual([])

    const amended = await admin.updateEngagement(userId, legacy, { amendments: [entry], endMonth: "2027-01", endDate: "2027-01-31" })
    expect(amended).toMatchObject({ amendments: [entry], endMonth: "2027-01", endDate: "2027-01-31", contractedDays: 80 })
    expect((await admin.updateEngagement(userId, legacy, { name: "Migration" })).amendments).toEqual([entry])

    // The rules check shape and size only, so a hand-written entry can be stored; it never reaches a reader.
    const junk = await seedEngagement({ amendments: [entry, { from: "2027-02", dailyRate: "900" }, "x"] })
    expect((await admin.getEngagements(userId)).find((e) => e.id === junk)?.amendments).toEqual([entry])
  })

  it("update of a missing engagement throws", async () => {
    await expect(admin.updateEngagement(userId, "nope", { name: "x" })).rejects.toThrow(/not found/)
  })
})

describe("tasks", () => {
  it("stores normalized labels, keeps them on unrelated updates, and reads a pre-labels document as []", async () => {
    const legacy = await userSub("tasks").add({
      // no labels field, like production docs before it existed
      userId, engagementId: "e1", title: "Vecchia", dueDate: null, notes: null,
      isDone: false, startedAt: null, createdAt: new Date(), updatedAt: new Date(),
    })
    const labelled = await admin.createTask(userId, {
      clientId: "c1", engagementId: "e1", title: "Nuova", labels: ["Urgente ", "URGENTE", "Cliente"],
    })
    const plain = await admin.createTask(userId, { clientId: "c1", engagementId: "e1", title: "Semplice" })
    expect(labelled.labels).toEqual(["Urgente", "Cliente"])
    expect(plain.labels).toEqual([])

    expect((await admin.updateTask(userId, labelled.id, { isDone: true })).labels).toEqual(["Urgente", "Cliente"])
    expect((await admin.updateTask(userId, plain.id, { labels: [" Bug  fix "] })).labels).toEqual(["Bug fix"])

    const byId = new Map((await admin.getTasks(userId)).map((t) => [t.id, t.labels]))
    expect(byId.get(legacy.id)).toEqual([])
    expect(byId.get(labelled.id)).toEqual(["Urgente", "Cliente"])
    expect(byId.get(plain.id)).toEqual(["Bug fix"])
  })

  it("writes clientId and a nullable engagementId, attaches and detaches, and reads a pre-#164 document", async () => {
    const legacy = await userSub("tasks").add({
      // no clientId, like production docs before #164
      userId, engagementId: "e1", title: "Vecchia", dueDate: null, notes: null,
      isDone: false, startedAt: null, createdAt: new Date(), updatedAt: new Date(),
    })
    const clientLevel = await admin.createTask(userId, { clientId: "c1", title: "Chiamata" })
    expect(clientLevel).toMatchObject({ clientId: "c1", engagementId: null })

    const attached = await admin.updateTask(userId, clientLevel.id, { engagementId: "e1", clientId: "c1" })
    expect(attached).toMatchObject({ clientId: "c1", engagementId: "e1", title: "Chiamata" })
    // A write that omits both must keep them (updates are built field by field).
    expect(await admin.updateTask(userId, clientLevel.id, { isDone: true })).toMatchObject({
      clientId: "c1", engagementId: "e1",
    })
    expect(await admin.updateTask(userId, clientLevel.id, { engagementId: null })).toMatchObject({
      clientId: "c1", engagementId: null,
    })

    const old = (await admin.getTasks(userId)).find((t) => t.id === legacy.id)
    expect(old).toMatchObject({ clientId: null, engagementId: "e1" })
  })
})

describe("allocations", () => {
  it("creates, updates, and filters by month window and engagement", async () => {
    const e1 = await seedEngagement({})
    const e2 = await seedEngagement({})
    await admin.createAllocation(userId, { engagementId: e1, yearMonth: "2026-07", days: 5 })
    const aug = await admin.createAllocation(userId, { engagementId: e1, yearMonth: "2026-08", days: 3 })
    await admin.createAllocation(userId, { engagementId: e2, yearMonth: "2026-08", days: 2 })

    expect((await admin.getAllocations(userId)).length).toBe(3)
    expect((await admin.getAllocations(userId, { from: "2026-08" })).length).toBe(2)
    expect((await admin.getAllocations(userId, { from: "2026-07", to: "2026-07" })).length).toBe(1)
    expect((await admin.getAllocations(userId, { engagementId: e1 })).length).toBe(2)
    expect(
      (await admin.getAllocations(userId, { engagementId: e1, from: "2026-08", to: "2026-08" })).length
    ).toBe(1)

    const updated = await admin.updateAllocation(userId, aug.id, { days: 7 })
    expect(updated.days).toBe(7)
  })

  it("getAllocationByKey finds exactly the (engagement, month) doc", async () => {
    const e1 = await seedEngagement({})
    await admin.createAllocation(userId, { engagementId: e1, yearMonth: "2026-08", days: 3 })
    const hit = await admin.getAllocationByKey(userId, e1, "2026-08")
    expect(hit?.days).toBe(3)
    await expect(admin.getAllocationByKey(userId, e1, "2026-09")).resolves.toBeNull()
    await expect(admin.getAllocationByKey(userId, "other", "2026-08")).resolves.toBeNull()
  })

  it("preserves a stored zero as zero", async () => {
    const e1 = await seedEngagement({})
    await admin.createAllocation(userId, { engagementId: e1, yearMonth: "2026-08", days: 0 })
    const [a] = await admin.getAllocations(userId, { from: "2026-08", to: "2026-08" })
    expect(a.days).toBe(0)
  })
})

// server-db.ts casts this module to ServerDb, so a missing export type-checks
// clean and fails only in production. These calls are the check.
describe("timecards", () => {
  it("set is an upsert on (contract, day) that keeps createdAt", async () => {
    const first = await admin.setTimecard(userId, { engagementId: "e1", date: "2026-09-21", hours: 6, notes: "analisi" })
    const second = await admin.setTimecard(userId, { engagementId: "e1", date: "2026-09-21", hours: 7.5 })
    expect(second).toMatchObject({ id: "e1_2026-09-21", date: "2026-09-21", hours: 7.5, notes: "analisi" })
    expect(second.createdAt).toEqual(first.createdAt)
    expect(await admin.getTimecards(userId)).toHaveLength(1)
  })

  it("get reads every day and delete removes exactly one", async () => {
    await admin.setTimecard(userId, { engagementId: "e1", date: "2026-09-21", hours: 6 })
    await admin.setTimecard(userId, { engagementId: "e1", date: "2026-09-22", hours: 2.5 })
    await admin.setTimecard(userId, { engagementId: "e2", date: "2026-09-21", hours: 1 })

    await admin.deleteTimecard(userId, "e1", "2026-09-21")
    const left = (await admin.getTimecards(userId)).map((t) => [t.id, t.hours, t.notes])
    expect(left.sort()).toEqual([
      ["e1_2026-09-22", 2.5, null],
      ["e2_2026-09-21", 1, null],
    ])
  })
})

// Same cast as timecards: these calls are the check that the exports exist.
describe("meetings", () => {
  it("creates with every field, reads back, and updates only what it is given", async () => {
    const created = await admin.createMeeting(userId, {
      clientId: "c1", engagementId: "e1", date: "2026-09-12", time: "10:30", health: "yellow", text: " Test slittati ",
    })
    expect(created).toMatchObject({
      userId, clientId: "c1", engagementId: "e1", date: "2026-09-12", time: "10:30", health: "yellow", text: "Test slittati",
    })
    expect(created.createdAt).toBeInstanceOf(Date)
    expect(await admin.getMeetings(userId)).toEqual([created])

    const moved = await admin.updateMeeting(userId, created.id, { engagementId: null, time: null, health: "red" })
    expect(moved).toMatchObject({ clientId: "c1", engagementId: null, time: null, health: "red", text: "Test slittati" })
    const edited = await admin.updateMeeting(userId, created.id, { date: "2026-09-11", text: "Corretto" })
    expect(edited).toMatchObject({ date: "2026-09-11", text: "Corretto", health: "red", engagementId: null })
    expect((await admin.getMeetings(userId))[0]).toMatchObject({ date: "2026-09-11", text: "Corretto" })
  })

  it("reads a document lacking engagementId, time and health as null", async () => {
    await userSub("meetings").add({
      userId, clientId: "c1", date: "2026-09-12", text: "Minimo", createdAt: new Date(), updatedAt: new Date(),
    })
    expect((await admin.getMeetings(userId))[0]).toMatchObject({ engagementId: null, time: null, health: null })
  })

  it("update of a missing verbale throws", async () => {
    await expect(admin.updateMeeting(userId, "nope", { text: "x" })).rejects.toThrow("Meeting not found")
  })
})

// The Admin SDK skips the rules, so these writes are parsed: the MCP tools' only gate.
describe("solutions", () => {
  const graph = {
    entities: [
      { name: "Product", source: "SAP MARA + MAKT, Akeneo", notes: "keyed by sku" },
      { name: "Category", source: "Akeneo", notes: null },
    ],
    relations: [{ from: "Product", to: "Category", type: "IN_CATEGORY" }],
  }

  it("creates with every field, reads back, and updates only what it is given", async () => {
    const created = await admin.createSolution(userId, {
      clientId: "c1", engagementId: "e1", name: " Product knowledge graph ", status: "delivered", domain: "retail",
      stack: ["Neo4j", "kafka"], sections: { purpose: "180,000 SKUs" }, ...graph,
    })
    expect(created).toMatchObject({
      userId, clientId: "c1", engagementId: "e1", name: "Product knowledge graph", status: "delivered", domain: "retail",
      stack: ["neo4j", "kafka"], ...graph,
    })
    expect(created.sections).toMatchObject({ purpose: "180,000 SKUs", kpis: null, results: null })
    expect(created.createdAt).toBeInstanceOf(Date)
    expect(await admin.getSolutions(userId)).toEqual([created])

    const edited = await admin.updateSolution(userId, created.id, { sections: { history: "2026-02-10 Kickoff" }, status: "retired" })
    expect(edited).toMatchObject({ status: "retired", name: "Product knowledge graph", ...graph })
    expect(edited.sections).toMatchObject({ purpose: "180,000 SKUs", history: "2026-02-10 Kickoff" })
    const unlinked = await admin.updateSolution(userId, created.id, { engagementId: null, sections: { purpose: null } })
    expect(unlinked).toMatchObject({ clientId: "c1", engagementId: null })
    expect(unlinked.sections).toMatchObject({ purpose: null, history: "2026-02-10 Kickoff" })
  })

  it("refuses a relation naming an entity the stored solution lacks, and writes nothing", async () => {
    const created = await admin.createSolution(userId, { clientId: "c1", name: "Graph", ...graph })
    await expect(
      admin.updateSolution(userId, created.id, { relations: [{ from: "Supplier", to: "Product", type: "SUPPLIES" }] }),
    ).rejects.toThrow(/Supplier/)
    await expect(admin.updateSolution(userId, created.id, { sections: { appendix: "x" } as never })).rejects.toThrow()
    await expect(admin.createSolution(userId, { clientId: "c1", name: "G", relations: graph.relations })).rejects.toThrow()
    expect(await admin.getSolutions(userId)).toEqual([created])
  })

  it("reads a hand-written document safely: malformed elements dropped, every section present", async () => {
    await userSub("solutions").add({
      userId, clientId: "c1", engagementId: null, name: "Hand-written", status: "building", domain: null,
      stack: ["neo4j", 7],
      sections: { purpose: "Why", kpis: 12 },
      entities: [graph.entities[0], { name: "Broken" }],
      relations: [{ from: "Product", to: "Product", type: "SIMILAR_TO" }, { from: "Product", to: "Broken", type: "X" }],
      createdAt: new Date(), updatedAt: new Date(),
    })
    const [read] = await admin.getSolutions(userId)
    expect(read).toMatchObject({
      stack: ["neo4j"],
      entities: [graph.entities[0]],
      relations: [{ from: "Product", to: "Product", type: "SIMILAR_TO" }],
    })
    expect(read.sections).toMatchObject({ purpose: "Why", kpis: null, results: null })
    expect(Object.keys(read.sections)).toHaveLength(9)
  })

  // A client SDK write the rules let through (they check the stack's type and size
  // only) must not leave a document every later server update refuses.
  it("updates a hand-written document whose stack and domain zod would refuse", async () => {
    const ref = await userSub("solutions").add({
      userId, clientId: "c1", engagementId: null, name: "Hand-written", status: "building", domain: "  ",
      stack: ["Neo4j", "neo4j", "", "x".repeat(41), " kafka "],
      sections: {}, entities: [], relations: [],
      createdAt: new Date(), updatedAt: new Date(),
    })
    expect((await admin.getSolutions(userId))[0]).toMatchObject({ domain: null, stack: ["neo4j", "kafka"] })
    const edited = await admin.updateSolution(userId, ref.id, { status: "delivered" })
    expect(edited).toMatchObject({ status: "delivered", domain: null, stack: ["neo4j", "kafka"] })
    expect((await ref.get()).data()).toMatchObject({ domain: null, stack: ["neo4j", "kafka"] })
  })

  // Filed before kinds did, or written by the client SDK, which parses nothing.
  it("reads a document with no kind as a product with no target and no steps, and mends a hand-written road", async () => {
    const old = await userSub("solutions").add({
      userId, clientId: "c1", engagementId: null, name: "Filed before kinds", status: "delivered", domain: null,
      stack: [], sections: {}, entities: [], relations: [], createdAt: new Date(), updatedAt: new Date(),
    })
    expect((await admin.getSolutions(userId))[0]).toMatchObject({ kind: "product", target: null, steps: [] })
    const step = { title: "Tune", state: "now", fromMonth: "2026-03", toMonth: null, paidBy: null, goal: null, outcome: null, doneOn: null }
    await old.update({ kind: "service", target: "  ", steps: [step, { ...step, title: "Review" }, { title: "" }] })
    const [read] = await admin.getSolutions(userId)
    expect(read).toMatchObject({ kind: "product", target: null })
    expect(read.steps.map((x) => [x.title, x.state])).toEqual([["Tune", "now"], ["Review", "next"]])
    expect(await admin.updateSolution(userId, old.id, { status: "retired" })).toMatchObject({ status: "retired", steps: read.steps })
  })

  it("refuses a road with two Now steps, and writes nothing", async () => {
    const step = { title: "A", state: "now", fromMonth: "2026-03", toMonth: null, paidBy: null, goal: null, outcome: null, doneOn: null } as const
    const created = await admin.createSolution(userId, { clientId: "c1", name: "Road" })
    await expect(admin.updateSolution(userId, created.id, { steps: [step, { ...step, title: "B" }] })).rejects.toThrow(/Only one step/)
    expect((await admin.getSolutions(userId))[0].steps).toEqual([])
  })

  it("update of a missing solution throws", async () => {
    await expect(admin.updateSolution(userId, "nope", { name: "x" })).rejects.toThrow("Solution not found")
  })
})

describe("invoices", () => {
  it("writes the customer and the period, never a contract", async () => {
    const created = await admin.createInvoice(userId, {
      clientId: "c1", number: "9", fromMonth: "2026-04", yearMonth: "2026-06", amount: 12000, vat: 2640,
    })
    expect(created).toMatchObject({ clientId: "c1", engagementId: null, fromMonth: "2026-04", yearMonth: "2026-06" })
    const raw = (await userSub("invoices").doc(created.id).get()).data()!
    expect(raw).toMatchObject({ clientId: "c1", fromMonth: "2026-04" })
    expect("engagementId" in raw).toBe(false)
  })

  it("reads a document written before invoices named their customer", async () => {
    await userSub("invoices").add({
      userId, engagementId: "e1", number: "4", yearMonth: "2026-05", amount: 1000, vat: 0,
      dueDate: null, paidDate: null, createdAt: new Date(), updatedAt: new Date(),
    })
    expect((await admin.getInvoices(userId))[0]).toMatchObject({
      clientId: null, engagementId: "e1", fromMonth: null, paidAccountId: null,
    })
  })

  it("update sets and clears the period, touching nothing else", async () => {
    const created = await admin.createInvoice(userId, {
      clientId: "c1", number: "9", yearMonth: "2026-07", amount: 12000, vat: 2640,
    })
    expect(created.fromMonth).toBeNull()
    const period = await admin.updateInvoice(userId, created.id, { fromMonth: "2026-04", yearMonth: "2026-06" })
    expect(period).toMatchObject({ fromMonth: "2026-04", yearMonth: "2026-06", amount: 12000, clientId: "c1" })
    const single = await admin.updateInvoice(userId, created.id, { fromMonth: null })
    expect(single).toMatchObject({ fromMonth: null, yearMonth: "2026-06" })
  })

  // mark_invoice_paid sends {paidDate} alone: the account a payment landed on survives it.
  it("writes the paid account, and keeps it when only the date changes", async () => {
    const created = await admin.createInvoice(userId, {
      clientId: "c1", number: "10", yearMonth: "2026-07", amount: 1000, vat: 220,
      paidDate: new Date("2026-08-03T00:00:00Z"), paidAccountId: "acc-a",
    })
    expect(created.paidAccountId).toBe("acc-a")
    const unpaid = await admin.updateInvoice(userId, created.id, { paidDate: null })
    expect(unpaid).toMatchObject({ paidDate: null, paidAccountId: "acc-a" })
    const moved = await admin.updateInvoice(userId, created.id, { paidAccountId: "acc-b" })
    expect(moved.paidAccountId).toBe("acc-b")
    const plain = await admin.createInvoice(userId, { clientId: "c1", number: "11", yearMonth: "2026-07", amount: 1, vat: 0 })
    expect(plain.paidAccountId).toBeNull()
  })
})

describe("capacity (MCP-private)", () => {
  it("set is idempotent per month and reads back by window", async () => {
    const doc = { yearMonth: "2026-08", daysOff: 10, availableDays: 11, reason: "vacation" as const, note: "mare" }
    await admin.setCapacity(userId, doc)
    await admin.setCapacity(userId, { ...doc, daysOff: 5, availableDays: 16 })

    const docs = await admin.getCapacityDocs(userId, { from: "2026-01", to: "2026-12" })
    expect(docs).toHaveLength(1) // same month overwrote, not duplicated
    expect(docs[0]).toMatchObject({ daysOff: 5, availableDays: 16, reason: "vacation", note: "mare" })

    await expect(admin.getCapacityDocs(userId, { from: "2027-01", to: "2027-12" })).resolves.toEqual([])
  })

  it("reads a doc stored with a legacy Italian reason as its English one", async () => {
    const legacy = { daysOff: 2, availableDays: 20, note: null }
    await userSub("capacity").doc("2028-01").set({ ...legacy, yearMonth: "2028-01", reason: "ferie" })
    await userSub("capacity").doc("2028-02").set({ ...legacy, yearMonth: "2028-02", reason: "formazione" })
    await userSub("capacity").doc("2028-03").set({ ...legacy, yearMonth: "2028-03", reason: "altro" })
    await userSub("capacity").doc("2028-04").set({ ...legacy, yearMonth: "2028-04", reason: "admin" })

    const docs = await admin.getCapacityDocs(userId, { from: "2028-01", to: "2028-04" })
    expect(docs.map((d) => d.reason)).toEqual(["vacation", "training", "other", "admin"])
  })
})

describe("mcp_audit (MCP-private)", () => {
  it("writes entries with sanitized params", async () => {
    await admin.addAuditEntry(userId, {
      tool: "log_allocation",
      params: { client: "Acme", days: 3 },
      result: "ok",
      documentIds: ["a1"],
      clientId: "test-client",
    })
    const snap = await userSub("mcp_audit").get()
    expect(snap.size).toBe(1)
    expect(snap.docs[0].data()).toMatchObject({
      tool: "log_allocation",
      params: { client: "Acme", days: 3 },
      result: "ok",
      documentIds: ["a1"],
      clientId: "test-client",
    })
  })
})

// The cash book's server half: ServerDb casts this module, so these calls are the
// check that each export exists, and the reads of older documents that it maps them.
describe("company accounts", () => {
  it("reads every account sorted by name, a document lacking the statement and importRef as null", async () => {
    await userSub("company_accounts").add({
      userId, name: "Second Bank", openingBalance: 100, openingDate: new Date("2026-05-01T00:00:00"),
      createdAt: new Date(), updatedAt: new Date(),
    })
    await userSub("company_accounts").add({
      userId, name: "Main Bank", openingBalance: 2500, openingDate: new Date("2026-05-01T00:00:00"),
      statementBalance: 2600, statementDate: new Date("2026-09-30T00:00:00"), importRef: null,
      createdAt: new Date(), updatedAt: new Date(),
    })
    const accounts = await admin.getCompanyAccounts(userId)
    expect(accounts.map((a) => a.name)).toEqual(["Main Bank", "Second Bank"])
    expect(accounts[0].statementDate).toEqual(new Date("2026-09-30T00:00:00"))
    expect(accounts[1]).toMatchObject({ statementBalance: null, statementDate: null, importRef: null })
  })

  it("stores a statement and refuses a balance without its date", async () => {
    const ref = await userSub("company_accounts").add({
      userId, name: "Main Bank", openingBalance: 0, openingDate: new Date("2026-05-01T00:00:00"),
      statementBalance: null, statementDate: null, importRef: null, createdAt: new Date(), updatedAt: new Date(),
    })
    const day = new Date("2026-10-07T00:00:00")
    const checked = await admin.updateCompanyAccount(userId, ref.id, { statementBalance: 12400, statementDate: day })
    expect(checked).toMatchObject({ name: "Main Bank", statementBalance: 12400, statementDate: day, openingBalance: 0 })
    await expect(admin.updateCompanyAccount(userId, ref.id, { statementDate: null })).rejects.toThrow(/needs its date/)
    expect((await admin.getCompanyAccounts(userId))[0].statementBalance).toBe(12400)
    await expect(admin.updateCompanyAccount(userId, "nope", { name: "x" })).rejects.toThrow("Company account not found")
  })
})

describe("company movements", () => {
  it("creates a transfer and reads it back, newest first", async () => {
    const day = new Date("2026-10-02T00:00:00")
    const created = await admin.createCompanyMovement(userId, {
      kind: "transfer", direction: "out", amount: 2500, date: day, accountId: "a", toAccountId: "b", description: "Transfer to Second Bank",
    })
    expect(created).toMatchObject({ kind: "transfer", toAccountId: "b", expenseId: null, project: null, dateEstimated: false })
    await admin.createCompanyMovement(userId, {
      kind: "deposit_held", direction: "in", amount: 900, date: new Date("2026-10-05T00:00:00"), accountId: "b",
      description: "Deposit Received", counterparty: "Room 3", project: "Flat Rental",
    })
    const movements = await admin.getCompanyMovements(userId)
    expect(movements.map((m) => m.counterparty)).toEqual(["Room 3", null])
    expect(movements[1].date).toEqual(day)
  })

  it("refuses what the rules refuse: a transfer to the same account, a payment naming no supplier invoice", async () => {
    const base = { direction: "out" as const, amount: 10, date: new Date(), accountId: "a", description: "x" }
    await expect(admin.createCompanyMovement(userId, { ...base, kind: "transfer", toAccountId: "a" })).rejects.toThrow(/different account/)
    await expect(admin.createCompanyMovement(userId, { ...base, kind: "supplier_payment" })).rejects.toThrow(/supplier invoice/)
    await expect(admin.createCompanyMovement(userId, { ...base, kind: "vat", amount: -1 })).rejects.toThrow()
    expect(await admin.getCompanyMovements(userId)).toEqual([])
  })

  it("reads a document lacking the optional fields as null", async () => {
    await userSub("company_movements").add({
      userId, kind: "vat", direction: "out", amount: 300, date: new Date(), accountId: "a", description: "VAT (F24)",
      createdAt: new Date(), updatedAt: new Date(),
    })
    expect((await admin.getCompanyMovements(userId))[0]).toMatchObject({
      toAccountId: null, expenseId: null, documentRef: null, project: null, counterparty: null, notes: null, dateEstimated: false, importRef: null,
    })
  })
})

describe("company costs and loans", () => {
  it("creates a cost with the cash book fields and refuses the cross-field mistakes", async () => {
    const created = await admin.createCompanyExpense(userId, {
      description: "Rent", category: "rent", amount: 1850, vat: 0, date: new Date("2026-10-05T00:00:00"),
      accountId: "a", documentRef: "INV-7", project: "Flat Rental", recurringExpenseId: "est-1",
    })
    expect(created).toMatchObject({ accountId: "a", paidByOwner: false, vat: 0, documentRef: "INV-7", project: "Flat Rental", recurringExpenseId: "est-1" })
    const card = await admin.createCompanyExpense(userId, {
      description: "Fridge", category: "office_supplies", amount: 480, date: new Date(), paidByOwner: true,
    })
    expect(card).toMatchObject({ accountId: null, paidByOwner: true, vat: null })
    await expect(
      admin.createCompanyExpense(userId, { description: "x", category: "other", amount: 5, date: new Date(), accountId: "a", paidByOwner: true }),
    ).rejects.toThrow(/not both/)
    await expect(
      admin.createCompanyExpense(userId, { description: "x", category: "other", amount: -5, date: new Date() }),
    ).rejects.toThrow(/refund/)
    expect(await admin.getCompanyExpenses(userId)).toHaveLength(2)
  })

  it("reads a cost written before the cash book with its new fields null or false", async () => {
    await userSub("company_expenses").add({
      userId, description: "Old", category: "software", amount: 20, date: new Date(), isRecurring: true, recurrenceMonths: 1,
      notes: null, createdAt: new Date(), updatedAt: new Date(),
    })
    expect((await admin.getCompanyExpenses(userId))[0]).toMatchObject({
      accountId: null, paidByOwner: false, vat: null, documentRef: null, project: null, recurringExpenseId: null, dateEstimated: false, importRef: null,
    })
  })

  it("creates a loan through an account and reads an older one with no account as null", async () => {
    const lent = await admin.createCompanyLoan(userId, {
      description: "Shareholder Loan", direction: "to_company", amount: 5000, date: new Date("2026-10-01T00:00:00"), accountId: "a",
    })
    expect(lent).toMatchObject({ accountId: "a", dateEstimated: false, importRef: null })
    await expect(
      admin.createCompanyLoan(userId, { description: "x", direction: "from_company", amount: 0, date: new Date() }),
    ).rejects.toThrow()
    await userSub("company_loans").add({
      userId, description: "Old", direction: "to_company", amount: 100, date: new Date("2025-01-01T00:00:00"), notes: null,
      createdAt: new Date(), updatedAt: new Date(),
    })
    const loans = await admin.getCompanyLoans(userId)
    expect(loans.map((l) => l.accountId)).toEqual(["a", null])
  })
})

describe("settleInvoicePayment", () => {
  const day = new Date("2026-10-05T00:00:00")
  const invoice = () => admin.createInvoice(userId, { clientId: "c1", number: "15/2026", yearMonth: "2026-09", amount: 1000, vat: 220 })

  it("writes the payment and its bank fee together", async () => {
    const i = await invoice()
    const { invoice: paid, fee } = await admin.settleInvoicePayment(userId, { invoiceId: i.id, paidDate: day, paidAccountId: "a", fee: 7.5 })
    expect(paid).toMatchObject({ paidDate: day, paidAccountId: "a" })
    expect(fee).toMatchObject({ id: `bank-fee-${i.id}`, description: "Bank fee on invoice 15/2026", category: "bank_fees", amount: 7.5, accountId: "a" })
    expect(fee!.date).toEqual(day)
  })

  it("without a fee writes the invoice alone", async () => {
    const i = await invoice()
    const { fee } = await admin.settleInvoicePayment(userId, { invoiceId: i.id, paidDate: day, paidAccountId: "non-cash" })
    expect(fee).toBeNull()
    expect(await admin.getCompanyExpenses(userId)).toEqual([])
    expect((await admin.getInvoices(userId))[0].paidAccountId).toBe("non-cash")
  })

  // The fee lands on a document that already exists: the commit fails as a whole,
  // so the invoice update in the same batch never lands either.
  it("a failing fee write leaves the invoice unpaid", async () => {
    const i = await invoice()
    await userSub("company_expenses").doc(`bank-fee-${i.id}`).set({ userId, description: "Earlier fee", category: "bank_fees", amount: 3 })
    await expect(
      admin.settleInvoicePayment(userId, { invoiceId: i.id, paidDate: day, paidAccountId: "a", fee: 7.5 }),
    ).rejects.toThrow()
    const after = (await admin.getInvoices(userId))[0]
    expect(after).toMatchObject({ paidDate: null, paidAccountId: null })
    expect((await userSub("company_expenses").doc(`bank-fee-${i.id}`).get()).get("amount")).toBe(3)
  })

  it("refuses a missing invoice", async () => {
    await expect(admin.settleInvoicePayment(userId, { invoiceId: "nope", paidDate: day, paidAccountId: "a" })).rejects.toThrow("Invoice not found")
  })
})

// The edits and deletes chat makes on the cash book. The Admin SDK skips the rules,
// so each update parses the merged document, as the rules read incoming().
describe("cash book edits and deletes", () => {
  const day = new Date("2026-10-05T00:00:00")
  const bill = () =>
    admin.createCompanyExpense(userId, { description: "Studio fee", category: "accountant", amount: 1000, vat: 0, date: day, documentRef: "ST-9" })
  const pay = (expenseId: string) =>
    admin.createCompanyMovement(userId, {
      kind: "supplier_payment", direction: "out", amount: 400, date: day, accountId: "a", expenseId, description: "Supplier Invoice Payment",
    })

  it("updates a movement's fields, keeps the rest and its importRef, and stamps updatedAt", async () => {
    const m = await admin.createCompanyMovement(userId, {
      kind: "income", direction: "in", amount: 650, date: day, accountId: "a", description: "Rent Room 2", counterparty: "Room 2",
      importRef: "2026:Ottobre!7",
    })
    const updated = await admin.updateCompanyMovement(userId, m.id, { amount: 700, date: new Date("2026-10-06T00:00:00"), notes: null })
    expect(updated).toMatchObject({ amount: 700, counterparty: "Room 2", importRef: "2026:Ottobre!7", description: "Rent Room 2" })
    expect(updated.date).toEqual(new Date("2026-10-06T00:00:00"))
    expect(updated.updatedAt.getTime()).toBeGreaterThan(m.updatedAt.getTime())
  })

  it("refuses a movement edit the merged document fails, and writes nothing", async () => {
    const t = await admin.createCompanyMovement(userId, {
      kind: "transfer", direction: "out", amount: 100, date: day, accountId: "a", toAccountId: "b", description: "Transfer to Second Bank",
    })
    await expect(admin.updateCompanyMovement(userId, t.id, { toAccountId: "a" })).rejects.toThrow(/different account/)
    await expect(admin.updateCompanyMovement(userId, t.id, { kind: "vat" })).rejects.toThrow(/destination account/)
    await expect(admin.updateCompanyMovement(userId, t.id, { kind: "supplier_payment", toAccountId: null })).rejects.toThrow(/supplier invoice/)
    expect((await admin.getCompanyMovements(userId))[0]).toMatchObject({ kind: "transfer", toAccountId: "b" })
    await expect(admin.updateCompanyMovement(userId, "nope", { amount: 1 })).rejects.toThrow("Company movement not found")
  })

  it("deletes a movement", async () => {
    const m = await admin.createCompanyMovement(userId, { kind: "vat", direction: "out", amount: 100, date: day, accountId: "a", description: "VAT (F24)" })
    await admin.deleteCompanyMovement(userId, m.id)
    expect(await admin.getCompanyMovements(userId)).toEqual([])
  })

  it("updates a cost on its merged document, refusing an account and the owner's card together", async () => {
    const c = await admin.createCompanyExpense(userId, { description: "Rent", category: "rent", amount: 1850, vat: 0, date: day, accountId: "a" })
    expect(await admin.updateCompanyExpense(userId, c.id, { amount: 1900, project: "Flat Rental" })).toMatchObject({
      amount: 1900, accountId: "a", project: "Flat Rental",
    })
    await expect(admin.updateCompanyExpense(userId, c.id, { paidByOwner: true })).rejects.toThrow(/not both/)
    await expect(admin.updateCompanyExpense(userId, c.id, { accountId: null, amount: -5, vat: null })).rejects.toThrow(/refund/)
    expect((await admin.getCompanyExpenses(userId))[0]).toMatchObject({ amount: 1900, paidByOwner: false, accountId: "a" })
    await expect(admin.updateCompanyExpense(userId, "nope", { amount: 1 })).rejects.toThrow("Company expense not found")
  })

  it("keeps a supplier invoice with payments one: its words may change, how it was paid may not", async () => {
    const b = await bill()
    await pay(b.id)
    expect(await admin.updateCompanyExpense(userId, b.id, { description: "Studio fee, September", amount: 1100 })).toMatchObject({
      description: "Studio fee, September", amount: 1100,
    })
    await expect(admin.updateCompanyExpense(userId, b.id, { accountId: "a" })).rejects.toThrow(BILL_HAS_PAYMENTS)
    await expect(admin.updateCompanyExpense(userId, b.id, { documentRef: null })).rejects.toThrow(BILL_HAS_PAYMENTS)
    expect((await admin.getCompanyExpenses(userId))[0]).toMatchObject({ accountId: null, documentRef: "ST-9" })
  })

  it("refuses to delete a supplier invoice with payments, and deletes it once they are gone", async () => {
    const b = await bill()
    const p = await pay(b.id)
    await expect(admin.deleteCompanyExpense(userId, b.id)).rejects.toThrow(BILL_HAS_PAYMENTS)
    expect(await admin.getCompanyExpenses(userId)).toHaveLength(1)
    await admin.deleteCompanyMovement(userId, p.id)
    await admin.deleteCompanyExpense(userId, b.id)
    expect(await admin.getCompanyExpenses(userId)).toEqual([])
  })

  it("updates a loan on its merged document and deletes it", async () => {
    const l = await admin.createCompanyLoan(userId, { description: "Shareholder Loan", direction: "to_company", amount: 5000, date: day, accountId: "a" })
    expect(await admin.updateCompanyLoan(userId, l.id, { amount: 4500, accountId: "b" })).toMatchObject({ amount: 4500, accountId: "b", direction: "to_company" })
    await expect(admin.updateCompanyLoan(userId, l.id, { amount: 0 })).rejects.toThrow()
    expect((await admin.getCompanyLoans(userId))[0].amount).toBe(4500)
    await expect(admin.updateCompanyLoan(userId, "nope", { amount: 1 })).rejects.toThrow("Company loan not found")
    await admin.deleteCompanyLoan(userId, l.id)
    expect(await admin.getCompanyLoans(userId)).toEqual([])
  })

  it("deletes an invoice alone: the bank fee booked with its payment stays on Costs", async () => {
    const i = await admin.createInvoice(userId, { clientId: "c1", number: "16/2026", yearMonth: "2026-09", amount: 1000, vat: 220 })
    await admin.settleInvoicePayment(userId, { invoiceId: i.id, paidDate: day, paidAccountId: "a", fee: 5 })
    await admin.deleteInvoice(userId, i.id)
    expect(await admin.getInvoices(userId)).toEqual([])
    expect((await admin.getCompanyExpenses(userId)).map((e) => e.id)).toEqual([`bank-fee-${i.id}`])
  })
})

describe("invoice files", () => {
  const stored = async (name: string) => {
    const path = `users/${userId}/company-files/${name}.xml`
    await getAdminBucket()!.file(path).save("<a/>", { contentType: "application/xml" })
    return { path, name: "IT01.xml", kind: "xml" as const, size: 4, uploadedAt: new Date() }
  }
  const exists = async (path: string) => (await getAdminBucket()!.file(path).exists())[0]

  it("deleting a cost through the MCP's adapter deletes its object", async () => {
    const file = await stored("admin-cost")
    const e = await admin.createCompanyExpense(userId, { description: "With file", category: "other", amount: 10, date: new Date(), file })
    expect((await admin.getCompanyExpenses(userId))[0].file).toEqual(file)
    await admin.deleteCompanyExpense(userId, e.id)
    expect(await exists(file.path)).toBe(false)
  })

  it("deleting an invoice through the MCP's adapter deletes its object", async () => {
    const file = await stored("admin-invoice")
    const i = await admin.createInvoice(userId, { clientId: "c1", number: "17/2026", yearMonth: "2026-09", amount: 1000, vat: 220 })
    await userSub("invoices").doc(i.id).update({ file })
    expect((await admin.getInvoices(userId))[0].file).toEqual(file)
    await admin.deleteInvoice(userId, i.id)
    expect(await exists(file.path)).toBe(false)
  })

  it("a failed object delete does not undo the cost delete: one unreferenced object is left", async () => {
    const file = await stored("admin-stuck")
    const e = await admin.createCompanyExpense(userId, { description: "Stuck", category: "other", amount: 10, date: new Date(), file })
    vi.mocked(getAdminBucket).mockReturnValueOnce({
      file: () => ({ delete: async () => { throw new Error("storage is down") } }),
    } as unknown as ReturnType<typeof getAdminBucket>)
    await expect(admin.deleteCompanyExpense(userId, e.id)).resolves.toBeUndefined()
    expect(await admin.getCompanyExpenses(userId)).toEqual([])
    expect(await exists(file.path)).toBe(true)
  })

  it("deletes only objects under the user's own company-files folder", async () => {
    const other = `users/someone-else/company-files/admin-foreign.xml`
    await getAdminBucket()!.file(other).save("<a/>", { contentType: "application/xml" })
    const file = { path: other, name: "IT01.xml", kind: "xml" as const, size: 4, uploadedAt: new Date() }
    const e = await admin.createCompanyExpense(userId, { description: "Foreign", category: "other", amount: 10, date: new Date(), file })
    await admin.deleteCompanyExpense(userId, e.id)
    expect(await exists(other)).toBe(true)
    await getAdminBucket()!.file(other).delete()
  })

  it("deleting a record without a file touches no object", async () => {
    const e = await admin.createCompanyExpense(userId, { description: "Plain", category: "other", amount: 10, date: new Date() })
    expect((await admin.getCompanyExpenses(userId))[0].file).toBeNull()
    await admin.deleteCompanyExpense(userId, e.id)
  })
})

describe("an invoice's file pointer through the Admin adapter", () => {
  it("sets it, keeps it through another edit, and clears it with null", async () => {
    const file = { path: `users/${userId}/company-files/admin-pointer.pdf`, name: "p.pdf", kind: "pdf" as const, size: 4, uploadedAt: new Date("2026-10-01T10:00:00Z") }
    const i = await admin.createInvoice(userId, { clientId: "c1", number: "18/2026", yearMonth: "2026-09", amount: 1000, vat: 220 })
    expect((await admin.updateInvoice(userId, i.id, { file })).file).toEqual(file)
    expect((await admin.updateInvoice(userId, i.id, { number: "19/2026" })).file).toEqual(file)
    expect((await admin.updateInvoice(userId, i.id, { file: null })).file).toBeNull()
  })
})

describe("the Admin files slice (what the MCP's attach_file and get_file store through)", () => {
  const files = admin.createFirebaseFiles()
  const text = (s: string, type = "") => new Blob([s], { type })
  const read = async (f: { path: string }) => (await files.download(f)).text()

  it.each([
    ["IT01_00001.xml", "xml", "application/xml"],
    ["IT01_00001.xml.p7m", "p7m", "application/pkcs7-mime"],
    ["EU-1234.pdf", "pdf", "application/pdf"],
  ])("stores %s under the user's own folder with the content type of its kind, whatever the Blob says", async (name, kind, contentType) => {
    const f = await files.upload(userId, text("body", "text/plain"), name)
    expect(f).toMatchObject({ name, kind, size: 4 })
    expect(f.path).toMatch(new RegExp(`^users/${userId}/company-files/[\\w-]+\\.${kind === "p7m" ? "xml\\.p7m" : kind}$`))
    expect((await getAdminBucket()!.file(f.path).getMetadata())[0].contentType).toBe(contentType)
    expect(await read(f)).toBe("body")
    await files.remove(f.path)
    await expect(files.download(f)).rejects.toThrow()
    await expect(files.remove(f.path)).resolves.toBeUndefined()
  })

  it("refuses another type and more than 10 MB, with the slot's words, before storing", async () => {
    await expect(files.upload(userId, text("x"), "invoice.docx")).rejects.toThrow("invoice.docx can't be attached: use the XML, the signed .p7m, or a PDF.")
    await expect(files.upload(userId, new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), "big.pdf")).rejects.toThrow("big.pdf is over the 10 MB limit.")
  })

  it.each(["a/b", "..", "x/../y", ""])("refuses the user id %j: no path can leave the caller's folder", async (id) => {
    await expect(files.upload(id, text("x"), "a.xml")).rejects.toThrow("Invalid user")
  })

  it.each([
    "secret.pdf",
    `users/${userId}/company-files/../../other/company-files/x.xml`,
    `users/${userId}/company-files/sub/x.xml`,
    `users/${userId}/company-files/x.txt`,
    `users/${userId}/accounts/x.xml`,
  ])("reads and removes nothing at %s", async (path) => {
    await expect(files.download({ path })).rejects.toThrow("Not a company file path")
    await expect(files.remove(path)).rejects.toThrow("Not a company file path")
  })

  // The slice checks the shape of a path, not whose folder it is: the tools' ownFolder guard (invoice-files.ts) is the line that keeps a caller to their own uid.
  it("serves a well-formed path in another user's folder: whose folder it is is the tools' guard, not the slice's", async () => {
    const path = "users/someone-else/company-files/x.pdf"
    await getAdminBucket()!.file(path).save("%PDF-other", { contentType: "application/pdf" })
    expect(await read({ path })).toBe("%PDF-other")
    await files.remove(path)
  })
})
