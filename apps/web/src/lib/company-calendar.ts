/**
 * One dated list out of five sources.
 *
 * Only three are stored: the deadlines the user types in, invoice due dates and
 * client tasks. Follow-ups come from the pipeline and budget-exhaustion dates
 * from the burn-down — both derived on read.
 * Persisting a derived date would let it drift from the plan that produced it,
 * which is exactly the bug this app exists to avoid.
 */

import { isoDate } from "@alter-ego/kernel/dates"
import { addDays, endOfMonth, endOfWeek, format, lastDayOfMonth } from "date-fns"

import { invoiceClientId, invoiceTotal } from "./invoices"
import { taskClientId } from "./tasks"

import type { EngagementBurnDown } from "./engagement-burndown"
import type {
  Client,
  CompanyDeadline,
  CompanyDeadlineKind,
  Engagement,
  Invoice,
  Opportunity,
  Task,
} from "@/types"

export type CalendarItemSource = "manual" | "crm" | "milestone" | "invoice" | "task"

export interface CalendarItem {
  /** ISO "YYYY-MM-DD". */
  date: string
  source: CalendarItemSource
  kind: CompanyDeadlineKind
  /** What is due: a deadline's title, "Invoice 14", a task, a follow-up's next action. */
  label: string
  /** Whose it is: "Yours", the client, "Deal · client", or "client · from the plan". */
  detail: string
  amount: number | null
  isDone: boolean
  /** Present only for stored deadlines, so the UI knows what it can edit. */
  deadlineId?: string
  /** Present only for invoice rows, so the UI can mark one paid. */
  invoiceId?: string
  /** Present only for task rows, so the UI can tick one off. */
  taskId?: string
  /** Present only for follow-ups, so the UI can open the client's deals. */
  clientId?: string
}

export interface BuildCompanyCalendarInput {
  deadlines?: CompanyDeadline[]
  /** Open opportunities contribute their next action; closed ones cannot be chased. */
  opportunities?: Opportunity[]
  burnDowns?: EngagementBurnDown[]
  /** Only invoices with a dueDate land on the calendar. */
  invoices?: Invoice[]
  /** Only tasks with a dueDate land on the calendar. */
  tasks?: Task[]
  /** Resolves invoice, task and follow-up → client name, and a budget's contract name. */
  engagements?: Engagement[]
  clients?: Client[]
  /** ISO "YYYY-MM-DD". Anything strictly earlier is dropped. */
  from?: string
  /** ISO "YYYY-MM-DD". Anything strictly later is dropped. */
  to?: string
  /** ISO "YYYY-MM-DD"; defaults to today. Derived items before it count as done. */
  today?: string
}

function monthEnd(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number)
  return isoDate(lastDayOfMonth(new Date(year, month - 1, 1)))
}

export function buildCompanyCalendar(input: BuildCompanyCalendarInput): CalendarItem[] {
  const today = input.today ?? isoDate(new Date())
  const items: CalendarItem[] = []

  const clientNameById = new Map((input.clients ?? []).map((c) => [c.id, c.name]))
  const clientName = (clientId: string | null | undefined) =>
    clientNameById.get(clientId ?? "") || "Unknown client"

  for (const deadline of input.deadlines ?? []) {
    items.push({
      date: isoDate(deadline.date),
      source: "manual",
      kind: deadline.kind,
      label: deadline.title,
      detail: "Yours",
      amount: deadline.amount,
      isDone: deadline.isDone,
      deadlineId: deadline.id,
    })
  }

  for (const opportunity of input.opportunities ?? []) {
    if (!opportunity.nextActionDate) continue
    if (opportunity.stage === "won" || opportunity.stage === "lost") continue
    items.push({
      date: isoDate(opportunity.nextActionDate),
      source: "crm",
      kind: "other",
      label: opportunity.nextActionNote || opportunity.title,
      detail: opportunity.nextActionNote
        ? `${opportunity.title} · ${clientName(opportunity.clientId)}`
        : clientName(opportunity.clientId),
      amount: null,
      // A follow-up is never "done": it either happens and moves, or it is overdue.
      isDone: false,
      clientId: opportunity.clientId,
    })
  }

  for (const burnDown of input.burnDowns ?? []) {
    if (!burnDown.exhaustionMonth) continue
    const date = monthEnd(burnDown.exhaustionMonth)
    const contract = input.engagements?.find((e) => e.id === burnDown.sourceId)
    items.push({
      date,
      source: "milestone",
      kind: "contract",
      label: `${contract?.name?.trim() || "Contract"} budget used up`,
      detail: `${burnDown.clientName} · from the plan`,
      amount: null,
      isDone: date < today,
    })
  }

  // An invoice with no dueDate is deliberately untracked — it must never land here,
  // or "scaduta" would be asserted about a date the user never gave.
  if (input.invoices?.length) {
    for (const invoice of input.invoices) {
      if (!invoice.dueDate) continue
      items.push({
        date: isoDate(invoice.dueDate),
        source: "invoice",
        kind: "admin",
        label: `Invoice ${invoice.number}`,
        detail: clientName(invoiceClientId(invoice, input.engagements ?? [])),
        amount: invoiceTotal(invoice),
        isDone: invoice.paidDate != null,
        invoiceId: invoice.id,
      })
    }
  }

  // Same rule as invoices: an undated to-do has no place on a dated list. It stays
  // visible on its client's card, which is where undated work belongs.
  for (const task of input.tasks ?? []) {
    if (!task.dueDate) continue
    items.push({
      date: isoDate(task.dueDate),
      source: "task",
      kind: "admin",
      label: task.title,
      detail: clientName(taskClientId(task, input.engagements ?? [])),
      amount: null,
      isDone: task.isDone,
      taskId: task.id,
    })
  }

  return items
    .filter((item) => (!input.from || item.date >= input.from) && (!input.to || item.date <= input.to))
    .sort(byDate)
}

