import { eurShort } from "@alter-ego/kernel/currency"
import { formatYearMonth, isoDate } from "@alter-ego/kernel/dates"
import { addDays, format, parseISO } from "date-fns"

import { liveAssignments, onContract } from "@/lib/assignment-plan"
import { marginTable } from "@/lib/assignments"
import {
  MAX_BANK_FEE,
  balancesAt,
  bookRows,
  chaseDay,
  costCentresOf,
  dayLabel,
  deposits,
  ownerLoanBalance,
  rowTypeLabel,
  statementCheck,
  supplierDocuments,
  toChase,
} from "@/lib/cash-book"
import { collaboratorMonth } from "@/lib/collaborator-invoices"
import {
  rateAt,
  resolveAllocationGrid,
  toRevenueSources,
  type AllocationCell,
  type RevenueSource,
} from "@/lib/engagement-burndown"
import { contractDays, contractUnit, engagementLabel, HOURS_PER_DAY, hoursToDays, inContractUnit, perDay, toContractUnit } from "@/lib/engagements"
import {
  clientBilling,
  eurCents,
  invoiceClientId,
  invoicePeriodLabel,
  invoiceSuggestions,
  invoiceTotal,
  nextInvoiceNumber,
  periodMonths,
  suggestedDueDate,
} from "@/lib/invoices"
import { healthByContract } from "@/lib/meetings"
import { monthNotEnded } from "@/lib/month-end"
import { buildProjection, costsFor, countedWhenPaid, nearestPaymentMonth, priceIn } from "@/lib/projection"
import { contractState, missingSections, nowStep, stepContract } from "@/lib/solutions"
import { monthHours, planCells } from "@/lib/timecards"

import type { CashRow, ChaseItem, SupplierDocument } from "@/lib/cash-book"
import type { InvoiceInputs } from "@/lib/collaborator-invoices"
import type { ClientBilling } from "@/lib/invoices"
import type { MonthEnd, MonthEndData, MonthEndItem } from "@/lib/month-end"
import type { ProjectionMonth } from "@/lib/projection"
import type {
  Allocation,
  Assignment,
  CapacityDoc,
  Client,
  Collaborator,
  CompanyAccount,
  CompanyDeadline,
  CompanyExpense,
  CompanyMovement,
  Engagement,
  Invoice,
  InvoiceFile,
  Meeting,
  Opportunity,
  Solution,
  SolutionStep,
  SolutionStepPayer,
  Task,
  Timecard,
} from "@/types"

export type { CapacityDoc }

// ─── Response envelope and month arithmetic ──────────────────────────────────

export class ToolInputError extends Error {}

export const round2 = (n: number) => Math.round(n * 100) / 100

// ─── MCP response shape ──────────────────────────────────────────────────────

export function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] }
}

export function fail(error: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error }) }],
    isError: true as const,
  }
}

// ─── Months ──────────────────────────────────────────────────────────────────

/**
 * Normalizes "YYYY-MM" or "YYYY-MM-DD" to the month, with a readable error.
 * Italian month names are NOT parsed here — the model translates before calling.
 */
export function normalizeMonth(input: string): string {
  const match = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(input.trim())
  const month = match ? Number(match[2]) : 0
  if (!match || month < 1 || month > 12) {
    throw new ToolInputError(
      `Invalid date: "${input}". Use YYYY-MM (e.g. 2026-08) or YYYY-MM-DD.`
    )
  }
  return `${match[1]}-${match[2]}`
}

/**
 * Resolves a [from, to] window that honours day precision when it is given.
 *
 * `normalizeMonth` deliberately truncates, which is right for the tools that
 * group by month — but a listing asked for "2026-07-05" must not silently answer
 * for all of July. A month bound still widens to the whole month (`from` to its
 * first day, `to` to its last), so the two precisions mix: from a day, to a month.
 *
 * `to` defaults to `from`, at the same precision: one day, or one whole month.
 */
export function resolveDateWindow(input: { from: string; to?: string }): {
  from: Date
  to: Date
} {
  const from = parseBound(input.from, "start")
  const to = input.to ? parseBound(input.to, "end") : parseBound(input.from, "end")
  if (to.getTime() < from.getTime()) {
    throw new ToolInputError(`Invalid range: "${input.from}" is after "${input.to}".`)
  }
  return { from, to }
}

/** A bound as a Date: start-of-day/month for "start", end-of-day/month for "end". */
function parseBound(input: string, edge: "start" | "end"): Date {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(input.trim())
  const month = match ? Number(match[2]) : 0
  if (!match || month < 1 || month > 12) {
    throw new ToolInputError(
      `Invalid date: "${input}". Use YYYY-MM-DD (e.g. 2026-08-23) or YYYY-MM.`
    )
  }
  const year = Number(match[1])
  const day = match[3] ? Number(match[3]) : null

  if (day === null) {
    return edge === "start"
      ? new Date(year, month - 1, 1)
      : new Date(year, month, 0, 23, 59, 59, 999)
  }
  const date =
    edge === "start"
      ? new Date(year, month - 1, day)
      : new Date(year, month - 1, day, 23, 59, 59, 999)
  // Rejects "2026-02-30", which the Date constructor would roll into March.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new ToolInputError(`Invalid date: "${input}" does not exist.`)
  }
  return date
}

/** "2026-05" → "2026-Q2". A month belongs to the quarter of its calendar position. */
export function quarterOf(yearMonth: string): string {
  return `${yearMonth.slice(0, 4)}-Q${Math.ceil(Number(yearMonth.slice(5, 7)) / 3)}`
}

/** Number of months in the inclusive [from, to] window. Negative spans throw. */
export function monthSpan(from: string, to: string): number {
  const span =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) +
    1
  if (span < 1) {
    throw new ToolInputError(`Invalid range: "${from}" is after "${to}".`)
  }
  return span
}

/** The month `delta` months after `from` (negative = before). */
export function monthShift(from: string, delta: number): string {
  const total = Number(from.slice(0, 4)) * 12 + (Number(from.slice(5, 7)) - 1) + delta
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return `${year}-${String(month).padStart(2, "0")}`
}

// ─── Entity resolution ───────────────────────────────────────────────────────

/**
 * Pure logic for the company tools: resolving clients, contracts, tasks, invoices and
 * deadlines, plus the capacity and revenue maths behind the plan and the timecard sums.
 * Everything here is unit-tested and the handlers stay thin wrappers.
 */
/**
 * Resolves a client by id or name: exact id → exact name → prefix → substring,
 * all case-insensitive on the name. Ambiguity and misses throw with the
 * candidate list so the model can self-correct in the next call. Names match
 * active clients only, unless `includeArchived` — reopening a closed contract of
 * an archived client has to find it.
 */
export function resolveClient(clients: Client[], query: string, includeArchived = false): Client {
  const byId = clients.find((c) => c.id === query)
  if (byId) return byId

  const q = query.trim().toLowerCase()
  const active = includeArchived ? clients : clients.filter((c) => c.isActive)
  for (const match of [
    active.filter((c) => c.name.toLowerCase() === q),
    active.filter((c) => c.name.toLowerCase().startsWith(q)),
    active.filter((c) => c.name.toLowerCase().includes(q)),
  ]) {
    if (match.length === 1) return match[0]
    if (match.length > 1) {
      throw new ToolInputError(
        `Several clients match "${query}": ${match.map((c) => c.name).join(", ")}. Be more specific.`
      )
    }
  }
  throw new ToolInputError(
    `No client matches "${query}". ${includeArchived ? "Clients" : "Active clients"}: ${active.map((c) => c.name).join(", ") || "none"}.`
  )
}

/**
 * Resolves a task by id, exact title, or substring (case-insensitive) — the
 * same ladder as resolveClient. Callers pass the candidate pool (e.g. only
 * open tasks for complete_task) so the error lists what is actually actionable.
 */
