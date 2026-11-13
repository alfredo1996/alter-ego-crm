"use client"

import { ContentCard, stretchedLink } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { FilterBar, FilterSelect } from "@alter-ego/ui/page/filter-bar"
import { StatusDot } from "@alter-ego/ui/page/meta-row"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { PageLoader, pageState } from "@alter-ego/ui/page/page-state"
import { SegmentedProgress } from "@alter-ego/ui/page/progress"
import { StatusPill, TagList } from "@alter-ego/ui/page/status-pill"
import { StatusTabs } from "@alter-ego/ui/page/status-tabs"
import { Button } from "@alter-ego/ui/ui/button"
import { cn } from "@alter-ego/ui/utils"
import { format } from "date-fns"
import { Flag, Plus } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { PresentBanner, PresentButton } from "@/components/crm/present-controls"
import { SolutionFormDialog } from "@/components/crm/solution-form-dialog"
import { STEP_MARK } from "@/components/crm/solution-road"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import { useEngagements } from "@/hooks/use-engagements"
import { useJournal } from "@/hooks/use-journal"
import { useMeetings } from "@/hooks/use-meetings"
import { useOpportunities } from "@/hooks/use-opportunities"
import { usePresent } from "@/hooks/use-present"
import { useSolutions } from "@/hooks/use-solutions"
import { useTimecards } from "@/hooks/use-timecards"
import { engagementLabel } from "@/lib/engagements"
import {
  SOLUTION_STATUS,
  SOLUTION_STATUSES,
  contractState,
  filterSolutions,
  lastActivity,
  missingSections,
  roadRow,
  sectionsFor,
  shortDay,
  solutionContractIds,
  solutionFilters,
  usageSummary,
  usedStack,
} from "@/lib/solutions"


import type { Engagement, Opportunity, Solution } from "@/types"

/** The Status tabs' "no filter". */
const ALL = "all"

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The contract's name and its own state beside a dot, or a hollow Pre-sales. */
function Contract({ contract }: { contract: Engagement | undefined }) {
  if (!contract) return <StatusDot outline>Pre-sales</StatusDot>
  return (
    <StatusDot tone={contract.isActive ? "success" : "neutral"}>
      <span className="[overflow-wrap:anywhere]">
        {engagementLabel(contract)} <span className="text-muted-foreground">· {contractState(contract)}</span>
      </span>
    </StatusDot>
  )
}

/**
 * One solution: client and status, the name, the purpose's opening, the stack, the
 * contract and how much is written. Nothing written yet, it is drawn dashed. The name
 * is the card's one control, a link to the solution's page stretched over the whole card.
 * The client page names the domain in place of the client, and its cards sit under an h2.
 */
