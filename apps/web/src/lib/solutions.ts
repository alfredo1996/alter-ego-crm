/**
 * The Solutions page's reading of the catalog: which solutions the filters
 * leave, how much of each is written, and the contract's state shown beside the
 * solution's own status (the two are separate on purpose: a delivered solution
 * on a closed contract is the normal end of the story).
 */
import { formatYearMonth } from "@alter-ego/kernel/dates"
import { format } from "date-fns"

import { contractUnit, contractUsage, countIn, inContractUnit, isOverBudget } from "@/lib/engagements"
import { STAGE_LABELS, isOpen } from "@/lib/opportunities"
import { SOLUTION_KIND_SECTIONS, SOLUTION_SECTIONS, solutionStepsSchema } from "@/types/schemas"

import type { Engagement, JournalEntry, Meeting, Opportunity, Solution, Timecard, SolutionKind, SolutionSectionKey, SolutionStatus, SolutionStep, SolutionStepPayer } from "@/types"

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
  /** ?kind=: Product or Advisory. */
  kind?: SolutionKind | null
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
    kind: ["product", "advisory"].includes(params.get("kind") ?? "") ? (params.get("kind") as SolutionKind) : null,
    stack: params.get("stack")?.trim().toLowerCase() || null,
    q: params.get("q")?.trim() || null,
  }
}

