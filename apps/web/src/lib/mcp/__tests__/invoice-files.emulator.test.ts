/**
 * Invoice files over MCP (attach_file, remove_file, get_file, and the file on the reads) —
 * end-to-end through the route handler, real Firestore and real Storage. Synthetic data only.
 *
 * Runs under the Firebase emulator (vitest.emulator.ts, Storage included).
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { isoDate } from "@alter-ego/kernel/dates"
import { format, startOfMonth, subMonths } from "date-fns"
import { createUserWithEmailAndPassword } from "firebase/auth"
import { beforeAll, describe, expect, it } from "vitest"

import { POST as mcp } from "@/app/api/mcp/route"
import { POST as approve } from "@/app/api/oauth/authorize/route"
import { POST as register } from "@/app/api/oauth/register/route"
import { POST as token } from "@/app/api/oauth/token/route"
import { PUT as upload } from "@/app/api/uploads/[token]/route"
import * as admin from "@/lib/backend/firebase-admin"
import { getAdminBucket, getAdminFirestore } from "@/lib/firebase-admin-client"
import { getFirebaseAuth } from "@/lib/firebase-client"
import { fileIdOf } from "@/lib/invoice-files"
import { s256 } from "@/lib/oauth/pkce"
import { INVOICE_FILES_MAX } from "@/types/schemas"

const ORIGIN = "https://mcp.test"
const REDIRECT = "https://claude.ai/api/mcp/auth_callback"
const VERIFIER = "a".repeat(43)

const now = new Date()
const ym = format(now, "yyyy-MM")
const day = (iso: string) => new Date(`${iso}T00:00:00`)
const opened = isoDate(startOfMonth(subMonths(now, 1)))

const standardXml = readFileSync("src/lib/__tests__/fixtures/fattura-pa/standard.xml")
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64")
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex")

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
    const file = (await storedCost(c.id)).files[0]
    expect(file).toMatchObject({ name: "IT01_00001.xml", kind: "xml", size: standardXml.length })
    expect(file.path).toMatch(new RegExp(`^users/${userId}/company-files/[\\w-]+\\.xml$`))
    expect(await bytesAt(file.path)).toEqual(standardXml)
    expect(payload.file).toEqual({ fileId: fileIdOf(file.path), name: "IT01_00001.xml", kind: "xml", size: standardXml.length, sha256: sha(standardXml) })
    expect(payload.summary).toBe('Attached IT01_00001.xml (FatturaPA XML, 4 KB) to the cost "Cloud hosting".')
  })

  it("on an invoice with no file writes at once, as a signed p7m", async () => {
    const i = await invoice("FT-1/2026")
    await callOk("attach_file", { target: "invoice", id: i.id, name: "IT01_00002.xml.p7m", content_base64: b64("signed") })
    const file = (await storedInvoice(i.id)).files[0]
    expect(file).toMatchObject({ name: "IT01_00002.xml.p7m", kind: "p7m", size: 6 })
    expect((await getAdminBucket()!.file(file.path).getMetadata())[0].contentType).toBe("application/pkcs7-mime")
  })

  it("on a row that has a file adds another by default, naming how many it now holds, and keeps the first", async () => {
    const c = await cost("Has a file")
    await callOk("attach_file", { target: "cost", id: c.id, name: "first.pdf", content_base64: b64("%PDF-1") })
    const first = (await storedCost(c.id)).files[0]
    const { payload } = await callOk("attach_file", { target: "cost", id: c.id, name: "second.pdf", content_base64: b64("%PDF-2") })
    const [kept, second] = (await storedCost(c.id)).files
    expect(kept).toEqual(first)
    expect(payload.summary).toBe('Attached second.pdf (PDF, 1 KB) to the cost "Has a file"; it now holds 2 files.')
    expect(payload.file).toEqual({ fileId: fileIdOf(second.path), name: "second.pdf", kind: "pdf", size: 6, sha256: sha("%PDF-2") })
    expect(await bytesAt(first.path)).toEqual(Buffer.from("%PDF-1"))
    expect(await bytesAt(second.path)).toEqual(Buffer.from("%PDF-2"))
  })

  it("refuses the same name and size as a retry: nothing stored, no object left", async () => {
    const c = await cost("Retried")
    await callOk("attach_file", { target: "cost", id: c.id, name: "same.xml", content_base64: b64("<a/>") })
    const before = await objectCount()
    expect(await refusal("attach_file", { target: "cost", id: c.id, name: "same.xml", content_base64: b64("<b/>") })).toBe(
      'The cost "Retried" already holds same.xml (FatturaPA XML, 1 KB). Nothing was attached.',
    )
    expect((await storedCost(c.id)).files).toHaveLength(1)
    expect(await objectCount()).toBe(before)
  })

  it("refuses a file past the cap before uploading it, and replace: true on a row of several, pointing at remove_file", async () => {
    const c = await cost("Full")
    for (let n = 0; n < INVOICE_FILES_MAX; n++) await callOk("attach_file", { target: "cost", id: c.id, name: `f${n}.xml`, content_base64: b64(`<${n}/>`) })
    const held = (await storedCost(c.id)).files
    const before = await objectCount()
    expect(await refusal("attach_file", { target: "cost", id: c.id, name: "one-more.xml", content_base64: b64("<x/>") })).toBe(
      `The cost "Full" already holds ${INVOICE_FILES_MAX} files, the most a cost can hold. Nothing was attached; remove one with remove_file first.`,
    )
    const said = await refusal("attach_file", { target: "cost", id: c.id, name: "r.xml", content_base64: b64("<r/>"), replace: true })
    expect(said).toBe(
      `replace: true swaps the only file of a row, and the cost "Full" holds ${INVOICE_FILES_MAX}: ` +
        `${held.map((f) => `${f.name} (fileId ${fileIdOf(f.path)})`).join(", ")}. To change one of them, remove it with remove_file and its fileId, then attach the new one.`,
    )
    expect((await storedCost(c.id)).files).toEqual(held)
    expect(await objectCount()).toBe(before)
  })

  it("with replace: true points at the new object and deletes the old one", async () => {
    const c = await cost("Replaced")
    await callOk("attach_file", { target: "cost", id: c.id, name: "old.xml", content_base64: b64("<old/>") })
    const old = (await storedCost(c.id)).files[0]
    const { payload } = await callOk("attach_file", { target: "cost", id: c.id, name: "new.pdf", content_base64: b64("%PDF-new"), replace: true })
    const next = (await storedCost(c.id)).files[0]
    expect((await storedCost(c.id)).files).toHaveLength(1)
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
    expect((await storedCost(c.id)).files).toEqual([])
    expect(await objectCount()).toBe(before)
  })

  it("sizes a line-wrapped base64 by its bytes: a 10 MB file wrapped at 76 columns is accepted", async () => {
    const c = await cost("Wrapped")
    const wrapped = Buffer.alloc(10 * 1024 * 1024, 1).toString("base64").replace(/(.{76})/g, "$1\r\n")
    const { payload } = await callOk("attach_file", { target: "cost", id: c.id, name: "ten.pdf", content_base64: wrapped })
    expect(payload.file).toMatchObject({ name: "ten.pdf", kind: "pdf", size: 10 * 1024 * 1024, sha256: sha(Buffer.alloc(10 * 1024 * 1024, 1)) })
  })

  it("a cost the schema no longer accepts is refused with the schema's words, not 'Internal error', and its upload is dropped", async () => {
    const c = await cost("Legacy VAT", { amount: 100 })
    await getAdminFirestore().collection("users").doc(userId).collection("company_expenses").doc(c.id).update({ vat: -20 })
    const before = await objectCount()
    expect(await refusal("attach_file", { target: "cost", id: c.id, name: "a.pdf", content_base64: b64("%PDF") })).toBe("VAT has the sign of the amount")
    expect((await storedCost(c.id)).files).toEqual([])
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
    expect((await storedCost(c.id)).files).toEqual([])
  })
})

describe("remove_file", () => {
  it("previews first and changes nothing, then clears the pointer and deletes the object on confirm", async () => {
    const i = await invoice("FT-3/2026")
    await callOk("attach_file", { target: "invoice", id: i.id, name: "out.pdf", content_base64: b64("%PDF-out") })
    const file = (await storedInvoice(i.id)).files[0]

    const preview = await callOk("remove_file", { target: "invoice", id: i.id })
    expect(preview.payload.preview).toBe(true)
    expect(preview.payload.summary).toContain("Preview, nothing changed yet: remove out.pdf (PDF, 1 KB) from invoice FT-3/2026")
    expect((await storedInvoice(i.id)).files).toEqual([file])
    expect(await exists(file.path)).toBe(true)

    const done = await callOk("remove_file", { target: "invoice", id: i.id, confirm: true })
    expect(done.payload.summary).toBe("Removed out.pdf from invoice FT-3/2026.")
    expect((await storedInvoice(i.id)).files).toEqual([])
    expect(await exists(file.path)).toBe(false)
  })

  it("on a row of several refuses without fileId, listing each; with fileId removes that file only", async () => {
    const c = await cost("Several to remove")
    for (const n of ["a.xml", "b.xml"]) await callOk("attach_file", { target: "cost", id: c.id, name: n, content_base64: b64(`<${n}/>`) })
    const [a, b] = (await storedCost(c.id)).files
    const list = `${a.name} (fileId ${fileIdOf(a.path)}), ${b.name} (fileId ${fileIdOf(b.path)})`
    expect(await refusal("remove_file", { target: "cost", id: c.id, confirm: true })).toBe(`The cost "Several to remove" holds 2 files: ${list}. Pass fileId to pick one.`)
    expect(await refusal("remove_file", { target: "cost", id: c.id, fileId: "nope", confirm: true })).toBe(`The cost "Several to remove" has no file with fileId "nope". It holds: ${list}.`)
    const preview = await callOk("remove_file", { target: "cost", id: c.id, fileId: fileIdOf(a.path) })
    expect(preview.payload.summary).toContain("remove a.xml (FatturaPA XML, 1 KB)")
    expect((await storedCost(c.id)).files).toHaveLength(2)
    await callOk("remove_file", { target: "cost", id: c.id, fileId: fileIdOf(a.path), confirm: true })
    expect((await storedCost(c.id)).files).toEqual([b])
    expect(await exists(a.path)).toBe(false)
    expect(await exists(b.path)).toBe(true)
  })

  it("says so when the row has no file", async () => {
    const c = await cost("Nothing attached")
    expect(await refusal("remove_file", { target: "cost", id: c.id })).toBe('The cost "Nothing attached" has no file.')
  })

  it("never deletes an object outside the caller's own folder, even when a record names one", async () => {
    const foreign = "users/someone-else/company-files/foreign.pdf"
    await getAdminBucket()!.file(foreign).save("%PDF", { contentType: "application/pdf" })
    const c = await cost("Foreign pointer", { files: [{ path: foreign, name: "foreign.pdf", kind: "pdf", size: 4, uploadedAt: new Date() }] })
    await callOk("remove_file", { target: "cost", id: c.id, confirm: true })
    expect((await storedCost(c.id)).files).toEqual([])
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
    const fileId = fileIdOf((await storedCost(c.id)).files[0].path)
    expect(resource).toEqual({ uri: `alter-ego://invoice-files/cost/${c.id}/${fileId}`, mimeType: "application/xml", text: standardXml.toString("utf8") })
    expect(payload).toEqual({ summary: `IT01_00003.xml (FatturaPA XML, 4 KB) of the cost "Fetched XML".`, file: { fileId, name: "IT01_00003.xml", kind: "xml", size: standardXml.length, sha256: sha(standardXml) } })
  })

  it("returns a PDF and a signed .p7m as a base64 blob with their content types", async () => {
    const i = await invoice("FT-4/2026")
    await callOk("attach_file", { target: "invoice", id: i.id, name: "issued.pdf", content_base64: b64("%PDF-1.4 body") })
    const pdf = (await callOk("get_file", { target: "invoice", id: i.id })).content.find((x) => x.type === "resource")!.resource!
    expect(pdf).toEqual({ uri: `alter-ego://invoice-files/invoice/${i.id}/${fileIdOf((await storedInvoice(i.id)).files[0].path)}`, mimeType: "application/pdf", blob: b64("%PDF-1.4 body") })

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
    const c = await cost("Foreign read", { files: [{ path: foreign, name: "secret.pdf", kind: "pdf", size: 11, uploadedAt: new Date() }] })
    expect(await refusal("get_file", { target: "cost", id: c.id })).toBe("The file of this cost is not in your folder, so it is not served.")
    await getAdminBucket()!.file(foreign).delete()
    const plain = await cost("No file to fetch")
    expect(await refusal("get_file", { target: "cost", id: plain.id })).toBe('The cost "No file to fetch" has no file.')
  })
})

describe("get_file on a row of several", () => {
  it("refuses without fileId, naming each; with fileId returns that file, and an unknown id is refused", async () => {
    const c = await cost("Several to read")
    await callOk("attach_file", { target: "cost", id: c.id, name: "one.xml", content_base64: b64("<one/>") })
    await callOk("attach_file", { target: "cost", id: c.id, name: "two.pdf", content_base64: b64("%PDF-two") })
    const [one, two] = (await storedCost(c.id)).files
    const list = `${one.name} (fileId ${fileIdOf(one.path)}), ${two.name} (fileId ${fileIdOf(two.path)})`
    expect(await refusal("get_file", { target: "cost", id: c.id })).toBe(`The cost "Several to read" holds 2 files: ${list}. Pass fileId to pick one.`)
    expect(await refusal("get_file", { target: "cost", id: c.id, fileId: "nope" })).toBe(`The cost "Several to read" has no file with fileId "nope". It holds: ${list}.`)
    const got = (await callOk("get_file", { target: "cost", id: c.id, fileId: fileIdOf(two.path) })).content.find((x) => x.type === "resource")!.resource!
    expect(got).toEqual({ uri: `alter-ego://invoice-files/cost/${c.id}/${fileIdOf(two.path)}`, mimeType: "application/pdf", blob: b64("%PDF-two") })
  })
})

describe("the reads show the files", () => {
  it("list_invoices carries files [{fileId, name, kind, size}], [] for none, and no file key", async () => {
    const [withFile, without] = [await invoice("FT-5/2026"), await invoice("FT-6/2026")]
    await callOk("attach_file", { target: "invoice", id: withFile.id, name: "five.pdf", content_base64: b64("%PDF-5") })
    const { payload } = await callOk("list_invoices", {})
    const by = (id: string) => (payload.invoices as Payload[]).find((r) => r.id === id)!
    expect(by(withFile.id).files).toEqual([{ fileId: fileIdOf((await storedInvoice(withFile.id)).files[0].path), name: "five.pdf", kind: "pdf", size: 6 }])
    expect(by(without.id).files).toEqual([])
    expect("file" in by(withFile.id)).toBe(false)
  })

  it("get_cash_book rows carry the file of a cost and of an invoice, and null on the rest", async () => {
    const c = await cost("Book row with file", { amount: 77 })
    const plain = await cost("Book row plain", { amount: 78 })
    await callOk("attach_file", { target: "cost", id: c.id, name: "row.xml", content_base64: b64("<a/>") })
    const paid = await admin.createInvoice(userId, { clientId, number: "FT-7/2026", yearMonth: ym, amount: 500, vat: 0, paidDate: day(`${ym}-01`), paidAccountId: accountId })
    await callOk("attach_file", { target: "invoice", id: paid.id, name: "paid.pdf", content_base64: b64("%PDF-p") })
    const { payload } = await callOk("get_cash_book", { limit: 200 })
    const row = (id: string) => (payload.rows as Payload[]).find((r) => r.id === id)!
    expect(row(c.id).files).toEqual([{ fileId: fileIdOf((await storedCost(c.id)).files[0].path), name: "row.xml", kind: "xml", size: 4 }])
    expect(row(plain.id).files).toEqual([])
    expect(row(paid.id).files).toEqual([{ fileId: fileIdOf((await storedInvoice(paid.id)).files[0].path), name: "paid.pdf", kind: "pdf", size: 6 }])
  })

  it("get_cash_book otherEntries carry the file of a cost on no company account (a supplier invoice, the owner's card)", async () => {
    const c = await cost("Owner card cost", { amount: 55, accountId: null, paidByOwner: true })
    await callOk("attach_file", { target: "cost", id: c.id, name: "card.pdf", content_base64: b64("%PDF-c") })
    const { payload } = await callOk("get_cash_book", { period: ym, limit: 200 })
    const entry = (payload.otherEntries as Payload[]).find((r) => r.id === c.id)!
    expect(entry.files).toEqual([{ fileId: fileIdOf((await storedCost(c.id)).files[0].path), name: "card.pdf", kind: "pdf", size: 6 }])
  })

  it("a row saved with only the old single file reads as one file, with its fileId, in both reads", async () => {
    const c = await cost("Legacy single file", { amount: 66 })
    const old = { path: `users/${userId}/company-files/legacy-one.xml`, name: "legacy.xml", kind: "xml", size: 4, uploadedAt: new Date() }
    await getAdminBucket()!.file(old.path).save("<a/>", { contentType: "application/xml" })
    await getAdminFirestore().collection("users").doc(userId).collection("company_expenses").doc(c.id).update({ file: old })
    const { payload } = await callOk("get_cash_book", { limit: 200 })
    expect((payload.rows as Payload[]).find((r) => r.id === c.id)!.files).toEqual([{ fileId: "legacy-one", name: "legacy.xml", kind: "xml", size: 4 }])
    // get_file and remove_file without a fileId act on it; the removal leaves file: null and files: [] on the raw row.
    expect((await callOk("get_file", { target: "cost", id: c.id })).payload.file.fileId).toBe("legacy-one")
    await callOk("remove_file", { target: "cost", id: c.id, confirm: true })
    const raw = (await getAdminFirestore().collection("users").doc(userId).collection("company_expenses").doc(c.id).get()).data()
    expect([raw?.file, raw?.files]).toEqual([null, []])
    expect(await exists(old.path)).toBe(false)
  })
})

// The three files the owner could not attach one call at a time: generated here, synthetic.
const pdfBytes = (kb: number) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(kb * 1024, 0x61), Buffer.from("\n%%EOF\n")])
const fatturaWith = (embedded: Buffer) =>
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><p:FatturaElettronica versione="FPR12"><FatturaElettronicaBody><Allegati><NomeAttachment>invoice.pdf</NomeAttachment>` +
      `<Attachment>${embedded.toString("base64")}</Attachment></Allegati></FatturaElettronicaBody></p:FatturaElettronica>`,
  )
const files: [string, string, Buffer][] = [
  ["a 65 KB XML with an embedded PDF", "IT01_65KB.xml", fatturaWith(pdfBytes(48))],
  ["a 313 KB XML", "IT01_313KB.xml", Buffer.from(`<?xml version="1.0"?><Root>${"<Line>synthetic supplier line</Line>\n".repeat(9_600)}</Root>`)],
  ["a PDF", "EU-1234.pdf", pdfBytes(20)],
]

describe("create_upload_url, PUT, complete_upload against Firestore and Storage", () => {
  const link = async (args: Record<string, unknown>) => (await callOk("create_upload_url", args)).payload
  const put = (uploadUrl: string, body: Buffer) =>
    upload(new Request(uploadUrl, { method: "PUT", body: new Uint8Array(body) }), { params: Promise.resolve({ token: uploadUrl.split("/").pop()! }) })

  it.each(files)("%s: stored with the size and sha256 of the original, and the row points at it", async (_what, name, bytes) => {
    expect(bytes.length).toBeGreaterThan(name.includes("65") ? 60_000 : name.includes("313") ? 300_000 : 10_000)
    const c = await cost(`Upload ${name}`)
    const made = await link({ target: "cost", id: c.id, name, size: bytes.length, sha256: sha(bytes) })
    expect(made).toMatchObject({ method: "PUT", headers: {}, maxBytes: bytes.length })
    expect(made.uploadUrl).toMatch(new RegExp(`^${ORIGIN}/api/uploads/[\\w-]{43}$`))
    expect((await storedCost(c.id)).files).toEqual([])

    const res = await put(made.uploadUrl, bytes)
    expect(res.status).toBe(201)
    expect((await storedCost(c.id)).files).toEqual([]) // arrived, not linked

    const { payload } = await callOk("complete_upload", { uploadId: made.uploadId })
    expect(payload.file).toMatchObject({ name, kind: name.endsWith(".pdf") ? "pdf" : "xml", size: bytes.length, sha256: sha(bytes) })
    const file = (await storedCost(c.id)).files[0]
    expect(file).toMatchObject({ name, size: bytes.length })
    expect(await bytesAt(file.path)).toEqual(bytes)
  })

  it("an invoice takes a file the same way", async () => {
    const i = await invoice("FT-UP/2026")
    const made = await link({ target: "invoice", id: i.id, name: "out.pdf" })
    expect((await put(made.uploadUrl, pdfBytes(3))).status).toBe(201)
    await callOk("complete_upload", { uploadId: made.uploadId })
    expect((await storedInvoice(i.id)).files[0]).toMatchObject({ name: "out.pdf", kind: "pdf" })
  })

  it("a row that has a file takes another by default; with replace the old object goes only at complete_upload", async () => {
    const c = await cost("Upload replace")
    await callOk("attach_file", { target: "cost", id: c.id, name: "old.xml", content_base64: b64("<old/>") })
    const old = (await storedCost(c.id)).files[0]

    const more = await link({ target: "cost", id: c.id, name: "more.xml" })
    expect((await put(more.uploadUrl, Buffer.from("<more/>"))).status).toBe(201)
    const added = await callOk("complete_upload", { uploadId: more.uploadId })
    expect(added.payload.summary).toBe('Attached more.xml (FatturaPA XML, 1 KB) to the cost "Upload replace"; it now holds 2 files.')
    expect((await storedCost(c.id)).files).toHaveLength(2)
    await callOk("remove_file", { target: "cost", id: c.id, fileId: fileIdOf((await storedCost(c.id)).files[1].path), confirm: true })

    const made = await link({ target: "cost", id: c.id, name: "new.xml", replace: true })
    expect((await put(made.uploadUrl, Buffer.from("<new/>"))).status).toBe(201)
    expect(await exists(old.path)).toBe(true)
    expect((await storedCost(c.id)).files).toEqual([old])

    await callOk("complete_upload", { uploadId: made.uploadId })
    const [next, ...rest] = (await storedCost(c.id)).files
    expect(rest).toEqual([])
    expect(await exists(old.path)).toBe(false)
    expect(await bytesAt(next.path)).toEqual(Buffer.from("<new/>"))
  })

  it("three links for one row, completed in parallel, all land with their own sha256", async () => {
    const c = await cost("Three at once")
    const bodies = ["<a-one/>", "<b-two/>", "<c-three/>"].map((x) => Buffer.from(x))
    const made = await Promise.all(bodies.map((_, n) => link({ target: "cost", id: c.id, name: `p${n}.xml`, sha256: sha(bodies[n]) })))
    for (const [n, m] of made.entries()) expect((await put(m.uploadUrl, bodies[n])).status).toBe(201)
    const done = await Promise.all(made.map((m) => call("complete_upload", { uploadId: m.uploadId })))
    expect(done.map((d) => d.isError)).toEqual([false, false, false])
    expect(done.map((d) => d.payload.file.sha256).sort()).toEqual(bodies.map(sha).sort())
    expect((await storedCost(c.id)).files.map((f) => f.name).sort()).toEqual(["p0.xml", "p1.xml", "p2.xml"])
  })

  it("a duplicate, or a row that filled up meanwhile, discards the object and marks the upload failed, leaving the row", async () => {
    const c = await cost("Complete refusals")
    await callOk("attach_file", { target: "cost", id: c.id, name: "dup.xml", content_base64: b64("<a/>") })
    const row = (await storedCost(c.id)).files
    const dup = await link({ target: "cost", id: c.id, name: "dup.xml" })
    expect((await put(dup.uploadUrl, Buffer.from("<b/>"))).status).toBe(201)
    const before = await objectCount()
    expect(await refusal("complete_upload", { uploadId: dup.uploadId })).toBe(
      'The cost "Complete refusals" already holds dup.xml (FatturaPA XML, 1 KB). Nothing was attached and the upload was discarded.',
    )
    expect(await objectCount()).toBe(before - 1)
    expect((await storedCost(c.id)).files).toEqual(row)

    const late = await link({ target: "cost", id: c.id, name: "late.xml" })
    expect((await put(late.uploadUrl, Buffer.from("<late/>"))).status).toBe(201)
    for (let n = 1; n < INVOICE_FILES_MAX; n++) await callOk("attach_file", { target: "cost", id: c.id, name: `x${n}.xml`, content_base64: b64(`<${n}/>`) })
    expect(await refusal("complete_upload", { uploadId: late.uploadId })).toContain(`already holds ${INVOICE_FILES_MAX} files, the most a cost can hold. Nothing was attached and the upload was discarded`)
    expect((await storedCost(c.id)).files).toHaveLength(INVOICE_FILES_MAX)

    const rep = await cost("Replace meanwhile")
    await callOk("attach_file", { target: "cost", id: rep.id, name: "r1.xml", content_base64: b64("<1/>") })
    const swap = await link({ target: "cost", id: rep.id, name: "r.xml", replace: true })
    expect((await put(swap.uploadUrl, Buffer.from("<r/>"))).status).toBe(201)
    await callOk("attach_file", { target: "cost", id: rep.id, name: "r2.xml", content_base64: b64("<2/>") })
    expect(await refusal("complete_upload", { uploadId: swap.uploadId })).toBe(
      'The cost "Replace meanwhile" now holds 2 files, so replace: true cannot pick one. Nothing was attached and the upload was discarded; remove the wrong file with remove_file, then start again without replace.',
    )
    expect((await storedCost(rep.id)).files).toHaveLength(2)
  })

  it("a wrong sha256, a used link and a body over the declared size each leave the row and Storage unchanged", async () => {
    const c = await cost("Upload refusals")
    const before = await objectCount()

    const wrong = await link({ target: "cost", id: c.id, name: "a.xml", sha256: sha("something else") })
    expect((await put(wrong.uploadUrl, Buffer.from("<a/>"))).status).toBe(201)
    expect(await refusal("complete_upload", { uploadId: wrong.uploadId })).toContain("sha256 of the file that arrived does not match")

    const used = await link({ target: "cost", id: c.id, name: "b.xml" })
    expect((await put(used.uploadUrl, Buffer.from("<b/>"))).status).toBe(201)
    expect((await put(used.uploadUrl, Buffer.from("<b2/>"))).status).toBe(409)
    await callOk("complete_upload", { uploadId: used.uploadId })
    expect(await refusal("complete_upload", { uploadId: used.uploadId })).toBe("This upload was already completed.")
    await callOk("remove_file", { target: "cost", id: c.id, confirm: true })

    const small = await link({ target: "cost", id: c.id, name: "c.xml", size: 4 })
    expect((await put(small.uploadUrl, Buffer.from("<too-long/>"))).status).toBe(413)

    expect((await storedCost(c.id)).files).toEqual([])
    expect(await objectCount()).toBe(before)
  })

  it("a read-only token cannot create or complete an upload", async () => {
    for (const [tool, args] of [["create_upload_url", { target: "cost", id: "x", name: "a.pdf" }], ["complete_upload", { uploadId: "x" }]] as const) {
      expect((await mcp(rpcRequest(readOnlyBearer, tool, args))).status).toBe(403)
    }
  })
})

describe("attach_file from a url", () => {
  it("refuses an address inside the network, naming nothing but the rule, and writes nothing", async () => {
    const c = await cost("Url refused")
    expect(await refusal("attach_file", { target: "cost", id: c.id, name: "a.xml", url: "https://169.254.169.254/latest/meta-data" })).toBe(
      "That address is private or internal, so it is not fetched.",
    )
    expect(await refusal("attach_file", { target: "cost", id: c.id, name: "a.xml", url: "http://files.example.com/a.xml" })).toBe("Only https addresses are accepted.")
    expect((await storedCost(c.id)).files).toEqual([])
  })
})
