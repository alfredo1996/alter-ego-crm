import { isoDate, weekdaysInMonth } from "@alter-ego/kernel/dates"
import { addDays, addMonths, format, getISOWeek, isValid, isWeekend, parseISO, startOfISOWeek } from "date-fns"

import { rateAt, resolveAllocationGrid, toRevenueSources, walkGrid, type AllocationCell } from "@/lib/engagement-burndown"
import { contractDays, contractEndDate, contractUnit, formatContractQuantity, HOURS_PER_DAY, hoursToDays } from "@/lib/engagements"
import { IVA_RATE } from "@/lib/italian-tax"

import type { Allocation, Assignment, Collaborator, ContractUnit, Engagement, Timecard } from "@/types"

/**
 * The pure half of the week of hours on /plan. A week is an ISO week, Monday first,
 * named by its Monday as "YYYY-MM-DD", which is also its ?week= value. Days stay
 * strings, like Timecard.date, so no timezone can move a cell a day.
 */

/** The Monday of `param`'s week, or of this week when `param` is missing or not a date. */
export function weekMonday(param: string | null, today: Date): string {
  const date = param ? parseISO(param) : today
  return isoDate(startOfISOWeek(isValid(date) ? date : today))
}

/** The day `n` days after `date` (before, when negative). */
export function shiftDays(date: string, n: number): string {
  return isoDate(addDays(parseISO(date), n))
}

/** Monday to Sunday of the week starting `monday`. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDays(monday, i))
}

/** "Week 39 · 21 Sep – 27 Sep 2026"; the first date carries its year only across New Year. */
export function weekLabel(monday: string): string {
  const first = parseISO(monday)
  const last = addDays(first, 6)
  const from = format(first, first.getFullYear() === last.getFullYear() ? "d MMM" : "d MMM yyyy")
  return `Week ${getISOWeek(first)} · ${from} – ${format(last, "d MMM yyyy")}`
}

/** "7,5", "7.5" or " 8 " as hours, and "" as 0, which clears the day. null for anything else or above 24. */
export function parseHours(text: string): number | null {
  const t = text.trim().replace(",", ".")
  if (t === "") return 0
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null
  const hours = Number(t)
  return hours <= 24 ? hours : null
}

/** How far ahead hours can be logged, in calendar months. */
export const HOURS_AHEAD_MONTHS = 3

/** The last day that takes new hours: today + 3 calendar months (addMonths clamps: 2026-11-30 -> 2027-02-28). */
export function lastLoggableDay(today: string): string {
  return isoDate(addMonths(parseISO(today), HOURS_AHEAD_MONTHS))
}

export type HoursRefusal = "closed" | "beforeStart" | "afterEnd" | "tooFar"

/**
 * Why `date` takes no new hours on `e`, or null. The one rule the grid and log_time
 * share, so chat and grid never disagree: nothing on a contract closed with no end
 * (it left the plan, yet its hours would still bill), nothing before the start month
 * (the plan zeroes those months), nothing after the contract's last day, nothing past
 * 3 months ahead. Clearing (0) is never asked: it is always allowed. A day after
 * today is scheduled, not refused.
 */
export function hoursRefusal(
  e: Pick<Engagement, "isActive" | "startMonth" | "endMonth" | "endDate">,
  date: string,
  today: string,
): HoursRefusal | null {
  if (!e.isActive && !e.endMonth) return "closed"
  if (e.startMonth && date.slice(0, 7) < e.startMonth) return "beforeStart"
  const end = contractEndDate(e)
  if (end && date > end) return "afterEnd"
  return date > lastLoggableDay(today) ? "tooFar" : null
}

export const refusalMessage: Record<HoursRefusal, string> = {
  closed: "The contract is closed.",
  beforeStart: "The contract has not started on this day.",
  afterEnd: "The contract has ended before this day.",
  tooFar: `Hours go at most ${HOURS_AHEAD_MONTHS} months ahead.`,
}

/** The most hours one person logs in a day: the owner per client, a collaborator in all. */
export const MAX_HOURS_A_DAY = HOURS_PER_DAY

