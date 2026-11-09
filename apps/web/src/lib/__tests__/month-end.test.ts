/**
 * Month End on worked months, made-up names and amounts only. Today is
 * 10 Oct 2026, so the month to close is September. Lumen Srl has a retainer
 * from July, 10 days a month at €450; the base data is a closed September:
 * every month's hours confirmed, invoiced and paid into Main Bank.
 */
import { describe, expect, it } from "vitest"

import { BLOCKING, STEP_ORDER, monthEndChecklist, monthEndFloor, openMonths, stepsOn } from "@/lib/month-end"

import type { MonthEndData, StepKey } from "@/lib/month-end"
import type {
  Allocation,
  Client,
  CompanyAccount,
  CompanyDeadline,
  CompanyExpense,
  CompanyMovement,
  Engagement,
  Invoice,
  Timecard,
} from "@/types"

const TODAY = "2026-10-10"
const at = new Date(2026, 4, 1)
const d = (day: string) => new Date(`${day}T00:00:00`)
let seq = 0

const client = (id: string, name: string): Client => ({
  id, userId: "u", name, vatNumber: null, email: null, contactName: null, contactPhone: null, notes: null,
  isActive: true, createdAt: at, updatedAt: at,
})
const engagement = (o: Partial<Engagement> & Pick<Engagement, "id" | "clientId">): Engagement => ({
  userId: "u", name: "Retainer", opportunityId: null, dailyRate: 450, vatApplicable: true, contractedDays: null,
  defaultDaysPerMonth: 10, startMonth: "2026-07", endMonth: null, endDate: null, isActive: true, notes: null,
  createdAt: at, updatedAt: at, ...o,
})
const allocation = (engagementId: string, yearMonth: string, days: number): Allocation => ({
  id: `${engagementId}:${yearMonth}`, userId: "u", engagementId, yearMonth, days, createdAt: at, updatedAt: at,
})
/** `days` of hours in `ym`, `perDay` hours a day from the 1st. */
const hoursIn = (engagementId: string, ym: string, days: number, perDay = 8): Timecard[] => {
  const out: Timecard[] = []
  for (let k = 0, left = days * 8; left > 0; k++, left -= perDay) {
    out.push({
      id: `t${++seq}`, userId: "u", engagementId, collaboratorId: null, date: `${ym}-${String(k + 1).padStart(2, "0")}`,
      hours: Math.min(perDay, left), notes: null, createdAt: at, updatedAt: at,
    })
  }
  return out
}
const invoice = (o: Partial<Invoice> & Pick<Invoice, "number" | "yearMonth" | "amount">): Invoice => ({
  id: `i${++seq}`, userId: "u", clientId: "c1", engagementId: null, fromMonth: null, vat: 0, dueDate: null,
  paidDate: null, paidAccountId: null, createdAt: new Date(2026, 4, 1, 0, 0, seq), updatedAt: at, ...o,
})
const account = (o: Partial<CompanyAccount> & Pick<CompanyAccount, "id" | "name">): CompanyAccount => ({
  userId: "u", openingBalance: 1000, openingDate: d("2026-07-01"), statementBalance: null, statementDate: null,
  importRef: null, createdAt: at, updatedAt: at, ...o,
})
const movement = (o: Partial<CompanyMovement> & Pick<CompanyMovement, "kind" | "direction" | "amount" | "date">): CompanyMovement => ({
  id: `m${++seq}`, userId: "u", accountId: "main", toAccountId: null, expenseId: null, description: "Row",
  documentRef: null, project: null, counterparty: null, notes: null, dateEstimated: false, importRef: null,
  createdAt: new Date(2026, 4, 1, 0, 0, seq), updatedAt: at, ...o,
})
const expense = (o: Partial<CompanyExpense> & Pick<CompanyExpense, "id" | "description" | "category" | "amount" | "date">): CompanyExpense => ({
  userId: "u", isRecurring: false, recurrenceMonths: null, notes: null, accountId: null, paidByOwner: false, vat: 0,
  documentRef: null, project: null, recurringExpenseId: null, dateEstimated: false, importRef: null, collaboratorId: null, engagementId: null, forMonth: null,
  createdAt: at, updatedAt: at, ...o,
})
const deadline = (o: Partial<CompanyDeadline> & Pick<CompanyDeadline, "id" | "title" | "date">): CompanyDeadline => ({
  userId: "u", kind: "admin", amount: null, notes: null, isDone: false, createdAt: at, updatedAt: at, ...o,
})

const E1 = engagement({ id: "e1", clientId: "c1" })
const MAIN = account({ id: "main", name: "Main Bank" })
/** Each month invoiced on its own and paid into Main Bank on the 25th of the next. */
const paidInvoices = () => [
  invoice({ number: "13/2026", yearMonth: "2026-07", amount: 4500, paidDate: d("2026-08-25"), paidAccountId: "main" }),
  invoice({ number: "14/2026", yearMonth: "2026-08", amount: 4500, paidDate: d("2026-09-25"), paidAccountId: "main" }),
  invoice({ number: "15/2026", yearMonth: "2026-09", amount: 4500, paidDate: d("2026-10-05"), paidAccountId: "main" }),
]

