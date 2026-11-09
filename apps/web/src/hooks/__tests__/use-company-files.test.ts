import { beforeEach, describe, expect, it, vi } from "vitest"

import { FileUploadError, NO_FILE_CHANGE, writeWithInvoiceFile } from "../use-company-files"

import type { InvoiceFile } from "@/types"

const calls: string[] = []
const upload = vi.fn()
const remove = vi.fn()
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ files: { upload, remove } }) }))

const file = (path: string): InvoiceFile => ({ path, name: "a.xml", kind: "xml", size: 1, uploadedAt: new Date(0) })
const OLD = file("old")
const NEW = file("new")
const picked = new File(["<a/>"], "a.xml")

beforeEach(() => {
  calls.length = 0
  upload.mockReset().mockImplementation(async () => (calls.push("upload"), NEW))
  remove.mockReset().mockImplementation(async (path: string) => void calls.push(`remove ${path}`))
})

describe("writeWithInvoiceFile", () => {
  it("uploads, writes the record, and only then deletes the old object", async () => {
    const write = vi.fn(async () => void calls.push("write"))
    await writeWithInvoiceFile({ userId: "u1", stored: OLD, draft: { picked, removed: false }, write })
    expect(write).toHaveBeenCalledWith(NEW)
    expect(calls).toEqual(["upload", "write", "remove old"])
  })

  it("clears the pointer first and deletes the object after, on Remove", async () => {
    const write = vi.fn(async () => void calls.push("write"))
    await writeWithInvoiceFile({ userId: "u1", stored: OLD, draft: { picked: null, removed: true }, write })
    expect(write).toHaveBeenCalledWith(null)
    expect(calls).toEqual(["write", "remove old"])
  })

  it("touches no file and no pointer when nothing changed", async () => {
    const write = vi.fn(async () => "saved")
    expect(await writeWithInvoiceFile({ userId: "u1", stored: OLD, draft: NO_FILE_CHANGE, write })).toBe("saved")
    expect(write).toHaveBeenCalledWith(undefined)
    expect(upload).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it("writes nothing when the upload fails", async () => {
    upload.mockRejectedValue(new Error("offline"))
    const write = vi.fn()
    const err: unknown = await writeWithInvoiceFile({ userId: "u1", stored: OLD, draft: { picked, removed: false }, write }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FileUploadError)
    expect((err as Error).message).toBe("a.xml could not be uploaded: offline.")
    expect(write).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it("deletes the new object, keeps the old one, and rethrows when the write fails", async () => {
    const boom = new Error("refused")
    await expect(
      writeWithInvoiceFile({ userId: "u1", stored: OLD, draft: { picked, removed: false }, write: async () => { throw boom } }),
    ).rejects.toBe(boom)
    expect(calls).toEqual(["upload", "remove new"])
  })

  it("does not fail the save when the old object cannot be deleted", async () => {
    remove.mockRejectedValue(new Error("offline"))
    await expect(
      writeWithInvoiceFile({ userId: "u1", stored: OLD, draft: { picked, removed: false }, write: async () => "ok" }),
    ).resolves.toBe("ok")
  })
})
