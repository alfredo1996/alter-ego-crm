/**
 * Types for the company side: clients, the pipeline, contracts, invoices, costs
 * and the cash book.
 *
 * The shared types (the signed-in user, API keys, the MCP audit entry) are in ./index.
 */

// ─── CRM Types ───────────────────────────────────────────────────────────────

export interface Client {
  id: string
  userId: string
  name: string
  /** Partita IVA. */
  vatNumber: string | null
  email: string | null
  /** The person you actually talk to. One per client — a company with two
   * contacts is rare enough to live in `notes` until it isn't. */
  contactName: string | null
  contactPhone: string | null
  notes: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * What a contract or opportunity is signed in. Storage and every calculation stay in
 * days (an hour is 1/8 of one); the unit only decides what the forms, screens and MCP
 * replies show and take. Absent = "day".
 */
export type ContractUnit = "day" | "hour"

export type OpportunityStage = "lead" | "proposal" | "negotiation" | "won" | "lost"

export interface Opportunity {
  id: string
  userId: string
  clientId: string
  title: string
  stage: OpportunityStage
  /** 0–100. Seeded from the stage, then overridable. */
  probability: number

  // Economic estimate — deliberately the same shape as a contract, so an open
  // opportunity feeds the projection through the same path as a signed one.
  dailyRate: number
  estimatedDaysPerMonth: number
  /** Absent = "day". */
  unit?: ContractUnit
  estimatedDurationMonths: number
  /** "YYYY-MM". null = would start at the projection origin. */
  expectedStartMonth: string | null
  vatApplicable: boolean

  nextActionDate: Date | null
  nextActionNote: string | null
  notes: string | null
  lostReason: string | null
  closedAt: Date | null
  /** The contract created on winning — the conversion trail. */
  engagementId: string | null

