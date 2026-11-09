import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import { createMockAdapter, __resetMockState } from "../mock"

import type { BackendAdapter, DatabaseAdapter } from "../types"

const USER = "user-1"
const OTHER_USER = "user-2"

let adapter: BackendAdapter
let db: DatabaseAdapter

beforeEach(() => {
  __resetMockState()
  adapter = createMockAdapter()
  db = adapter.db
})

// ─── Auth adapter ─────────────────────────────────────────────────────────────

describe("auth adapter", () => {
  afterEach(async () => {
    // Ensure mockUser is cleared between tests (not reset by __resetMockState)
    await adapter.auth.signOut()
  })

  it("signIn returns a user with the given email and a derived displayName", async () => {
    const user = await adapter.auth.signIn("alice@example.com", "pass")
    expect(user.email).toBe("alice@example.com")
    expect(user.displayName).toBe("alice")
    expect(user.id).toBeTruthy()
  })

  it("signUp returns a user with the provided displayName", async () => {
    const user = await adapter.auth.signUp("bob@example.com", "pass", "Bob")
    expect(user.email).toBe("bob@example.com")
    expect(user.displayName).toBe("Bob")
  })

  it("getCurrentUser returns null when no user is signed in", async () => {
    expect(await adapter.auth.getCurrentUser()).toBeNull()
  })

  it("getCurrentUser returns the signed-in user", async () => {
    await adapter.auth.signIn("alice@example.com", "pass")
    const user = await adapter.auth.getCurrentUser()
    expect(user?.email).toBe("alice@example.com")
  })

  it("signOut clears the current user", async () => {
    await adapter.auth.signIn("alice@example.com", "pass")
    await adapter.auth.signOut()
    expect(await adapter.auth.getCurrentUser()).toBeNull()
  })

  it("onAuthStateChanged fires immediately and on each auth change", async () => {
    const events: Array<string | null> = []
    const unsub = adapter.auth.onAuthStateChanged((u) =>
      events.push(u ? u.email : null)
    )
    expect(events).toHaveLength(1)   // immediate call with null
    expect(events[0]).toBeNull()

    await adapter.auth.signIn("alice@example.com", "pass")
    expect(events).toHaveLength(2)
    expect(events[1]).toBe("alice@example.com")

    await adapter.auth.signOut()
    expect(events).toHaveLength(3)
    expect(events[2]).toBeNull()

    unsub()
    // After unsubscribing the callback should no longer fire
    await adapter.auth.signIn("bob@example.com", "pass")
    expect(events).toHaveLength(3)
  })
})

// ─── updateProfile ──────────────────────────────────────────────────────────

describe("updateProfile", () => {
  it("updates displayName", async () => {
    await adapter.auth.signUp("test@test.com", "password", "Old Name")
    await adapter.auth.updateProfile({ displayName: "New Name" })
    const user = await adapter.auth.getCurrentUser()
    expect(user?.displayName).toBe("New Name")
  })

  it("updates email", async () => {
    await adapter.auth.signUp("old@test.com", "password", "Name")
    await adapter.auth.updateProfile({ email: "new@test.com" })
    const user = await adapter.auth.getCurrentUser()
    expect(user?.email).toBe("new@test.com")
  })

  it("throws when not signed in", async () => {
    await expect(adapter.auth.updateProfile({ displayName: "X" })).rejects.toThrow("Not signed in")
  })

  it("notifies auth listeners after update", async () => {
    await adapter.auth.signUp("test@test.com", "password", "Old Name")
    let notifiedName: string | null = null
    adapter.auth.onAuthStateChanged((u) => { notifiedName = u?.displayName ?? null })
    await adapter.auth.updateProfile({ displayName: "New Name" })
    expect(notifiedName).toBe("New Name")
  })
})

// ─── __resetMockState ────────────────────────────────────────────────────────

