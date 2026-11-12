/**
 * The solution catalog over MCP — end-to-end through the route handler, real
 * Firestore. Its own user, so the list filters see only the solutions made here.
 * Synthetic data only: Nordwind Retail S.p.A. and Sudwind Logistics are invented.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts).
 */
import { isoDate } from "@alter-ego/kernel/dates"
import { createUserWithEmailAndPassword } from "firebase/auth"
import { beforeAll, describe, expect, it } from "vitest"

import { POST as mcp } from "@/app/api/mcp/route"
import { POST as approve } from "@/app/api/oauth/authorize/route"
import { POST as register } from "@/app/api/oauth/register/route"
import { POST as token } from "@/app/api/oauth/token/route"
import * as admin from "@/lib/backend/firebase-admin"
import { getAdminFirestore } from "@/lib/firebase-admin-client"
import { getFirebaseAuth } from "@/lib/firebase-client"
import { s256 } from "@/lib/oauth/pkce"
import { SOLUTION_KIND_SECTIONS, SOLUTION_SECTIONS } from "@/types/schemas"

const ORIGIN = "https://mcp.test"
const REDIRECT = "https://claude.ai/api/mcp/auth_callback"
const VERIFIER = "a".repeat(43)

let userId = ""
let bearer = ""
let graphId = ""

async function mintToken(idToken: string): Promise<string> {
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
        idToken,
        clientId: oauthClient,
        redirectUri: REDIRECT,
        scope: "data:read data:write",
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
        client_id: oauthClient,
        redirect_uri: REDIRECT,
      }),
    })
  )
  return ((await tok.json()) as { access_token: string }).access_token
}

/** The JSON-RPC result of a tools/call: the tools' own JSON, or the SDK's plain-text refusal. */
async function rpc(name: string, args: Record<string, unknown>) {
  const res = await mcp(
    new Request(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    })
  )
  expect(res.status).toBe(200)
  const dataLine = (await res.text()).split("\n").find((l) => l.startsWith("data: "))!
  return (JSON.parse(dataLine.slice(6)) as { result: { isError?: boolean; content: [{ text: string }] } }).result
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<Payload> {
  const result = await rpc(name, args)
  const payload = JSON.parse(result.content[0].text) as Payload
  expect(result.isError ?? false, payload.error).toBe(false)
  return payload
}

/** The error text of a refused call. */
async function refusal(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await rpc(name, args)
  expect(result.isError).toBe(true)
  return (JSON.parse(result.content[0].text) as { error: string }).error
}

const stored = async (id: string) => (await admin.getSolutions(userId)).find((s) => s.id === id)!

beforeAll(async () => {
  const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), `mcp-solutions-${Date.now()}@example.com`, "Test1234!")
  userId = user.uid
  bearer = await mintToken(await user.getIdToken())

  const contract = { dailyRate: 900, vatApplicable: true, defaultDaysPerMonth: 5 }
  const nordwind = await admin.createClient(userId, { name: "Nordwind Retail S.p.A." })
  const sudwind = await admin.createClient(userId, { name: "Sudwind Logistics" })
  const graph = await admin.createEngagement(userId, { ...contract, clientId: nordwind.id, name: "Product graph" })
  await admin.createEngagement(userId, { ...contract, clientId: sudwind.id, name: "Fleet graph" })
  // A light stated, then a later call that states none: the light holds, the last meeting moves.
  await admin.createMeeting(userId, { clientId: nordwind.id, engagementId: graph.id, date: "2026-09-01", time: null, health: "green", text: "Kick-off." })
  await admin.createMeeting(userId, { clientId: nordwind.id, engagementId: graph.id, date: "2026-09-15", time: null, health: null, text: "Graph schema review." })
})

