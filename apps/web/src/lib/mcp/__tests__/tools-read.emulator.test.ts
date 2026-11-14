/**
 * MCP read tools — end-to-end through the route handler, real Firestore.
 *
 * The load-bearing assertions are the chat==UI invariants: every number a tool
 * returns is compared against a direct call of the same engine functions the
 * web UI uses (buildProjection, resolveAllocationGrid, computeBurnDown,
 * weightedPipelineMonthly). If these drift, chat and UI disagree — the one
 * failure mode this server must not have.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts).
 */
import { formatYearMonth, isoDate } from "@alter-ego/kernel/dates"
import { addDays, addMonths, endOfISOWeek, format, startOfISOWeek, subDays, subMonths } from "date-fns"
import { createUserWithEmailAndPassword } from "firebase/auth"
import { beforeAll, describe, expect, it } from "vitest"

import { POST as mcp } from "@/app/api/mcp/route"
import { POST as approve } from "@/app/api/oauth/authorize/route"
import { POST as register } from "@/app/api/oauth/register/route"
import { POST as token } from "@/app/api/oauth/token/route"
import * as admin from "@/lib/backend/firebase-admin"
import { monthEnd } from "@/lib/cash-book"
import {
  computeBurnDown,
  resolveAllocationGrid,
  toRevenueSources,
} from "@/lib/engagement-burndown"
import { engagementLabel } from "@/lib/engagements"
import { getAdminFirestore } from "@/lib/firebase-admin-client"
import { getFirebaseAuth } from "@/lib/firebase-client"
import { clientBilling, invoicePeriodLabel, invoiceSuggestions, suggestedDueDate } from "@/lib/invoices"
import { registerCrmReadTools } from "@/lib/mcp/tools/crm-read"
import { registerCrmWriteTools } from "@/lib/mcp/tools/crm-write"
import { healthByContract } from "@/lib/meetings"
import { STEP_ORDER, monthEndChecklist, openMonths } from "@/lib/month-end"
import { s256 } from "@/lib/oauth/pkce"
import { weightedPipelineMonthly } from "@/lib/opportunities"
import { buildProjection } from "@/lib/projection"

import type { MonthEndItem, StepKey } from "@/lib/month-end"
import type { Allocation, Client, Engagement, MeetingHealth, Opportunity } from "@/types"
import type { McpServer } from "@modelcontextprotocol/server"

const ORIGIN = "https://mcp.test"
const REDIRECT = "https://claude.ai/api/mcp/auth_callback"
const VERIFIER = "a".repeat(43)

const currentMonth = format(new Date(), "yyyy-MM")

let userId = ""
let idToken = ""
let bearer = ""

// Seeded fixtures, kept for direct engine calls in the invariants.
let clients: Client[] = []
let engagements: Engagement[] = []
let opportunities: Opportunity[] = []
let allocations: Allocation[] = []

/** Full OAuth dance against the emulator — same path Claude takes. */
async function mintAccessToken(idToken: string, scope = "data:read data:write"): Promise<string> {
  const reg = await register(
    new Request(`${ORIGIN}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "test", redirect_uris: [REDIRECT] }),
    })
  )
  const { client_id: clientId } = (await reg.json()) as { client_id: string }

  const auth = await approve(
    new Request(`${ORIGIN}/api/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idToken,
        clientId,
        redirectUri: REDIRECT,
        scope,
        codeChallenge: await s256(VERIFIER),
        codeChallengeMethod: "S256",
      }),
    })
  )
  const { code } = (await auth.json()) as { code: string }

  const tok = await token(
    new Request(`${ORIGIN}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: VERIFIER,
        client_id: clientId,
        redirect_uri: REDIRECT,
      }),
    })
  )
  return ((await tok.json()) as { access_token: string }).access_token
}

/** Calls one tool through the real route and parses the SSE envelope. */
async function callTool(name: string, args: Record<string, unknown> = {}, as = bearer): Promise<{
  isError: boolean
  payload: Record<string, unknown>
}> {
  const res = await mcp(
    new Request(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${as}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    })
  )
  expect(res.status).toBe(200)
  const text = await res.text()
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "))
  expect(dataLine, `no data line in: ${text.slice(0, 200)}`).toBeTruthy()
  const rpc = JSON.parse(dataLine!.slice(6)) as {
    result: { isError?: boolean; content: [{ text: string }] }
  }
  return {
    isError: rpc.result.isError ?? false,
    payload: JSON.parse(rpc.result.content[0].text) as Record<string, unknown>,
  }
}

beforeAll(async () => {
  const { user } = await createUserWithEmailAndPassword(
    getFirebaseAuth(),
    `mcp-read-${Date.now()}@example.com`,
    "Test1234!"
  )
  userId = user.uid
  idToken = await user.getIdToken()
  bearer = await mintAccessToken(idToken)

  // Fixtures: two clients; a capped and an uncapped engagement; open + closed
  // opportunities; explicit allocations including a stored 0.
  const acme = await admin.createClient(userId, { name: "Acme Spa" })
  const beta = await admin.createClient(userId, { name: "Beta Srl" })

  const e1 = await seedEngagement({
    clientId: acme.id, dailyRate: 1300, defaultDaysPerMonth: 10, contractedDays: 25, name: "Migrazione cloud",
  })
  const e2 = await seedEngagement({ clientId: beta.id, dailyRate: 1000, defaultDaysPerMonth: 5 })

  await admin.createOpportunity(userId, {
    clientId: acme.id, title: "Nuovo progetto", stage: "proposal", probability: 50,
    dailyRate: 1600, estimatedDaysPerMonth: 8, estimatedDurationMonths: 6, vatApplicable: true,
  })
  const wonSeed = await admin.createOpportunity(userId, {
    clientId: beta.id, title: "Chiusa", stage: "lead", probability: 20,
    dailyRate: 1000, estimatedDaysPerMonth: 4, estimatedDurationMonths: 2, vatApplicable: true,
  })
  await admin.updateOpportunity(userId, wonSeed.id, { stage: "won", probability: 100, closedAt: new Date() })

  await admin.createAllocation(userId, { engagementId: e1, yearMonth: currentMonth, days: 12 })
  await admin.createAllocation(userId, { engagementId: e2, yearMonth: currentMonth, days: 0 }) // stored zero

  // Invoices on fixed past months so the basis assertions never depend on today:
  // an unpaid overdue one, a nota di credito paid in a different month than its
  // competenza, and a normal invoice paid in that same cash month.
  await seedInvoice({
    engagementId: e1, number: "1", yearMonth: "2026-01", amount: 10000, vat: 2200,
    dueDate: new Date("2020-02-28"), paidDate: null,
  })
  await seedInvoice({
    engagementId: e1, number: "2", yearMonth: "2026-01", amount: -1000, vat: -220,
    dueDate: null, paidDate: new Date("2026-03-15"),
  })
  await seedInvoice({
    engagementId: e2, number: "3", yearMonth: "2026-02", amount: 5000, vat: 1100,
    dueDate: new Date("2026-04-30"), paidDate: new Date("2026-03-10"),
  })

  clients = await admin.getClients(userId)
  engagements = await admin.getEngagements(userId)
  opportunities = await admin.getOpportunities(userId)
  allocations = await admin.getAllocations(userId)
})

async function seedEngagement(
  over: { clientId: string; dailyRate: number; defaultDaysPerMonth: number; contractedDays?: number; name?: string }
): Promise<string> {
  // No createEngagement admin function by design — seed directly like the UI would.
  const { getAdminFirestore } = await import("@/lib/firebase-admin-client")
  const ref = await getAdminFirestore()
    .collection("users").doc(userId).collection("engagements")
    .add({
      userId,
      clientId: over.clientId,
      opportunityId: null,
      dailyRate: over.dailyRate,
      vatApplicable: true,
      contractedDays: over.contractedDays ?? null,
      defaultDaysPerMonth: over.defaultDaysPerMonth,
      startMonth: null,
      isActive: true,
      notes: null,
      // Unnamed seeds carry no name field at all, like documents written before it existed.
      ...(over.name && { name: over.name }),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  return ref.id
}

/** Same story for invoices: the admin module is read-only by design. */
async function seedInvoice(invoice: {
  engagementId: string
  number: string
  yearMonth: string
  amount: number
  vat: number
  dueDate: Date | null
  paidDate: Date | null
}): Promise<void> {
  const { getAdminFirestore } = await import("@/lib/firebase-admin-client")
  await getAdminFirestore()
    .collection("users").doc(userId).collection("invoices")
    .add({ userId, ...invoice, createdAt: new Date(), updatedAt: new Date() })
}

describe("tool input limit", () => {
  it("rejects arguments with more than 5000 elements", async () => {
    const res = await mcp(
      new Request(`${ORIGIN}/api/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "ping", arguments: { junk: Array.from({ length: 6000 }, (_, i) => i) } },
        }),
      })
    )
    const text = await res.text()
    expect(text).toContain("arguments contain more than the maximum of 5000 elements")
  })
})

