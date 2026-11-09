/**
 * Builds .xlsx files in memory for the tests: a plain zip writer, a workbook
 * writer and the prima nota layout on top. Made-up data only (Main Bank, Second
 * Bank, Room 2, Acme Ltd): nothing here may come from a real workbook.
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

// ─── The prima nota layout ──────────────────────────────────────────────────

export type BookRow = {
  /** Column B. */
  b: string
  /** Column C: the document number. */
  c?: string
  /** Money by account name: + in, − out. Fills D/E too, unless `transfer`. */
  money?: Record<string, number>
  /** D and E left empty: money between own accounts. */
  transfer?: boolean
  /** Overrides of D (Entrata di Cassa) / E (Uscita di Cassa), to build a broken row. */
  d?: number | null
  e?: number | null
  /** Credito / Debito: a document with no money. */
  j?: number
  k?: number
  /** Column L, the note. */
  l?: string
  /** Column M = X: a cost centre row. */
  x?: boolean
  /** A raw cell in place of an amount, by account name and side. */
  text?: { account: string; side: "in" | "out"; value: string }
}

export type Book = {
  accounts: string[]
  /** The Saldo sheet's Conto names, if not the accounts'. */
  saldoNames?: string[]
  /** "Via Esempio": the last header is "Spesa per Casa Via Esempio". */
  project: string
  /** "yyyy-mm-dd". */
  saldoDay: string
  /** The Saldo balances; by default the sum of every row of the account. */
  balances?: number[]
  months: { name: string; rows: BookRow[] }[]
  /** Extra sheets after the months (an unknown name, for the error test). */
  extraSheets?: string[]
  /** Leaves this header out of every month sheet. */
  dropHeader?: string
  noSaldo?: boolean
}