describe("create_solution", () => {
  it("creates an empty product and replies with the seven sections it asks for, one interview question each", async () => {
    const out = await callTool("create_solution", {
      client: "Nordwind",
      name: "Product knowledge graph",
      engagementId: "Product graph",
      domain: "retail",
      stack: ["Neo4j", "gds", "kafka"],
    })
    graphId = out.solution.id
    expect(out.solution).toMatchObject({
      name: "Product knowledge graph",
      client: "Nordwind Retail S.p.A.",
      contract: "Product graph",
      contractState: "Active",
      status: "proposed",
      domain: "retail",
      stack: ["neo4j", "gds", "kafka"],
    })
    expect(out.solution).toMatchObject({ kind: "product", target: null, steps: [], nowStep: null })
    expect(out.solution.missingSections).toEqual(SOLUTION_KIND_SECTIONS.product)
    // Steps and History are not asked: the road and the journal replace them.
    expect(out.interview).toEqual(
      SOLUTION_SECTIONS.filter((x) => SOLUTION_KIND_SECTIONS.product.includes(x.key)).map(({ key, label, question }) => ({ section: key, label, question }))
    )
    expect(out.next).toContain("one question at a time")
    expect(out.next).toContain("update_solution")
    expect(Object.values((await stored(graphId)).sections).every((t) => t === null)).toBe(true)
  })

  it("refuses a name the client already has, whatever its case", async () => {
    const before = (await admin.getSolutions(userId)).length
    expect(await refusal("create_solution", { client: "Nordwind", name: "product KNOWLEDGE graph" })).toContain(
      `Nordwind Retail S.p.A. already has a solution named "Product knowledge graph" (id ${graphId})`
    )
    expect(await admin.getSolutions(userId)).toHaveLength(before)
  })

  it("refuses another client's contract", async () => {
    const before = (await admin.getSolutions(userId)).length
    const error = await refusal("create_solution", { client: "Nordwind", name: "Fleet routing", engagementId: "Fleet graph" })
    expect(error).toContain('No contract matches "Fleet graph"')
    expect(error).toContain("Product graph")
    expect(await admin.getSolutions(userId)).toHaveLength(before)
  })
})

