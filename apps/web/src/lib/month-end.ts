/**
 * Month End: whether a month that has ended is closed, step by step
 * (docs/plans/month-end-close.md). Derived at read time from the data the other
 * pages keep, never stored: edit September in November and September turns red
 * again on its own. Pure, no I/O.
 *
 * Five steps block (Hours, Invoices, Bank, To Chase, Deadlines); four only warn,
 * in amber (Waiting for Payment, Supplier Invoices Owed, Recurring Costs, Invoice Files).
 */

import { formatYearMonth, isoDate, parseYearMonth } from "@alter-ego/kernel/dates"
import { addDays, addMonths, format, parseISO } from "date-fns"

import {
  MAX_BANK_FEE,
  bookRows,
  chaseDay,
  dayLabel,
  monthEnd,
  rowsSinceCheck,
  statementCheck,
  statementLabel,
  supplierDocuments,
  toChase,
} from "@/lib/cash-book"
import { toRevenueSources } from "@/lib/engagement-burndown"
import { contractEndDate, contractUnit, countIn, engagementLabel, formatContractQuantity, inContractUnit } from "@/lib/engagements"
import { filesInPeriod } from "@/lib/invoice-files"
import {
  clientBilling,
  eurCents,
  invoiceClientId,
  invoicePeriodLabel,
  invoiceStatus,
  invoiceSuggestions,
  invoiceTotal,
  periodMonths,
} from "@/lib/invoices"
import { estimateCovered, estimateRuns, priceIn } from "@/lib/projection"
import { hoursLine, monthHours, planCells } from "@/lib/timecards"

import type { ChaseItem } from "@/lib/cash-book"
import type { ModuleId } from "@/modules"
import type {
  Allocation,
  Client,
  CompanyAccount,
  CompanyDeadline,
  CompanyExpense,
  CompanyLoan,
  CompanyMovement,
  Engagement,
  Invoice,
  Timecard,
} from "@/types"

export type StepKey = "hours" | "invoices" | "waiting" | "suppliers" | "recurring" | "files" | "bank" | "chase" | "deadlines"
export type StepStatus = "done" | "todo" | "check" | "na"
export type ItemStatus = "done" | "todo" | "check"

/** The page's order: hours change the plan, invoices rest on the hours, the bank on the payments. */
export const STEP_ORDER: StepKey[] = ["hours", "invoices", "waiting", "suppliers", "recurring", "files", "bank", "chase", "deadlines"]

/** The steps that keep a month open. The others warn, in amber, and never block. */
export const BLOCKING: StepKey[] = ["hours", "invoices", "bank", "chase", "deadlines"]

/** The module each step belongs to: off, the step is not on the page and does not keep a month open. */
const STEP_MODULE: Record<StepKey, ModuleId> = {
  hours: "crm",
  invoices: "invoicing",
  waiting: "invoicing",
  suppliers: "books",
  recurring: "books",
  files: "invoicing",
  bank: "books",
  chase: "books",
  deadlines: "crm",
}

/** Every module on, for callers (tests) that are not a deployment. */
const ALL_ON: (id: ModuleId) => boolean = () => true

/** The steps of the modules `isOn` says are on, in the page's order. */
export function stepsOn(isOn: (id: ModuleId) => boolean): { order: StepKey[]; blocking: StepKey[] } {
  const keep = (k: StepKey) => isOn(STEP_MODULE[k])
  return { order: STEP_ORDER.filter(keep), blocking: BLOCKING.filter(keep) }
}

/**
 * Each step's name and what "done" means, worded as the goal ("Done when …") or,
 * for the three that never block, as a reminder: the card shows it above items
 * that may say the opposite, so it must never read as a statement of fact.
 */