/** The closed September, with no company account: Bank and To Chase have nothing to say. */
function base(over: Partial<MonthEndData> = {}): MonthEndData {
  return {
    engagements: [E1],
    clients: [client("c1", "Lumen Srl"), client("c2", "Studio Verdi"), client("c9", "Nordica Spa")],
    allocations: [],
    timecards: [...hoursIn("e1", "2026-07", 10), ...hoursIn("e1", "2026-08", 10), ...hoursIn("e1", "2026-09", 10)],
    invoices: paidInvoices(),
    accounts: [],
    movements: [],
    expenses: [],
    loans: [],
    deadlines: [],
    ...over,
  }
}

const sept = (data: MonthEndData, month = "2026-09", today = TODAY) => monthEndChecklist(data, month, today)
const texts = (data: MonthEndData, key: StepKey, month?: string, today?: string) =>
  sept(data, month, today).steps[key].items.map((i) => [i.kind, i.status, i.text])

describe("monthEndChecklist", () => {
  it("closes a month whose blocking steps are all done, in the page's order", () => {
    const m = sept(base())
    expect(STEP_ORDER).toEqual(["hours", "invoices", "waiting", "suppliers", "recurring", "files", "bank", "chase", "deadlines"])
    expect(BLOCKING).toEqual(["hours", "invoices", "bank", "chase", "deadlines"])
    expect(m).toMatchObject({ month: "2026-09", end: "2026-09-30", closed: true, todo: [] })
    expect(STEP_ORDER.map((k) => m.steps[k].status)).toEqual(["done", "done", "done", "done", "done", "check", "na", "na", "done"])
    expect(texts(base(), "hours")).toEqual([["hours_confirmed", "done", "Lumen Srl · Retainer: 10 d confirmed"]])
    expect(texts(base(), "invoices")).toEqual([["invoice_covered", "done", "Lumen Srl: covered by 15/2026 (Sep 2026)"]])
  })

  it("refuses the current month and a later one: a month closes once it has ended", () => {
    expect(() => sept(base(), "2026-10")).toThrow("2026-10 can't be closed until 1 November 2026: its hours and invoices are still open.")
    expect(() => sept(base(), "2026-12")).toThrow(/until 1 January 2027/)
  })
})

describe("Hours", () => {
  const withSept = (timecards: Timecard[], over: Partial<MonthEndData> = {}) =>
    base({ timecards: [...hoursIn("e1", "2026-07", 10), ...hoursIn("e1", "2026-08", 10), ...timecards], ...over })

  it("blocks a planned month with no hours, until the month is set to 0 days", () => {
    const missing = withSept([], { invoices: paidInvoices().slice(0, 2) })
    const m = sept(missing)
    expect(m.closed).toBe(false)
    expect(m.todo).toEqual(["hours"])
    expect(m.steps.hours.items).toEqual([
      {
        kind: "hours_missing",
        status: "todo",
        text: "Lumen Srl · Retainer: no hours logged",
        detail: "10 d planned. Log the hours, or set the month to 0 days if there was no work.",
        ref: "e1",
      },
    ])
    const noWork = { ...missing, allocations: [allocation("e1", "2026-09", 0)] }
    expect(sept(noWork).closed).toBe(true)
    expect(texts(noWork, "hours")).toEqual([["hours_none", "done", "Lumen Srl · Retainer: no work (0 days)"]])
  })

  it("says an hourly contract's no-work path in hours", () => {
    const hourly = withSept([], { engagements: [{ ...E1, unit: "hour" }], invoices: paidInvoices().slice(0, 2) })
    expect(sept(hourly).steps.hours.items[0].detail).toBe("80 h planned. Log the hours, or set the month to 0 hours if there was no work.")
    const noWork = { ...hourly, allocations: [allocation("e1", "2026-09", 0)] }
    expect(texts(noWork, "hours")).toEqual([["hours_none", "done", "Lumen Srl · Retainer: no work (0 hours)"]])
  })

  it("asks nothing once the budget is spent: the plan keeps its days and bills none", () => {
    const spent = withSept([], { engagements: [{ ...E1, contractedDays: 20 }], invoices: paidInvoices().slice(0, 2) })
    expect(sept(spent).steps.hours).toEqual({ status: "done", items: [] })
  })

  it("has nothing to check before the first month with hours", () => {
    const data = base({ timecards: hoursIn("e1", "2026-08", 10) })
    expect(sept(data, "2026-07").steps.hours.status).toBe("na")
  })

  it("asks to Use hours that differ from the plan, and is done once the plan holds them", () => {
    const nine = withSept(hoursIn("e1", "2026-09", 9))
    expect(sept(nine).steps.hours.items).toEqual([
      expect.objectContaining({ kind: "hours_use", status: "todo", text: "Lumen Srl · Retainer: 9 d logged, 10 d planned", detail: "Use puts the hours in the plan." }),
    ])
    // What Use writes.
    expect(sept(nine).steps.hours.items[0]).toMatchObject({ ref: "e1", days: 9 })
    const used = { ...nine, allocations: [allocation("e1", "2026-09", 9)] }
    expect(texts(used, "hours")).toEqual([["hours_confirmed", "done", "Lumen Srl · Retainer: 9 d confirmed"]])
  })

  it("blocks more than 31 days in a month", () => {
    expect(texts(withSept(hoursIn("e1", "2026-09", 33, 12)), "hours")).toEqual([
      ["hours_over", "todo", "Lumen Srl · Retainer: 33 d logged, more than 31"],
    ])
  })

  it("blocks hours outside the plan, pointing at the client, and never asks about a contract closed with no end", () => {
    const later = engagement({ id: "e2", clientId: "c2", startMonth: "2026-10" })
    const closed = engagement({ id: "e3", clientId: "c2", isActive: false })
    const data = withSept([...hoursIn("e1", "2026-09", 10), ...hoursIn("e2", "2026-09", 2), ...hoursIn("e3", "2026-09", 1)], {
      engagements: [E1, later, closed],
    })
    expect(sept(data).steps.hours.items.filter((i) => i.status === "todo")).toEqual([
      {
        kind: "hours_outside",
        status: "todo",
        text: "Studio Verdi · Retainer: 2 d logged outside the plan",
        detail: "The contract's start month comes after these hours: set it on the client.",
        ref: "c2",
      },
    ])
  })

  it("asks nothing of a contract starting after the month", () => {
    const data = base({ engagements: [E1, engagement({ id: "e2", clientId: "c2", startMonth: "2026-11" })] })
    expect(sept(data).closed).toBe(true)
  })

  it("still asks to Use the hours of a contract at €0 a day, with nothing to invoice", () => {
    const free = withSept(hoursIn("e1", "2026-09", 9), { engagements: [{ ...E1, dailyRate: 0 }], invoices: [] })
    const m = sept(free)
    expect(m.todo).toEqual(["hours"])
    expect(m.steps.invoices).toEqual({ status: "done", items: [] })
  })
})

