"use client"

import { eurShort } from "@alter-ego/kernel/currency"
import { isoDate } from "@alter-ego/kernel/dates"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { StatusDot } from "@alter-ego/ui/page/meta-row"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { ProgressBar } from "@alter-ego/ui/page/progress"
import { StatCard, StatStrip } from "@alter-ego/ui/page/stat-card"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@alter-ego/ui/ui/sheet"
import { cn } from "@alter-ego/ui/utils"
import { format } from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { useRef, useState, useSyncExternalStore } from "react"

import { useAllocations } from "@/hooks/use-allocations"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import { useEngagements } from "@/hooks/use-engagements"
import { useInvoices } from "@/hooks/use-invoices"
import { useMeetings } from "@/hooks/use-meetings"
import { useOpportunities } from "@/hooks/use-opportunities"
import { useSolutions } from "@/hooks/use-solutions"
import { useTimecards } from "@/hooks/use-timecards"
import {
  WINDOW_MONTHS,
  contractTimeline,
  groupByClient,
  quarterLabel,
  todayAt,
  windowFrom,
  windowLabel,
  type BarState,
  type TimelineBar,
} from "@/lib/contract-timeline"
import { monthsFrom } from "@/lib/engagement-burndown"
import { MEETING_HEALTH, formatMeetingDate, healthByContract } from "@/lib/meetings"
import { num } from "@/lib/timecards"
import { isModuleOn } from "@/modules"

import type { Meeting } from "@/types"

/** A bar's look, by state. The state is said in words beside it as well: colour is never the only cue. */
const BAR: Record<BarState, { track: string; fill: string; word: string }> = {
  active: { track: "border border-border-strong bg-surface-subtle", fill: "bg-foreground", word: "Active" },
  full: { track: "border border-warning bg-warning-soft", fill: "bg-warning", word: "Nearly full" },
  ended: { track: "border border-border bg-muted", fill: "bg-muted-foreground/50", word: "Ended" },
  open: { track: "border border-dashed border-border-strong bg-surface-subtle", fill: "bg-subtle-foreground", word: "Active" },
  opportunity: { track: "border-2 border-dashed border-info bg-info-soft", fill: "bg-transparent", word: "Not signed yet" },
}

const percent = (n: number) => `${Math.round(n * 100)}%`
const days = (n: number) => `${num(n)} ${num(n) === 1 ? "day" : "days"}`

/** Under a bar's name: how far it is and what it belongs to. */
function barLine(b: TimelineBar): string {
  const road = b.solution ? (b.solution.step ? `${b.solution.name}, step ${b.solution.step.number}` : b.solution.name) : null
  const lead =
    b.kind === "opportunity"
      ? `${b.stage} · ${days(b.estimate ?? 0)}`
      : b.total !== null
        ? `${num(b.used)} of ${num(b.total)} days`
        : `No ceiling · ${days(b.used)} logged`
  return road ? `${lead} · ${road}` : lead
}

const monthName = (ym: string) => format(new Date(`${ym}-01T00:00:00`), "MMM yyyy")

/** When a bar runs, in words; a bar with no end month says so. */
function barWhen(b: TimelineBar): string {
  if (b.start && b.end) return `${monthName(b.start)} – ${monthName(b.end)}`
  if (b.start) return `from ${monthName(b.start)}, no end month`
  return b.end ? `until ${monthName(b.end)}` : ""
}

/** The word after a bar: its fill, or its state. */
function afterWord(b: TimelineBar): string {
  if (b.state === "ended") return "Ended"
  if (b.state === "full") return `${percent(b.fill ?? 1)} · nearly full`
  if (b.state === "opportunity" || b.state === "open") return ""
  return b.fill === null ? "" : percent(b.fill)
}

const phoneQuery = "(max-width: 767px)"
function usePhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia?.(phoneQuery)
      list?.addEventListener("change", notify)
      return () => list?.removeEventListener("change", notify)
    },
    () => window.matchMedia?.(phoneQuery).matches ?? false,
    () => false,
  )
}

function Toggle({ pressed, onClick, children }: { pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="outline" size="lg" aria-pressed={pressed} onClick={onClick} className="aria-pressed:border-border-strong aria-pressed:bg-accent">
      {children}
    </Button>
  )
}

