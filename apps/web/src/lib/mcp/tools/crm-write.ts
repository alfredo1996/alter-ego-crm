import { eurShort } from "@alter-ego/kernel/currency"
import { formatYearMonth, isoDate, isoDateInRome, weekdaysInMonth } from "@alter-ego/kernel/dates"
import { format } from "date-fns"


import { ASSIGNMENT_HAS_DAYS, assignmentId, loggedDays } from "@/lib/assignments"
import { getServerDb, getServerFiles } from "@/lib/backend/server-db"
import { timeOffDoc } from "@/lib/capacity"
import {
  BILL_HAS_PAYMENTS,
  COST_CATEGORY_LABELS,
  MAX_BANK_FEE,
  NON_CASH,
  balancesAt,
  bookRows,
  checkAgainst,
  checkDetail,
  dayLabel,
  invoicePaidInto,
  deposits,
  kindLabel,
  leavesSupplierDocument,
  ownerLoanBalance,
  pickEstimate,
  rowTypeLabel,
  rowsSinceCheck,
  statementLabel,
  supplierDocuments,
} from "@/lib/cash-book"
import { computeBurnDown, rateAt, toRevenueSources } from "@/lib/engagement-burndown"
import {
  allocationsAfterEnd,
  amendContract,
  closingEndDate,
  contractDays,
  contractEndDate,
  contractUnit,
  contractUsage,
  conversionTerm,
  endBeforeAmendmentError,
  endFields,
  engagementLabel,
  engagementNameFromTitle,
  fromContractUnit,
  HOURS_PER_DAY,
  hoursToDays,
  inContractUnit,
  perDay,
  runOutMonth,
  timecardsAfterEnd,
  toContractUnit,
} from "@/lib/engagements"
import { checkInvoiceFile } from "@/lib/invoice-files"
import {
  amendmentEffects,
  clientBilling,
  creditsOn,
  eurCents,
  invoiceClientId,
  invoiceNumberTaken,
  invoicePeriodError,
  invoicePeriodLabel,
  invoiceTotal,
  openCredits,
  outstanding,
} from "@/lib/invoices"
import { monthInput, toolError, userIdOf } from "@/lib/mcp/tools/context"
import {
  ToolInputError,
  monthShift,
  normalizeMonth,
  ok,
  round2,
} from "@/lib/mcp/tools/helpers"
import {
  amendmentView,
  appendNote,
  assertFitsMonth,
  bookFigures,
  candidate,
  capacityForMonths,
  contractTerms,
  costCentreLabel,
  figureChanges,
  figureLine,
  contractLabel,
  fileSummary,
  invoicedLine,
  meetingCard,
  opportunityTerms,
  pickEngagement,
  planFigures,
  plural,
  qtyText,
  rateText,
  refuseDuplicate,
  resolveClient,
  resolveCollaborator,
  resolveCompanyAccount,
  resolveContract,
  resolveDeadline,
  resolveEstimate,
  resolveInvoice,
  resolveInvoiceContract,
  resolvePreferringActive,
  resolveSolution,
  resolveStepPayer,
  planMonths,
  resolveSupplierInvoice,
  resolveTask,
  revenueCells,
  solutionCard,
  targetEngagement,
  timecardDecision,
} from "@/lib/mcp/tools/helpers"
import { fileHolder, fileTargetInput, fileText, ownFolder } from "@/lib/mcp/tools/invoice-files"
import { healthByContract } from "@/lib/meetings"
import { getClient as getOAuthClient } from "@/lib/oauth/store"
import { isOpen, STAGE_LABELS, STAGE_PROBABILITY } from "@/lib/opportunities"
import { journalSource } from "@/lib/solution-journal"
import { completeStep, nowStep, sectionsFor, solutionNameTaken, stepContract, stepIndex } from "@/lib/solutions"
import { MAX_LABELS, statusOf, taskClientId, taskStatusUpdate } from "@/lib/tasks"
import { cellLimits, HOURS_AHEAD_MONTHS, hoursRefusal, lastLoggableDay, limitMessage, limitRefusal, monthPlanDays, planWarning } from "@/lib/timecards"
import { z } from "@/lib/zod"
import { isModuleOn } from "@/modules"
import {
  collaboratorFields,
  companyDeadlineKindSchema,
  companyExpenseCategorySchema,
  createAssignmentSchema,
  createCollaboratorSchema,
  companyMovementKindSchema,
  contractUnitSchema,
  createCompanyExpenseSchema,
  createCompanyLoanSchema,
  createCompanyMovementSchema,
  createMeetingSchema,
  createSolutionSchema,
  MAX_ADDED_DAYS,
  MAX_AMENDMENT_RATE,
  MAX_SOLUTION_STACK,
  MEETING_TEXT_MAX,
  opportunityStageSchema,
  setTimecardSchema,
  SOLUTION_SECTION_MAX,
  createJournalEntrySchema,
  journalLines,
  MAX_JOURNAL_DECISIONS,
  JOURNAL_LINE_MAX,
  SOLUTION_SECTIONS,
  solutionFields,
  solutionKindSchema,
  solutionSectionKeySchema,
  solutionStatusSchema,
  SOLUTION_TARGET_MAX,
  updateMeetingSchema,
} from "@/types/schemas"

import type { CapacityMonth, Figure, PlanBook } from "@/lib/mcp/tools/helpers"
import type {
  Allocation,
  Assignment,
  Client,
  Collaborator,
  CollaboratorFee,
  CompanyAccount,
  CompanyExpense,
  CompanyLoan,
  CompanyMovement,
  ContractAmendment,
  Engagement,
  Invoice,
  InvoiceFile,
  Meeting,
  Opportunity,
  Solution,
  SolutionStep,
  Timecard,
  UpdateCollaboratorInput,
  UpdateInvoiceInput,
  UpdateMeetingInput,
  UpdateSolutionInput,
} from "@/types"
import type { McpServer } from "@modelcontextprotocol/server"

const OWN_DAYS_NOTE = "Counts only your own days: collaborators' days on a contract are theirs."
const OWN_DAYS_DESCRIPTION =
  "The month's allocated days and the overbooking warning count only your own days: collaborators' days on a contract are theirs."

/** Names the HTTP-layer scope gate requires the write scope for. */
export const WRITE_TOOLS = new Set([
  "log_allocation",
  "move_opportunity",
  "create_opportunity",
  "create_client",
  "block_capacity",
  "convert_to_engagement",
  "create_contract",
  "update_engagement",
  "amend_contract",
  "add_note",
  "add_task",
  "complete_task",
  "update_task",
  "delete_task",
  "create_invoice",
  "mark_invoice_paid",
  "update_invoice",
  "delete_invoice",
  "add_deadline",
  "complete_deadline",
  "schedule_follow_up",
  "log_time",
  "log_meeting",
  "update_meeting",
  "add_movement",
  "add_expense",
  "record_loan",
  "check_balance",
  "update_movement",
  "delete_movement",
  "update_expense",
  "delete_expense",
  "attach_file",
  "remove_file",
  "update_loan",
  "delete_loan",
  "create_solution",
  "update_solution",
  "log_work",
  "add_collaborator",
  "update_collaborator",
  "assign_collaborator",
  "unassign_collaborator",
])

type ToolResult = ReturnType<typeof ok>

/** The rate before a change: "€700" on a day contract, as ever, "€75/h" on an hourly one. */
const wasRate = (dailyRate: number, unit: "day" | "hour") =>
  unit === "hour" ? rateText(dailyRate, unit) : `€${dailyRate}`

/**
 * Stored days past a contract's end keep billing (#154), and so do hours past its last
 * day once their day passes, so an end moved earlier must not read as "nothing more".
 * `lastDay` "" is before any day: a contract closed with no end takes no hours at all.
 */
function pastTheEnd(
  allocations: Allocation[],
  timecards: Timecard[],
  engagementId: string,
  endMonth: string | null,
  lastDay: string,
  unit: "day" | "hour" = "day",
) {
  const stale = endMonth ? allocationsAfterEnd(allocations, engagementId, endMonth) : []
  // Planned time is stored in days: an hourly contract is told its hours.
  const inUnit = (days: number) => inContractUnit(days, unit)
  const late = timecardsAfterEnd(timecards, engagementId, lastDay)
  return {
    summary:
      (stale.length > 0
        ? ` ${unit === "hour" ? "Hours" : "Days"} still planned after the last month: ${inUnit(stale.reduce((s, a) => s + a.days, 0))} ` +
          `(${stale.map((a) => `${a.yearMonth}: ${inUnit(a.days)}`).join(", ")}), and they still count in revenue: ` +
          `zero them with log_allocation set 0 if they will not happen (log_allocation takes ${unit === "hour" ? "hours on this contract" : "days"}).`
        : "") +
      (late.length > 0
        ? ` Hours logged ${lastDay ? "after the last day" : "on the contract"}: ${round2(late.reduce((s, t) => s + t.hours, 0))} ` +
          `(${late.map((t) => t.date).join(", ")}), and they bill once their day passes: ` +
          "remove them with log_time hours 0 if they did not happen."
        : ""),
    fields: {
      ...(stale.length > 0
        ? {
            allocationsAfterEnd: stale.map((a) =>
              unit === "hour" ? { yearMonth: a.yearMonth, hours: inUnit(a.days) } : { yearMonth: a.yearMonth, days: a.days },
            ),
          }
        : {}),
      ...(late.length > 0 ? { hoursAfterEnd: late.map((t) => ({ date: t.date, hours: t.hours })) } : {}),
    },
  }
}

/** Raw labels: the adapters normalize them (trim, 30 characters, no case duplicates). */
const labelsInput = z.array(z.string().max(100)).max(MAX_LABELS)
const quotedLabels = (labels: string[]) => labels.map((l) => `"${l}"`).join(", ")

/**
 * Runs a write tool and records the outcome in mcp_audit — an LLM is writing
 * real business data, so every attempt leaves a trace. A failed audit write
 * never fails the tool. A preview (a confirm tool called without confirm) is
 * audited too, marked preview: it shows what Claude was about to do.
 */
async function audited(
  ctx: { http?: { authInfo?: { clientId?: string; extra?: Record<string, unknown> } } },
  tool: string,
  params: unknown,
  run: (userId: string) => Promise<{ payload: unknown; documentIds?: string[] }>,
  preview = false,
): Promise<ToolResult> {
  const userId = userIdOf(ctx)
  const oauthClient = ctx.http?.authInfo?.clientId ?? "unknown"
  const marked = preview ? { preview: true } : {}
  try {
    const { payload, documentIds } = await run(userId)
    void getServerDb().addAuditEntry(userId, { tool, params, result: "ok", documentIds, clientId: oauthClient, ...marked }).catch(
      (e) => console.error("mcp_audit write failed:", e)
    )
    return ok(payload)
  } catch (e) {
    const failed = toolError(e)
    const errorMessage = e instanceof ToolInputError ? e.message : String(e)
    void getServerDb().addAuditEntry(userId, { tool, params, result: "error", errorMessage, clientId: oauthClient, ...marked }).catch(
      (err) => console.error("mcp_audit write failed:", err)
    )
    return failed
  }
}

/**
 * Where log_meeting files a verbale. Unlike add_task (#164), a client alone picks its
 * only ACTIVE contract, because the status belongs to the contract and a call is usually
 * about the running project; a client with none (a prospect) gets a client-level verbale,
 * and one with several must say which. engagementId null forces the client level;
 * engagementId as a name reaches a closed contract too (#156).
 */
function meetingTarget(
  engagements: Engagement[],
  clients: Client[],
  input: { client?: string; engagementId?: string | null }
): { clientId: string; engagement: Engagement | null } {
  const client = input.client ? resolveClient(clients, input.client) : null
  if (input.engagementId === null) {
    if (!client) throw new ToolInputError("engagementId null means a client-level meeting: pass client too.")
    return { clientId: client.id, engagement: null }
  }
  if (input.engagementId) {
    const pool = client ? engagements.filter((e) => e.clientId === client.id) : engagements
    const engagement = resolvePreferringActive(pool, clients, input.engagementId)
    return { clientId: engagement.clientId, engagement }
  }
  if (!client) throw new ToolInputError("Pass client or engagementId (the contract's id or name).")
  const active = engagements.filter((e) => e.clientId === client.id && e.isActive)
  if (active.length > 1) {
    throw new ToolInputError(
      `${client.name} has ${active.length} active contracts: ${active.map(candidate).join("; ")}. ` +
        "Pass engagementId (id or name), or engagementId null for a client-level meeting."
    )
  }
  return { clientId: client.id, engagement: active[0] ?? null }
}

/** A verbale's date is a call already made: "today" is Rome's (pinServerTimeZone). */
function refuseFutureMeeting(date: string): void {
  if (date > isoDate(new Date())) {
    throw new ToolInputError(
      `${date} has not come yet: a meeting records a call already made. For a future call use add_task with dueDate.`
    )
  }
}

/** A contract's status for a reply: its light and the day it was stated. */
const stated = (m: Meeting | undefined) => (m?.health ? { health: m.health, asOf: m.date } : null)

function capacityWarning(cap: CapacityMonth): string | null {
  if (!cap.overbooked) return null
  const blocked = cap.daysOff > 0 ? ` (${cap.reason}: ${plural(cap.daysOff, "day", "days")} blocked)` : ""
  return `Warning: ${cap.allocatedDays} days planned against ${cap.availableDays} available in ${cap.yearMonth}${blocked}.`
}

/** Finds an opportunity by id, exact title, or substring — mirrors resolveClient. */
function resolveOpportunity(opportunities: Opportunity[], query: string): Opportunity {
  const byId = opportunities.find((o) => o.id === query)
  if (byId) return byId
  const q = query.trim().toLowerCase()
  for (const match of [
    opportunities.filter((o) => o.title.toLowerCase() === q),
    opportunities.filter((o) => o.title.toLowerCase().includes(q)),
  ]) {
    if (match.length === 1) return match[0]
    if (match.length > 1) {
      throw new ToolInputError(
        `Several opportunities match "${query}": ${match.map((o) => o.title).join(", ")}. Be more specific.`
      )
    }
  }
  throw new ToolInputError(
    `No opportunity matches "${query}". Titles: ${opportunities.map((o) => o.title).join(", ") || "none"}.`
  )
}

// ─── Solutions ─────────────────────────────────────────────────────────────────

/** A name is unique within its client (create and rename alike, as on the page), so resolveSolution rarely has two to choose from there. */
function refuseTakenSolutionName(solutions: Solution[], client: Client, name: string, self?: string): void {
  const taken = solutionNameTaken(solutions, client.id, name, self)
  if (taken) {
    throw new ToolInputError(
      `${client.name} already has a solution named "${taken.name}" (id ${taken.id}): update it with update_solution, or pick another name.`
    )
  }
}

/**
 * solutionFields' refusal in words, before the write: the Admin SDK runs the same
 * parse of the stored solution with the update on top, so a relation is checked
 * against the entities it will sit beside. An entity or relation is named, not
 * numbered; a stored relation the update orphans says to send relations too.
 */
function refuseInvalidSolution(s: Solution, update: UpdateSolutionInput): void {
  try {
    solutionFields(s, update)
  } catch (e) {
    if (!(e instanceof z.ZodError)) throw e
    const entities = update.entities ?? s.entities
    const relations = update.relations ?? s.relations
    const steps = update.steps ?? s.steps
    const said = e.issues.map(({ path: [list, k], message }) => {
      if (list === "steps" && typeof k === "number") return `Step ${k + 1}${steps[k] ? ` "${steps[k].title}"` : ""}: ${message}`
      const r = list === "relations" ? relations[k as number] : undefined
      if (r) return `Relation ${r.from} -${r.type}-> ${r.to}: ${message}${update.relations ? "" : " (a stored relation: send relations too, without it)"}`
      const entity = list === "entities" ? entities[k as number] : undefined
      return `${entity ? `Entity "${entity.name}"` : String(list)}: ${message}`
    })
    throw new ToolInputError(said.join("; "))
  }
}

// ─── Cash book ─────────────────────────────────────────────────────────────────

const dayInput = z.iso.date("Invalid date: use YYYY-MM-DD")

/** The day money moved: today unless given (Rome's: pinServerTimeZone), never in the future. */
function cashDay(input: string | undefined): string {
  const today = isoDate(new Date())
  if (input && input > today) {
    throw new ToolInputError(`${input} has not come yet: the Cash Book records money that already moved.`)
  }
  return input ?? today
}

const dateOf = (day: string) => new Date(`${day}T00:00:00`)

/**
 * The shared zod schema, which firestore.rules mirrors: the Admin SDK skips the
 * rules, so this is where a write is refused, in words.
 */
function valid<S extends z.ZodType>(schema: S, value: z.input<S>): z.output<S> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ToolInputError(parsed.error.issues.map((i) => i.message).join("; "))
  return parsed.data
}

/** The cash book as the page reads it: every source, its rows, and those that reach a balance. */
async function loadBook(userId: string) {
  const db = getServerDb()
  const [accounts, movements, invoices, expenses, loans, clients, engagements] = await Promise.all([
    db.getCompanyAccounts(userId),
    db.getCompanyMovements(userId),
    db.getInvoices(userId),
    db.getCompanyExpenses(userId),
    db.getCompanyLoans(userId),
    db.getClients(userId),
    db.getEngagements(userId),
  ])
  const book = { accounts, movements, invoices, expenses, loans, clients, engagements }
  return { ...book, ...bookRows(book) }
}

/** What a collaborator's invoice needs besides the cash book: who they are, their contracts and the days logged. */
async function loadCollaborators(userId: string) {
  const db = getServerDb()
  const [collaborators, assignments, timecards] = await Promise.all([db.getCollaborators(userId), db.getAssignments(userId), db.getTimecards(userId)])
  return { collaborators, assignments, timecards }
}

/** The collaborator, contract and month an invoice names; the contract is theirs, auto when they are on one. */
async function invoiceLink(
  userId: string,
  b: { engagements: Engagement[]; clients: Client[] },
  ask: { collaborator: string; contract?: string; /** A contract already stored: kept as it is. */ keep?: string | null; forMonth: string },
) {
  const lb = await loadCollaborators(userId)
  const c = resolveCollaborator(lb.collaborators, ask.collaborator)
  const engagementId =
    ask.keep !== undefined
      ? ask.keep
      : resolveInvoiceContract({ collaborator: c, assignments: lb.assignments, engagements: b.engagements, clients: b.clients, query: ask.contract })
  const engagement = b.engagements.find((e) => e.id === engagementId)
  return { c, engagementId, contract: engagement ? contractLabel(engagement, b.clients) : null, forMonth: ask.forMonth, assignments: lb.assignments, timecards: lb.timecards }
}

const NEEDS_COLLABORATOR = "A Collaborators cost needs the collaborator: pass collaborator."

const RENT_OFF = "Rent is left out of this deployment: leaseId, rentMonth and rentPart are not available."

const RENT_MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "rentMonth is a month, YYYY-MM")

/** The lease a payment, a deposit or a rent offset names must be one of this user's. */
async function requireLease(userId: string, id: string): Promise<void> {
  if (!(await getServerDb().getLeases(userId)).some((l) => l.id === id)) {
    throw new ToolInputError(`No lease with id "${id}": get_rent lists the leases with their ids.`)
  }
}

/**
 * A cost made a rent offset (add_expense, update_expense): the module is on, the lease is the user's,
 * and the cost is not also a collaborator's invoice or a supplier payment. `clash` is the refusal when it is, or null.
 */
async function requireRentOffset(userId: string, leaseId: string, clash: string | null): Promise<void> {
  if (!isModuleOn("rent")) throw new ToolInputError(RENT_OFF)
  if (clash) throw new ToolInputError(clash)
  await requireLease(userId, leaseId)
}

/**
 * The lease fields a movement of this kind may carry, as Record Payment and the deposit form set them:
 * income is a rent payment (lease, month and part together), a deposit held names its lease only, nothing else has one.
 */
async function leaseFieldsOf(
  userId: string,
  kind: string,
  direction: string,
  a: { leaseId?: string | null; rentMonth?: string | null; rentPart?: string | null },
): Promise<{ leaseId: string | null; rentMonth: string | null; rentPart: "rent" | "contribution" | null }> {
  const none = { leaseId: null, rentMonth: null, rentPart: null }
  if (!isModuleOn("rent") && (a.leaseId || a.rentMonth || a.rentPart)) throw new ToolInputError(RENT_OFF)
  if (!a.leaseId) {
    if (a.rentMonth || a.rentPart) throw new ToolInputError("rentMonth and rentPart need leaseId: the lease the payment is for.")
    return none
  }
  if (kind === "income") {
    if (direction !== "in") throw new ToolInputError("A rent payment is money in: use direction in.")
    if (!a.rentMonth || !a.rentPart) throw new ToolInputError("A rent payment needs rentMonth (YYYY-MM, the month it covers) and rentPart (rent or contribution) with leaseId.")
  } else if (kind === "deposit_held") {
    if (a.rentMonth || a.rentPart) throw new ToolInputError("A deposit names its lease only: leave out rentMonth and rentPart.")
  } else {
    throw new ToolInputError("leaseId is for a rent payment (kind income) or a tenant's deposit (kind deposit_held) only.")
  }
  await requireLease(userId, a.leaseId)
  return { leaseId: a.leaseId, rentMonth: a.rentMonth ?? null, rentPart: (a.rentPart as "rent" | "contribution" | null) ?? null }
}

const FOR_MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "for_month is a month, YYYY-MM")

/** What a typed cost centre was stored as, for the reply: a new label is said to be one. */
const centreSaid = (centre: { label: string | null; isNew: boolean }) =>
  centre.label ? `, ${centre.isNew ? "new cost centre" : "cost centre"} ${centre.label}` : ""

/** Each account a write touched, its balance today read back after it: "Company account balance today: Main Bank €1,200.00." */
async function balancesAfter(userId: string, touched: CompanyAccount[]) {
  const b = await loadBook(userId)
  const today = balancesAt(b.accounts, b.counted, isoDate(new Date()))
  const balances = Object.fromEntries(touched.map((a) => [a.name, today.get(a.id) ?? null]))
  const each = touched.map((a) => {
    const balance = today.get(a.id)
    // Not open yet: its opening day instead.
    return `${a.name} ${balance === undefined ? `opens on ${dayLabel(isoDate(a.openingDate))}` : eurCents(balance)}`
  })
  return { balances, text: `Company account balance today: ${each.join(", ")}.` }
}

/** A day before the account opened stays out of its balance: said, as Add Movement says it. */
function beforeOpening(a: CompanyAccount, day: string, deposit = false): string {
  const opening = isoDate(a.openingDate)
  if (day >= opening) return ""
  return deposit
    ? ` Before ${a.name} opened (${dayLabel(opening)}): counted as a deposit, not in the balance, which already includes it.`
    : ` Before ${a.name} opened (${dayLabel(opening)}): it stays out of the balance and shows in To Chase. Change the date, or the account's opening date.`
}

/** The fee Mark Paid books, by chat (its fixed id), on the web or by the import (by its description). */
function bankFeeOn(expenses: CompanyExpense[], invoice: Invoice): CompanyExpense | undefined {
  const PREFIX = "Bank fee on invoice "
  return expenses.find(
    (e) =>
      e.id === `bank-fee-${invoice.id}` ||
      (e.category === "bank_fees" && e.description.startsWith(PREFIX) && e.description.slice(PREFIX.length).split(", ").includes(invoice.number)),
  )
}

/** Add Movement asks whose money it is on these only (movement-dialog.tsx hasCounterparty). */
const HAS_COUNTERPARTY = new Set(["income", "deposit_held", "deposit_paid"])

const NOT_AN_ACCOUNT = ' Or paidFrom "owner" for the owner\'s personal card, or "not_paid" for a supplier invoice to pay later.'

// ─── Cash book entries: finding, describing, Undo Import ─────────────────────

const ENTRY_NOUN = { movement: "movement", expense: "cost", loan: "shareholder loan", invoice: "invoice" } as const
const ENTRY_TOOLS = {
  movement: "update_movement or delete_movement",
  expense: "update_expense or delete_expense",
  loan: "update_loan or delete_loan",
  invoice: "update_invoice or delete_invoice",
} as const

/**
 * The entry an edit or delete names, by the id get_cash_book lists. An id from
 * another collection says which tool takes it, so a cost never meets the
 * movement editor.
 */
function entryOf<T extends { id: string }>(
  list: T[],
  b: { movements: CompanyMovement[]; expenses: CompanyExpense[]; loans: CompanyLoan[]; invoices: Invoice[] },
  id: string,
  source: "movement" | "expense" | "loan",
): T {
  const hit = list.find((x) => x.id === id)
  if (hit) return hit
  const other = (["movement", "expense", "loan", "invoice"] as const).find((k) =>
    ({ movement: b.movements, expense: b.expenses, loan: b.loans, invoice: b.invoices })[k].some((x) => x.id === id),
  )
  throw new ToolInputError(
    other
      ? `${id} is ${other === "invoice" ? "an" : "a"} ${ENTRY_NOUN[other]}, not a ${ENTRY_NOUN[source]}: use ${ENTRY_TOOLS[other]}.`
      : `No ${ENTRY_NOUN[source]} with id "${id}". get_cash_book lists each entry's source and id, in rows and otherEntries.`,
  )
}

/**
 * Undo Import (prima-nota.ts planUndo) deletes what the import created, found by
 * importRef, and keeps a row changed since unless the owner ticks it. Said before
 * an imported row is touched: never a silent surprise at the next Undo.
 */
function importNote(importRef: string | null, deleting: boolean): string | null {
  if (!importRef) return null
  return deleting
    ? `Imported from the prima nota workbook (${importRef}): Undo Import will find it gone already, and importing the ` +
        "workbook again after an Undo brings it back unless the workbook is corrected too."
    : `Imported from the prima nota workbook (${importRef}): Undo Import will list it as changed since the import and ` +
        "keep it as edited unless the owner ticks it there, and it can't bring back the workbook's version."
}

const accountName = (accounts: CompanyAccount[], id: string | null) => accounts.find((a) => a.id === id)?.name ?? "an unknown account"

/** The company accounts among `ids` that exist: the balances an entry touched. */
const accountsOf = (accounts: CompanyAccount[], ids: (string | null)[]) => accounts.filter((a) => ids.includes(a.id))

function movementCard(m: CompanyMovement, b: { accounts: CompanyAccount[]; expenses: CompanyExpense[] }) {
  return {
    id: m.id,
    type: kindLabel(m.kind, m.direction),
    kind: m.kind,
    direction: m.direction,
    amount: m.amount,
    date: isoDate(m.date),
    account: accountName(b.accounts, m.accountId),
    toAccount: m.toAccountId ? accountName(b.accounts, m.toAccountId) : null,
    description: m.description,
    documentRef: m.documentRef,
    costCentre: m.project,
    counterparty: m.counterparty,
    leaseId: m.leaseId ?? null,
    rentMonth: m.rentMonth ?? null,
    rentPart: m.rentPart ?? null,
    notes: m.notes,
    supplierInvoice: m.expenseId ? (b.expenses.find((e) => e.id === m.expenseId)?.documentRef ?? m.expenseId) : null,
    dateEstimated: m.dateEstimated,
    importRef: m.importRef,
  }
}

/** "VAT (F24) €100.00 from Main Bank on 01/10/2026". */
function movementLine(m: CompanyMovement, accounts: CompanyAccount[]): string {
  const label = kindLabel(m.kind, m.direction)
  const where =
    m.kind === "transfer"
      ? `from ${accountName(accounts, m.accountId)} to ${accountName(accounts, m.toAccountId)}`
      : `${m.direction === "in" ? "into" : "from"} ${accountName(accounts, m.accountId)}`
  return `${label}${m.description !== label ? ` "${m.description}"` : ""} ${eurCents(m.amount)} ${where} on ${dayLabel(isoDate(m.date))}`
}

/** What was paid, VAT included, whatever the sign. */
const costTotal = (e: CompanyExpense) => round2(Math.abs(e.amount + (e.vat ?? 0)))

const paidFromOf = (e: CompanyExpense, accounts: CompanyAccount[]) =>
  e.accountId ? accountName(accounts, e.accountId) : e.paidByOwner ? "owner" : "not_paid"

