import { format } from "date-fns"

import { z } from "@/lib/zod"

import type {
  Assignment,
  Collaborator,
  CollaboratorFee,
  FeeChange,
  CreateAssignmentInput,
  UpdateAssignmentInput,
  CreateCollaboratorInput,
  CreateJournalEntryInput,
  CreateSolutionInput,
  JournalEntry,
  Solution,
  SolutionEntity,
  SolutionRelation,
  SolutionKind,
  SolutionSectionKey,
  SolutionSections,
  SolutionStep,
  UpdateCollaboratorInput,
  UpdateJournalEntryInput,
  UpdateSolutionInput,
} from "./crm"

// ─── Auth Schemas ─────────────────────────────────────────────────────────────

export const signInSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
})
export type SignInFormValues = z.infer<typeof signInSchema>

/** Zod schemas: the sign-in form and the company side's records. */

// ─── Company Expense Schemas ────────────────────────────────────────────────

export const companyExpenseCategorySchema = z.enum([
  "rent", "software", "accountant", "insurance", "office_supplies",
  "travel", "marketing", "legal", "bank_fees", "collaborators", "other",
])

// The same checks as company_expenses and company_loans in firestore/crm.rules.
// The cross-field ones sit on the create schema only: a partial update cannot see
// the stored document, so the mock parses the merged document with the create
// schema, exactly as the rules read incoming() (the merged document) on update.

// A recurring estimate's dated price changes: the shape and cap of a collaborator's fee changes (FeeChange),
// with the estimate's wording.
const MAX_PRICE_CHANGES = 24
const priceMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month")
const priceChangeSchema = z.object({
  from: priceMonth,
  amount: z.number().gt(0, "The price is more than 0").max(1_000_000, "The price is too large"),
})

// The invoice file a cost or an invoice keeps: the pointer to its object in Storage (firestore/crm.rules checks the same shape).
export const invoiceFileSchema = z.object({
  path: z.string().min(1).max(300),
  name: z.string().min(1).max(255),
  kind: z.enum(["xml", "p7m", "pdf"]),
  size: z.number().int().min(0).max(10 * 1024 * 1024),
  uploadedAt: z.date(),
})

const companyExpenseFields = z.object({
  description: z.string().min(1, "Description is required").max(300),
  category: companyExpenseCategorySchema,
  // Net of recoverable VAT. Negative only on a refund (a one-off paid back into an account).
  amount: z.number().finite().refine((n) => n !== 0, "Amount can't be 0"),
  date: z.date(),
  isRecurring: z.boolean().optional(),
  recurrenceMonths: z.number().int().positive().nullable().optional(),
  notes: z.string().max(500).nullish(),
  // The company account it was paid from (the cash book).
  accountId: z.string().min(1).max(200).nullish(),
  // Paid with the owner's personal card: the company owes the owner.
  paidByOwner: z.boolean().optional(),
  // Recoverable VAT on top of amount; null = written before it.
  vat: z.number().finite().nullish(),
  documentRef: z.string().max(100).nullish(),
  // The cost centre.
  project: z.string().max(60).nullish(),
  recurringExpenseId: z.string().min(1).max(200).nullish(),
  dateEstimated: z.boolean().optional(),
  importRef: z.string().max(40).nullish(),
  // A collaborator's invoice: who, which contract (null = fixed fee) and the month of work it pays.
  collaboratorId: z.string().min(1).max(200).nullish(),
  engagementId: z.string().min(1).max(200).nullish(),
  forMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "For Month is a month, YYYY-MM").nullish(),
  // A rent offset: the lease it is netted against; its month is forMonth.
  leaseId: z.string().min(1).max(200).nullish(),
  // A recurring estimate's last month, its dated price changes, and whether the Plan counts it whole in the
  // months it is paid (absent or false = spread, as before these fields).
  endMonth: priceMonth.nullish(),
  priceChanges: z.array(priceChangeSchema).max(MAX_PRICE_CHANGES).optional(),
  countedWhenPaid: z.boolean().optional(),
  file: invoiceFileSchema.nullish(),
})

type ExpenseShape = Partial<z.infer<typeof companyExpenseFields>>

export const createCompanyExpenseSchema = companyExpenseFields.superRefine((e: ExpenseShape, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message })
  const paid = e.accountId != null || e.paidByOwner === true
  if (e.isRecurring && (paid || e.recurringExpenseId != null)) {
    issue("isRecurring", "A recurring estimate isn't paid: record each payment as a one-off cost")
  }
  if (e.accountId != null && e.paidByOwner) issue("paidByOwner", "Paid from a company account or by the owner, not both")
  if (e.amount !== undefined && e.amount < 0 && (e.isRecurring || e.accountId == null)) {
    issue("amount", "Only a refund into a company account is negative")
  }
  if (e.vat != null && e.amount !== undefined && e.vat !== 0 && e.vat > 0 !== e.amount > 0) {
    issue("vat", "VAT has the sign of the amount")
  }
  const start = e.date instanceof Date ? format(e.date, "yyyy-MM") : null
  if (e.endMonth && start && e.endMonth < start) issue("endMonth", "The end is before the start")
  const seen = new Set<string>()
  e.priceChanges?.forEach((c, i) => {
    if (start && c.from <= start) issue("priceChanges", `Change ${i + 1} starts after the cost does`)
    if (e.endMonth && c.from > e.endMonth) issue("priceChanges", `Change ${i + 1} falls after the end`)
    if (seen.has(c.from)) issue("priceChanges", "Two changes start in the same month")
    seen.add(c.from)
  })
})