describe("update_solution", () => {
  it("refuses a call with nothing to change", async () => {
    expect(await refusal("update_solution", { solution: "Product knowledge graph" })).toContain("Nothing to change")
    expect(await refusal("update_solution", { solution: "Product knowledge graph", append: true })).toContain("Nothing to change")
  })

  it("writes one section per call, leaving the others as they were", async () => {
    await callTool("update_solution", { solution: "Product knowledge graph", section: "purpose", text: "One graph of every product.\nFor search and recommendations." })
    const out = await callTool("update_solution", { solution: graphId, section: "kpis", text: "Search time from 4 s to 0.5 s." })
    const s = await stored(graphId)
    expect(s.sections.purpose).toBe("One graph of every product.\nFor search and recommendations.")
    expect(s.sections.kpis).toBe("Search time from 4 s to 0.5 s.")
    expect(out.summary).toContain("KPIs written")
    // The interview goes on: the reply lists what is still empty, with its question.
    expect(out.solution.missingSections).toEqual(["requirements", "sources", "model", "architecture", "results"])
    expect(out.interview[0]).toEqual({ section: "requirements", label: "Requirements", question: SOLUTION_SECTIONS[1].question })
  })

  it("refuses text without a section, and a section without text", async () => {
    expect(await refusal("update_solution", { solution: graphId, text: "Anything" })).toContain("Pass section")
    expect(await refusal("update_solution", { solution: graphId, section: "steps" })).toContain("Pass text")
  })

  it("appends to history on a new line", async () => {
    await callTool("update_solution", { solution: graphId, section: "history", text: "2026-03-01: chose GDS for similarity." })
    const out = await callTool("update_solution", { solution: graphId, section: "history", text: "2026-05-10: moved ingestion to Kafka.", append: true })
    expect((await stored(graphId)).sections.history).toBe("2026-03-01: chose GDS for similarity.\n2026-05-10: moved ingestion to Kafka.")
    expect(out.summary).toContain("History: a line added")
  })

  it("refuses an append or a text over 20,000 characters, saying the length, and writes nothing", async () => {
    await callTool("update_solution", { solution: graphId, section: "steps", text: "x".repeat(19_990) })
    const before = await stored(graphId)
    const error = await refusal("update_solution", { solution: graphId, section: "steps", text: "y".repeat(20), append: true })
    expect(error).toContain("Steps holds 19,990 characters; adding this line makes 20,011, over the 20,000")
    expect(error).toContain("Nothing was written")
    expect(await refusal("update_solution", { solution: graphId, section: "results", text: "z".repeat(20_001) })).toContain("The text is 20,001 characters")
    const after = await stored(graphId)
    expect(after.sections).toEqual(before.sections)
    expect(after.updatedAt).toEqual(before.updatedAt)
  })

  it("clears a section with text \"\" or null", async () => {
    await callTool("update_solution", { solution: graphId, section: "steps", text: "" })
    expect((await stored(graphId)).sections.steps).toBeNull()
    await callTool("update_solution", { solution: graphId, section: "kpis", text: null })
    expect((await stored(graphId)).sections.kpis).toBeNull()
    expect((await stored(graphId)).sections.purpose).not.toBeNull()
  })

  it("replaces entities and relations whole", async () => {
    await callTool("update_solution", {
      solution: graphId,
      entities: [
        { name: "Product", source: "SAP MARA" },
        { name: "Category", source: "PIM", notes: "Three levels" },
        { name: "Store" },
      ],
      relations: [
        { from: "Product", to: "Category", type: "IN_CATEGORY" },
        { from: "Product", to: "Store", type: "SOLD_AT" },
      ],
    })
    await callTool("update_solution", {
      solution: graphId,
      entities: [{ name: "Product", source: "SAP MARA" }, { name: "Category", source: "PIM" }],
      relations: [{ from: "Product", to: "Category", type: "IN_CATEGORY" }],
    })
    const s = await stored(graphId)
    expect(s.entities).toEqual([
      { name: "Product", source: "SAP MARA", notes: null },
      { name: "Category", source: "PIM", notes: null },
    ])
    expect(s.relations).toEqual([{ from: "Product", to: "Category", type: "IN_CATEGORY" }])
  })

  it("refuses a relation naming a missing entity, naming the relation, and writes nothing", async () => {
    const before = await stored(graphId)
    const error = await refusal("update_solution", {
      solution: graphId,
      relations: [{ from: "Product", to: "Category", type: "IN_CATEGORY" }, { from: "Product", to: "Store", type: "SOLD_AT" }],
    })
    expect(error).toContain('Relation Product -SOLD_AT-> Store: No entity is named "Store"')
    // Entities alone, dropping one a stored relation names: refused too.
    expect(await refusal("update_solution", { solution: graphId, entities: [{ name: "Product" }] })).toContain(
      'Relation Product -IN_CATEGORY-> Category: No entity is named "Category"'
    )
    const after = await stored(graphId)
    expect([after.entities, after.relations]).toEqual([before.entities, before.relations])
  })

  it("unlinks the contract with engagementId null, and links it again by name", async () => {
    const out = await callTool("update_solution", { solution: graphId, engagementId: null })
    expect(out.solution).toMatchObject({ engagementId: null, contract: null, contractState: "Pre-sales" })
    expect((await stored(graphId)).engagementId).toBeNull()
    const back = await callTool("update_solution", { solution: graphId, engagementId: "Product graph", status: "delivered" })
    expect(back.solution).toMatchObject({ contract: "Product graph", status: "delivered" })
  })

  it("refuses another client's contract, and writes nothing", async () => {
    const before = await stored(graphId)
    const error = await refusal("update_solution", { solution: graphId, engagementId: "Fleet graph" })
    expect(error).toContain('No contract matches "Fleet graph"')
    expect(error).toContain("Product graph")
    expect(await stored(graphId)).toEqual(before)
  })
})

