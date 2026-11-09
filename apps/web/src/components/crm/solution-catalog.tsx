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
import { Plus } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { SolutionFormDialog } from "@/components/crm/solution-form-dialog"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import { useEngagements } from "@/hooks/use-engagements"
import { useSolutions } from "@/hooks/use-solutions"
import { engagementLabel } from "@/lib/engagements"
import {
  SOLUTION_STATUS,
  SOLUTION_STATUSES,
  contractState,
  filledSections,
  filterSolutions,
  shortDay,
  solutionFilters,
  usedStack,
} from "@/lib/solutions"
import { SOLUTION_SECTIONS } from "@/types/schemas"

import type { Engagement, Solution } from "@/types"

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
  const filled = filledSections(s)
  const total = SOLUTION_SECTIONS.length
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
  const { data: solutions = [] } = solutionsQuery
  const { data: clients = [] } = clientsQuery
  const { data: engagements = [] } = engagementsQuery
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

  const gate = legacy ? <PageLoader /> : pageState([solutionsQuery, clientsQuery, engagementsQuery])
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
  const contractOf = (s: Solution) => engagements.find((e) => e.id === s.engagementId)
  // The clients with a solution, and the one a link filtered by even with none yet.
  const clientOptions = clients
    .filter((c) => c.id === filters.client || solutions.some((s) => s.clientId === c.id))
    .map((c) => ({ value: c.id, label: c.name }))
  const stack = usedStack(solutions)
  if (filters.stack && !stack.includes(filters.stack)) stack.push(filters.stack)
  const newSolution = (
    <Button size="lg" onClick={() => setForm(true)}>
      <Plus aria-hidden /> New Solution
    </Button>
  )
  const showAll = () => {
    setSearch("")
    go({ client: null, status: null, stack: null, q: null })
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      <PageHeader
        title="Solutions"
        subtitle="What you built for each client, ready to reuse in pre-sales."
        actions={solutions.length > 0 && newSolution}
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
              placeholder: "Search names, KPIs, history…",
              value: search,
              onChange: (value) => {
                const q = value.trim() || null
                setSearch(value)
                setSent([...sent, q])
                go({ q })
              },
            }}
            sheet={{ active: [filters.client, filters.stack].filter(Boolean).length }}
          >
            <FilterSelect
              label="Client"
              allLabel="All clients"
              value={filters.client}
              options={clientOptions}
              onValueChange={(client) => go({ client })}
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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-5">
                {visible.map((s) => (
                  <SolutionCard
                    key={s.id}
                    solution={s}
                    client={clientName.get(s.clientId) ?? "Unknown client"}
                    contract={contractOf(s)}
                  />
                ))}
              </div>
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