export const updateCompanyExpenseSchema = companyExpenseFields.partial()

// ─── Company Loan Schemas ───────────────────────────────────────────────────

export const companyLoanDirectionSchema = z.enum(["to_company", "from_company"])

export const createCompanyLoanSchema = z.object({
  description: z.string().min(1, "Description is required").max(300),
  direction: companyLoanDirectionSchema,
  amount: z.number().positive("Amount must be positive").finite(),
  date: z.date(),
  notes: z.string().max(500).nullish(),
  // The company account the money went through (the cash book).
  accountId: z.string().min(1).max(200).nullish(),
  dateEstimated: z.boolean().optional(),
  importRef: z.string().max(40).nullish(),
})

export const updateCompanyLoanSchema = createCompanyLoanSchema.partial()

// ─── Company Cash Book Schemas ──────────────────────────────────────────────
//
// The same checks as company_accounts and company_movements in firestore/crm.rules.
// There is no update schema: a partial update cannot see the stored document, so
// the mock parses the merged document with these, exactly as the rules read
// incoming() (the merged document) on update.

const statementPaired = (v: { statementBalance?: number | null; statementDate?: Date | null }) =>
  (v.statementBalance == null) === (v.statementDate == null)

export const createCompanyAccountSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100),
    openingBalance: z.number().finite(),
    openingDate: z.date(),
    statementBalance: z.number().finite().nullish(),
    statementDate: z.date().nullish(),
    importRef: z.string().max(40).nullish(),
  })
  .refine(statementPaired, { path: ["statementDate"], message: "A bank balance needs its date" })

export const companyMovementKindSchema = z.enum([
  "transfer", "income", "client_income", "deposit_held", "deposit_paid",
  "capital", "vat", "tax", "compensation", "supplier_payment",
])

export const createCompanyMovementSchema = z
  .object({
    kind: companyMovementKindSchema,
    direction: z.enum(["in", "out"]),
    amount: z.number().positive("Amount must be positive").finite(),
    date: z.date(),
    accountId: z.string().min(1, "Account is required").max(200),
    toAccountId: z.string().min(1).max(200).nullish(),
    expenseId: z.string().min(1).max(200).nullish(),
    description: z.string().min(1, "Description is required").max(300),
    documentRef: z.string().max(100).nullish(),
    project: z.string().max(60).nullish(),
    counterparty: z.string().max(100).nullish(),
    notes: z.string().max(1000).nullish(),
    dateEstimated: z.boolean().optional(),
    importRef: z.string().max(40).nullish(),
    // Rent module: the lease, the month it covers and the part it pays (rent or contribution).
    leaseId: z.string().min(1).max(200).nullish(),
    rentMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Rent month is a month, YYYY-MM").nullish(),
    rentPart: z.enum(["rent", "contribution"]).nullish(),
  })
  .refine((m) => (m.rentPart == null && m.rentMonth == null) || m.kind === "income", {
    path: ["rentPart"],
    message: "Only rent and other income can be a rent payment",
  })
  .refine(
    (m) => m.kind !== "transfer" || (m.direction === "out" && m.toAccountId != null && m.toAccountId !== m.accountId),
    { path: ["toAccountId"], message: "A transfer goes out to a different account" },
  )
  .refine((m) => m.kind === "transfer" || m.toAccountId == null, {
    path: ["toAccountId"],
    message: "Only a transfer has a destination account",
  })
  .refine((m) => (m.kind === "supplier_payment") === (m.expenseId != null), {
    path: ["expenseId"],
    message: "A supplier payment names the supplier invoice it pays, and nothing else does",
  })

// ─── CRM Schemas ────────────────────────────────────────────────────────────

export const yearMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Must be YYYY-MM format")

export const opportunityStageSchema = z.enum([
  "lead",
  "proposal",
  "negotiation",
  "won",
  "lost",
])

export const createClientSchema = z.object({
  name: z.string().min(1, "Client name is required").max(200),
  vatNumber: z.string().max(20).nullish(),
  email: z.string().email("Invalid email").max(200).nullish(),
  contactName: z.string().max(200).nullish(),
  contactPhone: z.string().max(40).nullish(),
  notes: z.string().max(1000).nullish(),
})

export const updateClientSchema = createClientSchema.partial().extend({
  isActive: z.boolean().optional(),
})

export const contractUnitSchema = z.enum(["day", "hour"])

