"use client"

import { eur } from "@alter-ego/kernel/currency"
import { quarterMonths } from "@alter-ego/kernel/dates"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { MetaRow } from "@alter-ego/ui/page/meta-row"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { StatusTabs } from "@alter-ego/ui/page/status-tabs"
import { Button } from "@alter-ego/ui/ui/button"
import { format } from "date-fns"
import { Plus } from "lucide-react"
import { useRef, useState } from "react"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { CollaboratorCard, type OnContract } from "@/components/crm/collaborator-card"
import { CollaboratorFormDialog } from "@/components/crm/collaborator-form-dialog"
import { useAllocations } from "@/hooks/use-allocations"
import { useAssignments } from "@/hooks/use-assignments"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import {
  useCollaborators,
  useCreateCollaborator,
  useDeleteCollaborator,
  useUpdateCollaborator,
} from "@/hooks/use-collaborators"
import { useCompanyExpenses } from "@/hooks/use-company-expenses"
import { useEngagements } from "@/hooks/use-engagements"
import { useOpportunities } from "@/hooks/use-opportunities"
import { useTimecards } from "@/hooks/use-timecards"
import { countedIn, liveAssignments, onContract, planOver } from "@/lib/assignment-plan"
import { assignmentUsage } from "@/lib/assignments"
import { earlierGapBlock, lastQuarterBlock } from "@/lib/collaborator-invoices"
import { monthlyFees, quarterCost } from "@/lib/collaborators"
import { rateAt, toRevenueSources } from "@/lib/engagement-burndown"
import { engagementLabel } from "@/lib/engagements"
import { buildProjection } from "@/lib/projection"
import { planCells } from "@/lib/timecards"

import type { Assignment, Collaborator, CollaboratorFee } from "@/types"

type Filter = "all" | "active" | "inactive"
const PLAN_MONTHS = 12
const count = (n: number, one: string) => `${n} ${one}`

function quarterOf(date: Date): { year: number; q: 1 | 2 | 3 | 4 } {
  return { year: date.getFullYear(), q: (Math.floor(date.getMonth() / 3) + 1) as 1 | 2 | 3 | 4 }
}

