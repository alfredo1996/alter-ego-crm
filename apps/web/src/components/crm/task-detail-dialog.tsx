"use client"


import { TagChip } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { Textarea } from "@alter-ego/ui/ui/textarea"
import { format } from "date-fns"
import { Trash2, X } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { useDeleteTask, useUpdateTask } from "@/hooks/use-tasks"
import { engagementLabel } from "@/lib/engagements"
import {
  MAX_LABELS,
  TASK_STATUSES,
  labelColor,
  labelSuggestions,
  normalizeLabels,
  statusOf,
  taskClientId,
  taskStatusUpdate,
} from "@/lib/tasks"

import type { TaskStatus } from "@/lib/tasks"
import type { Client, Engagement, Task, UpdateTaskInput } from "@/types"

/** A Radix Select item cannot hold "" or null: the Contract choice for client level. */
const NO_CONTRACT = "none"

/** What the dialog edits, in the shape its inputs hold it. */
export interface TaskDetailForm {
  title: string
  status: TaskStatus
  /** "yyyy-MM-dd" as the date input gives it; "" = no due date. */
  dueDate: string
  notes: string
  labels: string[]
  /** null = a client-level task. */
  engagementId: string | null
}

export function taskDetailForm(task: Task): TaskDetailForm {
  return {
    title: task.title,
    status: statusOf(task),
    dueDate: task.dueDate ? format(task.dueDate, "yyyy-MM-dd") : "",
    notes: task.notes ?? "",
    labels: task.labels,
    engagementId: task.engagementId,
  }
}

/**
 * The single update Save writes: only the fields that changed, so one left
 * alone never overwrites what the MCP wrote meanwhile. Status goes through
 * taskStatusUpdate, so isDone and startedAt always agree with the column. A
 * contract change restates the client, so a task always names its contract's
 * client, and one written before #164 gains the clientId it lacked (without
 * it, detaching would leave a task naming neither).
 */
export function taskDetailUpdate(
  task: Task,
  form: TaskDetailForm,
  clientId: string | null,
  now: Date = new Date(),
): UpdateTaskInput {
  const initial = taskDetailForm(task)
  const input: UpdateTaskInput = {}
  if (form.title !== initial.title) input.title = form.title.trim()
  if (form.status !== initial.status) Object.assign(input, taskStatusUpdate(form.status, task, now))
  if (form.dueDate !== initial.dueDate) input.dueDate = form.dueDate ? new Date(`${form.dueDate}T00:00:00`) : null
  if (form.notes !== initial.notes) input.notes = form.notes.trim() || null
  const labels = normalizeLabels(form.labels)
  if (labels.join("\n") !== initial.labels.join("\n")) input.labels = labels
  if (form.engagementId !== initial.engagementId) {
    input.engagementId = form.engagementId
    if (clientId) input.clientId = clientId
  }
  return input
}

/** A label as a TagChip whose dot takes the label's colour (labelColor): the chip itself stays neutral. */
export function LabelChip({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <TagChip dot={labelColor(label)} className="max-w-full">
      <span className="min-w-0 truncate">{label}</span>
      {children}
    </TagChip>
  )
}

