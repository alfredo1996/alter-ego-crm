/**
 * The cash book over MCP — end-to-end through the route handler, real Firestore.
 *
 * Its own user, so the company accounts seeded here never reach the other write
 * tests (mark_invoice_paid asks for an account once any exists). Synthetic data
 * only: invented banks, tenants and amounts.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts).
 */
import { formatYearMonth, isoDate } from "@alter-ego/kernel/dates"
import { addDays, format, startOfMonth, subMonths } from "date-fns"
import { createUserWithEmailAndPassword } from "firebase/auth"
import { beforeAll, describe, expect, it } from "vitest"

import { POST as mcp } from "@/app/api/mcp/route"
import { POST as approve } from "@/app/api/oauth/authorize/route"
import { POST as register } from "@/app/api/oauth/register/route"
import { POST as token } from "@/app/api/oauth/token/route"
import * as admin from "@/lib/backend/firebase-admin"
import {
  BILL_HAS_PAYMENTS,
  NON_CASH,
  balancesAt,
  cashRows,
  clientsOwe,
  costCentreTotals,
  deposits,
  monthEnd,
  monthSheet,
  ownerLoanBalance,
  rowsSinceCheck,
  splitRows,
  supplierDocuments,
  toChase,
} from "@/lib/cash-book"
import { getAdminFirestore } from "@/lib/firebase-admin-client"
import { getFirebaseAuth } from "@/lib/firebase-client"
import { invoiceClientId } from "@/lib/invoices"
import { s256 } from "@/lib/oauth/pkce"
import { planUndo } from "@/lib/prima-nota"

const ORIGIN = "https://mcp.test"
const REDIRECT = "https://claude.ai/api/mcp/auth_callback"
const VERIFIER = "a".repeat(43)

const now = new Date()
const today = isoDate(now)
const ym = today.slice(0, 7)
const firstOfMonth = `${ym}-01`
const opened = isoDate(startOfMonth(subMonths(now, 1)))
const day = (iso: string) => new Date(`${iso}T00:00:00`)

let userId = ""
let writeBearer = ""
let readOnlyBearer = ""
let mainId = ""
let secondId = ""
let clientId = ""

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

/** The SDK's own refusal, before the tool runs: plain text, not the tools' JSON. */
async function schemaRefusal(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await mcp(rpcRequest(writeBearer, name, args))
  const rpc = JSON.parse((await res.text()).split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as {
    result: { isError?: boolean; content: [{ text: string }] }
  }
  expect(rpc.result.isError).toBe(true)
  return rpc.result.content[0].text
}

const userSub = (name: string) => getAdminFirestore().collection("users").doc(userId).collection(name)

async function seedAccount(name: string, openingBalance: number, over: Record<string, unknown> = {}): Promise<string> {
  const ref = await userSub("company_accounts").add({
    userId, name, openingBalance, openingDate: day(opened), statementBalance: null, statementDate: null, importRef: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  })
  return ref.id
}

/** Everything the page reads, through the same Admin functions the tools use. */
async function book() {
  const [accounts, movements, invoices, expenses, loans, clients, engagements] = await Promise.all([
    admin.getCompanyAccounts(userId),
    admin.getCompanyMovements(userId),
    admin.getInvoices(userId),
    admin.getCompanyExpenses(userId),
    admin.getCompanyLoans(userId),
    admin.getClients(userId),
    admin.getEngagements(userId),
  ])
  const rows = cashRows({
    invoices, expenses, loans, movements,
    customerName: (i) => clients.find((c) => c.id === invoiceClientId(i, engagements))?.name ?? null,
  })
  const { counted } = splitRows(accounts, rows)
  return { accounts, movements, invoices, expenses, loans, engagements, rows, counted }
}

beforeAll(async () => {
  const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), `mcp-cash-${Date.now()}@example.com`, "Test1234!")
  userId = user.uid
  const idToken = await user.getIdToken()
  writeBearer = await mintToken(idToken, "data:read data:write")
  readOnlyBearer = await mintToken(idToken, "data:read")

  mainId = await seedAccount("Main Bank", 10000, { statementBalance: 10000, statementDate: day(opened) })
  secondId = await seedAccount("Second Bank", 2000)
  clientId = (await admin.createClient(userId, { name: "Cash Test Client" })).id
  await admin.createInvoice(userId, {
    clientId, number: "CB-1/2026", yearMonth: ym, amount: 1000, vat: 220, paidDate: day(firstOfMonth), paidAccountId: mainId,
  })
  await admin.createInvoice(userId, { clientId, number: "CB-2/2026", yearMonth: ym, amount: 500, vat: 110 })
  await admin.createCompanyExpense(userId, {
    description: "Rent", category: "rent", amount: 1850, vat: 0, date: day(firstOfMonth), accountId: secondId,
    documentRef: "R-1", project: "Flat Rental",
  })
  await admin.createCompanyExpense(userId, {
    description: "Fridge", category: "office_supplies", amount: 480, date: day(firstOfMonth), paidByOwner: true, project: "Flat Rental",
  })
  const bill = await admin.createCompanyExpense(userId, {
    description: "Studio Test fee", category: "accountant", amount: 1000, vat: 0, date: day(isoDate(addDays(day(opened), 14))),
    documentRef: "ST-9",
  })
  const move = (over: Partial<Parameters<typeof admin.createCompanyMovement>[1]>) =>
    admin.createCompanyMovement(userId, {
      kind: "vat", direction: "out", amount: 1, date: day(firstOfMonth), accountId: mainId, description: "x", ...over,
    })
  await move({ kind: "supplier_payment", amount: 500, expenseId: bill.id, description: "Supplier Invoice Payment", documentRef: "ST-9" })
  await move({ kind: "transfer", amount: 2500, toAccountId: secondId, description: "Transfer to Second Bank" })
  await move({ kind: "income", direction: "in", amount: 650, accountId: secondId, description: "Rent Room 2", counterparty: "Room 2", project: "Flat Rental" })
  await move({ kind: "deposit_held", direction: "in", amount: 900, accountId: secondId, description: "Deposit Received", counterparty: "Room 3", project: "Flat Rental" })
  await move({ kind: "vat", amount: 100, description: "VAT (F24)" })
  await admin.createCompanyLoan(userId, {
    description: "Shareholder Loan", direction: "to_company", amount: 5000, date: day(isoDate(addDays(day(opened), 9))), accountId: mainId,
  })
})

describe("get_cash_book", () => {
  it("answers with the page's numbers, to the cent", async () => {
    const { isError, payload } = await callTool("get_cash_book")
    expect(isError).toBe(false)

    // Worked by hand: Main 10,000 + 5,000 loan + 1,220 invoice − 500 supplier − 2,500 transfer − 100 VAT.
    expect(payload.accounts.map((a: Payload) => [a.name, a.balance])).toEqual([["Main Bank", 13120], ["Second Bank", 4200]])
    expect(payload.figures).toMatchObject({
      total: 17320, depositsToGiveBack: 900,
      clientsOwe: 610, suppliersOwed: 500, srlOwesYou: 5480,
    })
    expect(payload.period).toMatchObject({ period: ym, in: 2770, out: 2450, net: 320 })
    expect(payload.summary).toContain("Company accounts today: Main Bank €13,120.00 (Matches the bank on ")
    expect(payload.summary).toContain("Total €17,320.00, deposits to give back €900.00.")
    expect(payload.figures).not.toHaveProperty("available")
    expect(payload.figures).not.toHaveProperty("vatNotYetPaid")

    // And the same functions on the same data, so the tool can never drift from the page.
    const b = await book()
    const balances = balancesAt(b.accounts, b.counted, today)
    expect(payload.accounts.map((a: Payload) => a.balance)).toEqual(b.accounts.map((a) => balances.get(a.id)))
    const sheet = monthSheet(b.accounts, b.counted, ym, null)
    expect(payload.period).toMatchObject({ in: sheet.in, out: sheet.out, net: sheet.net, opening: sheet.opening, closing: sheet.closing })
    expect(payload.figures.clientsOwe).toBe(clientsOwe(b.invoices, b.engagements))
    expect(payload.figures.suppliersOwed).toBe(supplierDocuments(b.expenses, b.movements).owed)
    expect(payload.figures.ownerLoans).toEqual(ownerLoanBalance(b.loans, b.expenses))
    expect(payload.figures.depositsHeld).toEqual(
      deposits(b.movements).filter((d) => d.kind === "deposit_held").map(({ counterparty, amount }) => ({ counterparty, amount })),
    )
    const centres = costCentreTotals(b, firstOfMonth, monthEnd(ym), null)
    expect(payload.costCentres.map((c: Payload) => [c.name, c.income, c.costs, c.result, c.depositsHeld, c.label])).toEqual([
      ["Consulting", 1000, 0, 1000, 0, "Gain €1,000.00"],
      ["Flat Rental", 650, 2330, -1680, 900, "Loss €1,680.00"],
    ])
    expect(payload.costCentres.map((c: Payload) => c.result)).toEqual(centres.centres.map((c) => c.result))
    expect(payload.costCentreTotal.result).toBe(centres.total.result)
    expect(payload.toChase).toMatchObject({ total: toChase(b).length, costsWithNoDocument: 1 })
  })

  it("lists the month as the sheet does: a transfer once, with its amount and no in or out", async () => {
    const { payload } = await callTool("get_cash_book", { period: ym })
    const transfer = payload.rows.find((r: Payload) => r.type === "Transfer")
    expect(transfer).toMatchObject({ account: "Main Bank", otherAccount: "Second Bank", in: null, out: null, transferred: 2500 })
    expect(payload.rows.filter((r: Payload) => r.type === "Transfer")).toHaveLength(1)
    expect(payload.rowsTotal).toBe(payload.rows.length)
    expect(payload.period.byType).toContainEqual({ type: "Rent & Other Income", in: 650, out: 0 })
  })

  it("narrows the period to one account, its transfers apart", async () => {
    const { payload } = await callTool("get_cash_book", { account: "second" })
    expect(payload.period).toMatchObject({ account: "Second Bank", in: 1550, out: 1850, transfersNet: 2500 })
    // Company-wide whatever the account: the tiles never follow the chip.
    expect(payload.figures.total).toBe(17320)
    expect(payload.rows.every((r: Payload) => r.account === "Second Bank")).toBe(true)
  })

  it("narrows rows and cost centres to one cost centre", async () => {
    const { payload } = await callTool("get_cash_book", { costCentre: "flat rental" })
    expect(payload.costCentres.map((c: Payload) => c.name)).toEqual(["Flat Rental"])
    expect(payload.rows.map((r: Payload) => r.description).sort()).toEqual(["Deposit Received", "Rent", "Rent Room 2"])
    // The whole company's gain next to one centre's would read as that centre's: left out, as the export does.
    expect(payload).not.toHaveProperty("costCentreTotal")
  })

  it("takes a year, month by month as the Months tab", async () => {
    const { payload } = await callTool("get_cash_book", { period: ym.slice(0, 4), limit: 2 })
    const months = payload.period.months as Payload[]
    expect(months.at(-1)).toMatchObject({ month: ym, in: 2770, out: 2450 })
    expect(payload.period.in).toBe(months.reduce((s, m) => s + m.in, 0))
    expect(payload.rows).toHaveLength(2)
    expect(payload.rowsTotal).toBeGreaterThan(2)
  })

  it("refuses an unknown account, listing the company accounts, and a month that does not exist", async () => {
    expect(await refusal("get_cash_book", { account: "Third" })).toBe(
      'No company account matches "Third". Company accounts: Main Bank, Second Bank.',
    )
    expect(await refusal("get_cash_book", { period: "2026-13" })).toMatch(/Invalid date/)
  })

  it("is a read: a read-only token gets it", async () => {
    const res = await mcp(rpcRequest(readOnlyBearer, "get_cash_book", {}))
    expect(res.status).toBe(200)
  })

  // What update_* and delete_* take: every entry is found with its source and id, the ones no balance shows too.
  it("lists each row's kind, source and id, and the entries that reach no balance, the imported ones marked", async () => {
    const { payload } = await callTool("get_cash_book")
    expect(payload.rows.find((r: Payload) => r.description === "Rent")).toMatchObject({ kind: "cost", source: "expense", id: expect.any(String) })
    expect(payload.rows.find((r: Payload) => r.type === "Transfer")).toMatchObject({ kind: "transfer", source: "movement" })
    expect(payload.rows.some((r: Payload) => "imported" in r)).toBe(false)
    expect(payload.otherEntries).toEqual([
      expect.objectContaining({ description: "Fridge", paidBy: "owner's card", kind: "cost", amount: -480, source: "expense", id: expect.any(String) }),
    ])
    // Under one account, none of the costs no account paid.
    expect((await callTool("get_cash_book", { account: "Main" })).payload.otherEntries).toEqual([])

    const last = opened.slice(0, 7)
    expect((await callTool("get_cash_book", { period: last })).payload.otherEntries).toContainEqual(
      expect.objectContaining({ description: "Studio Test fee", paidBy: "supplier invoice", documentRef: "ST-9", amount: -1000 }),
    )
    // Imported, and dated before its account opened: in no balance, still found.
    const early = isoDate(addDays(day(opened), -3))
    const ref = await userSub("company_movements").add({
      userId, kind: "tax", direction: "out", amount: 77, date: day(early), accountId: mainId, toAccountId: null, expenseId: null,
      description: "IRES (F24)", documentRef: null, project: null, counterparty: null, notes: null, dateEstimated: false,
      importRef: "2026:Agosto!4", createdAt: new Date(), updatedAt: new Date(),
    })
    const { payload: before } = await callTool("get_cash_book", { period: early.slice(0, 7) })
    expect(before.otherEntries).toContainEqual({
      date: early, account: "Main Bank", type: "Tax (F24)", kind: "tax", description: "IRES (F24)", documentRef: null, costCentre: null,
      amount: -77, why: "dated before the account opened", source: "movement", file: null, id: ref.id, imported: true,
    })
    await ref.delete()
  })
})

