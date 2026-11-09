import type {
  CapacityDoc,
  McpAuditEntry,
  User,
  ApiKey,
  CompanyExpense,
  InvoiceFile,
  CreateCompanyExpenseInput,
  UpdateCompanyExpenseInput,
  CompanyLoan,
  CreateCompanyLoanInput,
  UpdateCompanyLoanInput,
  CompanyAccount,
  CreateCompanyAccountInput,
  UpdateCompanyAccountInput,
  CompanyMovement,
  CompanySettings,
  CreateCompanyMovementInput,
  UpdateCompanyMovementInput,
  Client,
  Opportunity,
  Engagement,
  Allocation,
  CompanyDeadline,
  CreateCompanyDeadlineInput,
  UpdateCompanyDeadlineInput,
  CreateClientInput,
  UpdateClientInput,
  CreateOpportunityInput,
  UpdateOpportunityInput,
  CreateEngagementInput,
  UpdateEngagementInput,
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  Timecard,
  SetTimecardInput,
  Meeting,
  CreateMeetingInput,
  UpdateMeetingInput,
  Assignment,
  CreateAssignmentInput,
  UpdateAssignmentInput,
  Collaborator,
  CreateCollaboratorInput,
  UpdateCollaboratorInput,
  Solution,
  CreateSolutionInput,
  UpdateSolutionInput,
  Invoice,
  CreateInvoiceInput,
  UpdateInvoiceInput,
  CreateAllocationInput,
  UpdateAllocationInput,
} from "@/types"
import type { RentAdapter } from "@alter-ego/rent/adapter"

export interface AuthAdapter {
  signIn(email: string, password: string): Promise<User>
  signUp(email: string, password: string, displayName: string): Promise<User>
  signOut(): Promise<void>
  getCurrentUser(): Promise<User | null>
  onAuthStateChanged(callback: (user: User | null) => void): () => void
  updateProfile(input: { displayName?: string; email?: string }): Promise<void>
  /**
   * A signed identity token for the current session, or null when signed out.
   *
   * Used by the OAuth consent page to prove to the server who is approving —
   * the alternative is reaching past the adapter into the Firebase SDK.
   */
  getIdToken(): Promise<string | null>
}

/**
 * API keys: the credential behind the connector. The MCP server and the OAuth
 * tokens it mints validate against these (`validateApiKey` is server-only, see
 * ServerDb).
 */
export interface ApiKeysAdapter {
  createApiKey(userId: string): Promise<{ key: string; id: string }>
  deleteApiKey(userId: string, keyId: string): Promise<void>
  getApiKeys(userId: string): Promise<Pick<ApiKey, "id" | "prefix" | "createdAt">[]>
}

export interface BackendAdapter {
  auth: AuthAdapter
  db: DatabaseAdapter
  files: FilesAdapter
}

/**
 * The company side's invoice files (a supplier's invoice on a cost, an issued
 * one on an invoice). Objects only: the record's `file` pointer is written
 * through db, so the caller uploads first and points second, and a failed
 * upload never leaves a record naming a file that is not there. Deleting a
 * cost, an invoice or its client deletes their objects (the db adapters do it).
 */
export interface FilesAdapter {
  /** Stores the file as uploaded under a new path. Refuses a wrong type or over 10 MB, as the slot does. */
  upload(userId: string, file: Blob, name: string): Promise<InvoiceFile>
  /** Rejects when the object is not there. */
  download(file: Pick<InvoiceFile, "path">): Promise<Blob>
  /** Removing an object that is already gone is not an error. */
  remove(path: string): Promise<void>
}


/**
 * The company side: clients, pipeline, contracts, invoices, costs and the cash
 * book.
 */
export interface CrmAdapter {
  // Time off (capacity): one record per month, the doc id is the month. The Plan and the connector share it.
  getCapacityDocs(userId: string, filter: { from: string; to: string }): Promise<CapacityDoc[]>
  /** Replaces the month's record. The caller builds it with timeOffDoc, so availableDays is never typed. */
  setCapacity(userId: string, doc: CapacityDoc): Promise<void>

  // Company expenses
  getCompanyExpenses(userId: string): Promise<CompanyExpense[]>
  createCompanyExpense(userId: string, input: CreateCompanyExpenseInput): Promise<CompanyExpense>
  updateCompanyExpense(userId: string, expenseId: string, input: UpdateCompanyExpenseInput): Promise<CompanyExpense>
  deleteCompanyExpense(userId: string, expenseId: string): Promise<void>

