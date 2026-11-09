"use client"

import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { FilterBar } from "@alter-ego/ui/page/filter-bar"
import { MetaRow, StatusDot } from "@alter-ego/ui/page/meta-row"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { StatusTabs } from "@alter-ego/ui/page/status-tabs"
import { Button } from "@alter-ego/ui/ui/button"
import { format } from "date-fns"
import { Plus } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useMemo, useRef, useState } from "react"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { ClientCard, clientStatus, monthlyAtPlan } from "@/components/crm/client-card"
import { ClientFormDialog } from "@/components/crm/client-form-dialog"
import { useContractActions } from "@/components/crm/contract-card"
import { useAllocations } from "@/hooks/use-allocations"
import { useAuth } from "@/hooks/use-auth"
import {
  useClients,
  useCreateClient,
  useDeleteClient,
  useUpdateClient,
} from "@/hooks/use-clients"
import { useEngagements } from "@/hooks/use-engagements"
import { useInvoices } from "@/hooks/use-invoices"
import { useMeetings } from "@/hooks/use-meetings"
import { useOpportunities } from "@/hooks/use-opportunities"
import { useSolutions } from "@/hooks/use-solutions"
import { useTasks } from "@/hooks/use-tasks"
import { useTimecards } from "@/hooks/use-timecards"
import { computeBurnDown, toRevenueSources } from "@/lib/engagement-burndown"
import { contractUsage, runOutMonth } from "@/lib/engagements"
import { eurCents, invoiceClientId, isInvoiceOverdue, outstanding } from "@/lib/invoices"
import { sortMeetings } from "@/lib/meetings"
import { closestToSigning, isOpen } from "@/lib/opportunities"
import { taskClientId } from "@/lib/tasks"
import { isModuleOn } from "@/modules"

import type { ClientStatus } from "@/components/crm/client-card"
import type { Client } from "@/types"

/** Long enough to see most contracts run out; short enough to stay meaningful. */
const HORIZON_MONTHS = 36
/** The Status tabs' "no filter"; `?status=` holds the others. */
const ALL = "all"
const STATUSES = ["active", "prospect", "inactive"] as const
const TAB_LABEL: Record<ClientStatus, string> = { active: "Active", prospect: "Prospects", inactive: "Inactive" }

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * Deleting a client takes its contracts, opportunities, allocations, tasks,
 * verbali, solutions and invoices with it — the one path that still deletes invoices. That
 * is a lot of data behind one button, so the dialog counts it out instead of
 * describing the cascade in the abstract.
 */
export function describeClientDeletion(
  name: string,
  contracts: number,
  opportunities: number,
  tasks: number,
  meetings: number,
  invoices = 0,
  solutions = 0,
) {
  if (!contracts && !opportunities && !tasks && !meetings && !invoices && !solutions) {
    return `"${name}" is deleted. Nothing else depends on it.`
  }
  const parts: string[] = []
  if (contracts) parts.push(`${contracts} ${contracts === 1 ? "contract" : "contracts"}`)
  if (opportunities) parts.push(`${opportunities} ${opportunities === 1 ? "opportunity" : "opportunities"}`)
  if (tasks) parts.push(`${tasks} ${tasks === 1 ? "task" : "tasks"}`)
  if (meetings) parts.push(`${meetings} ${meetings === 1 ? "meeting" : "meetings"}`)
  if (invoices) parts.push(`${invoices} ${invoices === 1 ? "invoice" : "invoices"}`)
  if (solutions) parts.push(`${solutions} ${solutions === 1 ? "solution" : "solutions"}`)
  const allocations = contracts ? ", plus the contract allocations" : ""
  // Tasks, verbali and solutions carry no revenue, so only contracts or opportunities cost the plan.
  const plan = contracts || opportunities ? " The plan loses the revenue they brought in." : ""
  return `"${name}" is deleted along with ${new Intl.ListFormat("en").format(parts)}${allocations}.${plan}`
}

/**
 * The Clients page (Clients.dc): a line on where the work stands, then a catalog of clients,
 * searched and narrowed by status (`?status=`). Each card leads to the client's page, where its
 * contracts, tasks, meetings and invoices are worked on; here only New Contract, and Edit and
 * Delete on a card.
 */
