/**
 * Collaborator tools, get_quarters and get_plan's costs over MCP (#329) — end-to-end through the route
 * handler, real Firestore. Its own user, synthetic data only. The model is the one shipped in #335-#337:
 * a collaborator's days are logged per person inside the contract's days, and their invoices link by
 * collaborator, contract and For Month.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts).
 */
import { format } from "date-fns"
import { createUserWithEmailAndPassword } from "firebase/auth"
import { beforeAll, describe, expect, it } from "vitest"

import { POST as mcp } from "@/app/api/mcp/route"
import { POST as approve } from "@/app/api/oauth/authorize/route"
import { POST as register } from "@/app/api/oauth/register/route"
import { POST as token } from "@/app/api/oauth/token/route"
import * as admin from "@/lib/backend/firebase-admin"
import { toRevenueSources } from "@/lib/engagement-burndown"
import { getFirebaseAuth } from "@/lib/firebase-client"
import { monthShift } from "@/lib/mcp/tools/helpers"
import { s256 } from "@/lib/oauth/pkce"
import { buildProjection } from "@/lib/projection"

const ORIGIN = "https://mcp.test"
const REDIRECT = "https://claude.ai/api/mcp/auth_callback"
const VERIFIER = "a".repeat(43)

const current = format(new Date(), "yyyy-MM")
const worked = monthShift(current, -1)
const in2 = monthShift(current, 2)
const in6 = monthShift(current, 6)

let userId = ""
let writeBearer = ""
let readOnlyBearer = ""
let nordwind = ""
let product = ""