export const createOpportunitySchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  title: z.string().min(1, "Title is required").max(200),
  stage: opportunityStageSchema,
  probability: z.number().min(0).max(100).finite(),
  dailyRate: z.number().positive("Rate must be positive").finite(),
  estimatedDaysPerMonth: z.number().min(0).max(31).finite(),
  unit: contractUnitSchema.optional(),
  estimatedDurationMonths: z.number().int().positive().max(120).finite(),
  expectedStartMonth: yearMonthSchema.nullish(),
  vatApplicable: z.boolean(),
  nextActionDate: z.date().nullish(),
  nextActionNote: z.string().max(500).nullish(),
  notes: z.string().max(1000).nullish(),
  // On the form so a deal marked lost can say why — the pipeline renders it.
  lostReason: z.string().max(500).nullish(),
})

export const updateOpportunitySchema = createOpportunitySchema.partial().extend({
  closedAt: z.date().nullish(),
  engagementId: z.string().nullish(),
})

const engagementFields = z.object({
  clientId: z.string().min(1, "Client is required"),
  name: z.string().trim().max(120).nullish(),
  opportunityId: z.string().nullish(),
  dailyRate: z.number().positive("Rate must be positive").finite(),
  unit: contractUnitSchema.optional(),
  vatApplicable: z.boolean(),
  contractedDays: z.number().positive("Must be positive").finite().nullable().optional(),
  defaultDaysPerMonth: z.number().min(0).max(31).finite(),
  startMonth: yearMonthSchema.nullish(),
  endMonth: yearMonthSchema.nullish(),
  // The last day hours go on; endMonth is its month (endFields writes both).
  endDate: z.iso.date("Invalid date: use YYYY-MM-DD").nullish(),
  notes: z.string().max(1000).nullish(),
})

// A contract ending before it starts would bill nothing at all. Checked only when
// both are in hand — an update carrying one of them cannot see the other. The end
// is the effective one (endDate's month, else endMonth: a conversion's planned end
// has no day), and the error sits under the End date field the dialog shows.
// Zod 4 refuses .partial()/.omit() on a refined object, hence refining each schema.
const endNotBeforeStart = (v: { startMonth?: string | null; endMonth?: string | null; endDate?: string | null }) => {
  const end = v.endDate?.slice(0, 7) ?? v.endMonth
  return !v.startMonth || !end || end >= v.startMonth
}
const endBeforeStart = { path: ["endDate"], message: "The end date cannot be before the start month" }

export const createEngagementSchema = engagementFields.refine(endNotBeforeStart, endBeforeStart)

export const updateEngagementSchema = engagementFields
  .partial()
  .omit({ opportunityId: true })
  .extend({ isActive: z.boolean().optional() })
  .refine(endNotBeforeStart, endBeforeStart)

/** Kept in step with the size guard on engagements in firestore/crm.rules. */
export const MAX_AMENDMENTS = 24
/** What one amendment may set: a day rate, and days added at once. */
export const MAX_AMENDMENT_RATE = 100_000
export const MAX_ADDED_DAYS = 1000

// Not in engagementFields: the Edit form re-sends every field it has on each save,
// so it must never carry the list. Every field is present, null when unused.
export const contractAmendmentSchema = z
  .object({
    from: yearMonthSchema,
    dailyRate: z.number().positive().finite().nullable(),
    addedDays: z.number().positive().finite().nullable(),
    lastDay: z.iso.date().nullable(),
    lastDayBefore: z.iso.date().nullable(),
    note: z.string().max(200).nullable(),
  })
  .refine((a) => a.dailyRate !== null || a.addedDays !== null || a.lastDay !== null, {
    message: "An amendment changes the day rate, the days or the end",
  })

export const createTaskSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  // null or omitted = a client-level task (#164)
  engagementId: z.string().min(1).nullish(),
  title: z.string().min(1, "Title is required").max(200),
  dueDate: z.date().nullish(),
  notes: z.string().max(1000).nullish(),
})

export const updateTaskSchema = createTaskSchema
  .partial()
  .extend({ isDone: z.boolean().optional() })

// Neither amount nor vat is constrained to be positive: a nota di credito is a
// negative invoice, which is the entire credit-note feature for no extra code.
export const createInvoiceSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  number: z.string().min(1, "Invoice number is required").max(50),
  fromMonth: yearMonthSchema.nullish(),
  yearMonth: yearMonthSchema,
  amount: z.number().finite(),
  vat: z.number().finite(),
  dueDate: z.date().nullish(),
  paidDate: z.date().nullish(),
  // The company account the payment landed on. No rule ties it to paidDate: an
  // untick sends {paidDate: null} alone, and the stale account is ignored on read.
  paidAccountId: z.string().min(1).max(200).nullish(),
  file: invoiceFileSchema.nullish(),
})

export const updateInvoiceSchema = createInvoiceSchema.partial().omit({ clientId: true })

export const companyDeadlineKindSchema = z.enum(["tax", "contract", "admin", "other"])

