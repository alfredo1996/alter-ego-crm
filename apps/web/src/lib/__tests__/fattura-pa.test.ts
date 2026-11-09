import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { attachmentBlob, attachmentFileName, DOC_TYPES, InvoiceReadError, parseFatturaPA, readInvoiceBytes, unwrapP7m } from "@/lib/fattura-pa"

const fixture = (name: string) => new Uint8Array(readFileSync(`src/lib/__tests__/fixtures/fattura-pa/${name}`))
const xml = (name: string) => readFileSync(`src/lib/__tests__/fixtures/fattura-pa/${name}`, "utf8")

describe("parseFatturaPA", () => {
  it("reads the parties, the document, several lines, two VAT rates and the payment as the XML states them", () => {
    const f = parseFatturaPA(xml("standard.xml"))
    expect(f).toMatchObject({
      format: "FPR12",
      docType: "TD01",
      number: "112/2026",
      date: "2026-09-30",
      currency: "EUR",
      total: "1354.60",
      notes: ["Servizi del terzo trimestre"],
      supplier: { name: "Studio Esempio S.r.l.", vat: "IT09999999990", address: ["Via Inventata 10", "40100 Bologna (BO)"] },
      customer: { name: "Cliente Prova S.r.l.", vat: "IT09999999991" },
      extraDocuments: 0,
    })
    expect(f.lines).toEqual([
      { description: "Tenuta contabilita luglio-settembre", quantity: "3.00", unit: "mese", unitPrice: "250.00", adjustments: [], vatRate: "22.00", natura: "", amount: "750.00" },
      { description: "Consulenza straordinaria", quantity: "1.00", unit: "", unitPrice: "200.00", adjustments: [{ kind: "SC", percent: "10.00", amount: "" }], vatRate: "22.00", natura: "", amount: "180.00" },
      { description: "Libri e pubblicazioni", quantity: "2.00", unit: "", unitPrice: "100.00", adjustments: [], vatRate: "10.00", natura: "", amount: "200.00" },
    ])
    expect(f.summary).toEqual([
      { vatRate: "22.00", natura: "", taxable: "930.00", vat: "204.60", collectability: "I", reference: "", rounding: "" },
      { vatRate: "10.00", natura: "", taxable: "200.00", vat: "20.00", collectability: "I", reference: "", rounding: "" },
    ])
    expect(f.payments).toEqual([{ condition: "TP02", method: "MP05", due: "2026-10-30", amount: "1354.60", iban: "IT00X0000000000000000000000" }])
  })

  it("keeps a reverse-charge Natura on the line and the summary, takes a person's name, and needs no prefix", () => {
    const f = parseFatturaPA(xml("reverse-charge.xml"))
    expect(f.format).toBe("FPA12")
    expect(f.supplier.name).toBe("Mario Inventato")
    expect(f.lines[0]).toMatchObject({ vatRate: "0.00", natura: "N6.3" })
    expect(f.summary).toEqual([
      { vatRate: "0.00", natura: "N6.3", taxable: "1000.00", vat: "0.00", collectability: "I", reference: "Inversione contabile art. 17", rounding: "" },
    ])
    // The XML states no total: it is the sum of the stated taxable and VAT, never a computed tax.
    expect(f.total).toBe("1000.00")
    expect(f.payments).toEqual([])
  })

  it("reads a TD04 credit note under another namespace prefix, and a customer known by tax code only", () => {
    const f = parseFatturaPA(xml("credit-note.xml"))
    expect(f).toMatchObject({ docType: "TD04", number: "NC-3", total: "122.00", supplier: { name: "Forniture Prova S.p.A." } })
    expect(f.customer.vat).toBe("RSSMRA80A01H501X")
  })

  it("states the withholding, stamp duty, pension fund, rounding, the invoices a credit note corrects and the attachments as the XML does", () => {
    const f = parseFatturaPA(xml("stated-rows.xml"))
    expect(f.withholding).toEqual([{ type: "RT01", rate: "20.00", amount: "40.00" }])
    expect(f.stampDuty).toBe("2.00")
    expect(f.pensionFunds).toEqual([{ type: "TC22", rate: "4.00", amount: "8.00", taxable: "200.00" }])
    expect(f.rounding).toBe("0.01")
    expect(f.summary[0]!.rounding).toBe("-0.01")
    expect(f.relatedInvoices).toEqual([{ number: "112/2026", date: "2026-09-30" }, { number: "113/2026", date: "" }])
    expect(f.attachments.map(({ name, format, description, size }) => ({ name, format, description, size }))).toEqual([
      { name: "../nota:1.txt", format: "TXT", description: "Dettaglio", size: 16 },
      { name: "conferma.pdf", format: "", description: "", size: 15 },
    ])
    expect(f.totalStated).toBe(true)
  })

  it("says the total is derived when the XML omits it", () => {
    expect(parseFatturaPA(xml("reverse-charge.xml")).totalStated).toBe(false)
  })

  it("rebuilds an attachment's bytes from its base64, wrapped lines included", async () => {
    const [txt, pdf] = parseFatturaPA(xml("stated-rows.xml")).attachments
    expect(await attachmentBlob(txt!).text()).toBe("hello attachment")
    expect(await attachmentBlob(pdf!).text()).toBe("%PDF-1.4\n%%EOF\n")
  })

  it.each([
    ["../nota:1.txt", "nota_1.txt"],
    ["a/b\\c.pdf", "c.pdf"],
    ["..", "attachment"],
    ["", "attachment"],
    ["fattura\u0000.xml", "fattura_.xml"],
  ])("saves the attachment %j as %j", (name, safe) => {
    expect(attachmentFileName(name)).toBe(safe)
  })

  it("names every current document type, the integration and deferred ones too", () => {
    for (const code of ["TD01", "TD07", "TD16", "TD17", "TD18", "TD19", "TD20", "TD24", "TD25", "TD26", "TD27", "TD28", "TD29"]) {
      expect(DOC_TYPES[code], code).toBeDefined()
    }
    expect(DOC_TYPES.TD17![0]).toBe("Self-Invoice for Foreign Services")
    expect(DOC_TYPES.TD24![0]).toBe("Deferred Invoice")
  })

  it("keeps markup in a value as plain text", () => {
    const f = parseFatturaPA(xml("injection.xml"))
    expect(f.supplier.name).toBe("<img src=x onerror=alert(1)> Evil S.r.l.")
    expect(f.lines[0]!.description).toBe("<script>window.__pwned = true</script><b>bold</b>")
  })

  it.each([
    ["not XML at all", "hello", "is not a valid XML file."],
    ["XML that is not a FatturaPA", "<html><body/></html>", "is not a FatturaPA invoice."],
    ["a FatturaPA with no body", "<FatturaElettronica versione=\"FPR12\"><FatturaElettronicaHeader/></FatturaElettronica>", "is not a FatturaPA invoice."],
  ])("raises a readable error for %s", (_, input, reason) => {
    expect(() => parseFatturaPA(input)).toThrow(new InvoiceReadError(reason))
  })
})


