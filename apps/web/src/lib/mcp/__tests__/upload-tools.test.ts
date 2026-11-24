// @vitest-environment node
/**
 * create_upload_url, complete_upload and attach_file (content_base64 and url) on the mock backend:
 * every refusal leaves the row as it was, the success returns what attach_file returns.
 */
import { createHash } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PUT } from "@/app/api/uploads/[token]/route"
import { __resetMockState } from "@/lib/backend/mock"
import { getServerDb, getServerFiles } from "@/lib/backend/server-db"
import { fileIdOf } from "@/lib/invoice-files"
import { WRITE_TOOLS, registerCrmWriteTools } from "@/lib/mcp/tools/crm-write"
import { downloadPublicFile } from "@/lib/safe-download"
import { type z } from "@/lib/zod"
import { INVOICE_FILES_MAX } from "@/types/schemas"

import type { McpServer } from "@modelcontextprotocol/server"


vi.mock("@/lib/safe-download", () => ({ downloadPublicFile: vi.fn() }))

const USER = "user-1"
const OTHER = "user-2"
const ORIGIN = "https://mcp.example.com"
const MB = 1024 * 1024

type Run = (input: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
const registered = new Map<string, { schema: z.ZodType; run: Run }>()
registerCrmWriteTools({
  registerTool: (name: string, config: { inputSchema: z.ZodType }, run: Run) => void registered.set(name, { schema: config.inputSchema, run }),
} as unknown as McpServer)

/** `request: null` is a connection with no HTTP request (stdio). */
async function call(name: string, input: Record<string, unknown>, userId = USER, request: Request | null = new Request(`${ORIGIN}/api/mcp`, { method: "POST" })) {
  const tool = registered.get(name)
  if (!tool) throw new Error(`${name} is not registered`)
  const ctx = { http: { authInfo: { clientId: "test-client", extra: { userId } }, ...(request && { req: request }) } }
  const result = await tool.run(tool.schema.parse(input), ctx)
  return { isError: result.isError === true, body: JSON.parse(result.content[0].text) as Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any -- a tool's JSON reply, read field by field
}

const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const b64 = (s: string) => Buffer.from(s).toString("base64")

/** The curl the description promises: PUT the bytes to the link. */
async function put(uploadUrl: string, body: string | Uint8Array) {
  const token = uploadUrl.split("/").pop()!
  return PUT(new Request(uploadUrl, { method: "PUT", body: body as BodyInit }), { params: Promise.resolve({ token }) })
}

async function newCost(userId = USER, file?: Awaited<ReturnType<ReturnType<typeof getServerFiles>["upload"]>>) {
  return getServerDb().createCompanyExpense(userId, { description: "Office Chair", category: "other", amount: 100, date: new Date(), ...(file && { files: [file] }) })
}
const rowFiles = async (id: string, userId = USER) => (await getServerDb().getCompanyExpenses(userId)).find((e) => e.id === id)?.files ?? []
const rowFile = async (id: string, userId = USER) => (await rowFiles(id, userId))[0] ?? null

beforeEach(() => {
  __resetMockState()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-23T10:00:00.000Z"))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.mocked(downloadPublicFile).mockReset()
})

describe("the new tools are write tools", () => {
  it.each(["create_upload_url", "complete_upload"])("%s is registered and held by the scope gate", (tool) => {
    expect(registered.has(tool)).toBe(true)
    expect(WRITE_TOOLS.has(tool)).toBe(true)
  })
})

describe("create_upload_url", () => {
  it("returns a one-object PUT link on the public origin, valid for 15 minutes", async () => {
    const cost = await newCost()
    const { isError, body } = await call("create_upload_url", { target: "cost", id: cost.id, name: "IT01_0001.xml", size: 10, sha256: sha("0123456789") })
    expect(isError).toBe(false)
    expect(body).toMatchObject({ method: "PUT", headers: {}, expiresAt: "2026-11-23T10:15:00.000Z", maxBytes: 10 })
    expect(body.uploadUrl).toMatch(new RegExp(`^${ORIGIN}/api/uploads/[A-Za-z0-9_-]{43}$`))
    expect(body.uploadId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.uploadUrl).not.toContain(body.uploadId)
    expect(await rowFile(cost.id)).toBeNull()
  })

  it("takes up to 10 MB when no size is declared", async () => {
    const cost = await newCost()
    expect((await call("create_upload_url", { target: "cost", id: cost.id, name: "a.pdf" })).body.maxBytes).toBe(10 * MB)
  })

  it.each([
    ["an unknown row", { id: "nope", name: "a.xml" }, /No cost with id "nope"/],
    ["a bad extension", { name: "a.docx" }, /can't be attached/],
    ["a declared size over 10 MB", { name: "a.pdf", size: 10 * MB + 1 }, /over the 10 MB limit/],
  ])("refuses %s", async (_label, over, message) => {
    const cost = await newCost()
    const { isError, body } = await call("create_upload_url", { target: "cost", id: cost.id, ...{ name: "a.xml" }, ...over })
    expect(isError).toBe(true)
    expect(body.error).toMatch(message)
    expect(await getServerDb().listUploads(USER)).toEqual([])
  })

  it("on a connection with no request, builds the link on MCP_PUBLIC_ORIGIN without a trailing slash", async () => {
    vi.stubEnv("MCP_PUBLIC_ORIGIN", "https://x.example/")
    const cost = await newCost()
    const { isError, body } = await call("create_upload_url", { target: "cost", id: cost.id, name: "a.xml" }, USER, null)
    expect(isError).toBe(false)
    expect(body.uploadUrl).toMatch(/^https:\/\/x\.example\/api\/uploads\/[A-Za-z0-9_-]{43}$/)
  })

  it("on a connection with no request and no MCP_PUBLIC_ORIGIN, refuses and creates no record", async () => {
    vi.stubEnv("MCP_PUBLIC_ORIGIN", "")
    const cost = await newCost()
    const { isError, body } = await call("create_upload_url", { target: "cost", id: cost.id, name: "a.xml" }, USER, null)
    expect(isError).toBe(true)
    expect(body.error).toBe("This connection has no public address to upload to: use attach_file.")
    expect(await getServerDb().listUploads(USER)).toEqual([])
  })

  it("refuses a recurring cost", async () => {
    const e = await getServerDb().createCompanyExpense(USER, { description: "Rent Estimate", category: "other", amount: 10, date: new Date(), isRecurring: true })
    const { isError, body } = await call("create_upload_url", { target: "cost", id: e.id, name: "a.xml" })
    expect(isError).toBe(true)
    expect(body.error).toMatch(/recurring estimate/)
  })

  it("makes a link for a row that has a file, and with replace: true too", async () => {
    const cost = await newCost(USER, await getServerFiles().upload(USER, new Blob(["<old/>"]), "old.xml"))
    expect((await call("create_upload_url", { target: "cost", id: cost.id, name: "new.xml" })).isError).toBe(false)
    expect((await call("create_upload_url", { target: "cost", id: cost.id, name: "new.xml", replace: true })).isError).toBe(false)
  })

  it("refuses a link for a full row, and replace: true on a row of several, naming each fileId", async () => {
    const stored = await Promise.all(Array.from({ length: INVOICE_FILES_MAX }, (_, n) => getServerFiles().upload(USER, new Blob([`<${n}/>`]), `f${n}.xml`)))
    const cost = await getServerDb().createCompanyExpense(USER, { description: "Office Chair", category: "other", amount: 100, date: new Date(), files: stored })
    const full = await call("create_upload_url", { target: "cost", id: cost.id, name: "one-more.xml" })
    expect(full.isError).toBe(true)
    expect(full.body.error).toBe(`The cost "Office Chair" already holds ${INVOICE_FILES_MAX} files, the most a cost can hold. Remove one with remove_file first.`)
    const replace = await call("create_upload_url", { target: "cost", id: cost.id, name: "r.xml", replace: true })
    expect(replace.isError).toBe(true)
    expect(replace.body.error).toBe(
      `replace: true swaps the only file of a row, and the cost "Office Chair" holds ${INVOICE_FILES_MAX}: ${stored.map((f) => `${f.name} (fileId ${fileIdOf(f.path)})`).join(", ")}. ` +
        "To change one of them, remove it with remove_file and its fileId, then attach the new one.",
    )
    expect(await getServerDb().listUploads(USER)).toEqual([])
  })

  it("deletes this user's expired, uncompleted uploads and their objects, and nobody else's", async () => {
    const cost = await newCost()
    const mine = (await call("create_upload_url", { target: "cost", id: cost.id, name: "a.xml" })).body
    expect((await put(mine.uploadUrl, "<a/>")).status).toBe(201)
    const theirCost = await newCost(OTHER)
    const theirs = (await call("create_upload_url", { target: "cost", id: theirCost.id, name: "b.xml" }, OTHER)).body
    expect((await put(theirs.uploadUrl, "<b/>")).status).toBe(201)
    const [stored] = await getServerDb().listUploads(USER)
    const [theirStored] = await getServerDb().listUploads(OTHER)

    vi.setSystemTime(new Date("2026-11-23T10:16:00.000Z"))
    await call("create_upload_url", { target: "cost", id: cost.id, name: "c.xml" })

    await expect(getServerFiles().download(stored.file!)).rejects.toThrow()
    expect((await getServerDb().listUploads(USER)).map((u) => u.id)).not.toContain(mine.uploadId)
    expect(await getServerDb().getUpload(theirs.uploadId)).not.toBeNull()
    expect(await (await getServerFiles().download(theirStored.file!)).text()).toBe("<b/>")
  })
})

describe("the lazy sweep never takes the file a row points at", () => {
  const LATER = new Date("2026-11-23T10:16:00.000Z")

  it("spares a completed upload's object once its link has expired, and drops the record", async () => {
    const cost = await newCost()
    const link = (await call("create_upload_url", { target: "cost", id: cost.id, name: "a.xml" })).body
    await put(link.uploadUrl, "<kept/>")
    expect((await call("complete_upload", { uploadId: link.uploadId })).isError).toBe(false)

    vi.setSystemTime(LATER)
    await call("create_upload_url", { target: "cost", id: cost.id, name: "b.xml", replace: true })
    expect(await getServerDb().getUpload(link.uploadId)).toBeNull()
    expect(await (await getServerFiles().download((await rowFile(cost.id))!)).text()).toBe("<kept/>")
  })

  it("spares the object when the final 'completed' write failed and the record stayed 'completing'", async () => {
    const cost = await newCost()
    const link = (await call("create_upload_url", { target: "cost", id: cost.id, name: "a.xml" })).body
    await put(link.uploadUrl, "<kept/>")
    const db = getServerDb()
    const move = db.moveUpload.bind(db)
    vi.spyOn(db, "moveUpload").mockImplementation((id, from, to, extra) => (to === "completed" ? Promise.reject(new Error("write failed")) : move(id, from, to, extra)))
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect((await call("complete_upload", { uploadId: link.uploadId })).isError).toBe(false)
    expect((await db.getUpload(link.uploadId))!.status).toBe("completing")

    vi.setSystemTime(LATER)
    await call("create_upload_url", { target: "cost", id: cost.id, name: "b.xml", replace: true })
    expect(await (await getServerFiles().download((await rowFile(cost.id))!)).text()).toBe("<kept/>")
  })
})

describe("complete_upload", () => {
  async function arrived(bytes: string, declared: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
    const cost = await newCost()
    const link = (await call("create_upload_url", { target: "cost", id: cost.id, name: "IT01_0002.xml", ...declared, ...over })).body
    expect((await put(link.uploadUrl, bytes)).status).toBe(201)
    return { cost, link }
  }

  it("links the stored file to the row and returns name, kind, size and sha256", async () => {
    const xml = "<FatturaElettronica>synthetic</FatturaElettronica>"
    const { cost, link } = await arrived(xml, { size: xml.length, sha256: sha(xml) })
    expect(await rowFile(cost.id)).toBeNull() // the row changes only at complete_upload
    const { isError, body } = await call("complete_upload", { uploadId: link.uploadId })
    expect(isError).toBe(false)
    const file = (await rowFile(cost.id))!
    expect(body.file).toEqual({ fileId: fileIdOf(file.path), name: "IT01_0002.xml", kind: "xml", size: xml.length, sha256: sha(xml) })
    expect(body.summary).toContain("Attached IT01_0002.xml")
    expect(await (await getServerFiles().download(file)).text()).toBe(xml)
  })

  it("refuses a file that never arrived, naming the PUT", async () => {
    const cost = await newCost()
    const link = (await call("create_upload_url", { target: "cost", id: cost.id, name: "a.xml" })).body
    const { isError, body } = await call("complete_upload", { uploadId: link.uploadId })
    expect(isError).toBe(true)
    expect(body.error).toMatch(/has not arrived/)
    expect(await rowFile(cost.id)).toBeNull()
  })

  it("refuses an expired upload and leaves the row alone", async () => {
    const { cost, link } = await arrived("<a/>")
    vi.setSystemTime(new Date("2026-11-23T10:15:01.000Z"))
    const { isError, body } = await call("complete_upload", { uploadId: link.uploadId })
    expect(isError).toBe(true)
    expect(body.error).toMatch(/expired/)
    expect(await rowFile(cost.id)).toBeNull()
  })

  it.each([
    ["size", { size: 99 }, /size .* does not match/i],
    ["sha256", { sha256: sha("something else") }, /sha256 .* does not match/i],
  ])("refuses a %s mismatch, deletes the stored object and leaves the row alone", async (_l, declared, message) => {
    const { cost, link } = await arrived("<a/>", declared)
    const stored = (await getServerDb().getUpload(link.uploadId))!.file!
    const { isError, body } = await call("complete_upload", { uploadId: link.uploadId })
    expect(isError).toBe(true)
    expect(body.error).toMatch(message)
    expect(await rowFile(cost.id)).toBeNull()
    await expect(getServerFiles().download(stored)).rejects.toThrow()
  })

  it("refuses a second completion and does not touch the row again", async () => {
    const { cost, link } = await arrived("<a/>")
    expect((await call("complete_upload", { uploadId: link.uploadId })).isError).toBe(false)
    const before = await rowFile(cost.id)
    const again = await call("complete_upload", { uploadId: link.uploadId })
    expect(again.isError).toBe(true)
    expect(again.body.error).toMatch(/already completed/)
    expect(await rowFile(cost.id)).toEqual(before)
  })

  it("does not know another user's upload", async () => {
    const { link } = await arrived("<a/>")
    const { isError, body } = await call("complete_upload", { uploadId: link.uploadId }, OTHER)
    expect(isError).toBe(true)
    expect(body.error).toMatch(/No upload with id/)
  })

  it("adds to a row that gained a file meanwhile, keeping both", async () => {
    const { cost, link } = await arrived("<new/>")
    const other = await getServerFiles().upload(USER, new Blob(["<other/>"]), "other.xml")
    await getServerDb().updateCompanyExpense(USER, cost.id, { files: [other] })
    const { isError, body } = await call("complete_upload", { uploadId: link.uploadId })
    expect(isError).toBe(false)
    expect(body.summary).toContain("; it now holds 2 files.")
    expect((await rowFiles(cost.id)).map((f) => f.name)).toEqual(["other.xml", "IT01_0002.xml"])
  })

  it("three parallel completions for one row all land", async () => {
    const cost = await newCost()
    const links = await Promise.all(["a", "b", "c"].map(async (n) => (await call("create_upload_url", { target: "cost", id: cost.id, name: `${n}.xml` })).body))
    for (const [n, l] of links.entries()) expect((await put(l.uploadUrl, `<${n}/>`)).status).toBe(201)
    const done = await Promise.all(links.map((l) => call("complete_upload", { uploadId: l.uploadId })))
    expect(done.map((d) => d.isError)).toEqual([false, false, false])
    expect((await rowFiles(cost.id)).map((f) => f.name).sort()).toEqual(["a.xml", "b.xml", "c.xml"])
  })

  it("refuses a duplicate, a full row and a replace of several at completion, dropping the object and leaving the row", async () => {
    const dup = await arrived("<a/>")
    const first = await getServerFiles().upload(USER, new Blob(["<x/>"]), "IT01_0002.xml") // same name and size as the one that arrived
    await getServerDb().updateCompanyExpense(USER, dup.cost.id, { files: [first] })
    const stored = (await getServerDb().getUpload(dup.link.uploadId))!.file!
    const refused = await call("complete_upload", { uploadId: dup.link.uploadId })
    expect(refused.body.error).toBe('The cost "Office Chair" already holds IT01_0002.xml (FatturaPA XML, 1 KB). Nothing was attached and the upload was discarded.')
    await expect(getServerFiles().download(stored)).rejects.toThrow()
    expect(await rowFiles(dup.cost.id)).toEqual([first])

    const full = await arrived("<f/>")
    const held = await Promise.all(Array.from({ length: INVOICE_FILES_MAX }, (_, n) => getServerFiles().upload(USER, new Blob([`<${n}-held/>`]), `h${n}.xml`)))
    await getServerDb().updateCompanyExpense(USER, full.cost.id, { files: held })
    expect((await call("complete_upload", { uploadId: full.link.uploadId })).body.error).toBe(
      `The cost "Office Chair" already holds ${INVOICE_FILES_MAX} files, the most a cost can hold. Nothing was attached and the upload was discarded; remove one with remove_file first.`,
    )
    expect(await rowFiles(full.cost.id)).toEqual(held)

    const swap = await arrived("<s/>", {}, { replace: true })
    await getServerDb().updateCompanyExpense(USER, swap.cost.id, { files: held.slice(0, 2) })
    expect((await call("complete_upload", { uploadId: swap.link.uploadId })).body.error).toBe(
      'The cost "Office Chair" now holds 2 files, so replace: true cannot pick one. Nothing was attached and the upload was discarded; remove the wrong file with remove_file, then start again without replace.',
    )
    expect(await rowFiles(swap.cost.id)).toEqual(held.slice(0, 2))
  })

  it("with replace: true the old object goes only after the row points at the new one", async () => {
    const old = await getServerFiles().upload(USER, new Blob(["<old/>"]), "old.xml")
    const cost = await newCost(USER, old)
    const link = (await call("create_upload_url", { target: "cost", id: cost.id, name: "new.xml", replace: true })).body
    expect((await put(link.uploadUrl, "<new/>")).status).toBe(201)
    expect(await (await getServerFiles().download(old)).text()).toBe("<old/>") // uploaded, not completed: the old file is still the row's
    expect(await rowFile(cost.id)).toEqual(old)

    const { body } = await call("complete_upload", { uploadId: link.uploadId })
    expect(body.summary).toContain("Replaced old.xml with new.xml")
    expect((await rowFile(cost.id))!.name).toBe("new.xml")
    await expect(getServerFiles().download(old)).rejects.toThrow()
  })
})

describe("complete_upload and attach_file keep the old file when the row cannot be pointed at the new one", () => {
  const breakRow = () => vi.spyOn(getServerDb(), "changeFiles").mockRejectedValueOnce(new Error("row write failed"))

  it("complete_upload with replace: the old object still downloads, the row still names it, the new one is dropped", async () => {
    const old = await getServerFiles().upload(USER, new Blob(["<old/>"]), "old.xml")
    const cost = await newCost(USER, old)
    const link = (await call("create_upload_url", { target: "cost", id: cost.id, name: "new.xml", replace: true })).body
    await put(link.uploadUrl, "<new/>")
    const stored = (await getServerDb().getUpload(link.uploadId))!.file!
    breakRow()
    expect((await call("complete_upload", { uploadId: link.uploadId })).isError).toBe(true)
    expect(await rowFile(cost.id)).toEqual(old)
    expect(await (await getServerFiles().download(old)).text()).toBe("<old/>")
    await expect(getServerFiles().download(stored)).rejects.toThrow()
  })

  it("attach_file with replace: the same", async () => {
    const old = await getServerFiles().upload(USER, new Blob(["<old/>"]), "old.xml")
    const cost = await newCost(USER, old)
    breakRow()
    expect((await call("attach_file", { target: "cost", id: cost.id, name: "new.xml", content_base64: b64("<new/>"), replace: true })).isError).toBe(true)
    expect(await rowFile(cost.id)).toEqual(old)
    expect(await (await getServerFiles().download(old)).text()).toBe("<old/>")
  })

  it("two concurrent complete_upload calls: one attaches, the other is told it is being completed, and the old file goes once", async () => {
    const old = await getServerFiles().upload(USER, new Blob(["<old/>"]), "old.xml")
    const cost = await newCost(USER, old)
    const link = (await call("create_upload_url", { target: "cost", id: cost.id, name: "new.xml", replace: true })).body
    await put(link.uploadUrl, "<new/>")
    const remove = vi.spyOn(getServerFiles(), "remove")
    const results = await Promise.all([call("complete_upload", { uploadId: link.uploadId }), call("complete_upload", { uploadId: link.uploadId })])
    expect(results.filter((r) => r.isError)).toHaveLength(1)
    expect(results.find((r) => r.isError)!.body.error).toMatch(/already being completed/)
    expect(remove.mock.calls.filter(([path]) => path === old.path)).toHaveLength(1)
    expect((await rowFile(cost.id))!.name).toBe("new.xml")
  })

  it("complete_upload takes only the id create_upload_url returned", () => {
    expect(registered.get("complete_upload")!.schema.safeParse({ uploadId: "a/b" }).success).toBe(false)
    expect(registered.get("complete_upload")!.schema.safeParse({ uploadId: "x".repeat(43) }).success).toBe(true)
  })
})

describe("attach_file", () => {
  it("with content_base64 returns what it returned before, plus the sha256", async () => {
    const cost = await newCost()
    const { isError, body } = await call("attach_file", { target: "cost", id: cost.id, name: "a.xml", content_base64: b64("<a/>") })
    expect(isError).toBe(false)
    expect(body.file).toEqual({ fileId: fileIdOf((await rowFile(cost.id))!.path), name: "a.xml", kind: "xml", size: 4, sha256: sha("<a/>") })
    expect(body.summary).toContain("Attached a.xml")
  })

  it.each([
    ["neither", {}],
    ["both", { content_base64: b64("<a/>"), url: "https://files.example.com/a.xml" }],
  ])("takes exactly one of content_base64 and url: %s is refused", async (_l, over) => {
    const cost = await newCost()
    const { isError, body } = await call("attach_file", { target: "cost", id: cost.id, name: "a.xml", ...over })
    expect(isError).toBe(true)
    expect(body.error).toBe("Pass exactly one of content_base64 and url.")
    expect(await rowFile(cost.id)).toBeNull()
  })

  it("downloads a url, then attaches it like content_base64", async () => {
    vi.mocked(downloadPublicFile).mockResolvedValue(Buffer.from("<from-url/>"))
    const cost = await newCost()
    const { isError, body } = await call("attach_file", { target: "cost", id: cost.id, name: "a.xml", url: "https://files.example.com/a.xml?sig=secret" })
    expect(isError).toBe(false)
    expect(downloadPublicFile).toHaveBeenCalledWith("https://files.example.com/a.xml?sig=secret")
    expect(body.file).toMatchObject({ name: "a.xml", kind: "xml", size: 11, sha256: sha("<from-url/>") })
    expect(await (await getServerFiles().download((await rowFile(cost.id))!)).text()).toBe("<from-url/>")
  })

  it("refuses an empty download and leaves the row alone", async () => {
    vi.mocked(downloadPublicFile).mockResolvedValue(Buffer.alloc(0))
    const cost = await newCost()
    const { isError, body } = await call("attach_file", { target: "cost", id: cost.id, name: "a.xml", url: "https://files.example.com/a.xml" })
    expect(isError).toBe(true)
    expect(body.error).toBe("The download was empty.")
    expect(await rowFile(cost.id)).toBeNull()
  })

  it("audits the url without its query string", async () => {
    vi.mocked(downloadPublicFile).mockResolvedValue(Buffer.from("<a/>"))
    const audit = vi.spyOn(getServerDb(), "addAuditEntry")
    const cost = await newCost()
    await call("attach_file", { target: "cost", id: cost.id, name: "a.xml", url: "https://user:pw@files.example.com/a.xml?sig=secret#frag" })
    expect(audit.mock.calls.at(-1)![1].params).toMatchObject({ url: "https://files.example.com/a.xml" })
    audit.mockRestore()
  })

  it("refuses an over-10 MB download and a full row, leaving the row alone", async () => {
    const cost = await newCost()
    vi.mocked(downloadPublicFile).mockResolvedValue(Buffer.alloc(10 * MB + 1))
    const big = await call("attach_file", { target: "cost", id: cost.id, name: "a.pdf", url: "https://files.example.com/a.pdf" })
    expect(big.body.error).toMatch(/over the 10 MB limit/)

    const held = await Promise.all(Array.from({ length: INVOICE_FILES_MAX }, (_, n) => getServerFiles().upload(USER, new Blob([`<${n}/>`]), `h${n}.xml`)))
    const has = await getServerDb().createCompanyExpense(USER, { description: "Office Chair", category: "other", amount: 100, date: new Date(), files: held })
    vi.mocked(downloadPublicFile).mockClear()
    const refused = await call("attach_file", { target: "cost", id: has.id, name: "a.xml", url: "https://files.example.com/a.xml" })
    expect(refused.body.error).toContain(`already holds ${INVOICE_FILES_MAX} files`)
    expect(downloadPublicFile).not.toHaveBeenCalled() // nothing is fetched for a row that would refuse it
    expect(await rowFile(cost.id)).toBeNull()
  })

  it("says in its description that content_base64 is for small files and where larger ones go", () => {
    const descriptions: Record<string, string> = {}
    registerCrmWriteTools({ registerTool: (name: string, c: { description: string }) => void (descriptions[name] = c.description) } as unknown as McpServer)
    expect(descriptions.attach_file).toContain("content_base64 is only for files under about 10 KB")
    expect(descriptions.attach_file).toContain("create_upload_url then complete_upload")
    for (const tool of ["create_upload_url", "complete_upload"]) {
      expect((descriptions[tool].match(/«/g) ?? []).length).toBeLessThanOrEqual(3)
    }
    expect(descriptions.create_upload_url).toContain('curl -X PUT --data-binary @file "<uploadUrl>"')
    expect(descriptions.create_upload_url).toContain("changes only at complete_upload")
  })
})