// ─── Writes ───────────────────────────────────────────────────────────────────
// They run after the reads above, so they change the book only from here on.
// Odd amounts keep a write from meeting a seeded row of the same day (today may
// be the 1st), which the duplicate guard would rightly refuse.

/** Each company account's balance today, as get_cash_book says it. */
async function balances(): Promise<Record<string, number>> {
  const { payload } = await callTool("get_cash_book")
  return Object.fromEntries(payload.accounts.map((a: Payload) => [a.name, a.balance]))
}

const todayLabel = format(now, "dd/MM/yyyy")

describe("add_movement", () => {
  it("records a transfer between two company accounts: both move, the total stays", async () => {
    const before = await balances()
    const { isError, payload } = await callTool("add_movement", { kind: "transfer", amount: 300.5, account: "Main", toAccount: "Second" })
    expect(isError).toBe(false)
    expect(payload.summary).toContain(`Recorded: Transfer €300.50 from Main Bank to Second Bank on ${todayLabel}.`)
    expect(payload.summary).toContain("Neither income nor a cost")
    expect(payload.balances).toEqual({ "Main Bank": before["Main Bank"] - 300.5, "Second Bank": before["Second Bank"] + 300.5 })
    expect(payload.movement).toMatchObject({ kind: "transfer", direction: "out", description: "Transfer to Second Bank", costCentre: null })
  })

  it("records a tenant's deposit under its name, held apart from the company's money", async () => {
    const { payload } = await callTool("add_movement", {
      kind: "deposit_held", direction: "in", amount: 450.25, account: "Second Bank", counterparty: "Room 4", costCentre: "Flat Rental",
    })
    expect(payload.summary).toContain(`Recorded: Deposit Received €450.25 into Second Bank on ${todayLabel} (Room 4), cost centre Flat Rental.`)
    const { payload: book } = await callTool("get_cash_book")
    expect(book.figures.depositsHeld).toContainEqual({ counterparty: "Room 4", amount: 450.25 })
  })

  it("warns when a deposit given back is more than the book holds under that name", async () => {
    const { isError, payload } = await callTool("add_movement", {
      kind: "deposit_held", direction: "out", amount: 500.25, account: "Second Bank", counterparty: "room 4",
    })
    expect(isError).toBe(false)
    expect(payload.summary).toContain("Room 4: only €450.25 in the Cash Book, less than this. Check the amount and the name.")
  })

  it("refuses a deposit given back under a name the book doesn't hold, listing those it does, unless force", async () => {
    const count = (await admin.getCompanyMovements(userId)).length
    const back = { kind: "deposit_held", direction: "out", amount: 12.34, account: "Second Bank", counterparty: "Stanza 3" }
    expect(await refusal("add_movement", back)).toBe(
      'No deposit held under "Stanza 3" in the Cash Book. Open: Room 3 (€900.00): pass the name as listed. If it began before ' +
        "the book, first add it as Deposit Received dated before the account's opening date: it counts as a deposit without " +
        "changing the balance. force: true records it anyway.",
    )
    expect(await refusal("add_movement", { ...back, kind: "deposit_paid", direction: "in", counterparty: "Landlord" })).toMatch(
      /^No deposit paid under "Landlord" in the Cash Book\. None is open\./,
    )
    expect((await admin.getCompanyMovements(userId)).length).toBe(count)
    expect((await callTool("add_movement", { ...back, force: true })).isError).toBe(false)
    // The real one is still held: the forced row is under its own name.
    const { payload } = await callTool("get_cash_book")
    expect(payload.figures.depositsHeld).toContainEqual({ counterparty: "Room 3", amount: 900 })
  })

  it("keeps a counterparty only on the kinds Add Movement asks it for", async () => {
    const { payload } = await callTool("add_movement", { kind: "vat", direction: "out", amount: 50.55, account: "Main", counterparty: "Agency" })
    expect(payload.movement.counterparty).toBeNull()
    expect(payload.summary).not.toContain("Agency")
    expect((await admin.getCompanyMovements(userId)).find((m) => m.id === payload.movement.id)!.counterparty).toBeNull()
  })

  it("spells a cost centre as the book already does, and says when one is new", async () => {
    const rent = { kind: "income", direction: "in", account: "Second", counterparty: "Room 2" }
    const known = await callTool("add_movement", { ...rent, amount: 61.1, costCentre: "flat RENTAL" })
    expect(known.payload.summary).toContain("(Room 2), cost centre Flat Rental.")
    expect(known.payload.movement.costCentre).toBe("Flat Rental")
    const fresh = await callTool("add_movement", { ...rent, amount: 61.2, costCentre: "Garage" })
    expect(fresh.payload.summary).toContain("(Room 2), new cost centre Garage.")
  })

  it("refuses what Add Movement refuses", async () => {
    expect(await refusal("add_movement", { kind: "vat", amount: 10.1, account: "Main" })).toBe(
      "Pass direction: in for money into the company account, out for money leaving it.",
    )
    expect(await refusal("add_movement", { kind: "transfer", amount: 10.1, account: "Main" })).toMatch(/needs toAccount/)
    expect(await refusal("add_movement", { kind: "vat", direction: "out", amount: 10.1, account: "Main", toAccount: "Second" })).toMatch(
      /toAccount is for a transfer only/,
    )
    expect(await refusal("add_movement", { kind: "transfer", amount: 10.1, account: "Main", toAccount: "main bank" })).toMatch(
      /different company account/,
    )
    expect(await refusal("add_movement", { kind: "deposit_held", direction: "in", amount: 10.1, account: "Second" })).toBe(
      "Say whose deposit it is in counterparty, e.g. Room 2.",
    )
    expect(await refusal("add_movement", { kind: "vat", direction: "out", amount: 10.1 })).toBe(
      "Which company account? Pass account: Main Bank, Second Bank.",
    )
    expect(await refusal("add_movement", { kind: "vat", direction: "out", amount: 10.1, account: "Bank" })).toBe(
      'Several company accounts match "Bank": Main Bank, Second Bank. Be more specific.',
    )
    const tomorrow = isoDate(addDays(now, 1))
    expect(await refusal("add_movement", { kind: "vat", direction: "out", amount: 10.1, account: "Main", date: tomorrow })).toBe(
      `${tomorrow} has not come yet: the Cash Book records money that already moved.`,
    )
  })

  it("refuses the same account, day and amount again, unless force", async () => {
    const vat = { kind: "vat", direction: "out", amount: 77.7, account: "Main", description: "VAT (F24) Q3" }
    expect((await callTool("add_movement", vat)).isError).toBe(false)
    const again = await refusal("add_movement", { ...vat, description: "VAT again" })
    expect(again).toMatch(new RegExp(`^Already in the Cash Book: VAT \\(F24\\), VAT \\(F24\\) Q3, €77\\.70 from Main Bank on ${todayLabel} \\(movement \\w+\\)\\.`))
    expect(again).toContain("Pass force: true if it really is a second one.")
    expect((await callTool("add_movement", { ...vat, force: true })).isError).toBe(false)
    const twins = (await admin.getCompanyMovements(userId)).filter((m) => m.amount === 77.7)
    expect(twins).toHaveLength(2)
  })
})

