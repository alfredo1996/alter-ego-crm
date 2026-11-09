/**
 * The Solutions page's reading of the catalog: which solutions the filters
 * leave, how much of each is written, and the contract's state shown beside the
 * solution's own status (the two are separate on purpose: a delivered solution
 * on a closed contract is the normal end of the story).
 */
import { format } from "date-fns"

import { SOLUTION_SECTIONS } from "@/types/schemas"

import type { Engagement, Solution, SolutionSectionKey, SolutionStatus } from "@/types"

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

/** The sections with no text yet, in order: what the MCP interview still has to ask. */
export function missingSections(solution: Pick<Solution, "sections">): SolutionSectionKey[] {
  return SOLUTION_SECTIONS.filter(({ key }) => !solution.sections[key]?.trim()).map(({ key }) => key)
}

/** How many of the nine sections have text: the list's "4/9". */
export function filledSections(solution: Pick<Solution, "sections">): number {
  return SOLUTION_SECTIONS.length - missingSections(solution).length
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