/** What a cell's write is checked against, from the day and the contract. */
export interface CellLimits {
  /** A collaborator's row: the day limit spans every client, not one. */
  collaborator: boolean
  /** The person's other hours counted against the day: the owner's on this client's other contracts, a collaborator's on every other contract. */
  otherHours: number
  /** Hours the contract's days still take, with this cell empty; null = no contracted days, no ceiling. */
  contractLeft: number | null
  /** The month's plan in hours, and the contract's other hours in that month; plan null = no plan. A warning only. */
  planHours: number | null
  monthOthers: number
}

type LimitContract = Pick<Engagement, "id" | "clientId"> & Parameters<typeof contractDays>[0]

/**
 * The one reading of the day, the contract and the month's plan for the cell
 * (`engagement`, `date`, `who`: null = the owner), shared by the grid and log_time so
 * they refuse the same hours with the same numbers. The cell's own stored hours are
 * left out of every sum. `plannedDays` is the month's plan cell for the contract.
 */
export function cellLimits(input: {
  timecards: readonly Pick<Timecard, "engagementId" | "date" | "hours" | "collaboratorId">[]
  engagements: readonly LimitContract[]
  engagement: LimitContract
  date: string
  who: string | null
  plannedDays: number | null
}): CellLimits {
  const { engagement: e, date, who } = input
  const clientOf = new Map(input.engagements.map((x) => [x.id, x.clientId]))
  const sum = (pool: typeof input.timecards) => round2(pool.reduce((s, t) => s + t.hours, 0))
  const others = input.timecards.filter((t) => !(t.engagementId === e.id && t.date === date && (t.collaboratorId ?? null) === who))
  const ofContract = others.filter((t) => t.engagementId === e.id)
  const days = contractDays(e)
  return {
    collaborator: who !== null,
    otherHours: sum(
      others.filter(
        (t) => t.date === date && (t.collaboratorId ?? null) === who && (who !== null || clientOf.get(t.engagementId) === e.clientId),
      ),
    ),
    contractLeft: days === null ? null : round2(days * HOURS_PER_DAY - sum(ofContract)),
    planHours: input.plannedDays === null ? null : round2(input.plannedDays * HOURS_PER_DAY),
    monthOthers: sum(ofContract.filter((t) => t.date.startsWith(date.slice(0, 7)))),
  }
}

export interface HoursRoom {
  unit: ContractUnit
  /** hoursRefusal for the date: a refused date takes no hours. */
  refusal: HoursRefusal | null
  /** The owner's day on this client, of MAX_HOURS_A_DAY; other clients' hours count only on them. */
  day: { logged: number; left: number; of: number; onThisContract: number; onOtherContracts: number; onOtherClients: number }
  /** The other clients' hours that day, by client id (an orphan contract keeps its own id): onOtherClients is their sum. */
  otherClients: { clientId: string; hours: number }[]
  /** What the contract's days still take now; null = no contracted days. */
  contractLeft: { daysLeft: number | null; hoursLeft: number | null }
  /** The month's plan, this contract's hours in it (everyone's); the plan null = none. Past the plan is a warning, so left can be negative. */
  /** An hourly contract reads in hours: plannedHours, no day fields. */
  month: { yearMonth: string; plannedDays: number | null; plannedHours: number | null; loggedHours: number; leftHours: number | null; leftDays: number | null }
  /** The most hours that can still be added to the day on this contract, and which limit binds. */
  most: number
  binds: "day" | "contract" | "date"
}

/**
 * The room get_hours_left shows, from the same cellLimits log_time enforces: what
 * `engagement` can still take on `date` from the owner. `most` is limitRefusal's own
 * edge, so one more hour is refused with the kind named in `binds`.
 */
