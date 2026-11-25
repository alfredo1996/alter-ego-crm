import { describe, it, expect } from "vitest"

import {
  parseMoneyManagerCSV,
  parseDDMMYYYY,
  isMoneyManagerFormat,
  inferAccountType,
  normalizeAccountName,
  matchAccountName,
  matchCategoryName,
  computeMMImportHash,
  computeMMImportHashes,
  resolveLedger,
} from "../money-manager-import"

// ─── Sample MM export (TSV, 11 columns, 20 data rows) ──────────────────────────
// Transfers appear as symmetric pairs (ingresso + uscita).
// The parser should keep only uscita rows and skip ingresso ones.

const SAMPLE_TSV = [
  "Periodo\tConto\tCategoria\tSotto-categoria\tNota\tEUR\tGuadagni/Spese\tDescrizione\tImporto\tValuta\tConto",
  "08/03/2026\tConto in banca\tAbbonamento Telefonico\t\tSpotify\t18\tSpese\t\t18\tEUR\t18",
  "06/03/2026\tPrestiti\tPortafoglio\t\tSoldi Alice\t250\tTrasferimento ingresso\tMancano 750\t250\tEUR\t250",
  "06/03/2026\tPortafoglio\tPrestiti\t\tSoldi Alice\t250\tTrasferimento uscita\tMancano 750\t250\tEUR\t250",
  "06/03/2026\tPrestiti\tConto in banca\t\tSoldi Bob\t300\tTrasferimento ingresso\tMancano 600\t300\tEUR\t300",
  "06/03/2026\tConto in banca\tPrestiti\t\tSoldi Bob\t300\tTrasferimento uscita\tMancano 600\t300\tEUR\t300",
  "06/03/2026\tCarta Visa\tSpese Periodiche\t\tPalestra\t35\tSpese\tAbbonamento Gymclub\t35\tEUR\t35",
  "01/03/2026\tConto in banca\tSpese aziendali\t\tRate IPhone\t29\tTrasferimento uscita\tDa scalare a Acme\t29\tEUR\t29",
  "01/03/2026\tSpese aziendali\tConto in banca\t\tRate IPhone\t29\tTrasferimento ingresso\tDa scalare a Acme\t29\tEUR\t29",
  "01/03/2026\tConto in banca\tAltro\t\tBanca iscrizione\t7\tSpese\tCarta di credito\t7\tEUR\t7",
  "28/02/2026\tConto in banca\tMacchina\t\tRata Macchina\t412,37\tSpese\tRata Auto Utilitaria\t412,37\tEUR\t412,37",
  "25/02/2026\tCarta Visa\tCibo\t\tCaffè\t4,3\tSpese\t\t4,3\tEUR\t4,3",
  "24/02/2026\tCarta Visa\tRegali\t\tRegalo Alice\t62,40\tSpese\tRegalo compleanno\t62,40\tEUR\t62,40",
  "24/02/2026\tCarta Visa\tCibo\t\tMerenda\t9,6\tSpese\tMerenda con amici\t9,6\tEUR\t9,6",
  "23/02/2026\tPrestiti\tCarta Visa\t\tSoldi benzina\t41,25\tTrasferimento ingresso\t\t41,25\tEUR\t41,25",
  "23/02/2026\tCarta Visa\tPrestiti\t\tSoldi benzina\t41,25\tTrasferimento uscita\t\t41,25\tEUR\t41,25",
  "23/02/2026\tConto in banca\tPrestiti\t\tSoldi prestito\t120\tTrasferimento ingresso\tCarl e Dana saldato\t120\tEUR\t120",
  "23/02/2026\tPrestiti\tConto in banca\t\tSoldi prestito\t120\tTrasferimento uscita\tCarl e Dana saldato\t120\tEUR\t120",
  "23/02/2026\tConto in banca\tSpese aziendali\t\tRimborso spese\t88,5\tTrasferimento ingresso\t\t88,5\tEUR\t88,5",
  "23/02/2026\tSpese aziendali\tConto in banca\t\tRimborso spese\t88,5\tTrasferimento uscita\t\t88,5\tEUR\t88,5",
  "23/02/2026\tConto in banca\tStipendio\t\tStipendio Febbraio\t1850,25\tIn\t\t1850,25\tEUR\t1850,25",
].join("\n")

