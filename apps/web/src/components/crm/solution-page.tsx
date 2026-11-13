"use client"


import { ContentCard } from "@alter-ego/ui/page/content-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { InlineEditor } from "@alter-ego/ui/page/inline-editor"
import { MetaRow, StatusDot } from "@alter-ego/ui/page/meta-row"
import { OnThisPage } from "@alter-ego/ui/page/on-this-page"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { ProgressBar, SegmentedProgress } from "@alter-ego/ui/page/progress"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { StatusPill, TagList } from "@alter-ego/ui/page/status-pill"
import { Timeline } from "@alter-ego/ui/page/timeline"
import { badgeVariants } from "@alter-ego/ui/ui/badge"
import { Button } from "@alter-ego/ui/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@alter-ego/ui/ui/dropdown-menu"
import { Input } from "@alter-ego/ui/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@alter-ego/ui/ui/tabs"
import { toast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { format } from "date-fns"
import { Flag, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react"
import { flushSync } from "react-dom"

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { LogWorkDialog } from "@/components/crm/log-work-dialog"
import { PresentBanner, PresentButton } from "@/components/crm/present-controls"
import { SolutionFormDialog } from "@/components/crm/solution-form-dialog"
import { SolutionGraph } from "@/components/crm/solution-graph"
import { SolutionJournal } from "@/components/crm/solution-journal"
import { SolutionRoad } from "@/components/crm/solution-road"
import { StepDialog, type StepPayerOption } from "@/components/crm/step-dialog"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import { useEngagements } from "@/hooks/use-engagements"
import { useJournal } from "@/hooks/use-journal"
import { useMeetings } from "@/hooks/use-meetings"
import { useOpportunities } from "@/hooks/use-opportunities"
import { usePresent } from "@/hooks/use-present"
import { useDeleteSolution, useSolutions, useUpdateSolution } from "@/hooks/use-solutions"
import { useTasks } from "@/hooks/use-tasks"
import { useTimecards } from "@/hooks/use-timecards"
import { contractUnit, countIn, engagementLabel, inContractUnit, isOverBudget } from "@/lib/engagements"
import { MEETING_HEALTH, formatMeetingDate, healthByContract, sortMeetings } from "@/lib/meetings"
import { OPEN_STAGES, STAGE_LABELS, STAGE_TONE } from "@/lib/opportunities"
import { SOLUTION_STATUS, contractState, historyEntries, lineLabel, moveStep, nowStep, pipelineSteps, sectionsFor, solutionContractIds, shortDay, stepContract, stepUsage } from "@/lib/solutions"
import { sortTasks } from "@/lib/tasks"
import {
  MAX_SOLUTION_ENTITIES,
  MAX_SOLUTION_RELATIONS,
  MAX_SOLUTION_STEPS,
  SOLUTION_SECTIONS,
  SOLUTION_SECTION_MAX,
  updateSolutionSchema,
} from "@/types/schemas"

import type {
  Client,
  Engagement,
  JournalEntry,
  Meeting,
  Opportunity,
  Solution,
  SolutionStep,
  SolutionStepPayer,
  Task,
  Timecard,
  SolutionSectionKey,
  SolutionSections,
  UpdateSolutionInput,
} from "@/types"

/**
 * The data model as its inputs hold it: "" where the stored value is null, and
 * each relation end as its entity's row, not its name. A renamed entity keeps
 * its relations, and a name typed through another entity's on the way ("Order"
 * on the way to "OrderItem") can never capture them.
 */
export interface DataModelDraft {
  entities: { name: string; source: string; notes: string }[]
  /** An end is null while no entity is picked, or after the one picked is removed. */
  relations: { from: number | null; to: number | null; type: string }[]
}

export function dataModelDraft(solution: Pick<Solution, "entities" | "relations">): DataModelDraft {
  const row = (name: string) => {
    const i = solution.entities.findIndex((e) => e.name === name)
    return i < 0 ? null : i
  }
  return {
    entities: solution.entities.map((e) => ({ name: e.name, source: e.source ?? "", notes: e.notes ?? "" })),
    relations: solution.relations.map((r) => ({ from: row(r.from), to: row(r.to), type: r.type })),
  }
}

const same = (a: DataModelDraft, b: DataModelDraft) => JSON.stringify(a) === JSON.stringify(b)

/**
 * What Save Data Model writes: the entities and the relations together, parsed
 * by updateSolutionSchema, so each relation is checked against the entities it
 * will sit beside. The Firebase client adapter does not parse, so this is the
 * check: while it reports anything, nothing is written. Each message names its row.
 */
export function dataModelUpdate(draft: DataModelDraft): { input: UpdateSolutionInput } | { errors: string[] } {
  const ends = draft.relations.flatMap((r, i) =>
    r.from !== null && r.to !== null ? [] : [`Relation ${i + 1}: pick an entity at each end`],
  )
  if (ends.length > 0) return { errors: ends }
  const name = (row: number | null) => (row === null ? "" : draft.entities[row].name)
  const parsed = updateSolutionSchema.safeParse({
    entities: draft.entities.map((e) => ({ name: e.name, source: e.source.trim() || null, notes: e.notes.trim() || null })),
    relations: draft.relations.map((r) => ({ from: name(r.from), to: name(r.to), type: r.type })),
  })
  if (parsed.success) return { input: parsed.data }
  const row = { entities: "Entity", relations: "Relation" } as Record<PropertyKey, string>
  return {
    errors: parsed.error.issues
      // An end is an entity's row, so its only fault is that entity's blank name, already reported on the entity.
      .filter(({ path }) => !(path[0] === "relations" && (path[2] === "from" || path[2] === "to")))
      .map(({ path: [list, i], message }) =>
        typeof i === "number" && row[list as PropertyKey] ? `${row[list as PropertyKey]} ${i + 1}: ${message}` : message,
      ),
  }
}

/** Entity i removed: a relation to it keeps its row with that end empty, refused on save until another is picked. */
export function removeEntity(draft: DataModelDraft, i: number): DataModelDraft {
  const end = (row: number | null) => (row === null || row === i ? null : row > i ? row - 1 : row)
  return {
    entities: draft.entities.filter((_, j) => j !== i),
    relations: draft.relations.map((r) => ({ ...r, from: end(r.from), to: end(r.to) })),
  }
}

/** A table cell's input. A phone hides the column headings, so there it carries its own. */
function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("grid min-w-0 gap-1", className)}>
      <span aria-hidden className="text-xs text-muted-foreground sm:hidden">
        {label}
      </span>
      {children}
    </div>
  )
}