describe("get_revenue", () => {
  it("equals the projection engine's line revenue for the same window (committed)", async () => {
    const { payload } = await callTool("get_revenue", { from: currentMonth, to: currentMonth })

    const sources = toRevenueSources({ engagements, opportunities: [], clients, scenario: "committed" })
    const months = buildProjection({ sources, allocations, fromMonth: currentMonth, months: 1 })
    const expected = months[0].lines.reduce((s, l) => s + l.revenue, 0)

    expect(payload.total).toBe(Math.round(expected * 100) / 100)
    expect(payload.basis).toBe("accrued")
    expect(payload.scenario).toBe("committed")
  })

  it("honours the stored zero: Beta contributes nothing this month", async () => {
    const { payload } = await callTool("get_revenue", {
      from: currentMonth,
      to: currentMonth,
      groupBy: "client",
    })
    const rows = payload.rows as { key: string; revenue: number; plannedDays: number }[]
    // The stored 0 must be honoured as zero — if it were treated as missing,
    // Beta would bill its 5-day default (€5000).
    const betaRow = rows.find((r) => r.key === "Beta Srl")
    expect(betaRow?.revenue).toBe(0)
    expect(betaRow?.plannedDays).toBe(0)
    const acme = rows.find((r) => r.key === "Acme Spa")
    expect(acme?.revenue).toBe(12 * 1300)
  })

  it("weighted scenario adds open pipeline at probability", async () => {
    const { payload } = await callTool("get_revenue", {
      from: currentMonth,
      to: currentMonth,
      scenario: "weighted",
    })
    const sources = toRevenueSources({
      engagements,
      opportunities: opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost"),
      clients,
      scenario: "weighted",
    })
    const months = buildProjection({ sources, allocations, fromMonth: currentMonth, months: 1 })
    const expected = months[0].lines.reduce((s, l) => s + l.revenue, 0)
    expect(payload.total).toBe(Math.round(expected * 100) / 100)
  })

  it("groups by quarter with lexicographic keys", async () => {
    const { payload } = await callTool("get_revenue", {
      from: "2026-04",
      to: "2026-09",
      groupBy: "quarter",
    })
    const rows = payload.rows as { key: string }[]
    expect(rows.map((r) => r.key)).toEqual(["2026-Q2", "2026-Q3"])
  })

  it("basis invoiced groups real invoices by their competenza month", async () => {
    const { payload } = await callTool("get_revenue", {
      from: "2026-01",
      to: "2026-02",
      basis: "invoiced",
    })
    expect(payload.rows).toEqual([
      // the −1000 nota di credito nets off inside its own competenza month
      { key: "2026-01", revenue: 9000, vat: 1980, count: 2 },
      { key: "2026-02", revenue: 5000, vat: 1100, count: 1 },
    ])
    expect(payload.total).toBe(14000)
    expect(payload.vat).toBe(3080)
    expect(String(payload.summary)).toContain("Invoiced")
  })

  it("basis paid keys on the payment month, not competenza", async () => {
    const { payload } = await callTool("get_revenue", { from: "2026-03", basis: "paid" })
    // Both collected invoices land in March even though they accrued in Jan/Feb.
    expect(payload.rows).toEqual([{ key: "2026-03", revenue: 4000, vat: 880, count: 2 }])
    expect(String(payload.summary)).toContain("Collected")

    // ...and nothing shows up under the competenza months for this basis.
    const { payload: jan } = await callTool("get_revenue", {
      from: "2026-01",
      to: "2026-02",
      basis: "paid",
    })
    expect(jan.rows).toEqual([])
    expect(jan.total).toBe(0)
  })

  it("basis paid excludes the unpaid invoice entirely", async () => {
    const { payload } = await callTool("get_revenue", {
      from: "2026-01",
      to: "2026-12",
      basis: "paid",
      groupBy: "client",
    })
    const rows = payload.rows as { key: string; revenue: number; vat: number; count: number }[]
    // Acme's only paid row is the −1000 credit note; the €10000 unpaid one is absent.
    expect(rows.find((r) => r.key === "Acme Spa")).toEqual({
      key: "Acme Spa",
      revenue: -1000,
      vat: -220,
      count: 1,
    })
    expect(payload.total).toBe(4000)
  })

  it("refuses scenario weighted on a non-accrued basis instead of ignoring it", async () => {
    const { isError, payload } = await callTool("get_revenue", {
      from: "2026-01",
      basis: "invoiced",
      scenario: "weighted",
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("weighted")
  })

  it("rejects garbage months readably", async () => {
    const { isError, payload } = await callTool("get_revenue", { from: "2026-08", to: "2026-13" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("Invalid date")
  })
})

describe("list_invoices", () => {
  type Row = {
    number: string
    client: string | null
    clientId: string | null
    total: number
    overdue: boolean
    paidDate: string | null
  }

  it("lists every invoice, unpaid first, with the total owed", async () => {
    const { payload } = await callTool("list_invoices")
    const rows = payload.invoices as Row[]
    expect(rows).toHaveLength(3)
    expect(rows[0].number).toBe("1") // unpaid sorts ahead of the two paid ones
    expect(rows[0].total).toBe(12200) // 10000 + 2200 IVA
    expect(rows.find((r) => r.number === "2")?.total).toBe(-1220) // nota di credito
  })

  it("unpaidOnly answers 'chi non mi ha pagato' and flags the overdue amount", async () => {
    const { payload } = await callTool("list_invoices", { unpaidOnly: true })
    const rows = payload.invoices as Row[]
    expect(rows.map((r) => r.number)).toEqual(["1"])
    expect(rows[0].overdue).toBe(true)
    expect(rows[0].paidDate).toBeNull()
    expect(payload.summary).toBe("1 unpaid invoice, 1 overdue (€12200).")
  })

  it("filters by client name and by competenza month", async () => {
    const { payload: beta } = await callTool("list_invoices", { client: "beta" })
    expect((beta.invoices as Row[]).map((r) => r.number)).toEqual(["3"])
    expect((beta.invoices as Row[])[0].client).toBe("Beta Srl")
    // Seeded the old way, a contract and no clientId: the customer comes from the contract.
    expect((beta.invoices as Row[])[0].clientId).toBe(clients.find((c) => c.name === "Beta Srl")!.id)

    const { payload: jan } = await callTool("list_invoices", { yearMonth: "2026-01" })
    expect((jan.invoices as Row[]).map((r) => r.number).sort()).toEqual(["1", "2"])
  })

  it("errors with candidates on an unknown client", async () => {
    const { isError, payload } = await callTool("list_invoices", { client: "Gamma" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("Acme Spa")
  })
})

describe("get_pipeline", () => {
  it("total equals weightedPipelineMonthly and stages carry the open opps", async () => {
    const { payload } = await callTool("get_pipeline")
    expect(payload.weightedMonthlyTotal).toBe(weightedPipelineMonthly(opportunities))

    const stages = payload.stages as { stage: string; opportunities: unknown[] }[]
    expect(stages.map((s) => s.stage)).toEqual(["lead", "proposal", "negotiation"])
    expect(stages.find((s) => s.stage === "proposal")?.opportunities).toHaveLength(1)
    expect(payload.closed as unknown[]).toHaveLength(1)
  })
})

describe("list_clients", () => {
  it("activeMonthly matches the clients page formula", async () => {
    const { payload } = await callTool("list_clients")
    const rows = payload.clients as { name: string; activeMonthly: number; openOpportunities: number }[]

    const acme = rows.find((r) => r.name === "Acme Spa")!
    // Direct formula: Σ defaultDaysPerMonth × dailyRate over Acme's active engagements
    const acmeClient = clients.find((c) => c.name === "Acme Spa")!
    const manual = engagements
      .filter((e) => e.isActive && e.clientId === acmeClient.id)
      .reduce((s, e) => s + e.defaultDaysPerMonth * e.dailyRate, 0)
    expect(acme.activeMonthly).toBe(manual)
    expect(acme.openOpportunities).toBe(1)
  })
})

describe("get_client", () => {
  it("resolves by partial name and reports exhaustionMonth from the burn-down", async () => {
    const { payload } = await callTool("get_client", { client: "acme" })
    const client = payload.client as { name: string }
    expect(client.name).toBe("Acme Spa")

    const sources = toRevenueSources({ engagements, opportunities: [], clients, scenario: "committed" })
    const burn = computeBurnDown({ sources, allocations, fromMonth: currentMonth, months: 36 })
    const acmeEng = engagements.find((e) => e.contractedDays === 25)!
    const expected = burn.find((b) => b.sourceId === acmeEng.id)!.exhaustionMonth

    const engs = payload.engagements as { id: string; name: string | null; exhaustionMonth: string | null }[]
    expect(engs.find((e) => e.id === acmeEng.id)?.exhaustionMonth).toBe(expected)
    expect(engs.find((e) => e.id === acmeEng.id)?.name).toBe("Migrazione cloud")
    expect(expected).not.toBeNull() // 25 contracted at 12+10/mo must exhaust within 36 months
  })

  it("errors with candidates on an unknown client", async () => {
    const { isError, payload } = await callTool("get_client", { client: "Gamma" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("Acme Spa")
  })
})

describe("get_plan / get_capacity", () => {
  it("plan lines equal the plan grid for the same window", async () => {
    const { payload } = await callTool("get_plan", { months: 3 })
    const sources = toRevenueSources({ engagements, opportunities: [], clients, scenario: "committed" })
    const cells = resolveAllocationGrid({ sources, allocations, fromMonth: currentMonth, months: 3 })

    const months = payload.months as {
      yearMonth: string
      lines: { clientName: string; plannedDays: number; billableDays: number }[]
    }[]
    expect(months).toHaveLength(3)
    for (const m of months) {
      for (const line of m.lines) {
        const cell = cells.find((c) => c.yearMonth === m.yearMonth && c.clientName === line.clientName)
        expect(cell, `${m.yearMonth}/${line.clientName}`).toBeTruthy()
        expect(line.plannedDays).toBe(cell!.plannedDays)
        expect(line.billableDays).toBe(cell!.billableDays)
      }
    }
  })

  it("capacity defaults to weekday count and reflects allocations", async () => {
    const { payload } = await callTool("get_capacity", { from: currentMonth, months: 1 })
    const [month] = payload.months as {
      yearMonth: string
      availableDays: number
      allocatedDays: number
    }[]
    expect(month.yearMonth).toBe(currentMonth)
    expect(month.availableDays).toBeGreaterThanOrEqual(20) // any month has ≥20 weekdays
    expect(month.allocatedDays).toBe(12) // 12 explicit + 0 stored-zero
  })
})

describe("list_tasks", () => {
  let migrazione: Engagement
  let beta: Engagement
  const titles = (payload: Record<string, unknown>) =>
    (payload.tasks as { title: string }[]).map((t) => t.title)

  // Seeded here, after every other suite has read its fixtures: a late todo, an
  // in-progress and a done task on the named contract; a future todo on Beta's.
  // Labels go in raw, as a caller would type them; the adapter normalizes them.
  beforeAll(async () => {
    migrazione = engagements.find((e) => e.name === "Migrazione cloud")!
    beta = engagements.find((e) => e.name === null)!
    const task = (engagementId: string, title: string, dueDate: Date | null = null, labels: string[] = []) =>
      admin.createTask(userId, {
        clientId: engagements.find((e) => e.id === engagementId)!.clientId, engagementId, title, dueDate, notes: null,
        labels,
      })
    await task(migrazione.id, "Kickoff", new Date("2020-01-10T00:00:00"), [" Urgente ", "fattura   cliente"])
    const deploy = await task(migrazione.id, "Deploy")
    await admin.updateTask(userId, deploy.id, { startedAt: new Date() })
    const closed = await task(migrazione.id, "Chiuso", null, ["urgente"])
    await admin.updateTask(userId, closed.id, { isDone: true })
    await task(beta.id, "Report Beta", new Date("2099-01-01T00:00:00"), ["URGENTE"])
  })

  it("labels each row with status, client and contract, and describes each contract once", async () => {
    const { isError, payload } = await callTool("list_tasks")
    expect(isError).toBe(false)
    expect(payload.summary).toBe("3 tasks: 2 to do, 1 in progress, 1 overdue.")
    expect(payload.tasks).toEqual([
      expect.objectContaining({
        title: "Kickoff", status: "todo", overdue: true, client: "Acme Spa",
        engagementId: migrazione.id, engagementLabel: "Migrazione cloud",
      }),
      expect.objectContaining({
        title: "Report Beta", status: "todo", overdue: false, client: "Beta Srl",
        engagementId: beta.id, engagementLabel: engagementLabel(beta),
      }),
      expect.objectContaining({ title: "Deploy", status: "doing", engagementId: migrazione.id }),
    ])
    expect(payload.engagements).toEqual([
      {
        id: migrazione.id, name: "Migrazione cloud", label: "Migrazione cloud",
        client: "Acme Spa", dailyRate: 1300, startMonth: null,
      },
      {
        id: beta.id, name: null, label: engagementLabel(beta),
        client: "Beta Srl", dailyRate: 1000, startMonth: null,
      },
    ])
  })

  it("filters to one contract by id, or by name case-insensitively", async () => {
    const byId = await callTool("list_tasks", { engagementId: beta.id })
    expect(titles(byId.payload)).toEqual(["Report Beta"])

    const byName = await callTool("list_tasks", { engagementId: "migrazione CLOUD" })
    expect(titles(byName.payload)).toEqual(["Kickoff", "Deploy"])
    expect((byName.payload.engagements as { id: string }[]).map((e) => e.id)).toEqual([migrazione.id])
  })

  it("scopes a contract name to the client, listing that client's contracts on a miss", async () => {
    const { isError, payload } = await callTool("list_tasks", { client: "Beta", engagementId: "Migrazione" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain(`${engagementLabel(beta)} (Beta Srl, id ${beta.id})`)
    expect(String(payload.error)).not.toContain("Migrazione cloud (")
  })

  it("status keeps one column and overrides includeDone", async () => {
    const doing = await callTool("list_tasks", { status: "doing" })
    expect(titles(doing.payload)).toEqual(["Deploy"])
    expect(doing.payload.summary).toBe("1 task: 1 in progress.")

    const done = await callTool("list_tasks", { status: "done", includeDone: false })
    expect(titles(done.payload)).toEqual(["Chiuso"])
    expect(done.payload.summary).toBe("1 task: 1 done.")
  })

  it("overdueOnly keeps the late ones; includeDone counts the done column too", async () => {
    const late = await callTool("list_tasks", { overdueOnly: true })
    expect(titles(late.payload)).toEqual(["Kickoff"])

    const all = await callTool("list_tasks", { includeDone: true })
    expect(all.payload.summary).toBe("4 tasks: 2 to do, 1 in progress, 1 done, 1 overdue.")
  })

  it("rows carry their normalized labels; label filters by one, ignoring case and spacing", async () => {
    const all = await callTool("list_tasks")
    expect(
      Object.fromEntries((all.payload.tasks as { title: string; labels: string[] }[]).map((t) => [t.title, t.labels]))
    ).toEqual({ Kickoff: ["Urgente", "fattura cliente"], "Report Beta": ["URGENTE"], Deploy: [] })

    const urgent = await callTool("list_tasks", { label: "urgente" })
    expect(titles(urgent.payload)).toEqual(["Kickoff", "Report Beta"])
    // Done tasks stay hidden unless asked for, as with every other filter.
    const urgentAll = await callTool("list_tasks", { label: "Urgente", includeDone: true })
    expect(titles(urgentAll.payload)).toEqual(["Kickoff", "Report Beta", "Chiuso"])

    // The filter is normalized like a stored label, then matched whole.
    const spaced = await callTool("list_tasks", { label: "  FATTURA  Cliente " })
    expect(titles(spaced.payload)).toEqual(["Kickoff"])
    const partial = await callTool("list_tasks", { label: "fattura" })
    expect(partial.payload.summary).toBe("No tasks.")
  })
})

// #156: closing a contract must not rewrite the months it already billed. Seeded
// after the suites above, so the contracts it adds never reach them.
describe("closed contracts", () => {
  let closedId = ""

  beforeAll(async () => {
    const omega = await admin.createClient(userId, { name: "Omega Srl" })
    // Closed with an end month: billed 4 days a month, January to March 2026.
    const closed = await admin.createEngagement(userId, {
      clientId: omega.id, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 4, startMonth: "2026-01",
    })
    await admin.updateEngagement(userId, closed.id, { isActive: false, endMonth: "2026-03" })
    closedId = closed.id
    // Closed the legacy way, no end month: stays out entirely, stored row and all.
    const legacy = await admin.createEngagement(userId, {
      clientId: omega.id, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 4, startMonth: "2026-01",
    })
    await admin.updateEngagement(userId, legacy.id, { isActive: false })
    await admin.createAllocation(userId, { engagementId: legacy.id, yearMonth: "2026-02", days: 8 })
  })

  it("get_revenue accrued still counts a closed contract's months up to its end", async () => {
    const past = await callTool("get_revenue", { from: "2026-01", to: "2026-06", groupBy: "client" })
    const omega = (past.payload.rows as { key: string; revenue: number; billableDays: number }[])
      .find((r) => r.key === "Omega Srl")
    expect(omega).toMatchObject({ revenue: 3 * 4 * 500, billableDays: 12 })

    const after = await callTool("get_revenue", { from: "2026-04", to: "2026-06", groupBy: "client" })
    const none = (after.payload.rows as { key: string; revenue: number }[]).find((r) => r.key === "Omega Srl")
    expect(none?.revenue).toBe(0)
  })

  it("get_client shows the contract closed, with its end month and last day", async () => {
    const { payload } = await callTool("get_client", { client: "Omega" })
    const engs = payload.engagements as { id: string; isActive: boolean; endMonth: string | null; lastDay: string | null }[]
    // Closed by month, before end dates: its last day is the month's.
    expect(engs.find((e) => e.id === closedId)).toMatchObject({ isActive: false, endMonth: "2026-03", lastDay: "2026-03-31" })
    expect(engs.find((e) => e.id !== closedId)).toMatchObject({ endMonth: null, lastDay: null })

    await admin.updateEngagement(userId, closedId, { endMonth: "2026-03", endDate: "2026-03-12" })
    const dated = await callTool("get_client", { client: "Omega" })
    expect((dated.payload.engagements as { id: string; lastDay: string | null }[]).find((e) => e.id === closedId))
      .toMatchObject({ lastDay: "2026-03-12" })
  })
})

describe("list_time", () => {
  let migrazione: Engagement
  let beta: Engagement
  const monday = startOfISOWeek(new Date())
  const migrazioneFirst = (rows: unknown) =>
    [...(rows as { engagementId: string }[])].sort((a, b) =>
      (a.engagementId === migrazione.id ? 0 : 1) - (b.engagementId === migrazione.id ? 0 : 1)
    )

  // Seeded last, so no other suite sees the extra allocation row. January 2026 is fixed
  // so the month assertions never depend on today; this week's rows exercise the default.
  beforeAll(async () => {
    migrazione = engagements.find((e) => e.name === "Migrazione cloud")!
    beta = engagements.find((e) => e.name === null)!
    const log = (engagementId: string, date: string, hours: number, notes: string | null = null) =>
      admin.setTimecard(userId, { engagementId, date, hours, notes })
    await log(migrazione.id, isoDate(monday), 6)
    await log(beta.id, isoDate(monday), 2)
    await log(migrazione.id, isoDate(subDays(monday, 1)), 8) // last Sunday: outside the default week
    await log(migrazione.id, "2026-01-12", 8, "workshop")
    await log(migrazione.id, "2026-01-13", 8)
    await log(beta.id, "2026-01-12", 4)
    await admin.createAllocation(userId, { engagementId: migrazione.id, yearMonth: "2026-01", days: 3 })
  })

  it("defaults to the current ISO week, one row per day and contract", async () => {
    const { isError, payload } = await callTool("list_time")
    expect(isError).toBe(false)
    const [from, to] = [isoDate(monday), isoDate(endOfISOWeek(monday))]
    expect(payload).toMatchObject({ from, to, groupBy: "day", total: { hours: 8, days: 1 } })
    expect(payload.summary).toBe(`8 hours = 1 day from ${from} to ${to}, on 2 contracts.`)
    expect(migrazioneFirst(payload.rows)).toEqual([
      {
        period: from, engagementId: migrazione.id, contract: "Migrazione cloud", client: "Acme Spa",
        hours: 6, days: 0.75, notes: null,
      },
      {
        period: from, engagementId: beta.id, contract: engagementLabel(beta), client: "Beta Srl",
        hours: 2, days: 0.25, notes: null,
      },
    ])
    expect(payload.byContract).toEqual([
      { engagementId: migrazione.id, contract: "Migrazione cloud", client: "Acme Spa", hours: 6, days: 0.75 },
      { engagementId: beta.id, contract: engagementLabel(beta), client: "Beta Srl", hours: 2, days: 0.25 },
    ])
  })

  it("groups a month with days, the days stored in the plan and what Use would write", async () => {
    const { payload } = await callTool("list_time", { from: "2026-01", groupBy: "month" })
    expect(payload).toMatchObject({ from: "2026-01-01", to: "2026-01-31", total: { hours: 20, days: 2.5 } })
    // Migrazione: its January row anchors the walk, so January is a closed month in the
    // plan at 3 d; 16 h make 2 d, and Use writes them. Beta's first row is the current
    // month, so January is outside its walk: nothing to use.
    expect(migrazioneFirst(payload.rows)).toEqual([
      expect.objectContaining({
        period: "2026-01", engagementId: migrazione.id, hours: 16, days: 2, storedPlannedDays: 3, useDays: 2,
      }),
      expect.objectContaining({
        period: "2026-01", engagementId: beta.id, hours: 4, days: 0.5, storedPlannedDays: null, useDays: null,
      }),
    ])
  })

  it("offers Use on the open month once the hours cover 80% of the weekdays left after the time off", async () => {
    const { weekdaysInMonth } = await import("@alter-ego/kernel/dates")
    const psi = await admin.createClient(userId, { name: "Psi Srl" })
    const e = await admin.createEngagement(userId, {
      clientId: psi.id, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 20, startMonth: currentMonth,
    })
    await admin.createAllocation(userId, { engagementId: e.id, yearMonth: currentMonth, days: 20 })
    const weekdays = weekdaysInMonth(currentMonth)
    // Hours on 80% of the weekdays left after 5 days off: enough with the time off, short of 80% of all.
    const covered = Math.ceil(0.8 * (weekdays - 5))
    expect(covered).toBeLessThan(0.8 * weekdays)
    const loggedDates: string[] = []
    try {
      for (let d = new Date(`${currentMonth}-01T12:00:00`); loggedDates.length < covered; d = addDays(d, 1)) {
        if (d.getDay() === 0 || d.getDay() === 6) continue
        await admin.setTimecard(userId, { engagementId: e.id, date: isoDate(d), hours: 8, notes: null })
        loggedDates.push(isoDate(d))
      }
      const useDays = async () => {
        const { payload } = await callTool("list_time", { from: currentMonth, groupBy: "month" })
        const scheduled = (payload.scheduled as { rows: unknown[] } | undefined)?.rows ?? []
        const row = [...(payload.rows as { engagementId: string }[]), ...(scheduled as { engagementId: string }[])]
          .find((r) => r.engagementId === e.id) as unknown as { useDays: number | null }
        return row.useDays
      }
      expect(await useDays()).toBeNull()
      await admin.setCapacity(userId, { yearMonth: currentMonth, daysOff: 5, availableDays: weekdays - 5, reason: "vacation", note: null })
      expect(await useDays()).toBe(covered)
    } finally {
      // Out of the way of the suites below: no other test expects this contract.
      await admin.setCapacity(userId, { yearMonth: currentMonth, daysOff: 0, availableDays: weekdays, reason: "vacation", note: null })
      await admin.updateEngagement(userId, e.id, { isActive: false, endMonth: currentMonth })
      // The hours go too: left in, a day after today holds them and a later test's own hours on that day.
      for (const date of loggedDates) await admin.deleteTimecard(userId, e.id, date)
    }
  })

  it("groups by ISO week", async () => {
    const { payload } = await callTool("list_time", { from: "2026-01", groupBy: "week" })
    expect(migrazioneFirst(payload.rows)).toEqual([
      expect.objectContaining({ period: "2026-W03", engagementId: migrazione.id, hours: 16 }),
      expect.objectContaining({ period: "2026-W03", engagementId: beta.id, hours: 4 }),
    ])
  })

  it("filters by client and by contract name, and shows a day's notes", async () => {
    const onlyBeta = await callTool("list_time", { from: "2026-01", client: "Beta" })
    expect(onlyBeta.payload.rows).toEqual([expect.objectContaining({ engagementId: beta.id, hours: 4 })])

    const day = await callTool("list_time", { from: "2026-01-12", engagementId: "migrazione" })
    expect(day.payload).toMatchObject({ from: "2026-01-12", to: "2026-01-12", total: { hours: 8 } })
    expect(day.payload.rows).toEqual([expect.objectContaining({ period: "2026-01-12", notes: "workshop" })])
    expect(day.payload.byContract).toHaveLength(1)
  })

  it("still counts a contract that has since been closed", async () => {
    const ref = (await import("@/lib/firebase-admin-client")).getAdminFirestore()
      .collection("users").doc(userId).collection("engagements").doc(beta.id)
    await ref.update({ isActive: false })
    const { payload } = await callTool("list_time", { from: "2026-01", client: "Beta" })
    await ref.update({ isActive: true })
    expect(payload.total).toMatchObject({ hours: 4 })
  })

  it("says so for an empty window", async () => {
    const { isError, payload } = await callTool("list_time", { from: "2025-03" })
    expect(isError).toBe(false)
    expect(payload).toMatchObject({ rows: [], byContract: [], total: { hours: 0, days: 0 } })
    expect(payload.summary).toBe("No hours logged from 2025-03-01 to 2025-03-31.")
  })

  it("caps the window at 12 months and says so", async () => {
    const year = await callTool("list_time", { from: "2025-02", to: "2026-01", groupBy: "month" })
    expect(year.isError).toBe(false)
    expect(year.payload.total).toMatchObject({ hours: 20 })

    const over = await callTool("list_time", { from: "2025-01", to: "2026-01" })
    expect(over.isError).toBe(true)
    expect(String(over.payload.error)).toContain("at most 12 months")

    const noFrom = await callTool("list_time", { to: "2026-01" })
    expect(noFrom.isError).toBe(true)
    expect(String(noFrom.payload.error)).toContain("to needs from as well")
  })

  it("keeps hours after today apart, as scheduled, out of total, byContract and rows", async () => {
    const tomorrow = isoDate(addDays(new Date(), 1))
    await admin.setTimecard(userId, { engagementId: migrazione.id, date: tomorrow, hours: 4, notes: "planning" })
    try {
      const alone = await callTool("list_time", { from: tomorrow })
      expect(alone.payload).toMatchObject({ rows: [], byContract: [], total: { hours: 0, days: 0 } })
      expect(alone.payload.summary).toBe(`No hours worked from ${tomorrow} to ${tomorrow}; 4 hours scheduled.`)
      expect(alone.payload.scheduled).toEqual({
        hours: 4, days: 0.5,
        rows: [{
          period: tomorrow, engagementId: migrazione.id, contract: "Migrazione cloud", client: "Acme Spa",
          hours: 4, days: 0.5, notes: "planning",
        }],
      })

      const both = await callTool("list_time", { from: isoDate(monday), to: tomorrow })
      expect(both.payload.total).toEqual({ hours: 8, days: 1 })
      expect((both.payload.rows as { period: string }[]).map((r) => r.period)).not.toContain(tomorrow)
      expect(String(both.payload.summary)).toMatch(/ Plus 4 hours scheduled after today\.$/)

      // No scheduled block when nothing is ahead.
      expect(await callTool("list_time", { from: "2026-01" })).not.toHaveProperty("payload.scheduled")
    } finally {
      await admin.deleteTimecard(userId, migrazione.id, tomorrow)
    }
  })
})

// Verbali. Seeded last, so no earlier suite sees the extra clients and contracts.
describe("list_meetings and the contract status in get_client", () => {
  let migrazione: Engagement
  let beta: Engagement
  let closed: Engagement
  let assistenza = ""
  let sviluppo = ""
  type Row = { engagementId: string; health: MeetingHealth | null; healthAsOf: string | null }
  const texts = (payload: Record<string, unknown>) => (payload.meetings as { text: string }[]).map((m) => m.text)

  beforeAll(async () => {
    migrazione = engagements.find((e) => e.name === "Migrazione cloud")!
    beta = engagements.find((e) => e.name === null)!
    // Omega's contract closed with an end month, from the "closed contracts" suite.
    closed = (await admin.getEngagements(userId)).find((e) => !e.isActive && e.endMonth === "2026-03")!
    const rho = await admin.createClient(userId, { name: "Rho Srl" })
    const contract = { clientId: rho.id, dailyRate: 400, vatApplicable: true, defaultDaysPerMonth: 1 }
    assistenza = (await admin.createEngagement(userId, { ...contract, name: "Assistenza Rho" })).id
    sviluppo = (await admin.createEngagement(userId, { ...contract, name: "Sviluppo Rho" })).id

    const meet = (e: { id: string | null; clientId: string }, date: string, health: MeetingHealth | null, text: string, time: string | null = null) =>
      admin.createMeeting(userId, { clientId: e.clientId, engagementId: e.id, date, time, health, text })
    await meet(migrazione, "2026-09-02", "green", "Kickoff", "10:00")
    await meet(migrazione, "2026-09-12", "yellow", "Test slittati")
    await meet(migrazione, "2026-09-20", null, "Call veloce", "09:00")
    await meet({ id: null, clientId: migrazione.clientId }, "2026-03-03", null, "Pre-vendita")
    await meet(beta, "2026-08-01", "red", "Pagamenti bloccati")
    await meet({ id: assistenza, clientId: rho.id }, "2026-05-01", "green", "Tutto regolare")
    // Red, so the tests can show a closed contract never counts as one.
    await meet(closed, "2026-02-01", "red", "Chiusura lavori")
  })

  it("unfiltered: every active contract worst first, each light the UI's own, newest verbale first", async () => {
    const { isError, payload } = await callTool("list_meetings")
    expect(isError).toBe(false)
    const board = payload.contracts as (Row & Record<string, unknown>)[]
    // Rosso, giallo, senza stato, verde; the closed contract is left out.
    expect(board.map((r) => r.engagementId)).toEqual([beta.id, migrazione.id, sviluppo, assistenza])
    expect(board[1]).toMatchObject({
      engagementLabel: "Migrazione cloud", client: "Acme Spa", isActive: true,
      health: "yellow", healthAsOf: "2026-09-12", lastMeetingDate: "2026-09-20",
    })
    expect(board[2]).toMatchObject({ health: null, healthAsOf: null, lastMeetingDate: null })
    // chat == UI: the chip reads healthByContract over the same verbali.
    const ui = healthByContract(await admin.getMeetings(userId))
    for (const r of board) {
      expect(r.health).toBe(ui.get(r.engagementId)?.health ?? null)
      expect(r.healthAsOf).toBe(ui.get(r.engagementId)?.date ?? null)
    }
    expect(payload.summary).toBe("4 active contracts: 1 red, 1 yellow, 1 green, 1 with no status. 7 meetings.")
    expect(payload.total).toBe(7)
    expect(texts(payload)).toEqual([
      "Call veloce", "Test slittati", "Kickoff", "Pagamenti bloccati", "Tutto regolare", "Pre-vendita", "Chiusura lavori",
    ])
    expect((payload.meetings as Record<string, unknown>[])[0]).toEqual({
      id: expect.any(String), date: "2026-09-20", time: "09:00", health: null, clientId: migrazione.clientId,
      client: "Acme Spa", engagementId: migrazione.id, engagementLabel: "Migrazione cloud", text: "Call veloce",
    })
  })

  it("a client includes its client-level verbali; a contract leaves them out", async () => {
    const acme = await callTool("list_meetings", { client: "Acme" })
    expect(texts(acme.payload)).toEqual(["Call veloce", "Test slittati", "Kickoff", "Pre-vendita"])
    expect(acme.payload.summary).toBe(
      "Acme Spa: 4 meetings from 2026-03-03 to 2026-09-20. Migrazione cloud: yellow since 2026-09-12."
    )

    const one = await callTool("list_meetings", { engagementId: "migrazione", limit: 1 })
    expect(texts(one.payload)).toEqual(["Call veloce"])
    expect(one.payload.total).toBe(3)
    expect(one.payload.summary).toBe(
      "Migrazione cloud: 3 meetings from 2026-09-02 to 2026-09-20, showing the latest. Status: yellow since 2026-09-12."
    )
  })

  it("filters by window and by light, and still reports the contracts when nothing matches", async () => {
    const september = await callTool("list_meetings", { client: "Acme", from: "2026-09-01", to: "2026-09-15" })
    expect(texts(september.payload)).toEqual(["Test slittati", "Kickoff"])

    // The verbali that said rosso, the closed contract's included; the contracts at rosso now, active only.
    const red = await callTool("list_meetings", { health: "red" })
    expect(texts(red.payload)).toEqual(["Pagamenti bloccati", "Chiusura lavori"])
    expect((red.payload.contracts as Row[]).map((r) => r.engagementId)).toEqual([beta.id])
    expect(red.payload.summary).toBe("1 active contract: 1 red. 2 meetings.")

    const empty = await callTool("list_meetings", { client: "Rho", to: "2026-01-31" })
    expect(empty.payload).toMatchObject({ total: 0, meetings: [] })
    expect(empty.payload.summary).toBe("No meetings for Rho Srl. Sviluppo Rho: no status. Assistenza Rho: green since 2026-05-01.")
  })

  it("a named contract is reported even when closed", async () => {
    const { payload } = await callTool("list_meetings", { engagementId: closed.id })
    expect(texts(payload)).toEqual(["Chiusura lavori"])
    expect(payload.contracts).toEqual([
      expect.objectContaining({ engagementId: closed.id, isActive: false, health: "red", healthAsOf: "2026-02-01" }),
    ])
  })

  it("get_client carries each contract's status and counts the active red and yellow ones", async () => {
    const acme = await callTool("get_client", { client: "Acme" })
    expect(String(acme.payload.summary)).toContain("1 active contract (1 yellow),")
    expect((acme.payload.engagements as { id: string }[]).find((e) => e.id === migrazione.id))
      .toMatchObject({ health: "yellow", healthAsOf: "2026-09-12", lastMeetingDate: "2026-09-20" })

    const betaClient = await callTool("get_client", { client: "Beta" })
    expect(String(betaClient.payload.summary)).toContain("(1 red)")

    // Green and no status add nothing to the summary; a closed contract never counts.
    const rho = await callTool("get_client", { client: "Rho" })
    expect(String(rho.payload.summary)).toBe("Rho Srl: 2 active contracts, 0 open opportunities.")
    expect(rho.payload.engagements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sviluppo, health: null, healthAsOf: null, lastMeetingDate: null }),
    ]))
    const omega = await callTool("get_client", { client: "Omega" })
    expect(omega.payload.engagements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: closed.id, health: "red" }),
    ]))
    expect(String(omega.payload.summary)).not.toMatch(/\bred\b/)
  })
})

// Seeded last, so no earlier suite sees the extra clients, contracts, hours and invoices.
describe("get_unbilled", () => {
  type Line = { contract: string; engagementId: string; dailyRate: number; hours: number; days: number; logged: number }
  type Month = {
    yearMonth: string
    hours: number
    days: number
    logged: number
    invoiced: number
    left: number
    unbilled: number
    partlyLogged: boolean
    invoiceNumbers: string[]
    suggestedVat: number
    current: boolean
    contracts: Line[]
  }
  type Suggestion = {
    fromMonth: string | null
    yearMonth: string
    months: string[]
    hours: number
    amount: number
    vat: number
    number: string | null
    dueDate: string | null
    dueBasis: string | null
  }
  type ClientRow = {
    client: string
    clientId: string
    hoursLogged: boolean
    loggedSince: string | null
    toInvoice: number | null
    thisMonth: number | null
    months: Month[]
    suggestions?: Suggestion[]
  }
  const lastMonth = format(subMonths(new Date(), 1), "yyyy-MM")
  const clientsOf = (payload: Record<string, unknown>) => payload.clients as ClientRow[]
  const find = (payload: Record<string, unknown>, id: string) => clientsOf(payload).find((c) => c.clientId === id)
  let dunderId = ""
  let zetaId = ""
  let platform = ""
  let legacy = ""

  beforeAll(async () => {
    const dunder = await admin.createClient(userId, { name: "Dunder Corp" })
    const zeta = await admin.createClient(userId, { name: "Zeta Srl" })
    dunderId = dunder.id
    zetaId = zeta.id
    const contract = async (clientId: string, name: string, dailyRate: number, vatApplicable: boolean, closed?: { endMonth?: string }) => {
      const e = await admin.createEngagement(userId, { clientId, name, dailyRate, vatApplicable, defaultDaysPerMonth: 5 })
      if (closed) await admin.updateEngagement(userId, e.id, { isActive: false, ...closed })
      return e.id
    }
    platform = await contract(dunder.id, "Platform", 500, true)
    await contract(dunder.id, "Audit", 800, true) // active, never logged
    legacy = await contract(dunder.id, "Legacy", 400, false, { endMonth: "2026-03" }) // closed with hours unbilled
    await contract(dunder.id, "Old", 400, true, {}) // closed and never logged: nothing to say
    const support = await contract(zeta.id, "Support", 1000, true)

    const log = (engagementId: string, date: string, hours: number) =>
      admin.setTimecard(userId, { engagementId, date, hours, notes: null })
    await log(platform, `${lastMonth}-10`, 16)
    await log(platform, `${currentMonth}-01`, 8)
    await log(legacy, "2026-03-10", 8)
    await log(support, "2026-02-10", 8)
    await admin.createInvoice(userId, { clientId: dunder.id, number: "D-1", yearMonth: lastMonth, amount: 500, vat: 110 })
    await admin.createInvoice(userId, {
      clientId: zeta.id, number: "Z-1", yearMonth: "2026-02", amount: 1000, vat: 220, paidDate: new Date("2026-03-31"),
    })
  })

  it("nets a client's logged hours, all its contracts pooled, against its invoices per month, the current month apart", async () => {
    const { isError, payload } = await callTool("get_unbilled", { client: "Dunder" })
    expect(isError).toBe(false)
    expect(payload.total).toBe(900)
    expect(clientsOf(payload)).toHaveLength(1)
    const d = find(payload, dunderId)!
    expect(d).toMatchObject({
      client: "Dunder Corp", hoursLogged: true, loggedSince: "2026-03", toInvoice: 900, thisMonth: 500,
    })
    const line = (contract: string, engagementId: string, dailyRate: number, hours: number) =>
      ({ contract, engagementId, dailyRate, hours, days: hours / 8, logged: (hours / 8) * dailyRate })
    expect(d.months).toEqual([
      {
        yearMonth: currentMonth, hours: 8, days: 1, logged: 500, invoiced: 0, left: 500, unbilled: 0,
        partlyLogged: false, invoiceNumbers: [], suggestedVat: 0, current: true, // so far, never offered
        contracts: [line("Platform", platform, 500, 8)],
      },
      {
        yearMonth: lastMonth, hours: 16, days: 2, logged: 1000, invoiced: 500, left: 500, unbilled: 500,
        partlyLogged: false, invoiceNumbers: ["D-1"], suggestedVat: 110, current: false,
        contracts: [line("Platform", platform, 500, 16)],
      },
      {
        // A closed contract's hours are still the client's to invoice; no VAT on this one.
        yearMonth: "2026-03", hours: 8, days: 1, logged: 400, invoiced: 0, left: 400, unbilled: 400,
        partlyLogged: false, invoiceNumbers: [], suggestedVat: 0, current: false,
        contracts: [line("Legacy", legacy, 400, 8)],
      },
    ])
    // chat == UI: the Invoices page runs the same function over the same documents.
    const direct = clientBilling({
      clientId: dunderId,
      engagements: await admin.getEngagements(userId),
      timecards: await admin.getTimecards(userId),
      invoices: await admin.getInvoices(userId),
      today: isoDate(new Date()),
    })
    expect(d.toInvoice).toBe(direct.toInvoice)
  })

  it("counts hours scheduled after today from their day on, never in this month so far", async () => {
    const tomorrow = isoDate(addDays(new Date(), 1))
    await admin.setTimecard(userId, { engagementId: platform, date: tomorrow, hours: 8, notes: null })
    try {
      const { payload } = await callTool("get_unbilled", { client: "Dunder" })
      const d = find(payload, dunderId)!
      expect(d).toMatchObject({ thisMonth: 500 })
      expect(d.months.find((m) => m.yearMonth === currentMonth)).toMatchObject({ hours: 8 })
      expect(d.months.every((m) => m.yearMonth <= currentMonth)).toBe(true)
    } finally {
      await admin.deleteTimecard(userId, platform, tomorrow)
    }
  })

  it("says which active contracts were never logged, from the lines", async () => {
    const { payload } = await callTool("get_unbilled", { client: "Dunder" })
    const named = find(payload, dunderId)!.months.flatMap((m) => m.contracts.map((l) => l.contract))
    expect(named).not.toContain("Audit")
    expect(named).not.toContain("Old")
    expect(payload.notLogged).toEqual(["Dunder Corp · Audit"])
    expect(payload.summary).toBe(
      // One suggestion each: March is fully open, last month partly invoiced (D-1).
      `€900.00 net to invoice on 1 client — Dunder Corp: Mar 2026 €400.00, ` +
        `${formatYearMonth(lastMonth, "MMM yyyy")} €500.00. ` +
        "This month so far €500.00 (1 d). VAT 22% on the VAT-liable contracts only: use suggestedVat. " +
        "No hours logged yet on Dunder Corp · Audit."
    )
  })

  it("answers for a contract's client, a credit note adding back to what is left", async () => {
    await admin.createInvoice(userId, { clientId: dunderId, number: "D-2", yearMonth: lastMonth, amount: -250, vat: -55 })
    const { payload } = await callTool("get_unbilled", { engagementId: "platform" })
    expect(clientsOf(payload).map((c) => c.clientId)).toEqual([dunderId])
    expect(payload.total).toBe(1150)
    expect(find(payload, dunderId)!.months[1]).toMatchObject({
      yearMonth: lastMonth, invoiced: 250, left: 750, unbilled: 750, invoiceNumbers: ["D-1", "D-2"], suggestedVat: 165,
    })
  })

  it("without arguments lists only clients with something to invoice", async () => {
    const { payload } = await callTool("get_unbilled")
    const listed = clientsOf(payload)
    expect(listed.map((c) => c.clientId)).toContain(dunderId)
    expect(listed.map((c) => c.clientId)).not.toContain(zetaId)
    expect(listed.every((c) => (c.toInvoice ?? 0) > 0 || (c.thisMonth ?? 0) > 0)).toBe(true)
    expect(payload.notLogged).toContain("Dunder Corp · Audit")
    const sum = listed.reduce((s, c) => s + Math.max(0, c.toInvoice ?? 0), 0)
    expect(payload.total).toBe(Math.round(sum * 100) / 100)
  })

  it("says so for a client with nothing left to invoice", async () => {
    const { isError, payload } = await callTool("get_unbilled", { client: "Zeta" })
    expect(isError).toBe(false)
    expect(payload).toMatchObject({ total: 0, notLogged: [], summary: "Nothing left to invoice from logged hours." })
    expect(clientsOf(payload)).toEqual([
      { client: "Zeta Srl", clientId: zetaId, hoursLogged: true, loggedSince: "2026-02", toInvoice: 0, thisMonth: 0, months: [] },
    ])
  })

  it("offers only what a month invoiced ahead left uncovered, never each month's left", async () => {
    const kappa = await admin.createClient(userId, { name: "Kappa" })
    const e = await admin.createEngagement(userId, { clientId: kappa.id, name: "Rollout", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 5 })
    await admin.setTimecard(userId, { engagementId: e.id, date: "2026-06-15", hours: 80, notes: null })
    await admin.setTimecard(userId, { engagementId: e.id, date: "2026-07-15", hours: 80, notes: null })
    await admin.createInvoice(userId, { clientId: kappa.id, number: "K-1", yearMonth: "2026-07", amount: 7500, vat: 1650 })

    const { payload } = await callTool("get_unbilled", { client: "Kappa" })
    expect(payload.total).toBe(2500)
    expect(find(payload, kappa.id)!.months.map((m) => [m.yearMonth, m.left, m.unbilled, m.suggestedVat])).toEqual([
      ["2026-07", -2500, 0, 0],
      ["2026-06", 5000, 2500, 550],
    ])
    expect(payload.summary).toBe("€2,500.00 net to invoice on 1 client — Kappa: Jun 2026 €2,500.00. VAT 22% applies.")
  })

  it("nets one invoice against three contracts of the same client", async () => {
    const layer = await admin.createClient(userId, { name: "Lumon" })
    const ids = await Promise.all(
      ["Operator", "Consulting", "Labs"].map(async (name) =>
        (await admin.createEngagement(userId, { clientId: layer.id, name, dailyRate: 700, vatApplicable: false, defaultDaysPerMonth: 5 })).id
      )
    )
    await Promise.all(
      [64, 32, 40].map((hours, i) => admin.setTimecard(userId, { engagementId: ids[i], date: "2026-08-10", hours, notes: null }))
    )
    await admin.createInvoice(userId, { clientId: layer.id, number: "L-14", yearMonth: "2026-08", amount: 11900, vat: 0 })

    const { payload } = await callTool("get_unbilled", { client: "Lumon" })
    const l = find(payload, layer.id)!
    expect(l.toInvoice).toBe(0)
    // Settled: the month says nothing to invoice, so get_unbilled lists no month.
    expect(l.months).toEqual([])
    const direct = clientBilling({
      clientId: layer.id,
      engagements: await admin.getEngagements(userId),
      timecards: await admin.getTimecards(userId),
      invoices: await admin.getInvoices(userId),
      today: isoDate(new Date()),
    })
    const lines = direct.months.find((m) => m.yearMonth === "2026-08")!.contracts
    // Keyed by contract: lines follow the adapter's contract order, which Firestore does not promise.
    expect(Object.fromEntries(lines.map((c) => [c.engagementId, c.logged]))).toEqual({
      [ids[0]]: 5600, [ids[1]]: 2800, [ids[2]]: 3500,
    })
  })

  it("spreads an invoice covering several months by the value logged in each, and lists its first month", async () => {
    const globex = await admin.createClient(userId, { name: "Globex Spa" })
    const e = await admin.createEngagement(userId, { clientId: globex.id, name: "Ops", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 5 })
    await admin.setTimecard(userId, { engagementId: e.id, date: "2026-06-10", hours: 16, notes: null })
    await admin.setTimecard(userId, { engagementId: e.id, date: "2026-07-10", hours: 48, notes: null })
    await admin.createInvoice(userId, {
      clientId: globex.id, number: "G-9", fromMonth: "2026-06", yearMonth: "2026-07", amount: 3000, vat: 660,
    })

    const listed = await callTool("list_invoices", { client: "Globex" })
    expect(listed.payload.invoices).toMatchObject([{ number: "G-9", fromMonth: "2026-06", yearMonth: "2026-07" }])

    const { payload } = await callTool("get_unbilled", { client: "Globex" })
    const g = find(payload, globex.id)!
    // €1,000 and €3,000 logged: the €3,000 invoice lands as 750 and 2,250.
    expect(g.months.map((m) => [m.yearMonth, m.invoiced, m.left, m.invoiceNumbers])).toEqual([
      ["2026-07", 2250, 750, ["G-9"]],
      ["2026-06", 750, 250, ["G-9"]],
    ])
    expect(g.toInvoice).toBe(1000)
  })

  it("errors with candidates on an unknown client", async () => {
    const { isError, payload } = await callTool("get_unbilled", { client: "Gamma" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("Dunder Corp")
  })

  it("answers a read-only token", async () => {
    const readOnly = await mintAccessToken(idToken, "data:read")
    const { isError, payload } = await callTool("get_unbilled", { client: "Zeta" }, readOnly)
    expect(isError).toBe(false)
    expect(payload.total).toBe(0)
  })

  // Seeded after the suites above, so their totals never see these clients.
  const seedMonths = async (clientName: string, vatApplicable: boolean, hours: [string, number][]) => {
    const client = await admin.createClient(userId, { name: clientName })
    const e = await admin.createEngagement(userId, { clientId: client.id, name: "Retail", dailyRate: 500, vatApplicable, defaultDaysPerMonth: 5 })
    await Promise.all(
      hours.map(([ym, h]) => admin.setTimecard(userId, { engagementId: e.id, date: `${ym}-10`, hours: h, notes: null }))
    )
    return client.id
  }

  it("proposes one invoice for a run of open months, numbered and due as the Invoices page proposes", async () => {
    const nordicId = await seedMonths("Nordic Retail SRL", true, [
      ["2026-04", 40], ["2026-05", 48], ["2026-06", 32], ["2026-07", 40], ["2026-08", 24], ["2026-09", 40],
    ])
    await admin.createInvoice(userId, {
      clientId: nordicId, number: "N-41", fromMonth: "2026-04", yearMonth: "2026-06", amount: 7500, vat: 1650,
      dueDate: new Date("2026-07-31T00:00:00"), paidDate: new Date("2026-07-31T00:00:00"),
    })

    const { payload } = await callTool("get_unbilled", { client: "Nordic" })
    const n = find(payload, nordicId)!
    expect(n.toInvoice).toBe(6500)
    expect(n.suggestions).toMatchObject([
      {
        fromMonth: "2026-07", yearMonth: "2026-09", months: ["2026-07", "2026-08", "2026-09"],
        hours: 104, amount: 6500, vat: 1430, number: "N-42", dueBasis: "Same terms as N-41 (due 31 Jul for Jun).",
      },
    ])
    expect(n.suggestions![0].dueDate).toMatch(/^\d{4}-\d{2}-3[01]$/)
    expect(payload.summary).toContain("Nordic Retail SRL: Jul–Sep 2026 €6,500.00.")
    // The per-month fields stay, for compatibility.
    expect(n.months.map((m) => [m.yearMonth, m.unbilled, m.suggestedVat])).toEqual([
      ["2026-09", 2500, 550],
      ["2026-08", 1500, 330],
      ["2026-07", 2500, 550],
    ])

    // chat == UI: the page's Ready to Invoice rows come from the same functions.
    const invoices = await admin.getInvoices(userId)
    const today = isoDate(new Date())
    const direct = clientBilling({ clientId: nordicId, engagements: await admin.getEngagements(userId), timecards: await admin.getTimecards(userId), invoices, today })
    const core = ({ fromMonth, yearMonth, months, hours, amount, vat }: Omit<Suggestion, "number" | "dueDate" | "dueBasis">) =>
      ({ fromMonth, yearMonth, months, hours, amount, vat })
    expect(n.suggestions!.map(core)).toEqual(invoiceSuggestions(direct).map(core))
    const own = invoices.filter((i) => i.clientId === nordicId)
    expect(n.suggestions![0].dueDate).toBe(suggestedDueDate(own, "2026-09", today)!.date)
  })

  it("splits the suggestions at a month already invoiced, and numbers them in turn", async () => {
    const polarId = await seedMonths("Polar Srl", false, [["2026-07", 40], ["2026-08", 40], ["2026-09", 40]])
    await admin.createInvoice(userId, { clientId: polarId, number: "P-7", yearMonth: "2026-08", amount: 2500, vat: 0 })

    const { payload } = await callTool("get_unbilled", { client: "Polar" })
    const one = { fromMonth: null, hours: 40, amount: 2500, vat: 0, dueDate: null, dueBasis: null }
    expect(find(payload, polarId)!.suggestions).toEqual([
      { ...one, yearMonth: "2026-07", months: ["2026-07"], number: "P-8" },
      { ...one, yearMonth: "2026-09", months: ["2026-09"], number: "P-9" },
    ])
    expect(payload.summary).toContain("Polar Srl: Jul 2026 €2,500.00, Sep 2026 €2,500.00.")
  })

  it("gives each line the rate in force in its month", async () => {
    const quasar = await admin.createClient(userId, { name: "Quasar Srl" })
    const e = await admin.createEngagement(userId, {
      clientId: quasar.id, name: "Rollout", dailyRate: 500, vatApplicable: false, defaultDaysPerMonth: 5, startMonth: "2026-02",
    })
    await admin.updateEngagement(userId, e.id, {
      amendments: [{ from: "2026-03", dailyRate: 600, addedDays: null, lastDay: null, lastDayBefore: null, note: null }],
    })
    await Promise.all(
      ["2026-02", "2026-03"].map((ym) => admin.setTimecard(userId, { engagementId: e.id, date: `${ym}-10`, hours: 8, notes: null }))
    )

    const { payload } = await callTool("get_unbilled", { client: "Quasar" })
    const q = find(payload, quasar.id)!
    expect(q.months.map((m) => [m.yearMonth, m.contracts.map((l) => [l.dailyRate, l.logged])])).toEqual([
      ["2026-03", [[600, 600]]],
      ["2026-02", [[500, 500]]],
    ])
    expect(q.toInvoice).toBe(1100)
  })
})

// Seeded last, with its own beforeAll, so no earlier suite sees rows before its window.
// Rows of 5 (half the default) tell all three states apart: burned from the start,
// 35 used → exhaustion m(6); a fetch left window-only would default-fill 70 → m(2);
// the budget seeded at the window, as before the fix → m(9).
describe("budget burns from the contract's start (#155)", () => {
  const m = (n: number) => format(addMonths(new Date(), n), "yyyy-MM")
  const client = "Lambda Srl" // "Kappa" is taken by the get_unbilled suite
  let lambdaId = ""

  beforeAll(async () => {
    const lambda = await admin.createClient(userId, { name: client })
    const e = await admin.createEngagement(userId, {
      clientId: lambda.id, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 10, contractedDays: 100,
      startMonth: m(-7),
    })
    lambdaId = e.id
    for (let n = -7; n <= -1; n++) {
      await admin.createAllocation(userId, { engagementId: e.id, yearMonth: m(n), days: 5 })
    }
  })

  it("get_client reports the exhaustion month from the contract's start, and only recent rows", async () => {
    const { payload } = await callTool("get_client", { client: "Lambda" })
    const [eng] = payload.engagements as { exhaustionMonth: string | null }[]
    expect(eng.exhaustionMonth).toBe(m(6)) // was m(9)
    const recent = payload.recentAllocations as { yearMonth: string }[]
    expect(recent.map((a) => a.yearMonth).sort()).toEqual([m(-5), m(-4), m(-3), m(-2), m(-1)])
  })

  it("get_revenue accrued burns the budget spent before the window", async () => {
    const { payload } = await callTool("get_revenue", { from: m(5), to: m(8), groupBy: "client" })
    const row = (payload.rows as { key: string }[]).find((r) => r.key === client)
    // was { plannedDays: 40, billableDays: 40, revenue: 20000 }
    expect(row).toMatchObject({ plannedDays: 40, billableDays: 15, revenue: 7500 })
  })

  it("get_plan caps the contract where the Plan grid does", async () => {
    const { payload } = await callTool("get_plan", { months: 8 })
    const months = payload.months as {
      yearMonth: string
      lines: { clientName: string; plannedDays: number; billableDays: number; capped: boolean }[]
    }[]
    const lineAt = (ym: string) => months.find((x) => x.yearMonth === ym)!.lines.find((l) => l.clientName === client)
    expect(lineAt(m(6))).toMatchObject({ plannedDays: 10, billableDays: 5, capped: true }) // was 10, uncapped
    expect(lineAt(m(7))).toMatchObject({ billableDays: 0, capped: true })

    const sources = toRevenueSources({
      engagements: await admin.getEngagements(userId),
      opportunities: [],
      clients: await admin.getClients(userId),
      scenario: "committed",
    })
    const grid = resolveAllocationGrid({
      sources,
      allocations: await admin.getAllocations(userId),
      fromMonth: currentMonth,
      months: 8,
    }).filter((c) => c.clientName === client)
    for (const x of months) {
      const cell = grid.find((c) => c.yearMonth === x.yearMonth)!
      expect(lineAt(x.yearMonth), x.yearMonth).toMatchObject({
        plannedDays: cell.plannedDays,
        billableDays: cell.billableDays,
        capped: cell.capped,
      })
    }
  })

  // #159: capacity reads the same grid, so a contract the plan stops billing stops taking days.
  it("get_capacity and get_plan agree, and a spent budget stops taking capacity", async () => {
    type Cap = { yearMonth: string; allocatedDays: number }
    type Line = {
      engagementId: string
      plannedDays: number
      billableDays: number
      capped: boolean
      remainingDays: number | null
    }
    const plan = await callTool("get_plan", { months: 8 })
    const months = plan.payload.months as { yearMonth: string; lines: Line[]; capacity: Cap }[]
    // A window-only fetch default-filled Lambda's months before the window, spending it by m(2):
    // m(3)–m(6) would differ.
    const cap = await callTool("get_capacity", { from: currentMonth, months: 8 })
    expect(cap.payload.months).toEqual(months.map((x) => x.capacity))

    const stored = new Set((await admin.getAllocations(userId)).map((a) => a.yearMonth))
    const unlogged = months.filter((x) => !stored.has(x.yearMonth))
    expect(unlogged.map((x) => x.yearMonth)).toContain(m(7))
    for (const x of unlogged) {
      expect(x.capacity.allocatedDays, x.yearMonth).toBe(x.lines.reduce((s, l) => s + l.billableDays, 0))
    }

    const lineAt = (ym: string) => months.find((x) => x.yearMonth === ym)!.lines.find((l) => l.engagementId === lambdaId)
    expect(lineAt(m(5))?.remainingDays).toBe(5)
    expect(lineAt(m(6))?.remainingDays).toBe(0)
    // Still on the plan at the default, but billing nothing: its 10 days no longer count (they did).
    expect(lineAt(m(7))).toMatchObject({ plannedDays: 10, billableDays: 0, capped: true })
  })
})

// Seeded after every other suite: a new client would show up in their totals.
describe("amended contracts in get_client and list_clients", () => {
  let amendedId = ""
  const raise = {
    from: currentMonth, dailyRate: 800, addedDays: 20, lastDay: null, lastDayBefore: null, note: "Addendum 2",
  }

  beforeAll(async () => {
    const client = await admin.createClient(userId, { name: "Amended Spa" })
    const e = await admin.createEngagement(userId, {
      clientId: client.id, name: "Rate rise", dailyRate: 700, vatApplicable: false, contractedDays: 80,
      defaultDaysPerMonth: 10, startMonth: format(subMonths(new Date(), 2), "yyyy-MM"),
    })
    amendedId = e.id
    await admin.updateEngagement(userId, e.id, { amendments: [raise] })
    await admin.createEngagement(userId, {
      clientId: client.id, name: "As signed", dailyRate: 500, vatApplicable: false, defaultDaysPerMonth: 2,
    })
  })

  it("get_client keeps the signed terms and adds the rate now, the whole budget and the amendments", async () => {
    const { payload } = await callTool("get_client", { client: "Amended Spa" })
    type Row = { id: string; name: string; dailyRate: number; rateNow: number; contractedDays: number | null; budgetDays: number | null }
    const rows = payload.engagements as Row[]
    expect(rows.find((e) => e.id === amendedId)).toMatchObject({
      dailyRate: 700, rateNow: 800, contractedDays: 80, budgetDays: 100, amendments: [raise],
    })
    const signed = rows.find((e) => e.name === "As signed")!
    expect(signed).toMatchObject({ dailyRate: 500, rateNow: 500, contractedDays: null, budgetDays: null })
    expect(signed).not.toHaveProperty("amendments")
  })

  it("list_clients values the month at the rate in force now", async () => {
    const { payload } = await callTool("list_clients")
    const row = (payload.clients as { name: string; activeMonthly: number }[]).find((c) => c.name === "Amended Spa")
    expect(row?.activeMonthly).toBe(10 * 800 + 2 * 500)
  })
})

// ─── Month End ───────────────────────────────────────────────────────────────
// A user of its own: company accounts and contracts of the other suites would
// reach every step. Made-up names and amounts. Last month and the one before
// carry hours on one contract (9 and 3 days, 10 planned), nothing invoiced, an
// account never checked and a deadline left open; another client owes an overdue
// invoice, an amber reminder only.

describe("get_month_end", () => {
  const now = new Date()
  const today = isoDate(now)
  const invoiceYear = today.slice(0, 4)
  const last = format(subMonths(now, 1), "yyyy-MM")
  const before = format(subMonths(now, 2), "yyyy-MM")
  let owner = ""
  let ownerToken = ""
  let ownerBearer = ""
  let contractId = ""
  let deadlineId = ""
  const day = (iso: string) => new Date(`${iso}T00:00:00`)
  const weekdays = (ym: string) =>
    Array.from({ length: 31 }, (_, k) => `${ym}-${String(k + 1).padStart(2, "0")}`).filter((d) => {
      const date = day(d)
      return isoDate(date) === d && date.getDay() !== 0 && date.getDay() !== 6
    })
  const monthEndOf = (args: Record<string, unknown> = {}, as?: string) => callTool("get_month_end", args, as ?? ownerBearer)
  type Step = { step: StepKey; status: string; items: (MonthEndItem & { next?: Next[] })[] }
  type Next = { tool?: string; args?: Record<string, unknown>; note?: string; app?: string }
  const steps = (payload: Record<string, unknown>) => payload.steps as Step[]
  const itemsOf = (payload: Record<string, unknown>, key: StepKey) => steps(payload).find((s) => s.step === key)!.items

  /** What the Month End page loads, read with the same Admin functions the tool uses. */
  async function pageData() {
    const [engagements, clients, allocations, timecards, invoices, accounts, movements, expenses, loans, deadlines] = await Promise.all([
      admin.getEngagements(owner),
      admin.getClients(owner),
      admin.getAllocations(owner),
      admin.getTimecards(owner),
      admin.getInvoices(owner),
      admin.getCompanyAccounts(owner),
      admin.getCompanyMovements(owner),
      admin.getCompanyExpenses(owner),
      admin.getCompanyLoans(owner),
      admin.getCompanyDeadlines(owner),
    ])
    return { engagements, clients, allocations, timecards, invoices, accounts, movements, expenses, loans, deadlines }
  }

  beforeAll(async () => {
    const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), `mcp-month-end-${Date.now()}@example.com`, "Test1234!")
    owner = user.uid
    ownerToken = await user.getIdToken()
    ownerBearer = await mintAccessToken(ownerToken)

    const lumen = await admin.createClient(owner, { name: "Lumen Test Srl" })
    const nordica = await admin.createClient(owner, { name: "Nordica Test Spa" })
    const contract = await admin.createEngagement(owner, {
      clientId: lumen.id, name: "Retainer", dailyRate: 450, vatApplicable: true, defaultDaysPerMonth: 10, startMonth: before,
    })
    contractId = contract.id
    for (const date of weekdays(last).slice(0, 9)) await admin.setTimecard(owner, { engagementId: contractId, date, hours: 8 })
    for (const date of weekdays(before).slice(0, 3)) await admin.setTimecard(owner, { engagementId: contractId, date, hours: 8 })
    await admin.createInvoice(owner, { clientId: nordica.id, number: `7/${invoiceYear}`, yearMonth: before, amount: 800, vat: 176, dueDate: day(`${before}-20`) })
    await getAdminFirestore().collection("users").doc(owner).collection("company_accounts").add({
      userId: owner, name: "Main Test Bank", openingBalance: 1000, openingDate: day(`${before}-01`), statementBalance: null,
      statementDate: null, importRef: null, createdAt: new Date(), updatedAt: new Date(),
    })
    deadlineId = (await admin.createCompanyDeadline(owner, { title: "Renew test domain", date: day(`${last}-15`), kind: "admin" })).id
  })

  it("defaults to last month and answers with the page's checklist, to the item", async () => {
    const { isError, payload } = await monthEndOf()
    expect(isError).toBe(false)
    expect(payload.month).toBe(last)

    const data = await pageData()
    const lib = monthEndChecklist(data, last, today)
    expect(payload).toMatchObject({ end: lib.end, closed: false, todo: lib.todo })
    expect(lib.todo).toEqual(["hours", "invoices", "bank", "deadlines"])
    expect(steps(payload).map((s) => s.step)).toEqual(STEP_ORDER)
    for (const s of steps(payload)) {
      expect(s.status).toBe(lib.steps[s.step].status)
      expect(s.items.map(({ next: _next, ...item }) => item)).toEqual(lib.steps[s.step].items)
    }
    const earlier = openMonths(data, today).filter((m) => m < last)
    expect(earlier).toEqual([before])
    expect(payload.alsoOpen).toEqual([{ month: before, todo: ["Hours", "Invoices", "Bank"] }])
    expect(payload.summary).toBe(
      `${formatYearMonth(last)}: 4 steps to do (Hours, Invoices, Bank, Deadlines). ` +
        `Also open: 1 earlier month (oldest: ${formatYearMonth(before)}). 1 invoice waiting for payment.`,
    )
  })

  it("names the write tool for each open item, with the arguments the data holds", async () => {
    const { payload } = await monthEndOf()
    expect(itemsOf(payload, "hours")[0].next).toEqual([
      { tool: "log_allocation", args: { client: "Lumen Test Srl", engagementId: contractId, month: last, mode: "set", days: 9 }, note: "Use: puts the days logged in the plan." },
    ])
    // Both months are one run: one invoice, the draft get_unbilled proposes, numbered after 7/<year>.
    const { payload: unbilled } = await callTool("get_unbilled", { client: "Lumen Test Srl" }, ownerBearer)
    const [draft] = (unbilled.clients as { suggestions: Record<string, unknown>[] }[])[0].suggestions
    expect(draft).toMatchObject({ fromMonth: before, yearMonth: last, amount: 12 * 450, number: `8/${invoiceYear}` })
    const invoices = itemsOf(payload, "invoices")
    expect(invoices.map((i) => i.next![0])).toEqual([0, 1].map(() => ({
      tool: "create_invoice",
      args: { client: "Lumen Test Srl", number: draft.number, fromMonth: before, yearMonth: last, amount: draft.amount, vat: draft.vat },
      note: `Ready to Invoice's draft, one invoice for ${invoicePeriodLabel({ fromMonth: before, yearMonth: last })}: confirm the number with the owner, the accountant assigns it.`,
    })))
    expect(itemsOf(payload, "bank")[0].next).toEqual([
      { tool: "check_balance", args: { account: "Main Test Bank", date: monthEnd(last) }, note: expect.stringMatching(/^balance: the statement's balance/) },
    ])
    expect(itemsOf(payload, "waiting")[0].next![0]).toMatchObject({ tool: "mark_invoice_paid", args: { invoice: `7/${invoiceYear}` } })
    expect(itemsOf(payload, "deadlines")[0].next).toEqual([{ tool: "complete_deadline", args: { deadline: deadlineId } }])
  })

  it("names only tools the server registers, with arguments each one takes", async () => {
    const schemas = new Map<string, { shape: Record<string, unknown> }>()
    const server = { registerTool: (name: string, config: { inputSchema: { shape: Record<string, unknown> } }) => void schemas.set(name, config.inputSchema) }
    registerCrmReadTools(server as unknown as McpServer)
    registerCrmWriteTools(server as unknown as McpServer)
    const { payload } = await monthEndOf()
    const hints = steps(payload).flatMap((s) => s.items.flatMap((i) => i.next ?? []))
    expect(hints.length).toBeGreaterThan(0)
    for (const h of hints) {
      expect(schemas.has(h.tool!), h.tool).toBe(true)
      expect(Object.keys(h.args!).filter((k) => !(k in schemas.get(h.tool!)!.shape))).toEqual([])
    }
  })

  it("closes the month once the hints are followed, an amber reminder and an older open month aside", async () => {
    const { payload } = await monthEndOf()
    const done = new Set<string>()
    for (const s of steps(payload)) {
      for (const i of s.items.filter((x) => x.status === "todo")) {
        const { tool, args } = i.next![0]
        const call = JSON.stringify([tool, args])
        if (done.has(call)) continue // two months of one invoice
        done.add(call)
        // What the owner adds: the statement's balance (the opening 1,000, nothing moved since).
        const { isError, payload: wrote } = await callTool(tool!, { ...args, ...(tool === "check_balance" && { balance: 1000 }) }, ownerBearer)
        expect(isError, JSON.stringify(wrote)).toBe(false)
      }
    }
    expect([...done].map((c) => JSON.parse(c)[0])).toEqual(["log_allocation", "create_invoice", "check_balance", "complete_deadline"])

    const { payload: after } = await monthEndOf({ month: last })
    expect(after).toMatchObject({ month: last, closed: true, todo: [], alsoOpen: [{ month: before, todo: ["Hours"] }] })
    expect(after.summary).toMatch(new RegExp(`^${formatYearMonth(last)} is closed: every required step is done\\. Also open: 1 earlier month`))
    expect(after.summary).toContain("waiting for payment")
    // Invoice Files: the invoice just recorded has no file. An amber reminder, so the month stays closed; only the app attaches one.
    expect(after.summary).toContain("1 invoice file missing")
    expect(steps(after).find((s) => s.step === "files")).toMatchObject({
      title: "Invoice Files",
      blocking: false,
      status: "check",
      toCheck: 1,
      items: [{ kind: "file_invoice", next: [{ app: expect.stringContaining("Attach File") }] }],
    })
    // The bank check on the month end closes the month before too, labelled.
    const older = await monthEndOf({ month: before })
    expect(itemsOf(older.payload, "bank")[0].text).toMatch(/\(after month end\)$/)
  })

  it("reads a month name as its most recent ended occurrence, across the year end", async () => {
    expect((await monthEndOf({ month: formatYearMonth(last, "MMMM") })).payload.month).toBe(last)
    // This month's name is last year's, before any data here.
    const lastYear = `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}`
    const { isError, payload } = await monthEndOf({ month: format(now, "MMMM").toLowerCase() })
    expect(isError).toBe(true)
    expect(payload.error).toBe(`${lastYear} is before the first month with data (${before}): nothing to close there.`)
  })

  it("refuses the current month and a later one", async () => {
    const current = await monthEndOf({ month: today.slice(0, 7) })
    expect(current.isError).toBe(true)
    expect(current.payload.error).toMatch(new RegExp(`^${today.slice(0, 7)} can't be closed until 1 .+: its hours and invoices are still open\\. Ask for ${last} or earlier\\.$`))
    const later = await monthEndOf({ month: format(addMonths(now, 2), "yyyy-MM") })
    expect(later.isError).toBe(true)
    expect(later.payload.error).toContain("can't be closed until")
  })

  it("answers a read-only token, and is never audited", async () => {
    const readOnly = await mintAccessToken(ownerToken, "data:read")
    const { isError, payload } = await monthEndOf({}, readOnly)
    expect(isError).toBe(false)
    expect(payload.month).toBe(last)
    const audit = await getAdminFirestore().collection("users").doc(owner).collection("mcp_audit").where("tool", "==", "get_month_end").get()
    expect(audit.empty).toBe(true)
  })

  // A user of its own again: two clients owe last month, no company account.
  describe("with two clients to invoice", () => {
    let two = ""
    const year = today.slice(0, 4)

    beforeAll(async () => {
      const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), `mcp-month-end-two-${Date.now()}@example.com`, "Test1234!")
      two = await mintAccessToken(await user.getIdToken())
      const contract: Record<string, string> = {}
      for (const name of ["Small Test Srl", "Big Test Spa"]) {
        const c = await admin.createClient(user.uid, { name })
        const e = await admin.createEngagement(user.uid, { clientId: c.id, name: "Support", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 10, startMonth: last })
        contract[name] = e.id
      }
      // The client created first logs 1 day, the other 10: the larger is still numbered first.
      // Keyed by name, not by read order: getEngagements returns doc-id order, and auto ids are random.
      const days = weekdays(last)
      await admin.setTimecard(user.uid, { engagementId: contract["Small Test Srl"], date: days[0], hours: 8 })
      for (const date of days.slice(0, 10)) await admin.setTimecard(user.uid, { engagementId: contract["Big Test Spa"], date, hours: 8 })
      const other = await admin.createClient(user.uid, { name: "Other Test Srl" })
      await admin.createInvoice(user.uid, { clientId: other.id, number: `5/${year}`, yearMonth: last, amount: 100, vat: 22 })
    })

    it("proposes the same invoice numbers as get_unbilled, largest amount first", async () => {
      const { payload } = await monthEndOf({}, two)
      const proposed = (p: Record<string, unknown>) =>
        Object.fromEntries(itemsOf(p, "invoices").map((i) => [i.next![0].args!.client, i.next![0].args!.number]))
      const { payload: unbilled } = await callTool("get_unbilled", {}, two)
      const clients = unbilled.clients as { client: string; toInvoice: number; suggestions: { number: string }[] }[]
      expect(clients.map((c) => [c.client, c.toInvoice, c.suggestions[0].number])).toEqual([
        ["Big Test Spa", 10 * 500, `6/${year}`],
        ["Small Test Srl", 500, `7/${year}`],
      ])
      expect(proposed(payload)).toEqual({ "Big Test Spa": `6/${year}`, "Small Test Srl": `7/${year}` })
    })

    it("says why a step has nothing to check, as the page does", async () => {
      const { payload } = await monthEndOf({}, two)
      const na = (payload.steps as Record<string, unknown>[]).filter((s) => s.status === "na")
      expect(na.map(({ step, notNeeded, done }) => ({ step, notNeeded, done }))).toEqual([
        { step: "bank", notNeeded: "No company account was open by the month end.", done: undefined },
        { step: "chase", notNeeded: "No company accounts in the Cash Book yet.", done: undefined },
      ])
      expect(steps(payload).find((s) => s.step === "hours")).toMatchObject({ done: expect.stringMatching(/^Done when/) })
    })
  })
})

describe("get_client, a contract worked past its budget (#308)", () => {
  let over: Engagement
  let under: Engagement

  beforeAll(async () => {
    const client = await admin.createClient(userId, { name: "Overrun Srl" })
    const contract = () =>
      admin.createEngagement(userId, {
        clientId: client.id, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 4, startMonth: currentMonth,
        contractedDays: 10,
      })
    over = await contract()
    under = await contract()
    // 2024-06 lies outside every other suite's window (list_time reads 12 months back, the rest 2025 on): 15 days (120 h) on one contract, 3 days (24 h) on the other.
    const log = (engagementId: string, day: number) =>
      admin.setTimecard(userId, { engagementId, date: `2024-06-${String(day).padStart(2, "0")}`, hours: 8, notes: null })
    for (let d = 1; d <= 15; d++) await log(over.id, d)
    for (let d = 1; d <= 3; d++) await log(under.id, d)
  })

  it("names no run-out month once the days worked pass the budget, and names it before", async () => {
    const { payload } = await callTool("get_client", { client: "Overrun" })
    const engs = payload.engagements as { id: string; exhaustionMonth: string | null }[]
    expect(engs.find((e) => e.id === over.id)?.exhaustionMonth).toBeNull()
    expect(engs.find((e) => e.id === under.id)?.exhaustionMonth).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe("get_hours_left", () => {
  // A fixed past day, away from list_time's rows; the contracts are seeded last so no other suite sees them.
  const day = "2026-05-19"
  let migrazione: Engagement
  let beta: Engagement
  let pilot: string
  let gamma: string

  beforeAll(async () => {
    migrazione = engagements.find((e) => e.name === "Migrazione cloud")!
    beta = engagements.find((e) => e.name === null)!
    pilot = await seedEngagement({ clientId: migrazione.clientId, dailyRate: 900, defaultDaysPerMonth: 2, name: "Pilot" })
    const gammaClient = await admin.createClient(userId, { name: "Gamma Srl" })
    gamma = await seedEngagement({ clientId: gammaClient.id, dailyRate: 800, defaultDaysPerMonth: 1, contractedDays: 2, name: "Gamma Build" })
    await admin.setTimecard(userId, { engagementId: beta.id, date: day, hours: 2, notes: null })
  })

  it("leaves the client its 8 h when 2 h went on another client that day", async () => {
    const { isError, payload } = await callTool("get_hours_left", { engagementId: migrazione.id, date: day })
    expect(isError).toBe(false)
    expect(payload).toMatchObject({
      client: "Acme Spa",
      contract: "Migrazione cloud",
      date: day,
      day: { logged: 0, left: 8, of: 8, onOtherContracts: 0, onOtherClients: 2 },
      most: 8,
      binds: "day",
      otherClients: [{ client: "Beta Srl", hours: 2 }],
    })
    expect(payload.summary).toContain("2026-05-19 on Acme Spa: nothing yet, 8 h left of 8. Your 2 h on Beta Srl that day count only there.")
  })

  it("takes 3 h on the client's other contract off the day: 5 h left", async () => {
    await admin.setTimecard(userId, { engagementId: pilot, date: day, hours: 3, notes: null })
    const { payload } = await callTool("get_hours_left", { client: "Acme Spa", engagementId: migrazione.id, date: day })
    expect(payload).toMatchObject({ day: { logged: 3, left: 5, onOtherContracts: 3 }, most: 5 })
    const refused = await callTool("log_time", { engagementId: migrazione.id, date: day, hours: 6 })
    expect(refused.isError).toBe(true)
    expect(JSON.stringify(refused.payload)).toContain("That makes 9 h on this client in one day: more than 8.")
    const at = await callTool("log_time", { engagementId: migrazione.id, date: day, hours: 5 })
    expect(at.isError).toBe(false)
    await callTool("log_time", { engagementId: migrazione.id, date: day, hours: 0 })
  })

  it("reports the contract's days left where log_time starts refusing", async () => {
    await admin.setTimecard(userId, { engagementId: gamma, date: "2026-05-12", hours: 10, notes: null })
    const { payload } = await callTool("get_hours_left", { engagementId: gamma, date: day })
    expect(payload).toMatchObject({ contractLeft: { daysLeft: 0.75, hoursLeft: 6 }, most: 6, binds: "contract" })
    const above = await callTool("log_time", { engagementId: gamma, date: day, hours: 6.25 })
    expect(above.isError).toBe(true)
    expect(JSON.stringify(above.payload)).toContain("The contract has 6 h left")
    const at = await callTool("log_time", { engagementId: gamma, date: day, hours: 6 })
    expect(at.isError).toBe(false)
    // The hours are in now: the same day shows them as logged, and nothing more to add.
    const after = await callTool("get_hours_left", { engagementId: gamma, date: day })
    expect(after.payload).toMatchObject({ day: { logged: 6, left: 2, onThisContract: 6 }, contractLeft: { hoursLeft: 0 }, most: 0 })
  })

  it("refuses a date that does not exist", async () => {
    const { isError, payload } = await callTool("get_hours_left", { engagementId: gamma, date: "2026-02-30" })
    expect(isError).toBe(true)
    expect(JSON.stringify(payload)).toContain("does not exist")
  })

  it("asks for the contract when the client alone has several active ones", async () => {
    const { isError, payload } = await callTool("get_hours_left", { client: "Acme Spa", date: day })
    expect(isError).toBe(true)
    expect(JSON.stringify(payload)).toContain("active contracts")
  })

  it("says why a date takes no hours", async () => {
    const { payload } = await callTool("get_hours_left", { engagementId: gamma, date: "2099-01-05" })
    expect(payload).toMatchObject({ refusal: "tooFar", most: 0, binds: "date" })
  })
})