function BarRow({ bar, selected, onPick, todayLeft, showClient }: { bar: TimelineBar; selected: boolean; onPick: (opener: HTMLElement) => void; todayLeft: number | null; showClient: boolean }) {
  const look = BAR[bar.state]
  const line = barLine(bar)
  // A bar running to the window's edge has no room beside it: its figure is in the row line and the detail.
  const after = bar.toEdge ? "" : afterWord(bar)
  const open = bar.toEdge
  return (
    <div className="grid grid-cols-[168px_minmax(0,1fr)] border-t border-hairline sm:grid-cols-[280px_minmax(0,1fr)]">
      <div className="sticky left-0 z-10 flex min-w-0 flex-col justify-center gap-0.5 border-r border-hairline bg-card px-4 py-2.5 md:border-r-0">
        <span className="truncate text-sm font-medium">{bar.name}</span>
        <span className="truncate text-xs text-muted-foreground">{showClient ? `${bar.clientName} · ${line}` : line}</span>
      </div>
      <div className="relative h-14 bg-[repeating-linear-gradient(to_right,var(--color-border)_0_1px,transparent_1px_25%),repeating-linear-gradient(to_right,var(--color-hairline)_0_1px,transparent_1px_8.3333%)]">
        {todayLeft !== null && <span aria-hidden className="absolute inset-y-0 w-0.5 bg-danger" style={{ left: `${todayLeft * 100}%` }} />}
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`${bar.name}, ${bar.clientName}: ${line}. ${look.word}${barWhen(bar) ? `, ${barWhen(bar)}` : ""}`}
          onClick={(e) => onPick(e.currentTarget)}
          // The button is the row's height, so a thumb finds it; the visible bar is the span inside.
          className="group absolute inset-y-0 flex items-center outline-hidden"
          style={{ left: `${bar.left * 100}%`, width: `${bar.width * 100}%` }}
        >
          <span
            className={cn(
              "relative flex h-7 w-full items-center overflow-hidden rounded-[7px] text-xs font-semibold group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ring",
              look.track,
              selected && "ring-2 ring-info",
              bar.fromEdge && "rounded-l-none",
              open && "rounded-r-none",
            )}
          >
            {bar.kind === "contract" && bar.fill !== null && (
              <span aria-hidden className={cn("h-full", look.fill)} style={{ width: `${Math.min(bar.fill, 1) * 100}%` }} />
            )}
            {bar.kind === "opportunity" && <span className="absolute left-2.5 whitespace-nowrap text-info-soft-foreground">{bar.stage}</span>}
          </span>
        </button>
        {after && (
          <span
            className="absolute top-[19px] ml-2 text-xs whitespace-nowrap text-subtle-foreground tabular-nums"
            style={{ left: `${(bar.left + bar.width) * 100}%` }}
          >
            {after}
          </span>
        )}
      </div>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </>
  )
}

