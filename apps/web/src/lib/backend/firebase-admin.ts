/**
 * Server-side Firebase access using firebase-admin SDK.
 *
 * Why this exists: Next.js API routes run server-side with no Firebase Auth
 * session, so the browser-oriented Web SDK adapter (firebase.ts) gets
 * PERMISSION_DENIED on every rules-protected write. Admin SDK bypasses
 * rules and is the correct server-side primitive.
 *
 * Scope: only the methods the MCP server and the OAuth routes call. Extend as needed.
 */

import { createHash } from "node:crypto"

import { createFirebaseRent } from "@alter-ego/rent/adapter-firebase"
import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore"

import { ASSIGNMENT_EXISTS, ASSIGNMENT_HAS_DAYS, assignmentId, timecardId } from "@/lib/assignments"
import { readCapacityDoc } from "@/lib/capacity"
import { BILL_HAS_PAYMENTS, leavesSupplierDocument } from "@/lib/cash-book"
import { normalizeAmendments } from "@/lib/engagements"
import { getAdminBucket, getAdminFirestore } from "@/lib/firebase-admin-client"
import { checkInvoiceFile, INVOICE_FILE_CONTENT_TYPE, INVOICE_FILE_EXTENSION } from "@/lib/invoice-files"
import { normalizeLabels } from "@/lib/tasks"
import {
  createCompanyAccountSchema,
  createCompanyExpenseSchema,
  createCompanyLoanSchema,
  createCompanyMovementSchema,
  assignmentFields,
  collaboratorFields,
  normalizeCollaboratorFee,
  normalizePriceChanges,
  normalizeMonthDays,
  normalizeSolutionDomain,
  normalizeSolutionGraph,
  normalizeSolutionSections,
  normalizeSolutionStack,
  solutionFields,
} from "@/types/schemas"

import type { FilesAdapter } from "./types"
import type {
  Assignment,
  Collaborator,
  CreateAssignmentInput,
  CreateCollaboratorInput,
  UpdateAssignmentInput,
  UpdateCollaboratorInput,
  CapacityDoc,
  Allocation,
  Client,
  CreateAllocationInput,
  CreateClientInput,
  CreateEngagementInput,
  CreateOpportunityInput,
  Engagement,
  Opportunity,
  OpportunityStage,
  UpdateAllocationInput,
  UpdateClientInput,
  UpdateEngagementInput,
  UpdateOpportunityInput,
  Task,
  Invoice,
  InvoiceFile,
  CreateInvoiceInput,
  UpdateInvoiceInput,
  CompanyDeadline,
  CreateCompanyDeadlineInput,
  CompanyAccount,
  UpdateCompanyAccountInput,
  CompanyMovement,
  RentPart,
  CreateCompanyMovementInput,
  UpdateCompanyMovementInput,
  CompanyExpense,
  CreateCompanyExpenseInput,
  UpdateCompanyExpenseInput,
  CompanyLoan,
  CreateCompanyLoanInput,
  UpdateCompanyLoanInput,
  UpdateCompanyDeadlineInput,
  CreateTaskInput,
  UpdateTaskInput,
  Timecard,
  SetTimecardInput,
  Meeting,
  MeetingHealth,
  CreateMeetingInput,
  UpdateMeetingInput,
  Solution,
  SolutionStatus,
  CreateSolutionInput,
  UpdateSolutionInput,
} from "@/types"

// ─── Helpers ────────────────────────────────────────────────────────────────

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  if (val && typeof (val as { toDate?: () => Date }).toDate === "function") {
    return (val as { toDate: () => Date }).toDate()
  }
  return new Date(val as string)
}

function userCol(userId: string, name: string) {
  return getAdminFirestore().collection(`users/${userId}/${name}`)
}

function userDoc(userId: string, name: string, id: string) {
  return getAdminFirestore().doc(`users/${userId}/${name}/${id}`)
}

const now = () => FieldValue.serverTimestamp()

function withId(snap: { id: string; data(): DocumentData | undefined }): DocumentData & { id: string } {
  return { id: snap.id, ...(snap.data() ?? {}) }
}


// ─── API keys (users/{uid}/api_keys + top-level api_keys_index) ─────────────
// The server is the only writer (#342): the visible doc and the index row go in
// one batch, the index id is the key hash, and a key is valid only while both exist.

export async function createApiKey(userId: string): Promise<{ key: string; id: string }> {
  const key = `ak_${crypto.randomUUID().replace(/-/g, "")}`
  const keyHash = createHash("sha256").update(key).digest("hex")
  const db = getAdminFirestore()
  const ref = userCol(userId, "api_keys").doc()
  const batch = db.batch()
  batch.create(ref, { userId, keyHash, prefix: key.slice(0, 7) + "...", createdAt: now() })
  batch.create(db.collection("api_keys_index").doc(keyHash), {
    userId,
    keyHash,
    apiKeyDocId: ref.id,
    createdAt: now(),
  })
  await batch.commit()
  return { key, id: ref.id }
}

/**
 * Removes the visible doc and its index rows atomically; another user's key id
 * is a no-op. Keys made before #342 have a random-id index row, so match by
 * userId + keyHash as well as by doc id.
 */
export async function deleteApiKey(userId: string, keyId: string): Promise<void> {
  const db = getAdminFirestore()
  const ref = userCol(userId, "api_keys").doc(keyId)
  const snap = await ref.get()
  if (!snap.exists) return
  const keyHash = snap.data()?.keyHash as string
  const legacy = await db.collection("api_keys_index").where("keyHash", "==", keyHash).get()
  const batch = db.batch()
  batch.delete(ref)
  batch.delete(db.collection("api_keys_index").doc(keyHash))
  for (const d of legacy.docs) if (d.data().userId === userId) batch.delete(d.ref)
  await batch.commit()
}

export async function validateApiKey(keyHash: string): Promise<string | null> {
  const db = getAdminFirestore()
  const index = db.collection("api_keys_index")
  let idx = (await index.doc(keyHash).get()).data()
  // Keys made before #342 were indexed under a random id: fall back to a lookup by hash.
  if (!idx) idx = (await index.where("keyHash", "==", keyHash).limit(1).get()).docs[0]?.data()
  if (!idx?.userId || !idx.apiKeyDocId) return null
  const visible = await userCol(idx.userId as string, "api_keys").doc(idx.apiKeyDocId as string).get()
  return visible.data()?.keyHash === keyHash ? (idx.userId as string) : null
}