/**
 * The page's reading order (Solution.dc): what pre-sales reads first, the data model in the middle. The MCP
 * interview asks in SOLUTION_SECTIONS' own order.
 */
const PAGE_ORDER: SolutionSectionKey[] = ["purpose", "kpis", "results", "model", "requirements", "sources", "architecture", "steps", "history"]
type Section = (typeof SOLUTION_SECTIONS)[number]
const SECTION = Object.fromEntries(SOLUTION_SECTIONS.map((s) => [s.key, s])) as Record<SolutionSectionKey, Section>
/** The sections an Advisory can take on request: Add Section. */
const ADDABLE: SolutionSectionKey[] = ["requirements", "sources", "model", "architecture"]
/** Side by side as cards (Solution.dc): what it measured beside what it delivered. */
const CARDS: SolutionSectionKey[] = ["kpis", "results"]
/** Under an empty card's question. Pre-sales reads Results first, so its Write is the one filled button. */
const NOT_WRITTEN: Partial<Record<SolutionSectionKey, string>> = {
  kpis: "Not written yet.",
  results: "The section pre-sales reads first. Not written yet.",
}
/** The editor's hint: how its text will show. */
const PROSE_HINT = 'Plain text: each line shows as its own line, and a "Label:" at its start shows in bold.'
const HISTORY_HINT = "One line per entry, opening on its date: 2026-07-15 Go-live."
/** The chips' labels on a phone, where the index's long ones crowd the row. */
const SHORT: Partial<Record<SolutionSectionKey, string>> = { purpose: "Purpose", sources: "Sources" }

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const written = (s: Solution, key: SolutionSectionKey) => Boolean(s.sections[key]?.trim())

const PROSE = {
  // Purpose and Target: the lead paragraph.
  lead: { box: "gap-3", line: "text-[17px] leading-[1.6] tracking-[-0.005em] text-pretty sm:text-xl sm:leading-[1.55]" },
  // KPIs and Results: a row per line, hairlines between.
  rows: { box: "", line: "border-t border-hairline py-2.5 text-[14.5px] leading-normal text-foreground/80" },
  text: { box: "max-w-[68ch] gap-2", line: "text-[15.5px] leading-[1.65]" },
  // Modelling choices, inside the data model card.
  small: { box: "gap-2", line: "text-[15px] leading-[1.65]" },
}

/** Plain text as the page shows it: a paragraph per line, a leading "Label:" in bold. Never Markdown. */
function Prose({ text, variant }: { text: string; variant: keyof typeof PROSE }) {
  return (
    <div className={cn("flex flex-col text-foreground/90", PROSE[variant].box)}>
      {text
        .split("\n")
        .filter((line) => line.trim())
        .map((line, i) => {
          const label = lineLabel(line)
          return (
            <p key={i} className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]", PROSE[variant].line)}>
              {label ? (
                <>
                  <strong className="font-semibold text-foreground">{label}</strong>
                  {line.slice(label.length)}
                </>
              ) : (
                line
              )}
            </p>
          )
        })}
    </div>
  )
}

/**
 * One solution's page, /solutions/[id]: its header, how much is written, the nine sections each saved on its
 * own, and the data model. The page is the only place a solution is deleted: chat can create and update.
 */
export function SolutionPage({ id }: { id: string }) {
  const { user } = useAuth()
  const solutionsQuery = useSolutions(user?.id)
  const clientsQuery = useClients(user?.id)
  const engagementsQuery = useEngagements(user?.id)
  const meetingsQuery = useMeetings(user?.id)
  const opportunitiesQuery = useOpportunities(user?.id)
  const timecardsQuery = useTimecards(user?.id)
  const tasksQuery = useTasks(user?.id)
  const journalQuery = useJournal(user?.id)
  const gate = pageState([solutionsQuery, clientsQuery, engagementsQuery, meetingsQuery, opportunitiesQuery, timecardsQuery, tasksQuery, journalQuery])
  if (gate) return gate

  const solutions = solutionsQuery.data ?? []
  const solution = solutions.find((s) => s.id === id)
  if (!solution) {
    return (
      <PageHeader
        size="detail"
        back={{ href: "/solutions", label: "Solutions" }}
        title="Solution not found"
        subtitle="It was deleted, or the link is wrong."
      />
    )
  }
  return (
    <SolutionBody
      key={solution.id}
      solution={solution}
      solutions={solutions}
      userId={user?.id}
      clients={clientsQuery.data ?? []}
      engagements={engagementsQuery.data ?? []}
      meetings={meetingsQuery.data ?? []}
      opportunities={opportunitiesQuery.data ?? []}
      timecards={timecardsQuery.data ?? []}
      tasks={tasksQuery.data ?? []}
      journal={journalQuery.data ?? []}
    />
  )
}

