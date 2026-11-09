"use client"

import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { FilterBar, FilterSelect } from "@alter-ego/ui/page/filter-bar"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { StatusPill, TagChip } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@alter-ego/ui/ui/tabs"
import { ToastAction } from "@alter-ego/ui/ui/toast"
import { toast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { format } from "date-fns"
import { ArrowRight, Check, ChevronDown, CircleCheck, Plus, Undo2 } from "lucide-react"
import Link from "next/link"
import { useId, useMemo, useState, type ComponentProps, type ReactNode } from "react"
import { flushSync } from "react-dom"

import { InvoiceSheet, type InvoiceSheetState } from "@/components/crm/invoice-sheet"
import { MarkPaid } from "@/components/crm/invoice-table"
import { TaskDetailDialog } from "@/components/crm/task-detail-dialog"
import { CalendarMonth, SOURCES } from "@/components/deadlines/calendar-month"
import { DeadlineFormDialog, KIND_LABELS } from "@/components/deadlines/deadline-form-dialog"
import { useAllocations } from "@/hooks/use-allocations"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import {
  useCompanyDeadlines,
  useCreateCompanyDeadline,
  useDeleteCompanyDeadline,
  useUpdateCompanyDeadline,
} from "@/hooks/use-company-deadlines"
import { useEngagements } from "@/hooks/use-engagements"
import { useInvoices, useUpdateInvoice } from "@/hooks/use-invoices"
import { useOpportunities } from "@/hooks/use-opportunities"
import { useTasks, useUpdateTask } from "@/hooks/use-tasks"
import { useTimecards } from "@/hooks/use-timecards"
import { buildCompanyCalendar, groupByPeriod, nextDays, overdueItems, overdueSummary } from "@/lib/company-calendar"
import { computeBurnDown, toRevenueSources } from "@/lib/engagement-burndown"
import { contractUsage, runOutMonth } from "@/lib/engagements"
import { eurCents } from "@/lib/invoices"
import { isModuleOn } from "@/modules"

import type { CalendarItem, CalendarItemSource } from "@/lib/company-calendar"
import type { CompanyDeadline } from "@/types"

/** Far enough ahead to see a contract running out. */
const HORIZON_MONTHS = 24

/** Done shows this many, the most recent, until Show All Done. */
const DONE_SHOWN = 3

/** A non-manual row's chip; your own deadlines show their kind (Tax, Admin…). */
const SOURCE_CHIP: Record<Exclude<CalendarItemSource, "manual">, string> = {
  crm: "Follow-up",
  invoice: "Invoice",
  task: "Task",
  milestone: "Budget",
}

const EYEBROW = "text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"

/**
 * Brings the selected day into view. Out here, not inline: React re-runs a callback ref
 * whose identity changes, so an inline one scrolled back to the day on every render.
 */
const scrollIntoView = (el: HTMLElement | null) => el?.scrollIntoView?.({ block: "nearest", behavior: "smooth" })

const day = (iso: string) => new Date(`${iso}T00:00:00`)

export function DeadlinesShell() {
  const { user } = useAuth()
  const deadlinesQuery = useCompanyDeadlines(user?.id)
  const engagementsQuery = useEngagements(user?.id)
  const opportunitiesQuery = useOpportunities(user?.id)
  const clientsQuery = useClients(user?.id)
  const allocationsQuery = useAllocations(user?.id)
  const invoicesQuery = useInvoices(user?.id)
  const tasksQuery = useTasks(user?.id)
  const timecardsQuery = useTimecards(user?.id)
  const { data: deadlines = [] } = deadlinesQuery
  const { data: engagements = [] } = engagementsQuery
  const { data: opportunities = [] } = opportunitiesQuery
  const { data: clients = [] } = clientsQuery
  const { data: allocations = [] } = allocationsQuery
  // Invoicing left out: the invoices stay unread by the list, so no row, Mark Paid, sheet or figure of theirs exists.
  const hasInvoicing = isModuleOn("invoicing")
  const invoices = useMemo(() => (hasInvoicing ? (invoicesQuery.data ?? []) : []), [hasInvoicing, invoicesQuery.data])
  const { data: tasks = [] } = tasksQuery
  const { data: timecards = [] } = timecardsQuery

  const createDeadline = useCreateCompanyDeadline(user?.id)
  const updateDeadline = useUpdateCompanyDeadline(user?.id)
  const deleteDeadline = useDeleteCompanyDeadline(user?.id)
  const updateInvoice = useUpdateInvoice(user?.id)
  const updateTask = useUpdateTask(user?.id)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CompanyDeadline | null>(null)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [invoiceSheet, setInvoiceSheet] = useState<InvoiceSheetState | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [view, setView] = useState("list")
  const [search, setSearch] = useState("")
  const [source, setSource] = useState<string | null>(null)
  const [allDone, setAllDone] = useState(false)
  const id = useId()

  const today = format(new Date(), "yyyy-MM-dd")
  const fromMonth = today.slice(0, 7)

  const items = useMemo(() => {
    const sources = toRevenueSources({
      engagements,
      opportunities,
      clients,
      scenario: "committed",
    })

    return buildCompanyCalendar({
      deadlines,
      opportunities,
      // A contract worked past its budget has no run-out month (the same rule as the Plan and the MCP tools).
      burnDowns: computeBurnDown({ sources, allocations, fromMonth, months: HORIZON_MONTHS }).map((b) => {
        const engagement = engagements.find((e) => e.id === b.sourceId)
        const usage = engagement && contractUsage({ engagement, timecards, cells: [], today })
        return { ...b, exhaustionMonth: runOutMonth(usage, b.exhaustionMonth) }
      }),
      invoices,
      tasks,
      engagements,
      clients,
      today,
    })
  }, [
    engagements,
    opportunities,
    clients,
    allocations,
    deadlines,
    invoices,
    tasks,
    timecards,
    fromMonth,
    today,
  ])

  function toggleDone(item: CalendarItem) {
    // Paid is a date, not a flag: an unpaid invoice's tick opens Mark Paid (see markPaidFor);
    // Mark Unpaid on a paid one clears its date, and Undo puts that date back.
    if (item.invoiceId) {
      const invoice = invoices.find((i) => i.id === item.invoiceId)
      const paidDate = invoice?.paidDate
      if (!invoice || !paidDate) return
      updateInvoice.mutate(
        { id: invoice.id, input: { paidDate: null } },
        {
          onSuccess: () =>
            toast({
              title: `Invoice ${invoice.number} marked unpaid.`,
              action: (
                <ToastAction
                  altText="Undo"
                  onClick={() => updateInvoice.mutate({ id: invoice.id, input: { paidDate } })}
                >
                  Undo
                </ToastAction>
              ),
            }),
        },
      )
      return
    }
    // Mark Done can file an older row behind Show All Done, so it says so and offers Undo.
    const toggle = (wasDone: boolean, set: (isDone: boolean, onSuccess?: () => void) => void) =>
      set(
        !wasDone,
        wasDone
          ? undefined
          : () =>
              toast({
                title: `${item.label} marked done.`,
                action: (
                  <ToastAction altText="Undo" onClick={() => set(false)}>
                    Undo
                  </ToastAction>
                ),
              }),
      )
    if (item.taskId) {
      const task = tasks.find((t) => t.id === item.taskId)
      if (!task) return
      toggle(task.isDone, (isDone, onSuccess) => updateTask.mutate({ id: task.id, input: { isDone } }, { onSuccess }))
      return
    }
    if (!item.deadlineId) return
    const stored = deadlines.find((d) => d.id === item.deadlineId)
    if (!stored) return
    toggle(stored.isDone, (isDone, onSuccess) => updateDeadline.mutate({ id: stored.id, input: { isDone } }, { onSuccess }))
  }

  /** An unpaid invoice's tick is the same Mark Paid as on /invoices: a date, and its credit notes. */
  const markPaidFor = (item: CalendarItem): MarkPaidProps | undefined => {
    const invoice = item.isDone ? undefined : invoices.find((i) => i.id === item.invoiceId)
    return invoice && { userId: user?.id, invoice, invoices, engagements }
  }

  /** Your own deadlines, tasks and invoices open in their dialog; follow-ups and budgets are derived. */
  const openerFor = (item: CalendarItem): (() => void) | undefined => {
    const stored = deadlines.find((d) => d.id === item.deadlineId)
    if (stored)
      return () => {
        setEditing(stored)
        setFormOpen(true)
      }
    if (item.taskId) return () => setOpenTaskId(item.taskId!)
    if (item.invoiceId) return () => setInvoiceSheet({ kind: "edit", invoiceId: item.invoiceId! })
    return undefined
  }

  const rowFor = (item: CalendarItem, key: string) => (
    <Row
      key={key}
      item={item}
      today={today}
      onOpen={openerFor(item)}
      onToggle={() => toggleDone(item)}
      markPaid={markPaidFor(item)}
      paidOn={item.isDone ? invoices.find((i) => i.id === item.invoiceId)?.paidDate : undefined}
    />
  )

  // The list is derived from all eight: one missing drops its rows.
  const gate = pageState([
    deadlinesQuery,
    engagementsQuery,
    opportunitiesQuery,
    clientsQuery,
    allocationsQuery,
    invoicesQuery,
    tasksQuery,
    timecardsQuery,
  ])
  if (gate) return gate

  // The strip sums everything; the search and the Source filter narrow the list and the calendar.
  const next = nextDays(items, today)
  const q = search.trim().toLowerCase()
  const shown = items.filter(
    (i) => (!source || i.source === source) && (!q || `${i.label} ${i.detail}`.toLowerCase().includes(q)),
  )
  const groups = groupByPeriod(shown, today)
  const dayItems = selectedDate ? shown.filter((i) => i.date === selectedDate) : []
  const clearFilters = () => {
    setSearch("")
    setSource(null)
  }
  const noMatch = (
    <EmptyPrompt
      variant="inline"
      title="No deadlines match these filters."
      action={
        <Button variant="outline" onClick={clearFilters}>
          Show All
        </Button>
      }
    />
  )

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      <PageHeader
        title="Deadlines"
        subtitle={`Your own deadlines, follow-ups, ${hasInvoicing ? "invoice due dates and budgets" : "and budgets"} running out, in one list.`}
        actions={
          <Button
            size="lg"
            aria-haspopup="dialog"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Deadline
          </Button>
        }
      />

      <Tabs value={view} onValueChange={setView} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
          <FilterBar
            className="min-w-0 sm:flex-[1_1_480px]"
            search={{ value: search, onChange: setSearch, label: "Search deadlines", placeholder: "Search deadlines…" }}
            sheet={{ active: source ? 1 : 0 }}
          >
            <FilterSelect
              label="Source"
              value={source}
              allLabel="All sources"
              options={Object.entries(SOURCES)
                .filter(([value]) => hasInvoicing || value !== "invoice")
                .map(([value, s]) => ({ value, label: s.label }))}
              onValueChange={setSource}
            />
          </FilterBar>
          <TabsList aria-label="View" className="grid grid-cols-2 sm:inline-flex">
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
          </TabsList>
        </div>

        {items.length > 0 && (
          <NextDaysStrip
            id={`${id}-next`}
            today={today}
            next={next}
            overdue={overdueItems(items, today)}
            // The strip shows on both views and counts past the filters: the link first brings
            // back the list and every row, so #overdue is on the page when the browser scrolls.
            onOverdue={() =>
              flushSync(() => {
                setView("list")
                clearFilters()
              })
            }
          />
        )}

        <TabsContent value="list" className="mt-3">
          {items.length === 0 ? (
            <EmptyPrompt
              title="Nothing due yet"
              description={`Add a deadline of your own, or give a task${hasInvoicing ? " or an invoice" : ""} a due date: it lands here.`}
            />
          ) : groups.length === 0 ? (
            noMatch
          ) : (
            <ContentCard as="div" padding="none" className="overflow-hidden">
              {groups.map((group, index) => {
                const headingId = `${id}-${group.key}`
                const done = group.key === "done"
                const rows = done && !allDone ? group.items.slice(0, DONE_SHOWN) : group.items
                return (
                  <section
                    key={group.key}
                    id={group.key === "overdue" ? "overdue" : undefined}
                    aria-labelledby={headingId}
                    className="scroll-mt-20"
                  >
                    <div
                      className={cn(
                        "flex items-baseline gap-2.5 bg-muted/50 px-3.5 py-2 sm:px-[22px] sm:py-2.5",
                        index > 0 && "border-t border-hairline",
                      )}
                    >
                      <h2 id={headingId} className={EYEBROW}>
                        {group.title}
                      </h2>
                      <span className="font-mono text-xs text-muted-foreground">{group.items.length}</span>
                      <span className="ml-auto text-meta text-muted-foreground">{group.range}</span>
                    </div>
                    <ul>{rows.map((item, i) => rowFor(item, `${group.key}-${item.date}-${i}`))}</ul>
                    {rows.length < group.items.length && (
                      <div className="border-t border-hairline px-3.5 sm:px-[22px]">
                        <Button
                          variant="ghost"
                          className="-ml-3 h-11 gap-1.5 text-subtle-foreground"
                          onClick={(e) => {
                            // The button goes with the click: focus moves to the first row it brought.
                            const section = e.currentTarget.closest("section")
                            flushSync(() => setAllDone(true))
                            const first = `li:nth-child(${DONE_SHOWN + 1})`
                            section?.querySelector<HTMLElement>(`${first} button, ${first} a`)?.focus()
                          }}
                        >
                          Show All {group.items.length} Done
                          <ChevronDown aria-hidden className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </section>
                )
              })}
            </ContentCard>
          )}
        </TabsContent>

        <TabsContent value="calendar" className="mt-3 flex flex-col gap-6">
          <CalendarMonth items={shown} today={today} selectedDate={selectedDate} onSelectDate={setSelectedDate} />

          {selectedDate && (
            // Below the month on a phone: tapping a day seemed to do nothing. A new key per day re-runs the ref.
            <section key={selectedDate} ref={scrollIntoView} aria-labelledby={`${id}-day`} className="flex flex-col gap-3">
              <h2 id={`${id}-day`} className="text-lg font-semibold tracking-tight">
                {format(day(selectedDate), "EEEE d MMMM yyyy")}
              </h2>
              {dayItems.length === 0 ? (
                <EmptyPrompt variant="inline" title="Nothing on this day." />
              ) : (
                <ContentCard as="div" padding="none" className="overflow-hidden">
                  <ul className="[&>li:first-child]:border-t-0">
                    {dayItems.map((item, i) => rowFor(item, `day-${item.date}-${i}`))}
                  </ul>
                </ContentCard>
              )}
            </section>
          )}
        </TabsContent>
      </Tabs>

      <p className="-mt-2 text-meta text-muted-foreground">
        Only your own deadlines{hasInvoicing && " and invoice due dates"} are stored. Follow-ups and budgets are worked out from the
        pipeline and the plan every time, so they never fall behind.
      </p>

      <DeadlineFormDialog
        key={editing?.id ?? "new"}
        open={formOpen}
        onOpenChange={setFormOpen}
        deadline={editing}
        isPending={createDeadline.isPending || updateDeadline.isPending}
        onSubmit={(values) => {
          if (editing) {
            updateDeadline.mutate({ id: editing.id, input: values }, { onSuccess: () => setFormOpen(false) })
          } else {
            createDeadline.mutate(values, { onSuccess: () => setFormOpen(false) })
          }
        }}
        isDeleting={deleteDeadline.isPending}
        onDelete={
          editing ? () => deleteDeadline.mutate(editing.id, { onSuccess: () => setFormOpen(false) }) : undefined
        }
      />

      <TaskDetailDialog
        userId={user?.id}
        task={tasks.find((t) => t.id === openTaskId) ?? null}
        clients={clients}
        engagements={engagements}
        allLabels={[...new Set(tasks.flatMap((t) => t.labels))].sort()}
        onClose={() => setOpenTaskId(null)}
      />

      {hasInvoicing && <InvoiceSheet userId={user?.id} state={invoiceSheet} onStateChange={setInvoiceSheet} />}
    </div>
  )
}

function NextDaysStrip({
  id,
  today,
  next,
  overdue,
  onOverdue,
}: {
  id: string
  today: string
  next: ReturnType<typeof nextDays>
  overdue: CalendarItem[]
  onOverdue: () => void
}) {
  const hasInvoicing = isModuleOn("invoicing")
  const short = (iso: string) => format(day(iso), "d MMM")
  const deadlines = (n: number) => (
    <>
      {n} <span className="max-sm:hidden">of your </span>
      {n === 1 ? "deadline" : "deadlines"}
    </>
  )
  const overdueFigure = (
    <>
      <span className="text-meta text-muted-foreground">Overdue</span>
      <span className="text-[15.5px] font-semibold tabular-nums sm:text-base">{next.overdue}</span>
      <span className="text-xs text-muted-foreground">{overdueSummary(overdue)}</span>
    </>
  )
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-2 rounded-xl border border-hairline bg-muted/50 px-3.5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-11 sm:gap-y-3.5 sm:px-[22px] sm:py-3.5"
    >
      <div className="flex items-baseline justify-between gap-2 sm:contents">
        <h2 id={id} className={EYEBROW}>
          Next 30 days
        </h2>
        <span className="text-meta text-muted-foreground sm:order-last sm:ml-auto">
          <span className="sm:hidden">to {short(next.to)}</span>
          <span className="max-sm:hidden">
            {short(today)} – {short(next.to)}
          </span>
        </span>
      </div>
      <div className={cn("grid gap-3 sm:contents", hasInvoicing ? "grid-cols-3" : "grid-cols-2")}>
        {hasInvoicing && (
          <Figure label="To collect" detail={count(next.collect.count, "invoice", "invoices")}>
            <SignedAmount amount={next.collect.total} format={eurCents} />
          </Figure>
        )}
        <Figure label="To pay" detail={next.pay.count ? deadlines(next.pay.count) : "Nothing due"}>
          <SignedAmount amount={next.pay.total} kind="out" format={eurCents} />
        </Figure>
        {next.overdue > 0 ? (
          <a
            href="#overdue"
            onClick={onOverdue}
            className="flex min-w-0 flex-col gap-0.5 rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {overdueFigure}
          </a>
        ) : (
          <div className="flex min-w-0 flex-col gap-0.5">{overdueFigure}</div>
        )}
      </div>
    </section>
  )
}

const count = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : "Nothing due")