// How many rows after dropping ingresso? 20 total - 6 ingresso = 14 uscita/expense/income rows
const EXPECTED_ROWS = 14
const EXPECTED_INGRESSO = 6

// ─── isMoneyManagerFormat ─────────────────────────────────────────────────────

describe("isMoneyManagerFormat", () => {
  it("accepts real MM headers (11 cols)", () => {
    expect(
      isMoneyManagerFormat([
        "Periodo", "Conto", "Categoria", "Sotto-categoria", "Nota",
        "EUR", "Guadagni/Spese", "Descrizione", "Importo", "Valuta", "Conto",
      ])
    ).toBe(true)
  })

  it("rejects too few columns", () => {
    expect(isMoneyManagerFormat(["Periodo", "Conto"])).toBe(false)
  })

  it("rejects English headers", () => {
    expect(
      isMoneyManagerFormat(["Date", "Account", "Category", "Sub", "Note", "EUR", "Type", "Desc"])
    ).toBe(false)
  })

  it("is case-insensitive", () => {
    expect(
      isMoneyManagerFormat([
        "periodo", "conto", "categoria", "sotto-categoria", "nota",
        "eur", "guadagni/spese", "descrizione", "importo", "valuta", "conto",
      ])
    ).toBe(true)
  })
})

// ─── parseMoneyManagerCSV ─────────────────────────────────────────────────────

