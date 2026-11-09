import { describe, expect, it } from "vitest"

import { estimateFacts, nextPaymentsLine, payHint, recurringStatus } from "../cash-book-recurring"

import type { CompanyExpense } from "@/types"

const at = new Date(2026, 4, 1)
const d = (day: string) => new Date(`${day}T00:00:00`)
const cost = (o: Partial<CompanyExpense> & Pick<CompanyExpense, "id">): CompanyExpense => ({
  userId: "u1", description: "Cost", category: "other", amount: 100, date: d("2026-05-12"), isRecurring: false, recurrenceMonths: null,
  notes: null, accountId: null, paidByOwner: false, vat: 0, documentRef: null, project: null, recurringExpenseId: null,
  dateEstimated: false, importRef: null, collaboratorId: null, engagementId: null, forMonth: null, createdAt: at, updatedAt: at, ...o,
})
const today = d("2026-10-15")

describe("recurringStatus", () => {
  it("is due when no payment covers this month, and the next payment follows the last one", () => {
    const fee = cost({ id: "fee", isRecurring: true, recurrenceMonths: 1 })
    const sep = cost({ id: "p", recurringExpenseId: "fee", date: d("2026-09-12") })
    expect(recurringStatus(fee, [fee, sep], today)).toEqual({ state: "due", next: d("2026-10-12") })
  })

  it("is due from its start date when it was never paid, however long ago that was", () => {
    const old = cost({ id: "old", isRecurring: true, recurrenceMonths: 1, date: d("2026-03-01") })
    expect(recurringStatus(old, [old], today)).toEqual({ state: "due", next: d("2026-03-01") })
  })

  it("is paid for the month a payment covers, and the next payment is a month on", () => {
    const desk = cost({ id: "desk", isRecurring: true, recurrenceMonths: 1 })
    const oct = cost({ id: "p", recurringExpenseId: "desk", date: d("2026-10-05") })
    expect(recurringStatus(desk, [desk, oct], today)).toEqual({ state: "paid", next: d("2026-11-05"), paidFor: "2026-10" })
  })

  it("keeps a yearly cost paid for the year, and counts no refund as a payment", () => {
    const insurance = cost({ id: "ins", isRecurring: true, recurrenceMonths: 12 })
    const paid = cost({ id: "p", recurringExpenseId: "ins", date: d("2026-03-01") })
    const refund = cost({ id: "r", recurringExpenseId: "ins", date: d("2026-10-01"), amount: -50 })
    expect(recurringStatus(insurance, [insurance, paid, refund], today)).toMatchObject({ state: "paid", next: d("2027-03-01") })
    expect(recurringStatus(insurance, [insurance, refund], today)).toMatchObject({ state: "due" })
  })

  it("a counted-when-paid estimate waits between its payment months, and is due in one", () => {
    // Quarterly from Sep 2026: Sep, Dec, Mar. On 15 Oct it waits for December (the day is its start day).
    const q = cost({ id: "q", isRecurring: true, recurrenceMonths: 3, countedWhenPaid: true, date: d("2026-09-10") })
    expect(recurringStatus(q, [q], today)).toEqual({ state: "waiting", next: d("2026-12-10") })
    expect(recurringStatus(q, [q], d("2026-12-02"))).toEqual({ state: "due", next: d("2026-12-10") })
    const sep = cost({ id: "p", recurringExpenseId: "q", date: d("2026-09-12") })
    expect(recurringStatus(q, [q, sep], d("2026-09-20"))).toEqual({ state: "paid", next: d("2026-12-10"), paidFor: "2026-09" })
  })

  it("an estimate past its end month is ended, and one ending this month is still due", () => {
    const ended = cost({ id: "e", isRecurring: true, recurrenceMonths: 1, endMonth: "2026-09", date: d("2026-01-05") })
    expect(recurringStatus(ended, [ended], today)).toMatchObject({ state: "ended" })
    expect(recurringStatus({ ...ended, endMonth: "2026-10" }, [ended], today)).toMatchObject({ state: "due" })
  })

  it("an ended estimate does not say it ends after: the Ended card already says it", () => {
    const ended = cost({ id: "e", isRecurring: true, recurrenceMonths: 1, endMonth: "2026-09", date: d("2026-01-05") })
    expect(estimateFacts(ended, today)).toEqual([])
    expect(estimateFacts({ ...ended, endMonth: "2026-10" }, today)).toEqual(["Ends after Oct 2026"])
  })

  it("is not ended while its end month has not passed, but has no next payment once the last is made", () => {
    // Quarterly from Nov 2026 ending Apr 2027 pays Nov, Feb: on 15 Mar the next (May) is past the end.
    const q = cost({ id: "q", isRecurring: true, recurrenceMonths: 3, countedWhenPaid: true, date: d("2026-11-10"), endMonth: "2027-04" })
    expect(recurringStatus(q, [q], d("2027-03-15"))).toEqual({ state: "waiting", next: d("2027-05-10"), last: true })
    const feb = cost({ id: "p", recurringExpenseId: "q", date: d("2027-02-12") })
    expect(recurringStatus(q, [q, feb], d("2027-02-20"))).toEqual({ state: "paid", next: d("2027-05-10"), paidFor: "2027-02", last: true })
    expect(recurringStatus(q, [q], d("2027-05-02"))).toMatchObject({ state: "ended" })
  })

  it("a spread estimate paid in its end month has no next payment", () => {
    const desk = cost({ id: "d", isRecurring: true, recurrenceMonths: 1, endMonth: "2026-10", date: d("2026-01-05") })
    const oct = cost({ id: "p", recurringExpenseId: "d", date: d("2026-10-05") })
    expect(recurringStatus(desk, [desk, oct], today)).toEqual({ state: "paid", next: d("2026-11-05"), paidFor: "2026-10", last: true })
  })

  it("says when it pays, its price and its end, only where they apply", () => {
    const acc = cost({
      id: "a", isRecurring: true, recurrenceMonths: 3, countedWhenPaid: true, amount: 1200, date: d("2026-01-15"),
      priceChanges: [{ from: "2026-07", amount: 1350 }], endMonth: "2027-12",
    })
    expect(estimateFacts(acc, today)).toEqual(["Pays in Jan, Apr, Jul, Oct", "Price €1,350.00 since Jul 2026", "Ends after Dec 2027"])
    expect(estimateFacts({ ...acc, priceChanges: [{ from: "2026-12", amount: 1400 }], endMonth: null }, today)).toEqual([
      "Pays in Jan, Apr, Jul, Oct",
      "Price €1,400.00 from Dec 2026",
    ])
    const yearly = cost({ id: "y", isRecurring: true, recurrenceMonths: 12, countedWhenPaid: true, date: d("2026-03-05") })
    expect(estimateFacts(yearly, today)).toEqual(["Pays in March"])
    // Spread (as stored before the field): no payment months to name.
    expect(estimateFacts({ ...yearly, countedWhenPaid: false }, today)).toEqual([])
  })

  it("is upcoming before its start month, due from it", () => {
    const later = cost({ id: "l", isRecurring: true, date: d("2026-12-01") })
    expect(recurringStatus(later, [later], today)).toEqual({ state: "upcoming", next: d("2026-12-01") })
    const now = cost({ id: "n", isRecurring: true, date: d("2026-10-20") })
    expect(recurringStatus(now, [now], today)).toEqual({ state: "due", next: d("2026-10-20") })
  })
})

