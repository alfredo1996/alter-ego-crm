"use client"

import { formatYearMonth, isoDate, quarterMonths } from "@alter-ego/kernel/dates"
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { MetaRow, StatusDot } from "@alter-ego/ui/page/meta-row"
import { OnThisPage } from "@alter-ego/ui/page/on-this-page"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { SegmentedProgress } from "@alter-ego/ui/page/progress"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { StatCard } from "@alter-ego/ui/page/stat-card"
import { StatusPill, TagChip } from "@alter-ego/ui/page/status-pill"
import { Timeline } from "@alter-ego/ui/page/timeline"
import { Button } from "@alter-ego/ui/ui/button"
import { Checkbox } from "@alter-ego/ui/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@alter-ego/ui/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alter-ego/ui/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@alter-ego/ui/ui/table"
import { cn } from "@alter-ego/ui/utils"
import { format, lastDayOfMonth, subMonths } from "date-fns"
import { Check, ChevronDown, ChevronRight, Mail, MoreHorizontal, Pencil, Phone, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { InvoicedChart, invoicedMonths } from "@/components/crm/billing-shell"
import { CLIENT_STATUS, clientStatus } from "@/components/crm/client-card"
import { ClientFormDialog } from "@/components/crm/client-form-dialog"
import { describeClientDeletion } from "@/components/crm/clients-shell"
import { ContractCard, useContractActions } from "@/components/crm/contract-card"
import { InvoiceSheet, type InvoiceSheetState } from "@/components/crm/invoice-sheet"
import { InvoiceTable } from "@/components/crm/invoice-table"
import { MeetingDialog } from "@/components/crm/meeting-dialog"
import { OpportunityFormDialog } from "@/components/crm/opportunity-form-dialog"
import { SolutionCard } from "@/components/crm/solution-catalog"
import { SolutionFormDialog } from "@/components/crm/solution-form-dialog"
import { NewTaskForm, newTaskInitial } from "@/components/crm/task-board"
import { TaskDetailDialog } from "@/components/crm/task-detail-dialog"
import { useAllocations } from "@/hooks/use-allocations"
import { useAssignments } from "@/hooks/use-assignments"
import { useAuth } from "@/hooks/use-auth"
import { useClients, useCreateClient, useDeleteClient, useUpdateClient } from "@/hooks/use-clients"
import { useCollaborators } from "@/hooks/use-collaborators"
import { useEngagements } from "@/hooks/use-engagements"
import { useInvoices } from "@/hooks/use-invoices"
import { useMeetings } from "@/hooks/use-meetings"
import { useCreateOpportunity, useOpportunities } from "@/hooks/use-opportunities"
import { useSolutions } from "@/hooks/use-solutions"
import { useCreateTask, useTasks, useUpdateTask } from "@/hooks/use-tasks"
import { useTimecards } from "@/hooks/use-timecards"
import { liveAssignments, marginPct, onContract } from "@/lib/assignment-plan"
import { loggedDays, marginTable } from "@/lib/assignments"
import { computeBurnDown, rateAt, toRevenueSources } from "@/lib/engagement-burndown"
import { contractUnit, contractUsage, countIn, engagementLabel, hoursToDays, inContractUnit, rateIn, runOutMonth } from "@/lib/engagements"
import {
  clientBilling,
  eurCents,
  invoiceClientId,
  invoicePeriodLabel,
  invoiceSuggestions,
  isInvoiceOverdue,
  outstanding,
  periodMonths,
  plannedBilling,
} from "@/lib/invoices"
import { MEETING_HEALTH, firstLine, formatMeetingDate, healthByContract, sortMeetings } from "@/lib/meetings"
import { STAGE_LABELS, STAGE_TONE, closestToSigning, isActionOverdue, isOpen, monthlyValue, opportunityValue, weightedMonthlyValue } from "@/lib/opportunities"
import { filterSolutions, shortDay } from "@/lib/solutions"
import { isTaskOverdue, sortTasks, statusOf, taskClientId } from "@/lib/tasks"
import { isModuleOn } from "@/modules"

import type { ContractMargin } from "@/components/crm/contract-margin"
import type { ContractUsage } from "@/lib/engagements"
import type { BillingMonth, ClientBilling, InvoiceSuggestion } from "@/lib/invoices"
import type { ContractUnit, Engagement, Invoice, Meeting, Opportunity, Task } from "@/types"
import type { ReactNode } from "react"

/** Each summary section lists this many; a link or a toggle opens the rest. */
const SUMMARY_ROWS = 6

/** Long enough to see most contracts run out; short enough to stay meaningful. */
const HORIZON_MONTHS = 36
const MONEY = "text-right tabular-nums whitespace-nowrap"
/** A task's pill: sentence case like every pill here ("In progress" billing), where the board's headings are Title Case. */
const TASK_PILL = {
  todo: { tone: "neutral", label: "To do" },
  doing: { tone: "warning", label: "In progress" },
  done: { tone: "success", label: "Done" },
} as const

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)
const round = (n: number) => Math.round(n * 100) / 100
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * A client's own page (Client.dc): who they are, what they owe and what is next, then each part of
 * the work under an index: contracts, billing, invoices, tasks, meetings, opportunities and
 * solutions. Billing's figures come from lib/invoices, like /invoices and get_unbilled; contracts
 * open the same dialogs as the Clients list's New Contract (useContractActions).
 */