describe("parseMoneyManagerCSV", () => {
  it("parses the expected number of rows (ingresso rows skipped)", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    expect(result.errors).toHaveLength(0)
    expect(result.rows).toHaveLength(EXPECTED_ROWS)
  })

  it("reports skipped ingresso count", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    expect(result.skippedIngresso).toBe(EXPECTED_INGRESSO)
  })

  it("maps Spese → expense", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    const spotify = result.rows.find((r) => r.description === "Spotify")
    expect(spotify?.type).toBe("expense")
  })

  it("maps In → income", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    const salary = result.rows.find((r) => r.description === "Stipendio Febbraio")
    expect(salary?.type).toBe("income")
  })

  it("maps Trasferimento uscita → transfer", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    const transfer = result.rows.find(
      (r) => r.description === "Soldi Alice" && r.type === "transfer"
    )
    expect(transfer).toBeDefined()
  })

  it("does NOT include Trasferimento ingresso rows", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    // In the raw data, ingresso rows have Conto=dest, Categoria=source
    // e.g., Conto=Prestiti, Categoria=Portafoglio for "Soldi Alice" ingresso
    // If parser were keeping ingresso, we'd find Prestiti as source for Soldi Alice
    const ingressoLeaks = result.rows.filter(
      (r) => r.description === "Soldi Alice" && r.accountName === "Prestiti"
    )
    expect(ingressoLeaks).toHaveLength(0)
  })

  it("parses DD/MM/YYYY dates correctly", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    const row = result.rows[0] // 08/03/2026
    expect(row.date.getFullYear()).toBe(2026)
    expect(row.date.getMonth()).toBe(2) // March = 0-indexed
    expect(row.date.getDate()).toBe(8)
  })

  it("accepts dates with a time suffix (newer exports)", () => {
    const csv = [
      "Periodo;Conto;Categoria;Sotto-categoria;Nota;EUR;Guadagni/Spese;Descrizione;Importo;Valuta;Conto",
      "04/09/2026 16:05:48;Revolut;Cibo;;Caffè;4,3;Spese;;4,3;EUR;4,3",
    ].join("\n")
    const result = parseMoneyManagerCSV(csv)
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].date).toEqual(new Date(2026, 8, 4))
  })

  it("parses comma-decimal amounts", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    const car = result.rows.find((r) => r.description === "Rata Macchina")
    expect(car?.amount).toBe(412.37)
  })

  it("parses amounts with comma and single decimal", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    const coffee = result.rows.find((r) => r.description === "Caffè")
    expect(coffee?.amount).toBe(4.3)
  })

  it("parses integer amounts", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    const spotify = result.rows.find((r) => r.description === "Spotify")
    expect(spotify?.amount).toBe(18)
  })

  it("reads currency from Valuta column", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    expect(result.rows.every((r) => r.currency === "EUR")).toBe(true)
  })

  it("populates notes from Descrizione column", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    const alice = result.rows.find(
      (r) => r.description === "Soldi Alice" && r.type === "transfer"
    )
    expect(alice?.notes).toBe("Mancano 750")
  })

  it("sets notes to null when Descrizione is empty", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    const coffee = result.rows.find((r) => r.description === "Caffè")
    expect(coffee?.notes).toBeNull()
  })

  it("transfers have categoryName=null", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    const transfers = result.rows.filter((r) => r.type === "transfer")
    expect(transfers.length).toBeGreaterThan(0)
    for (const t of transfers) {
      expect(t.categoryName).toBeNull()
    }
  })

  it("transfers have destAccountName from Categoria column", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    // Uscita row: Portafoglio → Prestiti
    const alice = result.rows.find(
      (r) => r.description === "Soldi Alice" && r.type === "transfer"
    )
    expect(alice?.accountName).toBe("Portafoglio")
    expect(alice?.destAccountName).toBe("Prestiti")
  })

  it("expenses have categoryName and destAccountName=null", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    const spotify = result.rows.find((r) => r.description === "Spotify")
    expect(spotify?.categoryName).toBe("Abbonamento Telefonico")
    expect(spotify?.destAccountName).toBeNull()
  })

  it("extracts unique account names (including dest accounts)", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    // Conto in banca, Portafoglio, Carta Visa, Prestiti, Spese aziendali
    expect(result.accountNames.length).toBeGreaterThanOrEqual(5)
    expect(result.accountNames).toContain("prestiti")
    expect(result.accountNames).toContain("portafoglio")
  })

  it("extracts category names only from non-transfer rows", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    expect(result.categoryNames.length).toBeGreaterThan(0)
    // Transfers use Categoria column for dest account, not category
    // "Prestiti" is a dest account, not a category
    expect(result.categoryNames).not.toContain("Prestiti")
    // "Cibo" is an actual category
    expect(result.categoryNames).toContain("Cibo")
  })

  it("handles empty input", () => {
    const result = parseMoneyManagerCSV("")
    expect(result.rows).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it("handles header-only file", () => {
    const result = parseMoneyManagerCSV(
      "Periodo\tConto\tCategoria\tSotto-categoria\tNota\tEUR\tGuadagni/Spese\tDescrizione\tImporto\tValuta\tConto"
    )
    expect(result.rows).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it("handles wrong format gracefully", () => {
    const result = parseMoneyManagerCSV("Date\tAmount\tDescription\n2026-01-01\t10\tCoffee")
    expect(result.rows).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
  })

  it("returns errors for invalid date", () => {
    const bad = [
      "Periodo\tConto\tCategoria\tSotto-categoria\tNota\tEUR\tGuadagni/Spese\tDescrizione\tImporto\tValuta\tConto",
      "not-a-date\tConto in banca\tCibo\t\tTest\t10\tSpese\t\t10\tEUR\t10",
    ].join("\n")
    const result = parseMoneyManagerCSV(bad)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/invalid date/i)
  })

  it("returns errors for unknown type", () => {
    const bad = [
      "Periodo\tConto\tCategoria\tSotto-categoria\tNota\tEUR\tGuadagni/Spese\tDescrizione\tImporto\tValuta\tConto",
      "08/03/2026\tConto in banca\tCibo\t\tTest\t7\tUnknown\t\t7\tEUR\t7",
    ].join("\n")
    const result = parseMoneyManagerCSV(bad)
    expect(result.errors).toHaveLength(1)
  })

  it("returns errors for zero amount", () => {
    const bad = [
      "Periodo\tConto\tCategoria\tSotto-categoria\tNota\tEUR\tGuadagni/Spese\tDescrizione\tImporto\tValuta\tConto",
      "08/03/2026\tConto in banca\tCibo\t\tTest\t0\tSpese\t\t0\tEUR\t0",
    ].join("\n")
    const result = parseMoneyManagerCSV(bad)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/invalid amount/i)
  })

  it("also accepts comma-separated variant", () => {
    const csv = [
      "Periodo,Conto,Categoria,Sotto-categoria,Nota,EUR,Guadagni/Spese,Descrizione,Importo,Valuta,Conto",
      "08/03/2026,Conto in banca,Cibo,,Caffè,4.3,Spese,,4.3,EUR,4.3",
    ].join("\n")
    const result = parseMoneyManagerCSV(csv)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].amount).toBe(4.3)
  })

  it("also accepts semicolon-separated variant", () => {
    const csv = [
      "Periodo;Conto;Categoria;Sotto-categoria;Nota;EUR;Guadagni/Spese;Descrizione;Importo;Valuta;Conto",
      "08/03/2026;Conto in banca;Cibo;;Caffè;4,3;Spese;;4,3;EUR;4,3",
    ].join("\n")
    const result = parseMoneyManagerCSV(csv)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].amount).toBe(4.3)
    expect(result.rows[0].description).toBe("Caffè")
    expect(result.rows[0].categoryName).toBe("Cibo")
  })

  it("maps Aumento Saldo as income with excludeFromReports", () => {
    const tsv = [
      "Periodo\tConto\tCategoria\tSotto-categoria\tNota\tEUR\tGuadagni/Spese\tDescrizione\tImporto\tValuta\tConto",
      "08/03/2026\tConto in banca\t\t\tCorrezione saldo\t100\tAumento Saldo\t\t100\tEUR\t100",
    ].join("\n")
    const result = parseMoneyManagerCSV(tsv)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].type).toBe("income")
    expect(result.rows[0].excludeFromReports).toBe(true)
  })

  it("maps Decremento Saldo as expense with excludeFromReports", () => {
    const tsv = [
      "Periodo\tConto\tCategoria\tSotto-categoria\tNota\tEUR\tGuadagni/Spese\tDescrizione\tImporto\tValuta\tConto",
      "08/03/2026\tConto in banca\t\t\tCorrezione\t50\tDecremento Saldo\t\t50\tEUR\t50",
    ].join("\n")
    const result = parseMoneyManagerCSV(tsv)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].type).toBe("expense")
    expect(result.rows[0].excludeFromReports).toBe(true)
  })

  it("normal transactions have excludeFromReports=false", () => {
    const result = parseMoneyManagerCSV(SAMPLE_TSV)
    for (const row of result.rows) {
      expect(row.excludeFromReports).toBe(false)
    }
  })

  it("imports rows with missing Nota as 'Unknown'", () => {
    const tsv = [
      "Periodo\tConto\tCategoria\tSotto-categoria\tNota\tEUR\tGuadagni/Spese\tDescrizione\tImporto\tValuta\tConto",
      "08/03/2026\tConto in banca\tCibo\t\t\t7\tSpese\tSome note\t7\tEUR\t7",
    ].join("\n")
    const result = parseMoneyManagerCSV(tsv)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].description).toBe("Unknown")
    expect(result.errors).toHaveLength(0)
  })

  it("defaults to EUR when Valuta column is missing", () => {
    // 7-col CSV without Valuta
    const csv = [
      "Periodo,Conto,Categoria,Sotto-categoria,Nota,EUR,Guadagni/Spese",
      "08/03/2026,Conto in banca,Cibo,,Caffè,4.3,Spese",
    ].join("\n")
    const result = parseMoneyManagerCSV(csv)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].currency).toBe("EUR")
  })
})