export function resolveTask(tasks: Task[], query: string): Task {
  const byId = tasks.find((t) => t.id === query)
  if (byId) return byId
  const q = query.trim().toLowerCase()
  for (const match of [
    tasks.filter((t) => t.title.toLowerCase() === q),
    tasks.filter((t) => t.title.toLowerCase().includes(q)),
  ]) {
    if (match.length === 1) return match[0]
    if (match.length > 1) {
      throw new ToolInputError(
        `Several tasks match "${query}": ${match.map((t) => t.title).join(", ")}. Be more specific.`
      )
    }
  }
  throw new ToolInputError(
    `No task matches "${query}". Tasks: ${tasks.map((t) => t.title).join(", ") || "none"}.`
  )
}

/** Marks a closed contract in a candidate list, so the model knows what it is picking. */
export function closedMark(e: Engagement): string {
  return e.isActive ? "" : " (closed)"
}

/**
 * Resolves a contract by id or name within `pool` — the caller scopes it to one
 * client's contracts or passes every one. Names match exact, then substring,
 * case-insensitive; an unnamed contract is reachable by id only. Misses and
 * ambiguity list the candidates by label, client and id.
 */
export function resolveEngagement(pool: Engagement[], clients: Client[], query: string): Engagement {
  const byId = pool.find((e) => e.id === query)
  if (byId) return byId

  const clientName = new Map(clients.map((c) => [c.id, c.name]))
  const describe = (e: Engagement) =>
    `${engagementLabel(e)} (${clientName.get(e.clientId) ?? e.clientId}, id ${e.id})${closedMark(e)}`
  const q = query.trim().toLowerCase()
  // "".includes is true for every string: without this, a blank engagementId would
  // silently resolve to the only named contract and log days or a verbale on it.
  if (q === "") {
    throw new ToolInputError("No contract given: pass the contract's id or name.")
  }
  for (const match of [
    pool.filter((e) => e.name?.trim().toLowerCase() === q),
    pool.filter((e) => e.name?.toLowerCase().includes(q)),
  ]) {
    if (match.length === 1) return match[0]
    if (match.length > 1) {
      throw new ToolInputError(
        `Several contracts match "${query}": ${match.map(describe).join("; ")}. Pass the id.`
      )
    }
  }
  throw new ToolInputError(
    `No contract matches "${query}". Contracts: ${pool.map(describe).join("; ") || "none"}.`
  )
}

/** A contract in a candidate list: label, id, and "(closed)" when closed. */
export const candidate = (e: Engagement) => `${engagementLabel(e)} (id ${e.id})${closedMark(e)}`

/**
 * Resolves a contract among the active ones first, then among all of them: a closed
 * contract stays reachable (#156) without making ambiguous a name that matched a
 * single active contract before — a renewal sharing its predecessor's name. The
 * fallback searches a superset, so a real miss or ambiguity still throws, listing
 * closed contracts too.
 */
export function resolvePreferringActive(pool: Engagement[], clients: Client[], query: string): Engagement {
  try {
    return resolveEngagement(pool.filter((e) => e.isActive), clients, query)
  } catch {
    return resolveEngagement(pool, clients, query)
  }
}

/**
 * The engagement a client-scoped write should target. `engagement` (id or contract
 * name) reaches a closed contract of the client too, so a correction to its days or
 * a late verbale can still land (#156); without it, the client's only active contract.
 */
export function pickEngagement(
  engagements: Engagement[],
  clients: Client[],
  client: Client,
  engagement: string | undefined
): Engagement {
  const own = engagements.filter((e) => e.clientId === client.id)
  if (engagement) return resolvePreferringActive(own, clients, engagement)
  const candidates = own.filter((e) => e.isActive)
  if (candidates.length === 0) {
    throw new ToolInputError(
      `No active contract for ${client.name}.` +
        (own.length > 0
          ? ` Contracts: ${own.map(candidate).join("; ")}. For a closed one pass engagementId (id or name).`
          : " Create the contract in the web app first.")
    )
  }
  if (candidates.length > 1) {
    const list = candidates.map(candidate).join("; ")
    throw new ToolInputError(
      `${client.name} has ${candidates.length} active contracts: ${list}. Pass engagementId (id or name).`
    )
  }
  return candidates[0]
}

/**
 * The contract a write names: the client's (engagementId picking among several),
 * or engagementId alone, active contracts first and then closed ones (#156).
 */
export function targetEngagement(
  engagements: Engagement[],
  clients: Client[],
  input: { client?: string; engagementId?: string }
): Engagement {
  if (input.client) {
    return pickEngagement(engagements, clients, resolveClient(clients, input.client), input.engagementId)
  }
  if (input.engagementId) return resolvePreferringActive(engagements, clients, input.engagementId)
  throw new ToolInputError("Pass client or engagementId (the contract's id or name).")
}

/**
 * The contract update_engagement and amend_contract act on: engagementId (id or
 * name) among every contract, closed ones too, or among the client's when client
 * is passed; a client's only contract needs no engagementId — the unnamed one of
 * #163 has no name to pass. client matches archived clients too: a closed contract
 * can still be renamed, and reopened even when its client was archived with it.
 */
export function resolveContract(
  clients: Client[],
  engagements: Engagement[],
  input: { client?: string; engagementId?: string },
): Engagement {
  const client = input.client ? resolveClient(clients, input.client, true) : null
  const pool = client ? engagements.filter((e) => e.clientId === client.id) : engagements
  if (!input.engagementId && !(client && pool.length === 1)) {
    const list = pool.map(candidate).join("; ") || "none"
    throw new ToolInputError(
      `Pass engagementId (the contract's id or name). Contracts${client ? ` of ${client.name}` : ""}: ${list}.`
    )
  }
  return input.engagementId ? resolveEngagement(pool, clients, input.engagementId) : pool[0]
}

/**
 * Resolves an invoice by id or number. The accountant owns numbering, so the
 * number is free text ("14", "2026/14") and a bare "14" must not silently pick
 * "2026/140" — exact match wins outright before substring is tried.
 */
export function resolveInvoice(invoices: Invoice[], query: string): Invoice {
  const byId = invoices.find((i) => i.id === query)
  if (byId) return byId

  const q = query.trim().toLowerCase()
  for (const match of [
    invoices.filter((i) => i.number.toLowerCase() === q),
    invoices.filter((i) => i.number.toLowerCase().includes(q)),
  ]) {
    if (match.length === 1) return match[0]
    if (match.length > 1) {
      throw new ToolInputError(
        `Several invoices match "${query}": ${match.map((i) => i.number).join(", ")}. Be more specific.`
      )
    }
  }
  throw new ToolInputError(
    `No invoice matches "${query}". Numbers: ${invoices.map((i) => i.number).join(", ") || "none"}.`
  )
}

/** Resolves a stored deadline by id, exact title, or substring — as resolveTask. */
export function resolveDeadline(deadlines: CompanyDeadline[], query: string): CompanyDeadline {
  const byId = deadlines.find((d) => d.id === query)
  if (byId) return byId

  const q = query.trim().toLowerCase()
  for (const match of [
    deadlines.filter((d) => d.title.toLowerCase() === q),
    deadlines.filter((d) => d.title.toLowerCase().includes(q)),
  ]) {
    if (match.length === 1) return match[0]
    if (match.length > 1) {
      throw new ToolInputError(
        `Several deadlines match "${query}": ${match.map((d) => d.title).join(", ")}. Be more specific.`
      )
    }
  }
  throw new ToolInputError(
    `No deadline matches "${query}". Deadlines: ${deadlines.map((d) => d.title).join(", ") || "none"}.`
  )
}

// ─── Cash book ───────────────────────────────────────────────────────────────