export const STEP_INFO: Record<StepKey, { title: string; done: string }> = {
  hours: {
    title: "Hours",
    done: "Done when every contract planned in the month has its hours and the plan holds them: no Use waiting, no month over 31 days, no hours outside a contract's months.",
  },
  invoices: {
    title: "Invoices",
    done: "Done when no client has hours left to invoice in this month or an earlier one. Each invoice shows the months it covers.",
  },
  waiting: {
    title: "Waiting for Payment",
    done: "Reminder as of today, never blocking: overdue invoices, invoices with no due date and open credit notes.",
  },
  suppliers: {
    title: "Supplier Invoices Owed",
    done: "Reminder, never blocking: supplier invoices dated up to the month end and not paid in full.",
  },
  recurring: {
    title: "Recurring Costs",
    done: "Reminder, never blocking: each recurring cost should have a payment linked to it that covers the month. A cost may skip a month.",
  },
  files: {
    title: "Invoice Files",
    done: "Reminder, never blocking: every one-off cost and issued invoice in the month should have its file, the XML or a PDF when the supplier sends no XML.",
  },
  bank: {
    title: "Bank",
    done: "Done when every account open by the month end matches the bank, checked on the month's last day or later.",
  },
  chase: {
    title: "To Chase",
    done: "Done when nothing to fix is dated up to the month end: no balance below zero, no payment without an account, no cost without a document, no estimated date.",
  },
  deadlines: {
    title: "Deadlines",
    done: "Done when no deadline of yours dated up to the month end is still open.",
  },
}

/** Why a step has nothing to check (status na), shown in place of STEP_INFO's done: only these three can say so. */
export const NOT_NEEDED: Partial<Record<StepKey, string>> = {
  hours: "No hours were logged in this month or before it.",
  bank: "No company account was open by the month end.",
  chase: "No company accounts in the Cash Book yet.",
}

/** What an item is: it picks the item's one action. */
export type ItemKind =
  | "hours_missing"
  | "hours_use"
  | "hours_over"
  | "hours_outside"
  | "hours_confirmed"
  | "hours_none"
  | "invoice_open"
  | "invoice_misdated"
  | "invoice_provisional"
  | "invoice_credited"
  | "invoice_covered"
  | "waiting"
  | "supplier"
  | "recurring"
  | "file_cost"
  | "file_invoice"
  | "bank_open"
  | "bank_matches"
  | "bank_dormant"
  | "chase"
  | "deadline"

export interface MonthEndItem {
  kind: ItemKind
  status: ItemStatus
  text: string
  detail: string | null
  /**
   * The record the action is about: the contract (hours), the client
   * (hours_outside and invoices), the account, the invoice (waiting), the cost
   * (supplier, recurring) or the deadline.
   */
  ref: string | null
  /** The month the action opens when it is not the month being closed: a later bank check's. */
  month?: string
  /** hours_use: the days Use writes, the month's hours. */
  days?: number
  /** invoice_open: the months Record Invoice opens on, Ready to Invoice's draft that holds the month. */
  period?: { from: string; to: string }
  /** invoice_misdated: the invoice whose period to edit. */
  invoiceId?: string
  /**
   * bank_open: the unpaid invoices that would explain a Missing IN, the account
   * it is missing on and the day to mark them paid there. waiting: the same, for
   * the one invoice, when the Bank names it.
   */
  suspects?: { invoiceIds: string[]; accountId: string; paidOn: string }
  /** recurring: a one-off to link to the estimate, or a payment just after the month end whose date to check. */
  link?: string
  late?: string
}

export interface MonthEndStep {
  status: StepStatus
  items: MonthEndItem[]
}

export interface MonthEnd {
  /** "yyyy-MM". */
  month: string
  /** Its last day, "yyyy-MM-dd". */
  end: string
  closed: boolean
  /** The blocking steps still to do, in order. */
  todo: StepKey[]
  steps: Record<StepKey, MonthEndStep>
}

export interface MonthEndData {
  engagements: Engagement[]
  clients: Client[]
  allocations: Allocation[]
  timecards: Timecard[]
  invoices: Invoice[]
  accounts: CompanyAccount[]
  movements: CompanyMovement[]
  expenses: CompanyExpense[]
  loans: CompanyLoan[]
  deadlines: CompanyDeadline[]
}

const shiftMonth = (ym: string, n: number) => format(addMonths(parseYearMonth(ym), n), "yyyy-MM")
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** "12/09": a day inside the month being closed. */
const shortDay = (day: string) => dayLabel(day).slice(0, 5)

/**
 * The first month a close can be about: the first month with hours, or the month
 * the first company account opened, whichever is earlier. null with neither.
 */
export function monthEndFloor(data: Pick<MonthEndData, "timecards" | "accounts">): string | null {
  const months = [
    ...data.timecards.map((t) => t.date.slice(0, 7)),
    ...data.accounts.map((a) => isoDate(a.openingDate).slice(0, 7)),
  ].sort()
  return months[0] ?? null
}