// ─── parseDDMMYYYY ────────────────────────────────────────────────────────────

describe("parseDDMMYYYY", () => {
  it.each([
    ["15/01/2024", new Date(2024, 0, 15)],
    ["04/09/2026 16:05:48", new Date(2026, 8, 4)],
    ["31/02/2024", null],
    ["29/02/2024", new Date(2024, 1, 29)],
    ["29/02/2023", null],
    ["01/13/2024", null],
    ["00/01/2024", null],
    ["2024-01-15", null],
  ])("%s gives %s", (value, expected) => {
    expect(parseDDMMYYYY(value)).toEqual(expected)
  })
})

// ─── inferAccountType ─────────────────────────────────────────────────────────

describe("inferAccountType", () => {
  it("detects checking from 'Conto in banca'", () => {
    expect(inferAccountType("Conto in banca")).toBe("checking")
  })

  it("detects cash from 'Portafoglio'", () => {
    expect(inferAccountType("Portafoglio")).toBe("cash")
  })

  it("detects credit_card from 'Carta Visa'", () => {
    expect(inferAccountType("Carta Visa")).toBe("credit_card")
  })

  it("detects loan from 'Prestiti'", () => {
    expect(inferAccountType("Prestiti")).toBe("loan")
  })

  it("detects checking from 'Revolut'", () => {
    expect(inferAccountType("Revolut")).toBe("checking")
  })

  it("detects other from 'Spese Aziendali'", () => {
    expect(inferAccountType("Spese Aziendali")).toBe("other")
  })

  it("detects savings from 'Risparmio'", () => {
    expect(inferAccountType("Risparmio")).toBe("savings")
  })

  it("falls back to checking for unknown names", () => {
    expect(inferAccountType("My Wallet")).toBe("checking")
  })
})

