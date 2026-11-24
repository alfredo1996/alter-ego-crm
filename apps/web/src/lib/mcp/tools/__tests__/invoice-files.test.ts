import { describe, expect, it } from "vitest"

import { INVOICE_FILES_MAX } from "@/types/schemas"

import { addedSummary, addFile, duplicateOf, pickFile, refuseBeforeAdding } from "../invoice-files"

import type { FileHolder } from "../invoice-files"
import type { InvoiceFile } from "@/types"

const f = (id: string, name = `${id}.xml`, size = 1024): InvoiceFile => ({ path: `users/u/company-files/${id}.xml`, name, kind: "xml", size, uploadedAt: new Date(0) })
const holder = (files: InvoiceFile[]): FileHolder => ({ noun: "cost", label: 'the cost "Print run"', files })
const ids = (n: number) => Array.from({ length: n }, (_, i) => f(`id${i}`))

describe("pickFile", () => {
  it("is the only file of a one-file row, with or without its fileId", () => {
    const only = f("Q3vT")
    expect([pickFile(holder([only])), pickFile(holder([only]), "Q3vT")]).toEqual([only, only])
  })
  it("refuses a row with none, an id the row does not hold, and no id on a row of several, naming each fileId", () => {
    expect(() => pickFile(holder([]))).toThrow('The cost "Print run" has no file.')
    expect(() => pickFile(holder([f("a"), f("b")]), "zz")).toThrow('The cost "Print run" has no file with fileId "zz". It holds: a.xml (fileId a), b.xml (fileId b).')
    expect(() => pickFile(holder([f("a"), f("b")]))).toThrow('The cost "Print run" holds 2 files: a.xml (fileId a), b.xml (fileId b). Pass fileId to pick one.')
  })
})

describe("what stops an add before anything is uploaded", () => {
  it("is a full row, and replace on a row of several; nothing for a row with room or one file to replace", () => {
    const full = holder(ids(INVOICE_FILES_MAX))
    expect(refuseBeforeAdding(full, false, "Remove one.")).toBe(`The cost "Print run" already holds ${INVOICE_FILES_MAX} files, the most a cost can hold. Remove one.`)
    expect(refuseBeforeAdding({ ...full, noun: "invoice", label: "invoice 14" }, false, "Go.")).toContain("the most an invoice can hold. Go.")
    expect(refuseBeforeAdding(holder(ids(2)), true, "")).toMatch(/^replace: true swaps the only file of a row, and the cost "Print run" holds 2: id0.xml \(fileId id0\), id1.xml \(fileId id1\)\. To change one/)
    expect([refuseBeforeAdding(holder(ids(2)), false, ""), refuseBeforeAdding(holder([f("a")]), true, ""), refuseBeforeAdding(holder([]), true, "")]).toEqual([null, null, null])
  })
  it("finds a file with the same name and size, and none when either differs", () => {
    expect(duplicateOf([f("a", "x.xml", 5)], { name: "x.xml", size: 5 })?.path).toBe("users/u/company-files/a.xml")
    expect([duplicateOf([f("a", "x.xml", 5)], { name: "x.xml", size: 6 }), duplicateOf([f("a", "x.xml", 5)], { name: "y.xml", size: 5 })]).toEqual([undefined, undefined])
  })
})

describe("addFile, the atomic change", () => {
  const stored = f("new", "new.xml", 9)
  const h = { noun: "cost" as const, label: 'the cost "Print run"' }
  it("appends, and swaps the only file with replace", () => {
    expect(addFile(h, stored, false, false)([f("a")])).toEqual([f("a"), stored])
    expect(addFile(h, stored, true, false)([f("a")])).toEqual([stored])
    expect(addFile(h, stored, true, false)([])).toEqual([stored])
  })
  it.each([
    ["attach_file, a duplicate", false, [f("a", "new.xml", 9)], 'The cost "Print run" already holds new.xml (FatturaPA XML, 1 KB). Nothing was attached.', false],
    ["complete_upload, a duplicate", false, [f("a", "new.xml", 9)], 'The cost "Print run" already holds new.xml (FatturaPA XML, 1 KB). Nothing was attached and the upload was discarded.', true],
    ["attach_file, a full row", false, ids(INVOICE_FILES_MAX), `The cost "Print run" already holds ${INVOICE_FILES_MAX} files, the most a cost can hold. Nothing was attached; remove one with remove_file first.`, false],
    ["complete_upload, a full row", false, ids(INVOICE_FILES_MAX), `The cost "Print run" already holds ${INVOICE_FILES_MAX} files, the most a cost can hold. Nothing was attached and the upload was discarded; remove one with remove_file first.`, true],
    ["complete_upload, replace on several", true, ids(2), 'The cost "Print run" now holds 2 files, so replace: true cannot pick one. Nothing was attached and the upload was discarded; remove the wrong file with remove_file, then start again without replace.', true],
  ])("%s is refused in its own words", (_who, replace, files, message, discarded) => {
    expect(() => addFile(h, stored, replace, discarded)(files)).toThrow(message)
  })
})

describe("addedSummary", () => {
  const stored = f("new", "new.xml")
  const h = { label: 'the cost "Print run"' }
  it("says attached for the first, how many it now holds for more, and replaced for a swap", () => {
    expect(addedSummary(h, [], [stored], stored, false)).toBe('Attached new.xml (FatturaPA XML, 1 KB) to the cost "Print run".')
    expect(addedSummary(h, [f("a")], [f("a"), stored], stored, false)).toBe('Attached new.xml (FatturaPA XML, 1 KB) to the cost "Print run"; it now holds 2 files.')
    expect(addedSummary(h, [f("a")], [stored], stored, true)).toBe('Replaced a.xml with new.xml (FatturaPA XML, 1 KB) on the cost "Print run".')
    expect(addedSummary(h, [], [stored], stored, true)).toBe('Attached new.xml (FatturaPA XML, 1 KB) to the cost "Print run".')
  })
})
