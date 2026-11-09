/**
 * The invoice sheet over a fixed clock (1 Oct 2026), on the review's seed:
 * Lumon has September to invoice on two contracts, Nordic July to September
 * on one. The suggestions' maths is lib/__tests__/invoices.test.ts; this checks
 * the sheet records them with nothing typed, refuses what it must in red, and
 * writes credit notes, edits and deletes the way the design says.
 */
import { Toaster } from "@alter-ego/ui/ui/toaster"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"


import {
  amountParts,
  InvoiceSheet,
  type InvoiceFields,
  type InvoiceSheetState,
  invoiceUpdate,
  isYearMonth,
  previousMonth,
  suggestVat,
} from "../invoice-sheet"

import type { BillingMonth } from "@/lib/invoices"
import type { Invoice } from "@/types"

const at = new Date(2026, 6, 1)
const client = (id: string, name: string) => ({
  id, userId: "u1", name, vatNumber: null, email: null, contactName: null,
  contactPhone: null, notes: null, isActive: true, createdAt: at, updatedAt: at,
})
const contract = (id: string, clientId: string, name: string, dailyRate: number, vatApplicable: boolean) => ({
  id, userId: "u1", clientId, name, opportunityId: null, dailyRate, vatApplicable, contractedDays: null,
  defaultDaysPerMonth: 10, startMonth: null, endMonth: null, endDate: null, isActive: true, notes: null,
  createdAt: at, updatedAt: at,
})
const hours = (engagementId: string, date: string, h: number) => (
  { id: `${engagementId}_${date}`, userId: "u1", engagementId, date, hours: h, notes: null, createdAt: at, updatedAt: at }
)
const invoice = (o: Partial<Invoice> & Pick<Invoice, "id" | "number" | "yearMonth" | "amount" | "vat">): Invoice => ({
  userId: "u1", clientId: "c1", engagementId: null, fromMonth: null, dueDate: null, paidDate: null, paidAccountId: null,
  createdAt: at, updatedAt: at, ...o,
})

const I17 = invoice({
  id: "i17", number: "17/2026", yearMonth: "2026-08", amount: 6300, vat: 0,
  dueDate: new Date(2026, 9, 31), createdAt: new Date(2026, 8, 2),
})
const DATA: Record<string, unknown> = {
  getClients: [client("c1", "Lumon Limited"), client("c2", "Nordic Retail SRL")],
  getEngagements: [
    contract("e1", "c1", "Operator", 700, false),
    contract("e3", "c1", "Consulting", 700, false),
    contract("e2", "c2", "Retail", 500, true),
  ],
  getTimecards: [
    hours("e1", "2026-08-14", 72),
    hours("e1", "2026-09-15", 88),
    hours("e3", "2026-09-16", 72),
    hours("e2", "2026-07-15", 40),
    hours("e2", "2026-08-14", 32),
    hours("e2", "2026-09-15", 32),
  ],
  getInvoices: [
    invoice({
      id: "i9", clientId: "c2", number: "9/2026", fromMonth: "2026-04", yearMonth: "2026-06", amount: 7500,
      vat: 1650, dueDate: new Date(2026, 6, 31), paidDate: new Date(2026, 6, 31), createdAt: new Date(2026, 6, 1),
    }),
    invoice({
      id: "i14", number: "14/2026", yearMonth: "2026-07", amount: 14000, vat: 0,
      dueDate: new Date(2026, 7, 31), createdAt: new Date(2026, 7, 2),
    }),
    invoice({ id: "nc2", number: "NC 2/2026", yearMonth: "2026-07", amount: -700, vat: 0, createdAt: new Date(2026, 7, 20) }),
    I17,
  ],
}
const ORIGINAL_INVOICES = DATA.getInvoices
const createInvoice = vi.fn()
const updateInvoice = vi.fn()
const deleteInvoice = vi.fn()
const WRITES: Record<string, unknown> = { createInvoice, updateInvoice, deleteInvoice }
const upload = vi.fn()
const removeFile = vi.fn()

vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    db: new Proxy(
      {},
      { get: (_db, method) => WRITES[String(method)] ?? (() => Promise.resolve(DATA[String(method)] ?? [])) },
    ),
    files: { upload, remove: removeFile },
  }),
}))

