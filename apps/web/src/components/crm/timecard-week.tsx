"use client"

import { eur } from "@alter-ego/kernel/currency"
import { isoDate } from "@alter-ego/kernel/dates"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { MonthStepper } from "@alter-ego/ui/page/month-stepper"
import { pageState } from "@alter-ego/ui/page/page-state"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { StatCard } from "@alter-ego/ui/page/stat-card"
import { Button } from "@alter-ego/ui/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@alter-ego/ui/ui/popover"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { cn } from "@alter-ego/ui/utils"
import { addDays, format, parseISO } from "date-fns"
import { ChevronDown, ChevronRight, MessageSquarePlus } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Fragment, useId, useRef, useState } from "react"


import { ContractRemainingLines } from "@/components/plan/contract-remaining"
import { useAllocations } from "@/hooks/use-allocations"
import { useAssignments } from "@/hooks/use-assignments"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import { useCollaborators } from "@/hooks/use-collaborators"
import { useEngagements } from "@/hooks/use-engagements"
import { useDeleteTimecard, useSetTimecard, useTimecards } from "@/hooks/use-timecards"
import { timecardId } from "@/lib/assignments"
import { contractUnit, engagementLabel, formatContractQuantity, hoursToDays, rateIn } from "@/lib/engagements"
import { eurCents } from "@/lib/invoices"
import {
  HOURS_AHEAD_MONTHS,
  cellLimits,
  hoursEdit,
  monthPlanDays,
  hoursRefusal,
  parseHours,
  lastLoggableDay,
  NOTE_MAX,
  noteEdit,
  num,
  planCells,
  refusalMessage,
  shiftDays,
  weekContracts,
  weekDays,
  weekLabel,
  weekMonday,
  weekPeople,
  weekResult,
} from "@/lib/timecards"


import type { AllocationCell } from "@/lib/engagement-burndown"
import type { WeekPerson, WeekResult } from "@/lib/timecards"
import type { Allocation, Assignment, ContractUnit, Engagement, Timecard } from "@/types"
import type { FormEvent, KeyboardEvent, ReactNode } from "react"

const dayText = (date: string, pattern: string) => format(parseISO(date), pattern)
/** "14–20 Sep", or "28 Sep–4 Oct" across a month. */
function weekRange(monday: string) {
  const first = parseISO(monday)
  const last = addDays(first, 6)
  return `${format(first, first.getMonth() === last.getMonth() ? "d" : "d MMM")}–${format(last, "d MMM")}`
}
const cellId = (row: number, day: number) => `hours-${row}-${day}`
const noteId = (row: number, day: number) => `note-${row}-${day}`
/** Below lg one day column shows at a time: seven of them and the sidebar do not fit. */
const onlyWide = "hidden lg:table-cell"
/** The clients folded in the week of hours: a per-viewer convenience, in this browser only. */
const COLLAPSED_KEY = "hours:collapsed-clients"

/** `items` by client id, in first-seen order: two clients that share a name never interleave. */
function groupByClient<T>(items: T[], clientOf: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(clientOf(item), [...(groups.get(clientOf(item)) ?? []), item])
  return [...groups]
}

/** A week reads in hours alone when every contract in it is hourly: a day count beside it would be a second unit. */
const weekUnit = (rows: Pick<Engagement, "unit">[]): ContractUnit => (rows.length > 0 && rows.every((e) => contractUnit(e) === "hour") ? "hour" : "day")

/** The Total column's width is set, not left to its content, so a total gaining digits moves nothing. */
const TOTAL_COL = "w-32 min-w-32 sm:w-40 sm:min-w-40"

/**
 * The week footer's Total, built like the rows': the hours worked, their days at 8 hours (not
 * on a week of hourly contracts alone: it would be a second unit) and their €, then what is scheduled.
 */
function weekTotal({ worked, scheduled }: Pick<WeekResult, "worked" | "scheduled">, unit: ContractUnit) {
  const line = "block text-xs font-normal text-muted-foreground"
  return (
    <>
      {num(worked.hours)} h
      {unit === "day" && <span className={line}>{num(hoursToDays(worked.hours))} d</span>}
      <span className={line}>{eurCents(worked.value)}</span>
      {/* Two lines kept for it: the text wraps in the fixed column and may appear while you type. */}
      <span className={`${line} min-h-8 whitespace-normal`}>
        {scheduled.hours > 0 && `${num(scheduled.hours)} h scheduled · +${eurCents(scheduled.value)} sch.`}
      </span>
    </>
  )
}

/** A row's or a client's Total: its hours, and under them the hours still to come, or a dash. */
function hoursTotal(worked: number, scheduled: number) {
  // The second line is always there, empty or not: a day typed in adds a "scheduled" line to the row.
  return (
    <>
      {worked === 0 && scheduled === 0 ? <span className="text-muted-foreground">—</span> : `${num(worked)} h`}
      <span className="block min-h-4 text-xs font-normal text-muted-foreground">{scheduled > 0 && `${num(scheduled)} h scheduled`}</span>
    </>
  )
}

