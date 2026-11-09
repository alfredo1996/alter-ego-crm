"use client"

import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth, isoDate, parseYearMonth } from "@alter-ego/kernel/dates"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { SegmentedButtons } from "@alter-ego/ui/page/segmented-buttons"
import { StatCard } from "@alter-ego/ui/page/stat-card"
import { Button } from "@alter-ego/ui/ui/button"
import { cn } from "@alter-ego/ui/utils"
import { differenceInCalendarMonths, format, subMonths } from "date-fns"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"

import { TimecardWeek } from "@/components/crm/timecard-week"
import { PlanGrid } from "@/components/plan/plan-grid"
import { ProjectionChart } from "@/components/plan/projection-chart"
import { QuartersSection } from "@/components/plan/quarters-section"
import { RevenueCliffPanel } from "@/components/plan/revenue-cliff-panel"
import { RunwaySection } from "@/components/plan/runway-section"
import { useAllocations, useApplyHours } from "@/hooks/use-allocations"
import { useAssignments, useSetAssignmentMonthDays } from "@/hooks/use-assignments"
import { useAuth } from "@/hooks/use-auth"
import { useCapacityDocs, useSetTimeOff } from "@/hooks/use-capacity"
import { useClients } from "@/hooks/use-clients"
import { useCollaborators } from "@/hooks/use-collaborators"
import { useCompanyAccounts } from "@/hooks/use-company-accounts"
import { useCompanyExpenses } from "@/hooks/use-company-expenses"
import { useCompanyLoans } from "@/hooks/use-company-loans"
import { useCompanyMovements } from "@/hooks/use-company-movements"
import { useCompanySettings, useSetCashFloor } from "@/hooks/use-company-settings"
import { useEngagements } from "@/hooks/use-engagements"
import { useInvoices } from "@/hooks/use-invoices"
import { useOpportunities } from "@/hooks/use-opportunities"
import { useTimecards } from "@/hooks/use-timecards"
import { capacityForMonths } from "@/lib/capacity"
import { balancesAt, bookRows, deposits, round2 } from "@/lib/cash-book"
import { feeChangeEvents } from "@/lib/collaborators"
import { computeBurnDown, computeRevenueCliffs, monthsFrom, toRevenueSources } from "@/lib/engagement-burndown"
import { contractEndDate, engagementLabel } from "@/lib/engagements"
import { buildProjection } from "@/lib/projection"
import { buildRunway } from "@/lib/runway"
import { monthHours, planCells, weekMonday } from "@/lib/timecards"
import { isModuleOn } from "@/modules"

import type { RevenueSource } from "@/lib/engagement-burndown"
import type { Allocation } from "@/types"

/** What you edit: the year ahead, after the two months just closed (whose hours can go in the plan) or the week shown. */
const GRID_MONTHS_AHEAD = 12
/** What you look at: two years, so a cliff a year out still arrives as a warning. */
const PROJECTION_MONTHS = 24
/** What the projection shows until "Show 24 Months". */
const PROJECTION_SHOWN = 12
/** The page's anchor chips: [section id, label]. */
const CHIPS = [
  ["week", "This Week"],
  ["plan-months", "Days by Month"],
  ["projection", "Projection"],
  ["runway", "Runway"],
  ["quarters", "Quarters"],
] as const

/**
 * The grid's rows. A contract ended before `fromMonth` with no days typed from then
 * on would sit there as a row of zeros for good: closed contracts stay in the engine
 * for their past (#156), not on the page that plans the future.
 */
export function plannableSources(
  sources: RevenueSource[],
  allocations: Allocation[],
  fromMonth: string,
): RevenueSource[] {
  return sources.filter(
    (s) =>
      !s.endMonth ||
      s.endMonth >= fromMonth ||
      allocations.some((a) => a.engagementId === s.id && a.yearMonth >= fromMonth && a.days > 0),
  )
}