describe("Invoices", () => {
  it("blocks a month with hours not invoiced", () => {
    const data = base({ invoices: paidInvoices().slice(0, 2) })
    expect(sept(data).todo).toEqual(["invoices"])
    expect(sept(data).steps.invoices.items).toEqual([
      {
        kind: "invoice_open",
        status: "todo",
        text: "Lumen Srl, September 2026: €4,500.00 not invoiced",
        detail: null,
        ref: "c1",
        // Record Invoice opens on Ready to Invoice's draft.
        period: { from: "2026-09", to: "2026-09" },
      },
    ])
  })

  it("blocks the month for an earlier month not invoiced, oldest first, and names Ready to Invoice's run", () => {
    const data = base({ invoices: paidInvoices().slice(0, 1) })
    const hint = "Ready to Invoice suggests one invoice for Aug–Sep 2026, €9,000.00."
    expect(sept(data).steps.invoices.items.map((i) => [i.text, i.detail, i.period])).toEqual([
      ["Lumen Srl, August 2026: €4,500.00 not invoiced", hint, { from: "2026-08", to: "2026-09" }],
      ["Lumen Srl, September 2026: €4,500.00 not invoiced", hint, { from: "2026-08", to: "2026-09" }],
    ])
  })

  // The owner's incident: August's invoice recorded as September leaves September green and August open.
  it("keeps the month open when an earlier month's invoice was recorded on it", () => {
    const data = base({
      allocations: [allocation("e1", "2026-08", 6), allocation("e1", "2026-09", 6)],
      timecards: [...hoursIn("e1", "2026-07", 10), ...hoursIn("e1", "2026-08", 6), ...hoursIn("e1", "2026-09", 6)],
      invoices: [paidInvoices()[0], invoice({ number: "15/2026", yearMonth: "2026-09", amount: 2700, paidDate: d("2026-10-05") })],
    })
    const m = sept(data)
    expect(m.closed).toBe(false)
    expect(texts(data, "invoices")).toEqual([
      ["invoice_open", "todo", "Lumen Srl, August 2026: €2,700.00 not invoiced"],
      ["invoice_covered", "done", "Lumen Srl: covered by 15/2026 (Sep 2026)"],
    ])
  })

  it("says when an invoice covers the month as part of a longer period, so a wrong period shows", () => {
    const data = base({
      invoices: [paidInvoices()[0], invoice({ number: "14/2026", fromMonth: "2026-08", yearMonth: "2026-09", amount: 9000, paidDate: d("2026-10-05") })],
    })
    expect(sept(data).closed).toBe(true)
    expect(texts(data, "invoices")).toEqual([["invoice_covered", "done", "Lumen Srl: covered by 14/2026 (Aug–Sep 2026)"]])
  })

  it("asks first whether an invoice recorded on the current month is the month's own", () => {
    const misdated = invoice({ number: "16/2026", yearMonth: "2026-10", amount: 4500 })
    const data = base({ invoices: [...paidInvoices().slice(0, 2), misdated] })
    expect(sept(data).steps.invoices.items).toEqual([
      {
        kind: "invoice_misdated",
        status: "todo",
        text: "Lumen Srl, September 2026: €4,500.00 not invoiced",
        detail: "Is 16/2026 (Oct 2026) the September invoice? Edit its period.",
        ref: "c1",
        invoiceId: misdated.id,
      },
    ])
  })

  it("calls a month provisional while its invoice runs into the current month: to check, not blocking", () => {
    const today = "2026-11-10"
    const data = base({
      timecards: [...base().timecards, ...hoursIn("e1", "2026-10", 10)],
      invoices: [...paidInvoices(), invoice({ number: "17/2026", fromMonth: "2026-10", yearMonth: "2026-12", amount: 9000, paidDate: d("2026-11-05") })],
    })
    const m = sept(data, "2026-10", today)
    expect(m.closed).toBe(true)
    expect(m.steps.invoices.status).toBe("check")
    expect(m.steps.invoices.items).toEqual([
      {
        kind: "invoice_provisional",
        status: "check",
        text: "Lumen Srl, October 2026: provisional, €1,500.00 to come from 17/2026 (Oct–Dec 2026)",
        detail: "Final once December 2026 ends: until then the months still running each take an even share.",
        ref: "c1",
      },
    ])
  })

  // At most the running invoice's shares on the months not ended can come back: €100 of €4,500 here.
  it("blocks what a small invoice running into the current month can never cover", () => {
    const small = invoice({ number: "16/2026", fromMonth: "2026-09", yearMonth: "2026-10", amount: 200 })
    const data = base({ invoices: [...paidInvoices().slice(0, 2), small] })
    const m = sept(data)
    expect(m.closed).toBe(false)
    expect(m.steps.invoices.items.map((i) => [i.kind, i.status, i.text, i.detail])).toEqual([
      [
        "invoice_open",
        "todo",
        "Lumen Srl, September 2026: €4,400.00 not invoiced",
        "Partly covered by 16/2026 (Sep–Oct 2026). At most €100.00 more can come from 16/2026 once October 2026 ends.",
      ],
    ])

    // Two months unbilled under one small invoice: both open, and both in openMonths.
    const wide = base({ invoices: [paidInvoices()[0], invoice({ number: "16/2026", fromMonth: "2026-08", yearMonth: "2026-10", amount: 300 })] })
    expect(sept(wide).steps.invoices.items.map((i) => [i.kind, i.text])).toEqual([
      ["invoice_open", "Lumen Srl, August 2026: €4,400.00 not invoiced"],
      ["invoice_open", "Lumen Srl, September 2026: €4,400.00 not invoiced"],
    ])
    expect(openMonths(wide, TODAY)).toEqual(["2026-09", "2026-08"])
  })

  it("asks to check what a credit note took back, and blocks only for more than that", () => {
    const credit = invoice({ number: "NC 1/2026", yearMonth: "2026-09", amount: -450, paidDate: d("2026-10-05") })
    const credited = base({ invoices: [...paidInvoices(), credit] })
    expect(sept(credited).closed).toBe(true)
    expect(sept(credited).steps.invoices.items).toEqual([
      {
        kind: "invoice_credited",
        status: "check",
        text: "Lumen Srl, September 2026: €450.00 credited by NC 1/2026",
        detail: "Re-invoice it, or leave it if it was a discount.",
        ref: "c1",
      },
    ])
    const short = base({ invoices: [...paidInvoices().slice(0, 2), invoice({ number: "15/2026", yearMonth: "2026-09", amount: 4050, paidDate: d("2026-10-05") }), credit] })
    expect(sept(short).steps.invoices.items.map((i) => [i.kind, i.text, i.detail])).toEqual([
      ["invoice_open", "Lumen Srl, September 2026: €900.00 not invoiced", "Partly covered by 15/2026 (Sep 2026). €450.00 of it was credited by NC 1/2026."],
    ])
  })

  it("says nothing of a client with no hours and no invoice in the month", () => {
    const ended = engagement({ id: "e2", clientId: "c2", endMonth: "2026-08" })
    const data = base({
      engagements: [E1, ended],
      timecards: [...base().timecards, ...hoursIn("e2", "2026-07", 10), ...hoursIn("e2", "2026-08", 10)],
      invoices: [
        ...paidInvoices(),
        invoice({ clientId: "c2", number: "20/2026", fromMonth: "2026-07", yearMonth: "2026-08", amount: 9000, paidDate: d("2026-09-10") }),
      ],
    })
    expect(sept(data).closed).toBe(true)
    expect(texts(data, "invoices")).toEqual([["invoice_covered", "done", "Lumen Srl: covered by 15/2026 (Sep 2026)"]])
  })
})

