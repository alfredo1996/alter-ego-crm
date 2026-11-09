/**
 * Invoice files over MCP (attach_file, remove_file, get_file, and the file on the reads) —
 * end-to-end through the route handler, real Firestore and real Storage. Synthetic data only.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts, Storage included).
 */
import { readFileSync } from "node:fs"

import { isoDate } from "@alter-ego/kernel/dates"
import { format, startOfMonth, subMonths } from "date-fns"
import { createUserWithEmailAndPassword } from "firebase/auth"
import { beforeAll, describe, expect, it } from "vitest"

import { POST as mcp } from "@/app/api/mcp/route"
import { POST as approve } from "@/app/api/oauth/authorize/route"
import { POST as register } from "@/app/api/oauth/register/route"
import { POST as token } from "@/app/api/oauth/token/route"
import * as admin from "@/lib/backend/firebase-admin"
import { getAdminBucket, getAdminFirestore } from "@/lib/firebase-admin-client"
import { getFirebaseAuth } from "@/lib/firebase-client"
import { s256 } from "@/lib/oauth/pkce"

const ORIGIN = "https://mcp.test"
const REDIRECT = "https://claude.ai/api/mcp/auth_callback"
const VERIFIER = "a".repeat(43)

const now = new Date()
const ym = format(now, "yyyy-MM")
const day = (iso: string) => new Date(`${iso}T00:00:00`)
const opened = isoDate(startOfMonth(subMonths(now, 1)))

const standardXml = readFileSync("src/lib/__tests__/fixtures/fattura-pa/standard.xml")
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64")

let userId = ""
let writeBearer = ""
let readOnlyBearer = ""
let accountId = ""
let clientId = ""

