"use client"

import { eur, eurShort } from "@alter-ego/kernel/currency"
import { formatYearMonth, weekdaysInMonth } from "@alter-ego/kernel/dates";
import { ContentCard } from "@alter-ego/ui/page/content-card";
import { DataTableCard } from "@alter-ego/ui/page/data-table-card";
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt";
import { SectionHeader } from "@alter-ego/ui/page/section-header";
import { Input } from "@alter-ego/ui/ui/input";
import { cn } from "@alter-ego/ui/utils";
import { Fragment, useCallback, useMemo, useState, useSyncExternalStore } from "react";


import { ContractRemainingLines } from "@/components/plan/contract-remaining";
import { assignedDays, countedDays, ownerDays } from "@/lib/assignment-plan";
import { loadWord } from "@/lib/capacity";
import { contractAnchors, rateAt } from "@/lib/engagement-burndown";
import { contractDays, contractUnit, formatContractQuantity, inContractUnit, rateIn, rateSteps, unitMark, unitNoun } from "@/lib/engagements";
import { hoursLine, num } from "@/lib/timecards";


import type { CapacityMonth } from "@/lib/capacity"
import type { AllocationCell, RevenueSource } from "@/lib/engagement-burndown"
import type { HoursLine, monthHours } from "@/lib/timecards"
import type { Allocation, Assignment, Timecard } from "@/types"
import type { ReactNode } from "react"

/**
 * One box for everything a month cell shows (the number, the "over" line, the input, a dash), so
 * opening it to type changes no column's width and no row's height. The "over" line sits inside it.
 */
export const CELL_BOX = "h-10 w-18 pointer-coarse:h-11"

/** The Time off cell holds the number and, under it, the reason the connector set: one box open or closed. */
const TIME_OFF_BOX = "h-12 w-18 pointer-coarse:h-12"

/** The Contract column stays while the months scroll: opaque, with an edge shadow where they pass under. */
const STICKY_EDGE = "sticky left-0 z-10 shadow-[1px_0_0_var(--color-border)]"

/** What a cell's billable days bring in, net of VAT: the plan is cash flow, and VAT is not the company's. */
function billed(cell: AllocationCell): number {
  return cell.billableDays * cell.dailyRate
}

/**
 * A contract's days as the Plan shows and takes them: in its own unit (an hourly contract plans
 * hours). What is stored and sent stays days; only this row's numbers, labels and inputs convert.
 */
const unitOf = (source: RevenueSource) => contractUnit(source)
const shown = (days: number, source: RevenueSource) => num(inContractUnit(days, unitOf(source)))

const noun = (source: RevenueSource, n: number) => unitNoun(unitOf(source)).slice(0, n === 1 ? -1 : undefined)

/** One hidden sentence the explicit cells point at: a changed value is told in words, not only in weight. */
const CHANGED = "plan-changed-from-default";
const PHONE = "(max-width: 639px)";

/** Whether the viewport is a phone (below sm): the table gives way to a month strip and contract cards. */
function useIsPhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia?.(PHONE);
      mq?.addEventListener("change", notify);
      return () => mq?.removeEventListener("change", notify);
    },
    () => window.matchMedia?.(PHONE).matches ?? false,
    () => false,
  );
}

/** One Use: the contract-month's days from its hours. */
export interface UseWrite {
  engagementId: string
  yearMonth: string
  days: number
}

interface Props {
  /** Each contract with its "Client · contract" label and last day (contractEndDate), in the order shown. */
  rows: { source: RevenueSource; label: string; end: string | null }[]
  /** planCells: a missing cell is a month the plan does not count. */
  cells: Map<string, AllocationCell>
  allocations: Allocation[]
  hours: ReturnType<typeof monthHours>
  /** All the hours: each contract row shows what is left of its budget from them. */
  timecards: Pick<Timecard, "engagementId" | "date" | "hours">[]
  months: string[]
  /** "YYYY-MM-DD": its month is the open one. */
  today: string
  /** A plan write is in flight: Use waits for it, so its Undo knows what was there. */
  pending: boolean
  /** null removes the month's row, so the contract default applies again (see clearTo). */
  onSet: (engagementId: string, yearMonth: string, days: number | null) => void
  onUse: (writes: UseWrite[], title: string) => void
  /** Under the heading, above the table: the cliff card. */
  intro?: ReactNode
  /** The collaborators on contracts: each gets a sub-row "of which <name>" under its contract, and the owner's row is what is left. */
  assignments?: { assignment: Assignment; name: string }[]
  /** One month of a collaborator's days; null takes the override away so the default counts again. */
  onSetAssignment?: (assignmentId: string, yearMonth: string, days: number | null) => void
  /** Your time: each month's time off, available days and what you plan (capacityForMonths). Without it the block is left out. */
  capacity?: CapacityMonth[]
  /** A month's days off; 0 clears them. */
  onSetTimeOff?: (yearMonth: string, daysOff: number) => void
}

/**
 * A collaborator's days in one contract month, editable like the contract's cell: a number, a click
 * opens it, Enter or leaving saves, empty goes back to the assignment's default.
 */