/** The solutions the filters leave, the most recently updated first. The search reads the name, domain, target, stack and every section. */
export function filterSolutions(solutions: Solution[], f: SolutionFilters): Solution[] {
  const q = f.q?.toLowerCase()
  return solutions
    .filter(
      (s) =>
        (!f.client || s.clientId === f.client) &&
        (!f.status || s.status === f.status) &&
        (!f.kind || s.kind === f.kind) &&
        (!f.stack || s.stack.includes(f.stack)) &&
        (!q || [s.name, s.domain, s.target, ...s.stack, ...Object.values(s.sections)].some((text) => text?.toLowerCase().includes(q))),
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

/**
 * One row of the Solutions list, read off the road: steps done of the total, the Now step, and what comes
 * after it (the next open step, "The target" after the last). Every step done is Reached: the last day
 * a step was marked Done and its outcome.
 */
export function roadRow(steps: SolutionStep[], opportunities: Pick<Opportunity, "id" | "stage" | "engagementId">[] = []) {
  const done = steps.filter((s) => s.state === "done").length
  const reached = steps.length > 0 && done === steps.length
  const now = steps.findIndex((s) => s.state === "now")
  const after = steps.find((s, i) => i > now && s.state !== "done")
  const last = steps[steps.length - 1]
  // An open opportunity behind the next step names its stage: "Front-desk guest card, in Proposal".
  const payer = after && stepContract(after, opportunities)
  const opportunity = payer?.type === "opportunity" ? opportunities.find((o) => o.id === payer.id) : undefined
  const stage = opportunity && isOpen(opportunity as Opportunity) ? `, in ${STAGE_LABELS[opportunity.stage]}` : ""
  return {
    done,
    total: steps.length,
    reached,
    reachedOn: reached ? steps.map((s) => s.doneOn ?? "").sort().pop() || null : null,
    result: reached ? last.outcome : null,
    now: now >= 0 ? { number: now + 1, title: steps[now].title } : null,
    next: reached || steps.length === 0 ? null : after ? `${after.title}${stage}` : now >= 0 ? "The target" : null,
  }
}

/** The solution's own contract and the contracts its steps follow, once each: their meetings are its calls. */
export function solutionContractIds(solution: Pick<Solution, "engagementId" | "steps">, opportunities: Pick<Opportunity, "id" | "engagementId">[]): string[] {
  return [
    ...new Set([
      ...(solution.engagementId ? [solution.engagementId] : []),
      ...solution.steps.flatMap((x) => {
        const p = stepContract(x, opportunities)
        return p?.type === "contract" ? [p.id] : []
      }),
    ]),
  ]
}

/** "YYYY-MM-DD" of the newest journal entry of the solution or meeting of its contracts; null when there is none. */
export function lastActivity(
  solutionId: string,
  contractIds: string[],
  journal: Pick<JournalEntry, "solutionId" | "date">[],
  meetings: Pick<Meeting, "engagementId" | "date">[],
): string | null {
  const days = [
    ...journal.filter((e) => e.solutionId === solutionId).map((e) => e.date),
    ...meetings.filter((m) => m.engagementId && contractIds.includes(m.engagementId)).map((m) => m.date),
  ]
  return days.sort().pop() ?? null
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

/**
 * The days a contract has used of its total, the client page's way (contractUsage): hours logged up to
 * today, over 8. The burn-down cells only shape the bar, so none are passed. null for a contract with no cap.
 */
export function stepUsage(
  contract: Pick<Engagement, "id" | "contractedDays"> & Parameters<typeof contractUsage>[0]["engagement"],
  timecards: Pick<Timecard, "engagementId" | "date" | "hours">[],
  today: string,
): { used: number; total: number } | null {
  const usage = contractUsage({ engagement: contract, timecards, cells: [], today })
  return usage && { used: usage.used, total: usage.total }
}

/** The Next and Later steps an open opportunity pays for (a won one has become a contract), with their 1-based number on the road. */
export function pipelineSteps(
  steps: SolutionStep[],
  opportunities: Pick<Opportunity, "id" | "stage" | "engagementId">[],
): { number: number; step: SolutionStep; opportunity: Pick<Opportunity, "id" | "stage" | "engagementId"> }[] {
  return steps.flatMap((step, i) => {
    if (step.state === "done" || step.state === "now") return []
    const payer = stepContract(step, opportunities)
    const opportunity = payer?.type === "opportunity" ? opportunities.find((o) => o.id === payer.id) : undefined
    return opportunity && isOpen(opportunity as Opportunity) ? [{ number: i + 1, step, opportunity }] : []
  })
}

/**
 * The row's days column: the days (hours on an hourly contract) the Now step's contract has used, or the
 * solution's own when no step is Now, then the steps an open opportunity pays for: "6.5 of 11 days · 2 steps
 * in the pipeline". Either part alone when the other is missing; null with neither.
 */
export function usageSummary(
  solution: Pick<Solution, "engagementId" | "steps">,
  engagements: (Parameters<typeof stepUsage>[0] & Parameters<typeof contractUnit>[0])[],
  opportunities: Pick<Opportunity, "id" | "stage" | "engagementId">[],
  timecards: Pick<Timecard, "engagementId" | "date" | "hours">[],
  today: string,
): string | null {
  const now = nowStep(solution.steps)
  const payer = now && stepContract(now, opportunities)
  const id = payer?.type === "contract" ? payer.id : solution.engagementId
  const contract = engagements.find((e) => e.id === id)
  const usage = contract && stepUsage(contract, timecards, today)
  const unit = contract ? contractUnit(contract) : "day"
  const days = usage && `${inContractUnit(usage.used, unit)} of ${countIn(usage.total, unit)}${isOverBudget(usage) ? ", over budget" : ""}`
  const n = pipelineSteps(solution.steps, opportunities).length
  const pipeline = n > 0 ? `${n} ${n === 1 ? "step" : "steps"} in the pipeline` : null
  return [days, pipeline].filter(Boolean).join(" · ") || null
}

/** The list with step `from` moved to position `to`; out of range, the list as it was. */
export function moveStep<T>(steps: T[], from: number, to: number): T[] {
  if (from < 0 || from >= steps.length || to < 0 || to >= steps.length || from === to) return steps
  const next = [...steps]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

/** "Oct – Nov 2026", "Oct 2026", "From Oct 2026": the months a step spans, the year once where it ends (or twice if it differs). */
export function stepWhen({ fromMonth, toMonth }: Pick<SolutionStep, "fromMonth" | "toMonth">): string {
  if (!toMonth) return `From ${formatYearMonth(fromMonth, "MMM yyyy")}`
  if (toMonth === fromMonth) return formatYearMonth(fromMonth, "MMM yyyy")
  const sameYear = fromMonth.slice(0, 4) === toMonth.slice(0, 4)
  return `${formatYearMonth(fromMonth, sameYear ? "MMM" : "MMM yyyy")} – ${formatYearMonth(toMonth, "MMM yyyy")}`
}

/** Edit Step's fields as the dialog holds them: "" for an optional one left empty. */
export interface StepDraft {
  title: string
  state: SolutionStep["state"]
  fromMonth: string
  toMonth: string
  paidBy: SolutionStepPayer | null
  goal: string
  outcome: string
}

/**
 * The road after Save Step: step `index` rewritten from the draft, or the draft added at the end when
 * `index` is null. Done asks for its outcome; a step newly Done follows completeStep (Now moves on);
 * one reopened loses its outcome and day; making a step Now while another is Now is refused, as
 * update_solution refuses it (owner, 2026-11-11). The result is
 * parsed by solutionStepsSchema: the Firebase client adapter does not, so while it reports anything
 * nothing is written.
 */
export function saveStep(
  steps: SolutionStep[],
  index: number | null,
  draft: StepDraft,
  today: string,
): { steps: SolutionStep[] } | { errors: string[] } {
  const previous = index === null ? undefined : steps[index]
  const outcome = draft.outcome.trim() || null
  if (draft.state === "done" && !outcome) return { errors: ["Say what came of it to mark the step Done"] }
  const otherNow = steps.findIndex((s, i) => s.state === "now" && i !== index)
  if (draft.state === "now" && otherNow !== -1) return { errors: [`Step ${otherNow + 1} is Now: mark it Done or set it to Next first`] }
  const step: SolutionStep = {
    title: draft.title.trim(),
    state: draft.state,
    fromMonth: draft.fromMonth,
    toMonth: draft.toMonth || null,
    paidBy: draft.paidBy,
    goal: draft.goal.trim() || null,
    // Only reopening a Done step clears its outcome; another step may carry one (the MCP allows it).
    outcome: previous?.state === "done" && draft.state !== "done" ? null : outcome,
    doneOn: draft.state === "done" ? (previous?.state === "done" ? previous.doneOn : today) : null,
  }
  let next: SolutionStep[]
  if (index === null) next = [...steps, step]
  else if (draft.state === "done" && previous?.state !== "done") next = completeStep(steps.map((s, i) => (i === index ? { ...step, state: previous!.state } : s)), index, outcome!, today) // keeps the edits
  else next = steps.map((s, i) => (i === index ? step : s))
  const parsed = solutionStepsSchema.safeParse(next)
  return parsed.success ? { steps: parsed.data } : { errors: [...new Set(parsed.error.issues.map((i) => i.message))] }
}