// Date only: fake timers would stall TanStack and findBy.
beforeAll(() => vi.setSystemTime(new Date(2026, 9, 1, 12)))
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  createInvoice.mockReset().mockResolvedValue({ id: "new1" })
  updateInvoice.mockReset().mockResolvedValue(undefined)
  deleteInvoice.mockReset().mockResolvedValue(undefined)
  upload.mockReset()
  removeFile.mockReset().mockResolvedValue(undefined)
})

/** BillingShell's part: one state, and the sheet re-targets or closes it. */
function Harness({ initial }: { initial: InvoiceSheetState }) {
  const [state, setState] = useState<InvoiceSheetState | null>(initial)
  return (
    <>
      <InvoiceSheet userId="u1" state={state} onStateChange={setState} />
      <Toaster />
    </>
  )
}

async function open(initial: InvoiceSheetState, name: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  )
  return screen.findByRole("dialog", { name })
}

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })

/** Delete and Issue Credit Note: the sheet's More menu, opened from the keyboard as Radix allows in jsdom. */
async function menu(sheet: HTMLElement, item: string) {
  const more = within(sheet).getByRole("button", { name: "More actions" })
  more.focus()
  fireEvent.keyDown(more, { key: "Enter" })
  fireEvent.click(await screen.findByRole("menuitem", { name: item }))
}

