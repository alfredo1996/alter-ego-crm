import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it } from "vitest"

import { zipInvoiceFiles } from "../invoice-files-zip"

import type { PeriodDocument } from "../invoice-files"

const file = (name: string, kind: "xml" | "p7m" | "pdf" = "xml") => ({ path: `company-files/${name}`, name, kind, size: 3, uploadedAt: new Date(2026, 8, 30) })
type F = ReturnType<typeof file>
const cost = (id: string, description: string, f: F | F[] | null, number: string | null = null): PeriodDocument => ({
  kind: "cost", id, day: "2026-09-02", label: description, number, customer: null, amount: 1, files: f === null ? [] : [f].flat(),
})
const invoice = (id: string, number: string, f: F | F[] | null): PeriodDocument => ({
  kind: "invoice", id, day: "2026-09", label: `Invoice ${number}`, number, customer: "Acme", amount: 1, files: f === null ? [] : [f].flat(),
})
const load = async (f: { name: string }) => new TextEncoder().encode(`content of ${f.name}`)

describe("zipInvoiceFiles", () => {
  it("holds exactly the files, in costs/ and invoices/, and counts the records without one", async () => {
    const { bytes, files, missing } = await zipInvoiceFiles(
      [cost("a", "Hosting", file("a.xml"), "26/1"), cost("b", "Bare", null), invoice("i", "14", file("x.pdf", "pdf")), invoice("j", "15", null)],
      load,
    )
    expect([files, missing]).toEqual([2, 2])
    const zip = unzipSync(bytes)
    expect(Object.keys(zip).sort()).toEqual(["costs/2026-09-02 Hosting (26-1).xml", "invoices/2026-09 Invoice 14 (Acme).pdf"])
    expect(strFromU8(zip["costs/2026-09-02 Hosting (26-1).xml"])).toBe("content of a.xml")
  })

  it("gives two files with the same name distinct entries, each its own content, keeping .xml.p7m whole", async () => {
    const { bytes } = await zipInvoiceFiles([cost("a", "Rent", file("one.xml.p7m", "p7m")), cost("b", "Rent", file("two.xml.p7m", "p7m"))], load)
    const zip = unzipSync(bytes)
    expect(Object.keys(zip).sort()).toEqual(["costs/2026-09-02 Rent (2).xml.p7m", "costs/2026-09-02 Rent.xml.p7m"])
    expect(strFromU8(zip["costs/2026-09-02 Rent (2).xml.p7m"])).toBe("content of two.xml.p7m")
  })
})

describe("a record with several files", () => {
  it("names each ' (file i of n)' in list order, and counts every file", async () => {
    const { bytes, files, missing } = await zipInvoiceFiles(
      [cost("a", "Print run", [file("one.xml"), file("two.xml.p7m", "p7m"), file("three.pdf", "pdf")], "118-26")],
      load,
    )
    expect([files, missing]).toEqual([3, 0])
    const zip = unzipSync(bytes)
    expect(Object.keys(zip).sort()).toEqual([
      "costs/2026-09-02 Print run (118-26) (file 1 of 3).xml",
      "costs/2026-09-02 Print run (118-26) (file 2 of 3).xml.p7m",
      "costs/2026-09-02 Print run (118-26) (file 3 of 3).pdf",
    ])
    expect(strFromU8(zip["costs/2026-09-02 Print run (118-26) (file 2 of 3).xml.p7m"])).toBe("content of two.xml.p7m")
  })

  it("keeps a one-file record's plain name; a clash between records numbers the record's name, before any file number", async () => {
    const { bytes } = await zipInvoiceFiles(
      [cost("a", "Rent", [file("a1.xml"), file("a2.xml")]), cost("b", "Rent", file("b.xml")), cost("c", "Rent", [file("c1.xml"), file("c2.xml")])],
      load,
    )
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual([
      "costs/2026-09-02 Rent (2) (file 1 of 2).xml",
      "costs/2026-09-02 Rent (2) (file 2 of 2).xml",
      "costs/2026-09-02 Rent (file 1 of 2).xml",
      "costs/2026-09-02 Rent (file 2 of 2).xml",
      "costs/2026-09-02 Rent.xml",
    ])
  })

  it("names the file that could not be downloaded", async () => {
    await expect(zipInvoiceFiles([cost("a", "Rent", [file("a1.xml"), file("a2.xml")])], async (f) => {
      if (f.name === "a2.xml") throw new Error("boom")
      return new Uint8Array(1)
    })).rejects.toThrow(new Error("2026-09-02 Rent (file 2 of 2).xml could not be downloaded"))
  })
})

it("treats names that differ only in case as one, and stores without deflating", async () => {
  const { bytes } = await zipInvoiceFiles([cost("a", "Rent", file("one.xml")), cost("b", "rent", file("two.xml"))], load)
  expect(Object.keys(unzipSync(bytes)).sort()).toEqual(["costs/2026-09-02 Rent.xml", "costs/2026-09-02 rent (2).xml"])
  // Level 0: the entry is the content plus headers, so a repetitive file is not shrunk.
  const big = await zipInvoiceFiles([cost("c", "Big", file("big.pdf", "pdf"))], async () => new Uint8Array(5000))
  expect(big.bytes.length).toBeGreaterThan(5000)
})

it("names the record whose file could not be downloaded, and nothing from storage", async () => {
  await expect(
    zipInvoiceFiles([cost("a", "Hosting", file("a.xml"))], async () => {
      throw new Error("storage/object-not-found: company-files/u1/a.xml")
    }),
  ).rejects.toThrow(new Error("2026-09-02 Hosting.xml could not be downloaded"))
})

