"use client"

import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { FilterBar, FilterSelect } from "@alter-ego/ui/page/filter-bar"
import { DOT } from "@alter-ego/ui/page/meta-row"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { StatusTabs } from "@alter-ego/ui/page/status-tabs"
import { Button } from "@alter-ego/ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alter-ego/ui/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@alter-ego/ui/ui/dropdown-menu"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { cn } from "@alter-ego/ui/utils"
import { differenceInCalendarDays } from "date-fns"
import { AlignLeft, CalendarDays, CircleCheck, MoreHorizontal, Plus } from "lucide-react"
import Link from "next/link"
import { useId, useRef, useState } from "react"
import { flushSync } from "react-dom"

import { LabelChip, TaskDetailDialog } from "@/components/crm/task-detail-dialog"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import { useEngagements } from "@/hooks/use-engagements"
import { useCreateTask, useTasks, useUpdateTask } from "@/hooks/use-tasks"
import { engagementLabel } from "@/lib/engagements"
import { shortDay } from "@/lib/solutions"
import {
  TASK_STATUSES,
  isTaskOverdue,
  sortDoneTasks,
  sortTasks,
  statusOf,
  taskClientId,
  taskStatusUpdate,
  usedLabels,
} from "@/lib/tasks"


import type { TaskStatus } from "@/lib/tasks"
import type { Client, CreateTaskInput, Engagement, Task } from "@/types"

/** Filter value meaning "no filter". */
export const ALL = "all"

/** Contract value meaning "none": the Client only filter, the No contract choice. */
export const NO_CONTRACT = "none"

/**
 * The tasks the Client, Contract and Label filters and the search leave; ALL
 * switches a filter off. A client keeps its client-level tasks; a contract never
 * matches them, and NO_CONTRACT matches only them. A label matches whatever its
 * case; the search reads the title and the description.
 */
export function filterBoardTasks(
  tasks: Task[],
  engagements: Pick<Engagement, "id" | "clientId">[],
  clientId: string,
  engagementId: string,
  label: string = ALL,
  query = "",
): Task[] {
  const labelKey = label.toLowerCase()
  const q = query.trim().toLowerCase()
  return tasks.filter(
    (t) =>
      (engagementId === ALL || (t.engagementId ?? NO_CONTRACT) === engagementId) &&
      (clientId === ALL || taskClientId(t, engagements) === clientId) &&
      (label === ALL || t.labels.some((l) => l.toLowerCase() === labelKey)) &&
      (!q || t.title.toLowerCase().includes(q) || !!t.notes?.toLowerCase().includes(q)),
  )
}

/**
 * Where the new-task dialog starts: on the contract the filter picked (and its
 * client), else on the filtered client, else on the only client. Never on a
 * contract nobody picked: like add_task, a task is client-level unless a
 * contract is chosen (#164).
 */
export function newTaskInitial(
  clients: Pick<Client, "id">[],
  engagements: Pick<Engagement, "id" | "clientId">[],
  clientId: string,
  engagementId: string,
): { clientId: string; engagementId: string } {
  const engagement = engagements.find((e) => e.id === engagementId)
  if (engagement) return { clientId: engagement.clientId, engagementId: engagement.id }
  const only = clients.length === 1 ? clients[0].id : ""
  return { clientId: clientId === ALL ? only : clientId, engagementId: NO_CONTRACT }
}

/** Done shows this many, the most recent, until Show All Done. */
const DONE_SHOWN = 10

/** Each column's dot beside its heading, and its line when empty. */
const COLUMN: Record<TaskStatus, { dot: string; empty: string }> = {
  todo: { dot: "border-[1.5px] border-muted-foreground", empty: "Nothing to do." },
  doing: { dot: DOT.warning, empty: "Nothing in progress." },
  done: { dot: DOT.success, empty: "Nothing done yet." },
}

/**
 * Every task across every contract, in three columns. The column is derived by
 * statusOf and every move writes taskStatusUpdate, so the board and the ticks
 * on the client's page (/clients/[id]) can never disagree. The ··· menu on each
 * card is the move control; dragging is an extra for a mouse, since HTML5 drag
 * fires nothing on touch screens. A click on a card, or Enter/Space on its
 * title, opens it in TaskDetailDialog. A phone shows one column at a time
 * behind Status tabs; the others are hidden by CSS, never unmounted. The tabs
 * have no panel of their own, each points at its column: from sm up they are
 * gone, and nothing focusable or named after them is left around the columns.
 */
