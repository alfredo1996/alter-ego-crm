import { describe, expect, it } from "vitest"

import { monthsFrom } from "@/lib/engagement-burndown"
import { fromContractUnit } from "@/lib/engagements"
import {
  amendmentEffects,
  clientBilling,
  creditsOn,
  eurCents,
  invoiceClientId,
  invoicedByMonth,
  invoiceNumberTaken,
  invoicePeriodError,
  invoicePeriodLabel,
  invoiceStatus,
  invoiceSuggestions,
  invoiceTotal,
  isInvoiceOverdue,
  nextInvoiceNumber,
  openCredits,
  outstanding,
  periodMonths,
  plannedBilling,
  rangeSuggestion,
  sortInvoices,
  suggestedDueDate,
  suggestedInvoiceNumber,
  suggestedVat,
} from "@/lib/invoices"

import type { Allocation, ContractAmendment, Engagement, Invoice, Timecard } from "@/types"

function invoice(o: Partial<Invoice>): Invoice {
  return {
    id: "i",
    userId: "u",
    clientId: null,
    engagementId: "e",
    number: "1",
    fromMonth: null,
    yearMonth: "2026-01",
    amount: 1000,
    vat: 220,
    dueDate: null,
    paidDate: null,
    paidAccountId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...o,
  }
}

describe("invoiceTotal", () => {
  it("adds the VAT as charged", () => {
    expect(invoiceTotal(invoice({ amount: 1000, vat: 220 }))).toBe(1220)
  })

  it("is 0-VAT for reverse charge, not 22%", () => {
    expect(invoiceTotal(invoice({ amount: 1000, vat: 0 }))).toBe(1000)
  })

  it("stays negative for a nota di credito", () => {
    expect(invoiceTotal(invoice({ amount: -1000, vat: -220 }))).toBe(-1220)
  })

  it("rounds float noise to cents", () => {
    expect(invoiceTotal(invoice({ amount: 1000.1, vat: 220.02 }))).toBe(1220.12)
  })
})

describe("sortInvoices", () => {
  it("puts unpaid before paid, due-dated (soonest first) before undated, then creation order", () => {
    const paid = invoice({ id: "paid", paidDate: new Date("2026-02-01"), dueDate: new Date("2026-01-05") })
    const dueSoon = invoice({ id: "soon", dueDate: new Date("2026-02-01") })
    const dueLate = invoice({ id: "late", dueDate: new Date("2026-03-01") })
    const undatedOld = invoice({ id: "old", createdAt: new Date("2026-01-01") })
    const undatedNew = invoice({ id: "new", createdAt: new Date("2026-01-10") })

    const sorted = sortInvoices([paid, undatedNew, dueLate, undatedOld, dueSoon])
    expect(sorted.map((i) => i.id)).toEqual(["soon", "late", "old", "new", "paid"])
  })

  it("does not mutate the input", () => {
    const input = [invoice({ id: "b", paidDate: new Date("2026-02-01") }), invoice({ id: "a" })]
    sortInvoices(input)
    expect(input.map((i) => i.id)).toEqual(["b", "a"])
  })
})

describe("isInvoiceOverdue", () => {
  const today = new Date("2026-08-21T15:00:00")

  it("is overdue when the due date has passed and the invoice is unpaid", () => {
    expect(isInvoiceOverdue(invoice({ dueDate: new Date("2026-08-20") }), today)).toBe(true)
  })

  it("is not overdue on the due date itself", () => {
    expect(isInvoiceOverdue(invoice({ dueDate: new Date("2026-08-21T00:00:00") }), today)).toBe(false)
  })

  it("is never overdue once paid, however late the payment was", () => {
    const paidLate = invoice({ dueDate: new Date("2026-08-01"), paidDate: new Date("2026-08-19") })
    expect(isInvoiceOverdue(paidLate, today)).toBe(false)
  })

  it("is never overdue without a due date", () => {
    expect(isInvoiceOverdue(invoice({ dueDate: null }), today)).toBe(false)
  })

  it("is never overdue for a credit note, even unpaid and past due", () => {
    const creditNote = invoice({ amount: -500, vat: -110, dueDate: new Date("2026-08-01") })
    expect(isInvoiceOverdue(creditNote, today)).toBe(false)
  })
})

describe("outstanding", () => {
  it("sums the unpaid invoices incl. VAT as charged", () => {
    expect(outstanding([invoice({ amount: 1000, vat: 220 }), invoice({ amount: 500, vat: 0 })])).toBe(1720)
  })

  it("leaves paid invoices out", () => {
    const paid = invoice({ amount: 2000, vat: 440, paidDate: new Date("2026-02-01") })
    expect(outstanding([paid, invoice({ amount: 1000, vat: 220 })])).toBe(1220)
  })

  it("nets an unpaid credit note against an unpaid invoice", () => {
    const creditNote = invoice({ amount: -500, vat: -110 })
    expect(outstanding([invoice({ amount: 1000, vat: 220 }), creditNote])).toBe(610)
  })

  it("reads 0, never negative, when only a credit note is unpaid", () => {
    const paid = invoice({ amount: 1000, vat: 220, paidDate: new Date("2026-02-01") })
    expect(outstanding([paid, invoice({ amount: -500, vat: -110 })])).toBe(0)
  })

  it("is 0 with no invoices", () => {
    expect(outstanding([])).toBe(0)
  })
})

describe("eurCents", () => {
  it("keeps the cents", () => {
    expect(eurCents(468.75)).toBe("€468.75")
  })
})

// ─── Billing ─────────────────────────────────────────────────────────────────

const CM = "2026-09"
// The month's last day, so every September hour is already worked.
const TODAY = "2026-09-30"
type Contract = Parameters<typeof clientBilling>[0]["engagements"][number]
const E1: Contract = { id: "e1", clientId: "c", dailyRate: 500, startMonth: null, vatApplicable: false }

function tc(date: string, hours: number, engagementId = "e1"): Pick<Timecard, "engagementId" | "date" | "hours"> {
  return { engagementId, date, hours }
}

function inv(yearMonth: string, amount: number, o: Partial<Invoice> = {}): Invoice {
  return invoice({ engagementId: "e1", yearMonth, amount, vat: 0, ...o })
}

function billing(timecards: Pick<Timecard, "engagementId" | "date" | "hours">[], invoices: Invoice[] = []) {
  return clientBilling({ clientId: "c", engagements: [E1], timecards, invoices, today: TODAY })
}

/** The client "c" over `engagements`, every other input as given. */
function bill(input: Omit<Parameters<typeof clientBilling>[0], "clientId" | "today"> & { today?: string }) {
  return clientBilling({ clientId: "c", today: TODAY, ...input })
}

function month(b: ReturnType<typeof clientBilling>, yearMonth: string) {
  const row = b.months.find((m) => m.yearMonth === yearMonth)
  if (!row) throw new Error(`no row for ${yearMonth}`)
  return row
}

