/**
 * Builds .xlsx files in memory for the tests: a plain zip writer and a workbook
 * writer. Made-up data only: nothing here may come from a real workbook.
 *
 * Only node:zlib, so the Playwright specs can import it too.
 */
import { crc32, deflateRawSync } from "node:zlib"

export type ZipEntry = {
  name: string
  data: string | Uint8Array
  /** Method 0 instead of deflate. */
  store?: boolean
  /** Sizes and CRC in a trailing data descriptor, zeros in the local header, as streaming writers do. */
  descriptor?: boolean
  /** Compression method written as is (an unsupported one, for the error test). */
  method?: number
}

const le = (bytes: number, value: number) => {
  const b = Buffer.alloc(bytes)
  if (bytes === 2) b.writeUInt16LE(value)
  else b.writeUInt32LE(value >>> 0)
  return b
}

/** A zip archive, as Excel and LibreOffice write them. */
export function zip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const raw = Buffer.from(typeof e.data === "string" ? Buffer.from(e.data, "utf8") : e.data)
    const body = e.store ? raw : deflateRawSync(raw)
    const method = e.method ?? (e.store ? 0 : 8)
    const name = Buffer.from(e.name, "utf8")
    const crc = crc32(raw)
    const flags = (e.descriptor ? 8 : 0) | 0x800
    const sizes = e.descriptor ? [le(4, 0), le(4, 0), le(4, 0)] : [le(4, crc), le(4, body.length), le(4, raw.length)]
    const local = Buffer.concat([le(4, 0x04034b50), le(2, 20), le(2, flags), le(2, method), le(2, 0), le(2, 0x21), ...sizes, le(2, name.length), le(2, 0), name])
    const trailer = e.descriptor ? Buffer.concat([le(4, 0x08074b50), le(4, crc), le(4, body.length), le(4, raw.length)]) : Buffer.alloc(0)
    central.push(
      Buffer.concat([
        le(4, 0x02014b50), le(2, 20), le(2, 20), le(2, flags), le(2, method), le(2, 0), le(2, 0x21),
        le(4, crc), le(4, body.length), le(4, raw.length), le(2, name.length), le(2, 0), le(2, 0), le(2, 0), le(2, 0), le(4, 0),
        le(4, offset), name,
      ]),
    )
    parts.push(local, body, trailer)
    offset += local.length + body.length + trailer.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.concat([
    le(4, 0x06054b50), le(2, 0), le(2, 0), le(2, entries.length), le(2, entries.length), le(4, directory.length), le(4, offset), le(2, 0),
  ])
  return Buffer.concat([...parts, directory, end])
}

export type Cell = string | number | null | { formula: string; value: number | string } | { rich: string[]; phonetic?: string }

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
const colName = (c: number): string => (c < 26 ? String.fromCharCode(65 + c) : colName(Math.floor(c / 26) - 1) + String.fromCharCode(65 + (c % 26)))

export type WorkbookOptions = {
  date1904?: boolean
  /** Strings written inline (t="inlineStr") instead of in sharedStrings.xml. */
  inline?: boolean
  /** Every entry stored (method 0) / with a data descriptor. */
  store?: boolean
  descriptor?: boolean
  /** Sheet files written in reverse name order: their order must come from the rels, not the file names. */
  shuffleFiles?: boolean
}

/** An .xlsx workbook with these sheets, in this order. */
export function buildXlsx(sheets: { name: string; rows: Cell[][] }[], opts: WorkbookOptions = {}): Buffer {
  const shared: string[] = []
  const sharedIndex = new Map<string, number>()
  const sst = (key: string, xml: string) => {
    if (!sharedIndex.has(key)) {
      sharedIndex.set(key, shared.length)
      shared.push(xml)
    }
    return sharedIndex.get(key)!
  }
  const cellXml = (ref: string, v: Cell): string => {
    if (v === null) return `<c r="${ref}" s="1"/>`
    if (typeof v === "number") return `<c r="${ref}" t="n"><v>${v}</v></c>`
    if (typeof v === "string") {
      if (opts.inline) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
      return `<c r="${ref}" t="s"><v>${sst(`s:${v}`, `<si><t xml:space="preserve">${esc(v)}</t></si>`)}</v></c>`
    }
    if ("formula" in v) {
      const t = typeof v.value === "string" ? ` t="str"` : ""
      return `<c r="${ref}"${t}><f>${esc(v.formula)}</f><v>${esc(String(v.value))}</v></c>`
    }
    const runs = v.rich.map((t, k) => `<r>${k ? "<rPr><b/></rPr>" : ""}<t xml:space="preserve">${esc(t)}</t></r>`).join("")
    const ph = v.phonetic ? `<rPh sb="0" eb="1"><t>${esc(v.phonetic)}</t></rPh>` : ""
    return `<c r="${ref}" t="s"><v>${sst(`r:${JSON.stringify(v)}`, `<si>${runs}${ph}</si>`)}</v></c>`
  }
  const sheetXml = (rows: Cell[][]) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:AC1000"/><cols><col min="1" max="1" width="20"/></cols><sheetData>${rows
      .map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) => cellXml(`${colName(c)}${r + 1}`, v)).join("")}</row>`)
      .join("")}<row r="999"><c r="A999" s="1"/><c r="B999" s="1"/></row></sheetData></worksheet>`
  const files = sheets.map((s, k) => ({ path: `worksheets/sheet${opts.shuffleFiles ? sheets.length - k : k + 1}.xml`, xml: sheetXml(s.rows) }))
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${opts.date1904 ? "true" : "false"}"/><sheets>${sheets
    .map((s, k) => `<sheet name="${esc(s.name)}" sheetId="${k + 1}" state="visible" r:id="rId${k + 3}"/>`)
    .join("")}</sheets></workbook>`
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>${files
    .map((f, k) => `<Relationship Id="rId${k + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${f.path}"/>`)
    .join("")}</Relationships>`
  const strings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.join("")}</sst>`
  const entry = (name: string, data: string): ZipEntry => ({ name, data, store: opts.store, descriptor: opts.descriptor })
  return zip([
    entry("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`),
    entry("xl/workbook.xml", workbook),
    entry("xl/_rels/workbook.xml.rels", rels),
    ...files.map((f) => entry(`xl/${f.path}`, f.xml)),
    entry("xl/sharedStrings.xml", strings),
    entry("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>`),
  ])
}
