// @vitest-environment node
import { createHash } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PUT } from "@/app/api/uploads/[token]/route"
import { __resetMockState } from "@/lib/backend/mock"
import { getServerDb, getServerFiles } from "@/lib/backend/server-db"
import { newUploadToken, uploadIdOf } from "@/lib/uploads"

import type { UploadRecord } from "@/lib/backend/types"
import type * as Modules from "@/modules"

// The plugin that owns invoice files can be switched off; the build's list is fixed at load, so this stands in for it.
const plugin = vi.hoisted(() => ({ off: false }))
vi.mock("@/modules", async (orig) => {
  const real = await orig<typeof Modules>()
  return { ...real, enabledToolNames: () => (plugin.off ? new Set<string>() : real.enabledToolNames()) }
})

const USER = "user-1"
const NOW = new Date("2026-11-23T10:00:00.000Z")

async function link(over: Partial<UploadRecord> = {}) {
  const token = newUploadToken()
  const id = uploadIdOf(token)
  await getServerDb().createUpload({
    id, userId: USER, target: "cost", rowId: "c1", name: "IT01_0003.xml", kind: "xml", declaredSize: null, declaredSha256: null, replace: false,
    status: "pending", createdAt: NOW, expiresAt: new Date(NOW.getTime() + 15 * 60_000), file: null, sha256: null, ...over,
  })
  return { token, id }
}
const put = (token: string, body: BodyInit | null, headers: Record<string, string> = {}) =>
  PUT(new Request(`https://mcp.example.com/api/uploads/${token}`, { method: "PUT", body, headers }), { params: Promise.resolve({ token }) })
const objects = async () => (await getServerDb().listUploads(USER)).flatMap((u) => (u.file ? [u.file] : []))

afterEach(() => vi.restoreAllMocks())
beforeEach(() => {
  plugin.off = false
  __resetMockState()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
})

describe("PUT /api/uploads/<token>", () => {
  it("stores the bytes in the user's folder and records the size and sha256 of what it received", async () => {
    const bytes = Buffer.from(Array.from({ length: 70_000 }, (_, i) => i % 251))
    const { token, id } = await link()
    const res = await put(token, bytes)
    expect(res.status).toBe(201)
    const hex = createHash("sha256").update(bytes).digest("hex")
    expect(await res.json()).toEqual({ uploadId: id, size: 70_000, sha256: hex })
    const record = (await getServerDb().getUpload(id))!
    expect(record).toMatchObject({ status: "received", sha256: hex })
    expect(record.file!.path).toMatch(new RegExp(`^users/${USER}/company-files/`))
    expect(Buffer.from(await (await getServerFiles().download(record.file!)).arrayBuffer())).toEqual(bytes)
  })

  it.each([
    ["a body over the declared size", { declaredSize: 10 }, "x".repeat(11), {}, "failed"],
    ["a body over 10 MB", {}, Buffer.alloc(10 * 1024 * 1024 + 1), {}, "failed"],
    // Refused on the header alone: nothing was claimed, so the link is still good.
    ["a Content-Length over the cap", { declaredSize: 10 }, "x", { "content-length": "11" }, "pending"],
  ])("refuses %s with 413 and stores nothing", async (_l, over, body, headers, status) => {
    const { token, id } = await link(over)
    const store = vi.spyOn(getServerFiles(), "upload")
    const res = await put(token, body, headers)
    expect(res.status).toBe(413)
    expect(store).not.toHaveBeenCalled()
    expect(await objects()).toEqual([])
    expect((await getServerDb().getUpload(id))!.file).toBeNull()
    expect((await getServerDb().getUpload(id))!.status).toBe(status)
  })

  it("refuses an empty body", async () => {
    const { token, id } = await link()
    const store = vi.spyOn(getServerFiles(), "upload")
    expect((await put(token, "")).status).toBe(400)
    expect(store).not.toHaveBeenCalled()
    expect(await objects()).toEqual([])
    expect((await getServerDb().getUpload(id))!.status).toBe("failed")
  })

  it("answers 500, burns the link and says so when the store fails", async () => {
    const { token, id } = await link()
    vi.spyOn(getServerFiles(), "upload").mockRejectedValueOnce(new Error("storage down"))
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const res = await put(token, "<a/>")
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain("create_upload_url")
    expect((await getServerDb().getUpload(id))!.status).toBe("failed")
    expect((await put(token, "<a/>")).status).toBe(409)
  })

  it("deletes the object and answers 410 when the record is gone by the time the body is stored", async () => {
    const { token, id } = await link()
    const files = getServerFiles()
    const real = files.upload.bind(files)
    let path = ""
    vi.spyOn(files, "upload").mockImplementationOnce(async (...args) => {
      await getServerDb().deleteUpload(id) // a sweep took the expired record while the body was arriving
      const file = await real(...args)
      path = file.path
      return file
    })
    const res = await put(token, "<a/>")
    expect(res.status).toBe(410)
    expect(path).not.toBe("")
    await expect(files.download({ path })).rejects.toThrow()
  })

  it("deletes the object when recording it throws", async () => {
    const { token, id } = await link()
    const files = getServerFiles()
    const remove = vi.spyOn(files, "remove")
    const db = getServerDb()
    const move = db.moveUpload.bind(db)
    vi.spyOn(db, "moveUpload").mockImplementation((uid, from, to, extra) => (to === "received" ? Promise.reject(new Error("write failed")) : move(uid, from, to, extra)))
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect((await put(token, "<a/>")).status).toBe(500)
    expect(remove).toHaveBeenCalledTimes(1)
    expect((await getServerDb().getUpload(id))!.status).toBe("failed")
  })

  it("refuses an unknown token and a malformed one", async () => {
    expect((await put(newUploadToken(), "<a/>")).status).toBe(404)
    expect((await put("short", "<a/>")).status).toBe(404)
  })

  it("refuses an expired link", async () => {
    const { token } = await link()
    vi.setSystemTime(new Date(NOW.getTime() + 15 * 60_000))
    const res = await put(token, "<a/>")
    expect(res.status).toBe(410)
    expect(await objects()).toEqual([])
  })

  it("takes a link once: the second PUT is refused and the first object stays", async () => {
    const { token, id } = await link()
    expect((await put(token, "<first/>")).status).toBe(201)
    const second = await put(token, "<second/>")
    expect(second.status).toBe(409)
    const record = (await getServerDb().getUpload(id))!
    expect(await (await getServerFiles().download(record.file!)).text()).toBe("<first/>")
  })

  it("lets exactly one of two concurrent PUTs store", async () => {
    const { token } = await link()
    const statuses = (await Promise.all([put(token, "<a/>"), put(token, "<b/>")])).map((r) => r.status).sort()
    expect(statuses).toEqual([201, 409])
    expect(await objects()).toHaveLength(1)
  })

  it("is not served when the plugin that owns invoice files is off", async () => {
    const { token, id } = await link()
    plugin.off = true
    expect((await put(token, "<a/>")).status).toBe(404)
    expect((await getServerDb().getUpload(id))!.status).toBe("pending")
  })
})