describe("clientBilling", () => {
  it("values hours at 8 h a day × the daily rate, with no rounding to half days", () => {
    expect(month(billing([tc("2026-08-10", 8), tc("2026-08-11", 8)]), "2026-08")).toMatchObject({
      hours: 16,
      logged: 1000,
    })
    expect(month(billing([tc("2026-08-10", 6)]), "2026-08").logged).toBe(375)
    expect(month(billing([tc("2026-08-10", 7.5)]), "2026-08").logged).toBe(468.75)
  })

  it("bills everyone's hours on the contract: a collaborator's day is the client's, at the contract's rate", () => {
    const hers = { ...tc("2026-08-10", 8), collaboratorId: "g" }
    expect(month(billing([tc("2026-08-10", 8), hers]), "2026-08")).toMatchObject({ hours: 16, logged: 1000 })
  })

  it("rounds logged, left and the balance to cents", () => {
    const b = bill({
      engagements: [{ ...E1, dailyRate: 333.33 }],
      timecards: [tc("2026-07-01", 7), tc("2026-08-01", 7)],
      invoices: [],
    })
    // 7 h = 0.875 d × 333.33 = 291.66375
    expect(month(b, "2026-08")).toMatchObject({ logged: 291.66, left: 291.66 })
    expect(b.toInvoice).toBe(583.32)
  })

  it("counts a month with hours and no invoice in full towards to invoice", () => {
    const b = billing([tc("2026-08-10", 16)])
    expect(month(b, "2026-08")).toMatchObject({ invoiced: 0, left: 1000, invoices: [] })
    expect(b.toInvoice).toBe(1000)
    expect(b.loggedSince).toBe("2026-08")
  })

  it("shows an invoice from before hours were logged as a row, never in the balance", () => {
    const b = billing([tc("2026-08-10", 16)], [inv("2026-06", 4000)])
    expect(month(b, "2026-06")).toMatchObject({ hours: null, logged: null, invoiced: 4000, left: null })
    expect(b.toInvoice).toBe(1000)
  })

  it("nets a quarterly invoice against the months it covers", () => {
    const b = billing(
      [tc("2026-06-15", 80), tc("2026-07-15", 80), tc("2026-08-15", 80)],
      [inv("2026-08", 15000)],
    )
    expect(b.months.map((m) => m.left)).toEqual([-10000, 5000, 5000])
    expect(b.toInvoice).toBe(0)
    // Nothing to offer: invoicing June's +5000 again would bill it twice.
    expect(b.months.map((m) => m.unbilled)).toEqual([0, 0, 0])
  })

  it("leaves what a part-covering invoice misses on the oldest uncovered month", () => {
    const b = billing(
      [tc("2026-06-15", 80), tc("2026-07-15", 80), tc("2026-08-15", 80)],
      [inv("2026-08", 13000)],
    )
    expect(b.months.map((m) => [m.yearMonth, m.left, m.unbilled])).toEqual([
      ["2026-08", -8000, 0],
      ["2026-07", 5000, 2000],
      ["2026-06", 5000, 0],
    ])
    expect(b.toInvoice).toBe(2000)
  })

  it("never counts a first month logged part-way as ahead", () => {
    // Timecards began 25 Sep: 4 d logged against September's full €10,000 invoice.
    const b = bill({
      engagements: [E1],
      timecards: [tc("2026-09-25", 32), tc("2026-10-15", 160)],
      invoices: [inv("2026-09", 10000)],
      today: "2026-11-30",
    })
    expect(month(b, "2026-09")).toMatchObject({ hours: 32, left: -8000, unbilled: 0, partlyLogged: true })
    expect(month(b, "2026-10")).toMatchObject({ left: 10000, unbilled: 10000, partlyLogged: false })
    expect(b.toInvoice).toBe(10000)
  })

  it("carries an invoice in advance forward when the contract started in its first logged month", () => {
    const b = bill({
      engagements: [{ ...E1, startMonth: "2026-06" }],
      timecards: [tc("2026-06-15", 80), tc("2026-07-15", 80), tc("2026-08-15", 80)],
      invoices: [inv("2026-06", 15000)],
    })
    expect(month(b, "2026-06")).toMatchObject({ left: -10000, partlyLogged: false })
    expect(b.months.map((m) => m.unbilled)).toEqual([0, 0, 0])
    expect(b.toInvoice).toBe(0)
  })

  it("gives a tracked month with an invoice and no hours 0 hours, netting the balance", () => {
    const b = billing([tc("2026-06-15", 16), tc("2026-08-15", 16)], [inv("2026-07", 1500)])
    expect(month(b, "2026-07")).toMatchObject({ hours: 0, logged: 0, invoiced: 1500, left: -1500 })
    expect(b.toInvoice).toBe(500)
    // July's surplus covers June, and what is left of it part of August.
    expect(b.months.map((m) => m.unbilled)).toEqual([500, 0, 0])
  })

  it("subtracts a credit note, and never reads VAT", () => {
    const hours = [tc("2026-08-10", 16)]
    const withCredit = billing(hours, [inv("2026-08", 1000, { id: "a" }), inv("2026-08", -500, { id: "cn" })])
    expect(month(withCredit, "2026-08")).toMatchObject({ invoiced: 500, left: 500 })
    expect(withCredit.toInvoice).toBe(500)

    const reverseCharge = billing(hours, [inv("2026-08", 950, { vat: 0 })])
    const standardVat = billing(hours, [inv("2026-08", 950, { vat: 2090 })])
    const figures = (b: ReturnType<typeof clientBilling>) => {
      const m = month(b, "2026-08")
      return [m.hours, m.logged, m.invoiced, m.left]
    }
    expect(figures(standardVat)).toEqual(figures(reverseCharge))
    expect(month(standardVat, "2026-08").left).toBe(50)
    expect(standardVat.toInvoice).toBe(reverseCharge.toInvoice)
  })

  it("keeps the current month out of to invoice, as this month so far", () => {
    const b = billing([tc("2026-08-10", 16), tc("2026-09-01", 8), tc("2026-09-02", 4)])
    expect(b.thisMonth).toBe(750)
    expect(b.thisMonthHours).toBe(12)
    expect(month(b, CM)).toMatchObject({ hours: 12, logged: 750, left: 750 })
    expect(b.toInvoice).toBe(1000)
  })

  it("counts hours scheduled after today only once their day comes, today's included", () => {
    const b = bill({
      engagements: [E1],
      timecards: [tc("2026-08-10", 16), tc("2026-09-15", 8), tc("2026-09-16", 8), tc("2026-09-17", 8), tc("2026-10-02", 8)],
      invoices: [],
      today: "2026-09-16",
    })
    expect(b.thisMonthHours).toBe(16)
    expect(b.thisMonth).toBe(1000)
    expect(b.toInvoice).toBe(1000)
    expect(b.loggedSince).toBe("2026-08")
    // October holds scheduled hours only, and no invoice: no row.
    expect(b.months.map((m) => m.yearMonth)).toEqual(["2026-09", "2026-08"])

    const onlyAhead = bill({ engagements: [E1], timecards: [tc("2026-10-02", 8)], invoices: [] })
    expect(onlyAhead.loggedSince).toBeNull()
    expect(onlyAhead.toInvoice).toBeNull()
    expect(onlyAhead.months).toEqual([])
  })

  it("reads this month as 0 when nothing is logged yet this month", () => {
    const b = billing([tc("2026-08-10", 16)])
    expect(b.thisMonth).toBe(0)
    expect(b.thisMonthHours).toBe(0)
    expect(b.months.map((m) => m.yearMonth)).toEqual(["2026-08"])
  })

  it("leaves an invoice for a future month untracked and out of the balance", () => {
    const b = billing([tc("2026-08-10", 16)], [inv("2026-10", 5000)])
    expect(month(b, "2026-10")).toMatchObject({ hours: null, logged: null, invoiced: 5000, left: null })
    expect(b.toInvoice).toBe(1000)
  })

  it("never calls a contract without timecards invoiced: everything reads null", () => {
    const b = billing([], [inv("2026-08", 1000), inv("2026-07", 1000)])
    expect(b.loggedSince).toBeNull()
    expect(b.toInvoice).toBeNull()
    expect(b.thisMonth).toBeNull()
    expect(b.thisMonthHours).toBeNull()
    expect(b.months.map((m) => [m.hours, m.logged, m.left])).toEqual([
      [null, null, null],
      [null, null, null],
    ])
  })

  it("keeps a closed contract's rows and balance", () => {
    const closed: Contract & Pick<Engagement, "isActive" | "endMonth"> = { ...E1, isActive: false, endMonth: null }
    const b = bill({ engagements: [closed], timecards: [tc("2026-07-10", 16)], invoices: [inv("2026-07", 400)] })
    expect(b.months).toHaveLength(1)
    expect(b.toInvoice).toBe(600)
  })

  it("sums the client's contracts and ignores other clients' contracts and invoices", () => {
    const later = inv("2026-08", 300, { id: "second", number: "2", createdAt: new Date("2026-09-03") })
    const earlier = inv("2026-08", 200, { id: "first", number: "10", createdAt: new Date("2026-09-01") })
    const b = bill({
      engagements: [E1, { ...E1, id: "e2", dailyRate: 800 }, { ...E1, id: "x", clientId: "other" }],
      timecards: [tc("2026-07-10", 8), tc("2026-08-10", 8, "e2"), tc("2026-05-10", 80, "x")],
      invoices: [
        later,
        earlier,
        invoice({ engagementId: "x", yearMonth: "2026-04", amount: 9999 }),
        invoice({ clientId: "other", engagementId: null, yearMonth: "2026-08", amount: 5000 }),
      ],
    })
    expect(b.months.map((m) => m.yearMonth)).toEqual(["2026-08", "2026-07"])
    expect(month(b, "2026-08").invoices.map((i) => i.id)).toEqual(["first", "second"])
    expect(month(b, "2026-08").contracts).toEqual([{ engagementId: "e2", hours: 8, dailyRate: 800, logged: 800 }])
    expect(b.loggedSince).toBe("2026-07")
    // Jul 500 + Aug 800 − 500
    expect(b.toInvoice).toBe(800)
  })

  // Lumon: three contracts at €700, no VAT, billed on one invoice a month.
  const LU = ["north", "contoso", "labs"].map((id): Contract => ({ ...E1, id, dailyRate: 700 }))

  it("nets one invoice against all the client's contracts in its month", () => {
    const b = bill({
      engagements: LU,
      timecards: [tc("2026-08-10", 64, "north"), tc("2026-08-10", 32, "contoso"), tc("2026-08-10", 40, "labs")],
      invoices: [invoice({ clientId: "c", engagementId: null, yearMonth: "2026-08", amount: 11900, vat: 0 })],
    })
    const aug = month(b, "2026-08")
    expect(aug.contracts.map((l) => [l.engagementId, l.logged])).toEqual([
      ["north", 5600],
      ["contoso", 2800],
      ["labs", 3500],
    ])
    expect(aug).toMatchObject({ hours: 136, logged: 11900, left: 0 })
    expect(b.toInvoice).toBe(0)
  })

  it("rounds each line to cents, and the lines add up to the month", () => {
    const b = bill({
      engagements: LU.map((c) => ({ ...c, dailyRate: 745 })),
      timecards: [tc("2026-06-10", 23.5, "north"), tc("2026-06-10", 13, "contoso"), tc("2026-06-10", 6, "labs")],
      invoices: [],
    })
    const jun = month(b, "2026-06")
    expect(jun.contracts.map((l) => l.logged)).toEqual([2188.44, 1210.63, 558.75])
    expect(jun.logged).toBe(3957.82)
    expect(jun.hours).toBe(42.5)
  })

  it("values each contract at its own rate", () => {
    const b = bill({
      engagements: [E1, { ...E1, id: "e2", dailyRate: 800 }],
      timecards: [tc("2026-08-10", 8), tc("2026-08-10", 8, "e2")],
      invoices: [],
    })
    expect(month(b, "2026-08")).toMatchObject({ hours: 16, logged: 1300 })
  })

  it("lets an invoice recorded on one contract cover another contract's hours", () => {
    const b = bill({
      engagements: [E1, { ...E1, id: "e2" }],
      timecards: [tc("2026-08-10", 16, "e2")],
      invoices: [inv("2026-08", 1000)], // legacy, on e1
    })
    expect(month(b, "2026-08")).toMatchObject({ logged: 1000, invoiced: 1000, left: 0 })
    expect(b.toInvoice).toBe(0)
  })

  it("reads partly logged only at the client's first logged month", () => {
    const b = bill({
      engagements: [E1, { ...E1, id: "e2" }],
      // e1 logged from July; e2 only from August, ahead too.
      timecards: [tc("2026-07-10", 16), tc("2026-08-10", 8, "e2")],
      invoices: [inv("2026-07", 3000), inv("2026-08", 2000)],
    })
    expect(month(b, "2026-07")).toMatchObject({ left: -2000, partlyLogged: true })
    expect(month(b, "2026-08")).toMatchObject({ left: -1500, partlyLogged: false })
    expect(b.toInvoice).toBe(-1500)
  })

  it("gives the VAT-liable share of the month, and suggests VAT on it", () => {
    const b = bill({
      engagements: [E1, { ...E1, id: "e2", vatApplicable: true }],
      timecards: [tc("2026-08-10", 8), tc("2026-08-10", 8, "e2")],
      invoices: [],
    })
    expect(month(b, "2026-08").vatShare).toBe(0.5)
    expect(suggestedVat(2000, 0.5)).toBe(220)
    expect(suggestedVat(1000, 1)).toBe(220)
    expect(suggestedVat(-1000, 0)).toBe(0)
    const allVat = bill({ engagements: [{ ...E1, vatApplicable: true }], timecards: [tc("2026-08-10", 7)], invoices: [] })
    expect(month(allVat, "2026-08").vatShare).toBe(1)
  })

  it("keeps the rows of a client with invoices and no contracts, with no balance", () => {
    const b = bill({
      engagements: [],
      timecards: [],
      invoices: [invoice({ clientId: "c", engagementId: null, yearMonth: "2026-08", amount: 1000 })],
    })
    expect(b.months.map((m) => [m.yearMonth, m.hours, m.invoiced, m.contracts, m.vatShare])).toEqual([
      ["2026-08", null, 1000, [], 0],
    ])
    expect(b.toInvoice).toBeNull()
  })
})