describe("list_solutions and get_solution", () => {
  beforeAll(async () => {
    await callTool("create_solution", { client: "Nordwind", name: "Store search", status: "building", stack: ["elasticsearch"] })
    // On a contract with no meetings yet: get_solution leaves its health out.
    await callTool("create_solution", { client: "Sudwind", name: "Product knowledge graph", engagementId: "Fleet graph", stack: ["neo4j"] })
  })

  it("lists the most recently updated first, with the purpose's first line and the empty sections", async () => {
    const out = await callTool("list_solutions")
    expect(out.solutions.map((s: Payload) => [s.name, s.client])).toEqual([
      ["Product knowledge graph", "Sudwind Logistics"],
      ["Store search", "Nordwind Retail S.p.A."],
      ["Product knowledge graph", "Nordwind Retail S.p.A."],
    ])
    const graph = out.solutions[2]
    expect(graph).toMatchObject({ contract: "Product graph", purpose: "One graph of every product." })
    expect(graph.missingSections).toEqual(["requirements", "kpis", "sources", "model", "architecture", "results"])
    expect(out.solutions[1]).toMatchObject({ contract: null, contractState: "Pre-sales", purpose: null })
  })

  it("filters by client, status, stack in any case, and text in the name, domain, stack or a section", async () => {
    const names = async (args: Record<string, unknown>) =>
      (await callTool("list_solutions", args)).solutions.map((s: Payload) => `${s.name} / ${s.client}`)
    expect(await names({ client: "Nordwind" })).toEqual(["Store search / Nordwind Retail S.p.A.", "Product knowledge graph / Nordwind Retail S.p.A."])
    expect(await names({ status: "building" })).toEqual(["Store search / Nordwind Retail S.p.A."])
    expect(await names({ stack: "NEO4J" })).toEqual(["Product knowledge graph / Sudwind Logistics", "Product knowledge graph / Nordwind Retail S.p.A."])
    expect(await names({ query: "RECOMMENDATIONS" })).toEqual(["Product knowledge graph / Nordwind Retail S.p.A."])
    expect(await names({ query: "search", client: "Nordwind" })).toEqual(["Store search / Nordwind Retail S.p.A.", "Product knowledge graph / Nordwind Retail S.p.A."])
    // The page's search: the domain and the stack count too, though no section names them.
    expect(await names({ query: "RETAIL" })).toEqual(["Product knowledge graph / Nordwind Retail S.p.A."])
    expect(await names({ query: "elastic" })).toEqual(["Store search / Nordwind Retail S.p.A."])
  })

  it("says so when nothing matches", async () => {
    const out = await callTool("list_solutions", { stack: "kafka", status: "retired" })
    expect(out.solutions).toEqual([])
    expect(out.summary).toBe("No solution matches status retired, stack kafka (3 in the catalog).")
  })

  it("refuses a name two clients share, listing both with their clients; client picks one", async () => {
    const error = await refusal("get_solution", { solution: "product knowledge graph" })
    expect(error).toContain("Several solutions match")
    expect(error).toContain("Product knowledge graph (Nordwind Retail S.p.A.")
    expect(error).toContain("Product knowledge graph (Sudwind Logistics")
    const out = await callTool("get_solution", { solution: "product knowledge graph", client: "Sudwind" })
    expect(out.solution.client).toBe("Sudwind Logistics")
  })

  it("returns the whole record, with the contract's health and its last meeting read from the meetings", async () => {
    const out = await callTool("get_solution", { solution: graphId })
    expect(out.solution).toMatchObject({
      name: "Product knowledge graph",
      contract: "Product graph",
      status: "delivered",
      domain: "retail",
      stack: ["neo4j", "gds", "kafka"],
      contractHealth: "green",
      contractHealthAsOf: "2026-09-01",
      lastMeetingDate: "2026-09-15",
    })
    expect(out.sections.map((s: Payload) => s.key)).toEqual(SOLUTION_SECTIONS.map((s) => s.key))
    expect(out.sections.find((s: Payload) => s.key === "requirements")).toEqual({ key: "requirements", label: "Requirements", text: null })
    expect(out.entities).toEqual([
      { name: "Product", source: "SAP MARA", notes: null },
      { name: "Category", source: "PIM", notes: null },
    ])
    expect(out.relations).toEqual([{ from: "Product", to: "Category", type: "IN_CATEGORY" }])
    expect(out.missingSections).toEqual(out.solution.missingSections)
    expect(out.summary).toContain("1 of 7 sections written")
    expect(out.summary).toContain("green since 2026-09-01, last meeting 2026-09-15")
  })

  it("returns only the sections asked for", async () => {
    const out = await callTool("get_solution", { solution: graphId, sections: ["history", "purpose"] })
    expect(out.sections.map((s: Payload) => s.key)).toEqual(["purpose", "history"])
  })

  it("refuses an unknown section key, listing the nine", async () => {
    const result = await rpc("get_solution", { solution: graphId, sections: ["purpose", "budget"] })
    expect(result.isError).toBe(true)
    for (const { key } of SOLUTION_SECTIONS) expect(result.content[0].text).toContain(key)
  })

  it("leaves the contract's health out in pre-sales, and before the contract's first meeting", async () => {
    const out = await callTool("get_solution", { solution: "Store search" })
    expect(out.solution.contractState).toBe("Pre-sales")
    expect(out.solution).not.toHaveProperty("contractHealth")
    expect(out.solution).not.toHaveProperty("lastMeetingDate")
    const unmet = await callTool("get_solution", { solution: "Product knowledge graph", client: "Sudwind" })
    expect(unmet.solution.contract).toBe("Fleet graph")
    expect(unmet.solution).not.toHaveProperty("contractHealth")
    expect(unmet.solution).not.toHaveProperty("contractHealthAsOf")
    expect(unmet.solution).not.toHaveProperty("lastMeetingDate")
    expect(unmet.summary).not.toContain("last meeting")
  })

  // Last: a rename moves the solution up the newest-first list above.
  it("refuses a rename to a name the client already has, but takes a new case of its own name", async () => {
    const search = (await admin.getSolutions(userId)).find((s) => s.name === "Store search")!
    expect(await refusal("update_solution", { solution: "Store search", client: "Nordwind", name: "product knowledge GRAPH" })).toContain(
      `Nordwind Retail S.p.A. already has a solution named "Product knowledge graph" (id ${graphId})`
    )
    expect(await stored(search.id)).toEqual(search)
    const out = await callTool("update_solution", { solution: graphId, name: "PRODUCT knowledge graph" })
    expect(out.solution.name).toBe("PRODUCT knowledge graph")
    expect((await stored(graphId)).name).toBe("PRODUCT knowledge graph")
  })
})

