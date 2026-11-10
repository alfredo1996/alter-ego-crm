import { createFirebaseRent } from "@alter-ego/rent/adapter-firebase"
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged as fbOnAuthStateChanged,
  updateProfile as fbUpdateProfile,
  updateEmail,
  type User as FirebaseUser,
} from "firebase/auth"
import {
  collection,
  doc,
  getDoc as getDocAnySource,
  getDocFromServer,
  getDocsFromServer,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from "firebase/firestore"
import { deleteObject, getBytes, ref as storageRef, uploadBytes } from "firebase/storage"

import { ASSIGNMENT_EXISTS, ASSIGNMENT_HAS_DAYS, assignmentId, COLLABORATOR_HAS_DAYS, timecardId } from "@/lib/assignments"
import { readCapacityDoc } from "@/lib/capacity"
import { ACCOUNT_HAS_ENTRIES, BILL_HAS_PAYMENTS, CLIENT_HAS_CASH, NON_CASH, leavesSupplierDocument } from "@/lib/cash-book"
import { byActiveThenName } from "@/lib/collaborators"
import { CONTRACT_HAS_HOURS } from "@/lib/engagements"
import { normalizeAmendments } from "@/lib/engagements"
import { getFirebaseAuth, getFirebaseDb, getFirebaseStorage } from "@/lib/firebase-client"
import { checkInvoiceFile, INVOICE_FILE_CONTENT_TYPE } from "@/lib/invoice-files"
import { normalizeLabels } from "@/lib/tasks"
import {
  assignmentFields,
  collaboratorFields,
  normalizeMonthDays,
  normalizeCollaboratorFee,
  normalizePriceChanges,
  normalizeSolutionDomain,
  normalizeSolutionGraph,
  normalizeSolutionKind,
  normalizeSolutionSections,
  normalizeSolutionStack,
  normalizeSolutionSteps,
  normalizeSolutionTarget,
  SOLUTION_SECTIONS,
} from "@/types/schemas"

import type { BackendAdapter, AuthAdapter, DatabaseAdapter, FilesAdapter } from "./types"
import type {
  User,
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
  RentPart,
  CapacityDoc,
  CompanySettings,
  CreateCompanyMovementInput,
  UpdateCompanyMovementInput,
  CreateEngagementInput,
  UpdateEngagementInput,
  CreateClientInput,
  UpdateClientInput,
  CreateOpportunityInput,
  UpdateOpportunityInput,
  CreateAllocationInput,
  UpdateAllocationInput,
  Client,
  Opportunity,
  Engagement,
  Allocation,
  CompanyDeadline,
  CreateCompanyDeadlineInput,
  UpdateCompanyDeadlineInput,
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  Timecard,
  SetTimecardInput,
  Meeting,
  MeetingHealth,
  CreateMeetingInput,
  UpdateMeetingInput,
  Assignment,
  CreateAssignmentInput,
  UpdateAssignmentInput,
  Collaborator,
  CollaboratorType,
  CreateCollaboratorInput,
  UpdateCollaboratorInput,
  Solution,
  SolutionStatus,
  CreateSolutionInput,
  UpdateSolutionInput,
  Invoice,
  InvoiceFile,
  CreateInvoiceInput,
  UpdateInvoiceInput,
} from "@/types"

// ponytail: never serve Firestore's offline cache as data. Plain getDocs/getDoc
// resolve from the SDK's memory cache once it decides it is offline (one failed
// connect, or 10 s with no reply): stale docs, or [] for a query never fetched this
// session. TanStack stored that as fresh, so a reopened tab sat on it for a minute,
// and the daily snapshot and recalculateBalances acted on it. The FromServer
// variants reject with 'unavailable' instead; online they are the same request.
// readBack is the plain getDoc, only for re-reading a doc after an acknowledged
// write: the cache holds the committed doc, and a server-only read that failed
// there would report a committed create as failed, inviting a duplicate on retry.
// Offline, Firestore's own message is for developers ("Run again without setting
// source to 'server'...") and would reach the owner in error cards and toasts.
const OFFLINE_MESSAGE = "Can't reach the server. Check your connection and try again."
function plainOffline(err: unknown): never {
  if ((err as { code?: unknown } | null)?.code === "unavailable") {
    throw Object.assign(new Error(OFFLINE_MESSAGE), { code: "unavailable" })
  }
  throw err
}
const getDoc = <A, D extends DocumentData>(ref: DocumentReference<A, D>) => getDocFromServer(ref).catch(plainOffline)
const getDocs = <A, D extends DocumentData>(q: Query<A, D>) => getDocsFromServer(q).catch(plainOffline)
const readBack = <A, D extends DocumentData>(ref: DocumentReference<A, D>) => getDocAnySource(ref).catch(plainOffline)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  return new Date(val as string)
}

function toOptionalDate(val: unknown): Date | null {
  if (val == null) return null
  return toDate(val)
}

/** The invoice file pointer as stored; absent (documents from before files) reads as null. */
function mapFile(f: unknown): InvoiceFile | null {
  if (f == null) return null
  const d = f as DocumentData
  return { path: d.path as string, name: d.name as string, kind: d.kind as InvoiceFile["kind"], size: Number(d.size), uploadedAt: toDate(d.uploadedAt) }
}

function fileDoc(f: InvoiceFile | null): Record<string, unknown> | null {
  return f && { path: f.path, name: f.name, kind: f.kind, size: f.size, uploadedAt: Timestamp.fromDate(f.uploadedAt) }
}

async function removeObject(path: string): Promise<void> {
  try {
    await deleteObject(storageRef(getFirebaseStorage(), path))
  } catch (err) {
    if ((err as { code?: string }).code !== "storage/object-not-found") throw err
  }
}

/**
 * Deleting a cost, an invoice or a client deletes the objects its records name,
 * after the documents: a failure here leaves one unreferenced object, never a
 * record pointing at nothing.
 * ponytail: a failed object delete is not retried; a sweep of company-files not named by any record would clean up.
 */
async function removeObjectsOf(files: unknown[]): Promise<void> {
  await Promise.all(
    files.map(mapFile).flatMap((f) =>
      f ? [removeObject(f.path).catch((err) => console.error(`Could not delete ${f.path}; it stays unreferenced`, err))] : [],
    ),
  )
}

function createFirebaseFilesAdapter(): FilesAdapter {
  return {
    async upload(userId, file, name) {
      const check = checkInvoiceFile({ name, size: file.size })
      if (!check.ok) throw new Error(check.reason)
      const path = `users/${userId}/company-files/${doc(collection(getFirebaseDb(), "_")).id}.${check.kind === "p7m" ? "xml.p7m" : check.kind}`
      await uploadBytes(storageRef(getFirebaseStorage(), path), file, { contentType: INVOICE_FILE_CONTENT_TYPE[check.kind] })
      return { path, name, kind: check.kind, size: file.size, uploadedAt: new Date() }
    },
    async download(file) {
      return new Blob([await getBytes(storageRef(getFirebaseStorage(), file.path))])
    },
    remove: removeObject,
  }
}