export const createCompanyDeadlineSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  date: z.date(),
  kind: companyDeadlineKindSchema,
  amount: z.number().min(0).finite().nullish(),
  notes: z.string().max(1000).nullish(),
})

export const updateCompanyDeadlineSchema = createCompanyDeadlineSchema.partial().extend({
  isDone: z.boolean().optional(),
})

export const createAllocationSchema = z.object({
  engagementId: z.string().min(1, "Engagement is required"),
  yearMonth: yearMonthSchema,
  days: z.number().min(0, "Days cannot be negative").max(31).finite(),
})

export const updateAllocationSchema = z.object({
  days: z.number().min(0).max(31).finite().optional(),
})

// z.iso.date() is a calendar-aware regex: it refuses 2026-02-30 and 2026-02-29,
// not only malformed strings, so a timecard can never land on a day that does not exist.
export const setTimecardSchema = z.object({
  engagementId: z.string().min(1, "Contract is required"),
  date: z.iso.date("Invalid date: use YYYY-MM-DD"),
  /** Omitted or null = the owner's own hours. */
  collaboratorId: z.string().min(1).nullish(),
  hours: z
    .number()
    .positive("Hours must be more than 0")
    .max(24, "At most 24 hours in a day")
    .finite(),
  notes: z.string().max(1000).nullish(),
})

// A verbale's date and time are the strings as typed, checked for real days and
// real minutes (2026-02-30 and 24:00 fail). Future dates are refused by the dialog
// and the tools, not here: the browser's "today" and the server's can differ.
export const MEETING_TEXT_MAX = 5000

const meetingFields = {
  engagementId: z.string().min(1).nullable(),
  date: z.iso.date("Invalid date: use YYYY-MM-DD"),
  time: z.iso.time({ precision: -1, error: "Invalid time: use HH:MM" }).nullable(),
  health: z.enum(["green", "yellow", "red"]).nullable(),
  text: z
    .string()
    .trim()
    .min(1, "Write what happened")
    .max(MEETING_TEXT_MAX, `At most ${MEETING_TEXT_MAX} characters`),
}

export const createMeetingSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  ...meetingFields,
})

export const updateMeetingSchema = z.object(meetingFields).partial()

// ─── Solution Schemas ───────────────────────────────────────────────────────
//
// Kept in step with solutions in firestore/crm.rules, which repeats the caps and
// the section keys; the rules tests pin the two. The rules check stack, entities
// and relations for type and size only: each element is checked here, on write,
// and mended or dropped on read when it fails (normalizeSolutionStack,
// normalizeSolutionGraph).

/** The nine sections in order, with the question that fills each one (the page's hint, the MCP interview). */
export const SOLUTION_SECTIONS = [
  { key: "purpose", label: "Purpose and Target", question: "Why did the client want it, and what had to change for them?" },
  { key: "requirements", label: "Requirements", question: "What did it have to do, point by point, and under which constraints?" },
  { key: "kpis", label: "KPIs", question: "How was success measured, and from which value to which?" },
  { key: "sources", label: "Data Sources", question: "Which of the client's systems did the data come from, in what format and how often?" },
  { key: "model", label: "Data Model", question: "Which modelling choices did you make, and why? The entities and relations go in the graph." },
  { key: "architecture", label: "Architecture", question: "Which components are there, who talks to whom, and where does each one run?" },
  { key: "steps", label: "Steps", question: "How did you build it, in order?" },
  { key: "history", label: "History", question: "Which decisions changed course, and when? One dated line each." },
  { key: "results", label: "Results", question: "What did it deliver, which numbers did it reach, and what would you do differently?" },
] as const satisfies readonly { key: SolutionSectionKey; label: string; question: string }[]

export const SOLUTION_SECTION_MAX = 20_000
export const MAX_SOLUTION_STACK = 30
export const MAX_SOLUTION_ENTITIES = 100
export const MAX_SOLUTION_RELATIONS = 300

export const MAX_SOLUTION_STEPS = 20
export const SOLUTION_TARGET_MAX = 500

export const solutionStatusSchema = z.enum(["proposed", "building", "delivered", "retired"])

export const solutionKindSchema = z.enum(["product", "advisory"])

/**
 * The sections each kind asks for, in order (the MCP interview, what is missing). The other
 * sections stay available on request, and text stored in Steps and History stays readable:
 * the road and the journal replace them.
 */
export const SOLUTION_KIND_SECTIONS: Record<SolutionKind, readonly SolutionSectionKey[]> = {
  product: ["purpose", "requirements", "kpis", "sources", "model", "architecture", "results"],
  advisory: ["purpose", "kpis", "results"],
}

const stepMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month")