describe("__resetMockState", () => {
  it("clears auth state and callbacks", async () => {
    await adapter.auth.signUp("test@test.com", "password", "Name")
    __resetMockState()
    adapter = createMockAdapter()
    const user = await adapter.auth.getCurrentUser()
    expect(user).toBeNull()
  })

  it("clears timecards", async () => {
    await db.setTimecard(USER, { engagementId: "e1", date: "2026-09-21", hours: 6 })
    __resetMockState()
    adapter = createMockAdapter()
    expect(await adapter.db.getTimecards(USER)).toEqual([])
  })

  it("clears meetings", async () => {
    await db.createMeeting(USER, {
      clientId: "c1", engagementId: null, date: "2026-09-21", time: null, health: null, text: "Call",
    })
    __resetMockState()
    adapter = createMockAdapter()
    expect(await adapter.db.getMeetings(USER)).toEqual([])
  })

  it("clears solutions", async () => {
    await db.createSolution(USER, { clientId: "c1", name: "Product knowledge graph" })
    __resetMockState()
    adapter = createMockAdapter()
    expect(await adapter.db.getSolutions(USER)).toEqual([])
  })

  it("clears company accounts and movements", async () => {
    await db.createCompanyAccount(USER, { name: "Bank A", openingBalance: 0, openingDate: new Date("2026-05-01") })
    await db.createCompanyMovement(USER, {
      kind: "income", direction: "in", amount: 10, date: new Date("2026-05-02"), accountId: "acc-a", description: "Rent",
    })
    __resetMockState()
    adapter = createMockAdapter()
    expect(await adapter.db.getCompanyAccounts(USER)).toEqual([])
    expect(await adapter.db.getCompanyMovements(USER)).toEqual([])
  })
})

// ─── Delete cascades, ownership ──────────────────────────────────────────────
//
// The cascade walks whole maps looking for dependents, so it has to filter by
// owner on the way. The shared adapter contract can't test this: its
// `otherUserId` is a uid the Firebase client isn't authenticated as, so there
// the rules refuse the cascade's reads before any delete happens.

