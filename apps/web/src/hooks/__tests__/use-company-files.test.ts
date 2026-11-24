import { beforeEach, describe, expect, it, vi } from "vitest"

import { draftChanges, FileUploadError, NO_FILE_CHANGE, writeWithInvoiceFiles } from "../use-company-files"

import type { InvoiceFile } from "@/types"

const calls: string[] = []
const upload = vi.fn()
const remove = vi.fn()
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ files: { upload, remove } }) }))

const file = (path: string): InvoiceFile => ({ path, name: `${path}.xml`, kind: "xml", size: 1, uploadedAt: new Date(0) })
const [A, , C] = [file("a"), file("b"), file("c")]
const pick = (name: string) => new File(["<a/>"], name)
/** The row as it is at save time: `list` through the change, as the adapter applies it. */
const rowWith = (list: InvoiceFile[]) =>
  vi.fn(async ({ change }: { change: (l: InvoiceFile[]) => InvoiceFile[] }) => {
    calls.push("change")
    return { before: list, after: change(list) }
  })
const base = { userId: "u1", target: "cost" as const }

beforeEach(() => {
  calls.length = 0
  let n = 0
  upload.mockReset().mockImplementation(async (_u: string, _f: File, name: string) => (calls.push(`upload ${name}`), file(`new${++n}`)))
  remove.mockReset().mockImplementation(async (path: string) => void calls.push(`remove ${path}`))
})

describe("writeWithInvoiceFiles on an existing row", () => {
  it("uploads every pick, writes the fields, changes the files once, and only then deletes the removed objects", async () => {
    const changeFiles = rowWith([A, file("b")])
    const write = vi.fn(async () => void calls.push("write"))
    await writeWithInvoiceFiles({ ...base, rowId: "r1", draft: { picked: [pick("x.xml"), pick("y.xml")], removed: ["a"] }, changeFiles, write })
    expect(write).toHaveBeenCalledWith(undefined)
    expect(calls).toEqual(["upload x.xml", "upload y.xml", "write", "change", "remove a"])
    expect(changeFiles).toHaveBeenCalledTimes(1)
  })

  it("applies the draft to the row as it is, keeping a file added meanwhile and not bringing back one removed meanwhile", async () => {
    // Opened on [A, B]; meanwhile another client removed B and added C. The draft removes A and adds a pick.
    const changeFiles = rowWith([A, C])
    await writeWithInvoiceFiles({ ...base, rowId: "r1", draft: { picked: [pick("x.xml")], removed: ["a"] }, changeFiles, write: async () => undefined })
    expect(changeFiles.mock.results).toHaveLength(1)
    const { after } = await changeFiles.mock.results[0].value
    expect(after.map((f: InvoiceFile) => f.path)).toEqual(["c", "new1"])
    // Only an object the row held is deleted: B was already gone from it.
    expect(remove).toHaveBeenCalledWith("a")
  })

  it("does not delete the object of a file the row no longer held", async () => {
    await writeWithInvoiceFiles({ ...base, rowId: "r1", draft: { picked: [], removed: ["gone"] }, changeFiles: rowWith([A]), write: async () => undefined })
    expect(remove).not.toHaveBeenCalled()
  })

  it("touches no file and no row when nothing changed", async () => {
    const changeFiles = rowWith([A])
    const write = vi.fn(async () => "saved")
    expect(await writeWithInvoiceFiles({ ...base, rowId: "r1", draft: NO_FILE_CHANGE, changeFiles, write })).toBe("saved")
    expect(write).toHaveBeenCalledWith(undefined)
    expect([upload, remove, changeFiles].map((f) => f.mock.calls.length)).toEqual([0, 0, 0])
  })

  it("on a failed second upload removes the first, writes nothing, and names the second file", async () => {
    upload.mockImplementationOnce(async () => (calls.push("upload one"), file("one"))).mockRejectedValueOnce(new Error("offline"))
    const write = vi.fn()
    const err: unknown = await writeWithInvoiceFiles({ ...base, rowId: "r1", draft: { picked: [pick("one.xml"), pick("two.xml")], removed: [] }, changeFiles: rowWith([]), write }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FileUploadError)
    expect((err as Error).message).toBe("two.xml could not be uploaded: offline.")
    expect(write).not.toHaveBeenCalled()
    expect(calls).toEqual(["upload one", "remove one"])
  })

  it("removes every new upload and rethrows when the fields write fails, and when the files change fails", async () => {
    const boom = new Error("refused")
    const draft = { picked: [pick("x.xml"), pick("y.xml")], removed: [] }
    await expect(writeWithInvoiceFiles({ ...base, rowId: "r1", draft, changeFiles: rowWith([A]), write: async () => { throw boom } })).rejects.toBe(boom)
    expect(calls).toEqual(["upload x.xml", "upload y.xml", "remove new1", "remove new2"])
    calls.length = 0
    const stuck = vi.fn(async () => { throw boom })
    await expect(writeWithInvoiceFiles({ ...base, rowId: "r1", draft, changeFiles: stuck, write: async () => "ok" })).rejects.toBe(boom)
    expect(calls.filter((c) => c.startsWith("remove"))).toEqual(["remove new3", "remove new4"])
  })

  it("does not fail the save when a removed object cannot be deleted", async () => {
    remove.mockRejectedValue(new Error("offline"))
    await expect(writeWithInvoiceFiles({ ...base, rowId: "r1", draft: { picked: [], removed: ["a"] }, changeFiles: rowWith([A]), write: async () => "ok" })).resolves.toBe("ok")
  })
})

describe("writeWithInvoiceFiles on a new row", () => {
  it("writes the row with the uploaded files, and never changes files afterwards", async () => {
    const changeFiles = rowWith([])
    const write = vi.fn(async () => "created")
    expect(await writeWithInvoiceFiles({ ...base, draft: { picked: [pick("x.xml"), pick("y.xml")], removed: [] }, changeFiles, write })).toBe("created")
    expect((write.mock.calls[0] as unknown as [InvoiceFile[]])[0].map((f) => f.path)).toEqual(["new1", "new2"])
    expect(changeFiles).not.toHaveBeenCalled()
  })

  it("writes no files at all when none were picked", async () => {
    const write = vi.fn(async () => "created")
    await writeWithInvoiceFiles({ ...base, draft: NO_FILE_CHANGE, changeFiles: rowWith([]), write })
    expect(write).toHaveBeenCalledWith(undefined)
  })
})

it("draftChanges is true for a pick or a removal, false for neither", () => {
  expect([draftChanges(NO_FILE_CHANGE), draftChanges({ picked: [pick("x.xml")], removed: [] }), draftChanges({ picked: [], removed: ["a"] })]).toEqual([false, true, true])
})