// Every field present, null when unused, like a contract amendment.
export const solutionStepSchema = z
  .object({
    title: z.string().trim().min(1, "Name the step").max(200),
    state: z.enum(["done", "now", "next", "later"]),
    fromMonth: stepMonth,
    toMonth: stepMonth.nullable(),
    paidBy: z.object({ type: z.enum(["contract", "opportunity"]), id: z.string().min(1) }).nullable(),
    goal: z.string().trim().min(1).max(1000).nullable(),
    outcome: z.string().trim().min(1).max(1000).nullable(),
    doneOn: z.iso.date().nullable(),
  })
  .superRefine((s, ctx) => {
    if (s.toMonth && s.toMonth < s.fromMonth) ctx.addIssue({ code: "custom", path: ["toMonth"], message: "The end is before the start" })
  })

export const solutionStepsSchema = z
  .array(solutionStepSchema)
  .max(MAX_SOLUTION_STEPS, `At most ${MAX_SOLUTION_STEPS} steps`)
  .superRefine((steps, ctx) => {
    const now = steps.flatMap((s, i) => (s.state === "now" ? [i] : []))
    if (now.length > 1) ctx.addIssue({ code: "custom", path: [now[1], "state"], message: "Only one step can be Now" })
  })

/** One of the nine section keys, for the sections map and the MCP tools' section input. */
export const solutionSectionKeySchema = z.enum(SOLUTION_SECTIONS.map((s) => s.key) as [SolutionSectionKey, ...SolutionSectionKey[]])

// Every field present, null when unused, like a contract amendment.
export const solutionEntitySchema = z.object({
  name: z.string().trim().min(1, "Name the entity").max(100),
  source: z.string().trim().max(200).nullable(),
  notes: z.string().trim().max(1000).nullable(),
})

export const solutionRelationSchema = z.object({
  from: z.string().trim().min(1).max(100),
  to: z.string().trim().min(1).max(100),
  type: z.string().trim().min(1, "Name the relation").max(60),
})

const solutionTagSchema = z.string().trim().toLowerCase().min(1).max(40)

const solutionShape = z.object({
  clientId: z.string().min(1, "Client is required"),
  name: z.string().trim().min(1, "Name is required").max(200),
  engagementId: z.string().min(1).nullish(),
  status: solutionStatusSchema.optional(),
  kind: solutionKindSchema.optional(),
  target: z.string().trim().min(1).max(SOLUTION_TARGET_MAX, `At most ${SOLUTION_TARGET_MAX} characters`).nullish(),
  steps: solutionStepsSchema.optional(),
  domain: z.string().trim().min(1).max(60).nullish(),
  stack: z
    .array(solutionTagSchema)
    .max(MAX_SOLUTION_STACK, `At most ${MAX_SOLUTION_STACK} technologies`)
    .refine((tags) => new Set(tags).size === tags.length, "List each technology once")
    .optional(),
  // A key outside the nine is refused, not dropped: it would be a section nothing shows.
  sections: z
    .partialRecord(
      solutionSectionKeySchema,
      z.string().max(SOLUTION_SECTION_MAX, `At most ${SOLUTION_SECTION_MAX} characters`).nullable(),
    )
    .optional(),
  entities: z.array(solutionEntitySchema).max(MAX_SOLUTION_ENTITIES, `At most ${MAX_SOLUTION_ENTITIES} entities`).optional(),
  relations: z.array(solutionRelationSchema).max(MAX_SOLUTION_RELATIONS, `At most ${MAX_SOLUTION_RELATIONS} relations`).optional(),
})

type Graph = { entities?: { name: string }[]; relations?: { from: string; to: string }[] }

// Entity names are unique, and a relation names two of them. An update carrying
// relations without entities cannot see the stored ones: solutionFields parses
// the merged document with the create schema, as the mock does for costs.
const checkGraph = ({ entities, relations }: Graph, ctx: z.RefinementCtx) => {
  if (!entities) return
  const names = new Set<string>()
  entities.forEach((e, i) => {
    if (names.has(e.name)) ctx.addIssue({ code: "custom", path: ["entities", i, "name"], message: `"${e.name}" is listed twice` })
    names.add(e.name)
  })
  relations?.forEach((r, i) => {
    for (const end of ["from", "to"] as const) {
      if (!names.has(r[end])) ctx.addIssue({ code: "custom", path: ["relations", i, end], message: `No entity is named "${r[end]}"` })
    }
  })
}

export const createSolutionSchema = solutionShape.superRefine((v, ctx) => checkGraph({ ...v, entities: v.entities ?? [] }, ctx))

export const updateSolutionSchema = solutionShape.omit({ clientId: true }).partial().superRefine(checkGraph)

/**
 * What a solution stores, parsed: a create input, or a stored solution with an
 * update on top (only the sections named change; clientId never does). The whole
 * result is parsed, as the rules read incoming(), so a relation is checked against
 * the entities it will sit beside. Throws a ZodError. The mock and the Admin SDK
 * write through it; the client SDK has the rules.
 */