/** The Collaborators page: a strip of what the fixed fees cost, All / Active / Inactive, one card each. */
export function CollaboratorsShell() {
  const { user } = useAuth()
  const collaboratorsQuery = useCollaborators(user?.id)
  // The dialog's preview: the Plan's net with this fee in it, from the Plan's own inputs.
  const clientsQuery = useClients(user?.id)
  const engagementsQuery = useEngagements(user?.id)
  const opportunitiesQuery = useOpportunities(user?.id)
  const allocationsQuery = useAllocations(user?.id)
  const expensesQuery = useCompanyExpenses(user?.id)
  const assignmentsQuery = useAssignments(user?.id)
  const timecardsQuery = useTimecards(user?.id)
  const { data: collaborators = [] } = collaboratorsQuery
  const { data: clients = [] } = clientsQuery
  const { data: engagements = [] } = engagementsQuery
  const { data: opportunities = [] } = opportunitiesQuery
  const { data: allocations = [] } = allocationsQuery
  const { data: expenses = [] } = expensesQuery
  const { data: assignments = [] } = assignmentsQuery
  const { data: timecards = [] } = timecardsQuery

  const createCollaborator = useCreateCollaborator(user?.id)
  const updateCollaborator = useUpdateCollaborator(user?.id)
  const deleteCollaborator = useDeleteCollaborator(user?.id)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Collaborator | null>(null)
  const [deleting, setDeleting] = useState<Collaborator | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  // No DialogTrigger: focus goes back by hand to the button that opened a dialog (a card's More).
  const opener = useRef<HTMLElement | null>(null)
  const restoreFocus = (event: Event) => {
    if (!opener.current?.isConnected) return
    event.preventDefault()
    opener.current.focus()
  }

  const gate = pageState([collaboratorsQuery, clientsQuery, engagementsQuery, opportunitiesQuery, allocationsQuery, expensesQuery, assignmentsQuery, timecardsQuery])
  if (gate) return gate

  const now = new Date()
  const currentMonth = format(now, "yyyy-MM")
  const thisQuarter = quarterOf(now)
  const nextQuarter = quarterOf(new Date(now.getFullYear(), now.getMonth() + 3, 1))
  const active = collaborators.filter((c) => c.isActive)
  const shown = filter === "all" ? collaborators : collaborators.filter((c) => c.isActive === (filter === "active"))

  /** The Plan's net, next 12 months, committed contracts only, with the draft in place of what is stored. */
  const planNet = (draft: { isActive: boolean; fee: CollaboratorFee | null }) => {
    const others = collaborators.filter((c) => c.id !== editing?.id)
    const me = { ...(editing ?? { id: "draft", userId: "", name: "", type: "company" as const, notes: null, createdAt: now, updatedAt: now }), ...draft }
    const months = buildProjection({
      sources: toRevenueSources({ engagements, opportunities, clients, scenario: "committed" }),
      allocations,
      fromMonth: currentMonth,
      months: PLAN_MONTHS,
      companyExpenses: expenses,
      collaborators: [...others, me],
      assignments,
    })
    return months.reduce((sum, m) => sum + m.revenue - m.costs, 0)
  }

  const today = format(now, "yyyy-MM-dd")
  const cells = planCells(engagements, allocations, currentMonth)
  const rate = (a: Assignment, m: string) => {
    const e = engagements.find((x) => x.id === a.engagementId)
    return e ? rateAt(e, m) : 0
  }
  const live = liveAssignments(assignments, collaborators)
  const onContracts = (c: Collaborator): OnContract[] =>
    assignments.flatMap((a) => {
      const e = engagements.find((x) => x.id === a.engagementId)
      if (a.collaboratorId !== c.id || !e) return []
      const client = clients.find((x) => x.id === e.clientId)?.name
      return [{ assignment: a, engagement: e, name: `${client ?? ""} · ${engagementLabel(e)}`, usage: assignmentUsage(a, e, timecards, today, countedIn(a, onContract(live, e.id), cells, currentMonth)) }]
    })
  const variable = (c: Collaborator) => {
    const mine = assignments.filter((a) => a.collaboratorId === c.id)
    const of = (r: { year: number; q: 1 | 2 | 3 | 4 }) => planOver(mine, cells, quarterMonths(r.year, r.q), rate, live)
    return { thisQuarter: of(thisQuarter), nextQuarter: of(nextQuarter) }
  }

  const invoiced = new Map(collaborators.map((c) => [c.id, lastQuarterBlock(c, { assignments, timecards, expenses, today })]))
  const earlier = new Map(collaborators.map((c) => [c.id, earlierGapBlock(c, { assignments, timecards, expenses, today })]))
  const notInvoiced = [...invoiced.values(), ...earlier.values()].reduce((s, b) => s + (b?.gap ?? 0), 0)

  const open = (c: Collaborator | null, from: HTMLElement | null) => {
    opener.current = from
    setEditing(c)
    setFormOpen(true)
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      <PageHeader
        title="Collaborators"
        subtitle={
          <>
            <span className="max-sm:hidden">The freelancers and companies the company pays, and what they cost.</span>
            <span className="sm:hidden">What they cost the company.</span>
          </>
        }
        actions={
          <Button size="lg" aria-haspopup="dialog" aria-label="New Collaborator" onClick={(ev) => open(null, ev.currentTarget)}>
            <Plus aria-hidden />
            <span aria-hidden className="max-sm:hidden">New Collaborator</span>
            <span aria-hidden className="sm:hidden">New</span>
          </Button>
        }
      />

      {collaborators.length === 0 ? (
        <EmptyPrompt title="No collaborators yet" description="Add a freelancer or a company you pay, with the fixed fee they bill each month." />
      ) : (
        <>
          <div className="rounded-xl border border-hairline bg-sidebar px-4 py-3.5 sm:px-[18px]">
            <MetaRow className="gap-x-7 gap-y-2 text-foreground max-sm:flex-col max-sm:items-start">
              <span className="font-medium">{count(active.length, "active")}</span>
              <span className="tabular-nums text-subtle-foreground max-sm:hidden">
                <span className="text-foreground">{eur(monthlyFees(collaborators, currentMonth))}</span> a month in fixed fees
              </span>
              <span className="tabular-nums text-subtle-foreground">
                <span className="text-foreground">{eur(active.reduce((s, c) => s + quarterCost(c, thisQuarter.year, thisQuarter.q) + variable(c).thisQuarter.cost, 0))}</span>{" "}
                this quarter<span className="max-sm:hidden">, Q{thisQuarter.q} {thisQuarter.year}</span>
              </span>
              {notInvoiced > 0 && (
                <span className="tabular-nums font-medium text-warning-soft-foreground">{eur(notInvoiced)} not invoiced yet</span>
              )}
            </MetaRow>
          </div>

          <StatusTabs
            aria-label="Status"
            value={filter}
            onValueChange={(v) => setFilter(v as Filter)}
            items={[
              { value: "all", label: "All", count: collaborators.length },
              { value: "active", label: "Active", count: active.length },
              { value: "inactive", label: "Inactive", count: collaborators.length - active.length },
            ]}
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(420px,100%),1fr))] gap-3 sm:gap-5">
              {shown.map((c) => (
                <CollaboratorCard
                  key={c.id}
                  collaborator={c}
                  onContracts={onContracts(c)}
                  variable={variable(c)}
                  invoiced={invoiced.get(c.id)}
                  earlier={earlier.get(c.id)}
                  currentMonth={currentMonth}
                  thisQuarter={thisQuarter}
                  nextQuarter={nextQuarter}
                  onEdit={(from) => open(c, from)}
                  onDelete={(from) => {
                    opener.current = from
                    setDeleting(c)
                  }}
                />
              ))}
            </div>
          </StatusTabs>
        </>
      )}

      <CollaboratorFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onCloseAutoFocus={restoreFocus}
        collaborator={editing}
        isPending={createCollaborator.isPending || updateCollaborator.isPending}
        planNet={planNet}
        onDelete={editing ? () => { setFormOpen(false); setDeleting(editing) } : undefined}
        onSubmit={(values) => {
          if (editing) updateCollaborator.mutate({ id: editing.id, input: values }, { onSuccess: () => setFormOpen(false) })
          else createCollaborator.mutate(values, { onSuccess: () => setFormOpen(false) })
        }}
      />

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onCloseAutoFocus={restoreFocus}
        title="Delete Collaborator"
        description={deleting ? `"${deleting.name}" is deleted, and its fixed fee leaves the Plan.` : ""}
        isPending={deleteCollaborator.isPending}
        onConfirm={() => {
          if (deleting) deleteCollaborator.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }}
      />
    </div>
  )
}