describe("InvoiceSheet: Record", () => {
  it("records the suggested invoice with nothing typed, and Undo removes it", async () => {
    const sheet = await open({ kind: "record", clientId: "c1" }, "Record Invoice")
    expect(within(sheet).getByLabelText("Invoice number")).toHaveValue("18/2026")
    expect(within(sheet).getByText("Next after 17/2026. Check it matches your invoicing software.")).toBeInTheDocument()
    expect(within(sheet).getByLabelText("Net amount")).toHaveValue(14000)
    expect(within(sheet).getByLabelText("VAT")).toHaveValue(0)
    expect(within(sheet).getByText("No VAT")).toBeInTheDocument()
    expect(within(sheet).getByLabelText("Due date")).toHaveValue("2026-11-30")
    expect(within(sheet).getByText(/^Same terms as 17\/2026 \(due 31 Oct for Aug\)\./)).toBeInTheDocument()
    // Two contracts: the month's lines sit under it in the breakdown, a long name truncated with a title.
    expect(within(sheet).getByTitle("Operator").parentElement).toHaveTextContent("Operator 88 h · €7,700.00")
    expect(within(sheet).getByTitle("Consulting").parentElement).toHaveTextContent("Consulting 72 h · €6,300.00")
    // Hours value is the sm+ column: a phone hides it.
    expect(within(sheet).getByRole("columnheader", { name: "Hours value" })).toHaveClass("hidden", "sm:table-cell")
    expect(within(sheet).getByText(/To invoice €14,000.00 → €0.00 net/)).toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole("button", { name: "Record Invoice" }))
    await waitFor(() =>
      expect(createInvoice).toHaveBeenCalledWith("u1", {
        clientId: "c1",
        number: "18/2026",
        fromMonth: null,
        yearMonth: "2026-09",
        amount: 14000,
        vat: 0,
        dueDate: new Date(2026, 10, 30),
        paidDate: null,
      }),
    )
    await screen.findByText("Invoice 18/2026 recorded. Sep 2026 is now invoiced.")
    expect(screen.queryByRole("dialog", { name: "Record Invoice" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() => expect(deleteInvoice).toHaveBeenCalledWith("u1", "new1"))
  })

  it("proposes a run of open months as one invoice, split month by month", async () => {
    const sheet = await open({ kind: "record", clientId: "c2" }, "Record Invoice")
    expect(within(sheet).getByRole("combobox", { name: "From" })).toHaveTextContent("Jul 2026")
    expect(within(sheet).getByRole("combobox", { name: "To" })).toHaveTextContent("Sep 2026")
    const rows = within(sheet).getAllByRole("row").slice(1)
    expect(rows.map((r) => r.textContent)).toEqual([
      "Jul 202640 h€2,500.00€2,500.00",
      "Aug 202632 h€2,000.00€2,000.00",
      "Sep 202632 h€2,000.00€2,000.00",
    ])
    expect(within(sheet).getByText(/^Split by hours value/)).toBeInTheDocument()
    expect(within(sheet).getByLabelText("Net amount")).toHaveValue(6500)
    expect(within(sheet).getByLabelText("VAT")).toHaveValue(1430)
    expect(within(sheet).getByText("€7,930.00")).toBeInTheDocument()
    expect(within(sheet).getByLabelText("Due date")).toHaveValue("2026-10-31")
    expect(
      within(sheet).getByText("To invoice €6,500.00 → €0.00 net · Unpaid €0.00 → €7,930.00 incl. VAT"),
    ).toBeInTheDocument()
  })

  it("says what a typed amount leaves to invoice, and Use snaps back to the hours", async () => {
    const sheet = await open({ kind: "record", clientId: "c1" }, "Record Invoice")
    type(within(sheet).getByLabelText("Net amount"), "13700")
    expect(within(sheet).getByText("€300.00 less than the hours: €300.00 stays to invoice.")).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole("button", { name: "Use €14,000.00" }))
    expect(within(sheet).getByLabelText("Net amount")).toHaveValue(14000)
    expect(within(sheet).queryByText(/less than the hours/)).toBeNull()
  })

  it("refuses a number already recorded as soon as the field is left", async () => {
    const sheet = await open({ kind: "record", clientId: "c1" }, "Record Invoice")
    const number = within(sheet).getByLabelText("Invoice number")
    type(number, " 17/2026 ")
    fireEvent.blur(number)
    const error = await within(sheet).findByText("17/2026 is already recorded (Lumon Limited, Aug 2026).")
    expect(error).toHaveClass("text-destructive")
    fireEvent.click(within(sheet).getByRole("button", { name: "Record Invoice" }))
    await waitFor(() => expect(number).toHaveFocus())
    expect(createInvoice).not.toHaveBeenCalled()
  })

  it("shows months that run backwards in red, and never saves them", async () => {
    const sheet = await open({ kind: "record", clientId: "c2" }, "Record Invoice")
    // Radix renders a native select beside each trigger inside a form: the From one comes first.
    type(sheet.querySelectorAll("select")[0], "2026-10")
    const error = await within(sheet).findByText("The first month comes after the last one.")
    expect(error).toHaveClass("text-destructive")
    fireEvent.click(within(sheet).getByRole("button", { name: "Record Invoice" }))
    await waitFor(() => expect(within(sheet).getByRole("combobox", { name: "From" })).toHaveFocus())
    expect(createInvoice).not.toHaveBeenCalled()
  })

  it("warns, without blocking, when a longer invoice would land on a month already invoiced, with a one-click fix", async () => {
    const sheet = await open({ kind: "record", clientId: "c1" }, "Record Invoice")
    type(sheet.querySelectorAll("select")[0], "2026-08")
    const warning = await within(sheet).findByText(
      "Aug 2026 is already invoiced (17/2026): part of this invoice would land on it. Record one invoice per run of open months instead.",
    )
    expect(warning).not.toHaveClass("text-destructive")
    fireEvent.click(within(warning).getByRole("button", { name: "Start from Sep 2026" }))
    expect(within(sheet).getByRole("combobox", { name: "From" })).toHaveTextContent("Sep 2026")
    expect(within(sheet).queryByText(/is already invoiced/)).toBeNull()
    expect(within(sheet).getByLabelText("Net amount")).toHaveValue(14000)
  })

  it("asks for the customer first when none was chosen", async () => {
    const sheet = await open({ kind: "record", clientId: null }, "Record Invoice")
    expect(within(sheet).queryByLabelText("Invoice number")).toBeNull()
    fireEvent.click(within(sheet).getByRole("button", { name: "Record Invoice" }))
    expect(await within(sheet).findByText("Pick the customer this invoice is for.")).toHaveClass("text-destructive")
  })
})

