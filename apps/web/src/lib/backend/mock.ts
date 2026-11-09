import { createMockRent } from "@alter-ego/rent/adapter-mock"

import { ASSIGNMENT_EXISTS, ASSIGNMENT_HAS_DAYS, assignmentId, COLLABORATOR_HAS_DAYS, timecardId } from "@/lib/assignments"
import { ACCOUNT_HAS_ENTRIES, BILL_HAS_PAYMENTS, CLIENT_HAS_CASH, NON_CASH, leavesSupplierDocument } from "@/lib/cash-book"
import { byActiveThenName } from "@/lib/collaborators"
import { CONTRACT_HAS_HOURS, normalizeAmendments } from "@/lib/engagements"
import { checkInvoiceFile } from "@/lib/invoice-files"
import { normalizeLabels } from "@/lib/tasks"
import {
  capacityDocSchema,
  cashFloorSchema,
  createCompanyAccountSchema,
  createCompanyExpenseSchema,
  createCompanyLoanSchema,
  createCompanyMovementSchema,
  assignmentFields,
  collaboratorFields,
  solutionFields,
} from "@/types/schemas"

import type {
  BackendAdapter,
  AuthAdapter,
  DatabaseAdapter,
  AuditAdapter,
  CrmServerAdapter,
  FilesAdapter,
} from "./types"
import type {
  CapacityDoc,
  McpAuditEntry,
  User,
  ApiKey,
  CompanyExpense,
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
  Client,
  Opportunity,
  Engagement,
  Allocation,
  CompanyDeadline,
  CreateCompanyDeadlineInput,
  UpdateCompanyDeadlineInput,
  InvoiceFile,
} from "@/types"

let mockUser: User | null = null
let authCallbacks: Array<(user: User | null) => void> = []

const apiKeys: Map<string, ApiKey> = new Map()
const companyExpenses: Map<string, CompanyExpense> = new Map()
const companyLoans: Map<string, CompanyLoan> = new Map()
const companyAccounts: Map<string, CompanyAccount> = new Map()
const companySettings: Map<string, CompanySettings> = new Map()
const companyMovements: Map<string, CompanyMovement> = new Map()
const clients: Map<string, Client> = new Map()
const opportunities: Map<string, Opportunity> = new Map()
const engagements: Map<string, Engagement> = new Map()
const allocations: Map<string, Allocation> = new Map()
// Server-only stores, keyed by userId. Not reachable from the client adapter by
// design — firestore.rules closes both collections.
const capacityDocs: Map<string, Map<string, CapacityDoc>> = new Map()
const auditEntries: Map<string, McpAuditEntry[]> = new Map()
const tasks: Map<string, Task> = new Map()
// Keyed `${userId}/${id}`: the id is deterministic, so two users can share one.
const timecards: Map<string, Timecard> = new Map()
const meetings: Map<string, Meeting> = new Map()
const solutions: Map<string, Solution> = new Map()
const collaborators: Map<string, Collaborator> = new Map()
const assignments: Map<string, Assignment> = new Map()
const invoices: Map<string, Invoice> = new Map()
const companyDeadlines: Map<string, CompanyDeadline> = new Map()

/**
 * An allocation is meaningless without its contract — nothing in the UI can
 * reach one whose engagement is gone. Deleting the contract takes them along.
 */
function deleteAssignmentsOf(engagementId: string) {
  for (const [id, a] of assignments) {
    if (a.engagementId === engagementId) assignments.delete(id)
  }
}

/** Whether days are logged for a collaborator, on one contract or on any. */
function hasDaysLogged(userId: string, collaboratorId: string, engagementId?: string) {
  return [...timecards.values()].some(
    (t) => t.userId === userId && t.collaboratorId === collaboratorId && (!engagementId || t.engagementId === engagementId),
  )
}

function deleteAllocationsOf(engagementId: string) {
  for (const [id, a] of allocations) {
    if (a.engagementId === engagementId) allocations.delete(id)
  }
}

/** The keys of an update that are set: undefined means "leave it", as in every update here. */
function definedOnly<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** A parsed cost input on top of the stored identity, optional fields as null or false. */
function companyExpenseOf(base: Pick<CompanyExpense, "id" | "userId" | "createdAt">, v: CreateCompanyExpenseInput): CompanyExpense {
  return {
    id: base.id,
    userId: base.userId,
    description: v.description,
    category: v.category,
    amount: v.amount,
    date: v.date,
    isRecurring: v.isRecurring ?? false,
    recurrenceMonths: v.recurrenceMonths ?? null,
    notes: v.notes ?? null,
    accountId: v.accountId ?? null,
    paidByOwner: v.paidByOwner ?? false,
    vat: v.vat ?? null,
    documentRef: v.documentRef ?? null,
    project: v.project ?? null,
    recurringExpenseId: v.recurringExpenseId ?? null,
    dateEstimated: v.dateEstimated ?? false,
    importRef: v.importRef ?? null,
    collaboratorId: v.collaboratorId ?? null,
    engagementId: v.engagementId ?? null,
    forMonth: v.forMonth ?? null,
    leaseId: v.leaseId ?? null,
    endMonth: v.endMonth ?? null,
    priceChanges: v.priceChanges ?? [],
    countedWhenPaid: v.countedWhenPaid ?? false,
    file: v.file ?? null,
    createdAt: base.createdAt,
    updatedAt: new Date(),
  }
}

/** A parsed loan input on top of the stored identity, optional fields as null or false. */
function companyLoanOf(base: Pick<CompanyLoan, "id" | "userId" | "createdAt">, v: CreateCompanyLoanInput): CompanyLoan {
  return {
    id: base.id,
    userId: base.userId,
    description: v.description,
    direction: v.direction,
    amount: v.amount,
    date: v.date,
    notes: v.notes ?? null,
    accountId: v.accountId ?? null,
    dateEstimated: v.dateEstimated ?? false,
    importRef: v.importRef ?? null,
    createdAt: base.createdAt,
    updatedAt: new Date(),
  }
}

