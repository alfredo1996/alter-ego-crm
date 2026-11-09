/**
 * MCP write tools — end-to-end through the route handler, real Firestore.
 *
 * Covers the write semantics the user relies on (additive logging, capacity
 * warnings that never block, closedAt stamping), the audit trail, and the
 * HTTP-layer scope gate that turns a read-only token's write attempt into a
 * 403 step-up instead of a dead tool error.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts).
 */
import { isoDate } from "@alter-ego/kernel/dates"
import { addDays, addMonths, format, lastDayOfMonth, subDays } from "date-fns"
import { createUserWithEmailAndPassword } from "firebase/auth"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { POST as mcp } from "@/app/api/mcp/route"
import { POST as approve } from "@/app/api/oauth/authorize/route"
import { POST as register } from "@/app/api/oauth/register/route"
import { POST as token } from "@/app/api/oauth/token/route"
import { hashApiKey } from "@/lib/api-auth"
import * as admin from "@/lib/backend/firebase-admin"
import { getAdminFirestore } from "@/lib/firebase-admin-client"
import { getFirebaseAuth } from "@/lib/firebase-client"
import { s256 } from "@/lib/oauth/pkce"
import { getToken } from "@/lib/oauth/store"

const ORIGIN = "https://mcp.test"
const REDIRECT = "https://claude.ai/api/mcp/auth_callback"
const VERIFIER = "a".repeat(43)

const currentMonth = format(new Date(), "yyyy-MM")

let userId = ""
let writeBearer = ""
let readOnlyBearer = ""

async function mintToken(idToken: string, scope: string): Promise<string> {
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

function rpcRequest(bearer: string, name: string, args: Record<string, unknown>): Request {
  return new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  })
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  bearer = writeBearer
): Promise<{ isError: boolean; payload: Record<string, unknown> }> {
  const res = await mcp(rpcRequest(bearer, name, args))
  expect(res.status).toBe(200)
  const dataLine = (await res.text()).split("\n").find((l) => l.startsWith("data: "))!
  const rpc = JSON.parse(dataLine.slice(6)) as {
    result: { isError?: boolean; content: [{ text: string }] }
  }
  return {
    isError: rpc.result.isError ?? false,
    payload: JSON.parse(rpc.result.content[0].text) as Record<string, unknown>,
  }
}

async function auditEntries(): Promise<{ tool: string; result: string }[]> {
  const snap = await getAdminFirestore()
    .collection("users").doc(userId).collection("mcp_audit").get()
  return snap.docs.map((d) => d.data() as { tool: string; result: string })
}

let acmeId = ""
let engagementId = ""

beforeAll(async () => {
  const { user } = await createUserWithEmailAndPassword(
    getFirebaseAuth(),
    `mcp-write-${Date.now()}@example.com`,
    "Test1234!"
  )
  userId = user.uid
  const idToken = await user.getIdToken()
  writeBearer = await mintToken(idToken, "data:read data:write")
  readOnlyBearer = await mintToken(idToken, "data:read")

  const acme = await admin.createClient(userId, { name: "Acme Spa" })
  acmeId = acme.id
  const ref = await getAdminFirestore()
    .collection("users").doc(userId).collection("engagements")
    .add({
      userId, clientId: acmeId, opportunityId: null, dailyRate: 1300, vatApplicable: true,
      contractedDays: 40, defaultDaysPerMonth: 10, startMonth: null, isActive: true, notes: null,
      createdAt: new Date(), updatedAt: new Date(),
    })
  engagementId = ref.id
})