/**
 * The company account a cash book tool acts on: id, exact name, or a unique
 * case-insensitive substring, as resolveDeadline. Left out, the only account;
 * with two or more it has to be named, so a cash box never takes a payment
 * silently. Misses and ambiguity list the accounts; `or` adds the other answers
 * the caller takes (add_expense's personal card), and `param` is the input the
 * caller reads the account from, so the refusal names one the tool has.
 */
export function resolveCompanyAccount(
  accounts: CompanyAccount[],
  query: string | undefined,
  or = "",
  param = "account",
): CompanyAccount {
  if (accounts.length === 0) {
    throw new ToolInputError(`No company account yet: add the company's bank accounts in the Cash Book first.${or}`)
  }
  const names = accounts.map((a) => a.name).join(", ")
  const q = query?.trim().toLowerCase() ?? ""
  if (q === "") {
    if (accounts.length === 1) return accounts[0]
    throw new ToolInputError(`Which company account? Pass ${param}: ${names}.${or}`)
  }
  const byId = accounts.find((a) => a.id === query)
  if (byId) return byId
  for (const match of [
    accounts.filter((a) => a.name.toLowerCase() === q),
    accounts.filter((a) => a.name.toLowerCase().includes(q)),
  ]) {
    if (match.length === 1) return match[0]
    if (match.length > 1) {
      throw new ToolInputError(`Several company accounts match "${query}": ${match.map((a) => a.name).join(", ")}. Be more specific.`)
    }
  }
  throw new ToolInputError(`No company account matches "${query}". Company accounts: ${names}.${or}`)
}

/**
 * A typed cost centre spelled as the book already spells it, case aside, so
 * "flat rental" never splits Flat Rental in two. The web offers the labels in
 * use as one types (costCentresOf); chat gets this instead, and `isNew` says so.
 */
export function costCentreLabel(
  typed: string | undefined,
  book: { expenses: CompanyExpense[]; movements: CompanyMovement[] },
): { label: string | null; isNew: boolean } {
  const label = typed?.trim()
  if (!label) return { label: null, isNew: false }
  const known = costCentresOf(book.movements, book.expenses).find((c) => c.toLowerCase() === label.toLowerCase())
  return known ? { label: known, isNew: false } : { label, isNew: true }
}

/**
 * Refuses a row the book already has: the same account, day and signed amount,
 * whatever wrote it. That is what a retried call, or one payment told twice,
 * looks like; a genuine twin (two equal loan rows on one day) passes with force.
 */
export function refuseDuplicate(rows: CashRow[], account: CompanyAccount, day: string, delta: number): void {
  const twin = rows.find((r) => r.accountId === account.id && r.day === day && round2(r.delta) === round2(delta))
  if (twin) {
    throw new ToolInputError(
      `Already in the Cash Book: ${[...new Set([rowTypeLabel(twin), twin.description])].join(", ")}, ${eurCents(Math.abs(twin.delta))} ` +
        `${twin.delta > 0 ? "into" : "from"} ${account.name} on ${dayLabel(day)} (${twin.source} ${twin.sourceId}). ` +
        "Pass force: true if it really is a second one."
    )
  }
}

/**
 * The supplier invoice a payment pays, by id or document number, among the costs
 * recorded Not Paid Yet with a document (supplierDocuments). Never more than is
 * still owed on it: the invoice is the cost, a payment only settles it.
 */
export function resolveSupplierInvoice(
  expenses: CompanyExpense[],
  movements: CompanyMovement[],
  query: string,
  amount: number,
): SupplierDocument {
  const { docs } = supplierDocuments(expenses, movements)
  const open = docs.filter((d) => d.owed > 0)
  const listed = `Open supplier invoices: ${
    open.map((d) => `${d.expense.documentRef} (${d.expense.description}, ${eurCents(d.owed)} owed)`).join("; ") || "none"
  }.`
  const q = query.trim().toLowerCase()
  const match = docs.filter((d) => d.expense.id === query || d.expense.documentRef?.trim().toLowerCase() === q)
  if (match.length === 0) {
    throw new ToolInputError(
      `No supplier invoice on Costs matches "${query}". ${listed} Record the supplier's invoice first: add_expense with ` +
        'paidFrom "not_paid" and its documentRef.'
    )
  }
  if (match.length > 1) {
    throw new ToolInputError(
      `Several supplier invoices are numbered "${query}": ${match.map((d) => `${d.expense.description} (id ${d.expense.id})`).join("; ")}. Pass the id.`
    )
  }
  const bill = match[0]
  if (round2(amount) > bill.owed) {
    throw new ToolInputError(`Only ${eurCents(bill.owed)} is owed on ${bill.expense.documentRef}. Record anything more as a cost with add_expense.`)
  }
  return bill
}

export type Figure = { figure: string; before: number | null; after: number | null }

/**
 * The money a cash book change can move, as the pages show it: each company
 * account's balance today (null: not open yet), You Owe Suppliers, SRL Owes You,
 * the deposits to give back and to get back, and the Plan's costs in `months`.
 * Taken before and after a change, figureChanges says what moved.
 */
export function bookFigures(
  book: Parameters<typeof bookRows>[0],
  months: string[],
  today: string,
): Map<string, number | null> {
  const balances = balancesAt(book.accounts, bookRows(book).counted, today)
  const held = deposits(book.movements)
  const heldAs = (kind: string) => round2(held.filter((d) => d.kind === kind).reduce((s, d) => s + d.amount, 0))
  return new Map<string, number | null>([
    ...book.accounts.map((a): [string, number | null] => [`${a.name} balance today`, balances.get(a.id) ?? null]),
    ["You Owe Suppliers", supplierDocuments(book.expenses, book.movements).owed],
    ["SRL Owes You", Math.max(0, ownerLoanBalance(book.loans, book.expenses).total)],
    ["Deposits to give back", heldAs("deposit_held")],
    ["Deposits to get back", heldAs("deposit_paid")],
    ...months.map((ym): [string, number] => [`Plan other costs in ${formatYearMonth(ym)}`, costsFor(book.expenses, ym)]),
  ])
}

/** The figures that differ, in the order taken. */
export function figureChanges(before: Map<string, number | null>, after: Map<string, number | null>): Figure[] {
  return [...before]
    .filter(([figure, value]) => (after.get(figure) ?? null) !== value)
    .map(([figure, value]) => ({ figure, before: value, after: after.get(figure) ?? null }))
}

/** "Main Bank balance today €1,200.00 → €900.00". */
export const figureLine = (f: Figure) => {
  const money = (n: number | null) => (n === null ? "not open yet" : eurCents(n))
  return `${f.figure} ${money(f.before)} → ${money(f.after)}`
}

/** A recurring estimate by id, exact description or a unique substring, as resolveDeadline. */
export function resolveEstimate(estimates: CompanyExpense[], query: string): CompanyExpense {
  const byId = estimates.find((e) => e.id === query)
  if (byId) return byId
  const q = query.trim().toLowerCase()
  for (const match of [
    estimates.filter((e) => e.description.toLowerCase() === q),
    estimates.filter((e) => e.description.toLowerCase().includes(q)),
  ]) {
    if (match.length === 1) return match[0]
    if (match.length > 1) {
      throw new ToolInputError(`Several recurring costs match "${query}": ${match.map((e) => e.description).join(", ")}. Be more specific.`)
    }
  }
  throw new ToolInputError(
    `No recurring cost matches "${query}". Recurring costs: ${estimates.map((e) => e.description).join(", ") || "none"}. ` +
      'Pass paysRecurring "none" when the cost pays none of them.'
  )
}

/** "Nordwind · Product Graph": a contract with its client, as the pages name it. */
export const contractLabel = (e: Engagement, clients: Client[]) => `${clients.find((x) => x.id === e.clientId)?.name ?? ""} · ${engagementLabel(e)}`

