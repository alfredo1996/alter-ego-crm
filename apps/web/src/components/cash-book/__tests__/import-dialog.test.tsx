/**
 * Import Excel and Undo Import on a synthetic workbook (helpers/prima-nota-workbook,
 * invented data). The planning maths is lib/__tests__/prima-nota.test.ts; this
 * checks the owner can read what will happen, decide, see the check, import with
 * the ids the earlier writes got, keep the report, and undo.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { primaNotaWorkbook, SYNTHETIC_BOOK } from "@/lib/__tests__/helpers/prima-nota-workbook"

import { ImportDialog } from "../import-dialog"
import { UndoImportDialog } from "../undo-import-dialog"

import type { AppData } from "@/lib/prima-nota"
import type { CompanyAccount, CompanyExpense, CompanyMovement, Invoice } from "@/types"

const stamp = { userId: "u1", createdAt: new Date(2026, 0, 1), updatedAt: new Date(2026, 0, 1) }
const invoice = (o: Partial<Invoice> & Pick<Invoice, "id" | "number" | "amount" | "vat" | "clientId">): Invoice => ({
  engagementId: null, fromMonth: null, yearMonth: "2026-06", dueDate: null, paidDate: null, paidAccountId: null, ...stamp, ...o,
})
const APP: AppData = {
  accounts: [],
  invoices: [
    invoice({ id: "i1", clientId: "c1", number: "101/2026", amount: 1000, vat: 220 }),
    invoice({ id: "i2", clientId: "c2", number: "102/2026", amount: 2000, vat: 0 }),
    invoice({ id: "cn2", clientId: "c2", number: "NC 101/2026", amount: -2000, vat: 0 }),
    invoice({ id: "i3", clientId: "c2", number: "103/2026", amount: 2000, vat: 0 }),
    invoice({ id: "i5", clientId: "c1", number: "105/2026", amount: 500, vat: 110 }),
  ],
  expenses: [],
  loans: [],
  movements: [],
  clients: [
    { id: "c1", name: "Acme Ltd" },
    { id: "c2", name: "Beta Srl" },
    { id: "c3", name: "Gamma Spa" },
  ],
  clientOf: (i) => i.clientId,
}

let seq = 0
const db: Record<string, ReturnType<typeof vi.fn>> = {}
const METHODS = [
  "createCompanyAccount", "updateCompanyAccount", "deleteCompanyAccount", "createCompanyExpense", "updateCompanyExpense", "deleteCompanyExpense",
  "createCompanyLoan", "deleteCompanyLoan", "createCompanyMovement", "deleteCompanyMovement", "createInvoice", "updateInvoice",
]
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ db }) }))
const downloadCsv = vi.fn()
vi.mock("@/lib/export", async (actual) => ({ ...(await actual<Record<string, unknown>>()), downloadCsv: (...a: unknown[]) => downloadCsv(...a) }))
const toast = vi.fn()
vi.mock("@alter-ego/ui/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }))

beforeEach(() => {
  seq = 0
  for (const m of METHODS) db[m] = vi.fn().mockImplementation(async () => ({ id: `${m.replace(/^create/, "").toLowerCase()}-${++seq}` }))
  downloadCsv.mockReset()
  toast.mockReset()
  onImported.mockReset()
  onOpenChange.mockReset()
})

function show(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
}

const onUndo = vi.fn()
/** Reading the file is real async work (inflate, parse): more than findBy's 1 s on a busy machine. */
const READ = { timeout: 5000 }
const onImported = vi.fn()
const onOpenChange = vi.fn()
const choose = (dialog: HTMLElement, bytes: Uint8Array) =>
  fireEvent.change(within(dialog).getByLabelText("Workbook (.xlsx)"), { target: { files: [new File([bytes as BlobPart], "synthetic.xlsx")] } })
async function openWith(bytes: Uint8Array, app: AppData = APP) {
  show(<ImportDialog userId="u1" open onOpenChange={onOpenChange} data={app} onUndo={onUndo} onImported={onImported} />)
  const dialog = await screen.findByRole("dialog", { name: "Import Excel" })
  choose(dialog, bytes)
  return dialog
}
const room5 = (dialog: HTMLElement) => within(dialog).getAllByRole("listitem").find((li) => li.textContent?.includes("Room 5 (affitto e deposito cauzionale)"))!