async function mintToken(idToken: string, scope: string): Promise<string> {
  const reg = await register(
    new Request(`${ORIGIN}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "test", redirect_uris: [REDIRECT] }),
    }),
  )
  const { client_id: oauthClient } = (await reg.json()) as { client_id: string }
  const auth = await approve(
    new Request(`${ORIGIN}/api/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken, clientId: oauthClient, redirectUri: REDIRECT, scope, codeChallenge: await s256(VERIFIER), codeChallengeMethod: "S256" }),
    }),
  )
  const { code } = (await auth.json()) as { code: string }
  const tok = await token(
    new Request(`${ORIGIN}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, client_id: oauthClient, redirect_uri: REDIRECT }),
    }),
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
type Content = { type: string; text?: string; resource?: { uri: string; mimeType: string; blob: string } }

async function call(name: string, args: Record<string, unknown>) {
  const res = await mcp(rpcRequest(writeBearer, name, args))
  expect(res.status).toBe(200)
  const dataLine = (await res.text()).split("\n").find((l) => l.startsWith("data: "))!
  const rpc = JSON.parse(dataLine.slice(6)) as { result: { isError?: boolean; content: Content[] } }
  return { isError: rpc.result.isError ?? false, content: rpc.result.content, payload: JSON.parse(rpc.result.content[0].text!) as Payload }
}
const callOk = async (name: string, args: Record<string, unknown>) => {
  const r = await call(name, args)
  expect(r.isError, JSON.stringify(r.payload)).toBe(false)
  return r
}
const refusal = async (name: string, args: Record<string, unknown>) => {
  const r = await call(name, args)
  expect(r.isError).toBe(true)
  return r.payload.error as string
}

const objectCount = async () => (await getAdminBucket()!.getFiles({ prefix: `users/${userId}/company-files/` }))[0].length
const exists = async (path: string) => (await getAdminBucket()!.file(path).exists())[0]
const bytesAt = async (path: string) => (await getAdminBucket()!.file(path).download())[0]
const cost = (description: string, over: Record<string, unknown> = {}) =>
  admin.createCompanyExpense(userId, { description, category: "other", amount: 100, date: day(`${ym}-01`), accountId, ...over } as never)
const invoice = (number: string) => admin.createInvoice(userId, { clientId, number, yearMonth: ym, amount: 1000, vat: 220 })
const storedCost = async (id: string) => (await admin.getCompanyExpenses(userId)).find((e) => e.id === id)!
const storedInvoice = async (id: string) => (await admin.getInvoices(userId)).find((i) => i.id === id)!

beforeAll(async () => {
  const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), `mcp-files-${Date.now()}@example.com`, "Test1234!")
  userId = user.uid
  const idToken = await user.getIdToken()
  writeBearer = await mintToken(idToken, "data:read data:write")
  readOnlyBearer = await mintToken(idToken, "data:read")
  accountId = (
    await getAdminFirestore().collection("users").doc(userId).collection("company_accounts").add({
      userId, name: "Main Bank", openingBalance: 10000, openingDate: day(opened), statementBalance: null, statementDate: null, importRef: null,
      createdAt: new Date(), updatedAt: new Date(),
    })
  ).id
  clientId = (await admin.createClient(userId, { name: "Files Test Client" })).id
})

describe("attach_file", () => {
  it("on a cost with no file writes at once: the object, the pointer, and nothing to confirm", async () => {
    const c = await cost("Cloud hosting")
    const { payload } = await callOk("attach_file", { target: "cost", id: c.id, name: "IT01_00001.xml", content_base64: b64(standardXml) })
    const file = (await storedCost(c.id)).file!
    expect(file).toMatchObject({ name: "IT01_00001.xml", kind: "xml", size: standardXml.length })
    expect(file.path).toMatch(new RegExp(`^users/${userId}/company-files/[\\w-]+\\.xml$`))
    expect(await bytesAt(file.path)).toEqual(standardXml)
    expect(payload.file).toEqual({ name: "IT01_00001.xml", kind: "xml", size: standardXml.length })
    expect(payload.summary).toBe('Attached IT01_00001.xml (FatturaPA XML, 4 KB) to the cost "Cloud hosting".')
  })

  it("on an invoice with no file writes at once, as a signed p7m", async () => {
    const i = await invoice("FT-1/2026")
    await callOk("attach_file", { target: "invoice", id: i.id, name: "IT01_00002.xml.p7m", content_base64: b64("signed") })
    const file = (await storedInvoice(i.id)).file!
    expect(file).toMatchObject({ name: "IT01_00002.xml.p7m", kind: "p7m", size: 6 })
    expect((await getAdminBucket()!.file(file.path).getMetadata())[0].contentType).toBe("application/pkcs7-mime")
  })

  it("refuses a row that has a file unless replace is true, naming the current file and changing nothing", async () => {
    const c = await cost("Has a file")
    await callOk("attach_file", { target: "cost", id: c.id, name: "first.pdf", content_base64: b64("%PDF-1") })
    const first = (await storedCost(c.id)).file!
    const said = await refusal("attach_file", { target: "cost", id: c.id, name: "second.pdf", content_base64: b64("%PDF-2") })
    expect(said).toBe('This cost already has a file: first.pdf (PDF, 1 KB). Ask the owner whether to replace it; if they agree, call again with replace: true.')
    expect((await storedCost(c.id)).file).toEqual(first)
    expect(await bytesAt(first.path)).toEqual(Buffer.from("%PDF-1"))
  })

  it("with replace: true points at the new object and deletes the old one", async () => {
    const c = await cost("Replaced")
    await callOk("attach_file", { target: "cost", id: c.id, name: "old.xml", content_base64: b64("<old/>") })
    const old = (await storedCost(c.id)).file!
    const { payload } = await callOk("attach_file", { target: "cost", id: c.id, name: "new.pdf", content_base64: b64("%PDF-new"), replace: true })
    const next = (await storedCost(c.id)).file!
    expect(next).toMatchObject({ name: "new.pdf", kind: "pdf" })
    expect(next.path).not.toBe(old.path)
    expect(await exists(old.path)).toBe(false)
    expect(await bytesAt(next.path)).toEqual(Buffer.from("%PDF-new"))
    expect(payload.summary).toBe('Replaced old.xml with new.pdf (PDF, 1 KB) on the cost "Replaced".')
  })

  it.each([
    ["a name that is not an invoice file", { name: "notes.docx", content_base64: b64("x") }, "notes.docx can't be attached: use the XML, the signed .p7m, or a PDF."],
    ["content that is not base64", { name: "a.pdf", content_base64: "not base64!!" }, "content_base64 is not valid base64."],
    ["a file over 10 MB", { name: "big.pdf", content_base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64") }, "big.pdf is over the 10 MB limit."],
  ])("refuses %s and stores nothing", async (_what, args, message) => {
    const c = await cost(`Refused ${_what}`)
    const before = await objectCount()
    expect(await refusal("attach_file", { target: "cost", id: c.id, ...args })).toBe(message)
    expect((await storedCost(c.id)).file).toBeNull()
    expect(await objectCount()).toBe(before)
  })

  it("sizes a line-wrapped base64 by its bytes: a 10 MB file wrapped at 76 columns is accepted", async () => {
    const c = await cost("Wrapped")
    const wrapped = Buffer.alloc(10 * 1024 * 1024, 1).toString("base64").replace(/(.{76})/g, "$1\r\n")
    const { payload } = await callOk("attach_file", { target: "cost", id: c.id, name: "ten.pdf", content_base64: wrapped })
    expect(payload.file).toEqual({ name: "ten.pdf", kind: "pdf", size: 10 * 1024 * 1024 })
  })

  it("a cost the schema no longer accepts is refused with the schema's words, not 'Internal error', and its upload is dropped", async () => {
    const c = await cost("Legacy VAT", { amount: 100 })
    await getAdminFirestore().collection("users").doc(userId).collection("company_expenses").doc(c.id).update({ vat: -20 })
    const before = await objectCount()
    expect(await refusal("attach_file", { target: "cost", id: c.id, name: "a.pdf", content_base64: b64("%PDF") })).toBe("VAT has the sign of the amount")
    expect((await storedCost(c.id)).file).toBeNull()
    expect(await objectCount()).toBe(before)
  })

  it("names the right tool for an id of the other kind, and refuses a recurring estimate", async () => {
    const i = await invoice("FT-2/2026")
    expect(await refusal("attach_file", { target: "cost", id: i.id, name: "a.pdf", content_base64: b64("x") })).toBe(
      `No cost with id "${i.id}". get_cash_book lists each cost's id; an invoice's file goes with target: "invoice".`,
    )
    const r = await cost("Monthly estimate", { isRecurring: true, accountId: null })
    expect(await refusal("attach_file", { target: "cost", id: r.id, name: "a.pdf", content_base64: b64("x") })).toBe(
      '"Monthly estimate" is a recurring estimate, not a document: attach the file to the cost that pays it.',
    )
  })

  it("a read-only token gets 403 insufficient_scope, and nothing is written", async () => {
    const c = await cost("Read only")
    const res = await mcp(rpcRequest(readOnlyBearer, "attach_file", { target: "cost", id: c.id, name: "a.pdf", content_base64: b64("x") }))
    expect(res.status).toBe(403)
    expect(res.headers.get("WWW-Authenticate") ?? "").toContain('error="insufficient_scope"')
    expect((await storedCost(c.id)).file).toBeNull()
  })
})

describe("remove_file", () => {
  it("previews first and changes nothing, then clears the pointer and deletes the object on confirm", async () => {
    const i = await invoice("FT-3/2026")
    await callOk("attach_file", { target: "invoice", id: i.id, name: "out.pdf", content_base64: b64("%PDF-out") })
    const file = (await storedInvoice(i.id)).file!

    const preview = await callOk("remove_file", { target: "invoice", id: i.id })
    expect(preview.payload.preview).toBe(true)
    expect(preview.payload.summary).toContain("Preview, nothing changed yet: remove out.pdf (PDF, 1 KB) from invoice FT-3/2026")
    expect((await storedInvoice(i.id)).file).toEqual(file)
    expect(await exists(file.path)).toBe(true)

    const done = await callOk("remove_file", { target: "invoice", id: i.id, confirm: true })
    expect(done.payload.summary).toBe("Removed out.pdf from invoice FT-3/2026.")
    expect((await storedInvoice(i.id)).file).toBeNull()
    expect(await exists(file.path)).toBe(false)
  })

  it("says so when the row has no file", async () => {
    const c = await cost("Nothing attached")
    expect(await refusal("remove_file", { target: "cost", id: c.id })).toBe('The cost "Nothing attached" has no file.')
  })

  it("never deletes an object outside the caller's own folder, even when a record names one", async () => {
    const foreign = "users/someone-else/company-files/foreign.pdf"
    await getAdminBucket()!.file(foreign).save("%PDF", { contentType: "application/pdf" })
    const c = await cost("Foreign pointer", { file: { path: foreign, name: "foreign.pdf", kind: "pdf", size: 4, uploadedAt: new Date() } })
    await callOk("remove_file", { target: "cost", id: c.id, confirm: true })
    expect((await storedCost(c.id)).file).toBeNull()
    expect(await exists(foreign)).toBe(true)
    await getAdminBucket()!.file(foreign).delete()
  })

  it("a read-only token gets 403 insufficient_scope", async () => {
    const res = await mcp(rpcRequest(readOnlyBearer, "remove_file", { target: "cost", id: "x", confirm: true }))
    expect(res.status).toBe(403)
  })
})

describe("get_file", () => {
  it("returns an XML as the text that was attached, identical, with its content type", async () => {
    const c = await cost("Fetched XML")
    await callOk("attach_file", { target: "cost", id: c.id, name: "IT01_00003.xml", content_base64: b64(standardXml) })
    const { content, payload } = await callOk("get_file", { target: "cost", id: c.id })
    const resource = content.find((x) => x.type === "resource")!.resource!
    expect(resource).toEqual({ uri: `alter-ego://invoice-files/cost/${c.id}`, mimeType: "application/xml", text: standardXml.toString("utf8") })
    expect(payload).toEqual({ summary: `IT01_00003.xml (FatturaPA XML, 4 KB) of the cost "Fetched XML".`, file: { name: "IT01_00003.xml", kind: "xml", size: standardXml.length } })
  })

  it("returns a PDF and a signed .p7m as a base64 blob with their content types", async () => {
    const i = await invoice("FT-4/2026")
    await callOk("attach_file", { target: "invoice", id: i.id, name: "issued.pdf", content_base64: b64("%PDF-1.4 body") })
    const pdf = (await callOk("get_file", { target: "invoice", id: i.id })).content.find((x) => x.type === "resource")!.resource!
    expect(pdf).toEqual({ uri: `alter-ego://invoice-files/invoice/${i.id}`, mimeType: "application/pdf", blob: b64("%PDF-1.4 body") })

    const signed = Buffer.from([0x30, 0x82, 0xff, 0x00])
    const c = await cost("Signed")
    await callOk("attach_file", { target: "cost", id: c.id, name: "IT01_1.xml.p7m", content_base64: signed.toString("base64") })
    const p7m = (await callOk("get_file", { target: "cost", id: c.id })).content.find((x) => x.type === "resource")!.resource!
    expect(p7m).toMatchObject({ mimeType: "application/pkcs7-mime", blob: signed.toString("base64") })
  })

  it("returns an XML that is not valid UTF-8 as a blob, so no byte is changed", async () => {
    const latin1 = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a>Perch\xe9</a>', "latin1")
    const c = await cost("Latin one")
    await callOk("attach_file", { target: "cost", id: c.id, name: "latin.xml", content_base64: latin1.toString("base64") })
    const resource = (await callOk("get_file", { target: "cost", id: c.id })).content.find((x) => x.type === "resource")!.resource!
    expect(resource).toMatchObject({ mimeType: "application/xml", blob: latin1.toString("base64") })
  })

  it("refuses a record whose pointer leaves the caller's folder, and a row with no file", async () => {
    const foreign = "users/someone-else/company-files/secret.pdf"
    await getAdminBucket()!.file(foreign).save("%PDF-secret", { contentType: "application/pdf" })
    const c = await cost("Foreign read", { file: { path: foreign, name: "secret.pdf", kind: "pdf", size: 11, uploadedAt: new Date() } })
    expect(await refusal("get_file", { target: "cost", id: c.id })).toBe("The file of this cost is not in your folder, so it is not served.")
    await getAdminBucket()!.file(foreign).delete()
    const plain = await cost("No file to fetch")
    expect(await refusal("get_file", { target: "cost", id: plain.id })).toBe('The cost "No file to fetch" has no file.')
  })
})