// ─── CRM: clients / opportunities / engagements / allocations ───────────────
// Adapter-shaped (DatabaseAdapter-compatible) plus optional query filters so
// MCP tools never scan whole collections. All reads are targeted queries; the
// one composite index (allocations engagementId+yearMonth) lives in
// firestore.indexes.json.

function mapClient(data: DocumentData): Client {
  return {
    id: data.id as string,
    userId: data.userId as string,
    name: data.name as string,
    vatNumber: (data.vatNumber as string | null) ?? null,
    email: (data.email as string | null) ?? null,
    contactName: (data.contactName as string | null) ?? null,
    contactPhone: (data.contactPhone as string | null) ?? null,
    notes: (data.notes as string | null) ?? null,
    isActive: (data.isActive as boolean) ?? true,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

function mapOpportunity(data: DocumentData): Opportunity {
  return {
    id: data.id as string,
    userId: data.userId as string,
    clientId: data.clientId as string,
    title: data.title as string,
    stage: data.stage as OpportunityStage,
    probability: data.probability as number,
    dailyRate: data.dailyRate as number,
    estimatedDaysPerMonth: data.estimatedDaysPerMonth as number,
    unit: data.unit as Opportunity["unit"],
    estimatedDurationMonths: data.estimatedDurationMonths as number,
    expectedStartMonth: (data.expectedStartMonth as string | null) ?? null,
    vatApplicable: (data.vatApplicable as boolean) ?? true,
    nextActionDate: data.nextActionDate ? toDate(data.nextActionDate) : null,
    nextActionNote: (data.nextActionNote as string | null) ?? null,
    notes: (data.notes as string | null) ?? null,
    lostReason: (data.lostReason as string | null) ?? null,
    closedAt: data.closedAt ? toDate(data.closedAt) : null,
    engagementId: (data.engagementId as string | null) ?? null,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

function mapEngagement(data: DocumentData): Engagement {
  return {
    id: data.id as string,
    userId: data.userId as string,
    clientId: data.clientId as string,
    name: (data.name as string | null) ?? null,
    opportunityId: (data.opportunityId as string | null) ?? null,
    dailyRate: data.dailyRate as number,
    unit: data.unit as Engagement["unit"],
    vatApplicable: (data.vatApplicable as boolean) ?? true,
    contractedDays: (data.contractedDays as number | null) ?? null,
    defaultDaysPerMonth: data.defaultDaysPerMonth as number,
    startMonth: (data.startMonth as string | null) ?? null,
    endMonth: (data.endMonth as string | null) ?? null,
    endDate: (data.endDate as string | null) ?? null,
    isActive: (data.isActive as boolean) ?? true,
    notes: (data.notes as string | null) ?? null,
    amendments: normalizeAmendments(data.amendments),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

function mapAllocation(data: DocumentData): Allocation {
  return {
    id: data.id as string,
    userId: data.userId as string,
    engagementId: data.engagementId as string,
    yearMonth: data.yearMonth as string,
    days: data.days as number,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

export async function getClients(
  userId: string,
  filter?: { activeOnly?: boolean },
): Promise<Client[]> {
  const col = userCol(userId, "clients")
  const snap = filter?.activeOnly ? await col.where("isActive", "==", true).get() : await col.get()
  return snap.docs.map((d) => mapClient(withId(d))).sort((a, b) => a.name.localeCompare(b.name))
}

export async function createClient(userId: string, input: CreateClientInput): Promise<Client> {
  const ref = await userCol(userId, "clients").add({
    userId,
    name: input.name,
    vatNumber: input.vatNumber ?? null,
    email: input.email ?? null,
    contactName: input.contactName ?? null,
    contactPhone: input.contactPhone ?? null,
    notes: input.notes ?? null,
    isActive: true,
    createdAt: now(),
    updatedAt: now(),
  })
  return mapClient(withId(await ref.get()))
}

export async function updateClient(
  userId: string,
  id: string,
  input: UpdateClientInput,
): Promise<Client> {
  const ref = userDoc(userId, "clients", id)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`Client ${id} not found`)
  const updates: Record<string, unknown> = { updatedAt: now() }
  if (input.name !== undefined) updates.name = input.name
  if (input.vatNumber !== undefined) updates.vatNumber = input.vatNumber
  if (input.email !== undefined) updates.email = input.email
  if (input.contactName !== undefined) updates.contactName = input.contactName
  if (input.contactPhone !== undefined) updates.contactPhone = input.contactPhone
  if (input.notes !== undefined) updates.notes = input.notes
  if (input.isActive !== undefined) updates.isActive = input.isActive
  await ref.update(updates)
  return mapClient(withId(await ref.get()))
}

export async function getOpportunities(
  userId: string,
  filter?: { openOnly?: boolean },
): Promise<Opportunity[]> {
  const col = userCol(userId, "opportunities")
  const snap = filter?.openOnly
    ? await col.where("stage", "in", ["lead", "proposal", "negotiation"]).get()
    : await col.get()
  return snap.docs.map((d) => mapOpportunity(withId(d)))
}

export async function createOpportunity(
  userId: string,
  input: CreateOpportunityInput,
): Promise<Opportunity> {
  const ref = await userCol(userId, "opportunities").add({
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
    nextActionDate: input.nextActionDate ? Timestamp.fromDate(input.nextActionDate) : null,
    nextActionNote: input.nextActionNote ?? null,
    notes: input.notes ?? null,
    lostReason: null,
    closedAt: null,
    engagementId: null,
    createdAt: now(),
    updatedAt: now(),
  })
  return mapOpportunity(withId(await ref.get()))
}

export async function updateOpportunity(
  userId: string,
  id: string,
  input: UpdateOpportunityInput,
): Promise<Opportunity> {
  const ref = userDoc(userId, "opportunities", id)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`Opportunity ${id} not found`)
  const updates: Record<string, unknown> = { updatedAt: now() }
  if (input.clientId !== undefined) updates.clientId = input.clientId
  if (input.title !== undefined) updates.title = input.title
  if (input.stage !== undefined) updates.stage = input.stage
  if (input.probability !== undefined) updates.probability = input.probability
  if (input.dailyRate !== undefined) updates.dailyRate = input.dailyRate
  if (input.unit !== undefined) updates.unit = input.unit
  if (input.estimatedDaysPerMonth !== undefined) updates.estimatedDaysPerMonth = input.estimatedDaysPerMonth
  if (input.estimatedDurationMonths !== undefined) updates.estimatedDurationMonths = input.estimatedDurationMonths
  if (input.expectedStartMonth !== undefined) updates.expectedStartMonth = input.expectedStartMonth
  if (input.vatApplicable !== undefined) updates.vatApplicable = input.vatApplicable
  if (input.nextActionDate !== undefined)
    updates.nextActionDate = input.nextActionDate ? Timestamp.fromDate(input.nextActionDate) : null
  if (input.nextActionNote !== undefined) updates.nextActionNote = input.nextActionNote
  if (input.notes !== undefined) updates.notes = input.notes
  if (input.lostReason !== undefined) updates.lostReason = input.lostReason
  if (input.closedAt !== undefined)
    updates.closedAt = input.closedAt ? Timestamp.fromDate(input.closedAt) : null
  if (input.engagementId !== undefined) updates.engagementId = input.engagementId
  await ref.update(updates)
  return mapOpportunity(withId(await ref.get()))
}

export async function getEngagements(
  userId: string,
  filter?: { activeOnly?: boolean },
): Promise<Engagement[]> {
  const col = userCol(userId, "engagements")
  const snap = filter?.activeOnly ? await col.where("isActive", "==", true).get() : await col.get()
  return snap.docs.map((d) => mapEngagement(withId(d)))
}

export async function createEngagement(
  userId: string,
  input: CreateEngagementInput,
): Promise<Engagement> {
  const ref = await userCol(userId, "engagements").add({
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
    createdAt: now(),
    updatedAt: now(),
  })
  return mapEngagement(withId(await ref.get()))
}

export async function updateEngagement(
  userId: string,
  id: string,
  input: UpdateEngagementInput,
): Promise<Engagement> {
  const ref = userDoc(userId, "engagements", id)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`Engagement ${id} not found`)
  const updates: Record<string, unknown> = { updatedAt: now() }
  // ponytail: unlike firebase.ts, a clientId change does not carry the contract's
  // tasks along — no server caller moves a contract to another client. Mirror
  // firebase.ts updateEngagement if one ever does.
  if (input.clientId !== undefined) updates.clientId = input.clientId
  if (input.name !== undefined) updates.name = input.name
  if (input.dailyRate !== undefined) updates.dailyRate = input.dailyRate
  if (input.unit !== undefined) updates.unit = input.unit
  if (input.vatApplicable !== undefined) updates.vatApplicable = input.vatApplicable
  if (input.contractedDays !== undefined) updates.contractedDays = input.contractedDays
  if (input.defaultDaysPerMonth !== undefined) updates.defaultDaysPerMonth = input.defaultDaysPerMonth
  if (input.startMonth !== undefined) updates.startMonth = input.startMonth
  if (input.endMonth !== undefined) updates.endMonth = input.endMonth
  if (input.endDate !== undefined) updates.endDate = input.endDate
  if (input.isActive !== undefined) updates.isActive = input.isActive
  if (input.notes !== undefined) updates.notes = input.notes
  // ponytail: whole-list last write wins, as in firebase.ts.
  if (input.amendments !== undefined) updates.amendments = input.amendments
  await ref.update(updates)
  return mapEngagement(withId(await ref.get()))
}

function mapTask(d: DocumentData & { id: string }): Task {
  return {
    id: d.id,
    userId: d.userId as string,
    // Absent on documents written before #164: read through taskClientId.
    clientId: (d.clientId as string | undefined) ?? null,
    engagementId: (d.engagementId as string | null | undefined) ?? null,
    title: d.title as string,
    dueDate: d.dueDate != null ? toDate(d.dueDate) : null,
    notes: (d.notes as string | null) ?? null,
    isDone: Boolean(d.isDone),
    startedAt: d.startedAt != null ? toDate(d.startedAt) : null,
    labels: Array.isArray(d.labels) ? (d.labels as string[]) : [],
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

export async function getTasks(userId: string): Promise<Task[]> {
  const snap = await userCol(userId, "tasks").get()
  return snap.docs.map((d) => mapTask(withId(d)))
}

/** The invoice file pointer as stored; absent (documents from before files) reads as null. */
function mapFile(f: unknown): InvoiceFile | null {
  if (f == null) return null
  const d = f as DocumentData
  return { path: d.path as string, name: d.name as string, kind: d.kind as InvoiceFile["kind"], size: Number(d.size), uploadedAt: toDate(d.uploadedAt) }
}

/**
 * After a cost or an invoice is deleted: its object goes too, so Storage keeps no file nothing names.
 * The Admin SDK skips storage.rules, so only the user's own folder is touched, whatever a record names.
 * A failure leaves one unreferenced object, never a rejected delete of a record that is already gone.
 */
async function removeObjectOf(userId: string, file: unknown): Promise<void> {
  const f = mapFile(file)
  if (!f) return
  if (!f.path.startsWith(`users/${userId}/company-files/`)) {
    console.error(`Not deleting ${f.path}: outside the company-files folder of ${userId}`)
    return
  }
  try {
    await getAdminBucket()?.file(f.path).delete({ ignoreNotFound: true })
  } catch (err) {
    console.error(`Could not delete ${f.path}; it stays unreferenced`, err)
  }
}

/** An object this slice may touch: one flat file of a user's company-files folder, named as it names its own. */
const COMPANY_FILE_PATH = /^users\/[^/]+\/company-files\/[\w-]+(\.xml\.p7m|\.xml|\.pdf)$/

function companyFileBucket(path: string) {
  if (path.includes("..") || !COMPANY_FILE_PATH.test(path)) throw new Error("Not a company file path")
  const bucket = getAdminBucket()
  if (!bucket) throw new Error("File storage is not configured on this deployment")
  return bucket
}

/**
 * The invoice files over Admin Storage, for the MCP. The Admin SDK skips storage.rules, so this makes
 * the rules' checks itself: the kind, the 10 MB and the name length (checkInvoiceFile), the content type
 * from the kind rather than from the caller, and a path that cannot leave the caller's company-files folder.
 */
export function createFirebaseFiles(): FilesAdapter {
  return {
    async upload(userId, file, name) {
      if (!userId || userId.includes("/") || userId.includes("..")) throw new Error("Invalid user")
      const check = checkInvoiceFile({ name, size: file.size })
      if (!check.ok) throw new Error(check.reason)
      const path = `users/${userId}/company-files/${getAdminFirestore().collection("_").doc().id}${INVOICE_FILE_EXTENSION[check.kind]}`
      await companyFileBucket(path).file(path).save(Buffer.from(await file.arrayBuffer()), { contentType: INVOICE_FILE_CONTENT_TYPE[check.kind] })
      return { path, name, kind: check.kind, size: file.size, uploadedAt: new Date() }
    },
    async download(file) {
      return new Blob([new Uint8Array((await companyFileBucket(file.path).file(file.path).download())[0])])
    },
    async remove(path) {
      await companyFileBucket(path).file(path).delete({ ignoreNotFound: true })
    },
  }
}

function mapInvoice(d: DocumentData & { id: string }): Invoice {
  return {
    id: d.id,
    userId: d.userId as string,
    clientId: (d.clientId as string | undefined) ?? null,
    engagementId: (d.engagementId as string | null | undefined) ?? null,
    number: d.number as string,
    fromMonth: (d.fromMonth as string | null | undefined) ?? null,
    yearMonth: d.yearMonth as string,
    amount: Number(d.amount),
    vat: Number(d.vat),
    dueDate: d.dueDate != null ? toDate(d.dueDate) : null,
    paidDate: d.paidDate != null ? toDate(d.paidDate) : null,
    // Absent on documents written before the cash book.
    paidAccountId: (d.paidAccountId as string | null | undefined) ?? null,
    file: mapFile(d.file),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

export async function getInvoices(userId: string): Promise<Invoice[]> {
  const snap = await userCol(userId, "invoices").get()
  return snap.docs.map((d) => mapInvoice(withId(d)))
}

export async function createInvoice(userId: string, input: CreateInvoiceInput): Promise<Invoice> {
  const ref = await userCol(userId, "invoices").add({
    userId,
    clientId: input.clientId,
    number: input.number,
    fromMonth: input.fromMonth ?? null,
    yearMonth: input.yearMonth,
    amount: input.amount,
    vat: input.vat,
    dueDate: input.dueDate ? Timestamp.fromDate(input.dueDate) : null,
    paidDate: input.paidDate ? Timestamp.fromDate(input.paidDate) : null,
    paidAccountId: input.paidAccountId ?? null,
    file: null,
    createdAt: now(),
    updatedAt: now(),
  })
  return mapInvoice(withId(await ref.get()))
}

export async function updateInvoice(
  userId: string,
  id: string,
  input: UpdateInvoiceInput,
): Promise<Invoice> {
  const ref = userDoc(userId, "invoices", id)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`Invoice ${id} not found`)
  const updates: Record<string, unknown> = { updatedAt: now() }
  if (input.number !== undefined) updates.number = input.number
  if (input.fromMonth !== undefined) updates.fromMonth = input.fromMonth
  if (input.yearMonth !== undefined) updates.yearMonth = input.yearMonth
  if (input.amount !== undefined) updates.amount = input.amount
  if (input.vat !== undefined) updates.vat = input.vat
  if (input.dueDate !== undefined)
    updates.dueDate = input.dueDate ? Timestamp.fromDate(input.dueDate) : null
  if (input.paidDate !== undefined)
    updates.paidDate = input.paidDate ? Timestamp.fromDate(input.paidDate) : null
  if (input.paidAccountId !== undefined) updates.paidAccountId = input.paidAccountId
  if (input.file !== undefined) updates.file = input.file
  await ref.update(updates)
  return mapInvoice(withId(await ref.get()))
}

/** The document alone, as the web's Delete: a bank fee booked with its payment stays on Costs. */
export async function deleteInvoice(userId: string, id: string): Promise<void> {
  const ref = userDoc(userId, "invoices", id)
  const file = (await ref.get()).data()?.file
  await ref.delete()
  await removeObjectOf(userId, file)
}

// ─── Cash book: company accounts, movements, costs and loans ─────────────────
// The Admin SDK skips firestore.rules, so every write here is parsed with the
// shared zod schemas first: the checks the rules make on the web's writes, and
// the mock's. An update parses the merged document, as the rules read incoming().
// Mappers mirror firebase.ts: a field absent on an older document reads as null.

const optional = <T>(v: unknown) => (v as T | null | undefined) ?? null

function mapCompanyAccount(d: DocumentData & { id: string }): CompanyAccount {
  return {
    id: d.id,
    userId: d.userId as string,
    name: d.name as string,
    openingBalance: Number(d.openingBalance),
    openingDate: toDate(d.openingDate),
    statementBalance: d.statementBalance != null ? Number(d.statementBalance) : null,
    statementDate: d.statementDate != null ? toDate(d.statementDate) : null,
    importRef: optional<string>(d.importRef),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapCompanyMovement(d: DocumentData & { id: string }): CompanyMovement {
  return {
    id: d.id,
    userId: d.userId as string,
    kind: d.kind as CompanyMovement["kind"],
    direction: d.direction as CompanyMovement["direction"],
    amount: Number(d.amount),
    date: toDate(d.date),
    accountId: d.accountId as string,
    toAccountId: optional<string>(d.toAccountId),
    expenseId: optional<string>(d.expenseId),
    description: d.description as string,
    documentRef: optional<string>(d.documentRef),
    project: optional<string>(d.project),
    counterparty: optional<string>(d.counterparty),
    notes: optional<string>(d.notes),
    dateEstimated: Boolean(d.dateEstimated),
    importRef: optional<string>(d.importRef),
    leaseId: optional<string>(d.leaseId),
    rentMonth: optional<string>(d.rentMonth),
    rentPart: optional<RentPart>(d.rentPart),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapCompanyExpense(d: DocumentData & { id: string }): CompanyExpense {
  return {
    id: d.id,
    userId: d.userId as string,
    description: d.description as string,
    category: d.category as CompanyExpense["category"],
    amount: Number(d.amount),
    date: toDate(d.date),
    isRecurring: Boolean(d.isRecurring),
    recurrenceMonths: d.recurrenceMonths != null ? Number(d.recurrenceMonths) : null,
    notes: optional<string>(d.notes),
    accountId: optional<string>(d.accountId),
    paidByOwner: Boolean(d.paidByOwner),
    vat: d.vat != null ? Number(d.vat) : null,
    documentRef: optional<string>(d.documentRef),
    project: optional<string>(d.project),
    recurringExpenseId: optional<string>(d.recurringExpenseId),
    dateEstimated: Boolean(d.dateEstimated),
    importRef: optional<string>(d.importRef),
    collaboratorId: optional<string>(d.collaboratorId),
    engagementId: optional<string>(d.engagementId),
    forMonth: optional<string>(d.forMonth),
    leaseId: optional<string>(d.leaseId),
    endMonth: optional<string>(d.endMonth),
    priceChanges: normalizePriceChanges(d.priceChanges),
    countedWhenPaid: d.countedWhenPaid === true,
    file: mapFile(d.file),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapCompanyLoan(d: DocumentData & { id: string }): CompanyLoan {
  return {
    id: d.id,
    userId: d.userId as string,
    description: d.description as string,
    direction: d.direction as CompanyLoan["direction"],
    amount: Number(d.amount),
    date: toDate(d.date),
    notes: optional<string>(d.notes),
    accountId: optional<string>(d.accountId),
    dateEstimated: Boolean(d.dateEstimated),
    importRef: optional<string>(d.importRef),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

export async function getCompanyAccounts(userId: string): Promise<CompanyAccount[]> {
  const snap = await userCol(userId, "company_accounts").get()
  return snap.docs.map((d) => mapCompanyAccount(withId(d))).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * An update as the rules read one: the merged document parsed with the create
 * schema (incoming()), then only the given fields written. One transaction with
 * `guard`'s reads, so a payment recorded meanwhile cannot slip past it.
 */
async function updateMerged<T>(
  ref: FirebaseFirestore.DocumentReference,
  map: (d: DocumentData & { id: string }) => T,
  schema: { parse(value: unknown): unknown },
  input: object,
  notFound: string,
  guard?: (t: FirebaseFirestore.Transaction) => Promise<void>,
): Promise<T> {
  await getAdminFirestore().runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists) throw new Error(notFound)
    await guard?.(t)
    const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
    schema.parse({ ...map(withId(snap)), ...set })
    const stamp = (v: unknown) => (v instanceof Date ? Timestamp.fromDate(v) : v)
    t.update(ref, { ...Object.fromEntries(Object.entries(set).map(([k, v]) => [k, stamp(v)])), updatedAt: now() })
  })
  return map(withId(await ref.get()))
}

export async function updateCompanyAccount(
  userId: string,
  id: string,
  input: UpdateCompanyAccountInput,
): Promise<CompanyAccount> {
  return updateMerged(userDoc(userId, "company_accounts", id), mapCompanyAccount, createCompanyAccountSchema, input, "Company account not found")
}

export async function getCompanyMovements(userId: string): Promise<CompanyMovement[]> {
  const snap = await userCol(userId, "company_movements").orderBy("date", "desc").get()
  return snap.docs.map((d) => mapCompanyMovement(withId(d)))
}

export async function createCompanyMovement(userId: string, input: CreateCompanyMovementInput): Promise<CompanyMovement> {
  const v = createCompanyMovementSchema.parse(input)
  const ref = await userCol(userId, "company_movements").add({
    userId,
    kind: v.kind,
    direction: v.direction,
    amount: v.amount,
    date: Timestamp.fromDate(v.date),
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
    createdAt: now(),
    updatedAt: now(),
  })
  return mapCompanyMovement(withId(await ref.get()))
}

export async function updateCompanyMovement(
  userId: string,
  id: string,
  input: UpdateCompanyMovementInput,
): Promise<CompanyMovement> {
  return updateMerged(userDoc(userId, "company_movements", id), mapCompanyMovement, createCompanyMovementSchema, input, "Company movement not found")
}

export async function deleteCompanyMovement(userId: string, id: string): Promise<void> {
  await userDoc(userId, "company_movements", id).delete()
}

export async function getCompanyExpenses(userId: string): Promise<CompanyExpense[]> {
  const snap = await userCol(userId, "company_expenses").orderBy("date", "desc").get()
  return snap.docs.map((d) => mapCompanyExpense(withId(d)))
}

/** A cost as stored, from a parsed input. */
function expenseDoc(userId: string, input: CreateCompanyExpenseInput) {
  const v = createCompanyExpenseSchema.parse(input)
  return {
    userId,
    description: v.description,
    category: v.category,
    amount: v.amount,
    date: Timestamp.fromDate(v.date),
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
    createdAt: now(),
    updatedAt: now(),
  }
}

export async function createCompanyExpense(userId: string, input: CreateCompanyExpenseInput): Promise<CompanyExpense> {
  const ref = await userCol(userId, "company_expenses").add(expenseDoc(userId, input))
  return mapCompanyExpense(withId(await ref.get()))
}

/** Read in the write's transaction: a supplier invoice with a payment pointing at it stays one (BILL_HAS_PAYMENTS). */
async function refusePaidBill(t: FirebaseFirestore.Transaction, userId: string, expenseId: string): Promise<void> {
  const payments = await t.get(userCol(userId, "company_movements").where("expenseId", "==", expenseId).limit(1))
  if (!payments.empty) throw new Error(BILL_HAS_PAYMENTS)
}

export async function updateCompanyExpense(
  userId: string,
  id: string,
  input: UpdateCompanyExpenseInput,
): Promise<CompanyExpense> {
  return updateMerged(
    userDoc(userId, "company_expenses", id),
    mapCompanyExpense,
    createCompanyExpenseSchema,
    input,
    "Company expense not found",
    leavesSupplierDocument(input) ? (t) => refusePaidBill(t, userId, id) : undefined,
  )
}

export async function deleteCompanyExpense(userId: string, id: string): Promise<void> {
  let file: unknown
  await getAdminFirestore().runTransaction(async (t) => {
    await refusePaidBill(t, userId, id)
    const ref = userDoc(userId, "company_expenses", id)
    file = (await t.get(ref)).data()?.file
    t.delete(ref)
  })
  await removeObjectOf(userId, file)
}

export async function getCompanyLoans(userId: string): Promise<CompanyLoan[]> {
  const snap = await userCol(userId, "company_loans").orderBy("date", "desc").get()
  return snap.docs.map((d) => mapCompanyLoan(withId(d)))
}

export async function createCompanyLoan(userId: string, input: CreateCompanyLoanInput): Promise<CompanyLoan> {
  const v = createCompanyLoanSchema.parse(input)
  const ref = await userCol(userId, "company_loans").add({
    userId,
    description: v.description,
    direction: v.direction,
    amount: v.amount,
    date: Timestamp.fromDate(v.date),
    notes: v.notes ?? null,
    accountId: v.accountId ?? null,
    dateEstimated: v.dateEstimated ?? false,
    importRef: v.importRef ?? null,
    createdAt: now(),
    updatedAt: now(),
  })
  return mapCompanyLoan(withId(await ref.get()))
}

export async function updateCompanyLoan(userId: string, id: string, input: UpdateCompanyLoanInput): Promise<CompanyLoan> {
  return updateMerged(userDoc(userId, "company_loans", id), mapCompanyLoan, createCompanyLoanSchema, input, "Company loan not found")
}

export async function deleteCompanyLoan(userId: string, id: string): Promise<void> {
  await userDoc(userId, "company_loans", id).delete()
}

/**
 * The invoice paid into an account and its bank fee, in one WriteBatch. The
 * fee's id is the invoice's, so a fee already booked for it (a payment marked
 * unpaid and paid again) fails the commit, and the invoice stays as it was.
 */
export async function settleInvoicePayment(
  userId: string,
  input: { invoiceId: string; paidDate: Date; paidAccountId: string; fee?: number },
): Promise<{ invoice: Invoice; fee: CompanyExpense | null }> {
  const ref = userDoc(userId, "invoices", input.invoiceId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error("Invoice not found")
  const feeRef = userDoc(userId, "company_expenses", `bank-fee-${input.invoiceId}`)
  const fee = input.fee
    ? expenseDoc(userId, {
        description: `Bank fee on invoice ${snap.get("number") as string}`,
        category: "bank_fees",
        amount: input.fee,
        date: input.paidDate,
        accountId: input.paidAccountId,
      })
    : null
  const batch = getAdminFirestore().batch()
  batch.update(ref, { paidDate: Timestamp.fromDate(input.paidDate), paidAccountId: input.paidAccountId, updatedAt: now() })
  if (fee) batch.create(feeRef, fee)
  await batch.commit()
  return {
    invoice: mapInvoice(withId(await ref.get())),
    fee: fee ? mapCompanyExpense(withId(await feeRef.get())) : null,
  }
}

function mapCompanyDeadline(d: DocumentData & { id: string }): CompanyDeadline {
  return {
    id: d.id,
    userId: d.userId as string,
    title: d.title as string,
    date: toDate(d.date),
    kind: d.kind as CompanyDeadline["kind"],
    amount: d.amount != null ? Number(d.amount) : null,
    notes: (d.notes as string | null) ?? null,
    isDone: Boolean(d.isDone),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

export async function getCompanyDeadlines(userId: string): Promise<CompanyDeadline[]> {
  const snap = await userCol(userId, "company_deadlines").orderBy("date", "asc").get()
  return snap.docs.map((d) => mapCompanyDeadline(withId(d)))
}

export async function createCompanyDeadline(
  userId: string,
  input: CreateCompanyDeadlineInput,
): Promise<CompanyDeadline> {
  const ref = await userCol(userId, "company_deadlines").add({
    userId,
    title: input.title,
    date: Timestamp.fromDate(input.date),
    kind: input.kind,
    amount: input.amount ?? null,
    notes: input.notes ?? null,
    isDone: false,
    createdAt: now(),
    updatedAt: now(),
  })
  return mapCompanyDeadline(withId(await ref.get()))
}

export async function updateCompanyDeadline(
  userId: string,
  id: string,
  input: UpdateCompanyDeadlineInput,
): Promise<CompanyDeadline> {
  const ref = userDoc(userId, "company_deadlines", id)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`Company deadline ${id} not found`)
  const updates: Record<string, unknown> = { updatedAt: now() }
  if (input.title !== undefined) updates.title = input.title
  if (input.date !== undefined) updates.date = Timestamp.fromDate(input.date)
  if (input.kind !== undefined) updates.kind = input.kind
  if (input.amount !== undefined) updates.amount = input.amount
  if (input.notes !== undefined) updates.notes = input.notes
  if (input.isDone !== undefined) updates.isDone = input.isDone
  await ref.update(updates)
  return mapCompanyDeadline(withId(await ref.get()))
}

export async function createTask(userId: string, input: CreateTaskInput): Promise<Task> {
  const ref = await userCol(userId, "tasks").add({
    userId,
    clientId: input.clientId,
    engagementId: input.engagementId ?? null,
    title: input.title,
    dueDate: input.dueDate ? Timestamp.fromDate(input.dueDate) : null,
    notes: input.notes ?? null,
    isDone: false,
    startedAt: null,
    labels: normalizeLabels(input.labels ?? []),
    createdAt: now(),
    updatedAt: now(),
  })
  return mapTask(withId(await ref.get()))
}

export async function updateTask(userId: string, id: string, input: UpdateTaskInput): Promise<Task> {
  const ref = userDoc(userId, "tasks", id)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`Task ${id} not found`)
  const updates: Record<string, unknown> = { updatedAt: now() }
  if (input.clientId !== undefined) updates.clientId = input.clientId
  if (input.engagementId !== undefined) updates.engagementId = input.engagementId
  if (input.title !== undefined) updates.title = input.title
  if (input.dueDate !== undefined)
    updates.dueDate = input.dueDate ? Timestamp.fromDate(input.dueDate) : null
  if (input.notes !== undefined) updates.notes = input.notes
  if (input.isDone !== undefined) updates.isDone = input.isDone
  if (input.startedAt !== undefined)
    updates.startedAt = input.startedAt ? Timestamp.fromDate(input.startedAt) : null
  if (input.labels !== undefined) updates.labels = normalizeLabels(input.labels)
  await ref.update(updates)
  return mapTask(withId(await ref.get()))
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  await userDoc(userId, "tasks", id).delete()
}

function mapTimecard(d: DocumentData & { id: string }): Timecard {
  return {
    id: d.id,
    userId: d.userId as string,
    engagementId: d.engagementId as string,
    // Documents written before collaborators have no field: the owner's.
    collaboratorId: (d.collaboratorId as string | null | undefined) ?? null,
    date: d.date as string,
    hours: Number(d.hours),
    notes: (d.notes as string | null) ?? null,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapCollaborator(x: DocumentData & { id: string }): Collaborator {
  return {
    id: x.id,
    userId: x.userId as string,
    name: x.name as string,
    type: x.type as Collaborator["type"],
    notes: (x.notes as string | null) ?? null,
    isActive: x.isActive as boolean,
    fee: normalizeCollaboratorFee(x.fee),
    createdAt: toDate(x.createdAt),
    updatedAt: toDate(x.updatedAt),
  }
}

function mapAssignment(x: DocumentData & { id: string }): Assignment {
  return {
    id: x.id,
    userId: x.userId as string,
    collaboratorId: x.collaboratorId as string,
    engagementId: x.engagementId as string,
    dailyRate: Number(x.dailyRate),
    from: x.from as string,
    until: (x.until as string | null) ?? null,
    defaultDays: Number(x.defaultDays),
    monthDays: normalizeMonthDays(x.monthDays),
    createdAt: toDate(x.createdAt),
    updatedAt: toDate(x.updatedAt),
  }
}

export async function getCollaborators(userId: string): Promise<Collaborator[]> {
  const snap = await userCol(userId, "collaborators").get()
  return snap.docs.map((d) => mapCollaborator(withId(d))).sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name))
}

/** Parsed whole, as the app's form and the mock do: the Admin SDK skips the rules, so the schema is the check. */
export async function createCollaborator(userId: string, input: CreateCollaboratorInput): Promise<Collaborator> {
  const ref = await userCol(userId, "collaborators").add({ userId, ...collaboratorFields(input), createdAt: now(), updatedAt: now() })
  return mapCollaborator(withId(await ref.get()))
}

/** The stored collaborator with the update on top, parsed whole; fee: null clears the fee. */
export async function updateCollaborator(userId: string, collaboratorId: string, input: UpdateCollaboratorInput): Promise<Collaborator> {
  const ref = userDoc(userId, "collaborators", collaboratorId)
  await getAdminFirestore().runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists) throw new Error("Collaborator not found")
    t.update(ref, { ...collaboratorFields(mapCollaborator(withId(snap)), input), updatedAt: now() })
  })
  return mapCollaborator(withId(await ref.get()))
}

export async function getAssignments(userId: string): Promise<Assignment[]> {
  const snap = await userCol(userId, "collaborator_assignments").get()
  return snap.docs.map((d) => mapAssignment(withId(d)))
}

/** One per collaborator and contract: the id is the pair, so a second create is refused, not overwritten. */
export async function createAssignment(userId: string, input: CreateAssignmentInput): Promise<Assignment> {
  const ref = userDoc(userId, "collaborator_assignments", assignmentId(input.collaboratorId, input.engagementId))
  await getAdminFirestore().runTransaction(async (t) => {
    if ((await t.get(ref)).exists) throw new Error(ASSIGNMENT_EXISTS)
    t.set(ref, { userId, ...assignmentFields(input), createdAt: now(), updatedAt: now() })
  })
  return mapAssignment(withId(await ref.get()))
}

export async function updateAssignment(userId: string, id: string, input: UpdateAssignmentInput): Promise<Assignment> {
  const ref = userDoc(userId, "collaborator_assignments", id)
  await getAdminFirestore().runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists) throw new Error("Assignment not found")
    const { dailyRate, from, until, defaultDays, monthDays } = assignmentFields(mapAssignment(withId(snap)), input)
    t.update(ref, { dailyRate, from, until, defaultDays, monthDays, updatedAt: now() })
  })
  return mapAssignment(withId(await ref.get()))
}

/** Refused while their days are logged on the contract (ASSIGNMENT_HAS_DAYS), as the app's. */
export async function deleteAssignment(userId: string, id: string): Promise<void> {
  const ref = userDoc(userId, "collaborator_assignments", id)
  const snap = await ref.get()
  if (!snap.exists) return
  const { collaboratorId, engagementId } = snap.data()!
  const logged = await userCol(userId, "timecards").where("collaboratorId", "==", collaboratorId).where("engagementId", "==", engagementId).limit(1).get()
  if (!logged.empty) throw new Error(ASSIGNMENT_HAS_DAYS)
  await ref.delete()
}

export async function getTimecards(userId: string): Promise<Timecard[]> {
  const snap = await userCol(userId, "timecards").get()
  return snap.docs.map((d) => mapTimecard(withId(d)))
}

/** Merge-set on the person's day (timecardId): a re-save overwrites and keeps createdAt. */
export async function setTimecard(userId: string, input: SetTimecardInput): Promise<Timecard> {
  const collaboratorId = input.collaboratorId ?? null
  const ref = userDoc(userId, "timecards", timecardId(input.engagementId, input.date, collaboratorId))
  const prev = await ref.get()
  await ref.set(
    {
      userId,
      engagementId: input.engagementId,
      collaboratorId,
      date: input.date,
      hours: input.hours,
      notes: input.notes === undefined ? (prev.get("notes") ?? null) : input.notes,
      ...(!prev.exists && { createdAt: now() }),
      updatedAt: now(),
    },
    { merge: true },
  )
  return mapTimecard(withId(await ref.get()))
}

export async function deleteTimecard(userId: string, engagementId: string, date: string, collaboratorId?: string | null): Promise<void> {
  await userDoc(userId, "timecards", timecardId(engagementId, date, collaboratorId)).delete()
}

function mapMeeting(d: DocumentData & { id: string }): Meeting {
  return {
    id: d.id,
    userId: d.userId as string,
    clientId: d.clientId as string,
    engagementId: (d.engagementId as string | null) ?? null,
    date: d.date as string,
    time: (d.time as string | null) ?? null,
    health: (d.health as MeetingHealth | null) ?? null,
    text: d.text as string,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

// ponytail: whole collection; where(clientId) once the history reaches thousands.
export async function getMeetings(userId: string): Promise<Meeting[]> {
  const snap = await userCol(userId, "meetings").get()
  return snap.docs.map((d) => mapMeeting(withId(d)))
}

export async function createMeeting(userId: string, input: CreateMeetingInput): Promise<Meeting> {
  const ref = await userCol(userId, "meetings").add({
    userId,
    clientId: input.clientId,
    engagementId: input.engagementId ?? null,
    date: input.date,
    time: input.time ?? null,
    health: input.health ?? null,
    text: input.text.trim(),
    createdAt: now(),
    updatedAt: now(),
  })
  return mapMeeting(withId(await ref.get()))
}

export async function updateMeeting(userId: string, id: string, input: UpdateMeetingInput): Promise<Meeting> {
  const ref = userDoc(userId, "meetings", id)
  const snap = await ref.get()
  if (!snap.exists) throw new Error("Meeting not found")
  const updates: Record<string, unknown> = { updatedAt: now() }
  if (input.engagementId !== undefined) updates.engagementId = input.engagementId
  if (input.date !== undefined) updates.date = input.date
  if (input.time !== undefined) updates.time = input.time
  if (input.health !== undefined) updates.health = input.health
  if (input.text !== undefined) updates.text = input.text.trim()
  await ref.update(updates)
  return mapMeeting(withId(await ref.get()))
}

function mapSolution(d: DocumentData & { id: string }): Solution {
  return {
    id: d.id,
    userId: d.userId as string,
    clientId: d.clientId as string,
    engagementId: (d.engagementId as string | null) ?? null,
    name: d.name as string,
    status: d.status as SolutionStatus,
    domain: normalizeSolutionDomain(d.domain),
    stack: normalizeSolutionStack(d.stack),
    sections: normalizeSolutionSections(d.sections),
    ...normalizeSolutionGraph(d.entities, d.relations),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

// ponytail: whole collection, like verbali; where(clientId) once the catalogue reaches thousands.
export async function getSolutions(userId: string): Promise<Solution[]> {
  const snap = await userCol(userId, "solutions").get()
  return snap.docs.map((d) => mapSolution(withId(d)))
}

// The Admin SDK skips the rules, so every write is parsed (solutionFields), as the cash book's are.
export async function createSolution(userId: string, input: CreateSolutionInput): Promise<Solution> {
  const ref = await userCol(userId, "solutions").add({
    userId,
    ...solutionFields(input),
    createdAt: now(),
    updatedAt: now(),
  })
  return mapSolution(withId(await ref.get()))
}

/** The stored solution with the update on top, parsed whole, in one transaction: a relation is checked against the stored entities. */
export async function updateSolution(userId: string, id: string, input: UpdateSolutionInput): Promise<Solution> {
  const ref = userDoc(userId, "solutions", id)
  await getAdminFirestore().runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists) throw new Error("Solution not found")
    t.update(ref, { ...solutionFields(mapSolution(withId(snap)), input), updatedAt: now() })
  })
  return mapSolution(withId(await ref.get()))
}

export async function getAllocations(
  userId: string,
  filter?: { from?: string; to?: string; engagementId?: string },
): Promise<Allocation[]> {
  let query: FirebaseFirestore.Query = userCol(userId, "allocations")
  if (filter?.engagementId) query = query.where("engagementId", "==", filter.engagementId)
  if (filter?.from) query = query.where("yearMonth", ">=", filter.from)
  if (filter?.to) query = query.where("yearMonth", "<=", filter.to)
  const snap = await query.get()
  return snap.docs.map((d) => mapAllocation(withId(d)))
}

/** The upsert lookup for log_allocation: at most one doc per (engagement, month). */
export async function getAllocationByKey(
  userId: string,
  engagementId: string,
  yearMonth: string,
): Promise<Allocation | null> {
  const snap = await userCol(userId, "allocations")
    .where("engagementId", "==", engagementId)
    .where("yearMonth", "==", yearMonth)
    .limit(1)
    .get()
  return snap.empty ? null : mapAllocation(withId(snap.docs[0]))
}

export async function createAllocation(
  userId: string,
  input: CreateAllocationInput,
): Promise<Allocation> {
  const ref = await userCol(userId, "allocations").add({
    userId,
    engagementId: input.engagementId,
    yearMonth: input.yearMonth,
    days: input.days,
    createdAt: now(),
    updatedAt: now(),
  })
  return mapAllocation(withId(await ref.get()))
}

export async function updateAllocation(
  userId: string,
  id: string,
  input: UpdateAllocationInput,
): Promise<Allocation> {
  const ref = userDoc(userId, "allocations", id)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`Allocation ${id} not found`)
  const updates: Record<string, unknown> = { updatedAt: now() }
  if (input.days !== undefined) updates.days = input.days
  await ref.update(updates)
  return mapAllocation(withId(await ref.get()))
}

// ─── Capacity (time off) and the MCP audit trail ─────────────────────────────
// Capacity is on the client adapter too (the Plan sets it); the audit trail is server-only.

export async function getCapacityDocs(
  userId: string,
  filter: { from: string; to: string },
): Promise<CapacityDoc[]> {
  const snap = await userCol(userId, "capacity")
    .where("yearMonth", ">=", filter.from)
    .where("yearMonth", "<=", filter.to)
    .get()
  return snap.docs.map((d) => readCapacityDoc(d.data()))
}

/** Doc id = yearMonth, so repeating a block is an idempotent overwrite. The userId lets the app (client rules) update it too. */
export async function setCapacity(userId: string, doc: CapacityDoc): Promise<void> {
  await userDoc(userId, "capacity", doc.yearMonth).set({ ...doc, userId, updatedAt: now() })
}

export async function addAuditEntry(
  userId: string,
  entry: {
    tool: string
    params: unknown
    result: "ok" | "error"
    errorMessage?: string
    documentIds?: string[]
    clientId: string
    preview?: boolean
  },
): Promise<void> {
  await userCol(userId, "mcp_audit").add({
    tool: entry.tool,
    params: JSON.parse(JSON.stringify(entry.params ?? null)),
    result: entry.result,
    errorMessage: entry.errorMessage ?? null,
    documentIds: entry.documentIds ?? [],
    clientId: entry.clientId,
    ...(entry.preview ? { preview: true } : {}),
    createdAt: now(),
  })
}

// ── Rent (tenants and leases) ───────────────────────────────────────────────
// The rent package's Firestore slice, composed from the Admin SDK's own calls the way
// firebase.ts composes it from the client SDK's. The Admin SDK bypasses the rules; the
// package's zod schemas are the check on every write.
const rentSlice = createFirebaseRent({
  col: userCol,
  docRef: userDoc,
  now,
  getDocs: (q) => (q as FirebaseFirestore.Query).get(),
  readBack: (ref) => (ref as FirebaseFirestore.DocumentReference).get(),
  addDoc: (c, data) => (c as FirebaseFirestore.CollectionReference).add(data),
  updateDoc: async (ref, data) => void (await (ref as FirebaseFirestore.DocumentReference).update(data)),
  toDate,
  isPermissionDenied: () => false,
})
export const getTenants = rentSlice.getTenants
export const createTenant = rentSlice.createTenant
export const updateTenant = rentSlice.updateTenant
export const getLeases = rentSlice.getLeases
export const createLease = rentSlice.createLease
export const updateLease = rentSlice.updateLease
