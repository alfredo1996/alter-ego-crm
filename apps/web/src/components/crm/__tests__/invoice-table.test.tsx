/**
 * The invoice list and Mark Paid over a fixed clock (1 Oct 2026), on the
 * review's seed: Lumon has 14/2026 overdue with NC 2/2026 open on the same
 * month, Nordic a paid quarter. The wording itself is invoiceStatus
 * (lib/__tests__/invoices.test.ts); this checks the rows read it in the right
 * order and that Mark Paid writes, and Undo clears, every date it set.
 */
import { Toaster } from "@alter-ego/ui/ui/toaster"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"


import { InvoiceTable } from "../invoice-table"

import type { CompanyAccount, Invoice } from "@/types"

const at = new Date(2026, 6, 1)
const invoice = (o: Partial<Invoice> & Pick<Invoice, "id" | "number" | "yearMonth" | "amount" | "vat">): Invoice => ({
  userId: "u1", clientId: "c1", engagementId: null, fromMonth: null, dueDate: null, paidDate: null, paidAccountId: null,
  createdAt: at, updatedAt: at, ...o,
})

const INVOICES = [
  invoice({
    id: "i9", clientId: "c2", number: "9/2026", fromMonth: "2026-04", yearMonth: "2026-06", amount: 7500,
    vat: 1650, dueDate: new Date(2026, 6, 31), paidDate: new Date(2026, 6, 31), createdAt: new Date(2026, 6, 1),
  }),
  invoice({
    id: "i14", number: "14/2026", yearMonth: "2026-07", amount: 14000, vat: 0,
    dueDate: new Date(2026, 7, 31), createdAt: new Date(2026, 7, 2),
  }),
  invoice({ id: "nc2", number: "NC 2/2026", yearMonth: "2026-07", amount: -700, vat: 0, createdAt: new Date(2026, 7, 20) }),
  invoice({
    id: "nc1", number: "NC 1/2026", yearMonth: "2026-06", amount: -100, vat: 0,
    paidDate: new Date(2026, 8, 3), createdAt: new Date(2026, 8, 1),
  }),
  invoice({
    id: "i17", number: "17/2026", yearMonth: "2026-08", amount: 6300, vat: 0,
    dueDate: new Date(2026, 9, 31), createdAt: new Date(2026, 8, 2),
  }),
  invoice({ id: "i18", clientId: "c2", number: "18/2026", yearMonth: "2026-09", amount: 1000, vat: 220, createdAt: new Date(2026, 9, 1) }),
  invoice({
    id: "i3", clientId: "c2", number: "3/2025", yearMonth: "2025-06", amount: 2000, vat: 440,
    paidDate: new Date(2025, 7, 1), createdAt: new Date(2025, 6, 1),
  }),
]
const CUSTOMERS = [
  { id: "c1", name: "Lumon Limited" },
  { id: "c2", name: "Nordic Retail SRL" },
]

const updateInvoice = vi.fn()
const getCompanyAccounts = vi.fn()
const createCompanyExpense = vi.fn()
const deleteCompanyExpense = vi.fn()
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ db: { updateInvoice, getCompanyAccounts, createCompanyExpense, deleteCompanyExpense } }),
}))

// Date only: fake timers would stall TanStack and findBy.
beforeAll(() => vi.setSystemTime(new Date(2026, 9, 1, 12)))
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  updateInvoice.mockReset().mockResolvedValue(undefined)
  // No cash book account: Mark Paid asks for the day alone, as before the cash book.
  getCompanyAccounts.mockReset().mockResolvedValue([])
  createCompanyExpense.mockReset().mockResolvedValue({ id: "fee1" })
  deleteCompanyExpense.mockReset().mockResolvedValue(undefined)
  localStorage.clear()
})

type Narrowing = Pick<Parameters<typeof InvoiceTable>[0], "tab" | "match">

function show(narrowing: Narrowing = {}) {
  const onOpen = vi.fn()
  const client = new QueryClient()
  const tree = (invoices: Invoice[], { tab, match }: Narrowing, key = "all") => (
    <QueryClientProvider client={client}>
      <InvoiceTable
        // BillingShell's part: a new status tab is a new table.
        key={key}
        userId="u1"
        invoices={invoices}
        engagements={[]}
        customers={CUSTOMERS}
        firstMonth="2025-11"
        onOpen={onOpen}
        tab={tab}
        match={match}
      />
      <Toaster />
    </QueryClientProvider>
  )
  const { rerender } = render(tree(INVOICES, narrowing))
  return {
    onOpen,
    /** The body's rows: the header and the totals aside. */
    rows: () => within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row"),
    /** The desktop's totals row; a phone's one-line copy comes first. */
    footer: () => within(screen.getAllByRole("rowgroup")[2]).getAllByRole("row")[1],
    /** The list refetched. */
    update: (invoices: Invoice[], next: Narrowing = narrowing, key?: string) => rerender(tree(invoices, next, key)),
  }
}