describe("Bank", () => {
  /** 1,000 at the opening, 4,500 in on 25/08 and 25/09: 10,000 at the month end, 14,500 after 05/10. */
  const banked = (main: Partial<CompanyAccount>, over: Partial<MonthEndData> = {}) => base({ accounts: [{ ...MAIN, ...main }], ...over })

  it("has nothing to say with no account open by the month end", () => {
    expect(sept(base()).steps.bank.status).toBe("na")
    expect(sept(banked({ openingDate: d("2026-10-01") })).steps.bank.status).toBe("na")
  })

  it("blocks an account never checked, saying which rows to look through", () => {
    expect(sept(banked({})).steps.bank.items).toEqual([
      {
        kind: "bank_open",
        status: "todo",
        text: "Main Bank: Not checked",
        detail: "Check it against the statement on 30/09/2026: 2 rows since the account opened.",
        ref: "main",
      },
    ])
  })

  it("blocks a matching check made before the month end", () => {
    const m = sept(banked({ statementBalance: 5500, statementDate: d("2026-09-15") }))
    expect(m.todo).toEqual(["bank"])
    expect(m.steps.bank.items.map((i) => [i.text, i.detail])).toEqual([
      ["Main Bank: Last checked on 15/09/2026, before the month end", "Check it against the statement on 30/09/2026: 1 row since the last check (15/09/2026)."],
    ])
  })

  it("is done with a matching check on the month end, or later, saying so", () => {
    expect(texts(banked({ statementBalance: 10000, statementDate: d("2026-09-30") }), "bank")).toEqual([
      ["bank_matches", "done", "Main Bank: Matches the bank on 30/09/2026"],
    ])
    expect(texts(banked({ statementBalance: 14500, statementDate: d("2026-10-05") }), "bank")).toEqual([
      ["bank_matches", "done", "Main Bank: Matches the bank on 05/10/2026 (after month end)"],
    ])
    expect(sept(banked({ statementBalance: 14500, statementDate: d("2026-10-05") })).closed).toBe(true)
  })

  // Check Balance never saves a check older than the account's last one, so only fixing that one closes the month.
  it("points at a later check that doesn't match, and links to its month", () => {
    const data = banked({ statementBalance: 14000, statementDate: d("2026-10-05") })
    expect(sept(data).steps.bank.items).toEqual([
      {
        kind: "bank_open",
        status: "todo",
        text: "Main Bank: Missing OUT of €500.00 on 05/10/2026",
        detail: "The 05/10/2026 check doesn't match the bank: fix that first. A check dated before it won't be saved.",
        ref: "main",
        month: "2026-10",
      },
    ])
    // On the month end itself, a new check replaces it: the usual advice, and the month's own rows.
    const same = banked({ statementBalance: 9000, statementDate: d("2026-09-30") })
    expect(sept(same).steps.bank.items[0]).toMatchObject({
      detail: "Check it against the statement on 30/09/2026: 1 row from 01/09/2026 to 30/09/2026.",
    })
    expect(sept(same).steps.bank.items[0].month).toBeUndefined()
  })

  it("turns red again, with nothing saved, when a row is added before the check", () => {
    const data = banked(
      { statementBalance: 10000, statementDate: d("2026-09-30") },
      { movements: [movement({ kind: "income", direction: "in", amount: 100, date: d("2026-09-20"), description: "Rent" })] },
    )
    expect(texts(data, "bank")).toEqual([["bank_open", "todo", "Main Bank: Missing OUT of €100.00 on 30/09/2026"]])
  })

  it("asks nothing more of an account closed at 0, and counts one opened mid-month", () => {
    const data = base({
      accounts: [
        { ...MAIN, statementBalance: 10000, statementDate: d("2026-09-30") },
        account({ id: "savings", name: "Savings", openingBalance: 0, statementBalance: 0, statementDate: d("2026-08-12") }),
        account({ id: "cash", name: "Cash Box", openingBalance: 200, openingDate: d("2026-09-15"), statementBalance: 200, statementDate: d("2026-09-30") }),
      ],
    })
    expect(texts(data, "bank")).toEqual([
      ["bank_matches", "done", "Main Bank: Matches the bank on 30/09/2026"],
      ["bank_dormant", "done", "Savings: closed at €0.00 since 12/08/2026"],
      ["bank_matches", "done", "Cash Box: Matches the bank on 30/09/2026"],
    ])
  })

  it("names an unpaid invoice a Missing IN could be, within a bank fee", () => {
    const nordica = invoice({ clientId: "c9", number: "12/2026", yearMonth: "2026-08", amount: 1500, vat: 330 })
    const data = banked({ statementBalance: 11820, statementDate: d("2026-09-30") }, { invoices: [...paidInvoices(), nordica] })
    expect(sept(data).steps.bank.items.map((i) => [i.text, i.detail])).toEqual([
      [
        "Main Bank: Missing IN of €1,820.00 on 30/09/2026",
        "Check it against the statement on 30/09/2026: 1 row from 01/09/2026 to 30/09/2026. Invoice 12/2026 · Nordica Spa, €1,830.00, unpaid: was it paid?",
      ],
    ])
    // Marked paid on the check's day, not today (2 October would leave September red), into the account it is missing on.
    const match = { invoiceIds: [nordica.id], accountId: "main", paidOn: "2026-09-30" }
    expect(sept(data).steps.bank.items[0].suspects).toEqual(match)
    // Waiting for Payment lists it too, with the same suggestion: Mark Paid dates it the same from either step.
    expect(sept(data).steps.waiting.items).toEqual([
      expect.objectContaining({
        text: "Invoice 12/2026 · Nordica Spa, €1,830.00",
        detail: "Unpaid, no due date: it never reaches Deadlines. It may be the Missing IN on Main Bank.",
        suspects: match,
      }),
    ])
  })

  it("dates a Missing IN's invoice on an earlier check's day, and on the month end for a later check", () => {
    const nordica = invoice({ clientId: "c9", number: "12/2026", yearMonth: "2026-08", amount: 1500, vat: 330 })
    // 15/09: 5,500 in the book, 1,830 more in the bank.
    const earlier = banked({ statementBalance: 7330, statementDate: d("2026-09-15") }, { invoices: [...paidInvoices(), nordica] })
    expect(sept(earlier).steps.bank.items[0].suspects).toEqual({ invoiceIds: [nordica.id], accountId: "main", paidOn: "2026-09-15" })
    const later = banked({ statementBalance: 16330, statementDate: d("2026-10-05") }, { invoices: [...paidInvoices(), nordica] })
    expect(sept(later).steps.bank.items[0]).toMatchObject({ month: "2026-10", suspects: { invoiceIds: [nordica.id], accountId: "main", paidOn: "2026-09-30" } })
    // A Missing OUT names no invoice.
    expect(sept(banked({ statementBalance: 9000, statementDate: d("2026-09-30") })).steps.bank.items[0].suspects).toBeUndefined()
  })

  it("dates a suggestion by the check, never by the month on screen", () => {
    const nordica = invoice({ clientId: "c9", number: "12/2026", yearMonth: "2026-09", amount: 1500, vat: 330 })
    // 05/10: 14,500 in the book, 1,830 more in the bank. July and August show the same red check.
    const later = banked({ statementBalance: 16330, statementDate: d("2026-10-05") }, { invoices: [...paidInvoices(), nordica] })
    expect(sept(later).steps.bank.items[0].suspects?.paidOn).toBe("2026-09-30")
    for (const month of ["2026-07", "2026-08"]) {
      // Two months or more before the check: no day to guess. Its own month fixes it.
      const [item] = sept(later, month).steps.bank.items
      expect(item).toMatchObject({ kind: "bank_open", month: "2026-10" })
      expect(item.suspects).toBeUndefined()
      expect(item.detail).not.toContain("was it paid?")
      expect(sept(later, month).steps.waiting.items[0].suspects).toBeUndefined()
    }
    // A September invoice never explains a Missing IN on 15/08.
    const august = banked({ statementBalance: 2830, statementDate: d("2026-08-15") }, { invoices: [...paidInvoices(), nordica] })
    expect(sept(august).steps.bank.items[0].text).toBe("Main Bank: Missing IN of €1,830.00 on 15/08/2026")
    expect(sept(august).steps.bank.items[0].suspects).toBeUndefined()
  })
})