export function hoursRoom(input: {
  timecards: readonly Pick<Timecard, "engagementId" | "date" | "hours" | "collaboratorId">[]
  engagements: readonly LimitContract[]
  engagement: LimitContract & Pick<Engagement, "isActive" | "startMonth" | "endMonth" | "endDate"> & { unit?: ContractUnit | null }
  date: string
  today: string
  plannedDays: number | null
}): HoursRoom {
  const { engagement: e, date } = input
  const l = cellLimits({ ...input, who: null })
  const clientOf = new Map(input.engagements.map((x) => [x.id, x.clientId]))
  const sum = (pool: typeof input.timecards) => round2(pool.reduce((s, t) => s + t.hours, 0))
  const ownerDay = input.timecards.filter((t) => t.date === date && !t.collaboratorId)
  const stored = sum(ownerDay.filter((t) => t.engagementId === e.id))
  const refusal = hoursRefusal(e, date, input.today)
  const dayRoom = round2(MAX_HOURS_A_DAY - l.otherHours)
  const contractRoom = l.contractLeft
  const total = Math.min(dayRoom, contractRoom ?? Infinity)
  const hoursLeft = contractRoom === null ? null : Math.max(0, round2(contractRoom - stored))
  const hourly = contractUnit(e) === "hour"
  const days = (hours: number | null) => (hours === null || hourly ? null : round2(hoursToDays(hours)))
  const byClient = new Map<string, number>()
  for (const t of ownerDay) {
    const c = clientOf.get(t.engagementId) ?? t.engagementId
    if (c !== e.clientId) byClient.set(c, (byClient.get(c) ?? 0) + t.hours)
  }
  const otherClients = [...byClient].map(([clientId, hours]) => ({ clientId, hours: round2(hours) }))
  const loggedHours = round2(l.monthOthers + stored)
  const leftHours = l.planHours === null ? null : round2(l.planHours - loggedHours)
  return {
    unit: contractUnit(e),
    refusal,
    day: {
      logged: round2(l.otherHours + stored),
      left: Math.max(0, round2(dayRoom - stored)),
      of: MAX_HOURS_A_DAY,
      onThisContract: stored,
      onOtherContracts: l.otherHours,
      onOtherClients: round2(otherClients.reduce((n, o) => n + o.hours, 0)),
    },
    otherClients,
    contractLeft: { daysLeft: days(hoursLeft), hoursLeft },
    month: {
      yearMonth: date.slice(0, 7),
      plannedDays: hourly ? null : input.plannedDays,
      plannedHours: l.planHours,
      loggedHours,
      leftHours,
      leftDays: days(leftHours),
    },
    most: refusal ? 0 : Math.max(0, round2(total - stored)),
    binds: refusal ? "date" : contractRoom !== null && contractRoom < dayRoom ? "contract" : "day",
  }
}

export type HoursEdit =
  | { kind: "same" }
  | { kind: "set"; hours: number; warning?: string }
  | { kind: "delete" }
  | { kind: "invalid"; message: string }

/**
 * Why `hours` on a cell is refused by the 8-hour day or the contract's days, or null.
 * Only a write that raises the cell is checked (`stored` = its current hours), so hours
 * stored above a limit stay and can always be lowered. The plan is never a refusal.
 */
export function limitRefusal(
  hours: number,
  stored: number,
  l: Pick<CellLimits, "collaborator" | "otherHours" | "contractLeft">,
): { kind: "day" | "contract"; reason: string } | null {
  if (hours <= stored) return null
  const day = round2(l.otherHours + hours)
  if (day > MAX_HOURS_A_DAY) {
    return {
      kind: "day",
      reason: `That makes ${day} h ${l.collaborator ? "on this day across clients" : "on this client in one day"}: more than ${MAX_HOURS_A_DAY}.`,
    }
  }
  if (l.contractLeft !== null && hours > l.contractLeft) {
    return { kind: "contract", reason: `The contract has ${Math.max(0, l.contractLeft)} h left.` }
  }
  return null
}

/** A refusal as a sentence; the contract's names the way past it: `tool`, the grid's button or the MCP tool. */
export function limitMessage(r: NonNullable<ReturnType<typeof limitRefusal>>, tool = "Amend Contract"): string {
  return r.kind === "contract" ? `${r.reason} To go past its days, use ${tool}.` : r.reason
}

/** The note for hours that take the month past its plan, or null. */
export function planWarning(hours: number, l: Pick<CellLimits, "planHours" | "monthOthers">): string | null {
  if (l.planHours === null) return null
  const month = round2(l.monthOthers + hours)
  return month > l.planHours ? `That is ${month} h this month: past the plan's ${l.planHours} h.` : null
}