export function PlanShell() {
  const { user } = useAuth()
  const clientsQuery = useClients(user?.id)
  const engagementsQuery = useEngagements(user?.id)
  const opportunitiesQuery = useOpportunities(user?.id)
  const allocationsQuery = useAllocations(user?.id)
  const companyExpensesQuery = useCompanyExpenses(user?.id)
  const collaboratorsQuery = useCollaborators(user?.id)
  const assignmentsQuery = useAssignments(user?.id)
  const setAssignmentDays = useSetAssignmentMonthDays(user?.id)
  const timecardsQuery = useTimecards(user?.id)
  const invoicesQuery = useInvoices(isModuleOn("invoicing") ? user?.id : undefined)
  // The Runway's cash side loads on its own, like the Quarters' invoices: the rest of the page does not wait for it.
  // Without the books module there are no accounts to start from: no Runway, and its reads stay off.
  const hasBooks = isModuleOn("books")
  // Quarters read ended months off invoices and costs: either one off, every quarter would say €0.
  const hasQuarters = hasBooks && isModuleOn("invoicing")
  const cashUser = hasBooks ? user?.id : undefined
  const accountsQuery = useCompanyAccounts(cashUser)
  const movementsQuery = useCompanyMovements(cashUser)
  const loansQuery = useCompanyLoans(cashUser)
  const settingsQuery = useCompanySettings(cashUser)
  const setCashFloor = useSetCashFloor(user?.id)
  const { data: accounts = [] } = accountsQuery
  const { data: movements = [] } = movementsQuery
  const { data: loans = [] } = loansQuery
  const { data: clients = [] } = clientsQuery
  const { data: engagements = [] } = engagementsQuery
  const { data: opportunities = [] } = opportunitiesQuery
  const { data: allocations = [] } = allocationsQuery
  const { data: companyExpenses = [] } = companyExpensesQuery
  const { data: collaborators = [] } = collaboratorsQuery
  const { data: assignments = [] } = assignmentsQuery
  const { data: timecards = [] } = timecardsQuery
  const { data: invoices = [] } = invoicesQuery

  const { apply: applyHours, setMonthDays } = useApplyHours(user?.id)

  const [scenario, setScenario] = useState<"committed" | "weighted">("committed")
  const [showAll, setShowAll] = useState(false)
  const weekParam = useSearchParams().get("week")

  const fromMonth = format(new Date(), "yyyy-MM")
  // The week of hours above and its month in Days by month below: an older week pulls the columns back.
  const weekMonth = weekMonday(weekParam, new Date()).slice(0, 7)
  const twoBack = format(subMonths(new Date(), 2), "yyyy-MM")
  const firstMonth = weekMonth < twoBack ? weekMonth : twoBack
  const gridMonths = differenceInCalendarMonths(parseYearMonth(fromMonth), parseYearMonth(firstMonth)) + GRID_MONTHS_AHEAD
  const lastMonth = monthsFrom(firstMonth, gridMonths).at(-1)!
  const capacityQuery = useCapacityDocs(user?.id, firstMonth, lastMonth)
  const setTimeOff = useSetTimeOff(user?.id)
  const { data: capacityDocs = [] } = capacityQuery

  const plan = useMemo(() => {
    const committedSources = toRevenueSources({
      engagements,
      opportunities,
      clients,
      scenario: "committed",
    })
    const weightedSources = toRevenueSources({
      engagements,
      opportunities,
      clients,
      scenario: "weighted",
    })

    const burnInput = {
      sources: committedSources,
      allocations,
      fromMonth,
      months: PROJECTION_MONTHS,
    }
    const burnDowns = computeBurnDown(burnInput)
    // computeBurnDown already resolved this grid; re-running it over identical input
    // was pure duplicate work.
    const cliffs = computeRevenueCliffs(burnDowns, burnDowns.flatMap((b) => b.cells))

    const inputFor = (sources: typeof committedSources) => ({
      sources,
      allocations,
      fromMonth,
      months: PROJECTION_MONTHS,
      companyExpenses,
      collaborators,
      assignments,
    })

    const committed = buildProjection(inputFor(committedSources))
    const weighted = buildProjection(inputFor(weightedSources))

    // The pipeline's contribution is the difference between the two runs, read in
    // the month the first budget runs out — the honest "how much you win back".
    const firstCliff = cliffs[0]
    const cliffIndex = firstCliff
      ? committed.findIndex((m) => m.yearMonth === firstCliff.yearMonth)
      : -1
    const pipelineRecovery =
      cliffIndex >= 0
        ? Math.max(0, weighted[cliffIndex].revenue - committed[cliffIndex].revenue)
        : 0

    // The first step of the cliff card is the month before it, at what that month really bills.
    const levelBefore =
      cliffIndex > 0 ? committed[cliffIndex - 1].revenue : null;

    return { cliffs, committed, weighted, pipelineRecovery, levelBefore };
  }, [
    engagements,
    opportunities,
    clients,
    allocations,
    companyExpenses,
    collaborators,
    assignments,
    fromMonth,
  ]);

  // The grid: light, and apart from the projection, which never reads hours.
  const grid = useMemo(() => {
    const byId = new Map(engagements.map((e) => [e.id, e]))
    const sources = toRevenueSources({ engagements, opportunities: [], clients, scenario: "committed" })
    return {
      rows: plannableSources(sources, allocations, firstMonth)
        .map((source) => {
          const e = byId.get(source.id)
          return {
            source,
            label: `${source.clientName} · ${e ? engagementLabel(e) : ""}`,
            end: e ? contractEndDate(e) : null,
          }
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
      cells: planCells(engagements, allocations, fromMonth),
    }
  }, [engagements, clients, allocations, fromMonth, firstMonth])
  // Your time: each month's time off, the days left and what you plan against them (the connector's own sum).
  const capacity = useMemo(
    () => capacityForMonths({ engagements, allocations, capacityDocs, from: firstMonth, months: gridMonths, collaborators, assignments }),
    [engagements, allocations, capacityDocs, firstMonth, gridMonths, collaborators, assignments],
  )
  const today = isoDate(new Date())
  const hours = useMemo(() => monthHours(timecards, today), [timecards, today])

  const timeline = scenario === "committed" ? plan.committed : plan.weighted

  // Money today is what the Cash Book shows: every company account open today, VAT included.
  const cash = useMemo(() => {
    const { counted } = bookRows({ accounts, invoices, expenses: companyExpenses, loans, movements, clients, engagements })
    const balances = balancesAt(accounts, counted, today)
    return {
      start: round2([...balances.values()].reduce((t, v) => t + v, 0)),
      accountCount: balances.size,
      heldDeposits: round2(deposits(movements).filter((d) => d.kind === "deposit_held").reduce((t, d) => t + d.amount, 0)),
    }
  }, [accounts, invoices, companyExpenses, loans, movements, clients, engagements, today])
  const cashFloor = settingsQuery.data?.cashFloor ?? null
  const runway = useMemo(() => buildRunway({ start: cash.start, floor: cashFloor, timeline }), [cash.start, cashFloor, timeline])
  const cashQueries = [accountsQuery, movementsQuery, loansQuery, invoicesQuery, settingsQuery]

  // Five feed the projection, and the grid's hours the timecards: any one
  // missing draws a plan that is wrong, not empty. TimecardWeek's own four reads
  // are among them, so it renders from the cache: one spinner for the page.
  // The invoices feed only the Quarters, which wait for them on their own.
  const gate = pageState([
    clientsQuery,
    engagementsQuery,
    opportunitiesQuery,
    allocationsQuery,
    companyExpensesQuery,
    collaboratorsQuery,
    assignmentsQuery,
    timecardsQuery,
  ])
  if (gate) return gate

  const months = showAll ? PROJECTION_MONTHS : PROJECTION_SHOWN;
  const shown = timeline.slice(0, months);
  const total = shown.reduce(
    (t, m) => ({ gross: t.gross + m.revenue, costs: t.costs + m.costs, collaborators: t.collaborators + m.collaborators, other: t.other + m.otherCosts }),
    { gross: 0, costs: 0, collaborators: 0, other: 0 },
  );
  const net = total.gross - total.costs;
  const range =
    shown.length > 0
      ? `${formatYearMonth(shown[0].yearMonth, "MMM yyyy")} to ${formatYearMonth(shown[shown.length - 1].yearMonth, "MMM yyyy")}`
      : "";
  const th =
    "px-2 py-3 sm:px-4 text-[12.5px] font-medium text-muted-foreground";

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <PageHeader
          title="Plan"
          subtitle="Log hours by the week and plan days by the month. The projection follows the days."
        />
        <nav aria-label="On this page" className="flex flex-wrap gap-2">
          {CHIPS.filter(([id]) => (id !== "runway" || hasBooks) && (id !== "quarters" || hasQuarters)).map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="inline-flex min-h-9 items-center rounded-full border bg-card px-3.5 text-[13px] text-subtle-foreground hover:text-foreground pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      {/* One page, no tabs: nothing unmounts, so a cell being typed into keeps its draft until its blur saves it. */}
      <div id="week" className="scroll-mt-20">
        <TimecardWeek />
      </div>

      <PlanGrid
        rows={grid.rows}
        cells={grid.cells}
        allocations={allocations}
        hours={hours}
        timecards={timecards}
        months={monthsFrom(firstMonth, gridMonths)}
        today={today}
        pending={setMonthDays.isPending}
        onSet={(engagementId, yearMonth, days) => setMonthDays.mutate({ engagementId, yearMonth, days })}
        onUse={applyHours}
        assignments={assignments.flatMap((a) => {
          const c = collaborators.find((x) => x.id === a.collaboratorId)
          return c?.isActive ? [{ assignment: a, name: c.name }] : []
        })}
        onSetAssignment={(assignmentId, yearMonth, days) => setAssignmentDays.mutate({ assignmentId, yearMonth, days })}
        // Time off is a side read: a slow or failed one leaves the Plan up, without Your time.
        capacity={capacityQuery.isSuccess ? capacity : undefined}
        onSetTimeOff={(yearMonth, daysOff) => setTimeOff.mutate({ yearMonth, daysOff })}
        intro={
          <RevenueCliffPanel
            cliffs={plan.cliffs}
            pipelineRecovery={plan.pipelineRecovery}
            levelBefore={plan.levelBefore}
          />
        }
      />

      <section className="space-y-4 [&_h2]:scroll-mt-20">
        <SectionHeader
          id="projection"
          title="Projection"
          description={`Next ${months} months, net of VAT. Cash flow only: no pay, no taxes.`}
          actions={
            <SegmentedButtons
              aria-label="What to count"
              value={scenario}
              onChange={setScenario}
              options={[
                { value: "committed", label: "Contracts Only" },
                { value: "weighted", label: "With Weighted Pipeline" },
              ]}
            />
          }
        />

        <div role="region" aria-label={`Next ${months} months`} className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <StatCard label="Gross" value={eur(total.gross)} detail={range && `What the plan bills, ${range}`} />
          <span aria-hidden className="flex items-center text-2xl font-light text-muted-foreground max-sm:hidden">−</span>
          <StatCard
            label="Costs"
            value={eur(total.costs)}
            detail={`About ${eur(Math.round(total.costs / Math.max(1, shown.length)))} a month`}
          >
            <dl className="space-y-0.5 text-meta text-subtle-foreground">
              <div className="flex justify-between gap-3">
                <dt>Collaborators</dt>
                <dd className="tabular-nums text-foreground">{eur(total.collaborators)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Other, from the Costs page</dt>
                <dd className="tabular-nums text-foreground">{eur(total.other)}</dd>
              </div>
            </dl>
          </StatCard>
          <span aria-hidden className="flex items-center text-2xl font-light text-muted-foreground max-sm:hidden">=</span>
          <StatCard
            label="Net"
            value={eur(net)}
            tone={net < 0 ? "danger" : undefined}
            detail="What is left before your pay and taxes"
            className="border-foreground"
          />
        </div>

        <ProjectionChart timeline={shown} />

        <DataTableCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <caption className="sr-only">Projection by month: gross minus costs equals net</caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className={cn(th, "text-left")}>
                    Month
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    Gross
                  </th>
                  <th scope="col" className={cn(th, "text-right max-sm:hidden")}>
                    Collaborators
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    <span className="sm:hidden">Costs</span>
                    <span className="max-sm:hidden">Other costs</span>
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    Net
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((month) => {
                  const cliff = plan.cliffs.find((c) => c.yearMonth === month.yearMonth)
                  const monthNet = month.revenue - month.costs
                  const fees = feeChangeEvents(collaborators, month.yearMonth)
                  return (
                    <tr
                      key={month.yearMonth}
                      className="border-b border-hairline"
                    >
                      <th
                        scope="row"
                        className="px-2 py-2.5 text-left font-normal sm:px-4"
                      >
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="font-medium">
                            <span className="sm:hidden">
                              {formatYearMonth(month.yearMonth, "MMM yyyy")}
                            </span>
                            <span className="max-sm:hidden">
                              {formatYearMonth(month.yearMonth)}
                            </span>
                          </span>
                          {cliff && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-warning-soft-foreground">
                              <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                              Billing stops
                              <span className="text-muted-foreground max-sm:hidden">
                                {cliff.sources
                                  .map((s) => s.clientName)
                                  .join(", ")}
                              </span>
                            </span>
                          )}
                          {fees.map((f) => (
                            <span key={`${f.kind}-${f.name}`} className="inline-flex items-center gap-1.5 text-xs text-warning-soft-foreground">
                              <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                              {f.kind === "changes" ? "Fee changes" : "Fee stops"}
                              <span className="text-muted-foreground max-sm:hidden">{f.name}</span>
                            </span>
                          ))}
                        </span>
                      </th>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right sm:px-4">
                        {eur(month.revenue)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right text-subtle-foreground max-sm:hidden sm:px-4">
                        {eur(month.collaborators)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right text-subtle-foreground sm:px-4">
                        <span className="sm:hidden">{eur(month.costs)}</span>
                        <span className="max-sm:hidden">{eur(month.otherCosts)}</span>
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-2 py-2.5 text-right font-medium sm:px-4",
                          monthNet < 0 && "text-danger",
                        )}
                      >
                        {eur(monthNet)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface-subtle font-medium">
                  <th
                    scope="row"
                    className="px-2 py-3 text-left font-medium sm:px-4"
                  >
                    <span className="max-sm:hidden">Next </span>
                    {shown.length} months
                  </th>
                  <td className="whitespace-nowrap px-2 py-3 text-right sm:px-4">
                    {eur(total.gross)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-3 text-right max-sm:hidden sm:px-4">
                    {eur(total.collaborators)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-3 text-right sm:px-4">
                    <span className="sm:hidden">{eur(total.costs)}</span>
                    <span className="max-sm:hidden">{eur(total.other)}</span>
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-2 py-3 text-right sm:px-4",
                      net < 0 && "text-danger",
                    )}
                  >
                    {eur(net)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </DataTableCard>

        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show ${PROJECTION_SHOWN} Months` : `Show ${PROJECTION_MONTHS} Months`}
          </Button>
        </div>
        <p className="text-meta text-muted-foreground">
          Gross is what the plan bills, Collaborators their fees and days that month, Other costs what the Costs page counts. Pay is in the Cash Book; taxes are
          your accountant&apos;s.
        </p>
      </section>

      {hasBooks && <div>
        {cashQueries.some((q) => q.isError) ? (
          <p role="alert" className="text-sm text-danger">Could not load the cash data for the Runway.</p>
        ) : cashQueries.some((q) => q.isLoading) ? (
          <p role="status" className="text-sm text-muted-foreground">Loading runway…</p>
        ) : cash.accountCount === 0 ? (
          <section className="space-y-3 [&_h2]:scroll-mt-20">
            <SectionHeader id="runway" title="Runway" />
            <p className="text-sm text-muted-foreground">
              The runway starts from your company accounts.{" "}
              <Link href="/cash-book" className="underline underline-offset-2">Add one in the Cash Book</Link> to see how long your money lasts.
            </p>
          </section>
        ) : (
          <RunwaySection
            runway={runway}
            horizon={timeline.length}
            scenarioLabel={scenario === "committed" ? "Contracts Only" : "With Weighted Pipeline"}
            today={new Date()}
            accountCount={cash.accountCount}
            heldDeposits={cash.heldDeposits}
            onSaveFloor={(floor) => setCashFloor.mutateAsync(floor)}
          />
        )}
      </div>}

      {/* The planned months are the Projection's own timeline, so the switch moves both and they agree. */}
      {!hasQuarters ? null : invoicesQuery.isError ? (
        <p role="alert" className="text-sm text-danger">Could not load the invoices for Quarters.</p>
      ) : invoicesQuery.isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading quarters…</p>
      ) : (
        <QuartersSection
          today={new Date()}
          invoices={invoices}
          engagements={engagements}
          timecards={timecards}
          expenses={companyExpenses}
          collaborators={collaborators}
          assignments={assignments}
          plan={timeline}
          weighted={scenario === "weighted"}
        />
      )}
    </div>
  )
}