export function solutionFields(
  base: CreateSolutionInput,
  update: UpdateSolutionInput = {},
): Omit<Solution, "id" | "userId" | "createdAt" | "updatedAt"> {
  // undefined = unchanged, at the top level and in the sections alike, as on the client SDK.
  const defined = (o: object = {}) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
  const v = createSolutionSchema.parse({
    ...base,
    ...defined(update),
    clientId: base.clientId,
    sections: { ...defined(base.sections), ...defined(update.sections) },
  })
  return {
    clientId: v.clientId,
    engagementId: v.engagementId ?? null,
    name: v.name,
    status: v.status ?? "proposed",
    kind: v.kind ?? "product",
    target: v.target ?? null,
    steps: v.steps ?? [],
    domain: v.domain ?? null,
    stack: v.stack ?? [],
    sections: normalizeSolutionSections(v.sections),
    entities: v.entities ?? [],
    relations: v.relations ?? [],
  }
}

/**
 * A stored stack as the app may read it: each tag as zod writes it (trimmed,
 * lowercase, 1 to 40 characters), once. The rules check the list's type and size
 * only, so a tag the client SDK wrote as given is mended or dropped here, and a
 * later parse of the stored document (solutionFields) does not throw.
 */
export function normalizeSolutionStack(raw: unknown): string[] {
  const tags = (Array.isArray(raw) ? raw : []).flatMap((t) => {
    const parsed = solutionTagSchema.safeParse(t)
    return parsed.success ? [parsed.data] : []
  })
  return [...new Set(tags)]
}

/** A stored kind: anything but "advisory" reads as a product, as a solution filed before kinds did. */
export function normalizeSolutionKind(raw: unknown): SolutionKind {
  return raw === "advisory" ? "advisory" : "product"
}

/** A stored target as zod writes it: trimmed, and null when blank. */
export function normalizeSolutionTarget(raw: unknown): string | null {
  return typeof raw === "string" ? raw.trim() || null : null
}

/**
 * A stored road as the app may read it: the steps that parse, at most 20, and only the first Now
 * (a later one reads as Next). The rules check the list's type and size only, so this keeps a
 * hand-written step from reaching a page or a tool, and a later parse (solutionFields) from throwing.
 */
export function normalizeSolutionSteps(raw: unknown): SolutionStep[] {
  let seenNow = false
  return (Array.isArray(raw) ? raw : [])
    .flatMap((r) => {
      const parsed = solutionStepSchema.safeParse(r)
      return parsed.success ? [parsed.data] : []
    })
    .slice(0, MAX_SOLUTION_STEPS)
    .map((s) => {
      if (s.state !== "now") return s
      if (seenNow) return { ...s, state: "next" as const }
      seenNow = true
      return s
    })
}

/** A stored domain as zod writes it: trimmed, and null when blank. */
export function normalizeSolutionDomain(raw: unknown): string | null {
  return typeof raw === "string" ? raw.trim() || null : null
}

/** Every section key, null where the stored map has no text: what the app reads. */
export function normalizeSolutionSections(raw: unknown): SolutionSections {
  const stored = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>
  return Object.fromEntries(
    SOLUTION_SECTIONS.map(({ key }) => [key, typeof stored[key] === "string" ? stored[key] : null]),
  ) as SolutionSections
}

/**
 * A stored data model as the app may read it: the entities that parse, the first
 * of two sharing a name, and the relations that parse and name two of them. The
 * rules check the lists' type and size only, so a hand-written element is dropped
 * here rather than reaching a page or a tool.
 */
export function normalizeSolutionGraph(
  rawEntities: unknown,
  rawRelations: unknown,
): { entities: SolutionEntity[]; relations: SolutionRelation[] } {
  const names = new Set<string>()
  const entities = (Array.isArray(rawEntities) ? rawEntities : []).flatMap((raw) => {
    const parsed = solutionEntitySchema.safeParse(raw)
    if (!parsed.success || names.has(parsed.data.name)) return []
    names.add(parsed.data.name)
    return [parsed.data]
  })
  const relations = (Array.isArray(rawRelations) ? rawRelations : []).flatMap((raw) => {
    const parsed = solutionRelationSchema.safeParse(raw)
    return parsed.success && names.has(parsed.data.from) && names.has(parsed.data.to) ? [parsed.data] : []
  })
  return { entities, relations }
}

// ─── Journal Schemas ────────────────────────────────────────────────────────
//
// Kept in step with journal in firestore/crm.rules, which repeats the caps; the rules tests pin the two.

export const JOURNAL_TEXT_MAX = 5000
export const JOURNAL_LINE_MAX = 500
export const MAX_JOURNAL_DECISIONS = 10
export const MAX_JOURNAL_LINKS = 10
export const JOURNAL_LINK_MAX = 300
export const JOURNAL_SOURCE_MAX = 100

export const journalLines = (max: number, size: number, what: string) =>
  z.array(z.string().trim().min(1).max(size, `At most ${size} characters`)).max(max, `At most ${max} ${what}`)