function AssignmentCell({
  label,
  source,
  assignment,
  siblings,
  cell,
  yearMonth,
  onSet,
}: {
  label: string
  source: RevenueSource
  assignment: Assignment
  /** Everyone planned on the contract, this one included: they share what it bills. */
  siblings: readonly Assignment[]
  /** The contract's cell for the month; none, or one that plans 0, means the contract does no days. */
  cell: AllocationCell | undefined
  yearMonth: string
  onSet: (days: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const inRun = yearMonth >= assignment.from && (!assignment.until || yearMonth <= assignment.until)
  const overridden = yearMonth in assignment.monthDays
  const days = assignedDays(assignment, yearMonth)
  const counted = cell ? (countedDays(siblings, yearMonth, cell.billableDays).get(assignment.id) ?? 0) : 0
  const over = Math.round((days - counted) * 100) / 100
  if (!inRun || !cell || cell.plannedDays === 0) {
    return (
      <span className={cn(CELL_BOX, "inline-block leading-10 text-muted-foreground pointer-coarse:leading-[2.75rem]")}>
        —<span className="sr-only">{inRun ? "The contract plans no days" : "Not assigned"}</span>
      </span>
    )
  }
  const commitDraft = () => {
    const text = (draft ?? "").trim()
    setDraft(null)
    if (text === "") {
      if (overridden) onSet(null)
      return
    }
    const next = Math.min(31, Number(text) / inContractUnit(1, unitOf(source)))
    if (Number.isFinite(next) && next >= 0 && next !== days) onSet(next)
  }
  if (draft !== null) {
    return (
      <Input
        autoFocus
        aria-label={`${label}, ${formatYearMonth(yearMonth)}, ${unitNoun(unitOf(source))}`}
        type="number"
        min="0"
        step="0.5"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitDraft()
          if (e.key === "Escape") setDraft(null)
        }}
        className={cn(CELL_BOX, "px-1 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none")}
      />
    )
  }
  return (
    <button
      type="button"
      aria-label={`${label}, ${formatYearMonth(yearMonth)}: ${formatContractQuantity(source, counted)} planned${over > 0.005 ? `, ${formatContractQuantity(source, over)} over the plan` : ""}`}
      onClick={() => setDraft(overridden ? String(shown(days, source)) : "")}
      className={cn(CELL_BOX, "inline-flex flex-col items-center justify-center rounded-md px-1 hover:bg-accent", overridden ? "font-semibold" : "text-muted-foreground")}
    >
      {shown(counted, source)}
      {over > 0.005 && (
        <span className="text-[11px] leading-none font-normal text-foreground">
          {" "}{shown(over, source)} over<span className="sr-only"> the plan</span>
        </span>
      )}
    </button>
  )
}

/**
 * Contracts × months, one editable number per cell and, under it, the month's
 * hours in days against it. An empty cell means "use the contract's default"; a
 * typed number, zero included, is an explicit decision for that month, which is
 * why clearing the input removes the row instead of storing a 0 (but see clearTo).
 * Hours never move the plan by themselves: Use writes them as the month's days
 * (hoursAction says when it is offered).
 */