async function mintToken(idToken: string, scope: string): Promise<string> {
  const reg = await register(
    new Request(`${ORIGIN}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "test", redirect_uris: [REDIRECT] }),
    })
  )
  const { client_id: oauthClient } = (await reg.json()) as { client_id: string }
  const auth = await approve(
    new Request(`${ORIGIN}/api/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idToken, clientId: oauthClient, redirectUri: REDIRECT, scope, codeChallenge: await s256(VERIFIER), codeChallengeMethod: "S256",
      }),
    })
  )
  const { code } = (await auth.json()) as { code: string }
  const tok = await token(
    new Request(`${ORIGIN}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, client_id: oauthClient, redirect_uri: REDIRECT }),
    })
  )
  return ((await tok.json()) as { access_token: string }).access_token
}

function rpcRequest(bearer: string, name: string, args: Record<string, unknown>): Request {
  return new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; payload: Payload }> {
  const res = await mcp(rpcRequest(writeBearer, name, args))
  expect(res.status).toBe(200)
  const dataLine = (await res.text()).split("\n").find((l) => l.startsWith("data: "))!
  const rpc = JSON.parse(dataLine.slice(6)) as { result: { isError?: boolean; content: [{ text: string }] } }
  return { isError: rpc.result.isError ?? false, payload: JSON.parse(rpc.result.content[0].text) as Payload }
}

async function refusal(name: string, args: Record<string, unknown>): Promise<string> {
  const { isError, payload } = await callTool(name, args)
  expect(isError).toBe(true)
  return payload.error as string
}

const COLLAB_COST = "Collaborators cost, next 12 months"
const NET = "Plan net, next 12 months"
const MARGIN = "Margin on Nordwind · Product Graph, next 6 months"
const stored = async (name: string) => (await admin.getCollaborators(userId)).find((c) => c.name === name)!

beforeAll(async () => {
  const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), `mcp-collab-${Date.now()}@example.com`, "Test1234!")
  userId = user.uid
  const idToken = await user.getIdToken()
  writeBearer = await mintToken(idToken, "data:read data:write")
  readOnlyBearer = await mintToken(idToken, "data:read")
  nordwind = (await admin.createClient(userId, { name: "Nordwind" })).id
  // 10 days a month at €500: €5,000 a month, open-ended.
  product = (await admin.createEngagement(userId, {
    clientId: nordwind, name: "Product Graph", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 10, startMonth: worked,
  })).id
})

describe("scope gate", () => {
  it.each(["add_collaborator", "update_collaborator", "assign_collaborator", "unassign_collaborator"])("%s needs the write scope", async (tool) => {
    const res = await mcp(rpcRequest(readOnlyBearer, tool, {}))
    expect(res.status).toBe(403)
  })
})

describe("add_collaborator", () => {
  it("creates one with a fixed fee and a dated change, and says what the next 12 months become", async () => {
    const { isError, payload } = await callTool("add_collaborator", {
      name: "Studio Verdi", type: "company", notes: "Design", fee_amount: 2400, fee_from: current, fee_changes: [{ from: in6, amount: 3000 }],
    })
    expect(isError).toBe(false)
    expect(payload.effects).toEqual([
      { figure: COLLAB_COST, before: 0, after: 32400 },
      { figure: NET, before: 60000, after: 27600 },
    ])
    expect(payload.collaborator).toMatchObject({ name: "Studio Verdi", type: "company", active: true, fee: { amount: 2400, from: current, until: null, changes: [{ from: in6, amount: 3000 }] } })
    expect(await stored("Studio Verdi")).toMatchObject({ notes: "Design", isActive: true, fee: { amount: 2400, from: current, until: null, changes: [{ from: in6, amount: 3000 }] } })
  })

  it.each([
    ["a name already used, in any case", { name: "studio verdi", type: "company" }, 'There is already a collaborator named "Studio Verdi".'],
    ["a fee without its start", { name: "A", type: "company", fee_amount: 100 }, "A fixed fee needs fee_amount and fee_from."],
    ["fee details without an amount", { name: "A", type: "company", fee_from: current }, "A fixed fee needs fee_amount and fee_from."],
    ["a change on the month the fee starts", { name: "A", type: "company", fee_amount: 100, fee_from: current, fee_changes: [{ from: current, amount: 200 }] }, "A change starts after the fee does"],
    ["a change after the end", { name: "A", type: "company", fee_amount: 100, fee_from: current, fee_until: in2, fee_changes: [{ from: in6, amount: 200 }] }, "A change falls after the end"],
    ["two changes in one month", { name: "A", type: "company", fee_amount: 100, fee_from: current, fee_changes: [{ from: in2, amount: 200 }, { from: in2, amount: 300 }] }, "Two changes start in the same month"],
    ["an end before the start", { name: "A", type: "company", fee_amount: 100, fee_from: in2, fee_until: current }, "The end is before the start"],
    ["a fee of nothing", { name: "A", type: "company", fee_amount: 0, fee_from: current }, "The fee is more than 0"],
  ])("refuses %s", async (_, args, message) => {
    expect(await refusal("add_collaborator", args)).toBe(message)
  })

  it("writes nothing when it refuses", async () => {
    expect((await admin.getCollaborators(userId)).map((c) => c.name)).toEqual(["Studio Verdi"])
  })
})

describe("update_collaborator", () => {
  it("previews without writing, then writes on confirm", async () => {
    const preview = await callTool("update_collaborator", { collaborator: "studio verdi", fee_amount: 2000 })
    expect(preview.payload.preview).toBe(true)
    expect(preview.payload.effects).toEqual([
      { figure: COLLAB_COST, before: 32400, after: 30000 },
      { figure: NET, before: 27600, after: 30000 },
    ])
    expect((await stored("Studio Verdi")).fee!.amount).toBe(2400)
    const done = await callTool("update_collaborator", { collaborator: "studio verdi", fee_amount: 2000, confirm: true })
    expect(done.payload.preview).toBeUndefined()
    expect((await stored("Studio Verdi")).fee).toEqual({ amount: 2000, from: current, until: null, changes: [{ from: in6, amount: 3000 }] })
  })

  it("replaces a change by adding one in its month, and removes one", async () => {
    const replaced = await callTool("update_collaborator", { collaborator: "Studio Verdi", add_fee_changes: [{ from: in6, amount: 2500 }], confirm: true })
    expect(replaced.payload.effects[0]).toEqual({ figure: COLLAB_COST, before: 30000, after: 27000 })
    const removed = await callTool("update_collaborator", { collaborator: "Studio Verdi", remove_fee_changes: [in6], confirm: true })
    expect(removed.payload.effects[0]).toEqual({ figure: COLLAB_COST, before: 27000, after: 24000 })
    expect((await stored("Studio Verdi")).fee!.changes).toEqual([])
    expect(await refusal("update_collaborator", { collaborator: "Studio Verdi", remove_fee_changes: [in6] })).toBe(`No fee change starts in ${in6}. Changes: none.`)
  })

  it("ends the fee, and refuses the combinations the app refuses", async () => {
    const ended = await callTool("update_collaborator", { collaborator: "Studio Verdi", fee_until: in2, confirm: true })
    expect(ended.payload.effects[0]).toEqual({ figure: COLLAB_COST, before: 24000, after: 6000 })
    expect((await stored("Studio Verdi")).fee!.until).toBe(in2)
    expect(await refusal("update_collaborator", { collaborator: "Studio Verdi", add_fee_changes: [{ from: current, amount: 1 }] })).toBe("A change starts after the fee does")
    expect(await refusal("update_collaborator", { collaborator: "Studio Verdi", add_fee_changes: [{ from: in6, amount: 1 }] })).toBe("A change falls after the end")
    expect(await refusal("update_collaborator", { collaborator: "Studio Verdi", clear_fee: true, fee_amount: 10 })).toBe("clear_fee removes the fee: leave out the fee_* fields.")
    expect(await refusal("update_collaborator", { collaborator: "Studio Verdi" })).toMatch(/^Nothing to change/)
    expect((await stored("Studio Verdi")).fee).toMatchObject({ amount: 2000, until: in2, changes: [] })
  })

  it("Inactive takes the fee out of the plan, and clearing the fee ends it", async () => {
    const off = await callTool("update_collaborator", { collaborator: "Studio Verdi", active: false, confirm: true })
    expect(off.payload.effects[0]).toEqual({ figure: COLLAB_COST, before: 6000, after: 0 })
    await callTool("update_collaborator", { collaborator: "Studio Verdi", active: true, confirm: true })
    const cleared = await callTool("update_collaborator", { collaborator: "Studio Verdi", clear_fee: true, confirm: true })
    expect(cleared.payload.effects[0]).toEqual({ figure: COLLAB_COST, before: 6000, after: 0 })
    expect(await stored("Studio Verdi")).toMatchObject({ fee: null, isActive: true })
  })

  it("starting a fee on one that has none needs both amount and start", async () => {
    expect(await refusal("update_collaborator", { collaborator: "Studio Verdi", fee_amount: 900 })).toBe("A fixed fee needs fee_amount and fee_from.")
    await callTool("update_collaborator", { collaborator: "Studio Verdi", fee_amount: 900, fee_from: current, confirm: true })
    expect((await stored("Studio Verdi")).fee).toEqual({ amount: 900, from: current, until: null, changes: [] })
    await callTool("update_collaborator", { collaborator: "Studio Verdi", clear_fee: true, confirm: true })
  })

  it("renames, rejecting a name another collaborator has, and refuses unknown names with the list", async () => {
    await callTool("add_collaborator", { name: "Giulia Neri", type: "freelancer", notes: "Backend" })
    expect(await refusal("update_collaborator", { collaborator: "Giulia Neri", name: "STUDIO VERDI" })).toBe('There is already a collaborator named "Studio Verdi".')
    expect(await refusal("update_collaborator", { collaborator: "Mario", active: false })).toBe('No collaborator matches "Mario". Collaborators: Giulia Neri, Studio Verdi.')
  })
})

describe("assign_collaborator and unassign_collaborator", () => {
  let giulia = ""
  const assignmentsOf = async () => (await admin.getAssignments(userId)).filter((a) => a.engagementId === product)

  beforeAll(async () => {
    giulia = (await stored("Giulia Neri")).id
  })

  it("previews the plan and the contract's margin, then assigns on confirm", async () => {
    const args = { collaborator: "giulia neri", contract: "Product Graph", rate: 300, from: current, days_per_month: 4 }
    const preview = await callTool("assign_collaborator", args)
    expect(preview.payload.preview).toBe(true)
    expect(preview.payload.effects).toEqual([
      { figure: COLLAB_COST, before: 0, after: 14400 },
      { figure: NET, before: 60000, after: 45600 },
      { figure: MARGIN, before: 30000, after: 22800 },
    ])
    expect(await assignmentsOf()).toEqual([])
    await callTool("assign_collaborator", { ...args, confirm: true })
    expect(await assignmentsOf()).toMatchObject([{ id: `${giulia}_${product}`, collaboratorId: giulia, dailyRate: 300, from: current, until: null, defaultDays: 4, monthDays: {} }])
  })

  it("assigning again edits that assignment, keeping what was not said", async () => {
    const done = await callTool("assign_collaborator", { collaborator: "Giulia Neri", contract: "Product Graph", days_per_month: 6, confirm: true })
    expect(done.payload.effects).toEqual([
      { figure: COLLAB_COST, before: 14400, after: 21600 },
      { figure: NET, before: 45600, after: 38400 },
      { figure: MARGIN, before: 22800, after: 19200 },
    ])
    expect(await assignmentsOf()).toMatchObject([{ dailyRate: 300, from: current, defaultDays: 6 }])
  })

  it("sets and removes a month's days", async () => {
    const next = monthShift(current, 1)
    await callTool("assign_collaborator", { collaborator: "Giulia Neri", contract: "Product Graph", month_days: [{ month: next, days: 0 }], confirm: true })
    expect((await assignmentsOf())[0].monthDays).toEqual({ [next]: 0 })
    await callTool("assign_collaborator", { collaborator: "Giulia Neri", contract: "Product Graph", month_days: [{ month: next, days: null }], confirm: true })
    expect((await assignmentsOf())[0].monthDays).toEqual({})
  })

  it.each([
    ["an unknown collaborator", { collaborator: "Mario", contract: "Product Graph", rate: 1, from: current, days_per_month: 1 }, 'No collaborator matches "Mario". Collaborators: Giulia Neri, Studio Verdi.'],
    ["a new assignment without its terms", { collaborator: "Studio Verdi", contract: "Product Graph" }, "A new assignment needs rate, from and days_per_month."],
    ["an end before the start", { collaborator: "Giulia Neri", contract: "Product Graph", until: worked }, "The end is before the start"],
    ["more than 31 days a month", { collaborator: "Giulia Neri", contract: "Product Graph", days_per_month: 32 }, "A month holds at most 31 days: 32 days is more."],
  ])("refuses %s", async (_, args, message) => {
    expect(await refusal("assign_collaborator", args)).toBe(message)
  })

  it("unknown contract is refused with the contracts", async () => {
    expect(await refusal("assign_collaborator", { collaborator: "Giulia Neri", contract: "Nope", rate: 1, from: current, days_per_month: 1 })).toMatch(/Nope/)
  })

  it("unassign refuses while days are logged, preview included; with none it previews, then removes", async () => {
    await admin.setTimecard(userId, { engagementId: product, collaboratorId: giulia, date: `${worked}-02`, hours: 8 })
    const logged = "This collaborator has days logged on this contract: set the assignment's Until instead of removing it."
    expect(await refusal("unassign_collaborator", { collaborator: "Giulia Neri", contract: "Product Graph" })).toBe(logged)
    expect(await refusal("unassign_collaborator", { collaborator: "Giulia Neri", contract: "Product Graph", confirm: true })).toBe(logged)

    await callTool("assign_collaborator", { collaborator: "Studio Verdi", contract: "Product Graph", rate: 250, from: current, days_per_month: 2, confirm: true })
    const args = { collaborator: "Studio Verdi", contract: "Product Graph" }
    const preview = await callTool("unassign_collaborator", args)
    expect(preview.payload.preview).toBe(true)
    expect(preview.payload.effects[0]).toEqual({ figure: COLLAB_COST, before: 27600, after: 21600 })
    expect(await assignmentsOf()).toHaveLength(2)
    await callTool("unassign_collaborator", { ...args, confirm: true })
    expect((await assignmentsOf()).map((a) => a.collaboratorId)).toEqual([giulia])
    expect(await refusal("unassign_collaborator", args)).toBe("Studio Verdi is not on Product Graph.")
  })
})

describe("get_plan", () => {
  it("returns costs split into collaborators and other, and net, as the Projection has them", async () => {
    await admin.createCompanyExpense(userId, { description: "Rent", category: "rent", amount: 700, date: new Date(`${current}-03T00:00:00`), vat: 0 })
    const { payload } = await callTool("get_plan", { months: 3 })
    const [engagements, clients, collaborators, assignments, expenses] = await Promise.all([
      admin.getEngagements(userId), admin.getClients(userId), admin.getCollaborators(userId), admin.getAssignments(userId), admin.getCompanyExpenses(userId),
    ])
    const projection = buildProjection({
      sources: toRevenueSources({ engagements, opportunities: [], clients, scenario: "committed" }),
      allocations: [], fromMonth: current, months: 3, companyExpenses: expenses, collaborators, assignments,
    })
    expect(payload.months.map((m: Payload) => [m.yearMonth, m.revenue, m.costs, m.net])).toEqual(
      projection.map((m) => [m.yearMonth, m.revenue, { collaborators: m.collaborators, other: m.otherCosts, total: m.costs }, m.revenue - m.costs]),
    )
    // Worked by hand: 6 days × €300 for Giulia, the €700 rent in this month only, €5,000 of revenue.
    expect(payload.months[0]).toMatchObject({ revenue: 5000, costs: { collaborators: 1800, other: 700, total: 2500 }, net: 2500 })
    expect(payload.months[1]).toMatchObject({ costs: { collaborators: 1800, other: 0, total: 1800 }, net: 3200 })
    expect(payload.totals).toEqual({ revenue: 15000, collaborators: 5400, other: 700, costs: 6100, net: 8900 })
    expect(payload.months[0].lines[0]).toMatchObject({ clientName: "Nordwind", plannedDays: 10, revenue: 5000 })
  })

  it("capacity counts only the owner's days: the contract's 10, less Giulia's 6", async () => {
    const plan = await callTool("get_plan", { months: 1 })
    expect(plan.payload.months[0].capacity).toMatchObject({ allocatedDays: 4 })
    const cap = await callTool("get_capacity", { from: current, months: 1 })
    expect(cap.payload.months[0].allocatedDays).toBe(4)
  })
})

describe("get_quarters", () => {
  const monthsOf = (year: string) => [1, 2, 3, 4].map((q) => [1, 2, 3].map((i) => `${year}-${String((q - 1) * 3 + i).padStart(2, "0")}`))

  beforeAll(async () => {
    const giulia = (await stored("Giulia Neri")).id
    for (const d of ["03", "04", "05"]) await admin.setTimecard(userId, { engagementId: product, collaboratorId: giulia, date: `${worked}-${d}`, hours: 8 })
    // 4 days of hers in the month of work (the 02nd is already logged): 4 × €300 = €1,200.
    await admin.createInvoice(userId, { clientId: nordwind, number: "Q-1/2026", yearMonth: worked, amount: 4000, vat: 0 })
    await admin.createCompanyExpense(userId, { description: "Printing", category: "office_supplies", amount: 300, date: new Date(`${worked}-10T00:00:00`), vat: 0 })
    // Giulia's invoice for the month of work, dated this month: it belongs to `worked`, and is €200 short of the plan.
    await admin.createCompanyExpense(userId, {
      description: "Invoice 9, Giulia", category: "collaborators", amount: 1000, date: new Date(`${current}-01T00:00:00`), vat: 0,
      collaboratorId: giulia, engagementId: product, forMonth: worked,
    })
  })

  it("an ended month: invoiced against plan, the gap naming who, and the For Month invoice in its month", async () => {
    const year = worked.slice(0, 4)
    const { payload } = await callTool("get_quarters", { year: Number(year) })
    const quarter = payload.quarters.find((q: Payload) => q.months.some((m: Payload) => m.yearMonth === worked))
    const month = quarter.months.find((m: Payload) => m.yearMonth === worked)
    expect(month).toEqual({
      yearMonth: worked, source: "invoiced", revenue: 4000, collaborators: 1000, otherCosts: 300, costs: 1300, net: 2700,
      collaboratorsPlan: 1200, missing: [{ name: "Giulia Neri", amount: 200 }],
    })
    expect(quarter.notInvoiced).toBe(200)
    const ended = monthsOf(year)[Math.floor((Number(worked.slice(5)) - 1) / 3)].every((m) => m < current)
    expect(quarter.status).toBe(ended ? "closed" : "in-progress")
    expect(quarter.costs).toEqual({ collaborators: quarter.months.reduce((s: number, m: Payload) => s + m.collaborators, 0), other: quarter.months.reduce((s: number, m: Payload) => s + m.otherCosts, 0), total: quarter.costs.total })
    expect(quarter.margin).toBe(Math.round((quarter.net / quarter.revenue) * 100))
  })

  it("this month is at plan, and the invoice for last month does not count in it", async () => {
    const { payload } = await callTool("get_quarters", {})
    const month = payload.quarters.flatMap((q: Payload) => q.months).find((m: Payload) => m.yearMonth === current)
    expect(month).toMatchObject({ source: "plan", revenue: 5000, collaborators: 1800, otherCosts: 700, costs: 2500, net: 2500, collaboratorsPlan: null, missing: [] })
  })

  it("a later year is all planned", async () => {
    const next = Number(current.slice(0, 4)) + 1
    const { payload } = await callTool("get_quarters", { year: next })
    expect(payload.quarters.map((q: Payload) => q.status)).toEqual(["planned", "planned", "planned", "planned"])
    expect(payload.quarters[0].months[0]).toMatchObject({ yearMonth: `${next}-01`, source: "plan", revenue: 5000, collaborators: 1800, costs: 1800, net: 3200 })
    expect(payload.totals).toEqual({ revenue: 60000, costs: { collaborators: 21600, other: 0, total: 21600 }, net: 38400, margin: 64 })
  })
})

describe("log_allocation", () => {
  it("its month total counts only the owner's days: 12 logged, less Giulia's 6", async () => {
    const set = await callTool("log_allocation", { client: "Nordwind", engagementId: "Product Graph", days: 12, month: current, mode: "set" })
    expect(set.payload.monthOwnDays).toBe(6)
    expect(set.payload.ownDaysNote).toBe("Counts only your own days: collaborators' days on a contract are theirs.")
  })
})

describe("assignments on contracts with an end or an hourly rate", () => {
  it("until may not pass the contract's end, and an hourly contract's rate is per hour", async () => {
    await admin.createEngagement(userId, { clientId: nordwind, name: "Short Job", dailyRate: 400, vatApplicable: true, defaultDaysPerMonth: 5, endMonth: in2 })
    expect(
      await refusal("assign_collaborator", { collaborator: "Giulia Neri", contract: "Short Job", rate: 300, from: current, until: in6, days_per_month: 2 }),
    ).toBe(`Short Job ends in ${in2}: until can't be later.`)
    await admin.createEngagement(userId, { clientId: nordwind, name: "Hourly Job", dailyRate: 320, unit: "hour", vatApplicable: true, defaultDaysPerMonth: 5 })
    await callTool("assign_collaborator", { collaborator: "Giulia Neri", contract: "Hourly Job", rate: 40, from: current, days_per_month: 16, confirm: true })
    const hourly = (await admin.getAssignments(userId)).find((a) => a.engagementId !== product && a.defaultDays === 2)!
    expect(hourly).toMatchObject({ dailyRate: 320, defaultDays: 2 })
    await callTool("assign_collaborator", { collaborator: "Giulia Neri", contract: "Hourly Job", month_days: [{ month: in2, days: 16 }], confirm: true })
    expect((await admin.getAssignments(userId)).find((x) => x.id === hourly.id)!.monthDays).toEqual({ [in2]: 2 })
    expect(await refusal("assign_collaborator", { collaborator: "Giulia Neri", contract: "Hourly Job", month_days: [{ month: in2, days: 300 }] })).toBe(
      "A month holds at most 31 days (248 hours): 300 hours is more.",
    )
  })
})
