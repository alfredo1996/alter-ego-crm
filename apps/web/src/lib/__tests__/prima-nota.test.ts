/**
 * The workbook import on synthetic workbooks only (helpers/prima-nota-workbook):
 * detection and its errors, the three date rules, every row kind of the plan's
 * mapping table, invoice reconciliation (a)–(e), credit-note chains, the
 * platform payout, split rows, the pre-check against the app, overlaps,
 * estimate links and the acceptance check.
 */
import { describe, expect, it } from "vitest"

import { primaNotaWorkbook, SYNTHETIC_BOOK, type Book, type BookRow } from "@/lib/__tests__/helpers/prima-nota-workbook"
import { NON_CASH } from "@/lib/cash-book"
import { detect, matchCollaborator, NO_CHOICES, planImport, planUndo, PrimaNotaError, suggestCategory, type AppData, type Choices, type ImportPlan, type Write } from "@/lib/prima-nota"
import { readXlsx } from "@/lib/xlsx"

import type { Assignment, Collaborator, CompanyAccount, CompanyExpense, CompanyLoan, CompanyMovement, Invoice } from "@/types"

const stamp = { userId: "u", createdAt: new Date(2026, 0, 1), updatedAt: new Date(2026, 0, 1) }
const d = (day: string) => new Date(`${day}T00:00:00`)
const invoice = (o: Partial<Invoice> & Pick<Invoice, "id" | "number" | "amount" | "vat" | "clientId">): Invoice => ({
  engagementId: null, fromMonth: null, yearMonth: "2026-06", dueDate: null, paidDate: null, paidAccountId: null, ...stamp, ...o,
})
const expense = (o: Partial<CompanyExpense> & Pick<CompanyExpense, "id" | "description" | "amount">): CompanyExpense => ({
  category: "other", date: d("2026-05-20"), isRecurring: false, recurrenceMonths: null, notes: null, accountId: null, paidByOwner: false,
  vat: null, documentRef: null, project: null, recurringExpenseId: null, dateEstimated: false, importRef: null, collaboratorId: null, engagementId: null, forMonth: null, ...stamp, ...o,
})
const loan = (o: Partial<CompanyLoan> & Pick<CompanyLoan, "id" | "direction" | "amount">): CompanyLoan => ({
  description: "Loan", date: d("2026-05-25"), notes: null, accountId: null, dateEstimated: false, importRef: null, ...stamp, ...o,
})

const INVOICES = [
  invoice({ id: "i1", clientId: "c1", number: "101/2026", amount: 1000, vat: 220 }),
  invoice({ id: "i2", clientId: "c2", number: "102/2026", amount: 2000, vat: 0 }),
  invoice({ id: "cn2", clientId: "c2", number: "NC 101/2026", amount: -2000, vat: 0 }),
  invoice({ id: "i3", clientId: "c2", number: "103/2026", amount: 2000, vat: 0 }),
  invoice({ id: "i5", clientId: "c1", number: "2026/105", amount: 500, vat: 110, yearMonth: "2026-07" }),
]
const app = (o: Partial<AppData> = {}): AppData => ({
  accounts: [],
  invoices: INVOICES,
  expenses: [],
  loans: [],
  movements: [],
  clients: [
    { id: "c1", name: "Acme Ltd" },
    { id: "c2", name: "Beta Srl" },
    { id: "c3", name: "Gamma Spa" },
  ],
  clientOf: (i) => i.clientId,
  ...o,
})

const read = async (book: Book = SYNTHETIC_BOOK) => detect((await readXlsx(primaNotaWorkbook(book))).sheets)
const withRows = (month: string, rows: BookRow[], book: Book = SYNTHETIC_BOOK): Book => ({
  ...book,
  months: book.months.map((m) => (m.name === month ? { ...m, rows } : m)),
})
/** The writes of a workbook row, split parts included. */
const of = (plan: ImportPlan, ref: string) => plan.writes.filter((w) => "ref" in w && w.ref?.replace(/[a-z]+$/, "") === ref)
const ops = (plan: ImportPlan, ref: string) => of(plan, ref).map((w) => w.op)
const input = (w: Write | undefined) => (w && "input" in w ? (w.input as unknown as Record<string, unknown>) : {})
const MAIN = "new-account:0"
const SECOND = "new-account:1"

/** Every review item decided: the suggestion, or the given decision. */
const decideAll = (plan: ImportPlan, own: Choices["decisions"] = {}): Choices => ({
  decisions: Object.fromEntries(
    plan.review.map((i) => [i.id, own[i.id] ?? { option: i.suggested, parts: i.parts, clientId: i.invoice?.clientId ?? undefined, gross: i.gross ?? undefined, invoiceId: i.invoiceId }]),
  ),
  keep: [],
  estimates: {},
})