describe("the reads show the file", () => {
  it("list_invoices carries file {name, kind, size} or null", async () => {
    const [withFile, without] = [await invoice("FT-5/2026"), await invoice("FT-6/2026")]
    await callOk("attach_file", { target: "invoice", id: withFile.id, name: "five.pdf", content_base64: b64("%PDF-5") })
    const { payload } = await callOk("list_invoices", {})
    const by = (id: string) => (payload.invoices as Payload[]).find((r) => r.id === id)!
    expect(by(withFile.id).file).toEqual({ name: "five.pdf", kind: "pdf", size: 6 })
    expect(by(without.id).file).toBeNull()
  })

  it("get_cash_book rows carry the file of a cost and of an invoice, and null on the rest", async () => {
    const c = await cost("Book row with file", { amount: 77 })
    const plain = await cost("Book row plain", { amount: 78 })
    await callOk("attach_file", { target: "cost", id: c.id, name: "row.xml", content_base64: b64("<a/>") })
    const paid = await admin.createInvoice(userId, { clientId, number: "FT-7/2026", yearMonth: ym, amount: 500, vat: 0, paidDate: day(`${ym}-01`), paidAccountId: accountId })
    await callOk("attach_file", { target: "invoice", id: paid.id, name: "paid.pdf", content_base64: b64("%PDF-p") })
    const { payload } = await callOk("get_cash_book", { limit: 200 })
    const row = (id: string) => (payload.rows as Payload[]).find((r) => r.id === id)!
    expect(row(c.id).file).toEqual({ name: "row.xml", kind: "xml", size: 4 })
    expect(row(plain.id).file).toBeNull()
    expect(row(paid.id).file).toEqual({ name: "paid.pdf", kind: "pdf", size: 6 })
  })

  it("get_cash_book otherEntries carry the file of a cost on no company account (a supplier invoice, the owner's card)", async () => {
    const c = await cost("Owner card cost", { amount: 55, accountId: null, paidByOwner: true })
    await callOk("attach_file", { target: "cost", id: c.id, name: "card.pdf", content_base64: b64("%PDF-c") })
    const { payload } = await callOk("get_cash_book", { period: ym, limit: 200 })
    const entry = (payload.otherEntries as Payload[]).find((r) => r.id === c.id)!
    expect(entry.file).toEqual({ name: "card.pdf", kind: "pdf", size: 6 })
  })
})