// ─── normalizeAccountName ─────────────────────────────────────────────────────

describe("normalizeAccountName", () => {
  it("lowercases and trims", () => {
    expect(normalizeAccountName("  Conto In Banca  ")).toBe("conto in banca")
  })

  it("collapses multiple spaces", () => {
    expect(normalizeAccountName("Conto  In   Banca")).toBe("conto in banca")
  })
})

// ─── matchAccountName ─────────────────────────────────────────────────────────

describe("matchAccountName", () => {
  const existing = [
    { id: "acc-1", name: "Conto in banca" },
    { id: "acc-2", name: "Portafoglio" },
  ]

  it("matches case-insensitively", () => {
    expect(matchAccountName("Conto In Banca", existing)).toBe("acc-1")
  })

  it("returns null for no match", () => {
    expect(matchAccountName("Revolut", existing)).toBeNull()
  })
})

// ─── matchCategoryName ────────────────────────────────────────────────────────

describe("matchCategoryName", () => {
  const existing = [
    { id: "cat-1", name: "Food" },
    { id: "cat-2", name: "Abbonamento Telefonico" },
  ]

  it("matches exactly (case-insensitive)", () => {
    expect(matchCategoryName("ABBONAMENTO TELEFONICO", existing)).toBe("cat-2")
  })

  it("returns null for no match", () => {
    expect(matchCategoryName("Macchina", existing)).toBeNull()
  })
})

// ─── resolveLedger ────────────────────────────────────────────────────────────