export function ClientPage({ clientId }: { clientId: string }) {
  const { user } = useAuth()
  const userId = user?.id
  const router = useRouter()
  // A left-out module's parts are not on the page: no section, no index entry, no link into its routes.
  const hasInvoicing = isModuleOn("invoicing")
  const hasSolutions = isModuleOn("solutions")
  const clientsQuery = useClients(userId)
  const engagementsQuery = useEngagements(userId)
  const invoicesQuery = useInvoices(userId)
  const allocationsQuery = useAllocations(userId)
  const timecardsQuery = useTimecards(userId)
  const assignmentsQuery = useAssignments(userId)
  const collaboratorsQuery = useCollaborators(userId)
  const solutionsQuery = useSolutions(userId)
  const opportunitiesQuery = useOpportunities(userId)
  const tasksQuery = useTasks(userId)
  const meetingsQuery = useMeetings(userId)
  const { data: clients = [] } = clientsQuery
  const { data: engagements = [] } = engagementsQuery
  const { data: invoices = [] } = invoicesQuery
  const { data: allocations = [] } = allocationsQuery
  const { data: timecards = [] } = timecardsQuery
  const { data: solutions = [] } = solutionsQuery
  const { data: opportunities = [] } = opportunitiesQuery
  const { data: tasks = [] } = tasksQuery
  const { data: meetings = [] } = meetingsQuery

  const createClient = useCreateClient(userId)
  const updateClient = useUpdateClient(userId)
  const deleteClient = useDeleteClient(userId)
  const createOpportunity = useCreateOpportunity(userId)
  const createTask = useCreateTask(userId)
  const updateTask = useUpdateTask(userId)
  const closedToggle = useRef<HTMLButtonElement>(null)
  const contracts = useContractActions({ userId, clients, engagements, allocations, invoices, fallbackFocus: closedToggle })

  // The one invoice editor: every entry point sets this, nothing edits inline.
  const [sheet, setSheet] = useState<InvoiceSheetState | null>(null)
  const [editingClient, setEditingClient] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [taskForm, setTaskForm] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [showOlderMeetings, setShowOlderMeetings] = useState(false)
  const [showClosedContracts, setShowClosedContracts] = useState(false)
  // { meeting: null } = a new verbale; null = the dialog is closed.
  const [meetingOpen, setMeetingOpen] = useState<{ meeting: Meeting | null } | null>(null)
  const [opportunityForm, setOpportunityForm] = useState(false)
  const [solutionForm, setSolutionForm] = useState(false)
  const moreButton = useRef<HTMLButtonElement>(null)

  // Hours after today are scheduled: they count from their day on.
  const today = isoDate(new Date())
  const currentMonth = today.slice(0, 7)
  const own = useMemo(
    () => engagements.filter((e) => e.clientId === clientId).sort((a, b) => Number(b.isActive) - Number(a.isActive)),
    [engagements, clientId],
  )
  const billing = useMemo(
    () => clientBilling({ clientId, engagements, timecards, invoices, today }),
    [clientId, engagements, timecards, invoices, today],
  )
  // The plan's resolver, as on Clients and Plan: a card and the projection agree on when days run out.
  const burnDownById = useMemo(() => {
    const sources = toRevenueSources({ engagements: own, opportunities: [], clients, scenario: "committed" })
    const burnDowns = computeBurnDown({ sources, allocations, fromMonth: currentMonth, months: HORIZON_MONTHS })
    return new Map(burnDowns.map((b) => [b.sourceId, b]))
  }, [own, clients, allocations, currentMonth])

  const gate = pageState([
    clientsQuery,
    engagementsQuery,
    invoicesQuery,
    allocationsQuery,
    timecardsQuery,
    assignmentsQuery,
    collaboratorsQuery,
    solutionsQuery,
    opportunitiesQuery,
    tasksQuery,
    meetingsQuery,
  ])
  const loaded = gate === null
  useEffect(() => {
    // Next scrolls to #invoices once, on arrival, while the spinner still stands
    // in for the sections: scroll again once they exist.
    if (loaded && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  }, [loaded])
  if (gate) return gate

  const client = clients.find((c) => c.id === clientId)
  if (!client) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">Client not found.</p>
        <Button asChild variant="link" className="mt-2">
          <Link href="/clients">Back to Clients</Link>
        </Button>
      </div>
    )
  }

  const clientInvoices = invoices.filter((i) => invoiceClientId(i, engagements) === client.id)
  const owed = outstanding(clientInvoices)
  const overdue = clientInvoices.filter((i) => isInvoiceOverdue(i)).length
  const unpaid = clientInvoices.filter((i) => !i.paidDate && i.amount > 0).length
  const active = own.filter((e) => e.isActive)
  const status = clientStatus(client, own)
  const atPlan = sum(active.map((e) => e.defaultDaysPerMonth * rateAt(e, currentMonth)))
  const planned = new Map(own.map((e) => [e.id, plannedBilling({ engagement: e, allocations, currentMonth, months: 3 })]))
  const usage = new Map(
    own.map((e) => [e.id, contractUsage({ engagement: e, timecards, cells: burnDownById.get(e.id)?.cells ?? [], today })]),
  )
  // Margin over the current quarter. The client's line rolls up every contract it has (a contract
  // with nobody on it costs 0); a contract shows its own table once it has a collaborator or logged days.
  const quarter = Math.floor((Number(currentMonth.slice(5)) - 1) / 3) + 1
  const quarterLabel = `Q${quarter} ${currentMonth.slice(0, 4)}`
  const allCollaborators = collaboratorsQuery.data ?? []
  const everyAssignment = assignmentsQuery.data ?? []
  const live = liveAssignments(everyAssignment, allCollaborators)
  const margins = new Map(
    own.map((e) => {
      const { rows, total } = marginTable({
        engagement: e,
        assignments: onContract(everyAssignment, e.id),
        live: onContract(live, e.id),
        cells: new Map((burnDownById.get(e.id)?.cells ?? []).map((c) => [c.yearMonth, c])),
        timecards,
        months: quarterMonths(Number(currentMonth.slice(0, 4)), quarter as 1 | 2 | 3 | 4),
        today,
      })
      // Everyone who has an assignment on it or logged days on it, by name.
      const people = allCollaborators.filter(
        (c) => everyAssignment.some((a) => a.engagementId === e.id && a.collaboratorId === c.id) || loggedDays(timecards, e.id, c.id) > 0,
      )
      const ofPerson = (id: string | null) => loggedDays(timecards, e.id, id)
      const margin: ContractMargin = {
        quarter: quarterLabel,
        rows,
        total,
        unit: contractUnit(e),
        hasPeople: people.length > 0,
        herName: people.length === 1 ? people[0].name : "Collaborators",
        used: [{ name: "you", days: ofPerson(null) }, ...people.map((c) => ({ name: c.name, days: ofPerson(c.id) }))],
      }
      return [e.id, margin] as const
    }),
  )
  const clientMargin = [...margins.values()].reduce(
    (t, m) => ({ revenue: t.revenue + m.total.revenue, margin: t.margin + m.total.margin }),
    { revenue: 0, margin: 0 },
  )
  const anyPeople = [...margins.values()].some((m) => m.hasPeople)
  const soFar = billing.months.find((m) => m.yearMonth === currentMonth)?.contracts ?? []
  const planThisMonth = own.flatMap((e) => (planned.get(e.id) ?? []).filter((p) => p.yearMonth === currentMonth))
  // Largest first; they add up to what is ready to invoice.
  const ready = invoiceSuggestions(billing).sort((a, b) => b.amount - a.amount)
  const clientMeetings = sortMeetings(meetings.filter((m) => m.clientId === client.id))
  const healthById = healthByContract(meetings)
  const clientTasks = sortTasks(tasks.filter((t) => taskClientId(t, engagements) === client.id))
  const openTasks = clientTasks.filter((t) => !t.isDone)
  const doneTasks = clientTasks.filter((t) => t.isDone)
  const clientOpportunities = opportunities.filter((o) => o.clientId === client.id)
  const openDeals = clientOpportunities.filter(isOpen).sort(closestToSigning)
  const closedDeals = clientOpportunities
    .filter((o) => !isOpen(o))
    .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0))
  const won = closedDeals.filter((o) => o.stage === "won").length
  // Most recently updated first, as the Solutions page lists them: the six shown are the ones View All starts with.
  const clientSolutions = filterSolutions(solutions, { client: client.id, status: null, stack: null })
  const engagementById = new Map(engagements.map((e) => [e.id, e]))
  // Since the first month anything shows: a record added later still dates from its contract, deal or hours.
  const since = [
    format(client.createdAt, "yyyy-MM"),
    ...own.flatMap((e) => (e.startMonth ? [e.startMonth] : [])),
    ...closedDeals.flatMap((o) => (o.stage === "won" && o.closedAt ? [format(o.closedAt, "yyyy-MM")] : [])),
    ...billing.months.map((m) => m.yearMonth),
  ].sort()[0]
  const record = (s: InvoiceSuggestion) =>
    setSheet({ kind: "record", clientId: s.clientId, from: s.fromMonth ?? s.yearMonth, to: s.yearMonth })
  const openInvoice = (invoiceId: string) => setSheet({ kind: "edit", invoiceId })

  const more = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={moreButton} variant="outline" size="icon-lg" className="max-sm:border-transparent" aria-label="More actions">
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
          <Trash2 aria-hidden /> Delete Client
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const section = (id: string, title: string, description: ReactNode, actions: ReactNode, body: ReactNode) => (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-20 flex-col gap-4">
      <SectionHeader id={`${id}-title`} title={title} description={description} actions={actions} />
      {body}
    </section>
  )
  // A phone's header row has room for "New" beside a long title (Client-phone.dc); the name stays whole.
  const add = (label: string, onClick: (el: HTMLButtonElement) => void, phone?: string) => (
    <Button variant="ghost" className="-mr-3 pointer-coarse:min-h-11" aria-label={phone && label} onClick={(e) => onClick(e.currentTarget)}>
      <Plus aria-hidden />
      {phone ? (
        <>
          <span className="sm:hidden">{phone}</span>
          <span className="max-sm:hidden">{label}</span>
        </>
      ) : (
        label
      )}
    </Button>
  )
  /** A section lists its first SUMMARY_ROWS; the header links to the rest. */
  const viewAll = (count: number, href: string, what: string) =>
    count > SUMMARY_ROWS && (
      <Button asChild variant="ghost" className="pointer-coarse:min-h-11">
        <Link href={href}>
          View All<span className="sr-only"> {what}</span> <ChevronRight aria-hidden />
        </Link>
      </Button>
    )
  /** A description whose tail a phone leaves out. */
  const tail = (head: ReactNode, rest: string) => (
    <>
      {head}
      <span className="max-sm:hidden">{rest}</span>
    </>
  )

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      <PageHeader
        size="detail"
        back={{ href: "/clients", label: "Clients", current: client.name }}
        pills={
          <>
            <StatusPill tone={CLIENT_STATUS[status].tone}>{CLIENT_STATUS[status].label}</StatusPill>
            <span className="text-meta text-muted-foreground">Client since {formatYearMonth(since, "MMM yyyy")}</span>
          </>
        }
        title={client.name}
        meta={
          (client.contactName || client.email || client.contactPhone || client.vatNumber || client.notes) && (
            <>
              <MetaRow className="[overflow-wrap:anywhere]">
                {client.contactName && <span>{client.contactName}</span>}
                {client.email && (
                  <a href={`mailto:${client.email}`} className="inline-flex items-center gap-1.5 text-foreground underline underline-offset-4 hover:decoration-2 pointer-coarse:py-2.5">
                    <Mail aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
                    {client.email}
                  </a>
                )}
                {client.contactPhone && (
                  <a href={`tel:${client.contactPhone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-1.5 text-foreground underline underline-offset-4 hover:decoration-2 pointer-coarse:py-2.5">
                    <Phone aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
                    {client.contactPhone}
                  </a>
                )}
                {/* An identifier, so mono (plan §0.4), and labelled, so it does not read as an internal id. */}
                {client.vatNumber && (
                  <span>
                    VAT <span className="font-mono text-meta">{client.vatNumber}</span>
                  </span>
                )}
              </MetaRow>
              {client.notes && <p className="text-[15px] leading-normal whitespace-pre-line [overflow-wrap:anywhere]">{client.notes}</p>}
            </>
          )
        }
        actions={
          <Button variant="outline" size="lg" onClick={() => setEditingClient(true)}>
            <Pencil aria-hidden /> Edit Client
          </Button>
        }
        more={more}
      />

      {/* The state of things in one line: contracts, money, the last call. */}
      <div className="rounded-xl border border-hairline bg-sidebar px-[18px] py-3.5">
        <MetaRow className="gap-x-6 text-foreground">
          <span>
            {active.length === 0 ? (
              <span className="font-medium">No active contract</span>
            ) : (
              <>
                <span className="font-medium">{count(active.length, "active contract")}</span>
                <span className="tabular-nums text-subtle-foreground">
                  {" · "}
                  <span className="font-medium text-foreground">{eurCents(atPlan)}</span> a month at plan
                </span>
              </>
            )}
          </span>
          {anyPeople && (
            <span className="tabular-nums">
              <span className="font-medium">{quarterLabel.split(" ")[0]} margin {marginPct(clientMargin.margin, clientMargin.revenue)}%</span>
              <span className="text-subtle-foreground"> · {eurCents(clientMargin.margin)} on {eurCents(clientMargin.revenue)} billed</span>
            </span>
          )}
          {hasInvoicing && (
            <StatusDot tone={overdue ? "danger" : unpaid ? "warning" : "success"}>
              {unpaid === 0 ? (
                "Nothing owed"
              ) : (
                <span>
                  {count(unpaid, "invoice")} unpaid, {overdue ? `${overdue} overdue` : "nothing overdue"} ·{" "}
                  <a href="#invoices" className="underline underline-offset-4 hover:decoration-2">
                    See Invoices
                  </a>
                </span>
              )}
            </StatusDot>
          )}
          {clientMeetings[0] ? (
            <StatusDot tone={clientMeetings[0].health ? MEETING_HEALTH[clientMeetings[0].health].tone : "neutral"}>
              Last meeting{clientMeetings[0].health && ` ${MEETING_HEALTH[clientMeetings[0].health].label.toLowerCase()}`} ·{" "}
              {formatMeetingDate(clientMeetings[0].date, "d MMM")}
            </StatusDot>
          ) : (
            <StatusDot outline>No meetings yet</StatusDot>
          )}
        </MetaRow>
      </div>

      <Figures
        billing={billing}
        invoices={clientInvoices}
        owed={owed}
        overdue={overdue}
        ready={ready}
        usages={active.flatMap((e) => {
          const u = usage.get(e.id)
          return u ? [{ usage: u, unit: contractUnit(e), exhaustionMonth: runOutMonth(u, burnDownById.get(e.id)?.exhaustionMonth ?? null) }] : []
        })}
        currentMonth={currentMonth}
        invoicing={hasInvoicing}
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-12">
        <OnThisPage
          aria-label="Sections"
          items={[
            { id: "contracts", label: "Contracts", count: own.length },
            ...(hasInvoicing
              ? [
                  { id: "billing", label: "Billing", count: formatYearMonth(currentMonth, "MMM") },
                  { id: "invoices", label: "Invoices", count: clientInvoices.length },
                ]
              : []),
            { id: "tasks", label: "Tasks", count: openTasks.length },
            { id: "meetings", label: "Meetings", count: clientMeetings.length },
            { id: "opportunities", label: "Opportunities", count: clientOpportunities.length },
            ...(hasSolutions ? [{ id: "solutions", label: "Solutions", count: clientSolutions.length }] : []),
          ]}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-8 sm:gap-11">
          {section(
            "contracts",
            "Contracts",
            [active.length && `${active.length} active`, own.length - active.length && `${own.length - active.length} closed`].filter(Boolean).join(" · "),
            add("New Contract", (el) => contracts.newContract(el, client.id)),
            own.length === 0 ? (
              <EmptyPrompt variant="inline" title="No contracts yet." />
            ) : (
              <>
              {active.length === 0 && !showClosedContracts && <EmptyPrompt variant="inline" title="No active contracts." />}
              {(showClosedContracts ? own : active).map((engagement) => (
                <ContractCard
                  key={engagement.id}
                  engagement={engagement}
                  burn={burnDownById.get(engagement.id)}
                  health={healthById.get(engagement.id)}
                  usage={usage.get(engagement.id)}
                  margin={margins.get(engagement.id)?.hasPeople ? margins.get(engagement.id) : undefined}
                  progress={{ line: soFar.find((l) => l.engagementId === engagement.id), planned: planned.get(engagement.id) ?? [] }}
                  actions={contracts.actions}
                />
              ))}
              {own.length > active.length && (
                <Button
                  ref={closedToggle}
                  variant="link"
                  className="h-11 justify-start px-0 text-subtle-foreground"
                  aria-expanded={showClosedContracts}
                  onClick={() => setShowClosedContracts((s) => !s)}
                >
                  {showClosedContracts ? "Hide Closed Contracts" : `Show ${own.length - active.length} Closed Contract${own.length - active.length === 1 ? "" : "s"}`}
                </Button>
              )}
              </>
            ),
          )}

          {hasInvoicing && (<>
          <section id="billing" aria-labelledby="billing-title" className="flex scroll-mt-20 flex-col gap-4">
            <SectionHeader id="billing-title" title="Billing" description="Hours against what you invoiced · net, before VAT" />
            <BillingHero
              billing={billing}
              ready={ready}
              currentMonth={currentMonth}
              thisMonthPlan={sum(planThisMonth.map((p) => p.days))}
              hourly={active.length > 0 && active.every((e) => contractUnit(e) === "hour")}
              thisMonthValue={sum(planThisMonth.map((p) => p.value))}
              onRecord={record}
              onCreate={() => setSheet({ kind: "record", clientId: client.id })}
            />
            <MonthsTable billing={billing} currentMonth={currentMonth} onOpen={openInvoice} />
          </section>

          {/* tabIndex: where the invoice sheet hands focus back when what opened it is gone. */}
          <section id="invoices" tabIndex={-1} aria-labelledby="invoices-title" className="flex scroll-mt-20 flex-col gap-4 outline-none">
            <SectionHeader
              id="invoices-title"
              title="Invoices"
              description={tail(clientInvoices.length, " · open one to edit it or issue a credit note")}
              actions={
                <Button asChild variant="ghost" className="-mr-3 pointer-coarse:min-h-11">
                  <Link href="/invoices">
                    All Invoices <ChevronRight aria-hidden />
                  </Link>
                </Button>
              }
            />
            <InvoiceTable
              userId={userId}
              invoices={clientInvoices}
              engagements={engagements}
              firstMonth={format(subMonths(new Date(), 11), "yyyy-MM")}
              onOpen={openInvoice}
              empty={<EmptyPrompt variant="inline" title="No invoices recorded yet." />}
            />
          </section>
          </>)}

          {section(
            "tasks",
            "Tasks",
            `${openTasks.length} open · ${doneTasks.length} done`,
            add("Add Task", () => setTaskForm(true)),
            clientTasks.length === 0 ? (
              <EmptyPrompt variant="inline" title="No tasks yet." />
            ) : (
              <ContentCard as="div" padding="none" className="overflow-hidden">
                {(openTasks.length > 0 || showDone) && (
                  <ul className="divide-y divide-hairline">
                    {[...openTasks, ...(showDone ? doneTasks : [])].map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        contract={task.engagementId ? engagementById.get(task.engagementId) : undefined}
                        onToggle={(done) => updateTask.mutate({ id: task.id, input: { isDone: done } })}
                        onOpen={() => setOpenTaskId(task.id)}
                      />
                    ))}
                  </ul>
                )}
                {doneTasks.length > 0 && (
                  <button
                    type="button"
                    aria-expanded={showDone}
                    onClick={() => setShowDone((s) => !s)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 px-[18px] text-left text-sm text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none sm:px-[22px]",
                      (openTasks.length > 0 || showDone) && "border-t border-hairline",
                    )}
                  >
                    <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", showDone && "rotate-180")} />
                    {showDone ? "Hide Done Tasks" : `Show Done Tasks (${doneTasks.length})`}
                  </button>
                )}
              </ContentCard>
            ),
          )}

          {section(
            "meetings",
            "Meetings",
            tail(clientMeetings.length, " · newest first"),
            add("Log Meeting", () => setMeetingOpen({ meeting: null })),
            clientMeetings.length === 0 ? (
              <EmptyPrompt variant="inline" title="No meetings yet." />
            ) : (
              <>
              <Timeline
                items={(showOlderMeetings ? clientMeetings : clientMeetings.slice(0, SUMMARY_ROWS)).map((m) => {
                  const rest = m.text.split("\n").map((l) => l.trim()).filter(Boolean).slice(1).join("\n")
                  const contract = m.engagementId ? engagementById.get(m.engagementId) : undefined
                  return {
                    key: m.id,
                    date: `${m.date}${m.time ? ` ${m.time}` : ""}`,
                    tone: m.health ? MEETING_HEALTH[m.health].tone : "neutral",
                    content: (
                      <>
                        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="font-semibold">{firstLine(m.text)}</span>
                          {m.health && <StatusPill tone={MEETING_HEALTH[m.health].tone}>{MEETING_HEALTH[m.health].label}</StatusPill>}
                        </span>
                        {rest && <span className="block whitespace-pre-line text-subtle-foreground">{rest}</span>}
                        <span className="block text-meta text-muted-foreground">{contract ? engagementLabel(contract) : "About the client"}</span>
                      </>
                    ),
                    actions: (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit meeting of ${formatMeetingDate(m.date, "d MMM")}`}
                        onClick={() => setMeetingOpen({ meeting: m })}
                      >
                        <Pencil aria-hidden />
                      </Button>
                    ),
                  }
                })}
              />
              {!showOlderMeetings && clientMeetings.length > SUMMARY_ROWS && (
                <Button variant="link" className="h-11 justify-start px-0 text-subtle-foreground" onClick={() => setShowOlderMeetings(true)}>
                  Show {clientMeetings.length - SUMMARY_ROWS} Older {clientMeetings.length - SUMMARY_ROWS === 1 ? "Meeting" : "Meetings"}
                </Button>
              )}
              </>
            ),
          )}

          {section(
            "opportunities",
            "Opportunities",
            [`${openDeals.length} open`, won && `${won} won`, closedDeals.length - won && `${closedDeals.length - won} lost`].filter(Boolean).join(" · "),
            <>
              {viewAll(clientOpportunities.length, `/pipeline?client=${client.id}`, "opportunities")}
              {add("New Opportunity", () => setOpportunityForm(true), "New")}
            </>,
            clientOpportunities.length === 0 ? (
              <EmptyPrompt variant="inline" title="No opportunities yet." />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4 sm:gap-5">
                {[...openDeals, ...closedDeals].slice(0, SUMMARY_ROWS).map((o) => (
                  <OpportunityCard key={o.id} opportunity={o} contract={o.engagementId ? engagementById.get(o.engagementId) : undefined} />
                ))}
              </div>
            ),
          )}

          {hasSolutions && section(
            "solutions",
            "Solutions",
            tail(clientSolutions.length, " · what you built for them"),
            <>
              {viewAll(clientSolutions.length, `/solutions?client=${client.id}`, "solutions")}
              {add("New Solution", () => setSolutionForm(true), "New")}
            </>,
            clientSolutions.length === 0 ? (
              <EmptyPrompt variant="inline" title="No solutions yet." />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4 sm:gap-5">
                {clientSolutions.slice(0, SUMMARY_ROWS).map((s) => (
                  <SolutionCard
                    key={s.id}
                    solution={s}
                    client={s.domain ?? ""}
                    contract={s.engagementId ? engagementById.get(s.engagementId) : undefined}
                    level={3}
                  />
                ))}
              </div>
            ),
          )}
        </div>
      </div>

      {contracts.dialogs}
      <InvoiceSheet userId={userId} state={sheet} onStateChange={setSheet} />
      <ClientFormDialog
        open={editingClient}
        onOpenChange={setEditingClient}
        client={client}
        isPending={updateClient.isPending}
        onSubmit={(values) => updateClient.mutate({ id: client.id, input: values }, { onSuccess: () => setEditingClient(false) })}
      />
      <ConfirmDeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete Client"
        description={describeClientDeletion(
          client.name,
          own.length,
          clientOpportunities.length,
          clientTasks.length,
          clientMeetings.length,
          clientInvoices.length,
          clientSolutions.length,
        )}
        isPending={deleteClient.isPending}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          moreButton.current?.focus()
        }}
        onConfirm={() => deleteClient.mutate(client.id, { onSuccess: () => router.push("/clients") })}
      />
      <Dialog open={taskForm} onOpenChange={setTaskForm}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
            <DialogDescription>Every task belongs to a client and, if you like, to one of its contracts.</DialogDescription>
          </DialogHeader>
          {/* Mounted only while open, so every opening starts from a blank form. */}
          <NewTaskForm
            clients={clients}
            engagements={engagements}
            initial={newTaskInitial(clients, engagements, client.id, "")}
            isPending={createTask.isPending}
            onCancel={() => setTaskForm(false)}
            onSubmit={(input) => createTask.mutate(input, { onSuccess: () => setTaskForm(false) })}
          />
        </DialogContent>
      </Dialog>
      <TaskDetailDialog
        userId={userId}
        task={tasks.find((t) => t.id === openTaskId) ?? null}
        clients={clients}
        engagements={engagements}
        allLabels={[...new Set(tasks.flatMap((t) => t.labels))].sort()}
        onClose={() => setOpenTaskId(null)}
      />
      <MeetingDialog
        open={!!meetingOpen}
        meeting={meetingOpen?.meeting ?? null}
        userId={userId}
        clientId={client.id}
        clientName={client.name}
        engagementId={null}
        onClose={() => setMeetingOpen(null)}
      />
      <OpportunityFormDialog
        open={opportunityForm}
        onOpenChange={setOpportunityForm}
        defaultClientId={client.id}
        clients={clients}
        onCreateClient={async (name) => (await createClient.mutateAsync({ name })).id}
        isPending={createOpportunity.isPending}
        onSubmit={(values) => createOpportunity.mutate(values, { onSuccess: () => setOpportunityForm(false) })}
      />
      <SolutionFormDialog
        open={solutionForm}
        solution={null}
        solutions={solutions}
        clientId={client.id}
        userId={userId}
        clients={clients}
        engagements={engagements}
        onClose={() => setSolutionForm(false)}
        onCreated={(id) => router.push(`/solutions/${id}`)}
      />
    </div>
  )
}