/** The popup is named by its heading: "Mark 14/2026 Paid", "Settle NC 2/2026". */
const popupName = (number: string) => (number.startsWith("NC") ? `Settle ${number}` : `Mark ${number} Paid`)

async function markPaid(number: string) {
  const row = screen.getAllByRole("row").find((r) => within(r).queryByRole("button", { name: number }))!
  fireEvent.click(within(row).getByRole("button", { name: /^(Mark Paid|Settle)$/ }))
  return screen.findByRole("dialog", { name: popupName(number) })
}

describe("InvoiceTable", () => {
  it("lists newest work month first, each with its status pill in its tone and its action", () => {
    const { rows } = show()
    const expected: [string, string, string, string | null][] = [
      ["18/2026", "Unpaid", "bg-warning-soft", "Mark Paid"],
      ["17/2026", "Unpaid · due 31 Oct", "bg-warning-soft", "Mark Paid"],
      ["NC 2/2026", "Credit note · open", "bg-muted", "Settle"],
      ["14/2026", "Overdue · due 31 Aug", "bg-danger-soft", "Mark Paid"],
      ["NC 1/2026", "Credit note · settled 3 Sep", "bg-success-soft", null],
      ["9/2026", "Paid 31 Jul", "bg-success-soft", null],
    ]
    expect(rows()).toHaveLength(expected.length)
    rows().forEach((row, k) => {
      const [number, status, tone, action] = expected[k]
      expect(within(row).getByRole("button", { name: number })).toBeInTheDocument()
      // Twice in the DOM: the Status column, and the phone's second line (CSS shows one).
      const pills = within(row).getAllByText(status)
      expect(pills).toHaveLength(2)
      for (const pill of pills) expect(pill).toHaveClass(tone)
      const buttons = within(row).getAllByRole("button").map((b) => b.textContent)
      expect(buttons.slice(1)).toEqual(action ? [action] : [])
    })
    // The danger tone: a soft red pill with its word, not a solid red slab.
    expect(within(rows()[3]).getAllByText("Overdue · due 31 Aug")[0]).toHaveClass("text-danger-soft-foreground")
    expect(within(rows()[3]).getAllByText("Overdue · due 31 Aug")[0]).not.toHaveClass("bg-destructive")
    // A squeezed one breaks after the "·" only: "Overdue ·" over "due 31 Aug".
    expect(within(rows()[3]).getAllByText("Overdue · due 31 Aug")[0].textContent).toBe("Overdue\u00a0· due\u00a031\u00a0Aug")
    expect(within(rows()[5]).getAllByText("Nordic Retail SRL")).not.toHaveLength(0)
    expect(within(rows()[5]).getAllByText("€9,150.00")).not.toHaveLength(0)

    // Paid before the chart's first month: folded, one click away.
    fireEvent.click(screen.getByRole("button", { name: "Show 1 older invoice" }))
    expect(within(rows()[6]).getAllByText("Paid 1 Aug 2025")).not.toHaveLength(0)
  })

  it("totals the rows it shows, and what of them is unpaid per customer", () => {
    const { footer } = show()
    const cells = within(footer()).getAllByRole("cell").map((c) => c.textContent)
    // Six rows (3/2025 folded): the net and VAT columns, then incl. VAT.
    expect(within(footer()).getByRole("rowheader")).toHaveTextContent("6 invoices")
    expect(cells).toContain("€28,000.00")
    expect(cells).toContain("€1,870.00")
    expect(cells).toContain("€29,870.00")
    // Lumon owes 17, 14 less NC 2; Nordic 18.
    expect(cells).toContain("€20,820.00 unpaid")
  })

  it("keeps a row the status tab no longer holds until the tab changes, and narrows by match live", () => {
    const unpaid = (i: Invoice) => !i.paidDate
    const { rows, update } = show({ tab: unpaid })
    const numbers = () => rows().map((r) => within(r).getAllByRole("button")[0].textContent)
    expect(numbers()).toEqual(["18/2026", "17/2026", "NC 2/2026", "14/2026"])

    // Paid: it keeps its place, its pill says so.
    const paid = INVOICES.map((i) => (i.id === "i17" ? { ...i, paidDate: new Date(2026, 9, 1) } : i))
    update(paid)
    expect(numbers()).toEqual(["18/2026", "17/2026", "NC 2/2026", "14/2026"])
    expect(within(rows()[1]).getAllByText("Paid 1 Oct")).not.toHaveLength(0)

    // The search is not the tab: it narrows at once, both ways.
    update(paid, { tab: unpaid, match: (i) => i.number.startsWith("1") })
    expect(numbers()).toEqual(["18/2026", "17/2026", "14/2026"])

    // Another tab, or back to this one: a new table, the paid invoice gone from Unpaid.
    update(paid, { tab: unpaid }, "unpaid-again")
    expect(numbers()).toEqual(["18/2026", "NC 2/2026", "14/2026"])
  })

  it("opens the sheet from the row or its number, never from Mark Paid", async () => {
    const { onOpen } = show()
    fireEvent.click(screen.getAllByText("€6,300.00")[0])
    expect(onOpen).toHaveBeenLastCalledWith("i17")
    fireEvent.click(screen.getByRole("button", { name: "14/2026" }))
    expect(onOpen).toHaveBeenLastCalledWith("i14")
    expect(onOpen).toHaveBeenCalledTimes(2)

    const popup = await markPaid("17/2026")
    fireEvent.click(within(popup).getByLabelText("Paid on"))
    expect(onOpen).toHaveBeenCalledTimes(2)
  })
})