describe("resolveLedger", () => {
  const ids = new Map([["conto in banca", "bank"], ["prestiti", "loans"]])
  const transfer = (accountName: string, destAccountName: string | null) =>
    ({ accountName, destAccountName, type: "transfer" as const })

  it("keeps a transfer between two imported accounts", () => {
    expect(resolveLedger(transfer("Conto in banca", "Prestiti"), ids))
      .toEqual({ accountId: "bank", type: "transfer", transferToAccountId: "loans" })
  })

  it("turns a transfer to an untracked account into an expense on the source", () => {
    expect(resolveLedger(transfer("Conto in banca", "Nexo Credit Card"), ids))
      .toEqual({ accountId: "bank", type: "expense", transferToAccountId: null })
  })

  it("turns a transfer from an untracked account into income on the destination", () => {
    expect(resolveLedger(transfer("Nexo Credit Card", "Prestiti"), ids))
      .toEqual({ accountId: "loans", type: "income", transferToAccountId: null })
  })

  it("skips rows that touch no imported account", () => {
    expect(resolveLedger(transfer("Nexo", "Nexo Credit Card"), ids)).toBeNull()
    expect(resolveLedger({ accountName: "Nexo", destAccountName: null, type: "expense" }, ids)).toBeNull()
  })

  it("skips a transfer whose two sides map to the same account", () => {
    expect(resolveLedger(transfer("Conto in banca", "CONTO IN BANCA"), ids)).toBeNull()
  })

  it("keeps expenses and income on an imported account", () => {
    expect(resolveLedger({ accountName: "Prestiti", destAccountName: null, type: "income" }, ids))
      .toEqual({ accountId: "loans", type: "income", transferToAccountId: null })
  })
})

// ─── computeMMImportHashes ────────────────────────────────────────────────────

describe("computeMMImportHashes", () => {
  it("gives identical rows distinct hashes, the first matching the plain hash", async () => {
    const result = parseMoneyManagerCSV([
      "Periodo,Conto,Categoria,Sotto-categoria,Nota,EUR,Guadagni/Spese,Descrizione,Importo,Valuta,Conto",
      "17/04/2022,Portafoglio,Regali,,Regalo,15,Spese,Refri,15,EUR,15",
      "17/04/2022,Portafoglio,Regali,,Regalo,15,Spese,Refri,15,EUR,15",
    ].join("\n"))
    const [first, second] = await computeMMImportHashes(result.rows)
    expect(first).not.toBe(second)
    expect(first).toBe(await computeMMImportHash("Portafoglio", result.rows[0].date, 15, "Regalo"))
  })
})

// ─── computeMMImportHash ──────────────────────────────────────────────────────

describe("computeMMImportHash", () => {
  it("is deterministic — same inputs produce same hash", async () => {
    const date = new Date(2026, 2, 8)
    const h1 = await computeMMImportHash("Conto in banca", date, 18.0, "Spotify")
    const h2 = await computeMMImportHash("Conto in banca", date, 18.0, "Spotify")
    expect(h1).toBe(h2)
  })

  it("is case-insensitive for account name", async () => {
    const date = new Date(2026, 2, 8)
    const h1 = await computeMMImportHash("Conto in banca", date, 18.0, "Spotify")
    const h2 = await computeMMImportHash("CONTO IN BANCA", date, 18.0, "Spotify")
    expect(h1).toBe(h2)
  })

  it("differs for different descriptions", async () => {
    const date = new Date(2026, 2, 8)
    const h1 = await computeMMImportHash("Conto in banca", date, 18.0, "Spotify")
    const h2 = await computeMMImportHash("Conto in banca", date, 18.0, "Netflix")
    expect(h1).not.toBe(h2)
  })

  it("differs for different amounts", async () => {
    const date = new Date(2026, 2, 8)
    const h1 = await computeMMImportHash("Conto in banca", date, 18.0, "Spotify")
    const h2 = await computeMMImportHash("Conto in banca", date, 19.0, "Spotify")
    expect(h1).not.toBe(h2)
  })

  it("differs for different dates", async () => {
    const d1 = new Date(2026, 2, 8)
    const d2 = new Date(2026, 2, 9)
    const h1 = await computeMMImportHash("Conto in banca", d1, 18.0, "Spotify")
    const h2 = await computeMMImportHash("Conto in banca", d2, 18.0, "Spotify")
    expect(h1).not.toBe(h2)
  })

  it("produces a 64-char hex string", async () => {
    const date = new Date(2026, 2, 8)
    const hash = await computeMMImportHash("conto in banca", date, 18.0, "spotify")
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
