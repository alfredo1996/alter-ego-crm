/**
 * A zero-dependency .xlsx reader: the cells' values, sheet by sheet. Neutral:
 * it imports nothing, so either product can use it.
 *
 * ponytail: hand-rolled because npm xlsx (SheetJS) is frozen at 0.18.5 with
 * known CVEs and exceljs is heavy and Node-oriented. Ceiling: no ZIP64, no
 * encrypted workbooks, no 1904 date system, formulas read by their cached value,
 * no styles (a date is its serial number: excelSerialToDate). The XML is read
 * by a small tokenizer, not DOMParser, so it runs the same in every browser,
 * in happy-dom and in Node.
 */

export type XlsxCell = string | number | null

/** rows[i] is the sheet's row i + 1, cells[j] its column j + 1: only cells with a value are set. */
export type XlsxSheet = { name: string; rows: XlsxCell[][] }

export class XlsxError extends Error {}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw")
  const writer = stream.writable.getWriter()
  // Not awaited: the reader below drains the stream; a corrupt entry fails there.
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {})
  writer.close().catch(() => {})
  const chunks: Uint8Array[] = []
  const reader = stream.readable.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** Every entry's bytes, by name. Sizes come from the central directory, so data descriptors work. */
async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  let eocd = -1
  for (let at = buf.length - 22; at >= Math.max(0, buf.length - 22 - 0xffff); at--) {
    if (u32(buf, at) === 0x06054b50) {
      eocd = at
      break
    }
  }
  if (eocd < 0) throw new XlsxError("This is not an .xlsx file (no zip directory found).")
  const count = u16(buf, eocd + 10)
  let at = u32(buf, eocd + 16)
  if (count === 0xffff || at === 0xffffffff) throw new XlsxError("This workbook is too large (ZIP64 is not supported).")
  const names = new TextDecoder()
  const files = new Map<string, Uint8Array>()
  for (let k = 0; k < count; k++) {
    if (u32(buf, at) !== 0x02014b50) throw new XlsxError("The zip directory of this file is damaged.")
    const flags = u16(buf, at + 8)
    const method = u16(buf, at + 10)
    const size = u32(buf, at + 20)
    const nameLength = u16(buf, at + 28)
    const local = u32(buf, at + 42)
    const name = names.decode(buf.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + u16(buf, at + 30) + u16(buf, at + 32)
    if (flags & 1) throw new XlsxError("This workbook is encrypted: save it without a password and try again.")
    if (u32(buf, local) !== 0x04034b50) throw new XlsxError("The zip entries of this file are damaged.")
    const start = local + 30 + u16(buf, local + 26) + u16(buf, local + 28)
    const data = buf.subarray(start, start + size)
    if (method === 0) files.set(name, data)
    else if (method === 8) files.set(name, await inflateRaw(data))
    else throw new XlsxError(`Unsupported compression in this file (method ${method}).`)
  }
  return files
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }

/** XML text: entities, then OOXML's _xHHHH_ escapes for control characters. */
function text(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(Number(e[1].toLowerCase() === "x" ? `0${e.slice(1)}` : e.slice(1))) : (ENTITIES[e] ?? m),
    )
    .replace(/_x([0-9A-F]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
}

type Element = { attrs: Record<string, string>; inner: string }

/**
 * Each `name` element, any namespace prefix, with its attributes (by local
 * name) and inner XML. Enough for OOXML's flat lists (si, row, c, sheet,
 * Relationship): never used on an element that nests inside itself.
 */
function elements(xml: string, name: string): Element[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>)`, "g")
  return [...xml.matchAll(re)].map((m) => {
    const attrs: Record<string, string> = {}
    for (const a of (m[1] ?? "").matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[a[1].replace(/^[\w.-]+:/, "")] = text(a[2] ?? a[3])
    }
    return { attrs, inner: m[2] ?? "" }
  })
}

/** A string item's text: its runs joined, phonetic runs (rPh) skipped. */
function stringOf(inner: string): string {
  return elements(inner.replace(/<(?:[\w.-]+:)?rPh[\s>][\s\S]*?<\/(?:[\w.-]+:)?rPh\s*>/g, ""), "t")
    .map((t) => text(t.inner))
    .join("")
}

/** "AC12" → 28 (0-based column). */
function columnOf(ref: string): number {
  let n = 0
  for (const ch of ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "") n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1
}

function readSheet(xml: string, shared: string[]): XlsxCell[][] {
  const rows: XlsxCell[][] = []
  let r = -1
  for (const row of elements(xml, "row")) {
    r = row.attrs.r ? Number(row.attrs.r) - 1 : r + 1
    const cells: XlsxCell[] = []
    let c = -1
    for (const cell of elements(row.inner, "c")) {
      c = cell.attrs.r ? columnOf(cell.attrs.r) : c + 1
      const type = cell.attrs.t
      const v = elements(cell.inner, "v")[0]
      let value: XlsxCell = null
      if (type === "inlineStr") value = stringOf(elements(cell.inner, "is")[0]?.inner ?? "")
      else if (v === undefined) continue
      else if (type === "s") value = shared[Number(v.inner)] ?? null
      else if (type === "str" || type === "e") value = text(v.inner)
      else value = Number(v.inner)
      if (value === null || (typeof value === "number" && !Number.isFinite(value))) continue
      cells[c] = value
    }
    // Sparse arrays read as holes; the API promises null.
    rows[r] = Array.from(cells, (x) => x ?? null)
  }
  // Styled empty rows up to the declared dimension cost nothing: trailing ones go.
  while (rows.length > 0 && !(rows[rows.length - 1] ?? []).some((x) => x !== null)) rows.pop()
  return Array.from(rows, (x) => x ?? [])
}

/** A date cell's serial number (1900 system) as that day at UTC midnight. */
export function excelSerialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400000))
}

/** Every sheet in workbook order with its cell values. Throws XlsxError on what it can't read. */
export async function readXlsx(input: ArrayBuffer | Uint8Array): Promise<{ sheets: XlsxSheet[] }> {
  const files = await unzip(input instanceof Uint8Array ? input : new Uint8Array(input))
  const utf8 = new TextDecoder()
  const read = (name: string) => {
    const bytes = files.get(name)
    return bytes ? utf8.decode(bytes) : null
  }
  const workbook = read("xl/workbook.xml")
  const rels = read("xl/_rels/workbook.xml.rels")
  if (!workbook || !rels) throw new XlsxError("This is not an .xlsx workbook (xl/workbook.xml is missing).")
  const props = elements(workbook, "workbookPr")[0]?.attrs
  if (props && (props.date1904 === "true" || props.date1904 === "1")) {
    throw new XlsxError("This workbook uses the 1904 date system: switch it off in Excel's options and save again.")
  }
  const targets = new Map(elements(rels, "Relationship").map((r) => [r.attrs.Id, r.attrs.Target]))
  const sharedXml = read("xl/sharedStrings.xml")
  const shared = sharedXml ? elements(sharedXml, "si").map((si) => stringOf(si.inner)) : []
  return {
    sheets: elements(elements(workbook, "sheets")[0]?.inner ?? "", "sheet").map((s) => {
      const target = targets.get(s.attrs.id) ?? ""
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`
      const xml = read(path)
      if (xml === null) throw new XlsxError(`Sheet “${s.attrs.name}” is missing from the file.`)
      return { name: s.attrs.name, rows: readSheet(xml, shared) }
    }),
  }
}