describe("To Chase and Deadlines", () => {
  const SECOND = account({ id: "second", name: "Second Bank", openingBalance: 0 })
  const checked = { ...MAIN, statementBalance: 14500, statementDate: d("2026-10-05") }

  it("blocks every item dated up to the month end, an old one too, and lists a transfer once", () => {
    const data = base({
      accounts: [checked, SECOND],
      movements: [
        movement({ kind: "income", direction: "in", amount: 50, date: d("2026-07-10"), description: "Old rent", dateEstimated: true }),
        movement({ kind: "transfer", direction: "out", amount: 50, toAccountId: "second", date: d("2026-09-30"), description: "To Second Bank", dateEstimated: true }),
        movement({ kind: "income", direction: "in", amount: 50, date: d("2026-10-02"), description: "October rent", dateEstimated: true }),
      ],
    })
    expect(texts(data, "chase")).toEqual([
      ["chase", "todo", "Old rent, ~10/07/2026, date estimated"],
      ["chase", "todo", "To Second Bank, ~30/09/2026, date estimated"],
    ])
    expect(sept(data).todo).toContain("chase")
    expect(texts(data, "chase", "2026-08")).toEqual([["chase", "todo", "Old rent, ~10/07/2026, date estimated"]])
  })

  it("has nothing to chase without company accounts", () => {
    expect(sept(base()).steps.chase.status).toBe("na")
  })

  it("blocks an open deadline dated in or before the month, never a done or later one", () => {
    const data = base({
      deadlines: [
        deadline({ id: "d1", title: "Accountant fee", date: d("2026-09-16"), amount: 250 }),
        deadline({ id: "d2", title: "Bank formality", date: d("2026-08-01") }),
        deadline({ id: "d3", title: "Insurance renewal", date: d("2026-09-20"), isDone: true }),
        deadline({ id: "d4", title: "Contract renewal", date: d("2026-10-16") }),
      ],
    })
    expect(sept(data).todo).toEqual(["deadlines"])
    expect(sept(data).steps.deadlines.items.map((i) => [i.text, i.detail, i.ref])).toEqual([
      ["Bank formality", "Due 01/08/2026.", "d2"],
      ["Accountant fee", "Due 16/09/2026, €250.00.", "d1"],
    ])
  })
})