describe("add_expense", () => {
  it("records a cost from a company account, the VAT inside the total", async () => {
    const before = await balances()
    const { isError, payload } = await callTool("add_expense", {
      description: "Design software", total: 122.2, vat: 22.2, paidFrom: "Main", category: "software", documentRef: "SW-1",
    })
    expect(isError).toBe(false)
    expect(payload.summary).toContain(`Cost recorded: Software & Tools €122.20 (VAT €22.20) from Main Bank on ${todayLabel}.`)
    expect(payload.balances["Main Bank"]).toBeCloseTo(before["Main Bank"] - 122.2, 2)
    const stored = (await admin.getCompanyExpenses(userId)).find((e) => e.documentRef === "SW-1")!
    expect(stored).toMatchObject({ amount: 100, vat: 22.2, accountId: mainId, paidByOwner: false, recurringExpenseId: null })
  })

  it("asks which recurring cost a payment stands for, and links the one named", async () => {
    const estimate = await admin.createCompanyExpense(userId, {
      description: "Accountant fee", category: "accountant", amount: 300, date: day(opened), isRecurring: true, recurrenceMonths: 1,
    })
    const asked = await refusal("add_expense", { description: "Quarterly review", total: 366.6, paidFrom: "Main", category: "accountant" })
    expect(asked).toBe(
      'Does it pay "Accountant fee" (€300.00 a period)? Pass paysRecurring with its description, or "none": otherwise the Plan counts both the estimate and this cost.',
    )
    const { payload } = await callTool("add_expense", {
      description: "Quarterly review", total: 366.6, paidFrom: "Main", category: "accountant", paysRecurring: "accountant", documentRef: "AC-3",
    })
    expect(payload.summary).toContain(`instead of the estimate "Accountant fee".`)
    expect((await admin.getCompanyExpenses(userId)).find((e) => e.documentRef === "AC-3")!.recurringExpenseId).toBe(estimate.id)
    const none = await callTool("add_expense", {
      description: "Other review", total: 50.5, paidFrom: "Main", category: "accountant", paysRecurring: "none", documentRef: "AC-4",
    })
    expect(none.payload.cost.paysRecurring).toBeNull()
  })

  it("records a cost paid with the owner's personal card: no account moves, the SRL owes it", async () => {
    const before = await balances()
    const { payload } = await callTool("add_expense", {
      description: "Kettle", total: 48.4, paidFrom: "owner", category: "office_supplies", costCentre: "Flat Rental",
    })
    expect(payload.summary).toContain("paid with your personal card")
    expect(payload.summary).toContain("The SRL now owes you €5,528.40.")
    expect(payload.summary).toContain("No document: it shows in To Chase")
    expect(await balances()).toEqual(before)
  })

  it("records a supplier invoice not paid yet, then its payment, never above what is owed", async () => {
    expect(await refusal("add_expense", { description: "Plumber", total: 610, paidFrom: "not_paid" })).toMatch(/pass documentRef/)
    const bill = await callTool("add_expense", { description: "Plumber", total: 610, paidFrom: "not_paid", documentRef: "PL-1", category: "other" })
    expect(bill.payload.summary).toContain("Supplier invoice PL-1 recorded")
    expect(bill.payload.summary).toContain("(You Owe Suppliers €1,110.00)")

    // The same number as a new cost would count it twice: it says how to pay it.
    expect(await refusal("add_expense", { description: "Plumber paid", total: 200, paidFrom: "Main", documentRef: "pl-1" })).toBe(
      'Supplier invoice "PL-1" is already on Costs (Plumber, €610.00 still owed). To record paying it, pass supplierInvoice "PL-1"; if this is another cost, pass force: true.',
    )
    expect(await refusal("add_expense", { description: "Plumber paid", total: 700, paidFrom: "Main", supplierInvoice: "PL-1" })).toBe(
      "Only €610.00 is owed on PL-1. Record anything more as a cost with add_expense.",
    )
    const before = await balances()
    const paid = await callTool("add_expense", { description: "Plumber, first half", total: 305, paidFrom: "Main", supplierInvoice: "PL-1" })
    expect(paid.payload.summary).toContain(`Supplier Invoice Payment €305.00 from Main Bank on ${todayLabel}: PL-1, €305.00 still owed of €610.00.`)
    expect(paid.payload.balances["Main Bank"]).toBeCloseTo(before["Main Bank"] - 305, 2)
    const stored = (await admin.getCompanyMovements(userId)).find((m) => m.description === "Plumber, first half")!
    expect(stored).toMatchObject({ kind: "supplier_payment", direction: "out", documentRef: "PL-1" })
    expect(await refusal("add_expense", { description: "x", total: 5, paidFrom: "Main", supplierInvoice: "NOPE-1" })).toMatch(
      /^No supplier invoice on Costs matches "NOPE-1"\. Open supplier invoices: .*PL-1 \(Plumber, €305\.00 owed\)/,
    )
  })

  it("records a refund back into an account, and refuses the mistakes the form refuses", async () => {
    const { payload } = await callTool("add_expense", { description: "Supplier refund", total: 21.3, paidFrom: "Second", refund: true, category: "other" })
    expect(payload.summary).toContain("Refund recorded: Other €21.30 back into Second Bank")
    expect((await admin.getCompanyExpenses(userId)).find((e) => e.description === "Supplier refund")).toMatchObject({ amount: -21.3, vat: 0 })

    expect(await refusal("add_expense", { description: "x", total: 9, paidFrom: "owner", refund: true })).toMatch(/money back into a company account/)
    expect(await refusal("add_expense", { description: "x", total: 9, vat: 9, paidFrom: "Main" })).toMatch(/vat is part of total/)
    expect(await refusal("add_expense", { description: "x", total: 9 })).toBe(
      'Which company account? Pass paidFrom: Main Bank, Second Bank. Or paidFrom "owner" for the owner\'s personal card, or "not_paid" for a supplier invoice to pay later.',
    )
  })

  it("refuses a refund on a supplier invoice: paying one is money out", async () => {
    const owed = async () => (await callTool("get_cash_book")).payload.figures.supplierInvoices.find((d: Payload) => d.documentRef === "PL-1").owed
    const before = await owed()
    expect(
      await refusal("add_expense", { description: "Plumber refund", total: 100, paidFrom: "Main", refund: true, supplierInvoice: "PL-1" }),
    ).toBe("A supplier invoice payment is money out. For money a supplier gave back, leave out supplierInvoice and pass refund: true.")
    expect(await owed()).toBe(before)
  })

  // A guessed "other" left the rent estimate out of the question, and the Plan counted the month twice.
  it("asks for the category, never guessing it from the description", async () => {
    const count = (await admin.getCompanyExpenses(userId)).length
    expect(await refusal("add_expense", { description: "Rent Via Esempio", total: 1850.5, paidFrom: "Second", documentRef: "R-10" })).toBe(
      "Pass category: rent, software, accountant, insurance, office_supplies, travel, marketing, legal, bank_fees, collaborators, other. It picks " +
        "the recurring estimate this cost stands for.",
    )
    expect((await admin.getCompanyExpenses(userId)).length).toBe(count)
  })

  it("spells a cost centre as the book already does", async () => {
    const { payload } = await callTool("add_expense", {
      description: "Smoke alarm", total: 23.45, paidFrom: "owner", category: "office_supplies", costCentre: "FLAT rental", documentRef: "SA-1",
    })
    expect(payload.summary).toContain(", cost centre Flat Rental: no company account moved.")
    expect(payload.cost.costCentre).toBe("Flat Rental")
  })

  it("refuses the same cost twice, from an account or on the card, unless force", async () => {
    const cost = { description: "Taxi", total: 33.3, paidFrom: "Main", category: "travel", documentRef: "TX-1" }
    expect((await callTool("add_expense", cost)).isError).toBe(false)
    expect(await refusal("add_expense", { ...cost, documentRef: "TX-2" })).toMatch(/^Already in the Cash Book: Cost: Travel & Transport, Taxi, €33\.30 from Main Bank/)
    expect((await callTool("add_expense", { ...cost, documentRef: "TX-2", force: true })).isError).toBe(false)
    const card = { description: "Lunch", total: 18.8, paidFrom: "owner", category: "marketing" }
    expect((await callTool("add_expense", card)).isError).toBe(false)
    expect(await refusal("add_expense", card)).toMatch(/^Already on Costs: "Lunch", €18\.80/)
  })
})

describe("record_loan", () => {
  it("records a loan to the SRL and a repayment, with what the SRL owes after each", async () => {
    const owes = async () => (await callTool("get_cash_book")).payload.figures.ownerLoans.total as number
    const start = await owes()
    const lent = await callTool("record_loan", { direction: "to_company", amount: 1000.1, account: "Main" })
    expect(lent.payload.summary).toContain(`Shareholder loan recorded: you lent the SRL €1,000.10 into Main Bank on ${todayLabel}.`)
    expect(lent.payload.srlOwesYou).toBe(Math.round((start + 1000.1) * 100) / 100)
    expect(lent.payload.summary).not.toMatch(/withdraw/i)

    const back = await callTool("record_loan", { direction: "from_company", amount: 200.2, account: "Main" })
    expect(back.payload.summary).toContain("the SRL paid you back €200.20 from Main Bank")
    expect(back.payload.srlOwesYou).toBe(await owes())
  })

  it("warns when a repayment is more than the SRL owes, and still records it", async () => {
    const owed = (await callTool("get_cash_book")).payload.figures.ownerLoans.total as number
    const { isError, payload } = await callTool("record_loan", { direction: "from_company", amount: owed + 99.9, account: "Second" })
    expect(isError).toBe(false)
    expect(payload.summary).toContain("the SRL has now paid you €99.90 more than it owed, which an SRL can't do. Check the amount.")
    const { payload: book } = await callTool("get_cash_book")
    expect(book.figures.srlOwesYou).toBe(0)
    expect(book.summary).toContain("The SRL has paid you €99.90 more than it owed")
    // Put it back, so what follows starts from a book that owes nothing back.
    await callTool("record_loan", { direction: "to_company", amount: 99.9, account: "Second", description: "Correction" })
  })
})

describe("check_balance", () => {
  it("answers Matches the bank, as the page does, and saves the check", async () => {
    const bank = (await balances())["Second Bank"]
    const { payload } = await callTool("check_balance", { account: "Second", balance: bank })
    expect(payload.summary).toBe(
      `Second Bank: Matches the bank on ${todayLabel}. Cash Book at the end of ${todayLabel}: ${eur(bank)} · Bank: ${eur(bank)}. Saved as the company account's last check.`,
    )
    const stored = (await admin.getCompanyAccounts(userId)).find((a) => a.id === secondId)!
    expect(stored).toMatchObject({ statementBalance: bank })
    expect(isoDate(stored.statementDate!)).toBe(today)
  })

  it("answers Missing OUT of €x with the rows since the last check", async () => {
    const book = (await balances())["Main Bank"]
    const { payload } = await callTool("check_balance", { account: "Main Bank", balance: book - 25 })
    expect(payload.summary).toContain(`Main Bank: Missing OUT of €25.00 on ${todayLabel}.`)
    expect(payload.summary).toContain("The bank has €25.00 less: money went out that the Cash Book doesn't have.")
    expect(payload.summary).toContain(`since the last check (${format(day(opened), "dd/MM/yyyy")})`)
    expect(payload.rows.length).toBeGreaterThan(0)
    expect(payload.check).toMatchObject({ status: "missing_out", difference: -25 })
  })

  // Without the customers' names, the credit note read as deducted from the other customer's invoice.
  it("lists the rows as the page does, each invoice with its customer", async () => {
    const other = await admin.createClient(userId, { name: "Other Test Client" })
    await admin.createInvoice(userId, { clientId, number: "CB-40/2026", yearMonth: ym, amount: 300.3, vat: 0, paidDate: day(today), paidAccountId: secondId })
    await admin.createInvoice(userId, {
      clientId: other.id, number: "CB-41/2026", yearMonth: ym, amount: -20.2, vat: 0, paidDate: day(today), paidAccountId: secondId,
    })
    const b = await book()
    const page = rowsSinceCheck(b.accounts.find((a) => a.id === secondId)!, b.counted, today).rows.slice(-20).map((r) => r.description)
    const { payload } = await callTool("check_balance", { account: "Second", balance: (await balances())["Second Bank"] - 1.11 })
    expect(payload.rows.map((r: Payload) => r.description)).toEqual(page)
    expect(page).toContain("Invoice CB-40/2026 · Cash Test Client")
    expect(page).toContain("Credit note CB-41/2026 · Other Test Client")
  })

  it("compares an earlier day only: a later check stays", async () => {
    const yesterday = isoDate(addDays(now, -1))
    const { payload } = await callTool("check_balance", { account: "Main", balance: 1, date: yesterday })
    expect(payload.saved).toBe(false)
    expect(payload.summary).toContain(`Not saved: the ${todayLabel} check is newer.`)
    expect((await admin.getCompanyAccounts(userId)).find((a) => a.id === mainId)!.statementBalance).not.toBe(1)
  })
})