/** A collaborator by id or exact name, any case: a guess at who is invoicing would book it against the wrong person. */
export function resolveCollaborator(list: Collaborator[], query: string): Collaborator {
  const byId = list.find((c) => c.id === query)
  if (byId) return byId
  const q = query.trim().toLowerCase()
  const named = list.filter((c) => c.name.toLowerCase() === q)
  if (named.length === 1) return named[0]
  if (named.length > 1) throw new ToolInputError(`Several collaborators are named "${query.trim()}": pass an id (${named.map((c) => c.id).join(", ")}).`)
  throw new ToolInputError(`No collaborator matches "${query.trim()}". Collaborators: ${list.map((c) => c.name).join(", ") || "none"}.`)
}

/**
 * The contract a collaborator's invoice is for: null = their fixed fee. Left out, it is the one they are on (none = fixed fee);
 * on several, the caller says which. A query is "none", an id, or the contract's name with or without its client.
 */
export function resolveInvoiceContract(input: {
  collaborator: Collaborator
  assignments: Assignment[]
  engagements: Engagement[]
  clients: Client[]
  query?: string
}): string | null {
  const { collaborator: c, query } = input
  const mine = input.assignments
    .filter((a) => a.collaboratorId === c.id)
    .flatMap((a) => {
      const e = input.engagements.find((x) => x.id === a.engagementId)
      return e ? [{ id: e.id, own: engagementLabel(e), full: contractLabel(e, input.clients) }] : []
    })
  const list = mine.map((m) => m.full).join(", ")
  if (query === undefined) {
    if (mine.length > 1) {
      throw new ToolInputError(`${c.name} is on several contracts: ${list}. Pass contract with one of them, or "none" for the fixed fee.`)
    }
    return mine[0]?.id ?? null
  }
  const q = query.trim().toLowerCase()
  if (q === "none") return null
  const hit = mine.filter((m) => m.id === query || m.full.toLowerCase() === q || m.own.toLowerCase() === q)
  if (hit.length === 1) return hit[0].id
  throw new ToolInputError(`${c.name} is not on "${query.trim()}". Their contracts: ${list || "none"}. Pass "none" for the fixed fee.`)
}

/** The reply's line for the month an invoice pays: "September: invoiced €1,280 of €3,680 planned, €2,400 missing." */
export function invoicedLine(c: Collaborator, input: InvoiceInputs & { yearMonth: string }): string {
  const m = collaboratorMonth(c, input)
  return `${formatYearMonth(input.yearMonth, "MMMM")}: invoiced ${eurShort(m.invoiced)} of ${eurShort(m.plan)} planned${m.gap > 0 ? `, ${eurShort(m.gap)} missing` : ""}.`
}

/** "1 day", "2 days": a count with its noun, for the English replies. */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// ─── Contract units ──────────────────────────────────────────────────────────

type Unit = "day" | "hour"

/** "€75/h" or "€600/day": a stored day rate, told in the contract's unit. */
export const rateText = (dailyRate: number, unit: Unit) =>
  `€${round2(dailyRate / perDay(unit))}${unit === "hour" ? "/h" : "/day"}`

/** "100 hours", "12.5 days": stored days, counted in the contract's unit. */
export const qtyText = (days: number, unit: Unit) =>
  plural(round2(days * perDay(unit)), unit === "hour" ? "hour" : "day", unit === "hour" ? "hours" : "days")

/** The most a month can hold, in days (the schemas and the rules cap the default at 31). */
export function assertFitsMonth(daysPerMonth: number, unit: Unit): void {
  if (daysPerMonth > 31) {
    throw new ToolInputError(
      `A month holds at most 31 days${unit === "hour" ? ` (${31 * HOURS_PER_DAY} hours)` : ""}: ${qtyText(daysPerMonth, unit)} is more.`,
    )
  }
}

/**
 * A contract's terms as a reply carries them, in its own unit. A day contract keeps the
 * day keys it always had; an hourly one says hourlyRate, the hours and rateNow in €/h,
 * so a reader never takes 75 for a day rate.
 */
export function contractTerms(
  e: Parameters<typeof toContractUnit>[0] & Parameters<typeof contractDays>[0] & Parameters<typeof rateAt>[0],
  month: string,
) {
  const unit = contractUnit(e)
  const t = toContractUnit(e)
  const budget = contractDays(e)
  const rateNow = round2(rateAt(e, month) / perDay(unit))
  const budgetInUnit = budget === null ? null : round2(budget * perDay(unit))
  return unit === "hour"
    ? { unit, hourlyRate: t.rate, rateNow, defaultHoursPerMonth: t.perMonth, contractedHours: t.contracted, budgetHours: budgetInUnit }
    : { unit, dailyRate: t.rate, rateNow, defaultDaysPerMonth: t.perMonth, contractedDays: t.contracted, budgetDays: budgetInUnit }
}

/** An opportunity's estimate in its unit, with the same keys contractTerms uses. */
export function opportunityTerms(o: { dailyRate: number; estimatedDaysPerMonth: number; unit?: Unit }) {
  const unit = contractUnit(o)
  const t = toContractUnit({ dailyRate: o.dailyRate, defaultDaysPerMonth: o.estimatedDaysPerMonth, contractedDays: null, unit })
  return unit === "hour"
    ? { unit, hourlyRate: t.rate, estimatedHoursPerMonth: t.perMonth }
    : { unit, dailyRate: t.rate, estimatedDaysPerMonth: t.perMonth }
}

/** An amendment as recorded, its rate and added days told in the contract's unit. */
export function amendmentView<A extends { dailyRate: number | null; addedDays: number | null }>(a: A, unit: Unit) {
  if (unit === "day") return a
  const { dailyRate, addedDays, ...rest } = a
  return {
    ...rest,
    hourlyRate: dailyRate === null ? null : round2(dailyRate / HOURS_PER_DAY),
    addedHours: addedDays === null ? null : round2(addedDays * HOURS_PER_DAY),
  }
}

// ─── Notes ───────────────────────────────────────────────────────────────────

/**
 * Appends a note line to an entity's single `notes` field. The 1000-char cap
 * mirrors the Firestore rules limit — erroring beats silent truncation.
 */
export function appendNote(existing: string | null, line: string, max = 1000): string {
  const combined = existing ? `${existing}\n${line}` : line
  if (combined.length > max) {
    throw new ToolInputError(
      `The notes would exceed ${max} characters (${combined.length}). Shorten the existing notes in the web app.`
    )
  }
  return combined
}

// ─── Meetings ────────────────────────────────────────────────────────────────

/** A meeting as every meeting tool returns it, its client and contract named. */
export function meetingCard(m: Meeting, clients: Client[], engagements: Engagement[]) {
  const e = m.engagementId ? engagements.find((x) => x.id === m.engagementId) : undefined
  return {
    id: m.id,
    date: m.date,
    time: m.time,
    health: m.health,
    clientId: m.clientId,
    client: clients.find((c) => c.id === m.clientId)?.name ?? null,
    engagementId: m.engagementId,
    engagementLabel: e ? engagementLabel(e) : null,
    text: m.text,
  }
}

/**
 * Each contract's status as get_client and list_meetings report it: its light and
 * the day it was stated (healthByContract, the UI chip's own rule), and the day of
 * its latest verbale whatever it said. One pass, then a lookup per contract.
 */
export function contractStatus(meetings: Meeting[]) {
  const current = healthByContract(meetings)
  const last = new Map<string, string>()
  for (const m of meetings) {
    if (m.engagementId && m.date > (last.get(m.engagementId) ?? "")) last.set(m.engagementId, m.date)
  }
  return (engagementId: string) => {
    const stated = current.get(engagementId)
    return {
      health: stated?.health ?? null,
      healthAsOf: stated?.date ?? null,
      lastMeetingDate: last.get(engagementId) ?? null,
    }
  }
}