describe("the amber steps never keep a month open", () => {
  const data = base({
    invoices: [
      ...paidInvoices(),
      invoice({ clientId: "c9", number: "12/2026", yearMonth: "2026-08", amount: 1500, vat: 330, dueDate: d("2026-09-30") }),
      invoice({ clientId: "c9", number: "18/2026", yearMonth: "2026-09", amount: 200, vat: 44 }),
      invoice({ clientId: "c9", number: "NC 2/2026", yearMonth: "2026-08", amount: -100, vat: -22 }),
    ],
    expenses: [
      expense({ id: "move", description: "Office move", category: "other", amount: 1000, vat: 220, date: d("2026-09-12"), documentRef: "INV 40" }),
      expense({ id: "later", description: "Desk", category: "other", amount: 300, date: d("2026-10-03"), documentRef: "INV 41" }),
      expense({ id: "fee", description: "Accountant fee", category: "accountant", amount: 250, date: d("2026-01-01"), isRecurring: true, recurrenceMonths: 1 }),
      expense({ id: "paidFee", description: "Commercialista settembre", category: "accountant", amount: 250, date: d("2026-09-12"), paidByOwner: true, documentRef: "R 12" }),
      expense({ id: "rent", description: "Office rent", category: "rent", amount: 900, date: d("2026-01-01"), isRecurring: true, recurrenceMonths: 1 }),
      expense({ id: "paidRent", description: "Rent", category: "rent", amount: 900, date: d("2026-10-02"), paidByOwner: true, documentRef: "R 13", recurringExpenseId: "rent" }),
      expense({ id: "software", description: "Software", category: "software", amount: 30, date: d("2026-01-01"), isRecurring: true, recurrenceMonths: 3 }),
      expense({ id: "paidSoftware", description: "Software Q3", category: "software", amount: 30, date: d("2026-07-15"), paidByOwner: true, documentRef: "S 7", recurringExpenseId: "software" }),
    ],
  })
  const m = sept(data)

  it("closes the month all the same", () => {
    expect(m.closed).toBe(true)
    expect([m.steps.waiting.status, m.steps.suppliers.status, m.steps.recurring.status]).toEqual(["check", "check", "check"])
  })

  it("lists invoices overdue today, with no due date, and open credit notes", () => {
    expect(m.steps.waiting.items.map((i) => [i.text, i.detail])).toEqual([
      ["Invoice 12/2026 · Nordica Spa, €1,830.00", "Overdue · due 30 Sep"],
      ["Invoice 18/2026 · Nordica Spa, €244.00", "Unpaid, no due date: it never reaches Deadlines."],
      ["Credit note NC 2/2026 · Nordica Spa, -€122.00", "Open credit note: settle it or offset it."],
    ])
  })

  it("lists supplier invoices up to the month end still owed", () => {
    expect(m.steps.suppliers.items.map((i) => [i.text, i.detail])).toEqual([["Office move (INV 40): €1,220.00 owed", "Dated 12/09/2026, €1,220.00 in all."]])
  })

  it("lists estimates no payment covers, with the forgotten link and the payment made just after", () => {
    expect(m.steps.recurring.items.map((i) => [i.text, i.detail])).toEqual([
      ["Accountant fee (€250.00, every month): not paid in September", 'Paid as "Commercialista settembre" on 12/09? Link it to the estimate.'],
      ["Office rent (€900.00, every month): not paid in September", "The 02/10 payment covers October. Was it for September? Edit its date."],
    ])
    // Link opens the one-off with the estimate picked; Edit Date opens the late payment.
    expect(m.steps.recurring.items.map((i) => [i.ref, i.link, i.late])).toEqual([
      ["fee", "paidFee", undefined],
      ["rent", undefined, "paidRent"],
    ])
  })
})