describe("mark_invoice_paid into a company account", () => {
  const seedInvoice = (number: string, amount = 1000, vat = 220) =>
    admin.createInvoice(userId, { clientId, number, yearMonth: ym, amount, vat })

  it("asks which account once the Cash Book has two", async () => {
    await seedInvoice("CB-10/2026")
    expect(await refusal("mark_invoice_paid", { invoice: "CB-10/2026" })).toBe(
      'Which company account? Pass account: Main Bank, Second Bank. Or account "none" for an offset against a credit note, no money moved.',
    )
  })

  it("books a short payment as a bank fee in the same write", async () => {
    const before = await balances()
    const { isError, payload } = await callTool("mark_invoice_paid", { invoice: "CB-10/2026", account: "Main", received: 1212.5 })
    expect(isError).toBe(false)
    expect(payload.summary).toContain(`Invoice CB-10/2026 collected on ${today} into Main Bank: €1,220.00. €7.50 short: booked as a bank fee`)
    expect(payload.balances["Main Bank"]).toBeCloseTo(before["Main Bank"] + 1212.5, 2)
    const invoice = (await admin.getInvoices(userId)).find((i) => i.number === "CB-10/2026")!
    expect(invoice.paidAccountId).toBe(mainId)
    expect((await admin.getCompanyExpenses(userId)).find((e) => e.id === `bank-fee-${invoice.id}`)).toMatchObject({
      category: "bank_fees", amount: 7.5, accountId: mainId, description: "Bank fee on invoice CB-10/2026",
    })
  })

  it("refuses a partial payment or more than the total, and the invoice stays unpaid", async () => {
    await seedInvoice("CB-11/2026")
    expect(await refusal("mark_invoice_paid", { invoice: "CB-11/2026", account: "Main", received: 1100 })).toMatch(
      /^€120\.00 short of the €1,220\.00 expected: partial payments aren't supported\./,
    )
    expect(await refusal("mark_invoice_paid", { invoice: "CB-11/2026", account: "Main", received: 1300 })).toMatch(
      /^That is more than expected: mark it paid at €1,220\.00/,
    )
    expect((await admin.getInvoices(userId)).find((i) => i.number === "CB-11/2026")!.paidDate).toBeNull()
  })

  it("closes an invoice as an offset, no money moved", async () => {
    await seedInvoice("CB-12/2026", 100, 22)
    const before = await balances()
    const { payload } = await callTool("mark_invoice_paid", { invoice: "CB-12/2026", account: "none" })
    expect(payload.summary).toBe(`Invoice CB-12/2026 collected on ${today} as an offset, no money moved: €122.00.`)
    expect((await admin.getInvoices(userId)).find((i) => i.number === "CB-12/2026")!.paidAccountId).toBe("non-cash")
    expect(await balances()).toEqual(before)
    await seedInvoice("CB-13/2026", -100, -22)
    expect(await refusal("mark_invoice_paid", { invoice: "CB-13/2026", account: "Main", received: 50 })).toBe(
      "A credit note has no amount received: leave out received.",
    )
    // Settled, so no later payment of this customer and month reads it as deducted.
    expect((await callTool("mark_invoice_paid", { invoice: "CB-13/2026", account: "none" })).isError).toBe(false)
  })

  it("refuses a short payment while a credit note is open: it was deducted, not a bank fee", async () => {
    await seedInvoice("CB-30/2026")
    await seedInvoice("CB-31/2026", -25, -5)
    const before = await balances()
    expect(await refusal("mark_invoice_paid", { invoice: "CB-30/2026", account: "Main", received: 1190 })).toBe(
      "Credit note CB-31/2026 (-€30.00) is still open on the same customer and months: €30.00 short is usually it, deducted, " +
        "not a bank fee. Mark it paid into Main Bank on the same day, and this invoice without received: they add up to what " +
        "arrived. A real bank fee, on top or instead, is add_expense category bank_fees.",
    )
    const invoices = await admin.getInvoices(userId)
    const invoice = invoices.find((i) => i.number === "CB-30/2026")!
    expect(invoice.paidDate).toBeNull()
    expect((await admin.getCompanyExpenses(userId)).filter((e) => e.category === "bank_fees" && e.description.includes("CB-30"))).toEqual([])

    // As the refusal says: the two together are what the bank shows, and no fee is booked.
    expect((await callTool("mark_invoice_paid", { invoice: "CB-31/2026", account: "Main" })).isError).toBe(false)
    const { payload } = await callTool("mark_invoice_paid", { invoice: "CB-30/2026", account: "Main" })
    expect(payload.balances["Main Bank"]).toBeCloseTo(before["Main Bank"] + 1190, 2)
  })

  it("refuses a second bank fee when the first was booked on the web, under its own id", async () => {
    await seedInvoice("CB-32/2026", 500, 110)
    // The web's Mark Paid books its fee with a random id, then the invoice was marked unpaid.
    const webFee = await admin.createCompanyExpense(userId, {
      description: "Bank fee on invoice CB-32/2026", category: "bank_fees", amount: 2, date: day(today), accountId: mainId,
    })
    expect(await refusal("mark_invoice_paid", { invoice: "CB-32/2026", account: "Main", received: 608 })).toBe(
      `A bank fee on invoice CB-32/2026 is already on Costs, from an earlier payment (expense ${webFee.id}): delete it first with ` +
        "delete_expense, or leave out received.",
    )
    expect((await admin.getCompanyExpenses(userId)).filter((e) => e.description === "Bank fee on invoice CB-32/2026")).toHaveLength(1)
  })

  it("refuses a day that does not exist, rather than storing another one", async () => {
    for (const paidDate of ["2026-02-30", "2026-00-10"]) {
      const text = await schemaRefusal("mark_invoice_paid", { invoice: "CB-11/2026", account: "Main", paidDate })
      expect(text).toContain("Input validation error")
      expect(text).toContain("Invalid date: use YYYY-MM-DD")
    }
    expect((await admin.getInvoices(userId)).find((i) => i.number === "CB-11/2026")!.paidDate).toBeNull()
  })
})

describe("the rest of the refusals", () => {
  it("add_movement: an unknown company account, listing them", async () => {
    expect(await refusal("add_movement", { kind: "capital", direction: "in", amount: 10.1, account: "Personal Checking" })).toBe(
      'No company account matches "Personal Checking". Company accounts: Main Bank, Second Bank.',
    )
  })

  it("add_expense: a supplier payment from no account, the same unpaid invoice twice, a cost taking its only estimate", async () => {
    expect(await refusal("add_expense", { description: "x", total: 5, paidFrom: "owner", supplierInvoice: "PL-1" })).toBe(
      "A supplier invoice payment leaves a company account: pass paidFrom with the account.",
    )
    const bill = { description: "Electrician", total: 244.4, paidFrom: "not_paid", documentRef: "EL-1", category: "other" }
    expect((await callTool("add_expense", bill)).isError).toBe(false)
    expect(await refusal("add_expense", { ...bill, documentRef: "EL-2" })).toMatch(/^Already on Costs: "Electrician", €244\.40/)
    // Its first word in the description: the one estimate of its category is linked unasked.
    const { payload } = await callTool("add_expense", {
      description: "Accountant, October", total: 300.3, paidFrom: "Main", category: "accountant", documentRef: "AC-9",
    })
    expect(payload.cost.paysRecurring).toBe("Accountant fee")
  })

  it("add_expense: two supplier invoices sharing a number, an estimate named that matches none or several, a day not come yet", async () => {
    const dup = { description: "Glazier", total: 120.1, paidFrom: "not_paid", documentRef: "DUP-1", category: "other" }
    expect((await callTool("add_expense", dup)).isError).toBe(false)
    expect((await callTool("add_expense", { ...dup, description: "Glazier, second job", total: 80.8, force: true })).isError).toBe(false)
    expect(await refusal("add_expense", { description: "Glazier paid", total: 10.1, paidFrom: "Main", supplierInvoice: "DUP-1" })).toMatch(
      /^Several supplier invoices are numbered "DUP-1": Glazier[^;]* \(id \w+\); Glazier[^;]* \(id \w+\)\. Pass the id\.$/,
    )

    for (const description of ["Office insurance", "Office legal retainer"]) {
      await admin.createCompanyExpense(userId, {
        description, category: description.includes("legal") ? "legal" : "insurance", amount: 90, date: day(opened), isRecurring: true, recurrenceMonths: 1,
      })
    }
    const cost = { description: "Policy", total: 91.9, paidFrom: "Main", category: "insurance", documentRef: "IN-1" }
    expect(await refusal("add_expense", { ...cost, paysRecurring: "office" })).toMatch(
      /^Several recurring costs match "office": Office (insurance|legal retainer), Office (insurance|legal retainer)\. Be more specific\.$/,
    )
    expect(await refusal("add_expense", { ...cost, paysRecurring: "Hosting" })).toMatch(/^No recurring cost matches "Hosting"\. Recurring costs: /)
    const tomorrow = isoDate(addDays(now, 1))
    expect(await refusal("add_expense", { ...cost, paysRecurring: "none", date: tomorrow })).toBe(
      `${tomorrow} has not come yet: the Cash Book records money that already moved.`,
    )
  })

  it("record_loan: an unknown or ambiguous account, a day not come yet", async () => {
    const loan = { direction: "to_company", amount: 10.1 }
    expect(await refusal("record_loan", { ...loan, account: "Third" })).toBe(
      'No company account matches "Third". Company accounts: Main Bank, Second Bank.',
    )
    expect(await refusal("record_loan", { ...loan, account: "Bank" })).toMatch(/^Several company accounts match "Bank"/)
    expect(await refusal("record_loan", { ...loan, account: "Main", date: isoDate(addDays(now, 1)) })).toMatch(/has not come yet/)
  })

  it("mark_invoice_paid: an unknown company account", async () => {
    expect(await refusal("mark_invoice_paid", { invoice: "CB-11/2026", account: "Third" })).toBe(
      'No company account matches "Third". Company accounts: Main Bank, Second Bank. Or account "none" for an offset against a credit note, no money moved.',
    )
  })

  it("record_loan: the same loan twice on one day, unless force", async () => {
    const loan = { direction: "to_company", amount: 250.5, account: "Second" }
    expect((await callTool("record_loan", loan)).isError).toBe(false)
    expect(await refusal("record_loan", loan)).toMatch(/^Already in the Cash Book: Shareholder Loan, €250\.50 into Second Bank/)
    expect((await callTool("record_loan", { ...loan, force: true })).isError).toBe(false)
  })

  it("check_balance: a day not come yet, an unknown account", async () => {
    const tomorrow = isoDate(addDays(now, 1))
    expect(await refusal("check_balance", { account: "Main", balance: 1, date: tomorrow })).toMatch(/has not come yet/)
    expect(await refusal("check_balance", { account: "Third", balance: 1 })).toMatch(/^No company account matches "Third"/)
  })

  it("mark_invoice_paid: a fee already booked, received on an offset, a day not come yet", async () => {
    await admin.createInvoice(userId, { clientId, number: "CB-20/2026", yearMonth: ym, amount: 500, vat: 110 })
    expect((await callTool("mark_invoice_paid", { invoice: "CB-20/2026", account: "Main", received: 605 })).isError).toBe(false)
    // Marked unpaid by hand, its fee stays on Costs: a second one would double it.
    expect((await callTool("update_invoice", { invoice: "CB-20/2026", paidDate: null, confirm: true })).isError).toBe(false)
    const cb20 = (await admin.getInvoices(userId)).find((i) => i.number === "CB-20/2026")!
    expect(await refusal("mark_invoice_paid", { invoice: "CB-20/2026", account: "Main", received: 605 })).toBe(
      `A bank fee on invoice CB-20/2026 is already on Costs, from an earlier payment (expense bank-fee-${cb20.id}): delete it first ` +
        "with delete_expense, or leave out received.",
    )
    expect(await refusal("mark_invoice_paid", { invoice: "CB-20/2026", account: "none", received: 605 })).toBe(
      "An offset moves no money: leave out received.",
    )
    expect(await refusal("mark_invoice_paid", { invoice: "CB-20/2026", account: "Main", paidDate: isoDate(addDays(now, 1)) })).toMatch(
      /has not come yet/,
    )
    expect((await admin.getInvoices(userId)).find((i) => i.number === "CB-20/2026")!.paidDate).toBeNull()
  })
})

describe("scope gate and audit", () => {
  it.each([
    ["add_movement", { kind: "vat", direction: "out", amount: 1, account: "Main" }],
    ["add_expense", { description: "x", total: 1, paidFrom: "Main" }],
    ["record_loan", { direction: "to_company", amount: 1, account: "Main" }],
    ["check_balance", { account: "Main", balance: 1 }],
    ["mark_invoice_paid", { invoice: "CB-11/2026", account: "Main" }],
    // The deletes and edits, confirmed or not: a read-only token never reaches them.
    ["delete_invoice", { invoice: "CB-2/2026", confirm: true }],
    ["update_movement", { id: "x", amount: 1, confirm: true }],
    ["delete_movement", { id: "x" }],
    ["update_expense", { id: "x", total: 1, confirm: true }],
    ["delete_expense", { id: "x" }],
    ["update_loan", { id: "x", amount: 1 }],
    ["delete_loan", { id: "x", confirm: true }],
  ])("a read-only token calling %s gets 403 insufficient_scope, and nothing is written", async (tool, args) => {
    const movements = (await admin.getCompanyMovements(userId)).length
    const invoices = (await admin.getInvoices(userId)).length
    const res = await mcp(rpcRequest(readOnlyBearer, tool, args))
    expect(res.status).toBe(403)
    expect(res.headers.get("WWW-Authenticate") ?? "").toContain('error="insufficient_scope"')
    expect((await admin.getCompanyMovements(userId)).length).toBe(movements)
    expect((await admin.getInvoices(userId)).length).toBe(invoices)
  })

  it("leaves an audit entry for every write, refused or done", async () => {
    // Audit writes are fire-and-forget: the newest may still be in flight.
    await expect
      .poll(async () => {
        const snap = await userSub("mcp_audit").get()
        const seen = new Set(snap.docs.map((d) => `${d.get("tool")}:${d.get("result")}`))
        return ["add_movement", "add_expense", "record_loan", "check_balance", "mark_invoice_paid"].flatMap((t) =>
          ["ok", "error"].filter((r) => !seen.has(`${t}:${r}`)).map((r) => `${t}:${r}`),
        )
      })
      .toEqual([])
    const refused = (await userSub("mcp_audit").where("tool", "==", "add_movement").where("result", "==", "error").get()).docs[0]
    expect(refused.get("errorMessage")).toBeTruthy()
    expect(refused.get("params")).toMatchObject({ kind: expect.any(String) })
  })

  it("never audits a read", async () => {
    const snap = await userSub("mcp_audit").where("tool", "==", "get_cash_book").get()
    expect(snap.empty).toBe(true)
  })
})