describe("MarkPaid", () => {
  it("stamps the chosen date on the invoice and the ticked credit note; Undo clears both", async () => {
    const { onOpen } = show()
    const popup = await markPaid("14/2026")
    expect(within(popup).getByRole("heading", { name: "Mark 14/2026 Paid" })).toBeInTheDocument()
    expect(within(popup).getByLabelText("Paid on")).toHaveValue("2026-10-01")
    expect(within(popup).getByRole("checkbox", { name: "Also settle NC 2/2026" })).toBeChecked()
    expect(within(popup).getByText("€13,300.00")).toBeInTheDocument()

    fireEvent.change(within(popup).getByLabelText("Paid on"), { target: { value: "2026-09-30" } })
    fireEvent.click(within(popup).getByRole("button", { name: "Mark Paid" }))
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledTimes(2))
    expect(updateInvoice).toHaveBeenCalledWith("u1", "i14", { paidDate: new Date(2026, 8, 30) })
    expect(updateInvoice).toHaveBeenCalledWith("u1", "nc2", { paidDate: new Date(2026, 8, 30) })
    expect(await screen.findByText("Invoice 14/2026 marked paid on 30 Sep. NC 2/2026 settled too.")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Mark 14/2026 Paid" })).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledTimes(4))
    expect(updateInvoice).toHaveBeenCalledWith("u1", "i14", { paidDate: null })
    expect(updateInvoice).toHaveBeenCalledWith("u1", "nc2", { paidDate: null })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("leaves an unticked credit note open, and refuses a day in the future", async () => {
    show()
    const popup = await markPaid("14/2026")
    fireEvent.click(within(popup).getByRole("checkbox", { name: "Also settle NC 2/2026" }))
    expect(within(popup).getByText("€14,000.00")).toBeInTheDocument()

    fireEvent.change(within(popup).getByLabelText("Paid on"), { target: { value: "2026-10-02" } })
    fireEvent.click(within(popup).getByRole("button", { name: "Mark Paid" }))
    expect(await within(popup).findByText("The payment date can't be in the future.")).toBeInTheDocument()
    expect(updateInvoice).not.toHaveBeenCalled()

    fireEvent.change(within(popup).getByLabelText("Paid on"), { target: { value: "2026-10-01" } })
    fireEvent.click(within(popup).getByRole("button", { name: "Mark Paid" }))
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledTimes(1))
    expect(updateInvoice).toHaveBeenCalledWith("u1", "i14", { paidDate: new Date(2026, 9, 1) })
  })

  it("hands focus to the row's number once the paid invoice loses its Mark Paid", async () => {
    const { update } = show()
    const trigger = within(screen.getAllByRole("row")[2]).getByRole("button", { name: "Mark Paid" })
    fireEvent.click(within(await markPaid("17/2026")).getByRole("button", { name: "Mark Paid" }))
    await waitFor(() => expect(trigger).toHaveFocus())
    update(INVOICES.map((i) => (i.id === "i17" ? { ...i, paidDate: new Date(2026, 9, 1) } : i)))
    expect(screen.getByRole("button", { name: "17/2026" })).toHaveFocus()
  })

  it("settles a credit note on its own", async () => {
    show()
    const popup = await markPaid("NC 2/2026")
    expect(within(popup).getByRole("heading", { name: "Settle NC 2/2026" })).toBeInTheDocument()
    expect(within(popup).queryByRole("checkbox")).not.toBeInTheDocument()
    fireEvent.click(within(popup).getByRole("button", { name: "Settle" }))
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledWith("u1", "nc2", { paidDate: new Date(2026, 9, 1) }))
    expect(await screen.findByText("Credit note NC 2/2026 settled on 1 Oct.")).toBeInTheDocument()
  })
})