describe("periodMonths", () => {
  it("is the accrual month alone for a single-month invoice", () => {
    expect(periodMonths({ fromMonth: null, yearMonth: "2026-07" })).toEqual(["2026-07"])
  })

  it("lists fromMonth to yearMonth, oldest first, across a year too", () => {
    expect(periodMonths({ fromMonth: "2026-04", yearMonth: "2026-06" })).toEqual(["2026-04", "2026-05", "2026-06"])
    expect(periodMonths({ fromMonth: "2025-11", yearMonth: "2026-01" })).toEqual(["2025-11", "2025-12", "2026-01"])
  })

  it("reads bad stored data as one month, and spreads an over-long period over its first 12", () => {
    expect(periodMonths({ fromMonth: "2026-07", yearMonth: "2026-07" })).toEqual(["2026-07"])
    expect(periodMonths({ fromMonth: "2026-08", yearMonth: "2026-07" })).toEqual(["2026-07"])
    expect(periodMonths({ fromMonth: "2024-01", yearMonth: "2026-01" })).toEqual(monthsFrom("2024-01", 12))
  })
})

describe("invoicePeriodError", () => {
  it("accepts one month, either way it is written", () => {
    expect(invoicePeriodError(null, "2026-07")).toBeNull()
    expect(invoicePeriodError("2026-07", "2026-07")).toBeNull()
  })

  it("refuses a first month after the last one", () => {
    expect(invoicePeriodError("2026-08", "2026-07")).toBe("The first month comes after the last one.")
  })

  it("accepts 12 months and refuses 13", () => {
    expect(invoicePeriodError("2026-01", "2026-12")).toBeNull()
    expect(invoicePeriodError("2026-01", "2027-01")).toBe("An invoice covers at most 12 months.")
  })
})

describe("invoicePeriodLabel", () => {
  it("names one month, a period within a year, and one across years", () => {
    expect(invoicePeriodLabel({ fromMonth: null, yearMonth: "2026-07" })).toBe("Jul 2026")
    expect(invoicePeriodLabel({ fromMonth: "2026-04", yearMonth: "2026-06" })).toBe("Apr–Jun 2026")
    expect(invoicePeriodLabel({ fromMonth: "2025-11", yearMonth: "2026-01" })).toBe("Nov 2025–Jan 2026")
  })
})