const journalShape = {
  date: z.iso.date("Invalid date: use YYYY-MM-DD"),
  stepTitle: z.string().trim().min(1).max(200).nullish(),
  text: z.string().trim().min(1, "Write what happened").max(JOURNAL_TEXT_MAX, `At most ${JOURNAL_TEXT_MAX} characters`),
  decisions: journalLines(MAX_JOURNAL_DECISIONS, JOURNAL_LINE_MAX, "decisions").optional(),
  links: journalLines(MAX_JOURNAL_LINKS, JOURNAL_LINK_MAX, "links").optional(),
  next: z.string().trim().min(1).max(JOURNAL_LINE_MAX, `At most ${JOURNAL_LINE_MAX} characters`).nullish(),
  source: z.string().trim().min(1).max(JOURNAL_SOURCE_MAX).nullish(),
}

export const createJournalEntrySchema = z
  .object({
    solutionId: z.string().min(1),
    clientId: z.string().min(1),
    kind: z.enum(["work", "decision"]).optional(),
    ...journalShape,
  })
  .refine((v) => v.kind !== "decision" || !v.decisions?.length, { path: ["decisions"], message: "A decision is one line" })

export const updateJournalEntrySchema = z.object(journalShape).partial()

/**
 * What a journal entry stores, parsed (a create input, or a stored entry with an update on top; the
 * ids and the kind never change). Throws a ZodError. The mock and the Admin SDK write through it;
 * the client SDK has the rules.
 */
export function journalFields(
  base: CreateJournalEntryInput,
  update: UpdateJournalEntryInput = {},
): Omit<JournalEntry, "id" | "userId" | "createdAt" | "updatedAt"> {
  const defined = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined))
  const v = createJournalEntrySchema.parse({ ...base, ...defined })
  return {
    solutionId: v.solutionId,
    clientId: v.clientId,
    kind: v.kind ?? "work",
    date: v.date,
    stepTitle: v.stepTitle ?? null,
    text: v.text,
    decisions: v.decisions ?? [],
    links: v.links ?? [],
    next: v.next ?? null,
    source: v.source ?? null,
  }
}

/** A stored entry as the app may read it: the rules check types and sizes, so a hand-written field is mended or dropped. */
export function normalizeJournalEntry(d: Record<string, unknown>): Omit<JournalEntry, "id" | "userId" | "createdAt" | "updatedAt"> {
  const lines = (raw: unknown, max: number) =>
    (Array.isArray(raw) ? raw : []).filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, max)
  const text = (raw: unknown) => (typeof raw === "string" && raw.trim() ? raw.trim() : null)
  return {
    solutionId: d.solutionId as string,
    clientId: d.clientId as string,
    kind: d.kind === "decision" ? "decision" : "work",
    date: d.date as string,
    stepTitle: text(d.stepTitle),
    text: (d.text as string | undefined) ?? "",
    decisions: lines(d.decisions, MAX_JOURNAL_DECISIONS),
    links: lines(d.links, MAX_JOURNAL_LINKS),
    next: text(d.next),
    source: text(d.source),
  }
}

// ─── Collaborator Schemas ───────────────────────────────────────────────────

export const MAX_FEE_CHANGES = 24
export const MAX_FEE = 1_000_000

const feeMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month")
const feeAmount = z.number().gt(0, "The fee is more than 0").max(MAX_FEE, "The fee is too large")

export const collaboratorFeeSchema = z
  .object({
    amount: feeAmount,
    from: feeMonth,
    until: feeMonth.nullable(),
    changes: z.array(z.object({ from: feeMonth, amount: feeAmount })).max(MAX_FEE_CHANGES),
  })
  .superRefine((fee, ctx) => {
    if (fee.until && fee.until < fee.from) ctx.addIssue({ code: "custom", path: ["until"], message: "The end is before the start" })
    const seen = new Set<string>()
    fee.changes.forEach((c, i) => {
      if (c.from <= fee.from) ctx.addIssue({ code: "custom", path: ["changes", i, "from"], message: "A change starts after the fee does" })
      if (fee.until && c.from > fee.until) ctx.addIssue({ code: "custom", path: ["changes", i, "from"], message: "A change falls after the end" })
      if (seen.has(c.from)) ctx.addIssue({ code: "custom", path: ["changes", i, "from"], message: "Two changes start in the same month" })
      seen.add(c.from)
    })
  })

export const createCollaboratorSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  type: z.enum(["freelancer", "company"]),
  notes: z.string().max(2000, "Notes are too long").nullable().optional(),
  isActive: z.boolean().optional(),
  fee: collaboratorFeeSchema.nullable().optional(),
})

export const updateCollaboratorSchema = createCollaboratorSchema.partial()

/**
 * What a collaborator stores, parsed (a create input, or a stored one with an
 * update on top): the mock and the form read it; the client SDK has the rules.
 * Throws a ZodError. Changes are stored oldest first.
 */
export function collaboratorFields(
  base: CreateCollaboratorInput,
  update: UpdateCollaboratorInput = {},
): Pick<Collaborator, "name" | "type" | "notes" | "isActive" | "fee"> {
  const defined = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined))
  const v = createCollaboratorSchema.parse({ ...base, ...defined })
  return {
    name: v.name,
    type: v.type,
    notes: v.notes?.trim() || null,
    isActive: v.isActive ?? true,
    fee: v.fee ? { ...v.fee, changes: [...v.fee.changes].sort((a, b) => a.from.localeCompare(b.from)) } : null,
  }
}