/**
 * What typing `text` into a cell that holds `stored` hours (0 = none) does. The
 * limits are log_time's, so the grid never writes what chat would refuse: the 8-hour
 * day, the contract's days (limitRefusal), and no new hours on a day hoursRefusal
 * refuses. Past the month's plan it writes, with a warning. Clearing is always allowed.
 */
export function hoursEdit(
  text: string,
  cell: { stored: number; refusal: HoursRefusal | null } & CellLimits,
): HoursEdit {
  const hours = parseHours(text)
  if (hours === null) return { kind: "invalid", message: "Hours go from 0 to 24, e.g. 7.5." }
  if (hours === cell.stored) return { kind: "same" }
  if (hours === 0) return { kind: "delete" }
  if (cell.refusal) return { kind: "invalid", message: refusalMessage[cell.refusal] }
  const refused = limitRefusal(hours, cell.stored, cell)
  if (refused) return { kind: "invalid", message: limitMessage(refused) }
  const warning = planWarning(hours, cell)
  return warning ? { kind: "set", hours, warning } : { kind: "set", hours }
}

/** A timecard note's length, as setTimecardSchema and the rules hold it. */
export const NOTE_MAX = 1000

export type NoteEdit = { kind: "same" } | { kind: "set"; notes: string | null } | { kind: "invalid"; message: string }

/**
 * What saving `text` as the note of a cell holding `stored` hours does. A note
 * rides on the day's hours (a timecard needs hours > 0). Adding or changing it is a
 * write log_time refuses on a day hoursRefusal refuses; clearing it, like clearing
 * hours, is always allowed. Blank text clears.
 */
export function noteEdit(
  text: string,
  cell: { stored: number; note: string | null; refusal: HoursRefusal | null },
): NoteEdit {
  const notes = text.trim() || null
  if (notes === (cell.note || null)) return { kind: "same" }
  if (cell.stored === 0) return { kind: "invalid", message: "Log hours first." }
  if (notes === null) return { kind: "set", notes }
  if (notes.length > NOTE_MAX) return { kind: "invalid", message: `A note holds at most ${NOTE_MAX} characters.` }
  if (cell.refusal) return { kind: "invalid", message: refusalMessage[cell.refusal] }
  return { kind: "set", notes }
}

/**
 * The grid's rows: the contracts that take new hours on some day of the week
 * (hoursRefusal, so a closed contract with no end stays out), plus any contract with
 * hours in it, so a closed contract's hours stay visible and correctable.
 */
export function weekContracts<
  E extends Pick<Engagement, "id" | "isActive" | "startMonth" | "endMonth" | "endDate">,