describe("clientBilling: an invoice covering several months", () => {
  const period = (fromMonth: string, yearMonth: string, amount: number, o: Partial<Invoice> = {}) =>
    inv(yearMonth, amount, { fromMonth, ...o })

  it("spreads it in proportion to the value logged in each month", () => {
    const b = billing([tc("2026-07-10", 16), tc("2026-08-10", 48)], [period("2026-07", "2026-08", 4000)])
    expect(month(b, "2026-07")).toMatchObject({ logged: 1000, invoiced: 1000, left: 0 })
    expect(month(b, "2026-08")).toMatchObject({ logged: 3000, invoiced: 3000, left: 0 })
    expect(b.toInvoice).toBe(0)
  })

  it("spreads it evenly over months with nothing logged, the last taking the cents", () => {
    const b = billing([tc("2026-08-10", 16)], [period("2026-04", "2026-06", 100)])
    expect(b.months.map((m) => [m.yearMonth, m.invoiced, m.left])).toEqual([
      ["2026-08", 0, 1000],
      ["2026-06", 33.34, null],
      ["2026-05", 33.33, null],
      ["2026-04", 33.33, null],
    ])
    expect(b.toInvoice).toBe(1000)
  })

  it("never counts the months before the first hours (Globex: #9 Apr–Jun, hours from July)", () => {
    const b = bill({
      engagements: [{ ...E1, dailyRate: 1000, vatApplicable: true, startMonth: "2026-07" }],
      timecards: [tc("2026-07-10", 56)],
      invoices: [
        period("2026-04", "2026-06", 12000, { id: "i9", number: "9" }),
        inv("2026-07", 5000, { id: "i10", number: "10" }),
      ],
    })
    for (const ym of ["2026-04", "2026-05", "2026-06"]) {
      expect(month(b, ym)).toMatchObject({ hours: null, invoiced: 4000, left: null })
      expect(month(b, ym).invoices.map((i) => i.number)).toEqual(["9"])
    }
    expect(month(b, "2026-07")).toMatchObject({ logged: 7000, left: 2000, unbilled: 2000 })
    expect(b.toInvoice).toBe(2000)
  })

  it("reconciles Globex to 0 once May and June are logged", () => {
    const b = bill({
      engagements: [{ ...E1, dailyRate: 1000, vatApplicable: true, startMonth: "2026-05" }],
      timecards: [tc("2026-05-10", 24), tc("2026-06-10", 56), tc("2026-07-10", 56)],
      invoices: [
        period("2026-04", "2026-06", 12000, { id: "i9", number: "9" }),
        inv("2026-07", 5000, { id: "i10", number: "10" }),
      ],
    })
    expect(b.months.map((m) => [m.yearMonth, m.invoiced, m.left])).toEqual([
      ["2026-07", 5000, 2000],
      ["2026-06", 8400, -1400],
      ["2026-05", 3600, -600],
      ["2026-04", 0, null],
    ])
    expect(b.toInvoice).toBe(0)
  })

  it("subtracts a credit note covering several months pro rata", () => {
    const b = billing(
      [tc("2026-07-10", 16), tc("2026-08-10", 48)],
      [inv("2026-07", 1000), inv("2026-08", 3000), period("2026-07", "2026-08", -400)],
    )
    expect(month(b, "2026-07")).toMatchObject({ invoiced: 900, left: 100 })
    expect(month(b, "2026-08")).toMatchObject({ invoiced: 2700, left: 300 })
    expect(b.toInvoice).toBe(400)
  })

  // Review: weighted by hours so far, Q4 landed €28,571 on October and hid September's €10,000.
  it("gives the current month and later an even share, so an advance never covers older months", () => {
    const b = bill({
      engagements: [{ ...E1, startMonth: "2026-09" }],
      timecards: [tc("2026-09-15", 160), tc("2026-10-15", 160), tc("2026-11-02", 8)],
      invoices: [period("2026-10", "2026-12", 30000)],
      today: "2026-11-03",
    })
    expect(b.months.map((m) => [m.yearMonth, m.invoiced, m.left, m.unbilled])).toEqual([
      ["2026-12", 10000, null, 0],
      ["2026-11", 10000, -9500, 0],
      ["2026-10", 10000, 0, 0],
      ["2026-09", 0, 10000, 10000],
    ])
    expect(b.toInvoice).toBe(10000)
  })

  it("reads a quarterly invoice recorded as a period invoiced on every month, none ahead", () => {
    const b = billing(
      [tc("2026-06-15", 80), tc("2026-07-15", 80), tc("2026-08-15", 80)],
      [period("2026-06", "2026-08", 15000)],
    )
    expect(b.months.map((m) => [m.invoiced, m.left])).toEqual([
      [5000, 0],
      [5000, 0],
      [5000, 0],
    ])
    expect(b.toInvoice).toBe(0)
  })
})

// ─── Dated rates: an amendment never reprices the months before it ──────────

describe("clientBilling with dated rates", () => {
  const amend = (from: string, dailyRate: number) =>
    ({ from, dailyRate, addedDays: null, lastDay: null, lastDayBefore: null, note: null })
  const after = "2026-10-07"
  const monthly = (months: string[], hours: number, engagementId = "e1") =>
    months.map((ym) => tc(`${ym}-15`, hours, engagementId))
  const invoiced = (months: string[], amount: number) =>
    months.map((ym, k) => inv(ym, amount, { id: `i${k}`, number: String(k + 1) }))

  // Example 1, Lumon PCM: €700/day, 10 days a month, Jan–Sep 2026 invoiced at €7,000.
  const nine = monthsFrom("2026-01", 9)
  const pcm: Contract = { ...E1, dailyRate: 700 }
  const lumon = (contract: Contract) =>
    bill({ engagements: [contract], timecards: monthly(nine, 80), invoices: invoiced(nine, 7000), today: after })

  it("keeps every invoiced month settled when the rate rises from a later month", () => {
    const b = lumon({ ...pcm, amendments: [amend("2027-01", 800)] })
    expect(b.months.every((m) => m.left === 0)).toBe(true)
    expect(b.toInvoice).toBe(0)
  })

  it("pins the defect: editing the signed rate reprices every invoiced month", () => {
    const b = lumon({ ...pcm, dailyRate: 800 })
    expect(b.months.every((m) => m.left === 1000)).toBe(true)
    expect(b.toInvoice).toBe(9000)
  })

  // Example 4, Globex: €1,000/day, 8 days a month, Jul–Sep invoiced at €8,000.
  const quarter = ["2026-07", "2026-08", "2026-09"]
  const globex = (rate: number) =>
    bill({
      engagements: [{ ...E1, dailyRate: 1000, amendments: [amend("2026-09", rate)] }],
      timecards: monthly(quarter, 64),
      invoices: invoiced(quarter, 8000),
      today: after,
    })

  it("reprices only the months from a backdated amendment on, either way", () => {
    const up = globex(1050)
    expect(up.months.map((m) => [m.yearMonth, m.left])).toEqual([["2026-09", 400], ["2026-08", 0], ["2026-07", 0]])
    expect(up.toInvoice).toBe(400)
    const down = globex(950)
    expect(month(down, "2026-09").left).toBe(-400)
    expect(down.toInvoice).toBe(-400)
  })

  it("puts the month's rate on each line", () => {
    const b = globex(1050)
    expect(month(b, "2026-08").contracts).toEqual([{ engagementId: "e1", hours: 64, dailyRate: 1000, logged: 8000 }])
    expect(month(b, "2026-09").contracts).toEqual([{ engagementId: "e1", hours: 64, dailyRate: 1050, logged: 8400 }])
  })

  it("spreads an invoice covering a rate change by each month's own value", () => {
    const b = bill({
      engagements: [{ ...E1, dailyRate: 1000, amendments: [amend("2026-09", 1050)] }],
      timecards: monthly(["2026-08", "2026-09"], 64),
      invoices: [inv("2026-09", 16400, { fromMonth: "2026-08" })],
      today: after,
    })
    expect(month(b, "2026-08")).toMatchObject({ logged: 8000, invoiced: 8000, left: 0 })
    expect(month(b, "2026-09")).toMatchObject({ logged: 8400, invoiced: 8400, left: 0 })
    expect(b.toInvoice).toBe(0)
  })

  it("changes nothing for a contract without amendments, absent or empty", () => {
    const input = { timecards: monthly(nine, 77), invoices: invoiced(nine.slice(0, 5), 7000), today: after }
    expect(JSON.stringify(bill({ ...input, engagements: [{ ...pcm, amendments: [] }] }))).toBe(
      JSON.stringify(bill({ ...input, engagements: [pcm] })),
    )
  })
})

describe("invoiceClientId", () => {
  const engagements = [{ id: "e1", clientId: "c" }]

  it("reads the invoice's own client first, then its contract's, else null", () => {
    expect(invoiceClientId({ clientId: "c2", engagementId: "e1" }, engagements)).toBe("c2")
    expect(invoiceClientId({ clientId: null, engagementId: "e1" }, engagements)).toBe("c")
    expect(invoiceClientId({ clientId: null, engagementId: "gone" }, engagements)).toBeNull()
  })
})

