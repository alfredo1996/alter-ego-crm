/**
 * Month End's in-place fixes on the mock backend, over a fixed clock: 2 October
 * 2026, closing September, made-up names and amounts. Each fix opens the window
 * the other pages use, prefilled and dated in September where the date decides
 * it (not 2 October, which would put the payment or the check in October), and
 * the step turns green once it is saved, with no reload. The page itself is
 * month-end-shell.test.tsx; the rules lib/__tests__/month-end.test.ts.
 */
import { Toaster } from "@alter-ego/ui/ui/toaster"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { getBackend } from "@/lib/backend"
import { __resetMockState, createMockAdapter } from "@/lib/backend/mock"

import { MonthEndShell } from "../month-end-shell"

import type { CreateEngagementInput } from "@/types"

vi.mock("@/lib/backend", async () => {
  const { createMockAdapter: mock } = await import("@/lib/backend/mock")
  const adapter = mock()
  return { getBackend: () => adapter }
})
const off = vi.hoisted(() => new Set<string>())
vi.mock("@/modules", async (actual) => ({ ...(await actual<Record<string, unknown>>()), isModuleOn: (id: string) => !off.has(id) }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const U = "u1"
const db = createMockAdapter().db
const d = (day: string) => new Date(`${day}T00:00:00`)

async function contract(client: string, name: string, days: number, o: Partial<CreateEngagementInput> = {}) {
  const clientId = (await db.createClient(U, { name: client })).id
  const engagementId = (
    await db.createEngagement(U, { clientId, name, dailyRate: 450, vatApplicable: true, defaultDaysPerMonth: days, startMonth: "2026-08", ...o })
  ).id
  return { clientId, engagementId }
}
async function hours(engagementId: string, ym: string, days: number) {
  for (let k = 1; k <= days; k++) await db.setTimecard(U, { engagementId, date: `${ym}-${String(k).padStart(2, "0")}`, hours: 8 })
}

// Date only: fake timers would stall TanStack and findBy.
beforeAll(() => vi.setSystemTime(new Date(2026, 9, 2, 12)))
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  off.clear()
  __resetMockState()
  localStorage.clear()
})

async function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MonthEndShell />
      <Toaster />
    </QueryClientProvider>,
  )
  await screen.findByRole("heading", { name: "Month End", level: 1 })
}
const verdict = () => screen.getByRole("region", { name: "Verdict" })
const card = (name: string) => screen.getByRole("region", { name })
/** Waits for a step's badge: the page recomputes once the fix's refetch lands. */
const badge = (step: string, label: "Done" | "To Do" | "Check") => waitFor(() => expect(within(card(step)).getByText(label)).toBeInTheDocument())
const undo = async () => fireEvent.click(await screen.findByRole("button", { name: "Undo" }))

/** Radix Select by keyboard: happy-dom has no pointer capture. */
async function pick(scope: HTMLElement, label: string, option: string) {
  fireEvent.keyDown(within(scope).getByRole("combobox", { name: label }), { key: "Enter" })
  fireEvent.keyDown(await screen.findByRole("option", { name: option }), { key: "Enter" })
}