describe("detect", () => {
  it("reads the accounts from the headers, the Saldo by prefix, the cost centre and every row", async () => {
    const wb = await read()
    expect(wb.accounts.map((a) => [a.name, a.statementDay])).toEqual([
      ["Main Bank", "2026-08-05"],
      ["Second Bank", "2026-08-05"],
    ])
    expect(wb.year).toBe(2026)
    expect(wb.openingDay).toBe("2026-05-01")
    expect(wb.project).toBe("Via Esempio")
    expect(wb.sheets).toEqual([
      { name: "Maggio", ym: "2026-05", rows: 7 },
      { name: "Giugno", ym: "2026-06", rows: 13 },
      { name: "Luglio", ym: "2026-07", rows: 21 },
      { name: "Agosto", ym: "2026-08", rows: 2 },
    ])
    expect(wb.empty).toEqual([{ ref: "2026:Luglio!18", where: "Luglio, row 18", description: "Movimento rimosso" }])
    expect(wb.rows.every((r) => r.rejected === null)).toBe(true)
  })

  it("keeps identical rows apart: both loans of the same day and amount", async () => {
    const wb = await read()
    const twins = wb.rows.filter((r) => r.description === "Finanziamento Soci" && r.sheet === "Luglio")
    expect(twins.map((r) => r.ref)).toEqual(["2026:Luglio!19", "2026:Luglio!20"])
  })

  it.each([
    [{ ...SYNTHETIC_BOOK, noSaldo: true }, /No Saldo sheet/],
    [{ ...SYNTHETIC_BOOK, extraSheets: ["Appunti"] }, /Sheet “Appunti” is not a month/],
    [{ ...SYNTHETIC_BOOK, dropHeader: "Note" }, /Maggio, row 1: the column “Note” is missing/],
    [{ ...SYNTHETIC_BOOK, dropHeader: "Uscita Second Bank" }, /the column “Uscita Second Bank” is missing/],
    [{ ...SYNTHETIC_BOOK, saldoNames: ["Main Bank", "Third Bank"] }, /Saldo: no row for the account of the columns Entrata\/Uscita Second Bank/],
  ])("stops on what it would have to guess, naming sheet and column, never a cell", async (book, message) => {
    const sheets = (await readXlsx(primaNotaWorkbook(book))).sheets
    expect(() => detect(sheets)).toThrow(PrimaNotaError)
    expect(() => detect(sheets)).toThrow(message)
    try {
      detect(sheets)
    } catch (e) {
      expect(String(e)).not.toMatch(/Finanziamento|Caparra|Room|Edilfast/)
    }
  })

  it("rejects a row whose Cassa columns disagree, a one-legged transfer and text in an amount", async () => {
    const wb = await read(
      withRows("Agosto", [
        { b: "Wrong total", money: { "Main Bank": -50 }, e: 60 },
        { b: "Half a transfer", money: { "Main Bank": -50 }, transfer: true },
        { b: "Typed", money: { "Main Bank": -10 }, text: { account: "Main Bank", side: "out", value: "dieci" } },
      ]),
    )
    const rejected = wb.rows.filter((r) => r.sheet === "Agosto").map((r) => r.rejected)
    expect(rejected[0]).toMatch(/Uscita di Cassa/)
    expect(rejected[1]).toMatch(/reads as a transfer/)
    expect(rejected[2]).toMatch(/“Uscita Main Bank” is not a number/)
    const plan = planImport(wb, app())
    expect(plan.blockers.join(" ")).toMatch(/3 rows can't be read: Agosto, row 2/)
  })

  it("dates a row from the bank date in its note, then a document date in the sheet's month, else the 1st, estimated", async () => {
    const wb = await read()
    const day = (ref: string) => wb.rows.find((r) => r.ref === ref)!
    // Rule 1, kept outside the sheet's month.
    expect(day("2026:Luglio!17")).toMatchObject({ day: "2026-08-01", dateEstimated: false })
    expect(day("2026:Giugno!6")).toMatchObject({ day: "2026-06-12", dateEstimated: false })
    // A real last day from the bank stays.
    expect(day("2026:Luglio!16")).toMatchObject({ day: "2026-07-31", dateEstimated: false })
    // Rule 2 inside the month only.
    expect(day("2026:Luglio!23")).toMatchObject({ day: "2026-07-10", dateEstimated: false })
    expect(day("2026:Giugno!8")).toMatchObject({ day: "2026-06-01", dateEstimated: true })
    // Rule 3.
    expect(day("2026:Maggio!2")).toMatchObject({ day: "2026-05-01", dateEstimated: true })
    // A document row never takes the payment date its note carries.
    expect(day("2026:Giugno!10")).toMatchObject({ day: "2026-06-01", dateEstimated: true })
    expect(day("2026:Giugno!9")).toMatchObject({ day: "2026-06-01", dateEstimated: true })
  })

  it("stops on a month sheet written after the Saldo, naming it, instead of reading it as last year", async () => {
    const late = { ...SYNTHETIC_BOOK, months: [...SYNTHETIC_BOOK.months, { name: "Settembre", rows: [{ b: "Negozio", money: { "Main Bank": -5 } }] }] }
    const sheets = (await readXlsx(primaNotaWorkbook(late))).sheets
    expect(() => detect(sheets)).toThrow("Sheet Settembre comes after the Saldo date 05/08/2026: update the Saldo sheet to today's balances and choose the file again.")
    // A gap before December is no December-to-January file either.
    const gap = { ...SYNTHETIC_BOOK, saldoDay: "2027-01-10", months: [{ name: "Novembre", rows: [] }, { name: "Gennaio", rows: [] }] }
    const gapSheets = (await readXlsx(primaNotaWorkbook(gap))).sheets
    expect(() => detect(gapSheets)).toThrow(/Sheet Novembre comes after the Saldo date 10\/01\/2027/)
  })

  it("puts a month after the Saldo's in the year before: a file from December to January", async () => {
    const wb = await read({
      accounts: ["Main Bank"],
      project: "Via Esempio",
      saldoDay: "2027-01-10",
      months: [
        { name: "Dicembre", rows: [{ b: "Finanziamento Soci", money: { "Main Bank": 100 }, l: "Bonifico ricevuto il 02/01" }] },
        { name: "Gennaio", rows: [{ b: "Commissione", money: { "Main Bank": -5 }, l: "Addebito del 30/12" }] },
      ],
    })
    expect(wb.sheets.map((s) => s.ym)).toEqual(["2026-12", "2027-01"])
    expect(wb.rows.map((r) => [r.ref, r.day])).toEqual([
      ["2026:Dicembre!2", "2027-01-02"],
      ["2027:Gennaio!2", "2026-12-30"],
    ])
  })
})

describe("planImport: what each row becomes", () => {
  it("books every row kind of the mapping table as the screens would", async () => {
    const plan = planImport(await read(), app())
    const one = (ref: string) => input(of(plan, ref)[0])
    // 1 transfer
    expect(one("2026:Maggio!7")).toMatchObject({ kind: "transfer", direction: "out", amount: 1500, accountId: MAIN, toAccountId: SECOND, project: null })
    // 5, 6 loans; the mistaken repayment and its correction both go in.
    expect(one("2026:Maggio!2")).toMatchObject({ direction: "to_company", amount: 5000, accountId: MAIN, dateEstimated: true, importRef: "2026:Maggio!2" })
    expect(one("2026:Maggio!5")).toMatchObject({ direction: "from_company", amount: 500 })
    expect(one("2026:Luglio!14")).toMatchObject({ direction: "from_company", amount: 2000 })
    expect(one("2026:Luglio!15")).toMatchObject({ direction: "to_company", amount: 2000 })
    // 7 capital
    expect(one("2026:Maggio!4")).toMatchObject({ kind: "capital", direction: "in", amount: 1000 })
    // 8 bank fee, missing document
    expect(one("2026:Maggio!3")).toMatchObject({ category: "bank_fees", amount: 20, vat: 0, documentRef: null })
    // 9 caparra
    expect(one("2026:Maggio!8")).toMatchObject({ kind: "deposit_paid", direction: "out", counterparty: "Landlord", project: "Via Esempio" })
    // 10 tenant deposit
    expect(one("2026:Luglio!3")).toMatchObject({ kind: "deposit_held", direction: "in", amount: 700, counterparty: "Room 2", project: "Via Esempio" })
    // 12 tenant income
    expect(one("2026:Luglio!6")).toMatchObject({ kind: "income", amount: 500, project: "Via Esempio", date: d("2026-07-18") })
    expect(one("2026:Luglio!7")).toMatchObject({ kind: "income", amount: 80 })
    // 13 the landlord's rent
    expect(one("2026:Luglio!2")).toMatchObject({ category: "rent", amount: 1500, accountId: SECOND, project: "Via Esempio" })
    // 15 a shop's refund: a negative cost on the account
    expect(one("2026:Luglio!10")).toMatchObject({ amount: -30, accountId: SECOND, documentRef: "NC 55" })
    // 17 a payment on a supplier invoice; 22 the invoice, Not Paid Yet
    expect(one("2026:Giugno!11")).toMatchObject({ kind: "supplier_payment", amount: 1000, expenseId: "doc:2026:Giugno!10", accountId: SECOND })
    expect(of(plan, "2026:Giugno!10")[0]).toMatchObject({ op: "expense", key: "doc:2026:Giugno!10" })
    expect(one("2026:Giugno!10")).toMatchObject({ amount: 3000, documentRef: "SUP-05", project: "Via Esempio" })
    expect(one("2026:Giugno!10").accountId).toBeUndefined()
    // 18 a cost
    expect(one("2026:Maggio!6")).toMatchObject({ category: "other", amount: 200, vat: 0, accountId: MAIN, documentRef: "R-100", project: null })
    expect(one("2026:Luglio!13")).toMatchObject({ category: "accountant", amount: 300 })
    // 21 the owner's card
    expect(one("2026:Giugno!9")).toMatchObject({ paidByOwner: true, amount: 80, category: "travel" })
    expect(one("2026:Giugno!9").accountId).toBeUndefined()
    // 19 an issued invoice, 23 a store credit, a supplier credit note netted: no write of their own.
    for (const ref of ["2026:Giugno!2", "2026:Luglio!21", "2026:Luglio!22", "2026:Giugno!13"]) expect(ops(plan, ref)).toEqual([])
    // 20 a credit note on one of your invoices settles it (below).
    expect(ops(plan, "2026:Giugno!4")).toEqual(["update_invoice", "update_invoice"])
    // 22 netted to 0: not created, reported
    expect(ops(plan, "2026:Giugno!12")).toEqual([])
    expect(plan.report).toMatch(/Giugno, row 12, Edilfast fattura SUP-06, annullata: cancelled by credit note NC SUP-07, not created/)
    expect(plan.report).toMatch(/Luglio, row 22, .*€20.00 with no money on an account, not imported/)
  })

  it("leaves documentRef empty when the note says the document is missing, keeping column C in the notes", async () => {
    const plan = planImport(await read(withRows("Agosto", [{ b: "Negozio", c: "X-1", money: { "Main Bank": -9 }, l: "Fattura da recuperare" }])), app())
    expect(input(of(plan, "2026:Agosto!2")[0])).toMatchObject({ documentRef: null, notes: "Fattura da recuperare · Excel ref: X-1" })
    expect(plan.report).toMatch(/Missing documents\n(- .*\n)*- Agosto, row 2, Negozio \(Excel ref X-1\)/)
  })

  it("asks about the rows that need a decision, and only those", async () => {
    const plan = planImport(await read(), app())
    expect(plan.review.map((i) => [i.id, i.suggested])).toEqual([
      ["2026:Maggio!4", "capital"],
      ["2026:Luglio!4", "split"],
      ["2026:Luglio!5", "split"],
      ["2026:Luglio!8", "split"],
      ["2026:Luglio!9", "cost"],
      ["2026:Luglio!11", "income"],
      ["2026:Luglio!12", "platform_invoice"],
      ["2026:Luglio!14", "loan"],
      ["2026:Luglio!23", "cost"],
    ])
    expect(plan.unresolved).toHaveLength(9)
    expect(plan.review.find((i) => i.id === "2026:Luglio!23")!.why).toMatch(/persona fisica/)
  })

  it("splits a mixed tenant row into signed parts that must add up to the bank amount", async () => {
    const wb = await read()
    const first = planImport(wb, app())
    const item = (id: string) => first.review.find((i) => i.id === id)!
    expect(item("2026:Luglio!4").parts!.map((p) => [p.as, p.amount])).toEqual([["income", 100], ["income", 550]])
    expect(item("2026:Luglio!5").parts!.map((p) => [p.as, p.amount])).toEqual([["income", 100], ["income", 600]])
    // Deposit + rent: the deposit's amount is the owner's to say.
    expect(item("2026:Luglio!8").parts!.map((p) => [p.as, p.amount])).toEqual([["income", 1400], ["deposit_held", 0]])

    const choices = decideAll(first)
    let plan = planImport(wb, app(), choices)
    expect(plan.unresolved).toEqual(["2026:Luglio!8"])
    expect(plan.review.find((i) => i.id === "2026:Luglio!8")!.problem).toBe("Enter every part's amount (none can be 0).")
    choices.decisions["2026:Luglio!8"] = { option: "split", parts: [{ as: "income", amount: 700, description: "Rent" }, { as: "deposit_held", amount: 600, description: "Deposit" }] }
    plan = planImport(wb, app(), choices)
    expect(plan.review.find((i) => i.id === "2026:Luglio!8")!.problem).toBe("The parts add up to €1,300.00, the bank amount is €1,400.00.")
    choices.decisions["2026:Luglio!8"].parts![1].amount = 700
    plan = planImport(wb, app(), choices)
    expect(plan.unresolved).toEqual([])
    expect(of(plan, "2026:Luglio!8").map((w) => [("ref" in w && w.ref) || "", input(w).kind, input(w).amount])).toEqual([
      ["2026:Luglio!8a", "income", 700],
      ["2026:Luglio!8b", "deposit_held", 700],
    ])
    expect(input(of(plan, "2026:Luglio!8")[1])).toMatchObject({ counterparty: "Room 5", project: "Via Esempio" })
  })

  it("books a negative part of a split as money out: a refund deducted from the rent", async () => {
    const wb = await read(withRows("Agosto", [{ b: "Room 6 (affitto + spese agosto, decurtato 120 di rimborso)", money: { "Second Bank": 580 } }]))
    const plan = planImport(wb, app())
    const parts = plan.review.find((i) => i.id === "2026:Agosto!2")!.parts!
    expect(parts.map((p) => [p.as, p.amount])).toEqual([["income", 700], ["cost", -120]])
    const done = planImport(wb, app(), decideAll(plan))
    expect(of(done, "2026:Agosto!2").map((w) => ["ref" in w && w.ref, w.op, input(w).amount, input(w).accountId])).toEqual([
      ["2026:Agosto!2b", "expense", 120, SECOND],
      ["2026:Agosto!2a", "movement", 700, SECOND],
    ])
  })

  it("lets the owner book a row as another kind", async () => {
    const wb = await read()
    const choices = decideAll(planImport(wb, app()), { "2026:Luglio!9": { option: "deposit_held" } })
    const plan = planImport(wb, app(), choices)
    expect(input(of(plan, "2026:Luglio!9")[0])).toMatchObject({ kind: "deposit_held", direction: "out", amount: 40, counterparty: "Room 3" })
  })

  it("proposes generic categories only", () => {
    expect(suggestCategory("Parcella commercialista")).toBe("accountant")
    expect(suggestCategory("Volo per Roma")).toBe("travel")
    expect(suggestCategory("Abbonamento software")).toBe("software")
    expect(suggestCategory("Cena di lavoro")).toBe("marketing")
    expect(suggestCategory("Acquisto vario")).toBe("other")
  })
})

describe("planImport: invoices", () => {
  it("marks an invoice paid in the workbook into the account, books a short payment as a fee when the workbook's total is the app's", async () => {
    const plan = planImport(await read(), app())
    expect(of(plan, "2026:Giugno!6")).toEqual([
      { op: "update_invoice", id: "i1", ref: "2026:Giugno!6", input: { paidDate: d("2026-06-12"), paidAccountId: MAIN } },
    ])
    // €1,980 for €2,000: the €20 is a bank fee, same day and account, as Mark Paid writes it.
    expect(of(plan, "2026:Giugno!7").map((w) => [w.op, input(w).paidAccountId ?? input(w).category, input(w).amount])).toEqual([
      ["expense", "bank_fees", 20],
      ["update_invoice", MAIN, undefined],
    ])
    // "2026/105" in the app is 105/2026 in the workbook.
    expect(input(of(plan, "2026:Agosto!2")[0])).toEqual({ paidDate: d("2026-08-03"), paidAccountId: MAIN })
  })

  it("asks when the gap is no plain fee, and books an overpayment as client money to review", async () => {
    const dearer = INVOICES.map((i) => (i.id === "i3" ? { ...i, amount: 2100 } : i.id === "i1" ? { ...i, amount: 980 } : i))
    const wb = await read()
    const plan = planImport(wb, app({ invoices: dearer }))
    expect(plan.review.find((i) => i.id === "2026:Giugno!7")).toMatchObject({ suggested: "client_income", why: expect.stringMatching(/€120.00 less/) })
    expect(plan.review.find((i) => i.id === "2026:Giugno!6")).toMatchObject({ suggested: "paid", why: expect.stringMatching(/€20.00 more/) })
    const done = planImport(wb, app({ invoices: dearer }), decideAll(plan))
    expect(of(done, "2026:Giugno!7").map((w) => [w.op, input(w).kind, input(w).amount])).toEqual([["movement", "client_income", 1980]])
    expect(of(done, "2026:Giugno!6").map((w) => [w.op, input(w).kind, input(w).amount])).toEqual([
      ["movement", "client_income", 20],
      ["update_invoice", undefined, undefined],
    ])
    expect(input(of(done, "2026:Giugno!6")[0]).description).toBe("Overpayment on invoice 101/2026, to review")
  })

  it("lets the workbook's bank date win, keeps the app's day for an estimated one in the same month, asks across months", async () => {
    const wb = await read()
    const paid = (id: string, day: string) => (i: Invoice) => (i.id === id ? { ...i, paidDate: d(day) } : i)
    let plan = planImport(wb, app({ invoices: INVOICES.map(paid("i1", "2026-06-15")).map(paid("i3", "2026-06-20")) }))
    expect(input(of(plan, "2026:Giugno!6")[0])).toEqual({ paidDate: d("2026-06-12"), paidAccountId: MAIN })
    expect(input(of(plan, "2026:Giugno!7").find((w) => w.op === "update_invoice"))).toEqual({ paidDate: d("2026-06-20"), paidAccountId: MAIN })
    expect(plan.report).toMatch(/invoice 101\/2026 paid on 12\/06\/2026; the app had 15\/06\/2026/)

    plan = planImport(wb, app({ invoices: INVOICES.map(paid("i3", "2026-07-02")) }))
    const item = plan.review.find((i) => i.id === "2026:Giugno!7#date:i3")!
    expect(item.suggested).toBe("app")
    const excel = planImport(wb, app({ invoices: INVOICES.map(paid("i3", "2026-07-02")) }), decideAll(plan, { [item.id]: { option: "excel" } }))
    expect(input(of(excel, "2026:Giugno!7").find((w) => w.op === "update_invoice")).paidDate).toEqual(d("2026-06-01"))
  })

  it("never invents a payment for an invoice paid in the app with no row in the workbook", async () => {
    const extra = invoice({ id: "i9", clientId: "c1", number: "109/2026", amount: 300, vat: 0, paidDate: d("2026-07-10") })
    const wb = await read()
    const plan = planImport(wb, app({ invoices: [...INVOICES, extra] }))
    const item = plan.review.find((i) => i.id === "invoice:i9")!
    expect(item.options.map((o) => o.id)).toEqual(["keep", "unpaid", "offset"])
    expect(item.suggested).toBe("keep")
    expect(plan.writes.some((w) => w.op === "update_invoice" && w.id === "i9")).toBe(false)
    const offset = planImport(wb, app({ invoices: [...INVOICES, extra] }), decideAll(plan, { "invoice:i9": { option: "offset" } }))
    expect(offset.writes).toContainEqual({ op: "update_invoice", id: "i9", ref: null, input: { paidAccountId: NON_CASH } })
    expect(offset.report).toMatch(/Invoice 109\/2026: settled as an offset, no bank payment; it was paid on 10\/07\/2026 with no account\./)
    const unpaid = planImport(wb, app({ invoices: [...INVOICES, extra] }), decideAll(plan, { "invoice:i9": { option: "unpaid" } }))
    expect(unpaid.report).toMatch(/Invoice 109\/2026: marked unpaid; it was paid on 10\/07\/2026 with no account\./)
  })

  it("creates a missing invoice from the workbook's Emessa row, or records client money without one", async () => {
    const wb = await read()
    const without = app({ invoices: INVOICES.filter((i) => i.id !== "i1") })
    const plan = planImport(wb, without)
    const item = plan.review.find((i) => i.id === "2026:Giugno!6")!
    expect(item.options.map((o) => o.id)).toEqual(["create_invoice", "client_income"])
    expect(item.invoice).toEqual({ number: "101/2026", clientId: "c1", amount: 1000, vat: 220 })
    const created = planImport(wb, without, decideAll(plan))
    expect(of(created, "2026:Giugno!6")).toEqual([
      {
        op: "create_invoice",
        key: "invoice:2026:Giugno!6",
        ref: "2026:Giugno!6",
        input: { clientId: "c1", number: "101/2026", yearMonth: "2026-06", amount: 1000, vat: 220, paidDate: d("2026-06-12"), paidAccountId: MAIN },
      },
    ])
    const money = planImport(wb, app({ invoices: [], clients: [] }))
    expect(money.review.find((i) => i.id === "2026:Giugno!6")!.options.map((o) => o.id)).toEqual(["client_income"])
    expect(input(of(planImport(wb, app({ invoices: [], clients: [] }), decideAll(money)), "2026:Giugno!6")[0])).toMatchObject({
      kind: "client_income",
      amount: 1220,
      project: "Consulting",
    })
  })

  it("pays every invoice a receipt names, on the same day and account", async () => {
    const wb = await read(withRows("Agosto", [{ b: "Incasso fattura 106/2026 e 107/2026 (Acme Ltd)", c: "106/2026 + 107/2026", money: { "Main Bank": 1830 }, l: "Bonifico ricevuto il 04/08" }]))
    const more = [
      invoice({ id: "i6", clientId: "c1", number: "106/2026", amount: 1000, vat: 0 }),
      invoice({ id: "i7", clientId: "c1", number: "107/2026", amount: 830, vat: 0 }),
    ]
    const plan = planImport(wb, app({ invoices: [...INVOICES, ...more] }))
    expect(of(plan, "2026:Agosto!2").map((w) => (w.op === "update_invoice" ? [w.id, w.input] : w.op))).toEqual([
      ["i6", { paidDate: d("2026-08-04"), paidAccountId: MAIN }],
      ["i7", { paidDate: d("2026-08-04"), paidAccountId: MAIN }],
    ])
  })

  it("settles a cancelled invoice with its credit note, no money and no account; equal credit notes are interchangeable", async () => {
    const twin = invoice({ id: "cn2b", clientId: "c2", number: "NC 102/2026", amount: -2000, vat: 0 })
    const plan = planImport(await read(), app({ invoices: [...INVOICES, twin] }))
    const settled = of(plan, "2026:Giugno!4")
    expect(settled.map((w) => (w.op === "update_invoice" ? w.id : w.op))).toEqual(["i2", "cn2"])
    expect(settled.every((w) => w.op === "update_invoice" && w.input.paidAccountId === NON_CASH && w.input.paidDate?.getTime() === d("2026-06-01").getTime())).toBe(true)
    const none = planImport(await read(), app({ invoices: INVOICES.filter((i) => !i.id.startsWith("cn")) }))
    expect(of(none, "2026:Giugno!4")).toEqual([])
    expect(none.report).toMatch(/invoice 102\/2026 reads as owed: add its credit note on Invoices/)
    // Counted as written only when it settles something: here it is only reported.
    const kind = (p: ImportPlan, label: string) => p.counts.byKind.find((k) => k.label === label)
    expect(kind(plan, "Credit notes on your invoices")).toMatchObject({ count: 1, written: true })
    expect(kind(none, "Credit notes on your invoices")).toBeUndefined()
    expect(kind(none, "Credit notes on your invoices, reported only")).toMatchObject({ count: 1, written: false })
    expect(kind(planImport(await read(), app({ invoices: [] })), "Credit notes on your invoices, reported only")).toMatchObject({ written: false })
    // The report keeps what the settled invoices were before.
    expect(plan.report).toMatch(/Undo Import keeps these changes\)\n- Invoice 102\/2026 and credit note NC 101\/2026: settled on 01\/06\/2026 with no money; both were unpaid\./)
  })

  it("checks the issued invoices against the app and reports the numbering gaps", async () => {
    const plan = planImport(await read(), app({ invoices: INVOICES.map((i) => (i.id === "i2" ? { ...i, amount: 1900 } : i)) }))
    expect(plan.report).toMatch(/Giugno, row 3: invoice 102\/2026 is €2,000.00 in the workbook, €1,900.00 in the app/)
    expect(plan.report).toMatch(/Invoice numbers missing from the workbook: 104\/2026/)
  })

  it("books a platform payout as an invoice at the gross plus the platform's commission, or as client money", async () => {
    const wb = await read()
    const plan = planImport(wb, app())
    const item = plan.review.find((i) => i.id === "2026:Luglio!12")!
    expect(item).toMatchObject({ suggested: "platform_invoice", gross: 1000, invoice: { clientId: "c3", number: "PLT-001" } })
    expect(of(plan, "2026:Luglio!12").map((w) => [w.op, input(w).amount])).toEqual([
      ["expense", 30],
      ["create_invoice", 1000],
    ])
    expect(input(of(plan, "2026:Luglio!12")[0])).toMatchObject({ description: "Platform commission", vat: 0, documentRef: "COM-9", accountId: MAIN })
    expect(input(of(plan, "2026:Luglio!12")[0]).notes).toMatch(/^Reverse charge/)
    expect(input(of(plan, "2026:Luglio!12")[1])).toMatchObject({ clientId: "c3", vat: 0, paidAccountId: MAIN })
    const net = planImport(wb, app(), decideAll(plan, { "2026:Luglio!12": { option: "client_income" } }))
    expect(of(net, "2026:Luglio!12").map((w) => [input(w).kind, input(w).amount])).toEqual([["client_income", 970]])
    const noGross = planImport(wb, app(), decideAll(plan, { "2026:Luglio!12": { option: "platform_invoice", clientId: "c3", gross: 900 } }))
    expect(noGross.review.find((i) => i.id === "2026:Luglio!12")!.problem).toMatch(/at least the €970.00/)
  })

  it("marks the payout's own invoice paid when the app has its number, never creating it twice", async () => {
    const wb = await read()
    const numbered = (data: AppData) => data.invoices.filter((i) => i.number === "PLT-001").length
    const count = (p: ImportPlan) => p.writes.filter((w) => w.op === "create_invoice" && w.input.number === "PLT-001").length
    // Typed in the app, unpaid: suggested, preselected.
    const typed = invoice({ id: "plt", clientId: "c3", number: "PLT-001", amount: 1000, vat: 0, yearMonth: "2026-07" })
    let plan = planImport(wb, app({ invoices: [...INVOICES, typed] }))
    let item = plan.review.find((i) => i.id === "2026:Luglio!12")!
    expect(item).toMatchObject({ suggested: "platform_existing", invoiceId: "plt" })
    expect(item.options.map((o) => o.id)).toEqual(["platform_existing", "client_income"])
    plan = planImport(wb, app({ invoices: [...INVOICES, typed] }), decideAll(plan))
    expect(count(plan)).toBe(0)
    expect(of(plan, "2026:Luglio!12").map((w) => [w.op, "id" in w ? w.id : input(w).amount])).toEqual([
      ["expense", 30],
      ["update_invoice", "plt"],
    ])

    // Imported, then undone: the invoice it created stays, paid with no account. Importing again pays it again.
    const first = planImport(wb, app(), decideAll(planImport(wb, app())))
    const created = first.writes.filter((w) => w.op === "create_invoice").map((w, k) =>
      invoice({ ...(w.input as Invoice), id: `new${k}`, paidAccountId: null }),
    )
    const undone = app({ invoices: [...INVOICES, ...created] })
    expect(numbered(undone)).toBe(1)
    const again = planImport(wb, undone)
    item = again.review.find((i) => i.id === "2026:Luglio!12")!
    expect(item.suggested).toBe("platform_existing")
    expect(item.openInvoices![0].label).toBe("PLT-001, €1,000.00, paid with no account")
    const done = planImport(wb, undone, decideAll(again))
    expect(count(done)).toBe(0)
    expect(done.review.some((i) => i.id.startsWith("invoice:"))).toBe(false)
    expect(done.check.ok).toBe(true)
  })
})