describe("delete cascades — ownership", () => {
  it("deleteClient for the wrong user touches nothing", async () => {
    const client = await db.createClient(USER, { name: "Mine" })
    const engagement = await db.createEngagement(USER, {
      clientId: client.id,
      dailyRate: 100,
      vatApplicable: false,
      defaultDaysPerMonth: 10,
    })
    const allocation = await db.createAllocation(USER, {
      engagementId: engagement.id,
      yearMonth: "2027-04",
      days: 5,
    })

    await db.deleteClient(OTHER_USER, client.id)

    expect(await db.getClients(USER)).toHaveLength(1)
    expect(await db.getEngagements(USER)).toHaveLength(1)
    expect((await db.getAllocations(USER))[0].id).toBe(allocation.id)
  })

  it("deleting a client leaves another user's identically-named data alone", async () => {
    const mine = await db.createClient(USER, { name: "Shared Name" })
    const theirs = await db.createClient(OTHER_USER, { name: "Shared Name" })
    const theirEngagement = await db.createEngagement(OTHER_USER, {
      clientId: theirs.id,
      dailyRate: 100,
      vatApplicable: false,
      defaultDaysPerMonth: 10,
    })
    await db.createAllocation(OTHER_USER, {
      engagementId: theirEngagement.id,
      yearMonth: "2027-04",
      days: 5,
    })

    await db.deleteClient(USER, mine.id)

    expect(await db.getClients(USER)).toHaveLength(0)
    expect(await db.getClients(OTHER_USER)).toHaveLength(1)
    expect(await db.getEngagements(OTHER_USER)).toHaveLength(1)
    expect(await db.getAllocations(OTHER_USER)).toHaveLength(1)
  })

  it("deleteEngagement for the wrong user leaves its allocations", async () => {
    const client = await db.createClient(USER, { name: "Mine" })
    const engagement = await db.createEngagement(USER, {
      clientId: client.id,
      dailyRate: 100,
      vatApplicable: false,
      defaultDaysPerMonth: 10,
    })
    await db.createAllocation(USER, {
      engagementId: engagement.id,
      yearMonth: "2027-05",
      days: 5,
    })

    await db.deleteEngagement(OTHER_USER, engagement.id)

    expect(await db.getEngagements(USER)).toHaveLength(1)
    expect(await db.getAllocations(USER)).toHaveLength(1)
  })

  // Verbali name their client and contract by id alone, so another user's
  // documents naming the same ids must survive every cascade untouched.
  it("leaves another user's verbali alone when a contract moves, is deleted, or its client is", async () => {
    const client = await db.createClient(USER, { name: "Mine" })
    const engagement = await db.createEngagement(USER, {
      clientId: client.id,
      dailyRate: 100,
      vatApplicable: false,
      defaultDaysPerMonth: 10,
    })
    const verbale = { date: "2026-09-21", time: null, health: "red" as const, text: "Non mio" }
    const onContract = await db.createMeeting(OTHER_USER, { ...verbale, clientId: client.id, engagementId: engagement.id })
    const onClient = await db.createMeeting(OTHER_USER, { ...verbale, clientId: client.id, engagementId: null })
    const theirs = async () => (await db.getMeetings(OTHER_USER)).sort((a, b) => a.id.localeCompare(b.id))
    const before = await theirs()

    await db.updateEngagement(USER, engagement.id, { clientId: "elsewhere" })
    await db.deleteEngagement(USER, engagement.id)
    await db.deleteClient(USER, client.id)

    expect(await theirs()).toEqual(before)
    expect(before.map((m) => m.id).sort()).toEqual([onContract.id, onClient.id].sort())
  })

  it("leaves another user's solutions alone when a contract moves, is deleted, or its client is", async () => {
    const client = await db.createClient(USER, { name: "Mine" })
    const engagement = await db.createEngagement(USER, {
      clientId: client.id,
      dailyRate: 100,
      vatApplicable: false,
      defaultDaysPerMonth: 10,
    })
    await db.createSolution(OTHER_USER, { clientId: client.id, engagementId: engagement.id, name: "Not mine" })
    await db.createSolution(OTHER_USER, { clientId: client.id, name: "Not mine either" })
    const before = await db.getSolutions(OTHER_USER)

    await db.updateEngagement(USER, engagement.id, { clientId: "elsewhere" })
    await db.deleteEngagement(USER, engagement.id)
    await db.deleteClient(USER, client.id)

    expect(await db.getSolutions(OTHER_USER)).toEqual(before)
    expect(before).toHaveLength(2)
  })

  it("updateSolution and deleteSolution for the wrong user touch nothing", async () => {
    const x = await db.createSolution(USER, { clientId: "c1", name: "Mine" })
    await expect(db.updateSolution(OTHER_USER, x.id, { name: "Stolen" })).rejects.toThrow("Solution not found")
    await db.deleteSolution(OTHER_USER, x.id)
    expect(await db.getSolutions(USER)).toEqual([x])
  })

  it("updateMeeting and deleteMeeting for the wrong user touch nothing", async () => {
    const m = await db.createMeeting(USER, {
      clientId: "c1", engagementId: null, date: "2026-09-21", time: null, health: null, text: "Mio",
    })
    await expect(db.updateMeeting(OTHER_USER, m.id, { text: "Rubato" })).rejects.toThrow()
    await db.deleteMeeting(OTHER_USER, m.id)
    expect(await db.getMeetings(USER)).toEqual([m])
  })
})

// ─── Solutions: the mock parses every write, as the rules and zod would ─────

