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
import { WRITE_TOOLS, registerCrmWriteTools } from "@/lib/mcp/tools/crm-write"
import { downloadPublicFile } from "@/lib/safe-download"
import { type z } from "@/lib/zod"

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

async function call(name: string, input: Record<string, unknown>, userId = USER) {
  const tool = registered.get(name)
  if (!tool) throw new Error(`${name} is not registered`)
  const ctx = { http: { authInfo: { clientId: "test-client", extra: { userId } }, req: new Request(`${ORIGIN}/api/mcp`, { method: "POST" }) } }
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
  return getServerDb().createCompanyExpense(userId, { description: "Office Chair", category: "other", amount: 100, date: new Date(), ...(file && { file }) })
}
const rowFile = async (id: string, userId = USER) => (await getServerDb().getCompanyExpenses(userId)).find((e) => e.id === id)?.file ?? null

beforeEach(() => {
  __resetMockState()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-23T10:00:00.000Z"))
})
afterEach(() => {
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

  it("refuses a recurring cost", async () => {
    const e = await getServerDb().createCompanyExpense(USER, { description: "Rent Estimate", category: "other", amount: 10, date: new Date(), isRecurring: true })
    const { isError, body } = await call("create_upload_url", { target: "cost", id: e.id, name: "a.xml" })
    expect(isError).toBe(true)
    expect(body.error).toMatch(/recurring estimate/)
  })

  it("refuses a row that has a file unless replace: true", async () => {
    const cost = await newCost(USER, await getServerFiles().upload(USER, new Blob(["<old/>"]), "old.xml"))
    const refused = await call("create_upload_url", { target: "cost", id: cost.id, name: "new.xml" })
    expect(refused.isError).toBe(true)
    expect(refused.body.error).toContain("already has a file: old.xml")
    expect((await call("create_upload_url", { target: "cost", id: cost.id, name: "new.xml", replace: true })).isError).toBe(false)
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
    expect(body.file).toEqual({ name: "IT01_0002.xml", kind: "xml", size: xml.length, sha256: sha(xml) })
    expect(body.summary).toContain("Attached IT01_0002.xml")
    const file = (await rowFile(cost.id))!
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

  it("refuses when the row gained a file meanwhile, without replace, and drops the object", async () => {
    const { cost, link } = await arrived("<new/>")
    const stored = (await getServerDb().getUpload(link.uploadId))!.file!
    const other = await getServerFiles().upload(USER, new Blob(["<other/>"]), "other.xml")
    await getServerDb().updateCompanyExpense(USER, cost.id, { file: other })
    const { isError, body } = await call("complete_upload", { uploadId: link.uploadId })
    expect(isError).toBe(true)
    expect(body.error).toContain("already has a file: other.xml")
    expect(await rowFile(cost.id)).toEqual(other)
    await expect(getServerFiles().download(stored)).rejects.toThrow()
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

describe("attach_file", () => {
  it("with content_base64 returns what it returned before, plus the sha256", async () => {
    const cost = await newCost()
    const { isError, body } = await call("attach_file", { target: "cost", id: cost.id, name: "a.xml", content_base64: b64("<a/>") })
    expect(isError).toBe(false)
    expect(body.file).toEqual({ name: "a.xml", kind: "xml", size: 4, sha256: sha("<a/>") })
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
    expect(body.file).toEqual({ name: "a.xml", kind: "xml", size: 11, sha256: sha("<from-url/>") })
    expect(await (await getServerFiles().download((await rowFile(cost.id))!)).text()).toBe("<from-url/>")
  })

  it("audits the url without its query string", async () => {
    vi.mocked(downloadPublicFile).mockResolvedValue(Buffer.from("<a/>"))
    const audit = vi.spyOn(getServerDb(), "addAuditEntry")
    const cost = await newCost()
    await call("attach_file", { target: "cost", id: cost.id, name: "a.xml", url: "https://user:pw@files.example.com/a.xml?sig=secret#frag" })
    expect(audit.mock.calls.at(-1)![1].params).toMatchObject({ url: "https://files.example.com/a.xml" })
    audit.mockRestore()
  })

  it("refuses an over-10 MB download and a row that has a file, leaving the row alone", async () => {
    const cost = await newCost()
    vi.mocked(downloadPublicFile).mockResolvedValue(Buffer.alloc(10 * MB + 1))
    const big = await call("attach_file", { target: "cost", id: cost.id, name: "a.pdf", url: "https://files.example.com/a.pdf" })
    expect(big.body.error).toMatch(/over the 10 MB limit/)

    const has = await newCost(USER, await getServerFiles().upload(USER, new Blob(["<old/>"]), "old.xml"))
    vi.mocked(downloadPublicFile).mockClear()
    const refused = await call("attach_file", { target: "cost", id: has.id, name: "a.xml", url: "https://files.example.com/a.xml" })
    expect(refused.body.error).toContain("already has a file")
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