describe("InvoiceSheet: Edit", () => {
  it("saves only the field that changed", async () => {
    const sheet = await open({ kind: "edit", invoiceId: "i17" }, "Invoice 17/2026")
    expect(within(sheet).getByText("Unpaid · due 31 Oct")).toBeInTheDocument()
    type(within(sheet).getByLabelText("Due date"), "2026-11-15")
    fireEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }))
    await waitFor(() =>
      expect(updateInvoice).toHaveBeenCalledWith("u1", "i17", { dueDate: new Date(2026, 10, 15) }),
    )
  })

  // An estimated paid date can be fixed without losing where the money landed, or the account set later.
  it("sets the cash book account next to the paid date, once the company has an account", async () => {
    DATA.getCompanyAccounts = [
      {
        id: "main", userId: "u1", name: "Main Bank", openingBalance: 0, openingDate: new Date(2026, 4, 1),
        statementBalance: null, statementDate: null, importRef: null, createdAt: at, updatedAt: at,
      },
    ]
    try {
      const sheet = await open({ kind: "edit", invoiceId: "i9" }, "Invoice 9/2026")
      const select = within(sheet).getByRole("combobox", { name: "Into account" })
      expect(select).toHaveTextContent("Not Recorded")
      fireEvent.keyDown(select, { key: "Enter" })
      fireEvent.keyDown(await screen.findByRole("option", { name: "Main Bank" }), { key: "Enter" })
      fireEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }))
      await waitFor(() => expect(updateInvoice).toHaveBeenCalledWith("u1", "i9", { paidAccountId: "main" }))
    } finally {
      delete DATA.getCompanyAccounts
    }
  })

  it("refuses a payment date in the future", async () => {
    const sheet = await open({ kind: "edit", invoiceId: "i17" }, "Invoice 17/2026")
    type(within(sheet).getByLabelText("Paid on"), "2026-10-05")
    fireEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }))
    expect(await within(sheet).findByText("The payment date can't be in the future.")).toHaveClass("text-destructive")
    expect(updateInvoice).not.toHaveBeenCalled()
  })

  it("deletes only after the confirmation says what To invoice becomes", async () => {
    const sheet = await open({ kind: "edit", invoiceId: "i17" }, "Invoice 17/2026")
    // In the footer's More menu, out of the way of Save: the only red item there.
    expect(within(sheet).queryByRole("button", { name: "Delete Invoice" })).toBeNull()
    await menu(sheet, "Delete Invoice")
    const confirm = await screen.findByRole("alertdialog", { name: "Delete Invoice 17/2026?" })
    expect(confirm).toHaveTextContent("To invoice for Lumon Limited goes from €14,000.00 to €20,300.00.")
    expect(deleteInvoice).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete Invoice" }))
    await waitFor(() => expect(deleteInvoice).toHaveBeenCalledWith("u1", "i17"))
  })

  it("turns into a credit note for the invoice on Issue Credit Note", async () => {
    const sheet = await open({ kind: "edit", invoiceId: "i14" }, "Invoice 14/2026")
    await menu(sheet, "Issue Credit Note")
    const credit = await screen.findByRole("dialog", { name: "Credit Note for 14/2026" })
    expect(within(credit).getByLabelText("Credit note number")).toHaveValue("NC 3/2026")
    // NC 2/2026 already credits €700 of July: only the rest is offered, never credited twice.
    expect(within(credit).getByLabelText("Amount credited")).toHaveValue(13300)
    expect(
      within(credit).getByText(
        "Before VAT, as a positive number: €13,300.00 cancels the rest of 14/2026 (NC 2/2026 already credits €700.00).",
      ),
    ).toBeInTheDocument()
    type(within(credit).getByLabelText("Amount credited"), "14000")
    expect(within(credit).getByText("More than what's left of 14/2026 (€13,300.00).")).toBeInTheDocument()
  })

  it("spells out the parts when credit notes add to the hours", async () => {
    const stored = DATA.getTimecards
    // July's hours worth €13,300: 14/2026 bills €14,000 and NC 2/2026 gives €700 back.
    DATA.getTimecards = [...(stored as unknown[]), hours("e1", "2026-07-15", 152)]
    try {
      const sheet = await open({ kind: "edit", invoiceId: "i14" }, "Invoice 14/2026")
      expect(
        within(sheet).getByText(
          "Before VAT. Hours €13,300.00 + credit notes €700.00 not yet re-invoiced = €14,000.00.",
        ),
      ).toBeInTheDocument()
    } finally {
      DATA.getTimecards = stored
    }
  })

  it("lets the VAT follow a corrected net when it was stored as the rate gives it", async () => {
    const sheet = await open({ kind: "edit", invoiceId: "i9" }, "Invoice 9/2026")
    expect(within(sheet).getByLabelText("VAT")).toHaveValue(1650)
    type(within(sheet).getByLabelText("Net amount"), "7000")
    expect(within(sheet).getByLabelText("VAT")).toHaveValue(1540)
    fireEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }))
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledWith("u1", "i9", { amount: 7000, vat: 1540 }))
  })

  it("hands focus back to what opened it", async () => {
    function Opener() {
      const [state, setState] = useState<InvoiceSheetState | null>(null)
      return (
        <>
          <button type="button" onClick={() => setState({ kind: "edit", invoiceId: "i17" })}>
            17/2026
          </button>
          <InvoiceSheet userId="u1" state={state} onStateChange={setState} />
        </>
      )
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Opener />
      </QueryClientProvider>,
    )
    const opener = screen.getByRole("button", { name: "17/2026" })
    opener.focus()
    fireEvent.click(opener)
    // Loading, then the form: a swapped content is not a close.
    const sheet = await screen.findByRole("dialog", { name: "Invoice 17/2026" })
    await waitFor(() => expect(sheet).toContainElement(document.activeElement as HTMLElement))
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(opener).toHaveFocus())
  })
})