  createdAt: Date
  updatedAt: Date
}

/**
 * A dated change to a signed contract (an addendum). Months before `from` keep
 * their terms: the signed ones, or an earlier amendment's.
 */
export interface ContractAmendment {
  /** "YYYY-MM": the first month it applies to. One entry per month, stored sorted by from. */
  from: string
  /** Day rate from `from` on. null = unchanged. */
  dailyRate: number | null
  /** Days added to the budget, spendable from `from` on, never before. null = none. */
  addedDays: number | null
  /** "YYYY-MM-DD": the last day it extended the contract to (written through to endMonth/endDate). null = end unchanged. */
  lastDay: string | null
  /** The last day before it, put back on Remove while the end is still `lastDay`. Set together with lastDay. */
  lastDayBefore: string | null
  /** "Addendum 2", a PO number. */
  note: string | null
}

/** A signed contract. Revenue = allocated days × dailyRate, capped by contractedDays. */
export interface Engagement {
  id: string
  userId: string
  clientId: string
  /** What the contract is called ("Migrazione cloud"). null = unnamed, labelled by its rate. */
  name: string | null
  /** Provenance, when it grew out of a won opportunity. */
  opportunityId: string | null
  dailyRate: number
  /** Absent = "day". */
  unit?: ContractUnit
  vatApplicable: boolean
  /** Total billable days in the contract. null = open-ended, no ceiling. */
  contractedDays: number | null
  /** Fills every grid month that has no explicit Allocation. */
  defaultDaysPerMonth: number
  /** "YYYY-MM". null = already running at the projection origin. */
  startMonth: string | null
  /**
   * "YYYY-MM", last month the contract runs. null = no planned end. Past it the
   * default days stop filling the grid; stored allocations still count.
   */
  endMonth: string | null
  /**
   * "YYYY-MM-DD", the last day hours can be logged; endMonth is its month. null with
   * an endMonth = that month's last day: contracts ended before end dates existed,
   * and planned ends set by month. Read it through contractEndDate.
   */
  endDate: string | null
  isActive: boolean
  notes: string | null
  /**
   * Dated changes to the signed terms. Absent = as signed: dailyRate and
   * contractedDays above stay the signed values. Read with `?? []`.
   */
  amendments?: ContractAmendment[]
  createdAt: Date
  updatedAt: Date
}

export interface Allocation {
  id: string
  userId: string
  engagementId: string
  /** "YYYY-MM" */
  yearMonth: string
  /**
   * Billable days planned for this engagement in this month. 0 is meaningful:
   * a missing record means "use defaultDaysPerMonth", a stored 0 means "nothing".
   */
  days: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Hours worked on one contract on one day: an actual, never a plan. The engine
 * never reads these. Allocations stay the only input the projection and burn-down
 * see, because a forecast derived from logged hours is what #106 undid.
 * Doc id is `${engagementId}_${date}`, so saving the same day twice overwrites.
 */
export interface Timecard {
  id: string
  userId: string
  engagementId: string
  /** Whose hours: null = the owner (documents written before collaborators have no field and read as null). */
  collaboratorId: string | null
  /** "YYYY-MM-DD". A string, never a Date, so no timezone can move it a day. */
  date: string
  /** 0 < hours <= 24. Days are hoursToDays(hours), computed on read. */
  hours: number
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

/** An upsert on (engagementId, date, person). */
export interface SetTimecardInput {
  engagementId: string
  date: string
  /** Omitted or null = the owner's own hours. */
  collaboratorId?: string | null
  hours: number
  /** Omitted keeps the stored note; null clears it. */
  notes?: string | null
}

export type MeetingHealth = "green" | "yellow" | "red"

/**
 * One call or one status update ("verbale") on a client, optionally on one of
 * its contracts. A contract's status is never stored: it is the health of its
 * newest verbale that states one (healthByContract in lib/meetings).
 */
export interface Meeting {
  /** An auto id: several calls on one day are legal. */
  id: string
  userId: string
  /** Always set: a new collection with no legacy documents. */
  clientId: string
  /** The contract ("progetto"); null = about the client (prospect, pre-sale, general). */
  engagementId: string | null
  /** "YYYY-MM-DD" as typed. A string, like Timecard.date, so no timezone can move it. */
  date: string
  /** "HH:mm" start time; null = not recorded, or not a call. */
  time: string | null
  /** The contract's state as judged in THIS verbale; null = not stated. */
  health: MeetingHealth | null
  /** Plain text, 1..MEETING_TEXT_MAX; its first line is the list title. */
  text: string
  createdAt: Date
  updatedAt: Date
}

export interface CreateMeetingInput {
  clientId: string
  engagementId: string | null
  date: string
  time: string | null
  health: MeetingHealth | null
  text: string
}

/** clientId never changes: engagementId moves a verbale only among its own client's contracts, or to null. */
export type UpdateMeetingInput = Partial<Omit<CreateMeetingInput, "clientId">>

export type SolutionStatus = "proposed" | "building" | "delivered" | "retired"

/** Product: something built for the client. Advisory: help given (tuning their queries, say). */
export type SolutionKind = "product" | "advisory"

export type SolutionStepState = "done" | "now" | "next" | "later"

/** What pays for a step: one contract, or one opportunity, of the solution's client. */
export interface SolutionStepPayer {
  type: "contract" | "opportunity"
  id: string
}

/**
 * One step of the road to the target. At most one step of a solution is Now. An
 * opportunity that has been won is followed to its contract at read time
 * (stepContract): nothing is written when it converts.
 */
export interface SolutionStep {
  title: string
  state: SolutionStepState
  /** "YYYY-MM". */
  fromMonth: string
  /** "YYYY-MM", never before fromMonth; null = open-ended. */
  toMonth: string | null
  paidBy: SolutionStepPayer | null
  goal: string | null
  /** What came of it; asked for when the step is marked Done. */
  outcome: string | null
  /** "YYYY-MM-DD", the day it was marked Done. */
  doneOn: string | null
}

/** The nine fixed sections; SOLUTION_SECTIONS in schemas.ts holds each one's label and interview question. */
export type SolutionSectionKey =
  | "purpose"
  | "requirements"
  | "kpis"
  | "sources"
  | "model"
  | "architecture"
  | "steps"
  | "history"
  | "results"

/** Free text per section; null = not written yet. Every key is present on read. */
export type SolutionSections = Record<SolutionSectionKey, string | null>

/** One node of the data model. */
export interface SolutionEntity {
  /** Unique within its solution: relations name entities by it. */
  name: string
  /** The client's system or dataset it derives from ("SAP MARA"); null = the solution derives it. */
  source: string | null
  notes: string | null
}

/** One edge of the data model, between two entity names. */
export interface SolutionRelation {
  from: string
  to: string
  /** The relation's name ("IN_CATEGORY"). */
  type: string
}

/**
 * A solution built for a client, documented for reuse in pre-sales. Shaped like
 * Meeting: it always names its client, and its contract once there is one. The
 * data model lives inside the document, like a contract's amendments.
 */
export interface Solution {
  id: string
  userId: string
  /**
   * Always set: a new collection with no legacy documents. updateSolution never
   * changes it; it follows its contract when the contract moves to another client,
   * as a verbale does.
   */
  clientId: string
  /** The contract; null in pre-sales, or once the contract is deleted. */
  engagementId: string | null
  name: string
  /** A stored solution with no kind reads as "product". */
  kind: SolutionKind
  /** The end state the road leads to, up to 500 characters; null = none. */
  target: string | null
  /** The road to the target, in order, at most 20. */
  steps: SolutionStep[]
  /** The solution's own lifecycle, not its contract's. */
  status: SolutionStatus
  /** One word to group by ("retail"); null = none. */
  domain: string | null
  /** Lowercase tags, one per technology ("neo4j", "kafka"). */
  stack: string[]
  sections: SolutionSections
  entities: SolutionEntity[]
  /** Every from and to names an entity in `entities`. */
  relations: SolutionRelation[]
  createdAt: Date
  updatedAt: Date
}

export interface CreateSolutionInput {
  clientId: string
  name: string
  /** Omitted = null, a pre-sales solution. */
  engagementId?: string | null
  /** Omitted = "proposed". */
  status?: SolutionStatus
  /** Omitted = "product". */
  kind?: SolutionKind
  /** Omitted = null. */
  target?: string | null
  /** Omitted = none; an update replaces the whole road. */
  steps?: SolutionStep[]
  domain?: string | null
  stack?: string[]
  /** The sections omitted are null. */
  sections?: Partial<SolutionSections>
  entities?: SolutionEntity[]
  relations?: SolutionRelation[]
}

/**
 * clientId never changes, as on a verbale. Only the sections named change (null
 * clears one); stack, entities and relations replace the whole list.
 */
export type UpdateSolutionInput = Partial<Omit<CreateSolutionInput, "clientId">>

/** A work session, or one decision taken on its own. */
export type JournalKind = "work" | "decision"

/**
 * One entry of a solution's journal. Calls and done steps are not entries: they are read from the
 * meetings and the road when the journal is shown (lib/solution-journal), never copied here.
 */
export interface JournalEntry {
  id: string
  userId: string
  solutionId: string
  /** The solution's client, so deleting a client removes its entries beside its solutions. */
  clientId: string
  kind: JournalKind
  /** "YYYY-MM-DD" as typed. */
  date: string
  /** The title of the step it belongs to when it was filed; null = none. */
  stepTitle: string | null
  /** What was done; for a decision, the one line. */
  text: string
  /** Each one is shown as its own Decision line. Always empty on a decision entry. */
  decisions: string[]
  /** PRs, commits, pages: a URL is shown as a link, anything else as text. */
  links: string[]
  next: string | null
  /** Where it came from; null = the page, else "Claude Code" with the repository's name. */
  source: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateJournalEntryInput {
  solutionId: string
  clientId: string
  kind?: JournalKind
  date: string
  stepTitle?: string | null
  text: string
  decisions?: string[]
  links?: string[]
  next?: string | null
  source?: string | null
}

/** Which solution, client and kind an entry has never changes. */
export type UpdateJournalEntryInput = Partial<Omit<CreateJournalEntryInput, "solutionId" | "clientId" | "kind">>

/**
 * A to-do for a client, optionally on one of its contracts — deliverables,
 * follow-ups, admin steps. Deliberately flat: no priority, ordering, or subtasks
 * until a due-date-sorted list stops being enough.
 */
export interface Task {
  id: string
  userId: string
  /**
   * The client the task belongs to. Always set on new writes; null only on
   * documents written before #164, which name just their contract — read the
   * client through taskClientId in lib/tasks, never this field alone.
   */
  clientId: string | null
  /** The contract, when the task is part of one; null = a client-level task. */
  engagementId: string | null
  title: string
  dueDate: Date | null
  notes: string | null
  isDone: boolean
  /**
   * When the task was put "in corso". isDone stays the sole authority for
   * done-ness — this only splits the open tasks; see statusOf in lib/tasks.
   */
  startedAt: Date | null
  /**
   * Free-text tags, Trello-style. A plain list rather than a label collection:
   * colors come from the text (labelColor in lib/tasks), stored already
   * normalized (normalizeLabels). Documents written before labels read as [].
   */
  labels: string[]
  createdAt: Date
  updatedAt: Date
}

/** What a company file is: the FatturaPA XML, the same signed (.xml.p7m), or a PDF where no XML exists. */
export type InvoiceFileKind = "xml" | "p7m" | "pdf"

/**
 * The invoice file a cost or an invoice keeps, stored exactly as uploaded.
 * `path` is the object in Storage (the adapter chooses it); `name` is what the
 * file was called when it was picked. null on the record = no file, and on
 * every document written before this existed.
 */
export interface InvoiceFile {
  path: string
  name: string
  kind: InvoiceFileKind
  size: number
  uploadedAt: Date
}

/**
 * A record of an invoice issued elsewhere — the fatturazione elettronica software
 * is the legal system of record, this is the CRM's copy for cash questions.
 *
 * Deliberately never reaches the Plan: its revenue stays keyed to the month the
 * days were worked (competenza). An invoice answers "did the money arrive".
 */
export interface Invoice {
  id: string
  userId: string
  /**
   * The customer billed. null only on documents written before invoices named
   * their customer, which name just their contract — read it through
   * invoiceClientId in lib/invoices, never this field alone.
   */
  clientId: string | null
  /** Legacy provenance only: the contract an old invoice was recorded on. */
  engagementId: string | null
  /** As printed on the paper: "14", "2026/14". Free text — the accountant owns numbering. */
  number: string
  /**
   * The first accrual month of an invoice covering several ("YYYY-MM"). null =
   * the single month yearMonth. yearMonth is always the last.
   */
  fromMonth: string | null
  /**
   * "YYYY-MM" competenza month, the same key as Allocation, so the two can be
   * compared. The last one when the invoice covers several (fromMonth).
   */
  yearMonth: string
  /** Imponibile, net of VAT. Negative for a nota di credito. */
  amount: number
  /** IVA as actually charged — stored, not derived: 0 covers reverse charge and esente. */
  vat: number
  /** When the client has to pay. null = not tracked, and it never reaches /deadlines. */
  dueDate: Date | null
  /** null = unpaid. Doubles as the paid flag and as the cash month for the 'paid' basis. */
  paidDate: Date | null
  /**
   * The CompanyAccount the payment landed on. Counts only while paidDate is set:
   * an untick clears the date alone, and the stale account is kept for the next
   * tick. null = not known (documents written before it, or never said).
   */
  paidAccountId: string | null
  /** The invoice file kept with it; null or absent = none (every invoice written before files). */
  file?: InvoiceFile | null
  createdAt: Date
  updatedAt: Date
}

// ─── Company Expense Types ──────────────────────────────────────────────────

export type CompanyExpenseCategory =
  | "rent"
  | "software"
  | "accountant"
  | "insurance"
  | "office_supplies"
  | "travel"
  | "marketing"
  | "legal"
  | "bank_fees"
  | "collaborators"
  | "other"

export interface CompanyExpense {
  id: string
  userId: string
  description: string
  category: CompanyExpenseCategory
  /**
   * The cost, net of recoverable VAT. Negative only on a refund: a
   * one-off paid back into an account.
   */
  amount: number
  date: Date
  isRecurring: boolean
  recurrenceMonths: number | null
  notes: string | null
  /**
   * The CompanyAccount it was paid from: a one-off with one is a cash row in
   * the cash book. null = not paid from a company account: a recurring
   * estimate, a cost paid by the owner, a supplier invoice not paid yet, or a
   * cost written before the cash book.
   */
  accountId: string | null
  /** Paid with the owner's personal card: the company owes the owner for it. */
  paidByOwner: boolean
  /**
   * The VAT the company recovers, on top of amount: cash out = amount + vat.
   * 0 when none is recoverable (reverse charge, exempt rental). null on costs
   * written before it: the cash book counts 0.
   */
  vat: number | null
  /** The supplier's invoice or receipt number. A one-off not paid yet with one is owed to the supplier. */
  documentRef: string | null
  /** The cost centre (free label, "Flat Rental"). */
  project: string | null
  /**
   * Recurring estimate only: the last month the Plan counts it, "YYYY-MM"; null or absent = no end.
   * Absent on estimates written before it.
   */
  endMonth?: string | null
  /** Recurring estimate only: dated price changes ("from this month, this amount each time"). Absent = none. */
  priceChanges?: FeeChange[]
  /**
   * Recurring estimate only: true = the full amount lands in its payment months (the start month and every
   * Nth after it); false or absent = amount / every, spread over every month, as it was before this field.
   * Only the owner switches it, in Edit; nothing else does.
   */
  countedWhenPaid?: boolean
  /** The recurring estimate this payment stands for: the Plan stops counting the estimate in its months. */
  recurringExpenseId: string | null
  /** The day is a guess; any date edit clears it. */
  dateEstimated: boolean
  /** The workbook row it came from. */
  importRef: string | null
  /** A collaborator's invoice: who it is from. null on any other cost and on costs written before it. */
  collaboratorId: string | null
  /** The contract it is for; null = a fixed fee (or no collaborator). */
  engagementId: string | null
  /** "YYYY-MM": the month of work the invoice pays. null = the month of `date`. */
  forMonth: string | null
  /** A rent offset: the lease it is netted against (its month is `forMonth`). null on any other cost. */
  leaseId?: string | null
  /** The supplier's invoice file; null or absent = none (every cost written before files). */
  file?: InvoiceFile | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateCompanyExpenseInput {
  description: string
  category: CompanyExpenseCategory
  amount: number
  date: Date
  isRecurring?: boolean
  recurrenceMonths?: number | null
  notes?: string | null
  accountId?: string | null
  paidByOwner?: boolean
  vat?: number | null
  documentRef?: string | null
  project?: string | null
  recurringExpenseId?: string | null
  dateEstimated?: boolean
  importRef?: string | null
  collaboratorId?: string | null
  engagementId?: string | null
  forMonth?: string | null
  leaseId?: string | null
  endMonth?: string | null
  priceChanges?: FeeChange[]
  countedWhenPaid?: boolean
  file?: InvoiceFile | null
}

export type UpdateCompanyExpenseInput = Partial<CreateCompanyExpenseInput>

// ─── Company Loan Types ─────────────────────────────────────────────────────

export type CompanyLoanDirection = "to_company" | "from_company"

export interface CompanyLoan {
  id: string
  userId: string
  description: string
  direction: CompanyLoanDirection
  amount: number
  date: Date
  notes: string | null
  /** The CompanyAccount the money went through: a cash row. null on loans written before the cash book. */
  accountId: string | null
  /** The day is a guess; any date edit clears it. */
  dateEstimated: boolean
  /** The workbook row it came from. */
  importRef: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateCompanyLoanInput {
  description: string
  direction: CompanyLoanDirection
  amount: number
  date: Date
  notes?: string | null
  accountId?: string | null
  dateEstimated?: boolean
  importRef?: string | null
}

export type UpdateCompanyLoanInput = Partial<CreateCompanyLoanInput>

// ─── Company Cash Book Types ────────────────────────────────────────────────

/**
 * A company bank account, or a cash box. Never the owner's
 * personal accounts. The balance is never
 * stored: it is openingBalance plus every cash row dated from openingDate on.
 */
export interface CompanyAccount {
  id: string
  userId: string
  name: string
  /** The balance at openingDate. May be negative. */
  openingBalance: number
  /** Rows dated before it never reach a balance. */
  openingDate: Date
  /** The last real bank balance checked; set together with statementDate. */
  statementBalance: number | null
  statementDate: Date | null
  /** Set when the workbook import created the account. */
  importRef: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateCompanyAccountInput {
  name: string
  openingBalance: number
  openingDate: Date
  statementBalance?: number | null
  statementDate?: Date | null
  importRef?: string | null
}

export type UpdateCompanyAccountInput = Partial<CreateCompanyAccountInput>

/**
 * What a movement is. Only `income` ever reaches the Plan; client money with an
 * invoice is the invoice's paidDate, never a movement.
 */
export type CompanyMovementKind =
  | "transfer"
  | "income"
  | "client_income"
  | "deposit_held"
  | "deposit_paid"
  | "capital"
  | "vat"
  | "tax"
  | "compensation"
  | "supplier_payment"

export type CompanyMovementDirection = "in" | "out"

/**
 * Cash on a company account that has no other home: costs stay CompanyExpense,
 * loans CompanyLoan, client payments the Invoice. A transfer is one document,
 * always "out" of accountId into toAccountId.
 */
export interface CompanyMovement {
  id: string
  userId: string
  kind: CompanyMovementKind
  direction: CompanyMovementDirection
  /** Always > 0: direction carries the sign. */
  amount: number
  date: Date
  accountId: string
  /** Transfer only, never accountId; null otherwise. */
  toAccountId: string | null
  /** supplier_payment only: the CompanyExpense it pays; null otherwise. */
  expenseId: string | null
  description: string
  documentRef: string | null
  /** Free label ("Consulting"). */
  project: string | null
  /** Free text ("Room 2"): who a deposit belongs to. */
  counterparty: string | null
  notes: string | null
  /** The day is a guess (an imported row with no day); any date edit clears it. */
  dateEstimated: boolean
  /** The workbook row it came from, e.g. "2026:Luglio!12". */
  importRef: string | null
  /** The lease this payment is for (Rent module); null or absent on any other row, and on rows written before it. */
  leaseId?: string | null
  /** "YYYY-MM": the month the payment covers, whatever day it arrived. Income only. */
  rentMonth?: string | null
  /** Which part of the lease's monthly amount it pays. Income only. */
  rentPart?: RentPart | null
  createdAt: Date
  updatedAt: Date
}

export type RentPart = "rent" | "contribution"

export interface CreateCompanyMovementInput {
  kind: CompanyMovementKind
  direction: CompanyMovementDirection
  amount: number
  date: Date
  accountId: string
  toAccountId?: string | null
  expenseId?: string | null
  description: string
  documentRef?: string | null
  project?: string | null
  counterparty?: string | null
  notes?: string | null
  dateEstimated?: boolean
  importRef?: string | null
  leaseId?: string | null
  rentMonth?: string | null
  rentPart?: RentPart | null
}

export type UpdateCompanyMovementInput = Partial<CreateCompanyMovementInput>

// ─── Company Deadline Types ─────────────────────────────────────────────────

export type CompanyDeadlineKind = "tax" | "contract" | "admin" | "other"

/**
 * A date the company has to remember that the app cannot derive on its own —
 * the commercialista's fee, an F24 the accountant sends, a contract renewal, a
 * bank formality. Budget-exhaustion dates are computed, never stored here.
 */
export interface CompanyDeadline {
  id: string
  userId: string
  title: string
  date: Date
  kind: CompanyDeadlineKind
  /** Expected cash out, when known. */
  amount: number | null
  notes: string | null
  isDone: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateCompanyDeadlineInput {
  title: string
  date: Date
  kind: CompanyDeadlineKind
  amount?: number | null
  notes?: string | null
}

export interface UpdateCompanyDeadlineInput {
  title?: string
  date?: Date
  kind?: CompanyDeadlineKind
  amount?: number | null
  notes?: string | null
  isDone?: boolean
}

export interface CreateClientInput {
  name: string
  vatNumber?: string | null
  email?: string | null
  contactName?: string | null
  contactPhone?: string | null
  notes?: string | null
}

export interface UpdateClientInput {
  name?: string
  vatNumber?: string | null
  email?: string | null
  contactName?: string | null
  contactPhone?: string | null
  notes?: string | null
  isActive?: boolean
}

export interface CreateOpportunityInput {
  clientId: string
  title: string
  stage: OpportunityStage
  probability: number
  dailyRate: number
  estimatedDaysPerMonth: number
  unit?: ContractUnit
  estimatedDurationMonths: number
  expectedStartMonth?: string | null
  vatApplicable: boolean
  nextActionDate?: Date | null
  nextActionNote?: string | null
  notes?: string | null
}

export interface UpdateOpportunityInput {
  clientId?: string
  title?: string
  stage?: OpportunityStage
  probability?: number
  dailyRate?: number
  estimatedDaysPerMonth?: number
  unit?: ContractUnit
  estimatedDurationMonths?: number
  expectedStartMonth?: string | null
  vatApplicable?: boolean
  nextActionDate?: Date | null
  nextActionNote?: string | null
  notes?: string | null
  lostReason?: string | null
  closedAt?: Date | null
  engagementId?: string | null
}

export interface CreateEngagementInput {
  clientId: string
  name?: string | null
  opportunityId?: string | null
  dailyRate: number
  unit?: ContractUnit
  vatApplicable: boolean
  contractedDays?: number | null
  defaultDaysPerMonth: number
  startMonth?: string | null
  endMonth?: string | null
  endDate?: string | null
  notes?: string | null
}

export interface UpdateEngagementInput {
  clientId?: string
  name?: string | null
  dailyRate?: number
  unit?: ContractUnit
  vatApplicable?: boolean
  contractedDays?: number | null
  defaultDaysPerMonth?: number
  startMonth?: string | null
  endMonth?: string | null
  endDate?: string | null
  isActive?: boolean
  notes?: string | null
  /** Replaces the whole list, like Task.labels. */
  amendments?: ContractAmendment[]
}

export interface CreateTaskInput {
  clientId: string
  /** Omitted or null = a client-level task. The caller keeps it one of clientId's contracts. */
  engagementId?: string | null
  title: string
  dueDate?: Date | null
  notes?: string | null
  labels?: string[]
}

export interface UpdateTaskInput {
  /** Changes with engagementId, so an attached task always names its contract's client. */
  clientId?: string
  /** A contract id attaches the task; null detaches it to client level. */
  engagementId?: string | null
  title?: string
  dueDate?: Date | null
  notes?: string | null
  isDone?: boolean
  startedAt?: Date | null
  labels?: string[]
}

export interface CreateInvoiceInput {
  /** The customer billed: an invoice covers all of a client's contracts in its month. */
  clientId: string
  number: string
  /** First accrual month of a period; null or omitted = the single month yearMonth. */
  fromMonth?: string | null
  yearMonth: string
  amount: number
  vat: number
  dueDate?: Date | null
  paidDate?: Date | null
  paidAccountId?: string | null
  file?: InvoiceFile | null
}

export interface UpdateInvoiceInput {
  number?: string
  /** null makes it a single-month invoice again. */
  fromMonth?: string | null
  yearMonth?: string
  amount?: number
  vat?: number
  dueDate?: Date | null
  paidDate?: Date | null
  paidAccountId?: string | null
  file?: InvoiceFile | null
}

/**
 * A month the user has blocked out: holiday, training, admin. Doc id is the
 * yearMonth, so blocking the same month twice overwrites rather than stacks.
 */
export interface CapacityDoc {
  yearMonth: string
  daysOff: number
  availableDays: number
  /** Set through the connector only; the app writes none and keeps the one that is there. */
  reason?: "vacation" | "training" | "admin" | "other"
  note: string | null
}

export interface CreateAllocationInput {
  engagementId: string
  yearMonth: string
  days: number
}

export interface UpdateAllocationInput {
  days?: number
}

// ─── Collaborators ──────────────────────────────────────────────────────────

export type CollaboratorType = "freelancer" | "company"

/** "From this month the fee is this amount", until the next change or the end. */
export interface FeeChange {
  /** "YYYY-MM". */
  from: string
  /** A month, net of VAT. */
  amount: number
}

/** A fixed monthly fee, in the contract-amendment pattern: a start, an optional end, dated changes. */
export interface CollaboratorFee {
  /** A month, net of VAT, in force from `from` until the first change. */
  amount: number
  /** "YYYY-MM", the first month it runs. */
  from: string
  /** "YYYY-MM", the last month it runs; null = no end. */
  until: string | null
  changes: FeeChange[]
}

/**
 * A freelancer or a company the company pays on invoice. No login, no payroll:
 * an employee is a company-type collaborator with a fixed fee.
 */
export interface Collaborator {
  id: string
  userId: string
  name: string
  type: CollaboratorType
  notes: string | null
  /** Inactive ones stay listed, but their fee is out of the Plan. */
  isActive: boolean
  /** null = no fixed fee. */
  fee: CollaboratorFee | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateCollaboratorInput {
  name: string
  type: CollaboratorType
  notes?: string | null
  /** Omitted = true. */
  isActive?: boolean
  fee?: CollaboratorFee | null
}

/** The fee replaces the whole object, changes included. */
export type UpdateCollaboratorInput = Partial<CreateCollaboratorInput>

// ─── Collaborator assignments ───────────────────────────────────────────────

/**
 * A collaborator on one contract: subcontracted days. Their days are part of the
 * contract's days, not on top: the client is billed for all of them at the
 * contract's rate, and the cost is days × `dailyRate`. Stored in days like every
 * contract figure (an hourly contract's €40/h is €320 here).
 */
export interface Assignment {
  id: string
  userId: string
  collaboratorId: string
  engagementId: string
  /** What a day of theirs costs, net of VAT. */
  dailyRate: number
  /** "YYYY-MM", the first month it runs. */
  from: string
  /** "YYYY-MM", the last month it runs; null = to the contract's end. Never counts past the contract. */
  until: string | null
  /** Planned days a month, from `from` to `until`. */
  defaultDays: number
  /** Planned days in a month where it differs from the default, by "YYYY-MM". 0 is meaningful: none that month. */
  monthDays: Record<string, number>
  createdAt: Date
  updatedAt: Date
}

export interface CreateAssignmentInput {
  collaboratorId: string
  engagementId: string
  dailyRate: number
  from: string
  until?: string | null
  defaultDays: number
  monthDays?: Record<string, number>
}

/** Who and what contract stay fixed: remove it and add another instead. */
export type UpdateAssignmentInput = Partial<Omit<CreateAssignmentInput, "collaboratorId" | "engagementId">>

/** The company's own settings, one record per user. */
export interface CompanySettings {
  /** The amount the Plan's Runway marks the first month under. Null = no floor. */
  cashFloor: number | null
}