describe("planImport: against the app", () => {
  it("refuses a second import: any record with an importRef", async () => {
    const movement = { id: "m1", importRef: "2026:Maggio!7" } as CompanyMovement
    const plan = planImport(await read(), app({ movements: [movement] }))
    expect(plan.alreadyImported).toBe(1)
    expect(plan.blockers).toContain("This workbook is already imported. Undo Import first to import it again.")
  })

  it("uses an empty account of the same name, and refuses one that has rows", async () => {
    const mine: CompanyAccount = { id: "acc1", name: "main bank business", openingBalance: 50, openingDate: d("2026-09-01"), statementBalance: null, statementDate: null, importRef: null, ...stamp }
    const plan = planImport(await read(), app({ accounts: [mine] }))
    expect(plan.writes[0]).toEqual({ op: "update_account", id: "acc1", input: { openingBalance: 0, openingDate: d("2026-05-01"), statementBalance: expect.any(Number), statementDate: d("2026-08-05") } })
    expect(plan.writes[1]).toMatchObject({ op: "create_account", key: SECOND, input: { name: "Second Bank", importRef: "2026:Saldo!3" } })
    expect(input(of(plan, "2026:Maggio!2")[0]).accountId).toBe("acc1")
    expect(plan.check.ok).toBe(true)
    expect(plan.report).toMatch(/main bank business: your account, used as it was empty. Before the import it opened on 01\/09\/2026 with €50.00/)

    const used = planImport(await read(), app({ accounts: [mine], movements: [{ id: "m", accountId: "acc1", toAccountId: null, importRef: null } as CompanyMovement] }))
    expect(used.blockers.join(" ")).toMatch(/main bank business already has rows in the Cash Book/)
  })

  it("pairs a cost or loan already in the app with a workbook row of the same amount within a month, replacing it by default", async () => {
    const wb = await read()
    const monitor = expense({ id: "e1", description: "Monitor", amount: 200, date: d("2026-05-20") })
    const far = expense({ id: "e2", description: "Monitor again", amount: 200, date: d("2026-07-20") })
    const lent = loan({ id: "l1", direction: "to_company", amount: 5000 })
    const back = loan({ id: "l2", direction: "from_company", amount: 5000 })
    const data = app({ expenses: [monitor, far], loans: [lent, back] })
    const plan = planImport(wb, data)
    expect(plan.overlaps.map((o) => [o.id, o.imported.ref, o.replace])).toEqual([
      ["e1", "2026:Maggio!6", true],
      ["l1", "2026:Maggio!2", true],
    ])
    expect(plan.writes.filter((w) => w.op.startsWith("delete"))).toEqual([
      { op: "delete_expense", id: "e1" },
      { op: "delete_loan", id: "l1" },
    ])
    expect(plan.report).toMatch(/Cost “Monitor”, 20\/05\/2026, €200.00, category Other, VAT not stated. Replaced by Maggio, row 6, on the app's 20\/05\/2026\./)
    // The workbook has no day for them (~01/05): Replace keeps the app's day, in the same month.
    expect(plan.overlaps[0].imported).toMatchObject({ day: "2026-05-01", dateEstimated: true, appDay: "2026-05-20" })
    expect(input(of(plan, "2026:Maggio!6")[0])).toMatchObject({ date: d("2026-05-20"), dateEstimated: false })
    expect(input(of(plan, "2026:Maggio!2")[0])).toMatchObject({ date: d("2026-05-25"), dateEstimated: false })
    expect(plan.report).not.toMatch(/Maggio, row 6, .*: ~01\/05\/2026/)
    const kept = planImport(wb, data, { ...NO, keep: ["e1"] })
    expect(kept.writes.filter((w) => w.op.startsWith("delete"))).toEqual([{ op: "delete_loan", id: "l1" }])
    expect(input(of(kept, "2026:Maggio!6")[0])).toMatchObject({ date: d("2026-05-01"), dateEstimated: true })
  })

  it("never pairs a row on another account, nor a cost paid with your card with a bank payment", async () => {
    const wb = await read()
    const box = expense({ id: "box", description: "Paper", amount: 200, accountId: "cash-box" })
    const card = expense({ id: "card", description: "Paper", amount: 200, paidByOwner: true })
    const boxLoan = loan({ id: "bl", direction: "to_company", amount: 5000, accountId: "cash-box" })
    const plan = planImport(wb, app({ expenses: [box, card], loans: [boxLoan] }))
    expect(plan.overlaps).toEqual([])
    expect(plan.writes.some((w) => w.op.startsWith("delete"))).toBe(false)
    // A card cost in the app can be the workbook's card cost (Giugno row 9, €80).
    const flight = expense({ id: "fl", description: "Flight", amount: 80, paidByOwner: true, vat: 0, category: "travel", documentRef: "W-1", date: d("2026-06-03") })
    const paired = planImport(wb, app({ expenses: [flight] }))
    expect(paired.overlaps.map((o) => [o.id, o.imported.ref, o.existing.details])).toEqual([
      ["fl", "2026:Giugno!9", ["category Travel & Transport", "VAT 0", "document W-1", "paid with your card"]],
    ])
  })

  it("links the payments that clearly stand for a recurring estimate, starting it on the opening day", async () => {
    const wb = await read()
    const accountant = expense({ id: "r1", description: "Commercialista mensile", category: "accountant", amount: 250, date: d("2026-01-01"), isRecurring: true, recurrenceMonths: 1 })
    const rent = expense({ id: "r2", description: "Affitto casa", category: "rent", amount: 1500, date: d("2026-06-01"), isRecurring: true, recurrenceMonths: 1 })
    const plan = planImport(wb, app({ expenses: [accountant, rent] }))
    expect(plan.estimates.map((e) => [e.estimate.id, e.payments, e.startsEarly, e.link, e.moveStart])).toEqual([
      ["r2", 1, false, true, false],
      ["r1", 1, true, true, true],
    ])
    expect(input(of(plan, "2026:Luglio!13")[0]).recurringExpenseId).toBe("r1")
    expect(plan.writes.filter((w) => w.op === "update_estimate")).toEqual([
      { op: "update_estimate", id: "r1", input: { date: d("2026-05-01") } },
    ])
    expect(plan.estimates.map((e) => [e.key, e.sure])).toEqual([
      ["r2", true],
      ["r1", true],
    ])
    const off = planImport(wb, app({ expenses: [accountant, rent] }), { ...NO, estimates: { r1: { link: false, moveStart: true } } })
    expect(input(of(off, "2026:Luglio!13")[0]).recurringExpenseId).toBeUndefined()
    expect(off.writes.some((w) => w.op === "update_estimate")).toBe(false)
    // The report keeps the start the estimate had.
    expect(plan.report).toMatch(/Recurring cost “Commercialista mensile”: start moved from 01\/01\/2026 to 01\/05\/2026\./)
  })

  it.each([
    [
      "a spread estimate: the start moves to the opening day and the price changes already in force fold into the amount",
      { recurrenceMonths: 1, date: d("2026-01-01"), priceChanges: [{ from: "2026-03", amount: 260 }, { from: "2026-09", amount: 300 }] },
      { date: d("2026-05-01"), amount: 260, priceChanges: [{ from: "2026-09", amount: 300 }] },
      "start moved from 01/01/2026 to 01/05/2026.",
    ],
    [
      "a counted-when-paid quarterly one: the start keeps its phase (Jan, Apr, Jul), so its payment months do not move",
      { recurrenceMonths: 3, countedWhenPaid: true, date: d("2026-01-15"), priceChanges: [{ from: "2026-02", amount: 280 }, { from: "2026-09", amount: 300 }] },
      { date: d("2026-07-15"), amount: 280, priceChanges: [{ from: "2026-09", amount: 300 }] },
      "start moved from 15/01/2026 to 15/07/2026.",
    ],
    [
      "a counted-when-paid one whose payment month is the opening month starts that month, on its own day",
      { recurrenceMonths: 4, countedWhenPaid: true, date: d("2026-01-15") },
      { date: d("2026-05-15") },
      "start moved from 15/01/2026 to 15/05/2026.",
    ],
  ])("starting a recurring estimate on the opening day, %s", async (_n, over, want, report) => {
    const wb = await read()
    const est = expense({ id: "r1", description: "Commercialista", category: "accountant", amount: 250, isRecurring: true, ...over })
    const plan = planImport(wb, app({ expenses: [est] }))
    expect(plan.writes.filter((w) => w.op === "update_estimate")).toEqual([{ op: "update_estimate", id: "r1", input: want }])
    expect(plan.report).toContain(report)
  })

  it("offers, unticked, the payments that only share an estimate's category: an estimate named in English", async () => {
    const book = withRows(
      "Agosto",
      [...SYNTHETIC_BOOK.months[3].rows, { b: "Elargizione associazione culturale", money: { "Main Bank": -100 } }, { b: "Ferramenta", money: { "Main Bank": -8 } }],
      withRows("Luglio", [...SYNTHETIC_BOOK.months[2].rows, { b: "Elargizione associazione sportiva", money: { "Main Bank": -100 } }]),
    )
    const wb = await read(book)
    const estimate = (id: string, description: string, category: CompanyExpense["category"]) =>
      expense({ id, description, category, amount: 100, date: d("2026-01-01"), isRecurring: true, recurrenceMonths: 1 })
    const english = [estimate("rent", "Rent", "rent"), estimate("acct", "Accountant", "accountant"), estimate("gift", "Donation", "other")]
    const plan = planImport(wb, app({ expenses: english }))
    expect(plan.estimates.map((e) => [e.key, e.sure, e.payments, e.link, e.sample])).toEqual([
      ["rent~", false, 1, false, "Affitto Luglio Via Esempio"],
      ["acct~", false, 1, false, "Parcella commercialista trimestrale"],
      // "Other" holds any cost: of the payments sharing a first word over two months or more (two shops, two
      // donations), the group nearest the estimate's amount; one card per estimate.
      ["gift~elargizione", false, 2, false, "Elargizione associazione sportiva"],
    ])
    expect(plan.writes.some((w) => w.op === "update_estimate")).toBe(false)
    expect(plan.writes.some((w) => w.op === "expense" && w.input.recurringExpenseId)).toBe(false)
    const ticked = planImport(wb, app({ expenses: english }), { ...NO, estimates: { "gift~elargizione": { link: true, moveStart: true } } })
    expect(ticked.writes.filter((w) => w.op === "expense" && w.input.recurringExpenseId === "gift")).toHaveLength(2)
    expect(ticked.writes.filter((w) => w.op === "update_estimate")).toEqual([{ op: "update_estimate", id: "gift", input: { date: d("2026-05-01") } }])
  })

  it("orders the writes: accounts, supplier invoices, costs, loans, movements, invoices, estimates, then the replaced rows", async () => {
    const plan = planImport(await read(), app({ expenses: [expense({ id: "e1", description: "Monitor", amount: 200 })] }))
    const order = ["account", "doc", "expense", "loan", "movement", "invoice", "update_estimate", "delete_expense", "delete_loan"]
    const rank = (w: Write) =>
      order.indexOf(w.op === "expense" && w.key.startsWith("doc:") ? "doc" : w.op.endsWith("_account") ? "account" : w.op.endsWith("_invoice") ? "invoice" : w.op)
    const ranks = plan.writes.map(rank)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(plan.writes.at(-1)).toEqual({ op: "delete_expense", id: "e1" })
  })

  it("writes a split part with no description under the row's, and blocks what the app would refuse before writing", async () => {
    const wb = await read()
    const parts = [{ as: "income" as const, amount: 700, description: "Rent" }, { as: "deposit_held" as const, amount: 700, description: "  " }]
    const plan = planImport(wb, app(), decideAll(planImport(wb, app()), { "2026:Luglio!8": { option: "split", parts } }))
    expect(plan.unresolved).toEqual([])
    expect(input(of(plan, "2026:Luglio!8")[1])).toMatchObject({ kind: "deposit_held", description: "Room 5 (affitto e deposito cauzionale)" })
    expect(plan.blockers).toEqual([])
    // An account name longer than the app takes: refused in the preview, naming the Saldo row, not halfway.
    const long = "Bank " + "x".repeat(100)
    const refused = planImport(await read({ ...SYNTHETIC_BOOK, accounts: [long, "Second Bank"], saldoNames: [long, "Second Bank"], months: [{ name: "Maggio", rows: [{ b: "Finanziamento Soci", money: { [long]: 5 } }] }] }), app())
    expect(refused.blockers).toHaveLength(1)
    expect(refused.blockers[0]).toMatch(/^Saldo, row 2: the app would refuse what it becomes \(name: /)
  })
})

const NO: Choices = { decisions: {}, keep: [], estimates: {} }

describe("the acceptance check", () => {
  const sums = (book: Book) =>
    book.accounts.map((a) => Math.round(book.months.flatMap((m) => m.rows).reduce((t, r) => t + (r.money?.[a] ?? 0), 0) * 100) / 100)

  it("passes when every account ends on its Saldo balance and every sheet adds up", async () => {
    const plan = planImport(await read(), app())
    expect(plan.check.ok).toBe(true)
    expect(plan.check.accounts.map((a) => a.label)).toEqual([
      `Main Bank: matches €${sums(SYNTHETIC_BOOK)[0].toLocaleString("en-IE", { minimumFractionDigits: 2 })} on 05/08/2026`,
      `Second Bank: matches €${sums(SYNTHETIC_BOOK)[1].toLocaleString("en-IE", { minimumFractionDigits: 2 })} on 05/08/2026`,
    ])
    expect(plan.check.problems).toEqual([])
  })

  it("fails like Verifica when a row is missing", async () => {
    const balances = sums(SYNTHETIC_BOOK)
    const dropped = withRows("Maggio", SYNTHETIC_BOOK.months[0].rows.filter((r) => r.c !== "R-100"))
    const plan = planImport(await read({ ...dropped, balances }), app())
    expect(plan.check.ok).toBe(false)
    expect(plan.check.accounts[0].label).toBe("Main Bank: missing OUT of €200.00 on 05/08/2026")
    expect(plan.check.accounts[1].ok).toBe(true)
  })

  it("says to update the Saldo when rows are dated after it", async () => {
    const balances = sums(SYNTHETIC_BOOK)
    const late = withRows("Agosto", [...SYNTHETIC_BOOK.months[3].rows, { b: "Negozio", c: "N-1", money: { "Main Bank": -50 }, l: "Addebito del 06/08" }])
    const plan = planImport(await read({ ...late, balances }), app())
    expect(plan.check.ok).toBe(false)
    expect(plan.check.problems.join(" ")).toMatch(/1 row is dated after 05\/08\/2026: update the Saldo sheet to today's balance and import again/)
  })

  it("compares each source sheet, so a row the bank dated next month still counts where it was written", async () => {
    const plan = planImport(await read(), app())
    // Luglio row 17 is dated 01/08: Luglio's sums still match.
    expect(plan.check.problems.filter((p) => p.startsWith("Luglio"))).toEqual([])
  })

  it("counts rows per kind and per account for the preview", async () => {
    const plan = planImport(await read(), app())
    expect(plan.counts.perSheet).toEqual([
      { sheet: "Maggio", rows: 7 },
      { sheet: "Giugno", rows: 13 },
      { sheet: "Luglio", rows: 21 },
      { sheet: "Agosto", rows: 2 },
    ])
    expect(plan.counts.byKind.find((k) => k.label === "Transfers between accounts")?.count).toBe(2)
    // Every row with an amount is counted once per sheet: the sheets add up to the total.
    expect(plan.counts.perSheet.reduce((t, s) => t + s.rows, 0)).toBe(plan.counts.rows)
    expect(plan.counts.byKind.find((k) => k.label === "Deposit received")).toMatchObject({ written: true })
    expect(plan.counts.byAccount.map((a) => [a.name, a.rows])).toEqual([
      ["Main Bank", 20],
      ["Second Bank", 15],
    ])
    expect(plan.counts.estimatedDates).toBeGreaterThan(10)
  })
})

describe("planUndo", () => {
  const t0 = new Date(2026, 9, 8, 10)
  const later = new Date(2026, 9, 9, 10)
  const acct = (id: string, importRef: string | null): CompanyAccount => ({
    id, name: id, openingBalance: 0, openingDate: d("2026-05-01"), statementBalance: 10, statementDate: d("2026-08-05"), importRef, createdAt: t0, updatedAt: t0, userId: "u",
  })
  const mv = (o: Partial<CompanyMovement> & Pick<CompanyMovement, "id">): CompanyMovement => ({
    userId: "u", kind: "income", direction: "in", amount: 10, date: d("2026-07-01"), accountId: "a1", toAccountId: null, expenseId: null,
    description: "Row", documentRef: null, project: null, counterparty: null, notes: null, dateEstimated: true, importRef: "2026:Luglio!2",
    createdAt: t0, updatedAt: t0, ...o,
  })
  const data = () => ({
    accounts: [acct("a1", "2026:Saldo!2"), acct("mine", null)],
    invoices: [
      // Paid into a1 by the import, while it ran.
      invoice({ id: "paid", clientId: "c1", number: "101/2026", amount: 10, vat: 0, paidDate: d("2026-06-12"), paidAccountId: "a1", updatedAt: t0 }),
      // Paid into a1 by the owner the day after, dated before the Saldo: theirs, it keeps the account.
      invoice({ id: "later", clientId: "c1", number: "109/2026", amount: 10, vat: 0, paidDate: d("2026-07-12"), paidAccountId: "a1", updatedAt: later }),
      invoice({ id: "offset", clientId: "c1", number: "102/2026", amount: 10, vat: 0, paidDate: d("2026-06-01"), paidAccountId: NON_CASH }),
    ],
    expenses: [
      expense({ id: "doc", description: "Supplier invoice", amount: 300, documentRef: "SUP-05", importRef: "2026:Giugno!10", createdAt: t0, updatedAt: t0 }),
      expense({ id: "cost", description: "Cost", amount: 20, accountId: "a1", importRef: "2026:Maggio!3", createdAt: t0, updatedAt: later }),
      expense({ id: "typed", description: "Typed by hand", amount: 5, accountId: "mine" }),
    ],
    loans: [loan({ id: "loan", direction: "to_company", amount: 100, accountId: "a1", importRef: "2026:Maggio!2", createdAt: t0, updatedAt: t0 })],
    movements: [mv({ id: "pay", kind: "supplier_payment", direction: "out", expenseId: "doc", accountId: "mine" }), mv({ id: "rent" })],
  })

  it("deletes what the import created, payments first, clears the account on the invoices it paid, then the accounts nothing uses", () => {
    const undo = planUndo(data(), true)
    expect(undo.steps).toEqual([
      { op: "delete_movement", id: "pay" },
      { op: "delete_movement", id: "rent" },
      { op: "delete_loan", id: "loan" },
      { op: "delete_expense", id: "doc" },
      { op: "delete_expense", id: "cost" },
      { op: "clear_invoice", id: "paid" },
    ])
    expect(undo.edited.map((e) => e.id)).toEqual(["cost"])
    expect(undo.invoiceNumbers).toEqual(["101/2026"])
    // A Check Balance since moved a1's statement on: the owner's invoice still keeps its account.
    const checked = data()
    checked.accounts[0] = { ...checked.accounts[0], statementDate: d("2026-10-31"), updatedAt: later }
    expect(planUndo(checked, true).steps.filter((s) => s.op === "clear_invoice")).toEqual([{ op: "clear_invoice", id: "paid" }])
    // An invoice paid into it after the import keeps the account; without one, it goes.
    const alone = data()
    alone.invoices = alone.invoices.filter((i) => i.id !== "later")
    expect(planUndo(alone, true).steps.at(-1)).toEqual({ op: "delete_account", id: "a1" })
  })

  it("keeps the rows edited since, and the account and supplier invoice they still need", () => {
    const edited = data()
    edited.movements[0] = { ...edited.movements[0], updatedAt: later }
    const undo = planUndo(edited, false)
    expect(undo.edited.map((e) => e.id).sort()).toEqual(["cost", "pay"])
    expect(undo.steps.map((s) => s.id)).toEqual(["rent", "loan", "paid"])
    expect(undo.counts).toEqual({ costs: 0, loans: 1, movements: 1, invoices: 1, accounts: 0 })
    expect(undo.keptAccounts).toEqual(["a1"])
  })

  it("names what it leaves as the import made it: invoices it created, settled or marked unpaid, recurring costs it changed", () => {
    const made = data()
    made.invoices.push(
      invoice({ id: "new", clientId: "c3", number: "PLT-001", amount: 1000, vat: 0, paidDate: d("2026-07-01"), paidAccountId: "a1", createdAt: t0, updatedAt: t0 }),
      invoice({ id: "nc", clientId: "c1", number: "NC 3/2030", amount: -10, vat: 0, paidDate: d("2026-06-01"), paidAccountId: NON_CASH, updatedAt: t0 }),
      invoice({ id: "unpaid", clientId: "c1", number: "4/2030", amount: 10, vat: 0, updatedAt: t0 }),
    )
    made.expenses.push(expense({ id: "est", description: "Rent", amount: 100, isRecurring: true, recurrenceMonths: 1, updatedAt: t0 }))
    const undo = planUndo(made, false)
    expect(undo.stays).toEqual({ createdInvoices: 1, settled: 1, unpaid: 1, estimates: 1 })
    expect(undo.invoiceNumbers).toEqual(["101/2026", "PLT-001"])
  })
})

describe("a collaborator's name in a cost's description", () => {
  const person = (id: string, name: string, over: Partial<Collaborator> = {}): Collaborator => ({
    id, name, type: "company", notes: null, isActive: true, fee: null, ...stamp, ...over,
  })
  const verdi = person("verdi", "Studio Verdi")
  const giulia = person("giulia", "Giulia Neri", { type: "freelancer" })
  const assignment = { id: "a1", collaboratorId: "giulia", engagementId: "e1", dailyRate: 320, from: "2026-08", until: null, defaultDays: 4, monthDays: {}, ...stamp } as Assignment

  describe("matchCollaborator", () => {
    it.each([
      ["Fattura 14 Studio Verdi", "verdi"],
      ["fattura 14 STUDIO VERDI srl", "verdi"],
      ["Studio  Verdi, agosto", "verdi"],
      ["Bonifico a Giulia Neri", "giulia"],
      ["Fattura Studio Verdiano", null],
      ["Fattura XStudio Verdi", null],
      ["Fattura Giulia", null],
      ["Giulia Neri e Studio Verdi", null],
      ["Fattura 9 Lab Nove", null],
    ])("%s", (description, expected) => {
      expect(matchCollaborator(description, [verdi, giulia, person("lab", "Lab Nove", { isActive: false })])?.id ?? null).toBe(expected)
    })
  })

  describe("matchCollaborator: spelling", () => {
    const list = [person("dangelo", "D’Angelo Srl"), person("nicolo", "Nicolò Bianchi"), person("verdi", "Verdi"), person("studio", "Studio Verdi"), person("rossi", "Rossi")]
    it.each([
      ["Fattura 3 D'Angelo Srl", "dangelo"],
      ["Fattura 3 d’angelo srl", "dangelo"],
      ["Fattura 4 Nicolo Bianchi", "nicolo"],
      ["Fattura 5 NICOLÒ BIANCHI", "nicolo"],
      ["Fattura 6 Studio Verdi", "studio"],
      ["Fattura 6 Verdi", "verdi"],
      ["Fattura 7 Verdi e Rossi", null],
    ])("%s", (description, expected) => {
      expect(matchCollaborator(description, list)?.id ?? null).toBe(expected)
    })
  })

  const row = (b: string): Book => withRows("Agosto", [{ b, c: "14", money: { "Main Bank": -2400 } }])
  const costOf = (plan: ImportPlan) => input(of(plan, "2026:Agosto!2")[0])

  it("makes the row a Collaborators cost for them, For Month starting as the date's month", async () => {
    const plan = planImport(await read(row("Fattura 14 Studio Verdi")), app({ collaborators: [verdi, giulia], assignments: [assignment] }))
    expect(costOf(plan)).toMatchObject({ category: "collaborators", collaboratorId: "verdi", engagementId: null, forMonth: "2026-08" })
    expect(plan.collaboratorRows).toEqual([
      { ref: "2026:Agosto!2", where: "Agosto, row 2", description: "Fattura 14 Studio Verdi", day: "2026-08-01", name: "Studio Verdi", forMonth: "2026-08" },
    ])
  })

  it("takes the contract only when they are on exactly one", async () => {
    const plan = planImport(await read(row("Fattura 9 Giulia Neri")), app({ collaborators: [verdi, giulia], assignments: [assignment] }))
    expect(costOf(plan)).toMatchObject({ collaboratorId: "giulia", engagementId: "e1" })
    const two = planImport(await read(row("Fattura 9 Giulia Neri")), app({ collaborators: [giulia], assignments: [assignment, { ...assignment, id: "a2", engagementId: "e2" }] }))
    expect(costOf(two)).toMatchObject({ collaboratorId: "giulia", engagementId: null })
  })

  it("lets the owner change the month before importing", async () => {
    const choices: Choices = { ...NO_CHOICES, forMonths: { "2026:Agosto!2": "2026-07" } }
    const plan = planImport(await read(row("Fattura 14 Studio Verdi")), app({ collaborators: [verdi] }), choices)
    expect(costOf(plan)).toMatchObject({ forMonth: "2026-07" })
    expect(plan.collaboratorRows[0]).toMatchObject({ forMonth: "2026-07" })
  })

  it("leaves a row alone with no match, two names, an inactive collaborator or none known", async () => {
    for (const [b, list] of [
      ["Fattura 14 Acme", [verdi]],
      ["Giulia Neri e Studio Verdi", [verdi, giulia]],
      ["Fattura 14 Studio Verdi", [person("verdi", "Studio Verdi", { isActive: false })]],
    ] as const) {
      const plan = planImport(await read(row(b)), app({ collaborators: [...list] }))
      expect(costOf(plan)).not.toHaveProperty("collaboratorId")
      expect(plan.collaboratorRows).toEqual([])
    }
    expect(planImport(await read(row("Fattura 14 Studio Verdi")), app()).collaboratorRows).toEqual([])
  })
})