export function TaskBoard() {
  const { user } = useAuth()
  const tasksQuery = useTasks(user?.id)
  const engagementsQuery = useEngagements(user?.id)
  const clientsQuery = useClients(user?.id)
  const { data: tasks = [] } = tasksQuery
  const { data: engagements = [] } = engagementsQuery
  const { data: clients = [] } = clientsQuery
  const createTask = useCreateTask(user?.id)
  const updateTask = useUpdateTask(user?.id)

  const [clientId, setClientId] = useState(ALL)
  const [engagementId, setEngagementId] = useState(ALL)
  const [label, setLabel] = useState(ALL)
  const [search, setSearch] = useState("")
  const [phoneColumn, setPhoneColumn] = useState<TaskStatus>("todo")
  const [allDone, setAllDone] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const boardId = useId()

  const clientName = new Map(clients.map((c) => [c.id, c.name]))
  const engagementById = new Map(engagements.map((e) => [e.id, e]))
  const contractName = (e: Engagement) => `${clientName.get(e.clientId) ?? "—"} · ${engagementLabel(e)}`
  // The client, then the contract when there is one.
  const subtitleOf = (task: Task) => {
    const engagement = task.engagementId ? engagementById.get(task.engagementId) : undefined
    const client = clientName.get(taskClientId(task, engagements) ?? "") ?? "—"
    return engagement ? `${client} · ${engagementLabel(engagement)}` : client
  }

  // The clients that own something to filter by: a contract, or a task of their own.
  const clientOptions = clients.filter(
    (c) =>
      engagements.some((e) => e.clientId === c.id) ||
      tasks.some((t) => taskClientId(t, engagements) === c.id),
  )
  const engagementOptions =
    clientId === ALL ? engagements : engagements.filter((e) => e.clientId === clientId)
  const labels = usedLabels(tasks)
  const visible = filterBoardTasks(tasks, engagements, clientId, engagementId, label, search)
  const columns = TASK_STATUSES.map(({ status, label: name }) => {
    const mine = visible.filter((t) => statusOf(t) === status)
    return { status, name, tasks: status === "done" ? sortDoneTasks(mine) : sortTasks(mine) }
  })

  function move(task: Task, target: TaskStatus) {
    if (statusOf(task) === target) return
    updateTask.mutate({ id: task.id, input: taskStatusUpdate(target, task) })
  }

  function moveById(taskId: string, target: TaskStatus) {
    const task = tasks.find((t) => t.id === taskId)
    if (task) move(task, target)
  }

  // FilterSelect speaks null for "All"; the board's filters speak ALL.
  const filter = (value: string) => (value === ALL ? null : value)

  function renderBody() {
    // Without this the "no clients" state flashes before the first fetch lands.
    const gate = pageState([tasksQuery, engagementsQuery, clientsQuery])
    if (gate) return gate

    if (clients.length === 0 && tasks.length === 0) {
      return (
        <EmptyPrompt
          title="No clients yet."
          description="A task always belongs to a client, and you have none yet."
          action={
            <Button asChild variant="outline">
              <Link href="/clients">Add a Client</Link>
            </Button>
          }
        />
      )
    }

    if (tasks.length === 0) {
      return <EmptyPrompt title="No tasks yet." description={'Add one with "New Task".'} />
    }

    return (
      <>
        {/* On a phone the selects fold into the Filters sheet; the search stays. */}
        <FilterBar
          search={{
            label: "Search tasks",
            placeholder: "Search tasks…",
            value: search,
            onChange: setSearch,
          }}
          sheet={{ active: [clientId, engagementId, label].filter((v) => v !== ALL).length }}
        >
          <FilterSelect
            label="Client"
            allLabel="All clients"
            value={filter(clientId)}
            options={clientOptions.map((c) => ({ value: c.id, label: c.name }))}
            onValueChange={(value) => {
              setClientId(value ?? ALL)
              setEngagementId(ALL)
            }}
          />
          <FilterSelect
            label="Contract"
            allLabel="All contracts"
            value={filter(engagementId)}
            options={[
              { value: NO_CONTRACT, label: "Client only" },
              ...engagementOptions.map((e) => ({
                value: e.id,
                label: `${clientId === ALL ? contractName(e) : engagementLabel(e)}${e.isActive ? "" : " (closed)"}`,
              })),
            ]}
            onValueChange={(value) => setEngagementId(value ?? ALL)}
          />
          <FilterSelect
            label="Label"
            allLabel="All labels"
            value={filter(label)}
            options={labels.map((l) => ({ value: l, label: l }))}
            onValueChange={(value) => setLabel(value ?? ALL)}
          />
        </FilterBar>

        {visible.length === 0 ? (
          <EmptyPrompt
            variant="inline"
            title="No tasks match these filters."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setClientId(ALL)
                  setEngagementId(ALL)
                  setLabel(ALL)
                  setSearch("")
                }}
              >
                Show All
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/* The tabs are a phone's: from sm up all three columns sit side by side (wrapping on a tablet). */}
            <StatusTabs
              aria-label="Status"
              className="sm:hidden"
              value={phoneColumn}
              onValueChange={(value) => setPhoneColumn(value as TaskStatus)}
              items={columns.map((c) => ({
                value: c.status,
                label: c.name,
                count: c.tasks.length,
                controls: `${boardId}-${c.status}`,
              }))}
            />
            <div className="grid gap-6 sm:grid-cols-[repeat(auto-fit,minmax(270px,1fr))]">
              {columns.map((column) => {
                const shown = column.status === "done" && !allDone ? column.tasks.slice(0, DONE_SHOWN) : column.tasks
                const others = columns.filter((c) => c.status !== column.status).map((c) => c.name)
                return (
                  <BoardColumn
                    key={column.status}
                    id={`${boardId}-${column.status}`}
                    status={column.status}
                    name={column.name}
                    count={column.tasks.length}
                    phoneHidden={column.status !== phoneColumn}
                    dragging={dragging}
                    onDropTask={(taskId) => {
                      setDragging(false)
                      moveById(taskId, column.status)
                    }}
                    footer={
                      <>
                        {shown.length < column.tasks.length && (
                          <Button
                            variant="outline"
                            onClick={(e) => {
                              // The button goes with the click: focus moves to the first card it
                              // brought, not back to the top of the page.
                              const section = e.currentTarget.closest("section")
                              flushSync(() => setAllDone(true))
                              section?.querySelector<HTMLElement>(`li:nth-child(${DONE_SHOWN + 1}) button`)?.focus()
                            }}
                          >
                            Show All Done
                          </Button>
                        )}
                        {column.tasks.length > 0 && (
                          <p className="text-meta text-muted-foreground sm:hidden">
                            Tap ··· on a card to move it to {others.join(" or ")}.
                          </p>
                        )}
                      </>
                    }
                  >
                    {shown.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        subtitle={subtitleOf(task)}
                        onMove={(target) => move(task, target)}
                        onOpen={() => setOpenTaskId(task.id)}
                        onDrag={setDragging}
                      />
                    ))}
                  </BoardColumn>
                )
              })}
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      <PageHeader
        title="Tasks"
        subtitle="What to do next for each client and contract."
        actions={
          <Button size="lg" aria-haspopup="dialog" onClick={() => setFormOpen(true)} disabled={clients.length === 0}>
            <Plus className="mr-2 h-4 w-4" />
            New Task
          </Button>
        }
      />

      {renderBody()}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
            <DialogDescription>
              Every task belongs to a client and, if you like, to one of its contracts.
            </DialogDescription>
          </DialogHeader>
          {/* Mounted only while open, so every opening starts from a blank form. */}
          <NewTaskForm
            clients={clients}
            engagements={engagements}
            initial={newTaskInitial(clients, engagements, clientId, engagementId)}
            isPending={createTask.isPending}
            onCancel={() => setFormOpen(false)}
            onSubmit={(input) => createTask.mutate(input, { onSuccess: () => setFormOpen(false) })}
          />
        </DialogContent>
      </Dialog>

      <TaskDetailDialog
        userId={user?.id}
        task={tasks.find((t) => t.id === openTaskId) ?? null}
        clients={clients}
        engagements={engagements}
        allLabels={labels}
        onClose={() => setOpenTaskId(null)}
      />
    </div>
  )
}