describe("plannedBilling", () => {
  const NOW = new Date("2026-01-01")

  function engagement(o: Partial<Engagement> = {}): Engagement {
    return {
      id: "e1", userId: "u", clientId: "c1", name: null, opportunityId: null,
      dailyRate: 500, vatApplicable: true,
      contractedDays: null, defaultDaysPerMonth: 10, startMonth: null, endMonth: null, endDate: null,
      isActive: true, notes: null, createdAt: NOW, updatedAt: NOW, ...o,
    }
  }

  function allocation(yearMonth: string, days: number, engagementId = "e1"): Allocation {
    return { id: `${engagementId}-${yearMonth}`, userId: "u", engagementId, yearMonth, days, createdAt: NOW, updatedAt: NOW }
  }

  function planned(e: Engagement, allocations: Allocation[] = []) {
    return plannedBilling({ engagement: e, allocations, currentMonth: CM, months: 3 })
  }

  it("fills the current month and the next three with the default days × rate", () => {
    expect(planned(engagement())).toEqual([
      { yearMonth: "2026-09", days: 10, value: 5000 },
      { yearMonth: "2026-10", days: 10, value: 5000 },
      { yearMonth: "2026-11", days: 10, value: 5000 },
      { yearMonth: "2026-12", days: 10, value: 5000 },
    ])
  })

  it("uses a stored allocation, gives a stored 0 no entry, and ignores other contracts", () => {
    const result = planned(engagement(), [allocation("2026-10", 0), allocation("2026-11", 4), allocation("2026-12", 20, "e2")])
    expect(result.map((m) => [m.yearMonth, m.days, m.value])).toEqual([
      ["2026-09", 10, 5000],
      ["2026-11", 4, 2000],
      ["2026-12", 10, 5000],
    ])
  })

  it("stops the default after endMonth", () => {
    expect(planned(engagement({ endMonth: "2026-10" })).map((m) => m.yearMonth)).toEqual(["2026-09", "2026-10"])
  })

  it("caps at contractedDays, burned from the current month", () => {
    expect(planned(engagement({ contractedDays: 25 })).map((m) => [m.yearMonth, m.days])).toEqual([
      ["2026-09", 10],
      ["2026-10", 10],
      ["2026-11", 5],
    ])
  })

  it("burns contractedDays from the contract's start, not from today (#155)", () => {
    // was [09:10, 10:10, 11:10, 12:10]: Jun–Aug's 30 default days were never burned
    expect(planned(engagement({ startMonth: "2026-06", contractedDays: 45 })).map((m) => [m.yearMonth, m.days])).toEqual([
      ["2026-09", 10],
      ["2026-10", 5],
    ])
  })

  it("gives a closed contract with no endMonth nothing", () => {
    expect(planned(engagement({ isActive: false, endMonth: null }))).toEqual([])
  })
})

describe("invoicedByMonth", () => {
  const months = monthsFrom("2025-10", 12)

  it("returns every month, 0-filled", () => {
    const result = invoicedByMonth([], months)
    expect(result).toHaveLength(12)
    expect(result[0]).toEqual({ yearMonth: "2025-10", amount: 0 })
    expect(result[11]).toEqual({ yearMonth: "2026-09", amount: 0 })
  })

  it("keys on the accrual month, not when the invoice was recorded", () => {
    const result = invoicedByMonth(
      [invoice({ yearMonth: "2026-08", amount: 4000, createdAt: new Date("2026-09-05") })],
      months,
    )
    expect(result.find((m) => m.yearMonth === "2026-08")?.amount).toBe(4000)
    expect(result.find((m) => m.yearMonth === "2026-09")?.amount).toBe(0)
  })

  it("keeps a month netted negative by a credit note negative", () => {
    const result = invoicedByMonth([invoice({ yearMonth: "2026-07", amount: -500 })], months)
    expect(result.find((m) => m.yearMonth === "2026-07")?.amount).toBe(-500)
  })

  it("rounds float noise to a clean 0, never -0", () => {
    const noisy = [0.3, -0.1, -0.2].map((amount) => invoice({ yearMonth: "2026-07", amount }))
    expect(invoicedByMonth(noisy, months).find((m) => m.yearMonth === "2026-07")?.amount).toBe(0)
  })
})

// ─── Suggestions ─────────────────────────────────────────────────────────────

/** Local midnight, the way dates are stored. */
const d = (iso: string) => new Date(`${iso}T00:00:00`)
/** An invoice naming the client "c" itself, as every invoice recorded since #181 does. */
const linv = (yearMonth: string, amount: number, o: Partial<Invoice> = {}) => inv(yearMonth, amount, { clientId: "c", ...o })
const sumAmounts = (b: ReturnType<typeof clientBilling>) =>
  Math.round(invoiceSuggestions(b).reduce((s, x) => s + x.amount, 0) * 100) / 100

// The review's seed, today 2026-10-01: three contracts at €700, no VAT.
const L = (id: string): Contract => ({ id, clientId: "c", dailyRate: 700, startMonth: "2026-06", vatApplicable: false })
const LUMON = {
  engagements: [L("op"), L("co"), L("labs")],
  timecards: [
    tc("2026-06-10", 136, "op"), tc("2026-07-10", 152, "op"), tc("2026-08-10", 72, "op"),
    tc("2026-09-10", 88, "op"), tc("2026-09-11", 32, "co"), tc("2026-09-12", 40, "labs"),
    tc("2026-10-01", 8, "op"),
  ],
  invoices: [
    linv("2026-06", 11900, { id: "i11", number: "11/2026", dueDate: d("2026-08-31"), createdAt: d("2026-07-02") }),
    linv("2026-07", 14000, { id: "i14", number: "14/2026", dueDate: d("2026-09-30"), createdAt: d("2026-08-02") }),
    linv("2026-07", -700, { id: "nc2", number: "NC 2/2026", createdAt: d("2026-08-20") }),
    linv("2026-08", 6300, { id: "i17", number: "17/2026", dueDate: d("2026-10-31"), createdAt: d("2026-09-02") }),
  ],
  today: "2026-10-01",
}
// One contract at €500 with VAT; 9/2026 covered Apr–Jun (2,500 + 3,000 + 2,000).
const N: Contract = { id: "n", clientId: "c", dailyRate: 500, startMonth: "2026-04", vatApplicable: true }
const NORDIC = {
  engagements: [N],
  timecards: [
    tc("2026-04-10", 40, "n"), tc("2026-05-10", 48, "n"), tc("2026-06-10", 32, "n"),
    tc("2026-07-10", 40, "n"), tc("2026-08-10", 24, "n"), tc("2026-09-10", 40, "n"),
  ],
  invoices: [
    linv("2026-06", 7500, {
      id: "i9", number: "9/2026", fromMonth: "2026-04", vat: 1650,
      dueDate: d("2026-07-31"), paidDate: d("2026-07-31"), createdAt: d("2026-07-01"),
    }),
  ],
  today: "2026-10-01",
}

describe("invoiceSuggestions", () => {
  it("proposes Lumon's open September alone, every contract's hours in it", () => {
    const b = bill(LUMON)
    expect(invoiceSuggestions(b)).toEqual([
      { clientId: "c", fromMonth: null, yearMonth: "2026-09", months: ["2026-09"], hours: 160, amount: 14000, vat: 0 },
    ])
    expect(b.toInvoice).toBe(14000)
  })

  it("joins Nordic's three open months into one invoice, VAT added up month by month", () => {
    expect(invoiceSuggestions(bill(NORDIC))).toEqual([
      {
        clientId: "c", fromMonth: "2026-07", yearMonth: "2026-09",
        months: ["2026-07", "2026-08", "2026-09"], hours: 104, amount: 6500, vat: 1430,
      },
    ])
  })

  it("keeps a partly invoiced month to itself, so the next invoice never lands on what was paid", () => {
    const b = bill({
      engagements: [N],
      timecards: [tc("2026-07-10", 40, "n"), tc("2026-08-10", 40, "n"), tc("2026-09-10", 40, "n")],
      invoices: [linv("2026-08", 1000)],
      today: "2026-10-01",
    })
    expect(invoiceSuggestions(b).map((x) => [x.fromMonth, x.yearMonth, x.amount, x.vat])).toEqual([
      [null, "2026-07", 2500, 550],
      [null, "2026-08", 1500, 330],
      [null, "2026-09", 2500, 550],
    ])
  })

  it("runs across a month with no hours and no invoice, which takes no share once recorded", () => {
    const input = {
      engagements: [N],
      timecards: [tc("2026-07-10", 40, "n"), tc("2026-09-10", 40, "n")],
      invoices: [] as Invoice[],
      today: "2026-10-01",
    }
    const [s] = invoiceSuggestions(bill(input))
    expect(s).toMatchObject({ fromMonth: "2026-07", yearMonth: "2026-09", months: ["2026-07", "2026-08", "2026-09"], amount: 5000 })

    const after = bill({ ...input, invoices: [linv(s.yearMonth, s.amount, { fromMonth: s.fromMonth, vat: s.vat })] })
    expect(after.months.map((m) => [m.yearMonth, m.invoiced, m.left])).toEqual([
      ["2026-09", 2500, 0],
      ["2026-08", 0, 0],
      ["2026-07", 2500, 0],
    ])
    expect(after.toInvoice).toBe(0)
  })

  it("never proposes more than 12 months in one invoice", () => {
    const months = monthsFrom("2025-01", 14)
    const b = bill({ engagements: [N], timecards: months.map((m) => tc(`${m}-10`, 8, "n")), invoices: [] })
    expect(invoiceSuggestions(b).map((x) => [x.fromMonth, x.yearMonth, x.months.length])).toEqual([
      ["2025-01", "2025-12", 12],
      ["2026-01", "2026-02", 2],
    ])
  })

  it("adds up to the To invoice tile, max(0, toInvoice), whatever the history", () => {
    const quarter = [tc("2026-06-15", 80), tc("2026-07-15", 80), tc("2026-08-15", 80)]
    const seeds = [
      bill(LUMON),
      bill(NORDIC),
      billing(quarter, [inv("2026-08", 13000)]),
      billing(quarter, [inv("2026-08", 20000)]),
      billing(quarter, [inv("2026-06", 2000), inv("2026-07", -500)]),
    ]
    for (const b of seeds) expect(sumAmounts(b)).toBe(Math.max(0, b.toInvoice ?? 0))
    // The part-covering invoice leaves July €2,000: offered alone, never July's whole €5,000.
    expect(invoiceSuggestions(seeds[2]).map((x) => [x.yearMonth, x.amount])).toEqual([["2026-07", 2000]])
    expect(invoiceSuggestions(seeds[3])).toEqual([])
  })
})