/** "Collaborators: 8 h · €500.00" on its own line when anyone but you logged hours; nothing otherwise. */
const withOthers = (hours: number, value: number) =>
  hours > 0.005 ? (
    <span className="block">
      Collaborators: {num(hours)} h · {eurCents(value)}
    </span>
  ) : null

/** What the week is worth: its hours at the contracts' rates, and the plan's share of its weekdays. `unit`: hour when every contract of the week is hourly. */
function WeekResultCards({ result, scheduledOn, unit }: { result: WeekResult; scheduledOn: string; unit: ContractUnit }) {
  const { worked, scheduled, plan } = result
  return (
    <section aria-label="Week result" className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] sm:gap-4">
      {/* Yours: your hours, days and money. What collaborators logged is one line apart. */}
      <StatCard
        label="Worked"
        value={`${num(result.own.worked)} h`}
        detail={
          <>
            {`${unit === "hour" ? "" : `${num(hoursToDays(result.own.worked))} d · `}${eurCents(result.own.workedValue)}`}
            {withOthers(worked.hours - result.own.worked, worked.value - result.own.workedValue)}
          </>
        }
      />
      <StatCard
        label="Scheduled"
        value={`${num(result.own.scheduled)} h`}
        detail={
          <>
            {`${unit === "hour" ? "" : `${num(hoursToDays(result.own.scheduled))} d · `}${eurCents(result.own.scheduledValue)}${scheduledOn}`}
            {withOthers(scheduled.hours - result.own.scheduled, scheduled.value - result.own.scheduledValue)}
          </>
        }
        // The days to come join the detail and wrap it: room for their lines is kept, so the table below stays put.
        className="[&_[data-slot=stat-detail]]:min-h-[3lh] max-sm:[&_[data-slot=stat-detail]]:min-h-[5lh]"
      />
      <StatCard label="Planned" value={formatContractQuantity({ unit }, plan.days)} detail={`≈ ${eur(plan.value)}, this week's share`} />
      <StatCard label="Worked incl. VAT" value={eurCents(result.workedVat)} detail={`${eurCents(worked.value)} plus VAT`} />
    </section>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">{children}</div>
}

/**
 * The top of /plan: the hours worked in one ISO week, one row per contract under
 * its client's header (which folds) and one cell per day, and above it what the
 * week is worth (its hours at the contracts' rates, its share of the plan). Hours
 * are actuals: the plan and every number built on it never read them, until Use
 * in Days by month puts a month's hours in the plan. Days after today take hours
 * too, up to 3 months ahead: they are scheduled, and count as worked once the day
 * comes. The week lives in ?week=<Monday>, so a week can be linked and Back works.
 */
