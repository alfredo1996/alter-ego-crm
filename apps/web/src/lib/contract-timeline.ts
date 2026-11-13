/**
 * Every contract and open deal on one 12-month timeline: where each bar sits, what state it is in, how full
 * it is, and its figures by quarter. No second computation: planned days are the Plan's own grid
 * (resolveAllocationGrid), logged days are the timecards up to today (the hours clientBilling reads), and
 * invoiced is clientBilling's, the engine Quarters reads too.
 */
import { parseYearMonth, quarterMonths } from "@alter-ego/kernel/dates"
import { addMonths, differenceInCalendarMonths, format, getDaysInMonth } from "date-fns"

import { monthsFrom, resolveAllocationGrid, toRevenueSources } from "@/lib/engagement-burndown"
import { contractDays, contractEndDate, contractUnit, engagementLabel, hoursToDays, rateIn } from "@/lib/engagements"
import { clientBilling, invoiceClientId } from "@/lib/invoices"
import { OPEN_STAGES, STAGE_LABELS } from "@/lib/opportunities"
import { stepContract } from "@/lib/solutions"

import type { Allocation, Client, Engagement, Invoice, Opportunity, Solution, Timecard } from "@/types"

export const WINDOW_MONTHS = 12
/** A contract this full or fuller is drawn "nearly full". */
export const NEARLY_FULL = 0.9

const round2 = (n: number) => Math.round(n * 100) / 100 + 0

/** The window's first month: the first month of the previous quarter, moved by whole quarters. */
export function windowFrom(today: string, shiftQuarters = 0): string {
  const month = parseYearMonth(today.slice(0, 7))
  const quarterStart = addMonths(month, -(month.getMonth() % 3))
  return format(addMonths(quarterStart, -3 + 3 * shiftQuarters), "yyyy-MM")
}

/** "Jul 2026 – Jun 2027". */
export function windowLabel(from: string): string {
  const last = monthsFrom(from, WINDOW_MONTHS).at(-1)!
  return `${format(parseYearMonth(from), "MMM yyyy")} – ${format(parseYearMonth(last), "MMM yyyy")}`
}

/** Where today falls in the window, 0–1; null when it is outside. */
export function todayAt(today: string, from: string): number | null {
  const index = monthsFrom(from, WINDOW_MONTHS).indexOf(today.slice(0, 7))
  if (index < 0) return null
  const day = Number(today.slice(8, 10))
  return (index + (day - 1) / getDaysInMonth(parseYearMonth(today.slice(0, 7)))) / WINDOW_MONTHS
}

export interface Span {
  /** 0–1 along the window. */
  left: number
  width: number
  /** Began before the window / runs past it or has no end. */
  fromEdge: boolean
  toEdge: boolean
}

/**
 * A bar's place in the window. No start = already running (the left edge); no end = to the right edge.
 * null when it lies wholly outside the window.
 */
export function barSpan(start: string | null, end: string | null, months: string[]): Span | null {
  const first = months[0]
  const last = months[months.length - 1]
  if ((start !== null && start > last) || (end !== null && end < first)) return null
  const from = start === null || start < first ? first : start
  const to = end === null || end > last ? last : end
  const left = months.indexOf(from) / months.length
  const width = (months.indexOf(to) - months.indexOf(from) + 1) / months.length
  return { left, width, fromEdge: start === null || start < first, toEdge: end === null || end > last }
}

export type BarState = "active" | "full" | "ended" | "open" | "opportunity"

export interface QuarterLine {
  label: string
  planned: number
  logged: number
  /** null when there are no invoices to read (the invoicing module is off). */
  invoiced: number | null
  /** Logged over planned; null with nothing planned. */
  fill: number | null
}

export interface TimelineBar extends Span {
  id: string
  kind: "contract" | "opportunity"
  clientId: string
  clientName: string
  name: string
  state: BarState
  /** Contract: its first month ("YYYY-MM"), or null. Opportunity: its expected start. */
  start: string | null
  end: string | null
  /** Days logged up to today, all time. */
  used: number
  /** Days it is contracted for, amendments included; null = no ceiling. */
  total: number | null
  /** Logged of contracted; with no ceiling, logged of planned in the window. null when unknowable. */
  fill: number | null
  /** An opportunity: its stage and its estimate in days. */
  stage: string | null
  estimate: number | null
  /** A contract's rate, "€1,000/day"; null for an opportunity. */
  rate: string | null
  /** The solution and step this bar pays for. */
  solution: { id: string; name: string; step: { number: number; title: string } | null } | null
  /** The quarters of the window the bar touches, then their sum. */
  quarters: QuarterLine[]
  sum: QuarterLine
}

export interface TimelineStats {
  active: number
  /** "Q4 2026": the quarter today is in. */
  quarter: string
  planned: number
  logged: number
  openDeals: number
  dealDays: number
}

export interface TimelineInput {
  /** "YYYY-MM-DD". */
  today: string
  /** The window's first month. */
  from: string
  clients: Pick<Client, "id" | "name">[]
  engagements: Engagement[]
  opportunities: Opportunity[]
  allocations: Allocation[]
  timecards: Pick<Timecard, "engagementId" | "date" | "hours">[]
  /** null = no invoicing: the Invoiced figures are left out. */
  invoices: Invoice[] | null
  solutions: Solution[]
}