describe("scope gate", () => {
  it("read-only token calling a write tool gets 403 insufficient_scope", async () => {
    const res = await mcp(
      rpcRequest(readOnlyBearer, "log_allocation", { client: "Acme", days: 1, month: currentMonth, mode: "set" })
    )
    expect(res.status).toBe(403)
    const challenge = res.headers.get("WWW-Authenticate") ?? ""
    expect(challenge).toContain('error="insufficient_scope"')
    expect(challenge).toContain('scope="data:read data:write"')
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`)

    // #157: what it has, what the tool needs, and that only a new credential changes that.
    const body = await res.text()
    const { error_description: text } = JSON.parse(body) as { error_description: string }
    expect(text).toContain("This credential was granted: data:read. The log_allocation tool needs data:write.")
    expect(text).toContain("Scopes are fixed when a credential is issued")
    expect(text).toContain("reconnect the connector (re-authorize)")
    expect(challenge).toContain(`error_description="${text}"`)

    const { clientId } = (await getToken(await hashApiKey(readOnlyBearer)))!
    for (const secret of [readOnlyBearer, readOnlyBearer.slice(0, 8), userId, clientId]) {
      expect(body + challenge).not.toContain(secret)
    }
  })

  // The 403 recommends an API key because it carries every scope — hold it to that.
  it("an API key passes the gate that stops a read-only token", async () => {
    const { key } = await admin.createApiKey(userId)
    const { isError } = await callTool("list_clients", {}, key)
    expect(isError).toBe(false)
    const res = await mcp(rpcRequest(key, "update_engagement", { engagementId: "Inesistente", active: true }))
    expect(res.status).toBe(200)
  })

  it("read-only token still reads", async () => {
    const { isError } = await callTool("list_clients", {}, readOnlyBearer)
    expect(isError).toBe(false)
  })
})

describe("log_allocation", () => {
  it("sets the month, adds to it (3+2=5), then set overwrites", async () => {
    const first = await callTool("log_allocation", {
      client: "Acme", days: 3, month: `${currentMonth}-19`, mode: "set",
    })
    expect(first.isError).toBe(false)
    expect(first.payload.days).toBe(3)

    const second = await callTool("log_allocation", { client: "Acme", days: 2, month: currentMonth, mode: "add" })
    expect(second.payload.days).toBe(5)
    expect(second.payload.monthOwnDays).toBe(5)
    expect(second.payload.remainingContractDays).toBe(35) // 40 contracted − 5

    const set = await callTool("log_allocation", { client: "Acme", days: 12, month: currentMonth, mode: "set" })
    expect(set.payload.days).toBe(12)

    // Exactly one allocation doc for the (engagement, month) pair — upsert, not duplicates.
    const all = await admin.getAllocations(userId, { engagementId })
    expect(all.filter((a) => a.yearMonth === currentMonth)).toHaveLength(1)
  })

  // The bug: "ho fatto 3 giorni" on a month with no row computed 0 + 3 and stored 3,
  // replacing the contract's default of 10 — revenue for that month fell.
  it("refuses add on a month with nothing recorded, instead of replacing the default", async () => {
    const empty = "2027-04"
    const { isError, payload } = await callTool("log_allocation", {
      client: "Acme", days: 3, month: empty, mode: "add",
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("contract default (10 days)")
    expect(String(payload.error)).toContain('mode "set"')
    expect(await admin.getAllocationByKey(userId, engagementId, empty)).toBeNull()
  })

  it("requires mode, so a bare call cannot fall back to add", async () => {
    const res = await mcp(rpcRequest(writeBearer, "log_allocation", {
      client: "Acme", days: 1, month: currentMonth,
    }))
    const dataLine = (await res.text()).split("\n").find((l) => l.startsWith("data: "))!
    const rpc = JSON.parse(dataLine.slice(6)) as { error?: unknown; result?: { isError?: boolean } }
    // The SDK reports invalid arguments as a tool error; either form must name the field.
    expect(rpc.error !== undefined || rpc.result?.isError === true).toBe(true)
    expect(JSON.stringify(rpc)).toContain("mode")
    // Nothing was written: the month still holds the 12 set above.
    expect((await admin.getAllocationByKey(userId, engagementId, currentMonth))?.days).toBe(12)
  })

  it("rejects an add that would exceed 31 days", async () => {
    const { isError, payload } = await callTool("log_allocation", {
      client: "Acme",
      days: 25,
      month: currentMonth,
      mode: "add",
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("exceeds the 31")
  })

  it("errors on a client with no active engagement", async () => {
    await admin.createClient(userId, { name: "SenzaContratto" })
    const { isError, payload } = await callTool("log_allocation", {
      client: "SenzaContratto",
      days: 1,
      month: currentMonth,
      mode: "set",
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("No active contract")
  })

  it("errors listing candidates on multi-engagement clients, engagementId tiebreaks", async () => {
    const second = await getAdminFirestore()
      .collection("users").doc(userId).collection("engagements")
      .add({
        userId, clientId: acmeId, opportunityId: null, dailyRate: 900, vatApplicable: true,
        contractedDays: null, defaultDaysPerMonth: 2, startMonth: null, isActive: true, notes: null,
        createdAt: new Date(), updatedAt: new Date(),
      })

    const ambiguous = await callTool("log_allocation", { client: "Acme", days: 1, month: currentMonth, mode: "set" })
    expect(ambiguous.isError).toBe(true)
    expect(String(ambiguous.payload.error)).toContain("2 active contracts")

    const tiebroken = await callTool("log_allocation", {
      client: "Acme", days: 1, month: currentMonth, engagementId: second.id, mode: "set",
    })
    expect(tiebroken.isError).toBe(false)

    // Restore the single-engagement state for later tests.
    await second.delete()
    const stray = await admin.getAllocationByKey(userId, second.id, currentMonth)
    if (stray) {
      await getAdminFirestore()
        .collection("users").doc(userId).collection("allocations").doc(stray.id).delete()
    }
  })
})

describe("block_capacity + overbooking warning", () => {
  it("blocking vacation makes an over-logged month warn, and the write still lands", async () => {
    const target = "2027-02" // clean future month

    const blocked = await callTool("block_capacity", {
      month: target, daysOff: 10, reason: "vacation", note: "montagna",
    })
    expect(blocked.isError).toBe(false)
    const cap = blocked.payload.capacity as { availableDays: number; daysOff: number }
    expect(cap.daysOff).toBe(10)

    // Engagement default is 10 days/month; log 5 more explicit → exceeds capacity.
    const logged = await callTool("log_allocation", {
      client: "Acme", days: 15, month: target, mode: "set",
    })
    expect(logged.isError).toBe(false) // never blocks
    expect(logged.payload.days).toBe(15) // the write landed
    expect(String(logged.payload.warning)).toContain("Warning")
    expect(String(logged.payload.warning)).toContain("vacation")
  })

  it("daysOff 0 clears the block", async () => {
    const cleared = await callTool("block_capacity", { month: "2027-02", daysOff: 0, reason: "vacation" })
    expect(cleared.isError).toBe(false)
    expect(String(cleared.payload.summary)).toContain("Block removed")
  })
})

describe("move_opportunity", () => {
  it("lost without lostReason errors; with it, closedAt and reason stick", async () => {
    const opp = await admin.createOpportunity(userId, {
      clientId: acmeId, title: "Progetto X", stage: "negotiation", probability: 75,
      dailyRate: 1600, estimatedDaysPerMonth: 8, estimatedDurationMonths: 4, vatApplicable: true,
    })

    const noReason = await callTool("move_opportunity", { opportunity: "Progetto X", stage: "lost" })
    expect(noReason.isError).toBe(true)
    expect(String(noReason.payload.error)).toContain("lostReason")

    const lost = await callTool("move_opportunity", {
      opportunity: opp.id, stage: "lost", lostReason: "budget cliente",
    })
    expect(lost.isError).toBe(false)
    const result = lost.payload.opportunity as { closedAt: string | null; lostReason: string; probability: number }
    expect(result.closedAt).not.toBeNull()
    expect(result.lostReason).toBe("budget cliente")
    expect(result.probability).toBe(0) // STAGE_PROBABILITY.lost
  })

  it("won stamps closedAt once, seeds probability 100, returns engagementPrefill; reopen clears", async () => {
    const opp = await admin.createOpportunity(userId, {
      clientId: acmeId, title: "Progetto Y", stage: "proposal", probability: 50,
      dailyRate: 1500, estimatedDaysPerMonth: 6, estimatedDurationMonths: 5,
      expectedStartMonth: "2027-01", vatApplicable: true,
    })

    const won = await callTool("move_opportunity", { opportunity: "Progetto Y", stage: "won" })
    expect(won.isError).toBe(false)
    const wonOpp = won.payload.opportunity as { probability: number; closedAt: string | null }
    expect(wonOpp.probability).toBe(100)
    expect(wonOpp.closedAt).not.toBeNull()
    expect(won.payload.engagementPrefill).toMatchObject({
      clientId: acmeId,
      opportunityId: opp.id,
      dailyRate: 1500,
      defaultDaysPerMonth: 6,
      contractedDays: 30, // 6 × 5
      startMonth: "2027-01",
      endMonth: "2027-05", // #154: 2027-01 + 5 − 1
      name: "Progetto Y", // the contract is named after the deal
    })
    expect(String(won.payload.summary)).toContain("Convert it to a contract")
    // An expansion of a running contract is an amendment: converting it too would count its days twice.
    expect(String(won.payload.summary)).toContain("record it with amend_contract instead and do not convert it")

    const reopened = await callTool("move_opportunity", { opportunity: opp.id, stage: "negotiation" })
    const reopenedOpp = reopened.payload.opportunity as { closedAt: string | null; probability: number }
    expect(reopenedOpp.closedAt).toBeNull()
    expect(reopenedOpp.probability).toBe(75) // re-seeded from stage
  })
})

describe("create_opportunity / create_client", () => {
  it("creates an opportunity with stage seeds and resolves the client by name", async () => {
    const { isError, payload } = await callTool("create_opportunity", {
      client: "acme", title: "Nuova iniziativa", dailyRate: 1600,
      estimatedDaysPerMonth: 5, estimatedDurationMonths: 3,
    })
    expect(isError).toBe(false)
    expect(payload.opportunity).toMatchObject({ stage: "lead", probability: 20 })
  })

  it("rejects a duplicate client name case-insensitively", async () => {
    const { isError, payload } = await callTool("create_client", { name: "ACME SPA" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("already exists")
  })

  it("creates a genuinely new client", async () => {
    const { isError, payload } = await callTool("create_client", {
      name: "Gamma Srl", vatNumber: "IT999", email: "info@gamma.it",
    })
    expect(isError).toBe(false)
    expect((payload.client as { name: string }).name).toBe("Gamma Srl")
  })
})

describe("a contract in hours", () => {
  it("create_opportunity unit hour, then convert_to_engagement, gives an hourly contract told in €/h and hours", async () => {
    await callTool("create_client", { name: "Oraria Srl" })
    const opp = await callTool("create_opportunity", {
      client: "Oraria", title: "Supporto orario", unit: "hour", dailyRate: 75,
      estimatedDaysPerMonth: 40, estimatedDurationMonths: 3,
    })
    expect(opp.isError).toBe(false)
    expect(opp.payload.opportunity).toMatchObject({ unit: "hour", hourlyRate: 75, estimatedHoursPerMonth: 40 })
    // Stored in days: €600/day, 5 days a month.
    const stored = (await admin.getOpportunities(userId)).find((o) => o.title === "Supporto orario")!
    expect(stored).toMatchObject({ unit: "hour", dailyRate: 600, estimatedDaysPerMonth: 5 })

    const won = await callTool("move_opportunity", { opportunity: "Supporto orario", stage: "won" })
    expect(won.payload.engagementPrefill).toMatchObject({ unit: "hour", dailyRate: 75, defaultDaysPerMonth: 40, contractedDays: 120 })

    const converted = await callTool("convert_to_engagement", { opportunity: "Supporto orario", startMonth: "2027-04" })
    expect(converted.isError).toBe(false)
    expect(converted.payload.engagement).toMatchObject({
      unit: "hour", hourlyRate: 75, defaultHoursPerMonth: 40, contractedHours: 120, budgetHours: 120,
    })
    expect(String(converted.payload.summary)).toContain("€75/h, 40 hours/month, budget 120 hours")
    expect(await admin.getEngagements(userId)).toContainEqual(
      expect.objectContaining({ unit: "hour", dailyRate: 600, defaultDaysPerMonth: 5, contractedDays: 15 }),
    )
  })

  it("get_client reports its rate in €/h and its budget in hours", async () => {
    const { payload } = await callTool("get_client", { client: "Oraria" })
    const [contract] = payload.engagements as Record<string, unknown>[]
    expect(contract).toMatchObject({ unit: "hour", hourlyRate: 75, rateNow: 75, contractedHours: 120, budgetHours: 120 })
    expect(contract).not.toHaveProperty("dailyRate")
    const [deal] = (await callTool("get_client", { client: "Gamma" })).payload.openOpportunities as Record<string, unknown>[]
    expect(deal ?? { unit: "day" }).toMatchObject({ unit: "day" })
  })

  it("amend_contract takes the rate and the added time in hours and answers in them", async () => {
    const { isError, payload } = await callTool("amend_contract", {
      client: "Oraria", from: "2027-06", dailyRate: 80, addDays: 40,
    })
    expect(isError).toBe(false)
    expect(String(payload.summary)).toContain("€80/h")
    expect(String(payload.summary)).toContain("+40 hours, a budget of 160 hours (120 + 40)")
    expect(payload.engagement).toMatchObject({ unit: "hour", hourlyRate: 75, budgetHours: 160 })
    expect(payload.amendment).toMatchObject({ from: "2027-06", hourlyRate: 80, addedHours: 40 })
    const stored = (await admin.getEngagements(userId)).find((e) => e.unit === "hour")!
    expect(stored.amendments).toMatchObject([{ from: "2027-06", dailyRate: 640, addedDays: 5 }])
  })

  it("update_engagement refuses a unit other than the contract's, and reads its rate in the contract's unit", async () => {
    const wrong = await callTool("update_engagement", { client: "Oraria", unit: "day", dailyRate: 600 })
    expect(wrong.isError).toBe(true)
    expect(String(wrong.payload.error)).toContain("in hours")
    const { isError, payload } = await callTool("update_engagement", { client: "Oraria", unit: "hour", dailyRate: 70 })
    expect(isError).toBe(false)
    expect(String(payload.summary)).toContain("signed rate €70/h (was €75/h)")
  })

  it("refuses more days a month than a month holds", async () => {
    const { isError, payload } = await callTool("create_opportunity", {
      client: "Oraria", title: "Troppo", unit: "day", dailyRate: 50, estimatedDaysPerMonth: 40, estimatedDurationMonths: 1,
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("A month holds at most 31 days: 40 days is more.")
  })

  it("get_plan tells an hourly contract's lines in hours", async () => {
    const { payload } = await callTool("get_plan", { months: 12 })
    const lines = (payload.months as { lines: Record<string, unknown>[] }[]).flatMap((m) => m.lines)
    const hourly = lines.find((l) => l.unit === "hour")!
    expect(hourly).toMatchObject({ plannedHours: 40, billableHours: 40, revenue: 2800 })  // 40 h at the €70/h set just above
    expect(hourly).not.toHaveProperty("plannedDays")
    expect(lines.filter((l) => l.unit !== "hour").every((l) => "plannedDays" in l)).toBe(true)
  })

  it("get_revenue names a client's amounts in hours when all its contracts are hourly", async () => {
    const now = new Date()
    const month = (n: number) => format(addMonths(now, n), "yyyy-MM")
    const { payload } = await callTool("get_revenue", { from: month(0), to: month(11), groupBy: "client" })
    const rows = payload.rows as Record<string, unknown>[]
    const oraria = rows.find((r) => r.key === "Oraria Srl")!
    expect(oraria).toMatchObject({ plannedHours: expect.any(Number), billableHours: expect.any(Number) })
    expect(oraria).not.toHaveProperty("plannedDays")
    expect(oraria).not.toHaveProperty("billableDays")
  })

  it("log_allocation counts and answers in the contract's hours: 40 stores 5 days", async () => {
    const { isError, payload } = await callTool("log_allocation", { client: "Oraria", month: "2027-05", mode: "set", days: 40 })
    expect(isError).toBe(false)
    expect(payload).toMatchObject({ unit: "hour", hours: 40, mode: "set" })
    expect(payload).not.toHaveProperty("days")
    expect(String(payload.summary)).toContain("40 hours")
    const stored = (await admin.getAllocations(userId)).find((a) => a.yearMonth === "2027-05")!
    expect(stored.days).toBe(5)
    const added = await callTool("log_allocation", { client: "Oraria", month: "2027-05", mode: "add", days: 8 })
    expect(added.payload).toMatchObject({ hours: 48 })
    expect((await admin.getAllocations(userId)).find((a) => a.yearMonth === "2027-05")!.days).toBe(6)
  })
})

describe("convert_to_engagement", () => {
  it("refuses an opportunity that is not won", async () => {
    await callTool("create_opportunity", {
      client: "Gamma", title: "Da Convertire", dailyRate: 1200,
      estimatedDaysPerMonth: 4, estimatedDurationMonths: 6,
    })
    const { isError, payload } = await callTool("convert_to_engagement", { opportunity: "Da Convertire" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("not won")
  })

  it("converts a won opportunity with prefill + overrides, back-links it, refuses a rerun", async () => {
    await callTool("move_opportunity", { opportunity: "Da Convertire", stage: "won" })

    const converted = await callTool("convert_to_engagement", {
      opportunity: "Da Convertire", dailyRate: 1300, startMonth: "2027-04", name: "  Migrazione cloud ",
    })
    expect(converted.isError).toBe(false)
    const engagement = converted.payload.engagement as Record<string, unknown>
    expect(engagement).toMatchObject({
      name: "Migrazione cloud", // trimmed
      dailyRate: 1300, // override wins
      defaultDaysPerMonth: 4, // prefilled from the opportunity
      contractedDays: 24, // 4 × 6
      startMonth: "2027-04",
      endMonth: "2027-09", // #154: the duration counts from the overriding start
      vatApplicable: true,
    })

    // The opportunity now carries the back-link, same as the UI conversion.
    const opp = (await admin.getOpportunities(userId)).find((o) => o.title === "Da Convertire")!
    expect(opp.engagementId).toBe(engagement.id)

    const again = await callTool("convert_to_engagement", { opportunity: "Da Convertire" })
    expect(again.isError).toBe(true)
    expect(String(again.payload.error)).toContain("already converted")
  })

  // Issue #163: a contract converted without a name used to be stored with name null.
  it("names the contract after the opportunity unless a name is given, capped at 120 chars", async () => {
    // Its own client: Gamma must keep a single active contract for the tests below.
    const delta = await admin.createClient(userId, { name: "Delta Srl" })
    const won = (title: string) =>
      admin.createOpportunity(userId, {
        clientId: delta.id, title, stage: "won", probability: 100,
        dailyRate: 900, estimatedDaysPerMonth: 2, estimatedDurationMonths: 3, vatApplicable: false,
      })
    const long = `Portale ${"x".repeat(142)}` // 150 chars, over the 120 a name may hold
    await won("Portale fornitori")
    await won("Portale clienti")
    await won(long)

    const unnamed = await callTool("convert_to_engagement", { opportunity: "Portale fornitori" })
    expect(unnamed.isError).toBe(false)
    expect(unnamed.payload.engagement).toMatchObject({ name: "Portale fornitori" })
    expect(String(unnamed.payload.summary)).toContain('"Portale fornitori"')

    const named = await callTool("convert_to_engagement", { opportunity: "Portale clienti", name: "Area riservata" })
    expect(named.payload.engagement).toMatchObject({ name: "Area riservata" })

    const capped = await callTool("convert_to_engagement", { opportunity: long })
    expect(capped.isError).toBe(false)
    const stored = (await admin.getEngagements(userId)).find(
      (e) => e.id === (capped.payload.engagement as { id: string }).id
    )!
    expect(stored.name).toBe(long.slice(0, 120))
  })

  // #154: a contract born with no end slides a zeroed month's days past the deal.
  it("gives the contract a term: from the expected start, else this month, for the deal's duration", async () => {
    // Its own client: Gamma must keep a single active contract for the tests below.
    const omega = await admin.createClient(userId, { name: "Omega Srl" })
    const won = (title: string) =>
      admin.createOpportunity(userId, {
        clientId: omega.id, title, stage: "won", probability: 100,
        dailyRate: 800, estimatedDaysPerMonth: 5, estimatedDurationMonths: 6, vatApplicable: true,
      })
    await won("Senza data")
    await won("Senza fine")
    await won("Fine sbagliata")
    const lastMonth = format(addMonths(new Date(), 5), "yyyy-MM")

    const unstarted = await callTool("convert_to_engagement", { opportunity: "Senza data" })
    expect(unstarted.isError).toBe(false)
    const engagement = unstarted.payload.engagement as { id: string }
    expect(engagement).toMatchObject({ startMonth: currentMonth, endMonth: lastMonth })
    expect(String(unstarted.payload.summary)).toContain(`from ${currentMonth} to ${lastMonth}`)
    const stored = (await admin.getEngagements(userId)).find((e) => e.id === engagement.id)!
    expect(stored).toMatchObject({ startMonth: currentMonth, endMonth: lastMonth })

    const open = await callTool("convert_to_engagement", { opportunity: "Senza fine", endMonth: null })
    expect(open.isError).toBe(false)
    expect(open.payload.engagement).toMatchObject({ startMonth: currentMonth, endMonth: null })

    const before = await callTool("convert_to_engagement", {
      opportunity: "Fine sbagliata", startMonth: "2027-04", endMonth: "2027-03",
    })
    expect(before.isError).toBe(true)
    expect(String(before.payload.error)).toContain("before the contract's start")
  })

  it("makes log_allocation work for the converted client", async () => {
    const logged = await callTool("log_allocation", { client: "Gamma", days: 2, month: "2027-05", mode: "set" })
    expect(logged.isError).toBe(false)
    expect(logged.payload.days).toBe(2)
    // 24 contracted − 4 (April, no row: the default) − 2. Was 22, which ignored the
    // default-filled month (#159).
    expect(logged.payload.remainingContractDays).toBe(18)
  })

  it("is blocked for read-only tokens by the scope gate", async () => {
    const res = await mcp(rpcRequest(readOnlyBearer, "convert_to_engagement", { opportunity: "x" }))
    expect(res.status).toBe(403)
  })
})

// Issue #163: nothing in the MCP could name a contract after the fact.
describe("update_engagement", () => {
  let epsilonActive = ""

  beforeAll(async () => {
    const epsilon = await admin.createClient(userId, { name: "Epsilon Srl" })
    const active = await admin.createEngagement(userId, {
      clientId: epsilon.id, dailyRate: 800, vatApplicable: true, defaultDaysPerMonth: 5,
    })
    epsilonActive = active.id
    const closed = await admin.createEngagement(userId, {
      clientId: epsilon.id, name: "Supporto 2025", dailyRate: 600, vatApplicable: true, defaultDaysPerMonth: 2,
    })
    await admin.updateEngagement(userId, closed.id, { isActive: false })
  })

  it("renames by id and by current name, reporting the label before and after", async () => {
    const byId = await callTool("update_engagement", { engagementId: epsilonActive, name: " E-commerce " })
    expect(byId.isError).toBe(false)
    expect(byId.payload.engagement).toMatchObject({
      id: epsilonActive, name: "E-commerce", label: "E-commerce", client: "Epsilon Srl", isActive: true,
    })
    expect((byId.payload.engagement as { labelBefore: string }).labelBefore).toContain("5 days/month")
    expect(String(byId.payload.summary)).toContain('renamed "E-commerce"')
    expect(byId.payload.engagement).not.toHaveProperty("notesBefore")

    const byName = await callTool("update_engagement", { engagementId: "e-commerce", name: "E-commerce B2B" })
    expect(byName.isError).toBe(false)
    expect(byName.payload.engagement).toMatchObject({ labelBefore: "E-commerce", label: "E-commerce B2B" })
    expect(byName.payload.changed).toEqual(["name"])
  })

  it("reaches a closed contract by client + name and updates its notes, returning the replaced text", async () => {
    const first = await callTool("update_engagement", { client: "Epsilon", engagementId: "Supporto", notes: "PO scaduto" })
    expect(first.payload.engagement).toMatchObject({ notes: "PO scaduto", notesBefore: null })

    const res = await callTool("update_engagement", {
      client: "Epsilon", engagementId: "Supporto", notes: "Chiuso a dicembre",
    })
    expect(res.isError).toBe(false)
    expect(res.payload.engagement).toMatchObject({
      label: "Supporto 2025", isActive: false, notes: "Chiuso a dicembre", notesBefore: "PO scaduto",
    })
    expect(String(res.payload.summary)).toContain("notes updated")

    // With a client, the name is looked up among that client's contracts only.
    const scoped = await callTool("update_engagement", { client: "Acme", engagementId: "Supporto", name: "x" })
    expect(scoped.isError).toBe(true)
    expect(String(scoped.payload.error)).toContain("No contract matches")
  })

  it("clears the name with null or an empty string; client alone picks its only contract", async () => {
    const cleared = await callTool("update_engagement", { engagementId: epsilonActive, name: null })
    expect(cleared.isError).toBe(false)
    expect(cleared.payload.engagement).toMatchObject({ name: null, labelBefore: "E-commerce B2B" })
    expect((cleared.payload.engagement as { label: string }).label).toContain("5 days/month")
    expect(String(cleared.payload.summary)).toContain("name removed")

    // Acme has one contract, and it is unnamed: the case of #163.
    const named = await callTool("update_engagement", { client: "Acme", name: "Consulenza" })
    expect(named.payload.engagement).toMatchObject({ id: engagementId, name: "Consulenza" })
    const emptied = await callTool("update_engagement", { client: "Acme", name: "" })
    expect(emptied.payload.engagement).toMatchObject({ id: engagementId, name: null })

    // Two contracts, one closed: the client alone is not enough.
    const ambiguous = await callTool("update_engagement", { client: "Epsilon", name: "x" })
    expect(ambiguous.isError).toBe(true)
    expect(String(ambiguous.payload.error)).toContain("Pass engagementId")
    expect(String(ambiguous.payload.error)).toContain("Supporto 2025")
  })

  it("refuses a call that changes nothing", async () => {
    const empty = await callTool("update_engagement", { engagementId: epsilonActive })
    expect(empty.isError).toBe(true)
    expect(String(empty.payload.error)).toContain("Nothing to change")
    // A new rate or more days reach this tool as nothing to change: route them on.
    expect(String(empty.payload.error)).toContain("a new rate from a month, more days or a renewal: amend_contract")

    const same = await callTool("update_engagement", { engagementId: "Supporto 2025", notes: "Chiuso a dicembre" })
    expect(same.isError).toBe(true)
    expect(String(same.payload.error)).toContain("already has these values")
  })

  it("lists the candidates when no contract matches", async () => {
    const { isError, payload } = await callTool("update_engagement", { engagementId: "Inesistente", name: "x" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("No contract matches")
    expect(String(payload.error)).toContain("Supporto 2025 (Epsilon Srl, id")
  })
})

// Issue #156: a contract could not be closed, and once closed could not be reached.
describe("closing and reopening a contract", () => {
  let zetaId = ""
  let thetaId = ""
  let manutenzione = ""
  let helpdesk = ""

  beforeAll(async () => {
    const zeta = await admin.createClient(userId, { name: "Zeta Srl" })
    zetaId = zeta.id
    manutenzione = (await admin.createEngagement(userId, {
      clientId: zeta.id, name: "Manutenzione Zeta", dailyRate: 700, vatApplicable: true,
      defaultDaysPerMonth: 4, startMonth: "2026-01", notes: "PO 2026",
    })).id
    const theta = await admin.createClient(userId, { name: "Theta Srl" })
    thetaId = theta.id
    helpdesk = (await admin.createEngagement(userId, {
      clientId: theta.id, name: "Help desk Theta", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 2,
    })).id
    await admin.updateEngagement(userId, helpdesk, { isActive: false, endMonth: "2026-06" })
  })

  it("closes today by default, appending the reason to the existing notes", async () => {
    const today = isoDate(new Date())
    const res = await callTool("update_engagement", {
      engagementId: "Manutenzione Zeta", active: false, reason: "progetto finito",
    })
    expect(res.isError).toBe(false)
    expect(res.payload.engagement).toMatchObject({
      id: manutenzione,
      isActive: false,
      endMonth: currentMonth,
      lastDay: today,
      notes: `PO 2026\nClosed on ${today}: progetto finito`,
      notesBefore: "PO 2026",
    })
    expect(res.payload.changed).toEqual(["notes", "isActive", "endMonth", "endDate"])
    expect(String(res.payload.summary)).toContain(`closed, ends on ${today}`)
    expect(String(res.payload.summary)).toContain(`The months up to ${currentMonth} stay in revenue`)
    expect(String(res.payload.summary)).toContain(`No hours can be logged after ${today}.`)
    const stored = (await admin.getEngagements(userId)).find((e) => e.id === manutenzione)!
    expect(stored).toMatchObject({ endMonth: currentMonth, endDate: today })

    // Closing twice is a clear refusal, not a second write.
    const again = await callTool("update_engagement", { engagementId: "Manutenzione Zeta", active: false })
    expect(again.isError).toBe(true)
    expect(String(again.payload.error)).toContain("already has these values")
    const withReason = await callTool("update_engagement", {
      engagementId: "Manutenzione Zeta", active: false, reason: "di nuovo",
    })
    expect(String(withReason.payload.error)).toContain("reason is only for closing")
  })

  it("reopens by client even when the client was archived, clearing the end", async () => {
    await admin.updateClient(userId, zetaId, { isActive: false })
    const res = await callTool("update_engagement", { client: "Zeta", active: true })
    expect(res.isError).toBe(false)
    expect(res.payload.engagement).toMatchObject({ id: manutenzione, isActive: true, endMonth: null, lastDay: null })
    expect(String(res.payload.summary)).toContain("reopened, end removed")
    const stored = (await admin.getEngagements(userId)).find((e) => e.id === manutenzione)!
    expect(stored).toMatchObject({ isActive: true, endMonth: null, endDate: null })
  })

  it("closes on an explicit end date, never one before the start", async () => {
    const early = await callTool("update_engagement", {
      engagementId: manutenzione, active: false, endMonth: "2025-12",
    })
    expect(early.isError).toBe(true)
    expect(String(early.payload.error)).toContain("End date 2025-12 is before the contract's start (2026-01)")
    const earlyDay = await callTool("update_engagement", { engagementId: manutenzione, endDate: "2025-12-31" })
    expect(String(earlyDay.payload.error)).toContain("End date 2025-12-31 is before the contract's start (2026-01)")

    // A day in endMonth would silently widen to the month's end: it points at endDate.
    // It is the SDK's input error, so the raw reply is read.
    const dayAsMonth = await mcp(rpcRequest(writeBearer, "update_engagement", {
      engagementId: manutenzione, active: false, endMonth: "2026-03-15",
    }))
    const raw = await dayAsMonth.text()
    expect(raw).toContain("for a day use endDate")
    expect((await admin.getEngagements(userId)).find((e) => e.id === manutenzione)).toMatchObject({ isActive: true })
    const both = await callTool("update_engagement", {
      engagementId: manutenzione, active: false, endMonth: "2026-03", endDate: "2026-03-15",
    })
    expect(String(both.payload.error)).toContain("Pass endDate or endMonth, not both.")

    const res = await callTool("update_engagement", { engagementId: manutenzione, active: false, endDate: "2026-03-15" })
    expect(res.isError).toBe(false)
    expect(res.payload.engagement).toMatchObject({
      isActive: false, endMonth: "2026-03", lastDay: "2026-03-15", notes: expect.stringContaining("PO 2026"),
    })
    expect(res.payload.changed).toEqual(["isActive", "endMonth", "endDate"])
    expect(String(res.payload.summary)).toContain("No hours can be logged after 2026-03-15.")
  })

  it("sets a whole month with endMonth alone: no day, the last day is the month's", async () => {
    const res = await callTool("update_engagement", { engagementId: manutenzione, endMonth: "2026-02" })
    expect(res.isError).toBe(false)
    expect(res.payload.engagement).toMatchObject({ endMonth: "2026-02", lastDay: "2026-02-28" })
    expect(res.payload.changed).toEqual(["endMonth", "endDate"])
    expect(String(res.payload.summary)).toContain("ends on 2026-02-28")
    const stored = (await admin.getEngagements(userId)).find((e) => e.id === manutenzione)!
    expect(stored).toMatchObject({ endMonth: "2026-02", endDate: null })
  })

  it("takes an invoice for a client whose contracts are all closed, and days and a task on a closed contract named explicitly", async () => {
    // An invoice bills the client: its last one lands without naming the closed contract.
    const invoice = await callTool("create_invoice", {
      client: "Theta", number: "TH-1", yearMonth: "2026-06", amount: 1000, vat: 220,
    })
    expect(invoice.isError).toBe(false)
    expect((invoice.payload.invoice as { clientId: string }).clientId).toBe(thetaId)

    const days = await callTool("log_allocation", {
      client: "Theta", engagementId: helpdesk, days: 3, month: "2026-06", mode: "set",
    })
    expect(days.isError).toBe(false)
    expect(days.payload.engagementId).toBe(helpdesk)

    const task = await callTool("add_task", { engagementId: "Help desk Theta", title: "Verbale di chiusura" })
    expect(task.isError).toBe(false)
    expect((task.payload.task as { engagementId: string }).engagementId).toBe(helpdesk)
    await admin.deleteTask(userId, (task.payload.task as { id: string }).id)
  })

  it("refuses a client alone when its only contract is closed, marking it in the list", async () => {
    const res = await callTool("log_allocation", { client: "Theta", days: 1, month: "2026-06", mode: "set" })
    expect(res.isError).toBe(true)
    expect(String(res.payload.error)).toContain("No active contract for Theta Srl")
    expect(String(res.payload.error)).toContain(`Help desk Theta (id ${helpdesk}) (closed)`)

    // A task needs no contract (#164): the client alone makes it the client's.
    const task = await callTool("add_task", { client: "Theta", title: "x" })
    expect(task.isError).toBe(false)
    expect(task.payload.task).toMatchObject({ client: "Theta Srl", engagementId: null })
    await admin.deleteTask(userId, (task.payload.task as { id: string }).id)

    const miss = await callTool("update_engagement", { engagementId: "Inesistente", active: true })
    expect(String(miss.payload.error)).toContain(`Help desk Theta (Theta Srl, id ${helpdesk}) (closed)`)
  })

  it("is blocked for read-only tokens by the scope gate", async () => {
    const res = await mcp(rpcRequest(readOnlyBearer, "update_engagement", { engagementId: helpdesk, active: true }))
    expect(res.status).toBe(403)
    expect(res.headers.get("WWW-Authenticate") ?? "").toContain('error="insufficient_scope"')
  })
})

// Review of #156: closing must not move an end already past, must not bill a contract that
// never ran, must say which stored days still bill after the end, and must not make a name
// ambiguous that picked one active contract before.
describe("closing a contract without rewriting its months", () => {
  const month = (n: number) => format(addMonths(new Date(), n), "yyyy-MM")
  const iotaRevenue = async (ym: string) => {
    const res = await callTool("get_revenue", { from: ym, to: ym, groupBy: "client" })
    return (res.payload.rows as { key: string; revenue: number }[]).find((r) => r.key === "Iota Srl")?.revenue ?? 0
  }
  let iotaId = ""
  let planned = ""
  let future = ""
  let residual = ""

  beforeAll(async () => {
    iotaId = (await admin.createClient(userId, { name: "Iota Srl" })).id
    const contract = { clientId: iotaId, dailyRate: 500, vatApplicable: true }
    planned = (await admin.createEngagement(userId, {
      ...contract, name: "Pianificato Iota", defaultDaysPerMonth: 4, startMonth: month(-8),
    })).id
    await admin.updateEngagement(userId, planned, { endMonth: month(-3) })
    future = (await admin.createEngagement(userId, {
      ...contract, name: "Futuro Iota", defaultDaysPerMonth: 4, startMonth: month(2),
    })).id
    residual = (await admin.createEngagement(userId, {
      ...contract, name: "Residuo Iota", defaultDaysPerMonth: 0,
    })).id
  })

  it("keeps a planned end already past: active true changes nothing, closing does not move it", async () => {
    const noop = await callTool("update_engagement", { engagementId: planned, active: true })
    expect(String(noop.payload.error)).toContain("already has these values")

    const res = await callTool("update_engagement", { engagementId: planned, active: false })
    expect(res.isError).toBe(false)
    expect(res.payload.engagement).toMatchObject({ isActive: false, endMonth: month(-3) })
    // The end stays in its month; closing only writes down its last day.
    expect(res.payload.changed).toEqual(["isActive", "endDate"])
    expect(String(res.payload.summary)).toContain(`The months up to ${month(-3)} stay in revenue`)
    expect(await iotaRevenue(month(-2))).toBe(0)
  })

  it("reopens with a new planned end in the same call", async () => {
    const res = await callTool("update_engagement", { engagementId: planned, active: true, endMonth: month(1) })
    expect(res.isError).toBe(false)
    expect(res.payload.engagement).toMatchObject({ isActive: true, endMonth: month(1) })
    // Back to closed at its old end, so later tests see no default days from it.
    await admin.updateEngagement(userId, planned, { isActive: false, endMonth: month(-3) })
  })

  it("closes a contract that has not started with no end month, so it bills nothing", async () => {
    expect(await iotaRevenue(month(2))).toBe(4 * 500)
    // Hours scheduled in its first month: the close names them, and refuses new ones.
    const [first, second] = [`${month(2)}-01`, `${month(2)}-02`]
    expect((await callTool("log_time", { engagementId: "Futuro Iota", hours: 8, date: first })).isError).toBe(false)

    const early = await callTool("update_engagement", { engagementId: future, active: false, endMonth: month(0) })
    expect(early.isError).toBe(true)
    expect(String(early.payload.error)).toContain("omit endDate")

    const res = await callTool("update_engagement", { engagementId: future, active: false })
    expect(res.isError).toBe(false)
    expect(res.payload.engagement).toMatchObject({ isActive: false, endMonth: null })
    expect(String(res.payload.summary)).toContain("had not started yet: it leaves the plan and takes no hours")
    expect(res.payload.hoursAfterEnd).toEqual([{ date: first, hours: 8 }])
    expect(String(res.payload.summary)).toContain(`Hours logged on the contract: 8 (${first}), and they bill`)
    expect(await iotaRevenue(month(2))).toBe(0)

    const fresh = await callTool("log_time", { engagementId: "Futuro Iota", hours: 4, date: second })
    expect(fresh.isError).toBe(true)
    expect(String(fresh.payload.error)).toContain("is closed with no end: it takes no hours")
    const removed = await callTool("log_time", { engagementId: "Futuro Iota", hours: 0, date: first })
    expect(removed.payload).toMatchObject({ change: "delete", previousHours: 8 })
  })

  it("lists the days stored after the end, which still bill, until they are zeroed", async () => {
    for (const [n, days] of [[1, 10], [2, 5], [3, 0]] as const) {
      await admin.createAllocation(userId, { engagementId: residual, yearMonth: month(n), days })
    }
    // Hours scheduled past today, and one on today: the last day keeps its own.
    const day = (n: number) => isoDate(addDays(new Date(), n))
    for (const [n, hours] of [[0, 8], [1, 4], [3, 2]] as const) {
      await admin.setTimecard(userId, { engagementId: residual, date: day(n), hours })
    }
    const res = await callTool("update_engagement", { engagementId: "Residuo Iota", active: false })
    expect(res.isError).toBe(false)
    expect(res.payload.engagement).toMatchObject({ endMonth: month(0), lastDay: day(0) })
    expect(res.payload.allocationsAfterEnd).toEqual([
      { yearMonth: month(1), days: 10 },
      { yearMonth: month(2), days: 5 },
    ])
    expect(String(res.payload.summary)).toContain("Days still planned after the last month: 15")
    expect(res.payload.hoursAfterEnd).toEqual([
      { date: day(1), hours: 4 },
      { date: day(3), hours: 2 },
    ])
    expect(String(res.payload.summary)).toContain(
      `Hours logged after the last day: 6 (${day(1)}, ${day(3)}), and they bill once their day passes: ` +
        "remove them with log_time hours 0",
    )
    for (const n of [0, 1, 3]) await admin.deleteTimecard(userId, residual, day(n))
    expect(await iotaRevenue(month(1))).toBe(10 * 500)

    // The remedy the reply names reaches the closed contract.
    for (const n of [1, 2]) {
      const zero = await callTool("log_allocation", {
        client: "Iota", engagementId: "Residuo Iota", days: 0, month: month(n), mode: "set",
      })
      expect(zero.isError).toBe(false)
    }
    expect(await iotaRevenue(month(1))).toBe(0)
  })

  it("prefers the active contract when a closed one shares its name", async () => {
    const contract = { clientId: iotaId, name: "Assistenza Iota", vatApplicable: true, defaultDaysPerMonth: 0 }
    const old = (await admin.createEngagement(userId, { ...contract, dailyRate: 400 })).id
    await admin.updateEngagement(userId, old, { isActive: false, endMonth: month(-12) })
    const renewal = (await admin.createEngagement(userId, { ...contract, dailyRate: 450 })).id

    for (const args of [{ engagementId: "Assistenza Iota" }, { client: "Iota", engagementId: "assistenza" }]) {
      const res = await callTool("add_task", { ...args, title: "Rinnovo" })
      expect(res.isError).toBe(false)
      const task = res.payload.task as { id: string; engagementId: string }
      expect(task.engagementId).toBe(renewal)
      await admin.deleteTask(userId, task.id)
    }
    // The closed one is still reachable by id.
    const byId = await callTool("add_task", { engagementId: old, title: "Archivio" })
    expect((byId.payload.task as { engagementId: string }).engagementId).toBe(old)
    await admin.deleteTask(userId, (byId.payload.task as { id: string }).id)
  })
})

// The first chat tool that changes money terms. MCP writes through the Admin SDK,
// past the rules, so amendContract and amendmentEffects are its only guard and
// every refusal is tested here, through the route.
describe("amend_contract", () => {
  const month = (n: number) => format(addMonths(new Date(), n), "yyyy-MM")
  const mon = (n: number) => format(addMonths(new Date(), n), "MMM yyyy")
  const lastDay = (n: number) => isoDate(lastDayOfMonth(addMonths(new Date(), n)))
  let pcm = ""
  let loose = ""
  const stored = async (id: string) => (await admin.getEngagements(userId)).find((e) => e.id === id)!
  const unbilled = async () =>
    ((await callTool("get_unbilled", { client: "Lumon" })).payload.clients as { toInvoice: number }[])[0].toInvoice

  beforeAll(async () => {
    const layer = await admin.createClient(userId, { name: "Lumon Ltd" })
    const contract = (name: string, o: Partial<Parameters<typeof admin.createEngagement>[1]> = {}) =>
      admin.createEngagement(userId, {
        clientId: layer.id, name, dailyRate: 700, vatApplicable: false, contractedDays: 80, defaultDaysPerMonth: 10,
        startMonth: month(-3), endMonth: month(2), ...o,
      })
    pcm = (await contract("PCM Nine")).id
    await contract("Hourly Nine", { contractedDays: null })
    loose = (await contract("Loose Nine", { dailyRate: 600, startMonth: null, endMonth: null })).id
    const packed = await contract("Packed Nine", { startMonth: month(-30) })
    await admin.updateEngagement(userId, packed.id, {
      amendments: Array.from({ length: 24 }, (_, k) => ({
        from: month(k - 30), dailyRate: 700 + k, addedDays: null, lastDay: null, lastDayBefore: null, note: null,
      })),
    })
    // Last month worked and invoiced: 8 days at €700.
    await admin.setTimecard(userId, { engagementId: pcm, date: `${month(-1)}-10`, hours: 64, notes: null })
    await admin.createInvoice(userId, { clientId: layer.id, number: "LU-1", yearMonth: month(-1), amount: 5600, vat: 0 })
  })

  it("records a rate from next month: invoiced months stay settled while the plan steps", async () => {
    const { isError, payload } = await callTool("amend_contract", { engagementId: "PCM Nine", from: month(1), dailyRate: 800 })
    expect(isError).toBe(false)
    expect(payload.amendment).toEqual({ from: month(1), dailyRate: 800, addedDays: null, lastDay: null, lastDayBefore: null, note: null })
    expect(payload.engagement).toMatchObject({ dailyRate: 700, rateNow: 700, contractedDays: 80, budgetDays: 80, client: "Lumon Ltd" })
    expect(String(payload.summary)).toContain(`from ${mon(1)} €800/day (was €700). Months before ${mon(1)} keep their terms.`)
    expect(payload).not.toHaveProperty("invoicedRepriced")
    expect((await stored(pcm)).amendments).toEqual([payload.amendment])

    expect(await unbilled()).toBe(0)
    const plan = (await callTool("get_plan", { months: 2 })).payload.months as {
      lines: { clientName: string; engagementId: string; revenue: number }[]
    }[]
    const revenue = plan.map((m) => m.lines.find((l) => l.clientName === "Lumon Ltd" && l.engagementId === pcm)?.revenue)
    expect(revenue).toEqual([7000, 8000])
  })

  it("names no run-out month while the days worked pass the budget, and names it once an amendment lifts the budget (#308)", async () => {
    const client = await admin.createClient(userId, { name: "Overrun Nine Ltd" })
    const over = await admin.createEngagement(userId, {
      clientId: client.id, name: "Overrun Nine", dailyRate: 500, vatApplicable: false, contractedDays: 10,
      defaultDaysPerMonth: 4, startMonth: month(-3),
    })
    // 2024-06 lies outside every other suite's window: 15 days (120 h) worked on a 10-day contract.
    for (let d = 1; d <= 15; d++) {
      await admin.setTimecard(userId, { engagementId: over.id, date: `2024-06-${String(d).padStart(2, "0")}`, hours: 8, notes: null })
    }
    const rate = await callTool("amend_contract", { engagementId: over.id, from: month(1), dailyRate: 550 })
    expect(rate.isError).toBe(false)
    expect((rate.payload.engagement as { exhaustionMonth: string | null }).exhaustionMonth).toBeNull()
    const days = await callTool("amend_contract", { engagementId: over.id, from: month(2), addDays: 10 })
    expect(days.isError).toBe(false)
    expect((days.payload.engagement as { exhaustionMonth: string | null }).exhaustionMonth).toMatch(/^\d{4}-\d{2}$/)
  })

  it.each<[string, string, Record<string, unknown>, string]>([
    ["nothing to amend", "PCM Nine", { from: month(1) }, "Nothing to amend"],
    ["a rate with no month", "PCM Nine", { dailyRate: 900 }, "Pass from (YYYY-MM), the first month the new rate or days apply"],
    ["endMonth 13", "PCM Nine", { endMonth: `${month(0).slice(0, 4)}-13` }, "-13\". Use YYYY-MM"],
    ["endMonth 00", "PCM Nine", { endMonth: `${month(0).slice(0, 4)}-00` }, "-00\". Use YYYY-MM"],
    ["a new end before from", "PCM Nine", { from: month(4), endMonth: month(3) }, `The new end ${lastDay(3)} is before ${mon(4)}`],
    ["the same month saying the same", "PCM Nine", { from: month(1), dailyRate: 800 }, `The ${mon(1)} amendment already says this`],
    [
      "the rate before that month's own amendment",
      "PCM Nine",
      { from: month(1), dailyRate: 700 },
      `€700/day is the rate in force before the ${mon(1)} amendment: to undo that amendment use remove`,
    ],
    ["a remove with no month", "PCM Nine", { remove: true }, "Pass from (YYYY-MM), the month of the amendment to remove"],
    ["a month before the start", "PCM Nine", { from: month(-4), dailyRate: 900 }, "is before the contract's start"],
    ["month 13", "PCM Nine", { from: `${month(0).slice(0, 4)}-13`, dailyRate: 900 }, "-13\" is not one"],
    ["month 00", "PCM Nine", { from: `${month(0).slice(0, 4)}-00`, dailyRate: 900 }, "-00\" is not one"],
    ["days on time and materials", "Hourly Nine", { from: month(0), addDays: 10 }, "a budget would cap months already past"],
    ["days with no start", "Loose Nine", { from: month(0), addDays: 10 }, "Set the contract's Start first, in the web app's Edit Contract"],
    ["the rate already in force", "PCM Nine", { from: month(0), dailyRate: 700 }, "already €700/day"],
    ["no end to extend", "Loose Nine", { endMonth: month(6) }, "no end to extend"],
    ["the same end", "PCM Nine", { endMonth: month(2) }, "is not later than the current one"],
    ["a gap after the end", "PCM Nine", { from: month(5), endMonth: month(8) }, `Start the renewal from ${month(3)}`],
    ["a month after the end", "PCM Nine", { from: month(3), dailyRate: 900 }, "would never apply"],
    ["a remove with nothing that month", "PCM Nine", { from: month(2), remove: true }, `No amendment from ${mon(2)} to remove`],
    ["a remove with a term", "PCM Nine", { from: month(1), remove: true, dailyRate: 900 }, "remove takes only from"],
    ["both end fields", "PCM Nine", { endDate: lastDay(6), endMonth: month(6) }, "Pass endDate or endMonth, not both"],
    ["a 25th amendment", "Packed Nine", { from: month(0), dailyRate: 900 }, "at most 24 amendments"],
  ])("refuses %s", async (_, engagementId, args, message) => {
    const { isError, payload } = await callTool("amend_contract", { engagementId, ...args })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain(message)
  })

  it("left the contract as it was after every refusal", async () => {
    expect((await stored(pcm)).amendments).toHaveLength(1)
    expect((await stored(pcm)).endMonth).toBe(month(2))
  })

  it("refuses a rate or days over the caps at the schema, update_engagement's rate too", async () => {
    for (const [tool, args] of [
      ["amend_contract", { from: month(0), dailyRate: 100_001 }],
      ["update_engagement", { dailyRate: 100_001 }],
    ] as const) {
      const res = await mcp(rpcRequest(writeBearer, tool, { engagementId: "Loose Nine", ...args }))
      const rpc = JSON.parse((await res.text()).split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as {
        result: { isError: boolean; content: [{ text: string }] }
      }
      expect(rpc.result.isError).toBe(true)
      expect(rpc.result.content[0].text).toContain("Input validation error")
    }
    // The days cap is checked after the unit is applied, so 1001 hours is fine and 1001 days is not.
    const over = await callTool("amend_contract", { engagementId: "Loose Nine", from: month(0), addDays: 1001 })
    expect(over.isError).toBe(true)
    expect(String(over.payload.error)).toContain("at most 1000")
  })

  it("asks before repricing an invoiced month, and saves once told the customer agreed", async () => {
    const args = { engagementId: "PCM Nine", from: month(-1), dailyRate: 800 }
    const refused = await callTool("amend_contract", args)
    expect(refused.isError).toBe(true)
    expect(String(refused.payload.error)).toContain(
      `${mon(-1)} is invoiced at €5,600; this contract's 8 days there at €800/day instead of €700: €800 more to invoice (a top-up).`,
    )
    expect(String(refused.payload.error)).toContain(`ask the owner first, and pass repriceInvoiced true only if the customer agreed, or start from ${month(0)}.`)
    expect((await stored(pcm)).amendments).toHaveLength(1)

    const saved = await callTool("amend_contract", { ...args, repriceInvoiced: true })
    expect(saved.isError).toBe(false)
    expect(saved.payload).toMatchObject({
      invoicedRepriced: [{ yearMonth: month(-1), invoiced: 5600, delta: 800 }],
      toInvoiceDelta: 800,
    })
    expect(String(saved.payload.summary)).toContain("€800 more to invoice (a top-up)")
    expect(saved.payload.engagement).toMatchObject({ dailyRate: 700, rateNow: 800 })
    expect(await unbilled()).toBe(800)
  })

  it("asks again before removing it, and the month reads settled after", async () => {
    const args = { engagementId: "PCM Nine", from: month(-1), remove: true }
    const refused = await callTool("amend_contract", args)
    expect(refused.isError).toBe(true)
    expect(String(refused.payload.error)).toContain("at €700/day instead of €800: €800 less to invoice: it is settled.")
    expect(String(refused.payload.error)).not.toContain("start from")

    const removed = await callTool("amend_contract", { ...args, repriceInvoiced: true })
    expect(removed.isError).toBe(false)
    expect(removed.payload.amendment).toBeNull()
    expect(removed.payload.amendmentBefore).toMatchObject({ from: month(-1), dailyRate: 800 })
    expect(String(removed.payload.summary)).toContain(`removed the ${mon(-1)} amendment (€800/day)`)
    expect(await unbilled()).toBe(0)
  })

  it("asks before repricing a month invoiced ahead, with no hours logged yet", async () => {
    const ahead = await admin.createClient(userId, { name: "Ahead Ten" })
    const contract = await admin.createEngagement(userId, {
      clientId: ahead.id, name: "Ahead Ten", dailyRate: 1000, vatApplicable: false, contractedDays: null, defaultDaysPerMonth: 8,
      startMonth: month(-1), endMonth: month(3),
    })
    await admin.createInvoice(userId, { clientId: ahead.id, number: "A10-1", yearMonth: month(1), amount: 8000, vat: 0 })
    const refused = await callTool("amend_contract", { engagementId: "Ahead Ten", from: month(1), dailyRate: 1050 })
    expect(refused.isError).toBe(true)
    expect(String(refused.payload.error)).toContain(
      `${mon(1)} is invoiced ahead at €8,000, with no hours on this contract yet: at €1,050/day instead of €1,000 ` +
        "its 8 days planned come to €400 more, a top-up once worked.",
    )
    expect(String(refused.payload.error)).toContain(`or start from ${month(2)}.`)
    expect((await stored(contract.id)).amendments ?? []).toEqual([])
  })

  it("names the past months a late renewal now plans by default", async () => {
    const late = await admin.createClient(userId, { name: "Late Eleven" })
    const contract = await admin.createEngagement(userId, {
      clientId: late.id, name: "Late Eleven", dailyRate: 1000, vatApplicable: false, contractedDays: null, defaultDaysPerMonth: 8,
      startMonth: month(-6), endMonth: month(-4),
    })
    await admin.updateEngagement(userId, contract.id, { isActive: false })
    const { isError, payload } = await callTool("amend_contract", { engagementId: "Late Eleven", endMonth: month(2) })
    expect(isError).toBe(false)
    expect(payload.pastMonthsPlanned).toEqual([-3, -2, -1].map((n) => ({ yearMonth: month(n), days: 8, value: 8000 })))
    expect(String(payload.summary)).toContain(
      `${mon(-3)}–${mon(-1)} are past and now plan 24 days by default (€24,000) in the Plan: ` +
        "if no work happened there, set them to 0 in the Plan, or make the renewal a new contract.",
    )
    expect(payload.engagement).toMatchObject({ isActive: true, lastDay: lastDay(2) })
  })

  it("renews with days in one write: the list and the end together, from the month after the end", async () => {
    // "Renewed at the same rate": the €800 in force is re-sent, and is no rate change.
    const { isError, payload } = await callTool("amend_contract", {
      engagementId: "PCM Nine", endMonth: month(8), addDays: 60, dailyRate: 800, note: "Renewal",
    })
    expect(isError).toBe(false)
    expect(payload.amendment).toEqual({
      from: month(3), dailyRate: null, addedDays: 60, lastDay: lastDay(8), lastDayBefore: lastDay(2), note: "Renewal",
    })
    expect(payload.engagement).toMatchObject({ lastDay: lastDay(8), contractedDays: 80, budgetDays: 140 })
    expect(payload.endBefore).toBe(lastDay(2))
    // 12 months of 10 days from the start: 20 of the 140 are never planned.
    expect(payload.daysLeftAtEnd).toBe(20)
    expect(String(payload.summary)).toContain("+60 days, a budget of 140 days (80 + 60)")

    const e = await stored(pcm)
    expect(e).toMatchObject({ endMonth: month(8), endDate: lastDay(8) })
    expect(e.amendments?.map((a) => a.from)).toEqual([month(1), month(3)])
  })

  it("merges a second call for the same month, replacing the days", async () => {
    const { payload } = await callTool("amend_contract", { engagementId: "PCM Nine", from: month(3), addDays: 30 })
    expect(payload.amendmentBefore).toMatchObject({ addedDays: 60 })
    expect(payload.amendment).toMatchObject({ addedDays: 30, lastDay: lastDay(8), note: "Renewal" })
    expect(payload.engagement).toMatchObject({ budgetDays: 110 })
    expect(String(payload.summary)).toContain(
      `The ${mon(3)} amendment now reads +30 days, until ${lastDay(8)}, "Renewal" (was +60 days, until ${lastDay(8)}, "Renewal").`,
    )
    expect((await stored(pcm)).amendments).toHaveLength(2)
  })

  it("refuses to remove the renewal while a later amendment needs its end", async () => {
    const later = await callTool("amend_contract", { engagementId: "PCM Nine", from: month(5), dailyRate: 900 })
    expect(later.isError).toBe(false)
    const refused = await callTool("amend_contract", { engagementId: "PCM Nine", from: month(3), remove: true })
    expect(refused.isError).toBe(true)
    expect(String(refused.payload.error)).toBe(
      `Removing it puts the end back to ${lastDay(2)}, and the ${mon(5)} amendment would then never apply: remove it first.`,
    )
    expect(await stored(pcm)).toMatchObject({ endMonth: month(8) })
    expect((await callTool("amend_contract", { engagementId: "PCM Nine", from: month(5), remove: true })).isError).toBe(false)
  })

  it("removes the renewal and puts the end back, naming the hours now past it", async () => {
    await admin.setTimecard(userId, { engagementId: pcm, date: `${month(4)}-03`, hours: 8, notes: null })
    const { isError, payload } = await callTool("amend_contract", { engagementId: "PCM Nine", from: month(3), remove: true })
    expect(isError).toBe(false)
    expect(payload.engagement).toMatchObject({ lastDay: lastDay(2), budgetDays: 80 })
    expect(payload.endBefore).toBe(lastDay(8))
    expect(String(payload.summary)).toContain(`The end is back to ${lastDay(2)}. Hours logged after the last day: 8 (${month(4)}-03)`)
    expect(payload.hoursAfterEnd).toEqual([{ date: `${month(4)}-03`, hours: 8 }])
    expect(await stored(pcm)).toMatchObject({ endMonth: month(2), endDate: lastDay(2) })
  })

  it("is refused to a read-only token", async () => {
    const res = await mcp(rpcRequest(readOnlyBearer, "amend_contract", { engagementId: "PCM Nine", from: month(1), dailyRate: 820 }))
    expect(res.status).toBe(403)
  })

  it("leaves an audit entry for every attempt", async () => {
    await expect
      .poll(async () => {
        const entries = await auditEntries()
        return ["ok", "error"].every((result) => entries.some((e) => e.tool === "amend_contract" && e.result === result))
      })
      .toBe(true)
  })

  it("update_engagement locks the signed rate once hours exist, and fixes a typo before them", async () => {
    const locked = await callTool("update_engagement", { engagementId: "PCM Nine", dailyRate: 780 })
    expect(locked.isError).toBe(true)
    expect(String(locked.payload.error)).toContain("has hours logged, so its signed rate (€700/day) is locked")
    expect(String(locked.payload.error)).toContain("amend_contract from a month on, so invoiced months keep their price")
    expect((await stored(pcm)).dailyRate).toBe(700)

    const typo = await callTool("update_engagement", { engagementId: "Loose Nine", dailyRate: 650 })
    expect(typo.isError).toBe(false)
    expect(typo.payload.engagement).toMatchObject({ dailyRate: 650 })
    expect(typo.payload.changed).toEqual(["dailyRate"])
    expect(String(typo.payload.summary)).toContain("signed rate €650/day (was €600)")
    expect((await stored(loose)).dailyRate).toBe(650)
  })

  it("update_engagement refuses an end or a close before an amendment, as Edit does, and allows one on or after it", async () => {
    const layer = (await admin.getClients(userId)).find((c) => c.name === "Lumon Ltd")!
    const { id } = await admin.createEngagement(userId, {
      clientId: layer.id, name: "Guard Nine", dailyRate: 700, vatApplicable: false, contractedDays: 80,
      defaultDaysPerMonth: 10, startMonth: month(-3), endMonth: month(4),
    })
    await admin.updateEngagement(userId, id, {
      amendments: [{ from: month(2), dailyRate: 800, addedDays: null, lastDay: null, lastDayBefore: null, note: null }],
    })
    const refusal =
      `The end moves before the ${mon(2)} amendment: it would never apply. ` +
      `Remove it first: amend_contract remove with from ${month(2)}.`
    for (const input of [{ endMonth: month(1) }, { endDate: `${month(1)}-15` }, { active: false }]) {
      const res = await callTool("update_engagement", { engagementId: "Guard Nine", ...input })
      expect(res.isError).toBe(true)
      expect(String(res.payload.error)).toBe(refusal)
    }
    expect(await stored(id)).toMatchObject({ isActive: true, endMonth: month(4) })

    const onIt = await callTool("update_engagement", { engagementId: "Guard Nine", endMonth: month(2) })
    expect(onIt.isError).toBe(false)
    expect(await stored(id)).toMatchObject({ endMonth: month(2), endDate: null })

    // The fix the refusal names, then the close goes through.
    expect((await callTool("amend_contract", { engagementId: "Guard Nine", from: month(2), remove: true })).isError).toBe(false)
    const closed = await callTool("update_engagement", { engagementId: "Guard Nine", active: false })
    expect(closed.isError).toBe(false)
    expect(await stored(id)).toMatchObject({ isActive: false, endMonth: month(0), endDate: isoDate(new Date()) })
  })
})

