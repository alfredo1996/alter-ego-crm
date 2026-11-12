import type { JournalEntry, Meeting, SolutionStep } from "@/types"

export const JOURNAL_FILTERS = ["all", "work", "calls", "decisions", "steps"] as const
export type JournalFilter = (typeof JOURNAL_FILTERS)[number]

export const JOURNAL_FILTER_LABEL: Record<JournalFilter, string> = {
  all: "All",
  work: "Work",
  calls: "Calls",
  decisions: "Decisions",
  steps: "Steps",
}

/** One line of the journal. A decision of a work session is its own line, pointing at the entry it was taken in. */
export type JournalItem =
  | { type: "work"; id: string; date: string; entry: JournalEntry }
  | { type: "decision"; id: string; date: string; text: string; stepTitle: string | null; entry: JournalEntry }
  | { type: "call"; id: string; date: string; meeting: Meeting }
  | { type: "step"; id: string; date: string; number: number; step: SolutionStep }

const KIND_OF: Record<JournalItem["type"], JournalFilter> = { work: "work", decision: "decisions", call: "calls", step: "steps" }

/**
 * The journal of one solution, newest first: its entries, the meetings of the contracts its steps
 * follow (read, never copied) and its Done steps on the day they were done. A day's lines keep the
 * order they were written in, entries first. `filter` keeps one kind.
 */
export function journalItems(
  { entries, meetings, steps, solutionId, contractIds }: {
    entries: JournalEntry[]
    meetings: Meeting[]
    steps: SolutionStep[]
    solutionId: string
    contractIds: string[]
  },
  filter: JournalFilter = "all",
): JournalItem[] {
  const stamped: { item: JournalItem; at: number }[] = []
  for (const entry of entries.filter((e) => e.solutionId === solutionId)) {
    const at = entry.createdAt.getTime()
    if (entry.kind === "decision") {
      stamped.push({ item: { type: "decision", id: entry.id, date: entry.date, text: entry.text, stepTitle: entry.stepTitle, entry }, at })
      continue
    }
    stamped.push({ item: { type: "work", id: entry.id, date: entry.date, entry }, at })
    entry.decisions.forEach((text, i) =>
      stamped.push({ item: { type: "decision", id: `${entry.id}:decision:${i}`, date: entry.date, text, stepTitle: entry.stepTitle, entry }, at }),
    )
  }
  for (const meeting of meetings) {
    if (meeting.engagementId && contractIds.includes(meeting.engagementId)) {
      stamped.push({ item: { type: "call", id: meeting.id, date: meeting.date, meeting }, at: meeting.createdAt.getTime() })
    }
  }
  steps.forEach((step, i) => {
    if (step.state === "done" && step.doneOn) stamped.push({ item: { type: "step", id: `step:${i}`, date: step.doneOn, number: i + 1, step }, at: 0 })
  })
  return stamped
    .filter(({ item }) => filter === "all" || KIND_OF[item.type] === filter)
    .sort((a, b) => b.item.date.localeCompare(a.item.date) || b.at - a.at)
    .map(({ item }) => item)
}

/** The 1-based number of the step an entry names, by its title as filed; null when the road no longer has it (or two steps share it). */
export function stepNumberOf(steps: Pick<SolutionStep, "title">[], title: string | null): number | null {
  if (title === null) return null
  const hits = steps.flatMap((s, i) => (s.title === title ? [i + 1] : []))
  return hits.length === 1 ? hits[0] : null
}

/** A textarea's lines as a list: one per line, blanks dropped. */
export function linesOf(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean)
}

/** A link entry that is a web address is shown as a link; PR #7 stays text. */
export function isWebLink(link: string): boolean {
  return /^https?:\/\/\S+$/i.test(link)
}

/** Where an entry filed over MCP says it came from: the connected app's registered name (MCP when it has none), then the repository. */
export function journalSource(clientName: string | null | undefined, repo?: string): string {
  const name = clientName?.trim() || "MCP"
  const r = repo?.trim()
  return r ? `${name} · ${r}` : name
}