/**
 * The four figures under the header: billed this year, what is owed, the days left on capped
 * contracts, and the next invoice. Label, value and detail are siblings (tests read label → value).
 */
function Figures({
  billing,
  invoices,
  owed,
  overdue,
  ready,
  usages,
  currentMonth,
  invoicing,
}: {
  billing: ClientBilling
  invoices: Invoice[]
  owed: number
  overdue: number
  ready: InvoiceSuggestion[]
  usages: { usage: ContractUsage; unit: ContractUnit; exhaustionMonth: string | null }[]
  currentMonth: string
  /** Invoicing is on: without it the money figures (billed, unpaid, next invoice) are not shown. */
  invoicing: boolean
}) {
  const year = currentMonth.slice(0, 4)
  const billed = invoices.filter((i) => i.yearMonth.startsWith(year))
  const issued = billed.filter((i) => i.amount > 0)
  const from = issued.map((i) => periodMonths(i)[0]).sort()[0]
  const to = issued.map((i) => i.yearMonth).sort().at(-1)
  // Told in hours only when every capped contract is: days and hours do not add up in one figure.
  const unit: ContractUnit = usages.length > 0 && usages.every((u) => u.unit === "hour") ? "hour" : "day"
  const left = round(inContractUnit(sum(usages.map((u) => u.usage.left)), unit))
  const total = round(inContractUnit(sum(usages.map((u) => u.usage.total)), unit))
  const lastDay = format(lastDayOfMonth(new Date(`${currentMonth}-01T00:00:00`)), "d MMM")
  return (
    // A 2×2 grid on a phone, as drawn (Client-phone.dc), so the values step down a size there.
    <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 max-sm:**:data-[slot=stat-value]:text-[22px]">
      {invoicing && <StatCard
        label={`Billed in ${year}`}
        value={eurCents(sum(billed.map((i) => i.amount)))}
        detail={
          issued.length === 0
            ? "net · no invoices yet"
            : `net · ${count(issued.length, "invoice")}, ${formatYearMonth(from!, "MMM")}${from !== to ? ` to ${formatYearMonth(to!, "MMM")}` : ""}`
        }
      />}
      {invoicing && <StatCard
        label="Unpaid"
        value={eurCents(owed)}
        detail={
          <>
            incl. VAT ·{" "}
            {overdue > 0 ? (
              <a href="#invoices" className="font-medium text-destructive underline-offset-4 hover:underline pointer-coarse:-my-3.5 pointer-coarse:inline-block pointer-coarse:py-3.5">
                {overdue} overdue
              </a>
            ) : (
              "none overdue"
            )}
          </>
        }
      />}
      <StatCard
        label={unit === "hour" ? "Hours left on contracts" : "Days left on contracts"}
        value={usages.length ? count(left, unit) : "—"}
        detail={
          usages.length === 0
            ? "no contract with a day cap"
            : usages.length === 1
              ? `of ${total}${usages[0].exhaustionMonth ? ` · ${usages[0].exhaustionMonth < currentMonth ? "ran" : "runs"} out ${formatYearMonth(usages[0].exhaustionMonth, "MMM yyyy")}` : ""}`
              : `of ${total} across ${usages.length} contracts`
        }
      />
      {invoicing && <StatCard
        label="Next invoice"
        value={ready.length ? eurCents(sum(ready.map((s) => s.amount))) : billing.thisMonth !== null ? eurCents(billing.thisMonth) : "—"}
        detail={
          ready.length === 1
            ? `${invoicePeriodLabel(ready[0])} · ${ready[0].hours} h · ready now`
            : ready.length > 1
              ? `${ready.length} invoices · ready now`
              : billing.thisMonth !== null
                ? `${formatYearMonth(currentMonth, "MMMM")} so far · ${billing.thisMonthHours ?? 0} h · on ${lastDay}`
                : "no hours logged yet"
        }
      />}
    </section>
  )
}