/** "Q4 2026". */
export const quarterLabel = (ym: string) => quarterOf(ym).label

function quarterOf(ym: string) {
  const year = Number(ym.slice(0, 4))
  const q = (Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4
  return { year, q, label: `Q${q} ${year}`, months: quarterMonths(year, q) }
}

function solutionFor(
  payer: { type: "contract" | "opportunity"; id: string },
  solutions: Solution[],
  opportunities: Opportunity[],
): TimelineBar["solution"] {
  for (const s of solutions) {
    const i = s.steps.findIndex((x) => {
      const p = stepContract(x, opportunities)
      return p?.type === payer.type && p.id === payer.id
    })
    if (i >= 0) return { id: s.id, name: s.name, step: { number: i + 1, title: s.steps[i].title } }
  }
  const own = payer.type === "contract" && solutions.find((s) => s.engagementId === payer.id)
  return own ? { id: own.id, name: own.name, step: null } : null
}

export function contractTimeline(input: TimelineInput): { bars: TimelineBar[]; stats: TimelineStats } {
  const { today, engagements, opportunities, invoices } = input
  const months = monthsFrom(input.from, WINDOW_MONTHS)
  const thisQuarter = quarterOf(today.slice(0, 7))
  const clientName = new Map(input.clients.map((c) => [c.id, c.name]))

  // The Plan's grid, over the window and this quarter, as the Plan burns it.
  const gridFrom = [months[0], thisQuarter.months[0]].sort()[0]
  const gridLast = [months.at(-1)!, thisQuarter.months[2]].sort().at(-1)!
  const planned = new Map<string, number>()
  for (const c of resolveAllocationGrid({
    sources: toRevenueSources({ engagements, opportunities: [], clients: [], scenario: "committed" }),
    allocations: input.allocations,
    fromMonth: gridFrom,
    months: differenceInCalendarMonths(parseYearMonth(gridLast), parseYearMonth(gridFrom)) + 1,
  })) {
    planned.set(`${c.sourceId}:${c.yearMonth}`, c.plannedDays)
  }

  // Hours up to today, as clientBilling counts them.
  const hoursBy = new Map<string, number>()
  const firstLogged = new Map<string, string>()
  const lastLogged = new Map<string, string>()
  for (const t of input.timecards) {
    if (t.date > today) continue
    const key = `${t.engagementId}:${t.date.slice(0, 7)}`
    hoursBy.set(key, (hoursBy.get(key) ?? 0) + t.hours)
    const ym = t.date.slice(0, 7)
    if (ym < (firstLogged.get(t.engagementId) ?? "9")) firstLogged.set(t.engagementId, ym)
    if (ym > (lastLogged.get(t.engagementId) ?? "")) lastLogged.set(t.engagementId, ym)
  }
  const loggedIn = (id: string, ms: string[]) => hoursToDays(ms.reduce((s, ym) => s + (hoursBy.get(`${id}:${ym}`) ?? 0), 0))
  const plannedIn = (id: string, ms: string[]) => ms.reduce((s, ym) => s + (planned.get(`${id}:${ym}`) ?? 0), 0)

  // A client's invoices belong to the client, not to a contract: a month's share goes to each contract by what it logged.
  const invoicedBy = new Map<string, number>()
  if (invoices) {
    const byClient = new Map<string, Invoice[]>()
    for (const i of invoices) {
      const clientId = invoiceClientId(i, engagements)
      if (clientId !== null) byClient.set(clientId, [...(byClient.get(clientId) ?? []), i])
    }
    for (const [clientId, list] of byClient) {
      const billing = clientBilling({ clientId, engagements, timecards: input.timecards, invoices: list, today })
      const own = engagements.filter((e) => e.clientId === clientId)
      for (const m of billing.months) {
        // A month's invoice goes by what each contract logged; with no hours, by its planned days; with
        // neither, evenly between the contracts running then (all of the client's, if none is).
        const running = own.filter((e) => (e.startMonth === null || e.startMonth <= m.yearMonth) && (e.endMonth === null || e.endMonth >= m.yearMonth))
        const candidates = running.length > 0 ? running : own
        const weights: [string, number][] = m.contracts.map((l) => [l.engagementId, l.logged])
        const byPlan: [string, number][] = candidates.map((e) => [e.id, planned.get(`${e.id}:${m.yearMonth}`) ?? 0])
        const byRun: [string, number][] = candidates.map((e) => [e.id, 1])
        const pick = [weights, byPlan, byRun].map((w) => w.filter(([, x]) => x > 0)).find((w) => w.length > 0) ?? []
        const worth = pick.reduce((s, [, x]) => s + x, 0)
        let rest = m.invoiced
        pick.forEach(([id, w], k) => {
          const share = k === pick.length - 1 ? round2(rest) : round2((m.invoiced * w) / worth)
          rest -= share
          invoicedBy.set(`${id}:${m.yearMonth}`, share)
        })
      }
    }
  }

  const line = (label: string, id: string, ms: string[]): QuarterLine => {
    const p = round2(plannedIn(id, ms))
    const l = round2(loggedIn(id, ms))
    return {
      label, planned: p, logged: l,
      invoiced: invoices ? round2(ms.reduce((s, ym) => s + (invoicedBy.get(`${id}:${ym}`) ?? 0), 0)) : null,
      fill: p > 0 ? l / p : null,
    }
  }

  const bars: TimelineBar[] = []
  const quarterLines = (id: string, span: Span) => {
    const touched = months.slice(Math.round(span.left * months.length), Math.round((span.left + span.width) * months.length))
    const labels = [...new Set(touched.map((ym) => quarterOf(ym).label))]
    return labels.map((label) => line(label, id, quarterOf(touched.find((ym) => quarterOf(ym).label === label)!).months))
  }
  const sumOf = (lines: QuarterLine[]): QuarterLine => {
    const p = round2(lines.reduce((s, q) => s + q.planned, 0))
    const l = round2(lines.reduce((s, q) => s + q.logged, 0))
    return {
      label: "Total", planned: p, logged: l,
      invoiced: invoices ? round2(lines.reduce((s, q) => s + (q.invoiced ?? 0), 0)) : null,
      fill: p > 0 ? l / p : null,
    }
  }

  let active = 0
  let thisPlanned = 0
  let thisLogged = 0
  for (const e of engagements) {
    const all = [...hoursBy.keys()].filter((k) => k.startsWith(`${e.id}:`))
    const used = hoursToDays(all.reduce((s, k) => s + hoursBy.get(k)!, 0))
    const total = contractDays(e)
    const endDate = contractEndDate(e)
    const ended = !e.isActive || (endDate !== null && endDate < today)
    if (!ended) active += 1
    thisPlanned += plannedIn(e.id, thisQuarter.months)
    thisLogged += loggedIn(e.id, thisQuarter.months)

    // Closed without an end month or an hour: it never ran, so it has no place on a timeline (the Plan leaves it out too).
    if (!e.isActive && e.endMonth === null && !lastLogged.has(e.id)) continue
    const start = e.startMonth ?? firstLogged.get(e.id) ?? null
    // A closed contract with no end month stops at its last hour.
    const end = e.endMonth ?? (!e.isActive ? (lastLogged.get(e.id) ?? start) : null)
    const span = barSpan(start, end, months)
    if (!span) continue
    const quarters = quarterLines(e.id, span)
    const sum = sumOf(quarters)
    const fill = total !== null ? (total > 0 ? used / total : null) : sum.fill
    const state: BarState = ended ? "ended" : fill !== null && total !== null && fill >= NEARLY_FULL ? "full" : e.endMonth === null ? "open" : "active"
    bars.push({
      ...span, id: e.id, kind: "contract", clientId: e.clientId, clientName: clientName.get(e.clientId) ?? "Unknown client",
      name: engagementLabel(e), state, start, end, used, total, fill, stage: null, estimate: null, rate: rateIn(e.dailyRate, contractUnit(e)),
      solution: solutionFor({ type: "contract", id: e.id }, input.solutions, opportunities), quarters, sum,
    })
  }

  let openDeals = 0
  let dealDays = 0
  for (const o of opportunities) {
    if (!(OPEN_STAGES as readonly string[]).includes(o.stage)) continue
    const estimate = o.estimatedDaysPerMonth * o.estimatedDurationMonths
    openDeals += 1
    dealDays += estimate
    const start = o.expectedStartMonth ?? today.slice(0, 7)
    const end = format(addMonths(parseYearMonth(start), Math.max(1, o.estimatedDurationMonths) - 1), "yyyy-MM")
    const span = barSpan(start, end, months)
    if (!span) continue
    const empty: QuarterLine = { label: "Total", planned: 0, logged: 0, invoiced: null, fill: null }
    bars.push({
      ...span, id: o.id, kind: "opportunity", clientId: o.clientId, clientName: clientName.get(o.clientId) ?? "Unknown client",
      name: o.title, state: "opportunity", start, end, used: 0, total: null, fill: null, stage: STAGE_LABELS[o.stage], estimate, rate: null,
      solution: solutionFor({ type: "opportunity", id: o.id }, input.solutions, opportunities), quarters: [], sum: empty,
    })
  }

  bars.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.name.localeCompare(b.name))
  return { bars, stats: { active, quarter: thisQuarter.label, planned: round2(thisPlanned), logged: round2(thisLogged), openDeals, dealDays: round2(dealDays) } }
}

/** The bars under their client, clients by name, each client's bars in the order given. */
export function groupByClient(bars: TimelineBar[]): { clientId: string; clientName: string; bars: TimelineBar[] }[] {
  const groups = new Map<string, { clientId: string; clientName: string; bars: TimelineBar[] }>()
  for (const b of bars) {
    const g = groups.get(b.clientId) ?? { clientId: b.clientId, clientName: b.clientName, bars: [] }
    g.bars.push(b)
    groups.set(b.clientId, g)
  }
  return [...groups.values()].sort((a, b) => a.clientName.localeCompare(b.clientName))
}