const serial = (day: string) => (Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000

/** The 13-column month sheets, the Saldo sheet first and a Verifica sheet last, as the owner keeps them. */
export function primaNotaWorkbook(book: Book, opts: WorkbookOptions = {}): Buffer {
  const header = [
    "Numero Transazione", "Descrizione", "Numero Fattura", "Entrata di Cassa", "Uscita di Cassa",
    ...book.accounts.flatMap((a) => [`Entrata ${a}`, `Uscita ${a}`]),
    "Credito", "Debito", "Note", `Spesa per Casa ${book.project}`,
  ]
  const keep = header.map((h) => h !== book.dropHeader)
  const totals = book.accounts.map(() => 0)
  const months = book.months.map((m) => ({
    name: m.name,
    rows: [
      header.filter((_h, k) => keep[k]),
      ...m.rows.map((r, n) => {
        const legs = book.accounts.flatMap((a, k) => {
          const v = r.money?.[a] ?? 0
          totals[k] += v
          const cell = (side: "in" | "out", n: number | null): Cell => (r.text?.account === a && r.text.side === side ? r.text.value : n)
          return [cell("in", v > 0 ? v : null), cell("out", v < 0 ? -v : null)]
        })
        const ins = Object.values(r.money ?? {}).filter((v) => v > 0).reduce((s, v) => s + v, 0)
        const outs = Object.values(r.money ?? {}).filter((v) => v < 0).reduce((s, v) => s - v, 0)
        const d = r.d !== undefined ? r.d : r.transfer || !ins ? null : Math.round(ins * 100) / 100
        const e = r.e !== undefined ? r.e : r.transfer || !outs ? null : Math.round(outs * 100) / 100
        const cells: Cell[] = [n + 1, r.b, r.c ?? null, d, e, ...legs, r.j ?? null, r.k ?? null, r.l ?? null, r.x ? "X" : null]
        return cells.filter((_c, k) => keep[k])
      }),
    ],
  }))
  const balances = book.balances ?? totals.map((t) => Math.round(t * 100) / 100)
  const saldo = {
    name: "Saldo",
    rows: [["Conto", "Data", "Saldo"], ...book.accounts.map((a, k) => [book.saldoNames?.[k] ?? a, serial(book.saldoDay), balances[k]])],
  }
  const verifica = { name: "Verifica", rows: [["Verifica della prima nota"], ["Mese", "Totale"], ["Maggio", { formula: "SUM(Maggio!F2:F400)", value: 0 }]] as Cell[][] }
  return buildXlsx(
    [...(book.noSaldo ? [] : [saldo]), ...months, verifica, ...(book.extraSheets ?? []).map((name) => ({ name, rows: [["x"]] }))],
    opts,
  )
}

const MAIN = "Main Bank"
const SECOND = "Second Bank"

/**
 * Every kind of row the import knows, invented: two banks, a flat let by the
 * room (Via Esempio), Acme Ltd and Beta Srl as clients, Edilfast as a supplier.
 * The Saldo balances are the rows' sums, on 5 August 2026.
 */
export const SYNTHETIC_BOOK: Book = {
  accounts: [MAIN, SECOND],
  saldoNames: ["Main Bank Business", "Second Bank"],
  project: "Via Esempio",
  saldoDay: "2026-08-05",
  months: [
    {
      name: "Maggio",
      rows: [
        { b: "Finanziamento Soci", money: { [MAIN]: 5000 } },
        { b: "Commissione Main Bank", money: { [MAIN]: -20 }, l: "Nessuna fattura: la banca non la emette" },
        { b: "Rientro del Deposito Capitale versato", money: { [MAIN]: 1000 } },
        { b: "Prelievo finanziamento soci per spese personali", money: { [MAIN]: -500 } },
        { b: "Acquisto monitor da Negozio Uno", c: "R-100", money: { [MAIN]: -200 } },
        { b: "Giroconto interno", money: { [MAIN]: -1500, [SECOND]: 1500 }, transfer: true },
        { b: "Caparra per la locazione", money: { [MAIN]: -1200 }, j: 1200, x: true },
      ],
    },
    {
      name: "Giugno",
      rows: [
        { b: "Emessa fattura 101/2026 (Acme Ltd)", c: "101/2026", k: 1220, l: "Totale 1.220,00, di cui IVA € 220,00" },
        { b: "Emessa fattura 102/2026 (Beta Srl)", c: "102/2026", k: 2000 },
        { b: "Nota di credito a storno 102/2026, Beta Srl", c: "Storno 102/2026", j: 2000 },
        { b: "Emessa fattura 103/2026 (Beta Srl, al posto della 102/2026)", c: "103/2026", k: 2000 },
        { b: "Incasso fattura 101/2026, cliente Acme Ltd", c: "101/2026", money: { [MAIN]: 1220 }, l: "Bonifico ricevuto il 12/06" },
        { b: "Incasso fattura 103/2026, cliente Beta Srl", c: "103/2026", money: { [MAIN]: 1980 }, l: "Fattura 2.000,00: incassati 1.980,00, differenza 20,00" },
        { b: "Abbonamento software gestionale", c: "SW-1", money: { [MAIN]: -12 }, l: "Fattura del 30/05" },
        { b: "Volo per trasferta (pagato da carta personale del socio)", c: "W-1", k: 80, l: "Pagati il 03/06 con la carta personale" },
        { b: "Edilfast fattura SUP-05 (lavori Via Esempio)", c: "SUP-05", k: 3000, x: true, l: "Pagati 1.000,00 il 20/06, residuo da pagare" },
        { b: "Edilfast – acconto fattura SUP-05", c: "SUP-05", money: { [SECOND]: -1000 }, l: "Bonifico disposto il 20/06", x: true },
        { b: "Edilfast fattura SUP-06, annullata", c: "SUP-06", k: 900, x: true },
        { b: "Edilfast nota di credito SUP-07 a storno della SUP-06", c: "NC SUP-07", j: 900, x: true },
        { b: "Giroconto interno", money: { [MAIN]: -3000, [SECOND]: 3000 }, transfer: true },
      ],
    },
    {
      name: "Luglio",
      rows: [
        { b: "Affitto Luglio Via Esempio", money: { [SECOND]: -1500 } },
        { b: "Room 2 (deposito cauzionale)", money: { [SECOND]: 700 } },
        { b: "Room 2 (affitto luglio)", money: { [SECOND]: 650 }, l: "Pagamento unico: di cui 100 come rimborso spese utenze" },
        { b: "Room 3 (affitto luglio 600 + spese 100)", money: { [SECOND]: 700 } },
        { b: "Room 4 (canone mensile)", money: { [SECOND]: 500 }, l: "Accredito ricevuto il 18/07" },
        { b: "Room 4 (contributo spese mensile)", money: { [SECOND]: 80 } },
        { b: "Room 5 (affitto e deposito cauzionale)", money: { [SECOND]: 1400 } },
        { b: "Room 3", money: { [SECOND]: -40 }, l: "Rimborso spese pulizie del 07/07: fattura assente", x: true },
        { b: "Negozio Due (rimborso)", c: "NC 55", money: { [SECOND]: 30 } },
        { b: "Banca Due (accredito)", money: { [SECOND]: 15 }, l: "Accredito del 21/07: cashback, da verificare" },
        {
          b: "Incasso da piattaforma (lavoro per il cliente Gamma Spa)",
          c: "PLT-001",
          money: { [MAIN]: 970 },
          l: "Fattura emessa dalla piattaforma in autofatturazione (5 gg x 200 = 1.000,00) meno commissione piattaforma 30,00 (fattura COM-9) = 970,00 netti",
        },
        { b: "Parcella commercialista trimestrale", c: "C-14", money: { [MAIN]: -300 } },
        { b: "Rimborso al socio (erroneamente)", money: { [MAIN]: -2000 } },
        { b: "Finanziamento Soci, nuovo versamento", money: { [MAIN]: 2000 } },
        { b: "Negozio Tre", money: { [SECOND]: -25 }, l: "Addebito carta il 31/07, fattura da recuperare" },
        { b: "Negozio Quattro", c: "NQ-1", money: { [SECOND]: -45 }, l: "Addebito del 01/08" },
        { b: "Movimento rimosso", l: "Nessun addebito sugli estratti: importo tolto" },
        { b: "Finanziamento Soci", money: { [MAIN]: 100 } },
        { b: "Finanziamento Soci", money: { [MAIN]: 100 } },
        { b: "Emessa fattura 105/2026 (Acme Ltd)", c: "105/2026", k: 610 },
        { b: "Negozio Quattro nota di credito, rimborsata come buono", c: "NC 77", j: 20 },
        { b: "Cena di lavoro", c: "F-9", money: { [MAIN]: -60 }, l: "Fattura del 10/07 intestata a persona fisica" },
      ],
    },
    {
      name: "Agosto",
      rows: [
        { b: "Incasso fattura 105/2026, cliente Acme Ltd", c: "105/2026", money: { [MAIN]: 610 }, l: "Accredito del 03/08" },
        { b: "Fornitore Estero servizi", c: "FE-1", money: { [MAIN]: -100 }, l: "Servizio estero: fattura del 02/08, reverse charge senza IVA" },
      ],
    },
  ],
}