  // Company loans (finanziamento soci — not taxed, not deductible, cash flow only)
  getCompanyLoans(userId: string): Promise<CompanyLoan[]>
  createCompanyLoan(userId: string, input: CreateCompanyLoanInput): Promise<CompanyLoan>
  updateCompanyLoan(userId: string, loanId: string, input: UpdateCompanyLoanInput): Promise<CompanyLoan>
  deleteCompanyLoan(userId: string, loanId: string): Promise<void>

  // Company bank accounts and the movements with no other home (the cash book).
  // A balance is never stored: it is derived from these, invoices, costs and loans.
  getCompanyAccounts(userId: string): Promise<CompanyAccount[]>
  createCompanyAccount(userId: string, input: CreateCompanyAccountInput): Promise<CompanyAccount>
  updateCompanyAccount(userId: string, accountId: string, input: UpdateCompanyAccountInput): Promise<CompanyAccount>
  /**
   * Refuses an account a movement, a cost or a paid invoice names (ACCOUNT_HAS_ENTRIES): they would
   * point at nothing. Clears it from unpaid invoices that kept it from an untick, in the same write.
   */
  deleteCompanyAccount(userId: string, accountId: string): Promise<void>
  /** Newest first, like costs and loans. */
  getCompanyMovements(userId: string): Promise<CompanyMovement[]>
  createCompanyMovement(userId: string, input: CreateCompanyMovementInput): Promise<CompanyMovement>
  updateCompanyMovement(userId: string, movementId: string, input: UpdateCompanyMovementInput): Promise<CompanyMovement>
  deleteCompanyMovement(userId: string, movementId: string): Promise<void>

  // The company's own settings (one record per user)
  getCompanySettings(userId: string): Promise<CompanySettings>
  /** The amount the Runway marks the first month under; null removes it. Refuses a negative one. */
  setCompanyCashFloor(userId: string, floor: number | null): Promise<CompanySettings>

  // CRM clients
  getClients(userId: string, filter?: { activeOnly?: boolean }): Promise<Client[]>
  createClient(userId: string, input: CreateClientInput): Promise<Client>
  updateClient(userId: string, clientId: string, input: UpdateClientInput): Promise<Client>
  /**
   * Takes its contracts, hours, tasks, verbali, solutions and invoices along. Refuses a client
   * with an invoice paid into a company account (CLIENT_HAS_CASH): a balance would move.
   */
  deleteClient(userId: string, clientId: string): Promise<void>

  // CRM opportunities (the pipeline)
  getOpportunities(userId: string, filter?: { openOnly?: boolean }): Promise<Opportunity[]>
  createOpportunity(userId: string, input: CreateOpportunityInput): Promise<Opportunity>
  updateOpportunity(userId: string, opportunityId: string, input: UpdateOpportunityInput): Promise<Opportunity>
  deleteOpportunity(userId: string, opportunityId: string): Promise<void>

  // Signed contracts
  getEngagements(userId: string, filter?: { activeOnly?: boolean }): Promise<Engagement[]>
  createEngagement(userId: string, input: CreateEngagementInput): Promise<Engagement>
  updateEngagement(userId: string, engagementId: string, input: UpdateEngagementInput): Promise<Engagement>
  /**
   * Refuses a contract with any timecard (CONTRACT_HAS_HOURS): its hours are what
   * the client's invoices are checked against, so it is closed, never deleted.
   * Without hours it hands its tasks, verbali and invoices to its client, and its
   * solutions go back to pre-sales (engagementId null).
   */
  deleteEngagement(userId: string, engagementId: string): Promise<void>

  // Per-engagement tasks
  getTasks(userId: string): Promise<Task[]>
  createTask(userId: string, input: CreateTaskInput): Promise<Task>
  updateTask(userId: string, taskId: string, input: UpdateTaskInput): Promise<Task>
  deleteTask(userId: string, taskId: string): Promise<void>

  // Hours worked per contract per day (actuals: the engine never reads them)
  getTimecards(userId: string): Promise<Timecard[]>
  /** Upsert on (engagementId, date): a re-save overwrites and keeps createdAt. */
  setTimecard(userId: string, input: SetTimecardInput): Promise<Timecard>
  /** `collaboratorId` omitted or null = the owner's row. */
  deleteTimecard(userId: string, engagementId: string, date: string, collaboratorId?: string | null): Promise<void>

  // Verbali: calls and status updates on a client or one of its contracts.
  // Unfiltered: ordering and "latest per contract" live in lib/meetings.
  getMeetings(userId: string): Promise<Meeting[]>
  createMeeting(userId: string, input: CreateMeetingInput): Promise<Meeting>
  updateMeeting(userId: string, meetingId: string, input: UpdateMeetingInput): Promise<Meeting>
  deleteMeeting(userId: string, meetingId: string): Promise<void>