// ─── Solutions ───────────────────────────────────────────────────────────────

/**
 * Resolves a solution by id, exact name, or a unique substring of it, ignoring
 * case, as resolveInvoice; `clientId` narrows the pool to one client's.
 * A name is unique within its client (solutionNameTaken, on the page and over
 * chat), so the usual ambiguity is a name two clients share; a partial name, or a
 * duplicate saved before the rule or from a page whose list was out of date, can
 * still match two of one client's. The refusal lists each candidate with its
 * client and id, and asks for client only when it would help.
 */
export function resolveSolution(solutions: Solution[], clients: Client[], query: string, clientId?: string): Solution {
  const pool = clientId ? solutions.filter((s) => s.clientId === clientId) : solutions
  const byId = pool.find((s) => s.id === query)
  if (byId) return byId

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id
  const describe = (s: Solution) => `${s.name} (${clientName(s.clientId)}, id ${s.id})`
  const q = query.trim().toLowerCase()
  for (const match of [
    pool.filter((s) => s.name.toLowerCase() === q),
    pool.filter((s) => s.name.toLowerCase().includes(q)),
  ]) {
    if (match.length === 1) return match[0]
    if (match.length > 1) {
      throw new ToolInputError(
        `Several solutions match "${query}": ${match.map(describe).join("; ")}. ${clientId ? "Pass the id." : "Pass client, or the id."}`
      )
    }
  }
  throw new ToolInputError(
    `No solution matches "${query}"${clientId ? ` for ${clientName(clientId)}` : ""}. ` +
      `Solutions: ${pool.map(describe).join("; ") || "none"}.`
  )
}

/**
 * The contract or opportunity of `client` a step is paid by: an id, a name or a title, exact first, then part
 * of one that only one of the client's contracts and opportunities has. Another client's never matches, so it
 * is refused with the client's own list.
 */
export function resolveStepPayer(
  client: Client,
  engagements: Engagement[],
  opportunities: Opportunity[],
  query: string,
): SolutionStepPayer {
  const q = query.trim().toLowerCase()
  const pool = [
    ...engagements.filter((e) => e.clientId === client.id).map((e) => ({ type: "contract" as const, id: e.id, name: engagementLabel(e) })),
    ...opportunities.filter((o) => o.clientId === client.id).map((o) => ({ type: "opportunity" as const, id: o.id, name: o.title })),
  ]
  const describe = (x: (typeof pool)[number]) => `${x.type} ${x.name} (id ${x.id})`
  if (q) {
    for (const match of [pool.filter((x) => x.id === query.trim()), pool.filter((x) => x.name.toLowerCase() === q), pool.filter((x) => x.name.toLowerCase().includes(q))]) {
      // A contract converted from an opportunity carries its title: the pair is one payer, the contract.
      const contract = match.find((x) => x.type === "contract")
      if (contract && match.every((x) => x === contract || (x.type === "opportunity" && opportunities.find((o) => o.id === x.id)?.engagementId === contract.id))) {
        return { type: "contract", id: contract.id }
      }
      if (match.length === 1) return { type: match[0].type, id: match[0].id }
      if (match.length > 1) throw new ToolInputError(`Several match "${query}": ${match.map(describe).join("; ")}. Pass the id.`)
    }
  }
  throw new ToolInputError(`No contract or opportunity of ${client.name} matches "${query}". ${pool.map(describe).join("; ") || "It has none"}.`)
}

/** A solution as every solution tool returns it: its client and contract named, the road with what pays for each step, and the sections still empty. */
export function solutionCard(s: Solution, clients: Client[], engagements: Engagement[], opportunities: Opportunity[]) {
  const e = s.engagementId ? engagements.find((x) => x.id === s.engagementId) : undefined
  const step = (x: SolutionStep, i: number) => {
    // A won opportunity reads as its contract (nothing is written at conversion).
    const payer = stepContract(x, opportunities)
    const name = payer?.type === "contract"
      ? engagements.find((c) => c.id === payer.id)
      : opportunities.find((o) => o.id === payer?.id)
    return {
      number: i + 1,
      ...x,
      paidBy: payer && { ...payer, name: name ? ("title" in name ? name.title : engagementLabel(name)) : null },
    }
  }
  const steps = s.steps.map(step)
  const now = nowStep(s.steps)
  return {
    id: s.id,
    name: s.name,
    clientId: s.clientId,
    client: clients.find((c) => c.id === s.clientId)?.name ?? null,
    engagementId: s.engagementId,
    contract: e ? engagementLabel(e) : null,
    contractState: contractState(e),
    status: s.status,
    kind: s.kind,
    target: s.target,
    steps,
    nowStep: now ? steps[s.steps.indexOf(now)] : null,
    domain: s.domain,
    stack: s.stack,
    updatedAt: isoDate(s.updatedAt),
    missingSections: missingSections(s),
  }
}

// ─── Timecards ───────────────────────────────────────────────────────────────

export type TimecardDecision = "create" | "update" | "unchanged" | "delete" | "conflict"

/**
 * What log_time does with `hours`, the day's TOTAL on one contract, given what is
 * stored for that (contract, day). The same hours again is "unchanged", so a retried
 * call writes nothing. Different hours on a filled day are a "conflict" unless
 * `replace`: "altre 2 ore" and "erano 2 ore" reach the tool as the same number, and
 * only the user knows which one they meant. 0 deletes the day.
 */
export function timecardDecision(
  stored: Pick<Timecard, "hours" | "notes"> | undefined,
  input: { hours: number; notes?: string | null; replace?: boolean }
): TimecardDecision {
  if (!stored) return input.hours === 0 ? "unchanged" : "create"
  if (input.hours === 0) return "delete"
  if (input.hours === stored.hours) {
    // A new note on the same hours is an edit, not a retry. "" and null are both no note.
    return input.notes === undefined || (input.notes || null) === (stored.notes || null) ? "unchanged" : "update"
  }
  return input.replace ? "update" : "conflict"
}

export type TimecardRow = { key: string; engagementId: string; hours: number; days: number }

/**
 * Hours per (period, contract), in period order. Week keys are ISO weeks
 * ("2026-W39"), so 2026-12-31 is 2026-W53 and a week never splits at New Year.
 * Hours are rounded to the cent so a sum never shows float dust.
 */