function Figure({ label, detail, children }: { label: string; detail: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-meta text-muted-foreground">{label}</span>
      <span className="text-[15.5px] font-semibold sm:text-base">{children}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  )
}

type MarkPaidProps = Omit<ComponentProps<typeof MarkPaid>, "children">

interface RowProps {
  item: CalendarItem
  today: string
  /** Opens the item's own dialog: given for your deadlines, tasks and invoices. */
  onOpen?: () => void
  /** Mark Done, Reopen, Mark Unpaid. */
  onToggle: () => void
  /** Given for an unpaid invoice: its tick opens Mark Paid instead of toggling. */
  markPaid?: MarkPaidProps
  /** A paid invoice's day, for its "Paid 9 Oct" pill. */
  paidOn?: Date | null
}

/** The outline tick: "✓ Mark Done" with a mouse, a 44 px circled check on a phone. */
const TICK = "h-9 gap-1.5 px-3 text-[13px] max-sm:-mt-1 max-sm:-mr-1.5 max-sm:size-11 max-sm:rounded-[10px] max-sm:px-0"
/** Reopen, Mark Unpaid, Open Deal: quiet, the same box. */
const QUIET =
  "h-9 gap-1.5 px-3 text-[13px] text-subtle-foreground max-sm:-mt-1 max-sm:-mr-1.5 max-sm:size-11 max-sm:rounded-[10px] max-sm:px-0 max-sm:text-muted-foreground"