describe("Import Excel", () => {
  it("says what will happen, waits for the decisions and the check, imports with the new ids, keeps the report", async () => {
    const dialog = await openWith(primaNotaWorkbook(SYNTHETIC_BOOK))
    const summary = await within(dialog).findByRole("region", { name: "What's in the File" }, READ)
    expect(summary).toHaveTextContent("43 rows on 4 month sheets, May 2026 to August 2026, and bank balances on 05/08/2026")
    expect(summary).toHaveTextContent(/What Import will do: Create 2 accounts, write \d+ costs, loans and movements, mark 4 invoices paid into an account/)
    expect(within(summary).getByRole("list", { name: "Written to the App" })).toHaveTextContent("Transfers between accounts2")
    expect(within(summary).getByRole("list", { name: "Checked or Reported, Not Written" })).toHaveTextContent("Invoices issued, checked against the app4")
    const importButton = within(dialog).getByRole("button", { name: "Import" })
    expect(importButton).toBeDisabled()
    expect(within(dialog).getByRole("status")).toHaveTextContent("Import is off until you decide 9 rows.")

    fireEvent.click(within(dialog).getByRole("button", { name: "Accept All Suggestions" }))
    // Deposit + rent: the owner says how much each is.
    const split = within(dialog).getAllByRole("listitem").find((li) => li.textContent?.includes("Room 5 (affitto e deposito cauzionale)"))!
    expect(split).toHaveTextContent("Enter every part's amount (none can be 0).")
    expect(within(dialog).getByRole("status")).toHaveTextContent("Import is off until you decide 1 row.")
    fireEvent.change(within(split).getByRole("spinbutton", { name: "Part 1: amount" }), { target: { value: "700" } })
    fireEvent.change(within(split).getByRole("spinbutton", { name: "Part 2: amount" }), { target: { value: "650" } })
    expect(split).toHaveTextContent("The parts add up to €1,350.00, the bank amount is €1,400.00.")
    fireEvent.change(within(split).getByRole("spinbutton", { name: "Part 2: amount" }), { target: { value: "700" } })

    const check = within(dialog).getByRole("list", { name: "Check" })
    expect(check).toHaveTextContent("Main Bank: matches €4,088.00 on 05/08/2026")
    expect(check).toHaveTextContent("Second Bank: matches €5,965.00 on 05/08/2026")
    expect(within(dialog).getByRole("status")).toHaveTextContent(/^Ready: \d+ changes, and every account matches the Saldo sheet\.$/)
    expect(importButton).toBeEnabled()

    fireEvent.click(importButton)
    expect(await within(dialog).findByText(/Imported: \d+ changes written\./, {}, { timeout: 5000 })).toBeInTheDocument()
    // Accounts first; every later write names the ids they got.
    expect(db.createCompanyAccount.mock.calls.map((c) => c[1].name)).toEqual(["Main Bank", "Second Bank"])
    const [main, second] = db.createCompanyAccount.mock.results.map((r) => (r.value as Promise<{ id: string }>))
    const mainId = (await main).id
    const secondId = (await second).id
    const transfer = db.createCompanyMovement.mock.calls.map((c) => c[1]).find((m) => m.kind === "transfer")
    expect(transfer).toMatchObject({ accountId: mainId, toAccountId: secondId, importRef: "2026:Maggio!7" })
    const docCall = db.createCompanyExpense.mock.calls.findIndex((c) => c[1].documentRef === "SUP-05")
    const docId = ((await db.createCompanyExpense.mock.results[docCall].value) as { id: string }).id
    expect(db.createCompanyMovement.mock.calls.map((c) => c[1]).find((m) => m.kind === "supplier_payment")).toMatchObject({ expenseId: docId, accountId: secondId })
    expect(db.updateInvoice).toHaveBeenCalledWith("u1", "i1", { paidDate: new Date(2026, 5, 12), paidAccountId: mainId })
    expect(within(dialog).getByText("Main Bank: matches the bank, €4,088.00 on 05/08/2026.")).toBeInTheDocument()
    // The page turns to the month the workbook ends on.
    expect(onImported).toHaveBeenCalledWith("2026-08-05")

    fireEvent.click(within(dialog).getByRole("button", { name: "Download Report" }))
    const [text, name, type] = downloadCsv.mock.calls[0]
    expect(name).toMatch(/^prima-nota-import-report_\d{4}-\d{2}-\d{2}\.txt$/)
    expect(type).toBe("text/plain;charset=utf-8;")
    expect(text).toMatch(/^Prima nota import report\nFile: synthetic.xlsx\nWritten: \d+ of \d+ changes/)
    expect(text).toMatch(/Estimated dates: the 1st of the month/)
    // Nothing was replaced, so nothing was saved before the import.
    expect(downloadCsv).toHaveBeenCalledTimes(1)
  })

  it("marks the costs that name a collaborator, and lets the month be changed before importing", async () => {
    const edilfast = { id: "col1", userId: "u1", name: "Edilfast", type: "company" as const, notes: null, isActive: true, fee: null, createdAt: stamp.createdAt, updatedAt: stamp.updatedAt }
    const dialog = await openWith(primaNotaWorkbook(SYNTHETIC_BOOK), { ...APP, collaborators: [edilfast] })
    const region = await within(dialog).findByRole("region", { name: "Collaborator Invoices" }, READ)
    expect(within(region).getAllByRole("listitem")).toHaveLength(1)
    expect(region).toHaveTextContent("Edilfast fattura SUP-05 (lavori Via Esempio)")
    expect(region).toHaveTextContent("Giugno, row 10 · Collaborator: Edilfast")
    const month = within(region).getByLabelText("For Month: Edilfast fattura SUP-05 (lavori Via Esempio)")
    expect(month).toHaveValue("2026-06")
    fireEvent.change(month, { target: { value: "2026-05" } })
    expect(within(region).getByLabelText("For Month: Edilfast fattura SUP-05 (lavori Via Esempio)")).toHaveValue("2026-05")
  })

  it("shows no Collaborator Invoices without a collaborator in the description", async () => {
    const dialog = await openWith(primaNotaWorkbook(SYNTHETIC_BOOK))
    await within(dialog).findByRole("region", { name: "What's in the File" }, READ)
    expect(within(dialog).queryByRole("region", { name: "Collaborator Invoices" })).not.toBeInTheDocument()
  })

  it("saves the report before writing when it replaces your rows, and deletes them last", async () => {
    const monitor: CompanyExpense = {
      id: "e1", description: "Monitor", category: "office_supplies", amount: 200, date: new Date(2026, 4, 20), isRecurring: false,
      recurrenceMonths: null, notes: "Bought for the office", accountId: null, paidByOwner: false, vat: null, documentRef: "R-9", project: null,
      recurringExpenseId: null, dateEstimated: false, importRef: null, collaboratorId: null, engagementId: null, forMonth: null, ...stamp,
    }
    const dialog = await openWith(primaNotaWorkbook(SYNTHETIC_BOOK), { ...APP, expenses: [monitor] })
    const already = await within(dialog).findByRole("region", { name: "Already in the App" }, READ)
    expect(already).toHaveTextContent("~01/05/2026, no day in the workbook")
    expect(already).toHaveTextContent("Replace keeps the app's 20/05/2026.")
    expect(already).toHaveTextContent("category Office Supplies · VAT not stated · document R-9")
    // The report can be read before importing.
    fireEvent.click(within(within(dialog).getByRole("region", { name: "What's in the File" })).getByRole("button", { name: "Download Report" }))
    expect(downloadCsv.mock.calls[0][0]).toMatch(/Not imported yet/)
    expect(downloadCsv.mock.calls[0][0]).toMatch(/Cost “Monitor”, 20\/05\/2026, €200.00, category Office Supplies, VAT not stated, document R-9, notes: Bought for the office/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept All Suggestions" }))
    fireEvent.change(within(room5(dialog)).getByRole("spinbutton", { name: "Part 1: amount" }), { target: { value: "700" } })
    fireEvent.change(within(room5(dialog)).getByRole("spinbutton", { name: "Part 2: amount" }), { target: { value: "700" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Import" }))
    expect(await within(dialog).findByText(/Imported: \d+ changes written\./, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(downloadCsv.mock.calls[1][0]).toMatch(/^Prima nota import report\nFile: synthetic.xlsx\nSaved before the import/)
    expect(downloadCsv.mock.invocationCallOrder[1]).toBeLessThan(db.createCompanyAccount.mock.invocationCallOrder[0])
    const lastWrite = Math.max(...Object.values(db).flatMap((m) => m.mock.invocationCallOrder))
    expect(db.deleteCompanyExpense.mock.invocationCallOrder[0]).toBe(lastWrite)
    expect(db.deleteCompanyExpense).toHaveBeenCalledWith("u1", "e1")
    // Done is not the way to lose the report: Download Report leads.
    const buttons = within(dialog).getAllByRole("button").map((b) => b.textContent)
    expect(buttons.indexOf("Download Report")).toBeGreaterThan(buttons.indexOf("Done"))
  })

  it("asks before Cancel, Esc or Change File throw your decisions away, and keeps them for the rows that did not change", async () => {
    const dialog = await openWith(primaNotaWorkbook(SYNTHETIC_BOOK))
    fireEvent.click(await within(dialog).findByRole("button", { name: "Accept All Suggestions" }, READ))
    expect(within(dialog).getByRole("status")).toHaveTextContent("Import is off until you decide 1 row.")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    const ask = await screen.findByRole("alertdialog", { name: "Discard Your Decisions?" })
    expect(ask).toHaveTextContent("You made 9 decisions in the import.")
    fireEvent.click(within(ask).getByRole("button", { name: "Keep Deciding" }))
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: "Escape" })
    expect(await screen.findByRole("alertdialog", { name: "Discard Your Decisions?" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Keep Deciding" }))
    // The same file again: every decision still fits its row.
    fireEvent.click(within(dialog).getByRole("button", { name: "Change File" }))
    expect(dialog).toHaveTextContent("Your decisions carry over to the rows that read the same")
    choose(dialog, primaNotaWorkbook(SYNTHETIC_BOOK))
    await within(dialog).findByRole("region", { name: "What's in the File" }, READ)
    expect(within(dialog).getByRole("status")).toHaveTextContent("Import is off until you decide 1 row.")
    // A row that changed starts over: the platform payout now arrives on the other bank.
    const moved = { ...SYNTHETIC_BOOK, months: SYNTHETIC_BOOK.months.map((m) => ({ ...m, rows: m.rows.map((r) => (r.c === "PLT-001" ? { ...r, money: { "Second Bank": 970 } } : r)) })) }
    fireEvent.click(within(dialog).getByRole("button", { name: "Change File" }))
    choose(dialog, primaNotaWorkbook(moved))
    await within(dialog).findByRole("region", { name: "What's in the File" }, READ)
    expect(within(dialog).getByRole("status")).toHaveTextContent("Import is off until you decide 2 rows.")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("names the sheet and column it can't read, never a cell", async () => {
    const dialog = await openWith(primaNotaWorkbook({ ...SYNTHETIC_BOOK, dropHeader: "Debito" }))
    expect(await within(dialog).findByRole("alert", {}, READ)).toHaveTextContent("Maggio, row 1: the column “Debito” is missing.")
  })

  it("refuses a second import and offers Undo Import", async () => {
    const imported = { ...APP, movements: [{ id: "m1", importRef: "2026:Maggio!7" } as CompanyMovement] }
    show(<ImportDialog userId="u1" open onOpenChange={() => {}} data={imported} onUndo={onUndo} />)
    const dialog = await screen.findByRole("dialog", { name: "Import Excel" })
    expect(dialog).toHaveTextContent("The workbook is already imported.")
    expect(within(dialog).getByLabelText("Workbook (.xlsx)")).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo Import" }))
    expect(onUndo).toHaveBeenCalled()
  })

  it("stops at a refused write and offers Undo Import", async () => {
    db.createCompanyLoan.mockRejectedValue(new Error("Amount must be positive"))
    const dialog = await openWith(primaNotaWorkbook(SYNTHETIC_BOOK))
    fireEvent.click(await within(dialog).findByRole("button", { name: "Accept All Suggestions" }, READ))
    const split = room5(dialog)
    fireEvent.change(within(split).getByRole("spinbutton", { name: "Part 2: amount" }), { target: { value: "700" } })
    fireEvent.change(within(split).getByRole("spinbutton", { name: "Part 1: amount" }), { target: { value: "700" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Import" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/The import stopped after \d+ of \d+ writes\.Amount must be positive/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo Import" }))
    expect(onUndo).toHaveBeenCalled()
    expect(onImported).not.toHaveBeenCalled()
  })
})

describe("Undo Import", () => {
  const t0 = new Date(2026, 9, 8, 10)
  const account: CompanyAccount = { id: "a1", name: "Main Bank", openingBalance: 0, openingDate: new Date(2026, 4, 1), statementBalance: 10, statementDate: new Date(2026, 7, 5), importRef: "2026:Saldo!2", ...stamp, createdAt: t0, updatedAt: t0 }
  const cost = (id: string, updatedAt: Date): CompanyExpense => ({
    id, userId: "u1", description: `Cost ${id}`, category: "other", amount: 10, date: new Date(2026, 4, 1), isRecurring: false, recurrenceMonths: null,
    notes: null, accountId: "a1", paidByOwner: false, vat: 0, documentRef: null, project: null, recurringExpenseId: null, dateEstimated: true,
    importRef: `2026:Maggio!${id}`, collaboratorId: null, engagementId: null, forMonth: null, createdAt: t0, updatedAt,
  })
  const data = {
    accounts: [account],
    invoices: [
      invoice({ id: "i1", clientId: "c1", number: "101/2026", amount: 10, vat: 0, paidDate: new Date(2026, 5, 12), paidAccountId: "a1", updatedAt: t0 }),
      // Marked paid into the imported account by the owner the next day: it keeps its account.
      invoice({ id: "i9", clientId: "c1", number: "109/2026", amount: 10, vat: 0, paidDate: new Date(2026, 6, 1), paidAccountId: "a1", updatedAt: new Date(2026, 9, 9) }),
      invoice({ id: "i4", clientId: "c1", number: "104/2026", amount: 10, vat: 0, paidDate: new Date(2026, 6, 1), paidAccountId: "non-cash", updatedAt: t0 }),
    ],
    expenses: [cost("2", t0), cost("3", new Date(2026, 9, 9))],
    loans: [],
    movements: [],
  }

  it("says what it removes, keeps a row edited since unless ticked, and deletes in order", async () => {
    show(<UndoImportDialog userId="u1" open onOpenChange={() => {}} data={data} />)
    const dialog = await screen.findByRole("dialog", { name: "Undo Import" })
    expect(dialog).toHaveTextContent("Deletes 1 record: 1 cost.")
    expect(dialog).toHaveTextContent("1 invoice it marked paid loses the account; the payment date stays, the workbook proved it: 101/2026.")
    expect(dialog).toHaveTextContent("Stays as the import left it: 1 invoice or credit note it settled with no money.")
    expect(dialog).not.toHaveTextContent("as before it")
    expect(dialog).toHaveTextContent("Changed since the import: kept, unless you tick the box.Cost 3, 01/05/2026")
    expect(dialog).not.toHaveTextContent("Deletes the 1 account")
    expect(dialog).toHaveTextContent("Keeps Main Bank")
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Also delete this row" }))
    expect(dialog).toHaveTextContent("Deletes 2 records: 2 costs.")
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo Import" }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Import undone: 2 records deleted, 1 invoice without the account." }))
    expect(db.deleteCompanyExpense.mock.calls.map((c) => c[1])).toEqual(["2", "3"])
    expect(db.updateInvoice.mock.calls).toEqual([["u1", "i1", { paidAccountId: null }]])
    // The owner's invoice 109/2026 still uses the account: it stays.
    expect(db.deleteCompanyAccount).not.toHaveBeenCalled()
  })

  it("deletes the account it created once nothing of yours uses it", async () => {
    const alone = { ...data, invoices: data.invoices.filter((i) => i.id !== "i9") }
    show(<UndoImportDialog userId="u1" open onOpenChange={() => {}} data={alone} />)
    const dialog = await screen.findByRole("dialog", { name: "Undo Import" })
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Also delete this row" }))
    expect(dialog).toHaveTextContent("Deletes the 1 account it created.")
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo Import" }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Import undone: 2 records deleted, 1 invoice without the account, 1 account deleted." }))
    expect(db.deleteCompanyAccount.mock.invocationCallOrder[0]).toBeGreaterThan(db.updateInvoice.mock.invocationCallOrder[0])
  })
})
