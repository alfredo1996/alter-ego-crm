"use client"

import { eur } from "@alter-ego/kernel/currency"
import { formatYearMonth } from "@alter-ego/kernel/dates"
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { FilterBar, FilterSelect } from "@alter-ego/ui/page/filter-bar"
import { MetaRow, StatusDot } from "@alter-ego/ui/page/meta-row"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { SegmentedProgress } from "@alter-ego/ui/page/progress"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { StatCard, StatStrip } from "@alter-ego/ui/page/stat-card"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { StatusTabs } from "@alter-ego/ui/page/status-tabs"
import { Button } from "@alter-ego/ui/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alter-ego/ui/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@alter-ego/ui/ui/table"
import { cn } from "@alter-ego/ui/utils"
import { differenceInCalendarDays, format } from "date-fns"
import { MoreHorizontal, Pencil, Plus, Trash2, Trophy } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useRef, useState } from "react"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { EngagementFormDialog } from "@/components/crm/engagement-form-dialog"
import { OpportunityFormDialog } from "@/components/crm/opportunity-form-dialog"
import { useAuth } from "@/hooks/use-auth"
import { useClients, useCreateClient } from "@/hooks/use-clients"
import { useCreateEngagement, useEngagements } from "@/hooks/use-engagements"
import {
  useCreateOpportunity,
  useDeleteOpportunity,
  useOpportunities,
  useUpdateOpportunity,
} from "@/hooks/use-opportunities"
import { contractUnit, conversionTerm, countIn, engagementLabel, engagementNameFromTitle, rateIn } from "@/lib/engagements"
import {
  OPEN_STAGES,
  STAGE_LABELS,
  STAGE_TONE,
  closestToSigning,
  isActionOverdue,
  isOpen,
  monthlyValue,
  nextFollowUp,
  weightedByStage,
  weightedMonthlyValue,
  weightedPipelineMonthly,
} from "@/lib/opportunities"
import { shortDay } from "@/lib/solutions"


import type { Engagement, Opportunity } from "@/types"

/** The Stage tabs: All, each open stage, then every closed deal. `?stage=` holds one past All. */
const ALL = "all"
const STAGE_TABS = [...OPEN_STAGES, "closed"] as const
type StageTab = typeof ALL | (typeof STAGE_TABS)[number]

/** The All tab lists this many closed deals; "View All Closed" opens the Closed tab. */
const SUMMARY_ROWS = 6

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]

/** "if all four close": what the open deals add per month at 100%. */
function ifAllClose(n: number): string {
  if (n === 1) return "if it closes"
  if (n === 2) return "if both close"
  return `if all ${NUMBER_WORDS[n] ?? n} close`
}

/** When a follow-up falls, from today: "in 2 days", "today", "3 days overdue". */
function followUpWhen(date: Date, today: Date): string {
  const days = differenceInCalendarDays(date, today)
  if (days === 0) return "today"
  if (days === 1) return "tomorrow"
  return days > 0 ? `in ${days} days` : `${plural(-days, "day")} overdue`
}

/** The stage bar's fill, furthest along darkest. */
const STAGE_FILL: Record<(typeof OPEN_STAGES)[number], string> = {
  negotiation: "bg-primary",
  proposal: "bg-muted-foreground",
  lead: "bg-border-strong",
}