describe("Month End's fixes", () => {
  it("Use writes the month's hours into the plan, and Undo takes them out again", async () => {
    const lumen = await contract("Lumen Srl", "Retainer", 10)
    await hours(lumen.engagementId, "2026-08", 10)
    await hours(lumen.engagementId, "2026-09", 9)
    await show()
    await badge("Hours", "To Do")
    fireEvent.click(within(card("Hours")).getByRole("button", { name: "Use 9 d" }))
    await badge("Hours", "Done")
    expect(await screen.findByText("9 d used: Lumen Srl · Retainer, September 2026")).toBeInTheDocument()
    expect((await db.getAllocations(U)).map((a) => [a.yearMonth, a.days])).toEqual([["2026-09", 9]])

    await undo()
    await badge("Hours", "To Do")
    expect(await db.getAllocations(U)).toEqual([])
  })

  it("Use All writes every contract's hours at once, and Undo puts each month back", async () => {
    const lumen = await contract("Lumen Srl", "Retainer", 10)
    const verdi = await contract("Studio Verdi", "Support", 6)
    await db.createAllocation(U, { engagementId: verdi.engagementId, yearMonth: "2026-09", days: 4 })
    await hours(lumen.engagementId, "2026-09", 9)
    await hours(verdi.engagementId, "2026-09", 5)
    await show()
    fireEvent.click(within(card("Hours")).getByRole("button", { name: "Use All (2)" }))
    await badge("Hours", "Done")
    expect(await screen.findByText("Hours used on 2 contracts, September 2026")).toBeInTheDocument()
    expect((await db.getAllocations(U)).map((a) => a.days).sort()).toEqual([5, 9])

    await undo()
    await badge("Hours", "To Do")
    // Lumen had no row, so it has none again; Studio Verdi's 4 days are back.
    expect((await db.getAllocations(U)).map((a) => [a.engagementId, a.days])).toEqual([[verdi.engagementId, 4]])
  })

  it("No Work sets a planned month with no hours to 0 days, with Undo", async () => {
    const rossi = await contract("Bottega Rossi", "Support", 4)
    await hours(rossi.engagementId, "2026-08", 4)
    await show()
    const hoursCard = within(card("Hours"))
    expect(hoursCard.getByText("Bottega Rossi · Support: no hours logged")).toBeInTheDocument()
    expect(hoursCard.getByRole("link", { name: "Log Hours" })).toHaveAttribute("href", "/plan?week=2026-09-07")
    fireEvent.click(hoursCard.getByRole("button", { name: "No Work" }))
    await badge("Hours", "Done")
    expect(within(card("Hours")).getByText("Bottega Rossi · Support: no work (0 days)")).toBeInTheDocument()
    expect(await screen.findByText("No work: Bottega Rossi · Support, September 2026, set to 0 days.")).toBeInTheDocument()
    // An explicit 0, not a deleted row: the contract default would plan 4 days again.
    expect((await db.getAllocations(U)).map((a) => [a.yearMonth, a.days])).toEqual([["2026-09", 0]])

    await undo()
    await badge("Hours", "To Do")
  })

  it("Attach File stores the file on the cost in place, and the row leaves Invoice Files", async () => {
    const lumen = await contract("Lumen Srl", "Retainer", 10)
    await hours(lumen.engagementId, "2026-08", 10)
    await hours(lumen.engagementId, "2026-09", 10)
    const hosting = await db.createCompanyExpense(U, { description: "Hosting", category: "software", amount: 41.2, date: d("2026-09-03"), documentRef: "EU-1" })
    await show()
    const files = within(card("Invoice Files"))
    expect(files.getByText("Cost · 3 Sep · €41.20 · Invoice EU-1")).toBeInTheDocument()
    fireEvent.click(files.getByRole("button", { name: "Attach File" }))
    const pdf = new File(["%PDF"], "EU-1.pdf", { type: "application/pdf" })
    fireEvent.change(screen.getByLabelText("Choose invoice file"), { target: { files: [pdf] } })
    await badge("Invoice Files", "Done")
    expect(await screen.findByText("Attached EU-1.pdf.")).toBeInTheDocument()
    const stored = (await db.getCompanyExpenses(U)).find((e) => e.id === hosting.id)?.file
    expect(stored).toMatchObject({ name: "EU-1.pdf", kind: "pdf", size: 4 })
  })

  it("Attach File shows Attaching and disables the row's button until the upload ends", async () => {
    const lumen = await contract("Lumen Srl", "Retainer", 10)
    await hours(lumen.engagementId, "2026-08", 10)
    await hours(lumen.engagementId, "2026-09", 10)
    await db.createCompanyExpense(U, { description: "Hosting", category: "software", amount: 41.2, date: d("2026-09-03") })
    await show()
    const files = within(card("Invoice Files"))
    const real = getBackend().files.upload.bind(getBackend().files)
    let release = () => {}
    const spy = vi.spyOn(getBackend().files, "upload").mockImplementation((...a) => new Promise((r) => (release = () => r(real(...a)))).then((x) => x as never))
    fireEvent.click(files.getByRole("button", { name: "Attach File" }))
    fireEvent.change(screen.getByLabelText("Choose invoice file"), { target: { files: [new File(["%PDF"], "EU-1.pdf", { type: "application/pdf" })] } })
    const busy = await files.findByRole("button", { name: "Attaching…" })
    expect(busy).toBeDisabled()
    release()
    await badge("Invoice Files", "Done")
    spy.mockRestore()
  })

  it("Attach File refuses a file that is not an XML or a PDF and changes nothing", async () => {
    const lumen = await contract("Lumen Srl", "Retainer", 10)
    await hours(lumen.engagementId, "2026-08", 10)
    await hours(lumen.engagementId, "2026-09", 10)
    const hosting = await db.createCompanyExpense(U, { description: "Hosting", category: "software", amount: 41.2, date: d("2026-09-03") })
    await show()
    fireEvent.click(within(card("Invoice Files")).getByRole("button", { name: "Attach File" }))
    fireEvent.change(screen.getByLabelText("Choose invoice file"), { target: { files: [new File(["x"], "notes.docx")] } })
    expect(await screen.findByText("notes.docx can't be attached: use the XML, the signed .p7m, or a PDF.")).toBeInTheDocument()
    expect((await db.getCompanyExpenses(U)).find((e) => e.id === hosting.id)?.file ?? null).toBeNull()
  })

  // The plan's example A.
  it("records the missing invoice from its draft and moves a misdated one to its month, closing September", async () => {
    const lumen = await contract("Lumen Srl", "Retainer", 9)
    const verdi = await contract("Studio Verdi", "Support", 6, { endMonth: "2026-08" })
    await hours(lumen.engagementId, "2026-08", 9)
    await hours(lumen.engagementId, "2026-09", 9)
    await hours(verdi.engagementId, "2026-08", 6)
    await db.createInvoice(U, { clientId: lumen.clientId, number: "14/2026", yearMonth: "2026-08", amount: 4050, vat: 891, dueDate: d("2026-09-30") })
    // Studio Verdi's August, recorded on October.
    await db.createInvoice(U, { clientId: verdi.clientId, number: "15/2026", yearMonth: "2026-10", amount: 2700, vat: 594 })
    await show()
    expect(verdict()).toHaveTextContent("September 2026: 1 step to do (Invoices)")
    const invoices = within(card("Invoices"))
    expect(invoices.getByText("Lumen Srl, September 2026: €4,050.00 not invoiced")).toBeInTheDocument()
    expect(invoices.getByText("Is 15/2026 (Oct 2026) the August invoice? Edit its period.")).toBeInTheDocument()

    fireEvent.click(invoices.getByRole("button", { name: "Record Invoice" }))
    let sheet = within(await screen.findByRole("dialog", { name: "Record Invoice" }))
    // As Ready to Invoice drafts it: September, the next number, the last terms, the hours' amount.
    await waitFor(() => expect(sheet.getByLabelText("Invoice number")).toHaveValue("16/2026"))
    expect(sheet.getByRole("combobox", { name: "From" })).toHaveTextContent("Sep 2026")
    expect(sheet.getByRole("combobox", { name: "To" })).toHaveTextContent("Sep 2026")
    expect(sheet.getByLabelText("Net amount")).toHaveValue(4050)
    expect(sheet.getByLabelText("Due date")).toHaveValue("2026-10-31")
    fireEvent.click(sheet.getByRole("button", { name: "Record Invoice" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(within(card("Invoices")).queryByText(/Lumen Srl, September 2026/)).toBeNull())

    fireEvent.click(within(card("Invoices")).getByRole("button", { name: "Edit Period" }))
    const dialog = await screen.findByRole("dialog", { name: "Invoice 15/2026" })
    sheet = within(dialog)
    expect(sheet.getByRole("combobox", { name: "From" })).toHaveTextContent("Oct 2026")
    await pick(dialog, "From", "Aug 2026")
    await pick(dialog, "To", "Aug 2026")
    fireEvent.click(sheet.getByRole("button", { name: "Save Changes" }))
    await badge("Invoices", "Done")
    expect(verdict()).toHaveTextContent("September 2026 is closed: every required step is done.")
    fireEvent.click(within(card("Invoices")).getByText("What was checked (1)"))
    expect(within(card("Invoices")).getByText("Lumen Srl: covered by 16/2026 (Sep 2026)")).toBeVisible()
  })

  it("offers no Mark Paid on a Missing IN, and names no invoice, when invoicing is off", async () => {
    off.add("invoicing")
    const nordica = (await db.createClient(U, { name: "Nordica Spa" })).id
    await db.createCompanyAccount(U, { name: "Main Bank", openingBalance: 1000, openingDate: d("2026-07-01"), statementBalance: 2830, statementDate: d("2026-09-30") })
    await db.createInvoice(U, { clientId: nordica, number: "12/2026", yearMonth: "2026-08", amount: 1500, vat: 330 })
    await show()
    const bank = within(card("Bank"))
    expect(bank.getByText("Main Bank: Missing IN of €1,830.00 on 30/09/2026")).toBeInTheDocument()
    expect(bank.getByRole("button", { name: "Check Balance" })).toBeInTheDocument()
    expect(bank.queryByRole("button", { name: /^Mark .* Paid$/ })).toBeNull()
    expect(card("Bank")).not.toHaveTextContent("12/2026")
  })

  // The plan's example B.
  it("marks the invoice a Missing IN matches paid on the check's day, not today, and the bank then matches", async () => {
    const nordica = (await db.createClient(U, { name: "Nordica Spa" })).id
    // 1,000 in the book on 30/09, 2,830 in the bank: an IN of 1,830 is missing.
    await db.createCompanyAccount(U, { name: "Main Bank", openingBalance: 1000, openingDate: d("2026-07-01"), statementBalance: 2830, statementDate: d("2026-09-30") })
    await db.createInvoice(U, { clientId: nordica, number: "12/2026", yearMonth: "2026-08", amount: 1500, vat: 330 })
    await show()
    expect(verdict()).toHaveTextContent("September 2026: 1 step to do (Bank)")
    const bank = within(card("Bank"))
    expect(bank.getByText("Main Bank: Missing IN of €1,830.00 on 30/09/2026")).toBeInTheDocument()

    // Waiting for Payment lists it too, above the Bank: its Mark Paid dates it as the Bank does, not today.
    const waiting = within(card("Waiting for Payment"))
    expect(waiting.getByText("Unpaid, no due date: it never reaches Deadlines. It may be the Missing IN on Main Bank.")).toBeInTheDocument()
    fireEvent.click(waiting.getByRole("button", { name: "Mark Paid" }))
    let popup = within(await screen.findByRole("dialog", { name: "Mark 12/2026 Paid" }))
    expect(popup.getByLabelText("Paid on")).toHaveValue("2026-09-30")
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    const trigger = bank.getByRole("button", { name: "Mark 12/2026 Paid" })
    expect(trigger).toHaveAccessibleDescription("To do: Main Bank: Missing IN of €1,830.00 on 30/09/2026")
    trigger.focus()
    fireEvent.click(trigger)
    popup = within(await screen.findByRole("dialog", { name: "Mark 12/2026 Paid" }))
    expect(popup.getByLabelText("Paid on")).toHaveValue("2026-09-30")
    expect(popup.getByText("Change it if the money moved on another day.")).toBeInTheDocument()
    expect(popup.getByRole("combobox", { name: "Into Account" })).toHaveTextContent("Main Bank")
    fireEvent.click(popup.getByRole("button", { name: "Mark Paid" }))
    await badge("Bank", "Done")
    expect(verdict()).toHaveTextContent("September 2026 is closed: every required step is done.")
    // The button went with the item: the step takes focus, not the page body.
    await waitFor(() => expect(document.activeElement).toBe(card("Bank")))
    expect(within(card("Waiting for Payment")).queryByText(/12\/2026/)).toBeNull()
    const [paid] = await db.getInvoices(U)
    expect(paid.paidDate).toEqual(d("2026-09-30"))

    await undo()
    await badge("Bank", "To Do")
  })

  it("marks a Missing IN's invoice paid into that account, not the last one used, from Waiting for Payment too", async () => {
    const nordica = (await db.createClient(U, { name: "Nordica Spa" })).id
    await db.createCompanyAccount(U, { name: "Main Bank", openingBalance: 1000, openingDate: d("2026-07-01"), statementBalance: 2830, statementDate: d("2026-09-30") })
    const card2 = await db.createCompanyAccount(U, { name: "Company Card", openingBalance: 200, openingDate: d("2026-07-01"), statementBalance: 200, statementDate: d("2026-09-30") })
    await db.createInvoice(U, { clientId: nordica, number: "12/2026", yearMonth: "2026-08", amount: 1500, vat: 330, dueDate: d("2026-09-15") })
    // Company Card was picked last, say for a cost paid by card.
    localStorage.setItem("cash-book:last-account", card2.id)
    await show()
    fireEvent.click(within(card("Bank")).getByRole("button", { name: "Mark 12/2026 Paid" }))
    let popup = within(await screen.findByRole("dialog", { name: "Mark 12/2026 Paid" }))
    expect(popup.getByRole("combobox", { name: "Into Account" })).toHaveTextContent("Main Bank")
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    // Overdue, so Waiting lists it first: the owner going top to bottom fixes it there.
    const trigger = within(card("Waiting for Payment")).getByRole("button", { name: "Mark Paid" })
    expect(trigger).toHaveAccessibleDescription("To check: Invoice 12/2026 · Nordica Spa, €1,830.00")
    trigger.focus()
    fireEvent.click(trigger)
    popup = within(await screen.findByRole("dialog", { name: "Mark 12/2026 Paid" }))
    expect(popup.getByLabelText("Paid on")).toHaveValue("2026-09-30")
    expect(popup.getByRole("combobox", { name: "Into Account" })).toHaveTextContent("Main Bank")
    fireEvent.click(popup.getByRole("button", { name: "Mark Paid" }))
    await badge("Bank", "Done")
    expect(verdict()).toHaveTextContent("September 2026 is closed: every required step is done.")
    await waitFor(() => expect(document.activeElement).toBe(card("Waiting for Payment")))
    const [paid] = await db.getInvoices(U)
    expect(paid.paidAccountId).not.toBe(card2.id)
    expect(paid.paidDate).toEqual(d("2026-09-30"))
  })

  it("opens Check Balance on the month's last day, and a matching balance closes the bank", async () => {
    await db.createCompanyAccount(U, { name: "Main Bank", openingBalance: 500, openingDate: d("2026-09-01") })
    await db.createCompanyAccount(U, { name: "Second Bank", openingBalance: 0, openingDate: d("2026-11-01") })
    await show()
    fireEvent.click(within(card("Bank")).getByRole("button", { name: "Check Balance" }))
    const dialog = within(await screen.findByRole("dialog", { name: "Check Balance" }))
    // The item's own account, on 30/09: not today, which is in October.
    expect(dialog.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Main Bank"])
    expect(dialog.getByLabelText("On")).toHaveValue("2026-09-30")
    fireEvent.change(dialog.getByLabelText("Bank Balance"), { target: { value: "500" } })
    expect(dialog.getByText("Matches the bank on 30/09/2026")).toBeInTheDocument()
    fireEvent.click(dialog.getByRole("button", { name: "Save Check" }))
    await badge("Bank", "Done")
    fireEvent.click(within(card("Bank")).getByText("What was checked (1)"))
    expect(within(card("Bank")).getByText("Main Bank: Matches the bank on 30/09/2026")).toBeVisible()
  })

  it("records a recurring cost's payment dated the month's last day", async () => {
    const lumen = await contract("Lumen Srl", "Retainer", 10)
    await hours(lumen.engagementId, "2026-09", 10)
    await db.createCompanyExpense(U, { description: "Accountant fee", category: "accountant", amount: 250, vat: 55, date: d("2026-01-01"), isRecurring: true, recurrenceMonths: 1 })
    await show()
    await badge("Recurring Costs", "Check")
    fireEvent.click(within(card("Recurring Costs")).getByRole("button", { name: "Record Payment" }))
    const dialog = within(await screen.findByRole("dialog", { name: "Record Payment" }))
    expect(dialog.getByLabelText("Date")).toHaveValue("2026-09-30")
    expect(dialog.getByLabelText("Description")).toHaveValue("Accountant fee")
    fireEvent.click(dialog.getByRole("button", { name: "Record Payment" }))
    await badge("Recurring Costs", "Done")
    const payment = (await db.getCompanyExpenses(U)).find((e) => !e.isRecurring)
    expect(payment?.date).toEqual(d("2026-09-30"))
  })

  // The plan's example C.
  it("links a forgotten payment to its estimate, and moves a payment made just after the month end into it", async () => {
    const lumen = await contract("Lumen Srl", "Retainer", 10)
    await hours(lumen.engagementId, "2026-09", 10)
    const fee = await db.createCompanyExpense(U, { description: "Accountant fee", category: "accountant", amount: 250, date: d("2026-01-01"), isRecurring: true, recurrenceMonths: 1 })
    await db.createCompanyExpense(U, { description: "Commercialista settembre", category: "accountant", amount: 250, date: d("2026-09-12"), paidByOwner: true, documentRef: "R 12" })
    const rent = await db.createCompanyExpense(U, { description: "Office rent", category: "rent", amount: 900, date: d("2026-01-01"), isRecurring: true, recurrenceMonths: 1 })
    await db.createCompanyExpense(U, { description: "Rent", category: "rent", amount: 900, date: d("2026-10-02"), paidByOwner: true, documentRef: "R 13", recurringExpenseId: rent.id })
    await show()
    const recurring = within(card("Recurring Costs"))
    expect(recurring.getByText('Paid as "Commercialista settembre" on 12/09? Link it to the estimate.')).toBeInTheDocument()

    fireEvent.click(recurring.getByRole("button", { name: "Link" }))
    let dialog = within(await screen.findByRole("dialog", { name: "Edit Cost" }))
    expect(dialog.getByLabelText("Description")).toHaveValue("Commercialista settembre")
    expect(dialog.getByRole("combobox", { name: "Pays Recurring Cost" })).toHaveTextContent("Accountant fee · €250.00 every month")
    fireEvent.click(dialog.getByRole("button", { name: "Save Changes" }))
    await waitFor(() => expect(within(card("Recurring Costs")).queryByText(/Accountant fee/)).toBeNull())
    expect((await db.getCompanyExpenses(U)).find((e) => e.description === "Commercialista settembre")?.recurringExpenseId).toBe(fee.id)

    fireEvent.click(within(card("Recurring Costs")).getByRole("button", { name: "Edit Date" }))
    dialog = within(await screen.findByRole("dialog", { name: "Edit Cost" }))
    expect(dialog.getByLabelText("Date")).toHaveValue("2026-10-02")
    fireEvent.change(dialog.getByLabelText("Date"), { target: { value: "2026-09-30" } })
    fireEvent.click(dialog.getByRole("button", { name: "Save Changes" }))
    await badge("Recurring Costs", "Done")
  })

  it("marks an own deadline done, with Undo", async () => {
    const lumen = await contract("Lumen Srl", "Retainer", 10)
    await hours(lumen.engagementId, "2026-09", 10)
    await db.createInvoice(U, { clientId: lumen.clientId, number: "16/2026", yearMonth: "2026-09", amount: 4500, vat: 990 })
    await db.createCompanyDeadline(U, { title: "Insurance renewal", date: d("2026-09-20"), kind: "admin", amount: 300 })
    await show()
    expect(verdict()).toHaveTextContent("September 2026: 1 step to do (Deadlines)")
    fireEvent.click(within(card("Deadlines")).getByRole("button", { name: "Mark Done" }))
    await badge("Deadlines", "Done")
    expect(verdict()).toHaveTextContent("September 2026 is closed: every required step is done.")
    expect(await screen.findByText("Done: Insurance renewal.")).toBeInTheDocument()

    await undo()
    await badge("Deadlines", "To Do")
  })

  it("opens Export for other periods on the page's month", async () => {
    await db.createCompanyAccount(U, { name: "Main Bank", openingBalance: 500, openingDate: d("2026-07-01") })
    await show()
    fireEvent.click(screen.getByRole("button", { name: "Other Periods" }))
    const dialog = within(await screen.findByRole("dialog", { name: "Export" }))
    expect(dialog.getByRole("combobox", { name: "Period" })).toHaveTextContent("A Month")
    expect(dialog.getByRole("combobox", { name: "Month" })).toHaveTextContent("September 2026")
  })
})
