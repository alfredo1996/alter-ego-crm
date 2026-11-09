/**
 * Reads a FatturaPA invoice (the Italian e-invoice XML, signed in a .p7m or not) into a plain
 * object the invoice view lays out. It states what the XML states: amounts are strings as
 * written, and the app never computes a tax (cash flow only).
 */

import type { InvoiceFileKind } from "@/types"

/** A file that cannot be read as an invoice. `message` finishes the sentence that starts with the file name. */
export class InvoiceReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvoiceReadError"
  }
}

const NO_XML = "has no FatturaPA XML inside the signature."

// ── The signed envelope ────────────────────────────────────────────────────

interface Tlv {
  tag: number
  constructed: boolean
  /** Where the content starts and ends. */
  start: number
  end: number
  /** Where the next element starts. */
  next: number
}

/** One DER/BER element at `pos`. Reads short, long and indefinite lengths. */
function readTlv(b: Uint8Array, pos: number, limit: number): Tlv {
  if (pos + 2 > limit) throw new InvoiceReadError(NO_XML)
  const tag = b[pos]!
  let len = b[pos + 1]!
  let start = pos + 2
  if (len === 0x80) {
    // Indefinite: children run to an end-of-contents marker (00 00).
    const constructed = (tag & 0x20) !== 0
    if (!constructed) throw new InvoiceReadError(NO_XML)
    let p = start
    while (!(b[p] === 0 && b[p + 1] === 0)) p = readTlv(b, p, limit).next
    return { tag, constructed, start, end: p, next: p + 2 }
  }
  if (len & 0x80) {
    const n = len & 0x7f
    if (n > 4 || start + n > limit) throw new InvoiceReadError(NO_XML)
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + b[start + i]!
    start += n
  }
  if (start + len > limit) throw new InvoiceReadError(NO_XML)
  return { tag, constructed: (tag & 0x20) !== 0, start, end: start + len, next: start + len }
}

function children(b: Uint8Array, t: Tlv): Tlv[] {
  const out: Tlv[] = []
  for (let p = t.start; p < t.end; ) {
    const c = readTlv(b, p, t.end)
    out.push(c)
    p = c.next
  }
  return out
}

/** An OCTET STRING's bytes; a constructed one (the -stream form) is its chunks joined. */
function octets(b: Uint8Array, t: Tlv): Uint8Array[] {
  if (!t.constructed) return [b.subarray(t.start, t.end)]
  return children(b, t).flatMap((c) => octets(b, c))
}

const START_OF_DER = 0x30

/** Text saved as base64 (with or without PEM lines) back to bytes. */
function fromBase64(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder().decode(bytes).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
  } catch {
    throw new InvoiceReadError(NO_XML)
  }
}