/** A DER/BER element; `indefinite` makes a constructed element of indefinite length (the form openssl -stream writes). */
function der(tag: number, content: Uint8Array | Uint8Array[], indefinite = false): Uint8Array {
  const body = Array.isArray(content) ? Uint8Array.from(content.flatMap((c) => [...c])) : content
  if (indefinite) return Uint8Array.from([tag, 0x80, ...body, 0, 0])
  const n = body.length
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]
  return Uint8Array.from([tag, ...len, ...body])
}
const OID = der(0x06, Uint8Array.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]))
/** ContentInfo { OID, [0] { SignedData { version, digests, encapContentInfo { OID, [0] { content } } } } } around an eContent element. */
const envelope = (content: Uint8Array) =>
  der(0x30, [OID, der(0xa0, der(0x30, [der(0x02, Uint8Array.from([1])), der(0x31, new Uint8Array()), der(0x30, [OID, der(0xa0, content)])]))])

describe("unwrapP7m", () => {
  const original = new Uint8Array(readFileSync("src/lib/__tests__/fixtures/fattura-pa/standard.xml"))

  it.each([
    ["an unchunked envelope", "standard.xml.p7m"],
    ["a chunked (-stream) envelope", "standard-stream.xml.p7m"],
    ["an envelope saved as base64 text", "standard-base64.xml.p7m"],
  ])("returns the signed XML byte for byte from %s", (_, name) => {
    expect(Buffer.from(unwrapP7m(fixture(name))).equals(Buffer.from(original))).toBe(true)
  })

  it("joins every chunk of a constructed OCTET STRING", () => {
    const parts = ["<a>one", "-two", "-three</a>"].map((p) => der(0x04, new TextEncoder().encode(p)))
    const env = envelope(der(0x24, parts, true))
    expect(parts.length).toBeGreaterThan(1)
    expect(new TextDecoder().decode(unwrapP7m(env))).toBe("<a>one-two-three</a>")
  })

  it("unwraps a file signed twice down to the XML", () => {
    const inner = envelope(der(0x04, original))
    const twice = envelope(der(0x04, inner))
    expect(Buffer.from(unwrapP7m(twice)).equals(Buffer.from(original))).toBe(true)
  })

  it("raises a readable error when there is no envelope", () => {
    expect(() => unwrapP7m(new TextEncoder().encode("not a signature"))).toThrow(
      new InvoiceReadError("has no FatturaPA XML inside the signature."),
    )
  })

  it("raises a readable error for a truncated envelope", () => {
    expect(() => unwrapP7m(fixture("standard.xml.p7m").slice(0, 300))).toThrow(InvoiceReadError)
  })
})

describe("readInvoiceBytes", () => {
  it("refuses a PDF in words", () => {
    expect(() => readInvoiceBytes(new Uint8Array(), "pdf")).toThrow(new InvoiceReadError("is a PDF, not a FatturaPA XML."))
  })

  const withText = (declared: string, text: string) =>
    `<?xml version="1.0" encoding="${declared}"?><FatturaElettronica><FatturaElettronicaHeader/><FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><Causale>${text}</Causale></DatiGeneraliDocumento></DatiGenerali></FatturaElettronicaBody></FatturaElettronica>`
  const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

  it("decodes the encoding the file declares", () => {
    expect(readInvoiceBytes(latin1(withText("ISO-8859-1", "Perché è già così")), "xml").notes).toEqual(["Perché è già così"])
  })

  it("reads a file that starts with a UTF-8 byte order mark, declared encoding or not", () => {
    const bom = [0xef, 0xbb, 0xbf]
    const utf8 = new TextEncoder().encode(withText("UTF-8", "Perché"))
    expect(readInvoiceBytes(Uint8Array.from([...bom, ...utf8]), "xml").notes).toEqual(["Perché"])
    const latin = latin1(withText("windows-1252", "Perché"))
    expect(readInvoiceBytes(Uint8Array.from([...bom, ...latin]), "xml").notes).toEqual(["Perché"])
  })

  it("falls back to UTF-8 for a label it does not know", () => {
    expect(readInvoiceBytes(new TextEncoder().encode(withText("klingon", "Perché")), "xml").notes).toEqual(["Perché"])
  })
})
