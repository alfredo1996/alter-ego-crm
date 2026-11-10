/**
 * The Solutions page's reading of the catalog: which solutions the filters
 * leave, how much of each is written, and the contract's state shown beside the
 * solution's own status (the two are separate on purpose: a delivered solution
 * on a closed contract is the normal end of the story).
 */
import { format } from "date-fns"

import { SOLUTION_KIND_SECTIONS, SOLUTION_SECTIONS } from "@/types/schemas"

import type { Engagement, Opportunity, Solution, SolutionKind, SolutionSectionKey, SolutionStatus, SolutionStep, SolutionStepPayer } from "@/types"

/** The solution's own lifecycle, in order, with each status's label and pill tone. */
export const SOLUTION_STATUS: Record<SolutionStatus, { label: string; tone: "info" | "warning" | "success" | "neutral" }> = {
  proposed: { label: "Proposed", tone: "info" },
  building: { label: "Building", tone: "warning" },
  delivered: { label: "Delivered", tone: "success" },
  retired: { label: "Retired", tone: "neutral" },
}

export const SOLUTION_STATUSES = Object.keys(SOLUTION_STATUS) as SolutionStatus[]

/** The list's filters as the URL holds them (?client=, ?status=, ?stack=, ?q=), so other pages can link to a view. null = all. */
export interface SolutionFilters {
  client: string | null
  status: SolutionStatus | null
  stack: string | null
  /** The one search: the page's box (?q=) and MCP list_solutions' query. */
  q?: string | null
}

/** An unknown status reads as no filter; a tag as it is stored, lowercase; the search trimmed. */
export function solutionFilters(params: URLSearchParams): SolutionFilters {
  const status = params.get("status") as SolutionStatus | null
  return {
    client: params.get("client") || null,
    status: status && SOLUTION_STATUSES.includes(status) ? status : null,
    stack: params.get("stack")?.trim().toLowerCase() || null,
    q: params.get("q")?.trim() || null,
  }
}