function costCard(
  e: CompanyExpense,
  b: { accounts: CompanyAccount[]; expenses: CompanyExpense[]; engagements: Engagement[]; clients: Client[] },
  collaborators: Collaborator[],
) {
  const contract = e.engagementId ? b.engagements.find((x) => x.id === e.engagementId) : undefined
  return {
    id: e.id,
    description: e.description,
    category: e.category,
    total: costTotal(e),
    vat: e.vat === null ? null : Math.abs(e.vat),
    date: isoDate(e.date),
    paidFrom: paidFromOf(e, b.accounts),
    refund: e.amount < 0,
    documentRef: e.documentRef,
    costCentre: e.project,
    paysRecurring: e.recurringExpenseId ? (b.expenses.find((x) => x.id === e.recurringExpenseId)?.description ?? null) : null,
    collaboratorId: e.collaboratorId,
    collaborator: e.collaboratorId ? (collaborators.find((c) => c.id === e.collaboratorId)?.name ?? "A collaborator who no longer exists") : null,
    engagementId: e.engagementId,
    contract: e.engagementId ? (contract ? contractLabel(contract, b.clients) : "A contract that no longer exists") : null,
    forMonth: e.forMonth,
    leaseId: e.leaseId ?? null,
    notes: e.notes,
    dateEstimated: e.dateEstimated,
    importRef: e.importRef,
  }
}

/** 'cost "Rent" €1,850.00 from Main Bank on 01/10/2026'. */
function costLine(e: CompanyExpense, accounts: CompanyAccount[]): string {
  const how = e.accountId
    ? `${e.amount < 0 ? "back into" : "from"} ${accountName(accounts, e.accountId)}`
    : e.paidByOwner
      ? "on the owner's card"
      : e.documentRef
        ? `owed to the supplier (${e.documentRef})`
        : "not paid from an account"
  return `${e.amount < 0 ? "refund" : "cost"} "${e.description}" ${eurCents(costTotal(e))} ${how} on ${dayLabel(isoDate(e.date))}`
}

function loanCard(l: CompanyLoan, accounts: CompanyAccount[]) {
  return {
    id: l.id,
    direction: l.direction,
    amount: l.amount,
    date: isoDate(l.date),
    account: l.accountId ? accountName(accounts, l.accountId) : null,
    description: l.description,
    notes: l.notes,
    dateEstimated: l.dateEstimated,
    importRef: l.importRef,
  }
}

/** "shareholder loan €5,000.00 into Main Bank on 10/09/2026". */
function loanLine(l: CompanyLoan, accounts: CompanyAccount[]): string {
  const lent = l.direction === "to_company"
  const where = l.accountId ? ` ${lent ? "into" : "from"} ${accountName(accounts, l.accountId)}` : ""
  return `${lent ? "shareholder loan" : "shareholder loan repayment"} ${eurCents(l.amount)}${where} on ${dayLabel(isoDate(l.date))}`
}

/** Below zero the SRL has paid the owner more than it owed: record_loan's warning. */
function overpaidNote(loans: CompanyLoan[], expenses: CompanyExpense[]): string | null {
  const owes = ownerLoanBalance(loans, expenses).total
  return owes < 0
    ? `After it the SRL would have paid you ${eurCents(-owes)} more than it owed, which an SRL can't do. Check the amounts.`
    : null
}

/** An invoice as a preview shows it, before and after. */
function invoiceCard(i: Invoice, b: { accounts: CompanyAccount[]; clients: Client[]; engagements: Engagement[] }) {
  const clientId = invoiceClientId(i, b.engagements)
  return {
    id: i.id,
    number: i.number,
    client: b.clients.find((c) => c.id === clientId)?.name ?? null,
    period: invoicePeriodLabel(i),
    amount: i.amount,
    vat: i.vat,
    total: invoiceTotal(i),
    dueDate: i.dueDate ? isoDate(i.dueDate) : null,
    paidDate: i.paidDate ? isoDate(i.paidDate) : null,
    paidInto:
      b.accounts.find((a) => a.id === invoicePaidInto(i))?.name ??
      (i.paidDate && i.paidAccountId === NON_CASH ? "offset, no money moved" : null),
  }
}

/** To invoice and Unpaid for one customer, as the web's Delete says them (invoice-sheet.tsx), for any set of invoices. */
function customerOwed(
  b: { engagements: Engagement[] },
  timecards: Timecard[],
  clientId: string | null,
  customer: string,
  today: string,
) {
  return (invoices: Invoice[]) => {
    const billing = clientId ? clientBilling({ clientId, engagements: b.engagements, timecards, invoices, today }) : null
    return new Map<string, number | null>([
      [`To invoice for ${customer}`, billing?.toInvoice == null ? null : Math.max(0, billing.toInvoice)],
      [`Unpaid for ${customer}`, outstanding(invoices.filter((i) => invoiceClientId(i, b.engagements) === clientId))],
    ])
  }
}

/** "" clears an optional text, undefined keeps it. */
const textOr = (typed: string | undefined, stored: string | null) => (typed === undefined ? stored : typed || null)

// ─── Collaborators (#329) ────────────────────────────────────────────────────

/** Everything the Projection reads, as the Plan page has it. */
async function loadPlanBook(userId: string): Promise<PlanBook> {
  const db = getServerDb()
  const [engagements, clients, allocations, expenses, collaborators, assignments] = await Promise.all([
    db.getEngagements(userId),
    db.getClients(userId),
    db.getAllocations(userId),
    db.getCompanyExpenses(userId),
    db.getCollaborators(userId),
    db.getAssignments(userId),
  ])
  return { engagements, clients, allocations, expenses, collaborators, assignments }
}

const thisMonth = () => format(new Date(), "yyyy-MM")

/** "€2,400 a month from 2026-10 to 2026-12, €3,000 from 2027-01", or "none". */
const feeText = (f: CollaboratorFee | null) =>
  f
    ? `${eurShort(f.amount)} a month from ${f.from}${f.until ? ` to ${f.until}` : ""}${f.changes.map((c) => `, ${eurShort(c.amount)} from ${c.from}`).join("")}`
    : "none"

/** How the preview shows a collaborator: the fee as a sentence, so before → after reads. */
const collaboratorView = (c: Pick<Collaborator, "name" | "type" | "notes" | "isActive" | "fee">) => ({
  name: c.name,
  type: c.type,
  notes: c.notes,
  active: c.isActive,
  fee: feeText(c.fee),
})

/** What a reply hands back for a collaborator: the fee as stored. */
const collaboratorCard = (c: Collaborator) => ({ id: c.id, name: c.name, type: c.type, notes: c.notes, active: c.isActive, fee: c.fee })

/** Two collaborators of one name would make every by-name call ambiguous. */
function refuseTakenCollaboratorName(list: Collaborator[], name: string, self?: string): void {
  const taken = list.find((c) => c.id !== self && c.name.trim().toLowerCase() === name.trim().toLowerCase())
  if (taken) throw new ToolInputError(`There is already a collaborator named "${taken.name}".`)
}

const NEEDS_FEE_TERMS = "A fixed fee needs fee_amount and fee_from."

const feeChangesInput = z.array(z.object({ from: z.string(), amount: z.number() })).max(24)

/** The fixed fee fields, shared by add and update. Months and amounts are checked by the app's own schema. */
const feeInputs = {
  fee_amount: z.number().optional(),
  fee_from: z.string().optional(),
  fee_until: z.string().nullable().optional(),
}

/** Collaborators and assignments as the contract's days see them: the compare "after" with a list changed. */
const withCollaborator = (book: PlanBook, next: Collaborator): PlanBook => ({
  ...book,
  collaborators: book.collaborators.some((c) => c.id === next.id)
    ? book.collaborators.map((c) => (c.id === next.id ? next : c))
    : [...book.collaborators, next],
})

// ─── Preview, then confirm ───────────────────────────────────────────────────
// The owner's rule for every delete and edit by chat (2026-10-10): the first call
// changes nothing and says exactly what would change; only a second call with
// confirm: true writes it.

const confirmInput = z.boolean().optional()

/** What every delete and edit tool's description says about confirm. */
const CONFIRM_RULE =
  "Preview, then confirm: called without confirm it changes nothing and returns exactly what would change (the " +
  "entry before and after, each touched company account's balance today before → after, and the totals that move). " +
  "Show that preview to the owner and ask; only once they agree call again, the same arguments, with confirm: true."

/**
 * Without confirm, the preview: what would change, written nowhere. With it,
 * `write` runs, and the reply says what changed and each touched account's
 * balance read back after it.
 */
async function previewOrApply(
  userId: string,
  confirm: boolean | undefined,
  change: {
    /** "Delete invoice 18/2026 (Acme, €1,220.00)". */
    action: string
    /** "Deleted invoice 18/2026". */
    done: string
    before: Record<string, unknown>
    after: Record<string, unknown> | null
    figures: Figure[]
    notes: string[]
    touched: CompanyAccount[]
    id: string
    write: () => Promise<unknown>
  },
): Promise<{ payload: unknown; documentIds: string[] }> {
  // The fields an edit changes, from the entry as stored to the entry as it would be.
  const show = (v: unknown) => (v === null || v === undefined ? "none" : typeof v === "string" ? `"${v}"` : String(v))
  const changes = change.after
    ? Object.keys(change.after)
        .filter((k) => JSON.stringify(change.before[k]) !== JSON.stringify(change.after![k]))
        .map((k) => `${k} ${show(change.before[k])} → ${show(change.after![k])}`)
    : []
  const listed = change.after ? ` Changes: ${changes.join(", ") || "none, it already reads so"}.` : ""
  const moves = change.figures.length ? ` ${change.figures.map(figureLine).join(". ")}.` : " No balance or total moves."
  const notes = change.notes.length ? ` ${change.notes.join(" ")}` : ""
  const shown = {
    before: change.before,
    after: change.after,
    ...(change.after ? { changes } : {}),
    effects: change.figures,
    notes: change.notes,
  }
  if (!confirm) {
    return {
      payload: {
        preview: true,
        summary:
          `Preview, nothing changed yet: ${change.action}.${listed}${moves}${notes} Show this to the owner and ask; ` +
          "if they agree, call again with the same arguments and confirm: true.",
        ...shown,
      },
      documentIds: [],
    }
  }
  await change.write()
  const after = change.touched.length ? await balancesAfter(userId, change.touched) : null
  return {
    payload: {
      summary: `${change.done}.${listed}${moves}${notes}${after ? ` ${after.text}` : ""}`,
      ...shown,
      ...(after ? { balances: after.balances } : {}),
    },
    documentIds: [change.id],
  }
}

// ─── Invoice files ───────────────────────────────────────────────────────────

/** "6 bytes" of base64 without decoding it: the size the file would have. */
const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0)

/** Points the record at `file`. A legacy record the schema no longer accepts answers with the schema's words, as valid() does. */
async function pointAt(userId: string, target: "cost" | "invoice", id: string, file: InvoiceFile | null) {
  try {
    await (target === "cost" ? getServerDb().updateCompanyExpense(userId, id, { file }) : getServerDb().updateInvoice(userId, id, { file }))
  } catch (e) {
    if (e instanceof z.ZodError) throw new ToolInputError(e.issues.map((i) => i.message).join("; "))
    throw e
  }
}

/** Deletes an object a record named, only inside the caller's own folder. A failure leaves one unreferenced object. */
async function dropObject(userId: string, file: InvoiceFile | null): Promise<void> {
  if (!file || !ownFolder(userId, file.path)) return
  await getServerFiles().remove(file.path).catch((e) => console.error(`Could not delete ${file.path}; it stays unreferenced`, e))
}