describe("rangeSuggestion", () => {
  it("re-totals net, VAT and hours for the months picked", () => {
    expect(rangeSuggestion(bill(NORDIC), "2026-07", "2026-08")).toEqual({
      months: ["2026-07", "2026-08"], hours: 64, logged: 4000, amount: 4000, vat: 880, vatShare: 1,
    })
  })

  it("reads the VAT share from logged, then from the contracts, when nothing is left", () => {
    const b = bill(NORDIC)
    expect(rangeSuggestion(b, "2026-04", "2026-06")).toMatchObject({ amount: 0, logged: 7500, vatShare: 1 })
    expect(rangeSuggestion(b, "2025-01", "2025-01", [N]).vatShare).toBe(1)
    expect(rangeSuggestion(b, "2025-01", "2025-01", [N, { ...E1, clientId: "c" }]).vatShare).toBe(0)
    expect(rangeSuggestion(b, "2025-01", "2025-01").vatShare).toBe(0)
  })
})

describe("nextInvoiceNumber", () => {
  const n = (number: string, createdAt: string, amount = 1000) =>
    linv("2026-01", amount, { id: number, number, createdAt: d(createdAt) })
  const today = "2026-10-01"

  it("follows the latest number's series: the highest counter this year, plus 1", () => {
    const history = [n("11/2026", "2026-07-02"), n("14/2026", "2026-08-02"), n("9/2026", "2026-08-10"), n("17/2026", "2026-09-02")]
    expect(nextInvoiceNumber(history, { today })).toBe("18/2026")
  })

  it("numbers credit notes in their own series, leaving the invoices' alone", () => {
    const history = [n("17/2026", "2026-09-02"), n("NC 2/2026", "2026-09-20", -700)]
    expect(nextInvoiceNumber(history, { credit: true, today })).toBe("NC 3/2026")
    expect(nextInvoiceNumber(history, { today })).toBe("18/2026")
  })

  it("reads the year wherever it sits, and keeps the counter's zero padding", () => {
    expect(nextInvoiceNumber([n("2026/14", "2026-09-02")], { today })).toBe("2026/15")
    expect(nextInvoiceNumber([n("INV-2026-0014", "2026-09-02")], { today })).toBe("INV-2026-0015")
  })

  it("restarts at 1 in a new year", () => {
    expect(nextInvoiceNumber([n("17/2025", "2025-12-20")], { today: "2026-01-05" })).toBe("1/2026")
  })

  it("skips a number already taken, whatever its case", () => {
    const history = [n("inv-2026-0015", "2026-08-02"), n("INV-2026-0014", "2026-09-02")]
    expect(nextInvoiceNumber(history, { today })).toBe("INV-2026-0016")
  })

  it("is empty with no history in the series", () => {
    expect(nextInvoiceNumber([], { today })).toBe("")
    expect(nextInvoiceNumber([n("17/2026", "2026-09-02")], { credit: true, today })).toBe("")
  })

  it("names the number it follows: the highest, not the last recorded", () => {
    const history = [n("17/2026", "2026-09-02"), n("9/2026", "2026-09-10")]
    expect(suggestedInvoiceNumber(history, { today })).toEqual({ number: "18/2026", after: "17/2026" })
    expect(suggestedInvoiceNumber([n("17/2025", "2025-12-20")], { today: "2026-01-05" })).toEqual({
      number: "1/2026",
      after: null,
    })
  })
})

describe("suggestedDueDate", () => {
  it("keeps the customer's terms, on the month's last day when that is where they fell", () => {
    expect(suggestedDueDate(LUMON.invoices, "2026-09", "2026-10-01")).toEqual({
      date: "2026-11-30",
      basis: "Same terms as 17/2026 (due 31 Oct for Aug).",
    })
    expect(suggestedDueDate(NORDIC.invoices, "2026-09", "2026-10-01")?.date).toBe("2026-10-31")
  })

  it("keeps the same day otherwise, clamped to a shorter month", () => {
    const prev = [linv("2025-07", 1000, { number: "5/2025", dueDate: d("2025-08-30"), createdAt: d("2025-08-01") })]
    expect(suggestedDueDate(prev, "2026-01", "2026-02-01")?.date).toBe("2026-02-28")
    expect(suggestedDueDate(prev, "2026-02", "2026-03-01")?.date).toBe("2026-03-30")
  })

  it("takes the later month's terms when two invoices were recorded in the same instant", () => {
    const at = d("2026-09-02")
    const same = [
      linv("2026-06", 1000, { number: "11/2026", dueDate: d("2026-07-31"), createdAt: at }),
      linv("2026-08", 1000, { number: "17/2026", dueDate: d("2026-10-31"), createdAt: at }),
    ]
    expect(suggestedDueDate(same, "2026-09", "2026-10-01")?.date).toBe("2026-11-30")
    expect(suggestedDueDate([...same].reverse(), "2026-09", "2026-10-01")?.date).toBe("2026-11-30")
  })

  it("counts a late recording from last month, never giving it a due date in the past", () => {
    expect(suggestedDueDate(LUMON.invoices, "2026-06", "2026-10-01")?.date).toBe("2026-11-30")
  })

  it("is null with no terms to copy, or when they give a date already past", () => {
    expect(suggestedDueDate([], "2026-09", "2026-10-01")).toBeNull()
    expect(suggestedDueDate([linv("2026-08", 1000, { dueDate: null })], "2026-09", "2026-10-01")).toBeNull()
    expect(suggestedDueDate([linv("2026-08", -1000, { dueDate: d("2026-10-31") })], "2026-09", "2026-10-01")).toBeNull()
    const net15 = [linv("2026-08", 1000, { dueDate: d("2026-09-15") })]
    expect(suggestedDueDate(net15, "2026-09", "2026-10-20")).toBeNull()
  })
})

describe("invoiceNumberTaken", () => {
  const history = [linv("2026-09", 1000, { id: "a", number: "18/2026" }), linv("2026-07", -700, { id: "b", number: "NC 2/2026" })]

  it("matches trimmed and case-insensitive, leaving the invoice being edited aside", () => {
    expect(invoiceNumberTaken(history, " 18/2026 ")?.id).toBe("a")
    expect(invoiceNumberTaken(history, "nc 2/2026")?.id).toBe("b")
    expect(invoiceNumberTaken(history, "18/2026", "a")).toBeUndefined()
    expect(invoiceNumberTaken(history, "19/2026")).toBeUndefined()
  })
})

describe("invoiceStatus", () => {
  const today = new Date("2026-10-01T12:00:00")
  const label = (o: Partial<Invoice>) => invoiceStatus(linv("2026-08", 1000, o), today)

  it("says due, overdue, paid or unpaid, with the year only when it is not this one", () => {
    // Says unpaid first, as the overdue one says overdue: a due date alone read like a deadline met.
    expect(label({ dueDate: d("2026-10-31") })).toEqual({ tone: "due", label: "Unpaid · due 31 Oct" })
    expect(label({ dueDate: d("2026-08-31") })).toEqual({ tone: "overdue", label: "Overdue · due 31 Aug" })
    expect(label({ dueDate: d("2026-08-31"), paidDate: d("2026-08-02") })).toEqual({ tone: "paid", label: "Paid 2 Aug" })
    expect(label({ paidDate: d("2025-12-30") })).toEqual({ tone: "paid", label: "Paid 30 Dec 2025" })
    expect(label({})).toEqual({ tone: "unpaid", label: "Unpaid" })
  })

  it("says open or settled for a credit note, never overdue", () => {
    const credit = (o: Partial<Invoice>) => invoiceStatus(linv("2026-07", -700, { dueDate: d("2026-08-01"), ...o }), today)
    expect(credit({})).toEqual({ tone: "credit", label: "Credit note · open" })
    expect(credit({ paidDate: d("2026-09-03") })).toEqual({ tone: "paid", label: "Credit note · settled 3 Sep" })
  })
})