const feeChangeSchema = z.object({ from: feeMonth, amount: feeAmount })

/**
 * A stored fee as the money path may read it, mended like normalizeAmendments:
 * the base amount, start and end must parse (else null, no fee); of changes only
 * the elements that parse, start after the fee does and not after its end stay,
 * oldest first, one per month, at most MAX_FEE_CHANGES. The rules check the
 * list's size only, so a hand-written element is dropped here.
 */
export function normalizeCollaboratorFee(raw: unknown): CollaboratorFee | null {
  const base = z.object({ amount: feeAmount, from: feeMonth, until: feeMonth.nullable() }).safeParse(raw)
  if (!base.success) return null
  const { amount, from, until } = base.data
  if (until && until < from) return null
  const list = (raw as { changes?: unknown }).changes
  const seen = new Set<string>()
  const changes = (Array.isArray(list) ? list : []).flatMap((c) => {
    const p = feeChangeSchema.safeParse(c)
    if (!p.success || p.data.from <= from || (until && p.data.from > until) || seen.has(p.data.from)) return []
    seen.add(p.data.from)
    return [{ from: p.data.from, amount: p.data.amount }]
  })
  changes.sort((a, b) => a.from.localeCompare(b.from))
  return { amount, from, until, changes: changes.slice(0, MAX_FEE_CHANGES) }
}

/**
 * A stored estimate's price changes as the money path may read them: of the list only the elements that parse,
 * one per month, oldest first, at most MAX_PRICE_CHANGES. The rules check the list's size only, so a
 * hand-written element is dropped here, as in normalizeCollaboratorFee.
 */
export function normalizePriceChanges(raw: unknown): FeeChange[] {
  const seen = new Set<string>()
  const changes = (Array.isArray(raw) ? raw : []).flatMap((c) => {
    const p = priceChangeSchema.safeParse(c)
    if (!p.success || seen.has(p.data.from)) return []
    seen.add(p.data.from)
    return [{ from: p.data.from, amount: p.data.amount }]
  })
  return changes.sort((a, b) => a.from.localeCompare(b.from)).slice(0, MAX_PRICE_CHANGES)
}

// ─── Collaborator assignments ───────────────────────────────────────────────

export const MAX_ASSIGNMENT_MONTHS = 120

const assignmentDays = z.number().finite().min(0, "Days can't be negative").max(31, "At most 31 days a month")

export const createAssignmentSchema = z
  .object({
    collaboratorId: z.string().min(1, "Pick a collaborator"),
    engagementId: z.string().min(1, "Pick a contract"),
    dailyRate: z.number().gt(0, "The rate is more than 0").max(MAX_FEE, "The rate is too large"),
    from: feeMonth,
    until: feeMonth.nullable().optional(),
    defaultDays: assignmentDays,
    monthDays: z.record(feeMonth, assignmentDays).refine((m) => Object.keys(m).length <= MAX_ASSIGNMENT_MONTHS, "Too many months").optional(),
  })
  .refine((a) => !a.until || a.until >= a.from, { path: ["until"], message: "The end is before the start" })

/**
 * What an assignment stores, parsed (a create input, or a stored one with an update on top): the
 * mock and the form read it; the client SDK has the rules. Throws a ZodError.
 */
export function assignmentFields(
  base: CreateAssignmentInput,
  update: UpdateAssignmentInput = {},
): Pick<Assignment, "collaboratorId" | "engagementId" | "dailyRate" | "from" | "until" | "defaultDays" | "monthDays"> {
  const defined = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined))
  const v = createAssignmentSchema.parse({ ...base, ...defined })
  return {
    collaboratorId: v.collaboratorId,
    engagementId: v.engagementId,
    dailyRate: v.dailyRate,
    from: v.from,
    until: v.until ?? null,
    defaultDays: v.defaultDays,
    monthDays: v.monthDays ?? {},
  }
}

/** A stored month map as the money path may read it: the months and days that parse stay, the rest are dropped. Never throws. */
export function normalizeMonthDays(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([m, d]) => feeMonth.safeParse(m).success && assignmentDays.safeParse(d).success)
      .slice(0, MAX_ASSIGNMENT_MONTHS),
  )
}

/** The Runway's floor: 0 or more, or null for none. The same check as company_settings in firestore/crm.rules. */
export const cashFloorSchema = z.number().finite().min(0).nullable()

/** A month's time off. The same check as `capacity` in firestore/crm.rules; the connector writes it through the Admin SDK, which skips the rules. */
export const capacityDocSchema = z.object({
  yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  daysOff: z.number().finite().min(0).max(31),
  availableDays: z.number().finite().min(0).max(31),
  reason: z.enum(["vacation", "training", "admin", "other"]).optional(),
  note: z.string().max(500).nullable(),
})