describe("add_note", () => {
  it("appends dated lines to a client's notes", async () => {
    const first = await callTool("add_note", { entity: "client", ref: "Gamma", text: "vuole fattura a 60gg" })
    expect(first.isError).toBe(false)
    expect(String(first.payload.notes)).toMatch(/^\[\d{4}-\d{2}-\d{2}\] vuole fattura a 60gg$/)

    const second = await callTool("add_note", { entity: "client", ref: "Gamma", text: "referente: Anna" })
    expect(String(second.payload.notes).split("\n")).toHaveLength(2)
    expect(String(second.payload.notes)).toContain("referente: Anna")
  })

  it("appends to an opportunity and errors past the 1000-char cap", async () => {
    const long = "x".repeat(500)
    const first = await callTool("add_note", { entity: "opportunity", ref: "Da Convertire", text: long })
    expect(first.isError).toBe(false)

    const overflow = await callTool("add_note", { entity: "opportunity", ref: "Da Convertire", text: long })
    expect(overflow.isError).toBe(true)
    expect(String(overflow.payload.error)).toContain("1000 characters")
  })
})

describe("task tools", () => {
  it("add_task with a client alone makes a client-level task; list_tasks sorts and flags overdue", async () => {
    const overdue = await callTool("add_task", {
      client: "Acme", title: "Report agosto", dueDate: "2026-01-10",
    })
    expect(overdue.isError).toBe(false)
    expect(String(overdue.payload.summary)).toBe(
      'Task "Report agosto" for client Acme Spa, due 2026-01-10.'
    )
    // Acme has contracts, yet none is picked for it (#164).
    expect(overdue.payload.task).toMatchObject({
      clientId: acmeId, client: "Acme Spa", engagementId: null, engagementLabel: null,
    })

    const undated = await callTool("add_task", { client: "Acme", title: "Fattura Q3" })
    expect(undated.isError).toBe(false)

    const list = await callTool("list_tasks", {})
    expect(list.isError).toBe(false)
    const rows = list.payload.tasks as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    // Due-dated first, and the past date is flagged.
    expect(rows[0]).toMatchObject({
      title: "Report agosto", overdue: true, clientId: acmeId, client: "Acme Spa", engagementId: null,
      engagementLabel: null,
    })
    expect(rows[1]).toMatchObject({ title: "Fattura Q3", dueDate: null, overdue: false })
    expect(String(list.payload.summary)).toContain("1 overdue")

    const filtered = await callTool("list_tasks", { client: "Gamma" })
    expect((filtered.payload.tasks as unknown[])).toHaveLength(0)
  })

  it("add_task gives a client with no contract at all a task of its own", async () => {
    const { isError, payload } = await callTool("add_task", { client: "SenzaContratto", title: "Prima chiamata" })
    expect(isError).toBe(false)
    expect(String(payload.summary)).toBe('Task "Prima chiamata" for client SenzaContratto.')
    const id = (payload.task as { id: string }).id

    const list = await callTool("list_tasks", { client: "SenzaContratto" })
    expect(list.payload.tasks).toEqual([
      expect.objectContaining({ id, client: "SenzaContratto", engagementId: null, engagementLabel: null }),
    ])
    expect(list.payload.engagements).toEqual([])
    await admin.deleteTask(userId, id)
  })

  it("complete_task matches open tasks by substring and hides them from the default list", async () => {
    const done = await callTool("complete_task", { task: "report" })
    expect(done.isError).toBe(false)
    expect(String(done.payload.summary)).toContain('" done.')

    const open = await callTool("list_tasks", {})
    expect((open.payload.tasks as Array<{ title: string }>).map((t) => t.title)).toEqual(["Fattura Q3"])

    const all = await callTool("list_tasks", { includeDone: true })
    expect(all.payload.tasks as unknown[]).toHaveLength(2)

    // Completed tasks leave the search pool: a rerun is a clean error, not a rewrite.
    const again = await callTool("complete_task", { task: "report" })
    expect(again.isError).toBe(true)
    expect(String(again.payload.error)).toContain("No task matches")
  })

  it("update_task retitles and reschedules an open task", async () => {
    const res = await callTool("update_task", {
      task: "Fattura", title: "Fattura Q3 rivista", dueDate: "2026-12-01",
    })
    expect(res.isError).toBe(false)
    expect(String(res.payload.summary)).toContain("due 2026-12-01")

    const list = await callTool("list_tasks", {})
    expect(list.payload.tasks as Array<{ title: string }>).toMatchObject([
      { title: "Fattura Q3 rivista", dueDate: "2026-12-01" },
    ])
  })

  it("update_task clears a due date with null", async () => {
    const res = await callTool("update_task", { task: "Fattura Q3 rivista", dueDate: null })
    expect(res.isError).toBe(false)
    expect(String(res.payload.summary)).toContain("due date removed")
    expect(res.payload.task).toMatchObject({ dueDate: null })
  })

  it("update_task reopens a completed task, which complete_task cannot find", async () => {
    // complete_task only searches open tasks, so reopening must search all of them.
    const res = await callTool("update_task", { task: "Report agosto", reopen: true })
    expect(res.isError).toBe(false)
    expect(String(res.payload.summary)).toContain("reopened")

    const open = await callTool("list_tasks", {})
    expect((open.payload.tasks as Array<{ title: string }>).map((t) => t.title).sort()).toEqual([
      "Fattura Q3 rivista", "Report agosto",
    ])
  })

  it("update_task with no fields is refused instead of writing an empty update", async () => {
    const { isError, payload } = await callTool("update_task", { task: "Report agosto" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("Nothing to change")
  })

  it("update_task status moves a task doing → todo → done; reopen and status 'done' conflict", async () => {
    const doing = await callTool("update_task", { task: "Fattura Q3 rivista", status: "doing" })
    expect(doing.isError).toBe(false)
    expect(String(doing.payload.summary)).toContain('status "doing"')
    expect(doing.payload.task).toMatchObject({ isDone: false, status: "doing" })

    const list = await callTool("list_tasks", {})
    const row = (list.payload.tasks as Array<Record<string, unknown>>).find(
      (t) => t.title === "Fattura Q3 rivista"
    )
    expect(row).toMatchObject({ isDone: false, status: "doing" })

    const back = await callTool("update_task", { task: "Fattura Q3 rivista", status: "todo" })
    expect(back.payload.task).toMatchObject({ isDone: false, status: "todo" })

    const done = await callTool("update_task", { task: "Fattura Q3 rivista", status: "done" })
    expect(String(done.payload.summary)).toContain('status "done"')
    expect(done.payload.task).toMatchObject({ isDone: true, status: "done" })
    const closed = await callTool("list_tasks", { status: "done" })
    expect((closed.payload.tasks as Array<{ title: string }>).map((t) => t.title)).toContain("Fattura Q3 rivista")

    const clash = await callTool("update_task", { task: "Fattura Q3 rivista", reopen: true, status: "done" })
    expect(clash.isError).toBe(true)
    expect(String(clash.payload.error)).toContain("contradict each other")
  })

  it("delete_task removes the task for good", async () => {
    const res = await callTool("delete_task", { task: "Report agosto" })
    expect(res.isError).toBe(false)
    expect(String(res.payload.summary)).toContain("deleted")

    const all = await callTool("list_tasks", { includeDone: true })
    expect((all.payload.tasks as Array<{ title: string }>).map((t) => t.title)).toEqual([
      "Fattura Q3 rivista",
    ])

    const again = await callTool("delete_task", { task: "Report agosto" })
    expect(again.isError).toBe(true)
    expect(String(again.payload.error)).toContain("No task matches")
  })

  it("add_task finds the contract by name, across clients or within the one given", async () => {
    // Gamma's contract was named "Migrazione cloud" by convert_to_engagement above.
    const res = await callTool("add_task", { engagementId: "migrazione cloud", title: "Piano di migrazione" })
    expect(res.isError).toBe(false)
    expect(String(res.payload.summary)).toContain("for Gamma Srl, contract Migrazione cloud")
    const gamma = (await admin.getEngagements(userId)).find((e) => e.name === "Migrazione cloud")!
    expect(res.payload.task).toMatchObject({
      clientId: gamma.clientId, client: "Gamma Srl", engagementId: gamma.id, engagementLabel: "Migrazione cloud",
    })
    // Stored with the contract's client, so it stays Gamma's if the contract goes.
    const stored = (await admin.getTasks(userId)).find((t) => t.id === (res.payload.task as { id: string }).id)
    expect(stored).toMatchObject({ clientId: gamma.clientId, engagementId: gamma.id })

    // With a client, the name is looked up among that client's contracts only.
    const scoped = await callTool("add_task", { client: "Acme", engagementId: "Migrazione", title: "x" })
    expect(scoped.isError).toBe(true)
    expect(String(scoped.payload.error)).toContain("No contract matches")

    const neither = await callTool("add_task", { title: "Senza contratto" })
    expect(neither.isError).toBe(true)
    expect(String(neither.payload.error)).toContain("Pass client or engagementId")

    await admin.deleteTask(userId, (res.payload.task as { id: string }).id)
  })

  it("write gate blocks add_task for read-only tokens, list_tasks stays readable", async () => {
    const res = await mcp(rpcRequest(readOnlyBearer, "add_task", { client: "x", title: "y" }))
    expect(res.status).toBe(403)
    for (const tool of ["complete_task", "update_task", "delete_task", "update_engagement", "log_time", "log_meeting", "update_meeting"]) {
      const blocked = await mcp(rpcRequest(readOnlyBearer, tool, { task: "x" }))
      expect(blocked.status).toBe(403)
    }
    const list = await callTool("list_tasks", {}, readOnlyBearer)
    expect(list.isError).toBe(false)
  })
})

// #164: a task belongs to a client, and optionally to one of its contracts.
describe("client-level tasks", () => {
  let kappaId = ""
  let lambdaId = ""
  let progetto = ""
  let supporto = ""
  let altrui = ""
  const titles = (payload: Record<string, unknown>) =>
    (payload.tasks as { title: string }[]).map((t) => t.title).sort()
  const stored = async (id: string) => (await admin.getTasks(userId)).find((t) => t.id === id)

  beforeAll(async () => {
    kappaId = (await admin.createClient(userId, { name: "Kappa Srl" })).id
    lambdaId = (await admin.createClient(userId, { name: "Lambda Srl" })).id
    const contract = { clientId: kappaId, dailyRate: 600, vatApplicable: true, defaultDaysPerMonth: 2 }
    progetto = (await admin.createEngagement(userId, { ...contract, name: "Progetto Kappa" })).id
    supporto = (await admin.createEngagement(userId, { ...contract, name: "Supporto Kappa" })).id
    await admin.updateEngagement(userId, supporto, { isActive: false, endMonth: "2026-06" })
    altrui = (await admin.createEngagement(userId, { ...contract, clientId: lambdaId, name: "Progetto Lambda" })).id
  })

  it("add_task: client + contract name lands on that client's contract, closed ones reachable", async () => {
    const onContract = await callTool("add_task", { client: "Kappa", engagementId: "progetto", title: "Kappa sul progetto" })
    expect(onContract.isError).toBe(false)
    expect(String(onContract.payload.summary)).toContain("for Kappa Srl, contract Progetto Kappa")
    expect(onContract.payload.task).toMatchObject({ clientId: kappaId, engagementId: progetto })

    const onClosed = await callTool("add_task", { client: "Kappa", engagementId: "Supporto Kappa", title: "Kappa chiuso" })
    expect(onClosed.payload.task).toMatchObject({ clientId: kappaId, engagementId: supporto })

    await callTool("add_task", { client: "Kappa", title: "Kappa cliente" })
  })

  it("list_tasks: the client filter includes client-level tasks, the contract filter excludes them", async () => {
    const byClient = await callTool("list_tasks", { client: "Kappa" })
    expect(titles(byClient.payload)).toEqual(["Kappa chiuso", "Kappa cliente", "Kappa sul progetto"])
    const clientLevel = (byClient.payload.tasks as Array<Record<string, unknown>>).find((t) => t.title === "Kappa cliente")
    expect(clientLevel).toMatchObject({ clientId: kappaId, client: "Kappa Srl", engagementId: null, engagementLabel: null })
    // Only the contracts rows point at: a client-level row adds none.
    expect((byClient.payload.engagements as { id: string }[]).map((e) => e.id).sort()).toEqual([progetto, supporto].sort())

    const byContract = await callTool("list_tasks", { client: "Kappa", engagementId: "Progetto Kappa" })
    expect(titles(byContract.payload)).toEqual(["Kappa sul progetto"])
  })

  it("update_task attaches by contract name among the task's client's contracts, and detaches with null", async () => {
    const attach = await callTool("update_task", { task: "Kappa cliente", engagementId: "progetto kappa" })
    expect(attach.isError).toBe(false)
    expect(String(attach.payload.summary)).toBe('"Kappa cliente" updated: linked to contract Progetto Kappa.')
    expect(attach.payload.task).toMatchObject({ clientId: kappaId, engagementId: progetto })

    // Another client's contract is out of reach, even by an exact name.
    const foreign = await callTool("update_task", { task: "Kappa cliente", engagementId: "Progetto Lambda" })
    expect(foreign.isError).toBe(true)
    expect(String(foreign.payload.error)).toContain("No contract matches")
    expect(await stored((attach.payload.task as { id: string }).id)).toMatchObject({ engagementId: progetto })

    const detach = await callTool("update_task", { task: "Kappa cliente", engagementId: null, title: "Kappa di nuovo cliente" })
    expect(detach.isError).toBe(false)
    expect(String(detach.payload.summary)).toBe(
      '"Kappa di nuovo cliente" updated: title "Kappa di nuovo cliente", unlinked from the contract, now on client Kappa Srl.'
    )
    expect(await stored((detach.payload.task as { id: string }).id)).toMatchObject({
      clientId: kappaId, engagementId: null,
    })
  })

  it("update_task detaches a task written before #164, giving it its contract's client", async () => {
    const legacy = await getAdminFirestore().collection("users").doc(userId).collection("tasks").add({
      userId, engagementId: altrui, title: "Lambda vecchia", dueDate: null, notes: null,
      isDone: false, createdAt: new Date(), updatedAt: new Date(),
    })
    const byClient = await callTool("list_tasks", { client: "Lambda" })
    expect(byClient.payload.tasks).toEqual([
      expect.objectContaining({ id: legacy.id, clientId: lambdaId, client: "Lambda Srl", engagementId: altrui }),
    ])

    const detach = await callTool("update_task", { task: "Lambda vecchia", engagementId: null })
    expect(detach.isError).toBe(false)
    expect(await stored(legacy.id)).toMatchObject({ clientId: lambdaId, engagementId: null })
  })

  it("update_task counts engagementId as a change, and names it when there is none", async () => {
    const none = await callTool("update_task", { task: "Lambda vecchia" })
    expect(none.isError).toBe(true)
    expect(String(none.payload.error)).toContain("reopen, status, engagementId or labels")
  })
})

describe("task labels", () => {
  let id = ""
  const storedLabels = async () => (await admin.getTasks(userId)).find((t) => t.id === id)?.labels

  it("add_task stores labels normalized and names them in the summary", async () => {
    const res = await callTool("add_task", {
      client: "Kappa", title: "Preventivo etichettato", labels: ["  Urgente ", "urgente", "fattura   Q3", " "],
    })
    expect(res.isError).toBe(false)
    expect(String(res.payload.summary)).toBe(
      'Task "Preventivo etichettato" for client Kappa Srl, labels "Urgente", "fattura Q3".'
    )
    expect(res.payload.task).toMatchObject({ labels: ["Urgente", "fattura Q3"] })
    id = (res.payload.task as { id: string }).id
    expect(await storedLabels()).toEqual(["Urgente", "fattura Q3"])
  })

  it("update_task leaves labels alone unless given, then replaces the whole set", async () => {
    const retitled = await callTool("update_task", { task: "Preventivo etichettato", dueDate: "2026-12-01" })
    expect(retitled.payload.task).toMatchObject({ labels: ["Urgente", "fattura Q3"] })

    // Labels alone are a change; "Urgente" is dropped because the list replaces it.
    const replaced = await callTool("update_task", { task: "Preventivo etichettato", labels: ["fattura q3", "Cliente  VIP"] })
    expect(replaced.isError).toBe(false)
    expect(String(replaced.payload.summary)).toBe(
      '"Preventivo etichettato" updated: labels "fattura q3", "Cliente VIP".'
    )
    expect(await storedLabels()).toEqual(["fattura q3", "Cliente VIP"])

    const listed = await callTool("list_tasks", { label: "cliente vip" })
    expect(listed.payload.tasks).toEqual([
      expect.objectContaining({ id, labels: ["fattura q3", "Cliente VIP"] }),
    ])
  })

  it("update_task with an empty list removes every label", async () => {
    const cleared = await callTool("update_task", { task: "Preventivo etichettato", labels: [] })
    expect(String(cleared.payload.summary)).toBe('"Preventivo etichettato" updated: labels removed.')
    expect(await storedLabels()).toEqual([])
    const listed = await callTool("list_tasks", { label: "fattura q3" })
    expect(listed.payload.tasks).toEqual([])
  })
})

// ─── Invoices ────────────────────────────────────────────────────────────────

describe("create_invoice", () => {
  it("records an invoice on the client, naming no contract", async () => {
    const { isError, payload } = await callTool("create_invoice", {
      client: "Acme",
      number: "2026/14",
      yearMonth: currentMonth,
      amount: 5000,
      vat: 1100,
      dueDate: `${currentMonth}-28`,
    })
    expect(isError).toBe(false)
    const invoice = payload.invoice as Record<string, unknown>
    expect(invoice.number).toBe("2026/14")
    expect(invoice.clientId).toBe(acmeId)
    expect(invoice).not.toHaveProperty("engagementId")
    expect(invoice.total).toBe(6100)
    expect(invoice.paidDate).toBeNull()

    const stored = (await admin.getInvoices(userId)).find((i) => i.number === "2026/14")!
    expect(stored).toMatchObject({ clientId: acmeId, engagementId: null })
    const raw = await getAdminFirestore().collection("users").doc(userId).collection("invoices").doc(stored.id).get()
    expect(raw.data()).not.toHaveProperty("engagementId")
  })

  it("ignores a stale engagementId: the client alone is the customer", async () => {
    const { isError, payload } = await callTool("create_invoice", {
      client: "Acme", number: "2026/13", yearMonth: currentMonth, amount: 100, vat: 22, engagementId: "nope",
    })
    expect(isError).toBe(false)
    expect((payload.invoice as Record<string, unknown>).clientId).toBe(acmeId)
    await getAdminFirestore()
      .collection("users").doc(userId).collection("invoices")
      .doc((payload.invoice as { id: string }).id).delete()
  })

  it("refuses a duplicate number — the commercialista owns numbering", async () => {
    const { isError, payload } = await callTool("create_invoice", {
      client: "Acme",
      number: "2026/14",
      yearMonth: currentMonth,
      amount: 100,
      vat: 22,
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toMatch(/an invoice numbered "2026\/14" already exists/i)
  })

  // lib/invoices' invoiceNumberTaken, the rule the invoice sheet checks as you type.
  it("refuses a duplicate whatever its spacing and case, even one stored untrimmed", async () => {
    const stored = await admin.createInvoice(userId, {
      clientId: acmeId, number: "NC 18/2026 ", yearMonth: currentMonth, amount: -100, vat: -22,
    })
    try {
      for (const number of ["NC 18/2026", " nc 18/2026 "]) {
        const { isError, payload } = await callTool("create_invoice", {
          client: "Acme", number, yearMonth: currentMonth, amount: -100, vat: -22,
        })
        expect(isError, number).toBe(true)
        expect(String(payload.error)).toContain('An invoice numbered "NC 18/2026 " already exists.')
      }
      const renumber = await callTool("update_invoice", { invoice: "2026/14", number: "nc 18/2026" })
      expect(renumber.isError).toBe(true)
      expect(String(renumber.payload.error)).toContain("already exists")
      expect((await admin.getInvoices(userId)).filter((i) => /18\/2026/.test(i.number))).toHaveLength(1)
    } finally {
      await getAdminFirestore().collection("users").doc(userId).collection("invoices").doc(stored.id).delete()
    }
  })

  // Reverse charge and esente really do charge zero, so VAT is stored as given
  // rather than derived from the contract's 22% flag.
  it("stores zero VAT as zero", async () => {
    const { payload } = await callTool("create_invoice", {
      client: "Acme",
      number: "2026/15",
      yearMonth: currentMonth,
      amount: 2000,
      vat: 0,
    })
    expect((payload.invoice as Record<string, unknown>).total).toBe(2000)
  })

  it("accepts a negative amount — a nota di credito is not an error", async () => {
    const { isError, payload } = await callTool("create_invoice", {
      client: "Acme",
      number: "2026/16-NC",
      yearMonth: currentMonth,
      amount: -500,
      vat: -110,
    })
    expect(isError).toBe(false)
    expect((payload.invoice as Record<string, unknown>).total).toBe(-610)
  })

  it("records an invoice covering several months, and a one-month period as a single month", async () => {
    const invoices = getAdminFirestore().collection("users").doc(userId).collection("invoices")
    const period = await callTool("create_invoice", {
      client: "Acme", number: "P-1", fromMonth: "2026-04", yearMonth: "2026-06-30", amount: 3000, vat: 660,
    })
    expect(period.isError).toBe(false)
    expect(String(period.payload.summary)).toContain("accrual months 2026-04–2026-06")
    const created = period.payload.invoice as { id: string }
    expect(created).toMatchObject({ fromMonth: "2026-04", yearMonth: "2026-06" })
    expect((await invoices.doc(created.id).get()).data()).toMatchObject({ fromMonth: "2026-04", yearMonth: "2026-06" })

    const single = await callTool("create_invoice", {
      client: "Acme", number: "P-2", fromMonth: "2026-06", yearMonth: "2026-06", amount: 100, vat: 22,
    })
    expect(single.isError).toBe(false)
    const one = single.payload.invoice as { id: string }
    expect((await invoices.doc(one.id).get()).data()).toMatchObject({ fromMonth: null, yearMonth: "2026-06" })

    await invoices.doc(created.id).delete()
    await invoices.doc(one.id).delete()
  })

  it("refuses a period whose first month comes after the last, or longer than 12 months", async () => {
    const backwards = await callTool("create_invoice", {
      client: "Acme", number: "P-3", fromMonth: "2026-07", yearMonth: "2026-06", amount: 100, vat: 22,
    })
    expect(backwards.isError).toBe(true)
    expect(String(backwards.payload.error)).toContain("The first month comes after the last one.")
    const long = await callTool("create_invoice", {
      client: "Acme", number: "P-3", fromMonth: "2025-06", yearMonth: "2026-06", amount: 100, vat: 22,
    })
    expect(long.isError).toBe(true)
    expect(String(long.payload.error)).toContain("An invoice covers at most 12 months.")
    expect((await admin.getInvoices(userId)).some((i) => i.number === "P-3")).toBe(false)
  })
})

describe("mark_invoice_paid", () => {
  it("stamps today's date when none is given", async () => {
    const { isError, payload } = await callTool("mark_invoice_paid", { invoice: "2026/15" })
    expect(isError).toBe(false)
    expect((payload.invoice as Record<string, unknown>).paidDate).toBe(format(new Date(), "yyyy-MM-dd"))

    const stored = (await admin.getInvoices(userId)).find((i) => i.number === "2026/15")!
    expect(stored.paidDate).not.toBeNull()
  })

  it("refuses to re-stamp an invoice already cashed", async () => {
    const { isError, payload } = await callTool("mark_invoice_paid", { invoice: "2026/15" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toMatch(/already collected/i)
  })

  it("resolves the exact number over the longer one it prefixes", async () => {
    const { isError, payload } = await callTool("mark_invoice_paid", {
      invoice: "2026/14",
      paidDate: `${currentMonth}-05`,
    })
    expect(isError).toBe(false)
    expect((payload.invoice as Record<string, unknown>).number).toBe("2026/14")
  })
})

describe("update_invoice", () => {
  const stored = async (number: string) => (await admin.getInvoices(userId)).find((i) => i.number === number)!

  it("sets the months an invoice covers and reads them back, then makes it a single month again", async () => {
    const created = await callTool("create_invoice", {
      client: "Acme", number: "U-9", yearMonth: "2026-07", amount: 12000, vat: 2640,
    })
    expect(created.isError).toBe(false)

    // Previewed first: nothing written until confirm.
    const preview = await callTool("update_invoice", { invoice: "U-9", fromMonth: "2026-04", yearMonth: "2026-06" })
    expect(preview.isError).toBe(false)
    expect(preview.payload).toMatchObject({ preview: true, changes: ['period "Jul 2026" → "Apr–Jun 2026"'] })
    expect(String(preview.payload.summary)).toMatch(/^Preview, nothing changed yet: edit invoice U-9 \(Acme Spa, €14,640\.00\): covers 2026-04–2026-06\./)
    expect(await stored("U-9")).toMatchObject({ fromMonth: null, yearMonth: "2026-07" })

    const { isError, payload } = await callTool("update_invoice", {
      invoice: "U-9", fromMonth: "2026-04", yearMonth: "2026-06", confirm: true,
    })
    expect(isError).toBe(false)
    expect(String(payload.summary)).toMatch(/^Invoice U-9 updated: covers 2026-04–2026-06\. Changes: period "Jul 2026" → "Apr–Jun 2026"\./)
    expect(payload.after).toMatchObject({
      number: "U-9", client: "Acme Spa", period: "Apr–Jun 2026", amount: 12000, vat: 2640, total: 14640, paidDate: null,
    })
    expect(await stored("U-9")).toMatchObject({ fromMonth: "2026-04", yearMonth: "2026-06", amount: 12000 })

    // One end alone moves only that end; from == to is a single month, stored as null.
    await callTool("update_invoice", { invoice: "U-9", fromMonth: "2026-06", confirm: true })
    expect(await stored("U-9")).toMatchObject({ fromMonth: null, yearMonth: "2026-06" })
    await callTool("update_invoice", { invoice: "U-9", fromMonth: "2026-05", confirm: true })
    await callTool("update_invoice", { invoice: "U-9", fromMonth: null, confirm: true })
    expect(await stored("U-9")).toMatchObject({ fromMonth: null, yearMonth: "2026-06" })
  })

  it("refuses a first month after the last one, or a period longer than 12 months", async () => {
    const backwards = await callTool("update_invoice", { invoice: "U-9", fromMonth: "2026-07" })
    expect(backwards.isError).toBe(true)
    expect(String(backwards.payload.error)).toContain("The first month comes after the last one.")
    const long = await callTool("update_invoice", { invoice: "U-9", fromMonth: "2025-06" })
    expect(long.isError).toBe(true)
    expect(String(long.payload.error)).toContain("An invoice covers at most 12 months.")
    expect(await stored("U-9")).toMatchObject({ fromMonth: null, yearMonth: "2026-06" })
  })

  it("refuses a number another invoice holds", async () => {
    const { isError, payload } = await callTool("update_invoice", { invoice: "U-9", number: "2026/14" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toMatch(/an invoice numbered "2026\/14" already exists/i)
    expect(await stored("U-9")).toBeDefined()
  })

  it("marks an invoice unpaid with paidDate null, so a wrong stamp can be undone", async () => {
    expect((await stored("2026/15")).paidDate).not.toBeNull()
    const { isError, payload } = await callTool("update_invoice", { invoice: "2026/15", paidDate: null, confirm: true })
    expect(isError).toBe(false)
    expect(String(payload.summary)).toContain("marked unpaid")
    expect((await stored("2026/15")).paidDate).toBeNull()
  })

  it("is an error with nothing to change", async () => {
    const { isError, payload } = await callTool("update_invoice", { invoice: "U-9" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("Nothing to change")
  })

  it("is blocked for read-only tokens by the scope gate", async () => {
    const res = await mcp(rpcRequest(readOnlyBearer, "update_invoice", { invoice: "U-9", amount: 1 }))
    expect(res.status).toBe(403)
    expect((await stored("U-9")).amount).toBe(12000)
  })

  it("leaves an audit entry for each attempt", async () => {
    // Audit writes are fire-and-forget; the newest entries may still be in flight.
    await expect
      .poll(async () => {
        const entries = await auditEntries()
        return (
          entries.some((e) => e.tool === "update_invoice" && e.result === "ok") &&
          entries.some((e) => e.tool === "update_invoice" && e.result === "error")
        )
      })
      .toBe(true)
  })
})

// ─── Company deadlines ───────────────────────────────────────────────────────

describe("deadlines", () => {
  it("adds, lists, and ticks off a stored deadline", async () => {
    const added = await callTool("add_deadline", {
      title: "Parcella commercialista",
      date: `${currentMonth}-10`,
      kind: "admin",
      amount: 1200,
    })
    expect(added.isError).toBe(false)
    expect((added.payload.deadline as Record<string, unknown>).kind).toBe("admin")

    // A read-only token must see it: listing is not a write.
    const listed = await callTool("list_deadlines", {}, readOnlyBearer)
    expect(listed.isError).toBe(false)
    const rows = listed.payload.deadlines as Record<string, unknown>[]
    expect(rows.some((r) => r.title === "Parcella commercialista" && r.amount === 1200)).toBe(true)

    const done = await callTool("complete_deadline", { deadline: "Parcella" })
    expect(done.isError).toBe(false)
    expect((done.payload.deadline as Record<string, unknown>).isDone).toBe(true)

    // Ticked deadlines drop out of the default listing.
    const after = await callTool("list_deadlines", {}, readOnlyBearer)
    const stillOpen = (after.payload.deadlines as Record<string, unknown>[]).some(
      (r) => r.title === "Parcella commercialista"
    )
    expect(stillOpen).toBe(false)

    const withDone = await callTool("list_deadlines", { includeDone: true }, readOnlyBearer)
    expect(
      (withDone.payload.deadlines as Record<string, unknown>[]).some(
        (r) => r.title === "Parcella commercialista"
      )
    ).toBe(true)
  })

  it("refuses to tick one that is already done", async () => {
    const { isError, payload } = await callTool("complete_deadline", { deadline: "Parcella" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toMatch(/already marked done/i)
  })

  it("filters by kind", async () => {
    await callTool("add_deadline", {
      title: "Rinnovo hosting",
      date: `${currentMonth}-20`,
      kind: "contract",
    })
    const { payload } = await callTool("list_deadlines", { kind: "contract" }, readOnlyBearer)
    const rows = payload.deadlines as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe("Rinnovo hosting")
  })
})

// ─── Pipeline follow-ups ─────────────────────────────────────────────────────

describe("schedule_follow_up", () => {
  it("sets, moves, and clears the next action on an open opportunity", async () => {
    const created = await callTool("create_opportunity", {
      client: "Acme",
      title: "Rinnovo 2027",
      dailyRate: 900,
      estimatedDaysPerMonth: 8,
      estimatedDurationMonths: 6,
    })
    expect(created.isError).toBe(false)

    const set = await callTool("schedule_follow_up", {
      opportunity: "Rinnovo 2027",
      date: `${currentMonth}-12`,
      note: "richiamare dopo il CDA",
    })
    expect(set.isError).toBe(false)
    expect((set.payload.opportunity as Record<string, unknown>).nextActionDate).toBe(`${currentMonth}-12`)

    // The whole point: a follow-up that already exists can be moved.
    const moved = await callTool("schedule_follow_up", {
      opportunity: "Rinnovo 2027",
      date: `${currentMonth}-19`,
    })
    expect((moved.payload.opportunity as Record<string, unknown>).nextActionDate).toBe(`${currentMonth}-19`)
    expect((moved.payload.opportunity as Record<string, unknown>).nextActionNote).toBe("richiamare dopo il CDA")

    const cleared = await callTool("schedule_follow_up", { opportunity: "Rinnovo 2027", date: null })
    expect(cleared.isError).toBe(false)
    expect((cleared.payload.opportunity as Record<string, unknown>).nextActionDate).toBeNull()
  })

  it("refuses to chase a closed deal", async () => {
    await callTool("move_opportunity", {
      opportunity: "Rinnovo 2027",
      stage: "lost",
      lostReason: "budget congelato",
    })
    const { isError, payload } = await callTool("schedule_follow_up", {
      opportunity: "Rinnovo 2027",
      date: `${currentMonth}-25`,
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toMatch(/not chased any more/i)
  })
})

// ─── Timecards ───────────────────────────────────────────────────────────────

describe("log_time", () => {
  const today = isoDate(new Date())
  let dunderId = ""

  async function seedContract(clientId: string, over: { name: string; startMonth: string | null; contractedDays?: number; defaultDaysPerMonth?: number }) {
    const ref = await getAdminFirestore()
      .collection("users").doc(userId).collection("engagements")
      .add({
        userId, clientId, opportunityId: null, dailyRate: 800, vatApplicable: true,
        contractedDays: null, defaultDaysPerMonth: 10, isActive: true, notes: null,
        createdAt: new Date(), updatedAt: new Date(), ...over,
      })
    return ref.id
  }
  const onDay = async (engagement: string, date: string) =>
    (await admin.getTimecards(userId)).filter((t) => t.engagementId === engagement && t.date === date)

  beforeAll(async () => {
    const dunder = await admin.createClient(userId, { name: "Dunder Corp" })
    // Starts this month, so the last day of the previous one is before the contract.
    dunderId = await seedContract(dunder.id, { name: "Supporto SAP", startMonth: currentMonth })
    const doppio = await admin.createClient(userId, { name: "Doppio Srl" })
    await seedContract(doppio.id, { name: "Manutenzione", startMonth: null })
    await seedContract(doppio.id, { name: "Sviluppo app", startMonth: null })
  })

  it("logs today by default; a retry writes nothing and says unchanged", async () => {
    const first = await callTool("log_time", { client: "Dunder", hours: 6 })
    expect(first.isError).toBe(false)
    expect(first.payload).toMatchObject({
      change: "create", date: today, hours: 6, previousHours: null, dayTotalHours: 6,
      client: "Dunder Corp", contract: "Supporto SAP", engagementId: dunderId,
      month: { yearMonth: currentMonth, hours: 6, days: 0.75, plannedDays: 10 },
    })

    const retry = await callTool("log_time", { client: "Dunder", hours: 6 })
    expect(retry.isError).toBe(false)
    expect(retry.payload.change).toBe("unchanged")
    expect(String(retry.payload.summary)).toContain("nothing changed")

    const docs = await onDay(dunderId, today)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ id: `${dunderId}_${today}`, hours: 6 })
  })

  it("refuses different hours on a filled day naming both numbers; replace corrects them", async () => {
    const conflict = await callTool("log_time", { client: "Dunder", hours: 5 })
    expect(conflict.isError).toBe(true)
    const error = String(conflict.payload.error)
    expect(error).toContain("already has 6 hours")
    expect(error).toContain("If the total is 5, repeat with replace: true")
    expect(error).toContain("repeat with hours 11 and replace: true")
    expect((await onDay(dunderId, today))[0].hours).toBe(6)

    // Following the additive hint as written lands, instead of being refused again.
    const added = await callTool("log_time", { client: "Dunder", hours: 8, replace: true })
    expect(added.payload).toMatchObject({ change: "update", hours: 8, previousHours: 6 })

    // The month's planned days come from the plan's own cell: an explicit row wins over the default.
    await admin.createAllocation(userId, { engagementId: dunderId, yearMonth: currentMonth, days: 12 })
    const fixed = await callTool("log_time", { client: "Dunder", hours: 5, replace: true, notes: "call" })
    expect(fixed.isError).toBe(false)
    expect(fixed.payload).toMatchObject({
      change: "update", hours: 5, previousHours: 8,
      month: { hours: 5, days: 0.625, plannedDays: 12 },
    })
    expect((await onDay(dunderId, today))[0]).toMatchObject({ hours: 5, notes: "call" })
  })

  it("deletes the day on 0; a repeated 0 is unchanged", async () => {
    const removed = await callTool("log_time", { client: "Dunder", hours: 0 })
    expect(removed.payload).toMatchObject({ change: "delete", hours: 0, previousHours: 5 })
    expect(await onDay(dunderId, today)).toHaveLength(0)

    const again = await callTool("log_time", { client: "Dunder", hours: 0 })
    expect(again.isError).toBe(false)
    expect(again.payload.change).toBe("unchanged")
  })

  it("writes and reads the owner's row only: a collaborator's hours on the same day are neither a conflict nor overwritten", async () => {
    const hers = await admin.setTimecard(userId, { engagementId: dunderId, date: today, collaboratorId: "giulia", hours: 20 })
    expect(hers.id).toBe(`${dunderId}_${today}_giulia`)
    const first = await callTool("log_time", { client: "Dunder", hours: 6 })
    expect(first.isError).toBe(false)
    // Her 20 h do not count against the owner's 24 h day, and the month's hours are the contract's: 6 + 20.
    expect(first.payload).toMatchObject({ change: "create", hours: 6, previousHours: null, dayTotalHours: 6, month: { hours: 26 } })
    expect((await onDay(dunderId, today)).map((t) => [t.collaboratorId, t.hours]).sort()).toEqual([["giulia", 20], [null, 6]].sort())
    await callTool("log_time", { client: "Dunder", hours: 0 })
    const left = await onDay(dunderId, today)
    expect(left.map((t) => [t.collaboratorId, t.hours])).toEqual([["giulia", 20]])
    await admin.deleteTimecard(userId, dunderId, today, "giulia")
  })

  it("schedules a day after today, up to 3 months ahead, and caps it at 8 hours a client", async () => {
    const tomorrow = isoDate(addDays(new Date(), 1))
    const ahead = await callTool("log_time", { client: "Dunder", hours: 2, date: tomorrow })
    expect(ahead.isError).toBe(false)
    expect(ahead.payload).toMatchObject({ change: "create", date: tomorrow, hours: 2, scheduled: true })
    expect(String(ahead.payload.summary)).toContain("Scheduled: it counts as worked once the day comes.")
    expect((await callTool("log_time", { client: "Dunder", hours: 1 })).payload.scheduled).toBe(false)
    await callTool("log_time", { client: "Dunder", hours: 0 })

    // The limit day is in; the day after it is not.
    const limit = isoDate(addMonths(new Date(), 3))
    const atLimit = await callTool("log_time", { client: "Dunder", hours: 1, date: limit })
    expect(atLimit.isError).toBe(false)
    expect(atLimit.payload.scheduled).toBe(true)
    const tooFar = await callTool("log_time", { client: "Dunder", hours: 1, date: isoDate(addDays(addMonths(new Date(), 3), 1)) })
    expect(tooFar.isError).toBe(true)
    expect(String(tooFar.payload.error)).toContain("more than 3 months ahead")
    expect(String(tooFar.payload.error)).toContain(`hours go up to ${limit}`)
    expect(String(tooFar.payload.error)).toContain("log_allocation")

    const dayAfter = isoDate(addDays(new Date(), 2))
    expect((await callTool("log_time", { engagementId: "Manutenzione", hours: 5, date: dayAfter })).isError).toBe(false)
    const over = await callTool("log_time", { engagementId: "Sviluppo app", hours: 4, date: dayAfter })
    expect(over.isError).toBe(true)
    expect(String(over.payload.error)).toContain("That makes 9 h on this client in one day: more than 8.")

    for (const [engagementId, date] of [["Supporto SAP", tomorrow], ["Supporto SAP", limit], ["Manutenzione", dayAfter]]) {
      expect((await callTool("log_time", { engagementId, hours: 0, date })).payload.change).toBe("delete")
    }
  })

  it("refuses new hours after a contract's end date, and still clears the ones there", async () => {
    const client = await admin.createClient(userId, { name: "Fine Srl" })
    const { id } = await admin.createEngagement(userId, {
      clientId: client.id, name: "Chiuso a metà", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 5,
    })
    expect((await callTool("log_time", { engagementId: "Chiuso a metà", hours: 2 })).isError).toBe(false)
    const yesterday = isoDate(subDays(new Date(), 1))
    await admin.updateEngagement(userId, id, { endDate: yesterday, endMonth: yesterday.slice(0, 7) })

    const fresh = await callTool("log_time", { engagementId: "Chiuso a metà", hours: 2, date: isoDate(addDays(new Date(), 1)) })
    expect(fresh.isError).toBe(true)
    expect(String(fresh.payload.error)).toContain(`ended on ${yesterday}`)
    expect(String(fresh.payload.error)).toContain("update_engagement endDate")
    expect(String(fresh.payload.error)).not.toContain("already logged")

    const correction = await callTool("log_time", { engagementId: "Chiuso a metà", hours: 3, replace: true })
    expect(correction.isError).toBe(true)
    expect(String(correction.payload.error)).toContain(`${today} is after its end. The 2 hours already logged can be removed with hours 0.`)

    const removed = await callTool("log_time", { engagementId: "Chiuso a metà", hours: 0 })
    expect(removed.payload).toMatchObject({ change: "delete", previousHours: 2 })
    expect(await onDay(id, today)).toHaveLength(0)
  })

  it("clears a note on any day and stores null; a new note on a locked day is still refused", async () => {
    const client = await admin.createClient(userId, { name: "Nota Srl" })
    const { id } = await admin.createEngagement(userId, {
      clientId: client.id, name: "Note chiuse", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 5,
    })
    const log = (over: Record<string, unknown>) => callTool("log_time", { engagementId: "Note chiuse", hours: 3, ...over })
    expect((await log({ notes: "Retro" })).isError).toBe(false)

    // null clears on an open contract, stored as null.
    const nulled = await log({ notes: null })
    expect(nulled.payload).toMatchObject({ change: "update", hours: 3, previousHours: 3 })
    expect(String(nulled.payload.summary)).toContain("Cleared the note on the 3 hours")
    expect((await onDay(id, today))[0]).toMatchObject({ hours: 3, notes: null })
    expect((await log({ notes: "Retro" })).payload.change).toBe("update")

    const yesterday = isoDate(subDays(new Date(), 1))
    await admin.updateEngagement(userId, id, { endDate: yesterday, endMonth: yesterday.slice(0, 7) })

    const changed = await log({ notes: "Review" })
    expect(changed.isError).toBe(true)
    expect(String(changed.payload.error)).toContain(`${today} is after its end`)
    // Clearing with new hours is new hours, refused too.
    expect((await log({ hours: 2, replace: true, notes: "" })).isError).toBe(true)
    expect((await onDay(id, today))[0]).toMatchObject({ hours: 3, notes: "Retro" })

    const cleared = await log({ notes: "" })
    expect(cleared.isError).toBe(false)
    expect(cleared.payload).toMatchObject({ change: "update", hours: 3, previousHours: 3 })
    expect((await onDay(id, today))[0]).toMatchObject({ hours: 3, notes: null })
    expect((await log({ notes: "" })).payload.change).toBe("unchanged")
    expect((await log({ notes: "Retro" })).isError).toBe(true)

    // Leaves today's total as it found it for the 24-hour test below.
    expect((await log({ hours: 0 })).payload.change).toBe("delete")
  })

  it("refuses a day before the contract starts, and a day that does not exist", async () => {
    const beforeStart = isoDate(subDays(new Date(`${currentMonth}-01T00:00:00`), 1))
    const early = await callTool("log_time", { client: "Dunder", hours: 2, date: beforeStart })
    expect(early.isError).toBe(true)
    expect(String(early.payload.error)).toContain(`starts in ${currentMonth}`)

    const invalid = await callTool("log_time", { client: "Dunder", hours: 2, date: "2026-02-30" })
    expect(invalid.isError).toBe(true)
    expect(String(invalid.payload.error)).toContain("does not exist")

    expect((await admin.getTimecards(userId)).filter((t) => t.engagementId === dunderId)).toHaveLength(0)
  })

  it("takes 8 h on each of two clients the same day, refuses 5 + 4 on one client's contracts", async () => {
    expect((await callTool("log_time", { client: "Acme", hours: 8 })).isError).toBe(false)
    const other = await callTool("log_time", { client: "Dunder", hours: 8 })
    expect(other.payload).toMatchObject({ change: "create", dayTotalHours: 16 })
    expect(String(other.payload.summary)).toContain("Day total across all contracts: 16 hours")
    await callTool("log_time", { client: "Acme", hours: 0 })
    await callTool("log_time", { client: "Dunder", hours: 0 })

    expect((await callTool("log_time", { engagementId: "Manutenzione", hours: 5 })).isError).toBe(false)
    const over = await callTool("log_time", { engagementId: "Sviluppo app", hours: 4 })
    expect(over.isError).toBe(true)
    expect(String(over.payload.error)).toContain("That makes 9 h on this client in one day: more than 8.")
    await callTool("log_time", { engagementId: "Manutenzione", hours: 0 })
  })

  it("refuses hours past the contract's days, and warns past the month's plan", async () => {
    const quota = await admin.createClient(userId, { name: "Quota Srl" })
    // Half a day contracted, a quarter of a day planned this month.
    const id = await seedContract(quota.id, { name: "Mezza giornata", startMonth: null, contractedDays: 0.5, defaultDaysPerMonth: 0.25 })
    const over = await callTool("log_time", { engagementId: id, hours: 5 })
    expect(over.isError).toBe(true)
    expect(String(over.payload.error)).toContain("The contract has 4 h left. To go past its days, use amend_contract.")

    const warned = await callTool("log_time", { engagementId: id, hours: 3 })
    expect(warned.isError).toBe(false)
    expect(String(warned.payload.summary)).toContain("Warning: That is 3 h this month: past the plan's 2 h.")
    expect((await onDay(id, today))[0].hours).toBe(3)

    // Lowering is never refused.
    expect((await callTool("log_time", { engagementId: id, hours: 1, replace: true })).isError).toBe(false)
    await callTool("log_time", { engagementId: id, hours: 0 })
  })

  it("asks which contract on a two-contract client, and finds one by name", async () => {
    const ambiguous = await callTool("log_time", { client: "Doppio", hours: 2 })
    expect(ambiguous.isError).toBe(true)
    expect(String(ambiguous.payload.error)).toContain("2 active contracts")
    expect(String(ambiguous.payload.error)).toContain("Manutenzione")
    expect(String(ambiguous.payload.error)).toContain("Sviluppo app")

    const byName = await callTool("log_time", { engagementId: "sviluppo app", hours: 3 })
    expect(byName.isError).toBe(false)
    expect(byName.payload).toMatchObject({ client: "Doppio Srl", contract: "Sviluppo app", hours: 3 })

    const scoped = await callTool("log_time", { client: "Doppio", engagementId: "Manutenzione", hours: 1 })
    expect(scoped.payload).toMatchObject({ contract: "Manutenzione", dayTotalHours: 4 })

    const neither = await callTool("log_time", { hours: 1 })
    expect(neither.isError).toBe(true)
    expect(String(neither.payload.error)).toContain("Pass client or engagementId")
  })

  it("removes hours on a closed contract by engagementId, even from before a start moved later", async () => {
    const client = await admin.createClient(userId, { name: "Chiusura Srl" })
    const id = await seedContract(client.id, { name: "Porting legacy", startMonth: null })
    expect((await callTool("log_time", { client: "Chiusura", hours: 2 })).isError).toBe(false)
    // Closed with no endMonth after its start moved past today: out of the plan entirely.
    await admin.updateEngagement(userId, id, {
      isActive: false, startMonth: format(addMonths(new Date(), 1), "yyyy-MM"),
    })

    const byClient = await callTool("log_time", { client: "Chiusura", hours: 0 })
    expect(byClient.isError).toBe(true)
    expect(String(byClient.payload.error)).toContain("No active contract")

    const correction = await callTool("log_time", { engagementId: "Porting legacy", hours: 3, replace: true })
    expect(correction.isError).toBe(true)
    expect(String(correction.payload.error)).toContain(
      "is closed with no end: it takes no hours. The 2 hours already logged can be removed with hours 0",
    )

    const removed = await callTool("log_time", { engagementId: "Porting legacy", hours: 0 })
    expect(removed.isError).toBe(false)
    expect(removed.payload).toMatchObject({ change: "delete", previousHours: 2, month: { plannedDays: null } })
    expect(String(removed.payload.summary)).toContain("outside the plan")
    expect(await onDay(id, today)).toHaveLength(0)
  })

  it("stays readable as list_time for a read-only token", async () => {
    const { isError, payload } = await callTool("list_time", {}, readOnlyBearer)
    expect(isError).toBe(false)
    expect(payload.total).toMatchObject({ hours: 4 })
  })
})

// Verbali: a call's minutes and, optionally, the contract's light, which is always
// the newest stated one (healthByContract, as the UI chip).
describe("log_meeting / update_meeting", () => {
  const today = isoDate(new Date())
  const tomorrow = isoDate(addDays(new Date(), 1))
  let sigmaId = ""
  let tauId = ""
  let migrazione = ""
  let sviluppo = ""
  let vecchio = ""
  const idOf = (payload: Record<string, unknown>) => (payload.meeting as { id: string }).id
  const stored = async (id: string) => (await admin.getMeetings(userId)).find((m) => m.id === id)

  beforeAll(async () => {
    const contract = { dailyRate: 700, vatApplicable: true, defaultDaysPerMonth: 4 }
    sigmaId = (await admin.createClient(userId, { name: "Sigma Verbali" })).id
    migrazione = (await admin.createEngagement(userId, { ...contract, clientId: sigmaId, name: "Migrazione Sigma" })).id
    tauId = (await admin.createClient(userId, { name: "Tau Prospect" })).id
    const upsilon = (await admin.createClient(userId, { name: "Upsilon Srl" })).id
    await admin.createEngagement(userId, { ...contract, clientId: upsilon, name: "Manutenzione Upsilon" })
    sviluppo = (await admin.createEngagement(userId, { ...contract, clientId: upsilon, name: "Sviluppo Upsilon" })).id
    vecchio = (await admin.createEngagement(userId, { ...contract, clientId: upsilon, name: "Vecchio Upsilon" })).id
    await admin.updateEngagement(userId, vecchio, { isActive: false, endMonth: "2026-06" })
  })

  it("a client alone lands on its only active contract, and the reply states the transition", async () => {
    const first = await callTool("log_meeting", {
      client: "Sigma", date: "2026-03-02", time: "10:30", health: "green", text: "Kickoff: si parte lunedì.",
    })
    expect(first.isError).toBe(false)
    expect(first.payload.summary).toBe(
      "Meeting on 2026-03-02 at 10:30 for Sigma Verbali, contract Migrazione Sigma. Status: green (the contract's first status)."
    )
    expect(first.payload.meeting).toEqual({
      id: expect.any(String), date: "2026-03-02", time: "10:30", health: "green", clientId: sigmaId,
      client: "Sigma Verbali", engagementId: migrazione, engagementLabel: "Migrazione Sigma", text: "Kickoff: si parte lunedì.",
    })
    expect(first.payload).toMatchObject({ previousHealth: null, contractHealth: { health: "green", asOf: "2026-03-02" } })

    const worse = await callTool("log_meeting", { client: "Sigma", date: "2026-03-10", health: "yellow", text: "I test slittano." })
    expect(String(worse.payload.summary)).toContain("Status: yellow (was green since 2026-03-02).")
    expect(worse.payload).toMatchObject({
      previousHealth: { health: "green", asOf: "2026-03-02" }, contractHealth: { health: "yellow", asOf: "2026-03-10" },
    })

    const same = await callTool("log_meeting", { client: "Sigma", date: "2026-03-12", health: "yellow", text: "Ancora in ritardo." })
    expect(String(same.payload.summary)).toContain("Status: yellow (unchanged).")
  })

  it("an omitted light is stored null and the status stays, with its own date", async () => {
    const res = await callTool("log_meeting", { client: "Sigma", date: "2026-03-15", text: "Call veloce." })
    expect(res.isError).toBe(false)
    expect(String(res.payload.summary)).toContain("No status given: it stays yellow since 2026-03-12.")
    expect(res.payload.contractHealth).toEqual({ health: "yellow", asOf: "2026-03-12" })
    expect(await stored(idOf(res.payload))).toMatchObject({ health: null, time: null })
  })

  it("a backdated verbale cannot override a newer assessment", async () => {
    const res = await callTool("log_meeting", { client: "Sigma", date: "2026-03-05", health: "red", text: "Call di una settimana fa." })
    expect(String(res.payload.summary)).toContain("A newer meeting exists: the status stays yellow since 2026-03-12.")
    expect(res.payload.contractHealth).toEqual({ health: "yellow", asOf: "2026-03-12" })
  })

  it("a client with no contract gets a client-level verbale, dated today", async () => {
    const res = await callTool("log_meeting", { client: "Tau", text: "Prima call conoscitiva." })
    expect(res.isError).toBe(false)
    expect(res.payload.summary).toBe(`Meeting on ${today} for Tau Prospect (client-level).`)
    expect(res.payload.meeting).toMatchObject({
      clientId: tauId, engagementId: null, engagementLabel: null, date: today, time: null, health: null,
    })
    expect(res.payload).toMatchObject({ previousHealth: null, contractHealth: null })
  })

  it("several active contracts fail listing them; engagementId picks one or forces the client", async () => {
    const several = await callTool("log_meeting", { client: "Upsilon", text: "Allineamento." })
    expect(several.isError).toBe(true)
    const error = String(several.payload.error)
    expect(error).toContain("Upsilon Srl has 2 active contracts")
    expect(error).toContain("Manutenzione Upsilon")
    expect(error).toContain("Sviluppo Upsilon")
    expect(error).not.toContain("Vecchio Upsilon")
    expect(error).toContain("engagementId null for a client-level meeting")

    const picked = await callTool("log_meeting", { client: "Upsilon", engagementId: "sviluppo", text: "Demo." })
    expect(picked.payload.meeting).toMatchObject({ engagementId: sviluppo })
    expect(String(picked.payload.summary)).toContain("No status given: the contract has no status yet.")

    const onClient = await callTool("log_meeting", { client: "Upsilon", engagementId: null, text: "Rinnovo quadro." })
    expect(onClient.payload.meeting).toMatchObject({ engagementId: null, client: "Upsilon Srl" })
    expect(String(onClient.payload.summary)).toContain("for Upsilon Srl (client-level).")

    const noClient = await callTool("log_meeting", { engagementId: null, text: "x" })
    expect(String(noClient.payload.error)).toContain("pass client too")
    const neither = await callTool("log_meeting", { text: "x" })
    expect(String(neither.payload.error)).toContain("Pass client or engagementId")
  })

  it("reaches a closed contract by name", async () => {
    const res = await callTool("log_meeting", { engagementId: "Vecchio Upsilon", date: "2026-05-20", text: "Chiusura lavori." })
    expect(res.isError).toBe(false)
    expect(res.payload.meeting).toMatchObject({ engagementId: vecchio, client: "Upsilon Srl" })
    expect(String(res.payload.summary)).toContain("contract Vecchio Upsilon")
  })

  it("refuses a future date, an impossible time or day, a blank text and one over the cap", async () => {
    const before = (await admin.getMeetings(userId)).length
    const future = await callTool("log_meeting", { client: "Sigma", date: tomorrow, text: "Call di domani." })
    expect(future.isError).toBe(true)
    expect(String(future.payload.error)).toContain("For a future call use add_task with dueDate")
    const hour = await callTool("log_meeting", { client: "Sigma", time: "25:00", text: "x" })
    expect(String(hour.payload.error)).toContain("Invalid time")
    const day = await callTool("log_meeting", { client: "Sigma", date: "2026-02-30", text: "x" })
    expect(String(day.payload.error)).toContain("Invalid date")
    const blank = await callTool("log_meeting", { client: "Sigma", text: "   " })
    expect(String(blank.payload.error)).toContain("Write what happened")
    // Over the cap is the SDK's input error, never a silent cut.
    const res = await mcp(rpcRequest(writeBearer, "log_meeting", { client: "Sigma", text: "x".repeat(5001) }))
    const dataLine = (await res.text()).split("\n").find((l) => l.startsWith("data: "))!
    const rpc = JSON.parse(dataLine.slice(6)) as { error?: unknown; result?: { isError?: boolean } }
    expect(rpc.error !== undefined || rpc.result?.isError === true).toBe(true)
    expect(await admin.getMeetings(userId)).toHaveLength(before)
  })

  it("update_meeting changes the time, clears the light and returns the replaced text", async () => {
    const logged = await callTool("log_meeting", {
      client: "Sigma", date: "2026-03-20", time: "10:00", health: "red", text: "Pagamenti bloccati.",
    })
    const id = idOf(logged.payload)

    const time = await callTool("update_meeting", { meetingId: id, time: "11:00" })
    expect(time.isError).toBe(false)
    expect(time.payload.summary).toBe("Meeting on 2026-03-20 (Sigma Verbali, Migrazione Sigma) updated: time 11:00.")
    expect(time.payload).toMatchObject({ changed: ["time"], contractHealth: { health: "red", asOf: "2026-03-20" } })
    expect(time.payload).not.toHaveProperty("textBefore")

    // Without its light the status falls back to the previous stated one.
    const cleared = await callTool("update_meeting", { meetingId: id, time: null, health: null })
    expect(String(cleared.payload.summary)).toContain("updated: time removed, status removed.")
    expect(cleared.payload.contractHealth).toEqual({ health: "yellow", asOf: "2026-03-12" })
    expect(await stored(id)).toMatchObject({ time: null, health: null })

    const text = await callTool("update_meeting", { meetingId: id, text: "Pagamenti sbloccati." })
    expect(text.payload).toMatchObject({ changed: ["text"], textBefore: "Pagamenti bloccati." })
    expect(String(text.payload.summary)).toContain("text replaced")
    expect((await stored(id))?.text).toBe("Pagamenti sbloccati.")
  })

  it("update_meeting moves a verbale among its client's contracts or to the client, never to another's", async () => {
    const logged = await callTool("log_meeting", {
      client: "Upsilon", engagementId: "Manutenzione", date: "2026-04-01", health: "yellow", text: "Ticket arretrati.",
    })
    const id = idOf(logged.payload)

    const moved = await callTool("update_meeting", { meetingId: id, engagementId: "Sviluppo Upsilon" })
    expect(String(moved.payload.summary)).toContain("updated: moved to Sviluppo Upsilon.")
    expect(moved.payload.contractHealth).toEqual({ health: "yellow", asOf: "2026-04-01" })
    expect((await stored(id))?.engagementId).toBe(sviluppo)

    const other = await callTool("update_meeting", { meetingId: id, engagementId: "Migrazione Sigma" })
    expect(other.isError).toBe(true)
    expect(String(other.payload.error)).toContain("No contract matches")
    expect((await stored(id))?.engagementId).toBe(sviluppo)

    const toClient = await callTool("update_meeting", { meetingId: id, engagementId: null })
    expect(String(toClient.payload.summary)).toContain("moved to the client")
    expect(toClient.payload.contractHealth).toBeNull()
    expect(await stored(id)).toMatchObject({ engagementId: null, health: "yellow" })
  })

  it("update_meeting refuses no fields, no change, an unknown id and a future date", async () => {
    const id = idOf((await callTool("log_meeting", { client: "Tau", date: "2026-04-02", text: "Offerta inviata." })).payload)
    const nothing = await callTool("update_meeting", { meetingId: id })
    expect(String(nothing.payload.error)).toContain("Nothing to change")
    // Trimmed before comparing, as it is stored.
    const same = await callTool("update_meeting", { meetingId: id, date: "2026-04-02", text: "  Offerta inviata. " })
    expect(same.isError).toBe(true)
    expect(String(same.payload.error)).toContain("already has these values")
    const unknown = await callTool("update_meeting", { meetingId: "nope", text: "x" })
    expect(String(unknown.payload.error)).toContain("No meeting with id nope")
    const future = await callTool("update_meeting", { meetingId: id, date: tomorrow })
    expect(String(future.payload.error)).toContain("has not come yet")
    expect((await stored(id))?.date).toBe("2026-04-02")
  })

  it("list_meetings stays readable for a read-only token", async () => {
    const { isError, payload } = await callTool("list_meetings", { client: "Tau" }, readOnlyBearer)
    expect(isError).toBe(false)
    expect(payload.total).toBe(2)
  })
})

// #159: the budget left was contractedDays − Σ rows, blind to the months the plan fills at
// the default, so a contract burning through the plan reported its whole budget.
describe("log_allocation reads the plan (#159)", () => {
  const m = (n: number) => format(addMonths(new Date(), n), "yyyy-MM")
  let phiId = ""

  beforeAll(async () => {
    const phi = await admin.createClient(userId, { name: "Phi Srl" }) // "Tau" is taken by the verbali suite
    phiId = (
      await admin.createEngagement(userId, {
        clientId: phi.id, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 10, contractedDays: 40,
        startMonth: m(-2),
      })
    ).id
  })

  it("reports the budget get_plan shows after the month, and the plan's capacity", async () => {
    const logged = await callTool("log_allocation", { client: "Phi Srl", days: 5, month: m(1), mode: "set" })
    expect(logged.isError).toBe(false)
    // 40 − 10 × 3 default months (m(-2)..m(0)) − 5. Was 35: only the stored rows were subtracted.
    expect(logged.payload.remainingContractDays).toBe(5)

    const plan = await callTool("get_plan", { months: 3 })
    const months = plan.payload.months as {
      yearMonth: string
      lines: { engagementId: string; plannedDays: number; billableDays: number; remainingDays: number | null; capped: boolean }[]
      capacity: { allocatedDays: number }
    }[]
    const at = (ym: string) => months.find((x) => x.yearMonth === ym)!
    const line = (ym: string) => at(ym).lines.find((l) => l.engagementId === phiId)
    expect(line(m(1))).toMatchObject({ plannedDays: 5, remainingDays: 5 })
    expect(line(m(0))?.remainingDays).toBe(10) // no row: the default burned
    expect(line(m(2))).toMatchObject({ billableDays: 5, remainingDays: 0, capped: true })
    expect(logged.payload.monthOwnDays).toBe(at(m(1)).capacity.allocatedDays)
  })
})

describe("create_contract", () => {
  const month = (n: number) => format(addMonths(new Date(), n), "yyyy-MM")
  let clientId = ""
  let before = { opportunities: 0, engagements: 0 }

  beforeAll(async () => {
    clientId = (await admin.createClient(userId, { name: "Nuovo Contratto Srl" })).id
    before = {
      opportunities: (await admin.getOpportunities(userId)).length,
      engagements: (await admin.getEngagements(userId)).length,
    }
  })

  it("creates a day contract with no deal behind it", async () => {
    const { isError, payload } = await callTool("create_contract", {
      client: "Nuovo Contratto", name: "Retainer 2027", dailyRate: 600, defaultDaysPerMonth: 10,
      contractedDays: 120, startMonth: "2027-01", endMonth: "2027-12", notes: "Signed in October",
    })
    expect(isError).toBe(false)
    expect(payload.engagement).toMatchObject({
      label: "Retainer 2027", client: "Nuovo Contratto Srl", clientId, unit: "day", dailyRate: 600,
      defaultDaysPerMonth: 10, contractedDays: 120, budgetDays: 120, startMonth: "2027-01", endMonth: "2027-12", vatApplicable: true,
    })
    expect(String(payload.summary)).toContain("Retainer 2027")
    const stored = (await admin.getEngagements(userId)).find((e) => e.id === (payload.engagement as { id: string }).id)!
    expect(stored).toMatchObject({
      clientId, name: "Retainer 2027", opportunityId: null, dailyRate: 600, unit: "day", vatApplicable: true,
      defaultDaysPerMonth: 10, contractedDays: 120, startMonth: "2027-01", endMonth: "2027-12", notes: "Signed in October", isActive: true,
    })
  })

  it("stores an hourly contract the way convert_to_engagement does", async () => {
    const { isError, payload } = await callTool("create_contract", {
      client: clientId, unit: "hour", dailyRate: 75, defaultDaysPerMonth: 40, contractedDays: 120,
      startMonth: "2027-04", vatApplicable: false,
    })
    expect(isError).toBe(false)
    expect(payload.engagement).toMatchObject({
      unit: "hour", hourlyRate: 75, defaultHoursPerMonth: 40, contractedHours: 120, budgetHours: 120, vatApplicable: false, endMonth: null,
    })
    expect(String(payload.summary)).toContain("€75/h, 40 hours/month, budget 120 hours")
    expect(await admin.getEngagements(userId)).toContainEqual(
      expect.objectContaining({ unit: "hour", dailyRate: 600, defaultDaysPerMonth: 5, contractedDays: 15, name: null, opportunityId: null }),
    )
  })

  it("starts this month with no budget when only the rate and the monthly quantity are given", async () => {
    const { payload } = await callTool("create_contract", { client: "Nuovo Contratto", dailyRate: 500, defaultDaysPerMonth: 4 })
    expect(payload.engagement).toMatchObject({ startMonth: currentMonth, endMonth: null, contractedDays: null, budgetDays: null })
  })

  it("leaves the pipeline alone", async () => {
    expect((await admin.getOpportunities(userId)).length).toBe(before.opportunities)
    expect((await admin.getEngagements(userId)).length).toBe(before.engagements + 3)
  })

  it.each<[string, Record<string, unknown>, string]>([
    ["an end before the start", { client: "Nuovo Contratto", dailyRate: 600, defaultDaysPerMonth: 5, startMonth: "2027-05", endMonth: "2027-04" }, "End month 2027-04 is before the contract's start (2027-05)"],
    ["an unknown client", { client: "Nessuno", dailyRate: 600, defaultDaysPerMonth: 5 }, 'No client matches "Nessuno"'],
    ["more days than a month holds", { client: "Nuovo Contratto", dailyRate: 600, defaultDaysPerMonth: 40 }, "A month holds at most 31 days: 40 days is more."],
  ])("refuses %s", async (_label, args, error) => {
    const { isError, payload } = await callTool("create_contract", args)
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain(error)
    expect((await admin.getEngagements(userId)).length).toBe(before.engagements + 3)
  })

  it("refuses an archived client, by name and by id", async () => {
    const old = await admin.createClient(userId, { name: "Vecchio Cliente Srl" })
    await admin.updateClient(userId, old.id, { isActive: false })
    for (const client of ["Vecchio Cliente", old.id]) {
      const { isError, payload } = await callTool("create_contract", { client, dailyRate: 600, defaultDaysPerMonth: 5 })
      expect(isError).toBe(true)
      expect(String(payload.error)).toMatch(/archived|No client matches/)
    }
    expect((await admin.getEngagements(userId)).length).toBe(before.engagements + 3)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("splits a contract by year: end the old one, open the new one, get_plan shows both", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }) // A ends 2026-12, B starts 2027-01, whatever today is
    vi.setSystemTime(new Date("2026-10-15T12:00:00"))
    const split = await admin.createClient(userId, { name: "Split Srl" })
    const a = await callTool("create_contract", {
      client: "Split Srl", name: "A", dailyRate: 600, defaultDaysPerMonth: 10, startMonth: month(0),
    })
    const idA = (a.payload.engagement as { id: string }).id
    expect((await callTool("update_engagement", { engagementId: idA, endMonth: month(2) })).isError).toBe(false)
    const b = await callTool("create_contract", {
      client: split.id, name: "B", dailyRate: 700, defaultDaysPerMonth: 5, contractedDays: 15, startMonth: month(3), endMonth: month(5),
    })
    const idB = (b.payload.engagement as { id: string }).id

    const plan = (await callTool("get_plan", { months: 6 })).payload.months as {
      lines: { clientName: string; engagementId: string; revenue: number }[]
    }[]
    const revenue = (id: string) => plan.map((m) => m.lines.find((l) => l.clientName === "Split Srl" && l.engagementId === id)?.revenue ?? 0)
    expect(revenue(idA)).toEqual([6000, 6000, 6000, 0, 0, 0])
    expect(revenue(idB)).toEqual([0, 0, 0, 3500, 3500, 3500])
  })
})

describe("mcp_audit", () => {
  it("records ok and error outcomes for write tools", async () => {
    const entries = await auditEntries()
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some((e) => e.tool === "log_allocation" && e.result === "ok")).toBe(true)
    expect(entries.some((e) => e.tool === "log_allocation" && e.result === "error")).toBe(true)
    expect(entries.some((e) => e.tool === "move_opportunity" && e.result === "ok")).toBe(true)
    expect(entries.some((e) => e.tool === "create_client" && e.result === "error")).toBe(true)
    expect(entries.some((e) => e.tool === "create_invoice" && e.result === "ok")).toBe(true)
    expect(entries.some((e) => e.tool === "create_invoice" && e.result === "error")).toBe(true)
    expect(entries.some((e) => e.tool === "mark_invoice_paid" && e.result === "ok")).toBe(true)
    expect(entries.some((e) => e.tool === "log_time" && e.result === "ok")).toBe(true)
    expect(entries.some((e) => e.tool === "log_time" && e.result === "error")).toBe(true)
    // Audit writes are fire-and-forget; the newest entries may still be in flight.
    await expect
      .poll(async () => {
        const latest = await auditEntries()
        return (
          latest.some((e) => e.tool === "convert_to_engagement" && e.result === "ok") &&
          latest.some((e) => e.tool === "update_engagement" && e.result === "ok") &&
          latest.some((e) => e.tool === "add_note" && e.result === "error") &&
          latest.some((e) => e.tool === "log_meeting" && e.result === "ok") &&
          latest.some((e) => e.tool === "log_meeting" && e.result === "error") &&
          latest.some((e) => e.tool === "update_meeting" && e.result === "ok")
        )
      })
      .toBe(true)
  })
})