describe("InvoiceSheet: Credit Note", () => {
  it("mirrors the invoice's VAT and stores both negative", async () => {
    const sheet = await open({ kind: "credit", invoiceId: "i9" }, "Credit Note for 9/2026")
    expect(within(sheet).queryByLabelText("Due date")).toBeNull()
    type(within(sheet).getByLabelText("Amount credited"), "1000")
    expect(within(sheet).getByLabelText("VAT")).toHaveValue(220)
    // Signed as the invoice list shows it.
    expect(within(sheet).getByText("Back to the customer").parentElement).toHaveTextContent("-€1,220.00")
    fireEvent.click(within(sheet).getByRole("button", { name: "Record Credit Note" }))
    await waitFor(() =>
      expect(createInvoice).toHaveBeenCalledWith("u1", {
        clientId: "c2",
        number: "NC 3/2026",
        fromMonth: "2026-04",
        yearMonth: "2026-06",
        amount: -1000,
        vat: -220,
        dueDate: null,
        paidDate: null,
      }),
    )
    await screen.findByText("Credit note NC 3/2026 recorded.")
  })

  it("lets an edited credit note's VAT follow its amount, as its help says", async () => {
    const stored = DATA.getInvoices
    DATA.getInvoices = [
      ...(stored as Invoice[]),
      invoice({ id: "nc9", clientId: "c2", number: "NC 9/2026", yearMonth: "2026-09", amount: -1000, vat: -220 }),
    ]
    try {
      const sheet = await open({ kind: "edit", invoiceId: "nc9" }, "Credit Note NC 9/2026")
      expect(within(sheet).getByText("Follows the amount at the rate it was recorded with.")).toBeInTheDocument()
      type(within(sheet).getByLabelText("Amount credited"), "500")
      expect(within(sheet).getByLabelText("VAT")).toHaveValue(110)
      fireEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }))
      await waitFor(() => expect(updateInvoice).toHaveBeenCalledWith("u1", "nc9", { amount: -500, vat: -110 }))
    } finally {
      DATA.getInvoices = stored
    }
  })

  it("warns when it credits more than the invoice's net", async () => {
    const sheet = await open({ kind: "credit", invoiceId: "i9" }, "Credit Note for 9/2026")
    type(within(sheet).getByLabelText("Amount credited"), "8000")
    expect(within(sheet).getByText("More than 9/2026's net (€7,500.00).")).toBeInTheDocument()
  })
})

describe("amountParts", () => {
  const month = (yearMonth: string, logged: number, invoiced: number) =>
    ({ yearMonth, logged, invoiced, partlyLogged: false }) as BillingMonth

  it("says nothing more when the hours are the whole suggestion", () => {
    expect(amountParts([month("2026-09", 14000, 0)], 14000, "2026-10")).toBeNull()
  })

  it("takes off what other invoices already bill", () => {
    expect(amountParts([month("2026-09", 14000, 5000)], 9000, "2026-10")).toBe(
      "Hours €14,000.00 − other invoices €5,000.00 = €9,000.00",
    )
  })

  it("names what invoices on other months cover, and leaves the month in progress out", () => {
    expect(amountParts([month("2026-10", 500, 0), month("2026-09", 1000, 0)], 400, "2026-10")).toBe(
      "Hours €1,000.00 − €600.00 covered by invoices on other months = €400.00",
    )
  })
})

