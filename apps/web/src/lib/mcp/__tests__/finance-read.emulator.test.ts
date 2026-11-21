/**
 * MCP finance read tools — end-to-end through the route handler, real Firestore.
 *
 * The load-bearing assertions are the chat==UI invariants: spending is compared
 * against a direct `getReportData` call (the reports page's engine) and budgets
 * against `budgetsWithSpending` (the budgets page's engine). If these drift,
 * chat and UI disagree about the user's money.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts).
 */
import { budgetsWithSpending } from "@alter-ego/finance/lib/budgets"
import { createUserWithEmailAndPassword } from "firebase/auth"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { POST as mcp } from "@/app/api/mcp/route"
import { POST as approve } from "@/app/api/oauth/authorize/route"
import { POST as register } from "@/app/api/oauth/register/route"
import { POST as token } from "@/app/api/oauth/token/route"
import * as admin from "@/lib/backend/firebase-admin"
import { getFirebaseAuth } from "@/lib/firebase-client"
import { s256 } from "@/lib/oauth/pkce"

const ORIGIN = "https://mcp.test"
const REDIRECT = "https://claude.ai/api/mcp/auth_callback"
const VERIFIER = "a".repeat(43)

let userId = ""
let bearer = ""
let checkingId = ""
let cardId = ""
let foodId = ""
let travelId = ""

/** Full OAuth dance against the emulator — same path Claude takes. */
async function mintAccessToken(idToken: string): Promise<string> {
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
        client_id: clientId,
        redirect_uri: REDIRECT,
      }),
    })
  )
  return ((await tok.json()) as { access_token: string }).access_token
}