describe("solutions refuse what zod refuses", () => {
  const graph = {
    entities: [
      { name: "Product", source: "SAP MARA", notes: null },
      { name: "Category", source: "Akeneo", notes: null },
    ],
    relations: [{ from: "Product", to: "Category", type: "IN_CATEGORY" }],
  }

  it("refuses a relation naming a missing entity on create, and stores nothing", async () => {
    await expect(
      db.createSolution(USER, { clientId: "c1", name: "G", ...graph, relations: [{ from: "Supplier", to: "Product", type: "SUPPLIES" }] }),
    ).rejects.toThrow(/No entity is named .+Supplier/)
    expect(await db.getSolutions(USER)).toEqual([])
  })

  it("checks an update's relations against the stored entities, and its entities against the stored relations", async () => {
    const x = await db.createSolution(USER, { clientId: "c1", name: "G", ...graph })
    await expect(db.updateSolution(USER, x.id, { relations: [{ from: "Order", to: "Product", type: "CONTAINS" }] })).rejects.toThrow()
    await expect(db.updateSolution(USER, x.id, { entities: [graph.entities[0]] })).rejects.toThrow(/No entity is named .+Category/)
    const ok = await db.updateSolution(USER, x.id, { relations: [{ from: "Category", to: "Product", type: "HOLDS" }] })
    expect(ok.relations).toEqual([{ from: "Category", to: "Product", type: "HOLDS" }])
    expect(await db.getSolutions(USER)).toEqual([ok])
  })

  it("refuses an unknown section key, an oversized section and duplicate entities, keeping the stored solution", async () => {
    const x = await db.createSolution(USER, { clientId: "c1", name: "G", ...graph })
    const bad = [
      { sections: { appendix: "No" } },
      { sections: { kpis: "x".repeat(20_001) } },
      { entities: [...graph.entities, graph.entities[0]] },
      { status: "archived" },
      { name: " " },
    ]
    for (const input of bad) {
      await expect(db.updateSolution(USER, x.id, input as never), JSON.stringify(input).slice(0, 60)).rejects.toThrow()
    }
    expect(await db.getSolutions(USER)).toEqual([x])
  })

  it("never moves a solution to another client, and stores copies, not the caller's arrays", async () => {
    const stack = ["Neo4j"]
    const x = await db.createSolution(USER, { clientId: "c1", name: "G", stack })
    stack.push("kafka")
    expect(x.stack).toEqual(["neo4j"])
    const moved = await db.updateSolution(USER, x.id, { clientId: "c2", name: "H" } as never)
    expect(moved).toMatchObject({ clientId: "c1", name: "H" })
  })
})

// ─── E2E latency hook ────────────────────────────────────────────────────────

describe("window.__MOCK_LATENCY_MS__", () => {
  const g = globalThis as { __MOCK_LATENCY_MS__?: number }

  afterEach(() => {
    delete g.__MOCK_LATENCY_MS__
    vi.useRealTimers()
  })

  it("holds every db call that long, so e2e can see loading states", async () => {
    vi.useFakeTimers()
    await db.createClient(USER, { name: "Slow" })
    g.__MOCK_LATENCY_MS__ = 400

    let clients: unknown[] | undefined
    const read = db.getClients(USER).then((a) => (clients = a))
    await vi.advanceTimersByTimeAsync(399)
    expect(clients).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await read
    expect(clients).toHaveLength(1)
  })
})

describe("invoice files", () => {
  it("deleting a cost deletes only an object under the user's own company-files folder", async () => {
    const mine = await adapter.files.upload(USER, new Blob(["<a/>"]), "mine.xml")
    const theirs = await adapter.files.upload(OTHER_USER, new Blob(["<b/>"]), "theirs.xml")
    const own = await db.createCompanyExpense(USER, { description: "Own", category: "other", amount: 10, date: new Date(), file: mine })
    const foreign = await db.createCompanyExpense(USER, { description: "Foreign", category: "other", amount: 10, date: new Date(), file: theirs })
    await db.deleteCompanyExpense(USER, own.id)
    await db.deleteCompanyExpense(USER, foreign.id)
    await expect(adapter.files.download(mine)).rejects.toThrow("File not found")
    await expect(adapter.files.download(theirs).then((b) => b.text())).resolves.toBe("<b/>")
  })
})