export function TimecardWeek() {
  const { user } = useAuth()
  const engagementsQuery = useEngagements(user?.id)
  const clientsQuery = useClients(user?.id)
  const timecardsQuery = useTimecards(user?.id)
  const allocationsQuery = useAllocations(user?.id)
  const assignmentsQuery = useAssignments(user?.id)
  const collaboratorsQuery = useCollaborators(user?.id)
  const weekParam = useSearchParams().get("week")

  const gate = pageState([engagementsQuery, clientsQuery, timecardsQuery, allocationsQuery, assignmentsQuery, collaboratorsQuery])
  if (gate) return gate

  const engagements = engagementsQuery.data ?? []
  const timecards = timecardsQuery.data ?? []
  const now = new Date()
  const today = isoDate(now)
  const thisMonday = weekMonday(null, now)
  const monday = weekMonday(weekParam, now)
  const lastDay = lastLoggableDay(today)
  const lastMonday = weekMonday(lastDay, now)
  const days = weekDays(monday)
  const clientName = new Map((clientsQuery.data ?? []).map((c) => [c.id, c.name]))
  const byClient = (a: Engagement, b: Engagement) =>
    (clientName.get(a.clientId) ?? "").localeCompare(clientName.get(b.clientId) ?? "") ||
    // Two clients with one name stay apart, so the rows run in the order they show.
    a.clientId.localeCompare(b.clientId) ||
    engagementLabel(a).localeCompare(engagementLabel(b))
  const rows = weekContracts(engagements, timecards, days, today).sort(byClient)
  // "on Friday": the days after today that hold hours, named in full for one, short for several.
  const ahead = days.filter((d) => d > today && timecards.some((t) => t.date === d && t.hours > 0 && !t.collaboratorId))
  const scheduledOn = ahead.length ? `, on ${ahead.map((d) => dayText(d, ahead.length === 1 ? "EEEE" : "EEE")).join(", ")}` : ""
  const unit = weekUnit(rows)
  const assignments = assignmentsQuery.data ?? []
  // A contract with a collaborator on it this week gets a row per person; the others keep their one row.
  const people = new Map(
    rows.map((e) => [e.id, weekPeople({ engagement: e, assignments, collaborators: collaboratorsQuery.data ?? [], timecards, days })]),
  )
  const cells = planCells(engagements, allocationsQuery.data ?? [], today.slice(0, 7))
  const result = weekResult({
    engagements,
    timecards,
    cells,
    days,
    today,
  })

  return (
    <div className="space-y-4">
      {engagements.length === 0 ? (
        <EmptyState>
          No contracts yet: hours are logged on a contract.{" "}
          <Link href="/clients" className="font-medium text-primary underline-offset-4 hover:underline pointer-coarse:-my-3 pointer-coarse:inline-block pointer-coarse:py-3">
            Add one on Clients
          </Link>
          .
        </EmptyState>
      ) : (
        <>
          <SectionHeader
            title={monday === thisMonday ? "This Week" : "Hours"}
            description={weekLabel(monday)}
            actions={
              <>
                {monday !== thisMonday && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/plan">This Week</Link>
                  </Button>
                )}
                <MonthStepper
                  groupLabel="Week"
                  label={weekRange(monday)}
                  prevHref={`/plan?week=${shiftDays(monday, -7)}`}
                  prevLabel="Previous week"
                  // Up to the week holding the last day that takes hours.
                  nextHref={monday < lastMonday ? `/plan?week=${shiftDays(monday, 7)}` : undefined}
                  nextLabel="Next week"
                />
              </>
            }
          />
          {rows.length === 0 ? (
            <EmptyState>
              {monday > lastMonday
                ? `Hours go up to ${HOURS_AHEAD_MONTHS} months ahead, until ${dayText(lastDay, "d MMM yyyy")}.`
                : "No active contracts in this week."}
            </EmptyState>
          ) : (
            <>
              <WeekResultCards result={result} scheduledOn={scheduledOn} unit={unit} />
              {/* Keyed by week: drafts and the chosen day belong to the week they were made in. */}
              <WeekGrid
                key={monday}
                userId={user?.id}
                days={days}
                today={today}
                rows={rows}
                engagements={engagements}
                clientName={clientName}
                people={people}
                assignments={assignments}
                timecards={timecards}
                cells={cells}
                allocations={allocationsQuery.data ?? []}
                result={result}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}

function WeekGrid({
  userId,
  days,
  today,
  rows,
  engagements,
  clientName,
  people,
  assignments,
  timecards,
  cells,
  allocations,
  result,
}: {
  userId: string | undefined
  days: string[]
  today: string
  rows: Engagement[]
  /** Every contract: the owner's day limit is per client, over all of its contracts. */
  engagements: Engagement[]
  clientName: Map<string, string>
  /** Per contract, the people with a row of their own; empty = the owner's single row. */
  people: Map<string, WeekPerson[]>
  assignments: Assignment[]
  timecards: Timecard[]
  cells: Map<string, AllocationCell>
  allocations: Allocation[]
  result: WeekResult
}) {
  const setTimecard = useSetTimecard(userId)
  const deleteTimecard = useDeleteTimecard(userId)
  // Text typed into a cell. Once sent, `from` holds the stored hours the save
  // replaces, and the cell is read-only until they change (the save landed, or
  // another writer's did) or the save fails: a cell never has two saves racing, and
  // a refetch never lands under typing. A draft not sent yet keeps its text whatever
  // the stored hours do, and is weighed against them when it is sent.
  const [drafts, setDrafts] = useState<Record<string, { text: string; from?: number }>>({})
  // Cells whose note is being saved: read-only meanwhile, as the note's write carries the day's hours.
  const [planNote, setPlanNote] = useState<string | null>(null)
  const [noteSaving, setNoteSaving] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState(Math.max(0, days.indexOf(today)))
  // Folded clients. The grid renders only in the browser, once the data is in.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const ids: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]")
      return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [])
    } catch {
      return new Set()
    }
  })

  const byCell = new Map(timecards.map((t) => [timecardId(t.engagementId, t.date, t.collaboratorId), t]))

  function drop(...keys: string[]) {
    setDrafts((prev) => {
      const next = { ...prev }
      for (const key of keys) delete next[key]
      return next
    })
  }
  const settled = Object.keys(drafts).filter((key) => {
    const { from } = drafts[key]
    return from !== undefined && from !== (byCell.get(key)?.hours ?? 0)
  })
  if (settled.length > 0) drop(...settled)

  const dayTotals = days.map((d) =>
    timecards.filter((t) => t.date === d).reduce((sum, t) => sum + t.hours, 0),
  )
  const contractOf = (e: Engagement) => `${clientName.get(e.clientId) ?? "—"} · ${engagementLabel(e)}`
  // The grid's lines: a contract's rows, one per person, or its single one.
  const lines = rows.flatMap((e) => {
    const who = people.get(e.id) ?? []
    if (who.length === 0) return [{ e, who: null as string | null, name: null as string | null, rate: null as string | null, first: true, count: 1 }]
    return who.map((p, i) => {
      const a = assignments.find((x) => x.engagementId === e.id && x.collaboratorId === p.id)
      return { e, who: p.id, name: p.name, rate: a ? rateIn(a.dailyRate, contractUnit(e)) : null, first: i === 0, count: who.length }
    })
  })
  type Line = (typeof lines)[number]
  /** What names a line to a screen reader: the contract, and the person when there are several. */
  const labelOf = (l: Line) => (l.name ? `${contractOf(l.e)} · ${l.name}` : contractOf(l.e))

  // What is typed and not yet saved (or saved, until the refetch lands), as the budget line counts it.
  const typedHours = (e: Engagement) => {
    const hours: Record<string, number> = {}
    for (const date of days) {
      // The day's total across the contract's people, with what is typed in place of what is stored.
      const mine = lines.filter((l) => l.e.id === e.id)
      if (!mine.some((l) => drafts[timecardId(e.id, date, l.who)]?.text !== undefined)) continue
      let total = 0
      for (const l of mine) {
        const key = timecardId(e.id, date, l.who)
        const stored = byCell.get(key)?.hours ?? 0
        const text = drafts[key]?.text
        // Blank or invalid text leaves the stored hours; the limits are the cell's own business.
        const typed = text === undefined ? null : parseHours(text)
        total += typed ?? stored
      }
      hours[date] = total
    }
    return hours
  }

  // Hours still saving count too: the query lags the write, and two quick edits must not both pass a limit.
  const pending = lines.flatMap((l) =>
    days.flatMap((date) => {
      const draft = drafts[timecardId(l.e.id, date, l.who)]
      const hours = draft?.from === undefined ? null : parseHours(draft.text)
      return hours === null ? [] : [{ engagementId: l.e.id, date, hours, collaboratorId: l.who }]
    }),
  )
  const pendingKeys = new Set(pending.map((p) => timecardId(p.engagementId, p.date, p.collaboratorId)))
  const pool = [...timecards.filter((t) => !pendingKeys.has(timecardId(t.engagementId, t.date, t.collaboratorId))), ...pending]
  // The month's plan as log_time reads it, once per contract-month.
  const planned = new Map<string, number | null>()
  const planOf = (e: Engagement, date: string) => {
    const k = `${e.id}:${date.slice(0, 7)}`
    if (!planned.has(k)) planned.set(k, monthPlanDays(e, allocations, date.slice(0, 7), today.slice(0, 7)))
    return planned.get(k) ?? null
  }

  const grid = lines.map((l) =>
    days.map((date) => {
      const e = l.e
      const key = timecardId(e.id, date, l.who)
      const timecard = byCell.get(key)
      const stored = timecard?.hours ?? 0
      const draft = drafts[key]?.text
      const saving = drafts[key]?.from !== undefined
      const refusal = hoursRefusal(e, date, today)
      const limits = cellLimits({
        timecards: pool,
        engagements,
        engagement: e,
        date,
        who: l.who,
        plannedDays: planOf(e, date),
      })
      const edit = draft === undefined || saving ? null : hoursEdit(draft, { stored, refusal, ...limits })
      return {
        key,
        date,
        stored,
        draft,
        saving,
        busy: saving || noteSaving.has(key),
        edit,
        note: timecard?.notes || null,
        refusal,
        // An empty day that takes no new hours is locked; a stored one stays open, for clearing only.
        locked: stored === 0 && refusal !== null,
        // After today: hours go in, and count as worked once the day comes.
        scheduled: date > today,
        error: edit?.kind === "invalid" ? `${labelOf(l)}, ${dayText(date, "EEE d MMM")}: ${edit.message}` : null,
      }
    }),
  )
  const error = grid.flat().find((c) => c.error)?.error

  /** The owner's writes carry no person, as before collaborators; a collaborator's name theirs. */
  const person = (l: Line) => (l.who ? { collaboratorId: l.who } : {})

  function commit(l: Line, cell: (typeof grid)[number][number]) {
    const e = l.e
    // No edit: nothing typed, or already sent. "invalid" keeps its draft on screen, marked, and writes nothing.
    if (!cell.edit || cell.edit.kind === "invalid") return
    if (cell.edit.kind === "same") return drop(cell.key)
    // Hours accepted past the month's plan: a note about this edit, the contract's, never a refusal (as log_time's reply).
    // It stays until the next edit; hours already stored over the plan raise none.
    setPlanNote(
      cell.edit.kind === "set" && cell.edit.warning ? `${contractOf(e)}, ${dayText(cell.date, "MMMM")}: ${cell.edit.warning}` : null,
    )
    setDrafts((prev) => ({ ...prev, [cell.key]: { text: cell.draft ?? "", from: cell.stored } }))
    // A failed save shows the stored hours again; the app-wide toast says why.
    // mutateAsync, not mutate's callbacks: those fire for the latest call only.
    const save =
      cell.edit.kind === "set"
        ? setTimecard.mutateAsync({ engagementId: e.id, date: cell.date, hours: cell.edit.hours, ...person(l) })
        : deleteTimecard.mutateAsync({ engagementId: e.id, date: cell.date, ...person(l) })
    save.catch(() => drop(cell.key))
  }

  /** null once saved, or why it was not; a failed write rejects, and the app-wide toast says why. */
  async function saveNote(l: Line, cell: (typeof grid)[number][number], text: string) {
    const e = l.e
    const edit = noteEdit(text, cell)
    if (edit.kind === "invalid") return edit.message
    // The same hours, so only the note moves: setTimecard is an upsert on (contract, day).
    if (edit.kind === "set") {
      setNoteSaving((prev) => new Set(prev).add(cell.key))
      try {
        await setTimecard.mutateAsync({ engagementId: e.id, date: cell.date, hours: cell.stored, notes: edit.notes, ...person(l) })
      } finally {
        setNoteSaving((prev) => {
          const next = new Set(prev)
          next.delete(cell.key)
          return next
        })
      }
    }
    return null
  }

  // Each row keeps its flat index r, the cells' address: a folded client's rows are
  // not rendered, so Enter and the arrows walk past them.
  /** The row's hours on days after today: scheduled, not worked yet. */
  const aheadHours = (r: number) => grid[r].reduce((sum, c) => sum + (c.scheduled ? c.stored : 0), 0)
  const groups = groupByClient(lines.map((_, r) => r), (r) => lines[r].e.clientId)
  const clientIds = groups.map(([id]) => id)
  const allCollapsed = clientIds.every((id) => collapsed.has(id))

  function fold(ids: string[], shut: boolean) {
    // A value typed into a cell is saved before its row goes.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    const next = new Set(collapsed)
    for (const id of ids) {
      if (shut) next.add(id)
      else next.delete(id)
    }
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
    } catch {
      // Blocked storage: the fold lasts until the page is left.
    }
  }

  // Enter and the arrows walk a day's column; Tab walks the week natively; Alt+Enter opens the day's note.
  function onKeyDown(ev: KeyboardEvent<HTMLInputElement>, row: number, day: number, cell: { key: string; saving: boolean }) {
    // The note's button is out of the Tab order, so Tab goes day to day whatever the cells hold.
    if (ev.key === "Enter" && ev.altKey) {
      ev.preventDefault()
      return document.getElementById(noteId(row, day))?.click()
    }
    // Esc drops what was typed; a draft already sent stays until its save settles.
    if (ev.key === "Escape") {
      if (!cell.saving) drop(cell.key)
      return
    }
    const step =
      ev.key === "ArrowDown" || (ev.key === "Enter" && !ev.shiftKey)
        ? 1
        : ev.key === "ArrowUp" || ev.key === "Enter"
          ? -1
          : 0
    if (step === 0) return
    ev.preventDefault()
    for (let r = row + step; r >= 0 && r < lines.length; r += step) {
      const next = document.getElementById(cellId(r, day)) as HTMLInputElement | null
      if (next && !next.disabled) return next.focus()
    }
    // The last row: Enter still saves.
    if (ev.key === "Enter") ev.currentTarget.blur()
  }

  return (
    <div className="space-y-3">
      <div className={cn("flex flex-wrap items-center justify-end gap-2", groups.length < 2 && "lg:hidden")}>
        <div role="group" aria-label="Day" className="grid basis-full grid-cols-7 gap-1 lg:hidden">
          {days.map((date, d) => (
            <button
              key={date}
              type="button"
              aria-pressed={d === shown}
              onClick={() => setShown(d)}
              className={cn(
                "min-w-0 rounded-md border py-1 text-center text-xs",
                d === shown ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              <span className="block font-medium">{dayText(date, "EEE")}</span>
              <span className="block">{dayText(date, "d")}</span>
              <span className="block h-4 text-[10px] tabular-nums">{dayTotals[d] > 0 && `${num(dayTotals[d])} h`}</span>
            </button>
          ))}
        </div>
        {groups.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => fold(clientIds, !allCollapsed)}>
            {allCollapsed ? "Expand All" : "Collapse All"}
          </Button>
        )}
      </div>

      <DataTableCard>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Hours from {dayText(days[0], "d MMM")} to {dayText(days[6], "d MMM yyyy")}
          </caption>
          <thead>
            <tr className="border-b border-hairline">
              <th scope="col" className="px-3 py-2.5 text-left text-[12.5px] font-medium text-muted-foreground">
                Contract
              </th>
              {days.map((date, d) => (
                <th
                  key={date}
                  scope="col"
                  aria-current={date === today ? "date" : undefined}
                  className={cn(
                    "px-1 py-2 text-center font-medium",
                    date === today && "bg-primary/5",
                    d !== shown && onlyWide,
                  )}
                >
                  {dayText(date, "EEE")}
                  {date === today && (
                    <span className="ml-1 inline-block rounded-full bg-foreground px-[7px] py-px align-[1px] text-[11px] font-semibold text-background">
                      Today
                    </span>
                  )}
                  <span className="block text-xs font-normal text-muted-foreground">{dayText(date, "d MMM")}</span>
                </th>
              ))}
              <th scope="col" className={`${TOTAL_COL} px-3 py-2 text-right font-medium`}>
                Total
              </th>
            </tr>
          </thead>
          {groups.map(([clientId, group]) => {
            const client = clientName.get(clientId) ?? "—"
            const open = !collapsed.has(clientId)
            const hours = days.map((_, d) => group.reduce((sum, r) => sum + grid[r][d].stored, 0))
            const ahead = group.reduce((sum, r) => sum + aheadHours(r), 0)
            // A contract with a collaborator on it has a row per person: count the contract once.
            const contractCount = new Set(group.map((r) => lines[r].e.id)).size
            return (
              <tbody key={clientId}>
                {/* Always drawn: a folded client still shows its day and week totals. */}
                <tr className="border-b border-hairline bg-muted/30">
                  <th scope="rowgroup" className="px-1 py-0.5 text-left font-normal">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => fold([clientId], open)}
                      className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left pointer-coarse:min-h-11 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")}
                      />
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{client}</span>
                        <span className="text-xs text-muted-foreground">
                          {contractCount === 1 ? "1 contract" : `${contractCount} contracts`}
                        </span>
                      </span>
                    </button>
                  </th>
                  {hours.map((h, d) => (
                    <td
                      key={days[d]}
                      className={cn(
                        "px-1 py-2 text-center text-xs tabular-nums text-muted-foreground",
                        days[d] === today && "bg-primary/5",
                        d !== shown && onlyWide,
                      )}
                    >
                      {h > 0 && `${num(h)} h`}
                    </td>
                  ))}
                  <td className={`${TOTAL_COL} whitespace-nowrap px-3 py-2 text-right tabular-nums`}>
                    {hoursTotal(hours.reduce((sum, h) => sum + h, 0) - ahead, ahead)}
                  </td>
                </tr>
                {open &&
                  group.map((r) => {
                    const l = lines[r]
                    const e = l.e
                    const multi = l.count > 1
                    return (
                      <Fragment key={`${e.id}:${l.who ?? ""}`}>
                        {/* A contract with several people: its own row first, with the days' totals and the budget lines. */}
                        {multi && l.first && (
                          <tr className="border-b border-hairline">
                            <th scope="row" aria-label={`${contractOf(e)}${e.isActive ? "" : " · closed"}`} aria-describedby={`remaining-${e.id}`} className="py-2 pr-3 text-left font-normal">
                              <span className="block pl-6">
                                <span className="sr-only">{client} · </span>
                                {engagementLabel(e)}
                                {!e.isActive && " · closed"}
                              </span>
                              <span className="block pl-6">
                                <ContractRemainingLines
                                  id={`remaining-${e.id}`}
                                  unit={e.unit}
                                  engagement={e}
                                  timecards={timecards}
                                  cells={[...cells.values()].filter((c) => c.sourceId === e.id)}
                                  allocations={allocations}
                                  today={today}
                                  drafts={{ hours: typedHours(e) }}
                                />
                              </span>
                            </th>
                            {days.map((date, d) => {
                              const h = lines.reduce((sum, x, i) => (x.e.id === e.id ? sum + grid[i][d].stored : sum), 0)
                              return (
                                <td key={date} className={cn("px-1 py-1 text-center text-xs tabular-nums text-muted-foreground", date === today && "bg-primary/5", d !== shown && onlyWide)}>
                                  {h > 0 && `${num(h)} h`}
                                </td>
                              )
                            })}
                            <td className={`${TOTAL_COL} whitespace-nowrap px-3 py-1 text-right tabular-nums`}>
                              {hoursTotal(
                                lines.reduce((sum, x, i) => (x.e.id === e.id ? sum + grid[i].reduce((s, c) => s + c.stored, 0) - aheadHours(i) : sum), 0),
                                lines.reduce((sum, x, i) => (x.e.id === e.id ? sum + aheadHours(i) : sum), 0),
                              )}
                            </td>
                          </tr>
                        )}
                        <tr className="border-b border-hairline last:border-0">
                          {multi ? (
                            <th scope="row" aria-label={labelOf(l)} className="py-1.5 pr-3 text-left font-normal">
                              <span className="flex items-center gap-2 pl-10">
                                <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                                  {l.name!.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                                </span>
                                <span className="min-w-0">
                                  <span className="block">{l.name}</span>
                                  {l.rate && <span className="block text-xs text-muted-foreground">{l.rate}</span>}
                                </span>
                              </span>
                            </th>
                          ) : (
                            // The client for screen readers: the row reads "Client · Contract".
                            // Named by the contract alone; the budget lines are its description (a label replaces content in some readers).
                            <th scope="row" aria-label={`${contractOf(e)}${e.isActive ? "" : " · closed"}`} aria-describedby={`remaining-${e.id}`} className="py-2 pr-3 text-left font-normal">
                              {/* The indent is on a span: the card's first-cell padding outranks the th's own. */}
                              <span className="block pl-6">
                                <span className="sr-only">{client} · </span>
                                {engagementLabel(e)}
                                {!e.isActive && " · closed"}
                              </span>
                              <span className="block pl-6">
                                <ContractRemainingLines
                                  id={`remaining-${e.id}`}
                                  unit={e.unit}
                                  engagement={e}
                                  timecards={timecards}
                                  cells={[...cells.values()].filter((c) => c.sourceId === e.id)}
                                  allocations={allocations}
                                  today={today}
                                  drafts={{ hours: typedHours(e) }}
                                />
                              </span>
                            </th>
                          )}
                          {grid[r].map((cell, d) => (
                            <td
                              key={cell.date}
                              className={cn("px-1 py-1 text-center", cell.date === today && "bg-primary/5", d !== shown && onlyWide)}
                            >
                              <CellNote
                                id={noteId(r, d)}
                                label={`Note for ${labelOf(l)}, ${dayText(cell.date, "EEEE d MMM")}`}
                                note={cell.note}
                                stored={cell.stored}
                                saving={cell.saving}
                                refused={cell.refusal && refusalMessage[cell.refusal]}
                                onSave={(text) => saveNote(l, cell, text)}
                              >
                                <Input
                                  id={cellId(r, d)}
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  aria-label={`${labelOf(l)}, ${dayText(cell.date, "EEEE d MMM")}${cell.scheduled ? ", scheduled" : ""}${cell.note ? `. Note: ${cell.note}` : ""}`}
                                  aria-invalid={cell.error ? true : undefined}
                                  aria-describedby={cell.error ? "hours-error" : undefined}
                                  title={cell.note ?? undefined}
                                  disabled={cell.locked}
                                  readOnly={cell.busy}
                                  aria-busy={cell.busy || undefined}
                                  aria-keyshortcuts="Alt+Enter"
                                  value={cell.draft ?? (cell.stored ? String(cell.stored) : "")}
                                  onFocus={(ev) => ev.currentTarget.select()}
                                  onChange={(ev) => setDrafts((prev) => ({ ...prev, [cell.key]: { text: ev.target.value } }))}
                                  onBlur={() => commit(l, cell)}
                                  onKeyDown={(ev) => onKeyDown(ev, r, d, cell)}
                                  className={cn(
                                    "h-11 w-16 bg-background px-1 text-center tabular-nums lg:h-8 lg:w-14",
                                    cell.scheduled && "border-dashed",
                                    cell.busy && "text-muted-foreground",
                                    cell.error && "border-destructive focus-visible:ring-destructive",
                                  )}
                                />
                              </CellNote>
                            </td>
                          ))}
                          <td className={`${TOTAL_COL} whitespace-nowrap px-3 py-1 text-right tabular-nums`}>
                            {hoursTotal(grid[r].reduce((sum, c) => sum + c.stored, 0) - aheadHours(r), aheadHours(r))}
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
              </tbody>
            )
          })}
          <tfoot>
            <tr className="border-t border-hairline bg-muted/30 font-medium">
              <th scope="row" className="px-3 py-2 text-left">
                Total
              </th>
              {dayTotals.map((hours, d) => (
                <td
                  key={days[d]}
                  className={cn(
                    "px-1 py-2 text-center tabular-nums",
                    // Only a race between two saves gets here: each cell refuses to pass 24.
                    hours > 24 && "text-amber-600 dark:text-amber-400",
                    d !== shown && onlyWide,
                  )}
                >
                  {hours > 0 && `${num(hours)} h`}
                </td>
              ))}
              <td aria-live="polite" className={`${TOTAL_COL} whitespace-nowrap px-3 py-2 text-right tabular-nums`}>
                {weekTotal(result, weekUnit(rows))}
              </td>
            </tr>
          </tfoot>
        </table>
        </div>
      </DataTableCard>

      {error && (
        <p id="hours-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && planNote && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          {planNote}
        </p>
      )}
      <details className="group text-[13.5px] leading-normal">
        <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-md text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
          Keyboard Tips
          <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <p className="pt-1.5 pb-2 text-muted-foreground">
          Type hours as 7.5 or 7,5. Enter saves and moves down, Esc undoes, 0 or empty clears. Alt+Enter adds,
          reads or edits a note.
        </p>
      </details>
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1.5 text-[12.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden className="h-3 w-4 rounded-[3px] border-[1.5px] border-dashed border-muted-foreground/60 bg-background" />
          Scheduled, not worked yet
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <span aria-hidden className="size-1.5 rounded-full bg-foreground" />
          Has a note
        </span>
      </div>
    </div>
  )
}

/**
 * A cell (`children`, its hours input) with its note: a dot when there is one,
 * else a button shown on hover or focus (always, below lg, where there is no
 * hover). It opens a popover under the cell, a dialog on a phone. A note rides on
 * the day's hours, so a day without any takes none; on a day that takes no new
 * hours, a note is only read or cleared.
 */
function CellNote({
  children,
  id: buttonId,
  label,
  note,
  stored,
  saving,
  refused,
  onSave,
}: {
  children: ReactNode
  id: string
  label: string
  note: string | null
  stored: number
  /** The day's hours are being saved: a note saved now would write the hours from before. */
  saving: boolean
  /** Why the day takes no new hours, so no new note either; null when it does. */
  refused: string | null
  onSave: (text: string) => Promise<string | null>
}) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(false)
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Why the button is off: nothing to ride on, or a refused day with no note to clear.
  const blocked = note ? null : (refused ?? (stored === 0 ? "Log hours first" : null))

  function toggle(next: boolean) {
    // A save in flight keeps the note open; WeekGrid holds the cell read-only meanwhile.
    if (pending) return
    if (next) {
      setText(note ?? "")
      setError(null)
    }
    setOpen(next)
  }

  async function save(ev: FormEvent) {
    ev.preventDefault()
    setPending(true)
    try {
      // A refused day's note is only cleared.
      const message = await onSave(refused ? "" : text)
      setError(message)
      if (!message) setOpen(false)
    } catch {
      // The app-wide toast says why; the text stays, to try again.
    } finally {
      setPending(false)
    }
  }

  const form = (
    <form onSubmit={save} className="space-y-2">
      <Label htmlFor={id}>Note</Label>
      {refused && (
        <p id={`${id}-refused`} className="text-sm text-muted-foreground">
          {refused} The note can be read or cleared.
        </p>
      )}
      <Textarea
        id={id}
        rows={4}
        maxLength={NOTE_MAX}
        readOnly={refused !== null}
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : refused ? `${id}-refused` : undefined}
      />
      {text.length > NOTE_MAX - 100 && (
        <p className="text-right text-xs tabular-nums text-muted-foreground">
          {text.length} / {NOTE_MAX}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => toggle(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || saving}>
          {refused ? "Clear Note" : "Save"}
        </Button>
      </div>
    </form>
  )

  return (
    <>
      <Popover open={open && !phone} onOpenChange={toggle}>
        {/* w-fit: the button sits on the input's corner, not the column's; beside it below lg. */}
        <PopoverAnchor className="group relative mx-auto flex w-fit items-center gap-1 lg:block">
          {children}
          <PopoverTrigger asChild>
            <button
              ref={button}
              id={buttonId}
              type="button"
              // Alt+Enter in the cell opens it: as a Tab stop it would sit between two days only when the first has hours.
              tabIndex={-1}
              aria-label={label}
              title={blocked ?? note ?? undefined}
              disabled={blocked !== null}
              onClick={(ev) => {
                const small = window.matchMedia("(max-width: 639px)").matches
                setPhone(small)
                // On a phone the dialog opens instead: the popover's own toggle is skipped.
                if (small) {
                  ev.preventDefault()
                  toggle(true)
                }
              }}
              className={cn(
                "flex h-11 w-8 shrink-0 items-center justify-center rounded-sm pointer-coarse:w-11 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground/40",
                "lg:absolute lg:-right-1.5 lg:-top-1.5 lg:h-4 lg:w-4",
                !note && !open && "lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100",
              )}
            >
              {note ? (
                <span aria-hidden className="h-2 w-2 rounded-full bg-primary" />
              ) : (
                <MessageSquarePlus aria-hidden className="h-4 w-4 lg:h-3 lg:w-3" />
              )}
            </button>
          </PopoverTrigger>
        </PopoverAnchor>
        <PopoverContent aria-label={label}>
          {form}
        </PopoverContent>
      </Popover>
      <Dialog open={open && phone} onOpenChange={toggle}>
        <DialogContent
          size="sm"
          aria-describedby={undefined}
          onCloseAutoFocus={(ev) => {
            // No DialogTrigger: focus goes back to the note's button by hand.
            ev.preventDefault()
            button.current?.focus()
          }}
        >
          <DialogTitle className="text-base">{label}</DialogTitle>
          {form}
        </DialogContent>
      </Dialog>
    </>
  )
}
