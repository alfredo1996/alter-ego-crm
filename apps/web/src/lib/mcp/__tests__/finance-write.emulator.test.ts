/**
 * MCP finance write tools — end-to-end through the route handler, real Firestore.
 *
 * The load-bearing assertions are the balance invariants: after every add,
 * edit and delete the account balances must equal what the ledger engine says
 * they should. A write tool that records the row but leaves the balance wrong
 * is worse than one that fails.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts).
 */
import { ARCHIVE_REFUSAL } from "@alter-ego/finance/lib/account-ledger"
import { createUserWithEmailAndPassword } from "firebase/auth"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

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

const today = new Date()
const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`

let userId = ""
let writeBearer = ""
let readOnlyBearer = ""
let checkingId = ""
let savingsId = ""
let cardId = ""

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

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<{
  isError: boolean
  payload: Record<string, unknown>
}> {
  const res = await mcp(rpcRequest(writeBearer, name, args))
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

async function balanceOf(accountId: string): Promise<number> {
  return (await admin.getAccount(userId, accountId))!.balance
}

async function auditEntries(): Promise<{ tool: string; result: string; preview?: boolean; documentIds?: string[]; params?: { id?: string } }[]> {
  const snap = await getAdminFirestore()
    .collection("users").doc(userId).collection("mcp_audit").get()
  return snap.docs.map((d) => d.data() as { tool: string; result: string; preview?: boolean; documentIds?: string[]; params?: { id?: string } })
}

async function seedAccount(name: string, type: string, balance: number, currency = "EUR"): Promise<string> {
  const ref = await getAdminFirestore()
    .collection("users").doc(userId).collection("accounts")
    .add({
      userId, name, type, kind: null, currency, balance, openingBalance: balance,
      icon: null, color: null, isArchived: false, createdAt: new Date(), updatedAt: new Date(),
    })
  return ref.id
}

/** Wipes transactions and resets balances so each test starts from a known ledger. */
async function resetLedger() {
  const db = getAdminFirestore()
  const snap = await db.collection("users").doc(userId).collection("transactions").get()
  await Promise.all(snap.docs.map((d) => d.ref.delete()))
  const totals = await db.collection("users").doc(userId).collection("monthly_totals").get()
  await Promise.all(totals.docs.map((d) => d.ref.delete()))
  await Promise.all([
    db.collection("users").doc(userId).collection("accounts").doc(checkingId).update({ balance: 5000 }),
    db.collection("users").doc(userId).collection("accounts").doc(savingsId).update({ balance: 2000 }),
    db.collection("users").doc(userId).collection("accounts").doc(cardId).update({ balance: 0 }),
  ])
}

beforeAll(async () => {
  const { user } = await createUserWithEmailAndPassword(
    getFirebaseAuth(),
    `mcp-finw-${Date.now()}@example.com`,
    "Test1234!"
  )
  userId = user.uid
  const idToken = await user.getIdToken()
  writeBearer = await mintToken(idToken, "data:read data:write")
  readOnlyBearer = await mintToken(idToken, "data:read")

  checkingId = await seedAccount("Conto Corrente", "checking", 5000)
  savingsId = await seedAccount("Libretto", "savings", 2000)
  cardId = await seedAccount("Carta di Credito", "credit_card", 0)

  // Referenced by name in the tests, so the id is not kept.
  await getAdminFirestore()
    .collection("users").doc(userId).collection("categories")
    .add({
      userId, name: "Spesa Alimentare", group: "expense", icon: "ShoppingCart",
      color: "#22c55e", parentId: null, isDefault: false, createdAt: new Date(), updatedAt: new Date(),
    })
})

beforeEach(resetLedger)

describe("scope gate", () => {
  it("read-only token calling a finance write tool gets 403 insufficient_scope", async () => {
    const res = await mcp(
      rpcRequest(readOnlyBearer, "add_transaction", {
        type: "expense", amount: 10, description: "Caffè", account: "Conto Corrente",
      })
    )
    expect(res.status).toBe(403)
    expect(res.headers.get("WWW-Authenticate") ?? "").toContain('error="insufficient_scope"')
    const { error_description: text } = (await res.json()) as { error_description: string }
    expect(text).toContain("This credential was granted: data:read. The add_transaction tool needs data:write.")
    expect(text).toContain("or use an API key, which carries every scope (data:read data:write).")
  })

  // #157 points a read-only caller at an API key; the key must actually write.
  it("lets an API key write, as the 403 promises", async () => {
    const { key } = await admin.createApiKey(userId)
    const res = await mcp(
      rpcRequest(key, "add_transaction", {
        type: "expense", amount: 10, description: "Caffè", account: "Conto Corrente",
      })
    )
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain('"isError":true')
  })

  it("does not gate the finance read tools", async () => {
    const res = await mcp(rpcRequest(readOnlyBearer, "list_accounts", {}))
    expect(res.status).toBe(200)
  })
})

describe("add_transaction", () => {
  it("records an expense and debits the account", async () => {
    const { isError, payload } = await callTool("add_transaction", {
      type: "expense", amount: 45.5, description: "Esselunga",
      account: "Conto Corrente", category: "Spesa Alimentare",
    })
    expect(isError).toBe(false)
    expect(payload.transaction).toMatchObject({
      type: "expense", amount: 45.5, account: "Conto Corrente", category: "Spesa Alimentare",
      currency: "EUR", date: todayIso,
    })
    expect(await balanceOf(checkingId)).toBe(4954.5)
  })

  it("records income and credits the account", async () => {
    await callTool("add_transaction", {
      type: "income", amount: 3000, description: "Stipendio", account: "Conto Corrente",
    })
    expect(await balanceOf(checkingId)).toBe(8000)
  })

  it("moves both sides of a transfer", async () => {
    const { payload } = await callTool("add_transaction", {
      type: "transfer", amount: 500, description: "Risparmio mensile",
      account: "Conto Corrente", toAccount: "Libretto",
    })
    expect(payload.transaction).toMatchObject({ account: "Conto Corrente", toAccount: "Libretto" })
    expect(await balanceOf(checkingId)).toBe(4500)
    expect(await balanceOf(savingsId)).toBe(2500)
  })

  it("takes the currency from the account rather than guessing", async () => {
    const { payload } = await callTool("add_transaction", {
      type: "expense", amount: 20, description: "Benzina", account: "Libretto",
    })
    expect((payload.transaction as { currency: string }).currency).toBe("EUR")
  })

  it("defaults the date to today and accepts an explicit one", async () => {
    const { payload } = await callTool("add_transaction", {
      type: "expense", amount: 12, description: "Pranzo", account: "Conto Corrente",
      date: "2026-03-09",
    })
    expect((payload.transaction as { date: string }).date).toBe("2026-03-09")
  })

  // ── The invariants nothing below this layer enforces ──────────────────────

  it("refuses a transfer with no destination instead of vaporising the money", async () => {
    const { isError, payload } = await callTool("add_transaction", {
      type: "transfer", amount: 100, description: "Giroconto", account: "Conto Corrente",
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("toAccount")
    expect(await balanceOf(checkingId)).toBe(5000)
  })

  it("refuses a transfer to the same account", async () => {
    const { isError, payload } = await callTool("add_transaction", {
      type: "transfer", amount: 100, description: "Giroconto",
      account: "Conto Corrente", toAccount: "Conto Corrente",
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("are the same")
    expect(await balanceOf(checkingId)).toBe(5000)
  })

  it("refuses toAccount on a non-transfer", async () => {
    const { isError, payload } = await callTool("add_transaction", {
      type: "expense", amount: 100, description: "Spesa",
      account: "Conto Corrente", toAccount: "Libretto",
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("only applies to transfers")
  })

  it("requires the account by name when several are open, listing them", async () => {
    const { isError, payload } = await callTool("add_transaction", {
      type: "expense", amount: 10, description: "Caffè",
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("Conto Corrente")
    expect(String(payload.error)).toContain("Libretto")
  })

  it("rejects an unknown account and an unknown category readably", async () => {
    const { payload: acc } = await callTool("add_transaction", {
      type: "expense", amount: 10, description: "Caffè", account: "Paypal",
    })
    expect(String(acc.error)).toContain("No account matches")

    const { payload: cat } = await callTool("add_transaction", {
      type: "expense", amount: 10, description: "Caffè",
      account: "Conto Corrente", category: "Criptovalute",
    })
    expect(String(cat.error)).toContain("No category matches")
  })

  it("refuses a same-day duplicate and names the existing movement", async () => {
    const first = await callTool("add_transaction", {
      type: "expense", amount: 800, description: "Affitto", account: "Conto Corrente",
    })
    const id = (first.payload.transaction as { id: string }).id

    const retry = await callTool("add_transaction", {
      type: "expense", amount: 800, description: "Affitto", account: "Conto Corrente",
    })
    expect(retry.isError).toBe(true)
    expect(String(retry.payload.error)).toContain(id)
    // The retry must not have posted a second time.
    expect(await balanceOf(checkingId)).toBe(4200)
  })

  it("force: true posts the second one when it really is a second expense", async () => {
    await callTool("add_transaction", {
      type: "expense", amount: 4, description: "Caffè", account: "Conto Corrente",
    })
    const { isError } = await callTool("add_transaction", {
      type: "expense", amount: 4, description: "Caffè", account: "Conto Corrente", force: true,
    })
    expect(isError).toBe(false)
    expect(await balanceOf(checkingId)).toBe(4992)
  })

  it("does not treat a different day as a duplicate", async () => {
    await callTool("add_transaction", {
      type: "expense", amount: 800, description: "Affitto", account: "Conto Corrente",
      date: "2026-01-01",
    })
    const { isError } = await callTool("add_transaction", {
      type: "expense", amount: 800, description: "Affitto", account: "Conto Corrente",
      date: "2026-02-01",
    })
    expect(isError).toBe(false)
  })
})

describe("update_transaction", () => {
  async function seedExpense(): Promise<string> {
    const { payload } = await callTool("add_transaction", {
      type: "expense", amount: 20, description: "Pranzo", account: "Conto Corrente",
    })
    return (payload.transaction as { id: string }).id
  }

  it("applies the balance difference when the amount changes", async () => {
    const id = await seedExpense()
    expect(await balanceOf(checkingId)).toBe(4980)

    await callTool("update_transaction", { confirm: true, id, amount: 25 })
    expect(await balanceOf(checkingId)).toBe(4975)
  })

  it("moves the money when the account changes", async () => {
    const id = await seedExpense()
    await callTool("update_transaction", { confirm: true, id, account: "Libretto" })

    expect(await balanceOf(checkingId)).toBe(5000)
    expect(await balanceOf(savingsId)).toBe(1980)
  })

  it("adjusts both old and new destination when a transfer is redirected", async () => {
    const { payload } = await callTool("add_transaction", {
      type: "transfer", amount: 300, description: "Giroconto",
      account: "Conto Corrente", toAccount: "Libretto",
    })
    const id = (payload.transaction as { id: string }).id
    expect(await balanceOf(savingsId)).toBe(2300)

    await callTool("update_transaction", { confirm: true, id, toAccount: "Carta di Credito" })

    expect(await balanceOf(checkingId)).toBe(4700) // source unchanged
    expect(await balanceOf(savingsId)).toBe(2000) // old destination refunded
    expect(await balanceOf(cardId)).toBe(300) // new destination credited
  })

  it("leaves the transfer destination alone when an unrelated field is edited", async () => {
    const { payload } = await callTool("add_transaction", {
      type: "transfer", amount: 300, description: "Giroconto",
      account: "Conto Corrente", toAccount: "Libretto",
    })
    const id = (payload.transaction as { id: string }).id

    const { payload: updated } = await callTool("update_transaction", { confirm: true, id, description: "Risparmi" })
    expect(updated.transaction).toMatchObject({ description: "Risparmi", toAccount: "Libretto" })
    expect(await balanceOf(savingsId)).toBe(2300)
  })

  it("refuses to turn an expense into a transfer with no destination", async () => {
    const id = await seedExpense()
    const { isError, payload } = await callTool("update_transaction", { confirm: true, id, type: "transfer" })

    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("toAccount")
    expect(await balanceOf(checkingId)).toBe(4980) // untouched
  })

  it("recategorises without touching the balance", async () => {
    const id = await seedExpense()
    const { payload } = await callTool("update_transaction", { confirm: true, id, category: "Spesa Alimentare" })

    expect((payload.transaction as { category: string }).category).toBe("Spesa Alimentare")
    expect(await balanceOf(checkingId)).toBe(4980)
  })

  it("rejects an unknown id and points at list_transactions", async () => {
    const { isError, payload } = await callTool("update_transaction", { confirm: true, id: "nope", amount: 5 })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("list_transactions")
  })
})

describe("delete_transaction", () => {
  it("restores the balance", async () => {
    const { payload } = await callTool("add_transaction", {
      type: "expense", amount: 60, description: "Cena", account: "Conto Corrente",
    })
    const id = (payload.transaction as { id: string }).id
    expect(await balanceOf(checkingId)).toBe(4940)

    const { isError, payload: deleted } = await callTool("delete_transaction", { confirm: true, id })
    expect(isError).toBe(false)
    expect(String(deleted.summary)).toContain("Cena")
    expect(await balanceOf(checkingId)).toBe(5000)
    expect(await admin.getTransaction(userId, id)).toBeNull()
  })

  it("restores both sides of a transfer", async () => {
    const { payload } = await callTool("add_transaction", {
      type: "transfer", amount: 250, description: "Giroconto",
      account: "Conto Corrente", toAccount: "Libretto",
    })
    await callTool("delete_transaction", { confirm: true, id: (payload.transaction as { id: string }).id })

    expect(await balanceOf(checkingId)).toBe(5000)
    expect(await balanceOf(savingsId)).toBe(2000)
  })

  it("rejects an unknown id", async () => {
    const { isError, payload } = await callTool("delete_transaction", { confirm: true, id: "nope" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("No transaction with id")
  })
})

describe("monthly totals", () => {
  const month = todayIso.slice(0, 7)
  const food = async () => (await admin.getMonthlyTotals(userId, month, month))[month]

  it("add, edit and delete keep this month's totals in step", async () => {
    expect(await food()).toEqual({ total: 0, expenseByCategory: {} }) // stored, as opening Budgets does

    const { payload } = await callTool("add_transaction", {
      type: "expense", amount: 45.5, description: "Esselunga", account: "Conto Corrente", category: "Spesa Alimentare",
    })
    const id = (payload.transaction as { id: string }).id
    const added = await food()
    expect(added.total).toBe(45.5)
    expect(Object.values(added.expenseByCategory)).toEqual([45.5])

    await callTool("update_transaction", { confirm: true, id, amount: 50 })
    expect((await food()).total).toBe(50)

    await callTool("delete_transaction", { confirm: true, id })
    expect((await food()).total).toBe(0)
  })
})

describe("replies write money in the account's currency (#317)", () => {
  it("reads $ for a USD account through create, add, duplicate, update, delete and a refused close", async () => {
    try {
      const { payload: created } = await callTool("create_account", {
        name: "Chase", type: "checking", balance: 12.5, currency: "USD",
      })
      expect(created.summary).toBe('Account "Chase" (checking) created with an opening balance of $12.50.')

      const add = { type: "expense", amount: 7.3, description: "Coffee beans", account: "Chase" }
      const { payload: added } = await callTool("add_transaction", add)
      expect(added.summary).toBe(`Expense of $7.30 recorded on Chase, ${todayIso}.`)

      const dup = await callTool("add_transaction", add)
      expect(String(dup.payload.error)).toContain('"Coffee beans" $7.30 on Chase')

      const id = (added.transaction as { id: string }).id
      const { payload: updated } = await callTool("update_transaction", { confirm: true, id, amount: 20 })
      expect(updated.summary).toBe(`Transaction updated: "Coffee beans" $20.00, ${todayIso}.`)

      const { payload: deleted } = await callTool("delete_transaction", { confirm: true, id })
      expect(String(deleted.summary)).toContain('"Coffee beans" $20.00 on Chase')

      const refused = await callTool("archive_account", { account: "Chase", archived: true })
      expect(refused.payload.error).toBe('"Chase" is at $12.50: move the balance out before closing it.')
    } finally {
      // Leaving it would make the next create_account refuse to infer a currency.
      const chase = (await admin.getAccounts(userId)).find((a) => a.name === "Chase")
      if (chase) await getAdminFirestore().collection("users").doc(userId).collection("accounts").doc(chase.id).delete()
    }
  })

  it("reads € with two decimals for a EUR account", async () => {
    const { payload } = await callTool("add_transaction", {
      type: "expense", amount: 45, description: "Esselunga", account: "Conto Corrente",
    })
    expect(payload.summary).toBe(`Expense of €45.00 recorded on Conto Corrente, ${todayIso}.`)
  })
})

describe("create_account", () => {
  it("opens an account with the starting balance as its opening balance", async () => {
    const { isError, payload } = await callTool("create_account", {
      name: "Libretto Postale",
      type: "savings",
      balance: 1500,
    })
    expect(isError).toBe(false)
    const account = payload.account as Record<string, unknown>
    expect(account).toMatchObject({ name: "Libretto Postale", type: "savings", balance: 1500 })

    const stored = (await admin.getAccounts(userId)).find((a) => a.name === "Libretto Postale")!
    expect(stored.openingBalance).toBe(1500)
    expect(stored.isArchived).toBe(false)
  })

  it("infers the currency when every existing account agrees", async () => {
    const { payload } = await callTool("create_account", { name: "Contanti", type: "cash" })
    expect((payload.account as Record<string, unknown>).currency).toBe("EUR")
    expect((payload.account as Record<string, unknown>).balance).toBe(0)
  })

  it("refuses a duplicate name", async () => {
    const { isError, payload } = await callTool("create_account", {
      name: "Conto Corrente",
      type: "checking",
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toMatch(/an account "conto corrente" already exists/i)
  })

  // The admin mapper used to drop `kind`, so an explicit override was invisible
  // on every read back and accountKind() fell through to the type default —
  // a "checking" account meant as a debt counted toward assets.
  it("keeps an explicit kind override, and net worth honours it", async () => {
    const created = await callTool("create_account", {
      name: "Fido Bancario",
      type: "checking",
      kind: "liability",
      balance: 700,
    })
    expect((created.payload.account as Record<string, unknown>).kind).toBe("liability")

    const listed = await callTool("list_accounts")
    const row = (listed.payload.accounts as Record<string, unknown>[]).find(
      (a) => a.name === "Fido Bancario"
    )!
    expect(row.kind).toBe("liability")
    expect(row.type).toBe("checking")
  })
})

describe("archive_account", () => {
  const stored = async (id: string) => (await admin.getAccount(userId, id))!

  it("closes a zero-balance account and reopens it", async () => {
    const id = await seedAccount("Revolut Chiuso", "checking", 0)
    const closed = await callTool("archive_account", { account: "Revolut Chiuso", archived: true })
    expect(closed.isError).toBe(false)
    expect(closed.payload.account).toMatchObject({ name: "Revolut Chiuso", type: "checking", balance: 0, isArchived: true })
    expect((await stored(id)).isArchived).toBe(true)

    const reopened = await callTool("archive_account", { account: id, archived: false })
    expect(reopened.payload.account).toMatchObject({ name: "Revolut Chiuso", isArchived: false })
    expect((await stored(id)).isArchived).toBe(false)
  })

  it("closes a float-residue account and replies €0.00, not the raw float (#314)", async () => {
    const id = await seedAccount("Revolut Residuo", "checking", 0.1 + 0.2 - 0.3)
    const { isError, payload } = await callTool("archive_account", { account: "Revolut Residuo", archived: true })
    expect(isError).toBe(false)
    expect(payload.summary).toBe('Account "Revolut Residuo" (checking) closed, balance €0.00.')
    expect((payload.account as { balance: number }).balance).toBe(0)
    expect((await stored(id)).isArchived).toBe(true)
  })

  it("refuses a non-zero balance, names it, and stores nothing", async () => {
    const id = await seedAccount("Revolut Pieno", "checking", 12.5)
    const { isError, payload } = await callTool("archive_account", { account: "Revolut Pieno", archived: true })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("€12.50")
    expect(String(payload.error)).toMatch(/move .* out/i)
    expect((await stored(id)).isArchived).toBe(false)
  })

  it("refuses an unknown account", async () => {
    const { isError, payload } = await callTool("archive_account", { account: "Nessuno", archived: true })
    expect(isError).toBe(true)
    expect(String(payload.error)).toMatch(/no account matches "nessuno"/i)
  })

  it("takes the archived account out of list_accounts but keeps it with includeArchived", async () => {
    const id = await seedAccount("Revolut Totali", "checking", 0)
    const names = (p: Record<string, unknown>) => (p.accounts as { name: string }[]).map((a) => a.name)
    expect(names((await callTool("list_accounts")).payload)).toContain("Revolut Totali")
    await callTool("archive_account", { account: id, archived: true })
    expect(names((await callTool("list_accounts")).payload)).not.toContain("Revolut Totali")
    const all = (await callTool("list_accounts", { includeArchived: true })).payload.accounts as {
      name: string
      isArchived: boolean
    }[]
    expect(all.find((a) => a.name === "Revolut Totali")).toMatchObject({ isArchived: true })
  })

  it("answers a transaction that lands after the check with the refusal and the new balance", async () => {
    await seedAccount("Revolut Gara", "checking", 0)
    const spy = vi.spyOn(admin, "updateAccount").mockImplementationOnce(async (uid, id) => {
      await getAdminFirestore().collection("users").doc(uid).collection("accounts").doc(id).update({ balance: 7 })
      throw new Error(ARCHIVE_REFUSAL)
    })
    const { isError, payload } = await callTool("archive_account", { account: "Revolut Gara", archived: true })
    spy.mockRestore()
    expect(isError).toBe(true)
    expect(payload.error).toBe('"Revolut Gara" is at €7.00: move the balance out before closing it.')
  })
})

describe("archived accounts take no writes (#315)", () => {
  const txCount = async (accountId: string) =>
    (await getAdminFirestore().collection("users").doc(userId).collection("transactions")
      .where("accountId", "==", accountId).get()).size
  const closedAccount = async (name: string) => {
    const id = await seedAccount(name, "checking", 0)
    await callTool("archive_account", { account: id, archived: true })
    return id
  }
  const REOPEN = /is closed.*archive_account.*archived false/s

  it("add_transaction refuses a closed account, hints how to reopen, stores nothing", async () => {
    const id = await closedAccount("Revolut Chiuso Add")
    const { isError, payload } = await callTool("add_transaction", {
      type: "income", amount: 50, description: "Regalo", account: "Revolut Chiuso Add",
    })
    expect(isError).toBe(true)
    expect(JSON.stringify(payload)).toMatch(REOPEN)
    expect(await txCount(id)).toBe(0)
    expect(await balanceOf(id)).toBe(0)
  })

  it("add_transaction refuses a transfer into a closed account", async () => {
    const id = await closedAccount("Revolut Chiuso Dest")
    const { isError } = await callTool("add_transaction", {
      type: "transfer", amount: 10, description: "Giro", account: "Conto Corrente", toAccount: "Revolut Chiuso Dest",
    })
    expect(isError).toBe(true)
    expect(await balanceOf(id)).toBe(0)
    expect(await balanceOf(checkingId)).toBe(5000)
  })

  it("update_transaction refuses moving a transaction into a closed account", async () => {
    const id = await closedAccount("Revolut Chiuso Move")
    const { payload } = await callTool("add_transaction", {
      type: "expense", amount: 20, description: "Pranzo", account: "Conto Corrente",
    })
    const { isError } = await callTool("update_transaction", { confirm: true,
      id: (payload.transaction as { id: string }).id, account: "Revolut Chiuso Move",
    })
    expect(isError).toBe(true)
    expect(await txCount(id)).toBe(0)
    expect(await balanceOf(checkingId)).toBe(4980)
  })

  it("update_transaction refuses a transfer destination in a closed account", async () => {
    const id = await closedAccount("Revolut Chiuso Dest2")
    const { payload } = await callTool("add_transaction", {
      type: "transfer", amount: 10, description: "Giro", account: "Conto Corrente", toAccount: "Libretto",
    })
    const { isError } = await callTool("update_transaction", { confirm: true,
      id: (payload.transaction as { id: string }).id, toAccount: "Revolut Chiuso Dest2",
    })
    expect(isError).toBe(true)
    expect(await balanceOf(id)).toBe(0)
  })

  it("update_transaction still edits a transaction already on a closed account", async () => {
    const id = await seedAccount("Revolut Vecchio", "checking", 0)
    const { payload } = await callTool("add_transaction", {
      type: "expense", amount: 20, description: "Vecchio", account: "Revolut Vecchio",
    })
    await getAdminFirestore().collection("users").doc(userId).collection("accounts").doc(id).update({ isArchived: true })
    const { isError } = await callTool("update_transaction", { confirm: true,
      id: (payload.transaction as { id: string }).id, amount: 25, account: "Revolut Vecchio",
    })
    expect(isError).toBe(false)
    expect(await balanceOf(id)).toBe(-25)
  })

  it("update_transaction keeps a transfer's closed destination when only the amount changes", async () => {
    const dest = await seedAccount("Revolut Dest Vecchio", "checking", 0)
    const { payload } = await callTool("add_transaction", {
      type: "transfer", amount: 10, description: "Giro", account: "Conto Corrente", toAccount: "Revolut Dest Vecchio",
    })
    await getAdminFirestore().collection("users").doc(userId).collection("accounts").doc(dest).update({ isArchived: true })
    const { isError } = await callTool("update_transaction", { confirm: true,
      id: (payload.transaction as { id: string }).id, amount: 15, toAccount: "Revolut Dest Vecchio",
    })
    expect(isError).toBe(false)
    expect(await balanceOf(dest)).toBe(15)
  })

  it("update_transaction swaps a transfer's direction while one side is closed, like the app", async () => {
    const closed = await seedAccount("Revolut Lato Vecchio", "checking", 0)
    const { payload } = await callTool("add_transaction", {
      type: "transfer", amount: 10, description: "Giro", account: "Conto Corrente", toAccount: "Revolut Lato Vecchio",
    })
    await getAdminFirestore().collection("users").doc(userId).collection("accounts").doc(closed).update({ isArchived: true })
    const { isError } = await callTool("update_transaction", { confirm: true,
      id: (payload.transaction as { id: string }).id,
      account: "Revolut Lato Vecchio", toAccount: "Conto Corrente",
    })
    expect(isError).toBe(false)
    expect(await balanceOf(closed)).toBe(-10)
    expect(await balanceOf(checkingId)).toBe(5010)
  })
})

describe("audit trail", () => {
  it("records both the successful writes and the refused ones", async () => {
    await callTool("add_transaction", {
      type: "expense", amount: 33, description: "Libri", account: "Conto Corrente",
    })
    await callTool("add_transaction", {
      type: "transfer", amount: 33, description: "Senza destinazione", account: "Conto Corrente",
    })

    const entries = await auditEntries()
    expect(entries.filter((e) => e.tool === "add_transaction" && e.result === "ok").length)
      .toBeGreaterThan(0)
    expect(entries.filter((e) => e.tool === "add_transaction" && e.result === "error").length)
      .toBeGreaterThan(0)
  })
})

describe("preview, then confirm (#351)", () => {
  async function seed(): Promise<string> {
    const { payload } = await callTool("add_transaction", {
      type: "expense", amount: 20, description: "Pranzo", account: "Conto Corrente",
    })
    return (payload.transaction as { id: string }).id
  }

  it("delete_transaction without confirm previews and writes nothing", async () => {
    const id = await seed()
    const { isError, payload } = await callTool("delete_transaction", { id })

    expect(isError).toBe(false)
    expect(payload.preview).toBe(true)
    expect(String(payload.summary)).toContain("Preview, nothing changed yet")
    expect(String(payload.summary)).toContain("Pranzo")
    expect(await admin.getTransaction(userId, id)).not.toBeNull()
    expect(await balanceOf(checkingId)).toBe(4980)
  })

  it("update_transaction without confirm previews before and after and writes nothing", async () => {
    const id = await seed()
    const { isError, payload } = await callTool("update_transaction", { id, amount: 25 })

    expect(isError).toBe(false)
    expect(payload.preview).toBe(true)
    expect(payload.changes).toEqual(["amount 20 → 25"])
    expect(await balanceOf(checkingId)).toBe(4980)
    expect((await admin.getTransaction(userId, id))!.amount).toBe(20)
  })

  it("the audit marks a preview as one, and a confirmed write carries the id", async () => {
    const id = await seed()
    await callTool("delete_transaction", { id })
    expect(await balanceOf(checkingId)).toBe(4980)
    await callTool("delete_transaction", { id, confirm: true })
    expect(await balanceOf(checkingId)).toBe(5000)

    // The audit write is fire-and-forget (`void addAuditEntry`), so it can land after the call returns.
    await vi.waitFor(async () => {
      const mine = (await auditEntries()).filter((e) => e.tool === "delete_transaction" && e.params?.id === id)
      expect(mine.map((e) => [e.result, e.preview ?? false, e.documentIds ?? []]).sort()).toEqual(
        [["ok", false, [id]], ["ok", true, []]].sort(),
      )
    })
  })

  it("a recategorisation preview does not claim the balance moves", async () => {
    const id = await seed()
    const { payload } = await callTool("update_transaction", { id, category: "Spesa Alimentare" })
    expect(String(payload.summary)).toContain("No balance moves.")
    expect(String(payload.summary)).not.toContain("balances are adjusted")
    const { payload: amount } = await callTool("update_transaction", { id, amount: 25 })
    expect(String(amount.summary)).toContain("Account balances are adjusted when it is applied.")
  })

  it("a transfer delete preview shows its type and destination", async () => {
    const { payload: made } = await callTool("add_transaction", {
      type: "transfer", amount: 10, description: "Giro", account: "Conto Corrente", toAccount: "Libretto",
    })
    const id = (made.transaction as { id: string }).id
    const { payload } = await callTool("delete_transaction", { id })
    expect(payload.before).toMatchObject({ type: "transfer", account: "Conto Corrente", toAccount: "Libretto" })
  })
})