describe("nextPaymentsLine", () => {
  const acc = (o: Partial<CompanyExpense> = {}) =>
    cost({ id: "acc", isRecurring: true, recurrenceMonths: 3, countedWhenPaid: true, amount: 1200, date: d("2026-01-15"), ...o })

  it("lists up to four payment months from now with the total at the price in force, and the Plan's month against the stored one", () => {
    const stored = acc()
    const draft = acc({ priceChanges: [{ from: "2027-07", amount: 1350 }] })
    // Jul 2026 onward: Jul 2026 (1200), Oct 2026 (1200), Jan 2027 (1200), Apr 2027 (1200).
    expect(nextPaymentsLine(draft, [stored], "2026-07")).toBe(
      "Next payments: Jul 2026, Oct 2026, Jan 2027, Apr 2027 · €4,800.00 in all · Plan other costs in Jul 2026 €1,200 (was €1,200)",
    )
    // From Jul 2027 the changed price counts: 4 × 1,350.
    expect(nextPaymentsLine(draft, [stored], "2027-07")).toBe(
      "Next payments: Jul 2027, Oct 2027, Jan 2028, Apr 2028 · €5,400.00 in all · Plan other costs in Jul 2027 €1,350 (was €1,200)",
    )
  })

  it("stops at the end month, says so when no payment is left, and has no 'was' for a new cost", () => {
    expect(nextPaymentsLine(acc({ endMonth: "2027-02" }), [], "2026-07")).toBe(
      "Next payments: Jul 2026, Oct 2026, Jan 2027 · €3,600.00 in all · Plan other costs in Jul 2026 €1,200",
    )
    expect(nextPaymentsLine(acc({ endMonth: "2026-08" }), [], "2026-09")).toBe("No payments ahead: it ends before the next payment month.")
  })

  it("is only for an estimate counted when paid", () => {
    expect(nextPaymentsLine(acc({ countedWhenPaid: false }), [], "2026-07")).toBeNull()
  })
})

describe("payHint", () => {
  const q = cost({ id: "q", description: "Accountant", isRecurring: true, recurrenceMonths: 3, date: d("2026-01-15") })

  it.each([
    ["spread quarterly: the old period", q, "2026-05-10", 'The Plan counts this cost instead of "Accountant" for 3 months from May 2026.'],
    ["spread monthly", { ...q, recurrenceMonths: 1 }, "2026-05-10", 'The Plan counts this cost instead of "Accountant" in May 2026.'],
    ["counted when paid: the nearest payment month", { ...q, countedWhenPaid: true }, "2026-05-10", 'The Plan counts this cost instead of "Accountant" in April 2026, the payment month nearest this date.'],
    ["no date yet", q, "", 'The Plan counts this cost instead of "Accountant" in its month.'],
  ])("%s", (_n, linked, date, want) => expect(payHint(linked, date)).toBe(want))
})