function eContent(der: Uint8Array): Uint8Array {
  // ContentInfo { OID, [0] { SignedData { version, digestAlgorithms, encapContentInfo { OID, [0] { OCTET STRING } } } } }
  const parts = (t: Tlv) => children(der, t)
  try {
    const signedData = parts(parts(readTlv(der, 0, der.length))[1]!)[0]!
    const encap = parts(signedData)[2]!
    const content = parts(parts(encap)[1]!)[0]!
    const chunks = octets(der, content)
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let at = 0
    for (const c of chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  } catch (err) {
    if (err instanceof InvoiceReadError) throw err
    throw new InvoiceReadError(NO_XML)
  }
}

/**
 * The XML a CAdES/CMS .p7m signs: the envelope's eContent. The file is DER, or DER saved as base64.
 * A file signed twice is unwrapped until the XML shows. The signature itself is not verified.
 */
export function unwrapP7m(bytes: Uint8Array): Uint8Array {
  let data = bytes
  for (let layer = 0; layer < 4; layer++) {
    if (data[0] !== START_OF_DER) data = fromBase64(data)
    if (data[0] !== START_OF_DER) throw new InvoiceReadError(NO_XML)
    data = eContent(data)
    if (data[0] !== START_OF_DER) return data
  }
  throw new InvoiceReadError(NO_XML)
}

// ── The invoice ────────────────────────────────────────────────────────────

/** What a TipoDocumento stands for: the heading, and the Italian name the file uses. */
export const DOC_TYPES: Record<string, [string, string]> = {
  TD01: ["Invoice", "fattura"],
  TD02: ["Advance Invoice", "acconto/anticipo su fattura"],
  TD03: ["Advance Invoice", "acconto/anticipo su parcella"],
  TD04: ["Credit Note", "nota di credito"],
  TD05: ["Debit Note", "nota di debito"],
  TD06: ["Fee Invoice", "parcella"],
  TD07: ["Simplified Invoice", "fattura semplificata"],
  TD08: ["Simplified Credit Note", "nota di credito semplificata"],
  TD09: ["Simplified Debit Note", "nota di debito semplificata"],
  TD16: ["Reverse Charge Integration", "integrazione fattura reverse charge interno"],
  TD17: ["Self-Invoice for Foreign Services", "integrazione/autofattura per acquisto servizi dall'estero"],
  TD18: ["Intra-EU Goods Integration", "integrazione per acquisto di beni intracomunitari"],
  TD19: ["Self-Invoice for Goods", "integrazione/autofattura per acquisto di beni ex art.17 c.2 DPR 633/72"],
  TD20: ["Regularisation Self-Invoice", "autofattura per regolarizzazione e integrazione delle fatture"],
  TD21: ["Ceiling Overrun Self-Invoice", "autofattura per splafonamento"],
  TD22: ["VAT Warehouse Extraction", "estrazione beni da Deposito IVA"],
  TD23: ["VAT Warehouse Extraction With VAT Payment", "estrazione beni da Deposito IVA con versamento IVA"],
  TD24: ["Deferred Invoice", "fattura differita art.21 c.4 lett. a"],
  TD25: ["Deferred Invoice", "fattura differita art.21 c.4 terzo periodo lett. b"],
  TD26: ["Depreciable Goods Sale", "cessione di beni ammortizzabili e passaggi interni"],
  TD27: ["Self-Consumption Invoice", "fattura per autoconsumo o cessioni gratuite senza rivalsa"],
  TD28: ["San Marino Purchase With VAT", "acquisti da San Marino con IVA"],
  TD29: ["Missing Invoice Report", "comunicazione per omessa o irregolare fatturazione"],
}

export interface FatturaParty {
  name: string
  vat: string
  address: string[]
}

export interface FatturaLine {
  description: string
  quantity: string
  unit: string
  unitPrice: string
  /** Discounts (SC) and surcharges (MG) the line states. */
  adjustments: { kind: string; percent: string; amount: string }[]
  vatRate: string
  /** The exemption code (N6.3 and the like) when the rate is 0. */
  natura: string
  amount: string
}

export interface FatturaPA {
  format: string
  docType: string
  number: string
  date: string
  currency: string
  /** ImportoTotaleDocumento; when the XML omits it, the stated taxable amounts plus the stated VAT. */
  total: string
  /** False when the XML omits ImportoTotaleDocumento and `total` is derived from the stated amounts. */
  totalStated: boolean
  notes: string[]
  /** DatiRitenuta, each as stated. */
  withholding: { type: string; rate: string; amount: string }[]
  /** DatiBollo's ImportoBollo, "" when there is none. */
  stampDuty: string
  /** DatiCassaPrevidenziale, each as stated. */
  pensionFunds: { type: string; rate: string; amount: string; taxable: string }[]
  /** The document-level Arrotondamento, "" when there is none. */
  rounding: string
  /** DatiFattureCollegate: the invoices this document refers to (a credit note, the ones it corrects). */
  relatedInvoices: { number: string; date: string }[]
  /** Allegati: embedded files. `data` is the base64 as stated, whitespace removed; never rendered. */
  attachments: { name: string; format: string; description: string; size: number; data: string }[]
  supplier: FatturaParty
  customer: FatturaParty
  lines: FatturaLine[]
  summary: { vatRate: string; natura: string; taxable: string; vat: string; collectability: string; reference: string; rounding: string }[]
  payments: { condition: string; method: string; due: string; amount: string; iban: string }[]
  /** More invoices in the same file; only the first is read. */
  extraDocuments: number
}

/** The direct children of `el` named `name`, whatever their namespace prefix. */
function kids(el: Element | undefined, name: string): Element[] {
  return el ? Array.from(el.children).filter((c) => c.localName === name) : []
}

/** The first element down a path of names. */
function at(el: Element | undefined, ...path: string[]): Element | undefined {
  let cur = el
  for (const name of path) cur = kids(cur, name)[0]
  return cur
}

/** The trimmed text down a path, or "". */
function val(el: Element | undefined, ...path: string[]): string {
  return at(el, ...path)?.textContent?.trim() ?? ""
}

function party(el: Element | undefined): FatturaParty {
  const id = at(el, "DatiAnagrafici")
  const person = [val(id, "Anagrafica", "Nome"), val(id, "Anagrafica", "Cognome")].filter(Boolean).join(" ")
  const country = val(id, "IdFiscaleIVA", "IdPaese")
  const code = val(id, "IdFiscaleIVA", "IdCodice")
  const seat = at(el, "Sede")
  return {
    name: val(id, "Anagrafica", "Denominazione") || person,
    vat: code ? country + code : val(id, "CodiceFiscale"),
    address: [
      [val(seat, "Indirizzo"), val(seat, "NumeroCivico")].filter(Boolean).join(" "),
      [[val(seat, "CAP"), val(seat, "Comune")].filter(Boolean).join(" "), val(seat, "Provincia") && `(${val(seat, "Provincia")})`].filter(Boolean).join(" "),
    ].filter(Boolean),
  }
}

export const sumStated = (values: string[]) => (Math.round(values.reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100).toFixed(2)

export function parseFatturaPA(xml: string): FatturaPA {
  const doc = new DOMParser().parseFromString(xml, "application/xml")
  const root = doc.documentElement
  if (!root || doc.getElementsByTagName("parsererror").length > 0) throw new InvoiceReadError("is not a valid XML file.")
  if (root.localName !== "FatturaElettronica") throw new InvoiceReadError("is not a FatturaPA invoice.")
  const header = kids(root, "FatturaElettronicaHeader")[0]
  const bodies = kids(root, "FatturaElettronicaBody")
  const body = bodies[0]
  if (!header || !body) throw new InvoiceReadError("is not a FatturaPA invoice.")

  const general = at(body, "DatiGenerali", "DatiGeneraliDocumento")
  const goods = at(body, "DatiBeniServizi")
  const summary = kids(goods, "DatiRiepilogo").map((r) => ({
    vatRate: val(r, "AliquotaIVA"),
    natura: val(r, "Natura"),
    taxable: val(r, "ImponibileImporto"),
    vat: val(r, "Imposta"),
    collectability: val(r, "EsigibilitaIVA"),
    reference: val(r, "RiferimentoNormativo"),
    rounding: val(r, "Arrotondamento"),
  }))

  return {
    format: root.getAttribute("versione") ?? "",
    docType: val(general, "TipoDocumento"),
    number: val(general, "Numero"),
    date: val(general, "Data"),
    currency: val(general, "Divisa") || "EUR",
    total: val(general, "ImportoTotaleDocumento") || sumStated([...summary.map((s) => s.taxable), ...summary.map((s) => s.vat)]),
    totalStated: val(general, "ImportoTotaleDocumento") !== "",
    notes: kids(general, "Causale").map((c) => c.textContent?.trim() ?? "").filter(Boolean),
    withholding: kids(general, "DatiRitenuta").map((r) => ({ type: val(r, "TipoRitenuta"), rate: val(r, "AliquotaRitenuta"), amount: val(r, "ImportoRitenuta") })),
    stampDuty: val(general, "DatiBollo", "ImportoBollo"),
    pensionFunds: kids(general, "DatiCassaPrevidenziale").map((c) => ({
      type: val(c, "TipoCassa"),
      rate: val(c, "AlCassa"),
      amount: val(c, "ImportoContributoCassa"),
      taxable: val(c, "ImponibileCassa"),
    })),
    rounding: val(general, "Arrotondamento"),
    relatedInvoices: kids(at(body, "DatiGenerali"), "DatiFattureCollegate").map((d) => ({ number: val(d, "IdDocumento"), date: val(d, "Data") })),
    attachments: kids(body, "Allegati").map((a) => {
      const data = val(a, "Attachment").replace(/\s+/g, "")
      return {
        name: val(a, "NomeAttachment"),
        format: val(a, "FormatoAttachment"),
        description: val(a, "DescrizioneAttachment"),
        size: Math.floor((data.replace(/=+$/, "").length * 3) / 4),
        data,
      }
    }),
    supplier: party(at(header, "CedentePrestatore")),
    customer: party(at(header, "CessionarioCommittente")),
    lines: kids(goods, "DettaglioLinee").map((l) => ({
      description: val(l, "Descrizione"),
      quantity: val(l, "Quantita"),
      unit: val(l, "UnitaMisura"),
      unitPrice: val(l, "PrezzoUnitario"),
      adjustments: kids(l, "ScontoMaggiorazione").map((s) => ({ kind: val(s, "Tipo"), percent: val(s, "Percentuale"), amount: val(s, "Importo") })),
      vatRate: val(l, "AliquotaIVA"),
      natura: val(l, "Natura"),
      amount: val(l, "PrezzoTotale"),
    })),
    summary,
    payments: kids(body, "DatiPagamento").flatMap((p) =>
      kids(p, "DettaglioPagamento").map((d) => ({
        condition: val(p, "CondizioniPagamento"),
        method: val(d, "ModalitaPagamento"),
        due: val(d, "DataScadenzaPagamento"),
        amount: val(d, "ImportoPagamento"),
        iban: val(d, "IBAN"),
      })),
    ),
    extraDocuments: bodies.length - 1,
  }
}

/** The invoice a stored file holds: the XML as it is, or the XML inside a signed .p7m. */
export function readInvoiceBytes(bytes: Uint8Array, kind: InvoiceFileKind): FatturaPA {
  if (kind === "pdf") throw new InvoiceReadError("is a PDF, not a FatturaPA XML.")
  const xml = kind === "p7m" ? unwrapP7m(bytes) : bytes
  return parseFatturaPA(decodeXml(xml))
}

/** The XML text: a UTF-8 byte order mark dropped, the encoding the declaration names (UTF-8 when it names none or an unknown one). */
function decodeXml(bytes: Uint8Array): string {
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes
  const head = new TextDecoder("latin1").decode(body.subarray(0, 200))
  const label = /^\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/.exec(head)?.[1]
  try {
    return new TextDecoder(label ?? "utf-8").decode(body)
  } catch {
    return new TextDecoder().decode(body)
  }
}

/** An attachment's file name made safe to save under: no path, no characters a file system refuses. */
export function attachmentFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ""
   
  const safe = base.replace(/[:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim()
  return safe || "attachment"
}

/** The bytes of an embedded attachment, decoded from its base64 when asked. */
export function attachmentBlob(a: { data: string }): Blob {
  try {
    const raw = atob(a.data)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return new Blob([out])
  } catch {
    throw new InvoiceReadError("has an attachment that is not valid base64.")
  }
}