/** A task opened like a Trello card: `task` null keeps the dialog closed. */
export function TaskDetailDialog({
  userId,
  task,
  clients,
  engagements,
  allLabels,
  onClose,
}: {
  userId: string | undefined
  task: Task | null
  clients: Pick<Client, "id" | "name">[]
  engagements: Engagement[]
  /** Every label used across the user's tasks: the suggestions. */
  allLabels: string[]
  onClose: () => void
}) {
  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      {/* Keyed, so each opening starts from the task as it is now. */}
      {task && (
        <TaskDetails
          key={task.id}
          userId={userId}
          task={task}
          clients={clients}
          engagements={engagements}
          allLabels={allLabels}
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}

function TaskDetails({
  userId,
  task: opened,
  clients,
  engagements,
  allLabels,
  onClose,
}: {
  userId: string | undefined
  task: Task
  clients: Pick<Client, "id" | "name">[]
  engagements: Engagement[]
  allLabels: string[]
  onClose: () => void
}) {
  const updateTask = useUpdateTask(userId)
  const deleteTask = useDeleteTask(userId)
  // The task as opened: a refetch while the dialog is open must not turn an
  // untouched field into an "edit" that reverts someone else's change.
  const [task] = useState(opened)
  const [form, setForm] = useState(() => taskDetailForm(task))
  const [labelDraft, setLabelDraft] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = (patch: Partial<TaskDetailForm>) => setForm((f) => ({ ...f, ...patch }))
  const addLabels = (raw: string[]) => set({ labels: normalizeLabels([...form.labels, ...raw]) })

  const clientId = taskClientId(task, engagements)
  const clientName = clients.find((c) => c.id === clientId)?.name ?? "—"
  const contracts = engagements.filter((e) => e.clientId === clientId)
  const contract = contracts.find((e) => e.id === task.engagementId)
  // A label typed but not yet confirmed with Enter still counts on Save.
  const update = taskDetailUpdate(task, { ...form, labels: [...form.labels, labelDraft] }, clientId)
  const dirty = Object.keys(update).length > 0
  const suggestions = labelSuggestions(allLabels, form.labels, labelDraft)
  const full = form.labels.length >= MAX_LABELS
  const dates = [
    { label: "Created", date: task.createdAt },
    { label: "Started", date: task.startedAt },
    { label: "Updated", date: task.updatedAt },
  ]

  function save() {
    if (!form.title.trim()) return
    if (!dirty) return onClose()
    updateTask.mutate({ id: task.id, input: update }, { onSuccess: onClose })
  }

  // Unsaved edits go only through Cancel or the close button, never through
  // a stray click beside the dialog or an Escape meant for a field.
  const keepEdits = (e: Event) => {
    if (dirty) e.preventDefault()
  }

  return (
    <DialogContent size="lg" onInteractOutside={keepEdits} onEscapeKeyDown={keepEdits}>
      <DialogHeader>
        <DialogTitle className="pr-6">{task.title}</DialogTitle>
        <DialogDescription>
          {contract ? `${clientName} · ${engagementLabel(contract)}` : clientName}
        </DialogDescription>
      </DialogHeader>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {/* minmax(0,1fr): a phone's single auto column would grow to its widest select. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-[1fr_13rem]">
          <div className="min-w-0 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="task-detail-title">Title</Label>
              <Input
                id="task-detail-title"
                value={form.title}
                maxLength={200}
                onChange={(e) => set({ title: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-detail-notes">Description</Label>
              <Textarea
                id="task-detail-notes"
                rows={6}
                maxLength={1000}
                placeholder="Add a more detailed description…"
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-detail-label">Labels</Label>
              {form.labels.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {form.labels.map((label) => (
                    <li key={label} className="max-w-full">
                      <LabelChip label={label}>
                        <button
                          type="button"
                          className="-mr-0.5 rounded-sm pointer-coarse:inline-flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          aria-label={`Remove Label ${label}`}
                          onClick={() => set({ labels: form.labels.filter((l) => l !== label) })}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </LabelChip>
                    </li>
                  ))}
                </ul>
              )}
              <Input
                id="task-detail-label"
                value={labelDraft}
                disabled={full}
                placeholder={full ? `At most ${MAX_LABELS} labels` : "Type, then press Enter or comma"}
                onChange={(e) => {
                  // A comma, typed or pasted, confirms what comes before it.
                  const parts = e.target.value.split(",")
                  if (parts.length > 1) addLabels(parts.slice(0, -1))
                  setLabelDraft(parts[parts.length - 1])
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return
                  // Enter adds the label; it must not submit the form.
                  e.preventDefault()
                  addLabels([labelDraft])
                  setLabelDraft("")
                }}
              />
              {!full && suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Already used:</span>
                  {suggestions.map((label) => (
                    <button
                      key={label}
                      type="button"
                      className="rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                      aria-label={`Add Label ${label}`}
                      onClick={() => {
                        addLabels([label])
                        setLabelDraft("")
                      }}
                    >
                      <LabelChip label={label} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="task-detail-status">Status</Label>
              <Select value={form.status} onValueChange={(value) => set({ status: value as TaskStatus })}>
                <SelectTrigger id="task-detail-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s.status} value={s.status}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-detail-due">Due date</Label>
              <Input
                id="task-detail-due"
                type="date"
                value={form.dueDate}
                onChange={(e) => set({ dueDate: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Client</p>
              <Link
                href={clientId ? `/clients/${clientId}` : "/clients"}
                className="text-sm text-primary underline-offset-4 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
              >
                {clientName}
              </Link>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-detail-engagement">Contract</Label>
              <Select
                value={form.engagementId ?? NO_CONTRACT}
                onValueChange={(value) => set({ engagementId: value === NO_CONTRACT ? null : value })}
                disabled={!clientId}
              >
                <SelectTrigger id="task-detail-engagement">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CONTRACT}>No contract</SelectItem>
                  {contracts.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {engagementLabel(e)}
                      {!e.isActive && " (closed)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {dates.map(({ label, date }) => (
                <div key={label} className="contents">
                  <dt>{label}</dt>
                  <dd>{date ? format(date, "d MMM yyyy") : "—"}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {updateTask.isError && (
          <p role="alert" className="text-sm text-destructive">
            Save failed. Try again.
          </p>
        )}

        <DialogFooter className="justify-between">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4 sm:mr-2" />
            <span className="max-sm:sr-only">Delete Task</span>
          </Button>
          {/* ml-auto: wrapped onto its own line, the group still ends at the right. */}
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!form.title.trim() || updateTask.isPending}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </form>

      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Task"
        description={`"${task.title}" is removed from the board, the client and the calendar.`}
        isPending={deleteTask.isPending}
        onConfirm={() => deleteTask.mutate(task.id, { onSuccess: onClose })}
      />
    </DialogContent>
  )
}