describe("creditsOn and openCredits", () => {
  const engagements = [{ id: "e1", clientId: "c" }]
  const i14 = linv("2026-07", 14000, { id: "i14" })

  it("offers the customer's unpaid credit notes on the same months, not another customer's", () => {
    const nc2 = linv("2026-07", -700, { id: "nc2" })
    const quarter = linv("2026-08", -100, { id: "q", fromMonth: "2026-06" })
    const all = [
      i14, nc2, quarter,
      linv("2026-08", -100, { id: "aug" }),
      linv("2026-07", -100, { id: "settled", paidDate: d("2026-09-01") }),
      linv("2026-07", -100, { id: "other", clientId: "c2" }),
      // No clientId: its contract names the customer.
      inv("2026-07", -100, { id: "legacy" }),
    ]
    expect(openCredits(i14, all, engagements).map((i) => i.id)).toEqual(["nc2", "q", "legacy"])
    // What already corrects 14: the settled one too.
    expect(creditsOn(i14, all, engagements).map((i) => i.id)).toEqual(["nc2", "q", "settled", "legacy"])
  })

  it("offers nothing to settle with a credit note", () => {
    const nc2 = linv("2026-07", -700, { id: "nc2" })
    expect(openCredits(nc2, [i14, nc2, linv("2026-07", -1, { id: "x" })], engagements)).toEqual([])
  })
})

// ─── Amendment effects: what the dialog and amend_contract show first ────────

