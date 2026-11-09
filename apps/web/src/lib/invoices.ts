import { eurShort } from "@alter-ego/kernel/currency"
import { formatYearMonth, isoDate, parseYearMonth } from "@alter-ego/kernel/dates"
import {
  addMonths,
  differenceInCalendarMonths,
  format,
  getDaysInMonth,
  isLastDayOfMonth,
  lastDayOfMonth,
  setDate,
} from "date-fns"

import { monthsFrom, rateAt, resolveAllocationGrid, toRevenueSources, walkGrid } from "@/lib/engagement-burndown"
import { contractDays, contractUnit, countIn, hoursToDays, rateIn, unitNoun } from "@/lib/engagements"
import { IVA_RATE } from "@/lib/italian-tax"
import { taskClientId } from "@/lib/tasks"

import type { Allocation, Engagement, Invoice, Timecard } from "@/types"

/** `+ 0` turns -0 into 0: Intl prints -0 as "-€0.00", and a netted month is not negative. */
function round2(n: number): number {
  return Math.round(n * 100) / 100 + 0
}

/**
 * The customer an invoice bills: its own clientId, or — on a document written
 * before invoices named their customer — its contract's client. null when
 * neither is known. Every reader goes through this, so old documents need no
 * migration.
 */
// ponytail: #164's resolver, same shape: own clientId first, else the contract's.
export const invoiceClientId: (
  i: Pick<Invoice, "clientId" | "engagementId">,
  engagements: Pick<Engagement, "id" | "clientId">[],
) => string | null = taskClientId

/**
 * Cents matter here in a way they do not elsewhere in the CRM: an invoice total
 * is the exact figure on the paper, not a planning estimate, so this does not
 * reuse `eur` from the kernel (whole euros). Hours × rate can carry cents too.
 */
export const eurCents = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
}).format

/**
 * What the client actually owes: imponibile plus the VAT as charged.
 *
 * Deliberately NOT shared with plan-grid's `invoiceable()`, which forecasts VAT
 * at the statutory rate from a contract flag. That one predicts, this one
 * reports. Merging them is how a €0 reverse-charge invoice starts reading as 22%.
 */
export function invoiceTotal(invoice: Invoice): number {
  return round2(invoice.amount + invoice.vat)
}

/**
 * Display order: unpaid before paid, due-dated before undated (soonest first),
 * creation order as the tiebreak. One comparator, same shape as sortTasks.
 */