/** A parsed account input on top of the stored identity, optional fields as null. */
function companyAccountOf(base: Pick<CompanyAccount, "id" | "userId" | "createdAt">, v: CreateCompanyAccountInput): CompanyAccount {
  return {
    id: base.id,
    userId: base.userId,
    name: v.name,
    openingBalance: v.openingBalance,
    openingDate: v.openingDate,
    statementBalance: v.statementBalance ?? null,
    statementDate: v.statementDate ?? null,
    importRef: v.importRef ?? null,
    createdAt: base.createdAt,
    updatedAt: new Date(),
  }
}

/** A parsed movement input on top of the stored identity, optional fields as null. */
function companyMovementOf(base: Pick<CompanyMovement, "id" | "userId" | "createdAt">, v: CreateCompanyMovementInput): CompanyMovement {
  return {
    id: base.id,
    userId: base.userId,
    kind: v.kind,
    direction: v.direction,
    amount: v.amount,
    date: v.date,
    accountId: v.accountId,
    toAccountId: v.toAccountId ?? null,
    expenseId: v.expenseId ?? null,
    description: v.description,
    documentRef: v.documentRef ?? null,
    project: v.project ?? null,
    counterparty: v.counterparty ?? null,
    notes: v.notes ?? null,
    dateEstimated: v.dateEstimated ?? false,
    importRef: v.importRef ?? null,
    leaseId: v.leaseId ?? null,
    rentMonth: v.rentMonth ?? null,
    rentPart: v.rentPart ?? null,
    createdAt: base.createdAt,
    updatedAt: new Date(),
  }
}

let idCounter = 0
function nextId(): string {
  return `mock-${++idCounter}`
}

// ── Invoice files: the objects, in memory ──────────────────────────────────

const mockFiles: Map<string, Blob> = new Map()

/** A deleted cost, invoice or client takes its file with it. */
function dropFile(file: InvoiceFile | null | undefined, userId: string): void {
  if (file?.path.startsWith(`users/${userId}/company-files/`)) mockFiles.delete(file.path)
}

const mockFilesAdapter: FilesAdapter = {
  async upload(userId, file, name) {
    const check = checkInvoiceFile({ name, size: file.size })
    if (!check.ok) throw new Error(check.reason)
    const ext = check.kind === "p7m" ? "xml.p7m" : check.kind
    const path = `users/${userId}/company-files/${nextId()}.${ext}`
    mockFiles.set(path, file)
    return { path, name, kind: check.kind, size: file.size, uploadedAt: new Date() }
  },
  async download(file) {
    const blob = mockFiles.get(file.path)
    if (!blob) throw new Error("File not found")
    return blob
  },
  async remove(path) {
    mockFiles.delete(path)
  },
}

function notifyAuthListeners() {
  authCallbacks.forEach((cb) => cb(mockUser))
}

