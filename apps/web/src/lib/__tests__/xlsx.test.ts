/**
 * The zero-dependency .xlsx reader on workbooks built in the test: shared and
 * inline strings, rich and phonetic runs, numbers, formulas by cached value,
 * dates as serials, sheet order from the rels, stored and data-descriptor
 * entries, and the files it must refuse.
 */
import { describe, expect, it } from "vitest"

import { buildXlsx, zip } from "@/lib/__tests__/helpers/prima-nota-workbook"
import { excelSerialToDate, readXlsx, XlsxError } from "@/lib/xlsx"

const sheets = [
  {
    name: "First",
    rows: [
      ["Name", "Amount", "When"],
      ["Rent & bills <May>", 1234.5, 46302],
      [{ rich: ["Bold", " and plain"], phonetic: "ignored" }, -0.01, { formula: "B2*2", value: 2469 }],
      [],
      [null, null, { formula: "A2", value: "text result" }],
    ],
  },
  { name: "Second", rows: [["only"]] },
]

describe("readXlsx", () => {
  it("reads strings, numbers, rich runs without phonetics, formulas by cached value", async () => {
    const book = await readXlsx(buildXlsx(sheets))
    expect(book.sheets.map((s) => s.name)).toEqual(["First", "Second"])
    expect(book.sheets[0].rows).toEqual([
      ["Name", "Amount", "When"],
      ["Rent & bills <May>", 1234.5, 46302],
      ["Bold and plain", -0.01, 2469],
      [],
      [null, null, "text result"],
    ])
    expect(book.sheets[1].rows).toEqual([["only"]])
  })

  it("drops the styled empty rows up to the declared dimension", async () => {
    const book = await readXlsx(buildXlsx(sheets))
    // The builder adds an empty styled row 999, as LibreOffice does up to A1:AC1000.
    expect(book.sheets[0].rows).toHaveLength(5)
  })

  it("reads inline strings, stored entries and data descriptors alike", async () => {
    for (const opts of [{ inline: true }, { store: true }, { descriptor: true }, { store: true, descriptor: true }]) {
      const book = await readXlsx(buildXlsx(sheets, opts))
      expect(book.sheets[0].rows[1]).toEqual(["Rent & bills <May>", 1234.5, 46302])
    }
  })

  it("takes the sheet order from the workbook, not from the file names", async () => {
    const book = await readXlsx(buildXlsx(sheets, { shuffleFiles: true }))
    expect(book.sheets.map((s) => [s.name, s.rows[0][0]])).toEqual([
      ["First", "Name"],
      ["Second", "only"],
    ])
  })

  it("reads a tiny hand-built zip: prefixed XML, no shared strings, entities, cells without r", async () => {
    const ns = `xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
    const file = zip([
      { name: "xl/workbook.xml", data: `<x:workbook ${ns}><x:sheets><x:sheet name="A &amp; B" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`, store: true },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="/xl/worksheets/a.xml"/></Relationships>`,
        descriptor: true,
      },
      {
        name: "xl/worksheets/a.xml",
        data: `<x:worksheet ${ns}><x:sheetData><x:row><x:c t="inlineStr"><x:is><x:t>Line&#10;two_x000D_</x:t></x:is></x:c><x:c><x:v>7</x:v></x:c></x:row><x:row r="3"><x:c r="B3" t="e"><x:v>#DIV/0!</x:v></x:c></x:row></x:sheetData></x:worksheet>`,
      },
    ])
    const book = await readXlsx(file)
    expect(book.sheets).toEqual([{ name: "A & B", rows: [["Line\ntwo\r", 7], [], [null, "#DIV/0!"]] }])
  })

  it("turns a date serial into that day at UTC midnight", () => {
    expect(excelSerialToDate(46302).toISOString()).toBe("2026-10-07T00:00:00.000Z")
    expect(excelSerialToDate(45658).toISOString()).toBe("2025-01-01T00:00:00.000Z")
  })

  it("refuses the 1904 date system", async () => {
    await expect(readXlsx(buildXlsx(sheets, { date1904: true }))).rejects.toThrow(/1904 date system/)
  })

  it("refuses a file that is no zip, an unknown compression and an encrypted entry", async () => {
    await expect(readXlsx(new TextEncoder().encode("Name;Amount\nRent;12"))).rejects.toThrow(XlsxError)
    await expect(readXlsx(zip([{ name: "xl/workbook.xml", data: "<workbook/>", method: 12, store: true }]))).rejects.toThrow(/method 12/)
    const locked = buildXlsx(sheets)
    const dir = locked.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    locked[dir + 8] |= 1
    await expect(readXlsx(locked)).rejects.toThrow(/encrypted/)
  })

  it("refuses a zip that is no workbook", async () => {
    await expect(readXlsx(zip([{ name: "word/document.xml", data: "<w/>" }]))).rejects.toThrow(/not an \.xlsx workbook/)
  })
})