export function SolutionCard({
  solution: s,
  client,
  contract,
  level = 2,
}: {
  solution: Solution
  /** The line over the name: the client, or on the client's own page the domain. */
  client: string
  contract: Engagement | undefined
  level?: 2 | 3
}) {
  const Heading = level === 2 ? "h2" : "h3"
  // The kind's own sections, as the solution's page counts them.
  const asked = sectionsFor(s.kind)
  const total = asked.length
  const filled = total - missingSections(s).length
  const purpose = s.sections.purpose?.trim()
  const titleId = `solution-${s.id}`
  const edited = s.updatedAt.getTime() > s.createdAt.getTime()
  return (
    <ContentCard
      labelledBy={titleId}
      variant={filled === 0 ? "dashed" : "default"}
      className="flex min-w-0 flex-col gap-3.5 transition-colors hover:border-border-strong motion-reduce:transition-none"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-meta text-muted-foreground [overflow-wrap:anywhere]">{client}</span>
        <StatusPill tone={SOLUTION_STATUS[s.status].tone} className="shrink-0">
          {SOLUTION_STATUS[s.status].label}
        </StatusPill>
      </div>
      <div className="flex flex-col gap-2">
        <Heading className="text-[19px] leading-snug font-semibold tracking-[-0.01em]">
          <Link
            id={titleId}
            href={`/solutions/${s.id}`}
            className={cn(
              stretchedLink,
              "rounded-sm [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            )}
          >
            {s.name}
          </Link>
        </Heading>
        {purpose ? (
          <p className="line-clamp-3 text-sm leading-[1.55] text-subtle-foreground [overflow-wrap:anywhere]">{purpose}</p>
        ) : (
          <p className="text-sm leading-[1.55] text-muted-foreground italic">No purpose yet. Open it to start the interview.</p>
        )}
      </div>
      {s.stack.length > 0 && <TagList items={s.stack} max={4} />}
      {/* mt-auto: the footers of a row's cards line up whatever the purpose's length. */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2.5 border-t border-hairline pt-3.5 text-meta text-subtle-foreground">
        <Contract contract={contract} />
        <SegmentedProgress done={filled} total={total} label={`${filled} of ${total} sections written`} />
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        {s.entities.length === 0
          ? "No data model yet"
          : `${count(s.entities.length, "entity", "entities")} · ${count(s.relations.length, "relation", "relations")}`}
        {" · "}
        {edited ? `updated ${shortDay(s.updatedAt)}` : `created ${shortDay(s.createdAt)}`}
      </p>
    </ContentCard>
  )
}

/**
 * One solution as a row of the list: client, kind and status over the name and the target; the road as a
 * small track of its steps ending in the flag, with Now and Next (Reached and Result once delivered); then
 * the last activity, the days used and the pipeline, and the stack. Presenting, the days go: no days, no money.
 * The name is the row's one control.
 */
export function SolutionRow({
  solution: s,
  client,
  usage,
  opportunities,
  activity,
  href,
  presenting,
}: {
  solution: Solution
  client: string
  /** The days column ("6.5 of 11 days · 2 steps in the pipeline"); null = none. */
  usage: string | null
  opportunities: Pick<Opportunity, "id" | "stage" | "engagementId">[]
  /** "YYYY-MM-DD" of the newest journal entry or call; null = none. */
  activity: string | null
  href: string
  presenting: boolean
}) {
  const road = roadRow(s.steps, opportunities)
  const titleId = `solution-${s.id}`
  const trackLabel = road.reached ? `All ${road.total} steps done, target reached` : `${road.done} of ${road.total} steps done`
  return (
    <ContentCard labelledBy={titleId} className="grid min-w-0 gap-x-7 gap-y-5 transition-colors hover:border-border-strong motion-reduce:transition-none sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 text-meta text-muted-foreground [overflow-wrap:anywhere]">{client}</span>
          <span className="rounded-full border px-2 py-px text-xs font-medium">{s.kind === "advisory" ? "Advisory" : "Product"}</span>
          <StatusPill tone={SOLUTION_STATUS[s.status].tone}>{SOLUTION_STATUS[s.status].label}</StatusPill>
        </div>
        <h2 className="text-lg leading-snug font-semibold">
          <Link
            id={titleId}
            href={href}
            className={cn(
              stretchedLink,
              "rounded-sm [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            )}
          >
            {s.name}
          </Link>
        </h2>
        {s.target && (
          <p className="flex items-start gap-2 text-sm leading-normal text-subtle-foreground">
            <Flag aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="[overflow-wrap:anywhere]">{s.target}</span>
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {road.total > 0 && (
          <div role="img" aria-label={trackLabel} className="flex items-center">
            {s.steps.map((step, i) => (
              <span key={i} className="contents">
                <span className={cn("size-[18px] shrink-0 rounded-full", STEP_MARK[step.state])} />
                <span className={cn("h-0.5 min-w-3 flex-1", step.state === "done" ? "bg-foreground" : "bg-border")} />
              </span>
            ))}
            <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border", road.reached ? "bg-foreground text-background" : "bg-sidebar")}>
              <Flag aria-hidden className="size-3" />
            </span>
          </div>
        )}
        <div className="flex flex-col gap-1 text-sm">
          {road.reached ? (
            <>
              <span>
                <span className="font-semibold text-success-soft-foreground">Reached:</span> {road.reachedOn ? `Target reached in ${format(new Date(`${road.reachedOn}T00:00:00`), "MMM yyyy")}.` : "Target reached."}
              </span>
              {road.result && (
                <span className="text-subtle-foreground">
                  <span className="font-medium">Result:</span> {road.result}
                </span>
              )}
            </>
          ) : (
            <>
              {road.now && (
                <span>
                  <span className="font-semibold text-warning-soft-foreground">Now:</span> {road.now.title} (step {road.now.number} of {road.total})
                </span>
              )}
              {road.next && (
                <span className="text-subtle-foreground">
                  <span className="font-medium">Next:</span> {road.next}
                </span>
              )}
              {!road.now && !road.next && <span className="text-muted-foreground">{road.total === 0 ? "No steps yet" : "No step in progress"}</span>}
            </>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 text-[13px] text-subtle-foreground sm:max-lg:col-span-2 lg:col-span-1">
        <span>{activity ? `Last activity ${shortDay(new Date(`${activity}T00:00:00`))}` : "No activity yet"}</span>
        {!presenting && usage && <span className="tabular-nums">{usage}</span>}
        {s.stack.length > 0 && <TagList items={s.stack} max={4} />}
      </div>
    </ContentCard>
  )
}

/**
 * The Solutions page: a catalog of every solution built or proposed for a client,
 * newest updated first, searched and narrowed by client, technology and status. The
 * filters and the search live in the URL (?client=, ?stack=, ?status=, ?q=), so the
 * Clients page links straight to a client's solutions. Each card opens its solution's
 * page, /solutions/[id]; an old ?solution=<id> link goes there too.
 */
export function SolutionCatalog() {
  const { user } = useAuth()
  const solutionsQuery = useSolutions(user?.id)
  const clientsQuery = useClients(user?.id)
  const engagementsQuery = useEngagements(user?.id)
  const journalQuery = useJournal(user?.id)
  const meetingsQuery = useMeetings(user?.id)
  const opportunitiesQuery = useOpportunities(user?.id)
  const timecardsQuery = useTimecards(user?.id)
  const { present, href } = usePresent()
  const { data: solutions = [] } = solutionsQuery
  const { data: clients = [] } = clientsQuery
  const { data: engagements = [] } = engagementsQuery
  const { data: journal = [] } = journalQuery
  const { data: meetings = [] } = meetingsQuery
  const { data: opportunities = [] } = opportunitiesQuery
  const { data: timecards = [] } = timecardsQuery
  const router = useRouter()
  const params = useSearchParams()
  // New Solution; a solution is edited on its own page.
  const [form, setForm] = useState(false)
  // The box holds what is typed; the URL follows it, so a keystroke never waits on the router.
  const [search, setSearch] = useState(() => params.get("q") ?? "")
  // A link can change ?q= too (the sidebar's Solutions drops it), and the box follows it then.
  // Not the box's own writes landing late, though: those would undo what was typed since.
  const urlQ = params.get("q")
  const [seenQ, setSeenQ] = useState(urlQ)
  const [sent, setSent] = useState<(string | null)[]>([])
  if (urlQ !== seenQ) {
    setSeenQ(urlQ)
    const echo = sent.lastIndexOf(urlQ)
    if (echo >= 0) setSent(sent.slice(echo + 1))
    else {
      setSent([])
      setSearch(urlQ ?? "")
    }
  }
  // A solution opened in a sheet here, as ?solution=<id>, until it got its own page: old links go to it.
  const legacy = params.get("solution")
  useEffect(() => {
    if (legacy) router.replace(`/solutions/${encodeURIComponent(legacy)}`)
  }, [legacy, router])

  const gate = legacy ? <PageLoader /> : pageState([solutionsQuery, clientsQuery, engagementsQuery, journalQuery, meetingsQuery, opportunitiesQuery, timecardsQuery])
  if (gate) return gate

  const filters = { ...solutionFilters(params), q: search.trim() || null }
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    const query = next.toString()
    router.replace(query ? `/solutions?${query}` : "/solutions", { scroll: false })
  }
  const visible = filterSolutions(solutions, filters)
  // Each tab counts what the other filters leave.
  const anyStatus = filterSolutions(solutions, { ...filters, status: null })
  const clientName = new Map(clients.map((c) => [c.id, c.name]))
  // The clients with a solution, and the one a link filtered by even with none yet.
  const clientOptions = clients
    .filter((c) => c.id === filters.client || solutions.some((s) => s.clientId === c.id))
    .map((c) => ({ value: c.id, label: c.name }))
  const stack = usedStack(solutions)
  if (filters.stack && !stack.includes(filters.stack)) stack.push(filters.stack)
  const newSolution = present ? undefined : (
    <Button size="lg" onClick={() => setForm(true)}>
      <Plus aria-hidden /> New Solution
    </Button>
  )
  const activityOf = (s: Solution) => lastActivity(s.id, solutionContractIds(s, opportunities), journal, meetings)
  const showAll = () => {
    setSearch("")
    go({ client: null, status: null, kind: null, stack: null, q: null })
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      {present && <PresentBanner />}
      <PageHeader
        title="Solutions"
        subtitle="Where each client is going, and how far along the road is."
        actions={
          solutions.length > 0 &&
          !present && (
            <>
              <PresentButton />
              {newSolution}
            </>
          )
        }
      />

      {solutions.length === 0 ? (
        <EmptyPrompt
          title="No solutions yet"
          description="Start one for a client: you fill in its sections as the work goes on."
          action={newSolution}
        />
      ) : (
        <>
          {/* On a phone the two selects fold into the Filters sheet; the search stays. */}
          <FilterBar
            search={{
              label: "Search solutions",
              placeholder: "Search name, target, stack, sections…",
              value: search,
              onChange: (value) => {
                const q = value.trim() || null
                setSearch(value)
                setSent([...sent, q])
                go({ q })
              },
            }}
            sheet={{ active: [filters.client, filters.kind, filters.stack].filter(Boolean).length }}
          >
            <FilterSelect
              label="Client"
              allLabel="All clients"
              value={filters.client}
              options={clientOptions}
              onValueChange={(client) => go({ client })}
            />
            <FilterSelect
              label="Kind"
              allLabel="All kinds"
              value={filters.kind ?? null}
              options={[
                { value: "product", label: "Product" },
                { value: "advisory", label: "Advisory" },
              ]}
              onValueChange={(kind) => go({ kind })}
            />
            <FilterSelect
              label="Stack"
              allLabel="All technologies"
              value={filters.stack}
              options={stack.map((t) => ({ value: t, label: t }))}
              onValueChange={(tag) => go({ stack: tag })}
            />
          </FilterBar>

          <StatusTabs
            aria-label="Status"
            value={filters.status ?? ALL}
            onValueChange={(status) => go({ status: status === ALL ? null : status })}
            items={[
              { value: ALL, label: "All", count: anyStatus.length },
              ...SOLUTION_STATUSES.map((status) => ({
                value: status,
                label: SOLUTION_STATUS[status].label,
                count: anyStatus.filter((s) => s.status === status).length,
              })),
            ]}
          >
            {visible.length === 0 ? (
              <EmptyPrompt
                variant="inline"
                title="No solutions match these filters."
                action={
                  <Button variant="outline" onClick={showAll}>
                    Show All
                  </Button>
                }
              />
            ) : (
              <ol className="flex flex-col gap-3">
                {visible.map((s) => (
                  <li key={s.id}>
                    <SolutionRow
                      solution={s}
                      client={clientName.get(s.clientId) ?? "Unknown client"}
                      usage={usageSummary(s, engagements, opportunities, timecards, format(new Date(), "yyyy-MM-dd"))}
                      opportunities={opportunities}
                      activity={activityOf(s)}
                      href={href(`/solutions/${s.id}`)}
                      presenting={present}
                    />
                  </li>
                ))}
              </ol>
            )}
          </StatusTabs>
        </>
      )}

      <SolutionFormDialog
        open={form}
        solution={null}
        solutions={solutions}
        // Only a client that exists: a stale link must not start a solution for a deleted one.
        clientId={filters.client && clientName.has(filters.client) ? filters.client : null}
        userId={user?.id}
        clients={clients}
        engagements={engagements}
        onClose={() => setForm(false)}
        onCreated={(id) => router.push(`/solutions/${id}`)}
      />
    </div>
  )
}