describe("a solution's kind, target and road", () => {
  let tuningId = ""
  let productGraphId = ""

  beforeAll(async () => {
    const [nordwind, sudwind] = await admin.getClients(userId)
    const [graphContract] = (await admin.getEngagements(userId)).filter((e) => e.name === "Product graph")
    productGraphId = graphContract.id
    const opp = { stage: "proposal", probability: 50, dailyRate: 900, estimatedDaysPerMonth: 5, estimatedDurationMonths: 3, vatApplicable: true } as const
    await admin.createOpportunity(userId, { ...opp, clientId: nordwind.id, title: "Phase two" })
    const won = await admin.createOpportunity(userId, { ...opp, clientId: nordwind.id, title: "Phase three" })
    await admin.updateOpportunity(userId, won.id, { engagementId: graphContract.id })
    await admin.createOpportunity(userId, { ...opp, clientId: sudwind.id, title: "Fleet phase two" })
  })

  const road = async () => (await stored(tuningId)).steps.map((x) => [x.title, x.state])

  it("create_solution with kind advisory stores kind and target and asks three questions", async () => {
    const out = await callTool("create_solution", { client: "Nordwind", name: "Query tuning", kind: "advisory", target: "Every report under 2 s" })
    tuningId = out.solution.id
    expect(out.solution).toMatchObject({ kind: "advisory", target: "Every report under 2 s", steps: [], nowStep: null })
    expect(out.interview.map((q: Payload) => [q.section, q.label])).toEqual([
      ["purpose", "Purpose and Target"], ["kpis", "KPIs"], ["results", "Results and Lessons"],
    ])
    expect(await stored(tuningId)).toMatchObject({ kind: "advisory", target: "Every report under 2 s" })
  })

  it("update_solution changes kind and target, and clears the target with null", async () => {
    await callTool("update_solution", { solution: tuningId, kind: "product", target: "Reports under 1 s" })
    expect(await stored(tuningId)).toMatchObject({ kind: "product", target: "Reports under 1 s" })
    await callTool("update_solution", { solution: tuningId, kind: "advisory", target: null })
    expect(await stored(tuningId)).toMatchObject({ kind: "advisory", target: null })
    expect(await refusal("update_solution", { solution: tuningId, target: "x".repeat(501) })).toContain("At most 500 characters")
  })

  it("a new title adds a step, in order, paid by one of the client's opportunities", async () => {
    await callTool("update_solution", { solution: tuningId, step: "Audit", fromMonth: "2026-03", toMonth: "2026-03", stepState: "now", goal: "Find the slow queries" })
    const out = await callTool("update_solution", { solution: tuningId, step: "Tune", fromMonth: "2026-04", paidBy: "Phase two" })
    await callTool("update_solution", { solution: tuningId, step: "Hand over", fromMonth: "2026-09", stepState: "later" })
    expect(await road()).toEqual([["Audit", "now"], ["Tune", "next"], ["Hand over", "later"]])
    expect(out.solution.steps[1]).toMatchObject({ number: 2, title: "Tune", paidBy: { type: "opportunity", name: "Phase two" } })
    expect(out.solution.nowStep).toMatchObject({ number: 1, title: "Audit" })
    expect((await stored(tuningId)).steps[0]).toMatchObject({ toMonth: "2026-03", goal: "Find the slow queries", outcome: null, doneOn: null })
  })

  it("refuses a second Now step, a new step with no from month, and a step number that is not there, and writes nothing", async () => {
    expect(await refusal("update_solution", { solution: tuningId, step: "Tune", stepState: "now" })).toContain("Only one step can be Now")
    expect(await refusal("update_solution", { solution: tuningId, step: "Review" })).toContain("fromMonth")
    expect(await refusal("update_solution", { solution: tuningId, step: 9, stepState: "next" })).toContain("There are 3 steps")
    expect(await refusal("update_solution", { solution: tuningId, step: "Tune", toMonth: "2026-01" })).toContain("The end is before the start")
    expect(await road()).toEqual([["Audit", "now"], ["Tune", "next"], ["Hand over", "later"]])
  })

  it("asks for the outcome to mark a step Done, then moves Now to the next step", async () => {
    expect(await refusal("update_solution", { solution: tuningId, step: "Audit", stepState: "done" })).toContain("outcome")
    expect(await road()).toEqual([["Audit", "now"], ["Tune", "next"], ["Hand over", "later"]])
    const out = await callTool("update_solution", { solution: tuningId, step: 1, stepState: "done", outcome: "Nine slow queries found" })
    expect(await road()).toEqual([["Audit", "done"], ["Tune", "now"], ["Hand over", "later"]])
    expect((await stored(tuningId)).steps[0]).toMatchObject({ outcome: "Nine slow queries found", doneOn: isoDate(new Date()) })
    expect(out.solution.nowStep).toMatchObject({ number: 2, title: "Tune" })
    expect(out.summary).toContain('step 1 "Audit" done')
    expect(out.summary).toContain('"Tune" is now')
  })

  it("follows a won opportunity to its contract when read, and refuses another client's contract or opportunity", async () => {
    await callTool("update_solution", { solution: tuningId, step: "Hand over", paidBy: "Phase three" })
    const out = await callTool("get_solution", { solution: tuningId })
    expect(out.solution.steps.map((x: Payload) => x.paidBy)).toEqual([
      null,
      expect.objectContaining({ type: "opportunity", name: "Phase two" }),
      { type: "contract", id: productGraphId, name: "Product graph" },
    ])
    for (const other of ["Fleet graph", "Fleet phase two"]) {
      expect(await refusal("update_solution", { solution: tuningId, step: "Tune", paidBy: other })).toContain("No contract or opportunity of Nordwind Retail S.p.A. matches")
    }
    expect((await stored(tuningId)).steps[1].paidBy).toMatchObject({ type: "opportunity" })
    await callTool("update_solution", { solution: tuningId, step: "Tune", paidBy: null })
    expect((await stored(tuningId)).steps[1].paidBy).toBeNull()
  })

  it("a Done step keeps its outcome; reopening it clears the outcome and the day, and doing it again asks for a new outcome", async () => {
    expect(await refusal("update_solution", { solution: tuningId, step: "Audit", outcome: null })).toContain("outcome")
    expect((await stored(tuningId)).steps[0]).toMatchObject({ outcome: "Nine slow queries found", doneOn: isoDate(new Date()) })
    await callTool("update_solution", { solution: tuningId, step: "Audit", stepState: "later" })
    expect((await stored(tuningId)).steps[0]).toMatchObject({ state: "later", outcome: null, doneOn: null })
    expect(await refusal("update_solution", { solution: tuningId, step: "Audit", stepState: "done" })).toContain("outcome")
    await callTool("update_solution", { solution: tuningId, step: "Audit", stepState: "done", outcome: "Eleven slow queries found" })
    expect((await stored(tuningId)).steps[0]).toMatchObject({ state: "done", outcome: "Eleven slow queries found", doneOn: isoDate(new Date()) })
  })

  it("refuses an empty paidBy instead of ignoring it", async () => {
    // A schema refusal, so it never reaches the handler: its text is not the JSON the handler's errors are.
    const result = await rpc("update_solution", { solution: tuningId, step: "Tune", paidBy: "" })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("paidBy")
  })

  it("removeStep deletes one by title or number", async () => {
    await callTool("update_solution", { solution: tuningId, removeStep: "Hand over" })
    expect(await road()).toEqual([["Audit", "done"], ["Tune", "now"]])
    await callTool("update_solution", { solution: tuningId, removeStep: 1 })
    expect(await road()).toEqual([["Tune", "now"]])
  })

  it("list_solutions and get_solution return kind, target, steps and the Now step", async () => {
    await callTool("update_solution", { solution: tuningId, target: "Every report under 2 s" })
    const row = (await callTool("list_solutions", { client: "Nordwind", query: "tuning" })).solutions[0]
    expect(row).toMatchObject({ name: "Query tuning", kind: "advisory", target: "Every report under 2 s", nowStep: { number: 1, title: "Tune" } })
    expect(row.steps).toHaveLength(1)
    const out = await callTool("get_solution", { solution: tuningId })
    expect(out.solution).toMatchObject({ kind: "advisory", nowStep: { title: "Tune" } })
    expect(out.summary).toContain("0 of 3 sections written")
  })
})