describe("invoiceUpdate", () => {
  const fields: InvoiceFields = {
    from: "2026-08", to: "2026-08", number: "17/2026", amount: 6300, vat: 0, dueDate: "2026-10-31", paidDate: "", paidAccountId: "",
  }

  it("sends nothing when nothing changed", () => {
    expect(invoiceUpdate(I17, fields)).toEqual({})
  })

  it("sends only the changed fields, the number trimmed", () => {
    expect(invoiceUpdate(I17, { ...fields, number: " 17b/2026 ", vat: 100, paidDate: "2026-10-01" })).toEqual({
      number: "17b/2026",
      vat: 100,
      paidDate: new Date(2026, 9, 1),
    })
  })

  it("sends the account only when it changed, \"\" as null", () => {
    expect(invoiceUpdate({ ...I17, paidAccountId: "main" }, { ...fields, paidAccountId: "main" })).toEqual({})
    expect(invoiceUpdate(I17, { ...fields, paidAccountId: "main" })).toEqual({ paidAccountId: "main" })
    expect(invoiceUpdate({ ...I17, paidAccountId: "main" }, fields)).toEqual({ paidAccountId: null })
  })

  it("stores a range of one month as a single month", () => {
    expect(invoiceUpdate(I17, { ...fields, from: "2026-07" })).toEqual({ fromMonth: "2026-07" })
    expect(invoiceUpdate({ ...I17, fromMonth: "2026-07" }, fields)).toEqual({ fromMonth: null })
  })
})

/**
 * The default month of a blank Record Invoice. Getting it wrong shifts every comparison against
 * the plan by a month, silently — so the January-to-December rollover is checked.
 */
describe("previousMonth", () => {
  it("steps back one month", () => {
    expect(previousMonth(new Date(2026, 7, 22))).toBe("2026-07")
  })

  it("crosses the year boundary", () => {
    expect(previousMonth(new Date(2026, 0, 3))).toBe("2025-12")
  })
})

describe("suggestVat", () => {
  it("applies the statutory rate when all the logged value is VAT-liable", () => {
    expect(suggestVat("4750", 1)).toBe("1045")
  })

  it("rounds to cents rather than trailing float noise", () => {
    expect(suggestVat("1234.56", 1)).toBe("271.6")
  })

  it("suggests nothing when none of it is VAT-liable", () => {
    expect(suggestVat("4750", 0)).toBe("0")
  })

  it("keeps the sign of a negative amount", () => {
    expect(suggestVat("-1000", 1)).toBe("-220")
  })

  it("stays at 0 for an empty or unparseable amount", () => {
    expect(suggestVat("", 1)).toBe("0")
    expect(suggestVat("abc", 1)).toBe("0")
  })

  it("applies the rate to the VAT-liable share of a mixed client", () => {
    expect(suggestVat("1000", 0.5)).toBe("110")
  })
})

describe("isYearMonth", () => {
  // The form's schema and the old list's guard read this one predicate.
  it("accepts a YYYY-MM month", () => {
    expect(isYearMonth("2026-07")).toBe(true)
  })

  it("rejects an empty field, which is what clearing the input produces", () => {
    expect(isYearMonth("")).toBe(false)
  })

  it("rejects the shapes a text fallback would let a user type", () => {
    expect(isYearMonth("08/2026")).toBe(false)
    expect(isYearMonth("2026-7")).toBe(false)
    expect(isYearMonth("2026-07-01")).toBe(false)
  })
})