export function PipelineShell() {
  const { user } = useAuth()
  const clientsQuery = useClients(user?.id)
  const opportunitiesQuery = useOpportunities(user?.id)
  const engagementsQuery = useEngagements(user?.id)
  const { data: clients = [] } = clientsQuery
  const { data: opportunities = [] } = opportunitiesQuery
  const { data: engagements = [] } = engagementsQuery
  const router = useRouter()
  const params = useSearchParams()

  const createClient = useCreateClient(user?.id)
  const createOpportunity = useCreateOpportunity(user?.id)
  const updateOpportunity = useUpdateOpportunity(user?.id)
  const deleteOpportunity = useDeleteOpportunity(user?.id)
  const createEngagement = useCreateEngagement(user?.id)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Opportunity | null>(null)
  const [deleting, setDeleting] = useState<Opportunity | null>(null)
  const [converting, setConverting] = useState<Opportunity | null>(null)
  const [search, setSearch] = useState("")
  // No DialogTrigger on these dialogs, and a menu item is gone by the time its dialog closes:
  // focus goes back by hand to the button that opened one (the More button for a menu item).
  const opener = useRef<HTMLElement | null>(null)
  const restoreFocus = (event: Event) => {
    if (!opener.current?.isConnected) return
    event.preventDefault()
    opener.current.focus()
  }

  // All three, or every card reads "—" until the clients land, and a won deal's contract.
  const gate = pageState([clientsQuery, opportunitiesQuery, engagementsQuery])
  if (gate) return gate

  // Recomputed per render rather than frozen in state: a stale "today" would stop
  // flagging overdue follow-ups on a tab left open overnight.
  const today = new Date()

  async function handleCreateClient(name: string): Promise<string> {
    const created = await createClient.mutateAsync({ name })
    return created.id
  }

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    const query = next.toString()
    router.replace(query ? `/pipeline?${query}` : "/pipeline", { scroll: false })
  }
  const stageParam = params.get("stage")
  const stage: StageTab = STAGE_TABS.find((s) => s === stageParam) ?? ALL
  const client = params.get("client")

  const clientName = new Map(clients.map((c) => [c.id, c.name]))
  const nameOf = (o: Opportunity) => clientName.get(o.clientId) ?? "—"
  const contractOf = (o: Opportunity) => engagements.find((e) => e.id === o.engagementId)

  // The figures are the whole pipeline's; the search, the client and the tabs narrow the deals below.
  const openDeals = opportunities.filter(isOpen)
  const byStage = weightedByStage(opportunities).filter((s) => s.value > 0)
  const next = nextFollowUp(opportunities)
  const nextOverdue = next !== null && isActionOverdue(next, today)
  const overdue = opportunities.filter((o) => isActionOverdue(o, today)).length

  const q = search.trim().toLowerCase()
  const matching = opportunities.filter(
    (o) =>
      (!client || o.clientId === client) &&
      (!q || o.title.toLowerCase().includes(q) || nameOf(o).toLowerCase().includes(q)),
  )
  const open = matching.filter(isOpen).sort(closestToSigning)
  // Won before lost, as the boards draw it; newest first within each, one with no date stamped last.
  const closed = matching
    .filter((o) => !isOpen(o))
    .sort(
      (a, b) =>
        Number(b.stage === "won") - Number(a.stage === "won") ||
        (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0),
    )
  const shownOpen = stage === ALL ? open : open.filter((o) => o.stage === stage)
  const shownClosed = stage === ALL || stage === "closed" ? closed : []
  // On All, the most recently closed ones, whatever their outcome, in the table's usual order (won first).
  const recent = new Set([...closed].sort((a, b) => (b.closedAt ?? b.updatedAt).getTime() - (a.closedAt ?? a.updatedAt).getTime()).slice(0, SUMMARY_ROWS))
  const listedClosed = stage === ALL ? closed.filter((o) => recent.has(o)) : shownClosed
  const won = closed.filter((o) => o.stage === "won").length

  // The clients with a deal, and the one a link filtered by even with none.
  const clientOptions = clients
    .filter((c) => c.id === client || opportunities.some((o) => o.clientId === c.id))
    .map((c) => ({ value: c.id, label: c.name }))

  const edit = (o: Opportunity, from: HTMLElement | null) => {
    opener.current = from
    setEditing(o)
    setFormOpen(true)
  }
  const remove = (o: Opportunity, from: HTMLElement | null) => {
    opener.current = from
    setDeleting(o)
  }
  const newOpportunity = (
    <Button
      size="lg"
      onClick={(e) => {
        opener.current = e.currentTarget
        setEditing(null)
        setFormOpen(true)
      }}
    >
      <Plus aria-hidden />
      New Opportunity
    </Button>
  )
  const showAll = () => {
    setSearch("")
    go({ stage: null, client: null })
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      <PageHeader
        title="Pipeline"
        subtitle="Open opportunities, and what they would be worth if they closed."
        actions={opportunities.length > 0 && newOpportunity}
      />

      {opportunities.length === 0 ? (
        <EmptyPrompt
          title="No opportunities yet"
          description="Log the first one to see it enter the projection."
          action={newOpportunity}
        />
      ) : (
        <>
          <StatStrip
            hero={
              <StatCard
                className="sm:flex-[2_1_440px]"
                label="Weighted pipeline"
                value={
                  <>
                    {eur(weightedPipelineMonthly(opportunities))}
                    <span className="text-[15px] font-medium tracking-normal text-subtle-foreground">/month</span>
                  </>
                }
                detail="if every open deal closes at its probability"
              >
                {byStage.length > 0 && (
                  <>
                    {/* The bar shows the split; the legend beside it says it in words. */}
                    <div
                      role="img"
                      aria-label={`Weighted pipeline by stage, per month: ${byStage.map((s) => `${STAGE_LABELS[s.stage]} ${eur(s.value)}`).join(", ")}.`}
                      className="mt-3 flex h-2 gap-[3px]"
                    >
                      {byStage.map((s) => (
                        <span
                          key={s.stage}
                          className={cn("rounded-[3px]", STAGE_FILL[s.stage as keyof typeof STAGE_FILL])}
                          style={{ flexGrow: s.value }}
                        />
                      ))}
                    </div>
                    <ul aria-hidden className="flex flex-col pt-1 text-sm text-subtle-foreground sm:flex-row sm:flex-wrap sm:gap-x-5 sm:gap-y-1.5 sm:text-meta">
                      {byStage.map((s) => (
                        <li key={s.stage} className="flex min-h-[26px] items-center justify-between gap-3 sm:min-h-0 sm:justify-start sm:gap-[7px]">
                          <span className="inline-flex items-center gap-2 sm:gap-[7px]">
                            <span className={cn("size-2.5 rounded-[3px]", STAGE_FILL[s.stage as keyof typeof STAGE_FILL])} />
                            {STAGE_LABELS[s.stage]}
                          </span>
                          <span className="text-foreground tabular-nums">{eur(s.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </StatCard>
            }
          >
            <StatCard
              label="Open deals"
              value={
                <>
                  {openDeals.length}
                  <span className="text-meta font-normal text-subtle-foreground sm:hidden">
                    {" "}
                    · {eur(openDeals.reduce((sum, o) => sum + monthlyValue(o), 0))} at 100%
                  </span>
                </>
              }
              detail={
                openDeals.length === 0
                  ? "Nothing open right now"
                  : `${eur(openDeals.reduce((sum, o) => sum + monthlyValue(o), 0))}/month ${ifAllClose(openDeals.length)}`
              }
            />
            <StatCard
              label="Next follow-up"
              tone={nextOverdue ? "warning" : undefined}
              value={
                next?.nextActionDate ? (
                  <>
                    {shortDay(next.nextActionDate)}
                    <span className="text-meta font-normal text-subtle-foreground sm:hidden"> · {next.title}</span>
                  </>
                ) : (
                  "None"
                )
              }
              detail={
                next?.nextActionDate ? `${next.title} · ${followUpWhen(next.nextActionDate, today)}` : "No follow-up dates set"
              }
            >
              <p className="text-meta text-subtle-foreground max-sm:hidden">
                <StatusDot tone={overdue > 0 ? "warning" : "success"}>
                  {overdue > 0 ? `${overdue} overdue` : "Nothing overdue"}
                </StatusDot>
              </p>
            </StatCard>
            {/* A phone gives the overdue count its own row. */}
            <StatCard
              className="sm:hidden"
              label="Overdue follow-ups"
              value={
                <span className="text-sm font-normal">
                  <StatusDot tone={overdue > 0 ? "warning" : "success"}>{overdue > 0 ? overdue : "None"}</StatusDot>
                </span>
              }
            />
          </StatStrip>

          {/* On a phone the client select folds into the Filters sheet; the search stays. */}
          <FilterBar
            search={{
              label: "Search deals",
              placeholder: "Search deals or clients…",
              value: search,
              onChange: setSearch,
            }}
            sheet={{ active: client ? 1 : 0 }}
          >
            <FilterSelect
              label="Client"
              allLabel="All clients"
              value={client}
              options={clientOptions}
              onValueChange={(c) => go({ client: c })}
            />
          </FilterBar>

          <StatusTabs
            aria-label="Stage"
            value={stage}
            onValueChange={(s) => go({ stage: s === ALL ? null : s })}
            items={[
              { value: ALL, label: "All", count: matching.length },
              ...OPEN_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s], count: open.filter((o) => o.stage === s).length })),
              { value: "closed", label: "Closed", count: closed.length },
            ]}
          >
            {shownOpen.length === 0 && shownClosed.length === 0 ? (
              <EmptyPrompt
                variant="inline"
                title="No deals match these filters."
                action={
                  <Button variant="outline" onClick={showAll}>
                    Show All
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-col gap-8 sm:gap-11">
                {shownOpen.length > 0 && (
                  <section aria-labelledby="pipeline-open" className="flex flex-col gap-3 sm:gap-4">
                    <SectionHeader
                      id="pipeline-open"
                      title="Open"
                      description={`${plural(shownOpen.length, "deal")} · closest to signing first`}
                    />
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(420px,100%),1fr))] gap-3 sm:gap-5">
                      {shownOpen.map((o) => (
                        <DealCard
                          key={o.id}
                          opportunity={o}
                          clientName={nameOf(o)}
                          overdue={isActionOverdue(o, today)}
                          onEdit={(from) => edit(o, from)}
                          onWin={(from) => {
                            opener.current = from
                            setConverting(o)
                          }}
                          onDelete={(from) => remove(o, from)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {shownClosed.length > 0 && (
                  <section aria-labelledby="pipeline-closed" className="flex flex-col gap-3 sm:gap-4">
                    <SectionHeader
                      id="pipeline-closed"
                      title="Closed"
                      description={`${won} won · ${shownClosed.length - won} lost`}
                    />
                    <ClosedDeals
                      deals={listedClosed}
                      clientName={nameOf}
                      contractOf={contractOf}
                      onEdit={edit}
                      onDelete={remove}
                    />
                    {listedClosed.length < shownClosed.length && (
                      <Button variant="link" className="h-11 justify-start px-0 text-subtle-foreground" onClick={() => go({ stage: "closed" })}>
                        View All Closed ({shownClosed.length})
                      </Button>
                    )}
                  </section>
                )}
              </div>
            )}
          </StatusTabs>
        </>
      )}

      <OpportunityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        opportunity={editing}
        clients={clients}
        onCreateClient={handleCreateClient}
        isPending={createOpportunity.isPending || updateOpportunity.isPending}
        onCloseAutoFocus={restoreFocus}
        onSubmit={(values) => {
          if (editing) {
            // Stamp the close date the first time a deal leaves the open stages, so
            // "how long did this take" stays answerable later.
            const nowClosed = values.stage === "won" || values.stage === "lost"
            const closedAt = nowClosed ? (editing.closedAt ?? new Date()) : null
            updateOpportunity.mutate(
              { id: editing.id, input: { ...values, closedAt } },
              { onSuccess: () => setFormOpen(false) },
            )
          } else {
            createOpportunity.mutate(values, { onSuccess: () => setFormOpen(false) })
          }
        }}
      />

      {/* Winning is explicit: rate and days at signature rarely match the estimate
          made months earlier, so the contract form opens prefilled, not auto-created. */}
      <EngagementFormDialog
        open={!!converting}
        onOpenChange={(open) => !open && setConverting(null)}
        prefill={
          converting
            ? {
                clientId: converting.clientId,
                name: engagementNameFromTitle(converting.title),
                opportunityId: converting.id,
                unit: contractUnit(converting),
                dailyRate: converting.dailyRate,
                vatApplicable: converting.vatApplicable,
                defaultDaysPerMonth: converting.estimatedDaysPerMonth,
                contractedDays:
                  converting.estimatedDaysPerMonth * converting.estimatedDurationMonths,
                ...conversionTerm(converting, format(new Date(), "yyyy-MM")),
              }
            : null
        }
        clients={clients}
        onCreateClient={handleCreateClient}
        isPending={createEngagement.isPending || updateOpportunity.isPending}
        onCloseAutoFocus={restoreFocus}
        onSubmit={(values) => {
          const opportunity = converting
          if (!opportunity) return
          createEngagement.mutate(values, {
            onSuccess: (engagement) => {
              updateOpportunity.mutate({
                id: opportunity.id,
                input: {
                  stage: "won",
                  probability: 100,
                  closedAt: new Date(),
                  engagementId: engagement.id,
                },
              })
              setConverting(null)
            },
          })
        }}
      />

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete Opportunity"
        description={`"${deleting?.title}" will be removed from the pipeline and the weighted projection.`}
        isPending={deleteOpportunity.isPending}
        onCloseAutoFocus={restoreFocus}
        onConfirm={() => {
          if (deleting) {
            deleteOpportunity.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
          }
        }}
      />
    </div>
  )
}

/** Opens a dialog, saying which button it came from: focus goes back there. */
type Opens = (from: HTMLElement | null) => void

/** A deal's Edit and Delete, behind one button named for the deal. */
function DealMenu({ title, onEdit, onDelete, className }: { title: string; onEdit: Opens; onDelete: Opens; className?: string }) {
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="ghost" size="icon-lg" className={className} aria-label={`More actions for ${title}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(trigger.current)}>
          <Pencil aria-hidden /> Edit Opportunity
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(trigger.current)}>
          <Trash2 aria-hidden /> Delete Opportunity
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const TITLE_BUTTON =
  "rounded-sm text-left [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"

interface DealCardProps {
  opportunity: Opportunity
  clientName: string
  overdue: boolean
  onEdit: Opens
  onWin: Opens
  onDelete: Opens
}

/**
 * An open deal: client and stage, the title (it opens the deal), the next step, what it
 * is worth per month at its odds, and how that is worked out. Won is the one action in
 * sight; Edit and Delete wait behind More.
 */
function DealCard({ opportunity: o, clientName, overdue, onEdit, onWin, onDelete }: DealCardProps) {
  const titleId = `deal-${o.id}`
  return (
    <ContentCard labelledBy={titleId} className="flex min-w-0 flex-col gap-3 sm:gap-3.5">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-meta text-muted-foreground [overflow-wrap:anywhere]">{clientName}</span>
        <StatusPill tone={STAGE_TONE[o.stage]} className="shrink-0">
          {STAGE_LABELS[o.stage]}
        </StatusPill>
      </div>
      <h3 id={titleId} className="text-lg leading-snug font-semibold tracking-[-0.01em] sm:text-[19px]">
        <button type="button" aria-haspopup="dialog" onClick={(e) => onEdit(e.currentTarget)} className={TITLE_BUTTON}>
          {o.title}
        </button>
      </h3>
      <MetaRow className="leading-[1.4]">
        {o.nextActionDate || o.nextActionNote ? (
          <StatusDot tone="warning" outline={!overdue}>
            <span className="[overflow-wrap:anywhere]">
              {overdue && <span className="font-medium text-warning-soft-foreground">Overdue · </span>}
              Next: {o.nextActionNote || "follow up"}
              {o.nextActionDate && (
                <>
                  {" · "}
                  <span className="font-mono text-meta">{shortDay(o.nextActionDate)}</span>
                </>
              )}
            </span>
          </StatusDot>
        ) : (
          <StatusDot outline>No follow-up set</StatusDot>
        )}
      </MetaRow>
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-hairline pt-3 text-sm sm:pt-3.5">
        <span className="tabular-nums">
          <span className="font-semibold">{eur(weightedMonthlyValue(o))}</span>
          <span className="text-subtle-foreground">/month weighted</span>
        </span>
        <SegmentedProgress
          done={o.probability / 10}
          total={10}
          text={`${o.probability}%`}
          label={`${o.probability}% likely to close`}
          className="text-meta text-subtle-foreground"
        />
      </div>
      <p className="text-[12.5px] leading-normal text-muted-foreground tabular-nums">
        {eur(monthlyValue(o))}/month at 100% · {countIn(o.estimatedDaysPerMonth, contractUnit(o))} × {contractUnit(o) === "hour" ? rateIn(o.dailyRate, "hour") : eur(o.dailyRate)} ·{" "}
        {plural(o.estimatedDurationMonths, "month")}
        {o.expectedStartMonth ? ` from ${formatYearMonth(o.expectedStartMonth, "MMM yyyy")}` : ", start not set"}
      </p>
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="lg" className="px-3.5" aria-haspopup="dialog" onClick={(e) => onWin(e.currentTarget)} title="Mark as won and create the contract">
          <Trophy aria-hidden />
          Won
        </Button>
        <DealMenu title={o.title} onEdit={onEdit} onDelete={onDelete} className="-mr-2.5" />
      </div>
    </ContentCard>
  )
}

interface ClosedDealsProps {
  deals: Opportunity[]
  clientName: (o: Opportunity) => string
  contractOf: (o: Opportunity) => Engagement | undefined
  onEdit: (o: Opportunity, from: HTMLElement | null) => void
  onDelete: (o: Opportunity, from: HTMLElement | null) => void
}

/**
 * Won and lost deals at full contrast: a table from lg up, a list below (the content column
 * is narrower than the table until then). One is display:none at each width, so a screen
 * reader meets each deal once.
 */
function ClosedDeals({ deals, clientName, contractOf, onEdit, onDelete }: ClosedDealsProps) {
  const closedOn = (o: Opportunity) => (o.closedAt ? format(o.closedAt, "d MMM yyyy") : "—")
  const note = (o: Opportunity, lower = false) => {
    if (o.stage === "lost") return o.lostReason || null
    const contract = contractOf(o)
    if (!contract) return null
    return (
      <>
        {lower ? "became" : "Became"} the contract{" "}
        <Link
          href={`/clients/${o.clientId}#contracts`}
          className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {engagementLabel(contract)}
        </Link>
      </>
    )
  }
  const outcome = (o: Opportunity) => (
    <StatusPill tone={STAGE_TONE[o.stage]}>{STAGE_LABELS[o.stage]}</StatusPill>
  )
  return (
    <DataTableCard>
      <Table className="max-lg:hidden">
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead scope="col">Deal</TableHead>
            <TableHead scope="col">Client</TableHead>
            <TableHead scope="col">Outcome</TableHead>
            <TableHead scope="col" className="text-right">
              Per Month
            </TableHead>
            <TableHead scope="col">Closed</TableHead>
            <TableHead scope="col">Note</TableHead>
            <TableHead scope="col">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((o) => (
            <TableRow key={o.id}>
              <TableHead scope="row" className="h-[52px] text-sm font-medium tracking-normal text-foreground normal-case">
                <button type="button" aria-haspopup="dialog" onClick={(e) => onEdit(o, e.currentTarget)} className={TITLE_BUTTON}>
                  {o.title}
                </button>
              </TableHead>
              <TableCell className="text-subtle-foreground">{clientName(o)}</TableCell>
              <TableCell>{outcome(o)}</TableCell>
              <TableCell className="text-right font-medium">{eur(monthlyValue(o))}</TableCell>
              <TableCell className="whitespace-nowrap text-subtle-foreground">{closedOn(o)}</TableCell>
              <TableCell className="text-subtle-foreground">{note(o) ?? "—"}</TableCell>
              <TableCell className="text-right">
                <DealMenu title={o.title} onEdit={(from) => onEdit(o, from)} onDelete={(from) => onDelete(o, from)} className="-mr-2 size-9 pointer-coarse:size-11" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ul className="divide-y divide-hairline lg:hidden">
        {deals.map((o) => {
          const why = note(o, true)
          return (
            <li key={o.id} className="flex items-start gap-2 py-3 pr-1.5 pl-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={(e) => onEdit(o, e.currentTarget)}
                    className={cn(TITLE_BUTTON, "text-[15px] font-medium")}
                  >
                    {o.title}
                  </button>
                  {outcome(o)}
                </div>
                <span className="text-meta text-muted-foreground">
                  {clientName(o)} · {closedOn(o)}
                </span>
                <span className="text-meta text-subtle-foreground tabular-nums">
                  <span className="font-medium text-foreground">{eur(monthlyValue(o))}</span>/month
                  {why && <> · {why}</>}
                </span>
              </div>
              <DealMenu title={o.title} onEdit={(from) => onEdit(o, from)} onDelete={(from) => onDelete(o, from)} className="-mt-2.5" />
            </li>
          )
        })}
      </ul>
    </DataTableCard>
  )
}