/**
 * What to invoice next, beside six months of invoicing: the ended months' hours with Create Invoice,
 * or with those all invoiced, the month being worked and what the plan says it closes at.
 */
function BillingHero({
  billing,
  ready,
  currentMonth,
  thisMonthPlan,
  hourly,
  thisMonthValue,
  onRecord,
  onCreate,
}: {
  billing: ClientBilling
  ready: InvoiceSuggestion[]
  currentMonth: string
  /** The plan's days and value for the current month, across the contracts. */
  thisMonthPlan: number
  /** Every active contract is in hours: the plan is told in them too. */
  hourly: boolean
  thisMonthValue: number
  onRecord: (s: InvoiceSuggestion) => void
  onCreate: () => void
}) {
  const { toInvoice, loggedSince } = billing
  const month = formatYearMonth(currentMonth, "MMMM")
  const lastDay = format(lastDayOfMonth(new Date(`${currentMonth}-01T00:00:00`)), "d MMM")
  const hours = billing.thisMonthHours ?? 0
  const balance =
    toInvoice === null || loggedSince === null
      ? "No hours logged yet: log them on Plan, or ask Claude (log_time)."
      : loggedSince >= currentMonth
        ? "No ended month logged yet."
        : toInvoice === 0
          ? "Ended months are all invoiced."
          : `Invoiced ${eurCents(-toInvoice)} more than the hours, usually an invoice in advance.`
  const one = ready.length === 1 ? ready[0] : undefined
  return (
    <ContentCard id="ready" as="div" className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {ready.length ? "Ready to invoice" : "Ready to invoice this month"}
        </p>
        <p className="text-[28px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
          {eurCents(ready.length ? sum(ready.map((s) => s.amount)) : (billing.thisMonth ?? 0))}
        </p>
        <p className="text-sm tabular-nums">
          {one
            ? `${invoicePeriodLabel(one)} · ${one.hours} h${one.vat > 0 ? ` · + VAT ${eurCents(one.vat)}` : ""}`
            : ready.length
              ? `${ready.length} invoices · ${round(sum(ready.map((s) => s.hours)))} h`
              : `${formatYearMonth(currentMonth)} · ${hours} h${thisMonthPlan ? (hourly ? ` · ${hours} of ${inContractUnit(thisMonthPlan, "hour")} planned hours` : ` · ${round(hoursToDays(hours))} of ${round(thisMonthPlan)} planned days`) : ""}`}
        </p>
        <p className="text-meta text-subtle-foreground">
          {ready.length
            ? "From the hours in ended months."
            : `${balance}${thisMonthValue > 0 ? ` At plan ${month} closes at ${eurCents(thisMonthValue)} on ${lastDay}.` : ""}`}
        </p>
        {one ? (
          <Button size="lg" className="mt-3" onClick={() => onRecord(one)}>
            <Plus aria-hidden /> Create Invoice
          </Button>
        ) : ready.length ? (
          <ReadyList items={ready} onRecord={onRecord} />
        ) : (
          <Button size="lg" className="mt-3" onClick={onCreate}>
            <Plus aria-hidden /> Create Invoice
          </Button>
        )}
      </div>
      <InvoicedChart
        invoiced={invoicedMonths(billing)}
        currentMonth={currentMonth}
        firstMonth={format(subMonths(new Date(`${currentMonth}-01T00:00:00`), 5), "yyyy-MM")}
        compact
        logged={billing.thisMonth ?? 0}
        // The phone board leaves the chart out: the months below say the same.
        className="w-full shrink-0 max-sm:hidden sm:w-[300px]"
      />
    </ContentCard>
  )
}