>(engagements: E[], timecards: Pick<Timecard, "engagementId" | "date">[], days: string[], today: string): E[] {
  const [first, last] = [days[0], days[days.length - 1]]
  const logged = new Set(timecards.filter((t) => t.date >= first && t.date <= last).map((t) => t.engagementId))
  return engagements.filter(
    (e) => logged.has(e.id) || days.some((d) => hoursRefusal(e, d, today) === null),
  )
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** "8.5" and "1.06", never float dust. */
export const num = (n: number) => Number(n.toFixed(2))

/**
 * The plan's cells by `${engagementId}:${yearMonth}`, exactly as the engine burns
 * them: each anchored contract's lead months (from its startMonth, else its first
 * stored row) plus 12 months from `currentMonth`, minus the months before a start.
 * The window never moves back: an unanchored contract would get a fresh budget
 * there (#155). No cell = the plan does not count that contract-month.
 */
export function planCells(
  engagements: Engagement[],
  allocations: Allocation[],
  currentMonth: string,
): Map<string, AllocationCell> {
  const startOf = new Map(engagements.map((e) => [e.id, e.startMonth ?? ""]))
  const sources = toRevenueSources({ engagements, opportunities: [], clients: [], scenario: "committed" })
  return new Map(
    walkGrid({ sources, allocations, fromMonth: currentMonth, months: 12 })
      .filter((c) => c.yearMonth >= (startOf.get(c.sourceId) ?? ""))
      .map((c) => [`${c.sourceId}:${c.yearMonth}`, c]),
  )
}

/**
 * The plan's days for a contract's month as log_time reads them: the walk starts at the
 * earlier of that month and `thisMonth`, so a past month of a contract with no start and
 * no rows still gets its default (planCells, which starts at this month, has no cell
 * there). null = a closed contract with no end, left out of the plan.
 */
export function monthPlanDays(engagement: Engagement, allocations: Allocation[], yearMonth: string, thisMonth: string): number | null {
  const origin = yearMonth < thisMonth ? yearMonth : thisMonth
  const [y0, m0] = origin.split("-").map(Number)
  const [y1, m1] = yearMonth.split("-").map(Number)
  const cells = resolveAllocationGrid({
    sources: toRevenueSources({ engagements: [engagement], opportunities: [], clients: [], scenario: "committed" }),
    allocations,
    fromMonth: origin,
    months: (y1 - y0) * 12 + (m1 - m0) + 1,
  })
  return cells.find((c) => c.yearMonth === yearMonth)?.plannedDays ?? null
}

export interface CellHours {
  /** Hours dated today or earlier, to the cent. */
  worked: number
  /** Hours dated after today, to the cent. */
  scheduled: number
  /** All of them at 8 a day, unrounded: what Use writes. */
  days: number
}

/**
 * Each contract-month's hours, by `${engagementId}:${yearMonth}`, and per month the
 * weekdays (Mon–Fri) carrying hours on any contract, each counted once.
 */
export function monthHours(
  timecards: Pick<Timecard, "engagementId" | "date" | "hours">[],
  today: string,
): { byCell: Map<string, CellHours>; covered: Map<string, number> } {
  const sums = new Map<string, { worked: number; scheduled: number }>()
  const weekdays = new Map<string, Set<string>>()
  for (const t of timecards) {
    const ym = t.date.slice(0, 7)
    const key = `${t.engagementId}:${ym}`
    const sum = sums.get(key) ?? { worked: 0, scheduled: 0 }
    if (t.date <= today) sum.worked += t.hours
    else sum.scheduled += t.hours
    sums.set(key, sum)
    if (!isWeekend(parseISO(t.date))) weekdays.set(ym, (weekdays.get(ym) ?? new Set()).add(t.date))
  }
  const byCell = new Map<string, CellHours>()
  for (const [key, { worked, scheduled }] of sums) {
    byCell.set(key, { worked: round2(worked), scheduled: round2(scheduled), days: hoursToDays(round2(worked + scheduled)) })
  }
  return { byCell, covered: new Map([...weekdays].map(([ym, dates]) => [ym, dates.size])) }
}

/**
 * The share of a month's weekdays that must carry hours before Use may lower an open
 * month, less the month's time off when the caller passes it (Plan → Your time).
 * Public holidays are not filled in: count them as time off.
 */
export const USE_COVERAGE = 0.8

export type HoursAction = "none" | "over" | "same" | "use" | "pace"

/**
 * What a contract-month's hours offer the plan, the one rule the Plan page and
 * list_time share. Hours never move the plan by themselves: Use writes `days` as the
 * month's allocation. A closed month (before today's, or any month once the
 * contract's last day `end`, contractEndDate, is behind today: no more hours can come)
 * goes either way; an open one is raised any time, and lowered only once USE_COVERAGE of its weekdays carry hours
 * (`covered`, on any contract), so one stray hour never cuts a month.
 * No plan (null) or no hours: nothing; silence is not zero work.
 */
export function hoursAction(input: {
  yearMonth: string
  today: string
  end: string | null
  planned: number | null
  days: number
  covered: number
  /** The month's time off: the open month's 80% is counted against the weekdays that are left. Required so every caller decides (0 for none). */
  daysOff: number
}): HoursAction {
  const { yearMonth, today, end, planned, days } = input
  if (planned === null || days === 0) return "none"
  if (days > 31) return "over"
  if (days === planned) return "same"
  const closed = yearMonth < today.slice(0, 7) || (end !== null && end < today)
  if (closed || days > planned) return "use"
  return input.covered >= USE_COVERAGE * Math.max(0, weekdaysInMonth(yearMonth) - input.daysOff) ? "use" : "pace"
}

/** A contract-month's hours against the plan: what the Plan's second line shows and offers. */
export interface HoursLine {
  h: CellHours
  planned: number | null
  action: HoursAction | "outside"
  title: string
}

/**
 * A contract-month's hours against its plan cell, the one reading the Plan grid and
 * Month End share. null with no hours. Hours on a month the plan does not count
 * (no cell) are "outside": the contract's start month is wrong. The caller passes
 * only the plan's contracts (toRevenueSources): a contract closed with no end month
 * is none of them, so its hours never read "outside".
 */
export function hoursLine(input: {
  engagementId: string
  /** The contract's last day, contractEndDate. */
  end: string | null
  yearMonth: string
  today: string
  /** planCells. */
  cells: Map<string, AllocationCell>
  hours: ReturnType<typeof monthHours>
  /** The contract's unit; the title counts in it (an hourly contract shows no days). */
  unit?: ContractUnit | null
  /** The month's time off (Plan → Your time); 0 for none. */
  daysOff: number
}): HoursLine | null {
  const { engagementId, end, yearMonth, today, cells, hours } = input
  const key = `${engagementId}:${yearMonth}`
  const h = hours.byCell.get(key)
  if (!h) return null
  const cell = cells.get(key)
  if (!cell) {
    return { h, planned: null, action: "outside", title: "Not in the plan this month: set the contract's start month on Clients." }
  }
  const covered = hours.covered.get(yearMonth) ?? 0
  const scheduled = h.scheduled > 0 ? ` (${num(h.scheduled)} h scheduled)` : ""
  return {
    h,
    planned: cell.plannedDays,
    action: hoursAction({ yearMonth, today, end, planned: cell.plannedDays, days: h.days, covered, daysOff: input.daysOff }),
    title: `${contractUnit(input) === "hour" ? "" : `${formatContractQuantity(input, h.days)} from `}${num(h.worked + h.scheduled)} h${scheduled}; hours on ${covered} of ${weekdaysInMonth(yearMonth)} weekdays${input.daysOff ? `, ${input.daysOff} off` : ""}`,
  }
}

/** A person in the week's grid: the owner (id null), or a collaborator. */
export interface WeekPerson {
  id: string | null
  name: string
}

/**
 * The rows under a contract in the week: "You" first, then each collaborator whose assignment covers the
 * week (from its From month to its Until or the contract's end) or who has hours in it, by name.
 * Empty when nobody but the owner qualifies: the contract keeps its single row. An inactive
 * collaborator shows only for hours already logged, so they stay visible and correctable.
 */
export function weekPeople(input: {
  engagement: Pick<Engagement, "id" | "endMonth">
  assignments: readonly Assignment[]
  collaborators: readonly Collaborator[]
  timecards: readonly Pick<Timecard, "engagementId" | "date" | "collaboratorId">[]
  days: string[]
}): WeekPerson[] {
  const { engagement: e, days } = input
  const [first, last] = [days[0], days[days.length - 1]]
  const logged = new Set(
    input.timecards.filter((t) => t.engagementId === e.id && t.date >= first && t.date <= last && t.collaboratorId).map((t) => t.collaboratorId),
  )
  const people = input.collaborators.filter((c) => {
    if (logged.has(c.id)) return true
    return (
      c.isActive &&
      input.assignments.some((a) => {
        if (a.engagementId !== e.id || a.collaboratorId !== c.id) return false
        const end = [a.until, e.endMonth].filter((m): m is string => !!m).sort()[0] ?? null
        return a.from <= last.slice(0, 7) && (!end || end >= first.slice(0, 7))
      })
    )
  })
  if (people.length === 0) return []
  return [{ id: null, name: "You" }, ...people.sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name }))]
}