export function groupTimecards(
  timecards: Pick<Timecard, "engagementId" | "date" | "hours">[],
  groupBy: "day" | "week" | "month"
): TimecardRow[] {
  const keyOf = (date: string) =>
    groupBy === "day" ? date : groupBy === "month" ? date.slice(0, 7) : format(parseISO(date), "RRRR-'W'II")
  const rows = new Map<string, TimecardRow>()
  for (const t of timecards) {
    const key = keyOf(t.date)
    const row = rows.get(`${key}|${t.engagementId}`) ?? { key, engagementId: t.engagementId, hours: 0, days: 0 }
    row.hours += t.hours
    rows.set(`${key}|${t.engagementId}`, row)
  }
  return Array.from(rows.values())
    .map((r) => ({ ...r, hours: round2(r.hours), days: hoursToDays(round2(r.hours)) }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.engagementId.localeCompare(b.engagementId))
}

// ─── Capacity ────────────────────────────────────────────────────────────────

// Moved to a shared module so the Plan page reads the same calculation.
export { allocatedDaysForMonth, capacityForMonths } from "@/lib/capacity"
export type { CapacityMonth } from "@/lib/capacity"

// ─── Plan figures (collaborator previews, get_plan, get_quarters) ────────────

/** Everything the Projection reads. */
export type PlanBook = {
  engagements: Engagement[]
  clients: Client[]
  allocations: Allocation[]
  expenses: CompanyExpense[]
  collaborators: Collaborator[]
  assignments: Assignment[]
}

/** The Plan page's committed Projection: one engine, no second computation. */
export function planProjection(book: PlanBook, from: string, months: number): ProjectionMonth[] {
  return buildProjection({
    sources: toRevenueSources({ engagements: book.engagements, opportunities: [], clients: book.clients, scenario: "committed" }),
    allocations: book.allocations,
    fromMonth: from,
    months,
    companyExpenses: book.expenses,
    collaborators: book.collaborators,
    assignments: book.assignments,
  })
}

/** Revenue, costs by kind and net over some months of a Projection. */
export function planTotals(months: readonly ProjectionMonth[]) {
  const sum = (f: (m: ProjectionMonth) => number) => round2(months.reduce((s, m) => s + f(m), 0))
  const revenue = sum((m) => m.revenue)
  const costs = sum((m) => m.costs)
  return { revenue, collaborators: sum((m) => m.collaborators), otherCosts: sum((m) => m.otherCosts), costs, net: round2(revenue - costs) }
}

const MARGIN_MONTHS = 6

/**
 * What a collaborator change moves, taken before and after (figureChanges says what differs): the
 * Plan's collaborators cost and net over the next 12 months, and with `engagementId` that contract's
 * margin over the next 6 (revenue less its collaborators, as the client page's table).
 */
export function planFigures(book: PlanBook, from: string, engagementId?: string): Map<string, number | null> {
  const t = planTotals(planProjection(book, from, 12))
  const out = new Map<string, number | null>([
    ["Collaborators cost, next 12 months", t.collaborators],
    ["Plan net, next 12 months", t.net],
  ])
  const contract = engagementId ? book.engagements.find((e) => e.id === engagementId) : undefined
  if (contract) {
    const cells = new Map(
      [...planCells(book.engagements, book.allocations, from)].filter(([k]) => k.startsWith(`${contract.id}:`)).map(([k, c]) => [k.slice(contract.id.length + 1), c]),
    )
    const { total } = marginTable({
      engagement: contract,
      assignments: onContract(book.assignments, contract.id),
      live: onContract(liveAssignments(book.assignments, book.collaborators), contract.id),
      cells,
      timecards: [],
      months: monthSpanList(from, MARGIN_MONTHS),
      today: `${from}-01`,
    })
    out.set(`Margin on ${contractLabel(contract, book.clients)}, next ${MARGIN_MONTHS} months`, total.margin)
  }
  return out
}

const monthSpanList = (from: string, n: number) => Array.from({ length: n }, (_, i) => monthShift(from, i))

// ─── Revenue ─────────────────────────────────────────────────────────────────

/**
 * The month cells for an inclusive [from, to] window, walked from this month when the
 * window starts later — the Plan's origin. Budgets burn from each contract's start
 * (#155), but a contract with no start and no row before the walk begins it with a
 * full budget: walked from `from`, it had a fresh one in every future month asked
 * about (#159). So a window from this month on agrees with the Plan page, provided
 * `allocations` includes the rows before `from`: pass them all, as the UI does. A
 * window starting in the past walks from its own start.
 */
export function revenueCells(input: {
  sources: RevenueSource[]
  allocations: Allocation[]
  from: string
  to: string
}): AllocationCell[] {
  const thisMonth = format(new Date(), "yyyy-MM")
  const origin = input.from < thisMonth ? input.from : thisMonth
  return resolveAllocationGrid({
    sources: input.sources,
    allocations: input.allocations,
    fromMonth: origin,
    months: monthSpan(origin, input.to),
  }).filter((c) => c.yearMonth >= input.from)
}

/** Days or hours, never both: the pair a group counts in. */
export type RevenueRow = {
  key: string
  revenue: number
  plannedDays?: number
  billableDays?: number
  plannedHours?: number
  billableHours?: number
}

/**
 * Groups cells and sums per-cell revenue exactly as `buildProjection` does:
 * `round2(billableDays × weight × dailyRate)` per cell, `round2` per group.
 * A group whose every cell is `isHourly` names its amounts in hours (plannedHours,
 * billableHours), as get_plan does; one with any day contract keeps days.
 */
export function groupRevenue(
  cells: AllocationCell[],
  groupBy: "month" | "quarter" | "client",
  isHourly: (sourceId: string) => boolean = () => false
): RevenueRow[] {
  const rows = new Map<string, { key: string; revenue: number; plannedDays: number; billableDays: number; hourly: boolean }>()
  for (const cell of cells) {
    const key =
      groupBy === "month" ? cell.yearMonth : groupBy === "quarter" ? quarterOf(cell.yearMonth) : cell.clientName
    const row = rows.get(key) ?? { key, revenue: 0, plannedDays: 0, billableDays: 0, hourly: true }
    row.revenue += round2(cell.billableDays * cell.weight * cell.dailyRate)
    row.plannedDays += cell.plannedDays
    row.billableDays += cell.billableDays
    row.hourly &&= isHourly(cell.sourceId)
    rows.set(key, row)
  }
  const result = Array.from(rows.values()).map(({ hourly, ...r }): RevenueRow =>
    hourly
      ? { key: r.key, revenue: round2(r.revenue), plannedHours: inContractUnit(r.plannedDays, "hour"), billableHours: inContractUnit(r.billableDays, "hour") }
      : { ...r, revenue: round2(r.revenue) }
  )
  return groupBy === "client"
    ? result.sort((a, b) => b.revenue - a.revenue)
    : result.sort((a, b) => a.key.localeCompare(b.key))
}

export type InvoiceRow = { key: string; revenue: number; vat: number; count: number }

/**
 * Sibling of `groupRevenue` for real invoices: same keys, same rounding, same
 * sort — but no plannedDays/billableDays, which would be meaningless zeros here.
 * `revenue` is the imponibile so an invoiced row is directly comparable with an
 * accrued one; VAT is reported apart because it is never revenue.
 *
 * The caller supplies `yearMonth` — competenza for basis 'invoiced', the paidDate
 * month for 'paid' — so this function never has to know which one it is looking at.
 * Amounts may be negative (nota di credito) and simply reduce their group.
 */
export function groupInvoices(
  items: { yearMonth: string; clientName: string; amount: number; vat: number }[],
  groupBy: "month" | "quarter" | "client"
): InvoiceRow[] {
  const rows = new Map<string, InvoiceRow>()
  for (const item of items) {
    const key =
      groupBy === "month" ? item.yearMonth : groupBy === "quarter" ? quarterOf(item.yearMonth) : item.clientName
    const row = rows.get(key) ?? { key, revenue: 0, vat: 0, count: 0 }
    row.revenue += item.amount
    row.vat += item.vat
    row.count++
    rows.set(key, row)
  }
  const result = Array.from(rows.values()).map((r) => ({
    ...r,
    revenue: round2(r.revenue),
    vat: round2(r.vat),
  }))
  return groupBy === "client"
    ? result.sort((a, b) => b.revenue - a.revenue)
    : result.sort((a, b) => a.key.localeCompare(b.key))
}

// ─── Invoices to record ──────────────────────────────────────────────────────

/**
 * Ready to Invoice's drafts for each client owed something: one per run of fully
 * open months, due as the customer's last invoice was, numbered in turn across the
 * clients (two drafts never share a number), largest toInvoice first, ties in the
 * order given. get_unbilled and get_month_end both pass every client's billing in
 * the clients' order, so the two propose the same number for the same invoice.
 */
export function invoiceDrafts(input: { invoices: Invoice[]; engagements: Engagement[]; billed: ClientBilling[]; today: string }) {
  const { invoices, engagements, today } = input
  let numbered: Pick<Invoice, "id" | "number" | "amount" | "createdAt">[] = invoices
  const owed = input.billed.filter((b) => (b.toInvoice ?? 0) > 0).sort((x, y) => (y.toInvoice ?? 0) - (x.toInvoice ?? 0))
  return new Map(
    owed.map((b) => {
      const own = invoices.filter((i) => invoiceClientId(i, engagements) === b.clientId)
      const drafts = invoiceSuggestions(b).map(({ fromMonth, yearMonth, months, hours, amount, vat }) => {
        const number = nextInvoiceNumber(numbered, { today })
        if (number) numbered = [...numbered, { id: "", number, amount, createdAt: new Date() }]
        const due = suggestedDueDate(own, yearMonth, today)
        return { fromMonth, yearMonth, months, hours, amount, vat, number: number || null, dueDate: due?.date ?? null, dueBasis: due?.basis ?? null }
      })
      return [b.clientId, drafts] as const
    }),
  )
}

// ─── Month End ───────────────────────────────────────────────────────────────

const MONTH_NAMES = Array.from({ length: 12 }, (_, k) => format(new Date(2000, k, 1), "MMMM").toLowerCase())

/**
 * The month get_month_end closes: none = the last month that has ended; an English
 * month name ("September", "sep") = its most recent ended occurrence, so December
 * asked in January is last year's; YYYY-MM as given. The current month or a later
 * one is refused: a month closes once it has ended.
 */
export function monthToClose(input: string | undefined, today: string): string {
  const current = today.slice(0, 7)
  const last = monthShift(current, -1)
  if (input === undefined) return last
  const s = input.trim().toLowerCase()
  const k = s.length >= 3 ? MONTH_NAMES.findIndex((n) => n.startsWith(s)) : -1
  if (k >= 0) {
    const ym = `${current.slice(0, 4)}-${String(k + 1).padStart(2, "0")}`
    return ym < current ? ym : monthShift(ym, -12)
  }
  if (!/^\d{4}-/.test(s)) throw new ToolInputError(`Invalid month: "${input}". Use YYYY-MM, or an English month name such as September.`)
  const month = normalizeMonth(s)
  const refused = monthNotEnded(month, today)
  if (refused) throw new ToolInputError(`${refused} Ask for ${last} or earlier.`)
  return month
}

/** What to call next for an open Month End item: a tool with the arguments the data holds, or the app. */
export type MonthEndNext = { tool: string; args: Record<string, unknown>; note?: string } | { app: string }

const EDIT_TOOL = { movement: "update_movement", expense: "update_expense", loan: "update_loan", invoice: "update_invoice" } as const

/**
 * Each open Month End item's next step: the write tool that fixes it, with the
 * arguments the data already holds (the owner gives the rest), or the app where no
 * tool can. Some records the checklist names only in its text (a month to invoice,
 * the misdated invoice, the unlinked payment, a Missing IN's invoice, a To Chase
 * row) are found again with month-end.ts's own rules, in its own order.
 * ponytail: those rules are restated here; read the item's own fields once
 * month-end.ts carries them (Month End PR 3).
 */
export function monthEndNext(checklist: MonthEnd, data: MonthEndData, today: string, invoicing = true): Map<MonthEndItem, MonthEndNext[]> {
  const { month, end, steps } = checklist
  const { engagements, invoices, expenses, accounts } = data
  const out = new Map<MonthEndItem, MonthEndNext[]>()
  const monthName = formatYearMonth(month, "MMMM")
  const clientName = (id: string | null) => data.clients.find((c) => c.id === id)?.name ?? "Unknown client"
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "an account that no longer exists"
  const { rows, counted } = bookRows(data)

  const hours = monthHours(data.timecards, today)
  for (const i of steps.hours.items) {
    if (i.kind === "hours_outside") {
      out.set(i, [{ app: `In the app only: Clients → ${clientName(i.ref)}, the contract's start month. No tool sets it.` }])
      continue
    }
    const e = engagements.find((c) => c.id === i.ref)
    if (!e) continue
    const plan = { client: clientName(e.clientId), engagementId: e.id, month, mode: "set" }
    if (i.kind === "hours_missing") {
      out.set(i, [
        { tool: "log_time", args: { engagementId: e.id }, note: `One call per day worked in ${monthName}: date, and hours (the day's total).` },
        { tool: "log_allocation", args: { ...plan, days: 0 }, note: "No work that month: sets it to 0 days." },
      ])
    } else if (i.kind === "hours_use") {
      const days = hours.byCell.get(`${e.id}:${month}`)?.days ?? 0
      out.set(i, [{ tool: "log_allocation", args: { ...plan, days }, note: "Use: puts the days logged in the plan." }])
    } else if (i.kind === "hours_over") {
      out.set(i, [
        { tool: "list_time", args: { from: month, engagementId: e.id }, note: "Find the hours on the wrong day or contract." },
        { tool: "log_time", args: { engagementId: e.id }, note: "Then correct each wrong day: date, hours and replace true (hours 0 removes it)." },
      ])
    }
  }

  // A client's open months, oldest first, one item each: month-end.ts's order.
  const invoiceItems = steps.invoices.items.filter((i) => i.kind !== "invoice_covered")
  // Every client, as get_unbilled numbers them: a later month or another client's draft takes a number too.
  const billed = new Map(
    data.clients.map((c) => [c.id, clientBilling({ clientId: c.id, engagements, timecards: data.timecards, invoices, today })]),
  )
  const drafts = invoiceDrafts({ invoices, engagements, billed: [...billed.values()], today })
  for (const clientId of new Set(invoiceItems.map((i) => i.ref ?? ""))) {
    const b = billed.get(clientId)
    if (!b) continue
    const open = b.months.filter((m) => m.yearMonth <= month && m.unbilled > 0).reverse()
    const client = clientName(clientId)
    invoiceItems
      .filter((i) => i.ref === clientId)
      .forEach((i, k) => {
        const m = open[k]
        // Every month with something unbilled is in one of Ready to Invoice's runs.
        const draft = m && drafts.get(clientId)?.find((d) => d.months.includes(m.yearMonth))
        if (!m || !draft || i.kind === "invoice_provisional") return
        const record: MonthEndNext = {
          tool: "create_invoice",
          args: {
            client,
            ...(draft.number && { number: draft.number }),
            ...(draft.fromMonth && { fromMonth: draft.fromMonth }),
            yearMonth: draft.yearMonth,
            amount: draft.amount,
            vat: draft.vat,
            ...(draft.dueDate && { dueDate: draft.dueDate }),
          },
          note:
            `Ready to Invoice's draft${draft.months.length > 1 ? `, one invoice for ${invoicePeriodLabel(draft)}` : ""}: ` +
            (draft.number ? "confirm the number with the owner, the accountant assigns it." : "number from the owner."),
        }
        if (i.kind === "invoice_credited") {
          out.set(i, [{ ...record, note: `Only if the credit note was not a discount: re-invoice it. ${record.note}` }])
        } else if (i.kind === "invoice_misdated") {
          // As month-end.ts finds it: a later invoice of the client's still running into the current month.
          const misdated = invoices.find(
            (inv) =>
              inv.amount > 0 &&
              invoiceClientId(inv, engagements) === clientId &&
              periodMonths(inv)[0] > m.yearMonth &&
              inv.yearMonth >= today.slice(0, 7),
          )
          const ym = formatYearMonth(m.yearMonth, "MMMM")
          out.set(i, [
            {
              tool: "update_invoice",
              args: { ...(misdated && { invoice: misdated.number }), fromMonth: null, yearMonth: m.yearMonth },
              note: `Only if ${misdated?.number ?? "the invoice the detail names"} is the ${ym} invoice: ask the owner first.`,
            },
            { ...record, note: `If it is not: record the ${ym} invoice. ${record.note}` },
          ])
        } else {
          out.set(i, [record])
        }
      })
  }

  for (const i of steps.waiting.items) {
    const inv = invoices.find((x) => x.id === i.ref)
    if (!inv) continue
    const account = accounts.length > 0 ? (inv.amount < 0 ? ", and account (the company account it was refunded from, or \"none\" for an offset)" : ", and account (the company account it arrived on)") : ""
    const when = inv.amount < 0 ? "Once settled" : "Once paid"
    out.set(i, [{ tool: "mark_invoice_paid", args: { invoice: inv.number }, note: `${when}: paidDate${account}.` }])
  }

  for (const i of steps.files.items) {
    if (i.status === "check") out.set(i, [{ app: "In the app only: Month End → Invoice Files → Attach File. No tool attaches a file." }])
  }

  const owed = supplierDocuments(expenses, data.movements).docs
  for (const i of steps.suppliers.items) {
    const doc = owed.find((d) => d.expense.id === i.ref)
    if (!doc) continue
    out.set(i, [
      {
        tool: "add_expense",
        args: { supplierInvoice: doc.expense.documentRef ?? doc.expense.id, description: "Supplier Invoice Payment", total: doc.owed },
        note: "Once paid: paidFrom (the company account it left) and date; total is what was paid, at most what is owed.",
      },
    ])
  }

  const weekAfter = isoDate(addDays(parseISO(end), 7))
  for (const i of steps.recurring.items) {
    const e = expenses.find((x) => x.id === i.ref)
    if (!e) continue
    const vat = e.vat ?? 0
    const pay: MonthEndNext = {
      tool: "add_expense",
      args: { description: e.description, total: round2(priceIn(e, month) + vat), ...(vat > 0 && { vat }), category: e.category, paysRecurring: e.id, date: end },
      note: `If it was paid in ${monthName}: paidFrom (the company account, or "owner" for the personal card), and the real date and total.`,
    }
    // month-end.ts's two hints: a one-off of its category paid in the month naming no estimate, else a linked payment just after.
    const unlinked = expenses.find(
      (c) => !c.isRecurring && c.amount > 0 && !c.recurringExpenseId && c.category === e.category && isoDate(c.date).slice(0, 7) === month,
    )
    const late = expenses.find((c) => !c.isRecurring && c.recurringExpenseId === e.id && isoDate(c.date) > end && isoDate(c.date) <= weekAfter)
    const fix: MonthEndNext[] = unlinked
      ? [{ tool: "update_expense", args: { id: unlinked.id, paysRecurring: e.id }, note: `If "${unlinked.description}" was this payment.` }]
      : late
        ? [{ tool: "update_expense", args: { id: late.id, date: end }, note: `If the ${dayLabel(isoDate(late.date))} payment was for ${monthName}.` }]
        : []
    out.set(i, [...fix, pay])
  }

  for (const i of steps.bank.items) {
    const a = accounts.find((x) => x.id === i.ref)
    if (!a || i.status !== "todo") continue
    const check = statementCheck(a, counted)
    // A later check that doesn't match: fixed first, then checked again on its own day.
    const next: MonthEndNext[] =
      i.month && check.status !== "not_checked"
        ? [
            { tool: "get_cash_book", args: { period: i.month, account: a.name }, note: `The ${dayLabel(check.day)} check doesn't match the bank: find the missing or wrong row and fix it first.` },
            { tool: "check_balance", args: { account: a.name, date: check.day }, note: "Then check that day again: balance from the statement." },
          ]
        : [{ tool: "check_balance", args: { account: a.name, date: end }, note: `balance: the statement's balance at the end of ${dayLabel(end)}.` }]
    if (check.status === "missing_in") {
      for (const inv of invoices) {
        const gap = invoiceTotal(inv) - check.difference
        if (inv.paidDate || inv.amount <= 0 || gap < 0 || gap > MAX_BANK_FEE) continue
        // Short by a bank fee: received books it, or the full total would leave a Missing OUT.
        const fee = gap > 0.005
        next.push({
          tool: "mark_invoice_paid",
          args: { invoice: inv.number, paidDate: check.day, account: a.name, ...(fee && { received: round2(check.difference) }) },
          note:
            `If this invoice was paid: it would explain the Missing IN${fee ? `, ${eurCents(round2(gap))} short booked as a bank fee` : ""}. ` +
            `paidDate: confirm with the owner the day it reached the bank, from the statement, on or before ${dayLabel(check.day)}.`,
        })
      }
    }
    out.set(i, next)
  }

  // To Chase: the same list, filtered as month-end.ts filters it, in its order.
  const chase = toChase({ accounts, rows, invoices, expenses, invoicing }).filter((c) => chaseDay(c) <= end)
  steps.chase.items.forEach((i, k) => {
    const c = chase[k]
    if (c) out.set(i, chaseNext(c, accountName))
  })

  for (const i of steps.deadlines.items) {
    if (i.ref) out.set(i, [{ tool: "complete_deadline", args: { deadline: i.ref } }])
  }
  return out
}

/** A To Chase item's fix: the edit tool of the entry it is about, or the rows to look through. */
function chaseNext(c: ChaseItem, accountName: (id: string) => string): MonthEndNext[] {
  // An invoice's payment can't change account: it is marked unpaid, then paid again on the right one.
  const repay = (number: string, paidDate: string): MonthEndNext[] => [
    { tool: "update_invoice", args: { invoice: number, paidDate: null }, note: "First mark it unpaid (preview, then confirm)." },
    { tool: "mark_invoice_paid", args: { invoice: number, paidDate }, note: "Then paid again, with account: the company account it arrived on." },
  ]
  switch (c.kind) {
    case "negative":
      return [
        {
          tool: "get_cash_book",
          args: { period: c.day.slice(0, 7), account: accountName(c.accountId) },
          note: "A bank account can't go below zero: a row is missing, or has the wrong date or account. Find it, then add it or correct it.",
        },
      ]
    case "no_account":
      return repay(c.invoice.number, isoDate(c.invoice.paidDate!))
    case "no_document":
      return [{ tool: "update_expense", args: { id: c.expense.id }, note: "documentRef: the supplier's invoice or receipt number." }]
    default: {
      const { row } = c
      const account = row.source === "expense" ? "paidFrom" : "account"
      const fix =
        c.kind === "estimated"
          ? `${row.source === "invoice" ? "paidDate" : "date"}: the real day, from the bank statement.`
          : c.kind === "before_opening"
            ? `date: the real day if it is wrong, or ${account}: the account it went through. Or move ${accountName(row.accountId)}'s opening date, in the app only (Cash Book).`
            : `${account}: a company account that exists.`
      if (row.source === "invoice") return c.kind === "estimated" ? [{ tool: "update_invoice", args: { invoice: row.sourceId }, note: fix }] : repay(row.sourceId, row.day)
      return [{ tool: EDIT_TOOL[row.source], args: { id: row.sourceId }, note: fix }]
    }
  }
}

/** The months whose Plan figures a cost or income dated `entries` can move: a payment covers its estimate's period, or the payment month nearest it. */
export function planMonths(entries: { date: Date; recurringExpenseId?: string | null }[], expenses: CompanyExpense[]): string[] {
  const out = new Set<string>()
  for (const e of entries) {
    const own = isoDate(e.date).slice(0, 7)
    const estimate = expenses.find((x) => x.id === e.recurringExpenseId)
    if (estimate && countedWhenPaid(estimate)) {
      out.add(own)
      out.add(nearestPaymentMonth(estimate, own))
      continue
    }
    const every = estimate?.recurrenceMonths ?? 1
    for (let k = 0; k < Math.max(1, every); k++) out.add(monthShift(own, k))
  }
  return [...out].sort()
}

/** What a read says of a row's invoice file: enough to see it is there; get_file fetches it. null = none. */
export function fileSummary(file: InvoiceFile | null | undefined): { name: string; kind: InvoiceFile["kind"]; size: number } | null {
  return file ? { name: file.name, kind: file.kind, size: file.size } : null
}