type MonthStatus = "current" | "none" | "unbilled" | "midMonth" | "invoiced" | "more"

/** One plain word per month, in this order: a month being worked is never "to invoice". */
function monthStatus(m: BillingMonth, currentMonth: string): MonthStatus {
  if (m.yearMonth === currentMonth) return "current"
  if (m.left === null || m.hours === 0) return "none"
  if (m.unbilled > 0) return "unbilled"
  if (m.partlyLogged) return "midMonth"
  // 0, or covered by another month's invoice (a quarterly one).
  if (m.left >= 0) return "invoiced"
  return "more"
}

function StatusText({ month: m, status }: { month: BillingMonth; status: MonthStatus }) {
  switch (status) {
    case "current":
      return <StatusPill>In progress</StatusPill>
    case "none":
      return <span className="text-muted-foreground">No hours</span>
    case "unbilled":
      return <StatusPill tone="warning">{eurCents(m.unbilled)} to invoice</StatusPill>
    case "midMonth":
      return <span className="text-muted-foreground">Started mid-month</span>
    case "invoiced":
      return <StatusPill tone="success">Invoiced</StatusPill>
    case "more":
      // Muted, not red: usually one invoice covering several months.
      return <span className="text-muted-foreground">{eurCents(-(m.left ?? 0))} more than the hours</span>
  }
}