/** The solutions the filters leave, the most recently updated first. The search reads the name, domain, stack and every section. */
export function filterSolutions(solutions: Solution[], f: SolutionFilters): Solution[] {
  const q = f.q?.toLowerCase()
  return solutions
    .filter(
      (s) =>
        (!f.client || s.clientId === f.client) &&
        (!f.status || s.status === f.status) &&
        (!f.stack || s.stack.includes(f.stack)) &&
        (!q || [s.name, s.domain, ...s.stack, ...Object.values(s.sections)].some((text) => text?.toLowerCase().includes(q))),
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
}

/**
 * The client's solution already called `name`, trimmed and case-insensitive,
 * `exceptId` (the one being renamed) aside. The one duplicate rule: the page's
 * New and Edit Solution, and MCP create/update_solution.
 */
export function solutionNameTaken<T extends Pick<Solution, "id" | "clientId" | "name">>(
  solutions: T[],
  clientId: string,
  name: string,
  exceptId?: string,
): T | undefined {
  const key = name.trim().toLowerCase()
  return solutions.find((s) => s.clientId === clientId && s.id !== exceptId && s.name.trim().toLowerCase() === key)
}

/** Every technology some solution lists, alphabetical: the Stack filter's choices. */
export function usedStack(solutions: Pick<Solution, "stack">[]): string[] {
  return [...new Set(solutions.flatMap((s) => s.stack))].sort()
}

/**
 * The sections a kind asks for, in order. An Advisory's results are presented as
 * "Results and Lessons"; the stored key stays `results`.
 */
export function sectionsFor(kind: SolutionKind): { key: SolutionSectionKey; label: string; question: string }[] {
  return SOLUTION_KIND_SECTIONS[kind].map((key) => {
    const section = SOLUTION_SECTIONS.find((x) => x.key === key)!
    return kind === "advisory" && key === "results" ? { ...section, label: "Results and Lessons" } : { ...section }
  })
}

/** The sections with no text yet, in order: what the MCP interview still has to ask. Only the kind's own when it is known. */
export function missingSections(solution: Pick<Solution, "sections"> & Partial<Pick<Solution, "kind">>): SolutionSectionKey[] {
  const asked = solution.kind ? sectionsFor(solution.kind) : SOLUTION_SECTIONS
  return asked.filter(({ key }) => !solution.sections[key]?.trim()).map(({ key }) => key)
}

/** How many of the nine sections have text: the list's "4/9". */
export function filledSections(solution: Pick<Solution, "sections">): number {
  return SOLUTION_SECTIONS.filter(({ key }) => solution.sections[key]?.trim()).length
}

/** The step the work is on now, if any: a solution has at most one. */
export function nowStep(steps: SolutionStep[]): SolutionStep | undefined {
  return steps.find((s) => s.state === "now")
}

/** The index of the step a number (1-based) or a title (any case) names; -1 when there is none or the title is shared. */
export function stepIndex(steps: SolutionStep[], ref: number | string): number {
  if (typeof ref === "number") return ref >= 1 && ref <= steps.length ? ref - 1 : -1
  const key = ref.trim().toLowerCase()
  const hits = steps.flatMap((s, i) => (s.title.trim().toLowerCase() === key ? [i] : []))
  return hits.length === 1 ? hits[0] : -1
}

/**
 * Marks step `index` Done with its outcome and the day. When it was the Now step, the next step
 * still open (Next or Later) becomes Now; none after it, none is Now. Returns a new list.
 */
export function completeStep(steps: SolutionStep[], index: number, outcome: string, today: string): SolutionStep[] {
  const wasNow = steps[index].state === "now"
  const next = wasNow ? steps.findIndex((s, i) => i > index && s.state !== "done") : -1
  return steps.map((s, i) =>
    i === index ? { ...s, state: "done", outcome, doneOn: today } : i === next ? { ...s, state: "now" } : s,
  )
}

/**
 * What a step is paid by today: its contract once its opportunity is won (read from
 * opportunity.engagementId, nothing is written at conversion), else the opportunity as stored.
 */
export function stepContract(
  step: Pick<SolutionStep, "paidBy">,
  opportunities: Pick<Opportunity, "id" | "engagementId">[],
): SolutionStepPayer | null {
  const { paidBy } = step
  if (paidBy?.type !== "opportunity") return paidBy
  const won = opportunities.find((o) => o.id === paidBy.id)?.engagementId
  return won ? { type: "contract", id: won } : paidBy
}

/** The contract's own state, shown beside the solution's status: "Pre-sales" while there is none. */
export function contractState(contract: Pick<Engagement, "isActive"> | undefined): "Pre-sales" | "Active" | "Closed" {
  if (!contract) return "Pre-sales"
  return contract.isActive ? "Active" : "Closed"
}

/** "14 Oct", with the year once it is not this one: a card's "updated 14 Oct", the page's meta line. */
export function shortDay(date: Date): string {
  return format(date, date.getFullYear() === new Date().getFullYear() ? "d MMM" : "d MMM yyyy")
}

/** One History entry: "2026-07-15 Go-live." */
export interface HistoryEntry {
  date: string
  text: string
}

/**
 * History as a timeline, newest first (a same-day pair in the order written): a line opening on a
 * YYYY-MM-DD date starts an entry, a line without one continues the entry above it. null when the
 * text does not open on a date: the page then shows it as written. Either way no text is dropped.
 */
export function historyEntries(text: string | null): HistoryEntry[] | null {
  const entries: HistoryEntry[] = []
  for (const line of (text ?? "").split("\n")) {
    // The date, then a colon, a dash or a space: "2026-07-15: Go-live", "2026-07-15 — Go-live".
    const dated = /^\s*(\d{4}-\d{2}-\d{2})(?:\s*[:–—]\s*|\s+-\s+|\s+|$)(.*)$/.exec(line)
    if (dated) entries.push({ date: dated[1], text: dated[2].trim() })
    else if (!line.trim()) continue
    else if (entries.length === 0) return null
    else entries[entries.length - 1].text += `${entries[entries.length - 1].text ? "\n" : ""}${line.trim()}`
  }
  return entries.length > 0 ? entries.sort((a, b) => b.date.localeCompare(a.date)) : null
}

/**
 * A prose line's leading "Label:", shown in bold: up to 40 characters with no sentence punctuation,
 * then a colon and a space ("Zero-result searches: 12% → under 5%"). A sentence, a link or a time is not one.
 */
export function lineLabel(line: string): string | null {
  return /^[^:,.;!?]{1,40}:(?=\s+\S)/.exec(line)?.[0] ?? null
}