/** Everything that does not depend on the month: built once, read for each month. */
function prepare(data: MonthEndData, today: string, isOn: (id: ModuleId) => boolean) {
  const currentMonth = today.slice(0, 7)
  const { rows, counted } = bookRows(data)
  const invoicing = isOn("invoicing")
  return {
    data,
    invoicing,
    today,
    currentMonth,
    clientName: (id: string | null) => data.clients.find((c) => c.id === id)?.name ?? "Unknown client",
    counted,
    hoursFloor: data.timecards.map((t) => t.date.slice(0, 7)).sort()[0] ?? null,
    sources: toRevenueSources({ engagements: data.engagements, opportunities: [], clients: data.clients, scenario: "committed" }),
    cells: planCells(data.engagements, data.allocations, currentMonth),
    hours: monthHours(data.timecards, today),
    billed: [...new Set(data.engagements.map((e) => e.clientId))].map((clientId) => ({
      clientId,
      billing: clientBilling({ clientId, engagements: data.engagements, timecards: data.timecards, invoices: data.invoices, today }),
    })),
    chase: toChase({ accounts: data.accounts, rows, invoices: data.invoices, expenses: data.expenses, invoicing }),
  }
}

type Context = ReturnType<typeof prepare>

/** Any to do, else any to check, else done. */
function step(items: MonthEndItem[]): MonthEndStep {
  const status = items.some((i) => i.status === "todo") ? "todo" : items.some((i) => i.status === "check") ? "check" : "done"
  return { status, items }
}

const NA: MonthEndStep = { status: "na", items: [] }

function item(kind: ItemKind, status: ItemStatus, text: string, detail: string | null, ref: string | null): MonthEndItem {
  return { kind, status, text, detail, ref }
}

/**
 * Hours, M only. Before the first month with hours there is nothing to check. A
 * month with billable days and no hours blocks until hours are logged or the
 * month is set to 0 days; Use waiting, more than 31 days and hours outside the
 * contract's months block too (hoursLine, the Plan's own reading). A contract
 * closed with no end month is not in the plan, so it is not asked about.
 */
function hoursStep(ctx: Context, month: string): MonthEndStep {
  if (ctx.hoursFloor === null || month < ctx.hoursFloor) return NA
  const byId = new Map(ctx.data.engagements.map((e) => [e.id, e]))
  const explicit = new Set(ctx.data.allocations.map((a) => `${a.engagementId}:${a.yearMonth}`))
  const items: MonthEndItem[] = []
  for (const source of ctx.sources) {
    const e = byId.get(source.id)
    if (!e) continue
    const label = `${source.clientName} · ${engagementLabel(e)}`
    const key = `${e.id}:${month}`
    const cell = ctx.cells.get(key)
    const line = hoursLine({ engagementId: e.id, end: contractEndDate(e), yearMonth: month, today: ctx.today, cells: ctx.cells, hours: ctx.hours, unit: e.unit,
      // Month End checks ended months only: their coverage rule never reads the time off.
      daysOff: 0 })
    if (!line) {
      // Billable, not planned: past a spent budget the plan keeps its days and bills none.
      if (cell && cell.billableDays > 0) {
        const detail = `${formatContractQuantity(e, cell.billableDays)} planned. Log the hours, or set the month to ${countIn(0, contractUnit(e))} if there was no work.`
        items.push(item("hours_missing", "todo", `${label}: no hours logged`, detail, e.id))
      } else if (cell && cell.plannedDays === 0 && explicit.has(key)) {
        items.push(item("hours_none", "done", `${label}: no work (${countIn(0, contractUnit(e))})`, null, e.id))
      }
      continue
    }
    const days = formatContractQuantity(e, line.h.days)
    if (line.action === "same") {
      items.push(item("hours_confirmed", "done", `${label}: ${days} confirmed`, null, e.id))
    } else if (line.action === "over") {
      items.push(item("hours_over", "todo", `${label}: ${days} logged, more than ${inContractUnit(31, contractUnit(e))}`, "Some hours are on the wrong day or contract.", e.id))
    } else if (line.action === "outside") {
      const detail = "The contract's start month comes after these hours: set it on the client."
      items.push(item("hours_outside", "todo", `${label}: ${days} logged outside the plan`, detail, e.clientId))
    } else {
      // "use": a month that has ended goes either way ("pace" and "none" only come for an open one).
      const text = `${label}: ${days} logged, ${formatContractQuantity(e, line.planned ?? 0)} planned`
      items.push({ ...item("hours_use", "todo", text, "Use puts the hours in the plan.", e.id), days: line.h.days })
    }
  }
  return step(items)
}