export function PlanGrid({
  rows,
  cells,
  allocations,
  hours,
  timecards,
  months,
  today,
  pending,
  onSet,
  onUse,
  intro,
  assignments = [],
  onSetAssignment,
  capacity,
  onSetTimeOff,
}: Props) {
  const currentMonth = today.slice(0, 7);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const phone = useIsPhone();
  const [picked, setPicked] = useState<string | null>(null);
  // The phone's input is uncontrolled: what is typed in it, until its blur saves it.
  const [typing, setTyping] = useState<{ key: string; text: string } | null>(null);
  // The Time off cell open on the desktop table: the month being typed, and what is typed.
  const [offEditing, setOffEditing] = useState<string | null>(null);
  const [offDraft, setOffDraft] = useState("");
  /** The last time-off entry that was not a number: the phone field resets and says so. */
  const [offBad, setOffBad] = useState<{ month: string; n: number } | null>(null);

  // When the current month opens out of view (a phone: the older months filled the screen),
  // scroll so the month just closed comes first: its hours are the ones Use puts in the plan.
  // In view (desktop) nothing moves. A callback ref, so it runs once the table is there.
  const scrollToCurrent = useCallback(
    (el: HTMLDivElement | null) => {
      const th = el?.querySelector<HTMLElement>(`th[data-month="${currentMonth}"]`)
      const sticky = el?.querySelector<HTMLElement>("th")
      if (!el || !th || !sticky || th.offsetLeft + th.offsetWidth <= el.clientWidth) return
      el.scrollLeft = (th.previousElementSibling as HTMLElement).offsetLeft - sticky.offsetWidth
    },
    [currentMonth],
  )

  const allocationByKey = useMemo(
    () => new Map(allocations.map((a) => [`${a.engagementId}:${a.yearMonth}`, a])),
    [allocations],
  )

  /**
   * Whether a closed month's row is what starts a contract with no start month in the
   * plan (contractAnchors). Deleting it would drop that month, and every one up to the
   * next row, out of the plan instead of back to the default.
   */
  const anchors = (source: RevenueSource, yearMonth: string) =>
    !source.startMonth && yearMonth < currentMonth && contractAnchors([source], allocations).get(source.id) === yearMonth

  /** What clearing a stored month writes: null, or the default as a number on an anchor row. */
  function clearTo(source: RevenueSource, yearMonth: string): number | null {
    if (!anchors(source, yearMonth)) return null
    return source.endMonth && yearMonth > source.endMonth ? 0 : source.daysPerMonth
  }

  function commit(source: RevenueSource, yearMonth: string, text = draft) {
    const engagementId = source.id;
    const existing = allocationByKey.get(`${engagementId}:${yearMonth}`);
    const trimmed = text.trim();

    if (trimmed === "") {
      const days = clearTo(source, yearMonth)
      if (existing && days !== existing.days) onSet(engagementId, yearMonth, days)
    } else {
      // Clamp to the same ceiling the Firestore rules enforce. Typing past the
      // input's max used to be accepted by the mock and rejected by Firestore, and
      // the only symptom was a cell that refused to change. Typed in the contract's unit.
      const days = Math.min(31, Number(trimmed) / inContractUnit(1, unitOf(source)))
      if (Number.isFinite(days) && days >= 0 && days !== existing?.days) {
        onSet(engagementId, yearMonth, days)
      }
    }
    setEditing(null)
    setDraft("")
    setTyping(null)
  }

  /** The line under a contract's name: what is left, and not planned, counting the month being typed. */
  const remaining = (source: RevenueSource) => {
    const typed = editing?.startsWith(`${source.id}:`) ? { key: editing, text: draft } : typing?.key.startsWith(`${source.id}:`) ? typing : null
    const ym = typed?.key.slice(source.id.length + 1)
    const text = typed?.text.trim()
    const parsed = text === undefined || text === "" ? null : Math.min(31, Number(text) / inContractUnit(1, unitOf(source)))
    // Empty text: an anchor row stores the default (typed); any other month goes back to it (not typed).
    const back = text === "" ? (clearTo(source, ym!) === null ? "default" : "typed") : null
    const days = parsed ?? (back ? (clearTo(source, ym!) ?? (source.endMonth && ym! > source.endMonth ? 0 : source.daysPerMonth)) : null)
    const preview = ym && days !== null && Number.isFinite(days) && days >= 0 ? (back === "default" ? { defaults: { [ym]: days } } : { months: { [ym]: days } }) : undefined
    return (
      <ContractRemainingLines
        unit={source.unit}
        engagement={{ id: source.id, contractedDays: source.budgetDays, amendments: source.amendments }}
        timecards={timecards}
        cells={[...cells.values()].filter((c) => c.sourceId === source.id)}
        allocations={allocations}
        today={today}
        drafts={preview}
      />
    )
  }

  const capacityOf = useMemo(() => new Map((capacity ?? []).map((c) => [c.yearMonth, c])), [capacity])

  const line = (engagementId: string, end: string | null, yearMonth: string) =>
    hoursLine({ engagementId, end, yearMonth, today, cells, hours, daysOff: capacityOf.get(yearMonth)?.daysOff ?? 0 })

  /** Typed days off for a month: empty is none, and no more than the month has weekdays (the connector's cap). */
  function commitTimeOff(yearMonth: string, text: string) {
    const cap = capacityOf.get(yearMonth)
    // A comma keypad types "2,5".
    const typed = text.trim() === "" ? 0 : Number(text.trim().replace(",", "."))
    if (!Number.isFinite(typed) || typed < 0) {
      // Not a number of days: keep what is stored, bump the field back to it and say why.
      setOffBad((b) => ({ month: yearMonth, n: (b?.n ?? 0) + 1 }))
      setOffEditing(null)
      setOffDraft("")
      return
    }
    setOffBad(null)
    if (cap) {
      const daysOff = Math.min(weekdaysInMonth(yearMonth), typed)
      if (daysOff !== cap.daysOff) onSetTimeOff?.(yearMonth, daysOff)
    }
    setOffEditing(null)
    setOffDraft("")
  }

  /** A closed month's Use writes, and the open month's once its hours cover enough of the days left; one per contract. */
  const usesFor = (ym: string) =>
    ym <= currentMonth
      ? rows.flatMap(({ source, end }) => {
          const l = line(source.id, end, ym);
          return l?.action === "use"
            ? [{ engagementId: source.id, yearMonth: ym, days: l.h.days }]
            : [];
        })
      : [];
  const applyAll = (ym: string, uses: UseWrite[]) =>
    onUse(
      uses,
      `Hours used on ${uses.length} contract${uses.length === 1 ? "" : "s"}, ${formatYearMonth(ym)}`,
    );
  /** After the contract's last month, with nothing planned: not a deliberate 0. */
  const endedAt = (source: RevenueSource, end: string | null, ym: string) =>
    (!!source.endMonth && ym > source.endMonth) ||
    (!!end && ym > end.slice(0, 7));

  const heading = (
    <SectionHeader
      id="plan-months"
      title="Days by Month"
      description="The days you plan to bill, per contract; an empty cell uses the contract default. Revenue and the projection use them."
    />
  )

  if (rows.length === 0) {
    return (
      <section className="space-y-4 [&_h2]:scroll-mt-20">
        {heading}
        {intro}
        <EmptyPrompt title="No active contracts" description="Add one to a client to plan its days." />
      </section>
    )
  }

  /** Today's terms: the rate in force now, the next one an amendment sets, the whole budget, the last month. */
  const terms = (source: RevenueSource) => {
    const budget = contractDays({
      contractedDays: source.budgetDays,
      amendments: source.amendments,
    });
    const nextRate = rateSteps(source.amendments).find(
      (r) => r.from > currentMonth,
    );
    return [
      rateIn(rateAt(source, currentMonth), unitOf(source)),
      nextRate &&
        `${unitOf(source) === "hour" ? rateIn(nextRate.dailyRate, "hour") : eurShort(nextRate.dailyRate)} from ${formatYearMonth(nextRate.from, "MMM yyyy")}`,
      budget !== null && `${inContractUnit(budget, unitOf(source))} ${unitNoun(unitOf(source))}`,
      source.endMonth &&
        `until ${formatYearMonth(source.endMonth, "MMM yyyy")}`,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const herOn = (source: RevenueSource) => assignments.filter((x) => x.assignment.engagementId === source.id)
  const herLabel = (x: { assignment: Assignment; name: string }, source: RevenueSource) =>
    `of which ${x.name} · ${rateIn(x.assignment.dailyRate, unitOf(source))}`
  const current = (ym: string) =>
    ym === currentMonth && "border-l bg-surface-subtle";
  const monthTotals = months.map((ym) => {
    const cellsOf = rows.flatMap(({ source }) => cells.get(`${source.id}:${ym}`) ?? [])
    return { billed: cellsOf.reduce((sum, c) => sum + billed(c), 0), days: cellsOf.reduce((sum, c) => sum + c.billableDays, 0) }
  })
  const head = "px-1 py-2.5 text-center text-[12.5px] font-medium text-muted-foreground"

  if (phone) {
    const open =
      picked && months.includes(picked)
        ? picked
        : months.includes(currentMonth)
          ? currentMonth
          : months[0];
    const uses = usesFor(open);
    return (
      <section className="space-y-4 [&_h2]:scroll-mt-20">
        {heading}
        <span id={CHANGED} hidden>
          changed from the default
        </span>
        {intro}
        {/* w-0 + min-w: the strip scrolls inside the column instead of widening it. */}
        <div
          role="tablist"
          aria-label="Month"
          className="-mx-4 flex w-0 min-w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 py-0.5"
        >
          {months.map((ym, i) => {
            const overBudget = rows.some(
              ({ source }) => cells.get(`${source.id}:${ym}`)?.capped,
            );
            const overBooked = !!capacityOf.get(ym)?.overbooked;
            return (
              <button
                key={ym}
                type="button"
                role="tab"
                aria-selected={ym === open}
                onClick={() => setPicked(ym)}
                className={cn(
                  "relative flex min-h-14 w-16 flex-none flex-col items-center justify-center rounded-xl border px-1 text-xs tabular-nums",
                  ym === open
                    ? "border-foreground bg-foreground text-background"
                    : "bg-card",
                )}
              >
                <span className="flex items-center gap-1 text-[13px] font-medium">
                  {formatYearMonth(ym, "MMM")}
                  {(overBudget || overBooked) && (
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full bg-danger"
                    />
                  )}
                </span>
                <span
                  className={
                    ym === open ? "opacity-80" : "text-muted-foreground"
                  }
                >
                  {eurShort(monthTotals[i].billed)}
                </span>
                {overBudget && <span className="sr-only">, over budget</span>}
                {overBooked && <span className="sr-only">, more days planned than available</span>}
              </button>
            );
          })}
        </div>
        <ContentCard
          role="tabpanel"
          aria-label={formatYearMonth(open)}
          className="space-y-1 divide-y divide-hairline"
        >
          {/* The height it has with Use All (the 44 px button, the padding under it, a hairline: measured): it keeps it when the button goes. */}
          <div className="flex min-h-[53px] items-center justify-between gap-2 pb-2">
            <h3 className="text-[15px] font-semibold">
              {formatYearMonth(open)}
            </h3>
            <div className="flex items-center gap-2">
              {open === currentMonth && (
                <span className="text-xs text-muted-foreground">
                  This month
                </span>
              )}
              {uses.length > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => applyAll(open, uses)}
                  className="min-h-11 rounded-md border px-2 text-xs hover:bg-accent disabled:opacity-50"
                >
                  Use All ({uses.length})
                </button>
              )}
            </div>
          </div>
          {rows.flatMap(({ source, label, end }) => {
            const cell = cells.get(`${source.id}:${open}`);
            if (!cell) return [];
            const explicit = allocationByKey.get(`${source.id}:${open}`);
            const month = formatYearMonth(open);
            const l = line(source.id, end, open);
            const over = cell.capped ? cell.plannedDays - cell.billableDays : 0;
            const ended =
              !explicit && cell.plannedDays === 0 && endedAt(source, end, open);
            return [
              <div key={source.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">
                    {terms(source)}
                  </div>
                  {remaining(source)}
                  {/* Its line is kept even when empty: saving a value past the budget must not grow the row. */}
                  <div className="flex min-h-4 items-center gap-1 text-xs text-danger">
                    {over > 0 && (
                      <>
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-danger"
                        />
                        Budget used up, {shown(over, source)} {noun(source, shown(over, source))}{" "}
                        over
                      </>
                    )}
                  </div>
                </div>
                {ended ? (
                  <span className="text-muted-foreground">
                    —<span className="sr-only">Contract ended</span>
                  </span>
                ) : (
                  <div className="flex w-24 flex-none flex-col items-end gap-1">
                    <Input
                      aria-label={`${label}, ${month}, ${unitNoun(unitOf(source))}`}
                      key={`${source.id}:${open}:${explicit?.days ?? ""}`}
                      type="text"
                      inputMode="decimal"
                      placeholder={String(shown(cell.plannedDays, source))}
                      defaultValue={explicit ? String(shown(explicit.days, source)) : ""}
                      aria-describedby={explicit ? CHANGED : undefined}
                      onChange={(e) => setTyping({ key: `${source.id}:${open}`, text: e.target.value })}
                      onBlur={(e) => commit(source, open, e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && e.currentTarget.blur()
                      }
                      className={cn(
                        "h-11 w-20 text-center",
                        explicit && "font-semibold",
                      )}
                    />
                    {l && (
                      // As tall as the Use button, so Use, ✓, pace and over take turns without moving the row.
                      <div className="flex h-11 w-full items-center justify-end overflow-hidden">
                        <HoursLineView
                          line={l}
                          source={source}
                          pending={pending}
                          name={`${label}, ${month}`}
                          onUse={() =>
                            onUse(
                              [
                                {
                                  engagementId: source.id,
                                  yearMonth: open,
                                  days: l.h.days,
                                },
                              ],
                              `${formatContractQuantity(source, l.h.days)} used: ${label}, ${month}`,
                            )
                          }
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>,
              ...herOn(source).map((x) => (
                <div key={x.assignment.id} className="flex items-center justify-between gap-3 py-2 pl-4 text-sm">
                  <span className="min-w-0 text-subtle-foreground [overflow-wrap:anywhere]">{herLabel(x, source)}</span>
                  <span className="flex w-24 flex-none justify-end">
                    <AssignmentCell
                      label={herLabel(x, source)}
                      source={source}
                      assignment={x.assignment}
                      siblings={herOn(source).map((y) => y.assignment)}
                      cell={cell}
                      yearMonth={open}
                      onSet={(days) => onSetAssignment?.(x.assignment.id, open, days)}
                    />
                  </span>
                </div>
              )),
              ...(herOn(source).length > 0
                ? [
                    <div key={`${source.id}-you`} className="flex items-center justify-between gap-3 py-2 pl-4 text-sm text-muted-foreground">
                      <span>you</span>
                      <span className="w-24 text-center">{shown(ownerDays(herOn(source).map((x) => x.assignment), open, cell.billableDays), source)}</span>
                    </div>,
                  ]
                : []),
            ];
          })}
          {capacityOf.get(open) && (
            <YourTimePhone
              cap={capacityOf.get(open)!}
              month={formatYearMonth(open)}
              onCommit={(text) => commitTimeOff(open, text)}
              invalid={offBad?.month === open ? offBad.n : 0}
            />
          )}
          <div className="flex items-baseline justify-between pt-3 font-medium">
            <span>
              Planned billing{" "}
              <span className="text-xs font-normal text-muted-foreground">
                net of VAT
              </span>
            </span>
            <span className="tabular-nums">
              {eur(monthTotals[months.indexOf(open)].billed)}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {num(monthTotals[months.indexOf(open)].days)} d
              </span>
            </span>
          </div>
        </ContentCard>
      </section>
    );
  }

  return (
    <section className="space-y-4 [&_h2]:scroll-mt-20">
      {heading}
      <span id={CHANGED} hidden>
        changed from the default
      </span>
      {intro}
      <DataTableCard>
        <div ref={scrollToCurrent} className="overflow-x-auto">
          <table aria-labelledby="plan-months" className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b">
                <th scope="col" className={cn(STICKY_EDGE, "bg-card px-2 py-2.5 text-left text-[12.5px] font-medium text-muted-foreground sm:px-3")}>
                  Contract
                </th>
                {months.map((ym) => {
                  const month = formatYearMonth(ym);
                  const uses = usesFor(ym);
                  return (
                    <th key={ym} scope="col" data-month={ym} className={cn("min-w-19", head, current(ym), ym === currentMonth && "text-foreground")}>
                      <abbr title={month} className="no-underline">
                        {formatYearMonth(ym, "MMM ''yy")}
                      </abbr>
                      {ym === currentMonth && <span className="block text-[11px] font-medium text-muted-foreground">This month</span>}
                      {/* The slot is there in every month: Use All goes once the hours match, and the header must not shrink. */}
                      <div className="mt-1 h-5 pointer-coarse:h-11">
                        {uses.length > 0 && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => applyAll(ym, uses)}
                            className="block h-full w-full whitespace-nowrap rounded-md border px-1 text-[11px] font-normal text-foreground hover:bg-accent disabled:opacity-50"
                          >
                            Use All ({uses.length})
                          </button>
                        )}
                      </div>
                    </th>
                  )
                })}
                <th scope="col" className={cn(head, "border-l border-hairline px-3 text-right")}>
                  Total
                  <span className="block text-[11px]">from {formatYearMonth(currentMonth, "MMM")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ source, label, end }) => {
                // Today's terms: the rate in force now, the next one an amendment sets, and the whole budget.
                // Each cell already bills at its month's rate; the next rate says why a month's total moves.
                const ahead = months.flatMap((ym) => {
                  const cell = cells.get(`${source.id}:${ym}`)
                  return cell && ym >= currentMonth ? [cell] : []
                })

                const her = herOn(source)
                return (
                  <Fragment key={source.id}>
                  <tr className={cn("border-hairline last:border-0", her.length === 0 && "border-b")}>
                    <th scope="row" className={cn(STICKY_EDGE, "min-w-32 bg-card px-2 py-2 text-left font-normal sm:min-w-44 sm:px-3")}>
                      <div className="font-medium">{label}</div>
                      <div className="whitespace-nowrap text-xs text-muted-foreground">
                        {terms(source)}
                      </div>
                      {remaining(source)}
                    </th>
                    {months.map((ym) => {
                      const key = `${source.id}:${ym}`;
                      const cell = cells.get(key);
                      const explicit = allocationByKey.get(key);
                      const month = formatYearMonth(ym);
                      const l = line(source.id, end, ym);
                      const over = cell?.capped
                        ? cell.plannedDays - cell.billableDays
                        : 0;
                      const ended =
                        !!cell &&
                        !explicit &&
                        cell.plannedDays === 0 &&
                        endedAt(source, end, ym);

                      return (
                        <td key={ym} className={cn("px-0.5 py-1 text-center", current(ym))}>
                          {!cell ? (
                            <span className={cn(CELL_BOX, "inline-block leading-10 text-muted-foreground pointer-coarse:leading-[2.75rem]")}>
                              –
                            </span>
                          ) : ended ? (
                            <span className={cn(CELL_BOX, "inline-block leading-10 text-muted-foreground pointer-coarse:leading-[2.75rem]")}>
                              —<span className="sr-only">Contract ended</span>
                            </span>
                          ) : editing === key ? (
                            <Input
                              autoFocus
                              type="number"
                              min="0"
                              max={31 * inContractUnit(1, unitOf(source))}
                              step="0.5"
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={() => commit(source, ym)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commit(source, ym)
                                if (e.key === "Escape") {
                                  setEditing(null)
                                  setDraft("")
                                }
                              }}
                              className={cn(CELL_BOX, "px-1 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none")}
                            />
                          ) : (
                            <button
                              type="button"
                              aria-label={`${label}, ${month}: ${formatContractQuantity(source, cell.plannedDays)} planned${cell.capped ? ", over the contract budget" : ""}`}
                              onClick={() => {
                                setEditing(key)
                                setDraft(explicit ? String(shown(explicit.days, source)) : "")
                              }}
                              aria-describedby={explicit ? CHANGED : undefined}
                              title={
                                cell.capped
                                  ? "Budget used up: not all the planned days are billable"
                                  : explicit && anchors(source, ym)
                                    ? "Explicit value — this month starts the contract's plan, so clearing it keeps the default as a number"
                                    : explicit
                                      ? "Explicit value — clear it to go back to the default"
                                      : "Contract default"
                              }
                              className={cn(
                                CELL_BOX,
                                "inline-flex flex-col items-center justify-center rounded-md px-1 hover:bg-accent",
                                explicit
                                  ? "font-semibold"
                                  : "text-muted-foreground",
                              )}
                            >
                              <span>{shown(cell.plannedDays, source)}</span>
                              {over > 0 && (
                                <span className="flex items-center gap-1 text-[11px] leading-none text-danger">
                                  <span aria-hidden className="size-1.5 rounded-full bg-danger" />
                                  {shown(over, source)} over
                                </span>
                              )}
                            </button>
                          )}
                          {l && (
                            // One slot for every line it can become (Use, ✓, pace, over): saving a value
                            // turns one into another, and none of them may change the row or the column.
                            <div className="mx-auto flex h-8 w-18 items-center justify-center overflow-hidden pointer-coarse:h-11">
                              <HoursLineView
                                line={l}
                                source={source}
                                pending={pending}
                                name={`${label}, ${month}`}
                                onUse={() =>
                                  onUse(
                                    [{ engagementId: source.id, yearMonth: ym, days: l.h.days }],
                                    `${formatContractQuantity(source, l.h.days)} used: ${label}, ${month}`,
                                  )
                                }
                              />
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td className="min-w-28 whitespace-nowrap border-l border-hairline px-3 py-2 text-right">
                      <span className="block font-medium">{eur(ahead.reduce((sum, c) => sum + billed(c), 0))}</span>
                      <span className="block text-xs text-muted-foreground">{formatContractQuantity(source, ahead.reduce((sum, c) => sum + c.billableDays, 0))}</span>
                    </td>
                  </tr>
                  {her.map((x) => (
                    <tr key={x.assignment.id} className="text-xs">
                      <th scope="row" className={cn(STICKY_EDGE, "bg-card py-1 pl-5 pr-2 text-left font-normal text-subtle-foreground sm:pr-3")}>
                        {herLabel(x, source)}
                      </th>
                      {months.map((ym) => (
                        <td key={ym} className={cn("px-0.5 py-0.5 text-center", current(ym))}>
                          <AssignmentCell
                            label={herLabel(x, source)}
                            source={source}
                            assignment={x.assignment}
                            siblings={her.map((y) => y.assignment)}
                            cell={cells.get(`${source.id}:${ym}`)}
                            yearMonth={ym}
                            onSet={(days) => onSetAssignment?.(x.assignment.id, ym, days)}
                          />
                        </td>
                      ))}
                      <td className="border-l border-hairline" />
                    </tr>
                  ))}
                  {her.length > 0 && (
                    <tr className="border-b border-hairline text-xs">
                      <th scope="row" className={cn(STICKY_EDGE, "bg-card py-1 pl-5 pr-2 text-left font-normal text-subtle-foreground sm:pr-3")}>
                        you
                        <span className="sr-only"> (the contract’s days less theirs)</span>
                      </th>
                      {months.map((ym) => {
                        const cell = cells.get(`${source.id}:${ym}`)
                        return (
                          <td key={ym} className={cn("px-0.5 py-1 text-center text-muted-foreground", current(ym))}>
                            {cell ? shown(ownerDays(her.map((x) => x.assignment), ym, cell.billableDays), source) : "–"}
                          </td>
                        )
                      })}
                      <td className="border-l border-hairline" />
                    </tr>
                  )}
                  </Fragment>
                )
              })}
              {capacity && capacity.length > 0 && (
                <>
                  <tr className="border-y border-hairline bg-surface-subtle">
                    <th scope="row" colSpan={months.length + 2} className={cn(STICKY_EDGE, "px-2 py-1.5 text-left text-xs font-medium text-muted-foreground sm:px-3")}>
                      Your time
                    </th>
                  </tr>
                  <tr className="border-b border-hairline">
                    <th scope="row" className={cn(STICKY_EDGE, "min-w-32 bg-card px-2 py-2 text-left font-normal sm:min-w-44 sm:px-3")}>
                      <div className="font-medium">Time off</div>
                      <div className="whitespace-nowrap text-xs text-muted-foreground">days you will not work</div>
                    </th>
                    {months.map((ym) => {
                      const cap = capacityOf.get(ym)
                      const month = formatYearMonth(ym)
                      return (
                        <td key={ym} className={cn("px-0.5 py-1 text-center", current(ym))}>
                          {!cap ? null : offEditing === ym ? (
                            <Input
                              autoFocus
                              type="number"
                              min="0"
                              max={weekdaysInMonth(ym)}
                              step="0.5"
                              aria-label={`Time off, ${month}, days`}
                              value={offDraft}
                              onChange={(e) => setOffDraft(e.target.value)}
                              onBlur={() => commitTimeOff(ym, offDraft)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitTimeOff(ym, offDraft)
                                if (e.key === "Escape") {
                                  setOffEditing(null)
                                  setOffDraft("")
                                }
                              }}
                              className={cn(TIME_OFF_BOX, "px-1 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none")}
                            />
                          ) : (
                            <button
                              type="button"
                              aria-label={
                                cap.daysOff > 0
                                  ? `Time off, ${month}: ${num(cap.daysOff)} ${cap.daysOff === 1 ? "day" : "days"}${cap.reason ? `, ${cap.reason}` : ""}`
                                  : `Time off, ${month}: none. Click to type days off`
                              }
                              onClick={() => {
                                setOffEditing(ym)
                                setOffDraft(cap.daysOff > 0 ? String(cap.daysOff) : "")
                              }}
                              className={cn(
                                TIME_OFF_BOX,
                                "inline-flex flex-col items-center justify-center rounded-md px-1 hover:bg-accent",
                                cap.daysOff > 0 ? "font-semibold" : "text-muted-foreground",
                              )}
                            >
                              <span>{cap.daysOff > 0 ? num(cap.daysOff) : "–"}</span>
                              {cap.daysOff > 0 && cap.reason && <span className="text-[11px] font-normal leading-none text-muted-foreground">{cap.reason}</span>}
                            </button>
                          )}
                        </td>
                      )
                    })}
                    <td className="min-w-28 whitespace-nowrap border-l border-hairline px-3 py-2 text-right">
                      <span className="block font-medium">{num(capacity.reduce((t, c) => t + (c.yearMonth >= currentMonth ? c.daysOff : 0), 0))} d</span>
                      <span className="block text-xs text-muted-foreground">from {formatYearMonth(currentMonth, "MMM")}</span>
                    </td>
                  </tr>
                  <tr className="border-b border-hairline">
                    <th scope="row" className={cn(STICKY_EDGE, "bg-card px-2 py-2 text-left font-normal sm:px-3")}>
                      <div className="font-medium">Available</div>
                      <div className="whitespace-nowrap text-xs text-muted-foreground">weekdays less time off</div>
                    </th>
                    {months.map((ym) => (
                      <td key={ym} className={cn("px-0.5 py-2 text-center font-medium", current(ym))}>
                        {capacityOf.get(ym) ? num(capacityOf.get(ym)!.availableDays) : "–"}
                      </td>
                    ))}
                    <td className="border-l border-hairline" />
                  </tr>
                  <tr className="border-b border-hairline">
                    <th scope="row" className={cn(STICKY_EDGE, "bg-card px-2 py-2 text-left font-normal sm:px-3")}>
                      <div className="font-medium">You plan</div>
                      <div className="whitespace-nowrap text-xs text-muted-foreground">your days, less collaborators’</div>
                    </th>
                    {months.map((ym) => {
                      const cap = capacityOf.get(ym)
                      return (
                        <td key={ym} className={cn("px-0.5 py-1 text-center", current(ym))}>
                          {cap && (
                            <>
                              <span className="block font-medium">{num(cap.allocatedDays)}</span>
                              <LoadWord planned={cap.allocatedDays} available={cap.availableDays} />
                            </>
                          )}
                        </td>
                      )
                    })}
                    <td className="border-l border-hairline" />
                  </tr>
                </>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t bg-surface-subtle font-medium">
                <th scope="row" className={cn(STICKY_EDGE, "bg-surface-subtle px-2 py-2 text-left font-medium sm:px-3")}>
                  Planned billing
                  <span className="block text-xs font-normal text-muted-foreground">net of VAT, billable days</span>
                </th>
                {monthTotals.map((total, i) => (
                  <td key={months[i]} className={cn("whitespace-nowrap px-0.5 py-2 text-center text-xs", current(months[i]))}>
                    {eur(total.billed)}
                    <span className="block font-normal text-muted-foreground">{num(total.days)} d</span>
                  </td>
                ))}
                <td className="min-w-28 whitespace-nowrap border-l border-hairline px-3 py-2 text-right text-xs">
                  {eur(monthTotals.reduce((sum, t, i) => sum + (months[i] >= currentMonth ? t.billed : 0), 0))}
                  <span className="block font-normal text-muted-foreground">
                    {num(monthTotals.reduce((sum, t, i) => sum + (months[i] >= currentMonth ? t.days : 0), 0))} d
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </DataTableCard>
      <ul
        aria-label="Legend"
        className="flex flex-wrap gap-x-5 gap-y-1 text-meta text-muted-foreground"
      >
        <li>
          <span aria-hidden className="text-success">
            ✓{" "}
          </span>
          Taken from logged hours
        </li>
        <li>
          <span aria-hidden className="font-semibold text-foreground">
            12{" "}
          </span>
          Changed from the contract default
        </li>
        <li>
          <span
            aria-hidden
            className="mr-1 inline-block size-1.5 rounded-full bg-danger"
          />
          Over the contract budget, or planned days over the days available
        </li>
        <li>
          <span aria-hidden>— </span>Contract ended
        </li>
        {capacity ? <li>Time off: type a number of days, empty clears it</li> : null}
      </ul>
    </section>
  )
}

/** The cell's second line: its hours in days, and Use when they can go in the plan. */
function HoursLineView({
  line,
  source,
  pending,
  name,
  onUse,
}: {
  line: HoursLine
  source: RevenueSource
  pending: boolean
  name: string
  onUse: () => void
}) {
  // In the contract's unit: an hourly contract's days read as hours, "Use 40 h".
  const days = shown(line.h.days, source)
  const planned = shown(line.planned ?? 0, source)
  const d = unitMark(unitOf(source))
  // Wraps inside its slot (two lines at most) instead of clipping: "Use 100 h" and "100 h: over 744" are long.
  const base = "block text-center text-xs leading-4 tabular-nums"
  switch (line.action) {
    case "use":
      return (
        <button
          type="button"
          disabled={pending}
          aria-label={`Use hours: ${name}, ${planned} ${d} → ${days} ${d}`}
          title={line.title}
          onClick={onUse}
          className={cn(base, "mx-auto rounded-md border px-1.5 font-medium hover:bg-accent disabled:opacity-50 pointer-coarse:min-h-11")}
        >
          Use {days} {d}
        </button>
      )
    case "same":
      return (
        <span
          title={line.title}
          className={cn(base, "text-emerald-600 dark:text-emerald-400")}
        >
          ✓<span className="sr-only">, from logged hours</span>
        </span>
      )
    case "pace":
      return (
        <span title={line.title} className={cn(base, "text-muted-foreground")}>
          {days} of {planned} {d}
        </span>
      )
    case "over":
      return (
        <span title={line.title} className={cn(base, "text-amber-600 dark:text-amber-400")}>
          {days} {d}: over {inContractUnit(31, unitOf(source))}
        </span>
      )
    case "outside":
      return (
        <span title={line.title} className={cn(base, "text-muted-foreground")}>
          {days} {d}
        </span>
      )
    default:
      return null
  }
}

/** "5 over", "full" or "2 free": the word carries the state, the colour only backs it up. */
function LoadWord({ planned, available }: { planned: number; available: number }) {
  const { kind, text } = loadWord(planned, available)
  return (
    <span className={cn("block text-[11px] leading-4", kind === "over" ? "font-medium text-danger" : "text-muted-foreground")}>
      {kind === "over" && <span aria-hidden className="mr-1 inline-block size-1.5 rounded-full bg-danger align-middle" />}
      {text}
    </span>
  )
}

/** The open month on a phone: Time off to type, then Available and You plan in words. */
function YourTimePhone({ cap, month, onCommit, invalid }: { cap: CapacityMonth; month: string; onCommit: (text: string) => void; invalid: number }) {
  return (
    <>
      <div className="flex items-center gap-3 py-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="font-medium">Time off</div>
          <div className={cn("text-xs", invalid > 0 ? "text-danger" : "text-muted-foreground")}>
            {invalid > 0 ? "Type a number of days, like 2 or 2.5." : cap.daysOff > 0 && cap.reason ? cap.reason : "days you will not work"}
          </div>
        </div>
        <Input
          aria-label={`Time off, ${month}, days`}
          key={`${cap.yearMonth}:${cap.daysOff}:${invalid}`}
          aria-invalid={invalid > 0 || undefined}
          type="text"
          inputMode="decimal"
          placeholder="0"
          defaultValue={cap.daysOff > 0 ? String(cap.daysOff) : ""}
          onBlur={(e) => onCommit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={cn("h-11 w-20 text-center", cap.daysOff > 0 && "font-semibold")}
        />
      </div>
      <div className="flex items-baseline justify-between py-3">
        <span>Available</span>
        <b className="font-medium tabular-nums">{num(cap.availableDays)} d</b>
      </div>
      <div className="flex items-baseline justify-between py-3">
        <span>You plan</span>
        <span className="flex items-baseline gap-2 tabular-nums">
          <b className="font-medium">{num(cap.allocatedDays)} d</b>
          <LoadWord planned={cap.allocatedDays} available={cap.availableDays} />
        </span>
      </div>
    </>
  )
}