/** One bar's detail: the facts, then its quarters, or what an unsigned deal is. */
function BarDetail({ bar, health, withInvoiced, withSolutions, sheet }: { bar: TimelineBar; health: Meeting | undefined; withInvoiced: boolean; withSolutions: boolean; sheet: boolean }) {
  const opportunity = bar.kind === "opportunity"
  const light = health?.health ? MEETING_HEALTH[health.health] : null
  const state = opportunity ? bar.stage : BAR[bar.state].word
  const left = bar.total !== null ? Math.max(0, bar.total - bar.used) : null
  return (
    <div className="grid min-w-0 gap-7 md:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{bar.clientName}</span>
          <div className="flex flex-wrap items-center gap-2.5">
            {sheet ? (
              <SheetTitle className="text-xl font-semibold [overflow-wrap:anywhere]">{bar.name}</SheetTitle>
            ) : (
              <h2 className="text-xl font-semibold [overflow-wrap:anywhere]">{bar.name}</h2>
            )}
            <StatusPill tone={opportunity ? "info" : bar.state === "ended" ? "neutral" : bar.state === "full" ? "warning" : "success"}>{state}</StatusPill>
          </div>
        </div>
        <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          {withSolutions && (
            <Fact label="Solution">
              {bar.solution ? (
                <Link href={`/solutions/${bar.solution.id}`} className="font-medium underline-offset-4 hover:underline">
                  {bar.solution.step ? `${bar.solution.name} · Step ${bar.solution.step.number}, ${bar.solution.step.title}` : bar.solution.name}
                </Link>
              ) : (
                "None yet"
              )}
            </Fact>
          )}
          <Fact label="Health">
            {opportunity ? (
              "No contract yet"
            ) : light && health ? (
              <StatusDot tone={light.tone}>
                {light.label} · last call {formatMeetingDate(health.date, "d MMM")}
              </StatusDot>
            ) : (
              <StatusDot outline>No call logged yet</StatusDot>
            )}
          </Fact>
          <Fact label={opportunity ? "Size" : "Rate"}>
            <span className="tabular-nums">{opportunity ? days(bar.estimate ?? 0) : bar.rate}</span>
          </Fact>
        </dl>
        {!opportunity && bar.fill !== null && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between gap-3 text-[13px] text-subtle-foreground tabular-nums">
              <span>
                {bar.total !== null
                  ? `${num(bar.used)} of ${num(bar.total)} days logged${left ? ` · ${num(left)} left` : ""}`
                  : `No ceiling: ${num(bar.sum.logged)} of ${num(bar.sum.planned)} planned days logged`}
              </span>
              <span className="font-semibold text-foreground">{percent(bar.fill)}</span>
            </div>
            <ProgressBar value={bar.fill} tone={bar.state === "full" ? "warning" : "default"} label={`${bar.name} filled`} />
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild variant="outline" size="lg">
            <Link href={opportunity ? "/pipeline" : `/clients/${bar.clientId}`}>{opportunity ? "Open Opportunity" : "Open Contract"}</Link>
          </Button>
          {withSolutions && bar.solution && (
            <Button asChild variant="outline" size="lg">
              <Link href={`/solutions/${bar.solution.id}`}>Open Solution</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2.5">
        {opportunity ? (
          <>
            <h3 className="text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">Not Signed Yet</h3>
            <p className="text-sm leading-relaxed">
              Expected {bar.start && bar.end ? `${format(new Date(`${bar.start}-01T00:00:00`), "MMM yyyy")} – ${format(new Date(`${bar.end}-01T00:00:00`), "MMM yyyy")}` : "soon"}, about {days(bar.estimate ?? 0)}. It has no days or money until it is won; then its contract takes this place on the timeline{withSolutions && bar.solution?.step ? ", and the roadmap step follows it" : ""}.
            </p>
            <Link href="/pipeline" className="text-sm font-medium underline-offset-4 hover:underline">
              Open in Pipeline
            </Link>
          </>
        ) : (
          <>
            <h3 className="text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">By Quarter</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th scope="col" className="py-2 text-left font-normal">Quarter</th>
                    <th scope="col" className="py-2 text-right font-normal">Planned</th>
                    <th scope="col" className="py-2 text-right font-normal">Logged</th>
                    {withInvoiced && <th scope="col" className="py-2 text-right font-normal">Invoiced</th>}
                    <th scope="col" className="py-2 text-right font-normal">Fill</th>
                  </tr>
                </thead>
                <tbody>
                  {[...bar.quarters, bar.sum].map((q, i, all) => (
                    <tr key={q.label} className={cn("border-t border-hairline", i === all.length - 1 && "border-border-strong font-semibold")}>
                      <th scope="row" className="py-2.5 text-left font-[inherit]">{q.label}</th>
                      <td className="py-2.5 text-right">{num(q.planned)}</td>
                      <td className="py-2.5 text-right">{num(q.logged)}</td>
                      {withInvoiced && <td className="py-2.5 text-right">{eurShort(q.invoiced ?? 0)}</td>}
                      <td className="py-2.5 text-right">{q.fill === null ? "–" : percent(q.fill)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[13px] leading-normal text-muted-foreground">
              Planned comes from the Plan, logged from the timecards{withInvoiced ? ", invoiced from Invoices" : ""}. Fill is logged over planned. Days.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Contracts: every contract and open deal on one 12-month timeline, by client or by start. A bar's
 * position and state come from lib/contract-timeline; a click opens its detail below, or on a phone in a sheet.
 */
export function ContractTimeline() {
  const { user } = useAuth()
  const hasInvoices = isModuleOn("invoicing")
  const hasSolutions = isModuleOn("solutions")
  const clientsQuery = useClients(user?.id)
  const engagementsQuery = useEngagements(user?.id)
  const opportunitiesQuery = useOpportunities(user?.id)
  const allocationsQuery = useAllocations(user?.id)
  const timecardsQuery = useTimecards(user?.id)
  const meetingsQuery = useMeetings(user?.id)
  const invoicesQuery = useInvoices(hasInvoices ? user?.id : undefined)
  const solutionsQuery = useSolutions(hasSolutions ? user?.id : undefined)
  const [shift, setShift] = useState(0)
  const [grouped, setGrouped] = useState(true)
  const [pipeline, setPipeline] = useState(true)
  const [picked, setPicked] = useState<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const phone = usePhone()

  const gate = pageState([
    clientsQuery, engagementsQuery, opportunitiesQuery, allocationsQuery, timecardsQuery, meetingsQuery,
    ...(hasInvoices ? [invoicesQuery] : []),
    ...(hasSolutions ? [solutionsQuery] : []),
  ])
  if (gate) return gate

  const today = isoDate(new Date())
  const from = windowFrom(today, shift)
  const months = monthsFrom(from, WINDOW_MONTHS)
  const { bars: all, stats } = contractTimeline({
    today,
    from,
    clients: clientsQuery.data ?? [],
    engagements: engagementsQuery.data ?? [],
    opportunities: opportunitiesQuery.data ?? [],
    allocations: allocationsQuery.data ?? [],
    timecards: timecardsQuery.data ?? [],
    invoices: hasInvoices ? (invoicesQuery.data ?? []) : null,
    solutions: hasSolutions ? (solutionsQuery.data ?? []) : [],
  })
  const bars = pipeline ? all : all.filter((b) => b.kind === "contract")
  const health = healthByContract(meetingsQuery.data ?? [])
  const rows = bars
  // No contract and no open deal anywhere: paging the window cannot help.
  const hasAnything = all.length > 0 || (engagementsQuery.data ?? []).length > 0 || stats.openDeals > 0
  // The detail follows the pick; with none, the first live contract, so the panel is never empty.
  const shown = rows.find((b) => b.id === picked) ?? rows.find((b) => b.state !== "ended" && b.kind === "contract") ?? rows[0]
  const todayLeft = todayAt(today, from)
  const nowQuarter = quarterLabel(today.slice(0, 7))
  const quarters = [0, 3, 6, 9].map((i) => quarterLabel(months[i]))
  const plural = (n: number) => `${n} ${n === 1 ? "contract" : "contracts"}`

  const row = (b: TimelineBar, showClient: boolean) => (
    <BarRow key={b.id} bar={b} selected={(phone ? picked : shown?.id) === b.id} onPick={(el) => { opener.current = el; setPicked(b.id) }} todayLeft={todayLeft} showClient={showClient} />
  )
  const detail = shown && (
    <BarDetail
      bar={shown}
      health={health.get(shown.id)}
      withInvoiced={hasInvoices}
      withSolutions={hasSolutions}
      sheet={phone}
    />
  )

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      <PageHeader
        title="Contracts"
        subtitle="Every contract across clients on one timeline. Click a bar for its days and money by quarter."
        actions={
          <>
            <div className="flex items-center rounded-lg border">
              <Button type="button" variant="ghost" size="icon-lg" aria-label="Earlier" onClick={() => setShift(shift - 1)}>
                <ChevronLeft aria-hidden />
              </Button>
              <span className="px-1.5 text-sm font-medium whitespace-nowrap">{windowLabel(from)}</span>
              <Button type="button" variant="ghost" size="icon-lg" aria-label="Later" onClick={() => setShift(shift + 1)}>
                <ChevronRight aria-hidden />
              </Button>
            </div>
            <Toggle pressed={grouped} onClick={() => setGrouped(!grouped)}>
              Group by Client
            </Toggle>
            <Toggle onClick={() => setPipeline(!pipeline)}>
              {pipeline ? "Hide Pipeline" : "Show Pipeline"}
            </Toggle>
          </>
        }
      />

      <StatStrip aria-label="Contracts summary">
        <StatCard label="Active contracts" value={stats.active} />
        <StatCard label={`${stats.quarter} planned`} value={days(stats.planned)} />
        <StatCard label={`${stats.quarter} logged`} value={days(stats.logged)} />
        <StatCard label="In the pipeline" value={stats.openDeals === 0 ? "None" : `${stats.openDeals} · ${days(stats.dealDays)}`} />
      </StatStrip>

      {rows.length === 0 && !hasAnything ? (
        <EmptyPrompt
          title="No contracts yet"
          description="Contracts and open deals show on this timeline once you have them."
          action={
            <Button asChild variant="outline">
              <Link href="/clients">Open Clients</Link>
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyPrompt
          title="Nothing on the timeline in these months"
          description="Contracts and open deals show here once they fall in the window. Try Earlier or Later."
        />
      ) : (
        <section aria-label="Timeline" className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="overflow-x-auto">
            <div className="min-w-[760px] lg:min-w-0">
              <div className="grid grid-cols-[168px_minmax(0,1fr)] bg-surface-subtle sm:grid-cols-[280px_minmax(0,1fr)]">
                <div className="sticky left-0 z-10 flex items-end bg-surface-subtle px-4 py-3 text-xs font-semibold tracking-[0.04em] text-muted-foreground">
                  <span className="uppercase">Contract</span>
                </div>
                <div className="relative">
                  <div className="grid grid-cols-4">
                    {quarters.map((q) => (
                      <span key={q} className={cn("border-l px-2.5 pt-2.5 pb-1 text-[13px] font-semibold", q === nowQuarter && "bg-muted")}>
                        {q}
                        {q === nowQuarter && " · now"}
                      </span>
                    ))}
                  </div>
                  <div className="grid grid-cols-12 text-xs text-muted-foreground">
                    {months.map((m, i) => (
                      <span key={m} className={cn("border-l px-2.5 pt-0.5 pb-7", i % 3 !== 0 && "border-hairline")}>
                        {format(new Date(`${m}-01T00:00:00`), "MMM")}
                      </span>
                    ))}
                  </div>
                  {todayLeft !== null && (
                    <span
                      className="absolute bottom-0 -translate-x-1/2 rounded bg-destructive px-1.5 py-px text-[11px] font-semibold text-destructive-foreground"
                      style={{ left: `${todayLeft * 100}%` }}
                    >
                      Today
                    </span>
                  )}
                </div>
              </div>
              {grouped
                ? groupByClient(rows).map((g) => (
                    <div key={g.clientId}>
                      <div className="border-t border-hairline bg-surface-subtle">
                        <div className="sticky left-0 flex w-fit items-baseline gap-2 px-4 pt-2.5 pb-1.5">
                          <span className="text-[13px] font-semibold">{g.clientName}</span>
                          <span className="text-xs text-muted-foreground">{plural(g.bars.length)}</span>
                        </div>
                      </div>
                      {g.bars.map((b) => row(b, false))}
                    </div>
                  ))
                : rows.map((b) => row(b, true))}
            </div>
          </div>
          <ul className="flex flex-wrap gap-x-[18px] gap-y-2 border-t px-4 py-3 text-xs text-subtle-foreground">
            <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-[18px] rounded-[3px] bg-foreground" />Days logged</li>
            <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-[18px] rounded-[3px] border border-border-strong bg-surface-subtle" />Days left</li>
            <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-[18px] rounded-[3px] bg-warning" />Nearly full</li>
            <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-[18px] rounded-[3px] bg-muted-foreground/50" />Ended</li>
            {pipeline && <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-[18px] rounded-[3px] border-[1.5px] border-dashed border-info bg-info-soft" />Pipeline, not signed</li>}
            <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-0.5 bg-danger" />Today</li>
          </ul>
        </section>
      )}

      {detail && !phone && (
        <section aria-label="Contract detail" className="rounded-xl border bg-card p-6 shadow-xs">
          {detail}
        </section>
      )}
      {detail && phone && (
        <Sheet open={picked !== null} onOpenChange={(open) => !open && setPicked(null)}>
          <SheetContent
            side="bottom"
            className="max-h-[85vh] overflow-y-auto"
            // The sheet has no trigger of its own, so focus goes back to the bar that opened it.
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              opener.current?.focus()
            }}
          >
            <SheetDescription className="sr-only">{shown.clientName}</SheetDescription>
            {detail}
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