function docData(snap: DocumentSnapshot | QueryDocumentSnapshot): DocumentData & { id: string } {
  return { id: snap.id, ...(snap.data() ?? {}) }
}


// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapFirebaseUser(u: FirebaseUser): User {
  return {
    id: u.uid,
    email: u.email ?? "",
    displayName: u.displayName ?? null,
    photoURL: u.photoURL ?? null,
    createdAt: new Date(u.metadata.creationTime ?? Date.now()),
    updatedAt: new Date(u.metadata.lastSignInTime ?? Date.now()),
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
    notes: (d.notes as string | null) ?? null,
    accountId: (d.accountId as string | null | undefined) ?? null,
    dateEstimated: Boolean(d.dateEstimated),
    importRef: (d.importRef as string | null | undefined) ?? null,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapCompanyAccount(d: DocumentData & { id: string }): CompanyAccount {
  return {
    id: d.id,
    userId: d.userId as string,
    name: d.name as string,
    openingBalance: Number(d.openingBalance),
    openingDate: toDate(d.openingDate),
    statementBalance: d.statementBalance != null ? Number(d.statementBalance) : null,
    statementDate: toOptionalDate(d.statementDate),
    importRef: (d.importRef as string | null | undefined) ?? null,
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
    toAccountId: (d.toAccountId as string | null | undefined) ?? null,
    expenseId: (d.expenseId as string | null | undefined) ?? null,
    description: d.description as string,
    documentRef: (d.documentRef as string | null | undefined) ?? null,
    project: (d.project as string | null | undefined) ?? null,
    counterparty: (d.counterparty as string | null | undefined) ?? null,
    notes: (d.notes as string | null | undefined) ?? null,
    dateEstimated: Boolean(d.dateEstimated),
    importRef: (d.importRef as string | null | undefined) ?? null,
    leaseId: (d.leaseId as string | null | undefined) ?? null,
    rentMonth: (d.rentMonth as string | null | undefined) ?? null,
    rentPart: (d.rentPart as RentPart | null | undefined) ?? null,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

/** The cost fields an update writes as they are; date is the one converted. */
const EXPENSE_FIELDS = [
  "description", "category", "amount", "isRecurring", "recurrenceMonths", "notes", "accountId", "paidByOwner", "vat",
  "documentRef", "project", "recurringExpenseId", "dateEstimated", "importRef", "collaboratorId", "engagementId", "forMonth", "leaseId", "endMonth", "priceChanges", "countedWhenPaid",
] as const satisfies readonly (keyof UpdateCompanyExpenseInput)[]

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
    notes: (d.notes as string | null) ?? null,
    accountId: (d.accountId as string | null | undefined) ?? null,
    paidByOwner: Boolean(d.paidByOwner),
    vat: d.vat != null ? Number(d.vat) : null,
    documentRef: (d.documentRef as string | null | undefined) ?? null,
    project: (d.project as string | null | undefined) ?? null,
    recurringExpenseId: (d.recurringExpenseId as string | null | undefined) ?? null,
    dateEstimated: Boolean(d.dateEstimated),
    importRef: (d.importRef as string | null | undefined) ?? null,
    collaboratorId: (d.collaboratorId as string | null | undefined) ?? null,
    engagementId: (d.engagementId as string | null | undefined) ?? null,
    forMonth: (d.forMonth as string | null | undefined) ?? null,
    leaseId: (d.leaseId as string | null | undefined) ?? null,
    endMonth: (d.endMonth as string | null | undefined) ?? null,
    priceChanges: normalizePriceChanges(d.priceChanges),
    countedWhenPaid: d.countedWhenPaid === true,
    file: mapFile(d.file),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapClient(d: DocumentData & { id: string }): Client {
  return {
    id: d.id,
    userId: d.userId as string,
    name: d.name as string,
    vatNumber: (d.vatNumber as string | null) ?? null,
    email: (d.email as string | null) ?? null,
    contactName: (d.contactName as string | null) ?? null,
    contactPhone: (d.contactPhone as string | null) ?? null,
    notes: (d.notes as string | null) ?? null,
    isActive: Boolean(d.isActive),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapOpportunity(d: DocumentData & { id: string }): Opportunity {
  return {
    id: d.id,
    userId: d.userId as string,
    clientId: d.clientId as string,
    title: d.title as string,
    stage: d.stage as Opportunity["stage"],
    probability: Number(d.probability),
    dailyRate: Number(d.dailyRate),
    estimatedDaysPerMonth: Number(d.estimatedDaysPerMonth),
    unit: d.unit as Opportunity["unit"],
    estimatedDurationMonths: Number(d.estimatedDurationMonths),
    expectedStartMonth: (d.expectedStartMonth as string | null) ?? null,
    vatApplicable: Boolean(d.vatApplicable),
    nextActionDate: d.nextActionDate != null ? toDate(d.nextActionDate) : null,
    nextActionNote: (d.nextActionNote as string | null) ?? null,
    notes: (d.notes as string | null) ?? null,
    lostReason: (d.lostReason as string | null) ?? null,
    closedAt: d.closedAt != null ? toDate(d.closedAt) : null,
    engagementId: (d.engagementId as string | null) ?? null,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapEngagement(d: DocumentData & { id: string }): Engagement {
  return {
    id: d.id,
    userId: d.userId as string,
    clientId: d.clientId as string,
    name: (d.name as string | null) ?? null,
    opportunityId: (d.opportunityId as string | null) ?? null,
    dailyRate: Number(d.dailyRate),
    unit: d.unit as Engagement["unit"],
    vatApplicable: Boolean(d.vatApplicable),
    contractedDays: d.contractedDays != null ? Number(d.contractedDays) : null,
    defaultDaysPerMonth: Number(d.defaultDaysPerMonth ?? 0),
    startMonth: (d.startMonth as string | null) ?? null,
    endMonth: (d.endMonth as string | null) ?? null,
    endDate: (d.endDate as string | null) ?? null,
    isActive: Boolean(d.isActive),
    notes: (d.notes as string | null) ?? null,
    amendments: normalizeAmendments(d.amendments),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
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

function mapAssignment(d: DocumentData & { id: string }): Assignment {
  return {
    id: d.id,
    userId: d.userId as string,
    collaboratorId: d.collaboratorId as string,
    engagementId: d.engagementId as string,
    dailyRate: Number(d.dailyRate),
    from: d.from as string,
    until: (d.until as string | null) ?? null,
    defaultDays: Number(d.defaultDays),
    // The rules check the map's type and size; a bad month or day is dropped here. Never throws.
    monthDays: normalizeMonthDays(d.monthDays),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
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

function mapSolution(d: DocumentData & { id: string }): Solution {
  return {
    id: d.id,
    userId: d.userId as string,
    clientId: d.clientId as string,
    engagementId: (d.engagementId as string | null) ?? null,
    name: d.name as string,
    status: d.status as SolutionStatus,
    kind: normalizeSolutionKind(d.kind),
    target: normalizeSolutionTarget(d.target),
    steps: normalizeSolutionSteps(d.steps),
    domain: normalizeSolutionDomain(d.domain),
    stack: normalizeSolutionStack(d.stack),
    sections: normalizeSolutionSections(d.sections),
    ...normalizeSolutionGraph(d.entities, d.relations),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapCollaborator(d: DocumentData & { id: string }): Collaborator {
  return {
    id: d.id,
    userId: d.userId as string,
    name: d.name as string,
    type: d.type as CollaboratorType,
    notes: (d.notes as string | null) ?? null,
    isActive: d.isActive as boolean,
    // The rules check the fee's shape and size; a bad amount or month reads as no fee, a bad change is dropped. Never throws.
    fee: normalizeCollaboratorFee(d.fee),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapInvoice(d:DocumentData & { id: string }): Invoice {
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

function mapAllocation(d: DocumentData & { id: string }): Allocation {
  return {
    id: d.id,
    userId: d.userId as string,
    engagementId: d.engagementId as string,
    yearMonth: d.yearMonth as string,
    days: Number(d.days),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

// ─── Adapter factories ────────────────────────────────────────────────────────

function createFirebaseAuthAdapter(): AuthAdapter {
  return {
    async signIn(email: string, password: string): Promise<User> {
      const auth = getFirebaseAuth()
      const { user } = await signInWithEmailAndPassword(auth, email, password)
      return mapFirebaseUser(user)
    },

    async signUp(email: string, password: string, displayName: string): Promise<User> {
      const auth = getFirebaseAuth()
      const { user } = await createUserWithEmailAndPassword(auth, email, password)
      await fbUpdateProfile(user, { displayName })
      return mapFirebaseUser(user)
    },

    async signOut(): Promise<void> {
      await fbSignOut(getFirebaseAuth())
    },

    async getCurrentUser(): Promise<User | null> {
      const user = getFirebaseAuth().currentUser
      return user ? mapFirebaseUser(user) : null
    },

    async getIdToken(): Promise<string | null> {
      const user = getFirebaseAuth().currentUser
      return user ? user.getIdToken() : null
    },

    onAuthStateChanged(callback: (user: User | null) => void): () => void {
      return fbOnAuthStateChanged(getFirebaseAuth(), (u) => {
        callback(u ? mapFirebaseUser(u) : null)
      })
    },

    async updateProfile(input: { displayName?: string; email?: string }): Promise<void> {
      const auth = getFirebaseAuth()
      const user = auth.currentUser
      if (!user) throw new Error("No authenticated user")
      if (input.displayName !== undefined) {
        await fbUpdateProfile(user, { displayName: input.displayName })
      }
      if (input.email !== undefined) {
        await updateEmail(user, input.email)
      }
    },
  }
}

// Applies one write to every ref. A writeBatch holds at most 500 writes; the
// batches commit in parallel, far faster than one round trip per document.
async function commitInChunks(
  refs: DocumentReference<unknown>[],
  write: (batch: WriteBatch, ref: DocumentReference<unknown>) => void
): Promise<void> {
  const commits: Promise<void>[] = []
  for (let i = 0; i < refs.length; i += 500) {
    const batch = writeBatch(getFirebaseDb())
    for (const ref of refs.slice(i, i + 500)) write(batch, ref)
    commits.push(batch.commit())
  }
  await Promise.all(commits)
}

async function authHeader(): Promise<HeadersInit> {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new Error("Not signed in")
  return { Authorization: `Bearer ${await user.getIdToken()}` }
}

// Deletes every document the queries return, in chunks.
async function deleteAllDocs(...queries: Parameters<typeof getDocs>[0][]): Promise<void> {
  const snaps = await Promise.all(queries.map((q) => getDocs(q)))
  await commitInChunks(snaps.flatMap((s) => s.docs.map((d) => d.ref)), (batch, ref) => batch.delete(ref))
}

function createFirebaseDbAdapter(): DatabaseAdapter {
  // Helper: user-scoped collection ref
  const col = (userId: string, ...segments: string[]) => {
    const db = getFirebaseDb()
    const path = `users/${userId}/${segments.join("/")}`
    return collection(db, path)
  }

  const docRef = (userId: string, colName: string, docId: string) => {
    const db = getFirebaseDb()
    return doc(db, `users/${userId}/${colName}/${docId}`)
  }

  const now = () => serverTimestamp()

  /**
   * An allocation is meaningless without its contract — nothing in the UI can
   * reach one whose engagement is gone. Firestore has no cascading delete, so
   * the adapter does it, in one batch: a dropped connection must not leave a
   * client half-deleted.
   *
   * ponytail: a write batch caps at 500 ops. A client with more contracts plus
   * allocations than that would need chunking; chunk it when one exists.
   */
  const allocationRefsOf = async (userId: string, engagementId: string) => {
    // Its collaborators' assignments go the same way.
    const snaps = await Promise.all(
      ["allocations", "collaborator_assignments"].map((c) =>
        getDocs(query(col(userId, c), where("engagementId", "==", engagementId))),
      ),
    )
    return snaps.flatMap((s) => s.docs.map((d) => d.ref))
  }

  // Firestore Security Rules throw FirebaseError with code "permission-denied"
  // when a user tries to access another user's data. Reads should return
  // null/empty instead of crashing.
  function isPermissionDenied(err: unknown): boolean {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "permission-denied"
    )
  }

  return {

    // ── API Keys ──────────────────────────────────────────────────────────

    // Keys are created and revoked by the server (#342): the rules refuse a
    // client write to api_keys_index, so the routes write both documents in one batch.
    async createApiKey(): Promise<{ key: string; id: string }> {
      const res = await fetch("/api/keys", { method: "POST", headers: await authHeader() })
      if (!res.ok) throw new Error("Could not create the API key")
      return (await res.json()) as { key: string; id: string }
    },

    async deleteApiKey(_userId: string, keyId: string): Promise<void> {
      const res = await fetch(`/api/keys/${encodeURIComponent(keyId)}`, {
        method: "DELETE",
        headers: await authHeader(),
      })
      if (!res.ok) throw new Error("Could not revoke the API key")
    },

    async getApiKeys(userId: string): Promise<{ id: string; prefix: string; createdAt: Date }[]> {
      try {
        const snap = await getDocs(col(userId, "api_keys"))
        return snap.docs.map((d) => {
          const data = docData(d)
          return {
            id: data.id,
            prefix: data.prefix as string,
            createdAt: toDate(data.createdAt),
          }
        })
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    // ── Company Expenses ────────────────────────────────────────────────────

    async getCompanyExpenses(userId: string): Promise<CompanyExpense[]> {
      try {
        const snap = await getDocs(query(col(userId, "company_expenses"), orderBy("date", "desc")))
        return snap.docs.map((d) => mapCompanyExpense(docData(d)))
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async createCompanyExpense(userId: string, input: CreateCompanyExpenseInput): Promise<CompanyExpense> {
      const ref = await addDoc(col(userId, "company_expenses"), {
        userId,
        description: input.description,
        category: input.category,
        amount: input.amount,
        date: Timestamp.fromDate(input.date),
        isRecurring: input.isRecurring ?? false,
        recurrenceMonths: input.recurrenceMonths ?? null,
        notes: input.notes ?? null,
        accountId: input.accountId ?? null,
        paidByOwner: input.paidByOwner ?? false,
        vat: input.vat ?? null,
        documentRef: input.documentRef ?? null,
        project: input.project ?? null,
        recurringExpenseId: input.recurringExpenseId ?? null,
        dateEstimated: input.dateEstimated ?? false,
        importRef: input.importRef ?? null,
        collaboratorId: input.collaboratorId ?? null,
        engagementId: input.engagementId ?? null,
        forMonth: input.forMonth ?? null,
        leaseId: input.leaseId ?? null,
        endMonth: input.endMonth ?? null,
        priceChanges: input.priceChanges ?? [],
        countedWhenPaid: input.countedWhenPaid ?? false,
        file: fileDoc(input.file ?? null),
        createdAt: now(),
        updatedAt: now(),
      })
      const snap = await readBack(ref)
      return mapCompanyExpense(docData(snap))
    },

    async updateCompanyExpense(userId: string, expenseId: string, input: UpdateCompanyExpenseInput): Promise<CompanyExpense> {
      const ref = docRef(userId, "company_expenses", expenseId)
      if (leavesSupplierDocument(input)) {
        const payments = await getDocs(query(col(userId, "company_movements"), where("expenseId", "==", expenseId), limit(1)))
        if (!payments.empty) throw new Error(BILL_HAS_PAYMENTS)
      }
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.date !== undefined) updates.date = Timestamp.fromDate(input.date)
      // Not checked against the stored document: an end before the start, or a price change that does not start after
      // it, is refused by the dialog and the schema on what they are given (the dialog sends the date, end and changes
      // together; the import folds changes into the amount when it moves a start). The mock and the admin adapter also
      // check the merge; here that would cost a read per update, and the rules cannot compare a list with a date.
      for (const key of EXPENSE_FIELDS) if (input[key] !== undefined) updates[key] = input[key]
      if (input.file !== undefined) updates.file = fileDoc(input.file)
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapCompanyExpense(docData(snap))
    },

    async deleteCompanyExpense(userId: string, expenseId: string): Promise<void> {
      const payments = await getDocs(query(col(userId, "company_movements"), where("expenseId", "==", expenseId), limit(1)))
      if (!payments.empty) throw new Error(BILL_HAS_PAYMENTS)
      const ref = docRef(userId, "company_expenses", expenseId)
      const file = (await getDoc(ref)).data()?.file
      await deleteDoc(ref)
      await removeObjectsOf([file])
    },

    // ── Company Loans (finanziamento soci) ─────────────────────────────────

    async getCompanyLoans(userId: string): Promise<CompanyLoan[]> {
      try {
        const snap = await getDocs(query(col(userId, "company_loans"), orderBy("date", "desc")))
        return snap.docs.map((d) => mapCompanyLoan(docData(d)))
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async createCompanyLoan(userId: string, input: CreateCompanyLoanInput): Promise<CompanyLoan> {
      const ref = await addDoc(col(userId, "company_loans"), {
        userId,
        description: input.description,
        direction: input.direction,
        amount: input.amount,
        date: Timestamp.fromDate(input.date),
        notes: input.notes ?? null,
        accountId: input.accountId ?? null,
        dateEstimated: input.dateEstimated ?? false,
        importRef: input.importRef ?? null,
        createdAt: now(),
        updatedAt: now(),
      })
      const snap = await readBack(ref)
      return mapCompanyLoan(docData(snap))
    },

    async updateCompanyLoan(userId: string, loanId: string, input: UpdateCompanyLoanInput): Promise<CompanyLoan> {
      const ref = docRef(userId, "company_loans", loanId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.description !== undefined) updates.description = input.description
      if (input.direction !== undefined) updates.direction = input.direction
      if (input.amount !== undefined) updates.amount = input.amount
      if (input.date !== undefined) updates.date = Timestamp.fromDate(input.date)
      if (input.notes !== undefined) updates.notes = input.notes
      if (input.accountId !== undefined) updates.accountId = input.accountId
      if (input.dateEstimated !== undefined) updates.dateEstimated = input.dateEstimated
      if (input.importRef !== undefined) updates.importRef = input.importRef
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapCompanyLoan(docData(snap))
    },

    async deleteCompanyLoan(userId: string, loanId: string): Promise<void> {
      await deleteDoc(docRef(userId, "company_loans", loanId))
    },

    // ── Company Accounts and Movements (the cash book) ─────────────────────
    //
    // The rules validate every write (company_accounts, company_movements);
    // the mock parses the same checks from schemas.ts.

    // ── Time off: a month's record, the doc id is the month (the connector writes the same docs) ──

    async getCapacityDocs(userId: string, filter: { from: string; to: string }): Promise<CapacityDoc[]> {
      try {
        const snap = await getDocs(
          query(col(userId, "capacity"), where("yearMonth", ">=", filter.from), where("yearMonth", "<=", filter.to)),
        )
        return snap.docs.map((d) => readCapacityDoc(d.data())).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
      } catch (err) {
        // A bundle deployed before the rules still renders.
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async setCapacity(userId: string, doc: CapacityDoc): Promise<void> {
      // The rules (firestore/crm.rules) are the closed schema; the mock parses capacityDocSchema for the same.
      await setDoc(docRef(userId, "capacity", doc.yearMonth), { userId, ...doc, updatedAt: now() })
    },

    async getCompanySettings(userId: string): Promise<CompanySettings> {
      try {
        const snap = await getDoc(docRef(userId, "company_settings", "main"))
        const floor = snap.data()?.cashFloor
        return { cashFloor: typeof floor === "number" ? floor : null }
      } catch (err) {
        if (isPermissionDenied(err)) return { cashFloor: null }
        throw err
      }
    },

    async setCompanyCashFloor(userId: string, floor: number | null): Promise<CompanySettings> {
      // The rules refuse a negative or non-number floor too; failing here gives the mock's error without a round trip.
      if (floor !== null && !(Number.isFinite(floor) && floor >= 0)) throw new Error("Floor must be 0 or more")
      const cashFloor = floor
      await setDoc(docRef(userId, "company_settings", "main"), { userId, cashFloor, updatedAt: now() })
      return { cashFloor }
    },

    async getCompanyAccounts(userId: string): Promise<CompanyAccount[]> {
      try {
        const snap = await getDocs(col(userId, "company_accounts"))
        return snap.docs.map((d) => mapCompanyAccount(docData(d))).sort((a, b) => a.name.localeCompare(b.name))
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async createCompanyAccount(userId: string, input: CreateCompanyAccountInput): Promise<CompanyAccount> {
      const ref = await addDoc(col(userId, "company_accounts"), {
        userId,
        name: input.name,
        openingBalance: input.openingBalance,
        openingDate: Timestamp.fromDate(input.openingDate),
        statementBalance: input.statementBalance ?? null,
        statementDate: input.statementDate ? Timestamp.fromDate(input.statementDate) : null,
        importRef: input.importRef ?? null,
        createdAt: now(),
        updatedAt: now(),
      })
      const snap = await readBack(ref)
      return mapCompanyAccount(docData(snap))
    },

    async updateCompanyAccount(userId: string, accountId: string, input: UpdateCompanyAccountInput): Promise<CompanyAccount> {
      const ref = docRef(userId, "company_accounts", accountId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.name !== undefined) updates.name = input.name
      if (input.openingBalance !== undefined) updates.openingBalance = input.openingBalance
      if (input.openingDate !== undefined) updates.openingDate = Timestamp.fromDate(input.openingDate)
      if (input.statementBalance !== undefined) updates.statementBalance = input.statementBalance
      if (input.statementDate !== undefined)
        updates.statementDate = input.statementDate ? Timestamp.fromDate(input.statementDate) : null
      if (input.importRef !== undefined) updates.importRef = input.importRef
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapCompanyAccount(docData(snap))
    },

    async deleteCompanyAccount(userId: string, accountId: string): Promise<void> {
      // ponytail: an entry written between this check and the delete names a gone
      // account; the statement check shows the difference.
      const [from, into, costs, loans, invoices] = await Promise.all([
        getDocs(query(col(userId, "company_movements"), where("accountId", "==", accountId), limit(1))),
        getDocs(query(col(userId, "company_movements"), where("toAccountId", "==", accountId), limit(1))),
        getDocs(query(col(userId, "company_expenses"), where("accountId", "==", accountId), limit(1))),
        getDocs(query(col(userId, "company_loans"), where("accountId", "==", accountId), limit(1))),
        getDocs(query(col(userId, "invoices"), where("paidAccountId", "==", accountId))),
      ])
      if (!from.empty || !into.empty || !costs.empty || !loans.empty || invoices.docs.some((d) => d.data().paidDate != null)) {
        throw new Error(ACCOUNT_HAS_ENTRIES)
      }
      // The rest are unpaid invoices keeping the account from an untick: clear it with
      // the delete, or a re-tick with the date alone pays them into a gone account.
      const batch = writeBatch(getFirebaseDb())
      for (const d of invoices.docs) batch.update(d.ref, { paidAccountId: null, updatedAt: now() })
      batch.delete(docRef(userId, "company_accounts", accountId))
      await batch.commit()
    },

    async getCompanyMovements(userId: string): Promise<CompanyMovement[]> {
      try {
        const snap = await getDocs(query(col(userId, "company_movements"), orderBy("date", "desc")))
        return snap.docs.map((d) => mapCompanyMovement(docData(d)))
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async createCompanyMovement(userId: string, input: CreateCompanyMovementInput): Promise<CompanyMovement> {
      const ref = await addDoc(col(userId, "company_movements"), {
        userId,
        kind: input.kind,
        direction: input.direction,
        amount: input.amount,
        date: Timestamp.fromDate(input.date),
        accountId: input.accountId,
        toAccountId: input.toAccountId ?? null,
        expenseId: input.expenseId ?? null,
        description: input.description,
        documentRef: input.documentRef ?? null,
        project: input.project ?? null,
        counterparty: input.counterparty ?? null,
        notes: input.notes ?? null,
        dateEstimated: input.dateEstimated ?? false,
        importRef: input.importRef ?? null,
        leaseId: input.leaseId ?? null,
        rentMonth: input.rentMonth ?? null,
        rentPart: input.rentPart ?? null,
        createdAt: now(),
        updatedAt: now(),
      })
      const snap = await readBack(ref)
      return mapCompanyMovement(docData(snap))
    },

    async updateCompanyMovement(userId: string, movementId: string, input: UpdateCompanyMovementInput): Promise<CompanyMovement> {
      const ref = docRef(userId, "company_movements", movementId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.kind !== undefined) updates.kind = input.kind
      if (input.direction !== undefined) updates.direction = input.direction
      if (input.amount !== undefined) updates.amount = input.amount
      if (input.date !== undefined) updates.date = Timestamp.fromDate(input.date)
      if (input.accountId !== undefined) updates.accountId = input.accountId
      if (input.toAccountId !== undefined) updates.toAccountId = input.toAccountId
      if (input.expenseId !== undefined) updates.expenseId = input.expenseId
      if (input.description !== undefined) updates.description = input.description
      if (input.documentRef !== undefined) updates.documentRef = input.documentRef
      if (input.project !== undefined) updates.project = input.project
      if (input.counterparty !== undefined) updates.counterparty = input.counterparty
      if (input.notes !== undefined) updates.notes = input.notes
      if (input.dateEstimated !== undefined) updates.dateEstimated = input.dateEstimated
      if (input.importRef !== undefined) updates.importRef = input.importRef
      if (input.leaseId !== undefined) updates.leaseId = input.leaseId
      if (input.rentMonth !== undefined) updates.rentMonth = input.rentMonth
      if (input.rentPart !== undefined) updates.rentPart = input.rentPart
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapCompanyMovement(docData(snap))
    },

    async deleteCompanyMovement(userId: string, movementId: string): Promise<void> {
      await deleteDoc(docRef(userId, "company_movements", movementId))
    },

    // ── CRM Clients ────────────────────────────────────────────────────────

    async getClients(userId: string): Promise<Client[]> {
      try {
        const snap = await getDocs(col(userId, "clients"))
        return snap.docs.map((d) => mapClient(docData(d))).sort((a, b) => a.name.localeCompare(b.name))
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async createClient(userId: string, input: CreateClientInput): Promise<Client> {
      const ref = await addDoc(col(userId, "clients"), {
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
      const snap = await readBack(ref)
      return mapClient(docData(snap))
    },

    async updateClient(userId: string, clientId: string, input: UpdateClientInput): Promise<Client> {
      const ref = docRef(userId, "clients", clientId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.name !== undefined) updates.name = input.name
      if (input.vatNumber !== undefined) updates.vatNumber = input.vatNumber
      if (input.email !== undefined) updates.email = input.email
      if (input.contactName !== undefined) updates.contactName = input.contactName
      if (input.contactPhone !== undefined) updates.contactPhone = input.contactPhone
      if (input.notes !== undefined) updates.notes = input.notes
      if (input.isActive !== undefined) updates.isActive = input.isActive
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapClient(docData(snap))
    },

    async deleteClient(userId: string, clientId: string): Promise<void> {
      const [oppSnap, engSnap, ownTaskSnap, ownInvoiceSnap] = await Promise.all([
        getDocs(query(col(userId, "opportunities"), where("clientId", "==", clientId))),
        getDocs(query(col(userId, "engagements"), where("clientId", "==", clientId))),
        // Client-level tasks and every task written since #164; the older ones carry
        // no clientId and are found through their contract below.
        getDocs(query(col(userId, "tasks"), where("clientId", "==", clientId))),
        // Likewise invoices: re-pointed and new ones by client, older ones by contract.
        getDocs(query(col(userId, "invoices"), where("clientId", "==", clientId))),
      ])
      const [allocationRefLists, taskSnaps, invoiceSnaps] = await Promise.all([
        Promise.all(engSnap.docs.map((d) => allocationRefsOf(userId, d.id))),
        Promise.all(
          engSnap.docs.map((d) =>
            getDocs(query(col(userId, "tasks"), where("engagementId", "==", d.id)))
          )
        ),
        Promise.all(
          engSnap.docs.map((d) =>
            getDocs(query(col(userId, "invoices"), where("engagementId", "==", d.id)))
          )
        ),
      ])
      const invoiceDocs = [ownInvoiceSnap, ...invoiceSnaps].flatMap((s) => s.docs)
      // Cash on a company account: deleting the invoice would change a balance.
      if (
        invoiceDocs.some((d) => {
          const i = d.data()
          return i.paidDate != null && typeof i.paidAccountId === "string" && i.paidAccountId !== NON_CASH
        })
      ) {
        throw new Error(CLIENT_HAS_CASH)
      }

      // Timecards, verbali and solutions first and chunked: a year of them must never
      // push the batch past 500 and make the client undeletable. Before the batch, so
      // a failure leaves the client in place and a retry finishes — never orphans.
      // Every verbale and solution names its client, so one query covers the
      // contracts' ones too.
      await deleteAllDocs(
        ...engSnap.docs.map((d) => query(col(userId, "timecards"), where("engagementId", "==", d.id))),
        query(col(userId, "meetings"), where("clientId", "==", clientId)),
        query(col(userId, "solutions"), where("clientId", "==", clientId)),
      )

      // ponytail: one writeBatch, so a client with more than 500 descendant docs
      // would fail the commit. Chunk into batches of 500 if that ever happens.
      const batch = writeBatch(getFirebaseDb())
      batch.delete(docRef(userId, "clients", clientId))
      for (const d of oppSnap.docs) batch.delete(d.ref)
      for (const d of engSnap.docs) batch.delete(d.ref)
      for (const ref of allocationRefLists.flat()) batch.delete(ref)
      // Keyed by path: a task found by both queries is deleted once.
      const taskRefs = new Map([ownTaskSnap, ...taskSnaps].flatMap((s) => s.docs.map((d) => [d.ref.path, d.ref])))
      for (const ref of taskRefs.values()) batch.delete(ref)
      const invoiceRefs = new Map(invoiceDocs.map((d) => [d.ref.path, d.ref]))
      for (const ref of invoiceRefs.values()) batch.delete(ref)
      await batch.commit()
      await removeObjectsOf(Array.from(new Map(invoiceDocs.map((d) => [d.ref.path, d.data().file])).values()))
    },

    // ── CRM Opportunities ──────────────────────────────────────────────────

    async getOpportunities(userId: string): Promise<Opportunity[]> {
      try {
        const snap = await getDocs(col(userId, "opportunities"))
        return snap.docs.map((d) => mapOpportunity(docData(d))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async createOpportunity(userId: string, input: CreateOpportunityInput): Promise<Opportunity> {
      const ref = await addDoc(col(userId, "opportunities"), {
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
      const snap = await readBack(ref)
      return mapOpportunity(docData(snap))
    },

    async updateOpportunity(userId: string, opportunityId: string, input: UpdateOpportunityInput): Promise<Opportunity> {
      const ref = docRef(userId, "opportunities", opportunityId)
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
      if (input.closedAt !== undefined) updates.closedAt = input.closedAt ? Timestamp.fromDate(input.closedAt) : null
      if (input.engagementId !== undefined) updates.engagementId = input.engagementId
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapOpportunity(docData(snap))
    },

    async deleteOpportunity(userId: string, opportunityId: string): Promise<void> {
      await deleteDoc(docRef(userId, "opportunities", opportunityId))
    },

    // ── Engagements (signed contracts) ─────────────────────────────────────

    async getEngagements(userId: string): Promise<Engagement[]> {
      try {
        const snap = await getDocs(col(userId, "engagements"))
        return snap.docs.map((d) => mapEngagement(docData(d))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async createEngagement(userId: string, input: CreateEngagementInput): Promise<Engagement> {
      const ref = await addDoc(col(userId, "engagements"), {
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
      const snap = await readBack(ref)
      return mapEngagement(docData(snap))
    },

    async updateEngagement(userId: string, engagementId: string, input: UpdateEngagementInput): Promise<Engagement> {
      const ref = docRef(userId, "engagements", engagementId)
      if (input.clientId !== undefined) {
        // A contract moved to another client takes its tasks, verbali and solutions
        // along: taskClientId trusts a task's own clientId, and a verbale's clientId
        // is its section, so each must keep naming the contract's client.
        // Filtered here, since the edit form sends clientId on every save.
        const clientId = input.clientId
        const snaps = await Promise.all(
          ["tasks", "meetings", "solutions"].map((c) => getDocs(query(col(userId, c), where("engagementId", "==", engagementId))))
        )
        await commitInChunks(
          snaps.flatMap((snap) => snap.docs).filter((d) => d.data().clientId !== clientId).map((d) => d.ref),
          (batch, ref) => batch.update(ref, { clientId })
        )
      }
      const updates: Record<string, unknown> = { updatedAt: now() }
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
      // ponytail: the whole list is read-modify-write, last write wins for a single owner;
      // arrayUnion or a transaction if two writers ever matter.
      if (input.amendments !== undefined) updates.amendments = input.amendments
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapEngagement(docData(snap))
    },

    async deleteEngagement(userId: string, engagementId: string): Promise<void> {
      // Its hours are what the client's invoices are checked against: close it instead.
      // ponytail: a timecard logged between this check and the batch is orphaned, not lost.
      const [engagement, hours] = await Promise.all([
        getDoc(docRef(userId, "engagements", engagementId)),
        getDocs(query(col(userId, "timecards"), where("engagementId", "==", engagementId), limit(1))),
      ])
      if (!hours.empty) throw new Error(CONTRACT_HAS_HOURS)
      // Its tasks, verbali and invoices outlive it, as its client's (#164), and its
      // solutions go back to pre-sales. Re-pointed before the batch and chunked: a
      // failure leaves the contract in place and a retry finishes — never a document
      // naming a contract that is gone.
      if (engagement.exists()) {
        const clientId = engagement.data().clientId as string
        const snaps = await Promise.all(
          ["tasks", "meetings", "invoices", "solutions"].map((c) =>
            getDocs(query(col(userId, c), where("engagementId", "==", engagementId)))
          )
        )
        await commitInChunks(
          snaps.flatMap((s) => s.docs.map((d) => d.ref)),
          (batch, ref) => batch.update(ref, { engagementId: null, clientId })
        )
      }
      const batch = writeBatch(getFirebaseDb())
      batch.delete(docRef(userId, "engagements", engagementId))
      for (const ref of await allocationRefsOf(userId, engagementId)) batch.delete(ref)
      await batch.commit()
    },

    // ── Tasks (a client's to-dos, optionally on a contract) ─────────────────

    async getTasks(userId: string): Promise<Task[]> {
      try {
        const snap = await getDocs(col(userId, "tasks"))
        return snap.docs.map((d) => mapTask(docData(d)))
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async createTask(userId: string, input: CreateTaskInput): Promise<Task> {
      const ref = await addDoc(col(userId, "tasks"), {
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
      const snap = await readBack(ref)
      return mapTask(docData(snap))
    },

    async updateTask(userId: string, taskId: string, input: UpdateTaskInput): Promise<Task> {
      const ref = docRef(userId, "tasks", taskId)
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
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapTask(docData(snap))
    },

    async deleteTask(userId: string, taskId: string): Promise<void> {
      await deleteDoc(docRef(userId, "tasks", taskId))
    },

    // ── Timecards (hours per contract per day) ──────────────────────────────

    async getTimecards(userId: string): Promise<Timecard[]> {
      try {
        const snap = await getDocs(col(userId, "timecards"))
        return snap.docs.map((d) => mapTimecard(docData(d)))
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    // A merge-set on the deterministic id: retries and double saves land on one
    // document, and createdAt is written only when the day is first logged.
    async setTimecard(userId: string, input: SetTimecardInput): Promise<Timecard> {
      const collaboratorId = input.collaboratorId ?? null
      const ref = docRef(userId, "timecards", timecardId(input.engagementId, input.date, collaboratorId))
      const prev = await getDoc(ref)
      await setDoc(
        ref,
        {
          userId,
          engagementId: input.engagementId,
          collaboratorId,
          date: input.date,
          hours: input.hours,
          notes: input.notes === undefined ? (prev.get("notes") ?? null) : input.notes,
          ...(!prev.exists() && { createdAt: now() }),
          updatedAt: now(),
        },
        { merge: true },
      )
      return mapTimecard(docData(await readBack(ref)))
    },

    async deleteTimecard(userId: string, engagementId: string, date: string, collaboratorId?: string | null): Promise<void> {
      await deleteDoc(docRef(userId, "timecards", timecardId(engagementId, date, collaboratorId)))
    },

    // ── Meetings (verbali: calls and status updates) ────────────────────────

    async getMeetings(userId: string): Promise<Meeting[]> {
      try {
        const snap = await getDocs(col(userId, "meetings"))
        return snap.docs.map((d) => mapMeeting(docData(d)))
      } catch (err) {
        // A bundle deployed before the rules still renders.
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    // Every field, null included: the rules require each one to be present.
    async createMeeting(userId: string, input: CreateMeetingInput): Promise<Meeting> {
      const ref = await addDoc(col(userId, "meetings"), {
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
      return mapMeeting(docData(await readBack(ref)))
    },

    async updateMeeting(userId: string, meetingId: string, input: UpdateMeetingInput): Promise<Meeting> {
      const ref = docRef(userId, "meetings", meetingId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.engagementId !== undefined) updates.engagementId = input.engagementId
      if (input.date !== undefined) updates.date = input.date
      if (input.time !== undefined) updates.time = input.time
      if (input.health !== undefined) updates.health = input.health
      if (input.text !== undefined) updates.text = input.text.trim()
      await updateDoc(ref, updates)
      return mapMeeting(docData(await readBack(ref)))
    },

    async deleteMeeting(userId: string, meetingId: string): Promise<void> {
      await deleteDoc(docRef(userId, "meetings", meetingId))
    },

    // ── Solutions (what was built for a client, kept for pre-sales) ─────────

    async getSolutions(userId: string): Promise<Solution[]> {
      try {
        const snap = await getDocs(col(userId, "solutions"))
        return snap.docs.map((d) => mapSolution(docData(d)))
      } catch (err) {
        // A bundle deployed before the rules still renders.
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    // Every field, every section key included: the rules require each one to be present.
    async createSolution(userId: string, input: CreateSolutionInput): Promise<Solution> {
      const ref = await addDoc(col(userId, "solutions"), {
        userId,
        clientId: input.clientId,
        engagementId: input.engagementId ?? null,
        name: input.name.trim(),
        status: input.status ?? "proposed",
        kind: input.kind ?? "product",
        target: input.target ?? null,
        steps: input.steps ?? [],
        domain: input.domain ?? null,
        stack: input.stack ?? [],
        sections: normalizeSolutionSections(input.sections),
        entities: input.entities ?? [],
        relations: input.relations ?? [],
        createdAt: now(),
        updatedAt: now(),
      })
      return mapSolution(docData(await readBack(ref)))
    },

    async updateSolution(userId: string, solutionId: string, input: UpdateSolutionInput): Promise<Solution> {
      const ref = docRef(userId, "solutions", solutionId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.engagementId !== undefined) updates.engagementId = input.engagementId
      if (input.name !== undefined) updates.name = input.name.trim()
      if (input.status !== undefined) updates.status = input.status
      if (input.kind !== undefined) updates.kind = input.kind
      if (input.target !== undefined) updates.target = input.target
      if (input.steps !== undefined) updates.steps = input.steps
      if (input.domain !== undefined) updates.domain = input.domain
      if (input.stack !== undefined) updates.stack = input.stack
      // One field path per section named, so the others stay as stored.
      for (const { key } of SOLUTION_SECTIONS) {
        if (input.sections?.[key] !== undefined) updates[`sections.${key}`] = input.sections[key]
      }
      if (input.entities !== undefined) updates.entities = input.entities
      if (input.relations !== undefined) updates.relations = input.relations
      await updateDoc(ref, updates)
      return mapSolution(docData(await readBack(ref)))
    },

    async deleteSolution(userId: string, solutionId: string): Promise<void> {
      await deleteDoc(docRef(userId, "solutions", solutionId))
    },

    // The rent module's slice: it takes our helpers instead of importing the SDK.
    ...createFirebaseRent({ col, docRef, now, getDocs, readBack, addDoc, updateDoc, toDate, isPermissionDenied }),

    // ── Collaborators ───────────────────────────────────────────────────────

    async getCollaborators(userId: string): Promise<Collaborator[]> {
      try {
        const snap = await getDocs(col(userId, "collaborators"))
        return snap.docs.map((d) => mapCollaborator(docData(d))).sort(byActiveThenName)
      } catch (err) {
        // A bundle deployed before the rules still renders.
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    // Every field, null included: the rules require each one to be present.
    async createCollaborator(userId: string, input: CreateCollaboratorInput): Promise<Collaborator> {
      const ref = await addDoc(col(userId, "collaborators"), {
        userId,
        ...collaboratorFields(input),
        createdAt: now(),
        updatedAt: now(),
      })
      return mapCollaborator(docData(await readBack(ref)))
    },

    async updateCollaborator(userId: string, collaboratorId: string, input: UpdateCollaboratorInput): Promise<Collaborator> {
      const ref = docRef(userId, "collaborators", collaboratorId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.name !== undefined) updates.name = input.name.trim()
      if (input.type !== undefined) updates.type = input.type
      if (input.notes !== undefined) updates.notes = input.notes?.trim() || null
      if (input.isActive !== undefined) updates.isActive = input.isActive
      if (input.fee !== undefined) {
        updates.fee = input.fee && { ...input.fee, changes: [...input.fee.changes].sort((a, b) => a.from.localeCompare(b.from)) }
      }
      await updateDoc(ref, updates)
      return mapCollaborator(docData(await readBack(ref)))
    },

    async deleteCollaborator(userId: string, collaboratorId: string): Promise<void> {
      const logged = await getDocs(query(col(userId, "timecards"), where("collaboratorId", "==", collaboratorId), limit(1)))
      if (!logged.empty) throw new Error(COLLABORATOR_HAS_DAYS)
      const mine = await getDocs(query(col(userId, "collaborator_assignments"), where("collaboratorId", "==", collaboratorId)))
      await commitInChunks(
        [...mine.docs.map((d) => d.ref), docRef(userId, "collaborators", collaboratorId)],
        (batch, ref) => batch.delete(ref),
      )
    },

    // ── Assignments (a collaborator's days on a contract) ───────────────────

    async getAssignments(userId: string): Promise<Assignment[]> {
      try {
        const snap = await getDocs(col(userId, "collaborator_assignments"))
        return snap.docs.map((d) => mapAssignment(docData(d)))
      } catch (err) {
        // A bundle deployed before the rules still renders.
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    // Every field, null included: the rules require each one to be present.
    async createAssignment(userId: string, input: CreateAssignmentInput): Promise<Assignment> {
      // The id is the pair, so a second one is the same document: refuse it before it overwrites.
      // ponytail: read then write is not atomic; the owner is the only writer, a transaction if that changes.
      const ref = docRef(userId, "collaborator_assignments", assignmentId(input.collaboratorId, input.engagementId))
      if ((await getDoc(ref)).exists()) throw new Error(ASSIGNMENT_EXISTS)
      await setDoc(ref, {
        userId,
        ...assignmentFields(input),
        createdAt: now(),
        updatedAt: now(),
      })
      return mapAssignment(docData(await readBack(ref)))
    },

    async updateAssignment(userId: string, assignmentId: string, input: UpdateAssignmentInput): Promise<Assignment> {
      const ref = docRef(userId, "collaborator_assignments", assignmentId)
      const prev = mapAssignment(docData(await readBack(ref)))
      const { dailyRate, from, until, defaultDays, monthDays } = assignmentFields(prev, input)
      await updateDoc(ref, { dailyRate, from, until, defaultDays, monthDays, updatedAt: now() })
      return mapAssignment(docData(await readBack(ref)))
    },

    async deleteAssignment(userId: string, assignmentId: string): Promise<void> {
      const ref = docRef(userId, "collaborator_assignments", assignmentId)
      const snap = await getDoc(ref)
      if (!snap.exists()) return
      const { collaboratorId, engagementId } = snap.data()
      const logged = await getDocs(
        query(col(userId, "timecards"), where("collaboratorId", "==", collaboratorId), where("engagementId", "==", engagementId), limit(1)),
      )
      if (!logged.empty) throw new Error(ASSIGNMENT_HAS_DAYS)
      await deleteDoc(ref)
    },

    // ── Invoices (a customer's record of issued paper) ────────────────────

    async getInvoices(userId: string): Promise<Invoice[]> {
      try {
        const snap = await getDocs(col(userId, "invoices"))
        return snap.docs.map((d) => mapInvoice(docData(d)))
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async createInvoice(userId: string, input: CreateInvoiceInput): Promise<Invoice> {
      const ref = await addDoc(col(userId, "invoices"), {
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
        file: fileDoc(input.file ?? null),
        createdAt: now(),
        updatedAt: now(),
      })
      const snap = await readBack(ref)
      return mapInvoice(docData(snap))
    },

    async updateInvoice(userId: string, invoiceId: string, input: UpdateInvoiceInput): Promise<Invoice> {
      const ref = docRef(userId, "invoices", invoiceId)
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
      if (input.file !== undefined) updates.file = fileDoc(input.file)
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapInvoice(docData(snap))
    },

    async deleteInvoice(userId: string, invoiceId: string): Promise<void> {
      const ref = docRef(userId, "invoices", invoiceId)
      const file = (await getDoc(ref)).data()?.file
      await deleteDoc(ref)
      await removeObjectsOf([file])
    },

    // ── Company Deadlines ───────────────────────────────────────────────────

    async getCompanyDeadlines(userId: string): Promise<CompanyDeadline[]> {
      try {
        const snap = await getDocs(query(col(userId, "company_deadlines"), orderBy("date", "asc")))
        return snap.docs.map((d) => mapCompanyDeadline(docData(d)))
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async createCompanyDeadline(userId: string, input: CreateCompanyDeadlineInput): Promise<CompanyDeadline> {
      const ref = await addDoc(col(userId, "company_deadlines"), {
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
      const snap = await readBack(ref)
      return mapCompanyDeadline(docData(snap))
    },

    async updateCompanyDeadline(userId: string, deadlineId: string, input: UpdateCompanyDeadlineInput): Promise<CompanyDeadline> {
      const ref = docRef(userId, "company_deadlines", deadlineId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.title !== undefined) updates.title = input.title
      if (input.date !== undefined) updates.date = Timestamp.fromDate(input.date)
      if (input.kind !== undefined) updates.kind = input.kind
      if (input.amount !== undefined) updates.amount = input.amount
      if (input.notes !== undefined) updates.notes = input.notes
      if (input.isDone !== undefined) updates.isDone = input.isDone
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapCompanyDeadline(docData(snap))
    },

    async deleteCompanyDeadline(userId: string, deadlineId: string): Promise<void> {
      await deleteDoc(docRef(userId, "company_deadlines", deadlineId))
    },

    // ── Allocations ─────────────────────────────────────────────────────────

    async getAllocations(userId: string): Promise<Allocation[]> {
      try {
        const snap = await getDocs(query(col(userId, "allocations"), orderBy("yearMonth", "asc")))
        return snap.docs.map((d) => mapAllocation(docData(d)))
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async createAllocation(userId: string, input: CreateAllocationInput): Promise<Allocation> {
      const ref = await addDoc(col(userId, "allocations"), {
        userId,
        engagementId: input.engagementId,
        yearMonth: input.yearMonth,
        days: input.days,
        createdAt: now(),
        updatedAt: now(),
      })
      const snap = await readBack(ref)
      return mapAllocation(docData(snap))
    },

    async updateAllocation(userId: string, allocationId: string, input: UpdateAllocationInput): Promise<Allocation> {
      const ref = docRef(userId, "allocations", allocationId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.days !== undefined) updates.days = input.days
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapAllocation(docData(snap))
    },

    async deleteAllocation(userId: string, allocationId: string): Promise<void> {
      await deleteDoc(docRef(userId, "allocations", allocationId))
    },
  }
}

export function createFirebaseAdapter(): BackendAdapter {
  return {
    auth: createFirebaseAuthAdapter(),
    db: createFirebaseDbAdapter(),
    files: createFirebaseFilesAdapter(),
  }
}