function BoardColumn({
  id,
  status,
  name,
  count,
  phoneHidden,
  dragging,
  onDropTask,
  footer,
  children,
}: {
  /** What the phone's tab for this column points at. */
  id: string
  status: TaskStatus
  name: string
  count: number
  /** Not the phone's tab: hidden below sm, still mounted. */
  phoneHidden: boolean
  /** A card is being dragged: every list shows its drop outline. */
  dragging: boolean
  onDropTask: (taskId: string) => void
  footer: React.ReactNode
  children: React.ReactNode
}) {
  const headingId = useId()
  // dragenter/dragleave fire again for every card the pointer crosses, so a
  // plain boolean would flicker; the highlight goes off only when the depth
  // count returns to zero.
  const depth = useRef(0)
  const [over, setOver] = useState(false)

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col gap-3", phoneHidden && "max-sm:hidden")}
      onDragEnter={(e) => {
        e.preventDefault()
        depth.current += 1
        setOver(true)
      }}
      onDragLeave={() => {
        depth.current -= 1
        if (depth.current <= 0) {
          depth.current = 0
          setOver(false)
        }
      }}
      // Without preventDefault here the browser refuses the drop.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        depth.current = 0
        setOver(false)
        const taskId = e.dataTransfer.getData("text/plain")
        if (taskId) onDropTask(taskId)
      }}
    >
      {/* The phone's tab already names the column: there the heading is for screen readers. */}
      <div className="flex items-center gap-2.5 border-b border-hairline px-0.5 pb-2.5 max-sm:sr-only">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", COLUMN[status].dot)} />
        <h2 id={headingId} className="text-[15px] font-semibold">
          {name}
        </h2>
        <span className="font-mono text-meta text-muted-foreground">{count}</span>
        {status === "done" && <span className="ml-auto text-meta text-muted-foreground">Newest first</span>}
      </div>
      {count === 0 && <p className="px-0.5 text-meta text-muted-foreground">{COLUMN[status].empty}</p>}
      {/* flex-1: the whole column is a place to drop onto, however short its list. */}
      <ul
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2.5 rounded-xl outline-offset-4 transition-colors motion-reduce:transition-none",
          dragging && "outline-[1.5px] outline-border-strong outline-dashed",
          over && "bg-surface-subtle outline-foreground",
        )}
      >
        {children}
      </ul>
      {footer}
    </section>
  )
}