export function registerCrmWriteTools(server: McpServer): void {
  const db = getServerDb

  server.registerTool(
    "log_allocation",
    {
      title: "Log Days",
      description:
        "Logs worked/planned days for a client in a month. mode is required. 'set' writes the " +
        "month's total («sono 12 giorni in tutto» → mode 'set') and is the one to use when the " +
        "month has no days recorded yet, since such a month counts the contract default. 'add' sums " +
        "onto a total already recorded («ne ho fatti altri 2» → mode 'add'), and is refused on a month with " +
        "nothing recorded: adding to zero would replace the default. When unsure, ask for or work " +
        "out the month's total and use 'set'. Replies with the new " +
        "month total, the contract budget left after that month (as get_plan shows it), and an " +
        "overbooking warning when the month exceeds capacity (the write still lands); " + OWN_DAYS_DESCRIPTION + " Convert " +
        "relative dates to YYYY-MM or YYYY-MM-DD yourself. " +
        "engagementId (the contract's id or name) picks one when the client has several, and " +
        "reaches a closed contract too, to correct its days ('fix December's days on the closed " +
        "contract'). On an hourly contract (get_client and get_plan say hours) days counts HOURS " +
        "and the reply speaks in hours.",
      inputSchema: z.object({
        client: z.string().min(1),
        days: z.number().min(0).max(31 * HOURS_PER_DAY),
        month: monthInput,
        mode: z.enum(["add", "set"]),
        engagementId: z.string().optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "log_allocation", input, async (userId) => {
        const yearMonth = normalizeMonth(input.month)
        const mode = input.mode
        // Every contract: pickEngagement decides, and capacity counts a closed one up to its end.
        const [clients, engagements] = await Promise.all([
          db().getClients(userId),
          db().getEngagements(userId),
        ])
        const client = resolveClient(clients, input.client)
        const engagement = pickEngagement(engagements, clients, client, input.engagementId)

        // Stored in days; an hourly contract's figures are typed and told in hours.
        const unit = contractUnit(engagement)
        const noun = unit === "hour" ? "hour" : "day"
        const inUnit = (d: number) => inContractUnit(d, unit)
        const typedDays = input.days / perDay(unit)
        if (typedDays > 31) {
          throw new ToolInputError(`${input.days} ${noun}s exceed the 31 days of ${yearMonth}.`)
        }
        const existing = await db().getAllocationByKey(userId, engagement.id, yearMonth)
        // A month with no row counts the contract default, not zero. Adding to zero
        // would silently replace a planned 10 with the 3 just mentioned.
        if (mode === "add" && !existing) {
          throw new ToolInputError(
            `${client.name} has no ${noun}s recorded in ${yearMonth}: the month counts the contract ` +
              `default (${plural(inUnit(engagement.defaultDaysPerMonth), noun, `${noun}s`)}), and "add" would replace it with ` +
              `${input.days}. Use mode "set" with the month's total.`
          )
        }
        const newDays = mode === "set" ? typedDays : (existing?.days ?? 0) + typedDays
        if (newDays > 31) {
          throw new ToolInputError(
            `A total of ${inUnit(newDays)} ${noun}s exceeds the 31 days of ${yearMonth} ` +
              `(it was ${inUnit(existing?.days ?? 0)}, +${input.days}). Use mode "set" to correct it.`
          )
        }
        const saved = existing
          ? await db().updateAllocation(userId, existing.id, { days: newDays })
          : await db().createAllocation(userId, { engagementId: engagement.id, yearMonth, days: newDays })

        // Every row, as get_plan: budgets burn from each contract's start (#155), so the
        // capacity warning and the budget left both need the months before this one.
        const [allocations, capacityDocs, collaborators, assignments] = await Promise.all([
          db().getAllocations(userId),
          db().getCapacityDocs(userId, { from: yearMonth, to: yearMonth }),
          db().getCollaborators(userId),
          db().getAssignments(userId),
        ])
        // The owner's own load: the collaborators' days on the contracts are not theirs to work.
        const [cap] = capacityForMonths({ engagements, allocations, capacityDocs, from: yearMonth, months: 1, collaborators, assignments })

        // The plan's budget left after this month, as get_plan's line shows it (#159): burned from
        // the contract's start, a month with no row at the default. null = no budget, or a closed
        // contract with no end month, which the plan leaves out (log_time's "outside the plan").
        const [cell] = revenueCells({
          sources: toRevenueSources({ engagements: [engagement], opportunities: [], clients, scenario: "committed" }),
          allocations,
          from: yearMonth,
          to: yearMonth,
        })
        const remainingContractDays = cell && Number.isFinite(cell.remainingDays) ? cell.remainingDays : null

        const warning = capacityWarning(cap)
        return {
          payload: {
            summary:
              `${client.name} ${yearMonth}: ${plural(inUnit(newDays), noun, `${noun}s`)}` +
              (mode === "add" ? ` (+${input.days})` : " (set)") +
              (warning ? `. ${warning}` : "."),
            client: client.name,
            engagementId: engagement.id,
            yearMonth,
            ...(unit === "hour"
              ? {
                  unit,
                  hours: inUnit(newDays),
                  mode,
                  monthOwnHours: inUnit(cap.allocatedDays),
                  monthAvailableHours: inUnit(cap.availableDays),
                  remainingContractHours: remainingContractDays === null ? null : inUnit(remainingContractDays),
                }
              : { days: newDays, mode, monthOwnDays: cap.allocatedDays, monthAvailableDays: cap.availableDays, remainingContractDays }),
            ownDaysNote: OWN_DAYS_NOTE,
            warning,
          },
          documentIds: [saved.id],
        }
      })
  )

  server.registerTool(
    "move_opportunity",
    {
      title: "Move Opportunity",
      description:
        "Moves a pipeline opportunity to another stage (lead|proposal|negotiation|won|lost). " +
        "'lost' requires lostReason. Probability re-seeds from the stage default unless you pass one. " +
        "Moving to 'won' does NOT create the contract: the reply includes prefill values — convert " +
        "explicitly with convert_to_engagement (or in the web app: Pipeline → Won → Create Contract). " +
        "If the deal only adds to an existing contract (more days, a new rate, a renewal), record it with amend_contract instead and do not convert it, or its days count twice.",
      inputSchema: z.object({
        opportunity: z.string().min(1),
        stage: opportunityStageSchema,
        lostReason: z.string().max(500).optional(),
        probability: z.number().min(0).max(100).optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "move_opportunity", input, async (userId) => {
        if (input.stage === "lost" && !input.lostReason) {
          throw new ToolInputError(
            "Marking an opportunity lost needs lostReason (the reason)."
          )
        }
        const opportunities = await db().getOpportunities(userId)
        const opp = resolveOpportunity(opportunities, input.opportunity)

        // pipeline-shell.tsx closedAt rules: won/lost stamp once, reopen clears.
        const nowClosed = input.stage === "won" || input.stage === "lost"
        const updated = await db().updateOpportunity(userId, opp.id, {
          stage: input.stage,
          probability: input.probability ?? STAGE_PROBABILITY[input.stage],
          closedAt: nowClosed ? (opp.closedAt ?? new Date()) : null,
          lostReason: input.stage === "lost" ? input.lostReason : null,
        })

        const engagementPrefill =
          input.stage === "won"
            ? {
                clientId: updated.clientId,
                name: engagementNameFromTitle(updated.title),
                opportunityId: updated.id,
                // In the deal's own unit, as convert_to_engagement takes them back.
                unit: contractUnit(updated),
                ...(() => {
                  const t = toContractUnit({
                    unit: updated.unit,
                    dailyRate: updated.dailyRate,
                    defaultDaysPerMonth: updated.estimatedDaysPerMonth,
                    contractedDays: updated.estimatedDaysPerMonth * updated.estimatedDurationMonths,
                  })
                  return { dailyRate: t.rate, defaultDaysPerMonth: t.perMonth, contractedDays: t.contracted }
                })(),
                vatApplicable: updated.vatApplicable,
                ...conversionTerm(updated, format(new Date(), "yyyy-MM")),
              }
            : null

        return {
          payload: {
            summary:
              input.stage === "won"
                ? `"${updated.title}" won! Convert it to a contract with convert_to_engagement. ` +
                  "If the deal only adds to an existing contract (more days, a new rate, a renewal), record it with amend_contract instead and do not convert it, or its days count twice."
                : `"${updated.title}" moved to ${STAGE_LABELS[input.stage]}.`,
            opportunity: {
              id: updated.id,
              title: updated.title,
              stage: updated.stage,
              probability: updated.probability,
              closedAt: updated.closedAt?.toISOString() ?? null,
              lostReason: updated.lostReason,
            },
            engagementPrefill,
          },
          documentIds: [updated.id],
        }
      })
  )

  server.registerTool(
    "create_opportunity",
    {
      title: "New Opportunity",
      description:
        "Creates a pipeline opportunity for a client (name or id). Stage defaults to 'lead' and " +
        "probability to the stage seed (lead 20, proposal 50, negotiation 75). Rate and estimated " +
        "days/duration are required — ask the user if missing. unit is \"day\" (default) or \"hour\": a deal " +
        "quoted per hour passes unit hour, and dailyRate is then the hourly rate and estimatedDaysPerMonth the " +
        "hours a month.",
      inputSchema: z.object({
        client: z.string().min(1),
        title: z.string().min(1).max(200),
        unit: contractUnitSchema.optional(),
        dailyRate: z.number().positive(),
        estimatedDaysPerMonth: z.number().min(0).max(31 * HOURS_PER_DAY),
        estimatedDurationMonths: z.number().int().positive().max(120),
        stage: opportunityStageSchema.optional(),
        probability: z.number().min(0).max(100).optional(),
        expectedStartMonth: monthInput.optional(),
        vatApplicable: z.boolean().optional(),
        nextActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        nextActionNote: z.string().max(500).optional(),
        notes: z.string().max(1000).optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "create_opportunity", input, async (userId) => {
        const clients = await db().getClients(userId)
        const client = resolveClient(clients, input.client)
        const stage = input.stage ?? "lead"
        // Stored in days whatever the unit: an hour is an eighth of one.
        const stored = fromContractUnit({ unit: input.unit, rate: input.dailyRate, contracted: null, perMonth: input.estimatedDaysPerMonth })
        assertFitsMonth(stored.defaultDaysPerMonth, input.unit ?? "day")
        const created = await db().createOpportunity(userId, {
          clientId: client.id,
          title: input.title,
          stage,
          probability: input.probability ?? STAGE_PROBABILITY[stage],
          dailyRate: stored.dailyRate,
          estimatedDaysPerMonth: stored.defaultDaysPerMonth,
          ...(input.unit && { unit: input.unit }),
          estimatedDurationMonths: input.estimatedDurationMonths,
          expectedStartMonth: input.expectedStartMonth ? normalizeMonth(input.expectedStartMonth) : null,
          vatApplicable: input.vatApplicable ?? true,
          nextActionDate: input.nextActionDate ? new Date(`${input.nextActionDate}T00:00:00`) : null,
          nextActionNote: input.nextActionNote ?? null,
          notes: input.notes ?? null,
        })
        return {
          payload: {
            summary: `Opportunity "${created.title}" created for ${client.name} (${STAGE_LABELS[created.stage]}, ${created.probability}%).`,
            opportunity: {
              id: created.id,
              title: created.title,
              stage: created.stage,
              probability: created.probability,
              ...opportunityTerms(created),
            },
          },
          documentIds: [created.id],
        }
      })
  )

  server.registerTool(
    "create_client",
    {
      title: "New Client",
      description:
        "Creates a CRM client. Fails on a duplicate name (case-insensitive) — use list_clients first " +
        "when unsure whether the client already exists.",
      inputSchema: z.object({
        name: z.string().min(1).max(200),
        vatNumber: z.string().max(20).optional(),
        email: z.string().email().max(200).optional(),
        contactName: z.string().max(200).optional(),
        contactPhone: z.string().max(40).optional(),
        notes: z.string().max(1000).optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "create_client", input, async (userId) => {
        const clients = await db().getClients(userId)
        const duplicate = clients.find((c) => c.name.toLowerCase() === input.name.trim().toLowerCase())
        if (duplicate) {
          throw new ToolInputError(
            `A client "${duplicate.name}"${duplicate.isActive ? "" : " (archived)"} already exists.`
          )
        }
        const created = await db().createClient(userId, {
          name: input.name.trim(),
          vatNumber: input.vatNumber ?? null,
          email: input.email ?? null,
          contactName: input.contactName ?? null,
          contactPhone: input.contactPhone ?? null,
          notes: input.notes ?? null,
        })
        return {
          payload: { summary: `Client "${created.name}" created.`, client: { id: created.id, name: created.name } },
          documentIds: [created.id],
        }
      })
  )

  server.registerTool(
    "block_capacity",
    {
      title: "Block Capacity / Time Off",
      description:
        "Blocks days off in a month BEFORE selling them: «blocca 2 settimane di ferie ad agosto» → " +
        "daysOff 10, reason vacation. Available days become the month's weekday count minus daysOff. " +
        "mode 'set' (default) replaces the month's block; 'add' stacks onto it; daysOff 0 clears it. " +
        "Replies with the month state and warns if already-planned work now exceeds availability; " + OWN_DAYS_DESCRIPTION,
      inputSchema: z.object({
        month: monthInput,
        daysOff: z.number().min(0).max(31),
        reason: z.enum(["vacation", "training", "admin", "other"]),
        mode: z.enum(["set", "add"]).optional(),
        note: z.string().max(500).optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "block_capacity", input, async (userId) => {
        const yearMonth = normalizeMonth(input.month)
        const weekdays = weekdaysInMonth(yearMonth)
        const [existing] = await db().getCapacityDocs(userId, { from: yearMonth, to: yearMonth })
        const daysOff = Math.min(
          weekdays,
          input.mode === "add" ? (existing?.daysOff ?? 0) + input.daysOff : input.daysOff
        )
        const doc = timeOffDoc({ yearMonth, daysOff, reason: input.reason, note: input.note ?? existing?.note ?? null })
        await db().setCapacity(userId, doc)

        // Every contract and every row, as get_capacity: capacityForMonths counts a closed
        // contract up to its end, and burns each budget from the contract's start.
        const [engagements, allocations, collaborators, assignments] = await Promise.all([
          db().getEngagements(userId),
          db().getAllocations(userId),
          db().getCollaborators(userId),
          db().getAssignments(userId),
        ])
        const [cap] = capacityForMonths({ engagements, allocations, capacityDocs: [doc], from: yearMonth, months: 1, collaborators, assignments })
        const warning = capacityWarning(cap)
        return {
          payload: {
            summary:
              daysOff === 0
                ? `Block removed for ${yearMonth}: ${plural(doc.availableDays, "day", "days")} available.`
                : `${yearMonth}: ${plural(daysOff, "day", "days")} blocked (${input.reason}), ` +
                  `${plural(doc.availableDays, "day", "days")} available` +
                  (warning ? `. ${warning}` : "."),
            capacity: cap,
            ownDaysNote: OWN_DAYS_NOTE,
            warning,
          },
          documentIds: [yearMonth],
        }
      })
  )

  server.registerTool(
    "convert_to_engagement",
    {
      title: "Convert to Contract",
      description:
        "Converts a WON opportunity into an active engagement (contract). Prefills rate, VAT, " +
        "days/month, contracted-days budget (days/month × duration), start month (the opportunity's, " +
        "else this month, also when the opportunity's has passed) and end month (start + duration − 1: " +
        "past it the default days stop, so a zeroed month loses its days instead of sliding them later; " +
        "endMonth null = no end) from the " +
        "opportunity; pass any field to override the prefill. The contract is named after the " +
        "opportunity's title (first 120 characters) unless you pass a name (\"Cloud migration\"), " +
        "which tells it apart from the client's other contracts. The contract is in the opportunity's unit " +
        "(\"day\" or \"hour\"), or the unit you pass; with unit hour, dailyRate is the hourly rate and " +
        "defaultDaysPerMonth and contractedDays count hours. Fails if the opportunity is not won " +
        "or was already converted. From then on log_allocation works for the client. " +
        "If the deal only adds to an existing contract (more days, a new rate, a renewal), record it with amend_contract instead and do not convert it, or its days count twice.",
      inputSchema: z.object({
        opportunity: z.string().min(1),
        name: z.string().trim().min(1).max(120).optional(),
        unit: contractUnitSchema.optional(),
        dailyRate: z.number().positive().optional(),
        defaultDaysPerMonth: z.number().min(0).max(31 * HOURS_PER_DAY).optional(),
        contractedDays: z.number().positive().nullable().optional(),
        startMonth: monthInput.optional(),
        endMonth: monthInput.nullable().optional(),
        vatApplicable: z.boolean().optional(),
        notes: z.string().max(1000).optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "convert_to_engagement", input, async (userId) => {
        const [clients, opportunities] = await Promise.all([
          db().getClients(userId),
          db().getOpportunities(userId),
        ])
        const opp = resolveOpportunity(opportunities, input.opportunity)
        if (opp.stage !== "won") {
          throw new ToolInputError(
            `"${opp.title}" is in ${STAGE_LABELS[opp.stage]}, not won. Move it to "won" before converting it.`
          )
        }
        if (opp.engagementId) {
          throw new ToolInputError(
            `"${opp.title}" was already converted (contract ${opp.engagementId}).`
          )
        }
        const client = clients.find((c) => c.id === opp.clientId)

        // 0 estimated days × months would mean an instantly-exhausted budget: treat as open-ended.
        const prefillBudget = opp.estimatedDaysPerMonth * opp.estimatedDurationMonths || null
        // "This month" is Rome's: both server entry points pin TZ (pinServerTimeZone).
        const term = conversionTerm(
          opp,
          format(new Date(), "yyyy-MM"),
          input.startMonth ? normalizeMonth(input.startMonth) : undefined,
        )
        const endMonth = input.endMonth === undefined ? term.endMonth : input.endMonth && normalizeMonth(input.endMonth)
        if (endMonth && endMonth < term.startMonth) {
          throw new ToolInputError(
            `End month ${endMonth} is before the contract's start (${term.startMonth}): ` +
              `pass an endMonth from ${term.startMonth} on, or null for no end.`
          )
        }
        // What was passed is in the contract's unit; what was not comes from the deal, already in days.
        const unit = input.unit ?? contractUnit(opp)
        const typed = fromContractUnit({
          unit,
          rate: input.dailyRate ?? 1,
          contracted: input.contractedDays ?? null,
          perMonth: input.defaultDaysPerMonth ?? 0,
        })
        const defaultDaysPerMonth = input.defaultDaysPerMonth !== undefined ? typed.defaultDaysPerMonth : opp.estimatedDaysPerMonth
        assertFitsMonth(defaultDaysPerMonth, unit)
        const engagement = await db().createEngagement(userId, {
          clientId: opp.clientId,
          name: input.name ?? engagementNameFromTitle(opp.title),
          opportunityId: opp.id,
          dailyRate: input.dailyRate !== undefined ? typed.dailyRate : opp.dailyRate,
          unit,
          vatApplicable: input.vatApplicable ?? opp.vatApplicable,
          contractedDays: input.contractedDays !== undefined ? typed.contractedDays : prefillBudget,
          defaultDaysPerMonth,
          startMonth: term.startMonth,
          endMonth,
          notes: input.notes ?? null,
        })
        // Same back-link the UI conversion writes (pipeline-shell.tsx).
        await db().updateOpportunity(userId, opp.id, { engagementId: engagement.id })

        return {
          payload: {
            summary:
              `Contract ${engagement.name ? `"${engagement.name}" ` : ""}created for ${client?.name ?? opp.clientId}: ${rateText(engagement.dailyRate, unit)}, ` +
              `${qtyText(engagement.defaultDaysPerMonth, unit)}/month` +
              (engagement.contractedDays !== null ? `, budget ${qtyText(engagement.contractedDays, unit)}` : ", no budget") +
              (engagement.startMonth ? `, from ${engagement.startMonth}` : "") +
              (engagement.endMonth ? ` to ${engagement.endMonth}` : "") +
              ".",
            engagement: {
              id: engagement.id,
              name: engagement.name,
              clientId: engagement.clientId,
              opportunityId: engagement.opportunityId,
              ...contractTerms(engagement, term.startMonth),
              vatApplicable: engagement.vatApplicable,
              startMonth: engagement.startMonth,
              endMonth: engagement.endMonth,
            },
          },
          documentIds: [engagement.id, opp.id],
        }
      })
  )

  server.registerTool(
    "create_contract",
    {
      title: "Create Contract",
      description:
        "Creates a contract for an existing client directly, with no deal behind it, like the web app's " +
        "New Contract: unit (\"day\" or \"hour\", default day), dailyRate (the hourly rate in unit hour), " +
        "defaultDaysPerMonth (hours in unit hour), contractedDays (the budget, same unit; null = no cap), " +
        "vatApplicable (default true), startMonth (default this month), endMonth (null = no end), an " +
        "optional name that tells it apart from the client's other contracts, notes. No opportunity is " +
        "created, so the pipeline's won figures do not move. Archived clients are refused. «nuovo contratto " +
        "per Dunder», «contratto 2027». To split a contract by year, first update_engagement with endMonth " +
        "on the old contract (the last month of the year), then create_contract for the new year. " +
        "For more days or a new rate on the same contract, use amend_contract instead. " +
        "To convert a won deal, use convert_to_engagement. Replies with the contract's label, id, client, term and budget.",
      inputSchema: z.object({
        client: z.string().min(1),
        name: z.string().trim().min(1).max(120).optional(),
        unit: contractUnitSchema.optional(),
        dailyRate: z.number().positive(),
        defaultDaysPerMonth: z.number().min(0).max(31 * HOURS_PER_DAY),
        contractedDays: z.number().positive().nullable().optional(),
        startMonth: monthInput.optional(),
        endMonth: monthInput.nullable().optional(),
        vatApplicable: z.boolean().optional(),
        notes: z.string().max(1000).optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "create_contract", input, async (userId) => {
        const client = resolveClient(await db().getClients(userId), input.client)
        // resolveClient finds an archived client by id.
        if (!client.isActive) {
          throw new ToolInputError(`${client.name} is archived: reopen it before adding a contract.`)
        }
        const startMonth = input.startMonth ? normalizeMonth(input.startMonth) : format(new Date(), "yyyy-MM")
        const endMonth = input.endMonth ? normalizeMonth(input.endMonth) : null
        if (endMonth && endMonth < startMonth) {
          throw new ToolInputError(
            `End month ${endMonth} is before the contract's start (${startMonth}): ` +
              `pass an endMonth from ${startMonth} on, or null for no end.`
          )
        }
        const unit = input.unit ?? "day"
        const stored = fromContractUnit({
          unit,
          rate: input.dailyRate,
          contracted: input.contractedDays ?? null,
          perMonth: input.defaultDaysPerMonth,
        })
        assertFitsMonth(stored.defaultDaysPerMonth, unit)
        const engagement = await db().createEngagement(userId, {
          clientId: client.id,
          name: input.name ?? null,
          opportunityId: null,
          dailyRate: stored.dailyRate,
          unit,
          vatApplicable: input.vatApplicable ?? true,
          contractedDays: stored.contractedDays,
          defaultDaysPerMonth: stored.defaultDaysPerMonth,
          startMonth,
          endMonth,
          notes: input.notes ?? null,
        })
        return {
          payload: {
            summary:
              `Contract ${engagement.name ? `"${engagement.name}" ` : ""}created for ${client.name}: ${rateText(engagement.dailyRate, unit)}, ` +
              `${qtyText(engagement.defaultDaysPerMonth, unit)}/month` +
              (engagement.contractedDays !== null ? `, budget ${qtyText(engagement.contractedDays, unit)}` : ", no budget") +
              `, from ${startMonth}` +
              (endMonth ? ` to ${endMonth}` : "") +
              ".",
            engagement: {
              id: engagement.id,
              label: engagementLabel(engagement),
              client: client.name,
              clientId: client.id,
              ...contractTerms(engagement, startMonth),
              vatApplicable: engagement.vatApplicable,
              startMonth: engagement.startMonth,
              endMonth: engagement.endMonth,
            },
          },
          documentIds: [engagement.id],
        }
      })
  )

  server.registerTool(
    "update_engagement",
    {
      title: "Edit Contract",
      description:
        "Edits an existing contract (engagement). A new rate, more days or a renewal agreed with the client → " +
        "amend_contract (it keeps the history and never reprices earlier months); endDate/endMonth here correct or " +
        "plan the end, with no history. 'rename the Dunder contract to \"Cloud migration\"' → " +
        "client Dunder + name; 'remove the contract's name' → name null (or \"\"), and it goes back to " +
        "being told apart by its rate; 'update the contract's notes' → notes (null clears them). notes " +
        "replaces the whole text: for «segna sul contratto che …» → notes, read the current " +
        "engagements[].notes from get_client and pass them with the new line. engagementId takes the " +
        "contract's id or current name, and every contract is searched, closed ones too; client narrows the " +
        "search, and alone is enough when the client has a single contract. An unnamed contract is " +
        "otherwise reachable by id only (see get_client); client matches archived clients too. " +
        "«chiudi il contratto, il progetto è finito» → active false + reason: endDate, the last day hours " +
        "can be logged, is today (or an earlier planned end already past) unless you pass one, and its " +
        "month is the last one that bills the default days; a contract that has not started yet closes " +
        "with no end, leaves the plan and takes no hours: any it holds are listed as hoursAfterEnd. " +
        "reason is appended to the notes as 'Closed on YYYY-MM-DD: …'. " +
        "Closing keeps past revenue: the months up to the end's month still count in get_revenue and " +
        "get_plan, and so do days stored after it — the reply lists them as allocationsAfterEnd; zero the " +
        "ones that will not happen with log_allocation set 0. Hours logged after the last day are kept " +
        "and listed as hoursAfterEnd: remove the ones that did not happen with log_time hours 0. 'reopen " +
        "the contract' → active true, which clears the end unless you pass a new planned one. endDate " +
        "alone sets the last day without closing: a planned end on an active contract, a correction on a " +
        "closed one; endMonth (YYYY-MM) sets a whole month instead, ending on its last day. Pass one of " +
        "the two. An end (a close's too) in a month before an amendment's is refused: remove that amendment " +
        "first (amend_contract remove). dailyRate fixes a typo in the signed day rate, and only before any " +
        "hours are logged on the contract: after that it is refused, and the change is an amendment (amend_contract) from a month on, so " +
        "invoiced months keep their price. A contract's status (green/yellow/red) is not a contract field: record it with " +
        "log_meeting. Replies with the contract's label before and after, its client, what changed, its " +
        "lastDay (the last day hours can be logged), and the replaced notes as notesBefore.",
      inputSchema: z.object({
        engagementId: z.string().optional(),
        client: z.string().min(1).optional(),
        name: z.string().trim().max(120).nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
        active: z.boolean().optional(),
        endDate: z.iso.date("Use YYYY-MM-DD").optional(),
        // Strict: a day passed here would silently widen to the month's end.
        endMonth: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM; for a day use endDate").optional(),
        reason: z.string().trim().min(1).max(500).optional(),
        unit: contractUnitSchema.optional(),
        dailyRate: z.number().positive().max(MAX_AMENDMENT_RATE).optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "update_engagement", input, async (userId) => {
        // Kept off the Zod schema for the same reason as update_task's guard.
        if ([input.name, input.notes, input.active, input.endDate, input.endMonth, input.dailyRate].every((v) => v === undefined)) {
          throw new ToolInputError(
            "Nothing to change: pass name, notes, active, endDate, endMonth or dailyRate " +
              "(a new rate from a month, more days or a renewal: amend_contract)."
          )
        }
        if (input.endDate && input.endMonth) throw new ToolInputError("Pass endDate or endMonth, not both.")
        const [clients, engagements] = await Promise.all([
          db().getClients(userId),
          db().getEngagements(userId),
        ])
        const engagement = resolveContract(clients, engagements, input)
        const unit = contractUnit(engagement)
        if (input.unit && input.unit !== unit) {
          throw new ToolInputError(`This contract is in ${unit}s: its unit cannot be changed here, and dailyRate is the rate per ${unit}.`)
        }
        // The rate comes in the contract's unit (€/h on an hourly one) and is stored per day.
        const typedRate =
          input.dailyRate === undefined ? undefined : fromContractUnit({ unit, rate: input.dailyRate, contracted: null, perMonth: 0 }).dailyRate
        if (typedRate !== undefined && typedRate > MAX_AMENDMENT_RATE) {
          throw new ToolInputError(`The rate is at most €${round2(MAX_AMENDMENT_RATE / perDay(unit))} per ${unit}.`)
        }
        const dailyRate = typedRate === engagement.dailyRate ? undefined : typedRate
        // Owner decision (2026-10-07): once hours exist the signed rate is what invoiced months were
        // priced at, so a new rate starts from a month instead. Before any hours it is a typo fix.
        if (dailyRate !== undefined && (await db().getTimecards(userId)).some((t) => t.engagementId === engagement.id)) {
          throw new ToolInputError(
            `This contract has hours logged, so its signed rate (${rateText(engagement.dailyRate, unit)}) is locked. ` +
              "Record the new rate with amend_contract from a month on, so invoiced months keep their price."
          )
        }

        // "" clears like null: an empty name would otherwise be stored and still read as unnamed.
        const name = input.name === undefined ? undefined : input.name || null
        let notes = input.notes === undefined ? undefined : input.notes || null

        // Closing records the last day instead of dropping the contract, so the months it
        // already billed keep their revenue (closingEndDate). An already-closed contract keeps
        // its end unless one is passed: defaulting it would move the end, or give a contract
        // closed without one a past it never had in the plan. active true on an active
        // contract changes nothing, so it cannot wipe a planned end either.
        const closing = input.active === false && engagement.isActive
        const reopening = input.active === true && !engagement.isActive
        if (input.reason && !closing) {
          throw new ToolInputError("reason is only for closing an active contract: pass active false.")
        }
        // "Today" is Rome's: both server entry points pin TZ (pinServerTimeZone).
        const today = isoDate(new Date())
        // endMonth alone is a whole month: endDate null, which contractEndDate reads as its last day.
        const end =
          input.endDate ? endFields(input.endDate)
          : input.endMonth ? { endMonth: normalizeMonth(input.endMonth), endDate: null }
          : reopening ? endFields(null)
          : closing ? endFields(closingEndDate(engagement, today))
          : undefined
        if (end?.endMonth && engagement.startMonth && end.endMonth < engagement.startMonth) {
          // Advising an end from the start on would bill a month of a contract that never ran.
          const neverStarted = closing && engagement.startMonth > today.slice(0, 7)
          throw new ToolInputError(
            `End date ${input.endDate ?? end.endMonth} is before the contract's start (${engagement.startMonth}): ` +
              (neverStarted
                ? "to close a contract that has not started yet, omit endDate."
                : `pass an endDate from ${engagement.startMonth}-01 on.`)
          )
        }
        // As Edit and Close in the app: MCP writes through the Admin SDK, past the rules.
        const stranded = end ? endBeforeAmendmentError(engagement, end.endMonth, "chat") : null
        if (stranded) throw new ToolInputError(stranded)
        if (closing && input.reason) {
          const line = `Closed on ${isoDate(new Date())}: ${input.reason}`
          notes = appendNote(notes === undefined ? engagement.notes : notes, line)
        }
        const isActive = input.active

        const changes = {
          ...(name !== undefined && name !== engagement.name ? { name } : {}),
          ...(dailyRate !== undefined ? { dailyRate } : {}),
          ...(notes !== undefined && notes !== engagement.notes ? { notes } : {}),
          ...(isActive !== undefined && isActive !== engagement.isActive ? { isActive } : {}),
          ...(end && end.endMonth !== engagement.endMonth ? { endMonth: end.endMonth } : {}),
          ...(end && end.endDate !== engagement.endDate ? { endDate: end.endDate } : {}),
        }
        const before = engagementLabel(engagement)
        if (Object.keys(changes).length === 0) {
          throw new ToolInputError(`Contract ${before} already has these values: nothing to change.`)
        }
        const updated = await db().updateEngagement(userId, engagement.id, changes)
        const after = engagementLabel(updated)
        const clientName = clients.find((c) => c.id === updated.clientId)?.name ?? updated.clientId
        const lastDay = contractEndDate(updated)
        const endMoved = "endMonth" in changes || "endDate" in changes
        const changed = [
          "name" in changes ? (updated.name ? `renamed "${updated.name}"` : "name removed") : null,
          "dailyRate" in changes ? `signed rate ${rateText(updated.dailyRate, unit)} (was ${wasRate(engagement.dailyRate, unit)})` : null,
          "notes" in changes ? (updated.notes ? "notes updated" : "notes removed") : null,
          "isActive" in changes ? (updated.isActive ? "reopened" : "closed") : null,
          endMoved ? (lastDay ? `ends on ${lastDay}` : "end removed") : null,
        ].filter(Boolean)
        // Stored days past the end keep billing (#154), and so do hours past the last day once
        // their day passes, so an end must not read as "nothing more": a close usually leaves
        // plan-grid rows and scheduled hours for days that will not happen.
        const endAt = updated.endMonth
        // Closed with no end (it had not started), the contract takes no hours at all, so every
        // one it holds, scheduled ahead, is late: "" is before any day.
        const hoursAfter = lastDay ?? (closing ? "" : null)
        const past =
          hoursAfter !== null && (closing || endMoved)
            ? pastTheEnd(
                ...(await Promise.all([
                  endAt ? db().getAllocations(userId, { engagementId: updated.id }) : [],
                  db().getTimecards(userId),
                ])),
                updated.id,
                endAt,
                hoursAfter,
                unit,
              )
            : { summary: "", fields: {} }
        return {
          payload: {
            summary:
              `Contract ${before} (${clientName}): ${changed.join(", ")}` +
              (after !== before ? `. Now named ${after}.` : ".") +
              (closing
                ? endAt
                  ? ` The months up to ${endAt} stay in revenue. No hours can be logged after ${lastDay}.`
                  : " It had not started yet: it leaves the plan and takes no hours."
                : "") +
              past.summary,
            engagement: {
              id: updated.id,
              name: updated.name,
              labelBefore: before,
              label: after,
              client: clientName,
              clientId: updated.clientId,
              isActive: updated.isActive,
              ...contractTerms(updated, today.slice(0, 7)),
              endMonth: updated.endMonth,
              lastDay,
              notes: updated.notes,
              // A replace cannot be undone from the audit (it keeps params only), so hand back the old text.
              ...("notes" in changes ? { notesBefore: engagement.notes } : {}),
            },
            changed: Object.keys(changes),
            ...past.fields,
          },
          documentIds: [updated.id],
        }
      })
  )

  server.registerTool(
    "amend_contract",
    {
      title: "Amend Contract",
      description:
        "Records a dated change to a signed contract (an addendum): from a month on, a new day rate, more days, a " +
        "later end, or several at once. Earlier months keep their price everywhere: invoices and the Plan. " +
        "«da gennaio la tariffa sale a 800» → dailyRate 800 + from 2027-01; «aggiungi 20 giornate da gennaio» → " +
        "addDays 20 + from; «rinnovato per 6 mesi» → endMonth = the current lastDay's month + 6, and from defaults to " +
        "the month after the current last day (add addDays if the renewal brings days). from (YYYY-MM) is the first " +
        "month it applies, always from the 1st, and is required for a rate or days alone. Added days count from " +
        "their month, never before: if they also cover months already worked over budget, date it from the first " +
        "of those (the reply names them). Days are planned only up to the end, so extend the end when the work runs " +
        "longer. endDate (YYYY-MM-DD) or endMonth (its last day) only extends, and from the month after the current " +
        "end at the latest; to shorten use update_engagement. One amendment per month: a second call for the same " +
        "month replaces the fields it passes (addDays replaces, never adds); remove with from undoes that month's " +
        "amendment, the end it moved included (remove later amendments first, and the reply lists hours left past the end). A change that reprices a month already invoiced, an invoice in advance " +
        "included, is refused with the € difference per month (a rise is a top-up invoice, a cut a credit note): ask the owner, and pass " +
        "repriceInvoiced true only once they confirm. Not an amendment: a different scope, a new purchase order, a " +
        "VAT change or a renewal after a gap is a new contract (convert_to_engagement or the web app); if the " +
        "expansion is an open opportunity, mark it won with move_opportunity and do not convert it, or its days " +
        "count twice. More days in a month: log_allocation. Cutting days: update_engagement with an earlier end. A " +
        "typo in the signed rate: update_engagement dailyRate before any hours, else an amendment from the start " +
        "month. engagementId takes the contract's id or name; client narrows the search, and alone is enough for a " +
        "client with one contract. A contract signed in hours (unit hour) takes dailyRate as the hourly rate and " +
        "addDays as hours, and its replies say hourlyRate, contractedHours, budgetHours and addedHours. " +
        "Replies with the contract's signed dailyRate and contractedDays, rateNow (the " +
        "rate in force this month), budgetDays (signed plus added), lastDay and exhaustionMonth (null once the days worked pass the budget), the amendment " +
        "(amendmentBefore when it replaced or removed one), the whole list, and what it changes, with warnings in " +
        "the summary.",
      inputSchema: z.object({
        engagementId: z.string().optional(),
        client: z.string().min(1).optional(),
        // Strict: an amendment starts on the 1st, so a day here is refused rather than widened.
        from: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM: an amendment starts on the 1st of a month").optional(),
        unit: contractUnitSchema.optional(),
        dailyRate: z.number().positive().max(MAX_AMENDMENT_RATE).optional(),
        addDays: z.number().positive().max(MAX_ADDED_DAYS * HOURS_PER_DAY).optional(),
        endDate: z.iso.date("Use YYYY-MM-DD").optional(),
        endMonth: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM; for a day use endDate").optional(),
        note: z.string().trim().min(1).max(200).optional(),
        remove: z.boolean().optional(),
        repriceInvoiced: z.boolean().optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "amend_contract", input, async (userId) => {
        if (input.endDate && input.endMonth) throw new ToolInputError("Pass endDate or endMonth, not both.")
        const [clients, engagements, allocations, timecards, invoices] = await Promise.all([
          db().getClients(userId),
          db().getEngagements(userId),
          db().getAllocations(userId),
          db().getTimecards(userId),
          db().getInvoices(userId),
        ])
        const engagement = resolveContract(clients, engagements, input)
        const unit = contractUnit(engagement)
        if (input.unit && input.unit !== unit) {
          throw new ToolInputError(`This contract is in ${unit}s: its unit cannot be changed here, and dailyRate and addDays count ${unit}s.`)
        }
        // Passed in the contract's unit, written in days.
        const dayRate = input.dailyRate === undefined ? undefined : input.dailyRate * perDay(unit)
        const addedDays = input.addDays === undefined ? undefined : input.addDays / perDay(unit)
        // "Today" is Rome's: both server entry points pin TZ (pinServerTimeZone).
        const today = isoDate(new Date())
        const lastDay = input.endMonth
          ? (contractEndDate({ endMonth: normalizeMonth(input.endMonth), endDate: null }) ?? undefined)
          : input.endDate
        // The only guard: MCP writes through the Admin SDK, past the rules.
        const result = amendContract(
          engagement,
          { from: input.from, dailyRate: dayRate, addDays: addedDays, lastDay, note: input.note, remove: input.remove },
          { today, allocations }
        )
        if ("error" in result) throw new ToolInputError(result.error)
        const { changes, entry, before } = result
        const { from } = (entry ?? before) as ContractAmendment
        const effects = amendmentEffects({
          before: engagement, after: { ...engagement, ...changes }, from, engagements, allocations, timecards, invoices, today,
        })
        // Owner decision (2026-10-07): an invoiced month is never repriced without asking.
        const repriced = effects.invoicedRepriced.at(-1)
        if (repriced && !input.repriceInvoiced) {
          throw new ToolInputError(
            `${effects.warnings.join(" ")} This reprices invoiced months: ask the owner first, and pass ` +
              "repriceInvoiced true only if the customer agreed" +
              (entry ? `, or start from ${monthShift(repriced.yearMonth, 1)}.` : ".")
          )
        }

        const updated = await db().updateEngagement(userId, engagement.id, changes)
        const clientName = clients.find((c) => c.id === updated.clientId)?.name ?? updated.clientId
        const thisMonth = today.slice(0, 7)
        const budgetDays = contractDays(updated)
        const lastDayNow = contractEndDate(updated)
        const endBefore = contractEndDate(engagement)
        const month = formatYearMonth(from, "MMM yyyy")
        const terms = (a: ContractAmendment) =>
          [
            a.dailyRate !== null ? rateText(a.dailyRate, unit) : null,
            a.addedDays !== null ? `+${qtyText(a.addedDays, unit)}` : null,
            a.lastDay ? `until ${a.lastDay}` : null,
            a.note ? `"${a.note}"` : null,
          ].filter(Boolean).join(", ")
        const was = rateAt(engagement, from)
        const set = entry
          ? [
              dayRate !== undefined
                ? `${rateText(dayRate, unit)}${dayRate === was ? "" : ` (was ${wasRate(was, unit)})`}`
                : null,
              addedDays !== undefined && budgetDays !== null && updated.contractedDays !== null
                ? `+${qtyText(addedDays, unit)}, a budget of ${qtyText(budgetDays, unit)} ` +
                  `(${round2(updated.contractedDays * perDay(unit))} + ${round2((budgetDays - updated.contractedDays) * perDay(unit))})`
                : null,
              lastDay ? `until ${lastDayNow} (was ${endBefore})` : null,
              input.note ? `"${input.note}"` : null,
            ].filter(Boolean).join(", ")
          : ""
        const headline = entry
          ? // A merge keeps the terms not passed, so the whole month is restated, never "replaced".
            `from ${month} ${set}.${before ? ` The ${month} amendment now reads ${terms(entry)} (was ${terms(before)}).` : ""} ` +
            `Months before ${month} keep their terms.${changes.isActive ? " The contract is open again." : ""}`
          : `removed the ${month} amendment (${terms(before as ContractAmendment)}).` +
            (lastDayNow !== endBefore
              ? ` The end is back to ${lastDayNow}.`
              : before?.lastDay ? ` The end stays ${lastDayNow}: it changed after that amendment.` : "")
        // A removed extension moves the end earlier: what now sits past it still bills.
        const past =
          lastDayNow && endBefore && lastDayNow < endBefore
            ? pastTheEnd(allocations, timecards, updated.id, updated.endMonth, lastDayNow, unit)
            : { summary: "", fields: {} }
        const burn = computeBurnDown({
          sources: toRevenueSources({ engagements: [updated], opportunities: [], clients, scenario: "committed" }),
          allocations,
          fromMonth: thisMonth,
          months: 36,
        })[0]
        const { warnings, ...found } = effects
        return {
          payload: {
            summary: [`${engagementLabel(updated)} (${clientName}): ${headline}${past.summary}`, ...warnings].join(" "),
            engagement: {
              id: updated.id,
              label: engagementLabel(updated),
              client: clientName,
              clientId: updated.clientId,
              isActive: updated.isActive,
              // The signed terms; rateNow and the budget read the amendments.
              ...contractTerms(updated, thisMonth),
              lastDay: lastDayNow,
              exhaustionMonth: runOutMonth(contractUsage({ engagement: updated, timecards, cells: [], today }), burn?.exhaustionMonth ?? null),
            },
            amendment: entry && amendmentView(entry, unit),
            // The audit keeps params only, so hand back what a merge or a removal replaced.
            ...(before ? { amendmentBefore: amendmentView(before, unit) } : {}),
            amendments: (updated.amendments ?? []).map((a) => amendmentView(a, unit)),
            ...(lastDayNow !== endBefore ? { endBefore } : {}),
            ...past.fields,
            // Only what the change does: empty lists and zeros left out.
            ...Object.fromEntries(Object.entries(found).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== 0))),
          },
          documentIds: [updated.id],
        }
      })
  )

  server.registerTool(
    "add_note",
    {
      title: "Add Note",
      description:
        "Appends a dated note to a client or opportunity: «segna che Acme vuole fattura a 60gg» → " +
        "entity 'client'. Notes accumulate as '[YYYY-MM-DD] text' lines on the entity's notes field; " +
        "fails if the combined text would exceed 1000 characters (trim old notes in the web UI). " +
        "For what happened in a call or meeting use log_meeting: notes are standing facts ('wants " +
        "invoices at 60 days').",
      inputSchema: z.object({
        entity: z.enum(["client", "opportunity"]),
        ref: z.string().min(1),
        text: z.string().min(1).max(500),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "add_note", input, async (userId) => {
        const line = `[${isoDate(new Date())}] ${input.text.trim()}`
        if (input.entity === "client") {
          const clients = await db().getClients(userId)
          const client = resolveClient(clients, input.ref)
          const updated = await db().updateClient(userId, client.id, {
            notes: appendNote(client.notes, line),
          })
          return {
            payload: { summary: `Note added to ${client.name}.`, entity: "client", id: client.id, notes: updated.notes },
            documentIds: [client.id],
          }
        }
        const opportunities = await db().getOpportunities(userId)
        const opp = resolveOpportunity(opportunities, input.ref)
        const updated = await db().updateOpportunity(userId, opp.id, {
          notes: appendNote(opp.notes, line),
        })
        return {
          payload: { summary: `Note added to "${opp.title}".`, entity: "opportunity", id: opp.id, notes: updated.notes },
          documentIds: [opp.id],
        }
      })
  )

  server.registerTool(
    "add_task",
    {
      title: "New Task",
      description:
        "Adds a to-do for a client, optionally on one of its contracts: " +
        "«ricordami di mandare il report ad Acme entro venerdì» → client + title + dueDate. client " +
        "alone creates a client-level task, even when the client has a single contract " +
        "or none at all — it never picks a contract for you. Pass engagementId (the contract's id " +
        "or name) only when the user names a contract: 'add a task to the Cloud migration " +
        "contract' needs no client; with a client too, the name is looked up among that " +
        "client's contracts. engagementId prefers an active contract and reaches a closed one too. " +
        `labels tags it ('label it urgent' → ['urgent']), at most ${MAX_LABELS}. ` +
        "Convert relative dates to YYYY-MM-DD yourself.",
      inputSchema: z.object({
        client: z.string().min(1).optional(),
        title: z.string().min(1).max(200),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
        notes: z.string().max(1000).optional(),
        engagementId: z.string().optional(),
        labels: labelsInput.optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "add_task", input, async (userId) => {
        const [clients, engagements] = await Promise.all([
          db().getClients(userId),
          db().getEngagements(userId),
        ])
        // Not targetEngagement: a client alone means the client, never its only contract (#164).
        const client = input.client ? resolveClient(clients, input.client) : null
        const pool = client ? engagements.filter((e) => e.clientId === client.id) : engagements
        const engagement = input.engagementId
          ? resolvePreferringActive(pool, clients, input.engagementId)
          : null
        const clientId = engagement?.clientId ?? client?.id
        if (!clientId) throw new ToolInputError("Pass client or engagementId (the contract's id or name).")
        const clientName = clients.find((c) => c.id === clientId)?.name ?? clientId
        const created = await db().createTask(userId, {
          clientId,
          engagementId: engagement?.id ?? null,
          title: input.title.trim(),
          dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00`) : null,
          notes: input.notes ?? null,
          labels: input.labels,
        })
        return {
          payload: {
            summary:
              `Task "${created.title}" ` +
              (engagement
                ? `for ${clientName}, contract ${engagementLabel(engagement)}`
                : `for client ${clientName}`) +
              (input.dueDate ? `, due ${input.dueDate}` : "") +
              (created.labels.length ? `, labels ${quotedLabels(created.labels)}` : "") +
              ".",
            task: {
              id: created.id,
              title: created.title,
              clientId,
              client: clientName,
              engagementId: created.engagementId,
              engagementLabel: engagement ? engagementLabel(engagement) : null,
              dueDate: input.dueDate ?? null,
              labels: created.labels,
            },
          },
          documentIds: [created.id],
        }
      })
  )

  server.registerTool(
    "complete_task",
    {
      title: "Complete Task",
      description:
        "Marks an open to-do as done, by title or id: «fatto il report per Acme» → complete the " +
        "matching task. Only open tasks are searched — use list_tasks first when unsure of the title.",
      inputSchema: z.object({
        task: z.string().min(1),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "complete_task", input, async (userId) => {
        const tasks = await db().getTasks(userId)
        const open = tasks.filter((t) => !t.isDone)
        const task = resolveTask(open, input.task)
        const updated = await db().updateTask(userId, task.id, { isDone: true })
        const remaining = open.length - 1
        return {
          payload: {
            summary:
              `"${updated.title}" done. ` +
              (remaining > 0 ? `${remaining} open ${remaining === 1 ? "task" : "tasks"} left.` : "No open tasks left."),
            task: { id: updated.id, title: updated.title, isDone: updated.isDone },
          },
          documentIds: [updated.id],
        }
      })
  )

  server.registerTool(
    "update_task",
    {
      title: "Edit Task",
      description:
        "Edits an existing to-do: retitle it, move its due date ('move the report to Monday'), " +
        "change its notes, or reopen one closed by mistake with reopen. Done tasks are searched " +
        "too, so a reopen works by title. Pass dueDate null to clear the due date. Convert " +
        "relative dates to YYYY-MM-DD yourself. status moves it between board columns: " +
        "«metti in corso» → status 'doing', 'todo' to put it back to do, 'done' to close it. engagementId " +
        "moves it between client level and a contract: a contract id or name ('link it to the " +
        "Cloud migration contract'), looked up among the task's client's contracts, attaches it; " +
        "null ('unlink it from the contract') makes it a task of the client alone. labels REPLACES the " +
        "whole label set, so read the current labels from list_tasks first and send the full list: " +
        "'add the urgent label' → current labels + 'urgent', 'remove the invoice label' → " +
        "current labels without it, [] removes them all.",
      inputSchema: z.object({
        task: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
          .nullable()
          .optional(),
        notes: z.string().max(1000).nullable().optional(),
        reopen: z.boolean().optional(),
        status: z.enum(["todo", "doing", "done"]).optional(),
        engagementId: z.string().min(1).nullable().optional(),
        labels: labelsInput.optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "update_task", input, async (userId) => {
        // Kept off the Zod schema on purpose: .refine() would make it a
        // ZodEffects, and registerTool wants a plain object schema.
        if (
          input.title === undefined &&
          input.dueDate === undefined &&
          input.notes === undefined &&
          input.reopen === undefined &&
          input.status === undefined &&
          input.engagementId === undefined &&
          input.labels === undefined
        ) {
          throw new ToolInputError(
            "Nothing to change: pass title, dueDate, notes, reopen, status, engagementId or labels."
          )
        }
        if (input.reopen && input.status === "done") {
          throw new ToolInputError("reopen and status 'done' contradict each other: pass only one.")
        }
        const [tasks, engagements, clients] = await Promise.all([
          db().getTasks(userId),
          db().getEngagements(userId),
          db().getClients(userId),
        ])
        const task = resolveTask(tasks, input.task)
        const clientId = taskClientId(task, engagements)
        // Among the task's client's contracts, closed ones reachable too, as in add_task.
        const attachTo = input.engagementId
          ? resolvePreferringActive(
              engagements.filter((e) => e.clientId === clientId),
              clients,
              input.engagementId
            )
          : null
        // A detached task keeps its client, so one written before #164 needs it spelled out.
        if (input.engagementId === null && !clientId) {
          throw new ToolInputError(`"${task.title}" has no client: link it to a contract instead.`)
        }
        const updated = await db().updateTask(userId, task.id, {
          ...(attachTo ? { engagementId: attachTo.id, clientId: attachTo.clientId } : {}),
          ...(input.engagementId === null && clientId ? { engagementId: null, clientId } : {}),
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.dueDate !== undefined
            ? { dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00`) : null }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          // reopen:false is a no-op, not a completion — complete_task owns closing.
          ...(input.reopen ? { isDone: false } : {}),
          ...(input.status ? taskStatusUpdate(input.status, task) : {}),
          ...(input.labels !== undefined ? { labels: input.labels } : {}),
        })
        const changes = [
          input.title !== undefined ? `title "${updated.title}"` : null,
          input.dueDate !== undefined
            ? input.dueDate
              ? `due ${input.dueDate}`
              : "due date removed"
            : null,
          input.notes !== undefined ? (input.notes ? "notes updated" : "notes removed") : null,
          input.reopen ? "reopened" : null,
          input.status ? `status "${input.status}"` : null,
          attachTo ? `linked to contract ${engagementLabel(attachTo)}` : null,
          input.engagementId === null
            ? `unlinked from the contract, now on client ${clients.find((c) => c.id === clientId)?.name ?? clientId}`
            : null,
          input.labels !== undefined
            ? updated.labels.length
              ? `labels ${quotedLabels(updated.labels)}`
              : "labels removed"
            : null,
        ].filter(Boolean)
        return {
          payload: {
            summary: `"${updated.title}" updated: ${changes.join(", ")}.`,
            task: {
              id: updated.id,
              title: updated.title,
              clientId: taskClientId(updated, engagements),
              engagementId: updated.engagementId,
              dueDate: updated.dueDate ? isoDate(updated.dueDate) : null,
              isDone: updated.isDone,
              status: statusOf(updated),
              labels: updated.labels,
            },
          },
          documentIds: [updated.id],
        }
      })
  )

  server.registerTool(
    "delete_task",
    {
      title: "Delete Task",
      description:
        "Deletes a to-do by title or id — for one added by mistake. Done tasks are searched too. " +
        "Irreversible: to close a finished task use complete_task, which keeps it in the history.",
      inputSchema: z.object({
        task: z.string().min(1),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "delete_task", input, async (userId) => {
        const tasks = await db().getTasks(userId)
        const task = resolveTask(tasks, input.task)
        await db().deleteTask(userId, task.id)
        return {
          payload: {
            summary: `Task "${task.title}" deleted.`,
            task: { id: task.id, title: task.title },
          },
          documentIds: [task.id],
        }
      })
  )

  // ─── Invoices ──────────────────────────────────────────────────────────────

  server.registerTool(
    "create_invoice",
    {
      title: "Record Invoice",
      description:
        "Records an invoice already issued in the e-invoicing «fatturazione elettronica» software — this is " +
        "the CRM's copy for cash questions, never the legal record. An invoice bills the client, not a " +
        "contract: one invoice a month covers the hours of all its contracts, closed ones included, so only " +
        "the client is named. yearMonth is the accrual month «competenza» (the months the days were worked), " +
        "which is NOT necessarily the issue month. amount is the net amount «imponibile», before VAT; vat is " +
        "what was actually charged, so pass 0 for reverse charge or exempt «esente» rather than computing " +
        "22%. Both go negative for a credit note «nota di credito». Fails on a duplicate number. The amount, " +
        "yearMonth and vat usually come from get_unbilled's suggestions. An invoice " +
        "covering several months names the first in fromMonth and the last in yearMonth: «la fattura copre " +
        "aprile–giugno» → fromMonth 2026-04, yearMonth 2026-06 (at most 12 months); omit fromMonth for one month.",
      inputSchema: z.object({
        client: z.string().min(1),
        number: z.string().min(1).max(50),
        fromMonth: monthInput.optional(),
        yearMonth: monthInput,
        amount: z.number().finite(),
        vat: z.number().finite(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
        paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "create_invoice", input, async (userId) => {
        const [clients, invoices] = await Promise.all([db().getClients(userId), db().getInvoices(userId)])
        const number = input.number.trim()
        const duplicate = invoiceNumberTaken(invoices, number)
        if (duplicate) {
          throw new ToolInputError(
            `An invoice numbered "${duplicate.number}" already exists. The accountant assigns the numbers: check before recording it again.`
          )
        }
        const client = resolveClient(clients, input.client)
        const yearMonth = normalizeMonth(input.yearMonth)
        const fromMonth = input.fromMonth ? normalizeMonth(input.fromMonth) : null
        const periodError = invoicePeriodError(fromMonth, yearMonth)
        if (periodError) throw new ToolInputError(periodError)

        const created = await db().createInvoice(userId, {
          clientId: client.id,
          number,
          // From == to is a single month: stored as null.
          fromMonth: fromMonth && fromMonth < yearMonth ? fromMonth : null,
          yearMonth,
          amount: input.amount,
          vat: input.vat,
          dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00`) : null,
          paidDate: input.paidDate ? new Date(`${input.paidDate}T00:00:00`) : null,
        })
        return {
          payload: {
            summary:
              `Invoice ${created.number} for ${client.name}: €${invoiceTotal(created)} ` +
              `(net €${created.amount}, VAT €${created.vat}), ` +
              (created.fromMonth
                ? `accrual months ${created.fromMonth}–${created.yearMonth}`
                : `accrual month ${created.yearMonth}`) +
              (input.dueDate ? `, due ${input.dueDate}.` : "."),
            invoice: {
              id: created.id,
              number: created.number,
              client: client.name,
              clientId: client.id,
              fromMonth: created.fromMonth,
              yearMonth: created.yearMonth,
              total: invoiceTotal(created),
              dueDate: input.dueDate ?? null,
              paidDate: input.paidDate ?? null,
            },
          },
          documentIds: [created.id],
        }
      })
  )

  server.registerTool(
    "mark_invoice_paid",
    {
      title: "Mark Invoice Paid",
      description:
        "Stamps the cash date on an invoice: «ho incassato la 2026/14» → paidDate today. Pass " +
        "paidDate for a payment that landed earlier. Identify the invoice by its number or id. " +
        "Paid is a date, not a flag — to undo a wrong stamp, update_invoice with paidDate null; a bank fee booked " +
        "with it stays on Costs: delete_expense removes it. " +
        "Once the company has accounts in the Cash Book, account is the company (SRL) account the money arrived on " +
        "(for a credit note, the one it was refunded from), the only one when there is one; account \"none\" closes " +
        "it as an offset against a credit note, no money moved. received is what the bank shows when it is less " +
        `than the invoice total: up to €${MAX_BANK_FEE} short is booked as a bank fee in the same write; more short, ` +
        "or more than the total, is refused. One transfer paying several invoices: call once per invoice with the " +
        "same date and account. An open credit note on the same months is usually deducted from this payment: ask " +
        "the owner, then mark it paid too, into the same account on the same day, and leave out received here: the " +
        "two add up to what arrived.",
      inputSchema: z.object({
        invoice: z.string().min(1),
        paidDate: dayInput.optional(),
        account: z.string().min(1).optional(),
        received: z.number().positive().finite().optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "mark_invoice_paid", input, async (userId) => {
        const [invoices, accounts, expenses, engagements] = await Promise.all([
          db().getInvoices(userId),
          db().getCompanyAccounts(userId),
          db().getCompanyExpenses(userId),
          db().getEngagements(userId),
        ])
        const invoice = resolveInvoice(invoices, input.invoice)
        if (invoice.paidDate) {
          throw new ToolInputError(
            `Invoice ${invoice.number} was already collected on ${isoDate(invoice.paidDate)}.`
          )
        }
        // No Cash Book yet: the date alone, as before it.
        if (accounts.length === 0 && input.account === undefined && input.received === undefined) {
          const paidDate = input.paidDate ? new Date(`${input.paidDate}T00:00:00`) : new Date()
          const updated = await db().updateInvoice(userId, invoice.id, { paidDate })
          return {
            payload: {
              summary: `Invoice ${updated.number} collected on ${isoDate(paidDate)}: €${invoiceTotal(updated)}.`,
              invoice: {
                id: updated.id,
                number: updated.number,
                total: invoiceTotal(updated),
                paidDate: isoDate(paidDate),
              },
            },
            documentIds: [updated.id],
          }
        }

        // Mark Paid's rules (invoice-table.tsx): an account or the offset, and a short payment up to a bank fee.
        const day = cashDay(input.paidDate)
        const credit = invoice.amount < 0
        const offset = input.account?.trim().toLowerCase() === "none"
        const account = offset
          ? null
          : resolveCompanyAccount(accounts, input.account, ' Or account "none" for an offset against a credit note, no money moved.')
        let fee = 0
        if (input.received !== undefined) {
          if (credit || offset) {
            throw new ToolInputError(credit ? "A credit note has no amount received: leave out received." : "An offset moves no money: leave out received.")
          }
          const expected = invoiceTotal(invoice)
          fee = round2(expected - input.received)
          // Mark Paid ticks these and adds them to the expected amount: a credit note deducted is never a fee.
          const open = fee > 0 ? openCredits(invoice, invoices, engagements) : []
          if (open.length > 0) {
            throw new ToolInputError(
              `${open.map((c) => `Credit note ${c.number} (${eurCents(invoiceTotal(c))})`).join(", ")} ${open.length === 1 ? "is" : "are"} ` +
                `still open on the same customer and months: ${eurCents(fee)} short is usually ${open.length === 1 ? "it" : "them"}, ` +
                `deducted, not a bank fee. Mark ${open.length === 1 ? "it" : "them"} paid into ${account!.name} on the same day, and ` +
                "this invoice without received: they add up to what arrived. A real bank fee, on top or instead, is add_expense " +
                "category bank_fees."
            )
          }
          if (fee > MAX_BANK_FEE) {
            throw new ToolInputError(
              `${eurCents(fee)} short of the ${eurCents(expected)} expected: partial payments aren't supported. Record the ` +
                "payment when it is complete, or fix the invoice. If a credit note was deducted from this payment, leave " +
                "out received and mark the credit note paid into the same account on the same day: the two add up to what arrived."
            )
          }
          if (fee < 0) {
            throw new ToolInputError(
              `That is more than expected: mark it paid at ${eurCents(expected)} (leave out received) and add the extra ` +
                "with add_movement kind client_income."
            )
          }
        }
        const earlierFee = fee > 0 ? bankFeeOn(expenses, invoice) : undefined
        if (earlierFee) {
          throw new ToolInputError(
            `A bank fee on invoice ${invoice.number} is already on Costs, from an earlier payment (expense ${earlierFee.id}): ` +
              "delete it first with delete_expense, or leave out received."
          )
        }
        const { invoice: updated, fee: bankFee } = await db().settleInvoicePayment(userId, {
          invoiceId: invoice.id,
          paidDate: dateOf(day),
          paidAccountId: account?.id ?? NON_CASH,
          ...(fee > 0 ? { fee } : {}),
        })
        const after = account ? await balancesAfter(userId, [account]) : null
        return {
          payload: {
            summary:
              `${credit ? "Credit note" : "Invoice"} ${updated.number} ${credit ? "settled" : "collected"} on ${day}` +
              (account ? ` ${credit ? "from" : "into"} ${account.name}` : " as an offset, no money moved") +
              `: ${eurCents(invoiceTotal(updated))}.` +
              (bankFee
                ? ` ${eurCents(fee)} short: booked as a bank fee, a cost on the same day and account. Undoing the payment ` +
                  `leaves it on Costs: delete_expense id ${bankFee.id} removes it.`
                : "") +
              (account ? beforeOpening(account, day) : "") +
              (after ? ` ${after.text}` : ""),
            invoice: {
              id: updated.id,
              number: updated.number,
              total: invoiceTotal(updated),
              paidDate: day,
              account: account?.name ?? null,
              offset,
            },
            ...(bankFee ? { bankFee: { id: bankFee.id, amount: bankFee.amount } } : {}),
            ...(after ? { balances: after.balances } : {}),
          },
          documentIds: [updated.id, ...(bankFee ? [bankFee.id] : [])],
        }
      })
  )

  server.registerTool(
    "update_invoice",
    {
      title: "Edit Invoice",
      description:
        "Edits a recorded company (SRL) invoice or credit note, by number or id: its number, amounts, dates or the months " +
        "it covers: «la 9 copre aprile–giugno» → fromMonth 2026-04, yearMonth 2026-06 (yearMonth is always the last " +
        "accrual month; fromMonth null makes it a single month again). get_unbilled spreads a period by the hours logged " +
        "in each ended month, the current month and later evenly. amount is the net «imponibile» and vat is stored apart: " +
        "it never follows amount, so a corrected total needs both. paidDate null marks it unpaid and takes its payment " +
        "off the Cash Book (the bank fee booked with it stays on Costs: the preview names it). The client never changes: " +
        "record it again for another client. The preview says what To invoice and Unpaid become for the customer, and " +
        "the balance of the company account it was paid into. " +
        CONFIRM_RULE,
      inputSchema: z.object({
        invoice: z.string().min(1),
        number: z.string().trim().min(1).max(50).optional(),
        fromMonth: monthInput.nullable().optional(),
        yearMonth: monthInput.optional(),
        amount: z.number().finite().optional(),
        vat: z.number().finite().optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable().optional(),
        paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable().optional(),
        confirm: confirmInput,
      }),
    },
    async (input, ctx) =>
      audited(
        ctx,
        "update_invoice",
        input,
        async (userId) => {
          // Kept off the Zod schema on purpose, as in update_task: .refine() would make it a ZodEffects.
          const { invoice: query, confirm, ...changes } = input
          if (Object.values(changes).every((v) => v === undefined)) {
            throw new ToolInputError(
              "Nothing to change: pass number, fromMonth, yearMonth, amount, vat, dueDate or paidDate."
            )
          }
          const [b, timecards] = await Promise.all([loadBook(userId), db().getTimecards(userId)])
          const invoice = resolveInvoice(b.invoices, query)
          const { number } = input
          const duplicate = number !== undefined && invoiceNumberTaken(b.invoices, number, invoice.id)
          if (duplicate) {
            throw new ToolInputError(
              `An invoice numbered "${duplicate.number}" already exists. The accountant assigns the numbers: check before renumbering.`
            )
          }
          // The period is checked merged with what is stored: passing one end moves only that end.
          const period = input.fromMonth !== undefined || input.yearMonth !== undefined
          const from =
            input.fromMonth === undefined ? invoice.fromMonth : input.fromMonth ? normalizeMonth(input.fromMonth) : null
          const to = input.yearMonth ? normalizeMonth(input.yearMonth) : invoice.yearMonth
          const periodError = period ? invoicePeriodError(from, to) : null
          if (periodError) throw new ToolInputError(periodError)

          const day = (value: string | null) => (value ? new Date(`${value}T00:00:00`) : null)
          const set: UpdateInvoiceInput = {
            ...(number !== undefined ? { number } : {}),
            // From == to is a single month: stored as null.
            ...(period ? { fromMonth: from && from < to ? from : null, yearMonth: to } : {}),
            ...(input.amount !== undefined ? { amount: input.amount } : {}),
            ...(input.vat !== undefined ? { vat: input.vat } : {}),
            ...(input.dueDate !== undefined ? { dueDate: day(input.dueDate) } : {}),
            ...(input.paidDate !== undefined ? { paidDate: day(input.paidDate) } : {}),
            // Unpaid, it was paid into nothing: the web's Undo clears both.
            ...(input.paidDate === null && invoice.paidAccountId !== null ? { paidAccountId: null } : {}),
          }
          const updated: Invoice = { ...invoice, ...set }
          const invoices = b.invoices.map((i) => (i.id === invoice.id ? updated : i))
          const today = isoDate(new Date())
          const clientId = invoiceClientId(invoice, b.engagements)
          const customer = b.clients.find((c) => c.id === clientId)?.name ?? "the customer"
          const owed = customerOwed(b, timecards, clientId, customer, today)
          const figures = [
            ...figureChanges(owed(b.invoices), owed(invoices)),
            ...figureChanges(bookFigures(b, [], today), bookFigures({ ...b, invoices }, [], today)),
          ]
          // Marked unpaid, the fee its payment booked stays: the bank charged it all the same.
          const fee = input.paidDate === null && invoice.paidDate ? bankFeeOn(b.expenses, invoice) : undefined
          const notes = fee
            ? [
                `The ${eurCents(fee.amount + (fee.vat ?? 0))} bank fee booked with its payment ("${fee.description}", expense ${fee.id}) ` +
                  `stays on Costs, as on the web. To remove it too, delete_expense id ${fee.id}.`,
              ]
            : []
          const changed = [
            number !== undefined ? `number ${updated.number}` : null,
            period ? (updated.fromMonth ? `covers ${updated.fromMonth}–${updated.yearMonth}` : `accrual month ${updated.yearMonth}`) : null,
            input.amount !== undefined || input.vat !== undefined
              ? `net ${eurCents(updated.amount)}, VAT ${eurCents(updated.vat)}, total ${eurCents(invoiceTotal(updated))}`
              : null,
            input.dueDate !== undefined ? (input.dueDate ? `due ${input.dueDate}` : "due date removed") : null,
            input.paidDate !== undefined ? (input.paidDate ? `paid ${input.paidDate}` : "marked unpaid") : null,
          ].filter(Boolean)
          const noun = invoice.amount < 0 ? "credit note" : "invoice"
          return previewOrApply(userId, confirm, {
            action: `edit ${noun} ${invoice.number} (${clientId ? `${customer}, ` : ""}${eurCents(invoiceTotal(invoice))}): ${changed.join(", ")}`,
            done: `${noun === "invoice" ? "Invoice" : "Credit note"} ${updated.number} updated: ${changed.join(", ")}`,
            before: invoiceCard(invoice, b),
            after: invoiceCard(updated, b),
            figures,
            notes,
            touched: accountsOf(b.accounts, [invoicePaidInto(invoice), invoicePaidInto(updated)]),
            id: invoice.id,
            write: () => db().updateInvoice(userId, invoice.id, set),
          })
        },
        !input.confirm,
      )
  )

  server.registerTool(
    "delete_invoice",
    {
      title: "Delete Invoice",
      description:
        "Deletes a company invoice or credit note recorded by mistake, by number or id: «cancella la fattura " +
        "18/2026». The app's copy only: the paper in the e-invoicing software stays, and a real invoice issued wrong is " +
        "corrected with a credit note, not deleted. A paid one takes its payment off the Cash Book with it: to keep the " +
        "invoice and take only the payment off, update_invoice paidDate null. The preview says what To invoice and " +
        "Unpaid become for the customer, the company (SRL) account balance when it was paid into one, the credit notes " +
        "on the same months (they stay), and the bank fee booked with its payment, which stays on Costs as on the web " +
        "(delete_expense removes it). " +
        CONFIRM_RULE,
      inputSchema: z.object({
        invoice: z.string().min(1),
        confirm: confirmInput,
      }),
    },
    async (input, ctx) =>
      audited(
        ctx,
        "delete_invoice",
        input,
        async (userId) => {
          const [b, timecards] = await Promise.all([loadBook(userId), db().getTimecards(userId)])
          const invoice = resolveInvoice(b.invoices, input.invoice)
          const credit = invoice.amount < 0
          const noun = credit ? "credit note" : "invoice"
          const clientId = invoiceClientId(invoice, b.engagements)
          const customer = b.clients.find((c) => c.id === clientId)?.name ?? "the customer"
          const account = b.accounts.find((a) => a.id === invoicePaidInto(invoice)) ?? null
          const rest = b.invoices.filter((i) => i.id !== invoice.id)
          const today = isoDate(new Date())

          // To invoice and Unpaid as the web's Delete says them, then the cash book's figures.
          const owed = customerOwed(b, timecards, clientId, customer, today)
          const figures = [
            ...figureChanges(owed(b.invoices), owed(rest)),
            ...figureChanges(bookFigures(b, [], today), bookFigures({ ...b, invoices: rest }, [], today)),
          ]

          const fee = bankFeeOn(b.expenses, invoice)
          // What corrects it, or what it corrects: both stay, and now count alone.
          const linked = credit
            ? b.invoices.filter((i) => creditsOn(i, b.invoices, b.engagements).some((c) => c.id === invoice.id))
            : creditsOn(invoice, b.invoices, b.engagements)
          const numbers = linked.map((i) => i.number).join(", ")
          // Closed as an offset (Mark Paid, no money moved): it stays marked paid, though nothing may settle it any more.
          const offsets = credit ? linked.filter((i) => i.paidDate && i.paidAccountId === NON_CASH) : []
          const notes = [
            `This removes the app's copy only; the ${noun} in your invoicing software is untouched.`,
            account
              ? `It was paid into ${account.name} on ${dayLabel(isoDate(invoice.paidDate!))}: the payment leaves the Cash Book with it. ` +
                "To keep the invoice and take only the payment off, use update_invoice with paidDate null instead."
              : null,
            fee
              ? `The ${eurCents(fee.amount + (fee.vat ?? 0))} bank fee booked with its payment ("${fee.description}", expense ${fee.id}) ` +
                "stays on Costs, as on the web: the bank charged it whatever happens to the invoice. To remove it too, " +
                `delete_expense id ${fee.id}.`
              : null,
            linked.length
              ? credit
                ? `It corrects ${numbers}, which ${linked.length === 1 ? "counts" : "count"} in full again without it.`
                : linked.length === 1
                  ? `Credit note ${numbers} on the same months stays: with this invoice gone it lowers what ${customer} owes on its own. ` +
                    "Delete it too if it only corrected this invoice."
                  : `Credit notes ${numbers} on the same months stay: with this invoice gone they lower what ${customer} owes on their own. ` +
                    "Delete them too if they only corrected this invoice."
              : null,
            ...offsets.map(
              (i) =>
                `${i.number} stays marked paid as an offset, no money moved: Unpaid doesn't count it. If this credit note was ` +
                `what settled it and ${customer} now owes it, mark it unpaid with update_invoice paidDate null.`,
            ),
          ].filter((n): n is string => n !== null)

          const label = `${noun} ${invoice.number} (${clientId ? `${customer}, ` : ""}${eurCents(invoiceTotal(invoice))})`
          return previewOrApply(userId, input.confirm, {
            action: `delete ${label}`,
            done: `Deleted ${label}`,
            before: invoiceCard(invoice, b),
            after: null,
            figures,
            notes,
            touched: account ? [account] : [],
            id: invoice.id,
            write: () => db().deleteInvoice(userId, invoice.id),
          })
        },
        !input.confirm,
      )
  )

  // ─── Company deadlines ─────────────────────────────────────────────────────

  server.registerTool(
    "add_deadline",
    {
      title: "New Deadline",
      description:
        "Stores a date the company has to remember that the app cannot derive on its own — the " +
        "accountant's fee, an F24 the accountant gave you (kind tax), a contract renewal, a bank formality. " +
        "Convert relative dates to YYYY-MM-DD yourself. Do NOT use this for invoice due dates or pipeline " +
        "follow-ups: those are computed from the plan every time, and storing a copy would let it " +
        "drift. amount is the expected cash out, when known.",
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
        kind: companyDeadlineKindSchema,
        amount: z.number().min(0).finite().optional(),
        notes: z.string().max(1000).optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "add_deadline", input, async (userId) => {
        const created = await db().createCompanyDeadline(userId, {
          title: input.title.trim(),
          date: new Date(`${input.date}T00:00:00`),
          kind: input.kind,
          amount: input.amount ?? null,
          notes: input.notes ?? null,
        })
        return {
          payload: {
            summary:
              `Deadline "${created.title}" on ${input.date}` +
              (created.amount != null ? `, €${created.amount}.` : "."),
            deadline: {
              id: created.id,
              title: created.title,
              date: input.date,
              kind: created.kind,
              amount: created.amount,
            },
          },
          documentIds: [created.id],
        }
      })
  )

  server.registerTool(
    "complete_deadline",
    {
      title: "Mark Deadline Done",
      description:
        "Ticks off a stored deadline by title or id. Pass done=false to reopen one closed by " +
        "mistake. Only reaches the deadlines you typed in — an invoice is not one of these (use " +
        "mark_invoice_paid).",
      inputSchema: z.object({
        deadline: z.string().min(1),
        done: z.boolean().optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "complete_deadline", input, async (userId) => {
        const deadlines = await db().getCompanyDeadlines(userId)
        const deadline = resolveDeadline(deadlines, input.deadline)
        const done = input.done ?? true
        if (deadline.isDone === done) {
          throw new ToolInputError(
            `Deadline "${deadline.title}" is already ${done ? "marked done" : "open"}.`
          )
        }
        const updated = await db().updateCompanyDeadline(userId, deadline.id, { isDone: done })
        return {
          payload: {
            summary: `Deadline "${updated.title}" ${done ? "marked done" : "reopened"}.`,
            deadline: { id: updated.id, title: updated.title, isDone: updated.isDone },
          },
          documentIds: [updated.id],
        }
      })
  )

  // ─── Pipeline follow-ups ───────────────────────────────────────────────────

  server.registerTool(
    "schedule_follow_up",
    {
      title: "Schedule Follow-Up",
      description:
        "Sets or moves the next action on an open opportunity: «richiamo Acme il 3 settembre» → date. This " +
        "is the date that shows on the Deadlines calendar — a follow-up is never 'done', it either " +
        "happens and moves or it goes overdue, so reschedule it rather than closing it. Pass " +
        "date=null to drop the reminder. A won or lost deal cannot be chased.",
      inputSchema: z.object({
        opportunity: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable(),
        note: z.string().max(500).optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "schedule_follow_up", input, async (userId) => {
        const opportunities = await db().getOpportunities(userId)
        const opp = resolveOpportunity(opportunities, input.opportunity)
        if (!isOpen(opp)) {
          throw new ToolInputError(
            `"${opp.title}" is ${STAGE_LABELS[opp.stage]}: a closed opportunity is not chased any more.`
          )
        }
        const updated = await db().updateOpportunity(userId, opp.id, {
          nextActionDate: input.date ? new Date(`${input.date}T00:00:00`) : null,
          ...(input.note !== undefined && { nextActionNote: input.note }),
        })
        return {
          payload: {
            summary: input.date
              ? `Follow-up for "${updated.title}" on ${input.date}` +
                (input.note ? `: ${input.note}.` : ".")
              : `Follow-up removed from "${updated.title}".`,
            opportunity: {
              id: updated.id,
              title: updated.title,
              stage: updated.stage,
              nextActionDate: input.date,
              nextActionNote: updated.nextActionNote,
            },
          },
          documentIds: [updated.id],
        }
      })
  )

  // ─── Timecards ─────────────────────────────────────────────────────────────

  server.registerTool(
    "log_time",
    {
      title: "Log Hours",
      description:
        "Records hours actually worked on one contract on one day (a timecard, the actuals): " +
        "«oggi 6 ore su Dunder» → client 'Dunder', hours 6. date defaults to today (Europe/Rome); " +
        "convert 'yesterday' or 'Monday' to YYYY-MM-DD yourself. hours is the day's TOTAL on that " +
        "contract, not an increment, so repeating a call is harmless. When the day already holds " +
        "different hours the call is refused and says what is there: a correction " +
        "«correggi: erano 5 ore» → hours 5, replace: true; more hours «altre 2 ore» → the stored hours " +
        "+ 2, replace: true. hours 0 removes the day, even one before the start or after the end. New " +
        "hours go on any day from the contract's start month to its last day (lastDay), up to 3 months " +
        "ahead of today (Europe/Rome), and none on a contract closed with no end; a day after today is " +
        "scheduled: list_time lists it apart and " +
        "get_unbilled counts it once the day has passed. The 8-hour day holds: the owner logs at most 8 hours " +
        "a day per client (over all that client's contracts; another client has its own 8), and the contract's " +
        "hours never pass its days (a refusal points to amend_contract). Hours past the month's plan are " +
        "accepted, and the reply carries a warning. Lowering is never refused. Hours never change the plan: to plan days use " +
        "log_allocation. engagementId takes the contract's id or name, picks " +
        "one when the client has several, and reaches a closed contract too (to correct or remove " +
        "its hours); client alone targets active contracts. Replies with the day's total across " +
        "contracts and the month's hours, days (8 hours = 1 day) and planned days. notes '' or null on the " +
        "same hours clears the day's note, on any day.",
      inputSchema: z.object({
        client: z.string().min(1).optional(),
        engagementId: z.string().optional(),
        hours: z.number().min(0).max(24),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
        notes: z.string().max(1000).nullish(),
        replace: z.boolean().optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "log_time", input, async (userId) => {
        const today = isoDate(new Date())
        const date = input.date ?? today
        // The storage schema's own rule, so 2026-02-30 is refused here, not after a write.
        if (!setTimecardSchema.shape.date.safeParse(date).success) {
          throw new ToolInputError(`Invalid date: "${date}" does not exist.`)
        }
        const yearMonth = date.slice(0, 7)
        const [clients, engagements, timecards, allocations] = await Promise.all([
          db().getClients(userId),
          // Every contract: targetEngagement reaches a closed one by engagementId only (#156).
          db().getEngagements(userId),
          db().getTimecards(userId),
          db().getAllocations(userId, { from: yearMonth, to: yearMonth }),
        ])
        const engagement = targetEngagement(engagements, clients, input)
        const contract = engagementLabel(engagement)

        // The owner's row: a collaborator's hours on the same day are another document (collaboratorId).
        const stored = timecards.find((t) => t.engagementId === engagement.id && t.date === date && !t.collaboratorId)
        const previousHours = stored?.hours ?? null
        // Blank clears, as on the grid (noteEdit): stored as null, never "".
        const notes = input.notes === undefined ? undefined : input.notes?.trim() || null
        const decision = timecardDecision(stored, { ...input, notes })
        const writes = decision === "create" || decision === "update"
        // Clearing a note on the same hours, like removing hours, is always allowed (noteEdit).
        const clearsNote = decision === "update" && notes === null && previousHours === input.hours
        // The grid's own rule (hoursRefusal). Only new hours and notes are refused: ones stored before
        // a start moved later, or after an end moved earlier, stay removable.
        const refusal = (writes && !clearsNote) || decision === "conflict" ? hoursRefusal(engagement, date, today) : null
        const removable = stored ? ` The ${plural(stored.hours, "hour", "hours")} already logged can be removed with hours 0.` : ""
        if (refusal === "closed") {
          throw new ToolInputError(
            `Contract ${contract} is closed with no end: it takes no hours.${removable}` +
              " To log them, reopen it (update_engagement active true) or set its last day with update_engagement endDate."
          )
        }
        if (refusal === "beforeStart") {
          // resolveAllocationGrid zeroes every month before startMonth: hours there would count for nothing.
          throw new ToolInputError(`Contract ${contract} starts in ${engagement.startMonth}: ${date} is before the start.${removable}`)
        }
        if (refusal === "afterEnd") {
          throw new ToolInputError(
            `Contract ${contract} ended on ${contractEndDate(engagement)}: ${date} is after its end.${removable}` +
              " To log it, move the end with update_engagement endDate."
          )
        }
        if (refusal === "tooFar") {
          throw new ToolInputError(
            `${date} is more than ${HOURS_AHEAD_MONTHS} months ahead: hours go up to ${lastLoggableDay(today)}. ` +
              "To plan days, use log_allocation."
          )
        }
        if (decision === "conflict") {
          throw new ToolInputError(
            `${date} on ${contract} already has ${plural(previousHours ?? 0, "hour", "hours")}. If the total is ${input.hours}, ` +
              `repeat with replace: true; if ${input.hours} are extra, repeat with hours ` +
              `${round2((previousHours ?? 0) + input.hours)} and replace: true.`
          )
        }
        const sum = (pool: typeof timecards) => round2(pool.reduce((s, t) => s + t.hours, 0))
        // The plan's own cell, shared with the grid (monthPlanDays). None for a closed contract with
        // no endMonth, which toRevenueSources leaves out of the plan.
        const plannedDays = monthPlanDays(engagement, allocations, yearMonth, today.slice(0, 7))
        // The grid's own limits (cellLimits, limitRefusal): 8 hours a day on this client, and the contract's days.
        // A collaborator's hours are theirs for the day, and count toward the contract.
        const limits = cellLimits({
          timecards,
          engagements,
          engagement,
          date,
          who: null,
          plannedDays,
        })
        const limit = writes ? limitRefusal(input.hours, previousHours ?? 0, limits) : null
        if (limit) throw new ToolInputError(`${date} on ${contract}: ${limitMessage(limit, "amend_contract")}`)
        // The day across all the owner's contracts, for the reply.
        const otherHours = sum(timecards.filter((t) => t.date === date && t.engagementId !== engagement.id && !t.collaboratorId))
        const overPlan = writes ? planWarning(input.hours, limits) : null
        if (writes) {
          await db().setTimecard(userId, { engagementId: engagement.id, date, hours: input.hours, notes })
        } else if (decision === "delete") {
          await db().deleteTimecard(userId, engagement.id, date)
        }

        // After the call the day holds exactly input.hours on this contract, whatever the decision.
        const restOfMonth = timecards.filter(
          (t) => t.engagementId === engagement.id && t.date.startsWith(yearMonth) && (t.date !== date || !!t.collaboratorId)
        )
        const monthHours = round2(sum(restOfMonth) + input.hours)
        const clientName = clients.find((c) => c.id === engagement.clientId)?.name ?? engagement.clientId
        const dayTotalHours = round2(otherHours + input.hours)
        const scheduled = date > today
        const action = {
          create: `Logged ${plural(input.hours, "hour", "hours")}`,
          update:
            clearsNote
              ? `Cleared the note on the ${plural(input.hours, "hour", "hours")}`
              : previousHours === input.hours
              ? `Updated the note on the ${plural(input.hours, "hour", "hours")}`
              : `Corrected to ${plural(input.hours, "hour", "hours")} (was ${previousHours})`,
          delete: `Removed the ${plural(previousHours ?? 0, "hour", "hours")}`,
          unchanged: input.hours === 0 ? "No hours to remove" : `${plural(input.hours, "hour", "hours")} already logged, nothing changed`,
        }[decision]
        return {
          payload: {
            summary:
              `${action} on ${date} for ${clientName}, contract ${contract}. ` +
              `${yearMonth}: ${plural(monthHours, "hour", "hours")}` +
              (contractUnit(engagement) === "hour" ? "" : ` = ${plural(round2(hoursToDays(monthHours)), "day", "days")}`) +
              (plannedDays === null
                ? " (contract closed, outside the plan)."
                : contractUnit(engagement) === "hour"
                  ? ` of ${plural(inContractUnit(plannedDays, "hour"), "planned hour", "planned hours")}.`
                  : ` of ${plural(plannedDays, "planned day", "planned days")}.`) +
              (dayTotalHours !== input.hours ? ` Day total across all contracts: ${plural(dayTotalHours, "hour", "hours")}.` : "") +
              // Not after a removal: there is nothing left to count.
              (scheduled && input.hours > 0 ? " Scheduled: it counts as worked once the day comes." : "") +
              (overPlan ? ` Warning: ${overPlan}` : ""),
            change: decision,
            client: clientName,
            engagementId: engagement.id,
            contract,
            date,
            hours: input.hours,
            previousHours,
            dayTotalHours,
            scheduled,
            month: { yearMonth, hours: monthHours, days: hoursToDays(monthHours), plannedDays },
          },
          documentIds: [`${engagement.id}_${date}`],
        }
      })
  )

  // ─── Meetings ──────────────────────────────────────────────────────────────

  server.registerTool(
    "log_meeting",
    {
      title: "Log Meeting",
      description:
        "Records the minutes of a call or meeting, and optionally how the project is going: " +
        "«call con Dunder» → client 'Dunder'; 'spoke to Dunder at 10:30, the tests are slipping, we are " +
        "at yellow' → client 'Dunder', time '10:30', health 'yellow', text 'The tests are slipping by two " +
        "weeks.' A «progetto» is a contract: pass its name as engagementId. What was built, and its History " +
        "section, is the solution catalog: get_solution / update_solution. health is green, yellow or red " +
        "(«verde/giallo/rosso» → green/yellow/red). It is the contract's status, not a task status and not " +
        "open/closed. Omit it when the user gave none: the contract keeps its last one, and the reply says " +
        "which; tell the user. A status change without a call is a meeting too: «metti Dunder in rosso» → " +
        "health red, the reason as text, no time. client alone files the meeting on the client's only " +
        "active contract (unlike add_task); on a client with none (a prospect, a pre-sale call) it is " +
        "client-level; with several it fails listing them. engagementId null forces a client-level meeting; " +
        "engagementId as a name reaches a closed contract too. The reply names where it landed and the " +
        "contract's status before and after. Write text in the language the user used, as plain text: facts " +
        "and decisions; add nothing the user did not say. Follow-ups are tasks: call add_task for each. " +
        "Only calls that already happened; a future call is add_task with a dueDate. date defaults to today " +
        "(Europe/Rome); convert relative dates to YYYY-MM-DD and times to HH:MM yourself. To delete a " +
        "meeting use the web app: Clients → Meetings.",
      inputSchema: z.object({
        client: z.string().min(1).optional(),
        engagementId: z.string().min(1).nullable().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
        time: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM").optional(),
        health: z.enum(["green", "yellow", "red"]).optional(),
        // Over the cap is an error, never a silent cut: the rule enforces the same 5000.
        text: z.string().min(1).max(MEETING_TEXT_MAX),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "log_meeting", input, async (userId) => {
        const [clients, engagements, meetings] = await Promise.all([
          db().getClients(userId),
          // Every contract: engagementId reaches a closed one (#156).
          db().getEngagements(userId),
          db().getMeetings(userId),
        ])
        const { clientId, engagement } = meetingTarget(engagements, clients, input)
        // The storage schema, so 25:00, 2026-02-30 and a blank text are refused before a write.
        const parsed = createMeetingSchema.safeParse({
          clientId,
          engagementId: engagement?.id ?? null,
          date: input.date ?? isoDate(new Date()),
          time: input.time ?? null,
          health: input.health ?? null,
          text: input.text,
        })
        if (!parsed.success) throw new ToolInputError(parsed.error.issues[0].message)
        refuseFutureMeeting(parsed.data.date)

        const created = await db().createMeeting(userId, parsed.data)
        const card = meetingCard(created, clients, engagements)
        // healthByContract is the UI chip's rule, so the reply says what the screen shows.
        const previous = engagement ? stated(healthByContract(meetings).get(engagement.id)) : null
        const latest = engagement ? healthByContract([...meetings, created]).get(engagement.id) : undefined
        const current = stated(latest)
        const status =
          !engagement ? ""
          : !current ? " No status given: the contract has no status yet."
          : !created.health ? ` No status given: it stays ${current.health} since ${current.asOf}.`
          : latest?.id !== created.id
            ? ` A newer meeting exists: the status stays ${current.health} since ${current.asOf}.`
          : !previous ? ` Status: ${created.health} (the contract's first status).`
          : previous.health === created.health ? ` Status: ${created.health} (unchanged).`
          : ` Status: ${created.health} (was ${previous.health} since ${previous.asOf}).`
        return {
          payload: {
            summary:
              `Meeting on ${created.date}${created.time ? ` at ${created.time}` : ""} for ${card.client ?? clientId}` +
              (engagement ? `, contract ${card.engagementLabel}.` : " (client-level).") +
              status,
            meeting: card,
            previousHealth: previous,
            contractHealth: current,
          },
          documentIds: [created.id],
        }
      })
  )

  server.registerTool(
    "update_meeting",
    {
      title: "Edit Meeting",
      description:
        "Corrects a meeting: 'it was at 11' → time '11:00' (null removes it); 'no, it was yellow' → " +
        "health (null: no status stated; «verde/giallo/rosso» → green/yellow/red); 'it was on the 12th' " +
        "→ date; 'add to the minutes that…' → pass the whole new text (it replaces; the reply returns " +
        "textBefore); 'it was about the Contoso contract' → " +
        "engagementId, among the same client's contracts only (closed ones too), null → the client. " +
        "Take meetingId from log_meeting's or list_meetings' reply. contractHealth in the reply is " +
        "the status of the contract the meeting now belongs to.",
      inputSchema: z.object({
        meetingId: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
        time: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM").nullable().optional(),
        health: z.enum(["green", "yellow", "red"]).nullable().optional(),
        text: z.string().min(1).max(MEETING_TEXT_MAX).optional(),
        engagementId: z.string().min(1).nullable().optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "update_meeting", input, async (userId) => {
        // Kept off the Zod schema for the same reason as update_task's guard.
        const { meetingId, ...fields } = input
        if (Object.values(fields).every((v) => v === undefined)) {
          throw new ToolInputError("Nothing to change: pass date, time, health, text or engagementId.")
        }
        const [meetings, engagements, clients] = await Promise.all([
          db().getMeetings(userId),
          db().getEngagements(userId),
          db().getClients(userId),
        ])
        const meeting = meetings.find((m) => m.id === meetingId)
        if (!meeting) throw new ToolInputError(`No meeting with id ${meetingId}: find it with list_meetings.`)
        // Among the verbale's own client's contracts: another client's misses, listing these.
        const target = fields.engagementId
          ? resolvePreferringActive(
              engagements.filter((e) => e.clientId === meeting.clientId),
              clients,
              fields.engagementId
            )
          : null
        const parsed = updateMeetingSchema.safeParse({
          ...fields,
          engagementId: fields.engagementId === undefined ? undefined : (target?.id ?? null),
        })
        if (!parsed.success) throw new ToolInputError(parsed.error.issues[0].message)
        const next = parsed.data
        if (next.date !== undefined) refuseFutureMeeting(next.date)

        const changes: UpdateMeetingInput = {
          ...(next.date !== undefined && next.date !== meeting.date ? { date: next.date } : {}),
          ...(next.time !== undefined && next.time !== meeting.time ? { time: next.time } : {}),
          ...(next.health !== undefined && next.health !== meeting.health ? { health: next.health } : {}),
          ...(next.text !== undefined && next.text !== meeting.text ? { text: next.text } : {}),
          ...(next.engagementId !== undefined && next.engagementId !== meeting.engagementId
            ? { engagementId: next.engagementId }
            : {}),
        }
        const before = meetingCard(meeting, clients, engagements)
        const header =
          `Meeting on ${meeting.date} (${[before.client ?? meeting.clientId, before.engagementLabel].filter(Boolean).join(", ")})`
        if (Object.keys(changes).length === 0) {
          throw new ToolInputError(`${header} already has these values: nothing to change.`)
        }
        const updated = await db().updateMeeting(userId, meeting.id, changes)
        const changed = [
          "date" in changes ? `date ${updated.date}` : null,
          "time" in changes ? (updated.time ? `time ${updated.time}` : "time removed") : null,
          "health" in changes ? (updated.health ? `status ${updated.health}` : "status removed") : null,
          "text" in changes ? "text replaced" : null,
          "engagementId" in changes ? (target ? `moved to ${engagementLabel(target)}` : "moved to the client") : null,
        ].filter(Boolean)
        const after = meetings.map((m) => (m.id === updated.id ? updated : m))
        return {
          payload: {
            summary: `${header} updated: ${changed.join(", ")}.`,
            meeting: meetingCard(updated, clients, engagements),
            changed: Object.keys(changes),
            // A replace cannot be undone from the audit (it keeps params only), so hand back the old text.
            ...("text" in changes ? { textBefore: meeting.text } : {}),
            contractHealth: updated.engagementId ? stated(healthByContract(after).get(updated.engagementId)) : null,
          },
          documentIds: [updated.id],
        }
      })
  )

  // ─── Cash book ─────────────────────────────────────────────────────────────
  // The company's (SRL) bank accounts, never the owner's personal ones. Each tool
  // follows the web form it stands for (Add Movement, the Costs form, the loan
  // dialog, Check Balance) and replies with the touched account's balance.

  server.registerTool(
    "add_movement",
    {
      title: "Add Movement",
      description:
        "Records money in or out of a company (SRL) bank account that is neither an invoice, a cost nor a " +
        "shareholder loan: a transfer between two company accounts «giroconto 2.500 da Main Bank a Second Bank» " +
        "(kind transfer, account → toAccount: neither income nor a cost); rent and other income «incassato affitto " +
        "stanza 2, 650 su Second Bank» (income, in; counterparty who paid); client money with no invoice in the app, " +
        "such as a platform payout (client_income, in); a tenant's «deposito cauzionale» (deposit_held: in when " +
        "received, out when given back; counterparty says whose, as the owner says it, untranslated, and for a return " +
        "the name get_cash_book's depositsHeld lists); a deposit the company paid (deposit_paid: " +
        "out, in when refunded); VAT paid with an F24 (vat, out); IRES, IRAP, INPS or IRPEF lines of an F24 (tax, out); " +
        "the administrator's net pay (compensation, out); share capital (capital, in). An F24 is one call per line. " +
        "Consulting money from a client is mark_invoice_paid, never income. Costs, stamp duty and fees are " +
        "add_expense, and so is a supplier invoice payment (a withholding on a professional's fee too); shareholder " +
        "loans and their repayment are record_loan. " +
        "direction is required except for a transfer. account is the company account's name, the only one when there " +
        "is one. date defaults to today and is never in the future. costCentre is a free label such as Flat Rental " +
        "(get_cash_book lists those in use). Refuses the same account, day and amount already in the book unless " +
        "force (a genuine second one). " +
        (isModuleOn("rent")
          ? "A tenant's rent is linked to its lease (get_rent lists the ids): leaseId with rentMonth (YYYY-MM, the month it " +
            "covers) and rentPart (rent or contribution) on an income in, one call per part; a deposit_held takes leaseId alone. "
          : "") +
        "Replies with the account's new balance.",
      inputSchema: z.object({
        kind: companyMovementKindSchema.exclude(["supplier_payment"]),
        direction: z.enum(["in", "out"]).optional(),
        amount: z.number().positive().finite(),
        date: dayInput.optional(),
        account: z.string().min(1).optional(),
        toAccount: z.string().min(1).optional(),
        description: z.string().trim().max(300).optional(),
        documentRef: z.string().trim().max(100).optional(),
        costCentre: z.string().trim().max(60).optional(),
        counterparty: z.string().trim().max(100).optional(),
        notes: z.string().trim().max(1000).optional(),
        leaseId: z.string().min(1).max(200).optional(),
        rentMonth: RENT_MONTH.optional(),
        rentPart: z.enum(["rent", "contribution"]).optional(),
        force: z.boolean().optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "add_movement", input, async (userId) => {
        const b = await loadBook(userId)
        const account = resolveCompanyAccount(b.accounts, input.account)
        const transfer = input.kind === "transfer"
        if (transfer !== (input.toAccount !== undefined)) {
          throw new ToolInputError(
            transfer ? "A transfer needs toAccount: the company account the money went to." : "toAccount is for a transfer only (kind transfer)."
          )
        }
        const to = transfer ? resolveCompanyAccount(b.accounts, input.toAccount, "", "toAccount") : null
        if (to?.id === account.id) {
          throw new ToolInputError(`A transfer goes to a different company account from the one it left: both are ${account.name}.`)
        }
        if (!transfer && !input.direction) {
          throw new ToolInputError("Pass direction: in for money into the company account, out for money leaving it.")
        }
        const direction = transfer ? "out" : input.direction!
        // Kept only where Add Movement asks for it: the page's editor would clear it on any other kind.
        const counterparty = (HAS_COUNTERPARTY.has(input.kind) && input.counterparty) || null
        if (input.kind === "deposit_held" && !counterparty) {
          throw new ToolInputError("Say whose deposit it is in counterparty, e.g. Room 2.")
        }
        const day = cashDay(input.date)
        const amount = round2(input.amount)
        if (!input.force) refuseDuplicate(b.rows, account, day, direction === "in" ? amount : -amount)
        // A deposit given back is matched to the one in the book before anything is written: a wrong
        // name would leave the real one held until someone notices and edits the row.
        const deposit = input.kind === "deposit_held" || input.kind === "deposit_paid"
        const backing = (input.kind === "deposit_held" && direction === "out") || (input.kind === "deposit_paid" && direction === "in")
        const open = deposits(b.movements).filter((d) => d.kind === input.kind)
        const whose = (counterparty ?? "Unnamed").toLowerCase()
        const held = open.find((d) => d.counterparty.toLowerCase() === whose)
        if (backing && !held && !input.force) {
          const first = input.kind === "deposit_held" ? "Deposit Received" : "Deposit Paid"
          throw new ToolInputError(
            `No ${input.kind === "deposit_held" ? "deposit held" : "deposit paid"} under "${counterparty ?? "Unnamed"}" in the Cash Book. ` +
              (open.length
                ? `Open: ${open.map((d) => `${d.counterparty} (${eurCents(d.amount)})`).join(", ")}: pass the name as listed. `
                : "None is open. ") +
              `If it began before the book, first add it as ${first} dated before the account's opening date: it counts as a ` +
              "deposit without changing the balance. force: true records it anyway."
          )
        }
        const centre = transfer ? { label: null, isNew: false } : costCentreLabel(input.costCentre, b)
        const lease = await leaseFieldsOf(userId, input.kind, direction, input)

        const label = kindLabel(input.kind, direction)
        const created = await db().createCompanyMovement(
          userId,
          valid(createCompanyMovementSchema, {
            kind: input.kind,
            direction,
            amount,
            date: dateOf(day),
            accountId: account.id,
            toAccountId: to?.id ?? null,
            description: input.description || (to ? `Transfer to ${to.name}` : label),
            documentRef: input.documentRef || null,
            // A transfer belongs to no cost centre.
            project: centre.label,
            counterparty,
            notes: input.notes || null,
            ...lease,
          })
        )
        // Giving back more than the book holds under that name: Add Movement warns as it is typed.
        const overReturn =
          backing && held && amount > held.amount
            ? ` ${held.counterparty}: only ${eurCents(held.amount)} in the Cash Book, less than this. Check the amount and the name.`
            : ""
        const after = await balancesAfter(userId, to ? [account, to] : [account])
        return {
          payload: {
            summary:
              `Recorded: ${label} ${eurCents(amount)} ${to ? `from ${account.name} to ${to.name}` : `${direction === "in" ? "into" : "from"} ${account.name}`} ` +
              `on ${dayLabel(day)}${counterparty ? ` (${counterparty})` : ""}${centreSaid(centre)}.` +
              (transfer ? " Neither income nor a cost: the total of the company accounts stays the same." : "") +
              beforeOpening(account, day, deposit) +
              (to ? beforeOpening(to, day) : "") +
              overReturn +
              ` ${after.text}`,
            movement: {
              id: created.id,
              type: label,
              kind: created.kind,
              direction: created.direction,
              amount: created.amount,
              date: day,
              account: account.name,
              toAccount: to?.name ?? null,
              description: created.description,
              documentRef: created.documentRef,
              costCentre: created.project,
              counterparty: created.counterparty,
              leaseId: created.leaseId ?? null,
              rentMonth: created.rentMonth ?? null,
              rentPart: created.rentPart ?? null,
            },
            balances: after.balances,
          },
          documentIds: [created.id],
        }
      })
  )

  server.registerTool(
    "add_expense",
    {
      title: "Add Company Cost",
      description:
        "Records a company (SRL) cost, once: it counts in the Cash Book and in the Plan. «pagato 1.850 affitto " +
        "da Main Bank» → total 1850, paidFrom Main Bank, category rent. paidFrom is the company account it left (the " +
        "only one when there is one), \"owner\" for the owner's personal card «carta personale» (no company account " +
        "moves: the SRL owes it to the owner), or \"not_paid\" for a supplier's invoice to pay later «fattura " +
        "fornitore» (documentRef required: it shows in You Owe Suppliers). total is what was paid, VAT included; vat " +
        "is only the Italian VAT the company recovers, so pass it only when the receipt shows it, and 0 (the default) " +
        "for reverse charge, foreign suppliers, the owner's rent or a rented flat's costs. Paying a supplier invoice " +
        "already on Costs (Not Paid Yet), all or part of it, a professional's withholding included: pass " +
        "supplierInvoice (its document number or id) and paidFrom the account; it records the payment, never a second " +
        "cost, and never more than is owed. refund true: money a supplier gave back into a company account, never " +
        "with supplierInvoice. " +
        "paysRecurring names the recurring estimate this payment stands for (its description or id, or \"none\"): the " +
        "Plan then counts the payment instead of the estimate that month; when a recurring cost of the same category " +
        "exists and the description does not clearly name it, the call is refused until you say which. category is " +
        "required (not for supplierInvoice): it picks the estimate. A collaborator's invoice, such as recording " +
        "Giulia's invoice for a month: pass collaborator (a name or id from Collaborators; unknown names are refused with the list), which " +
        "sets the category to Collaborators, contract (the one they are on is picked automatically; \"none\" for their " +
        "fixed fee; several need one named) and for_month, YYYY-MM, the month of work it pays (default: the date's " +
        "month). Quarters and the Collaborators page compare it with that month's plan, and the reply says how the " +
        "month stands. " +
        (isModuleOn("rent")
          ? "leaseId makes the cost a rent offset netted against a tenant's lease (get_rent lists the ids) in this one call: " +
            "its month is for_month, the month of rent it offset (default: the date's month); not with a collaborator or " +
            "supplierInvoice. "
          : "") +
        "costCentre is a free label such as Flat Rental " +
        "(get_cash_book lists those in use). " +
        "date defaults to today and is never in the future. Refuses the same " +
        "account, day and amount already in the book unless force.",
      inputSchema: z.object({
        description: z.string().trim().min(1).max(300),
        total: z.number().positive().finite(),
        vat: z.number().min(0).finite().optional(),
        paidFrom: z.string().min(1).optional(),
        category: companyExpenseCategorySchema.optional(),
        date: dayInput.optional(),
        documentRef: z.string().trim().max(100).optional(),
        costCentre: z.string().trim().max(60).optional(),
        notes: z.string().trim().max(500).optional(),
        paysRecurring: z.string().min(1).optional(),
        supplierInvoice: z.string().min(1).optional(),
        collaborator: z.string().trim().min(1).optional(),
        contract: z.string().trim().min(1).optional(),
        for_month: FOR_MONTH.optional(),
        leaseId: z.string().min(1).max(200).optional(),
        refund: z.boolean().optional(),
        force: z.boolean().optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "add_expense", input, async (userId) => {
        // A rent offset: its lease, and the month of rent it offsets (for_month, default the date's month).
        if (input.leaseId !== undefined) {
          await requireRentOffset(
            userId,
            input.leaseId,
            input.collaborator !== undefined || input.contract !== undefined
              ? "A cost is a rent offset or a collaborator's invoice, not both: leave out leaseId, or the collaborator, contract and supplierInvoice."
              : input.supplierInvoice
                ? "A rent offset is a new cost, not a supplier invoice payment: leave out leaseId or supplierInvoice."
                : null,
          )
        } else if (input.collaborator === undefined && (input.contract !== undefined || input.for_month !== undefined)) {
          throw new ToolInputError("contract and for_month belong to a collaborator's invoice: pass collaborator.")
        }
        if (input.collaborator !== undefined && input.supplierInvoice) {
          throw new ToolInputError("A supplier invoice payment is money, not a new cost: set the collaborator on the invoice itself with update_expense.")
        }
        const b = await loadBook(userId)
        const how = input.paidFrom?.trim().toLowerCase()
        const owner = how === "owner"
        const notPaid = how === "not_paid"
        const account = owner || notPaid ? null : resolveCompanyAccount(b.accounts, input.paidFrom, NOT_AN_ACCOUNT, "paidFrom")
        const day = cashDay(input.date)
        const total = round2(input.total)
        const documentRef = input.documentRef || null

        // A payment of a supplier invoice already on Costs: the invoice is the cost, this is the money.
        if (input.supplierInvoice) {
          if (!account) throw new ToolInputError("A supplier invoice payment leaves a company account: pass paidFrom with the account.")
          if (input.refund) {
            throw new ToolInputError(
              "A supplier invoice payment is money out. For money a supplier gave back, leave out supplierInvoice and pass refund: true."
            )
          }
          const bill = resolveSupplierInvoice(b.expenses, b.movements, input.supplierInvoice, total)
          if (!input.force) refuseDuplicate(b.rows, account, day, -total)
          const centre = input.costCentre ? costCentreLabel(input.costCentre, b) : { label: bill.expense.project, isNew: false }
          const created = await db().createCompanyMovement(
            userId,
            valid(createCompanyMovementSchema, {
              kind: "supplier_payment",
              direction: "out",
              amount: total,
              date: dateOf(day),
              accountId: account.id,
              expenseId: bill.expense.id,
              description: input.description,
              documentRef: documentRef ?? bill.expense.documentRef,
              project: centre.label,
              notes: input.notes || null,
            })
          )
          const owed = round2(bill.owed - total)
          const after = await balancesAfter(userId, [account])
          return {
            payload: {
              summary:
                `Supplier Invoice Payment ${eurCents(total)} from ${account.name} on ${dayLabel(day)}: ${bill.expense.documentRef}, ` +
                `${eurCents(owed)} still owed of ${eurCents(bill.total)}${centreSaid(centre)}. The invoice is the cost: this is the money.` +
                beforeOpening(account, day) +
                ` ${after.text}`,
              payment: { id: created.id, supplierInvoice: bill.expense.documentRef, amount: total, date: day, account: account.name, owed },
              balances: after.balances,
            },
            documentIds: [created.id],
          }
        }

        if (input.refund && !account) {
          throw new ToolInputError("A refund is money back into a company account: pass paidFrom with the account.")
        }
        if (notPaid && !documentRef) {
          throw new ToolInputError("A cost not paid yet is a supplier invoice: pass documentRef, its number, so You Owe Suppliers shows it.")
        }
        const vat = round2(input.vat ?? 0)
        if (vat >= total) throw new ToolInputError("vat is part of total, so less than it: pass the total paid, VAT included.")
        const same = documentRef?.toLowerCase()
        const bill = same && supplierDocuments(b.expenses, b.movements).docs.find((d) => d.expense.documentRef?.trim().toLowerCase() === same)
        if (bill && !input.force) {
          throw new ToolInputError(
            `Supplier invoice "${bill.expense.documentRef}" is already on Costs (${bill.expense.description}, ${eurCents(bill.owed)} ` +
              `still owed). To record paying it, pass supplierInvoice "${bill.expense.documentRef}"; if this is another cost, pass force: true.`
          )
        }
        const link =
          input.collaborator === undefined
            ? null
            : await invoiceLink(userId, b, { collaborator: input.collaborator, contract: input.contract, forMonth: input.for_month ?? day.slice(0, 7) })
        // Required: a guessed category would hide the estimate this cost pays, and the Plan would count both.
        const category = link ? ("collaborators" as const) : input.category
        if (category === "collaborators" && !link) throw new ToolInputError(NEEDS_COLLABORATOR)
        if (!category) {
          throw new ToolInputError(
            `Pass category: ${companyExpenseCategorySchema.options.join(", ")}. It picks the recurring estimate this cost stands ` +
              "for."
          )
        }
        // The Costs form's rule: a cost takes the one estimate it clearly pays, and an unclear one is asked.
        const estimates = b.expenses.filter((e) => e.isRecurring)
        const asked = input.paysRecurring?.trim().toLowerCase()
        const suggestion = pickEstimate({ category, description: input.description }, estimates)
        if (!input.refund && asked === undefined && !suggestion.picked && suggestion.candidates.length > 0) {
          throw new ToolInputError(
            `Does it pay ${suggestion.candidates.map((e) => `"${e.description}" (${eurCents(e.amount)} a period)`).join(" or ")}? ` +
              'Pass paysRecurring with its description, or "none": otherwise the Plan counts both the estimate and this cost.'
          )
        }
        const estimate =
          input.refund || asked === "none"
            ? null
            : input.paysRecurring
              ? resolveEstimate(estimates, input.paysRecurring)
              : suggestion.picked
        if (!input.force && account) refuseDuplicate(b.rows, account, day, input.refund ? total : -total)
        const centre = costCentreLabel(input.costCentre, b)
        // No account moved: the same card cost, or the same unpaid invoice, on the same day.
        const twin =
          !input.force &&
          !account &&
          b.expenses.find(
            (e) =>
              !e.isRecurring && e.accountId === null && e.paidByOwner === owner && isoDate(e.date) === day &&
              round2(e.amount + (e.vat ?? 0)) === total
          )
        if (twin) {
          throw new ToolInputError(
            `Already on Costs: "${twin.description}", ${eurCents(total)} on ${dayLabel(day)} (expense ${twin.id}). ` +
              "Pass force: true if it really is a second one."
          )
        }

        const sign = input.refund ? -1 : 1
        const created = await db().createCompanyExpense(
          userId,
          valid(createCompanyExpenseSchema, {
            description: input.description,
            category,
            amount: round2(sign * (total - vat)),
            // `+ 0`: a refund with no VAT stores 0, not -0, as the web does.
            vat: round2(sign * vat) + 0,
            date: dateOf(day),
            isRecurring: false,
            accountId: account?.id ?? null,
            paidByOwner: owner,
            recurringExpenseId: estimate?.id ?? null,
            documentRef,
            project: centre.label,
            notes: input.notes || null,
            collaboratorId: link?.c.id ?? null,
            engagementId: link?.engagementId ?? null,
            forMonth: link?.forMonth ?? (input.leaseId ? (input.for_month ?? day.slice(0, 7)) : null),
            ...(input.leaseId ? { leaseId: input.leaseId } : {}),
          })
        )
        const what = `${COST_CATEGORY_LABELS[category]} ${eurCents(total)}${vat > 0 ? ` (VAT ${eurCents(vat)})` : ""}`
        const said = centreSaid(centre)
        const plan = estimate
          ? ` The Plan counts it for ${formatYearMonth(day.slice(0, 7))} instead of the estimate "${estimate.description}".`
          : ""
        const chase =
          (account || owner) && !input.refund && !documentRef && category !== "bank_fees"
            ? " No document: it shows in To Chase until the invoice or receipt number is added."
            : ""
        let outcome: string
        let balances: Record<string, number | null> | undefined
        if (account) {
          const after = await balancesAfter(userId, [account])
          balances = after.balances
          outcome =
            (input.refund
              ? `Refund recorded: ${what} back into ${account.name} on ${dayLabel(day)}${said}: it lowers the costs.`
              : `Cost recorded: ${what} from ${account.name} on ${dayLabel(day)}${said}.`) +
            plan + chase + beforeOpening(account, day) + ` ${after.text}`
        } else if (owner) {
          const owes = ownerLoanBalance(b.loans, [...b.expenses, created]).total
          outcome =
            `Cost recorded: ${what} paid with your personal card on ${dayLabel(day)}${said}: no company account moved. ` +
            `The SRL now owes you ${eurCents(Math.max(0, owes))}.` + plan + chase
        } else {
          const owed = supplierDocuments([...b.expenses, created], b.movements).owed
          outcome =
            `Supplier invoice ${documentRef} recorded: ${what} on ${dayLabel(day)}${said}, owed to the supplier ` +
            `(You Owe Suppliers ${eurCents(owed)}). Record paying it with add_expense supplierInvoice "${documentRef}".` + plan
        }
        if (created.leaseId && created.forMonth) {
          outcome += ` It offsets the rent for ${formatYearMonth(created.forMonth)} on lease ${created.leaseId}.`
        }
        if (link) {
          outcome += ` ${invoicedLine(link.c, { assignments: link.assignments, timecards: link.timecards, expenses: [...b.expenses, created], yearMonth: link.forMonth })}`
        }
        return {
          payload: {
            summary: outcome,
            cost: {
              id: created.id,
              description: created.description,
              category: created.category,
              total,
              vat,
              amountNetOfVat: Math.abs(created.amount),
              date: day,
              paidFrom: account?.name ?? (owner ? "owner" : "not_paid"),
              refund: input.refund ?? false,
              documentRef: created.documentRef,
              costCentre: created.project,
              paysRecurring: estimate?.description ?? null,
              ...(link ? { collaborator: link.c.name, contract: link.contract, forMonth: link.forMonth } : {}),
              ...(created.leaseId ? { leaseId: created.leaseId, forMonth: created.forMonth } : {}),
            },
            ...(balances ? { balances } : {}),
          },
          documentIds: [created.id],
        }
      })
  )

  server.registerTool(
    "record_loan",
    {
      title: "Record Shareholder Loan",
      description:
        "Records a shareholder loan through a company (SRL) bank account: the owner lends the SRL money " +
        "«finanziamento soci» (direction to_company, money into the account), or the SRL pays the owner back " +
        "«la società mi ha rimborsato» (direction from_company, money out of it). Never a withdrawal: money to the " +
        "owner is a loan repayment, administrator pay (add_movement kind compensation) or an expense refund. A " +
        "repayment may also settle costs the owner paid with the personal card: the SRL owes those too. Replies with " +
        "what the SRL owes the owner after it, and warns when a repayment goes past it. account is the company " +
        "account (the only one when there is one); date defaults to today. Refuses the same account, day and amount " +
        "already in the book unless force (two equal loans on one day).",
      inputSchema: z.object({
        direction: z.enum(["to_company", "from_company"]),
        amount: z.number().positive().finite(),
        date: dayInput.optional(),
        account: z.string().min(1).optional(),
        description: z.string().trim().max(300).optional(),
        notes: z.string().trim().max(500).optional(),
        force: z.boolean().optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "record_loan", input, async (userId) => {
        const b = await loadBook(userId)
        const account = resolveCompanyAccount(b.accounts, input.account)
        const day = cashDay(input.date)
        const amount = round2(input.amount)
        const lending = input.direction === "to_company"
        if (!input.force) refuseDuplicate(b.rows, account, day, lending ? amount : -amount)
        const before = ownerLoanBalance(b.loans, b.expenses).total
        const created = await db().createCompanyLoan(
          userId,
          valid(createCompanyLoanSchema, {
            description: input.description || (lending ? "Shareholder Loan" : "Shareholder Loan Repayment"),
            direction: input.direction,
            amount,
            date: dateOf(day),
            accountId: account.id,
            notes: input.notes || null,
          })
        )
        const owes = round2(before + (lending ? amount : -amount))
        const after = await balancesAfter(userId, [account])
        return {
          payload: {
            summary:
              (lending
                ? `Shareholder loan recorded: you lent the SRL ${eurCents(amount)} into ${account.name} on ${dayLabel(day)}.`
                : `Shareholder loan repayment recorded: the SRL paid you back ${eurCents(amount)} from ${account.name} on ${dayLabel(day)}.`) +
              (owes < 0
                ? ` That is more than it owed you (${eurCents(Math.max(0, before))}): the SRL has now paid you ${eurCents(-owes)} more ` +
                  "than it owed, which an SRL can't do. Check the amount."
                : ` The SRL owes you ${eurCents(owes)}.`) +
              beforeOpening(account, day) +
              ` ${after.text}`,
            loan: { id: created.id, direction: created.direction, amount, date: day, account: account.name, description: created.description },
            srlOwesYou: owes,
            balances: after.balances,
          },
          documentIds: [created.id],
        }
      })
  )

  server.registerTool(
    "check_balance",
    {
      title: "Check Balance",
      description:
        "Checks a company (SRL) bank account against the bank: «Main Bank oggi 12.400» → account Main Bank, balance " +
        "12400. Compares the bank's balance with the Cash Book at the end of the same day and answers as the Cash " +
        "Book page does, \"Matches the bank\" or \"Missing IN/OUT of €x\", listing the rows since the last check when " +
        "they differ. Saves it as the account's last check «estratto conto», unless the account already has a later " +
        "one (then it only compares). date defaults to today.",
      inputSchema: z.object({
        balance: z.number().finite(),
        account: z.string().min(1).optional(),
        date: dayInput.optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "check_balance", input, async (userId) => {
        const b = await loadBook(userId)
        const account = resolveCompanyAccount(b.accounts, input.account)
        const day = cashDay(input.date)
        const bank = round2(input.balance)
        const check = checkAgainst(account, b.counted, bank, day)
        // Check Balance's rule: an earlier day than the last check is compared, never saved over it.
        const newer = account.statementDate && isoDate(account.statementDate) > day ? isoDate(account.statementDate) : null
        const { rows, since } = check.status === "matches" ? { rows: [], since: "" } : rowsSinceCheck(account, b.counted, day)
        if (!newer) {
          await db().updateCompanyAccount(userId, account.id, { statementBalance: bank, statementDate: dateOf(day) })
        }
        const detail = checkDetail(check, eurCents)
        const shown = rows.slice(-20)
        return {
          payload: {
            summary:
              `${account.name}: ${statementLabel(check, eurCents)}. ` +
              `Cash Book at the end of ${dayLabel(day)}: ${eurCents(check.book)} · Bank: ${eurCents(bank)}.` +
              (detail ? ` ${detail}` : "") +
              (rows.length ? ` ${plural(rows.length, "row", "rows")} ${since}${rows.length > shown.length ? `, the last ${shown.length} listed` : ""}.` : "") +
              (newer ? ` Not saved: the ${dayLabel(newer)} check is newer.` : " Saved as the company account's last check."),
            check,
            saved: !newer,
            rows: shown.map((r) => ({
              date: r.day,
              type: rowTypeLabel(r),
              description: r.description,
              amount: r.delta,
              source: r.source,
              id: r.sourceId,
            })),
          },
          documentIds: newer ? [] : [account.id],
        }
      })
  )

  // ─── Cash book: edit and delete ────────────────────────────────────────────
  // Each follows the page's own editor (Edit Movement, the Costs form, the loan
  // dialog): the same fields, the same guards, and the merged entry parsed with
  // the shared schema. Preview, then confirm (previewOrApply).

  server.registerTool(
    "update_movement",
    {
      title: "Edit Movement",
      description:
        "Corrects a movement in the company (SRL) Cash Book by id (get_cash_book lists each row's source and id): " +
        "«correggi il giroconto del 3/10: erano 2.000» → amount 2000. Pass only what changes, as Edit Movement on the " +
        "Cash Book page takes it: kind (a transfer stays a transfer, and no other movement becomes one), direction, " +
        "amount, date (never in the future; a changed date is no longer estimated), account, toAccount (a transfer, " +
        "which stays between two different company accounts), description, " +
        "documentRef, costCentre, counterparty (rent and other income and deposits only), notes; \"\" clears a text. " +
        "supplierInvoice (document number or id) is the supplier invoice a supplier_payment pays, never more than is still " +
        "owed on it. " +
        (isModuleOn("rent")
          ? "leaseId links the movement to a tenant's lease (get_rent lists the ids; \"none\" unlinks it): an income in " +
            "needs rentMonth (YYYY-MM) and rentPart (rent or contribution) too, a deposit_held takes the lease alone, and a " +
            "new kind or a new direction on an income unlinks it unless the same call links it again. "
          : "") +
        "Costs are update_expense, shareholder loans update_loan, and invoices update_invoice. " +
        "An imported row can be edited: the preview says what it means for " +
        "Undo Import. " +
        CONFIRM_RULE,
      inputSchema: z.object({
        id: z.string().min(1),
        kind: companyMovementKindSchema.optional(),
        direction: z.enum(["in", "out"]).optional(),
        amount: z.number().positive().finite().optional(),
        date: dayInput.optional(),
        account: z.string().min(1).optional(),
        toAccount: z.string().min(1).optional(),
        description: z.string().trim().max(300).optional(),
        documentRef: z.string().trim().max(100).optional(),
        costCentre: z.string().trim().max(60).optional(),
        counterparty: z.string().trim().max(100).optional(),
        notes: z.string().trim().max(1000).optional(),
        supplierInvoice: z.string().min(1).optional(),
        leaseId: z.string().min(1).max(200).optional(),
        rentMonth: RENT_MONTH.optional(),
        rentPart: z.enum(["rent", "contribution"]).optional(),
        confirm: confirmInput,
      }),
    },
    async (input, ctx) =>
      audited(
        ctx,
        "update_movement",
        input,
        async (userId) => {
          const { id, confirm, ...changes } = input
          if (Object.values(changes).every((v) => v === undefined)) {
            throw new ToolInputError(
              "Nothing to change: pass kind, direction, amount, date, account, toAccount, description, documentRef, costCentre, counterparty, notes, supplierInvoice, leaseId, rentMonth or rentPart.",
            )
          }
          const b = await loadBook(userId)
          const m = entryOf(b.movements, b, id, "movement")
          const kind = input.kind ?? m.kind
          const transfer = kind === "transfer"
          // Edit Movement locks the direction across the transfer line: one side never becomes the other.
          if (transfer !== (m.kind === "transfer")) {
            throw new ToolInputError(
              m.kind === "transfer"
                ? "A transfer stays a transfer, as in Edit Movement: delete it with delete_movement and add the right movement with add_movement."
                : "A movement can't become a transfer, as in Edit Movement: delete it with delete_movement and add the transfer with add_movement.",
            )
          }
          const accountId = input.account ? resolveCompanyAccount(b.accounts, input.account).id : m.accountId
          if (input.toAccount !== undefined && !transfer) throw new ToolInputError("toAccount is for a transfer only (kind transfer).")
          const toAccountId = transfer
            ? input.toAccount
              ? resolveCompanyAccount(b.accounts, input.toAccount, "", "toAccount").id
              : m.toAccountId
            : null
          if (transfer && !toAccountId) throw new ToolInputError("A transfer needs toAccount: the company account the money went to.")
          if (transfer && toAccountId === accountId) {
            throw new ToolInputError(
              `A transfer goes to a different company account from the one it left: both are ${accountName(b.accounts, accountId)}.`,
            )
          }
          const direction = transfer ? "out" : (input.direction ?? m.direction)
          const day = input.date ? cashDay(input.date) : isoDate(m.date)
          const amount = input.amount !== undefined ? round2(input.amount) : m.amount
          // Kept only where Edit Movement asks for it: the page clears it on any other kind.
          const counterparty = HAS_COUNTERPARTY.has(kind) ? textOr(input.counterparty, m.counterparty) : null
          if (kind === "deposit_held" && !counterparty) throw new ToolInputError("Say whose deposit it is in counterparty, e.g. Room 2.")

          // Only income (a payment, money in) and a deposit carry a lease, each on its own terms: a new kind, or income turned
          // to money out, unlinks it, as the page does, unless this call links one. "none" unlinks.
          const unlink = input.leaseId === "none"
          if (unlink && (input.rentMonth || input.rentPart)) throw new ToolInputError('leaseId "none" unlinks: leave out rentMonth and rentPart.')
          const kept = kind === m.kind && !unlink && (kind !== "income" || direction === m.direction)
          const asked = input.leaseId !== undefined || input.rentMonth !== undefined || input.rentPart !== undefined
          if (asked && !isModuleOn("rent")) throw new ToolInputError(RENT_OFF)
          const lease =
            !asked && kept
              ? {}
              : await leaseFieldsOf(userId, kind, direction, {
                  leaseId: unlink ? null : (input.leaseId ?? (kept ? m.leaseId : null)),
                  rentMonth: input.rentMonth ?? (kept ? m.rentMonth : null),
                  rentPart: input.rentPart ?? (kept ? m.rentPart : null),
                })

          // A supplier invoice payment names its invoice, and never pays more than is owed besides itself.
          const others = b.movements.filter((x) => x.id !== m.id)
          let expenseId: string | null = null
          if (kind === "supplier_payment") {
            if (input.supplierInvoice) {
              expenseId = resolveSupplierInvoice(b.expenses, others, input.supplierInvoice, direction === "out" ? amount : 0).expense.id
            } else if (m.kind === "supplier_payment" && m.expenseId) {
              expenseId = m.expenseId
              const bill = supplierDocuments(b.expenses, others).docs.find((d) => d.expense.id === expenseId)
              if (bill && direction === "out" && amount > bill.owed) {
                throw new ToolInputError(
                  `Only ${eurCents(bill.owed)} is owed on ${bill.expense.documentRef} besides this payment. Record anything more as a cost with add_expense.`,
                )
              }
            } else {
              throw new ToolInputError("A supplier invoice payment names the supplier invoice it pays: pass supplierInvoice, its document number or id.")
            }
          } else if (input.supplierInvoice) {
            throw new ToolInputError("supplierInvoice is for a supplier invoice payment only (kind supplier_payment).")
          }

          const centre = transfer
            ? { label: null, isNew: false }
            : input.costCentre !== undefined
              ? costCentreLabel(input.costCentre, b)
              : { label: m.project, isNew: false }
          const to = b.accounts.find((a) => a.id === toAccountId)
          // A description still reading as its type's default follows the type: "Transfer to Second Bank" never outlives the transfer.
          const typed = (k: CompanyMovement["kind"], d: "in" | "out", toId: string | null) =>
            k === "transfer" ? `Transfer to ${accountName(b.accounts, toId)}` : kindLabel(k, d)
          const set = valid(createCompanyMovementSchema, {
            kind,
            direction,
            amount,
            date: dateOf(day),
            accountId,
            toAccountId,
            expenseId,
            description:
              (input.description ?? (m.description === typed(m.kind, m.direction, m.toAccountId) ? "" : m.description)) ||
              typed(kind, direction, to?.id ?? null),
            documentRef: textOr(input.documentRef, m.documentRef),
            project: centre.label,
            counterparty,
            notes: textOr(input.notes, m.notes),
            // Any date edit makes the day a real one, as on the page.
            ...(day !== isoDate(m.date) ? { dateEstimated: false } : {}),
            ...lease,
          })
          const updated: CompanyMovement = { ...m, ...set }
          const after = { ...b, movements: [...others, updated] }
          const months = planMonths([m, updated], [])
          const today = isoDate(new Date())

          // Giving back more than the book holds under that name: the page warns as it is typed.
          const backing = (kind === "deposit_held" && direction === "out") || (kind === "deposit_paid" && direction === "in")
          const held = deposits(others).find((d) => d.kind === kind && d.counterparty.toLowerCase() === (counterparty ?? "Unnamed").toLowerCase())
          const deposit = kind === "deposit_held" || kind === "deposit_paid"
          const notes = [
            backing && amount > (held?.amount ?? 0)
              ? `${counterparty ?? "Unnamed"}: only ${eurCents(held?.amount ?? 0)} held in the Cash Book besides this row, less than this. Check the amount and the name.`
              : null,
            ...accountsOf(b.accounts, [accountId, toAccountId]).map((a) => beforeOpening(a, day, deposit).trim() || null),
            centre.isNew ? `${centre.label} is a new cost centre.` : null,
            importNote(m.importRef, false),
          ].filter((n): n is string => n !== null)
          return previewOrApply(userId, confirm, {
            action: `edit ${movementLine(m, b.accounts)} → ${movementLine(updated, b.accounts)}`,
            done: `Updated: ${movementLine(updated, b.accounts)}`,
            before: movementCard(m, b),
            after: movementCard(updated, b),
            figures: figureChanges(bookFigures(b, months, today), bookFigures(after, months, today)),
            notes,
            touched: accountsOf(b.accounts, [m.accountId, m.toAccountId, accountId, toAccountId]),
            id: m.id,
            write: () => db().updateCompanyMovement(userId, m.id, set),
          })
        },
        !input.confirm,
      )
  )

  server.registerTool(
    "delete_movement",
    {
      title: "Delete Movement",
      description:
        "Deletes a movement from the company (SRL) Cash Book by id (get_cash_book lists each row's source and id): " +
        "«elimina il movimento del 3/10». For a row entered twice or by mistake; one that is only wrong is " +
        "update_movement. A supplier invoice payment deleted puts what it paid back into You Owe Suppliers. Costs are " +
        "delete_expense, shareholder loans delete_loan, and invoices delete_invoice. " +
        "An imported row can be deleted: the preview says what it means for Undo Import. " +
        CONFIRM_RULE,
      inputSchema: z.object({ id: z.string().min(1), confirm: confirmInput }),
    },
    async (input, ctx) =>
      audited(
        ctx,
        "delete_movement",
        input,
        async (userId) => {
          const b = await loadBook(userId)
          const m = entryOf(b.movements, b, input.id, "movement")
          const after = { ...b, movements: b.movements.filter((x) => x.id !== m.id) }
          const months = planMonths([m], [])
          const today = isoDate(new Date())
          return previewOrApply(userId, input.confirm, {
            action: `delete ${movementLine(m, b.accounts)}`,
            done: `Deleted: ${movementLine(m, b.accounts)}`,
            before: movementCard(m, b),
            after: null,
            figures: figureChanges(bookFigures(b, months, today), bookFigures(after, months, today)),
            notes: [importNote(m.importRef, true)].filter((n): n is string => n !== null),
            touched: accountsOf(b.accounts, [m.accountId, m.toAccountId]),
            id: m.id,
            write: () => db().deleteCompanyMovement(userId, m.id),
          })
        },
        !input.confirm,
      )
  )

  server.registerTool(
    "update_expense",
    {
      title: "Edit Company Cost",
      description:
        "Corrects a one-off company (SRL) cost by id, a supplier invoice or a cost paid with the owner's card too " +
        "(get_cash_book lists its id in rows or otherEntries): «correggi l'affitto di ottobre: era 1.900» → total 1900. " +
        "Pass only what changes, as the Costs form takes it: description, category, total (paid, VAT included), vat (the " +
        "recoverable VAT inside total), date (never in the future; a changed date is no longer estimated), paidFrom (a " +
        "company account, \"owner\" for the personal card, \"not_paid\" for a supplier invoice), refund (money back into a " +
        "company account), documentRef, costCentre, notes (\"\" clears a text), paysRecurring (the recurring estimate it " +
        "stands for, or \"none\"), and a collaborator's invoice: collaborator «sposta la fattura di Giulia a settembre» " +
        "(a name or id; \"none\" clears the link), contract (\"none\" for their fixed fee) and for_month (YYYY-MM, the " +
        "month of work it pays), as add_expense takes them; the reply says how that month stands. " +
        (isModuleOn("rent")
          ? "leaseId makes the cost a rent offset netted against a tenant's lease (get_rent lists the ids; \"none\" unlinks " +
            "it): its month is for_month, the month of rent it offsets; linking a collaborator's invoice unlinks the lease. "
          : "") +
        "A supplier invoice with payments recorded against it stays one: it can't move to an " +
        "account or the card, lose its document or become a refund until those payments are deleted (delete_movement). " +
        "The preview says what moves in the balances, You Owe Suppliers, SRL Owes You and the Plan. Recurring estimates " +
        "are edited on Costs in the web app. " +
        CONFIRM_RULE,
      inputSchema: z.object({
        id: z.string().min(1),
        description: z.string().trim().min(1).max(300).optional(),
        category: companyExpenseCategorySchema.optional(),
        total: z.number().positive().finite().optional(),
        vat: z.number().min(0).finite().optional(),
        date: dayInput.optional(),
        paidFrom: z.string().min(1).optional(),
        refund: z.boolean().optional(),
        documentRef: z.string().trim().max(100).optional(),
        costCentre: z.string().trim().max(60).optional(),
        notes: z.string().trim().max(500).optional(),
        paysRecurring: z.string().min(1).optional(),
        collaborator: z.string().trim().min(1).optional(),
        contract: z.string().trim().min(1).optional(),
        for_month: FOR_MONTH.optional(),
        leaseId: z.string().min(1).max(200).optional(),
        confirm: confirmInput,
      }),
    },
    async (input, ctx) =>
      audited(
        ctx,
        "update_expense",
        input,
        async (userId) => {
          const { id, confirm, ...changes } = input
          if (Object.values(changes).every((v) => v === undefined)) {
            throw new ToolInputError(
              "Nothing to change: pass description, category, total, vat, date, paidFrom, refund, documentRef, costCentre, notes, paysRecurring, collaborator, contract, for_month or leaseId.",
            )
          }
          const b = await loadBook(userId)
          const all = (await loadCollaborators(userId)).collaborators
          const e = entryOf(b.expenses, b, id, "expense")
          if (e.isRecurring) {
            throw new ToolInputError(`"${e.description}" is a recurring estimate in the Plan, not a Cash Book entry: edit it on Costs in the web app.`)
          }
          const how = input.paidFrom?.trim().toLowerCase()
          const owner = how === undefined ? e.paidByOwner : how === "owner"
          const accountId =
            how === undefined
              ? e.accountId
              : how === "owner" || how === "not_paid"
                ? null
                : resolveCompanyAccount(b.accounts, input.paidFrom, NOT_AN_ACCOUNT, "paidFrom").id
          const refund = input.refund ?? (e.amount < 0 && accountId !== null)
          if (refund && !accountId) throw new ToolInputError("A refund is money back into a company account: pass paidFrom with the account.")
          const sign = refund ? -1 : 1
          // Not stated (written before costs had VAT): kept so unless given.
          const vat = input.vat !== undefined ? round2(input.vat) : e.vat === null ? null : Math.abs(e.vat)
          const total = input.total !== undefined ? round2(input.total) : costTotal(e)
          if ((vat ?? 0) >= total) throw new ToolInputError("vat is part of total, so less than it: pass the total paid, VAT included.")
          const day = input.date ? cashDay(input.date) : isoDate(e.date)
          const asked = input.paysRecurring?.trim().toLowerCase()
          const estimates = b.expenses.filter((x) => x.isRecurring)
          // A refund pays no estimate: it lowers the costs.
          const recurringExpenseId = refund
            ? null
            : input.paysRecurring === undefined
              ? e.recurringExpenseId
              : asked === "none"
                ? null
                : resolveEstimate(estimates, input.paysRecurring).id
          const centre = input.costCentre !== undefined ? costCentreLabel(input.costCentre, b) : { label: e.project, isNew: false }
          // The collaborator link: left alone, set or moved (the contract follows a new collaborator), or cleared with "none".
          const clearing = input.collaborator?.trim().toLowerCase() === "none"
          let link: Awaited<ReturnType<typeof invoiceLink>> | null = null
          let linked = { collaboratorId: e.collaboratorId, engagementId: e.engagementId, forMonth: e.forMonth }
          // A rent offset: its lease and the month of rent it offsets (for_month). "none" unlinks the lease.
          if (input.leaseId !== undefined && !isModuleOn("rent")) throw new ToolInputError(RENT_OFF)
          const unleasing = input.leaseId === "none"
          const leaseId = unleasing ? null : (input.leaseId ?? e.leaseId ?? null)
          const rentOffset = leaseId !== null && !clearing && input.collaborator === undefined && input.contract === undefined
          if (input.leaseId !== undefined && !unleasing) {
            await requireRentOffset(
              userId,
              input.leaseId,
              input.collaborator !== undefined || input.contract !== undefined || !!e.collaboratorId
                ? "A cost is a rent offset or a collaborator's invoice, not both: clear the collaborator first (collaborator \"none\")."
                : null,
            )
          }
          if (rentOffset && (input.leaseId !== undefined || input.for_month !== undefined)) {
            const month = input.for_month ?? e.forMonth
            if (!month) throw new ToolInputError("A rent offset names the month of rent it offsets: pass for_month (YYYY-MM).")
            linked = { collaboratorId: null, engagementId: null, forMonth: month }
          } else if (unleasing && e.leaseId && input.collaborator === undefined && input.contract === undefined && input.for_month === undefined) {
            linked = { ...linked, forMonth: null }
          } else if (clearing) {
            if (input.contract !== undefined || input.for_month !== undefined) {
              throw new ToolInputError('collaborator "none" clears the link: leave out contract and for_month.')
            }
            linked = { collaboratorId: null, engagementId: null, forMonth: null }
          } else if (input.collaborator !== undefined || input.contract !== undefined || input.for_month !== undefined) {
            const who = input.collaborator ?? all.find((c) => c.id === e.collaboratorId)?.id
            if (who === undefined) {
              throw new ToolInputError(
                e.collaboratorId
                  ? "The collaborator on this cost no longer exists: pass collaborator with another name."
                  : "This cost has no collaborator: pass collaborator with their name.",
              )
            }
            const changed = input.collaborator !== undefined && resolveCollaborator(all, who).id !== e.collaboratorId
            link = await invoiceLink(userId, b, {
              collaborator: who,
              contract: input.contract,
              // Same collaborator, no contract named: the stored one stays, even if the assignment is gone since.
              keep: changed || input.contract !== undefined ? undefined : e.engagementId,
              forMonth: input.for_month ?? (changed || !e.forMonth || e.forMonth === isoDate(e.date).slice(0, 7) ? day.slice(0, 7) : e.forMonth),
            })
            linked = { collaboratorId: link.c.id, engagementId: link.engagementId, forMonth: link.forMonth }
          } else if (e.forMonth && !e.leaseId && e.forMonth === isoDate(e.date).slice(0, 7)) {
            // For Month still follows the date: nobody moved it by hand. A rent offset's month is the rent's, so it stays.
            linked = { ...linked, forMonth: day.slice(0, 7) }
          }
          const finalCategory = link ? "collaborators" : (input.category ?? e.category)
          if (finalCategory === "collaborators" && !linked.collaboratorId) {
            throw new ToolInputError(`${NEEDS_COLLABORATOR.slice(0, -1)}, or a new category.`)
          }
          const set = valid(createCompanyExpenseSchema, {
            description: input.description ?? e.description,
            category: finalCategory,
            amount: round2(sign * (total - (vat ?? 0))),
            // `+ 0`: a refund with no VAT stores 0, not -0, as the web does.
            vat: vat === null ? null : round2(sign * vat) + 0,
            date: dateOf(day),
            isRecurring: false,
            accountId,
            paidByOwner: accountId === null && owner,
            recurringExpenseId,
            documentRef: textOr(input.documentRef, e.documentRef),
            project: centre.label,
            notes: textOr(input.notes, e.notes),
            ...linked,
            // Linking a collaborator's invoice unlinks the lease, as the page does.
            ...(input.leaseId !== undefined ? { leaseId } : link && e.leaseId ? { leaseId: null } : {}),
            ...(day !== isoDate(e.date) ? { dateEstimated: false } : {}),
          })
          // The page's guard (BILL_HAS_PAYMENTS): a supplier invoice paid in the Cash Book stays one.
          const payments = b.movements.filter((m) => m.expenseId === e.id)
          if (payments.length > 0 && leavesSupplierDocument(set)) {
            throw new ToolInputError(
              `${BILL_HAS_PAYMENTS} Its payments: ${payments.map((m) => `${movementLine(m, b.accounts)} (movement ${m.id})`).join("; ")}.`,
            )
          }
          const updated: CompanyExpense = { ...e, ...set }
          const after = { ...b, expenses: b.expenses.map((x) => (x.id === e.id ? updated : x)) }
          const months = planMonths([e, updated], b.expenses)
          const today = isoDate(new Date())
          const account = b.accounts.find((a) => a.id === accountId)
          const notes = [
            (accountId || updated.paidByOwner) && !refund && !updated.documentRef && updated.category !== "bank_fees"
              ? "No document: it shows in To Chase until the invoice or receipt number is added."
              : null,
            account ? beforeOpening(account, day).trim() || null : null,
            centre.isNew ? `${centre.label} is a new cost centre.` : null,
            link ? invoicedLine(link.c, { assignments: link.assignments, timecards: link.timecards, expenses: after.expenses, yearMonth: link.forMonth }) : null,
            overpaidNote(b.loans, after.expenses),
            importNote(e.importRef, false),
          ].filter((n): n is string => n !== null)
          return previewOrApply(userId, confirm, {
            action: `edit ${costLine(e, b.accounts)} → ${costLine(updated, b.accounts)}`,
            done: `Updated: ${costLine(updated, b.accounts)}`,
            before: costCard(e, b, all),
            after: costCard(updated, b, all),
            figures: figureChanges(bookFigures(b, months, today), bookFigures(after, months, today)),
            notes,
            touched: accountsOf(b.accounts, [e.accountId, accountId]),
            id: e.id,
            write: () => db().updateCompanyExpense(userId, e.id, set),
          })
        },
        !input.confirm,
      )
  )

  server.registerTool(
    "delete_expense",
    {
      title: "Delete Company Cost",
      description:
        "Deletes a one-off company (SRL) cost by id: a cost paid from a company account, a refund, a supplier invoice, " +
        "a cost paid with the owner's card, or the bank fee booked with an invoice's payment (get_cash_book lists its id " +
        "in rows or otherEntries): «cancella la spesa doppia del 5/10». A supplier invoice with payments recorded against " +
        "it is refused until those payments are deleted (delete_movement), as on the web. The preview says what moves in " +
        "the balances, You Owe Suppliers, SRL Owes You and the Plan (a payment that stood for a recurring estimate gives " +
        "the month back to it). Recurring estimates are deleted on Costs in the web app. " +
        CONFIRM_RULE,
      inputSchema: z.object({ id: z.string().min(1), confirm: confirmInput }),
    },
    async (input, ctx) =>
      audited(
        ctx,
        "delete_expense",
        input,
        async (userId) => {
          const b = await loadBook(userId)
          const e = entryOf(b.expenses, b, input.id, "expense")
          if (e.isRecurring) {
            throw new ToolInputError(`"${e.description}" is a recurring estimate in the Plan, not a Cash Book entry: delete it on Costs in the web app.`)
          }
          const payments = b.movements.filter((m) => m.expenseId === e.id)
          if (payments.length > 0) {
            throw new ToolInputError(
              `${BILL_HAS_PAYMENTS} Its payments: ${payments.map((m) => `${movementLine(m, b.accounts)} (movement ${m.id})`).join("; ")}. ` +
                "delete_movement removes each.",
            )
          }
          const after = { ...b, expenses: b.expenses.filter((x) => x.id !== e.id) }
          const months = planMonths([e], b.expenses)
          const today = isoDate(new Date())
          return previewOrApply(userId, input.confirm, {
            action: `delete ${costLine(e, b.accounts)}`,
            done: `Deleted: ${costLine(e, b.accounts)}`,
            before: costCard(e, b, (await loadCollaborators(userId)).collaborators),
            after: null,
            figures: figureChanges(bookFigures(b, months, today), bookFigures(after, months, today)),
            notes: [overpaidNote(b.loans, after.expenses), importNote(e.importRef, true)].filter((n): n is string => n !== null),
            touched: accountsOf(b.accounts, [e.accountId]),
            id: e.id,
            write: () => db().deleteCompanyExpense(userId, e.id),
          })
        },
        !input.confirm,
      )
  )

  server.registerTool(
    "attach_file",
    {
      title: "Attach Invoice File",
      description:
        "Attaches an invoice file to a company (SRL) cost (the supplier's invoice) or to an issued invoice, as the Attach " +
        "File slot does on the web: the FatturaPA XML, the signed .xml.p7m, or a PDF where there is no XML, up to 10 MB. " +
        "target is cost or invoice; id is the one get_cash_book (a cost) or list_invoices (an invoice) lists; name is the " +
        "file name with its extension (it decides the kind); content_base64 is the file's bytes, base64, read from disk " +
        "by a client that can: «allega la fattura XML». Check the row's file in get_cash_book or list_invoices first: " +
        "when it has none, send the bytes once and this writes at once, with no preview. When it has one, ask the owner " +
        "whether to replace it, and only then send the bytes once, with replace: true, which swaps it and deletes the old " +
        "one. Without replace: true a row that has a file is refused, naming it, and the bytes are wasted.",
      inputSchema: z.object({
        target: fileTargetInput,
        id: z.string().min(1),
        name: z.string().min(1).max(255),
        // 10 MB is 13.98M base64 characters; the rest is room for line breaks. The real limit is checkInvoiceFile's, on the stripped string.
        content_base64: z.string().min(1).max(14_500_000),
        replace: z.boolean().optional(),
      }),
    },
    async (input, ctx) =>
      // The audit keeps what was asked, not the file: its bytes would fill mcp_audit.
      audited(ctx, "attach_file", { ...input, content_base64: `<${input.content_base64.length} base64 characters>` }, async (userId) => {
        // Line breaks are not bytes: strip them before sizing.
        const b64 = input.content_base64.replace(/\s/g, "")
        const check = checkInvoiceFile({ name: input.name, size: base64Bytes(b64) })
        if (!check.ok) throw new ToolInputError(check.reason)
        if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new ToolInputError("content_base64 is not valid base64.")
        const holder = await fileHolder(userId, input.target, input.id)
        if (holder.file && !input.replace) {
          throw new ToolInputError(`This ${holder.noun} already has a file: ${fileText(holder.file)}. Ask the owner whether to replace it; if they agree, call again with replace: true.`)
        }
        const files = getServerFiles()
        // Upload first, point second: a failed upload never leaves a record naming a file that is not there.
        const stored = await files.upload(userId, new Blob([Buffer.from(b64, "base64")]), input.name)
        try {
          await pointAt(userId, input.target, input.id, stored)
        } catch (e) {
          await dropObject(userId, stored)
          throw e
        }
        await dropObject(userId, holder.file)
        return {
          payload: {
            summary: holder.file
              ? `Replaced ${holder.file.name} with ${fileText(stored)} on ${holder.label}.`
              : `Attached ${fileText(stored)} to ${holder.label}.`,
            file: fileSummary(stored),
          },
          documentIds: [input.id],
        }
      }),
  )

  server.registerTool(
    "remove_file",
    {
      title: "Remove Invoice File",
      description:
        "Removes the invoice file from a company (SRL) cost or an issued invoice and deletes it from storage (target cost " +
        "or invoice, id from get_cash_book or list_invoices): «togli il PDF dalla fattura». To swap a file use " +
        "attach_file with replace: true. Preview, then confirm: called without confirm it changes nothing and says which " +
        "file would go; show that to the owner and ask; only once they agree call again, the same arguments, with confirm: true.",
      inputSchema: z.object({ target: fileTargetInput, id: z.string().min(1), confirm: confirmInput }),
    },
    async (input, ctx) =>
      audited(
        ctx,
        "remove_file",
        input,
        async (userId) => {
          const holder = await fileHolder(userId, input.target, input.id)
          if (!holder.file) throw new ToolInputError(`${holder.label[0].toUpperCase()}${holder.label.slice(1)} has no file.`)
          if (!input.confirm) {
            return {
              payload: {
                preview: true,
                summary:
                  `Preview, nothing changed yet: remove ${fileText(holder.file)} from ${holder.label}. Show this to the owner and ask; ` +
                  "if they agree, call again with the same arguments and confirm: true.",
                file: fileSummary(holder.file),
              },
              documentIds: [],
            }
          }
          await pointAt(userId, input.target, input.id, null)
          await dropObject(userId, holder.file)
          return { payload: { summary: `Removed ${holder.file.name} from ${holder.label}.`, file: fileSummary(holder.file) }, documentIds: [input.id] }
        },
        !input.confirm,
      ),
  )

  server.registerTool(
    "update_loan",
    {
      title: "Edit Shareholder Loan",
      description:
        "Corrects a company (SRL) shareholder loan or repayment by id (get_cash_book lists its id): «il finanziamento " +
        "del 10/9 era 4.000» → amount 4000. Pass only what changes, as the loan dialog takes it: direction (to_company, " +
        "from_company), amount, date (never in the future; a changed date is no longer estimated), account (the company " +
        "account it went through), description, notes (\"\" clears them). The preview says what the SRL owes the owner " +
        "after it and the account's balance, and warns when repayments would pass what was owed. " +
        CONFIRM_RULE,
      inputSchema: z.object({
        id: z.string().min(1),
        direction: z.enum(["to_company", "from_company"]).optional(),
        amount: z.number().positive().finite().optional(),
        date: dayInput.optional(),
        account: z.string().min(1).optional(),
        description: z.string().trim().max(300).optional(),
        notes: z.string().trim().max(500).optional(),
        confirm: confirmInput,
      }),
    },
    async (input, ctx) =>
      audited(
        ctx,
        "update_loan",
        input,
        async (userId) => {
          const { id, confirm, ...changes } = input
          if (Object.values(changes).every((v) => v === undefined)) {
            throw new ToolInputError("Nothing to change: pass direction, amount, date, account, description or notes.")
          }
          const b = await loadBook(userId)
          const l = entryOf(b.loans, b, id, "loan")
          const direction = input.direction ?? l.direction
          const accountId = input.account ? resolveCompanyAccount(b.accounts, input.account).id : l.accountId
          const day = input.date ? cashDay(input.date) : isoDate(l.date)
          const typed = (d: CompanyLoan["direction"]) => (d === "to_company" ? "Shareholder Loan" : "Shareholder Loan Repayment")
          const set = valid(createCompanyLoanSchema, {
            direction,
            amount: input.amount !== undefined ? round2(input.amount) : l.amount,
            date: dateOf(day),
            accountId,
            // The web writes its defaults in sentence case: a default either way follows the direction.
            description:
              (input.description ?? (l.description.toLowerCase() === typed(l.direction).toLowerCase() ? "" : l.description)) || typed(direction),
            notes: textOr(input.notes, l.notes),
            ...(day !== isoDate(l.date) ? { dateEstimated: false } : {}),
          })
          const updated: CompanyLoan = { ...l, ...set }
          const after = { ...b, loans: b.loans.map((x) => (x.id === l.id ? updated : x)) }
          const today = isoDate(new Date())
          const account = b.accounts.find((a) => a.id === accountId)
          const notes = [
            overpaidNote(after.loans, b.expenses),
            account ? beforeOpening(account, day).trim() || null : null,
            importNote(l.importRef, false),
          ].filter((n): n is string => n !== null)
          return previewOrApply(userId, confirm, {
            action: `edit ${loanLine(l, b.accounts)} → ${loanLine(updated, b.accounts)}`,
            done: `Updated: ${loanLine(updated, b.accounts)}`,
            before: loanCard(l, b.accounts),
            after: loanCard(updated, b.accounts),
            figures: figureChanges(bookFigures(b, [], today), bookFigures(after, [], today)),
            notes,
            touched: accountsOf(b.accounts, [l.accountId, accountId]),
            id: l.id,
            write: () => db().updateCompanyLoan(userId, l.id, set),
          })
        },
        !input.confirm,
      )
  )

  server.registerTool(
    "delete_loan",
    {
      title: "Delete Shareholder Loan",
      description:
        "Deletes a company (SRL) shareholder loan or repayment recorded by mistake, by id (get_cash_book lists its id): " +
        "«elimina il rimborso doppio del 2/10». The preview says what the SRL owes the owner after it and the company " +
        "account's balance, and warns when repayments would pass what was owed. " +
        CONFIRM_RULE,
      inputSchema: z.object({ id: z.string().min(1), confirm: confirmInput }),
    },
    async (input, ctx) =>
      audited(
        ctx,
        "delete_loan",
        input,
        async (userId) => {
          const b = await loadBook(userId)
          const l = entryOf(b.loans, b, input.id, "loan")
          const after = { ...b, loans: b.loans.filter((x) => x.id !== l.id) }
          const today = isoDate(new Date())
          return previewOrApply(userId, input.confirm, {
            action: `delete ${loanLine(l, b.accounts)}`,
            done: `Deleted: ${loanLine(l, b.accounts)}`,
            before: loanCard(l, b.accounts),
            after: null,
            figures: figureChanges(bookFigures(b, [], today), bookFigures(after, [], today)),
            notes: [overpaidNote(after.loans, b.expenses), importNote(l.importRef, true)].filter((n): n is string => n !== null),
            touched: accountsOf(b.accounts, [l.accountId]),
            id: l.id,
            write: () => db().deleteCompanyLoan(userId, l.id),
          })
        },
        !input.confirm,
      )
  )

  // ─── Solutions ─────────────────────────────────────────────────────────────
  // The catalog of what was built for each client. Direct writes, as on meetings
  // and tasks: the preview-confirm rule is for the money records. No delete tool:
  // a solution is deleted on the Solutions page only.

  server.registerTool(
    "create_solution",
    {
      title: "New Solution",
      description:
        "Adds a solution to the catalog: what was built, or proposed, for a client, documented for reuse in " +
        "pre-sales. Not a contract (convert_to_engagement) nor a call (log_meeting). «documentiamo il progetto di " +
        "Acme» → client + name. client and name are required, and a name the client already has is refused: update " +
        "that one. engagementId links it to one of that client's contracts (id or name, closed ones too); without " +
        "it the solution is pre-sales. status defaults to proposed (building, delivered, retired); kind is product " +
        "(the default: something built) or advisory (help given, such as tuning the client's queries); target is the " +
        `end state the work leads to, up to ${SOLUTION_TARGET_MAX} characters; the road of steps to it is added with ` +
        "update_solution. domain is one word to group by ('retail'); stack lists the technologies as lowercase tags " +
        "('neo4j', 'kafka'). It starts with every section empty, and the reply lists the sections its kind asks for " +
        "(a product seven, an advisory three: purpose, kpis, results) with one question each: the end-of-project " +
        "interview. Ask the owner ONE question at a time, in that order; after each answer call update_solution with " +
        "the section and the answer as text (the owner's facts, in the language they used, nothing added), then ask " +
        "the next. For model, send entities and relations too. Skip a section the owner has nothing for.",
      inputSchema: z.object({
        client: z.string().min(1),
        name: z.string().trim().min(1).max(200),
        engagementId: z.string().min(1).optional(),
        status: solutionStatusSchema.optional(),
        kind: solutionKindSchema.optional(),
        // Over the cap is refused with the schema's message, not the SDK's.
        target: z.string().optional(),
        domain: z.string().max(60).optional(),
        stack: z.array(z.string().max(40)).max(MAX_SOLUTION_STACK).optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "create_solution", input, async (userId) => {
        const [clients, engagements, solutions, opportunities] = await Promise.all([
          db().getClients(userId),
          db().getEngagements(userId),
          db().getSolutions(userId),
          db().getOpportunities(userId),
        ])
        // Archived clients too: a past project is documented after the client has gone.
        const client = resolveClient(clients, input.client, true)
        const engagement = input.engagementId
          ? resolvePreferringActive(engagements.filter((e) => e.clientId === client.id), clients, input.engagementId)
          : null
        refuseTakenSolutionName(solutions, client, input.name)
        const created = await db().createSolution(
          userId,
          valid(createSolutionSchema, {
            clientId: client.id,
            name: input.name,
            engagementId: engagement?.id ?? null,
            status: input.status,
            kind: input.kind,
            target: input.target?.trim() || null,
            domain: input.domain?.trim() || null,
            stack: input.stack,
          }),
        )
        return {
          payload: {
            summary:
              `Solution "${created.name}" (${created.kind}) created for ${client.name}` +
              `${engagement ? `, contract ${engagementLabel(engagement)}` : " (pre-sales)"}, status ${created.status}. ` +
              "Every section is empty: start the interview.",
            solution: solutionCard(created, clients, engagements, opportunities),
            interview: sectionsFor(created.kind).map(({ key, label, question }) => ({ section: key, label, question })),
            next:
              "Ask the owner one question at a time, in this order. After each answer call update_solution with " +
              `solution "${created.id}", the section and the answer as text, then ask the next question. ` +
              "For model, send entities and relations too.",
          },
          documentIds: [created.id],
        }
      })
  )

  server.registerTool(
    "update_solution",
    {
      title: "Edit Solution",
      description:
        "Edits a solution of the catalog, one section per call: section (purpose, requirements, kpis, sources, " +
        "model, architecture, steps, history, results) with its text, which replaces the section; append true adds " +
        "the text on a new line instead. History grows that way, one dated line per decision: start the line with " +
        "its date, YYYY-MM-DD. text \"\" or null clears the section. A section holds at most " +
        `${SOLUTION_SECTION_MAX.toLocaleString("en")} characters: a longer text, or an append past it, is refused ` +
        "with the current length and nothing is written; never cut the owner's words to fit. entities and relations " +
        "REPLACE the whole data model, so read it with get_solution and send the full lists: an entity is {name, " +
        "source (the client's system it comes from), notes}, a relation {from, type, to} names two entities, and one " +
        "naming a missing entity is refused. Also stack (replaces the list), status (proposed, building, delivered, " +
        "retired), engagementId (a contract of the same client, id or name; null = back to pre-sales), name, domain " +
        "(null removes it). solution is a name or id; client narrows it when two clients have one by that name. " +
        "During the interview create_solution started, call it after each answer: the reply lists the sections still " +
        "empty with their questions. «aggiungi alla storia che a maggio siamo passati a Kafka» → section history, " +
        "append true. kind (product or advisory) and target (the end state, up to " +
        `${SOLUTION_TARGET_MAX} characters; null removes it) change as they are. The road to the target is steps, ` +
        "one step per call: step is its number (1 is the first) or its title, and a title no step has adds a new " +
        "step at the end (it needs fromMonth, YYYY-MM). With step, any of stepTitle (renames), stepState (done, now, " +
        "next, later; the default for a new step is next), fromMonth, toMonth (never before fromMonth; null = " +
        "open-ended), paidBy (a contract or opportunity of this client, id or name; null = none; an opportunity " +
        "follows its contract once it is won), goal and outcome (null clears). At most 20 steps and one Now: moving " +
        "a second to now is refused. Marking a step done needs its outcome; if it was the Now step, the next open " +
        "step becomes Now. removeStep (number or title) deletes one. «siamo passati alla fase due» → mark the Now " +
        "step done with its outcome.",
      inputSchema: z.object({
        solution: z.string().trim().min(1),
        client: z.string().min(1).optional(),
        kind: solutionKindSchema.optional(),
        target: z.string().nullable().optional(),
        step: z.union([z.number().int().min(1), z.string().trim().min(1)]).optional(),
        stepTitle: z.string().trim().min(1).max(200).optional(),
        stepState: z.enum(["done", "now", "next", "later"]).optional(),
        fromMonth: z.string().optional(),
        toMonth: z.string().nullable().optional(),
        paidBy: z.string().trim().min(1).nullable().optional(),
        goal: z.string().nullable().optional(),
        outcome: z.string().nullable().optional(),
        removeStep: z.union([z.number().int().min(1), z.string().trim().min(1)]).optional(),
        section: solutionSectionKeySchema.optional(),
        // Over the cap is refused in the handler, with the length: never cut.
        text: z.string().nullable().optional(),
        append: z.boolean().optional(),
        entities: z
          .array(z.object({ name: z.string(), source: z.string().nullable().optional(), notes: z.string().nullable().optional() }))
          .optional(),
        relations: z.array(z.object({ from: z.string(), to: z.string(), type: z.string() })).optional(),
        stack: z.array(z.string().max(40)).max(MAX_SOLUTION_STACK).optional(),
        status: solutionStatusSchema.optional(),
        engagementId: z.string().min(1).nullable().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        domain: z.string().max(60).nullable().optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "update_solution", input, async (userId) => {
        // Kept off the Zod schema for the same reason as update_task's guard.
        const { solution: query, client: clientQuery, section, text, append, ...fields } = input
        const { step: stepRef, stepTitle, stepState, fromMonth, toMonth, paidBy, goal, outcome, removeStep, ...rest } = fields
        const stepFields = { stepTitle, stepState, fromMonth, toMonth, paidBy, goal, outcome }
        if (stepRef === undefined && Object.values(stepFields).some((v) => v !== undefined)) {
          throw new ToolInputError("Pass step (its number, or the title of a new one) with stepTitle, stepState, fromMonth, toMonth, paidBy, goal or outcome.")
        }
        if (stepRef !== undefined && removeStep !== undefined) throw new ToolInputError("Pass step or removeStep, not both.")
        if (section === undefined && text === undefined && stepRef === undefined && removeStep === undefined && Object.values(rest).every((v) => v === undefined)) {
          throw new ToolInputError(
            "Nothing to change: pass section with text, entities, relations, stack, status, kind, target, step, removeStep, engagementId, name or domain."
          )
        }
        if (text !== undefined && !section) {
          throw new ToolInputError(`Pass section with text: one of ${SOLUTION_SECTIONS.map((x) => x.key).join(", ")}.`)
        }
        if (section && text === undefined) throw new ToolInputError(`Pass text for ${section} ("" or null clears it).`)
        if (append && !text?.trim()) throw new ToolInputError("append needs text: there is nothing to add.")

        const [solutions, clients, engagements, opportunities] = await Promise.all([
          db().getSolutions(userId),
          db().getClients(userId),
          db().getEngagements(userId),
          db().getOpportunities(userId),
        ])
        const narrowed = clientQuery ? resolveClient(clients, clientQuery, true) : null
        const s = resolveSolution(solutions, clients, query, narrowed?.id)
        const client = clients.find((c) => c.id === s.clientId)
        const update: UpdateSolutionInput = {}
        const changes: string[] = []
        let textBefore: string | null = null

        if (section) {
          const { label } = SOLUTION_SECTIONS.find((x) => x.key === section)!
          const before = s.sections[section]?.trimEnd() || null
          const added = append && before !== null
          const next = added ? `${before}\n${text!.trim()}` : text?.trim() || null
          if (next && next.length > SOLUTION_SECTION_MAX) {
            const n = (x: number) => x.toLocaleString("en")
            throw new ToolInputError(
              (added
                ? `${label} holds ${n(before!.length)} characters; adding this line makes ${n(next.length)}`
                : `The text is ${n(next.length)} characters`) +
                `, over the ${n(SOLUTION_SECTION_MAX)} a section holds. Nothing was written: ` +
                "shorten it with the owner, never by cutting their words."
            )
          }
          update.sections = { [section]: next }
          if (!added) textBefore = before
          changes.push(next === null ? `${label} cleared` : `${label}${added ? ": a line added" : " written"} (${next.length} characters)`)
        }
        if (fields.kind) {
          update.kind = fields.kind
          changes.push(`kind ${fields.kind}`)
        }
        if (fields.target !== undefined) {
          update.target = fields.target?.trim() || null
          changes.push(update.target ? "target set" : "target removed")
        }
        if (stepRef !== undefined || removeStep !== undefined) {
          const steps = [...s.steps]
          const list = `There ${steps.length === 1 ? "is 1 step" : `are ${steps.length} steps`}${steps.length ? `: ${steps.map((x, k) => `${k + 1} ${x.title}`).join("; ")}` : ""}.`
          const notFound = (ref: number | string) => new ToolInputError(`No single step is "${ref}". ${list}`)
          if (removeStep !== undefined) {
            const at = stepIndex(steps, removeStep)
            if (at < 0) throw notFound(removeStep)
            changes.push(`step ${at + 1} "${steps[at].title}" removed`)
            steps.splice(at, 1)
          } else {
            const found = stepIndex(steps, stepRef!)
            // A title no step has adds one; a number past the end, or a title two steps share, does not.
            const isNew = found < 0 && typeof stepRef === "string" && !steps.some((x) => x.title.trim().toLowerCase() === stepRef.trim().toLowerCase())
            if (found < 0 && !isNew) throw notFound(stepRef!)
            if (isNew && !fromMonth) throw new ToolInputError(`"${stepRef}" is a new step: pass fromMonth (YYYY-MM).`)
            const at = isNew ? steps.length : found
            const payer = paidBy ? resolveStepPayer(client!, engagements, opportunities, paidBy) : paidBy === null ? null : undefined
            const before: SolutionStep = isNew
              ? { title: stepRef as string, state: "next", fromMonth: fromMonth!, toMonth: null, paidBy: null, goal: null, outcome: null, doneOn: null }
              : steps[at]
            const edited: SolutionStep = {
              ...before,
              ...(stepTitle !== undefined && { title: stepTitle }),
              ...(stepState !== undefined && { state: stepState }),
              ...(fromMonth !== undefined && { fromMonth }),
              ...(toMonth !== undefined && { toMonth }),
              ...(payer !== undefined && { paidBy: payer }),
              ...(goal !== undefined && { goal: goal?.trim() || null }),
              ...(outcome !== undefined && { outcome: outcome?.trim() || null }),
            }
            // A completion undone takes its outcome and day with it; a Done step keeps an outcome.
            if (before.state === "done" && edited.state !== "done") Object.assign(edited, { outcome: null, doneOn: null })
            else if (edited.state === "done" && before.state === "done" && !edited.outcome) {
              throw new ToolInputError(`step ${at + 1} "${edited.title}" is done: it keeps its outcome. Reopen it first to clear it.`)
            }
            const label = `step ${at + 1} "${edited.title}"`
            if (stepState === "done" && before.state !== "done") {
              if (!edited.outcome) throw new ToolInputError(`Marking ${label} done needs its outcome: what came of it.`)
              // Kept at its former state until here, so completeStep knows whether it was the Now step.
              const staged = isNew ? [...steps, { ...edited, state: before.state }] : steps.map((x, k) => (k === at ? { ...edited, state: before.state } : x))
              const done = completeStep(staged, at, edited.outcome, isoDate(new Date()))
              const moved = done.findIndex((x, k) => x.state === "now" && staged[k].state !== "now")
              changes.push(`${label} done` + (moved >= 0 ? `, step ${moved + 1} "${done[moved].title}" is now Now` : ""))
              steps.splice(0, steps.length, ...done)
            } else {
              changes.push(`${label} ${isNew ? "added" : "changed"}`)
              steps.splice(at, 1, edited)
            }
          }
          update.steps = steps
        }
        if (fields.entities) {
          update.entities = fields.entities.map((e) => ({ name: e.name, source: e.source?.trim() || null, notes: e.notes?.trim() || null }))
          changes.push(`entities ${update.entities.map((e) => e.name).join(", ") || "removed"}`)
        }
        if (fields.relations) {
          update.relations = fields.relations
          changes.push(plural(fields.relations.length, "relation", "relations"))
        }
        if (fields.stack) {
          update.stack = fields.stack
          changes.push(`stack ${fields.stack.join(", ") || "emptied"}`)
        }
        if (fields.status) {
          update.status = fields.status
          changes.push(`status ${fields.status}`)
        }
        if (fields.engagementId !== undefined) {
          // Among the solution's own client's contracts, closed ones too: another client's misses, listing these.
          const target = fields.engagementId
            ? resolvePreferringActive(engagements.filter((e) => e.clientId === s.clientId), clients, fields.engagementId)
            : null
          update.engagementId = target?.id ?? null
          changes.push(target ? `linked to contract ${engagementLabel(target)}` : "unlinked from its contract (pre-sales)")
        }
        if (fields.name) {
          if (client) refuseTakenSolutionName(solutions, client, fields.name, s.id)
          update.name = fields.name
          changes.push(`renamed "${fields.name}"`)
        }
        if (fields.domain !== undefined) {
          update.domain = fields.domain?.trim() || null
          changes.push(update.domain ? `domain ${update.domain}` : "domain removed")
        }
        refuseInvalidSolution(s, update)

        const updated = await db().updateSolution(userId, s.id, update)
        const card = solutionCard(updated, clients, engagements, opportunities)
        return {
          payload: {
            summary:
              `"${updated.name}" updated: ${changes.join(", ")}. ` +
              (card.missingSections.length ? `Still empty: ${card.missingSections.join(", ")}.` : `All ${sectionsFor(updated.kind).length} sections are written.`),
            solution: card,
            // A replace cannot be undone from the audit (it keeps params only), so hand back the old text.
            ...(textBefore !== null && { textBefore }),
            interview: sectionsFor(updated.kind).filter(({ key }) => card.missingSections.includes(key)).map(
              ({ key, label, question }) => ({ section: key, label, question }),
            ),
          },
          documentIds: [updated.id],
        }
      })
  )

  server.registerTool(
    "log_work",
    {
      title: "Log Work",
      description:
        "Files a work session on a solution's journal, the page's Log Work: did (what was done), decisions (each shown as " +
        "its own Decision line), links (PRs, commits), next, and source (the repository's name; the entry says which app filed it). " +
        "step is its number (1 is the first) or its title; the default is the Now step, and a step of another solution is " +
        "refused. With decisions and no did, each decision is filed on its own. Dated today. The reply names the step and " +
        "the open tasks of the contract that pays for it. «segna la sessione di oggi sul grafo» → did, with the step Now. " +
        "solution is a name or id; client narrows it when two clients have one by that name. Entries are edited and deleted " +
        "on the solution page, not here.",
      inputSchema: z.object({
        solution: z.string().trim().min(1),
        client: z.string().min(1).optional(),
        step: z.union([z.number().int().min(1), z.string().trim().min(1)]).optional(),
        // Lengths are checked by the shared schema, which names them.
        did: z.string().optional(),
        decisions: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
        next: z.string().nullable().optional(),
        source: z.string().optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "log_work", input, async (userId) => {
        const did = input.did?.trim()
        const decisions = (input.decisions ?? []).map((d) => d.trim()).filter(Boolean)
        if (!did && decisions.length === 0) throw new ToolInputError("Pass did (what was done), or decisions.")
        if (!did && (input.links?.length || input.next?.trim())) throw new ToolInputError("links and next go with did (a work session).")
        valid(journalLines(MAX_JOURNAL_DECISIONS, JOURNAL_LINE_MAX, "decisions"), decisions)
        const [solutions, clients, opportunities, tasks] = await Promise.all([
          db().getSolutions(userId),
          db().getClients(userId),
          db().getOpportunities(userId),
          db().getTasks(userId),
        ])
        const narrowed = input.client ? resolveClient(clients, input.client, true) : null
        const s = resolveSolution(solutions, clients, input.solution, narrowed?.id)
        let at = -1
        if (input.step !== undefined) {
          at = stepIndex(s.steps, input.step)
          if (at < 0) {
            const list = s.steps.map((x, k) => `${k + 1} ${x.title}`).join("; ")
            throw new ToolInputError(`No single step is "${input.step}" on ${s.name}. ${s.steps.length ? `Its steps: ${list}.` : "It has no steps."}`)
          }
        } else {
          const now = nowStep(s.steps)
          at = now ? s.steps.indexOf(now) : -1
        }
        const step = at >= 0 ? s.steps[at] : null
        // The registered name of the OAuth client; stdio and API keys have none.
        const oauthId = ctx.http?.authInfo?.clientId
        const client = oauthId && oauthId !== "api-key" ? await getOAuthClient(oauthId).catch(() => null) : null
        const source = journalSource(client?.clientName, input.source)
        const base = { solutionId: s.id, clientId: s.clientId, date: isoDateInRome(new Date()), stepTitle: step?.title ?? null, source }
        const docs = did
          ? [valid(createJournalEntrySchema, { ...base, kind: "work", text: did, decisions, links: input.links ?? [], next: input.next ?? null })]
          : decisions.map((text) => valid(createJournalEntrySchema, { ...base, kind: "decision", text }))
        const created = []
        for (const doc of docs) created.push(await db().createJournalEntry(userId, doc))

        const payer = step ? stepContract(step, opportunities) : null
        const open = payer?.type === "contract" ? tasks.filter((t) => !t.isDone && t.engagementId === payer.id) : []
        const where = step ? `step ${at + 1} ${step.title}` : "no step (none is Now)"
        const tail = !step
          ? ""
          : payer?.type !== "contract"
            ? " No contract pays for this step, so no tasks to list."
            : open.length === 0
              ? " No open tasks on this step."
              : ` ${plural(open.length, "open task", "open tasks")} on this step: ${open.map((t) => t.title).sort().join(", ")}.`
        return {
          payload: {
            summary: `Filed on ${s.name}, ${where}.${tail}`,
            entries: created.map((e) => ({ id: e.id, kind: e.kind, date: e.date, step: e.stepTitle })),
            openTasks: open.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate ? isoDate(t.dueDate) : null })),
          },
          documentIds: created.map((e) => e.id),
        }
      })
  )

  // ─── Collaborators (#329) ──────────────────────────────────────────────────
  // The plan's costs: a fixed monthly fee, and days on contracts at a daily rate. Net of VAT, no payroll, no
  // taxes. Every reply says what the next 12 months become, from the Projection the Plan page reads.

  server.registerTool(
    "add_collaborator",
    {
      title: "Add Collaborator",
      description:
        "Adds a collaborator: a freelancer or a company the SRL pays on invoice (an employee is a company with a fixed fee " +
        "taken from the accountant's figure; no payroll). «aggiungi Giulia come collaboratrice». Optional fixed fee: " +
        "fee_amount a month net of VAT, fee_from (YYYY-MM, the first month), fee_until (the last month; leave out for no end) " +
        "and fee_changes [{from, amount}], dated changes after the start, one per month, none after the end. A collaborator " +
        "without a fee costs only what you assign them on contracts (assign_collaborator). Names are unique, any case. Replies " +
        "with the plan's collaborators cost and net over the next 12 months, before → after.",
      inputSchema: z.object({
        name: z.string(),
        type: z.enum(["freelancer", "company"]),
        notes: z.string().optional(),
        active: z.boolean().optional(),
        ...feeInputs,
        fee_changes: feeChangesInput.optional(),
      }),
    },
    async (input, ctx) =>
      audited(ctx, "add_collaborator", input, async (userId) => {
        const book = await loadPlanBook(userId)
        refuseTakenCollaboratorName(book.collaborators, input.name)
        const hasFee = [input.fee_amount, input.fee_from, input.fee_until, input.fee_changes].some((v) => v !== undefined)
        if (hasFee && (input.fee_amount === undefined || input.fee_from === undefined)) throw new ToolInputError(NEEDS_FEE_TERMS)
        const fields = valid(createCollaboratorSchema, {
          name: input.name,
          type: input.type,
          notes: input.notes,
          isActive: input.active,
          fee: hasFee ? { amount: input.fee_amount!, from: input.fee_from!, until: input.fee_until ?? null, changes: input.fee_changes ?? [] } : null,
        })
        const from = thisMonth()
        const before = planFigures(book, from)
        const created = await db().createCollaborator(userId, fields)
        const figures = figureChanges(before, planFigures(withCollaborator(book, created), from))
        return {
          payload: {
            summary:
              `Added ${created.name} (${created.type}), ${created.isActive ? "Active" : "Inactive"}, fixed fee ${feeText(created.fee)}.` +
              (figures.length ? ` ${figures.map(figureLine).join(". ")}.` : " No plan figure moves yet."),
            collaborator: collaboratorCard(created),
            effects: figures,
          },
          documentIds: [created.id],
        }
      })
  )

  server.registerTool(
    "update_collaborator",
    {
      title: "Update Collaborator",
      description:
        "Changes a collaborator (name or id, any case; unknown names are refused with the list): name, type, notes (empty clears), " +
        "active (Inactive keeps them listed but takes their fee and days out of the plan). «giulia non lavora più con noi» → " +
        "active false. The fixed fee: fee_amount, fee_from and fee_until change those fields (fee_until null removes the end); " +
        "add_fee_changes [{from, amount}] adds a dated change, or replaces the one already in that month; remove_fee_changes " +
        "[YYYY-MM] removes the change starting then; clear_fee removes the fee. A collaborator with no fee needs fee_amount and " +
        "fee_from to start one. The app's rules apply: a change after the start and not past the end, one per month. " +
        CONFIRM_RULE +
        " The preview and the reply give the plan's collaborators cost and net over the next 12 months, before → after.",
      inputSchema: z.object({
        collaborator: z.string().min(1),
        name: z.string().optional(),
        type: z.enum(["freelancer", "company"]).optional(),
        notes: z.string().optional(),
        active: z.boolean().optional(),
        ...feeInputs,
        add_fee_changes: feeChangesInput.optional(),
        remove_fee_changes: z.array(z.string()).max(24).optional(),
        clear_fee: z.boolean().optional(),
        confirm: confirmInput,
      }),
    },
    async (input, ctx) =>
      audited(
        ctx,
        "update_collaborator",
        input,
        async (userId) => {
          const book = await loadPlanBook(userId)
          const c = resolveCollaborator(book.collaborators, input.collaborator)
          const update: UpdateCollaboratorInput = {}
          if (input.name !== undefined) {
            refuseTakenCollaboratorName(book.collaborators, input.name, c.id)
            update.name = input.name
          }
          if (input.type !== undefined) update.type = input.type
          if (input.notes !== undefined) update.notes = input.notes.trim() || null
          if (input.active !== undefined) update.isActive = input.active
          const feeAsked = [input.fee_amount, input.fee_from, input.fee_until, input.add_fee_changes, input.remove_fee_changes].some((v) => v !== undefined)
          if (input.clear_fee) {
            if (feeAsked) throw new ToolInputError("clear_fee removes the fee: leave out the fee_* fields.")
            update.fee = null
          } else if (feeAsked) {
            update.fee = nextFee(c.fee, input)
          }
          if (Object.keys(update).length === 0) {
            throw new ToolInputError(
              "Nothing to change: pass name, type, notes, active, fee_amount, fee_from, fee_until, add_fee_changes, remove_fee_changes or clear_fee."
            )
          }
          let fields
          try {
            fields = collaboratorFields(c, update)
          } catch (e) {
            if (e instanceof z.ZodError) throw new ToolInputError(e.issues.map((i) => i.message).join("; "))
            throw e
          }
          const from = thisMonth()
          const figures = figureChanges(planFigures(book, from), planFigures(withCollaborator(book, { ...c, ...fields }), from))
          return previewOrApply(userId, input.confirm, {
            action: `Update ${c.name}`,
            done: `Updated ${c.name}`,
            before: collaboratorView(c),
            after: collaboratorView(fields),
            figures,
            notes: [],
            touched: [],
            id: c.id,
            write: () => db().updateCollaborator(userId, c.id, update),
          })
        },
        !input.confirm
      )
  )

  server.registerTool(
    "assign_collaborator",
    {
      title: "Assign Collaborator",
      description:
        "Puts a collaborator on a contract, or edits their assignment there (one per collaborator and contract). «metti Giulia sul " +
        "contratto Nordwind». Their days are part of the contract's days, never on top: the client is billed for all of them at " +
        "the contract's rate, and the cost is their days × rate. rate is what a day costs, net of VAT, in the contract's unit " +
        "(per hour on an hourly contract), and so is days_per_month. from (YYYY-MM) is the first month; until the last (leave out " +
        "for the contract's end; null removes it; never past the contract's end). month_days [{month, days}] sets the days in " +
        "one month, days 0 for none, days null removes that month's override; like days_per_month, days is in the contract's unit " +
        "(hours on an hourly contract). A new assignment needs rate, from and " +
        "days_per_month; an existing one keeps whatever is left out. To remove one use unassign_collaborator. " +
        CONFIRM_RULE +
        " The preview and the reply give the plan's collaborators cost and net over the next 12 months and the contract's margin " +
        "over the next 6, before → after.",
      inputSchema: z.object({
        collaborator: z.string().min(1),
        contract: z.string().min(1),
        rate: z.number().optional(),
        from: z.string().optional(),
        until: z.string().nullable().optional(),
        days_per_month: z.number().optional(),
        month_days: z.array(z.object({ month: z.string(), days: z.number().nullable() })).max(24).optional(),
        confirm: confirmInput,
      }),
    },
    async (input, ctx) =>
      audited(
        ctx,
        "assign_collaborator",
        input,
        async (userId) => {
          const book = await loadPlanBook(userId)
          const c = resolveCollaborator(book.collaborators, input.collaborator)
          const e = resolvePreferringActive(book.engagements, book.clients, input.contract)
          const unit = contractUnit(e)
          const n = perDay(unit)
          const id = assignmentId(c.id, e.id)
          const stored = book.assignments.find((a) => a.id === id)
          if (!stored && (input.rate === undefined || input.from === undefined || input.days_per_month === undefined)) {
            throw new ToolInputError("A new assignment needs rate, from and days_per_month.")
          }
          if (stored && [input.rate, input.from, input.until, input.days_per_month, input.month_days].every((v) => v === undefined)) {
            throw new ToolInputError("Nothing to change: pass rate, from, until, days_per_month or month_days.")
          }
          if (input.days_per_month !== undefined) assertFitsMonth(input.days_per_month / n, unit)
          const monthDays = { ...stored?.monthDays }
          for (const { month, days } of input.month_days ?? []) {
            if (days === null) delete monthDays[month]
            else {
              assertFitsMonth(days / n, unit)
              monthDays[month] = days / n
            }
          }
          const fields = valid(createAssignmentSchema, {
            collaboratorId: c.id,
            engagementId: e.id,
            dailyRate: input.rate !== undefined ? round2(input.rate * n) : stored!.dailyRate,
            from: input.from ?? stored!.from,
            until: input.until === undefined ? (stored?.until ?? null) : input.until,
            defaultDays: input.days_per_month !== undefined ? input.days_per_month / n : stored!.defaultDays,
            monthDays,
          })
          if (e.endMonth && fields.until && fields.until > e.endMonth) {
            throw new ToolInputError(`${engagementLabel(e)} ends in ${e.endMonth}: until can't be later.`)
          }
          const next: Assignment = stored
            ? { ...stored, ...fields, until: fields.until ?? null, monthDays: fields.monthDays ?? {}, updatedAt: new Date() }
            : { id, userId, ...fields, until: fields.until ?? null, monthDays: fields.monthDays ?? {}, createdAt: new Date(), updatedAt: new Date() }
          const from = thisMonth()
          const figures = figureChanges(
            planFigures(book, from, e.id),
            planFigures({ ...book, assignments: [...book.assignments.filter((a) => a.id !== id), next] }, from, e.id),
          )
          const label = contractLabel(e, book.clients)
          return previewOrApply(userId, input.confirm, {
            action: `${stored ? "Change" : "Assign"} ${c.name} on ${label}`,
            done: `${stored ? "Changed" : "Assigned"} ${c.name} on ${label}`,
            before: stored ? assignmentView(stored, unit) : {},
            after: assignmentView(next, unit),
            figures,
            notes: c.isActive ? [] : [`${c.name} is Inactive: the plan leaves this assignment out until they are Active.`],
            touched: [],
            id,
            write: () =>
              stored
                ? db().updateAssignment(userId, id, { dailyRate: next.dailyRate, from: next.from, until: next.until, defaultDays: next.defaultDays, monthDays: next.monthDays })
                : db().createAssignment(userId, { collaboratorId: c.id, engagementId: e.id, dailyRate: next.dailyRate, from: next.from, until: next.until, defaultDays: next.defaultDays, monthDays: next.monthDays }),
          })
        },
        !input.confirm
      )
  )

  server.registerTool(
    "unassign_collaborator",
    {
      title: "Remove Assignment",
      description:
        "Takes a collaborator off a contract. Refused while their days are logged on that contract: set the assignment's " +
        "until with assign_collaborator instead, so what they worked still counts. «togli Giulia dal contratto Nordwind». " +
        CONFIRM_RULE +
        " The preview and the reply give the plan's collaborators cost and net over the next 12 months and the contract's margin " +
        "over the next 6, before → after.",
      inputSchema: z.object({ collaborator: z.string().min(1), contract: z.string().min(1), confirm: confirmInput }),
    },
    async (input, ctx) =>
      audited(
        ctx,
        "unassign_collaborator",
        input,
        async (userId) => {
          const book = await loadPlanBook(userId)
          const c = resolveCollaborator(book.collaborators, input.collaborator)
          const e = resolvePreferringActive(book.engagements, book.clients, input.contract)
          const id = assignmentId(c.id, e.id)
          const stored = book.assignments.find((a) => a.id === id)
          if (!stored) throw new ToolInputError(`${c.name} is not on ${engagementLabel(e)}.`)
          if (loggedDays(await db().getTimecards(userId), e.id, c.id) > 0) throw new ToolInputError(ASSIGNMENT_HAS_DAYS)
          const from = thisMonth()
          const figures = figureChanges(
            planFigures(book, from, e.id),
            planFigures({ ...book, assignments: book.assignments.filter((a) => a.id !== id) }, from, e.id),
          )
          const label = contractLabel(e, book.clients)
          return previewOrApply(userId, input.confirm, {
            action: `Remove ${c.name} from ${label}`,
            done: `Removed ${c.name} from ${label}`,
            before: assignmentView(stored, contractUnit(e)),
            after: null,
            figures,
            notes: [],
            touched: [],
            id,
            write: () => db().deleteAssignment(userId, id),
          })
        },
        !input.confirm
      )
  )
}

/** The fee after an update: the stored one with the asked fields on top; a fee that has none starts from amount and start. */
function nextFee(
  stored: CollaboratorFee | null,
  ask: {
    fee_amount?: number
    fee_from?: string
    fee_until?: string | null
    add_fee_changes?: { from: string; amount: number }[]
    remove_fee_changes?: string[]
  },
): CollaboratorFee {
  const amount = ask.fee_amount ?? stored?.amount
  const from = ask.fee_from ?? stored?.from
  if (amount === undefined || from === undefined) throw new ToolInputError(NEEDS_FEE_TERMS)
  let changes = [...(stored?.changes ?? [])]
  for (const month of ask.remove_fee_changes ?? []) {
    if (!changes.some((c) => c.from === month)) {
      const list = changes.map((c) => `${c.from} ${eurShort(c.amount)}`).join(", ") || "none"
      throw new ToolInputError(`No fee change starts in ${month}. Changes: ${list}.`)
    }
    changes = changes.filter((c) => c.from !== month)
  }
  for (const add of ask.add_fee_changes ?? []) changes = [...changes.filter((c) => c.from !== add.from), add]
  return { amount, from, until: ask.fee_until === undefined ? (stored?.until ?? null) : ask.fee_until, changes }
}

/** An assignment as the preview shows it, in the contract's unit. */
function assignmentView(a: Pick<Assignment, "dailyRate" | "from" | "until" | "defaultDays" | "monthDays">, unit: "day" | "hour") {
  return {
    rate: rateText(a.dailyRate, unit),
    from: a.from,
    until: a.until,
    perMonth: qtyText(a.defaultDays, unit),
    months: Object.entries(a.monthDays).sort(([x], [y]) => x.localeCompare(y)).map(([m, d]) => `${m} ${qtyText(d, unit)}`).join(", ") || "none",
  }
}