describe("the recurring step with the end month and the timing", () => {
  const est = (o: Partial<CompanyExpense> & Pick<CompanyExpense, "id">) =>
    expense({ description: o.id, category: "other", amount: 300, date: d("2026-01-01"), isRecurring: true, recurrenceMonths: 3, ...o })
  const asked = (list: CompanyExpense[]) => sept(base({ expenses: list })).steps.recurring.items.map((i) => i.ref)

  it("asks about a counted-when-paid estimate only in its payment months", () => {
    // Quarterly from January pays in Jan, Apr, Jul, Oct: September is not one. From March it is.
    expect(asked([est({ id: "jan", countedWhenPaid: true }), est({ id: "mar", countedWhenPaid: true, date: d("2026-03-10") })])).toEqual(["mar"])
  })

  it("keeps asking about a spread estimate every month, and asks nothing after the end month", () => {
    expect(asked([est({ id: "spread" }), est({ id: "ended", endMonth: "2026-08" }), est({ id: "last", endMonth: "2026-09" })])).toEqual(["spread", "last"])
  })
})

describe("the recurring step names the price in force", () => {
  it("asks for the changed price, not the amount it started at", () => {
    const e = expense({
      id: "acc", description: "Accountant", category: "other", amount: 300, date: d("2026-01-01"), isRecurring: true, recurrenceMonths: 3,
      priceChanges: [{ from: "2026-07", amount: 360 }],
    })
    expect(sept(base({ expenses: [e] })).steps.recurring.items.map((i) => i.text)).toEqual(["Accountant (€360.00, every 3 months): not paid in September"])
  })
})

describe("openMonths", () => {
  it("lists the older months still open, newest first, from the floor", () => {
    const data = base({
      timecards: [...hoursIn("e1", "2026-07", 10), ...hoursIn("e1", "2026-09", 10)],
      invoices: [paidInvoices()[0], paidInvoices()[2]],
    })
    expect(openMonths(data, TODAY)).toEqual(["2026-08"])
    expect(sept(data).closed).toBe(true)
  })

  it("stops at the first month with data, and looks at most 24 months back", () => {
    const since = (day: string) => base({ accounts: [account({ id: "main", name: "Main Bank", openingDate: d(day) })] })
    expect(openMonths(since("2026-06-15"), TODAY)).toEqual(["2026-09", "2026-08", "2026-07", "2026-06"])
    const old = openMonths(since("2023-01-01"), TODAY)
    expect(old).toHaveLength(24)
    expect([old[0], old.at(-1)]).toEqual(["2026-09", "2024-10"])
  })

  it("is empty with no data", () => {
    expect(openMonths(base({ timecards: [], invoices: [] }), TODAY)).toEqual([])
  })
})

