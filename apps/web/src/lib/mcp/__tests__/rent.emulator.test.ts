/**
 * Rent over MCP: end-to-end through the route handler, real Firestore. Its own user.
 * Synthetic data only: invented people, houses and banks.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts).
 */
import { isoDate } from "@alter-ego/kernel/dates"
import { describeRentContract } from "@alter-ego/rent/contract"
import { format, startOfMonth, subMonths } from "date-fns"
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

const ORIGIN = "https://mcp.test"
const REDIRECT = "https://claude.ai/api/mcp/auth_callback"
const VERIFIER = "a".repeat(43)


const now = new Date()
const today = isoDate(now)
const ym = today.slice(0, 7)
const lastYm = format(subMonths(now, 1), "yyyy-MM")
const opened = isoDate(startOfMonth(subMonths(now, 2)))
const leaseStart = isoDate(startOfMonth(subMonths(now, 1)))
const leaseEnd = isoDate(new Date(now.getFullYear() + 1, now.getMonth(), 0))

const TAX_ID = "XX-TAX-77120"
const STREET = "Via Riservata 31"

let userId = ""
let writeBearer = ""
let readOnlyBearer = ""
let mainId = ""
let leaseId = ""

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
        idToken,
        clientId: oauthClient,
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
        client_id: oauthClient,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; payload: Payload }> {
  const res = await mcp(rpcRequest(writeBearer, name, args))
  expect(res.status).toBe(200)
  const dataLine = (await res.text()).split("\n").find((l) => l.startsWith("data: "))!
  const rpc = JSON.parse(dataLine.slice(6)) as { result: { isError?: boolean; content: [{ text: string }] } }
  return { isError: rpc.result.isError ?? false, payload: JSON.parse(rpc.result.content[0].text) as Payload }
}

/** The error text of a refused call. */
async function refusal(name: string, args: Record<string, unknown>): Promise<string> {
  const { isError, payload } = await callTool(name, args)
  expect(isError).toBe(true)
  return payload.error as string
}

async function callAs(bearer: string, name: string, args: Record<string, unknown> = {}) {
  const res = await mcp(rpcRequest(bearer, name, args))
  return res
}

const roomOf = async (month = ym) => {
  const { payload } = await callTool("get_rent", { month })
  return payload.properties[0].rooms[0] as Payload
}

beforeAll(async () => {
  const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), `mcp-rent-${Date.now()}@example.com`, "Test1234!")
  userId = user.uid
  const idToken = await user.getIdToken()
  writeBearer = await mintToken(idToken, "data:read data:write")
  readOnlyBearer = await mintToken(idToken, "data:read")
  mainId = (
    await getAdminFirestore().collection("users").doc(userId).collection("company_accounts").add({
      userId, name: "Bank One", openingBalance: 5000, openingDate: new Date(`${opened}T00:00:00`), statementBalance: null, statementDate: null, importRef: null,
      createdAt: new Date(), updatedAt: new Date(),
    })
  ).id
})

describe("the rent contract against the Admin SDK", () => {
  // Their own users: the contract's tenants must not reach the tools' user.
  const ids = { userId: "", otherUserId: "" }
  beforeAll(async () => {
    const make = async (tag: string) => (await createUserWithEmailAndPassword(getFirebaseAuth(), `mcp-rent-${tag}-${Date.now()}@example.com`, "Test1234!")).user.uid
    ids.userId = await make("contract")
    ids.otherUserId = await make("other")
  })
  describeRentContract(() => ({ db: admin, ...ids }))
})