/**
 * Invoices, every month up to M: an invoice recorded on the wrong period leaves
 * an older month unbilled while M reads green, so an older month blocks M too.
 * An unbilled month covered by an invoice still running into the current month is
 * provisional, but only up to what that invoice can still move back onto it (its
 * shares on the months not ended yet, all of them if those log nothing): more
 * than that is certainly unbilled and blocks. One a credit note took back is
 * credited. Provisional and credited are to check, never blocking. Each client
 * invoiced in M says which invoice covers it.
 */
function invoicesStep(ctx: Context, month: string): MonthEndStep {
  const items: MonthEndItem[] = []
  const covering = (list: Invoice[]) => list.map((i) => `${i.number} (${invoicePeriodLabel(i)})`).join(", ")
  for (const { clientId, billing } of ctx.billed) {
    const name = ctx.clientName(clientId)
    // Oldest first: the month to invoice first.
    const open = billing.months.filter((m) => m.yearMonth <= month && m.unbilled > 0).reverse()
    for (const m of open) {
      const when = formatYearMonth(m.yearMonth)
      const running = m.invoices.filter((i) => i.amount > 0 && i.yearMonth >= ctx.currentMonth)
      // The months not ended yet each hold an even share; if they log nothing, it all comes back here.
      const movable = running.reduce((sum, i) => {
        const period = periodMonths(i)
        return sum + (i.amount * period.filter((ym) => ym >= ctx.currentMonth).length) / period.length
      }, 0)
      const runsTo = formatYearMonth(running.reduce((last, i) => (i.yearMonth > last ? i.yearMonth : last), ctx.currentMonth))
      if (running.length > 0 && m.unbilled <= movable + 0.01) {
        const detail = `Final once ${runsTo} ends: until then the months still running each take an even share.`
        items.push(item("invoice_provisional", "check", `${name}, ${when}: provisional, ${eurCents(m.unbilled)} to come from ${covering(running)}`, detail, clientId))
        continue
      }
      // ponytail: a credit note over several months is split evenly; exact for single-month ones, the norm.
      const credits = m.invoices.filter((i) => i.amount < 0)
      const credited = credits.reduce((sum, c) => sum + Math.abs(c.amount) / periodMonths(c).length, 0)
      const numbers = credits.map((c) => c.number).join(", ")
      if (credits.length > 0 && m.unbilled <= credited + 0.005) {
        const text = `${name}, ${when}: ${eurCents(m.unbilled)} credited by ${numbers}`
        items.push(item("invoice_credited", "check", text, "Re-invoice it, or leave it if it was a discount.", clientId))
        continue
      }
      const text = `${name}, ${when}: ${eurCents(m.unbilled)} not invoiced`
      // An invoice for this month recorded on the current one: asked first, before a second invoice.
      const misdated = ctx.data.invoices.find(
        (i) =>
          i.amount > 0 &&
          invoiceClientId(i, ctx.data.engagements) === clientId &&
          periodMonths(i)[0] > m.yearMonth &&
          i.yearMonth >= ctx.currentMonth,
      )
      if (misdated) {
        const detail = `Is ${misdated.number} (${invoicePeriodLabel(misdated)}) the ${formatYearMonth(m.yearMonth, "MMMM")} invoice? Edit its period.`
        items.push({ ...item("invoice_misdated", "todo", text, detail, clientId), invoiceId: misdated.id })
        continue
      }
      // Ready to Invoice's draft for it: one invoice over a run of fully open months, or the month alone.
      const draft = invoiceSuggestions(billing).find((s) => s.months.includes(m.yearMonth))
      const run = draft && draft.months.length > 1 ? draft : undefined
      const detail = [
        m.invoices.some((i) => i.amount > 0) ? `Partly covered by ${covering(m.invoices.filter((i) => i.amount > 0))}.` : "",
        running.length > 0 ? `At most ${eurCents(movable)} more can come from ${running.map((i) => i.number).join(", ")} once ${runsTo} ends.` : "",
        credits.length > 0 ? `${eurCents(credited)} of it was credited by ${numbers}.` : "",
        run ? `Ready to Invoice suggests one invoice for ${invoicePeriodLabel(run)}, ${eurCents(run.amount)}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
      const period = draft ? { from: draft.fromMonth ?? draft.yearMonth, to: draft.yearMonth } : { from: m.yearMonth, to: m.yearMonth }
      items.push({ ...item("invoice_open", "todo", text, detail || null, clientId), period })
    }
    const own = billing.months.find((m) => m.yearMonth === month)
    if (own && own.invoices.length > 0 && !open.includes(own)) {
      items.push(item("invoice_covered", "done", `${name}: covered by ${covering(own.invoices)}`, null, clientId))
    }
  }
  return step(items)
}

/**
 * As of today, whatever the month: payments are chased today. An invoice the
 * Bank names for a Missing IN carries the Bank's suggestion, so Mark Paid dates
 * it the same from either step.
 */
function waitingStep(ctx: Context, bank: MonthEndStep): MonthEndStep {
  const now = parseISO(ctx.today)
  const items: MonthEndItem[] = []
  for (const i of ctx.data.invoices) {
    const status = invoiceStatus(i, now)
    const detail =
      status.tone === "overdue"
        ? status.label
        : status.tone === "unpaid"
          ? "Unpaid, no due date: it never reaches Deadlines."
          : status.tone === "credit"
            ? "Open credit note: settle it or offset it."
            : null
    if (detail === null) continue
    const text = `${i.amount < 0 ? "Credit note" : "Invoice"} ${i.number} · ${ctx.clientName(invoiceClientId(i, ctx.data.engagements))}, ${eurCents(invoiceTotal(i))}`
    const match = bank.items.find((b) => b.suspects?.invoiceIds.includes(i.id))?.suspects
    if (!match) {
      items.push(item("waiting", "check", text, detail, i.id))
      continue
    }
    const account = ctx.data.accounts.find((a) => a.id === match.accountId)?.name
    items.push({ ...item("waiting", "check", text, `${detail} It may be the Missing IN on ${account}.`, i.id), suspects: { ...match, invoiceIds: [i.id] } })
  }
  return step(items)
}

/** Supplier invoices dated up to the month end, not paid in full today. */
function suppliersStep(ctx: Context, end: string): MonthEndStep {
  return step(
    supplierDocuments(ctx.data.expenses, ctx.data.movements)
      .docs.filter((d) => d.owed > 0 && isoDate(d.expense.date) <= end)
      .map((d) => {
        const doc = d.expense.documentRef ? ` (${d.expense.documentRef})` : ""
        const detail = `Dated ${dayLabel(isoDate(d.expense.date))}, ${eurCents(d.total)} in all.`
        return item("supplier", "check", `${d.expense.description}${doc}: ${eurCents(d.owed)} owed`, detail, d.expense.id)
      }),
  )
}

/**
 * Recurring estimates started by M with no payment linked to them that covers
 * M. Two hints: a one-off of the estimate's category paid in M that names no
 * estimate ("Paid as … on 12/09?"), and a linked payment in the week after the
 * month end, which counts for the next month.
 */
function recurringStep(ctx: Context, month: string, end: string): MonthEndStep {
  const { expenses } = ctx.data
  const weekAfter = isoDate(addDays(parseISO(end), 7))
  const name = (ym: string) => formatYearMonth(ym, "MMMM")
  return step(
    expenses
      .filter((e) => e.isRecurring && estimateRuns(e, month) && !estimateCovered(e, month, expenses))
      .map((e) => {
        const every = e.recurrenceMonths && e.recurrenceMonths > 1 ? `every ${e.recurrenceMonths} months` : "every month"
        const unlinked = expenses.find(
          (c) => !c.isRecurring && c.amount > 0 && !c.recurringExpenseId && c.category === e.category && isoDate(c.date).slice(0, 7) === month,
        )
        const late = expenses.find(
          (c) => !c.isRecurring && c.recurringExpenseId === e.id && isoDate(c.date) > end && isoDate(c.date) <= weekAfter,
        )
        const detail = unlinked
          ? `Paid as "${unlinked.description}" on ${shortDay(isoDate(unlinked.date))}? Link it to the estimate.`
          : late
            ? `The ${shortDay(isoDate(late.date))} payment covers ${name(shiftMonth(month, 1))}. Was it for ${name(month)}? Edit its date.`
            : null
        const fix = item("recurring", "check", `${e.description} (${eurCents(priceIn(e, month))}, ${every}): not paid in ${name(month)}`, detail, e.id)
        return unlinked ? { ...fix, link: unlinked.id } : late ? { ...fix, late: late.id } : fix
      }),
  )
}

/**
 * Invoice Files, M only and amber: each one-off cost dated in M and each invoice
 * of M with the file it keeps, or without one (the item to attach). A recurring
 * estimate is no document. Never blocking, so a month closed before stays closed.
 */
function filesStep(ctx: Context, month: string, end: string): MonthEndStep {
  const docs = filesInPeriod(ctx.data, { from: `${month}-01`, to: end }, (i) => ctx.clientName(invoiceClientId(i, ctx.data.engagements)))
  return step(
    docs.map((doc) => {
      const kind = doc.kind === "cost" ? "file_cost" : "file_invoice"
      const text = doc.kind === "cost" ? doc.label : `${doc.label} · ${doc.customer}`
      if (doc.file) return item(kind, "done", text, doc.file.name, doc.id)
      const money = eurCents(doc.amount)
      const detail =
        doc.kind === "cost"
          ? ["Cost", format(parseISO(doc.day), "d MMM"), money, doc.number && `Invoice ${doc.number}`].filter(Boolean).join(" · ")
          : `Issued ${doc.amount < 0 ? "credit note" : "invoice"} · ${formatYearMonth(doc.day)} · ${money} net`
      return item(kind, "check", text, detail, doc.id)
    }),
  )
}

/**
 * Each account open by the month end against the bank: done when its last check
 * matches and is dated the month end or later (later says so: it proves the
 * running total, not the cut-off). An account checked at 0 with nothing after it
 * is closed and asks for nothing more. A check after the month end that doesn't
 * match is the one to fix: Check Balance never saves an older check over it, so a
 * check on the month end could not close the month. Unpaid invoices within a bank
 * fee of a Missing IN are named as the likely cause, dated by the check, never by
 * the month on screen: on its day when it is dated by the month end, on the month
 * end when it falls early next month (the money came either side of it). A check
 * later than that names none: it is fixed from its own month. Nor is an invoice
 * named for a day before its period begins.
 */
function bankStep(ctx: Context, end: string): MonthEndStep {
  const open = ctx.data.accounts.filter((a) => isoDate(a.openingDate) <= end)
  if (open.length === 0) return NA
  const next = shiftMonth(end.slice(0, 7), 1)
  return step(
    open.map((a) => {
      const check = statementCheck(a, ctx.counted)
      if (check.status === "matches") {
        const later = ctx.counted.some((r) => r.accountId === a.id && r.day > check.day)
        if (check.book === 0 && !later) {
          return item("bank_dormant", "done", `${a.name}: closed at ${eurCents(0)} since ${dayLabel(check.day)}`, null, a.id)
        }
        if (check.day >= end) {
          const after = check.day > end ? " (after month end)" : ""
          return item("bank_matches", "done", `${a.name}: ${statementLabel(check, eurCents)}${after}`, null, a.id)
        }
      }
      const newer = check.status !== "not_checked" && check.status !== "matches" && check.day > end ? check.day : null
      const since = rowsSinceCheck(a, ctx.counted, end)
      const paidOn = check.status === "not_checked" ? null : check.day <= end ? check.day : check.day.slice(0, 7) === next ? end : null
      const suspects =
        check.status === "missing_in" && paidOn && ctx.invoicing
          ? ctx.data.invoices.filter((i) => {
              const gap = invoiceTotal(i) - check.difference
              return !i.paidDate && i.amount > 0 && gap >= 0 && gap <= MAX_BANK_FEE && `${periodMonths(i)[0]}-01` <= paidOn
            })
          : []
      const detail = [
        newer
          ? `The ${dayLabel(newer)} check doesn't match the bank: fix that first. A check dated before it won't be saved.`
          : `Check it against the statement on ${dayLabel(end)}: ${plural(since.rows.length, "row")} ${since.since}.`,
        ...suspects.map((i) => `Invoice ${i.number} · ${ctx.clientName(invoiceClientId(i, ctx.data.engagements))}, ${eurCents(invoiceTotal(i))}, unpaid: was it paid?`),
      ].join(" ")
      const label = check.status === "matches" ? `Last checked on ${dayLabel(check.day)}, before the month end` : statementLabel(check, eurCents)
      const fix: MonthEndItem = { ...item("bank_open", "todo", `${a.name}: ${label}`, detail, a.id), ...(newer && { month: newer.slice(0, 7) }) }
      if (paidOn && suspects.length > 0) fix.suspects = { invoiceIds: suspects.map((i) => i.id), accountId: a.id, paidOn }
      return fix
    }),
  )
}

function chaseText(c: ChaseItem, accountName: (id: string) => string): string {
  switch (c.kind) {
    case "negative":
      return `${accountName(c.accountId)} ends ${dayLabel(c.day)} at ${eurCents(c.balance)}`
    case "no_account":
      return `Invoice ${c.invoice.number} paid on ${dayLabel(chaseDay(c))}, no account`
    case "no_document":
      return `${c.expense.description}, ${dayLabel(chaseDay(c))}, no document`
    case "estimated":
      return `${c.row.description}, ~${dayLabel(c.row.day)}, date estimated`
    case "before_opening":
      return `${c.row.description}, ${dayLabel(c.row.day)}, before ${accountName(c.row.accountId)} opened`
    case "unassigned":
      return `${c.row.description}, ${dayLabel(c.row.day)}, on an account that no longer exists`
  }
}

/** To Chase, strict: every item dated up to the month end blocks, an old one too. */
function chaseStep(ctx: Context, end: string): MonthEndStep {
  if (ctx.data.accounts.length === 0) return NA
  const accountName = (id: string) => ctx.data.accounts.find((a) => a.id === id)?.name ?? "An account that no longer exists"
  return step(ctx.chase.filter((c) => chaseDay(c) <= end).map((c) => item("chase", "todo", chaseText(c, accountName), null, null)))
}

/** Deadlines the owner wrote, dated up to the month end and not done. */
function deadlinesStep(ctx: Context, end: string): MonthEndStep {
  return step(
    ctx.data.deadlines
      .filter((d) => !d.isDone && isoDate(d.date) <= end)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((d) => item("deadline", "todo", d.title, `Due ${dayLabel(isoDate(d.date))}${d.amount !== null ? `, ${eurCents(d.amount)}` : ""}.`, d.id)),
  )
}

function checklist(ctx: Context, month: string, isOn: (id: ModuleId) => boolean): MonthEnd {
  const end = monthEnd(month)
  const bank = bankStep(ctx, end)
  const steps: Record<StepKey, MonthEndStep> = {
    hours: hoursStep(ctx, month),
    invoices: invoicesStep(ctx, month),
    waiting: waitingStep(ctx, bank),
    suppliers: suppliersStep(ctx, end),
    recurring: recurringStep(ctx, month, end),
    files: filesStep(ctx, month, end),
    bank,
    chase: chaseStep(ctx, end),
    deadlines: deadlinesStep(ctx, end),
  }
  const todo = stepsOn(isOn).blocking.filter((k) => steps[k].status === "todo")
  return { month, end, closed: todo.length === 0, todo, steps }
}

/** Why `month` cannot be closed yet, or null: a month closes once it has ended. */
export function monthNotEnded(month: string, today: string): string | null {
  if (month < today.slice(0, 7)) return null
  const opens = format(parseYearMonth(shiftMonth(month, 1)), "d MMMM yyyy")
  return `${month} can't be closed until ${opens}: its hours and invoices are still open.`
}

/** The month's checklist. Throws for the current month or a later one. */
export function monthEndChecklist(data: MonthEndData, month: string, today: string, isOn = ALL_ON): MonthEnd {
  const refused = monthNotEnded(month, today)
  if (refused) throw new Error(refused)
  return checklist(prepare(data, today, isOn), month, isOn)
}

/** How far back openMonths looks. */
export const OPEN_MONTHS_BACK = 24

/** Months before today's that are not closed, newest first, from the floor, at most 24 back. */
export function openMonths(data: MonthEndData, today: string, isOn = ALL_ON): string[] {
  const floor = monthEndFloor(data)
  if (floor === null) return []
  const ctx = prepare(data, today, isOn)
  const out: string[] = []
  let ym = shiftMonth(ctx.currentMonth, -1)
  for (let k = 0; k < OPEN_MONTHS_BACK && ym >= floor; k++, ym = shiftMonth(ym, -1)) {
    if (!checklist(ctx, ym, isOn).closed) out.push(ym)
  }
  return out
}