// ─── Deletes and edits: preview, then confirm ─────────────────────────────────
// After everything above, on rows of their own: each call without confirm must
// leave the documents as they were, read back to be sure.

/** The audit entries a tool left, newest last (fire-and-forget: polled until `count` are in). */
async function auditOf(tool: string, count: number) {
  await expect.poll(async () => (await userSub("mcp_audit").where("tool", "==", tool).get()).size).toBeGreaterThanOrEqual(count)
  const snap = await userSub("mcp_audit").where("tool", "==", tool).get()
  return snap.docs.map((d) => d.data()).sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis())
}

describe("delete_invoice", () => {
  let customerId = ""
  let paidId = ""
  const last = opened.slice(0, 7)

  beforeAll(async () => {
    customerId = (await admin.createClient(userId, { name: "Delete Test Client" })).id
    // One day logged last month at 800: what To invoice is measured against.
    const contract = await admin.createEngagement(userId, {
      clientId: customerId, dailyRate: 800, vatApplicable: true, defaultDaysPerMonth: 10, startMonth: last,
    })
    await admin.setTimecard(userId, { engagementId: contract.id, date: opened, hours: 8 })
    const paid = await admin.createInvoice(userId, { clientId: customerId, number: "DI-1/2026", yearMonth: ym, amount: 500, vat: 110 })
    paidId = paid.id
    await admin.settleInvoicePayment(userId, { invoiceId: paid.id, paidDate: day(firstOfMonth), paidAccountId: mainId, fee: 4.5 })
    await admin.createInvoice(userId, { clientId: customerId, number: "DI-2/2026", yearMonth: last, amount: 800, vat: 176 })
    await admin.createInvoice(userId, { clientId: customerId, number: "DI-3/2026", yearMonth: last, amount: -100, vat: -22 })
  })

  it("previews a paid invoice and writes nothing: the balance, the payment leaving, the bank fee that stays", async () => {
    const before = await balances()
    const { isError, payload } = await callTool("delete_invoice", { invoice: "DI-1" })
    expect(isError).toBe(false)
    expect(payload.preview).toBe(true)
    expect(payload.summary).toMatch(/^Preview, nothing changed yet: delete invoice DI-1\/2026 \(Delete Test Client, €610\.00\)\./)
    expect(payload.summary).toContain(`Main Bank balance today ${eur(before["Main Bank"])} → ${eur(before["Main Bank"] - 610)}.`)
    expect(payload.summary).toContain("call again with the same arguments and confirm: true")
    expect(payload.effects).toContainEqual({ figure: "Main Bank balance today", before: before["Main Bank"], after: before["Main Bank"] - 610 })
    expect(payload.notes.join(" ")).toContain("update_invoice with paidDate null")
    expect(payload.notes.join(" ")).toContain(`The €4.50 bank fee booked with its payment ("Bank fee on invoice DI-1/2026", expense bank-fee-${paidId}) stays on Costs`)
    expect(payload.before).toMatchObject({ number: "DI-1/2026", total: 610, paidInto: "Main Bank", client: "Delete Test Client" })
    expect(payload.after).toBeNull()
    // Nothing written: the invoice, its fee and the balance as they were.
    expect((await admin.getInvoices(userId)).some((i) => i.id === paidId)).toBe(true)
    expect((await admin.getCompanyExpenses(userId)).some((e) => e.id === `bank-fee-${paidId}`)).toBe(true)
    expect(await balances()).toEqual(before)
  })

  it("with confirm deletes it alone, says the new balance, and leaves the bank fee on Costs", async () => {
    const before = await balances()
    const { isError, payload } = await callTool("delete_invoice", { invoice: "DI-1/2026", confirm: true })
    expect(isError).toBe(false)
    expect(payload.preview).toBeUndefined()
    expect(payload.summary).toMatch(/^Deleted invoice DI-1\/2026 \(Delete Test Client, €610\.00\)\./)
    expect(payload.summary).toContain(`Company account balance today: Main Bank ${eur(before["Main Bank"] - 610)}.`)
    expect(payload.balances).toEqual({ "Main Bank": before["Main Bank"] - 610 })
    expect((await admin.getInvoices(userId)).some((i) => i.id === paidId)).toBe(false)
    expect((await admin.getCompanyExpenses(userId)).some((e) => e.id === `bank-fee-${paidId}`)).toBe(true)
  })

  it("says what To invoice and Unpaid become for the customer, and the credit note that stays", async () => {
    const { payload } = await callTool("delete_invoice", { invoice: "DI-2" })
    // Logged 800, invoiced 800 − 100: To invoice 100 → 900. Unpaid 976 − 122 → none, the credit note alone.
    expect(payload.effects).toEqual([
      { figure: "To invoice for Delete Test Client", before: 100, after: 900 },
      { figure: "Unpaid for Delete Test Client", before: 854, after: 0 },
    ])
    expect(payload.summary).toContain("To invoice for Delete Test Client €100.00 → €900.00. Unpaid for Delete Test Client €854.00 → €0.00.")
    expect(payload.notes.join(" ")).toContain("Credit note DI-3/2026 on the same months stays")
    const { payload: credit } = await callTool("delete_invoice", { invoice: "DI-3" })
    expect(credit.summary).toContain("delete credit note DI-3/2026 (Delete Test Client, -€122.00)")
    expect(credit.notes.join(" ")).toContain("It corrects DI-2/2026, which counts in full again without it.")
    expect((await admin.getInvoices(userId)).filter((i) => i.number.startsWith("DI-")).map((i) => i.number).sort()).toEqual(["DI-2/2026", "DI-3/2026"])
  })

  it("refuses a number it does not know, listing the numbers", async () => {
    expect(await refusal("delete_invoice", { invoice: "ZZ-404" })).toMatch(/^No invoice matches "ZZ-404"\. Numbers: .*DI-2\/2026/)
  })

  it("says an invoice closed as an offset against the credit note stays marked paid", async () => {
    const offsetClient = (await admin.createClient(userId, { name: "Offset Test Client" })).id
    for (const [number, sign] of [["OF-1/2026", 1], ["OF-2/2026", -1]] as const) {
      await admin.createInvoice(userId, {
        clientId: offsetClient, number, yearMonth: ym, amount: sign * 300, vat: sign * 66, paidDate: day(firstOfMonth), paidAccountId: NON_CASH,
      })
    }
    const { payload } = await callTool("delete_invoice", { invoice: "OF-2" })
    expect(payload.before).toMatchObject({ number: "OF-2/2026", paidInto: "offset, no money moved" })
    expect(payload.notes).toContain(
      "OF-1/2026 stays marked paid as an offset, no money moved: Unpaid doesn't count it. If this credit note was what settled it " +
        "and Offset Test Client now owes it, mark it unpaid with update_invoice paidDate null.",
    )
    // Unpaid doesn't move: both were settled.
    expect(effect(payload, "Unpaid for Offset Test Client")).toBeUndefined()
    expect((await admin.getInvoices(userId)).filter((i) => i.number.startsWith("OF-"))).toHaveLength(2)
  })

  it("audits the previews marked as previews, and the delete with its document", async () => {
    const entries = await auditOf("delete_invoice", 5)
    const previews = entries.filter((e) => e.preview === true)
    expect(previews.length).toBeGreaterThanOrEqual(3)
    expect(previews.every((e) => e.documentIds.length === 0)).toBe(true)
    const done = entries.find((e) => e.params.confirm === true)!
    expect(done).toMatchObject({ result: "ok", documentIds: [paidId] })
    expect(done.preview).toBeUndefined()
    expect(entries.find((e) => e.result === "error")).toMatchObject({ preview: true, errorMessage: expect.stringContaining("ZZ-404") })
  })
})

/** A movement written as the import or the page would, straight to Firestore. */
async function seedMovement(over: Record<string, unknown>): Promise<string> {
  const ref = await userSub("company_movements").add({
    userId, kind: "vat", direction: "out", amount: 1, date: day(firstOfMonth), accountId: mainId, toAccountId: null, expenseId: null,
    description: "x", documentRef: null, project: null, counterparty: null, notes: null, dateEstimated: false, importRef: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  })
  return ref.id
}

const firstLabel = format(day(firstOfMonth), "dd/MM/yyyy")
const effect = (payload: Payload, figure: string) => (payload.effects as Payload[]).find((e) => e.figure === figure)