export function ClientsShell() {
  const { user } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const clientsQuery = useClients(user?.id)
  const engagementsQuery = useEngagements(user?.id)
  const opportunitiesQuery = useOpportunities(user?.id)
  // The burn-down: when a card's contract runs out.
  const allocationsQuery = useAllocations(user?.id)
  const tasksQuery = useTasks(user?.id)
  // Each card's Unpaid and the delete dialog's count; waited for so the figures do not pop in.
  const invoicesQuery = useInvoices(user?.id)
  // Waited for too: each card's last-meeting line must not pop in after the page.
  const meetingsQuery = useMeetings(user?.id)
  // Waited for too: each card's Solutions link and the delete dialog's count read it.
  const solutionsQuery = useSolutions(user?.id)
  // The client page reads the same collection, once, and it shares this cache entry.
  const timecardsQuery = useTimecards(user?.id)
  const { data: clients = [] } = clientsQuery
  const { data: engagements = [] } = engagementsQuery
  const { data: opportunities = [] } = opportunitiesQuery
  const { data: allocations = [] } = allocationsQuery
  const { data: tasks = [] } = tasksQuery
  const { data: invoices = [] } = invoicesQuery
  const { data: meetings = [] } = meetingsQuery
  const { data: solutions = [] } = solutionsQuery
  const { data: timecards = [] } = timecardsQuery

  const createClient = useCreateClient(user?.id)
  const updateClient = useUpdateClient(user?.id)
  const deleteClient = useDeleteClient(user?.id)
  const [clientFormOpen, setClientFormOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [deletingClient, setDeletingClient] = useState<Client | null>(null)
  const [search, setSearch] = useState("")
  // No DialogTrigger on the client dialogs, and a menu item is gone by the time its dialog
  // closes: focus goes back by hand to the button that opened one (a card's More).
  const opener = useRef<HTMLElement | null>(null)
  const restoreFocus = (event: Event) => {
    if (!opener.current?.isConnected) return
    event.preventDefault()
    opener.current.focus()
  }

  // Same resolver the plan uses, so a client card and the projection can never
  // disagree about when a budget runs out.
  const burnDownById = useMemo(() => {
    const sources = toRevenueSources({
      engagements,
      opportunities: [],
      clients,
      scenario: "committed",
    })
    const burnDowns = computeBurnDown({
      sources,
      allocations,
      fromMonth: format(new Date(), "yyyy-MM"),
      months: HORIZON_MONTHS,
    })
    return new Map(burnDowns.map((b) => [b.sourceId, b]))
  }, [engagements, allocations, clients])
  // New Contract, from the header. After the memo: the compiler cannot tell a hook leaves its arguments alone.
  const contracts = useContractActions({ userId: user?.id, clients, engagements, allocations, invoices })

  const gate = pageState([
    clientsQuery,
    engagementsQuery,
    opportunitiesQuery,
    allocationsQuery,
    tasksQuery,
    invoicesQuery,
    meetingsQuery,
    solutionsQuery,
    timecardsQuery,
  ])
  if (gate) return gate

  const currentMonth = format(new Date(), "yyyy-MM")
  const today = format(new Date(), "yyyy-MM-dd")
  const statusParam = params.get("status")
  const tab = STATUSES.find((s) => s === statusParam) ?? ALL
  const setTab = (value: string) => {
    const next = new URLSearchParams(params.toString())
    if (value === ALL) next.delete("status")
    else next.set("status", value)
    const query = next.toString()
    router.replace(query ? `/clients?${query}` : "/clients", { scroll: false })
  }

  const invoicesOf = (id: string) => invoices.filter((i) => invoiceClientId(i, engagements) === id)
  const openTasks = tasks.filter((t) => !t.isDone)
  // The line on top counts the whole book; the search and the tabs narrow the cards only.
  const active = engagements.filter((e) => e.isActive)
  // Summed per client, as each card's Unpaid: a credit note nets within its own client.
  const owed = clients.reduce((sum, c) => sum + outstanding(invoicesOf(c.id)), 0)
  const overdue = invoices.filter((i) => isInvoiceOverdue(i)).length

  const q = search.trim().toLowerCase()
  const matching = clients
    .filter((c) => !q || [c.name, c.vatNumber, c.contactName, c.email].some((f) => f?.toLowerCase().includes(q)))
    .map((c) => ({ client: c, status: clientStatus(c, engagements) }))
  const shown = tab === ALL ? matching : matching.filter((m) => m.status === tab)

  const newClient = (from: HTMLElement) => {
    contracts.cancel()
    opener.current = from
    setEditingClient(null)
    setClientFormOpen(true)
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      <PageHeader
        title="Clients"
        subtitle={isModuleOn("invoicing") ? "Who you work for, what is signed and what is owed." : "Who you work for and what is signed."}
        actions={
          <>
            <Button size="lg" variant="outline" aria-haspopup="dialog" onClick={(ev) => contracts.newContract(ev.currentTarget)}>
              <Plus aria-hidden />
              New Contract
            </Button>
            <Button size="lg" aria-haspopup="dialog" onClick={(ev) => newClient(ev.currentTarget)}>
              <Plus aria-hidden />
              New Client
            </Button>
          </>
        }
      />

      {clients.length === 0 ? (
        <EmptyPrompt title="No clients yet" description="Add one, or log an opportunity and it is created for you." />
      ) : (
        <>
          {/* Where the work stands, in one line: contracts, money, tasks. */}
          <div className="rounded-xl border border-hairline bg-sidebar px-4 py-3.5 sm:px-[18px]">
            <MetaRow className="gap-x-7 gap-y-2 text-foreground max-sm:flex-col max-sm:items-start">
              {/* Two facts on a desktop; one line, joined by "·", on a phone (Clients-phone.dc). */}
              <span className="sm:contents">
                {active.length === 0 ? (
                  <span className="font-medium">No active contracts</span>
                ) : (
                  <>
                    <span className="font-medium">{count(active.length, "active contract")}</span>
                    <span className="tabular-nums text-subtle-foreground">
                      <span className="sm:hidden">{" · "}</span>
                      <span className="text-foreground">
                        {eurCents(active.reduce((sum, e) => sum + monthlyAtPlan(e, currentMonth), 0))}
                      </span>{" "}
                      a month at plan
                    </span>
                  </>
                )}
              </span>
              {isModuleOn("invoicing") && (
                <StatusDot tone={overdue ? "danger" : owed ? "warning" : "success"}>
                  {owed === 0 && overdue === 0 ? (
                    "Nothing owed"
                  ) : (
                    <span className="text-subtle-foreground">
                      <span className="tabular-nums text-foreground">{eurCents(owed)}</span> unpaid,{" "}
                      {overdue ? `${overdue} overdue` : "nothing overdue"} ·{" "}
                      <Link
                        href="/invoices"
                        className="rounded-sm text-foreground underline underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:-my-3 pointer-coarse:py-3"
                      >
                        See Invoices
                      </Link>
                    </span>
                  )}
                </StatusDot>
              )}
              <span className="text-subtle-foreground">
                {count(openTasks.length, "open task")}
                {/* The phone board says whose. */}
                <span className="sm:hidden">
                  {" "}
                  across {count(new Set(openTasks.map((t) => taskClientId(t, engagements))).size, "client")}
                </span>
              </span>
            </MetaRow>
          </div>

          <FilterBar
            search={{
              label: "Search clients",
              // Clients-phone.dc's copy: the desktop board's "…contact or email…" is cut off on a phone.
              placeholder: "Search name, VAT number, contact…",
              value: search,
              onChange: setSearch,
            }}
          />

          <StatusTabs
            aria-label="Status"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: ALL, label: "All", count: matching.length },
              ...STATUSES.map((s) => ({ value: s, label: TAB_LABEL[s], count: matching.filter((m) => m.status === s).length })),
            ]}
          >
            {shown.length === 0 ? (
              <EmptyPrompt
                variant="inline"
                title="No clients match these filters."
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("")
                      setTab(ALL)
                    }}
                  >
                    Show All
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(420px,100%),1fr))] gap-3 sm:gap-5">
                {shown.map(({ client, status }) => (
                  <ClientCard
                    key={client.id}
                    client={client}
                    status={status}
                    contracts={engagements.filter((e) => e.clientId === client.id)}
                    invoices={invoicesOf(client.id)}
                    deals={opportunities.filter((o) => o.clientId === client.id && isOpen(o)).sort(closestToSigning)}
                    openTasks={openTasks.filter((t) => taskClientId(t, engagements) === client.id)}
                    meetings={sortMeetings(meetings.filter((m) => m.clientId === client.id))}
                    solutions={solutions.filter((x) => x.clientId === client.id).length}
                    exhaustionMonth={(id) => {
                      // Worked past the budget: the client page says so and names no month, and so does this.
                      const usage = engagements.find((e) => e.id === id)
                      const u = usage && contractUsage({ engagement: usage, timecards, cells: [], today })
                      return runOutMonth(u, burnDownById.get(id)?.exhaustionMonth ?? null)
                    }}
                    onEdit={(from) => {
                      contracts.cancel()
                      opener.current = from
                      setEditingClient(client)
                      setClientFormOpen(true)
                    }}
                    onDelete={(from) => {
                      contracts.cancel()
                      opener.current = from
                      setDeletingClient(client)
                    }}
                  />
                ))}
              </div>
            )}
          </StatusTabs>
        </>
      )}

      <ClientFormDialog
        open={clientFormOpen}
        onOpenChange={setClientFormOpen}
        onCloseAutoFocus={restoreFocus}
        client={editingClient}
        isPending={createClient.isPending || updateClient.isPending}
        onSubmit={(values) => {
          if (editingClient) {
            updateClient.mutate(
              { id: editingClient.id, input: values },
              { onSuccess: () => setClientFormOpen(false) },
            )
          } else {
            createClient.mutate(values, { onSuccess: () => setClientFormOpen(false) })
          }
        }}
      />

      {contracts.dialogs}

      <ConfirmDeleteDialog
        open={!!deletingClient}
        onOpenChange={(open) => !open && setDeletingClient(null)}
        onCloseAutoFocus={restoreFocus}
        title="Delete Client"
        description={
          deletingClient
            ? describeClientDeletion(
                deletingClient.name,
                engagements.filter((e) => e.clientId === deletingClient.id).length,
                opportunities.filter((o) => o.clientId === deletingClient.id).length,
                tasks.filter((t) => taskClientId(t, engagements) === deletingClient.id).length,
                meetings.filter((m) => m.clientId === deletingClient.id).length,
                invoicesOf(deletingClient.id).length,
                solutions.filter((x) => x.clientId === deletingClient.id).length,
              )
            : ""
        }
        isPending={deleteClient.isPending}
        onConfirm={() => {
          if (deletingClient) {
            deleteClient.mutate(deletingClient.id, { onSuccess: () => setDeletingClient(null) })
          }
        }}
      />
    </div>
  )
}