describe("log_work", () => {
  let solutionId = ""
  let contractId = ""

  beforeAll(async () => {
    const [nordwind] = (await admin.getClients(userId)).filter((c) => c.name.startsWith("Nordwind"))
    contractId = (await admin.getEngagements(userId)).find((e) => e.name === "Product graph")!.id
    const step = { goal: null, outcome: null, doneOn: null, toMonth: null } as const
    solutionId = (
      await admin.createSolution(userId, {
        clientId: nordwind.id,
        name: "Guest journal",
        steps: [
          { ...step, title: "Proof of concept", state: "done", fromMonth: "2026-08", paidBy: null, outcome: "Report sent", doneOn: "2026-09-12" },
          { ...step, title: "MVP", state: "now", fromMonth: "2026-10", paidBy: { type: "contract", id: contractId } },
          { ...step, title: "Rollout", state: "later", fromMonth: "2026-12", paidBy: null },
        ],
      })
    ).id
    await admin.createSolution(userId, { clientId: nordwind.id, name: "Other journal", steps: [{ ...step, title: "Only here", state: "now", fromMonth: "2026-10", paidBy: null }] })
    await admin.createTask(userId, { clientId: nordwind.id, engagementId: contractId, title: "Nightly run" })
    await admin.createTask(userId, { clientId: nordwind.id, engagementId: contractId, title: "Backup test" })
    const done = await admin.createTask(userId, { clientId: nordwind.id, engagementId: contractId, title: "Finished one" })
    await admin.updateTask(userId, done.id, { isDone: true })
  })

  const entries = async (id: string) => (await admin.getJournal(userId)).filter((e) => e.solutionId === id)

  it("files on the Now step, and the reply names the step and its open tasks", async () => {
    const out = await callTool("log_work", {
      solution: "Guest journal",
      did: "Loading rewritten as idempotent Cypher.",
      decisions: ["A stay's spend goes to the booking holder."],
      links: ["PR #7"],
      next: "One nightly run.",
      source: "guest-360",
    })
    expect(out.summary).toBe("Filed on Guest journal, step 2 MVP. 2 open tasks on this step: Backup test, Nightly run.")
    expect(out.openTasks.map((t: { title: string }) => t.title).sort()).toEqual(["Backup test", "Nightly run"])
    expect(await entries(solutionId)).toMatchObject([
      {
        kind: "work", stepTitle: "MVP", text: "Loading rewritten as idempotent Cypher.", links: ["PR #7"],
        decisions: ["A stay's spend goes to the booking holder."], next: "One nightly run.", source: "Claude Code · guest-360",
      },
    ])
  })

  it("files on a step named by number or title, and a decision alone becomes a decision entry", async () => {
    const out = await callTool("log_work", { solution: solutionId, step: 3, did: "Planned the rollout." })
    expect(out.summary).toBe("Filed on Guest journal, step 3 Rollout. No contract pays for this step, so no tasks to list.")
    await callTool("log_work", { solution: solutionId, step: "proof of concept", decisions: ["Italian and English reports."] })
    const all = await entries(solutionId)
    expect(all.find((e) => e.kind === "decision")).toMatchObject({ stepTitle: "Proof of concept", text: "Italian and English reports.", decisions: [], source: "Claude Code" })
    expect(all.find((e) => e.text === "Planned the rollout.")).toMatchObject({ stepTitle: "Rollout" })
  })

  it("refuses a step of another solution, and a call with neither did nor decisions, and writes nothing", async () => {
    const before = (await entries(solutionId)).length
    expect(await refusal("log_work", { solution: solutionId, step: "Only here", did: "x" })).toContain('No single step is "Only here"')
    expect(await refusal("log_work", { solution: solutionId, step: 9, did: "x" })).toContain('No single step is "9"')
    expect(await refusal("log_work", { solution: solutionId })).toContain("did")
    expect(await refusal("log_work", { solution: solutionId, did: "x".repeat(5001) })).toContain("5000")
    expect((await entries(solutionId)).length).toBe(before)
  })

  it("refuses links and next without did, and decisions past the caps, and writes nothing", async () => {
    const before = (await entries(solutionId)).length
    expect(await refusal("log_work", { solution: solutionId, decisions: ["A"], links: ["PR #1"] })).toContain("links and next go with did")
    expect(await refusal("log_work", { solution: solutionId, decisions: ["A"], next: "Ship it" })).toContain("links and next go with did")
    expect(await refusal("log_work", { solution: solutionId, decisions: ["x".repeat(501)] })).toContain("At most 500 characters")
    expect(await refusal("log_work", { solution: solutionId, decisions: Array.from({ length: 11 }, (_, i) => `D${i}`) })).toContain("At most 10 decisions")
    expect((await entries(solutionId)).length).toBe(before)
  })

  it("get_solution returns the latest entries, newest first", async () => {
    const out = await callTool("get_solution", { solution: solutionId })
    expect(out.journal.length).toBe(3)
    expect(out.journal[0]).toMatchObject({ kind: expect.any(String), date: isoDate(new Date()) })
    expect(out.journal.map((e: { text: string }) => e.text)).toContain("Planned the rollout.")
  })

  it("audits every call, refused or done", async () => {
    const audit = () => getAdminFirestore().collection("users").doc(userId).collection("mcp_audit").where("tool", "==", "log_work").get()
    await expect.poll(async () => new Set((await audit()).docs.map((d) => d.get("result"))).size).toBe(2)
    const done = (await audit()).docs.find((d) => d.get("result") === "ok" && d.get("params")?.solution === "Guest journal")!
    expect(done.get("params")).toMatchObject({ solution: "Guest journal", did: "Loading rewritten as idempotent Cypher." })
  })
})
