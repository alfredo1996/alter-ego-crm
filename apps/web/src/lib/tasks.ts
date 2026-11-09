import type { Engagement, Task, UpdateTaskInput } from "@/types"

export type TaskStatus = "todo" | "doing" | "done"

/** The board's columns in order, with the names the board and the task dialog show. */
export const TASK_STATUSES: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "doing", label: "In Progress" },
  { status: "done", label: "Done" },
]

/**
 * The client a task belongs to: its own clientId, or — on a document written
 * before tasks carried one (#164) — its contract's client. null when neither is
 * known. Every reader goes through this, which is why the old documents need no
 * migration.
 */
export function taskClientId(
  task: Pick<Task, "clientId" | "engagementId">,
  engagements: Pick<Engagement, "id" | "clientId">[],
): string | null {
  // ponytail: linear find per task; a Map if a user ever has thousands of contracts.
  return task.clientId ?? engagements.find((e) => e.id === task.engagementId)?.clientId ?? null
}

/**
 * Display order for an engagement's task list: open before done, due-dated
 * before undated (soonest first), creation order as the tiebreak. Sorting lives
 * here — not in the adapters — so there is exactly one comparator to keep true.
 */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.isDone !== b.isDone) return a.isDone ? 1 : -1
    if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime()
    if (a.dueDate !== b.dueDate) return a.dueDate ? -1 : 1
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
}

/**
 * The Done column's order: the most recently done first. No completion time is
 * stored, so the last write stands in for it.
 * ponytail: an edit to a done task moves it to the top; store a doneAt if that ever misleads.
 */
export function sortDoneTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
}

/** Overdue = an open task whose due date has passed (date-only comparison). */
export function isTaskOverdue(task: Task, today: Date = new Date()): boolean {
  if (task.isDone || !task.dueDate) return false
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return task.dueDate.getTime() < startOfToday.getTime()
}

/**
 * Board column for a task. isDone is the only authority for done-ness —
 * startedAt merely splits the open tasks — so the writers that touch isDone
 * alone (complete_task, reopen, both checkboxes) can never leave a task in a
 * column its checkbox contradicts.
 */
export function statusOf(task: Pick<Task, "isDone" | "startedAt">): TaskStatus {
  if (task.isDone) return "done"
  return task.startedAt ? "doing" : "todo"
}

/**
 * The update that moves a task to `target`, so every writer agrees on it.
 * "done" keeps startedAt; "doing" keeps an existing start rather than
 * restarting the clock.
 */
export function taskStatusUpdate(
  target: TaskStatus,
  task: Pick<Task, "startedAt">,
  now: Date = new Date()
): Pick<UpdateTaskInput, "isDone" | "startedAt"> {
  if (target === "done") return { isDone: true }
  if (target === "doing") return { isDone: false, startedAt: task.startedAt ?? now }
  return { isDone: false, startedAt: null }
}

export const MAX_LABELS = 10
export const MAX_LABEL_LENGTH = 30

/**
 * The one shape a label list is stored in: trimmed, inner whitespace collapsed,
 * each at most MAX_LABEL_LENGTH code points, no empties, no case-insensitive
 * duplicates (the first spelling wins), at most MAX_LABELS. The adapters apply
 * it on every write, so a caller can pass raw user input.
 */
export function normalizeLabels(input: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input) {
    // Array.from slices by code point, so a cap never splits an emoji in half.
    const label = Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, MAX_LABEL_LENGTH).join("").trim()
    const key = label.toLowerCase()
    if (!label || seen.has(key)) continue
    seen.add(key)
    out.push(label)
    if (out.length === MAX_LABELS) break
  }
  return out
}

/**
 * Every label in use across these tasks, once whatever its case (the first
 * spelling met wins), A to Z: what the label filter and the suggestions offer.
 */
export function usedLabels(tasks: Pick<Task, "labels">[]): string[] {
  const byKey = new Map<string, string>()
  for (const task of tasks) {
    for (const label of task.labels) {
      if (!byKey.has(label.toLowerCase())) byKey.set(label.toLowerCase(), label)
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
}

/**
 * The used labels worth suggesting while typing: those the task lacks that
 * contain the typed text, ignoring case — all of them on an empty input.
 */
export function labelSuggestions(used: string[], current: string[], typed: string, limit = 8): string[] {
  const taken = new Set(current.map((l) => l.toLowerCase()))
  const query = typed.trim().toLowerCase()
  return used.filter((l) => !taken.has(l.toLowerCase()) && l.toLowerCase().includes(query)).slice(0, limit)
}

/** Dot colours for labels: saturated enough to tell apart on the chip's muted fill, in both themes. */
const LABEL_COLORS = ["#8b5cf6", "#e11d48", "#65a30d", "#059669", "#2563eb", "#ea580c", "#0891b2", "#ca8a04"] as const

/**
 * A label's dot colour, derived from its text so there is nothing to store or
 * configure: the same label is the same colour on every card, whatever its case.
 */
export function labelColor(label: string): string {
  const key = label.toLowerCase()
  let h = 0
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0
  // Fold the high bits in: a multiply-add hash leaves the low bits (all % 8 sees) weak.
  return LABEL_COLORS[((h ^ (h >>> 16)) >>> 0) % LABEL_COLORS.length]
}