export function sortInvoices(invoices: Invoice[]): Invoice[] {
  return [...invoices].sort((a, b) => {
    const aPaid = a.paidDate != null
    const bPaid = b.paidDate != null
    if (aPaid !== bPaid) return aPaid ? 1 : -1
    if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime()
    if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
}

/**
 * Overdue = unpaid and past its due date (date-only comparison). A credit note
 * is never overdue: it is money owed to the client, not chased from them.
 */
export function isInvoiceOverdue(invoice: Invoice, today: Date = new Date()): boolean {
  if (invoice.amount < 0) return false
  if (invoice.paidDate || !invoice.dueDate) return false
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return invoice.dueDate.getTime() < startOfToday.getTime()
}

/**
 * Unpaid, incl. VAT as charged, for ONE client's invoices: credit notes net
 * against unpaid invoices across all its contracts. Summed per client by the
 * caller, so the tile and the client's row always agree.
 */
export function outstanding(invoices: Invoice[]): number {
  const unpaid = invoices.filter((i) => !i.paidDate).reduce((sum, i) => sum + invoiceTotal(i), 0)
  // ponytail: per-client clamp; a real refund owed would read 0 — tick the credit note.
  return Math.max(0, round2(unpaid))
}

/**
 * The VAT to suggest for a net amount: the statutory rate on the VAT-liable
 * share of what was logged. Exact for a client whose contracts all carry VAT
 * (or none do), pro rata for a mixed one. A suggestion, never a rule.
 */
export function suggestedVat(amount: number, vatShare: number): number {
  return round2(amount * IVA_RATE * vatShare)
}

// ─── Periods: an invoice covering several months ────────────────────────────

/**
 * The accrual months an invoice covers, oldest first: fromMonth to yearMonth,
 * or yearMonth alone. Bad stored data (from at or after to) reads as one month.
 */
export function periodMonths(i: Pick<Invoice, "fromMonth" | "yearMonth">): string[] {
  if (!i.fromMonth || i.fromMonth >= i.yearMonth) return [i.yearMonth]
  // ponytail: capped at 12 like invoicePeriodError; longer stored data spreads over its first 12.
  return monthsFrom(i.fromMonth, 12).filter((m) => m <= i.yearMonth)
}

/**
 * Why a period cannot be recorded, or null. The one check the form and the MCP
 * share; the rules check only the shape. 12 months, so a typo in the year
 * cannot spread one invoice over a decade.
 */
export function invoicePeriodError(fromMonth: string | null, yearMonth: string): string | null {
  if (!fromMonth) return null
  if (fromMonth > yearMonth) return "The first month comes after the last one."
  if (!monthsFrom(fromMonth, 12).includes(yearMonth)) return "An invoice covers at most 12 months."
  return null
}

/** "Jul 2026", "Apr–Jun 2026", "Nov 2025–Jan 2026". */
export function invoicePeriodLabel(i: Pick<Invoice, "fromMonth" | "yearMonth">): string {
  const months = periodMonths(i)
  const last = formatYearMonth(i.yearMonth, "MMM yyyy")
  if (months.length === 1) return last
  const sameYear = months[0].slice(0, 4) === i.yearMonth.slice(0, 4)
  return `${formatYearMonth(months[0], sameYear ? "MMM" : "MMM yyyy")}–${last}`
}

// ─── Billing: logged hours against invoices ─────────────────────────────────

/** One contract's hours in a month, valued at its rate in force that month: a line of the client's invoice. */
export type BillingLine = { engagementId: string; hours: number; dailyRate: number; logged: number }

export type BillingMonth = {
  yearMonth: string
  /** null = untracked: before loggedSince, or after currentMonth. */
  hours: number | null
  /** Net: Σ over the lines of hoursToDays(hours) × that month's dailyRate. null when hours is null. */
  logged: number | null
  /** One line per contract with hours, in contract order; [] when the month is untracked. */
  contracts: BillingLine[]
  /** The VAT-liable share of logged, 0-1. 0 when logged is null or 0. */
  vatShare: number
  /**
   * Net: Σ of this month's share of each invoice, credit notes subtract. VAT is
   * never read. A single-month invoice's share is its amount.
   */
  invoiced: number
  /** This client's invoices with a share in this accrual month (a period one on each of its months), by createdAt. */
  invoices: Invoice[]
  /** logged − invoiced. null when logged is null. */
  left: number | null
  /**
   * What this month still holds of the balance: its left once months invoiced
   * ahead (one invoice covering several) have covered the oldest positive ones.
   * Σ unbilled = max(0, toInvoice); 0 for untracked and current months. Record
   * Invoice and get_unbilled offer this, never left: a quarter reads +/+/− by
   * month, and invoicing each + bills the same hours twice.
   */
  unbilled: number
  /**
   * The client's first logged month came out ahead while a contract was already
   * running: hours start part-way, the invoice pays the whole month. Never
   * counts as ahead.
   */
  partlyLogged: boolean
}

export type ClientBilling = {
  clientId: string
  /** Months with hours or an invoice, newest first. */
  months: BillingMonth[]
  /** First month with a timecard on any of the client's contracts. null = never logged. */
  loggedSince: string | null
  /** Σ left over closed tracked months, a partly logged one aside. null when never logged. */
  toInvoice: number | null
  /** The current month's logged value so far. null when never logged. */
  thisMonth: number | null
  thisMonthHours: number | null
}

/**
 * What a client's logged hours are worth against what it was invoiced, per
 * accrual month (competenza). Invoices bill the customer, not a contract: one
 * invoice covers every contract's hours in its month, so the balance is the
 * client's and each month lists its contracts' lines. Only months from the
 * first timecard to the current month are tracked: history before hours were
 * logged shows as rows but never enters the balance. The current month is still
 * being worked, so it is "so far", never "to invoice". Hours dated after
 * `today` are scheduled, not worked: they count from their day on, and today's
 * own hours count.
 *
 * An invoice covering several months (fromMonth–yearMonth) is spread over them
 * in proportion to the value logged in each closed month, evenly when none is;
 * the current month and later ones, still being worked, take an even share each.
 * The shares add up to its amount to the cent. A share on an untracked month
 * shows on its row and never enters the balance, like any invoice there.
 *
 * ponytail: shares rebalance as months close, so a period's figures move until
 * its last month is over.
 *
 * `engagements` is every contract, not only the client's: a document written
 * before invoices named their customer finds its client through its contract.
 *
 * ponytail: a first month ahead counts as partly logged unless every contract's
 * startMonth says it began then or later; with startMonth null an invoice in
 * advance in that first month reads as to invoice — set startMonth to fix it.
 *
 * Each month's hours are valued at the rate in force that month (rateAt), so an
 * amendment never reprices the months before it. A rate snapshot on the timecard
 * would have fixed billing alone, while the plan still repriced.
 */
export function clientBilling(input: {
  clientId: string
  engagements: Pick<Engagement, "id" | "clientId" | "dailyRate" | "startMonth" | "vatApplicable" | "amendments">[]
  timecards: Pick<Timecard, "engagementId" | "date" | "hours">[]
  invoices: Invoice[]
  /** "YYYY-MM-DD": its month is the current month. */
  today: string
}): ClientBilling {
  const { clientId, engagements, today } = input
  const currentMonth = today.slice(0, 7)
  // Closed contracts included: their hours are still history.
  const own = engagements.filter((e) => e.clientId === clientId)
  const ownIds = new Set(own.map((e) => e.id))
  const vatIds = new Set(own.filter((e) => e.vatApplicable).map((e) => e.id))

  // month → contract → Σ hours
  const hoursByMonth = new Map<string, Map<string, number>>()
  for (const t of input.timecards) {
    if (!ownIds.has(t.engagementId) || t.date > today) continue
    // Dates are "YYYY-MM-DD" strings, so this month key cannot drift a timezone.
    const ym = t.date.slice(0, 7)
    const byContract = hoursByMonth.get(ym) ?? new Map<string, number>()
    byContract.set(t.engagementId, (byContract.get(t.engagementId) ?? 0) + t.hours)
    hoursByMonth.set(ym, byContract)
  }

  // Every month with hours is tracked: none is before the first, or after today.
  // Rounded per contract, then added: rates differ, and the lines must add up to the month.
  const linesByMonth = new Map<string, BillingLine[]>()
  for (const [ym, byContract] of hoursByMonth) {
    const lines: BillingLine[] = []
    for (const e of own) {
      const h = byContract.get(e.id)
      if (h === undefined) continue
      const hours = round2(h)
      const dailyRate = rateAt(e, ym)
      lines.push({ engagementId: e.id, hours, dailyRate, logged: round2(hoursToDays(hours) * dailyRate) })
    }
    linesByMonth.set(ym, lines)
  }
  const loggedIn = (ym: string) => round2((linesByMonth.get(ym) ?? []).reduce((sum, l) => sum + l.logged, 0))

  // month → each invoice's share of it; a single-month invoice is one share of its whole amount.
  const sharesByMonth = new Map<string, { invoice: Invoice; share: number }[]>()
  const invoices = input.invoices
    .filter((i) => invoiceClientId(i, engagements) === clientId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  for (const invoice of invoices) {
    const period = periodMonths(invoice)
    const even = invoice.amount / period.length
    // Only a closed month's value is final: the current month and later each take an even
    // share, so an invoice in advance never piles onto the closed months and covers older ones.
    const weights = period.map((ym) => (ym < currentMonth ? loggedIn(ym) : null))
    const closed = weights.filter((w) => w !== null)
    const total = closed.reduce((sum, w) => sum + w, 0)
    let rest = invoice.amount
    period.forEach((ym, k) => {
      const w = weights[k]
      // The last month takes the remainder, so the shares add up to the amount exactly.
      const share =
        k === period.length - 1
          ? round2(rest)
          : round2(w === null || total === 0 ? even : (even * closed.length * w) / total)
      rest -= share
      sharesByMonth.set(ym, [...(sharesByMonth.get(ym) ?? []), { invoice, share }])
    })
  }

  const loggedSince = [...hoursByMonth.keys()].sort()[0] ?? null
  // Running before the first timecard: that month's invoice also pays days nobody logged.
  const startedEarlier =
    loggedSince !== null && own.some((e) => e.startMonth === null || e.startMonth < loggedSince)

  const months = [...new Set([...hoursByMonth.keys(), ...sharesByMonth.keys()])]
    .sort()
    .reverse()
    .map((yearMonth): BillingMonth => {
      const tracked = loggedSince !== null && loggedSince <= yearMonth && yearMonth <= currentMonth
      const contracts = linesByMonth.get(yearMonth) ?? []
      const vatLogged = contracts.reduce((sum, l) => (vatIds.has(l.engagementId) ? sum + l.logged : sum), 0)
      const hours = tracked ? round2(contracts.reduce((sum, l) => sum + l.hours, 0)) : null
      const logged = tracked ? loggedIn(yearMonth) : null
      const shares = sharesByMonth.get(yearMonth) ?? []
      const monthInvoices = shares.map((s) => s.invoice)
      const invoiced = round2(shares.reduce((sum, s) => sum + s.share, 0))
      const left = logged === null ? null : round2(logged - invoiced)
      const partlyLogged = startedEarlier && yearMonth === loggedSince && left !== null && left < 0
      return {
        yearMonth,
        hours,
        logged,
        contracts,
        // Rounded like logged, so a client whose contracts all carry VAT reads exactly 1.
        vatShare: logged ? round2(vatLogged) / logged : 0,
        invoiced,
        invoices: monthInvoices,
        left,
        unbilled: 0,
        partlyLogged,
      }
    })

  if (loggedSince === null) {
    return { clientId, months, loggedSince, toInvoice: null, thisMonth: null, thisMonthHours: null }
  }

  // Oldest first: a month ahead covers the oldest open months, and what it has
  // left over covers the next ones (an invoice in advance).
  let ahead = 0
  const open: BillingMonth[] = []
  for (const m of [...months].reverse()) {
    if (m.left === null || m.yearMonth >= currentMonth || m.partlyLogged) continue
    if (m.left > 0) {
      const covered = Math.min(ahead, m.left)
      ahead = round2(ahead - covered)
      m.unbilled = round2(m.left - covered)
      open.push(m)
    } else {
      ahead = round2(ahead - m.left)
      for (const o of open) {
        const covered = Math.min(ahead, o.unbilled)
        o.unbilled = round2(o.unbilled - covered)
        ahead = round2(ahead - covered)
      }
    }
  }

  const current = months.find((m) => m.yearMonth === currentMonth)
  return {
    clientId,
    months,
    loggedSince,
    toInvoice: round2(months.reduce((sum, m) => sum + m.unbilled, 0) - ahead),
    thisMonth: current?.logged ?? 0,
    thisMonthHours: current?.hours ?? 0,
  }
}

// ─── Amendment effects: what an amendment changes, before it is saved ───────

export type AmendmentEffects = {
  /**
   * Invoiced months whose price for this contract moves, oldest first, invoiced ahead
   * included. invoiced is the month's figure before the change; delta what this
   * contract's days there move: the hours worked, else the days planned.
   */
  invoicedRepriced: { yearMonth: string; invoiced: number; delta: number }[]
  /** How toInvoice moves: positive = a top-up to invoice, negative = invoiced ahead, a credit note. */
  toInvoiceDelta: number
  /** Months from the current one to the end the budget still caps. Only when the end or the days change. */
  cappedAhead: string[]
  /** Months before `from` with more hours logged than the plan bills. Only when days are added. */
  cappedWithHours: { yearMonth: string; hours: number; billableDays: number }[]
  /** Budget left after the end month, which the Plan never bills. Only when the end or the days change. */
  daysLeftAtEnd: number
  /** Stored 0 rows the new end now covers: they stay 0. */
  zeroRowsInExtension: string[]
  /** Months already past that an extension now plans by default, with no stored row: nobody may have worked them. */
  pastMonthsPlanned: { yearMonth: string; days: number; value: number }[]
  /** Ready sentences for the reply and the dialog, the repriced months first. */
  warnings: string[]
}

/** Sorted "YYYY-MM"s as words: a run as a range ("Mar 2026–Sep 2026"), a list with holes month by month. */
export function monthRun(list: string[]): string {
  const mon = (ym: string) => formatYearMonth(ym, "MMM yyyy")
  return monthsFrom(list[0], list.length).at(-1) === list.at(-1)
    ? `${mon(list[0])}${list.length > 1 ? `–${mon(list[list.length - 1])}` : ""}`
    : list.map(mon).join(", ")
}

/**
 * What changing a contract from `before` to `after` does, from `from` on: a diff of
 * the client's billing and one walk of the contract, never an input to the numbers.
 * Remove passes them the other way round. `engagements` is every contract, as
 * clientBilling takes them; `allocations` every row, as the walk burns from the start.
 */
export function amendmentEffects(input: {
  before: Engagement
  after: Engagement
  from: string
  engagements: Engagement[]
  allocations: Allocation[]
  timecards: Pick<Timecard, "engagementId" | "date" | "hours">[]
  invoices: Invoice[]
  today: string
}): AmendmentEffects {
  const { before, after, from, today } = input
  const currentMonth = today.slice(0, 7)
  const mon = (ym: string) => formatYearMonth(ym, "MMM yyyy")
  const months = monthRun
  const bill = (e: Engagement) =>
    clientBilling({
      clientId: e.clientId,
      engagements: [...input.engagements.filter((x) => x.id !== e.id), e],
      timecards: input.timecards,
      invoices: input.invoices,
      today,
    })
  const was = bill(before)
  const now = bill(after)
  const end = after.endMonth
  // One walk from this month to the end, or to a month invoiced further ahead, the lead
  // from the contract's start included.
  const reach = [end, now.months[0]?.yearMonth].filter((m): m is string => !!m).sort().at(-1)
  const span = reach && reach > currentMonth ? differenceInCalendarMonths(parseYearMonth(reach), parseYearMonth(currentMonth)) + 1 : 1
  const unit = contractUnit(after)
  const cells = walkGrid({
    sources: toRevenueSources({ engagements: [after], opportunities: [], clients: [], scenario: "committed" }),
    allocations: input.allocations,
    fromMonth: currentMonth,
    months: span,
  })
  const hours = new Map<string, number>()
  for (const t of input.timecards) {
    if (t.engagementId === after.id && t.date <= today) hours.set(t.date.slice(0, 7), (hours.get(t.date.slice(0, 7)) ?? 0) + t.hours)
  }

  // A month is repriced when it holds an invoice and this contract's rate there moves,
  // whether or not hours are logged yet: an invoice in advance asks first too. Only this
  // contract's days count, so a multi-month invoice whose shares rebalance, or another
  // contract's hours, never read as repriced.
  const invoicedWas = new Map(was.months.map((m) => [m.yearMonth, m.invoiced]))
  const repriced = now.months
    .filter((m) => m.invoices.length > 0 && rateAt(before, m.yearMonth) !== rateAt(after, m.yearMonth))
    .reverse()
    .flatMap((m) => {
      const worked = round2(hours.get(m.yearMonth) ?? 0)
      // A closed month this contract never worked bills nothing at either rate.
      if (worked === 0 && m.yearMonth < currentMonth) return []
      const rateWas = rateAt(before, m.yearMonth)
      const rate = rateAt(after, m.yearMonth)
      const dayCount = worked > 0 ? hoursToDays(worked) : (cells.find((c) => c.yearMonth === m.yearMonth)?.billableDays ?? 0)
      const delta = round2(round2(dayCount * rate) - round2(dayCount * rateWas))
      return [{ m, worked: worked > 0, rateWas, rate, dayCount, delta, invoiced: invoicedWas.get(m.yearMonth) ?? m.invoiced }]
    })
  const invoicedRepriced = repriced.map(({ m, invoiced, delta }) => ({ yearMonth: m.yearMonth, invoiced, delta }))
  // The € difference, and what it asks for by where the month lands: undoing a rise is
  // "settled", never a credit note.
  const warnings = repriced.map(({ m, worked, rateWas, rate, dayCount, delta, invoiced }) => {
    const period = m.invoices.find((i) => periodMonths(i).length > 1)
    const head =
      `${mon(m.yearMonth)} is invoiced${worked ? "" : " ahead"} ` +
      (period ? `with ${months(periodMonths(period))} (${eurShort(period.amount)})` : `at ${eurShort(invoiced)}`)
    const at = `at ${rateIn(rate, unit)} instead of ${unit === "hour" ? rateIn(rateWas, unit) : eurShort(rateWas)}`
    if (!worked) {
      return dayCount > 0
        ? `${head}, with no hours on this contract yet: ${at} its ${countIn(round2(dayCount), unit)} planned come to ` +
            `${eurShort(Math.abs(delta))} ${delta > 0 ? "more, a top-up" : "less, a credit note"} once worked.`
        : `${head}, with no hours or planned ${unitNoun(unit)} on this contract yet: its hours will be priced ${at}.`
    }
    const rest = m.left ?? 0
    const change =
      delta > 0
        ? rest > 0
          ? `${eurShort(delta)} more to invoice (a top-up)`
          : `${eurShort(delta)} less invoiced ahead`
        : rest < 0
          ? `${eurShort(-delta)} less, so ${eurShort(-rest)} reads as invoiced ahead: issue a credit note, or it comes off your next invoice suggestion`
          : `${eurShort(-delta)} less to invoice`
    return `${head}; this contract's ${countIn(round2(dayCount), unit)} there ${at}: ${change}${rest === 0 ? ": it is settled" : ""}.`
  })

  const daysBefore = contractDays(before)
  const daysAfter = contractDays(after)
  const reshaped = before.endMonth !== after.endMonth || daysBefore !== daysAfter
  const cappedWithHours =
    daysAfter !== null && daysBefore !== null && daysAfter > daysBefore
      ? cells
          .filter((c) => c.yearMonth < from && c.capped && hoursToDays(hours.get(c.yearMonth) ?? 0) > c.billableDays)
          .map((c) => ({ yearMonth: c.yearMonth, hours: round2(hours.get(c.yearMonth) ?? 0), billableDays: c.billableDays }))
      : []
  if (cappedWithHours.length > 0) {
    warnings.push(
      cappedWithHours.map((c) => `${mon(c.yearMonth)} has ${c.hours} h logged but plans ${countIn(c.billableDays, unit)}`).join(", ") +
        `: if the added ${unitNoun(unit)} cover ${cappedWithHours.length > 1 ? "them" : "it"}, date the amendment from ${cappedWithHours[0].yearMonth}.`,
    )
  }

  const cappedAhead =
    reshaped && end ? cells.filter((c) => c.yearMonth >= currentMonth && c.yearMonth <= end && c.capped).map((c) => c.yearMonth) : []
  if (cappedAhead.length > 0) {
    warnings.push(
      `The budget runs out before the end: ${months(cappedAhead)} ${cappedAhead.length > 1 ? "stay" : "stays"} capped. ` +
        `Add ${unitNoun(unit)} from ${cappedAhead[0]} if the contract includes them.`,
    )
  }
  const endCell = end ? cells.find((c) => c.yearMonth === end) : undefined
  const daysLeftAtEnd = reshaped && endCell && Number.isFinite(endCell.remainingDays) ? round2(endCell.remainingDays) : 0
  if (endCell && daysLeftAtEnd > 0) {
    warnings.push(
      `${countIn(daysLeftAtEnd, unit)} of the budget ${daysLeftAtEnd === 1 ? "is" : "are"} left after ${mon(endCell.yearMonth)}, ` +
        `the last month: the Plan never bills them. Extend the end, or plan more ${unitNoun(unit)} in the months before it.`,
    )
  }
  const oldEnd = before.endMonth
  const zeroRowsInExtension =
    end && oldEnd && end > oldEnd
      ? input.allocations
          .filter((a) => a.engagementId === after.id && a.days === 0 && a.yearMonth > oldEnd && a.yearMonth <= end)
          .map((a) => a.yearMonth)
          .sort()
      : []
  if (zeroRowsInExtension.length > 0) {
    warnings.push(
      `${zeroRowsInExtension.map(mon).join(", ")} ${zeroRowsInExtension.length > 1 ? "hold" : "holds"} 0 ${unitNoun(unit)} in the Plan, ` +
        `so the extension bills nothing there: set their ${unitNoun(unit)} in the Plan.`,
    )
  }

  // An extension dated before this month fills months already past with the default days:
  // revenue for months nobody may have worked, so it is named with its value.
  const storedMonths = new Set(input.allocations.filter((a) => a.engagementId === after.id).map((a) => a.yearMonth))
  const pastMonthsPlanned =
    end && oldEnd && end > oldEnd
      ? cells
          .filter((c) => c.yearMonth > oldEnd && c.yearMonth < currentMonth && c.billableDays > 0 && !storedMonths.has(c.yearMonth))
          .map((c) => ({ yearMonth: c.yearMonth, days: c.billableDays, value: round2(c.billableDays * c.dailyRate) }))
      : []
  if (pastMonthsPlanned.length > 0) {
    const many = pastMonthsPlanned.length > 1
    warnings.push(
      `${months(pastMonthsPlanned.map((c) => c.yearMonth))} ${many ? "are past and now plan" : "is past and now plans"} ` +
        `${countIn(round2(pastMonthsPlanned.reduce((sum, c) => sum + c.days, 0)), unit)} by default ` +
        `(${eurShort(round2(pastMonthsPlanned.reduce((sum, c) => sum + c.value, 0)))}) in the Plan: ` +
        `if no work happened there, set ${many ? "them" : "it"} to 0 in the Plan, or make the renewal a new contract.`,
    )
  }

  return {
    invoicedRepriced,
    toInvoiceDelta: round2((now.toInvoice ?? 0) - (was.toInvoice ?? 0)),
    cappedAhead,
    cappedWithHours,
    daysLeftAtEnd,
    zeroRowsInExtension,
    pastMonthsPlanned,
    warnings,
  }
}

export type PlannedMonth = { yearMonth: string; days: number; value: number }

/**
 * The plan's billable days from currentMonth for `months` more months, burned
 * from the contract's start like the Clients card's "runs out" date. From allocations
 * only, never hours: always shown as "planned".
 */
export function plannedBilling(input: {
  engagement: Engagement
  allocations: Allocation[]
  currentMonth: string
  months: number
}): PlannedMonth[] {
  return resolveAllocationGrid({
    sources: toRevenueSources({
      engagements: [input.engagement],
      opportunities: [],
      clients: [],
      scenario: "committed",
    }),
    allocations: input.allocations,
    fromMonth: input.currentMonth,
    months: input.months + 1,
  })
    .filter((c) => c.billableDays > 0)
    .map((c) => ({ yearMonth: c.yearMonth, days: c.billableDays, value: round2(c.billableDays * c.dailyRate) }))
}

/**
 * Net invoiced per accrual month, 0-filled. Fed the billing months
 * ({yearMonth, amount: invoiced}), so an invoice covering several months draws
 * its shares, the way the rows reconcile. A month netted negative by a credit
 * note stays negative.
 */
export function invoicedByMonth(
  invoices: Pick<Invoice, "yearMonth" | "amount">[],
  months: string[],
): { yearMonth: string; amount: number }[] {
  return months.map((yearMonth) => ({
    yearMonth,
    amount: round2(invoices.reduce((sum, i) => (i.yearMonth === yearMonth ? sum + i.amount : sum), 0)),
  }))
}

// ─── Suggestions: what Record Invoice and get_unbilled propose ──────────────

/** One invoice the hours propose. Computed, never stored: the suggestion is the draft. */
export type InvoiceSuggestion = {
  clientId: string
  /** null = a single month. */
  fromMonth: string | null
  yearMonth: string
  /** Every month it covers, oldest first. One with no hours takes no share. */
  months: string[]
  hours: number
  /** Net: Σ unbilled of its months. */
  amount: number
  /** Σ suggestedVat month by month, so it matches get_unbilled's months to the cent. */
  vat: number
}

/**
 * What fromMonth..yearMonth leaves to invoice: net (Σ unbilled), VAT month by
 * month, and the VAT-liable share for an amount typed instead. The share weighs
 * by unbilled, then by logged, then the customer's contracts (1 when every one
 * carries VAT, else 0) for months with no hours.
 */
export function rangeSuggestion(
  billing: ClientBilling,
  fromMonth: string,
  yearMonth: string,
  engagements: Pick<Engagement, "clientId" | "vatApplicable">[] = [],
): { months: string[]; hours: number; logged: number; amount: number; vat: number; vatShare: number } {
  const months = periodMonths({ fromMonth, yearMonth })
  const rows = billing.months.filter((m) => months.includes(m.yearMonth))
  const sum = (f: (m: BillingMonth) => number) => round2(rows.reduce((s, m) => s + f(m), 0))
  const amount = sum((m) => m.unbilled)
  const logged = sum((m) => m.logged ?? 0)
  const own = engagements.filter((e) => e.clientId === billing.clientId)
  const vatShare =
    amount > 0
      ? sum((m) => m.unbilled * m.vatShare) / amount
      : logged > 0
        ? sum((m) => (m.logged ?? 0) * m.vatShare) / logged
        : own.length > 0 && own.every((e) => e.vatApplicable)
          ? 1
          : 0
  return {
    months,
    hours: sum((m) => m.hours ?? 0),
    logged,
    amount,
    vat: sum((m) => suggestedVat(m.unbilled, m.vatShare)),
    vatShare,
  }
}

/**
 * The invoices the hours propose, oldest first. Consecutive fully open months
 * (unbilled = logged: nothing invoiced, nothing covered by an advance) join one,
 * up to 12 months; a month with no row (no hours, no invoice) takes no share of
 * the spread, so it never breaks a run. Any other month with something unbilled
 * is its own: spread by hours, a longer invoice would land part of itself on a
 * month already paid for. They add up to max(0, toInvoice).
 */
export function invoiceSuggestions(billing: ClientBilling): InvoiceSuggestion[] {
  const runs: { from: string; to: string }[] = []
  let open: { from: string; to: string } | null = null
  for (const m of [...billing.months].reverse()) {
    const full = m.unbilled > 0 && m.unbilled === m.logged
    if (full && open && invoicePeriodError(open.from, m.yearMonth) === null) {
      open.to = m.yearMonth
      continue
    }
    open = null
    if (m.unbilled <= 0) continue
    const run = { from: m.yearMonth, to: m.yearMonth }
    runs.push(run)
    if (full) open = run
  }
  return runs.map(({ from, to }) => {
    const { months, hours, amount, vat } = rangeSuggestion(billing, from, to)
    return { clientId: billing.clientId, fromMonth: from < to ? from : null, yearMonth: to, months, hours, amount, vat }
  })
}

/**
 * The invoice already holding `number`, trimmed and case-insensitive, `exceptId`
 * aside. The one duplicate rule: the sheet's form and MCP create/update_invoice.
 */
export function invoiceNumberTaken<T extends Pick<Invoice, "id" | "number">>(
  invoices: T[],
  number: string,
  exceptId?: string,
): T | undefined {
  const key = number.trim().toLowerCase()
  return invoices.find((i) => i.id !== exceptId && i.number.trim().toLowerCase() === key)
}

const YEAR = "\u0000y"
const COUNTER = "\u0000n"

/**
 * "INV-2026-0014" → its series "INV-\0y-\0n", year "2026", counter 14, width 4.
 * The year is the first 4-digit 19xx/20xx run, the counter the first other run.
 * null without a counter.
 */
function numberParts(number: string) {
  const s = number.trim()
  const runs = [...s.matchAll(/\d+/g)]
  const year = runs.find((r) => /^(?:19|20)\d\d$/.test(r[0]))
  const counter = runs.find((r) => r !== year)
  if (!counter) return null
  let template = s
  // Right to left, so the first slot does not shift the second's index.
  for (const r of [year, counter].flatMap((r) => (r ? [r] : [])).sort((a, b) => (b.index ?? 0) - (a.index ?? 0))) {
    const at = r.index ?? 0
    template = template.slice(0, at) + (r === year ? YEAR : COUNTER) + template.slice(at + r[0].length)
  }
  return {
    template,
    year: year?.[0] ?? null,
    counter: Number(counter[0]),
    width: counter[0].startsWith("0") ? counter[0].length : 1,
  }
}

/**
 * The next number in the company-wide series: invoices, or credit notes when
 * `credit`. The latest number of the series (by createdAt) sets the pattern;
 * the highest counter with that pattern in today's year, plus 1, skipping any
 * number taken. A pattern with a year restarts at 1 in a new year. "" with no
 * history. `after` is the number it follows ("Next after 17/2026"): null when
 * the series restarts.
 *
 * ponytail: a 2-digit year ("FPR 12/26") reads as a suffix and never rolls over,
 * and a counter that is itself 20xx reads as a year. The duplicate check catches
 * the collisions; parse a configured pattern if either shows up.
 */
export function suggestedInvoiceNumber(
  invoices: Pick<Invoice, "id" | "number" | "amount" | "createdAt">[],
  { credit = false, today }: { credit?: boolean; today: string },
): { number: string; after: string | null } {
  const latest = invoices
    .filter((i) => i.amount < 0 === credit)
    .reduce<(typeof invoices)[number] | null>(
      (a, i) => (a === null || i.createdAt.getTime() > a.createdAt.getTime() ? i : a),
      null,
    )
  const series = latest && numberParts(latest.number)
  if (!series) return { number: "", after: null }
  const year = today.slice(0, 4)
  const same = invoices.flatMap((i) => {
    const p = numberParts(i.number)
    return p && p.template === series.template && (series.year === null || p.year === year)
      ? [{ counter: p.counter, number: i.number }]
      : []
  })
  const top = same.reduce<(typeof same)[number] | null>((a, c) => (a === null || c.counter > a.counter ? c : a), null)
  const make = (n: number) =>
    series.template.replace(YEAR, year).replace(COUNTER, String(n).padStart(series.width, "0"))
  let n = (top?.counter ?? 0) + 1
  while (invoiceNumberTaken(invoices, make(n))) n++
  return { number: make(n), after: top?.number ?? null }
}

/** suggestedInvoiceNumber's number alone: what get_unbilled proposes. */
export function nextInvoiceNumber(
  invoices: Pick<Invoice, "id" | "number" | "amount" | "createdAt">[],
  options: { credit?: boolean; today: string },
): string {
  return suggestedInvoiceNumber(invoices, options).number
}

/**
 * The due date the customer's last terms give `yearMonth`: as many months after
 * it as its latest invoice's due date fell after that invoice's month, on the
 * month's last day when that one was, else the same day (clamped). A late
 * recording counts from last month, never from a month long gone. null with no
 * history or a date already past: the field stays empty, never made-up terms.
 *
 * ponytail: terms inferred from the last invoice; a paymentTermsDays on Client
 * if the guess proves wrong often.
 */
export function suggestedDueDate(
  customerInvoices: Pick<Invoice, "number" | "amount" | "yearMonth" | "dueDate" | "createdAt">[],
  yearMonth: string,
  today: string,
): { date: string; basis: string } | null {
  const prev = customerInvoices
    .filter((i) => i.amount > 0 && i.dueDate)
    .reduce<(typeof customerInvoices)[number] | null>(
      // Recorded in the same instant (an import): the later month is the newer terms.
      (a, i) =>
        a === null || (i.createdAt.getTime() - a.createdAt.getTime() || i.yearMonth.localeCompare(a.yearMonth)) > 0
          ? i
          : a,
      null,
    )
  if (!prev?.dueDate) return null
  const due = prev.dueDate
  const terms = differenceInCalendarMonths(due, parseYearMonth(prev.yearMonth))
  const lastMonth = format(addMonths(parseYearMonth(today.slice(0, 7)), -1), "yyyy-MM")
  const month = addMonths(parseYearMonth(yearMonth > lastMonth ? yearMonth : lastMonth), terms)
  const date = isoDate(
    isLastDayOfMonth(due) ? lastDayOfMonth(month) : setDate(month, Math.min(due.getDate(), getDaysInMonth(month))),
  )
  if (date < today) return null
  return {
    date,
    basis: `Same terms as ${prev.number} (due ${format(due, "d MMM")} for ${formatYearMonth(prev.yearMonth, "MMM")}).`,
  }
}

export type InvoiceStatus = { tone: "due" | "overdue" | "paid" | "credit" | "unpaid"; label: string }

/** The one wording for an invoice's state: the table, the sheet header and the month rows. */
export function invoiceStatus(invoice: Invoice, today: Date = new Date()): InvoiceStatus {
  const day = (d: Date) => format(d, d.getFullYear() === today.getFullYear() ? "d MMM" : "d MMM yyyy")
  if (invoice.amount < 0) {
    return invoice.paidDate
      ? { tone: "paid", label: `Credit note · settled ${day(invoice.paidDate)}` }
      : { tone: "credit", label: "Credit note · open" }
  }
  if (invoice.paidDate) return { tone: "paid", label: `Paid ${day(invoice.paidDate)}` }
  if (!invoice.dueDate) return { tone: "unpaid", label: "Unpaid" }
  if (isInvoiceOverdue(invoice, today)) return { tone: "overdue", label: `Overdue · due ${day(invoice.dueDate)}` }
  return { tone: "due", label: `Unpaid · due ${day(invoice.dueDate)}` }
}

/**
 * The customer's credit notes sharing a month with `invoice`, settled or not:
 * what already corrects it, so a new credit note offers only the rest. [] for
 * a credit note itself.
 */
export function creditsOn(
  invoice: Invoice,
  invoices: Invoice[],
  engagements: Pick<Engagement, "id" | "clientId">[],
): Invoice[] {
  const clientId = invoiceClientId(invoice, engagements)
  if (invoice.amount < 0 || clientId === null) return []
  const months = new Set(periodMonths(invoice))
  return invoices.filter(
    (c) =>
      c.amount < 0 && invoiceClientId(c, engagements) === clientId && periodMonths(c).some((m) => months.has(m)),
  )
}

/**
 * The unpaid ones of creditsOn: usually deducted from the invoice's payment,
 * so Mark Paid offers them ticked. Never applied silently.
 */
export function openCredits(
  invoice: Invoice,
  invoices: Invoice[],
  engagements: Pick<Engagement, "id" | "clientId">[],
): Invoice[] {
  return creditsOn(invoice, invoices, engagements).filter((c) => !c.paidDate)
}