/**
 * One hairline row. On a phone the date block, the title with its meta and amount, and a 44 px
 * action sit side by side; from sm up the amount and the action get their own columns, so every
 * row's actions line up. Named by its title: tests find a row by it.
 */
function Row({ item, today, onOpen, onToggle, markPaid, paidOn }: RowProps) {
  const titleId = useId()
  const overdue = !item.isDone && item.date < today
  const date = day(item.date)
  // An invoice brings money in (a credit note takes it back); your own deadline is money out.
  const amount = item.amount === null ? null : item.source === "invoice" ? item.amount : -item.amount
  const title = "text-[15px] leading-[1.4] font-medium [overflow-wrap:anywhere]"
  const label = (text: string) => <span className="max-sm:sr-only">{text}</span>

  let action: ReactNode
  if (item.source === "crm" || item.source === "milestone") {
    const deal = item.source === "crm"
    action = (
      <Button asChild variant="ghost" className={QUIET}>
        <Link href={deal ? `/pipeline?client=${item.clientId}` : "/plan"} aria-describedby={titleId}>
          {label(deal ? "Open Deal" : "Open Plan")}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Button>
    )
  } else if (markPaid) {
    action = (
      <MarkPaid {...markPaid}>
        <Button variant="outline" aria-haspopup="dialog" aria-describedby={titleId} className={TICK}>
          <Check aria-hidden className="size-[15px] max-sm:hidden" />
          <CircleCheck aria-hidden className="size-5 sm:hidden" />
          {label("Mark Paid")}
        </Button>
      </MarkPaid>
    )
  } else if (item.isDone) {
    action = (
      <Button variant="ghost" aria-describedby={titleId} className={QUIET} onClick={onToggle}>
        <Undo2 aria-hidden className="size-4 sm:hidden" />
        {label(item.invoiceId ? "Mark Unpaid" : "Reopen")}
      </Button>
    )
  } else {
    action = (
      <Button variant="outline" aria-describedby={titleId} className={TICK} onClick={onToggle}>
        <Check aria-hidden className="size-[15px] max-sm:hidden" />
        <CircleCheck aria-hidden className="size-5 sm:hidden" />
        {label("Mark Done")}
      </Button>
    )
  }

  return (
    <li
      aria-labelledby={titleId}
      className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-start gap-x-3 border-t border-hairline px-3.5 py-3 sm:grid-cols-[52px_minmax(0,1fr)_128px_136px] sm:items-center sm:gap-x-[18px] sm:px-[22px] sm:py-3.5"
    >
      <span className="row-span-2 flex h-12 flex-col items-center justify-center gap-px rounded-[10px] border border-hairline bg-surface-subtle font-mono sm:row-span-1 sm:h-[52px]">
        <span aria-hidden className="text-[10.5px] leading-3 tracking-[0.04em] text-muted-foreground uppercase">
          {format(date, "MMM")}
        </span>
        <span aria-hidden className="text-base leading-5 font-medium sm:text-lg">
          {format(date, "d")}
        </span>
        {item.date.slice(0, 4) !== today.slice(0, 4) && (
          <span aria-hidden className="text-[10px] leading-3 text-muted-foreground">
            {format(date, "yyyy")}
          </span>
        )}
        <span className="sr-only">{format(date, "d MMMM yyyy")}</span>
      </span>

      <div className="col-start-2 flex min-w-0 flex-col gap-1.5">
        {onOpen ? (
          <button
            id={titleId}
            type="button"
            aria-haspopup="dialog"
            onClick={onOpen}
            className={cn(
              title,
              "self-start rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {item.label}
          </button>
        ) : (
          <span id={titleId} className={title}>
            {item.label}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-meta text-subtle-foreground">
          {overdue && <StatusPill tone="danger">Overdue</StatusPill>}
          {item.isDone && (
            <StatusPill tone="success">
              {/* The year only when it is not this one, as the invoice badges write it. */}
              {paidOn ? `Paid ${format(paidOn, paidOn.getFullYear() === day(today).getFullYear() ? "d MMM" : "d MMM yyyy")}` : "Done"}
            </StatusPill>
          )}
          <TagChip>{item.source === "manual" ? KIND_LABELS[item.kind] : SOURCE_CHIP[item.source]}</TagChip>
          <span className="min-w-0 [overflow-wrap:anywhere]">{item.detail}</span>
        </div>
      </div>

      {amount !== null && (
        <SignedAmount
          amount={amount}
          format={eurCents}
          className="col-start-2 row-start-2 mt-1.5 text-[15px] sm:col-start-3 sm:row-start-1 sm:mt-0 sm:text-right"
        />
      )}

      <div className="col-start-3 row-span-2 row-start-1 flex justify-end sm:col-start-4 sm:row-span-1">{action}</div>
    </li>
  )
}