describe("InvoiceSheet: the invoice file", () => {
  const pointer = (name: string, path = `users/u1/company-files/${name}`) => ({
    path, name, kind: "xml" as const, size: 7 * 1024, uploadedAt: new Date(2026, 9, 1),
  })
  const xml = () => new File(["<a/>"], "IT09876543210_00017.xml", { type: "application/xml" })
  const choose = (sheet: HTMLElement, file: File) =>
    fireEvent.change(within(sheet).getByLabelText("Choose invoice file"), { target: { files: [file] } })

  it("is its own group under Payment", async () => {
    const sheet = await open({ kind: "edit", invoiceId: "i17" }, "Invoice 17/2026")
    const headings = within(sheet).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)
    expect(headings.indexOf("Invoice File")).toBe(headings.indexOf("Payment") + 1)
    expect(within(sheet).getByRole("group", { name: "Invoice File" })).toHaveTextContent("Choose File")
  })

  it("uploads a picked file when the invoice is saved, and writes it with only the file changed", async () => {
    const next = pointer("IT09876543210_00017.xml")
    upload.mockResolvedValue(next)
    const sheet = await open({ kind: "edit", invoiceId: "i17" }, "Invoice 17/2026")
    choose(sheet, xml())
    expect(within(sheet).getByText("FatturaPA XML · 1 KB · saved with the invoice")).toBeInTheDocument()
    expect(upload).not.toHaveBeenCalled()
    fireEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }))
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledWith("u1", "i17", { file: next }))
    expect(upload).toHaveBeenCalledWith("u1", expect.any(File), "IT09876543210_00017.xml")
  })

  it("leaves nothing behind on Cancel", async () => {
    const sheet = await open({ kind: "edit", invoiceId: "i17" }, "Invoice 17/2026")
    choose(sheet, xml())
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Invoice 17/2026" })).not.toBeInTheDocument())
    expect(upload).not.toHaveBeenCalled()
    expect(updateInvoice).not.toHaveBeenCalled()
  })

  it("records a new invoice with the file picked", async () => {
    const next = pointer("IT09876543210_00018.xml")
    upload.mockResolvedValue(next)
    const sheet = await open({ kind: "record", clientId: "c1" }, "Record Invoice")
    choose(sheet, xml())
    fireEvent.click(within(sheet).getByRole("button", { name: "Record Invoice" }))
    await waitFor(() => expect(createInvoice).toHaveBeenCalledWith("u1", expect.objectContaining({ clientId: "c1", number: "18/2026", file: next })))
  })

  it("saves nothing when the upload fails, and says why", async () => {
    upload.mockRejectedValue(new Error("Network down"))
    const sheet = await open({ kind: "edit", invoiceId: "i17" }, "Invoice 17/2026")
    choose(sheet, xml())
    fireEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }))
    expect(await screen.findByText("IT09876543210_00017.xml could not be uploaded: Network down.")).toBeInTheDocument()
    expect(updateInvoice).not.toHaveBeenCalled()
  })

  describe("on an invoice that keeps one", () => {
    const KEPT = pointer("IT09876543210_00014.xml", "users/u1/company-files/kept.xml")
    const withFile = async () => {
      DATA.getInvoices = [{ ...I17, file: KEPT }]
      return open({ kind: "edit", invoiceId: "i17" }, "Invoice 17/2026")
    }
    afterEach(() => {
      DATA.getInvoices = ORIGINAL_INVOICES
    })

    it("shows it, and removes it on Save with the object deleted after the write", async () => {
      const sheet = await withFile()
      expect(within(sheet).getByText("FatturaPA XML · 7 KB · added 1 Oct")).toBeInTheDocument()
      fireEvent.keyDown(within(sheet).getByRole("button", { name: "More file actions" }), { key: "Enter" })
      fireEvent.click(await screen.findByRole("menuitem", { name: "Remove File" }))
      expect(removeFile).not.toHaveBeenCalled()
      fireEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }))
      await waitFor(() => expect(updateInvoice).toHaveBeenCalledWith("u1", "i17", { file: null }))
      await waitFor(() => expect(removeFile).toHaveBeenCalledWith(KEPT.path))
    })

    it("replaces it: the new object first, the old one gone once the invoice points at the new", async () => {
      const next = pointer("new.xml")
      upload.mockResolvedValue(next)
      const sheet = await withFile()
      fireEvent.keyDown(within(sheet).getByRole("button", { name: "More file actions" }), { key: "Enter" })
      fireEvent.click(await screen.findByRole("menuitem", { name: "Replace File…" }))
      choose(sheet, xml())
      fireEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }))
      await waitFor(() => expect(updateInvoice).toHaveBeenCalledWith("u1", "i17", { file: next }))
      await waitFor(() => expect(removeFile).toHaveBeenCalledWith(KEPT.path))
      expect(removeFile).toHaveBeenCalledTimes(1)
    })
  })
})