/** "9/2026 (Apr–Jun)": a share of a longer invoice says so. */
function invoiceLabel(i: Invoice): string {
  const months = periodMonths(i)
  if (months.length === 1) return i.number
  return `${i.number} (${formatYearMonth(months[0], "MMM")}–${formatYearMonth(i.yearMonth, "MMM")})`
}

/** Each month worked against its invoices, newest first, and the total since hours were first logged. */
function MonthsTable({ billing, currentMonth, onOpen }: { billing: ClientBilling; currentMonth: string; onOpen: (invoiceId: string) => void }) {
  const [showOlder, setShowOlder] = useState(false)
  const firstMonth = format(subMonths(new Date(`${currentMonth}-01T00:00:00`), 11), "yyyy-MM")
  const older = billing.months.filter((m) => m.yearMonth < firstMonth).length
  const rows = (showOlder ? billing.months : billing.months.filter((m) => m.yearMonth >= firstMonth)).map((m) => ({
    m,
    status: monthStatus(m, currentMonth),
  }))
  // Tracked months only: what was logged since the first hour, and what was invoiced against it.
  const tracked = billing.months.filter((m) => m.hours !== null)
  const since = billing.loggedSince
  const logged = sum(tracked.map((m) => m.logged ?? 0))
  const invoiced = sum(tracked.map((m) => m.invoiced))
  const left = round(logged - invoiced)
  return (
    <>
      {rows.length > 0 && (
        <DataTableCard>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">Month</TableHead>
                <TableHead scope="col" className="hidden text-right sm:table-cell">Hours</TableHead>
                <TableHead scope="col" className="hidden text-right sm:table-cell">Hours value</TableHead>
                <TableHead scope="col" className="hidden text-right sm:table-cell">Invoiced</TableHead>
                <TableHead scope="col">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ m, status }) => (
                <TableRow key={m.yearMonth}>
                  <TableHead scope="row" className="h-auto py-3 align-top text-sm font-medium tracking-normal text-foreground normal-case">
                    <span className="whitespace-nowrap">{formatYearMonth(m.yearMonth, "MMM yyyy")}</span>
                    {/* The three hidden columns, on one line under the month. */}
                    <span className="block text-xs font-normal text-muted-foreground sm:hidden">
                      {m.hours !== null && `${m.hours} h · ${eurCents(m.logged ?? 0)} worked · `}
                      {eurCents(m.invoiced)} invoiced
                    </span>
                  </TableHead>
                  <TableCell className={cn("hidden align-top sm:table-cell", MONEY)}>{m.hours === null ? "—" : `${m.hours} h`}</TableCell>
                  <TableCell className={cn("hidden align-top sm:table-cell", MONEY)}>{m.logged === null ? "—" : eurCents(m.logged)}</TableCell>
                  <TableCell className={cn("hidden align-top sm:table-cell", MONEY, m.invoices.length === 0 && "text-muted-foreground")}>
                    {m.invoices.length > 0 ? eurCents(m.invoiced) : status === "current" ? "Not yet" : "—"}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <StatusText month={m} status={status} />
                      {m.invoices.map((invoice) => (
                        <Button
                          key={invoice.id}
                          type="button"
                          variant="link"
                          // Underlined like a link from the start: it opens the invoice.
                          className="h-auto p-0 font-mono text-[13px] font-normal text-foreground underline decoration-muted-foreground/40 pointer-coarse:min-h-0"
                          onClick={() => onOpen(invoice.id)}
                        >
                          {invoiceLabel(invoice)}
                          {isInvoiceOverdue(invoice) && <span className="font-sans text-destructive"> overdue</span>}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {since && (
              <TableFooter className="bg-surface-subtle">
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="row" className="text-sm font-medium tracking-normal text-subtle-foreground normal-case">
                    Since {formatYearMonth(since, since.startsWith(currentMonth.slice(0, 4)) ? "MMMM" : "MMMM yyyy")}
                  </TableHead>
                  <TableCell className={cn("hidden text-subtle-foreground sm:table-cell", MONEY)}>{round(sum(tracked.map((m) => m.hours ?? 0)))} h</TableCell>
                  <TableCell className={cn("hidden text-subtle-foreground sm:table-cell", MONEY)}>{eurCents(logged)}</TableCell>
                  <TableCell className={cn("hidden font-semibold sm:table-cell", MONEY)}>{eurCents(invoiced)}</TableCell>
                  <TableCell className="text-sm text-subtle-foreground tabular-nums">
                    {left > 0 ? `${eurCents(left)} still to invoice` : left < 0 ? `${eurCents(-left)} invoiced ahead` : "All invoiced"}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </DataTableCard>
      )}
      {rows.some((r) => r.status === "midMonth") && (
        <p className="text-xs text-muted-foreground">
          Started mid-month: hours begin part-way through the month, and its invoice also pays the days before.
        </p>
      )}
      {older > 0 && !showOlder && (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground underline-offset-4 hover:underline pointer-coarse:min-h-11"
          onClick={() => setShowOlder(true)}
        >
          Show {older} older {older === 1 ? "month" : "months"}
        </button>
      )}
    </>
  )
}

/** A task as a checklist row: done box, title (it opens the task), labels and contract, due date and column. */
function TaskRow({
  task,
  contract,
  onToggle,
  onOpen,
}: {
  task: Task
  contract: Engagement | undefined
  onToggle: (done: boolean) => void
  onOpen: () => void
}) {
  const status = statusOf(task)
  const overdue = isTaskOverdue(task)
  return (
    <li className="flex items-start gap-3 px-[18px] py-3.5 sm:px-[22px]">
      <Checkbox
        className="mt-0.5"
        checked={task.isDone}
        aria-label={`${task.isDone ? "Reopen" : "Complete"} task: ${task.title}`}
        onCheckedChange={(checked) => onToggle(checked === true)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={onOpen}
            className={cn(
              "rounded-sm text-left text-[15px] font-medium [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              task.isDone && "text-muted-foreground",
            )}
          >
            {task.title}
          </button>
          {(task.labels.length > 0 || contract) && (
            <div className="flex flex-wrap items-center gap-1.5 text-meta text-subtle-foreground">
              {task.labels.map((label) => (
                <TagChip key={label}>{label}</TagChip>
              ))}
              {contract && <span className="[overflow-wrap:anywhere]">{engagementLabel(contract)}</span>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 max-sm:flex-row-reverse max-sm:justify-end">
          {task.dueDate && (
            <span className={cn("font-mono text-meta whitespace-nowrap", overdue ? "font-medium text-destructive" : "text-subtle-foreground")}>
              {overdue ? "Overdue · " : "Due "}
              {shortDay(task.dueDate)}
            </span>
          )}
          <StatusPill tone={TASK_PILL[status].tone}>
            {status === "done" && <Check aria-hidden className="mr-1 size-3" />}
            {TASK_PILL[status].label}
          </StatusPill>
        </div>
      </div>
    </li>
  )
}

/**
 * A deal of this client's: open, what it is worth at its odds and the next step; won, the contract it
 * became; lost, why. Its title leads to the Pipeline, where deals are worked.
 */
function OpportunityCard({ opportunity: o, contract }: { opportunity: Opportunity; contract: Engagement | undefined }) {
  const titleId = `opportunity-${o.id}`
  const open = isOpen(o)
  const overdue = isActionOverdue(o, new Date())
  const months = count(o.estimatedDurationMonths, "month")
  return (
    <ContentCard labelledBy={titleId} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-meta text-muted-foreground">
          {open
            ? `${o.expectedStartMonth ? `Starts ${formatYearMonth(o.expectedStartMonth, "MMM yyyy")}` : "Start not set"} · ${months}`
            : `Closed ${o.closedAt ? format(o.closedAt, "d MMM yyyy") : "—"}`}
        </span>
        <StatusPill tone={STAGE_TONE[o.stage]} className="shrink-0">
          {STAGE_LABELS[o.stage]}
        </StatusPill>
      </div>
      <h3 id={titleId} className="text-lg leading-snug font-semibold tracking-[-0.01em]">
        <Link
          href={`/pipeline?client=${o.clientId}${open ? "" : "&stage=closed"}`}
          className="rounded-sm [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {o.title}
        </Link>
      </h3>
      <MetaRow className="leading-[1.4]">
        {open ? (
          o.nextActionDate || o.nextActionNote ? (
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
          )
        ) : o.stage === "won" ? (
          contract ? (
            <StatusDot tone="success">
              <span>
                Became the contract{" "}
                <a href="#contracts" className="text-foreground underline underline-offset-4 hover:decoration-2">
                  {engagementLabel(contract)}
                </a>
              </span>
            </StatusDot>
          ) : (
            <StatusDot tone="success">Won</StatusDot>
          )
        ) : (
          <StatusDot outline>{o.lostReason || "No reason given"}</StatusDot>
        )}
      </MetaRow>
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-hairline pt-3 text-sm">
        <span className="tabular-nums">
          <span className="font-semibold">{eurCents(open ? weightedMonthlyValue(o) : monthlyValue(o))}</span>
          <span className="text-subtle-foreground">{open ? "/month weighted" : "/month"}</span>
        </span>
        {open ? (
          <SegmentedProgress
            done={o.probability / 10}
            total={10}
            text={`${o.probability}%`}
            label={`${o.probability}% likely to close`}
            className="text-meta text-subtle-foreground"
          />
        ) : (
          <span className="text-meta text-subtle-foreground">{months}</span>
        )}
      </div>
      <p className="text-[12.5px] leading-normal text-muted-foreground tabular-nums">
        {rateIn(o.dailyRate, contractUnit(o))} × {countIn(o.estimatedDaysPerMonth, contractUnit(o))}/month
        {open
          ? ` = ${eurCents(monthlyValue(o))} × ${o.probability}% · ${eurCents(opportunityValue(o))} over ${months}`
          : contract?.startMonth
            ? ` · ${formatYearMonth(contract.startMonth, "MMM yyyy")}${contract.endMonth ? ` to ${formatYearMonth(contract.endMonth, "MMM yyyy")}` : ""}`
            : ""}
      </p>
    </ContentCard>
  )
}

/** A client's ready invoices when there are several, one line each with its Create Invoice: the period leads. */
function ReadyList({ items, onRecord }: { items: InvoiceSuggestion[]; onRecord: (s: InvoiceSuggestion) => void }) {
  return (
    <ul className="divide-y text-sm">
      {items.map((s) => (
        // Two lines on a phone, by grid order: the period and how much, then Create Invoice.
        <li
          key={`${s.clientId}-${s.yearMonth}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0 sm:flex sm:flex-wrap"
        >
          <span className="font-medium">
            {invoicePeriodLabel(s)} · {s.hours} h
          </span>
          <span className="text-right tabular-nums sm:text-left">
            <span className="whitespace-nowrap font-medium">{eurCents(s.amount)} net</span>
            {s.vat > 0 && <span className="block whitespace-nowrap text-xs text-muted-foreground sm:inline sm:text-sm"> + VAT {eurCents(s.vat)}</span>}
          </span>
          <Button variant="outline" size="sm" className="col-span-2 justify-self-end sm:ml-auto" onClick={() => onRecord(s)}>
            Create Invoice
          </Button>
        </li>
      ))}
    </ul>
  )
}