describe("rent tools", () => {
  it("creates a tenant and a lease, and get_rent shows Owed for the month that ended", async () => {
    await callTool("create_tenant", {
      firstName: "Anna", surname: "Testova", taxId: TAX_ID, street: STREET, postcode: "10100", city: "Turin", country: "Italy",
    })
    const l = await callTool("create_lease", {
      tenant: "Anna Testova", property: "Via Aurora 7", room: "Room 2", rent: 800, contribution: 100, startDate: leaseStart, endDate: leaseEnd,
    })
    leaseId = l.payload.lease.id
    const room = await roomOf()
    expect(room).toMatchObject({ room: "Room 2", tenant: "Anna Testova", status: "Not yet", due: 900, paid: 0, owed: 900, leaseId })
  })

  it("links a payment to the lease and get_rent shows Paid, with neither the tax ID nor the address", async () => {
    for (const [rentPart, amount] of [["rent", 800], ["contribution", 100]] as const) {
      const r = await callTool("add_movement", {
        kind: "income", direction: "in", amount, account: "Bank One", leaseId, rentMonth: ym, rentPart, counterparty: "Anna Testova", force: true,
      })
      expect(r.payload.movement).toMatchObject({ leaseId, rentMonth: ym, rentPart })
    }
    expect(await roomOf()).toMatchObject({ status: "Paid", paid: 900, notInvoiced: true, owed: 900 })
    const { payload } = await callTool("get_rent", {})
    expect(JSON.stringify(payload)).not.toContain(TAX_ID)
    expect(JSON.stringify(payload)).not.toContain(STREET)
    expect((await callTool("get_tenant", { tenant: "Testova" })).payload.tenant).toMatchObject({ taxId: TAX_ID, street: STREET })
  })

  it("refuses an unknown lease on all three write tools", async () => {
    const bad = { leaseId: "no-such-lease" }
    expect(await refusal("add_movement", { kind: "income", direction: "in", amount: 5, account: "Bank One", rentMonth: ym, rentPart: "rent", ...bad })).toContain('No lease with id "no-such-lease"')
    const pay = (await admin.getCompanyMovements(userId))[0]
    expect(await refusal("update_movement", { id: pay.id, ...bad, rentMonth: ym, rentPart: "rent", confirm: true })).toContain('No lease with id "no-such-lease"')
    const cost = await admin.createCompanyExpense(userId, {
      description: "Offset", category: "other", amount: 100, vat: 0, date: new Date(`${today}T00:00:00`), accountId: mainId, project: "Via Aurora 7",
    })
    expect(await refusal("update_expense", { id: cost.id, ...bad, for_month: ym, confirm: true })).toContain('No lease with id "no-such-lease"')
  })

  it("update_expense previews a rent offset, writes nothing without confirm, and links it on confirm", async () => {
    const cost = (await admin.getCompanyExpenses(userId)).find((e) => e.description === "Offset")!
    const args = { id: cost.id, leaseId, for_month: ym }
    const preview = await callTool("update_expense", args)
    expect(preview.payload.preview).toBe(true)
    expect(preview.payload.changes).toEqual(expect.arrayContaining([`leaseId none → "${leaseId}"`, `forMonth none → "${ym}"`]))
    expect((await admin.getCompanyExpenses(userId)).find((e) => e.id === cost.id)).toMatchObject({ leaseId: null, forMonth: null })
    await callTool("update_expense", { ...args, confirm: true })
    expect((await admin.getCompanyExpenses(userId)).find((e) => e.id === cost.id)).toMatchObject({ leaseId, forMonth: ym })
    expect((await roomOf()).offset).toBe(100)
  })

  it("add_expense saves a rent offset in one call, linked and netted like update_expense does", async () => {
    const before = (await roomOf()).offset
    const { payload } = await callTool("add_expense", {
      description: "Offset one call", total: 40, paidFrom: "Bank One", category: "other", date: today, leaseId, for_month: ym, force: true,
    })
    expect(payload.cost).toMatchObject({ leaseId, forMonth: ym })
    expect((await admin.getCompanyExpenses(userId)).find((e) => e.id === payload.cost.id)).toMatchObject({ leaseId, forMonth: ym, collaboratorId: null })
    expect((await roomOf()).offset).toBe(before + 40)
  })

  it("update_movement keeps the lease on an edit, unlinks it on a kind change, and keeps it when the same call links again", async () => {
    const pay = (await admin.getCompanyMovements(userId)).find((m) => m.rentPart === "rent")!
    const preview = await callTool("update_movement", { id: pay.id, kind: "client_income" })
    expect(preview.payload.changes).toEqual(expect.arrayContaining([`leaseId "${leaseId}" → none`, `rentMonth "${ym}" → none`, `rentPart "rent" → none`]))
    expect((await admin.getCompanyMovements(userId)).find((m) => m.id === pay.id)).toMatchObject({ kind: "income", leaseId })

    await callTool("update_movement", { id: pay.id, description: "Rent, corrected", confirm: true })
    expect((await admin.getCompanyMovements(userId)).find((m) => m.id === pay.id)).toMatchObject({ leaseId, rentMonth: ym, rentPart: "rent" })

    await callTool("update_movement", { id: pay.id, kind: "client_income", confirm: true })
    expect((await admin.getCompanyMovements(userId)).find((m) => m.id === pay.id)).toMatchObject({ kind: "client_income", leaseId: null, rentMonth: null, rentPart: null })

    await callTool("update_movement", { id: pay.id, kind: "income", leaseId, rentMonth: ym, rentPart: "rent", confirm: true })
    expect((await admin.getCompanyMovements(userId)).find((m) => m.id === pay.id)).toMatchObject({ kind: "income", leaseId, rentMonth: ym, rentPart: "rent" })
    expect((await roomOf()).status).toBe("Paid")
  })

  it("update_lease ends a tenancy only on confirm", async () => {
    const end = lastYm + "-28"
    const preview = await callTool("update_lease", { lease: leaseId, endDate: end })
    expect(preview.payload.preview).toBe(true)
    expect((await admin.getLeases(userId)).find((l) => l.id === leaseId)!.endDate).toBe(leaseEnd)
    await callTool("update_lease", { lease: leaseId, endDate: end, confirm: true })
    expect((await admin.getLeases(userId)).find((l) => l.id === leaseId)!.endDate).toBe(end)
  })

  const book = async () => ({ movements: await admin.getCompanyMovements(userId), expenses: await admin.getCompanyExpenses(userId) })
  const movementOf = async (id: string) => (await book()).movements.find((m) => m.id === id)!
  const costOf = async (id: string) => (await book()).expenses.find((e) => e.id === id)!
  const income = { kind: "income", direction: "in", amount: 7, account: "Bank One", rentMonth: ym, rentPart: "rent", force: true }

  it("links a rent payment to money in only, and a deposit either way", async () => {
    expect(await refusal("add_movement", { ...income, direction: "out", leaseId })).toBe("A rent payment is money in: use direction in.")
    expect(await refusal("add_movement", { ...income, kind: "client_income", leaseId })).toContain("leaseId is for a rent payment")
    expect(await refusal("add_movement", { ...income, leaseId, rentPart: undefined })).toContain("A rent payment needs rentMonth")
    expect(await refusal("add_movement", { kind: "deposit_held", direction: "in", amount: 7, account: "Bank One", counterparty: "Room 2", leaseId, rentMonth: ym, force: true })).toBe(
      "A deposit names its lease only: leave out rentMonth and rentPart.",
    )
    for (const direction of ["in", "out"]) {
      const r = await callTool("add_movement", { kind: "deposit_held", direction, amount: 7, account: "Bank One", counterparty: "Room 2", leaseId, force: true })
      expect(r.payload.movement).toMatchObject({ leaseId, rentMonth: null, rentPart: null })
    }
  })

  it("update_movement: leaseId none unlinks, and income turned to money out unlinks too", async () => {
    const make = async () => (await callTool("add_movement", { ...income, leaseId })).payload.movement.id as string
    const [one, two] = [await make(), await make()]
    await callTool("update_movement", { id: one, leaseId: "none", confirm: true })
    expect(await movementOf(one)).toMatchObject({ kind: "income", leaseId: null, rentMonth: null, rentPart: null })
    expect((await callTool("update_movement", { id: two, direction: "out" })).payload.changes).toEqual(expect.arrayContaining([`leaseId "${leaseId}" → none`]))
    await callTool("update_movement", { id: two, direction: "out", confirm: true })
    expect(await movementOf(two)).toMatchObject({ direction: "out", leaseId: null })
    expect(await refusal("update_movement", { id: two, leaseId, rentMonth: ym, rentPart: "rent", confirm: true })).toBe("A rent payment is money in: use direction in.")
  })

  it("update_expense: leaseId none unlinks, a collaborator's invoice unlinks the lease, and a lease on one is refused", async () => {
    const offset = (await admin.getCompanyExpenses(userId)).find((e) => e.description === "Offset")!
    await callTool("update_expense", { id: offset.id, leaseId: "none", confirm: true })
    expect(await costOf(offset.id)).toMatchObject({ leaseId: null, collaboratorId: null })

    await callTool("add_collaborator", { name: "Studio Neri", type: "company" })
    await callTool("update_expense", { id: offset.id, leaseId, for_month: ym, confirm: true })
    expect(await refusal("update_expense", { id: offset.id, leaseId, collaborator: "Studio Neri", confirm: true })).toContain("not both")
    const preview = await callTool("update_expense", { id: offset.id, collaborator: "Studio Neri", for_month: ym })
    expect(preview.payload.changes).toEqual(expect.arrayContaining([`leaseId "${leaseId}" → none`]))
    await callTool("update_expense", { id: offset.id, collaborator: "Studio Neri", for_month: ym, confirm: true })
    const linked = await costOf(offset.id)
    expect(linked.leaseId ?? null).toBeNull()
    expect(linked.collaboratorId).toBeTruthy()
    expect(await refusal("update_expense", { id: offset.id, leaseId, confirm: true })).toContain("not both")
  })

  it("a read-only token cannot call a write tool", async () => {
    const res = await callAs(readOnlyBearer, "create_tenant", { firstName: "X", surname: "Y", taxId: "1", street: "s", postcode: "1", city: "c", country: "k" })
    expect(res.status).toBe(403)
    expect(await admin.getTenants(userId)).toHaveLength(1)
  })
})