describe("MarkPaid on a phone", () => {
  beforeEach(() => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: query === "(max-width: 639px)" }) as MediaQueryList)
  })
  afterEach(() => vi.restoreAllMocks())

  it("opens as a modal dialog, not a popup beside the row, and gives focus back to its button", async () => {
    show()
    const trigger = within(screen.getAllByRole("row")[2]).getByRole("button", { name: "Mark Paid" })
    const dialog = await markPaid("17/2026")
    // A Dialog, not the popover: it has the dialog's Close button.
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument()
    expect(within(dialog).getByLabelText("Paid on")).toHaveValue("2026-10-01")

    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it("marks the invoice paid from the dialog", async () => {
    show()
    const dialog = await markPaid("14/2026")
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark Paid" }))
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledWith("u1", "i14", { paidDate: new Date(2026, 9, 1) }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Mark 14/2026 Paid" })).not.toBeInTheDocument())
  })
})

describe("MarkPaid with cash book accounts", () => {
  const account = (id: string, name: string): CompanyAccount => ({
    id, userId: "u1", name, openingBalance: 0, openingDate: new Date(2026, 4, 1), statementBalance: null,
    statementDate: null, importRef: null, createdAt: at, updatedAt: at,
  })
  const ACCOUNTS = [account("main", "Main Bank"), account("second", "Second Bank")]

  /** The accounts load with the list, before any click. */
  async function showWithAccounts() {
    getCompanyAccounts.mockResolvedValue(ACCOUNTS)
    const shown = show()
    await act(async () => {})
    return shown
  }

  /** Radix Select by keyboard: jsdom has no pointer capture. */
  async function pick(popup: HTMLElement, label: string, option: string) {
    fireEvent.keyDown(within(popup).getByRole("combobox", { name: label }), { key: "Enter" })
    fireEvent.keyDown(await screen.findByRole("option", { name: option }), { key: "Enter" })
  }

  it("asks where the money arrived, and books a small shortfall as a bank fee; Undo takes both back", async () => {
    await showWithAccounts()
    const popup = await markPaid("17/2026")
    // Two accounts and none used yet: no guess.
    fireEvent.click(within(popup).getByRole("button", { name: "Mark Paid" }))
    expect(await within(popup).findByText("Pick the account the money arrived on.")).toBeInTheDocument()
    expect(updateInvoice).not.toHaveBeenCalled()

    await pick(popup, "Into Account", "Second Bank")
    const received = within(popup).getByLabelText("Amount Received")
    expect(received).toHaveValue(6300)
    fireEvent.change(received, { target: { value: "6275" } })
    expect(within(popup).getByText("€25.00 short: booked as a bank fee, a cost on the same day and account.")).toBeInTheDocument()
    fireEvent.click(within(popup).getByRole("button", { name: "Mark Paid" }))

    await waitFor(() => expect(createCompanyExpense).toHaveBeenCalledTimes(1))
    const day = new Date(2026, 9, 1)
    expect(updateInvoice).toHaveBeenCalledWith("u1", "i17", { paidDate: day, paidAccountId: "second" })
    expect(createCompanyExpense).toHaveBeenCalledWith("u1", {
      description: "Bank fee on invoice 17/2026", category: "bank_fees", amount: 25, date: day, accountId: "second",
    })
    expect(
      await screen.findByText("Invoice 17/2026 marked paid on 1 Oct into Second Bank. €25.00 booked as a bank fee."),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() => expect(deleteCompanyExpense).toHaveBeenCalledWith("u1", "fee1"))
    expect(updateInvoice).toHaveBeenLastCalledWith("u1", "i17", { paidDate: null, paidAccountId: null })
    // Remembered for the next payment.
    expect(localStorage.getItem("cash-book:last-account")).toBe("second")
  })

  it("refuses a partial payment and an overpayment", async () => {
    localStorage.setItem("cash-book:last-account", "main")
    await showWithAccounts()
    const popup = await markPaid("17/2026")
    expect(within(popup).getByRole("combobox", { name: "Into Account" })).toHaveTextContent("Main Bank")
    const received = within(popup).getByLabelText("Amount Received")

    fireEvent.change(received, { target: { value: "6249.99" } })
    fireEvent.click(within(popup).getByRole("button", { name: "Mark Paid" }))
    expect(
      await within(popup).findByText(
        "Partial payments aren't supported: record the payment when it is complete, or fix the invoice.",
      ),
    ).toBeInTheDocument()

    fireEvent.change(received, { target: { value: "6315" } })
    fireEvent.click(within(popup).getByRole("button", { name: "Mark Paid" }))
    expect(
      await within(popup).findByText(
        "That is more than expected: mark it paid at €6,300.00 and add the extra in the Cash Book as a Client Payment Without Invoice.",
      ),
    ).toBeInTheDocument()
    expect(updateInvoice).not.toHaveBeenCalled()
    expect(createCompanyExpense).not.toHaveBeenCalled()

    fireEvent.change(received, { target: { value: "6300" } })
    fireEvent.click(within(popup).getByRole("button", { name: "Mark Paid" }))
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledWith("u1", "i17", { paidDate: new Date(2026, 9, 1), paidAccountId: "main" }))
    expect(createCompanyExpense).not.toHaveBeenCalled()
  })

  it("stamps the account on the ticked credit note too, the bank amount net of it", async () => {
    localStorage.setItem("cash-book:last-account", "main")
    await showWithAccounts()
    const popup = await markPaid("14/2026")
    expect(within(popup).getByLabelText("Amount Received")).toHaveValue(13300)
    fireEvent.click(within(popup).getByRole("button", { name: "Mark Paid" }))
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledTimes(2))
    const input = { paidDate: new Date(2026, 9, 1), paidAccountId: "main" }
    expect(updateInvoice).toHaveBeenCalledWith("u1", "i14", input)
    expect(updateInvoice).toHaveBeenCalledWith("u1", "nc2", input)
  })

  it("closes an invoice its credit notes cover as an offset, with no account and no amount", async () => {
    await showWithAccounts()
    const covered = { ...INVOICES[1], id: "i20", number: "20/2026", amount: 700 }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InvoiceTable userId="u1" invoices={[covered, INVOICES[2]]} engagements={[]} firstMonth="2025-11" onOpen={vi.fn()} />
      </QueryClientProvider>,
    )
    await act(async () => {})
    const row = screen.getAllByRole("row").find((r) => within(r).queryByRole("button", { name: "20/2026" }))!
    fireEvent.click(within(row).getByRole("button", { name: "Mark Paid" }))
    const popup = await screen.findByRole("dialog", { name: "Mark 20/2026 Paid" })
    expect(within(popup).getByText("The ticked credit notes cover this invoice: it closes as an offset, no money moves.")).toBeInTheDocument()
    expect(within(popup).queryByRole("combobox", { name: "Into Account" })).not.toBeInTheDocument()
    expect(within(popup).queryByLabelText("Amount Received")).not.toBeInTheDocument()
    fireEvent.click(within(popup).getByRole("button", { name: "Mark Paid" }))
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledTimes(2))
    expect(updateInvoice).toHaveBeenCalledWith("u1", "i20", { paidDate: new Date(2026, 9, 1), paidAccountId: "non-cash" })
    expect(updateInvoice).toHaveBeenCalledWith("u1", "nc2", { paidDate: new Date(2026, 9, 1), paidAccountId: "non-cash" })
  })

  it("settles a credit note as an offset when picked", async () => {
    await showWithAccounts()
    const popup = await markPaid("NC 2/2026")
    await pick(popup, "Refunded From", "Offset, No Bank Payment")
    fireEvent.click(within(popup).getByRole("button", { name: "Settle" }))
    await waitFor(() =>
      expect(updateInvoice).toHaveBeenCalledWith("u1", "nc2", { paidDate: new Date(2026, 9, 1), paidAccountId: "non-cash" }),
    )
    expect(await screen.findByText("Credit note NC 2/2026 settled on 1 Oct as an offset, no money moved.")).toBeInTheDocument()
  })
})