export interface WeekResult {
  worked: { hours: number; value: number }
  scheduled: { hours: number; value: number }
  /** The owner's own hours: the rows with no collaborator. worked and scheduled above are everyone's, as billed. */
  own: { worked: number; scheduled: number; workedValue: number; scheduledValue: number }
  /** The plan's billable days falling in the week, by each month's weekday share, and their value. */
  plan: { days: number; value: number }
  /** The worked value plus VAT on the contracts that charge it. */
  workedVat: number
}

/**
 * What the week of `days` (Monday to Sunday) is worth. Hours are valued per contract
 * as clientBilling values them, round2(days × rate), worked (dated today or earlier)
 * apart from scheduled, at the rate in force in their month: a week across a rate
 * change values each side at its own rate. The plan's share is each month's billable
 * days times the week's weekdays in that month over the month's weekdays, at the
 * cell's rate; a missing cell adds nothing.
 */
export function weekResult(input: {
  engagements: Pick<Engagement, "id" | "dailyRate" | "vatApplicable" | "amendments">[]
  timecards: (Pick<Timecard, "engagementId" | "date" | "hours"> & { collaboratorId?: string | null })[]
  cells: Map<string, AllocationCell>
  days: string[]
  today: string
}): WeekResult {
  const { days, today } = input
  const [first, last] = [days[0], days[days.length - 1]]
  const months = new Map<string, number>()
  for (const d of days) {
    if (!isWeekend(parseISO(d))) months.set(d.slice(0, 7), (months.get(d.slice(0, 7)) ?? 0) + 1)
  }
  const week = input.timecards.filter((t) => t.date >= first && t.date <= last)
  const r: WeekResult = {
    worked: { hours: 0, value: 0 },
    scheduled: { hours: 0, value: 0 },
    own: { worked: 0, scheduled: 0, workedValue: 0, scheduledValue: 0 },
    plan: { days: 0, value: 0 },
    workedVat: 0,
  }
  for (const e of input.engagements) {
    const own = week.filter((t) => t.engagementId === e.id)
    // Hours bucketed by the rate in force in their month; a week with one rate is one bucket.
    const price = (list: typeof own) => {
      const byRate = new Map<number, { worked: number; scheduled: number }>()
      for (const t of list) {
        const rate = rateAt(e, t.date.slice(0, 7))
        const bucket = byRate.get(rate) ?? { worked: 0, scheduled: 0 }
        bucket[t.date <= today ? "worked" : "scheduled"] += t.hours
        byRate.set(rate, bucket)
      }
      const buckets = [...byRate]
      return {
        hours: (kind: "worked" | "scheduled") => buckets.reduce((sum, [, b]) => sum + b[kind], 0),
        value: (kind: "worked" | "scheduled") => round2(buckets.reduce((sum, [rate, b]) => sum + round2(hoursToDays(round2(b[kind])) * rate), 0)),
      }
    }
    const everyone = price(own)
    const hours = everyone.hours
    const value = everyone.value
    // The owner's own rows, at the same rates: what the cards call yours.
    const mine = price(own.filter((t) => !t.collaboratorId))
    r.own.worked += mine.hours("worked")
    r.own.scheduled += mine.hours("scheduled")
    r.own.workedValue += mine.value("worked")
    r.own.scheduledValue += mine.value("scheduled")
    const worked = value("worked")
    const scheduled = value("scheduled")
    r.worked.hours += hours("worked")
    r.worked.value += worked
    r.scheduled.hours += hours("scheduled")
    r.scheduled.value += scheduled
    r.workedVat += worked * (e.vatApplicable ? 1 + IVA_RATE : 1)
    for (const [ym, weekdays] of months) {
      const cell = input.cells.get(`${e.id}:${ym}`)
      if (!cell) continue
      const planDays = (cell.billableDays * weekdays) / weekdaysInMonth(ym)
      r.plan.days += planDays
      r.plan.value += planDays * cell.dailyRate
    }
  }
  r.own = { worked: round2(r.own.worked), scheduled: round2(r.own.scheduled), workedValue: round2(r.own.workedValue), scheduledValue: round2(r.own.scheduledValue) }
  r.worked = { hours: round2(r.worked.hours), value: round2(r.worked.value) }
  r.scheduled = { hours: round2(r.scheduled.hours), value: round2(r.scheduled.value) }
  r.plan.value = round2(r.plan.value)
  r.workedVat = round2(r.workedVat)
  return r
}
