"use client"

import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { Timeline, type TimelineItem } from "@alter-ego/ui/page/timeline"
import { Button } from "@alter-ego/ui/ui/button"
import { cn } from "@alter-ego/ui/utils"
import { useState } from "react"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { useDeleteJournalEntry } from "@/hooks/use-journal"
import { MEETING_HEALTH } from "@/lib/meetings"
import {
  JOURNAL_FILTERS,
  JOURNAL_FILTER_LABEL,
  isWebLink,
  journalItems,
  stepNumberOf,
  type JournalFilter,
  type JournalItem,
} from "@/lib/solution-journal"
import { shortDay } from "@/lib/solutions"

import type { JournalEntry, Meeting, Solution } from "@/types"

const PAGE = 10

const EMPTY: Record<JournalFilter, string> = {
  all: "Nothing is logged yet. Log Work adds the first entry.",
  work: "No work sessions yet.",
  calls: "No calls yet. Calls are the meetings of its contract and of the contracts its steps follow.",
  decisions: "No decisions yet.",
  steps: "No step is Done yet.",
}

const dayLabel = (date: string, today: string) => (date === today ? "Today" : shortDay(new Date(`${date}T00:00:00`)))

interface Props {
  solution: Solution
  entries: JournalEntry[]
  meetings: Meeting[]
  /** The contracts its steps follow: their meetings are the calls. */
  contractIds: string[]
  userId: string | undefined
  today: string
  onEdit: (entry: JournalEntry) => void
  /** Presenting: no Edit and no Delete. */
  readOnly?: boolean
}

/** The Journal: work sessions, decisions, the calls of its contracts and its Done steps, newest first. */
export function SolutionJournal({ solution, entries, meetings, contractIds, userId, today, onEdit, readOnly }: Props) {
  const [filter, setFilter] = useState<JournalFilter>("all")
  const [shown, setShown] = useState(PAGE)
  const [deleting, setDeleting] = useState<JournalEntry | null>(null)
  const remove = useDeleteJournalEntry(userId)
  const all = journalItems({ entries, meetings, steps: solution.steps, solutionId: solution.id, contractIds }, filter)
  const stepChip = (title: string | null) => {
    if (title === null) return null
    const n = stepNumberOf(solution.steps, title)
    return (
      <span className="rounded-md border border-hairline px-1.5 py-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {n ? `Step ${n}` : title}
      </span>
    )
  }

  const head = (label: string, chip?: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold">{label}</span>
      {chip}
    </div>
  )

  const line = (item: JournalItem): Omit<TimelineItem, "key" | "date"> => {
    if (item.type === "work") {
      const { entry } = item
      return {
        content: (
          <div className="flex min-w-0 flex-col gap-1.5">
            {head("Work session", stepChip(entry.stepTitle))}
            <p className="text-[15px] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{entry.text}</p>
            {entry.next && (
              <p className="text-[15px] [overflow-wrap:anywhere]">
                <span className="font-medium">Next:</span> {entry.next}
              </p>
            )}
            {(entry.links.length > 0 || entry.source) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {entry.links.map((l, i) =>
                  isWebLink(l) ? (
                    <a key={i} href={l} target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2 [overflow-wrap:anywhere]">
                      {l}
                    </a>
                  ) : (
                    <span key={i} className="text-foreground [overflow-wrap:anywhere]">
                      {l}
                    </span>
                  ),
                )}
                {entry.source && <span>Filed from {entry.source}</span>}
              </div>
            )}
          </div>
        ),
        actions: entryActions(entry, "session"),
      }
    }
    if (item.type === "decision") {
      const own = item.entry.kind === "decision"
      return {
        content: (
          <div className="flex min-w-0 flex-col gap-1.5">
            {head("Decision", stepChip(item.stepTitle))}
            <p className="text-[15px] leading-relaxed [overflow-wrap:anywhere]">{item.text}</p>
            {own && item.entry.source && <span className="text-sm text-muted-foreground">Filed from {item.entry.source}</span>}
          </div>
        ),
        actions: own ? entryActions(item.entry, "decision") : undefined,
      }
    }
    if (item.type === "call") {
      const { meeting } = item
      const [title, ...rest] = meeting.text.split("\n")
      return {
        tone: meeting.health ? MEETING_HEALTH[meeting.health].tone : undefined,
        content: (
          <div className="flex min-w-0 flex-col gap-1.5">
            {head(`Call: ${title}`, meeting.health ? <span className="text-xs text-muted-foreground">{MEETING_HEALTH[meeting.health].label}</span> : null)}
            {rest.join("\n").trim() && <p className="text-[15px] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{rest.join("\n").trim()}</p>}
            <span className="text-sm text-muted-foreground">From Meetings</span>
          </div>
        ),
      }
    }
    return {
      content: (
        <div className="flex min-w-0 flex-col gap-1.5">
          {head(`Step ${item.number} done: ${item.step.title}`)}
          {item.step.outcome && <p className="text-[15px] leading-relaxed [overflow-wrap:anywhere]">{item.step.outcome}</p>}
        </div>
      ),
    }
  }

  function entryActions(entry: JournalEntry, what: string) {
    if (readOnly) return null
    // The day as shown and the start of the text: two entries of one day stay apart.
    const name = `${shortDay(new Date(`${entry.date}T00:00:00`))}: ${entry.text.length > 40 ? `${entry.text.slice(0, 40).trimEnd()}...` : entry.text}`
    return (
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" aria-label={`Edit ${what} of ${name}`} onClick={() => onEdit(entry)}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" className="text-destructive" aria-label={`Delete ${what} of ${name}`} onClick={() => setDeleting(entry)}>
          Delete
        </Button>
      </div>
    )
  }

  const items: TimelineItem[] = all.slice(0, shown).map((item) => ({ key: item.id, date: dayLabel(item.date, today), ...line(item) }))

  return (
    <section aria-labelledby="journal" className="flex flex-col gap-4">
      <SectionHeader id="journal" title="Journal" description="Work sessions, calls, decisions and steps, newest first." />
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {JOURNAL_FILTERS.map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            variant={filter === f ? "default" : "outline"}
            aria-pressed={filter === f}
            className={cn("rounded-full")}
            onClick={() => {
              setFilter(f)
              setShown(PAGE)
            }}
          >
            {JOURNAL_FILTER_LABEL[f]}
          </Button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{readOnly && filter === "all" ? "Nothing logged yet" : EMPTY[filter]}</p>
      ) : (
        <Timeline items={items} />
      )}
      {all.length > shown && (
        <Button variant="outline" className="self-start" onClick={() => setShown((n) => n + PAGE)}>
          Show Older
        </Button>
      )}
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting?.kind === "decision" ? "Delete Decision" : "Delete Work Session"}
        description={`The entry of ${deleting?.date ?? ""} is removed from the Journal. This can't be undone.`}
        confirmLabel={deleting?.kind === "decision" ? "Delete Decision" : "Delete Work Session"}
        isPending={remove.isPending}
        onConfirm={() => {
          const id = deleting!.id
          setDeleting(null)
          remove.mutate(id)
        }}
      />
    </section>
  )
}