describe("update_movement and delete_movement", () => {
  it("unlinks a rent payment from its lease and month when its kind leaves income, as the page does", async () => {
    const id = await seedMovement({
      kind: "income", direction: "in", amount: 950, leaseId: "lease-1", rentMonth: "2026-10", rentPart: "rent", description: "Rent October",
    })
    const { isError } = await callTool("update_movement", { id, kind: "vat", direction: "out", confirm: true })
    expect(isError).toBe(false)
    const stored = (await admin.getCompanyMovements(userId)).find((m) => m.id === id)
    expect(stored).toMatchObject({ kind: "vat", leaseId: null, rentMonth: null, rentPart: null })
  })

  it("unlinks a deposit from its lease when its kind changes to income", async () => {
    const id = await seedMovement({ kind: "deposit_held", direction: "in", amount: 1500, counterparty: "Room 7", leaseId: "lease-1", description: "Deposit Room 7" })
    const { isError } = await callTool("update_movement", { id, kind: "income", confirm: true })
    expect(isError).toBe(false)
    expect((await admin.getCompanyMovements(userId)).find((m) => m.id === id)).toMatchObject({ kind: "income", leaseId: null, rentMonth: null, rentPart: null })
    await callTool("delete_movement", { id, confirm: true }) // leave the book as the next test found it
  })

  it("keeps a deposit's lease when the deposit is edited; a deposit has no rent month to keep", async () => {
    const id = await seedMovement({ kind: "deposit_held", direction: "in", amount: 1500, counterparty: "Room 7", leaseId: "lease-1", description: "Deposit Room 7" })
    const { isError } = await callTool("update_movement", { id, amount: 1400, confirm: true })
    expect(isError).toBe(false)
    expect((await admin.getCompanyMovements(userId)).find((m) => m.id === id)).toMatchObject({ kind: "deposit_held", amount: 1400, leaseId: "lease-1", rentMonth: null })
  })

  it("previews an edit and writes nothing, then confirms it: the balance moves, the Plan does not", async () => {
    const id = await seedMovement({
      kind: "income", direction: "in", amount: 333.33, accountId: secondId, description: "Rent Room 7", counterparty: "Room 7", project: "Flat Rental",
    })
    const before = await balances()
    const { isError, payload } = await callTool("update_movement", { id, amount: 345.67 })
    expect(isError).toBe(false)
    expect(payload.preview).toBe(true)
    expect(payload.summary).toContain(
      `Preview, nothing changed yet: edit Rent & Other Income "Rent Room 7" €333.33 into Second Bank on ${firstLabel} → ` +
        `Rent & Other Income "Rent Room 7" €345.67 into Second Bank on ${firstLabel}.`,
    )
    expect(effect(payload, "Second Bank balance today")).toEqual({
      figure: "Second Bank balance today", before: before["Second Bank"], after: round(before["Second Bank"] + 12.34),
    })
    // Rent is cash, never in the Plan: only the balance moved.
    expect((payload.effects as Payload[]).map((e) => e.figure)).toEqual(["Second Bank balance today"])
    expect(payload.changes).toEqual(["amount 333.33 → 345.67"])
    expect(payload.summary).toContain(" Changes: amount 333.33 → 345.67. ")
    expect(payload.before).toMatchObject({ amount: 333.33, counterparty: "Room 7" })
    expect(payload.after).toMatchObject({ amount: 345.67, counterparty: "Room 7", costCentre: "Flat Rental" })
    expect((await admin.getCompanyMovements(userId)).find((m) => m.id === id)!.amount).toBe(333.33)
    expect(await balances()).toEqual(before)

    const { payload: done } = await callTool("update_movement", { id, amount: 345.67, confirm: true })
    expect(done.summary).toMatch(/^Updated: Rent & Other Income "Rent Room 7" €345\.67 into Second Bank/)
    expect(done.balances).toEqual({ "Second Bank": round(before["Second Bank"] + 12.34) })
    expect((await admin.getCompanyMovements(userId)).find((m) => m.id === id)).toMatchObject({ amount: 345.67, counterparty: "Room 7" })
  })

  it("refuses what Edit Movement refuses, and writes nothing", async () => {
    const id = await seedMovement({ kind: "transfer", amount: 111.11, toAccountId: secondId, description: "Transfer to Second Bank" })
    expect(await refusal("update_movement", { id, toAccount: "Main" })).toBe(
      "A transfer goes to a different company account from the one it left: both are Main Bank.",
    )
    // Edit Movement locks the direction across the transfer line, both ways.
    const stays = "A transfer stays a transfer, as in Edit Movement: delete it with delete_movement and add the right movement with add_movement."
    expect(await refusal("update_movement", { id, kind: "vat" })).toBe(stays)
    expect(await refusal("update_movement", { id, kind: "income", direction: "in", counterparty: "Room 9", confirm: true })).toBe(stays)
    expect(await refusal("update_movement", { id, date: isoDate(addDays(now, 1)) })).toMatch(/has not come yet/)
    expect(await refusal("update_movement", { id })).toMatch(/^Nothing to change/)
    const vat = await seedMovement({ kind: "vat", amount: 12.34, description: "VAT (F24)" })
    expect(await refusal("update_movement", { id: vat, toAccount: "Second" })).toBe("toAccount is for a transfer only (kind transfer).")
    expect(await refusal("update_movement", { id: vat, kind: "transfer", toAccount: "Second", confirm: true })).toBe(
      "A movement can't become a transfer, as in Edit Movement: delete it with delete_movement and add the transfer with add_movement.",
    )
    expect(await refusal("update_movement", { id: vat, kind: "deposit_held" })).toBe("Say whose deposit it is in counterparty, e.g. Room 2.")
    expect(await refusal("update_movement", { id: vat, kind: "supplier_payment" })).toMatch(/pass supplierInvoice/)
    // Its default description follows a new destination; a typed one stays.
    const third = await seedAccount("Third Bank", 0)
    const { payload } = await callTool("update_movement", { id, toAccount: "Third" })
    expect(payload.changes).toEqual(['toAccount "Second Bank" → "Third Bank"', 'description "Transfer to Second Bank" → "Transfer to Third Bank"'])
    await userSub("company_accounts").doc(third).delete()
    const stored = await admin.getCompanyMovements(userId)
    expect(stored.find((m) => m.id === id)).toMatchObject({ kind: "transfer", toAccountId: secondId, amount: 111.11 })
    expect(stored.find((m) => m.id === vat)).toMatchObject({ kind: "vat", toAccountId: null, counterparty: null })
  })

  it("keeps a supplier invoice payment within what is owed besides itself, and says You Owe Suppliers", async () => {
    const bill = await admin.createCompanyExpense(userId, {
      description: "Plumber", category: "other", amount: 300, vat: 0, date: day(firstOfMonth), documentRef: "SB-1",
    })
    const id = await seedMovement({ kind: "supplier_payment", amount: 100, expenseId: bill.id, description: "Supplier Invoice Payment" })
    expect(await refusal("update_movement", { id, amount: 300.01 })).toBe(
      "Only €300.00 is owed on SB-1 besides this payment. Record anything more as a cost with add_expense.",
    )
    const { payload } = await callTool("update_movement", { id, amount: 250 })
    const owed = effect(payload, "You Owe Suppliers")!
    expect(round(owed.before - owed.after)).toBe(150)
    expect(payload.after).toMatchObject({ supplierInvoice: "SB-1", amount: 250 })
    // Moved onto another supplier invoice: checked against what that one is owed.
    await admin.createCompanyExpense(userId, { description: "Painter", category: "other", amount: 80, vat: 0, date: day(firstOfMonth), documentRef: "SB-2" })
    expect(await refusal("update_movement", { id, supplierInvoice: "SB-2" })).toBe("Only €80.00 is owed on SB-2. Record anything more as a cost with add_expense.")
    await callTool("update_movement", { id, supplierInvoice: "sb-2", amount: 80, confirm: true })
    const paid = (await admin.getCompanyMovements(userId)).find((m) => m.id === id)!
    const painter = (await admin.getCompanyExpenses(userId)).find((e) => e.documentRef === "SB-2")!
    expect(paid).toMatchObject({ expenseId: painter.id, amount: 80, kind: "supplier_payment" })
  })

  it("says what an edit means for Undo Import, keeps the importRef, and Undo Import then lists the row as changed", async () => {
    const id = await seedMovement({ kind: "tax", amount: 45.67, description: "IRAP (F24)", importRef: "2026:Ottobre!9" })
    const { payload } = await callTool("update_movement", { id, description: "IRAP balance (F24)" })
    expect(payload.notes).toContain(
      "Imported from the prima nota workbook (2026:Ottobre!9): Undo Import will list it as changed since the import and keep it as " +
        "edited unless the owner ticks it there, and it can't bring back the workbook's version.",
    )
    expect(payload.summary).toContain('Changes: description "IRAP (F24)" → "IRAP balance (F24)". No balance or total moves.')
    await new Promise((r) => setTimeout(r, 1100)) // planUndo reads "edited" as updated more than a second after creation.
    await callTool("update_movement", { id, description: "IRAP balance (F24)", confirm: true })
    const b = await book()
    expect(b.movements.find((m) => m.id === id)).toMatchObject({ description: "IRAP balance (F24)", importRef: "2026:Ottobre!9" })
    expect(planUndo(b, false).edited.map((e) => e.id)).toContain(id)
    const { payload: gone } = await callTool("delete_movement", { id })
    expect(gone.notes).toEqual([
      "Imported from the prima nota workbook (2026:Ottobre!9): Undo Import will find it gone already, and importing the workbook " +
        "again after an Undo brings it back unless the workbook is corrected too.",
    ])
  })

  it("previews a delete and writes nothing, then deletes: a deposit given up leaves Deposits to give back", async () => {
    const id = await seedMovement({ kind: "deposit_held", direction: "in", amount: 222.22, accountId: secondId, description: "Deposit Received", counterparty: "Room 8" })
    const before = await balances()
    const { payload } = await callTool("delete_movement", { id })
    expect(payload.summary).toContain(`Preview, nothing changed yet: delete Deposit Received €222.22 into Second Bank on ${firstLabel}.`)
    const held = effect(payload, "Deposits to give back")!
    expect(round(held.before - held.after)).toBe(222.22)
    expect((await admin.getCompanyMovements(userId)).some((m) => m.id === id)).toBe(true)
    const { payload: done } = await callTool("delete_movement", { id, confirm: true })
    expect(done.summary).toMatch(/^Deleted: Deposit Received €222\.22 into Second Bank/)
    expect(done.balances).toEqual({ "Second Bank": round(before["Second Bank"] - 222.22) })
    expect((await admin.getCompanyMovements(userId)).some((m) => m.id === id)).toBe(false)
  })

  it("sends an id from another collection to its own tool", async () => {
    const cost = (await admin.getCompanyExpenses(userId)).find((e) => e.description === "Rent")!
    expect(await refusal("delete_movement", { id: cost.id })).toBe(`${cost.id} is a cost, not a movement: use update_expense or delete_expense.`)
    const invoice = (await admin.getInvoices(userId)).find((i) => i.number === "CB-2/2026")!
    expect(await refusal("update_movement", { id: invoice.id, amount: 1 })).toBe(
      `${invoice.id} is an invoice, not a movement: use update_invoice or delete_invoice.`,
    )
    expect(await refusal("update_movement", { id: "nope", amount: 1 })).toBe(
      'No movement with id "nope". get_cash_book lists each entry\'s source and id, in rows and otherEntries.',
    )
  })

  it("audits previews as previews and the confirmed writes with their document", async () => {
    const entries = await auditOf("update_movement", 4)
    expect(entries.filter((e) => e.preview === true).every((e) => e.documentIds.length === 0)).toBe(true)
    // A confirmed write carries its document; a confirmed call refused, none, and is no preview either.
    const confirmed = entries.filter((e) => e.params.confirm === true)
    expect(confirmed.filter((e) => e.result === "ok").every((e) => e.documentIds.length === 1 && !e.preview)).toBe(true)
    expect(confirmed.some((e) => e.result === "error" && !e.preview)).toBe(true)
    expect(entries.some((e) => e.result === "error" && e.preview === true)).toBe(true)
    expect((await auditOf("delete_movement", 3)).some((e) => e.params.confirm === true && e.result === "ok")).toBe(true)
  })
})