describe("Invoice Files", () => {
  const stored = { path: "company-files/u/a.xml", name: "a.xml", kind: "xml" as const, size: 9, uploadedAt: at }
  const files = (data: MonthEndData) => sept(data).steps.files.items.map((i) => [i.kind, i.status, i.ref, i.text])

  it("lists a one-off cost and an invoice without a file, amber, never a recurring estimate or one with a file", () => {
    const data = base({
      invoices: [
        invoice({ id: "inv-bare", number: "15/2026", yearMonth: "2026-09", amount: 4500 }),
        invoice({ id: "inv-file", number: "14/2026", yearMonth: "2026-09", amount: 100, file: stored }),
        ...paidInvoices().slice(0, 2),
      ],
      expenses: [
        expense({ id: "bare", description: "Hosting", category: "software", amount: 41.2, date: d("2026-09-03"), documentRef: "EU-1" }),
        expense({ id: "est", description: "Rent", category: "rent", amount: 900, date: d("2026-07-01"), isRecurring: true }),
        expense({ id: "has", description: "Phone", category: "software", amount: 30, date: d("2026-09-05"), file: stored }),
      ],
    })
    const m = sept(data)
    expect(m.steps.files.status).toBe("check")
    expect(files(data).filter((r) => r[1] !== "done")).toEqual([
      ["file_cost", "check", "bare", "Hosting"],
      ["file_invoice", "check", "inv-bare", "Invoice 15/2026 · Lumen Srl"],
    ])
    expect(m.steps.files.items.filter((i) => i.status === "done").map((i) => i.ref)).toEqual(["has", "inv-file"])
    expect(m.steps.files.items[0].detail).toBe("Cost · 3 Sep · €41.20 · Invoice EU-1")
  })

  it("calls a negative invoice a credit note in its text and detail", () => {
    const data = base({ invoices: [invoice({ id: "nc", number: "NC 2/2026", yearMonth: "2026-09", amount: -50 })], expenses: [] })
    const row = sept(data).steps.files.items.find((i) => i.ref === "nc")
    expect([row?.text, row?.detail?.startsWith("Issued credit note · ")]).toEqual(["Credit note NC 2/2026 · Lumen Srl", true])
  })

  it("never keeps a month open: a month closed before stays closed with every file missing", () => {
    const m = sept(base())
    expect(m.steps.files.items.length).toBeGreaterThan(0)
    expect(m.todo).toEqual([])
    expect(m.closed).toBe(true)
    expect(BLOCKING).not.toContain("files")
    expect(openMonths(base(), TODAY)).toEqual([])
  })

  it("is done with nothing to check in a month that has no documents", () => {
    expect(sept(base({ invoices: [] })).steps.files).toEqual({ status: "done", items: [] })
  })
})

describe("monthEndFloor", () => {
  it("is the first month with hours or the first account's opening, whichever is earlier", () => {
    expect(monthEndFloor(base())).toBe("2026-07")
    expect(monthEndFloor(base({ accounts: [account({ id: "main", name: "Main Bank", openingDate: d("2026-06-15") })] }))).toBe("2026-06")
    expect(monthEndFloor(base({ timecards: [] }))).toBeNull()
  })
})

describe("Month End per module set", () => {
  const without = (...off: string[]) => (id: string) => !off.includes(id)

  it.each([
    [[], ["hours", "invoices", "waiting", "suppliers", "recurring", "files", "bank", "chase", "deadlines"], ["hours", "invoices", "bank", "chase", "deadlines"]],
    [["invoicing"], ["hours", "suppliers", "recurring", "bank", "chase", "deadlines"], ["hours", "bank", "chase", "deadlines"]],
    [["crm", "invoicing"], ["suppliers", "recurring", "bank", "chase"], ["bank", "chase"]],
    [["books"], ["hours", "invoices", "waiting", "files", "deadlines"], ["hours", "invoices", "deadlines"]],
  ] as const)("without %j the steps are %j", (off, order, blocking) => {
    expect(stepsOn(without(...off))).toEqual({ order, blocking })
  })

  // A paid invoice with no account is an Invoicing fix (its Open Invoice action): without the module it must not hold the month open.
  it("drops the paid-with-no-account item from To Chase when invoicing is off", () => {
    const noAccount = invoice({ number: "20/2026", yearMonth: "2026-08", amount: 100, vat: 0, paidDate: d("2026-09-10") })
    const data = base({ accounts: [MAIN], invoices: [...paidInvoices(), noAccount] })
    expect(monthEndChecklist(data, "2026-09", TODAY).steps.chase.items.map((i) => i.text)).toEqual(["Invoice 20/2026 paid on 10/09/2026, no account"])
    expect(monthEndChecklist(data, "2026-09", TODAY).todo).toContain("chase")
    const m = monthEndChecklist(data, "2026-09", TODAY, without("invoicing"))
    expect(m.steps.chase.items).toEqual([])
    expect(m.todo).not.toContain("chase")
  })

  it("names no unpaid invoice on a Missing IN when invoicing is off", () => {
    const nordica = invoice({ clientId: "c9", number: "12/2026", yearMonth: "2026-08", amount: 1500, vat: 330 })
    const data = base({ accounts: [{ ...MAIN, statementBalance: 11820, statementDate: d("2026-09-30") }], invoices: [...paidInvoices(), nordica] })
    expect(monthEndChecklist(data, "2026-09", TODAY).steps.bank.items[0].suspects).toBeDefined()
    const item = monthEndChecklist(data, "2026-09", TODAY, without("invoicing")).steps.bank.items[0]
    expect(item.suspects).toBeUndefined()
    expect(item.detail).not.toContain("12/2026")
  })

  it("closes a month whose only open step belongs to a module that is off", () => {
    const missing = base({ timecards: [...hoursIn("e1", "2026-07", 10), ...hoursIn("e1", "2026-08", 10)] })
    expect(monthEndChecklist(missing, "2026-09", TODAY).todo).toEqual(["hours"])
    const m = monthEndChecklist(missing, "2026-09", TODAY, without("crm", "invoicing"))
    expect(m.todo).toEqual([])
    expect(m.closed).toBe(true)
    expect(openMonths(missing, TODAY, without("crm", "invoicing"))).toEqual([])
  })
})