const mockAuth: AuthAdapter = {
  async signIn(email: string, _password: string): Promise<User> {
    mockUser = {
      id: "mock-user-1",
      email,
      displayName: email.split("@")[0],
      photoURL: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    notifyAuthListeners()
    return mockUser
  },

  async signUp(email: string, _password: string, displayName: string): Promise<User> {
    mockUser = {
      id: "mock-user-1",
      email,
      displayName,
      photoURL: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    notifyAuthListeners()
    return mockUser
  },

  async signOut(): Promise<void> {
    mockUser = null
    notifyAuthListeners()
  },

  async getCurrentUser(): Promise<User | null> {
    return mockUser
  },

  // ponytail: not a real signed token — the mock backend has no signing key, and
  // the server rejects it. OAuth against the mock backend is not a supported combo.
  async getIdToken(): Promise<string | null> {
    return mockUser ? `mock-id-token:${mockUser.id}` : null
  },

  onAuthStateChanged(callback: (user: User | null) => void): () => void {
    authCallbacks.push(callback)
    callback(mockUser)
    return () => {
      authCallbacks = authCallbacks.filter((cb) => cb !== callback)
    }
  },

  async updateProfile(input: { displayName?: string; email?: string }): Promise<void> {
    if (!mockUser) throw new Error("Not signed in")
    mockUser = {
      ...mockUser,
      displayName: input.displayName !== undefined ? input.displayName : mockUser.displayName,
      email: input.email !== undefined ? input.email : mockUser.email,
      updatedAt: new Date(),
    }
    notifyAuthListeners()
  },
}

const { rent: mockRent, clear: clearRent } = createMockRent(nextId)

const mockDb: DatabaseAdapter & AuditAdapter & CrmServerAdapter & { validateApiKey(keyHash: string): Promise<string | null> } = {
  ...mockRent,

  // API keys
  async createApiKey(userId: string): Promise<{ key: string; id: string }> {
    const id = nextId()
    const rawKey = `ak_${id}_${Math.random().toString(36).slice(2, 14)}`
    const prefix = rawKey.slice(0, 7) + "..."
    // Hash the key for storage (matches what api-auth.ts sends to validateApiKey)
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawKey))
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    const apiKey: ApiKey = {
      id,
      userId,
      keyHash,
      prefix,
      createdAt: new Date(),
    }
    apiKeys.set(id, apiKey)
    return { key: rawKey, id }
  },

  async validateApiKey(keyHash: string): Promise<string | null> {
    for (const ak of apiKeys.values()) {
      if (ak.keyHash === keyHash) return ak.userId
    }
    return null
  },

  async deleteApiKey(userId: string, keyId: string): Promise<void> {
    const ak = apiKeys.get(keyId)
    if (ak && ak.userId !== userId) return
    apiKeys.delete(keyId)
  },

  async getApiKeys(userId: string): Promise<Pick<ApiKey, "id" | "prefix" | "createdAt">[]> {
    return Array.from(apiKeys.values())
      .filter((ak) => ak.userId === userId)
      .map(({ id, prefix, createdAt }) => ({ id, prefix, createdAt }))
  },

  // ── Company Expenses ───────────────────────────────────────────────────────

  async getCompanyExpenses(userId: string): Promise<CompanyExpense[]> {
    return Array.from(companyExpenses.values())
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.date.getTime() - a.date.getTime())
  },

  // Costs and loans are parsed with the shared zod schemas, standing in for the
  // rules; an update parses the merged document, as the rules read incoming().

  async createCompanyExpense(userId: string, input: CreateCompanyExpenseInput): Promise<CompanyExpense> {
    const expense = companyExpenseOf({ id: nextId(), userId, createdAt: new Date() }, createCompanyExpenseSchema.parse(input))
    companyExpenses.set(expense.id, expense)
    return expense
  },

  async updateCompanyExpense(userId: string, expenseId: string, input: UpdateCompanyExpenseInput): Promise<CompanyExpense> {
    const e = companyExpenses.get(expenseId)
    if (!e || e.userId !== userId) throw new Error("Company expense not found")
    if (leavesSupplierDocument(input) && Array.from(companyMovements.values()).some((m) => m.userId === userId && m.expenseId === expenseId)) {
      throw new Error(BILL_HAS_PAYMENTS)
    }
    const updated = companyExpenseOf(e, createCompanyExpenseSchema.parse({ ...e, ...definedOnly(input) }))
    companyExpenses.set(expenseId, updated)
    return updated
  },

  async deleteCompanyExpense(userId: string, expenseId: string): Promise<void> {
    const e = companyExpenses.get(expenseId)
    if (!e || e.userId !== userId) return
    const paid = Array.from(companyMovements.values()).some((m) => m.userId === userId && m.expenseId === expenseId)
    if (paid) throw new Error(BILL_HAS_PAYMENTS)
    dropFile(e.file, userId)
    companyExpenses.delete(expenseId)
  },

  // ── Company Loans (finanziamento soci) ─────────────────────────────────────

  async getCompanyLoans(userId: string): Promise<CompanyLoan[]> {
    return Array.from(companyLoans.values())
      .filter((l) => l.userId === userId)
      .sort((a, b) => b.date.getTime() - a.date.getTime())
  },

  async createCompanyLoan(userId: string, input: CreateCompanyLoanInput): Promise<CompanyLoan> {
    const loan = companyLoanOf({ id: nextId(), userId, createdAt: new Date() }, createCompanyLoanSchema.parse(input))
    companyLoans.set(loan.id, loan)
    return loan
  },

  async updateCompanyLoan(userId: string, loanId: string, input: UpdateCompanyLoanInput): Promise<CompanyLoan> {
    const l = companyLoans.get(loanId)
    if (!l || l.userId !== userId) throw new Error("Company loan not found")
    const updated = companyLoanOf(l, createCompanyLoanSchema.parse({ ...l, ...definedOnly(input) }))
    companyLoans.set(loanId, updated)
    return updated
  },

  async deleteCompanyLoan(userId: string, loanId: string): Promise<void> {
    const l = companyLoans.get(loanId)
    if (l && l.userId === userId) companyLoans.delete(loanId)
  },

  // ── Company Accounts and Movements (the cash book) ─────────────────────────
  //
  // Parsed with the shared zod schemas, standing in for the rules that check the
  // Firebase writes. An update parses the merged document, as the rules read
  // incoming() on update.

  async getCompanySettings(userId: string): Promise<CompanySettings> {
    return { ...(companySettings.get(userId) ?? { cashFloor: null }) }
  },

  async setCompanyCashFloor(userId: string, floor: number | null): Promise<CompanySettings> {
    const settings = { cashFloor: cashFloorSchema.parse(floor) }
    companySettings.set(userId, settings)
    return { ...settings }
  },

  async getCompanyAccounts(userId: string): Promise<CompanyAccount[]> {
    return Array.from(companyAccounts.values())
      .filter((a) => a.userId === userId)
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async createCompanyAccount(userId: string, input: CreateCompanyAccountInput): Promise<CompanyAccount> {
    const v = createCompanyAccountSchema.parse(input)
    const account = companyAccountOf({ id: nextId(), userId, createdAt: new Date() }, v)
    companyAccounts.set(account.id, account)
    return account
  },

  async updateCompanyAccount(userId: string, accountId: string, input: UpdateCompanyAccountInput): Promise<CompanyAccount> {
    const a = companyAccounts.get(accountId)
    if (!a || a.userId !== userId) throw new Error("Company account not found")
    const updated = companyAccountOf(a, createCompanyAccountSchema.parse({ ...a, ...definedOnly(input) }))
    companyAccounts.set(accountId, updated)
    return updated
  },

  async deleteCompanyAccount(userId: string, accountId: string): Promise<void> {
    const inUse =
      Array.from(companyMovements.values()).some(
        (m) => m.userId === userId && (m.accountId === accountId || m.toAccountId === accountId),
      ) ||
      Array.from(invoices.values()).some((i) => i.userId === userId && i.paidDate && i.paidAccountId === accountId) ||
      Array.from(companyExpenses.values()).some((e) => e.userId === userId && e.accountId === accountId) ||
      Array.from(companyLoans.values()).some((l) => l.userId === userId && l.accountId === accountId)
    if (inUse) throw new Error(ACCOUNT_HAS_ENTRIES)
    // An unpaid invoice keeps the account from an untick: clear it, or a re-tick
    // with the date alone pays it into a gone account.
    for (const i of invoices.values()) {
      if (i.userId === userId && i.paidAccountId === accountId) {
        invoices.set(i.id, { ...i, paidAccountId: null, updatedAt: new Date() })
      }
    }
    const a = companyAccounts.get(accountId)
    if (a && a.userId === userId) companyAccounts.delete(accountId)
  },

  async getCompanyMovements(userId: string): Promise<CompanyMovement[]> {
    return Array.from(companyMovements.values())
      .filter((m) => m.userId === userId)
      .sort((a, b) => b.date.getTime() - a.date.getTime())
  },

  async createCompanyMovement(userId: string, input: CreateCompanyMovementInput): Promise<CompanyMovement> {
    const v = createCompanyMovementSchema.parse(input)
    const movement = companyMovementOf({ id: nextId(), userId, createdAt: new Date() }, v)
    companyMovements.set(movement.id, movement)
    return movement
  },

  async updateCompanyMovement(userId: string, movementId: string, input: UpdateCompanyMovementInput): Promise<CompanyMovement> {
    const m = companyMovements.get(movementId)
    if (!m || m.userId !== userId) throw new Error("Company movement not found")
    const updated = companyMovementOf(m, createCompanyMovementSchema.parse({ ...m, ...definedOnly(input) }))
    companyMovements.set(movementId, updated)
    return updated
  },

  async deleteCompanyMovement(userId: string, movementId: string): Promise<void> {
    const m = companyMovements.get(movementId)
    if (m && m.userId === userId) companyMovements.delete(movementId)
  },

  // ── CRM Clients ───────────────────────────────────────────────────────────

  async getClients(userId: string, filter?: { activeOnly?: boolean }): Promise<Client[]> {
    return Array.from(clients.values())
      .filter((c) => c.userId === userId)
      .filter((c) => !filter?.activeOnly || c.isActive)
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async createClient(userId: string, input: CreateClientInput): Promise<Client> {
    const now = new Date()
    const client: Client = {
      id: nextId(),
      userId,
      name: input.name,
      vatNumber: input.vatNumber ?? null,
      email: input.email ?? null,
      contactName: input.contactName ?? null,
      contactPhone: input.contactPhone ?? null,
      notes: input.notes ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }
    clients.set(client.id, client)
    return client
  },

  async updateClient(userId: string, clientId: string, input: UpdateClientInput): Promise<Client> {
    const c = clients.get(clientId)
    if (!c || c.userId !== userId) throw new Error("Client not found")
    const updated: Client = {
      ...c,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.vatNumber !== undefined && { vatNumber: input.vatNumber }),
      ...(input.email !== undefined && { email: input.email }),
      ...(input.contactName !== undefined && { contactName: input.contactName }),
      ...(input.contactPhone !== undefined && { contactPhone: input.contactPhone }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      updatedAt: new Date(),
    }
    clients.set(clientId, updated)
    return updated
  },

  async deleteClient(userId: string, clientId: string): Promise<void> {
    const c = clients.get(clientId)
    if (!c || c.userId !== userId) return
    // The invoices deleted below: by client, and older ones by contract.
    const contracts = new Set(
      Array.from(engagements.values()).filter((e) => e.userId === userId && e.clientId === clientId).map((e) => e.id),
    )
    const hasCash = Array.from(invoices.values()).some(
      (i) =>
        i.userId === userId &&
        (i.clientId === clientId || (i.engagementId !== null && contracts.has(i.engagementId))) &&
        i.paidDate &&
        i.paidAccountId &&
        i.paidAccountId !== NON_CASH,
    )
    if (hasCash) throw new Error(CLIENT_HAS_CASH)
    clients.delete(clientId)
    for (const [id, o] of opportunities) {
      if (o.userId === userId && o.clientId === clientId) opportunities.delete(id)
    }
    // Its own tasks, client-level ones included; tasks from before #164 carry no
    // clientId and go with their contract below.
    for (const [id, t] of tasks) {
      if (t.userId === userId && t.clientId === clientId) tasks.delete(id)
    }
    // Every verbale names its client, so this covers the contract-level ones too.
    for (const [id, m] of meetings) {
      if (m.userId === userId && m.clientId === clientId) meetings.delete(id)
    }
    // Likewise every solution, pre-sales ones included.
    for (const [id, x] of solutions) {
      if (x.userId === userId && x.clientId === clientId) solutions.delete(id)
    }
    // Its invoices, re-pointed ones included; older ones name just their contract, below.
    for (const [id, i] of invoices) {
      if (i.userId === userId && i.clientId === clientId) {
        dropFile(i.file, userId)
        invoices.delete(id)
      }
    }
    for (const [id, e] of engagements) {
      if (e.userId === userId && e.clientId === clientId) {
        engagements.delete(id)
        deleteAllocationsOf(id)
        deleteAssignmentsOf(id)
        for (const [taskId, t] of tasks) {
          if (t.engagementId === id) tasks.delete(taskId)
        }
        for (const [key, t] of timecards) {
          if (t.userId === userId && t.engagementId === id) timecards.delete(key)
        }
        for (const [invoiceId, i] of invoices) {
          if (i.engagementId === id) {
            dropFile(i.file, userId)
            invoices.delete(invoiceId)
          }
        }
      }
    }
  },

  // ── CRM Opportunities ─────────────────────────────────────────────────────

  async getOpportunities(userId: string, filter?: { openOnly?: boolean }): Promise<Opportunity[]> {
    return Array.from(opportunities.values())
      .filter((o) => o.userId === userId)
      .filter((o) => !filter?.openOnly || (o.stage !== "won" && o.stage !== "lost"))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  },

  async createOpportunity(userId: string, input: CreateOpportunityInput): Promise<Opportunity> {
    const now = new Date()
    const opportunity: Opportunity = {
      id: nextId(),
      userId,
      clientId: input.clientId,
      title: input.title,
      stage: input.stage,
      probability: input.probability,
      dailyRate: input.dailyRate,
      estimatedDaysPerMonth: input.estimatedDaysPerMonth,
      ...(input.unit && { unit: input.unit }),
      estimatedDurationMonths: input.estimatedDurationMonths,
      expectedStartMonth: input.expectedStartMonth ?? null,
      vatApplicable: input.vatApplicable,
      nextActionDate: input.nextActionDate ?? null,
      nextActionNote: input.nextActionNote ?? null,
      notes: input.notes ?? null,
      lostReason: null,
      closedAt: null,
      engagementId: null,
      createdAt: now,
      updatedAt: now,
    }
    opportunities.set(opportunity.id, opportunity)
    return opportunity
  },

  async updateOpportunity(userId: string, opportunityId: string, input: UpdateOpportunityInput): Promise<Opportunity> {
    const o = opportunities.get(opportunityId)
    if (!o || o.userId !== userId) throw new Error("Opportunity not found")
    const updated: Opportunity = {
      ...o,
      ...(input.clientId !== undefined && { clientId: input.clientId }),
      ...(input.title !== undefined && { title: input.title }),
      ...(input.stage !== undefined && { stage: input.stage }),
      ...(input.probability !== undefined && { probability: input.probability }),
      ...(input.dailyRate !== undefined && { dailyRate: input.dailyRate }),
      ...(input.unit !== undefined && { unit: input.unit }),
      ...(input.estimatedDaysPerMonth !== undefined && { estimatedDaysPerMonth: input.estimatedDaysPerMonth }),
      ...(input.estimatedDurationMonths !== undefined && { estimatedDurationMonths: input.estimatedDurationMonths }),
      ...(input.expectedStartMonth !== undefined && { expectedStartMonth: input.expectedStartMonth }),
      ...(input.vatApplicable !== undefined && { vatApplicable: input.vatApplicable }),
      ...(input.nextActionDate !== undefined && { nextActionDate: input.nextActionDate }),
      ...(input.nextActionNote !== undefined && { nextActionNote: input.nextActionNote }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.lostReason !== undefined && { lostReason: input.lostReason }),
      ...(input.closedAt !== undefined && { closedAt: input.closedAt }),
      ...(input.engagementId !== undefined && { engagementId: input.engagementId }),
      updatedAt: new Date(),
    }
    opportunities.set(opportunityId, updated)
    return updated
  },

  async deleteOpportunity(userId: string, opportunityId: string): Promise<void> {
    const o = opportunities.get(opportunityId)
    if (o && o.userId === userId) opportunities.delete(opportunityId)
  },

  // ── Engagements (signed contracts) ────────────────────────────────────────

  async getEngagements(userId: string, filter?: { activeOnly?: boolean }): Promise<Engagement[]> {
    return Array.from(engagements.values())
      .filter((e) => e.userId === userId)
      .filter((e) => !filter?.activeOnly || e.isActive)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  },

  async createEngagement(userId: string, input: CreateEngagementInput): Promise<Engagement> {
    const now = new Date()
    const engagement: Engagement = {
      id: nextId(),
      userId,
      clientId: input.clientId,
      name: input.name ?? null,
      opportunityId: input.opportunityId ?? null,
      dailyRate: input.dailyRate,
      ...(input.unit && { unit: input.unit }),
      vatApplicable: input.vatApplicable,
      contractedDays: input.contractedDays ?? null,
      defaultDaysPerMonth: input.defaultDaysPerMonth,
      startMonth: input.startMonth ?? null,
      endMonth: input.endMonth ?? null,
      endDate: input.endDate ?? null,
      isActive: true,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    }
    engagements.set(engagement.id, engagement)
    return engagement
  },

  async updateEngagement(userId: string, engagementId: string, input: UpdateEngagementInput): Promise<Engagement> {
    const e = engagements.get(engagementId)
    if (!e || e.userId !== userId) throw new Error("Engagement not found")
    // A contract moved to another client takes its tasks along (see firebase.ts).
    if (input.clientId !== undefined) {
      for (const [id, t] of tasks) {
        if (t.engagementId === engagementId) tasks.set(id, { ...t, clientId: input.clientId })
      }
      for (const [id, m] of meetings) {
        if (m.userId === userId && m.engagementId === engagementId) meetings.set(id, { ...m, clientId: input.clientId })
      }
      for (const [id, x] of solutions) {
        if (x.userId === userId && x.engagementId === engagementId) solutions.set(id, { ...x, clientId: input.clientId })
      }
    }
    const updated: Engagement = {
      ...e,
      ...(input.clientId !== undefined && { clientId: input.clientId }),
      ...(input.name !== undefined && { name: input.name }),
      ...(input.dailyRate !== undefined && { dailyRate: input.dailyRate }),
      ...(input.unit !== undefined && { unit: input.unit }),
      ...(input.vatApplicable !== undefined && { vatApplicable: input.vatApplicable }),
      ...(input.contractedDays !== undefined && { contractedDays: input.contractedDays }),
      ...(input.defaultDaysPerMonth !== undefined && { defaultDaysPerMonth: input.defaultDaysPerMonth }),
      ...(input.startMonth !== undefined && { startMonth: input.startMonth }),
      ...(input.endMonth !== undefined && { endMonth: input.endMonth }),
      ...(input.endDate !== undefined && { endDate: input.endDate }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      ...(input.notes !== undefined && { notes: input.notes }),
      // A copy, as Firestore would store it: the caller's array must not alias the store.
      ...(input.amendments !== undefined && { amendments: normalizeAmendments(input.amendments) }),
      updatedAt: new Date(),
    }
    engagements.set(engagementId, updated)
    return updated
  },

  async deleteEngagement(userId: string, engagementId: string): Promise<void> {
    const e = engagements.get(engagementId)
    if (!e || e.userId !== userId) return
    // Its hours are what the client's invoices are checked against: close it instead.
    if ([...timecards.values()].some((t) => t.userId === userId && t.engagementId === engagementId)) {
      throw new Error(CONTRACT_HAS_HOURS)
    }
    deleteAssignmentsOf(engagementId)
    // Its tasks outlive it, as tasks of its client (#164).
    for (const [id, t] of tasks) {
      if (t.engagementId === engagementId) tasks.set(id, { ...t, engagementId: null, clientId: e.clientId })
    }
    // So are its verbali: the call history stays with the client, health intact.
    for (const [id, m] of meetings) {
      if (m.userId === userId && m.engagementId === engagementId) {
        meetings.set(id, { ...m, engagementId: null, clientId: e.clientId })
      }
    }
    // Its solutions stay documented, back to pre-sales on the same client.
    for (const [id, x] of solutions) {
      if (x.userId === userId && x.engagementId === engagementId) {
        solutions.set(id, { ...x, engagementId: null, clientId: e.clientId })
      }
    }
    // And its invoices: issued paper bills the client, whatever contract it was recorded on.
    for (const [id, i] of invoices) {
      if (i.userId === userId && i.engagementId === engagementId) {
        invoices.set(id, { ...i, engagementId: null, clientId: e.clientId })
      }
    }
    engagements.delete(engagementId)
    deleteAllocationsOf(engagementId)
  },

  // ── Tasks (a client's to-dos, optionally on a contract) ────────────────────

  async getTasks(userId: string): Promise<Task[]> {
    return Array.from(tasks.values()).filter((t) => t.userId === userId)
  },

  async createTask(userId: string, input: CreateTaskInput): Promise<Task> {
    const now = new Date()
    const task: Task = {
      id: nextId(),
      userId,
      clientId: input.clientId,
      engagementId: input.engagementId ?? null,
      title: input.title,
      dueDate: input.dueDate ?? null,
      notes: input.notes ?? null,
      isDone: false,
      startedAt: null,
      labels: normalizeLabels(input.labels ?? []),
      createdAt: now,
      updatedAt: now,
    }
    tasks.set(task.id, task)
    return task
  },

  async updateTask(userId: string, taskId: string, input: UpdateTaskInput): Promise<Task> {
    const t = tasks.get(taskId)
    if (!t || t.userId !== userId) throw new Error("Task not found")
    const updated: Task = {
      ...t,
      ...(input.clientId !== undefined && { clientId: input.clientId }),
      ...(input.engagementId !== undefined && { engagementId: input.engagementId }),
      ...(input.title !== undefined && { title: input.title }),
      ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.isDone !== undefined && { isDone: input.isDone }),
      ...(input.startedAt !== undefined && { startedAt: input.startedAt }),
      ...(input.labels !== undefined && { labels: normalizeLabels(input.labels) }),
      updatedAt: new Date(),
    }
    tasks.set(taskId, updated)
    return updated
  },

  async deleteTask(userId: string, taskId: string): Promise<void> {
    const t = tasks.get(taskId)
    if (t && t.userId === userId) tasks.delete(taskId)
  },

  // ── Timecards (hours per contract per day) ─────────────────────────────────

  async getTimecards(userId: string): Promise<Timecard[]> {
    return Array.from(timecards.values()).filter((t) => t.userId === userId)
  },

  async setTimecard(userId: string, input: SetTimecardInput): Promise<Timecard> {
    const collaboratorId = input.collaboratorId ?? null
    const id = timecardId(input.engagementId, input.date, collaboratorId)
    const prev = timecards.get(`${userId}/${id}`)
    const now = new Date()
    const timecard: Timecard = {
      id,
      userId,
      engagementId: input.engagementId,
      collaboratorId,
      date: input.date,
      hours: input.hours,
      notes: input.notes === undefined ? (prev?.notes ?? null) : input.notes,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    }
    timecards.set(`${userId}/${id}`, timecard)
    return timecard
  },

  async deleteTimecard(userId: string, engagementId: string, date: string, collaboratorId?: string | null): Promise<void> {
    timecards.delete(`${userId}/${timecardId(engagementId, date, collaboratorId)}`)
  },

  // ── Meetings (verbali: calls and status updates) ───────────────────────────

  async getMeetings(userId: string): Promise<Meeting[]> {
    return Array.from(meetings.values()).filter((m) => m.userId === userId)
  },

  async createMeeting(userId: string, input: CreateMeetingInput): Promise<Meeting> {
    const now = new Date()
    const meeting: Meeting = {
      id: nextId(),
      userId,
      clientId: input.clientId,
      engagementId: input.engagementId ?? null,
      date: input.date,
      time: input.time ?? null,
      health: input.health ?? null,
      text: input.text.trim(),
      createdAt: now,
      updatedAt: now,
    }
    meetings.set(meeting.id, meeting)
    return meeting
  },

  async updateMeeting(userId: string, meetingId: string, input: UpdateMeetingInput): Promise<Meeting> {
    const m = meetings.get(meetingId)
    if (!m || m.userId !== userId) throw new Error("Meeting not found")
    const updated: Meeting = {
      ...m,
      ...(input.engagementId !== undefined && { engagementId: input.engagementId }),
      ...(input.date !== undefined && { date: input.date }),
      ...(input.time !== undefined && { time: input.time }),
      ...(input.health !== undefined && { health: input.health }),
      ...(input.text !== undefined && { text: input.text.trim() }),
      updatedAt: new Date(),
    }
    meetings.set(meetingId, updated)
    return updated
  },

  async deleteMeeting(userId: string, meetingId: string): Promise<void> {
    const m = meetings.get(meetingId)
    if (m && m.userId === userId) meetings.delete(meetingId)
  },

  // ── Collaborators ───────────────────────────────────────────────────────────

  async getCollaborators(userId: string): Promise<Collaborator[]> {
    return Array.from(collaborators.values()).filter((x) => x.userId === userId).sort(byActiveThenName)
  },

  async createCollaborator(userId: string, input: CreateCollaboratorInput): Promise<Collaborator> {
    const now = new Date()
    const collaborator: Collaborator = { id: nextId(), userId, ...collaboratorFields(input), createdAt: now, updatedAt: now }
    collaborators.set(collaborator.id, collaborator)
    return collaborator
  },

  async updateCollaborator(userId: string, collaboratorId: string, input: UpdateCollaboratorInput): Promise<Collaborator> {
    const x = collaborators.get(collaboratorId)
    if (!x || x.userId !== userId) throw new Error("Collaborator not found")
    const updated: Collaborator = { ...x, ...collaboratorFields(x, input), updatedAt: new Date() }
    collaborators.set(collaboratorId, updated)
    return updated
  },

  async deleteCollaborator(userId: string, collaboratorId: string): Promise<void> {
    const x = collaborators.get(collaboratorId)
    if (!x || x.userId !== userId) return
    if (hasDaysLogged(userId, collaboratorId)) throw new Error(COLLABORATOR_HAS_DAYS)
    collaborators.delete(collaboratorId)
    for (const [id, a] of assignments) if (a.collaboratorId === collaboratorId) assignments.delete(id)
  },

  // ── Assignments (a collaborator's days on a contract) ──────────────────────

  async getAssignments(userId: string): Promise<Assignment[]> {
    return Array.from(assignments.values()).filter((a) => a.userId === userId)
  },

  async createAssignment(userId: string, input: CreateAssignmentInput): Promise<Assignment> {
    const c = collaborators.get(input.collaboratorId)
    const e = engagements.get(input.engagementId)
    if (!c || c.userId !== userId) throw new Error("Collaborator not found")
    if (!e || e.userId !== userId) throw new Error("Contract not found")
    const id = assignmentId(input.collaboratorId, input.engagementId)
    if (assignments.has(id)) throw new Error(ASSIGNMENT_EXISTS)
    const now = new Date()
    const assignment: Assignment = { id, userId, ...assignmentFields(input), createdAt: now, updatedAt: now }
    assignments.set(assignment.id, assignment)
    return assignment
  },

  async updateAssignment(userId: string, assignmentId: string, input: UpdateAssignmentInput): Promise<Assignment> {
    const a = assignments.get(assignmentId)
    if (!a || a.userId !== userId) throw new Error("Assignment not found")
    const updated: Assignment = { ...a, ...assignmentFields(a, input), updatedAt: new Date() }
    assignments.set(assignmentId, updated)
    return updated
  },

  async deleteAssignment(userId: string, assignmentId: string): Promise<void> {
    const a = assignments.get(assignmentId)
    if (!a || a.userId !== userId) return
    if (hasDaysLogged(userId, a.collaboratorId, a.engagementId)) throw new Error(ASSIGNMENT_HAS_DAYS)
    assignments.delete(assignmentId)
  },

  // ── Solutions (what was built for a client, kept for pre-sales) ────────────

  async getSolutions(userId: string): Promise<Solution[]> {
    return Array.from(solutions.values()).filter((x) => x.userId === userId)
  },

  async createSolution(userId: string, input: CreateSolutionInput): Promise<Solution> {
    const now = new Date()
    const solution: Solution = { id: nextId(), userId, ...solutionFields(input), createdAt: now, updatedAt: now }
    solutions.set(solution.id, solution)
    return solution
  },

  async updateSolution(userId: string, solutionId: string, input: UpdateSolutionInput): Promise<Solution> {
    const x = solutions.get(solutionId)
    if (!x || x.userId !== userId) throw new Error("Solution not found")
    const updated: Solution = { ...x, ...solutionFields(x, input), updatedAt: new Date() }
    solutions.set(solutionId, updated)
    return updated
  },

  async deleteSolution(userId: string, solutionId: string): Promise<void> {
    const x = solutions.get(solutionId)
    if (x && x.userId === userId) solutions.delete(solutionId)
  },

  // ── Invoices (a customer's record of issued paper) ───────────────────────

  async getInvoices(userId: string): Promise<Invoice[]> {
    return Array.from(invoices.values()).filter((i) => i.userId === userId)
  },

  async createInvoice(userId: string, input: CreateInvoiceInput): Promise<Invoice> {
    const now = new Date()
    const invoice: Invoice = {
      id: nextId(),
      userId,
      clientId: input.clientId,
      engagementId: null,
      number: input.number,
      fromMonth: input.fromMonth ?? null,
      yearMonth: input.yearMonth,
      amount: input.amount,
      vat: input.vat,
      dueDate: input.dueDate ?? null,
      paidDate: input.paidDate ?? null,
      paidAccountId: input.paidAccountId ?? null,
      file: input.file ?? null,
      createdAt: now,
      updatedAt: now,
    }
    invoices.set(invoice.id, invoice)
    return invoice
  },

  async updateInvoice(userId: string, invoiceId: string, input: UpdateInvoiceInput): Promise<Invoice> {
    const i = invoices.get(invoiceId)
    if (!i || i.userId !== userId) throw new Error("Invoice not found")
    const updated: Invoice = {
      ...i,
      ...(input.number !== undefined && { number: input.number }),
      ...(input.fromMonth !== undefined && { fromMonth: input.fromMonth }),
      ...(input.yearMonth !== undefined && { yearMonth: input.yearMonth }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.vat !== undefined && { vat: input.vat }),
      ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
      ...(input.paidDate !== undefined && { paidDate: input.paidDate }),
      ...(input.paidAccountId !== undefined && { paidAccountId: input.paidAccountId }),
      ...(input.file !== undefined && { file: input.file }),
      updatedAt: new Date(),
    }
    invoices.set(invoiceId, updated)
    return updated
  },

  async deleteInvoice(userId: string, invoiceId: string): Promise<void> {
    const i = invoices.get(invoiceId)
    if (i && i.userId === userId) {
      dropFile(i.file, userId)
      invoices.delete(invoiceId)
    }
  },

  // ── Company Deadlines ─────────────────────────────────────────────────────

  async getCompanyDeadlines(userId: string): Promise<CompanyDeadline[]> {
    return Array.from(companyDeadlines.values())
      .filter((d) => d.userId === userId)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
  },

  async createCompanyDeadline(userId: string, input: CreateCompanyDeadlineInput): Promise<CompanyDeadline> {
    const now = new Date()
    const deadline: CompanyDeadline = {
      id: nextId(),
      userId,
      title: input.title,
      date: input.date,
      kind: input.kind,
      amount: input.amount ?? null,
      notes: input.notes ?? null,
      isDone: false,
      createdAt: now,
      updatedAt: now,
    }
    companyDeadlines.set(deadline.id, deadline)
    return deadline
  },

  async updateCompanyDeadline(userId: string, deadlineId: string, input: UpdateCompanyDeadlineInput): Promise<CompanyDeadline> {
    const d = companyDeadlines.get(deadlineId)
    if (!d || d.userId !== userId) throw new Error("Company deadline not found")
    const updated: CompanyDeadline = {
      ...d,
      ...(input.title !== undefined && { title: input.title }),
      ...(input.date !== undefined && { date: input.date }),
      ...(input.kind !== undefined && { kind: input.kind }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.isDone !== undefined && { isDone: input.isDone }),
      updatedAt: new Date(),
    }
    companyDeadlines.set(deadlineId, updated)
    return updated
  },

  async deleteCompanyDeadline(userId: string, deadlineId: string): Promise<void> {
    const d = companyDeadlines.get(deadlineId)
    if (d && d.userId === userId) companyDeadlines.delete(deadlineId)
  },

  // ── Allocations ───────────────────────────────────────────────────────────

  async getAllocations(
    userId: string,
    filter?: { from?: string; to?: string; engagementId?: string }
  ): Promise<Allocation[]> {
    return Array.from(allocations.values())
      .filter((a) => a.userId === userId)
      .filter((a) => !filter?.engagementId || a.engagementId === filter.engagementId)
      .filter((a) => !filter?.from || a.yearMonth >= filter.from)
      .filter((a) => !filter?.to || a.yearMonth <= filter.to)
      .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
  },

  async createAllocation(userId: string, input: CreateAllocationInput): Promise<Allocation> {
    const now = new Date()
    const allocation: Allocation = {
      id: nextId(),
      userId,
      engagementId: input.engagementId,
      yearMonth: input.yearMonth,
      days: input.days,
      createdAt: now,
      updatedAt: now,
    }
    allocations.set(allocation.id, allocation)
    return allocation
  },

  async updateAllocation(userId: string, allocationId: string, input: UpdateAllocationInput): Promise<Allocation> {
    const a = allocations.get(allocationId)
    if (!a || a.userId !== userId) throw new Error("Allocation not found")
    const updated: Allocation = {
      ...a,
      ...(input.days !== undefined && { days: input.days }),
      updatedAt: new Date(),
    }
    allocations.set(allocationId, updated)
    return updated
  },

  async deleteAllocation(userId: string, allocationId: string): Promise<void> {
    const a = allocations.get(allocationId)
    if (a && a.userId === userId) allocations.delete(allocationId)
  },

  // ── Server-only (see AuditAdapter / CrmServerAdapter) ─────────────────────

  async addAuditEntry(userId: string, entry: McpAuditEntry): Promise<void> {
    const forUser = auditEntries.get(userId) ?? []
    forUser.push(entry)
    auditEntries.set(userId, forUser)
  },

  async getCapacityDocs(
    userId: string,
    filter: { from: string; to: string },
  ): Promise<CapacityDoc[]> {
    return Array.from(capacityDocs.get(userId)?.values() ?? [])
      .filter((d) => d.yearMonth >= filter.from && d.yearMonth <= filter.to)
      .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
  },

  // Keyed by yearMonth, so blocking the same month twice overwrites rather than
  // stacking — same idempotence the Firestore doc id gives.
  async setCapacity(userId: string, doc: CapacityDoc): Promise<void> {
    capacityDocSchema.parse(doc) // stands in for the rules' closed schema
    const forUser = capacityDocs.get(userId) ?? new Map<string, CapacityDoc>()
    forUser.set(doc.yearMonth, doc)
    capacityDocs.set(userId, forUser)
  },

  async getAllocationByKey(
    userId: string,
    engagementId: string,
    yearMonth: string,
  ): Promise<Allocation | null> {
    return (
      Array.from(allocations.values()).find(
        (a) => a.userId === userId && a.engagementId === engagementId && a.yearMonth === yearMonth,
      ) ?? null
    )
  },

  // ponytail: sequential, the fee first: a fee refused (or already booked) leaves
  // the invoice unpaid, which is what the Admin batch guarantees.
  async settleInvoicePayment(userId, input) {
    const i = invoices.get(input.invoiceId)
    if (!i || i.userId !== userId) throw new Error("Invoice not found")
    let fee: CompanyExpense | null = null
    if (input.fee) {
      const id = `bank-fee-${i.id}`
      if (companyExpenses.has(id)) throw new Error(`A bank fee is already booked for invoice ${i.number}`)
      const v = createCompanyExpenseSchema.parse({
        description: `Bank fee on invoice ${i.number}`,
        category: "bank_fees",
        amount: input.fee,
        date: input.paidDate,
        accountId: input.paidAccountId,
      })
      fee = companyExpenseOf({ id, userId, createdAt: new Date() }, v)
      companyExpenses.set(id, fee)
    }
    const invoice = { ...i, paidDate: input.paidDate, paidAccountId: input.paidAccountId, updatedAt: new Date() }
    invoices.set(i.id, invoice)
    return { invoice, fee }
  },
}

/** Test-only: stores a task as the app wrote it before #164 — a contract, no clientId. */
export function __seedLegacyTask(userId: string, engagementId: string, title: string): Task {
  const now = new Date()
  const task: Task = {
    id: nextId(), userId, clientId: null, engagementId, title, dueDate: null, notes: null,
    isDone: false, startedAt: null, labels: [], createdAt: now, updatedAt: now,
  }
  tasks.set(task.id, task)
  return task
}

/** Test-only: stores an invoice as the app wrote it before invoices named their customer — a contract, no clientId. */
export function __seedLegacyInvoice(userId: string, engagementId: string, number: string): Invoice {
  const now = new Date()
  const invoice: Invoice = {
    id: nextId(), userId, clientId: null, engagementId, number, fromMonth: null, yearMonth: "2027-01", amount: 1000, vat: 220,
    dueDate: null, paidDate: null, paidAccountId: null, file: null, createdAt: now, updatedAt: now,
  }
  invoices.set(invoice.id, invoice)
  return invoice
}

export function __resetMockState() {
  apiKeys.clear()
  companyExpenses.clear()
  companyLoans.clear()
  companyAccounts.clear()
  companySettings.clear()
  companyMovements.clear()
  clients.clear()
  opportunities.clear()
  engagements.clear()
  allocations.clear()
  tasks.clear()
  timecards.clear()
  meetings.clear()
  solutions.clear()
  collaborators.clear()
  clearRent()
  assignments.clear()
  invoices.clear()
  companyDeadlines.clear()
  mockFiles.clear()
  authCallbacks = []
  mockUser = null
  idCounter = 0
}

/**
 * Opt-in latency, for e2e only. The mock answers in a microtask, so a page's
 * loading state never lasts long enough to assert on. A spec sets
 * `window.__MOCK_LATENCY_MS__` and every db call then waits that long first.
 * It is read on each call, so a spec can seed its data at full speed and slow
 * down afterwards. A runtime global, not a NEXT_PUBLIC_ variable: those are
 * inlined when the dev server compiles, and all specs share that one server.
 * Unset, which is always the case outside e2e, it changes nothing.
 */
function withLatency<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver)
      const ms = (globalThis as { __MOCK_LATENCY_MS__?: number }).__MOCK_LATENCY_MS__
      if (!ms || typeof value !== "function") return value
      return async (...args: unknown[]) => {
        await new Promise((resolve) => setTimeout(resolve, ms))
        return value.apply(target, args)
      }
    },
  })
}

export function createMockAdapter(): BackendAdapter {
  return {
    auth: mockAuth,
    db: withLatency(mockDb),
    files: withLatency(mockFilesAdapter),
  }
}