/** Calls one tool through the real route and parses the SSE envelope. */
async function callTool(name: string, args: Record<string, unknown> = {}): Promise<{
  isError: boolean
  payload: Record<string, unknown>
}> {
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

/** Seeded like the UI would write them, so the read tools face real documents. */
async function seed(collection: string, data: Record<string, unknown>): Promise<string> {
  const { getAdminFirestore } = await import("@/lib/firebase-admin-client")
  const ref = await getAdminFirestore()
    .collection("users").doc(userId).collection(collection)
    .add({ userId, ...data, createdAt: new Date(), updatedAt: new Date() })
  return ref.id
}

beforeAll(async () => {
  const { user } = await createUserWithEmailAndPassword(
    getFirebaseAuth(),
    `mcp-finance-${Date.now()}@example.com`,
    "Test1234!"
  )
  userId = user.uid
  bearer = await mintAccessToken(await user.getIdToken())

  // One asset and one liability account, plus an archived one that must stay
  // out of the default listing and out of net worth.
  checkingId = await seed("accounts", {
    name: "Conto Corrente", type: "checking", kind: null, currency: "EUR",
    balance: 5000, openingBalance: 5000, icon: null, color: null, isArchived: false,
  })
  cardId = await seed("accounts", {
    name: "Carta di Credito", type: "credit_card", kind: null, currency: "EUR",
    balance: 800, openingBalance: 0, icon: null, color: null, isArchived: false,
  })
  await seed("accounts", {
    name: "Vecchio Conto", type: "savings", kind: null, currency: "EUR",
    balance: 9999, openingBalance: 9999, icon: null, color: null, isArchived: true,
  })

  foodId = await seed("categories", {
    name: "Spesa Alimentare", group: "expense", icon: "ShoppingCart",
    color: "#22c55e", parentId: null, isDefault: false,
  })
  travelId = await seed("categories", {
    name: "Viaggi", group: "expense", icon: "Plane",
    color: "#3b82f6", parentId: null, isDefault: false,
  })

  // Fixed past months so no assertion depends on today's date.
  const tx = (over: Parameters<typeof admin.createTransaction>[1]) =>
    admin.createTransaction(userId, over)

  await tx({
    accountId: checkingId, type: "expense", amount: 200, currency: "EUR",
    categoryId: foodId, description: "Esselunga", date: new Date(2026, 3, 5),
  })
  await tx({
    accountId: checkingId, type: "expense", amount: 300, currency: "EUR",
    categoryId: travelId, description: "Volo Ryanair", date: new Date(2026, 3, 20),
  })
  await tx({
    accountId: cardId, type: "expense", amount: 150, currency: "EUR",
    categoryId: foodId, description: "Coop", date: new Date(2026, 4, 8),
  })
  await tx({
    accountId: checkingId, type: "income", amount: 3000, currency: "EUR",
    categoryId: null, description: "Stipendio", date: new Date(2026, 3, 27),
  })
  // Excluded from reports: get_spending must not see it, list_transactions must.
  await tx({
    accountId: checkingId, type: "expense", amount: 1000, currency: "EUR",
    categoryId: foodId, description: "Giroconto interno", date: new Date(2026, 3, 15),
    excludeFromReports: true,
  })

  // Current-month spend, so the budgets actually have something to be measured
  // against — the month-window tools above all filter to 2026-04/05 and are
  // unaffected, but every no-filter count includes this row.
  await tx({
    accountId: checkingId, type: "expense", amount: 500, currency: "EUR",
    categoryId: foodId, description: "Spesa del mese", date: new Date(),
  })

  await seed("budgets", {
    name: "Budget Spesa", categoryId: foodId, amount: 400, currency: "EUR",
    period: "monthly", rolloverMode: "reset",
  })
  await seed("budgets", {
    name: "Budget Viaggi", categoryId: travelId, amount: 1000, currency: "EUR",
    period: "monthly", rolloverMode: "reset",
  })
})

describe("list_categories", () => {
  it("lists what add_transaction will accept, defaults and custom alike", async () => {
    const { isError, payload } = await callTool("list_categories")
    expect(isError).toBe(false)
    const rows = payload.categories as Record<string, unknown>[]
    const names = rows.map((r) => r.name)
    expect(names).toContain("Spesa Alimentare")
    expect(names).toContain("Viaggi")
    expect(rows.find((r) => r.name === "Viaggi")).toMatchObject({ id: travelId, isDefault: false })
  })

  it("lists a built-in the user edited once, under its new name", async () => {
    const builtIn = (await admin.getCategories(userId)).find((c) => c.isDefault)!
    const { getAdminFirestore } = await import("@/lib/firebase-admin-client")
    await getAdminFirestore().doc(`users/${userId}/categories/${builtIn.id}`).set({
      userId, name: "Casa Mia", group: builtIn.group, icon: builtIn.icon, color: builtIn.color,
      parentId: null, isDefault: false, createdAt: new Date(), updatedAt: new Date(),
    })
    const { payload } = await callTool("list_categories")
    const rows = (payload.categories as { id: string; name: string }[]).filter((r) => r.id === builtIn.id)
    expect(rows.map((r) => r.name)).toEqual(["Casa Mia"])
  })

  it("filters by group", async () => {
    const { payload } = await callTool("list_categories", { group: "food" })
    const rows = payload.categories as Record<string, unknown>[]
    expect(rows.every((r) => r.group === "food")).toBe(true)
  })
})

describe("list_accounts", () => {
  it("splits assets from liabilities and nets them into net worth", async () => {
    const { payload } = await callTool("list_accounts")
    const accounts = payload.accounts as { name: string; kind: string; balance: number }[]

    expect(accounts.map((a) => a.name).sort()).toEqual(["Carta di Credito", "Conto Corrente"])
    expect(accounts.find((a) => a.name === "Carta di Credito")?.kind).toBe("liability")

    // Balances are whatever the ledger says after the seeded transactions —
    // asserting against stored values keeps this about the asset/liability
    // split rather than re-deriving createTransaction's balance arithmetic.
    const stored = await admin.getAccounts(userId)
    const balanceOf = (name: string) => stored.find((a) => a.name === name)!.balance
    // Totals follow the balances' signs, not the kinds.
    const bals = [balanceOf("Conto Corrente"), balanceOf("Carta di Credito")]
    expect(payload.assets).toBe(bals.filter((b) => b > 0).reduce((s, b) => s + b, 0))
    expect(payload.liabilities).toBe(bals.filter((b) => b < 0).reduce((s, b) => s - b, 0))
    expect(payload.netWorth).toBe(bals[0] + bals[1])
  })

  it("hides archived accounts by default and their balance with them", async () => {
    const { payload: hidden } = await callTool("list_accounts")
    expect((hidden.accounts as unknown[]).length).toBe(2)

    const { payload: shown } = await callTool("list_accounts", { includeArchived: true })
    const names = (shown.accounts as { name: string }[]).map((a) => a.name)
    expect(names).toContain("Vecchio Conto")
    // The archived €9999 must not have been silently counted in the default view.
    expect(Number(shown.assets) - Number(hidden.assets)).toBe(9999)
  })
})

describe("list_transactions", () => {
  it("filters by month window, inclusive at both ends", async () => {
    const { payload } = await callTool("list_transactions", { from: "2026-04", to: "2026-04" })
    const descriptions = (payload.transactions as { description: string }[]).map((t) => t.description)

    expect(payload.total).toBe(4) // three expenses + salary, excluded-from-reports included
    expect(descriptions).toContain("Esselunga")
    expect(descriptions).not.toContain("Coop") // May
  })

  it("resolves a category by name and returns its label on each row", async () => {
    const { payload } = await callTool("list_transactions", { category: "Viaggi" })
    const rows = payload.transactions as { description: string; category: string }[]

    expect(rows).toHaveLength(1)
    expect(rows[0].description).toBe("Volo Ryanair")
    expect(rows[0].category).toBe("Viaggi")
  })

  it("resolves an account by partial name", async () => {
    const { payload } = await callTool("list_transactions", { account: "carta" })
    const rows = payload.transactions as { account: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].account).toBe("Carta di Credito")
  })

  it("searches the description", async () => {
    const { payload } = await callTool("list_transactions", { search: "ryanair" })
    expect(payload.total).toBe(1)
  })

  // The summary names the range rather than "the first N": with offset in play,
  // page two is rows 3–4, and calling those "the first 2" would be a lie.
  it("reports the full total, and which slice of it, when the limit truncates", async () => {
    const { payload } = await callTool("list_transactions", { limit: 2 })
    expect(payload.returned).toBe(2)
    expect(payload.total).toBe(6)
    expect(String(payload.summary)).toContain("(1–2)")
  })

  it("returns an empty list, not an error, for a month with nothing in it", async () => {
    const { isError, payload } = await callTool("list_transactions", { from: "2020-01" })
    expect(isError).toBe(false)
    expect(payload.total).toBe(0)
    expect(payload.transactions).toEqual([])
  })

  it("rejects an unknown category by name and lists the real ones", async () => {
    const { isError, payload } = await callTool("list_transactions", { category: "Criptovalute" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("No category matches")
    expect(String(payload.error)).toContain("Viaggi")
  })

  it("rejects a `to` without a `from` instead of silently ignoring it", async () => {
    const { isError, payload } = await callTool("list_transactions", { to: "2026-04" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("from")
  })

  it("rejects a garbage month readably", async () => {
    const { isError, payload } = await callTool("list_transactions", { from: "2026-13" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("Invalid date")
  })
})

describe("list_transactions search filters", () => {
  const names = (payload: Record<string, unknown>) =>
    (payload.transactions as Record<string, unknown>[]).map((t) => t.description)

  // The regression that motivated the day-aware window: this used to answer for
  // the whole of April, because normalizeMonth truncated the day away.
  it("honours a single day instead of widening it to the month", async () => {
    const { payload } = await callTool("list_transactions", {
      from: "2026-04-05",
      to: "2026-04-05",
    })
    expect(names(payload)).toEqual(["Esselunga"])
  })

  it("mixes a day start with a month end", async () => {
    const { payload } = await callTool("list_transactions", {
      from: "2026-04-20",
      to: "2026-05",
    })
    expect(names(payload).sort()).toEqual(["Coop", "Stipendio", "Volo Ryanair"])
  })

  it("still treats a bare month as the whole month", async () => {
    const { payload } = await callTool("list_transactions", { from: "2026-04", type: "expense" })
    expect(names(payload).sort()).toEqual(["Esselunga", "Giroconto interno", "Volo Ryanair"])
  })

  it("bounds by amount, inclusive at both ends", async () => {
    const over = await callTool("list_transactions", {
      from: "2026-04",
      to: "2026-05",
      type: "expense",
      minAmount: 300,
    })
    expect(names(over.payload).sort()).toEqual(["Giroconto interno", "Volo Ryanair"])

    const under = await callTool("list_transactions", {
      from: "2026-04",
      to: "2026-05",
      type: "expense",
      maxAmount: 200,
    })
    expect(names(under.payload).sort()).toEqual(["Coop", "Esselunga"])
  })

  it("rejects an inverted amount range rather than returning nothing", async () => {
    const { isError, payload } = await callTool("list_transactions", {
      minAmount: 500,
      maxAmount: 100,
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toMatch(/invalid amount range/i)
  })

  it("finds what still needs filing", async () => {
    const { payload } = await callTool("list_transactions", {
      from: "2026-04",
      to: "2026-05",
      uncategorized: true,
    })
    expect(names(payload)).toEqual(["Stipendio"])
  })

  it("refuses uncategorized together with a category", async () => {
    const { isError, payload } = await callTool("list_transactions", {
      uncategorized: true,
      category: "Spesa Alimentare",
    })
    expect(isError).toBe(true)
    expect(String(payload.error)).toMatch(/mutually exclusive/i)
  })

  it("pages with offset and stops advertising a next page at the end", async () => {
    const first = await callTool("list_transactions", {
      from: "2026-04",
      to: "2026-05",
      type: "expense",
      limit: 2,
    })
    expect(first.payload.total).toBe(4)
    expect(first.payload.returned).toBe(2)
    expect(first.payload.offset).toBe(0)
    expect(first.payload.nextOffset).toBe(2)

    const second = await callTool("list_transactions", {
      from: "2026-04",
      to: "2026-05",
      type: "expense",
      limit: 2,
      offset: first.payload.nextOffset as number,
    })
    expect(second.payload.returned).toBe(2)
    expect(second.payload.nextOffset).toBeNull()

    // The two pages together are the whole set, with nothing repeated.
    const all = [...names(first.payload), ...names(second.payload)]
    expect(new Set(all).size).toBe(4)
  })
})

describe("list_transactions notes, tags, status and totals", () => {
  const names = (payload: Record<string, unknown>) =>
    (payload.transactions as Record<string, unknown>[]).map((t) => t.description)
  // Its own month, seeded here rather than in the top-level beforeAll, so no count
  // asserted above moves.
  const window = { from: "2025-11", to: "2025-11" }

  beforeAll(async () => {
    const workTagId = await seed("tags", { name: "Lavoro", color: "#ef4444" })
    const tx = (over: Parameters<typeof admin.createTransaction>[1]) =>
      admin.createTransaction(userId, over)

    await tx({
      accountId: checkingId, type: "expense", amount: 40, currency: "EUR",
      description: "Taxi", notes: "Rimborso trasferta Milano", tagIds: [workTagId],
      date: new Date(2025, 10, 3),
    })
    await tx({
      accountId: checkingId, type: "expense", amount: 60, currency: "EUR",
      description: "Pranzo", rawDescription: "POS 4411 TRATTORIA DA MARIO",
      status: "pending", date: new Date(2025, 10, 4),
    })
    // A balance adjustment: listed, never counted as spending.
    await tx({
      accountId: checkingId, type: "expense", amount: 500, currency: "EUR",
      description: "Differenza di equilibrio", excludeFromReports: true,
      date: new Date(2025, 10, 5),
    })
    await tx({
      accountId: cardId, type: "expense", amount: 25, currency: "EUR",
      description: "Caffè", date: new Date(2025, 10, 6),
    })
  })

  // Money Manager imports put the detail in the notes, which the server adapter
  // used to skip while the web app's search already covered it.
  it("searches the notes and the original imported text, not only the description", async () => {
    const byNote = await callTool("list_transactions", { ...window, search: "trasferta" })
    expect(names(byNote.payload)).toEqual(["Taxi"])

    const byRaw = await callTool("list_transactions", { ...window, search: "trattoria" })
    expect(names(byRaw.payload)).toEqual(["Pranzo"])
  })

  it("returns the notes, tag names and report flag on each row", async () => {
    const { payload } = await callTool("list_transactions", window)
    const rows = payload.transactions as Record<string, unknown>[]
    const taxi = rows.find((r) => r.description === "Taxi")!

    expect(taxi.notes).toBe("Rimborso trasferta Milano")
    expect(taxi.tags).toEqual(["Lavoro"])
    expect(taxi.excludeFromReports).toBe(false)
    expect(rows.find((r) => r.description === "Differenza di equilibrio")!.excludeFromReports).toBe(true)
  })

  it("lists the tags list_transactions can filter by", async () => {
    const { payload } = await callTool("list_tags")
    expect((payload.tags as { name: string }[]).map((t) => t.name)).toEqual(["Lavoro"])
  })

  it("filters by tag name, and rejects an unknown tag listing the real ones", async () => {
    const { payload } = await callTool("list_transactions", { tag: "lavoro" })
    expect(names(payload)).toEqual(["Taxi"])

    const unknown = await callTool("list_transactions", { tag: "Vacanze" })
    expect(unknown.isError).toBe(true)
    expect(String(unknown.payload.error)).toContain("Lavoro")
  })

  it("filters to rows carrying a note, and by status", async () => {
    const noted = await callTool("list_transactions", { ...window, hasNote: true })
    expect(names(noted.payload)).toEqual(["Taxi"])

    const pending = await callTool("list_transactions", { ...window, status: "pending" })
    expect(names(pending.payload)).toEqual(["Pranzo"])
  })

  // The bug this replaced: the total summed only the returned page, so "how much
  // did I spend" came out low whenever the list was truncated.
  it("totals spending over every match, not the page, leaving out excluded rows", async () => {
    const { payload } = await callTool("list_transactions", { ...window, limit: 1 })
    expect(payload.returned).toBe(1)
    expect(payload.total).toBe(4)
    expect(payload.spent).toBe(125) // 40 + 60 + 25; the 500 adjustment is excluded
    expect(String(payload.summary)).toContain("€125.00")
  })
})

describe("get_spending", () => {
  it("equals the reports engine for the same window", async () => {
    const { payload } = await callTool("get_spending", { from: "2026-04" })
    const report = await admin.getReportData(userId, {
      from: new Date(2026, 3, 1),
      to: new Date(2026, 3, 30, 23, 59, 59, 999),
    })

    expect(payload.totalExpenses).toBe(report.totalExpenses)
    expect(payload.totalIncome).toBe(report.totalIncome)
    expect(payload.netSavings).toBe(report.netSavings)
  })

  it("excludes transactions flagged excludeFromReports, like the reports page", async () => {
    const { payload } = await callTool("get_spending", { from: "2026-04" })
    // 200 + 300 only — the €1000 giroconto is excluded from reports.
    expect(payload.totalExpenses).toBe(500)
    expect(payload.totalIncome).toBe(3000)
    expect(payload.netSavings).toBe(2500)
  })

  it("writes the totals in euros to the cent (#317)", async () => {
    const { payload } = await callTool("get_spending", { from: "2026-04" })
    expect(String(payload.summary)).toContain("€500.00 spent, €3,000.00 income, net savings €2,500.00.")
  })

  it("groups by category, largest first", async () => {
    const { payload } = await callTool("get_spending", { from: "2026-04", groupBy: "category" })
    const rows = payload.rows as { key: string; amount: number }[]
    expect(rows.map((r) => r.key)).toEqual(["Viaggi", "Spesa Alimentare"])
    expect(rows[0].amount).toBe(300)
  })

  it("groups by month across a multi-month window", async () => {
    const { payload } = await callTool("get_spending", {
      from: "2026-04",
      to: "2026-05",
      groupBy: "month",
    })
    const rows = payload.rows as { key: string; expenses: number }[]
    expect(rows.map((r) => r.key)).toEqual(["2026-04", "2026-05"])
    expect(rows[1].expenses).toBe(150)
  })

  it("defaults `to` to `from` so one month is one argument", async () => {
    const { payload } = await callTool("get_spending", { from: "2026-05" })
    expect(payload.to).toBe("2026-05")
    expect(payload.totalExpenses).toBe(150)
  })

  it("rejects a reversed window", async () => {
    const { isError, payload } = await callTool("get_spending", { from: "2026-05", to: "2026-04" })
    expect(isError).toBe(true)
    expect(String(payload.error)).toContain("Invalid range")
  })

  it("returns zeroes, not an error, for an empty window", async () => {
    const { isError, payload } = await callTool("get_spending", { from: "2020-01" })
    expect(isError).toBe(false)
    expect(payload.totalExpenses).toBe(0)
    expect(payload.rows).toEqual([])
  })
})

describe("get_budget_status", () => {
  it("equals the budgets page engine for the same data", async () => {
    const { payload } = await callTool("get_budget_status")

    const [budgets, transactions] = await Promise.all([
      admin.getBudgets(userId),
      admin.getTransactions(userId),
    ])
    const expected = budgetsWithSpending(budgets, transactions.data, new Date())
    const byName = new Map(expected.map((b) => [b.name, b]))

    for (const row of payload.budgets as { name: string; spent: number; remaining: number }[]) {
      expect(row.spent).toBe(byName.get(row.name)!.spent)
      expect(row.remaining).toBe(byName.get(row.name)!.remaining)
    }
  })

  it("orders worst first and labels the overspent budget danger", async () => {
    const { payload } = await callTool("get_budget_status")
    const rows = payload.budgets as {
      name: string
      spent: number
      remaining: number
      percentage: number
      status: string
    }[]

    expect(rows).toHaveLength(2)
    // €500 spent against a €400 food budget; travel is untouched this month.
    expect(rows[0]).toMatchObject({
      name: "Budget Spesa",
      spent: 500,
      remaining: 0,
      percentage: 100,
      status: "danger",
    })
    expect(rows[1]).toMatchObject({ name: "Budget Viaggi", spent: 0, status: "ok" })
    expect(String(payload.summary)).toContain("1 over budget")
    expect(String(payload.summary)).toContain("Budget Spesa")
  })

  it("reports a zero-euro budget with spending as danger", async () => {
    const id = await seed("budgets", {
      name: "Budget Zero", categoryId: foodId, amount: 0, currency: "EUR",
      period: "monthly", rolloverMode: "reset",
    })
    try {
      const { payload } = await callTool("get_budget_status")
      const rows = payload.budgets as { name: string; status: string }[]
      expect(rows.find((r) => r.name === "Budget Zero")).toMatchObject({ status: "danger" })
      expect(String(payload.summary)).toContain("2 over budget")
    } finally {
      const { getAdminFirestore } = await import("@/lib/firebase-admin-client")
      await getAdminFirestore().collection("users").doc(userId).collection("budgets").doc(id).delete()
    }
  })

  it("names the category each budget is scoped to", async () => {
    const { payload } = await callTool("get_budget_status")
    const names = (payload.budgets as { category: string }[]).map((b) => b.category).sort()
    expect(names).toEqual(["Spesa Alimentare", "Viaggi"])
  })
})

describe("a USD account in the replies (#317)", () => {
  it("reads $ for the account's own totals, and bare numbers once currencies mix", async () => {
    const { getAdminFirestore } = await import("@/lib/firebase-admin-client")
    const col = getAdminFirestore().collection("users").doc(userId).collection("accounts")
    const usdId = await seed("accounts", {
      name: "Chase", type: "checking", kind: null, currency: "USD",
      balance: 12.5, openingBalance: 12.5, icon: null, color: null, isArchived: false,
    })
    try {
      const mixed = await callTool("list_accounts")
      // The EUR balances depend on the earlier tests: only the shape is asserted.
      expect(String(mixed.payload.summary)).toMatch(
        /^3 accounts: assets [\d,]+\.\d{2}, liabilities [\d,]+\.\d{2}, net worth -?[\d,]+\.\d{2}\. Totals add EUR and USD without conversion\./
      )

      await col.doc(cardId).update({ isArchived: true })
      await col.doc(checkingId).update({ isArchived: true })
      const only = await callTool("list_accounts")
      expect(only.payload.summary).toBe("1 account: assets $12.50, liabilities $0.00, net worth $12.50.")
    } finally {
      await col.doc(cardId).update({ isArchived: false })
      await col.doc(checkingId).update({ isArchived: false })
      await col.doc(usdId).delete()
    }
  })

  it("list_transactions names the currency of what it sums, not of every row it lists", async () => {
    const usdId = await seed("accounts", {
      name: "Chase2", type: "checking", kind: null, currency: "USD",
      balance: 0, openingBalance: 0, icon: null, color: null, isArchived: false,
    })
    const made = [
      await admin.createTransaction(userId, {
        accountId: checkingId, type: "expense", amount: 40, currency: "EUR",
        description: "Eur lunch", date: new Date(2025, 8, 3),
      }),
      await admin.createTransaction(userId, {
        accountId: usdId, type: "expense", amount: 500, currency: "USD",
        description: "Usd adjustment", excludeFromReports: true, date: new Date(2025, 8, 4),
      }),
    ]
    try {
      const { payload } = await callTool("list_transactions", { from: "2025-09", to: "2025-09" })
      expect(payload.total).toBe(2)
      expect(payload.summary).toBe("2 transactions, €40.00 spent.")
    } finally {
      for (const t of made) await admin.deleteTransaction(userId, t.id)
      const { getAdminFirestore } = await import("@/lib/firebase-admin-client")
      await getAdminFirestore().collection("users").doc(userId).collection("accounts").doc(usdId).delete()
    }
  })

  it("get_spending takes the currency from the accounts and does not re-read the transactions", async () => {
    const spy = vi.spyOn(admin, "getTransactions")
    try {
      const { payload } = await callTool("get_spending", { from: "2026-04" })
      expect(String(payload.summary)).toContain("€500.00 spent")
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe("list_accounts byPerson", () => {
  it("tells who owes what on a loan account, the same buckets as the account page", async () => {
    // Created here and removed after: the archived-accounts test above counts the listing.
    const loanId = await seed("accounts", {
      name: "Prestiti", type: "loan", kind: "asset", currency: "EUR",
      balance: 0, openingBalance: 0, icon: null, color: null, isArchived: false,
    })
    const tx = (over: Parameters<typeof admin.createTransaction>[1]) => admin.createTransaction(userId, over)
    const rows = [
      await tx({ accountId: checkingId, type: "transfer", amount: 500, currency: "EUR", categoryId: null, description: "Soldi Alice", date: new Date(2026, 4, 1), transferToAccountId: loanId }),
      await tx({ accountId: loanId, type: "transfer", amount: 100, currency: "EUR", categoryId: null, description: "soldi alice", date: new Date(2026, 4, 2), transferToAccountId: checkingId }),
      await tx({ accountId: loanId, type: "transfer", amount: 1000, currency: "EUR", categoryId: null, description: "Soldi Carol", date: new Date(2026, 4, 3), transferToAccountId: checkingId }),
      await tx({ accountId: checkingId, type: "transfer", amount: 630, currency: "EUR", categoryId: null, description: "Soldi Bob", date: new Date(2026, 4, 4), transferToAccountId: loanId }),
      await tx({ accountId: loanId, type: "transfer", amount: 630, currency: "EUR", categoryId: null, description: "Soldi Bob", date: new Date(2026, 4, 5), transferToAccountId: checkingId }),
    ]

    const { isError, payload } = await callTool("list_accounts")
    expect(isError).toBe(false)
    const accounts = payload.accounts as { name: string; byPerson?: unknown; settled?: unknown }[]
    expect(accounts.find((a) => a.name === "Prestiti")).toMatchObject({
      byPerson: [
        { name: "alice", balance: 400, lent: 500, repaid: 100 },
        { name: "Carol", balance: -1000, lent: 0, repaid: 1000 },
      ],
      settled: ["Bob"],
    })
    expect(accounts.find((a) => a.name === "Conto Corrente")?.byPerson).toBeUndefined()
    expect(payload.summary).toContain("Prestiti: alice owe you €400.00; you owe Carol €1,000.00.")

    for (const t of rows) await admin.deleteTransaction(userId, t.id)
    const { getAdminFirestore } = await import("@/lib/firebase-admin-client")
    await getAdminFirestore().collection("users").doc(userId).collection("accounts").doc(loanId).delete()
  })
})