/** Chips shown on a card; the rest are counted as "+N". */
const CARD_LABELS = 3

function TaskCard({
  task,
  subtitle,
  onMove,
  onOpen,
  onDrag,
}: {
  task: Task
  subtitle: string
  onMove: (target: TaskStatus) => void
  onOpen: () => void
  onDrag: (dragging: boolean) => void
}) {
  const titleId = useId()
  const status = statusOf(task)
  const hidden = task.labels.length - CARD_LABELS

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id)
        e.dataTransfer.effectAllowed = "move"
        onDrag(true)
      }}
      onDragEnd={() => onDrag(false)}
      onClick={(e) => {
        // A click anywhere on the card opens it, the way the title does. The move
        // menu is a portal, so its clicks bubble here through React without being
        // inside the card; the buttons inside (title, menu trigger) handle their own.
        const target = e.target as HTMLElement
        if (e.currentTarget.contains(target) && !target.closest("button")) onOpen()
      }}
    >
      <ContentCard
        labelledBy={titleId}
        padding="none"
        className="flex cursor-pointer flex-col gap-3 p-4 transition-colors hover:border-border-strong motion-reduce:transition-none"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-meta text-muted-foreground [overflow-wrap:anywhere]">{subtitle}</span>
            {/* The title is the card's control: a real button, so keyboard and screen
                readers reach it without turning the list item into one. */}
            <button
              id={titleId}
              type="button"
              aria-haspopup="dialog"
              onClick={onOpen}
              className={cn(
                "rounded-sm text-left text-base leading-snug font-medium [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-[15px]",
                status === "done" && "text-subtle-foreground",
              )}
            >
              {task.title}
            </button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mt-2 -mr-2 size-9 shrink-0 text-subtle-foreground pointer-coarse:-mt-2.5 pointer-coarse:-mr-2.5 pointer-coarse:size-11"
                aria-label={`Move Task: ${task.title}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={status} onValueChange={(value) => onMove(value as TaskStatus)}>
                {TASK_STATUSES.map((c) => (
                  <DropdownMenuRadioItem key={c.status} value={c.status}>
                    {c.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {task.labels.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {task.labels.slice(0, CARD_LABELS).map((l) => (
              <LabelChip key={l} label={l} />
            ))}
            {hidden > 0 && (
              <span className="px-1 text-xs text-muted-foreground">
                +{hidden}
                <span className="sr-only"> more</span>
              </span>
            )}
          </div>
        )}
        {(task.dueDate || task.notes || status === "done") && (
          <div className="flex items-center justify-between gap-2 border-t border-hairline pt-2.5">
            <DueLine task={task} />
            {task.notes && (
              <span className="text-muted-foreground" title="Has description">
                <AlignLeft className="size-[15px]" aria-hidden />
                <span className="sr-only">Has description</span>
              </span>
            )}
          </div>
        )}
      </ContentCard>
    </li>
  )
}

/** Done in words; else the due date, with a pill once it is overdue, today or tomorrow. */
function DueLine({ task }: { task: Task }) {
  const date = task.dueDate && <span className="font-mono text-meta text-subtle-foreground">{shortDay(task.dueDate)}</span>
  if (task.isDone) {
    return (
      <span className="inline-flex items-center gap-2 text-meta">
        <span className="inline-flex items-center gap-1.5 font-medium text-green-700 dark:text-green-400">
          <CircleCheck aria-hidden className="size-[15px] fill-success text-card" />
          Done
        </span>
        {task.dueDate && <span className="font-mono text-muted-foreground">due {shortDay(task.dueDate)}</span>}
      </span>
    )
  }
  if (!task.dueDate) return <span />
  if (isTaskOverdue(task)) {
    return (
      <span className="inline-flex items-center gap-2">
        <StatusPill tone="danger">Overdue</StatusPill>
        {date}
      </span>
    )
  }
  const days = differenceInCalendarDays(task.dueDate, new Date())
  if (days <= 1) {
    return (
      <span className="inline-flex items-center gap-2">
        <StatusPill tone="warning">{days === 0 ? "Due today" : "Due tomorrow"}</StatusPill>
        {date}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-[7px] font-mono text-meta text-subtle-foreground">
      <CalendarDays aria-hidden className="size-3.5 text-muted-foreground" />
      <span className="sr-only">Due </span>
      {shortDay(task.dueDate)}
    </span>
  )
}

/** The New Task dialog's form; the client page opens it on its client. */
export function NewTaskForm({
  clients,
  engagements,
  initial,
  isPending,
  onCancel,
  onSubmit,
}: {
  clients: Client[]
  engagements: Engagement[]
  initial: { clientId: string; engagementId: string }
  isPending: boolean
  onCancel: () => void
  onSubmit: (input: CreateTaskInput) => void
}) {
  const [clientId, setClientId] = useState(initial.clientId)
  const [engagementId, setEngagementId] = useState(initial.engagementId)
  const [title, setTitle] = useState("")
  const [dueDate, setDueDate] = useState("")
  // Closed contracts stay offered, marked: add_task reaches them by name too.
  const clientEngagements = engagements.filter((e) => e.clientId === clientId)
  const ready = !!clientId && !!title.trim()

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        onSubmit({
          clientId,
          engagementId: engagementId === NO_CONTRACT ? null : engagementId,
          title: title.trim(),
          dueDate: dueDate ? new Date(`${dueDate}T00:00:00`) : null,
        })
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="new-task-client">Client</Label>
        <Select
          value={clientId}
          onValueChange={(value) => {
            setClientId(value)
            setEngagementId(NO_CONTRACT)
          }}
        >
          <SelectTrigger id="new-task-client">
            <SelectValue placeholder="Choose a client" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-task-engagement">Contract (optional)</Label>
        <Select value={engagementId} onValueChange={setEngagementId} disabled={!clientId}>
          <SelectTrigger id="new-task-engagement">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CONTRACT}>No contract</SelectItem>
            {clientEngagements.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {engagementLabel(e)}
                {!e.isActive && " (closed)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-task-title">Title</Label>
        <Input
          id="new-task-title"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-task-due">Due date (optional)</Label>
        <Input id="new-task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready || isPending}>
          Add Task
        </Button>
      </DialogFooter>
    </form>
  )
}