describe("update_expense and delete_expense", () => {
  let gasId = ""
  let billId = ""
  let paymentId = ""
  let estimateId = ""

  beforeAll(async () => {
    gasId = (await admin.createCompanyExpense(userId, {
      description: "Gas", category: "other", amount: 123.45, vat: 0, date: day(firstOfMonth), accountId: secondId, documentRef: "G-1",
    })).id
    billId = (await admin.createCompanyExpense(userId, {
      description: "Electrician", category: "other", amount: 400, vat: 0, date: day(firstOfMonth), documentRef: "EL-4",
    })).id
    paymentId = await seedMovement({ kind: "supplier_payment", amount: 150, expenseId: billId, description: "Supplier Invoice Payment", documentRef: "EL-4" })
    estimateId = (await admin.createCompanyExpense(userId, {
      description: "Bookkeeping", category: "accountant", amount: 200, vat: 0, date: day(opened), isRecurring: true, recurrenceMonths: 1,
    })).id
  })

  it("keeps a rent offset on its month when its date is edited", async () => {
    const month = isoDate(day(firstOfMonth)).slice(0, 7)
    const offset = await admin.createCompanyExpense(userId, {
      description: "Works, taken off the rent", category: "other", amount: 520, vat: 0, date: day(firstOfMonth), accountId: secondId, leaseId: "lease-1", forMonth: month,
    })
    const { isError } = await callTool("update_expense", { id: offset.id, date: isoDate(addDays(day(firstOfMonth), -45)), confirm: true })
    expect(isError).toBe(false)
    expect((await admin.getCompanyExpenses(userId)).find((e) => e.id === offset.id)).toMatchObject({ leaseId: "lease-1", forMonth: month })
  })

  it("previews a new total and writes nothing, then confirms: the balance and the Plan's costs move", async () => {
    const before = await balances()
    const { payload } = await callTool("update_expense", { id: gasId, total: 150 })
    expect(payload.summary).toContain(`Preview, nothing changed yet: edit cost "Gas" €123.45 from Second Bank on ${firstLabel} → cost "Gas" €150.00 from Second Bank`)
    expect(effect(payload, "Second Bank balance today")).toMatchObject({ before: before["Second Bank"], after: round(before["Second Bank"] - 26.55) })
    const plan = effect(payload, `Plan other costs in ${formatYearMonth(ym)}`)!
    expect(round(plan.after - plan.before)).toBe(26.55)
    expect((await admin.getCompanyExpenses(userId)).find((e) => e.id === gasId)!.amount).toBe(123.45)
    const { payload: done } = await callTool("update_expense", { id: gasId, total: 150, confirm: true })
    expect(done.summary).toContain(`Company account balance today: Second Bank ${eur(round(before["Second Bank"] - 26.55))}.`)
    expect((await admin.getCompanyExpenses(userId)).find((e) => e.id === gasId)).toMatchObject({ amount: 150, vat: 0, accountId: secondId })
  })

  it("moved to the owner's card: the account gets it back and SRL Owes You grows", async () => {
    const { payload } = await callTool("update_expense", { id: gasId, paidFrom: "owner" })
    const srl = effect(payload, "SRL Owes You")!
    expect(round(srl.after - srl.before)).toBe(150)
    expect(round(effect(payload, "Second Bank balance today")!.after - effect(payload, "Second Bank balance today")!.before)).toBe(150)
    expect(payload.after).toMatchObject({ paidFrom: "owner", refund: false })
  })

  it("turned into a refund, the money comes back into the account instead of leaving it", async () => {
    const { payload } = await callTool("update_expense", { id: gasId, refund: true })
    const balance = effect(payload, "Second Bank balance today")!
    expect(round(balance.after - balance.before)).toBe(300)
    expect(payload.changes).toEqual(["refund false → true"])
    expect(payload.summary).toContain('→ refund "Gas" €150.00 back into Second Bank')
  })

  it("says what touching an imported cost means for Undo Import", async () => {
    const imported = await admin.createCompanyExpense(userId, {
      description: "Stamp duty", category: "other", amount: 16, vat: 0, date: day(firstOfMonth), accountId: mainId, importRef: "2026:Ottobre!12",
    })
    const { payload: edit } = await callTool("update_expense", { id: imported.id, notes: "F24 line" })
    expect(edit.notes.join(" ")).toContain("Imported from the prima nota workbook (2026:Ottobre!12): Undo Import will list it as changed")
    const { payload: gone } = await callTool("delete_expense", { id: imported.id })
    expect(gone.notes).toContain(
      "Imported from the prima nota workbook (2026:Ottobre!12): Undo Import will find it gone already, and importing the workbook " +
        "again after an Undo brings it back unless the workbook is corrected too.",
    )
    expect((await admin.getCompanyExpenses(userId)).find((e) => e.id === imported.id)).toMatchObject({ notes: null, importRef: "2026:Ottobre!12" })
  })

  it("unlinked from its estimate, the Plan counts the estimate again that month", async () => {
    const paid = await admin.createCompanyExpense(userId, {
      description: "Bookkeeping October", category: "accountant", amount: 210, vat: 0, date: day(firstOfMonth), accountId: mainId,
      recurringExpenseId: estimateId, documentRef: "BK-10",
    })
    const { payload } = await callTool("update_expense", { id: paid.id, paysRecurring: "none" })
    const plan = effect(payload, `Plan other costs in ${formatYearMonth(ym)}`)!
    expect(round(plan.after - plan.before)).toBe(200)
    expect(payload.before.paysRecurring).toBe("Bookkeeping")
    expect(payload.after.paysRecurring).toBeNull()
  })

  it("keeps a supplier invoice with payments one, naming the payments, and lets its words change", async () => {
    for (const change of [{ paidFrom: "Main" }, { paidFrom: "owner" }, { documentRef: "" }]) {
      const error = await refusal("update_expense", { id: billId, ...change })
      expect(error).toContain(BILL_HAS_PAYMENTS)
      expect(error).toContain(`(movement ${paymentId})`)
    }
    const { isError, payload } = await callTool("update_expense", { id: billId, description: "Electrician, September" })
    expect(isError).toBe(false)
    expect(payload.after).toMatchObject({ description: "Electrician, September", paidFrom: "not_paid", documentRef: "EL-4" })
    expect((await admin.getCompanyExpenses(userId)).find((e) => e.id === billId)).toMatchObject({ description: "Electrician", accountId: null })
  })

  it("refuses what the Costs form refuses", async () => {
    expect(await refusal("update_expense", { id: estimateId, total: 1 })).toBe(
      '"Bookkeeping" is a recurring estimate in the Plan, not a Cash Book entry: edit it on Costs in the web app.',
    )
    expect(await refusal("update_expense", { id: gasId, refund: true, paidFrom: "owner" })).toBe(
      "A refund is money back into a company account: pass paidFrom with the account.",
    )
    expect(await refusal("update_expense", { id: gasId, vat: 150 })).toMatch(/^vat is part of total/)
    expect(await refusal("update_expense", { id: gasId, paidFrom: "Third" })).toMatch(/^No company account matches "Third"/)
  })

  it("refuses to delete a supplier invoice with payments until they are gone, then deletes it", async () => {
    const error = await refusal("delete_expense", { id: billId, confirm: true })
    expect(error).toContain(BILL_HAS_PAYMENTS)
    expect(error).toContain(`(movement ${paymentId}). delete_movement removes each.`)
    expect((await admin.getCompanyExpenses(userId)).some((e) => e.id === billId)).toBe(true)
    await callTool("delete_movement", { id: paymentId, confirm: true })
    const { payload } = await callTool("delete_expense", { id: billId })
    expect(payload.summary).toContain('delete cost "Electrician" €400.00 owed to the supplier (EL-4)')
    const owed = effect(payload, "You Owe Suppliers")!
    expect(round(owed.before - owed.after)).toBe(400)
    expect((await admin.getCompanyExpenses(userId)).some((e) => e.id === billId)).toBe(true)
    await callTool("delete_expense", { id: billId, confirm: true })
    expect((await admin.getCompanyExpenses(userId)).some((e) => e.id === billId)).toBe(false)
    expect(await refusal("delete_expense", { id: estimateId })).toMatch(/recurring estimate in the Plan/)
  })

  it("warns when moving or deleting a card cost leaves the SRL having repaid more than it owed", async () => {
    const laptop = await admin.createCompanyExpense(userId, {
      description: "Laptop", category: "office_supplies", amount: 500, vat: 0, date: day(firstOfMonth), paidByOwner: true, documentRef: "LP-1",
    })
    // Repaid exactly what the SRL owes: SRL Owes You €0.00.
    const b = await book()
    const repay = await admin.createCompanyLoan(userId, {
      description: "Shareholder Loan Repayment", direction: "from_company", amount: ownerLoanBalance(b.loans, b.expenses).total,
      date: day(firstOfMonth), accountId: mainId,
    })
    const warning = "After it the SRL would have paid you €500.00 more than it owed, which an SRL can't do. Check the amounts."
    try {
      const { payload: moved } = await callTool("update_expense", { id: laptop.id, paidFrom: "Main" })
      expect(moved.notes).toContain(warning)
      const { payload: gone } = await callTool("delete_expense", { id: laptop.id })
      expect(gone.notes).toContain(warning)
      // A change that leaves the card part alone says nothing.
      expect((await callTool("update_expense", { id: laptop.id, notes: "Work laptop" })).payload.notes).not.toContain(warning)
    } finally {
      await admin.deleteCompanyLoan(userId, repay.id)
      await admin.deleteCompanyExpense(userId, laptop.id)
    }
  })

  it("audits previews and writes", async () => {
    expect((await auditOf("update_expense", 6)).some((e) => e.params.confirm === true && e.result === "ok" && !e.preview)).toBe(true)
    expect((await auditOf("delete_expense", 3)).some((e) => e.result === "error" && e.params.confirm === true && !e.preview)).toBe(true)
  })
})