  // Solutions built for a client, documented for pre-sales. Unfiltered, like verbali.
  getSolutions(userId: string): Promise<Solution[]>
  createSolution(userId: string, input: CreateSolutionInput): Promise<Solution>
  /** Only the sections named change; stack, entities and relations replace the whole list. */
  updateSolution(userId: string, solutionId: string, input: UpdateSolutionInput): Promise<Solution>
  deleteSolution(userId: string, solutionId: string): Promise<void>

  // Collaborators: freelancers and companies paid on invoice, with an optional fixed monthly fee.
  getCollaborators(userId: string): Promise<Collaborator[]>
  createCollaborator(userId: string, input: CreateCollaboratorInput): Promise<Collaborator>
  /** A fee in the input replaces the stored one, changes included. */
  updateCollaborator(userId: string, collaboratorId: string, input: UpdateCollaboratorInput): Promise<Collaborator>
  /** Refuses a collaborator with days logged (COLLABORATOR_HAS_DAYS); removes their assignments. */
  deleteCollaborator(userId: string, collaboratorId: string): Promise<void>

  // Assignments: a collaborator's days on a contract, with the cost of each.
  getAssignments(userId: string): Promise<Assignment[]>
  createAssignment(userId: string, input: CreateAssignmentInput): Promise<Assignment>
  /** monthDays in the input replaces the stored map. */
  updateAssignment(userId: string, assignmentId: string, input: UpdateAssignmentInput): Promise<Assignment>
  /** Refuses an assignment whose collaborator has days logged on its contract (ASSIGNMENT_HAS_DAYS). */
  deleteAssignment(userId: string, assignmentId: string): Promise<void>

  // Per-customer invoices (a record of paper issued elsewhere)
  getInvoices(userId: string): Promise<Invoice[]>
  createInvoice(userId: string, input: CreateInvoiceInput): Promise<Invoice>
  updateInvoice(userId: string, invoiceId: string, input: UpdateInvoiceInput): Promise<Invoice>
  deleteInvoice(userId: string, invoiceId: string): Promise<void>

  // Company deadlines (the ones the app cannot derive)
  getCompanyDeadlines(userId: string): Promise<CompanyDeadline[]>
  createCompanyDeadline(userId: string, input: CreateCompanyDeadlineInput): Promise<CompanyDeadline>
  updateCompanyDeadline(userId: string, deadlineId: string, input: UpdateCompanyDeadlineInput): Promise<CompanyDeadline>
  deleteCompanyDeadline(userId: string, deadlineId: string): Promise<void>

  // Monthly day allocations per contract
  getAllocations(
    userId: string,
    filter?: { from?: string; to?: string; engagementId?: string }
  ): Promise<Allocation[]>
  createAllocation(userId: string, input: CreateAllocationInput): Promise<Allocation>
  updateAllocation(userId: string, allocationId: string, input: UpdateAllocationInput): Promise<Allocation>
  deleteAllocation(userId: string, allocationId: string): Promise<void>
}

/**
 * Everything a client reads and writes: the company side, rent and API keys.
 * Every adapter in this repo implements this.
 */
export interface DatabaseAdapter extends ApiKeysAdapter, CrmAdapter, RentAdapter {}

/**
 * Server-only surfaces. These are deliberately NOT on DatabaseAdapter: the
 * `mcp_audit` collection is `allow read, write: if false` in
 * firestore.rules, so the client SDK could never implement them honestly. They
 * are reached through the Admin SDK, which bypasses rules — which is exactly why
 * they must go through an interface rather than a direct firebase-admin import.
 */
export interface AuditAdapter {
  /** Records one MCP tool call. Shared by both products' tools. */
  addAuditEntry(userId: string, entry: McpAuditEntry): Promise<void>
}

/** The company side's server-only reads and writes. */
export interface CrmServerAdapter {
  /** The (engagement, month) pair is unique, so this is an upsert lookup. */
  getAllocationByKey(
    userId: string,
    engagementId: string,
    yearMonth: string,
  ): Promise<Allocation | null>
  /**
   * Marks an invoice paid into a company account and, when the bank kept a fee,
   * books it as the bank_fees cost `bank-fee-<invoiceId>` on the same day and
   * account, in one atomic write: the book never holds the payment without its
   * fee, nor the fee without the payment. A fee already booked for the invoice
   * fails the whole write.
   */
  settleInvoicePayment(
    userId: string,
    input: { invoiceId: string; paidDate: Date; paidAccountId: string; fee?: number },
  ): Promise<{ invoice: Invoice; fee: CompanyExpense | null }>
}