const byDate = (a: CalendarItem, b: CalendarItem) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label)

/** Open items whose date has passed — the ones worth shouting about. */
export function overdueItems(items: CalendarItem[], today: string): CalendarItem[] {
  return items.filter((item) => !item.isDone && item.date < today)
}

export type PeriodKey = "overdue" | "week" | "month" | "later" | "done"

export interface PeriodGroup {
  key: PeriodKey
  title: string
  /** The days it covers, in words: "15–18 Oct", "Nov 2026 – Apr 2027". */
  range: string
  items: CalendarItem[]
}

const PERIOD_TITLES: Record<PeriodKey, string> = {
  overdue: "Overdue",
  week: "This week",
  month: "This month",
  later: "Later",
  done: "Done",
}

const day = (iso: string) => new Date(`${iso}T00:00:00`)

/** "15–18 Oct", "29 Oct – 1 Nov", or "18 Oct" for one day. */
function dayRange(from: string, to: string): string {
  if (from === to) return format(day(from), "d MMM")
  if (from.slice(0, 7) === to.slice(0, 7)) return `${format(day(from), "d")}–${format(day(to), "d MMM")}`
  return `${format(day(from), "d MMM")} – ${format(day(to), "d MMM")}`
}

/** "Nov 2026 – Apr 2027", or "Nov 2026" for one month. */
function monthRange(from: string, to: string): string {
  const [a, b] = [format(day(from), "MMM yyyy"), format(day(to), "MMM yyyy")]
  return a === b ? a : `${a} – ${b}`
}

/**
 * The Deadlines list's periods: what is late, the rest of this week (to Sunday),
 * the rest of this month, everything after, and what is done: newest day first, a day's items A to Z.
 * Empty periods are left out.
 */
export function groupByPeriod(items: CalendarItem[], today: string): PeriodGroup[] {
  const weekEnd = isoDate(endOfWeek(day(today), { weekStartsOn: 1 }))
  const monthEnd = isoDate(endOfMonth(day(today)))
  const keyOf = (item: CalendarItem): PeriodKey =>
    item.isDone
      ? "done"
      : item.date < today
        ? "overdue"
        : item.date <= weekEnd
          ? "week"
          : item.date <= monthEnd
            ? "month"
            : "later"
  const groups: PeriodGroup[] = (Object.keys(PERIOD_TITLES) as PeriodKey[]).map((key) => ({
    key,
    title: PERIOD_TITLES[key],
    range: "",
    items: items.filter((item) => keyOf(item) === key).sort(byDate),
  }))
  return groups
    .filter((g) => g.items.length > 0)
    .map((g) => {
      const first = g.items[0].date
      const last = g.items[g.items.length - 1].date
      switch (g.key) {
        case "overdue":
          return { ...g, range: "before today" }
        case "week":
          return { ...g, range: dayRange(today, weekEnd) }
        case "month":
          return { ...g, range: dayRange(isoDate(addDays(day(weekEnd), 1)), monthEnd) }
        case "later":
          return { ...g, range: monthRange(first, last) }
        case "done":
          return {
            ...g,
            range: "newest first",
            items: [...g.items].sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label)),
          }
      }
    })
}

export interface NextDays {
  /** ISO "YYYY-MM-DD", the last day counted. */
  to: string
  /** Unpaid invoices due by then, late ones included. */
  collect: { total: number; count: number }
  /** Your own open deadlines with an amount, due by then, late ones included. */
  pay: { total: number; count: number }
  overdue: number
}

/** The strip over the Deadlines list: what comes in and goes out over the next `days`. */
export function nextDays(items: CalendarItem[], today: string, days = 30): NextDays {
  const to = isoDate(addDays(day(today), days))
  const due = items.filter((i) => !i.isDone && i.date <= to && i.amount !== null)
  const sum = (list: CalendarItem[]) => ({
    total: Math.round(list.reduce((s, i) => s + (i.amount ?? 0), 0) * 100) / 100,
    count: list.length,
  })
  return {
    to,
    collect: sum(due.filter((i) => i.source === "invoice")),
    pay: sum(due.filter((i) => i.source === "manual")),
    overdue: overdueItems(items, today).length,
  }
}

const NOUNS: [CalendarItemSource, string, string][] = [
  ["invoice", "invoice", "invoices"],
  ["task", "task", "tasks"],
  ["manual", "deadline", "deadlines"],
  ["crm", "follow-up", "follow-ups"],
  ["milestone", "budget", "budgets"],
]

/** "1 invoice, 1 task": what the overdue items are. */
export function overdueSummary(overdue: CalendarItem[]): string {
  const parts = NOUNS.flatMap(([source, one, many]) => {
    const n = overdue.filter((i) => i.source === source).length
    return n ? [`${n} ${n === 1 ? one : many}`] : []
  })
  return parts.join(", ") || "Nothing late"
}