describe("update_loan and delete_loan", () => {
  it("previews and confirms a loan's new amount: SRL Owes You and the balance move", async () => {
    const loan = await admin.createCompanyLoan(userId, {
      description: "Shareholder Loan", direction: "to_company", amount: 1111, date: day(firstOfMonth), accountId: mainId,
    })
    const before = await balances()
    const { payload } = await callTool("update_loan", { id: loan.id, amount: 1000 })
    expect(payload.summary).toContain(`edit shareholder loan €1,111.00 into Main Bank on ${firstLabel} → shareholder loan €1,000.00 into Main Bank`)
    const srl = effect(payload, "SRL Owes You")!
    expect(round(srl.before - srl.after)).toBe(111)
    expect((await admin.getCompanyLoans(userId)).find((l) => l.id === loan.id)!.amount).toBe(1111)
    const { payload: done } = await callTool("update_loan", { id: loan.id, amount: 1000, confirm: true })
    expect(done.balances).toEqual({ "Main Bank": before["Main Bank"] - 111 })
    expect((await admin.getCompanyLoans(userId)).find((l) => l.id === loan.id)!.amount).toBe(1000)

    const { payload: gone } = await callTool("delete_loan", { id: loan.id })
    expect(gone.summary).toContain(`delete shareholder loan €1,000.00 into Main Bank on ${firstLabel}`)
    expect(round(effect(gone, "SRL Owes You")!.before - effect(gone, "SRL Owes You")!.after)).toBe(1000)
    expect((await admin.getCompanyLoans(userId)).some((l) => l.id === loan.id)).toBe(true)
    const { payload: deleted } = await callTool("delete_loan", { id: loan.id, confirm: true })
    expect(deleted.balances).toEqual({ "Main Bank": before["Main Bank"] - 1111 })
    expect((await admin.getCompanyLoans(userId)).some((l) => l.id === loan.id)).toBe(false)
    const entries = await auditOf("delete_loan", 2)
    expect(entries.map((e) => [e.result, e.preview ?? false, e.documentIds])).toEqual([["ok", true, []], ["ok", false, [loan.id]]])
  })

  it("says what touching an imported loan means for Undo Import, and sends other ids to their tool", async () => {
    const imported = await admin.createCompanyLoan(userId, {
      description: "Shareholder Loan", direction: "to_company", amount: 700, date: day(firstOfMonth), accountId: mainId, importRef: "2026:Ottobre!3",
    })
    const { payload } = await callTool("update_loan", { id: imported.id, account: "Second" })
    expect(payload.notes.join(" ")).toContain("Imported from the prima nota workbook (2026:Ottobre!3)")
    expect(payload.changes).toEqual(['account "Main Bank" → "Second Bank"'])
    const vat = (await admin.getCompanyMovements(userId)).find((m) => m.kind === "vat")!
    expect(await refusal("delete_loan", { id: vat.id })).toBe(`${vat.id} is a movement, not a shareholder loan: use update_movement or delete_movement.`)
  })

  it("warns when repayments would pass what the SRL owed", async () => {
    const repay = await admin.createCompanyLoan(userId, {
      description: "Shareholder Loan Repayment", direction: "from_company", amount: 50, date: day(firstOfMonth), accountId: mainId,
    })
    const { payload } = await callTool("update_loan", { id: repay.id, amount: 999999 })
    expect(payload.notes.join(" ")).toMatch(/more than it owed, which an SRL can't do/)
    const { payload: flipped } = await callTool("update_loan", { id: repay.id, direction: "to_company" })
    expect(flipped.after).toMatchObject({ direction: "to_company", description: "Shareholder Loan" })
    expect(await schemaRefusal("update_loan", { id: repay.id, amount: 0 })).toMatch(/Input validation/)
    expect(await refusal("update_loan", { id: repay.id, date: isoDate(addDays(now, 2)) })).toMatch(/has not come yet/)
    expect((await auditOf("update_loan", 3)).some((e) => e.preview === true)).toBe(true)
  })

  it("finds a loan through no account in otherEntries, so it can be edited and deleted", async () => {
    const loose = await admin.createCompanyLoan(userId, {
      description: "Shareholder Loan", direction: "to_company", amount: 700, date: day(firstOfMonth), accountId: null,
    })
    const { payload } = await callTool("get_cash_book")
    expect(payload.otherEntries).toContainEqual({
      date: firstOfMonth, paidBy: "no account", type: "Shareholder Loan", kind: "loan", description: "Shareholder Loan",
      documentRef: null, costCentre: null, amount: 700, source: "loan", id: loose.id,
    })
    // Through no account: not under one, nor under a named cost centre; under Untagged, as the loan rows.
    expect((await callTool("get_cash_book", { account: "Main" })).payload.otherEntries.some((e: Payload) => e.id === loose.id)).toBe(false)
    expect((await callTool("get_cash_book", { costCentre: "Flat Rental" })).payload.otherEntries.some((e: Payload) => e.id === loose.id)).toBe(false)
    expect((await callTool("get_cash_book", { costCentre: "untagged" })).payload.otherEntries.some((e: Payload) => e.id === loose.id)).toBe(true)

    const { payload: edit } = await callTool("update_loan", { id: loose.id, amount: 650 })
    expect(round(effect(edit, "SRL Owes You")!.before - effect(edit, "SRL Owes You")!.after)).toBe(50)
    const { payload: done } = await callTool("delete_loan", { id: loose.id, confirm: true })
    expect(done.summary).toMatch(/^Deleted: shareholder loan €700\.00 on /)
    expect((await admin.getCompanyLoans(userId)).some((l) => l.id === loose.id)).toBe(false)
  })
})

describe("update_invoice on a paid invoice", () => {
  let paidId = ""

  beforeAll(async () => {
    const customer = (await admin.createClient(userId, { name: "Edit Invoice Client" })).id
    paidId = (await admin.createInvoice(userId, { clientId: customer, number: "EI-1/2026", yearMonth: ym, amount: 500, vat: 110 })).id
    await admin.settleInvoicePayment(userId, { invoiceId: paidId, paidDate: day(firstOfMonth), paidAccountId: mainId, fee: 3.5 })
  })

  const stored = async () => (await admin.getInvoices(userId)).find((i) => i.id === paidId)!

  it("previews a new amount and writes nothing: the balance and Unpaid stay, the account moves", async () => {
    const before = await balances()
    const { isError, payload } = await callTool("update_invoice", { invoice: "EI-1/2026", amount: 400 })
    expect(isError).toBe(false)
    expect(payload.preview).toBe(true)
    expect(payload.summary).toMatch(/^Preview, nothing changed yet: edit invoice EI-1\/2026 \(Edit Invoice Client, €610\.00\): net €400\.00, VAT €110\.00, total €510\.00\./)
    expect(payload.changes).toEqual(["amount 500 → 400", "total 610 → 510"])
    expect(effect(payload, "Main Bank balance today")).toEqual({ figure: "Main Bank balance today", before: before["Main Bank"], after: round(before["Main Bank"] - 100) })
    expect(await stored()).toMatchObject({ amount: 500, paidAccountId: mainId })
    expect(await balances()).toEqual(before)
  })

  it("marked unpaid: previews the payment leaving and the fee that stays, then clears the account too", async () => {
    const before = await balances()
    const { payload } = await callTool("update_invoice", { invoice: "EI-1/2026", paidDate: null })
    expect(payload.preview).toBe(true)
    expect(payload.changes).toEqual([`paidDate "${firstOfMonth}" → none`, 'paidInto "Main Bank" → none'])
    expect(effect(payload, "Main Bank balance today")).toEqual({ figure: "Main Bank balance today", before: before["Main Bank"], after: round(before["Main Bank"] - 610) })
    expect(effect(payload, "Unpaid for Edit Invoice Client")).toEqual({ figure: "Unpaid for Edit Invoice Client", before: 0, after: 610 })
    expect(payload.notes).toEqual([
      `The €3.50 bank fee booked with its payment ("Bank fee on invoice EI-1/2026", expense bank-fee-${paidId}) stays on Costs, ` +
        `as on the web. To remove it too, delete_expense id bank-fee-${paidId}.`,
    ])
    expect((await stored()).paidDate).not.toBeNull()

    const { payload: done } = await callTool("update_invoice", { invoice: "EI-1/2026", paidDate: null, confirm: true })
    expect(done.summary).toMatch(/^Invoice EI-1\/2026 updated: marked unpaid\./)
    expect(done.summary).toContain(`Company account balance today: Main Bank ${eur(round(before["Main Bank"] - 610))}.`)
    expect(done.balances).toEqual({ "Main Bank": round(before["Main Bank"] - 610) })
    expect(await stored()).toMatchObject({ paidDate: null, paidAccountId: null, amount: 500 })
    expect((await admin.getCompanyExpenses(userId)).some((e) => e.id === `bank-fee-${paidId}`)).toBe(true)
  })

  it("audits the previews as previews and the confirmed edit with its document", async () => {
    const entries = (await auditOf("update_invoice", 4)).filter((e) => e.params.invoice === "EI-1/2026")
    expect(entries.map((e) => [e.result, e.preview ?? false, e.documentIds])).toEqual([
      ["ok", true, []],
      ["ok", true, []],
      ["ok", false, [paidId]],
    ])
  })
})

// #328: a collaborator's invoice names who it is from, the contract and the month of work it pays.
describe("collaborator invoices over add_expense and update_expense", () => {
  const worked = format(subMonths(now, 1), "yyyy-MM")
  const workedName = format(subMonths(now, 1), "MMMM")
  let giulia = ""
  let verdi = ""
  let contract = ""

  const readCost = async (ref: string) => (await admin.getCompanyExpenses(userId)).find((e) => e.documentRef === ref)!

  beforeAll(async () => {
    const stamp = { userId, notes: null, isActive: true, createdAt: new Date(), updatedAt: new Date() }
    giulia = (await userSub("collaborators").add({ ...stamp, name: "Giulia Neri", type: "freelancer", fee: null })).id
    verdi = (
      await userSub("collaborators").add({
        ...stamp, name: "Studio Verdi", type: "company", fee: { amount: 2400, from: "2020-01", until: null, changes: [] },
      })
    ).id
    const nordwind = await admin.createClient(userId, { name: "Nordwind" })
    contract = (await admin.createEngagement(userId, {
      clientId: nordwind.id, name: "Product Graph", dailyRate: 520, vatApplicable: true, defaultDaysPerMonth: 8,
    })).id
    await userSub("collaborator_assignments").add({
      userId, collaboratorId: giulia, engagementId: contract, dailyRate: 320, from: worked, until: null, defaultDays: 4, monthDays: {},
      createdAt: new Date(), updatedAt: new Date(),
    })
    // Four days of hers logged in the month of work: 4 × €320 = €1,280.
    for (const d of ["01", "02", "03", "04"]) {
      await admin.setTimecard(userId, { engagementId: contract, collaboratorId: giulia, date: `${worked}-${d}`, hours: 8 })
    }
  })

  it("books the invoice against her, the contract she is on and the month, and says how the month stands", async () => {
    const { isError, payload } = await callTool("add_expense", {
      description: "Invoice 9/2026, Giulia", total: 1280, paidFrom: "Main", collaborator: "giulia neri", for_month: worked, documentRef: "G-9",
    })
    expect(isError).toBe(false)
    expect(payload.summary).toContain(`${workedName}: invoiced €1,280 of €1,280 planned.`)
    expect(await readCost("G-9")).toMatchObject({
      category: "collaborators", collaboratorId: giulia, engagementId: contract, forMonth: worked, amount: 1280,
    })
    expect(payload.cost).toMatchObject({ category: "collaborators", collaborator: "Giulia Neri", contract: "Nordwind · Product Graph", forMonth: worked })
  })

  it("defaults the month to the date's and the fixed fee for one on no contract, and names what is missing", async () => {
    const { payload } = await callTool("add_expense", {
      description: "Invoice 14/2026, Verdi", total: 1000, paidFrom: "Main", collaborator: "Studio Verdi", date: `${worked}-20`, documentRef: "V-14",
    })
    expect(payload.summary).toContain(`${workedName}: invoiced €1,000 of €2,400 planned, €1,400 missing.`)
    expect(await readCost("V-14")).toMatchObject({ collaboratorId: verdi, engagementId: null, forMonth: worked })
  })

  it("refuses an unknown name with the list, a contract that is not theirs, and a stray field", async () => {
    const base = { description: "Invoice", total: 100, paidFrom: "Main" }
    expect(await refusal("add_expense", { ...base, collaborator: "Mario" })).toBe('No collaborator matches "Mario". Collaborators: Giulia Neri, Studio Verdi.')
    expect(await refusal("add_expense", { ...base, collaborator: "Studio Verdi", contract: "Product Graph" })).toMatch(/Studio Verdi is not on "Product Graph"/)
    expect(await refusal("add_expense", { ...base, category: "other", for_month: worked })).toMatch(/pass collaborator/)
    expect(await refusal("add_expense", { ...base, collaborator: "Giulia Neri", supplierInvoice: "G-9" })).toMatch(/update_expense/)
  })

  it("sets, moves and clears the link on a cost already recorded as Other", async () => {
    const other = await admin.createCompanyExpense(userId, {
      description: "Verdi, via the bank", category: "other", amount: 2400, vat: 0, date: day(`${worked}-28`), accountId: mainId, documentRef: "V-15",
    })
    const preview = await callTool("update_expense", { id: other.id, collaborator: "Studio Verdi", for_month: worked })
    expect(preview.payload.preview).toBe(true)
    expect((await readCost("V-15")).collaboratorId).toBeNull()
    const set = await callTool("update_expense", { id: other.id, collaborator: "Studio Verdi", for_month: worked, confirm: true })
    expect(set.payload.summary).toContain(`${workedName}: invoiced €3,400 of €2,400 planned.`)
    expect(await readCost("V-15")).toMatchObject({ category: "collaborators", collaboratorId: verdi, engagementId: null, forMonth: worked })
    const moved = await callTool("update_expense", { id: other.id, for_month: format(subMonths(now, 2), "yyyy-MM"), confirm: true })
    expect(moved.isError).toBe(false)
    expect((await readCost("V-15")).forMonth).toBe(format(subMonths(now, 2), "yyyy-MM"))
    await callTool("update_expense", { id: other.id, collaborator: "none", category: "other", confirm: true })
    expect(await readCost("V-15")).toMatchObject({ category: "other", collaboratorId: null, engagementId: null, forMonth: null })
  })

  it("refuses a Collaborators cost with no collaborator, and clearing the link without a new category", async () => {
    const base = { description: "Invoice", total: 100, paidFrom: "Main" }
    expect(await refusal("add_expense", { ...base, category: "collaborators" })).toBe("A Collaborators cost needs the collaborator: pass collaborator.")
    const linked = await admin.createCompanyExpense(userId, {
      description: "Verdi", category: "collaborators", amount: 2400, vat: 0, date: day(`${worked}-27`), accountId: mainId, documentRef: "V-16",
      collaboratorId: verdi, forMonth: worked,
    })
    expect(await refusal("update_expense", { id: linked.id, collaborator: "none", confirm: true })).toMatch(/needs the collaborator.*or a new category/)
    expect(await refusal("update_expense", { id: linked.id, category: "collaborators", collaborator: "none", confirm: true })).toMatch(/needs the collaborator/)
    expect(await readCost("V-16")).toMatchObject({ category: "collaborators", collaboratorId: verdi })
  })

  it("moves For Month with the date unless it was set apart from it", async () => {
    const earlier = format(subMonths(now, 2), "yyyy-MM")
    const follows = await admin.createCompanyExpense(userId, {
      description: "Verdi follows", category: "collaborators", amount: 2400, vat: 0, date: day(`${worked}-27`), accountId: mainId, documentRef: "V-17",
      collaboratorId: verdi, forMonth: worked,
    })
    await callTool("update_expense", { id: follows.id, date: `${earlier}-10`, confirm: true })
    expect(await readCost("V-17")).toMatchObject({ forMonth: earlier })
    const apart = await admin.createCompanyExpense(userId, {
      description: "Verdi apart", category: "collaborators", amount: 2400, vat: 0, date: day(`${worked}-27`), accountId: mainId, documentRef: "V-18",
      collaboratorId: verdi, forMonth: earlier,
    })
    await callTool("update_expense", { id: apart.id, date: `${worked}-05`, confirm: true })
    expect(await readCost("V-18")).toMatchObject({ forMonth: earlier })
  })

  it("names the collaborator and contract on the cost it shows, and a collaborator who is gone", async () => {
    const withBoth = await admin.createCompanyExpense(userId, {
      description: "Giulia card", category: "collaborators", amount: 1280, vat: 0, date: day(`${worked}-26`), accountId: mainId, documentRef: "G-19",
      collaboratorId: giulia, engagementId: contract, forMonth: worked,
    })
    const preview = await callTool("update_expense", { id: withBoth.id, notes: "checked" })
    expect(preview.payload.before).toMatchObject({ collaborator: "Giulia Neri", contract: "Nordwind · Product Graph" })
    const orphan = await admin.createCompanyExpense(userId, {
      description: "Gone", category: "collaborators", amount: 100, vat: 0, date: day(`${worked}-25`), accountId: mainId, documentRef: "X-20",
      collaboratorId: "deleted-collaborator", forMonth: worked,
    })
    expect((await callTool("update_expense", { id: orphan.id, notes: "n" })).payload.before).toMatchObject({ collaborator: "A collaborator who no longer exists" })
    expect(await refusal("update_expense", { id: orphan.id, for_month: worked, confirm: true })).toBe(
      "The collaborator on this cost no longer exists: pass collaborator with another name.",
    )
  })
})

const round = (n: number) => Math.round(n * 100) / 100

function eur(n: number): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n)
}