function SolutionBody({
  solution,
  solutions,
  userId,
  clients,
  engagements,
  meetings,
  opportunities,
  timecards,
  tasks,
  journal,
}: {
  solution: Solution
  solutions: Solution[]
  userId: string | undefined
  clients: Client[]
  engagements: Engagement[]
  meetings: Meeting[]
  opportunities: Opportunity[]
  timecards: Timecard[]
  tasks: Task[]
  journal: JournalEntry[]
}) {
  const router = useRouter()
  const { present, href } = usePresent()
  const update = useUpdateSolution(userId)
  const remove = useDeleteSolution(userId)
  /** The sections open for editing, with their text so far; a section absent here shows as text. */
  const [drafts, setDrafts] = useState<Partial<Record<SolutionSectionKey, string>>>({})
  /** The text each editor opened with: Unsaved changes is the draft against it, so History's line for today alone is no change. */
  const [opened, setOpened] = useState<Partial<Record<SolutionSectionKey, string>>>({})
  /** Each save running or failed, by section ("model" for the data model): saves overlap, each keeps its own outcome. */
  const [saves, setSaves] = useState<Partial<Record<SolutionSectionKey | "model" | "road", "saving" | "failed">>>({})
  const stored = dataModelDraft(solution)
  const [model, setModel] = useState(stored)
  /** The stored data model the draft started from: Unsaved changes is the draft against it, never against a refetch. */
  const [base, setBase] = useState(stored)
  const [modelErrors, setModelErrors] = useState<string[]>([])
  // An empty model has no graph to show: it opens on its first table.
  const [tab, setTab] = useState(solution.entities.length > 0 ? "graph" : "entities")
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [leaving, setLeaving] = useState(false)
  /** Sections an Advisory took on through Add Section. */
  const [added, setAdded] = useState<SolutionSectionKey[]>([])
  /** Edit Step's step ("new" = Add Step) and its opening, so a draft never outlives it. */
  const [stepEdit, setStepEdit] = useState<{ index: number | "new"; session: number } | null>(null)
  const [deletingStep, setDeletingStep] = useState<number | null>(null)
  /** Log Work's entry ("new" files one) and its opening, so a draft never outlives it. */
  const [logging, setLogging] = useState<{ entry: JournalEntry | "new"; session: number } | null>(null)
  const openLog = (entry: JournalEntry | "new") => setLogging((l) => ({ entry, session: (l?.session ?? 0) + 1 }))
  const moreButton = useRef<HTMLButtonElement>(null)

  // Another writer (a second tab, chat) changed the data model: an untouched
  // draft follows it, so Save Data Model never writes back a stale copy.
  if (!same(base, stored) && same(model, base)) {
    setBase(stored)
    setModel(stored)
  }

  const client = clients.find((c) => c.id === solution.clientId)
  const contract = engagements.find((e) => e.id === solution.engagementId)
  const health = contract && healthByContract(meetings).get(contract.id)
  const lastMeeting = contract && sortMeetings(meetings.filter((m) => m.engagementId === contract.id))[0]
  const edited = solution.updatedAt.getTime() > solution.createdAt.getTime()
  // The kind's own sections count; Steps and History show only while they hold text, an Advisory's others once added or written.
  const kindKeys = sectionsFor(solution.kind).map((x) => x.key)
  const labelOf = (key: SolutionSectionKey) => sectionsFor(solution.kind).find((x) => x.key === key)?.label ?? SECTION[key].label
  const modelPresent = solution.entities.length > 0 || solution.relations.length > 0
  const shown = (key: SolutionSectionKey) =>
    kindKeys.includes(key) || written(solution, key) || added.includes(key) || drafts[key] !== undefined || (key === "model" && modelPresent)
  const SECTIONS = PAGE_ORDER.filter(shown).map((key) => ({ ...SECTION[key], label: labelOf(key) }))
  const missing = PAGE_ORDER.filter((key) => kindKeys.includes(key) && !written(solution, key)).map((key) => ({ ...SECTION[key], label: labelOf(key) }))
  const filled = kindKeys.length - missing.length
  const addable = ADDABLE.filter((key) => !shown(key))
  const today = format(new Date(), "yyyy-MM-dd")
  const now = nowStep(solution.steps)
  const nowIndex = now ? solution.steps.indexOf(now) : -1
  const nowPayer = now && stepContract(now, opportunities)
  const nowContract = nowPayer?.type === "contract" ? engagements.find((e) => e.id === nowPayer.id) : undefined
  const nowUsage = nowContract && stepUsage(nowContract, timecards, today)
  const nowHealth = nowContract && healthByContract(meetings).get(nowContract.id)
  const nowCall = nowContract && sortMeetings(meetings.filter((m) => m.engagementId === nowContract.id))[0]
  const nowUnit = nowContract ? contractUnit(nowContract) : "day"
  const nowLine = nowUsage ? `${inContractUnit(nowUsage.used, nowUnit)} of ${countIn(nowUsage.total, nowUnit)} used` : null
  const nowTasks = nowContract ? sortTasks(tasks.filter((t) => !t.isDone && t.engagementId === nowContract.id)) : []
  const pipeline = pipelineSteps(solution.steps, opportunities)
  /** The solution's own contract and the contracts its steps follow: their meetings are the Journal's calls. */
  const journalContracts = solutionContractIds(solution, opportunities)
  /** The client's contracts and open opportunities: what a step can be paid by. */
  const payers: StepPayerOption[] = [
    ...engagements
      .filter((e) => e.clientId === solution.clientId)
      .map((e) => ({ type: "contract" as const, id: e.id, label: `Contract · ${engagementLabel(e)} · ${contractState(e).toLowerCase()}` })),
    ...opportunities
      .filter((o) => o.clientId === solution.clientId && (OPEN_STAGES as readonly string[]).includes(o.stage))
      .map((o) => ({ type: "opportunity" as const, id: o.id, label: `Opportunity · ${o.title} · ${STAGE_LABELS[o.stage]}` })),
  ]
  /** Paid by for a payer the client does not list as open: a won opportunity reads as the contract it became. */
  const payerLabel = (p: SolutionStepPayer) => {
    const o = p.type === "opportunity" ? opportunities.find((x) => x.id === p.id) : undefined
    const won = o?.engagementId ? engagements.find((e) => e.id === o.engagementId) : undefined
    if (won) return `Won · Contract ${engagementLabel(won)}`
    return o ? `Opportunity · ${o.title} · ${STAGE_LABELS[o.stage]}` : "No longer listed"
  }
  const changed = (key: SolutionSectionKey) => drafts[key] !== undefined && drafts[key] !== opened[key]
  const modelChanged = !same(model, base)
  const dirty = modelChanged || SOLUTION_SECTIONS.some(({ key }) => changed(key))

  // A reload or a closed tab with unsaved edits asks first; the breadcrumb asks through Discard Changes.
  // ponytail: the sidebar's links leave without asking; a router guard if lost edits get reported.
  useEffect(() => {
    if (!dirty) return
    const keep = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", keep)
    return () => window.removeEventListener("beforeunload", keep)
  }, [dirty])

  /** Closes a section's editor. Focus in it, or dropped (a disabled Save drops it), goes to its Write/Edit button, not the page's top. */
  function closeEditor(key: SolutionSectionKey) {
    const active = document.activeElement
    const inside = document.getElementById(`solution-editor-${key}`)?.contains(active)
    flushSync(() =>
      setDrafts((d) => {
        const next = { ...d }
        delete next[key]
        return next
      }),
    )
    if (!active || active === document.body || inside) document.getElementById(`solution-edit-${key}`)?.focus()
  }

  /** Writes one part beside any other save still running. False when it failed. */
  async function write(key: SolutionSectionKey | "model" | "road", input: UpdateSolutionInput) {
    setSaves((s) => ({ ...s, [key]: "saving" }))
    try {
      await update.mutateAsync({ id: solution.id, input })
      setSaves((s) => ({ ...s, [key]: undefined }))
      return true
    } catch {
      setSaves((s) => ({ ...s, [key]: "failed" }))
      return false
    }
  }

  async function saveSection(key: SolutionSectionKey) {
    // History's line for today, left without words, is not an entry.
    const text = key === "history" ? (drafts[key] ?? "").replace(/(^|\n)\d{4}-\d{2}-\d{2}\s*$/, "") : (drafts[key] ?? "")
    // Only this section: the other eight, and whatever chat wrote to them, stay as stored.
    const sections: Partial<SolutionSections> = { [key]: text.trim() ? text : null }
    if (await write(key, { sections })) closeEditor(key)
  }

  /** Writes the road. Steps were parsed by saveStep; a reorder or a delete changes none of their fields. */
  async function saveRoad(steps: SolutionStep[]) {
    const ok = await write("road", { steps })
    if (ok) setStepEdit(null)
    return ok
  }

  async function moveTo(from: number, to: number) {
    // A second write built from the stale road would undo the first.
    if (from === to || saves.road === "saving") return
    // Edit Step follows its step to the new place.
    if (await write("road", { steps: moveStep(solution.steps, from, to) })) setStepEdit((e) => (e && e.index === from ? { ...e, index: to } : e))
  }

  async function saveModel() {
    const result = dataModelUpdate(model)
    if ("errors" in result) return setModelErrors(result.errors)
    setModelErrors([])
    if (!(await write("model", result.input))) return setModelErrors(["Save failed. Try again."])
    const saved = dataModelDraft({ entities: result.input.entities ?? [], relations: result.input.relations ?? [] })
    setBase(saved)
    // An edit made while it saved stays, and stays unsaved.
    setModel((m) => (same(m, model) ? saved : m))
  }

  /** Rows are keyed by position: removing one, the next takes its place and focus. Removing the last, focus goes up a row, or to Add. */
  function removeRow(list: "entity" | "relation", i: number, rows: number, next: (m: DataModelDraft) => DataModelDraft) {
    flushSync(() => setModel(next))
    if (i === rows - 1) document.getElementById(i > 0 ? `solution-${list}-remove-${i - 1}` : `solution-add-${list}`)?.focus()
  }

  const savingModel = saves.model === "saving"
  const setEntity = (i: number, patch: Partial<DataModelDraft["entities"][number]>) =>
    setModel((m) => ({ ...m, entities: m.entities.map((e, j) => (j === i ? { ...e, ...patch } : e)) }))
  const setRelation = (i: number, patch: Partial<DataModelDraft["relations"][number]>) =>
    setModel((m) => ({ ...m, relations: m.relations.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))
  /** An entity to pick, by its row; empty again when that entity is removed. */
  const endSelect = (i: number, end: "from" | "to", label: string) => {
    const value = model.relations[i][end]
    return (
      <Select value={value === null ? "" : String(value)} onValueChange={(v) => setRelation(i, { [end]: Number(v) })}>
        <SelectTrigger aria-label={`Relation ${i + 1} ${label}`}>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {model.entities.map((e, j) => (
            <SelectItem key={j} value={String(j)}>
              {e.name.trim() || `Entity ${j + 1} (no name)`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  const openEditor = (key: SolutionSectionKey, text: string) => {
    setDrafts((d) => ({ ...d, [key]: text }))
    setOpened((o) => ({ ...o, [key]: text }))
  }

  /** A section's editor: `name` is what its Save saves, `labelId` the heading that names its textbox. */
  const editor = (key: SolutionSectionKey, name: string = labelOf(key), labelId = `solution-section-${key}`) => (
    <InlineEditor
      id={`solution-editor-${key}`}
      labelledBy={labelId}
      question={SECTION[key].question}
      value={drafts[key] ?? ""}
      onChange={(value) => setDrafts((d) => ({ ...d, [key]: value }))}
      maxLength={SOLUTION_SECTION_MAX}
      hint={key === "history" ? HISTORY_HINT : PROSE_HINT}
      saveLabel={`Save ${name}`}
      saving={saves[key] === "saving"}
      error={saves[key] === "failed" ? "Save failed. Try again." : null}
      onSave={() => saveSection(key)}
      onCancel={() => closeEditor(key)}
    />
  )

  const unsaved = (key: SolutionSectionKey) => changed(key) && <StatusPill tone="warning">Unsaved changes</StatusPill>

  /** A written section's pencil. History's way in is Add an Entry: the editor opens with a line for today under the rest. */
  const editButton = (key: SolutionSectionKey, label: string, className?: string) =>
    present ? null : key === "history" ? (
      <Button
        id="solution-edit-history"
        variant="ghost"
        size="lg"
        className="-mr-2 px-2 text-foreground/80 sm:mr-0 sm:px-3"
        aria-label="Add an Entry"
        onClick={() => openEditor("history", `${(solution.sections.history ?? "").trimEnd()}\n${format(new Date(), "yyyy-MM-dd")} `)}
      >
        <Plus aria-hidden />
        {/* One flex item: the button's gap would split the words. */}
        <span>
          Add<span className="max-sm:hidden"> an Entry</span>
        </span>
      </Button>
    ) : (
      <Button
        id={`solution-edit-${key}`}
        variant="ghost"
        size="icon-lg"
        className={cn("text-muted-foreground", className)}
        aria-label={`Edit ${label}`}
        onClick={() => openEditor(key, solution.sections[key] ?? "")}
      >
        <Pencil aria-hidden />
      </Button>
    )

  /** One section, the data model aside: a dashed prompt while empty, else its heading over its text or its editor. */
  function block(key: SolutionSectionKey) {
    const { question } = SECTION[key]
    const label = labelOf(key)
    const headingId = `solution-section-${key}`
    const text = solution.sections[key] ?? ""
    const open = drafts[key] !== undefined
    const card = CARDS.includes(key)
    // Presenting, a section nobody has written shows nothing: its prompt asks to be written.
    if (!open && !text.trim() && present) return null
    if (!open && !text.trim()) {
      return (
        <section key={key} id={key} aria-labelledby={headingId} className="scroll-mt-20">
          <EmptyPrompt
            titleId={headingId}
            title={label}
            description={
              card ? (
                <>
                  {question}
                  <span className="mt-1.5 block text-meta text-muted-foreground">{NOT_WRITTEN[key]}</span>
                </>
              ) : (
                question
              )
            }
            action={
              <Button
                id={`solution-edit-${key}`}
                variant={key === "results" ? "default" : "outline"}
                size="lg"
                className="shrink-0"
                onClick={() => openEditor(key, "")}
              >
                Write {label}
              </Button>
            }
            className={card ? "h-full justify-center" : "sm:flex-row sm:items-center sm:justify-between"}
          />
        </section>
      )
    }
    const header = (
      <SectionHeader
        id={headingId}
        title={label}
        variant={key === "purpose" ? "eyebrow" : card ? "card" : "section"}
        description={unsaved(key)}
        actions={!open && editButton(key, label, card ? "-my-2.5 -mr-2.5" : undefined)}
      />
    )
    const entries = key === "history" && !open ? historyEntries(text) : null
    const body = open ? (
      editor(key)
    ) : entries ? (
      <Timeline
        phoneLimit={3}
        items={entries.map((e, i) => ({
          key: String(i),
          date: e.date,
          content: <span className="whitespace-pre-line">{e.text}</span>,
          outline: i === entries.length - 1,
        }))}
      />
    ) : (
      <Prose text={text} variant={key === "purpose" ? "lead" : card ? "rows" : "text"} />
    )
    return card ? (
      <ContentCard
        key={key}
        as="section"
        id={key}
        labelledBy={headingId}
        // Editing, it takes the row: the editor wants the width.
        className={cn("flex scroll-mt-20 flex-col gap-3.5", open && "col-span-full")}
      >
        {header}
        {body}
      </ContentCard>
    ) : (
      <section key={key} id={key} aria-labelledby={headingId} className="flex scroll-mt-20 flex-col gap-3">
        {header}
        {body}
      </section>
    )
  }

  const more = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={moreButton} variant="outline" size="icon-lg" className="max-sm:border-transparent" aria-label="More actions">
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      {/* The dialogs these open say where focus goes back to. */}
      <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
        {/* A phone has no room for Edit Details beside the title: it lives here. */}
        <DropdownMenuItem className="sm:hidden" onClick={() => setEditing(true)}>
          <Pencil aria-hidden /> Edit Details
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
          <Trash2 aria-hidden /> Delete Solution
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  /** Presenting: the saved model's graph alone, with no tables to edit. */
  const presentModel = (
    <ContentCard as="section" id="model" labelledBy="solution-section-model" className="flex scroll-mt-20 flex-col gap-4 rounded-2xl">
      <h2 id="solution-section-model" className="text-[17px] font-semibold tracking-tight">
        Data Model
      </h2>
      <div className="rounded-xl border border-hairline bg-surface-subtle p-2">
        <SolutionGraph entities={solution.entities} relations={solution.relations} />
      </div>
    </ContentCard>
  )

  const dataModel = (
    <ContentCard
      key="model"
      as="section"
      id="model"
      labelledBy="solution-section-model"
      className="flex scroll-mt-20 flex-col gap-[18px] rounded-2xl"
    >
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="solution-section-model" className="text-[17px] font-semibold tracking-tight">
              Data Model
            </h2>
            <span className="text-meta text-muted-foreground">
              {count(solution.entities.length, "entity", "entities")} · {count(solution.relations.length, "relation", "relations")}
            </span>
          </div>
          <TabsList aria-label="Data model view" className="max-sm:grid max-sm:w-full max-sm:grid-cols-3">
            <TabsTrigger value="graph">Graph</TabsTrigger>
            <TabsTrigger value="entities">Entities</TabsTrigger>
            <TabsTrigger value="relations">Relations</TabsTrigger>
          </TabsList>
        </div>

        {/* Mounted while hidden: a table keeps the focus targets Remove hands on, the graph its size. */}
        <TabsContent value="graph" forceMount className="mt-0 data-[state=inactive]:hidden">
          {solution.entities.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {/* The saved model: the tables are the draft, the record and what a screen reader reads. */}
              <div className="rounded-xl border border-hairline bg-surface-subtle p-2">
                <SolutionGraph entities={solution.entities} relations={solution.relations} />
              </div>
              {modelChanged && <p className="text-xs text-muted-foreground">The graph shows the saved model.</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No entities yet: add them under Entities, then how they relate.</p>
          )}
        </TabsContent>

        {/* The tables and their Save, which stays pinned to the screen's bottom while they are on it. */}
        <div className="flex flex-col gap-4">
          <TabsContent value="entities" forceMount className="mt-0 space-y-2 data-[state=inactive]:hidden">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground tabular-nums">
                {model.entities.length} / {MAX_SOLUTION_ENTITIES}
              </p>
              <Button
                id="solution-add-entity"
                variant="outline"
                size="sm"
                disabled={model.entities.length >= MAX_SOLUTION_ENTITIES}
                onClick={() => setModel((m) => ({ ...m, entities: [...m.entities, { name: "", source: "", notes: "" }] }))}
              >
                <Plus aria-hidden /> Add Entity
              </Button>
            </div>
            {model.entities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No entities yet.</p>
            ) : (
              <>
                <div aria-hidden className="hidden grid-cols-[repeat(3,minmax(0,1fr))_2.25rem] gap-2 text-xs text-muted-foreground sm:grid">
                  <span>Name</span>
                  <span>Source</span>
                  <span>Notes</span>
                </div>
                {/* A phone has a card per entity: the name beside Remove, then source and notes full width. */}
                {model.entities.map((e, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md border p-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:border-0 sm:p-0"
                  >
                    <Field label="Name">
                      <Input
                        aria-label={`Entity ${i + 1} name`}
                        placeholder="Name"
                        maxLength={100}
                        value={e.name}
                        onChange={(ev) => setEntity(i, { name: ev.target.value })}
                      />
                    </Field>
                    <Field label="Source" className="max-sm:col-span-2">
                      <Input
                        aria-label={`Entity ${i + 1} source`}
                        placeholder="Source, e.g. SAP MARA"
                        maxLength={200}
                        value={e.source}
                        onChange={(ev) => setEntity(i, { source: ev.target.value })}
                      />
                    </Field>
                    <Field label="Notes" className="max-sm:col-span-2">
                      <Input
                        aria-label={`Entity ${i + 1} notes`}
                        placeholder="Notes"
                        maxLength={1000}
                        value={e.notes}
                        onChange={(ev) => setEntity(i, { notes: ev.target.value })}
                      />
                    </Field>
                    <Button
                      id={`solution-entity-remove-${i}`}
                      variant="ghost"
                      size="icon"
                      className="self-end max-sm:col-start-2 max-sm:row-start-1"
                      aria-label={`Remove entity ${i + 1}`}
                      onClick={() => removeRow("entity", i, model.entities.length, (m) => removeEntity(m, i))}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                ))}
              </>
            )}
          </TabsContent>

          <TabsContent value="relations" forceMount className="mt-0 space-y-2 data-[state=inactive]:hidden">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground tabular-nums">
                {model.relations.length} / {MAX_SOLUTION_RELATIONS}
              </p>
              <Button
                id="solution-add-relation"
                variant="outline"
                size="sm"
                disabled={model.relations.length >= MAX_SOLUTION_RELATIONS || model.entities.length === 0}
                onClick={() => setModel((m) => ({ ...m, relations: [...m.relations, { from: null, to: null, type: "" }] }))}
              >
                <Plus aria-hidden /> Add Relation
              </Button>
            </div>
            {model.relations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {model.entities.length === 0 ? "Add an entity first: a relation joins two of them." : "No relations yet."}
              </p>
            ) : (
              <>
                <div aria-hidden className="hidden grid-cols-[repeat(3,minmax(0,1fr))_2.25rem] gap-2 text-xs text-muted-foreground sm:grid">
                  <span>From</span>
                  <span>To</span>
                  <span>Type</span>
                </div>
                {/* A phone has From and To side by side beside Remove, then the type full width. */}
                {model.relations.map((r, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 rounded-md border p-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:border-0 sm:p-0"
                  >
                    <Field label="From">{endSelect(i, "from", "From")}</Field>
                    <Field label="To">{endSelect(i, "to", "To")}</Field>
                    <Field label="Type" className="max-sm:col-span-full">
                      <Input
                        aria-label={`Relation ${i + 1} type`}
                        placeholder="Type, e.g. IN_CATEGORY"
                        maxLength={60}
                        value={r.type}
                        onChange={(ev) => setRelation(i, { type: ev.target.value })}
                      />
                    </Field>
                    <Button
                      id={`solution-relation-remove-${i}`}
                      variant="ghost"
                      size="icon"
                      className="self-end max-sm:col-start-3 max-sm:row-start-1"
                      aria-label={`Remove relation ${i + 1}`}
                      onClick={() =>
                        removeRow("relation", i, model.relations.length, (m) => ({
                          ...m,
                          relations: m.relations.filter((_, j) => j !== i),
                        }))
                      }
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                ))}
              </>
            )}
          </TabsContent>

          {modelErrors.length > 0 && (
            <ul role="alert" className="space-y-1 text-sm text-destructive">
              {modelErrors.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}

          {/* Saves both tables together. Pinned inside the page's scroll: a long data model keeps Save in reach. */}
          {(tab !== "graph" || modelChanged) && (
            <div className="sticky bottom-0 z-10 mx-[calc(var(--card-padding)*-1)] flex flex-wrap items-center justify-end gap-2 border-y border-hairline bg-card px-(--card-padding) py-3">
              {modelChanged && <span className="mr-auto text-xs text-warning-soft-foreground">Unsaved changes</span>}
              <Button disabled={savingModel} onClick={saveModel}>
                {savingModel ? "Saving…" : "Save Data Model"}
              </Button>
            </div>
          )}
        </div>
      </Tabs>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* The Data Model section's prose, named apart from the card: its Save is not Save Data Model. */}
            <p id="solution-modelling-choices" className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Modelling choices
            </p>
            {unsaved("model")}
          </div>
          {drafts.model === undefined && written(solution, "model") && editButton("model", "Modelling Choices", "-my-2.5 -mr-2.5")}
        </div>
        {drafts.model !== undefined ? (
          editor("model", "Modelling Choices", "solution-modelling-choices")
        ) : written(solution, "model") ? (
          <Prose text={solution.sections.model ?? ""} variant="small" />
        ) : (
          <EmptyPrompt
            variant="inline"
            title={SECTION.model.question}
            action={
              <Button id="solution-edit-model" variant="outline" size="sm" onClick={() => openEditor("model", "")}>
                Write Modelling Choices
              </Button>
            }
          />
        )}
      </div>
    </ContentCard>
  )

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      {present && <PresentBanner />}
      <PageHeader
        size="detail"
        back={{
          href: href("/solutions"),
          label: "Solutions",
          current: client?.name ?? "Unknown client",
          onNavigate: (e) => {
            if (!dirty) return
            e.preventDefault()
            setLeaving(true)
          },
        }}
        pills={
          <>
            <StatusPill tone={SOLUTION_STATUS[solution.status].tone}>{SOLUTION_STATUS[solution.status].label}</StatusPill>
            <span className={cn(badgeVariants({ variant: "outline" }), "font-normal")}>{solution.kind === "advisory" ? "Advisory" : "Product"}</span>
            {solution.domain && (
              <span className={cn(badgeVariants({ variant: "outline" }), "font-normal [overflow-wrap:anywhere]")}>{solution.domain}</span>
            )}
          </>
        }
        title={solution.name}
        meta={
          <>
            <MetaRow className="[overflow-wrap:anywhere]">
              <span>{client?.name ?? "Unknown client"}</span>
              {contract ? (
                <StatusDot tone={health ? MEETING_HEALTH[health.health!].tone : contract.isActive ? "success" : "neutral"}>
                  <span>
                    {present ? null : `${engagementLabel(contract)} · `}
                    {health ? `${health.health} on ${formatMeetingDate(health.date)}` : contractState(contract)}
                  </span>
                </StatusDot>
              ) : (
                <StatusDot outline>Pre-sales</StatusDot>
              )}
              <span className="text-muted-foreground">
                {lastMeeting && `Last meeting ${shortDay(new Date(`${lastMeeting.date}T00:00:00`))} · `}
                {edited ? `updated ${shortDay(solution.updatedAt)}` : `created ${shortDay(solution.createdAt)}`}
              </span>
            </MetaRow>
            {solution.stack.length > 0 && <TagList items={solution.stack} />}
          </>
        }
        actions={
          present ? undefined : (
            <>
              <PresentButton />
              <Button variant="outline" size="lg" onClick={() => openLog("new")}>
                <Plus aria-hidden /> Log Work
              </Button>
              <Button variant="outline" size="lg" className="max-sm:hidden" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> Edit Details
              </Button>
            </>
          )
        }
        more={present ? undefined : more}
      />

      {solution.target && (
        <ContentCard as="section" labelledBy="solution-target" className="flex items-start gap-3">
          <Flag aria-hidden className="mt-1 size-5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="solution-target" className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Target
            </h2>
            <p className="text-[17px] leading-[1.5] [overflow-wrap:anywhere]">{solution.target}</p>
          </div>
        </ContentCard>
      )}

      {saves.road === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          Saving the roadmap failed. Try again.
        </p>
      )}
      <SolutionRoad
        steps={solution.steps}
        target={solution.target}
        nowLine={nowLine}
        busy={saves.road === "saving"}
        engagements={engagements}
        opportunities={opportunities}
        canAdd={solution.steps.length < MAX_SOLUTION_STEPS}
        readOnly={present}
        onOpen={(index) => setStepEdit({ index, session: Date.now() })}
        onAdd={() => setStepEdit({ index: "new", session: Date.now() })}
        onMove={moveTo}
      />

      {/* The Now card and the pipeline side by side on a desktop. */}
      <div className={cn("grid gap-6", now && pipeline.length > 0 && "lg:grid-cols-2 lg:items-start")}>
      {now && (
        <ContentCard as="section" labelledBy="solution-now" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold tracking-[0.08em] text-warning-soft-foreground uppercase">Now · Step {nowIndex + 1}</p>
            <h2 id="solution-now" className="text-lg font-semibold [overflow-wrap:anywhere]">
              {now.title}
            </h2>
            {now.goal && <p className="text-[15px] leading-[1.6] [overflow-wrap:anywhere]">{now.goal}</p>}
          </div>
          {nowContract ? (
            <>
              <div className="flex flex-col gap-1.5">
                {nowUsage ? (
                  <>
                    <p className="text-sm font-medium tabular-nums">{nowLine}</p>
                    <ProgressBar
                      value={nowUsage.used / nowUsage.total}
                      tone={isOverBudget(nowUsage) ? "danger" : "default"}
                      label={nowUnit === "hour" ? "Hours used" : "Days used"}
                    />
                  </>
                ) : (
                  <p className="text-sm font-medium">Time and materials, no cap</p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span>
                    Contract {present ? null : `${engagementLabel(nowContract)} · `}{contractState(nowContract)}
                    {nowCall && ` · last call ${formatMeetingDate(nowCall.date)}`}
                  </span>
                  {nowHealth?.health && <StatusDot tone={MEETING_HEALTH[nowHealth.health].tone}>{MEETING_HEALTH[nowHealth.health].label}</StatusDot>}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">Open tasks</p>
                {nowTasks.length === 0 ? (
                  <p className="text-sm">No open tasks on this contract.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {nowTasks.slice(0, 5).map((t) => (
                      <li key={t.id} className="flex justify-between gap-3">
                        <span className="[overflow-wrap:anywhere]">{t.title}</span>
                        {t.dueDate && <span className="shrink-0 tabular-nums">{format(t.dueDate, "d MMM")}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                <Link href="/tasks" className="inline-flex min-h-11 items-center self-start text-sm font-medium underline underline-offset-2">
                  Open in Tasks
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm">
              {nowPayer ? "No contract yet: days and tasks follow once the opportunity is won." : "Nothing pays for this step yet."}
            </p>
          )}
        </ContentCard>
      )}

      {pipeline.length > 0 && (
        <section aria-labelledby="solution-pipeline" className="flex flex-col gap-3">
          <SectionHeader id="solution-pipeline" variant="card" title="Next Steps in the Pipeline" description={pipeline.length} />
          <ul className="flex flex-col gap-2">
            {pipeline.map(({ number, step, opportunity }) => {
              const full = opportunities.find((o) => o.id === opportunity.id)!
              return (
                <li key={number} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border bg-card p-4">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[15px] font-medium [overflow-wrap:anywhere]">
                      {number}. {step.title}
                    </span>
                    {step.goal && <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{step.goal}</span>}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <StatusPill tone={STAGE_TONE[full.stage]}>{STAGE_LABELS[full.stage]}</StatusPill>
                    <span className="tabular-nums">
                      {countIn(full.estimatedDaysPerMonth * full.estimatedDurationMonths, full.unit ?? "day")}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="text-sm text-muted-foreground">
            Each step names the opportunity behind it. Once won, the step follows its contract: days, invoices and health.{" "}
            <Link href={`/pipeline?client=${solution.clientId}`} className="underline underline-offset-2">
              Open in Pipeline
            </Link>
          </p>
        </section>
      )}
      </div>

      <SolutionJournal
        solution={solution}
        entries={journal}
        meetings={meetings}
        contractIds={journalContracts}
        userId={userId}
        today={today}
        onEdit={openLog}
        readOnly={present}
      />

      <h2 className="-mb-2 text-xl font-semibold tracking-tight">What We Know</h2>

      {/* How much is written: on a desktop a quiet bar with the missing sections' links, on a phone a line over full-width segments. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] sm:rounded-xl sm:border sm:border-hairline sm:bg-sidebar sm:px-[18px] sm:py-3.5 sm:text-sm">
        <span className="font-medium">
          {filled} of {kindKeys.length} sections written
        </span>
        <SegmentedProgress size="banner" done={filled} total={kindKeys.length} className="max-sm:order-last max-sm:basis-full" />
        {missing.length > 0 && !present && (
          <>
            <span className="text-subtle-foreground max-sm:hidden">
              Still to write:{" "}
              {missing.map(({ key, label }, i) => (
                <Fragment key={key}>
                  {i > 0 && ", "}
                  <a href={`#${key}`} className="text-foreground underline underline-offset-2 hover:decoration-2">
                    {label}
                  </a>
                </Fragment>
              ))}
            </span>
            <a href={`#${missing[0].key}`} className="-my-3 ml-auto inline-flex py-3 text-subtle-foreground underline underline-offset-2 sm:hidden">
              Still to write: {missing.length}
            </a>
          </>
        )}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-12">
        <OnThisPage
          aria-label="Sections"
          items={SECTIONS.map(({ key, label }) => ({
            id: key,
            label,
            short: SHORT[key],
            state: written(solution, key) ? "done" : "empty",
          }))}
        />
        {/* PAGE_ORDER, with KPIs and Results side by side (one under the other on a phone). */}
        <div className="flex min-w-0 max-w-[800px] flex-1 flex-col gap-8 sm:gap-11">
          {block("purpose")}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-4">
            {block("kpis")}
            {block("results")}
          </div>
          {shown("model") && (present ? solution.entities.length > 0 && presentModel : dataModel)}
          {(["requirements", "sources", "architecture", "steps", "history"] as const).filter(shown).map((key) => block(key))}
          {addable.length > 0 && !present && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="lg" className="self-start">
                  <Plus aria-hidden /> Add Section
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {addable.map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => {
                      setAdded((a) => [...a, key])
                      if (key === "model") setTab("entities")
                      else openEditor(key, "")
                    }}
                  >
                    {SECTION[key].label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <LogWorkDialog
        entry={logging?.entry ?? null}
        session={logging?.session ?? 0}
        solution={solution}
        userId={userId}
        today={today}
        onClose={() => setLogging(null)}
      />
      <StepDialog
        index={stepEdit?.index ?? null}
        session={stepEdit?.session ?? 0}
        steps={solution.steps}
        solutionName={solution.name}
        payers={payers}
        payerLabel={payerLabel}
        busy={saves.road === "saving"}
        today={today}
        onSave={saveRoad}
        onMove={moveTo}
        onDelete={setDeletingStep}
        onClose={() => setStepEdit(null)}
      />
      <ConfirmDeleteDialog
        open={deletingStep !== null}
        onOpenChange={(o) => !o && setDeletingStep(null)}
        title="Delete Step"
        description={`"${deletingStep === null ? "" : solution.steps[deletingStep]?.title}" is removed from the road. This can't be undone.`}
        confirmLabel="Delete Step"
        isPending={saves.road === "saving"}
        onConfirm={async () => {
          const at = deletingStep!
          setDeletingStep(null)
          await saveRoad(solution.steps.filter((_, i) => i !== at))
        }}
      />
      <SolutionFormDialog
        open={editing}
        solution={solution}
        solutions={solutions}
        clientId={null}
        userId={userId}
        clients={clients}
        engagements={engagements}
        onClose={() => setEditing(false)}
        onCreated={() => {}}
        returnFocus={moreButton}
      />
      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Solution"
        description={`"${solution.name}" is deleted, with its nine sections, its data model and its journal. This can't be undone.`}
        confirmLabel="Delete Solution"
        isPending={remove.isPending}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          moreButton.current?.focus()
        }}
        onConfirm={() =>
          remove.mutate(solution.id, {
            onSuccess: () => {
              router.push("/solutions")
              toast({ title: `Solution "${solution.name}" deleted.` })
            },
          })
        }
      />
      <ConfirmDeleteDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Discard Changes"
        description="Some edits on this page are not saved. Leaving now loses them."
        confirmLabel="Discard Changes"
        cancelLabel="Keep Editing"
        isPending={false}
        onConfirm={() => router.push("/solutions")}
      />
    </div>
  )
}