describe("amendmentEffects", () => {
  const at = new Date("2026-01-01")
  const contract = (o: Partial<Engagement> = {}): Engagement => ({
    id: "e1", userId: "u", clientId: "c", name: null, opportunityId: null, dailyRate: 1000, vatApplicable: false,
    contractedDays: 96, defaultDaysPerMonth: 8, startMonth: "2026-01", endMonth: "2026-12", endDate: null,
    isActive: true, notes: null, createdAt: at, updatedAt: at, ...o,
  })
  const amend = (o: Partial<ContractAmendment>): ContractAmendment => ({
    from: "2026-09", dailyRate: null, addedDays: null, lastDay: null, lastDayBefore: null, note: null, ...o,
  })
  const row = (yearMonth: string, days: number): Allocation => ({
    id: yearMonth, userId: "u", engagementId: "e1", yearMonth, days, createdAt: at, updatedAt: at,
  })
  const effects = (
    before: Engagement,
    after: Engagement,
    from: string,
    o: Partial<Parameters<typeof amendmentEffects>[0]> = {},
  ) =>
    amendmentEffects({ before, after, from, engagements: [before], allocations: [], timecards: [], invoices: [], today: "2026-10-07", ...o })

  // Example 4, Globex: €1,000/day, 8 days a month, Jul–Sep worked and invoiced at €8,000.
  const quarter = ["2026-07", "2026-08", "2026-09"]
  const worked = {
    timecards: quarter.map((ym) => tc(`${ym}-15`, 64)),
    invoices: quarter.map((ym, k) => inv(ym, 8000, { id: `i${k}`, number: String(k + 1) })),
  }
  const globex = contract()

  it("prices a backdated rise as a top-up on the invoiced month", () => {
    const fx = effects(globex, contract({ amendments: [amend({ dailyRate: 1050 })] }), "2026-09", worked)
    expect(fx.invoicedRepriced).toEqual([{ yearMonth: "2026-09", invoiced: 8000, delta: 400 }])
    expect(fx.toInvoiceDelta).toBe(400)
    expect(fx.warnings).toEqual([
      "Sep 2026 is invoiced at €8,000; this contract's 8 days there at €1,050/day instead of €1,000: €400 more to invoice (a top-up).",
    ])
  })

  it("leaves an invoiced closed month with no hours of this contract alone: no top-up, no credit note", () => {
    const fx = effects(globex, contract({ amendments: [amend({ from: "2026-08", dailyRate: 1050 })] }), "2026-08", {
      timecards: [tc("2026-09-15", 64)],
      invoices: [inv("2026-08", 8000, { id: "i1", number: "1" }), inv("2026-09", 8000, { id: "i2", number: "2" })],
    })
    expect(fx.invoicedRepriced).toEqual([{ yearMonth: "2026-09", invoiced: 8000, delta: 400 }])
    expect(fx.toInvoiceDelta).toBe(400)
    expect(fx.warnings).toHaveLength(1)
  })

  it("tells an hourly contract's warning in hours and €/h", () => {
    // €75/h is €600/day stored; October holds 10 h, invoiced at €750.
    const hourly = contract({ unit: "hour", dailyRate: 600, contractedDays: 12.5, defaultDaysPerMonth: 5 })
    const fx = effects(hourly, contract({ ...hourly, amendments: [amend({ from: "2026-10", dailyRate: 640 })] }), "2026-10", {
      timecards: [tc("2026-10-05", 10)],
      invoices: [inv("2026-10", 750)],
    })
    expect(fx.warnings[0]).toContain("this contract's 10 hours there at €80/h instead of €75/h: €50 more to invoice")
    expect(fx.warnings[0]).not.toMatch(/day/)
  })

  it("prices a backdated cut as a credit note", () => {
    const fx = effects(globex, contract({ amendments: [amend({ dailyRate: 950 })] }), "2026-09", worked)
    expect(fx.invoicedRepriced).toEqual([{ yearMonth: "2026-09", invoiced: 8000, delta: -400 }])
    expect(fx.toInvoiceDelta).toBe(-400)
    expect(fx.warnings[0]).toContain("€400 less, so €400 reads as invoiced ahead: issue a credit note")
  })

  it("gives the mirror result for a removal, which reads settled again", () => {
    const fx = effects(contract({ amendments: [amend({ dailyRate: 1050 })] }), globex, "2026-09", worked)
    expect(fx.invoicedRepriced).toEqual([{ yearMonth: "2026-09", invoiced: 8000, delta: -400 }])
    expect(fx.toInvoiceDelta).toBe(-400)
    expect(fx.warnings[0]).toMatch(/at €1,000\/day instead of €1,050: €400 less to invoice: it is settled\.$/)
    const undoCut = effects(contract({ amendments: [amend({ dailyRate: 950 })] }), globex, "2026-09", worked)
    expect(undoCut.warnings[0]).toMatch(/: €400 less invoiced ahead: it is settled\.$/)
  })

  it("touches nothing invoiced from the next month on", () => {
    const fx = effects(globex, contract({ amendments: [amend({ from: "2026-10", dailyRate: 1050 })] }), "2026-10", worked)
    expect(fx).toEqual({
      invoicedRepriced: [], toInvoiceDelta: 0, cappedAhead: [], cappedWithHours: [], daysLeftAtEnd: 0, zeroRowsInExtension: [],
      pastMonthsPlanned: [], warnings: [],
    })
  })

  // Owner decision 2 asks before any invoiced month is repriced, an invoice in advance included.
  it("asks for a month invoiced ahead with no hours yet, by its planned days", () => {
    const novAhead = { ...worked, invoices: [...worked.invoices, inv("2026-11", 8000, { id: "nov", number: "4" })] }
    const fx = effects(globex, contract({ amendments: [amend({ from: "2026-11", dailyRate: 1050 })] }), "2026-11", novAhead)
    expect(fx.invoicedRepriced).toEqual([{ yearMonth: "2026-11", invoiced: 8000, delta: 400 }])
    expect(fx.warnings).toEqual([
      "Nov 2026 is invoiced ahead at €8,000, with no hours on this contract yet: at €1,050/day instead of €1,000 its 8 days planned come to €400 more, a top-up once worked.",
    ])
    const cut = effects(globex, contract({ amendments: [amend({ from: "2026-11", dailyRate: 950 })] }), "2026-11", novAhead)
    expect(cut.warnings[0]).toContain("its 8 days planned come to €400 less, a credit note once worked.")
  })

  it("asks for each month of a quarter invoiced ahead from the amended month on, the current one included", () => {
    const quarterAhead = { ...worked, invoices: [...worked.invoices, inv("2026-12", 24000, { id: "q4", number: "4", fromMonth: "2026-10" })] }
    const fromNov = effects(globex, contract({ amendments: [amend({ from: "2026-11", dailyRate: 1200 })] }), "2026-11", quarterAhead)
    expect(fromNov.invoicedRepriced).toEqual([
      { yearMonth: "2026-11", invoiced: 8000, delta: 1600 },
      { yearMonth: "2026-12", invoiced: 8000, delta: 1600 },
    ])
    expect(fromNov.warnings[0]).toMatch(/^Nov 2026 is invoiced ahead with Oct 2026–Dec 2026 \(€24,000\), with no hours/)
    const fromOct = effects(globex, contract({ amendments: [amend({ from: "2026-10", dailyRate: 1200 })] }), "2026-10", quarterAhead)
    expect(fromOct.invoicedRepriced.map((m) => m.yearMonth)).toEqual(["2026-10", "2026-11", "2026-12"])
  })

  it("names only the amended month of a quarter invoiced at once, by its own delta", () => {
    const oneInvoice = { timecards: worked.timecards, invoices: [inv("2026-09", 24000, { id: "q3", fromMonth: "2026-07" })] }
    const fx = effects(globex, contract({ amendments: [amend({ dailyRate: 1050 })] }), "2026-09", oneInvoice)
    expect(fx.invoicedRepriced).toEqual([{ yearMonth: "2026-09", invoiced: 8000, delta: 400 }])
    expect(fx.toInvoiceDelta).toBe(400)
    expect(fx.warnings).toEqual([
      "Sep 2026 is invoiced with Jul 2026–Sep 2026 (€24,000); this contract's 8 days there at €1,050/day instead of €1,000: €400 more to invoice (a top-up).",
    ])
  })

  it("prices only the amended contract's days when the client has another contract that month", () => {
    const other = contract({ id: "e2", dailyRate: 500 })
    const fx = effects(globex, contract({ amendments: [amend({ dailyRate: 1100 })] }), "2026-09", {
      engagements: [globex, other],
      timecards: [tc("2026-09-15", 64), tc("2026-09-16", 80, "e2")],
      invoices: [inv("2026-09", 13000, { clientId: "c" })],
    })
    expect(fx.invoicedRepriced).toEqual([{ yearMonth: "2026-09", invoiced: 13000, delta: 800 }])
    expect(fx.warnings).toEqual([
      "Sep 2026 is invoiced at €13,000; this contract's 8 days there at €1,100/day instead of €1,000: €800 more to invoice (a top-up).",
    ])
  })

  // Example 3: the 96 days run out in Dec, so a renewal without days stays capped.
  it("warns that a renewal without days stays capped, and is quiet once days come with it", () => {
    const renewal = amend({ from: "2027-01", lastDay: "2027-06-30", lastDayBefore: "2026-12-31" })
    const bare = effects(globex, contract({ endMonth: "2027-06", endDate: "2027-06-30", amendments: [renewal] }), "2027-01")
    expect(bare.cappedAhead).toEqual(monthsFrom("2027-01", 6))
    expect(bare.warnings).toEqual([
      "The budget runs out before the end: Jan 2027–Jun 2027 stay capped. Add days from 2027-01 if the contract includes them.",
    ])
    const withDays = effects(
      globex,
      contract({ endMonth: "2027-06", endDate: "2027-06-30", amendments: [{ ...renewal, addedDays: 48 }] }),
      "2027-01",
    )
    expect(withDays).toMatchObject({ cappedAhead: [], daysLeftAtEnd: 0, warnings: [] })
  })

  // Example 2, Migration: 80 days at 10 a month from Jan, spent in Aug; Sep was worked anyway.
  const migration = contract({ dailyRate: 700, contractedDays: 80, defaultDaysPerMonth: 10 })
  const expansion = (from: string) =>
    contract({
      dailyRate: 700, contractedDays: 80, defaultDaysPerMonth: 10, endMonth: "2027-01", endDate: "2027-01-31",
      amendments: [amend({ from, addedDays: 40, lastDay: "2027-01-31", lastDayBefore: "2026-12-31" })],
    })

  it("names the worked months before the added days that the plan leaves at 0", () => {
    const septemberWorked = { timecards: [tc("2026-09-10", 40), tc("2026-09-20", 40)] }
    const fx = effects(migration, expansion("2026-10"), "2026-10", septemberWorked)
    expect(fx.cappedWithHours).toEqual([{ yearMonth: "2026-09", hours: 80, billableDays: 0 }])
    expect(fx.warnings).toContain(
      "Sep 2026 has 80 h logged but plans 0 days: if the added days cover it, date the amendment from 2026-09.",
    )
    expect(effects(migration, expansion("2026-09"), "2026-09", septemberWorked).cappedWithHours).toEqual([])
    // Without added days nothing is said about them.
    const rateOnly = contract({ dailyRate: 700, contractedDays: 80, defaultDaysPerMonth: 10, amendments: [amend({ from: "2026-10", dailyRate: 800 })] })
    expect(effects(migration, rateOnly, "2026-10", septemberWorked).cappedWithHours).toEqual([])
  })

  it("counts the days the end leaves unplanned", () => {
    const daysOnly = contract({ dailyRate: 700, contractedDays: 80, defaultDaysPerMonth: 10, amendments: [amend({ from: "2026-10", addedDays: 40 })] })
    const fx = effects(migration, daysOnly, "2026-10")
    expect(fx.daysLeftAtEnd).toBe(10)
    expect(fx.warnings).toContain(
      "10 days of the budget are left after Dec 2026, the last month: the Plan never bills them. Extend the end, or plan more days in the months before it.",
    )
  })

  it("names the stored 0 rows the extension now covers", () => {
    const renewal = contract({
      endMonth: "2027-06", endDate: "2027-06-30",
      amendments: [amend({ from: "2027-01", addedDays: 48, lastDay: "2027-06-30", lastDayBefore: "2026-12-31" })],
    })
    const fx = effects(globex, renewal, "2027-01", { allocations: [row("2026-11", 0), row("2027-02", 0), row("2027-03", 8)] })
    expect(fx.zeroRowsInExtension).toEqual(["2027-02"])
    expect(fx.warnings).toContain("Feb 2027 holds 0 days in the Plan, so the extension bills nothing there: set their days in the Plan.")
  })

  // Example 2's failure: a renewal agreed after the end fills the months nobody worked.
  it("names the past months an extension now plans by default, with their value", () => {
    const ended = contract({ endMonth: "2026-06", endDate: "2026-06-30", isActive: false })
    const renewed = contract({
      endMonth: "2026-12", endDate: "2026-12-31",
      amendments: [amend({ from: "2026-07", lastDay: "2026-12-31", lastDayBefore: "2026-06-30" })],
    })
    const fx = effects(ended, renewed, "2026-07")
    expect(fx.pastMonthsPlanned).toEqual(["2026-07", "2026-08", "2026-09"].map((yearMonth) => ({ yearMonth, days: 8, value: 8000 })))
    expect(fx.warnings).toContain(
      "Jul 2026–Sep 2026 are past and now plan 24 days by default (€24,000) in the Plan: " +
        "if no work happened there, set them to 0 in the Plan, or make the renewal a new contract.",
    )
    // A month with a stored row says what happened there already.
    const withRow = effects(ended, renewed, "2026-07", { allocations: [row("2026-08", 0)] })
    expect(withRow.warnings).toContainEqual(expect.stringMatching(/^Jul 2026, Sep 2026 are past and now plan 16 days by default \(€16,000\)/))
    // From this month on nothing is past.
    const onTime = contract({ endMonth: "2026-09", endDate: "2026-09-30" })
    expect(effects(onTime, { ...renewed, amendments: [amend({ from: "2026-10", lastDay: "2026-12-31" })] }, "2026-10").pastMonthsPlanned).toEqual([])
  })

})

describe("an hourly contract", () => {
  // €75/h for 100 h, stored as €600/day for 12.5 days.
  const { dailyRate } = fromContractUnit({ unit: "hour", rate: 75, contracted: 100, perMonth: 40 })

  it("bills 10 hours at €750, not €93.75", () => {
    const b = bill({ engagements: [{ ...E1, dailyRate }], timecards: [tc("2026-09-10", 10)], invoices: [] })
    expect(month(b, CM).logged).toBe(750)
    // The bug: the typed €75 stored as the day rate.
    const wrong = bill({ engagements: [{ ...E1, dailyRate: 75 }], timecards: [tc("2026-09-10", 10)], invoices: [] })
    expect(month(wrong, CM).logged).toBe(93.75)
  })
})
