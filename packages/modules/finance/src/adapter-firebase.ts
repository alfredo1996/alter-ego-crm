
import { advanceDate } from "@alter-ego/kernel/dates"
import { format, differenceInCalendarMonths } from "date-fns"
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
  increment,
  query,
  where,
  and,
  or,
  orderBy,
  limit,
  getCountFromServer,
  documentId,
  runTransaction,
  serverTimestamp,
  writeBatch,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QueryDocumentSnapshot,
  type QueryFilterConstraint,
  type Firestore,
  type WriteBatch,
} from "firebase/firestore"

import {
  ACCOUNT_HAS_TRANSACTIONS,
  assertArchivable,
  assertLedgerValid,
  txBelongsToAccount,
  balanceEffects,
  balanceEffectsDiff,
} from "./lib/account-ledger"
import { calculateMortgage } from "./lib/amortization"
import { mergeCategoryCopies } from "./lib/categories"
import { normalizeDescription } from "./lib/merchants"
import {
  afterCreate,
  afterUpdate,
  monthBounds,
  monthKeysBetween,
  totalsDelta,
  totalsFromTransactions,
  type CountedTransaction,
} from "./lib/monthly-totals"
import { encodeLoanNote } from "./lib/mortgage"
import { netWorthTotals } from "./lib/net-worth"
import { accumulateCategorySpending } from "./lib/splits"

import type { FinanceAdapter } from "./adapter"
import type {
  MonthlyTotal,
  MonthlyTotals,
  Account,
  Transaction,
  TransactionSplit,
  Category,
  Budget,
  RecurringTransaction,
  SavingsGoal,
  NetWorthSnapshot,
  Tag,
  CategorizationRule,
  LoanRecurringMeta,
  CreateAccountInput,
  UpdateAccountInput,
  CreateTransactionInput,
  UpdateTransactionInput,
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateBudgetInput,
  UpdateBudgetInput,
  CreateRecurringTransactionInput,
  UpdateRecurringTransactionInput,
  CreateSavingsGoalInput,
  UpdateSavingsGoalInput,
  CreateTagInput,
  CreateCategorizationRuleInput,
  TransactionFilters,
  DashboardData,
  ReportData,
  PaginatedResult,
  AccountType,
  AccountKind,
  TransactionType,
  Currency,
  CategoryGroup,
  BudgetPeriod,
  RecurringFrequency,
  DismissedSubscriptionPattern,
  CreateDismissedSubscriptionPatternInput,
  TransactionStatus,
} from "./types"

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
export function plainOffline(err: unknown): never {
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

function docData(snap: DocumentSnapshot | QueryDocumentSnapshot): DocumentData & { id: string } {
  return { id: snap.id, ...(snap.data() ?? {}) }
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapAccount(d: DocumentData & { id: string }): Account {
  return {
    id: d.id,
    userId: d.userId as string,
    name: d.name as string,
    type: d.type as AccountType,
    kind: (d.kind as AccountKind | null) ?? null,
    currency: d.currency as Currency,
    balance: Number(d.balance),
    openingBalance: Number(d.openingBalance ?? d.balance ?? 0),
    icon: (d.icon as string | null) ?? null,
    color: (d.color as string | null) ?? null,
    isArchived: Boolean(d.isArchived),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapTransaction(d: DocumentData & { id: string }): Transaction {
  return {
    id: d.id,
    userId: d.userId as string,
    accountId: d.accountId as string,
    type: d.type as TransactionType,
    amount: Number(d.amount),
    currency: d.currency as Currency,
    categoryId: (d.categoryId as string | null) ?? null,
    description: d.description as string,
    rawDescription: (d.rawDescription as string | null) ?? null,
    date: toDate(d.date),
    notes: (d.notes as string | null) ?? null,
    tagIds: (d.tagIds as string[]) ?? [],
    splits: Array.isArray(d.splits)
      ? (d.splits as Array<Record<string, unknown>>).map((s): TransactionSplit => ({
          id: s.id as string,
          categoryId: s.categoryId as string,
          amount: Number(s.amount),
          note: (s.note as string | null) ?? null,
        }))
      : [],
    attachments: Array.isArray(d.attachments)
      ? (d.attachments as Array<Record<string, unknown>>).map((a) => ({
          id: a.id as string,
          fileName: a.fileName as string,
          mimeType: a.mimeType as string,
          url: a.url as string,
          size: Number(a.size ?? 0),
          uploadedAt: toDate(a.uploadedAt),
        }))
      : [],
    transferToAccountId: (d.transferToAccountId as string | null) ?? null,
    linkedTransactionId: (d.linkedTransactionId as string | null) ?? null,
    status: (d.status as TransactionStatus) ?? "cleared",
    isRecurring: Boolean(d.isRecurring),
    importHash: (d.importHash as string | null) ?? null,
    excludeFromReports: (d.excludeFromReports as boolean) ?? false,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapCategory(d: DocumentData & { id: string }): Category {
  return {
    id: d.id,
    userId: (d.userId as string | null) ?? null,
    name: d.name as string,
    group: d.group as CategoryGroup,
    icon: d.icon as string,
    color: d.color as string,
    parentId: (d.parentId as string | null) ?? null,
    isDefault: Boolean(d.isDefault),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapBudget(d: DocumentData & { id: string }): Budget {
  return {
    id: d.id,
    userId: d.userId as string,
    name: d.name as string,
    categoryId: (d.categoryId as string | null) ?? null,
    amount: Number(d.amount),
    currency: d.currency as Currency,
    period: d.period as BudgetPeriod,
    rolloverMode: (d.rolloverMode as Budget["rolloverMode"]) ?? "reset",
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapSavingsGoal(d: DocumentData & { id: string }): SavingsGoal {
  return {
    id: d.id,
    userId: d.userId as string,
    name: d.name as string,
    targetAmount: Number(d.targetAmount),
    currentAmount: Number(d.currentAmount),
    currency: d.currency as Currency,
    targetDate: toOptionalDate(d.targetDate),
    icon: d.icon as string,
    color: d.color as string,
    isCompleted: Boolean(d.isCompleted),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapRecurringTransaction(d: DocumentData & { id: string }): RecurringTransaction {
  return {
    id: d.id,
    userId: d.userId as string,
    accountId: d.accountId as string,
    type: d.type as "income" | "expense",
    amount: Number(d.amount),
    currency: d.currency as Currency,
    categoryId: (d.categoryId as string | null) ?? null,
    description: d.description as string,
    notes: (d.notes as string | null) ?? null,
    frequency: d.frequency as RecurringFrequency,
    interval: Number(d.interval),
    startDate: toDate(d.startDate),
    endDate: toOptionalDate(d.endDate),
    nextDueDate: toDate(d.nextDueDate),
    isActive: Boolean(d.isActive),
    loanMeta: (d.loanMeta as LoanRecurringMeta | null) ?? null,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

function mapNetWorthSnapshot(id: string, d: DocumentData): NetWorthSnapshot {
  return {
    id,
    userId: d.userId as string,
    date: toDate(d.date),
    totalAssets: Number(d.totalAssets),
    totalLiabilities: Number(d.totalLiabilities),
    netWorth: Number(d.netWorth),
  }
}

function mapTag(d: DocumentData & { id: string }): Tag {
  return {
    id: d.id,
    userId: d.userId as string,
    name: d.name as string,
    color: d.color as string,
    createdAt: toDate(d.createdAt),
  }
}

function mapCategorizationRule(d: DocumentData & { id: string }): CategorizationRule {
  return {
    id: d.id,
    userId: d.userId as string,
    pattern: d.pattern as string,
    categoryId: d.categoryId as string,
    displayAs: (d.displayAs as string | null) ?? null,
    isActive: Boolean(d.isActive),
    createdAt: toDate(d.createdAt),
  }
}

function mapDismissedSubscriptionPattern(
  d: DocumentData & { id: string },
): DismissedSubscriptionPattern {
  return {
    id: d.id,
    userId: d.userId as string,
    patternKey: d.patternKey as string,
    dismissedAt: toDate(d.dismissedAt),
  }
}

// ─── Adapter factories ────────────────────────────────────────────────────────

// Applies one write to every ref. A writeBatch holds at most 500 writes; the
// batches commit in parallel, far faster than one round trip per document.
async function commitInChunks(
  db: Firestore,
  refs: DocumentReference<unknown>[],
  write: (batch: WriteBatch, ref: DocumentReference<unknown>) => void
): Promise<void> {
  const commits: Promise<void>[] = []
  for (let i = 0; i < refs.length; i += 500) {
    const batch = writeBatch(db)
    for (const ref of refs.slice(i, i + 500)) write(batch, ref)
    commits.push(batch.commit())
  }
  await Promise.all(commits)
}

// Deletes every document the queries return, in chunks.
async function deleteAllDocs(db: Firestore, ...queries: Parameters<typeof getDocs>[0][]): Promise<void> {
  const snaps = await Promise.all(queries.map((q) => getDocs(q)))
  await commitInChunks(db, snaps.flatMap((s) => s.docs.map((d) => d.ref)), (batch, ref) => batch.delete(ref))
}

/**
 * The finance half of the Firestore adapter. The host passes the SDK instance in (a getter, read on
 * every call so the emulator can be wired after the adapter is built); this file imports no app code.
 */
export function createFirebaseFinance(getDb: () => Firestore): FinanceAdapter {
  // Helper: user-scoped collection ref
  const col = (userId: string, ...segments: string[]) => {
    const db = getDb()
    const path = `users/${userId}/${segments.join("/")}`
    return collection(db, path)
  }

  const docRef = (userId: string, colName: string, docId: string) => {
    const db = getDb()
    return doc(db, `users/${userId}/${colName}/${docId}`)
  }

  const now = () => serverTimestamp()

  // Moves the month totals by what `before` becoming `after` changes. Staged in the same
  // batch as the transaction write, so the totals never see half of a change. `n` counts
  // the writes: the lazy fill uses it to notice a write that landed while it computed.
  // increment() makes parallel writers (the importer's batches) add up instead of overwrite.
  const stageTotals = (
    batch: WriteBatch,
    userId: string,
    before: CountedTransaction | null,
    after: CountedTransaction | null,
  ) => {
    for (const [month, d] of totalsDelta(before, after)) {
      batch.set(
        docRef(userId, "monthly_totals", month),
        {
          total: increment(d.total),
          // an empty map in a merge write REPLACES the stored one, so leave the key out
          ...(Object.keys(d.byCategory).length > 0 && {
            expenseByCategory: Object.fromEntries(Object.entries(d.byCategory).map(([c, v]) => [c, increment(v)])),
          }),
          n: increment(1),
        },
        { merge: true },
      )
    }
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

  function isFailedPrecondition(err: unknown): boolean {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "failed-precondition"
    )
  }

  /**
   * Pages on the server: Firestore applies every filter it has a form for, counts the
   * matches with an aggregation (one read per thousand rows, not one per row) and
   * returns only the page. The filters it has no form for (search, amounts, tags, note,
   * status, uncategorized) still read every match and page in memory.
   *
   * accountServerSide: the account filter as an `or` over source and destination
   * (txBelongsToAccount), which needs an index per branch; false keeps it in memory.
   */
  async function fetchTransactions(
    userId: string,
    f: TransactionFilters,
    accountServerSide: boolean,
  ): Promise<PaginatedResult<Transaction>> {
    const parts: QueryFilterConstraint[] = []
    if (f.accountId && accountServerSide) {
      parts.push(or(where("accountId", "==", f.accountId), where("transferToAccountId", "==", f.accountId)))
    }
    if (f.type) parts.push(where("type", "==", f.type))
    if (f.categoryId) parts.push(where("categoryId", "==", f.categoryId))
    if (f.dateFrom) parts.push(where("date", ">=", Timestamp.fromDate(f.dateFrom)))
    if (f.dateTo) parts.push(where("date", "<=", Timestamp.fromDate(f.dateTo)))
    const base = parts.length
      ? query(col(userId, "transactions"), and(...parts), orderBy("date", "desc"))
      : query(col(userId, "transactions"), orderBy("date", "desc"))

    const inMemory =
      (f.accountId && !accountServerSide) ||
      f.minAmount != null ||
      f.maxAmount != null ||
      !!f.uncategorized ||
      !!f.hasNote ||
      !!f.tagIds?.length ||
      !!f.status ||
      !!f.search
    const offset = f.offset ?? 0
    const paged = f.limit != null && !inMemory

    let total: number | undefined
    let snap
    if (paged) {
      // ponytail: the web SDK has no offset(), so page N reads offset+limit rows. Paging
      // is prev/next only, so that stays small; cursors if deep pages ever matter.
      ;[snap, total] = await Promise.all([
        getDocs(query(base, limit(offset + f.limit!))),
        f.skipCount ? undefined : getCountFromServer(base).catch(plainOffline).then((c) => c.data().count),
      ])
    } else {
      snap = await getDocs(base)
    }
    let txs = snap.docs.map((d) => mapTransaction(docData(d)))

    // Incoming transfers count for the destination account. Re-applied after the `or`
    // too: it drops a non-transfer row that kept a stray destination.
    if (f.accountId) txs = txs.filter((t) => txBelongsToAccount(t, f.accountId!))

    if (f.minAmount != null) txs = txs.filter((t) => t.amount >= f.minAmount!)
    if (f.maxAmount != null) txs = txs.filter((t) => t.amount <= f.maxAmount!)
    // A split transaction is filed on its splits, so it is not uncategorized.
    if (f.uncategorized) txs = txs.filter((t) => t.categoryId == null && t.splits.length === 0)
    if (f.hasNote) txs = txs.filter((t) => !!t.notes)
    if (f.tagIds?.length) txs = txs.filter((t) => f.tagIds!.some((id) => t.tagIds.includes(id)))
    if (f.status) txs = txs.filter((t) => t.status === f.status)
    if (f.search) {
      const term = f.search.toLowerCase()
      txs = txs.filter(
        (t) =>
          t.description.toLowerCase().includes(term) ||
          t.rawDescription?.toLowerCase().includes(term) ||
          t.notes?.toLowerCase().includes(term),
      )
    }

    // The page is cut in Firestore's order (date, then document id), which is stable
    // across pages: no row repeats or goes missing. Only then is it sorted for display,
    // newest date first and most-recently-created next, since same-date rows (date-only
    // bulk imports) read as "random" in id order. Same-date rows on either side of a
    // page boundary keep id order; sorting before the cut would move rows between pages.
    // In memory (every match read) the whole list is sorted first, as the mock and admin
    // adapters do, so the three page the same way.
    const byDateThenCreated = (a: Transaction, b: Transaction) =>
      b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime()
    if (!paged) txs.sort(byDateThenCreated)
    total ??= txs.length
    const pageSize = f.limit ?? txs.length
    const data = txs.slice(offset, offset + pageSize)
    if (paged) data.sort(byDateThenCreated)
    return { data, total, limit: pageSize, offset }
  }

  // Computes a month's totals from its transactions and stores them, once. `seenWrites` is
  // the month document's write count when the caller read it (0 = no document). The store is
  // a transaction that checks the count is still that: a write that landed while we computed
  // is not in our sum, and writing over it would lose it, so we compute again. If the store
  // keeps losing or fails, the answer is still right for this read, just not kept.
  async function fillMonth(userId: string, month: string, seenWrites: number): Promise<MonthlyTotal> {
    const ref = docRef(userId, "monthly_totals", month)
    const { start, end } = monthBounds(month)
    let seen = seenWrites
    let totals: MonthlyTotal = { total: 0, expenseByCategory: {} }
    for (let attempt = 0; attempt < 3; attempt++) {
      totals = totalsFromTransactions((await fetchTransactions(userId, { dateFrom: start, dateTo: end }, true)).data)
      try {
        const kept = await runTransaction(getDb(), async (t) => {
          const current = (await t.get(ref)).data()
          if (current?.ready === true) return current as MonthlyTotal
          if ((current?.n ?? 0) !== seen) {
            seen = current?.n ?? 0
            return null
          }
          t.set(ref, { ...totals, n: seen, ready: true })
          return totals
        })
        if (kept) return { total: kept.total ?? 0, expenseByCategory: kept.expenseByCategory ?? {} }
      } catch (err) {
        console.warn("getMonthlyTotals: could not store the totals of", month, err)
        return totals
      }
    }
    return totals
  }

  return {

    async getAccounts(userId: string): Promise<Account[]> {
      try {
        const snap = await getDocs(col(userId, "accounts"))
        return snap.docs.map((d) => mapAccount(docData(d))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async getAccount(userId: string, accountId: string): Promise<Account | null> {
      try {
        const snap = await getDoc(docRef(userId, "accounts", accountId))
        if (!snap.exists()) return null
        return mapAccount(docData(snap))
      } catch (err) {
        if (isPermissionDenied(err)) return null
        throw err
      }
    },

    async createAccount(userId: string, input: CreateAccountInput): Promise<Account> {
      const ref = await addDoc(col(userId, "accounts"), {
        userId,
        name: input.name,
        type: input.type,
        kind: input.kind ?? null,
        currency: input.currency,
        balance: input.balance,
        openingBalance: input.balance,
        icon: input.icon ?? null,
        color: input.color ?? null,
        isArchived: false,
        createdAt: now(),
        updatedAt: now(),
      })
      const snap = await readBack(ref)
      return mapAccount(docData(snap))
    },

    async updateAccount(userId: string, accountId: string, input: UpdateAccountInput): Promise<Account> {
      const ref = docRef(userId, "accounts", accountId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.name !== undefined) updates.name = input.name
      if (input.type !== undefined) updates.type = input.type
      if (input.kind !== undefined) updates.kind = input.kind
      if (input.currency !== undefined) updates.currency = input.currency
      // Both checks below need the stored account; one read serves them.
      const existing = input.balance !== undefined || input.isArchived ? mapAccount(docData(await getDoc(ref))) : null
      if (existing) assertArchivable(existing, input)
      if (input.balance !== undefined && existing) {
        // A `balance` edit sets the OPENING balance; keep current balance
        // consistent by preserving the existing transaction delta.
        const txnDelta = existing.balance - existing.openingBalance
        updates.openingBalance = input.balance
        updates.balance = input.balance + txnDelta
      }
      if (input.icon !== undefined) updates.icon = input.icon
      if (input.color !== undefined) updates.color = input.color
      if (input.isArchived !== undefined) updates.isArchived = input.isArchived
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapAccount(docData(snap))
    },

    async deleteAccount(userId: string, accountId: string): Promise<void> {
      // One row is enough to refuse; the account filter counts incoming transfers too.
      const { total } = await this.getTransactions(userId, { accountId, limit: 1 })
      if (total > 0) throw new Error(ACCOUNT_HAS_TRANSACTIONS)
      await deleteDoc(docRef(userId, "accounts", accountId))
    },

    async getLastActivity(userId: string, accountIds: string[]): Promise<Record<string, Date | null>> {
      try {
        const dates = await Promise.all(
          accountIds.map(async (id) => {
            const snap = await getDocs(
              query(
                col(userId, "transactions"),
                or(where("accountId", "==", id), and(where("transferToAccountId", "==", id), where("type", "==", "transfer"))),
                orderBy("date", "desc"),
                limit(1),
              ),
            )
            return [id, snap.docs[0] ? mapTransaction(docData(snap.docs[0])).date : null] as const
          }),
        )
        return Object.fromEntries(dates)
      } catch (err) {
        if (isPermissionDenied(err)) return {}
        throw err
      }
    },

    async getTransactions(userId: string, filters?: TransactionFilters): Promise<PaginatedResult<Transaction>> {
      try {
        return await fetchTransactions(userId, filters ?? {}, true)
      } catch (err) {
        if (isPermissionDenied(err)) return { data: [], total: 0, limit: 0, offset: 0 }
        // A filter combination without its composite index: answer the old way (every
        // row, filtered here) and say which index is missing instead of breaking the page.
        if (isFailedPrecondition(err) && filters?.accountId) {
          console.warn("getTransactions: missing Firestore index, reading the account in memory.", err)
          return fetchTransactions(userId, filters, false)
        }
        throw err
      }
    },

    async getTransaction(userId: string, transactionId: string): Promise<Transaction | null> {
      try {
        const snap = await getDoc(docRef(userId, "transactions", transactionId))
        if (!snap.exists()) return null
        return mapTransaction(docData(snap))
      } catch (err) {
        if (isPermissionDenied(err)) return null
        throw err
      }
    },

    async createTransaction(userId: string, input: CreateTransactionInput): Promise<Transaction> {
      assertLedgerValid({
        type: input.type,
        amount: input.amount,
        accountId: input.accountId,
        transferToAccountId: input.transferToAccountId ?? null,
      })
      const baseData = {
        userId,
        type: input.type,
        amount: input.amount,
        currency: input.currency,
        categoryId: input.categoryId ?? null,
        description: input.description,
        rawDescription: input.rawDescription ?? null,
        date: Timestamp.fromDate(input.date),
        notes: input.notes ?? null,
        tagIds: input.tagIds ?? [],
        splits: (input.splits ?? []).map((s) => ({
          id: s.id,
          categoryId: s.categoryId,
          amount: s.amount,
          note: s.note ?? null,
        })),
        attachments: [],
        status: input.status ?? "cleared",
        isRecurring: input.isRecurring ?? false,
        importHash: input.importHash ?? null,
        excludeFromReports: input.excludeFromReports ?? false,
        createdAt: now(),
        updatedAt: now(),
      }

      // Standard transaction (single row, including transfers), with its share of the
      // month totals in the same batch.
      const ref = doc(col(userId, "transactions"))
      const batch = writeBatch(getDb())
      batch.set(ref, {
        ...baseData,
        accountId: input.accountId,
        transferToAccountId: input.transferToAccountId ?? null,
        linkedTransactionId: input.linkedTransactionId ?? null,
      })
      stageTotals(batch, userId, null, afterCreate(input))
      await batch.commit()
      // Atomically apply the balance effects to every affected account (source,
      // plus the destination for a transfer). increment() is race-safe under the
      // parallel batches the importer runs.
      const effects = balanceEffects({
        type: input.type,
        amount: input.amount,
        accountId: input.accountId,
        transferToAccountId: input.transferToAccountId ?? null,
      })
      await Promise.all(
        effects.map((e) =>
          updateDoc(docRef(userId, "accounts", e.accountId), {
            balance: increment(e.delta),
            updatedAt: now(),
          }),
        ),
      )
      const snap = await readBack(ref)
      return mapTransaction(docData(snap))
    },

    async updateTransaction(userId: string, transactionId: string, input: UpdateTransactionInput): Promise<Transaction> {
      const ref = docRef(userId, "transactions", transactionId)
      const oldSnap = await getDoc(ref)
      if (!oldSnap.exists()) throw new Error(`Transaction ${transactionId} not found`)
      const oldTx = mapTransaction(docData(oldSnap))
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.accountId !== undefined) updates.accountId = input.accountId
      if (input.type !== undefined) updates.type = input.type
      if (input.amount !== undefined) updates.amount = input.amount
      if (input.currency !== undefined) updates.currency = input.currency
      if (input.categoryId !== undefined) updates.categoryId = input.categoryId
      if (input.description !== undefined) updates.description = input.description
      if (input.date !== undefined) updates.date = Timestamp.fromDate(input.date)
      if (input.notes !== undefined) updates.notes = input.notes
      if (input.tagIds !== undefined) updates.tagIds = input.tagIds
      if (input.splits !== undefined) updates.splits = input.splits.map((s) => ({
        id: s.id,
        categoryId: s.categoryId,
        amount: s.amount,
        note: s.note ?? null,
      }))
      if (input.transferToAccountId !== undefined) updates.transferToAccountId = input.transferToAccountId
      if (input.linkedTransactionId !== undefined) updates.linkedTransactionId = input.linkedTransactionId
      if (input.status !== undefined) updates.status = input.status
      if (input.isRecurring !== undefined) updates.isRecurring = input.isRecurring
      if (input.excludeFromReports !== undefined) updates.excludeFromReports = input.excludeFromReports
      // Apply the net balance change (reverse old, apply new) atomically.
      const newLedger = {
        type: input.type ?? oldTx.type,
        amount: input.amount ?? oldTx.amount,
        accountId: input.accountId ?? oldTx.accountId,
        transferToAccountId:
          input.transferToAccountId !== undefined ? input.transferToAccountId : oldTx.transferToAccountId,
      }
      assertLedgerValid(newLedger)
      const batch = writeBatch(getDb())
      batch.update(ref, updates)
      stageTotals(batch, userId, oldTx, afterUpdate(oldTx, input))
      await batch.commit()
      await Promise.all(
        balanceEffectsDiff(oldTx, newLedger).map((e) =>
          updateDoc(docRef(userId, "accounts", e.accountId), {
            balance: increment(e.delta),
            updatedAt: now(),
          }),
        ),
      )
      const snap = await readBack(ref)
      return mapTransaction(docData(snap))
    },

    async deleteTransaction(userId: string, transactionId: string): Promise<void> {
      // ponytail: the totals delta comes from a read outside the batch, so two concurrent deletes of one row
      // both subtract (as account balances already do). Upgrade: runTransaction around read + delete.
      const ref = docRef(userId, "transactions", transactionId)
      const snap = await getDoc(ref)
      if (!snap.exists()) return
      const tx = mapTransaction(docData(snap))
      // Reverse the transaction's balance effects atomically, then delete.
      await Promise.all(
        balanceEffects(tx).map((e) =>
          updateDoc(docRef(userId, "accounts", e.accountId), {
            balance: increment(-e.delta),
            updatedAt: now(),
          }),
        ),
      )
      const batch = writeBatch(getDb())
      batch.delete(ref)
      stageTotals(batch, userId, tx, null)
      await batch.commit()
    },

    async deleteTransactions(userId: string, transactionIds: string[]): Promise<void> {
      await Promise.all(
        transactionIds.map((id) => this.deleteTransaction(userId, id)),
      )
    },

    async deleteAllTransactions(userId: string): Promise<void> {
      await deleteAllDocs(getDb(), col(userId, "transactions"), col(userId, "monthly_totals"))
    },

    async getMonthlyTotals(userId: string, fromMonth: string, toMonth: string): Promise<MonthlyTotals> {
      const snap = await getDocs(
        query(col(userId, "monthly_totals"), where(documentId(), ">=", fromMonth), where(documentId(), "<=", toMonth)),
      )
      const result: MonthlyTotals = {}
      // Writes seen on a month that is not complete yet: the fill below must not overwrite them.
      const seen = new Map<string, number>()
      for (const d of snap.docs) {
        const data = d.data()
        if (data.ready === true) {
          result[d.id] = { total: data.total ?? 0, expenseByCategory: data.expenseByCategory ?? {} }
        } else {
          seen.set(d.id, data.n ?? 0)
        }
      }
      await Promise.all(
        monthKeysBetween(fromMonth, toMonth)
          .filter((month) => !result[month])
          .map(async (month) => {
            result[month] = await fillMonth(userId, month, seen.get(month) ?? 0)
          }),
      )
      return result
    },

    async deleteAllAccountData(userId: string): Promise<void> {
      await deleteAllDocs(
        getDb(),
        col(userId, "accounts"),
        col(userId, "transactions"),
        col(userId, "monthly_totals"),
        col(userId, "recurring"),
        col(userId, "account_balance_snapshots"),
        col(userId, "net_worth_snapshots"),
      )
    },

    async getImportHashes(userId: string): Promise<string[]> {
      try {
        const snap = await getDocs(col(userId, "transactions"))
        return snap.docs
          .map((d) => docData(d).importHash as string | null)
          .filter((h): h is string => !!h)
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async recalculateBalances(userId: string): Promise<void> {
      const allTxs = (await this.getTransactions(userId)).data
      const userAccounts = await this.getAccounts(userId)

      // Single-row transfers: account_id = source, transfer_to_account_id = dest.
      // Seed each account with its opening balance, then apply transaction effects.
      const balanceMap = new Map<string, number>()
      for (const acc of userAccounts) balanceMap.set(acc.id, acc.openingBalance)
      for (const tx of allTxs) {
        if (tx.type === "income") {
          balanceMap.set(tx.accountId, (balanceMap.get(tx.accountId) ?? 0) + tx.amount)
        } else if (tx.type === "expense") {
          balanceMap.set(tx.accountId, (balanceMap.get(tx.accountId) ?? 0) - tx.amount)
        } else if (tx.type === "transfer") {
          balanceMap.set(tx.accountId, (balanceMap.get(tx.accountId) ?? 0) - tx.amount)
          if (tx.transferToAccountId) {
            balanceMap.set(tx.transferToAccountId, (balanceMap.get(tx.transferToAccountId) ?? 0) + tx.amount)
          }
        }
      }

      const db = getDb()
      await Promise.all(
        userAccounts.map((account) => {
          const balance = balanceMap.get(account.id) ?? account.openingBalance
          return updateDoc(doc(db, "users", userId, "accounts", account.id), { balance })
        })
      )
    },

    async getCategories(userId: string): Promise<Category[]> {
      const db = getDb()
      const [defaultsSnap, customSnap] = await Promise.all([
        getDocs(collection(db, "categories")),
        getDocs(col(userId, "categories")),
      ])
      return mergeCategoryCopies(
        defaultsSnap.docs.map((d) => mapCategory(docData(d))),
        customSnap.docs.map((d) => mapCategory(docData(d)))
      )
    },

    async getCategory(userId: string, categoryId: string): Promise<Category | null> {
      const db = getDb()
      // Check user categories first, then defaults
      const userSnap = await getDoc(docRef(userId, "categories", categoryId))
      const defaultSnap = await getDoc(doc(db, `categories/${categoryId}`))
      if (userSnap.exists()) {
        const mine = mapCategory(docData(userSnap))
        return defaultSnap.exists() ? { ...mine, isDefault: true } : mine
      }
      if (defaultSnap.exists()) return mapCategory(docData(defaultSnap))
      return null
    },

    async createCategory(userId: string, input: CreateCategoryInput): Promise<Category> {
      const ref = await addDoc(col(userId, "categories"), {
        userId,
        name: input.name,
        group: input.group,
        icon: input.icon,
        color: input.color,
        parentId: input.parentId ?? null,
        isDefault: false,
        createdAt: now(),
        updatedAt: now(),
      })
      const snap = await readBack(ref)
      return mapCategory(docData(snap))
    },

    async updateCategory(userId: string, categoryId: string, input: UpdateCategoryInput): Promise<Category> {
      const ref = docRef(userId, "categories", categoryId)
      // A built-in with no copy yet: the edit creates the user's copy under the same id.
      if (!(await getDoc(ref)).exists()) {
        const builtIn = await getDoc(doc(getDb(), `categories/${categoryId}`))
        if (builtIn.exists()) {
          const base = mapCategory(docData(builtIn))
          await setDoc(ref, {
            userId,
            name: input.name ?? base.name,
            group: input.group ?? base.group,
            icon: input.icon ?? base.icon,
            color: input.color ?? base.color,
            parentId: input.parentId !== undefined ? input.parentId : base.parentId,
            isDefault: false, // the rules refuse true; reads mark a copy of a built-in as one
            createdAt: now(),
            updatedAt: now(),
          })
          return { ...mapCategory(docData(await readBack(ref))), isDefault: true }
        }
      }
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.name !== undefined) updates.name = input.name
      if (input.group !== undefined) updates.group = input.group
      if (input.icon !== undefined) updates.icon = input.icon
      if (input.color !== undefined) updates.color = input.color
      if (input.parentId !== undefined) updates.parentId = input.parentId
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      const updated = mapCategory(docData(snap))
      const builtIn = await getDoc(doc(getDb(), `categories/${categoryId}`))
      return builtIn.exists() ? { ...updated, isDefault: true } : updated
    },

    async deleteCategory(userId: string, categoryId: string): Promise<void> {
      await deleteDoc(docRef(userId, "categories", categoryId))
    },

    async deleteAllCategories(userId: string): Promise<void> {
      const snap = await getDocs(col(userId, "categories"))
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
    },

    async getBudgets(userId: string): Promise<Budget[]> {
      const snap = await getDocs(col(userId, "budgets"))
      return snap.docs.map((d) => mapBudget(docData(d))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    },

    async getBudget(userId: string, budgetId: string): Promise<Budget | null> {
      try {
        const snap = await getDoc(docRef(userId, "budgets", budgetId))
        if (!snap.exists()) return null
        return mapBudget(docData(snap))
      } catch (err) {
        if (isPermissionDenied(err)) return null
        throw err
      }
    },

    async createBudget(userId: string, input: CreateBudgetInput): Promise<Budget> {
      const ref = await addDoc(col(userId, "budgets"), {
        userId,
        name: input.name,
        categoryId: input.categoryId ?? null,
        amount: input.amount,
        currency: input.currency,
        period: input.period,
        rolloverMode: input.rolloverMode ?? "reset",
        createdAt: now(),
        updatedAt: now(),
      })
      const snap = await readBack(ref)
      return mapBudget(docData(snap))
    },

    async updateBudget(userId: string, budgetId: string, input: UpdateBudgetInput): Promise<Budget> {
      const ref = docRef(userId, "budgets", budgetId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.name !== undefined) updates.name = input.name
      if (input.categoryId !== undefined) updates.categoryId = input.categoryId
      if (input.amount !== undefined) updates.amount = input.amount
      if (input.currency !== undefined) updates.currency = input.currency
      if (input.period !== undefined) updates.period = input.period
      if (input.rolloverMode !== undefined) updates.rolloverMode = input.rolloverMode
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapBudget(docData(snap))
    },

    async deleteBudget(userId: string, budgetId: string): Promise<void> {
      await deleteDoc(docRef(userId, "budgets", budgetId))
    },

    async getSavingsGoals(userId: string): Promise<SavingsGoal[]> {
      const snap = await getDocs(col(userId, "savings_goals"))
      return snap.docs.map((d) => mapSavingsGoal(docData(d))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    },

    async getSavingsGoal(userId: string, goalId: string): Promise<SavingsGoal | null> {
      try {
        const snap = await getDoc(docRef(userId, "savings_goals", goalId))
        if (!snap.exists()) return null
        return mapSavingsGoal(docData(snap))
      } catch (err) {
        if (isPermissionDenied(err)) return null
        throw err
      }
    },

    async createSavingsGoal(userId: string, input: CreateSavingsGoalInput): Promise<SavingsGoal> {
      const ref = await addDoc(col(userId, "savings_goals"), {
        userId,
        name: input.name,
        targetAmount: input.targetAmount,
        currentAmount: 0,
        currency: input.currency,
        targetDate: input.targetDate ? Timestamp.fromDate(input.targetDate) : null,
        icon: input.icon ?? "🎯",
        color: input.color ?? "#6366f1",
        isCompleted: false,
        createdAt: now(),
        updatedAt: now(),
      })
      const snap = await readBack(ref)
      return mapSavingsGoal(docData(snap))
    },

    async updateSavingsGoal(userId: string, goalId: string, input: UpdateSavingsGoalInput): Promise<SavingsGoal> {
      const ref = docRef(userId, "savings_goals", goalId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.name !== undefined) updates.name = input.name
      if (input.targetAmount !== undefined) updates.targetAmount = input.targetAmount
      if (input.currentAmount !== undefined) updates.currentAmount = input.currentAmount
      if (input.currency !== undefined) updates.currency = input.currency
      if (input.targetDate !== undefined) updates.targetDate = input.targetDate ? Timestamp.fromDate(input.targetDate) : null
      if (input.icon !== undefined) updates.icon = input.icon
      if (input.color !== undefined) updates.color = input.color
      if (input.isCompleted !== undefined) updates.isCompleted = input.isCompleted
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapSavingsGoal(docData(snap))
    },

    async deleteSavingsGoal(userId: string, goalId: string): Promise<void> {
      await deleteDoc(docRef(userId, "savings_goals", goalId))
    },

    async getRecurringTransactions(userId: string): Promise<RecurringTransaction[]> {
      const q = query(col(userId, "recurring"), orderBy("nextDueDate", "asc"))
      const snap = await getDocs(q)
      return snap.docs.map((d) => mapRecurringTransaction(docData(d)))
    },

    async getRecurringTransaction(userId: string, recurringId: string): Promise<RecurringTransaction | null> {
      const snap = await getDoc(docRef(userId, "recurring", recurringId))
      if (!snap.exists()) return null
      return mapRecurringTransaction(docData(snap))
    },

    async createRecurringTransaction(userId: string, input: CreateRecurringTransactionInput): Promise<RecurringTransaction> {
      const ref = await addDoc(col(userId, "recurring"), {
        userId,
        accountId: input.accountId,
        type: input.type,
        amount: input.amount,
        currency: input.currency,
        categoryId: input.categoryId ?? null,
        description: input.description,
        notes: input.notes ?? null,
        frequency: input.frequency,
        interval: input.interval ?? 1,
        startDate: Timestamp.fromDate(input.startDate),
        endDate: input.endDate ? Timestamp.fromDate(input.endDate) : null,
        nextDueDate: Timestamp.fromDate(input.startDate),
        isActive: true,
        loanMeta: input.loanMeta ?? null,
        createdAt: now(),
        updatedAt: now(),
      })
      const snap = await readBack(ref)
      return mapRecurringTransaction(docData(snap))
    },

    async updateRecurringTransaction(userId: string, recurringId: string, input: UpdateRecurringTransactionInput): Promise<RecurringTransaction> {
      const ref = docRef(userId, "recurring", recurringId)
      const updates: Record<string, unknown> = { updatedAt: now() }
      if (input.accountId !== undefined) updates.accountId = input.accountId
      if (input.type !== undefined) updates.type = input.type
      if (input.amount !== undefined) updates.amount = input.amount
      if (input.currency !== undefined) updates.currency = input.currency
      if (input.categoryId !== undefined) updates.categoryId = input.categoryId
      if (input.description !== undefined) updates.description = input.description
      if (input.notes !== undefined) updates.notes = input.notes
      if (input.frequency !== undefined) updates.frequency = input.frequency
      if (input.interval !== undefined) updates.interval = input.interval
      if (input.startDate !== undefined) updates.startDate = Timestamp.fromDate(input.startDate)
      if (input.endDate !== undefined) updates.endDate = input.endDate ? Timestamp.fromDate(input.endDate) : null
      if (input.nextDueDate !== undefined) updates.nextDueDate = Timestamp.fromDate(input.nextDueDate)
      if (input.isActive !== undefined) updates.isActive = input.isActive
      if (input.loanMeta !== undefined) updates.loanMeta = input.loanMeta
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapRecurringTransaction(docData(snap))
    },

    async deleteRecurringTransaction(userId: string, recurringId: string): Promise<void> {
      await deleteDoc(docRef(userId, "recurring", recurringId))
    },

    async generateDue(userId: string, upToDate: Date): Promise<Transaction[]> {
      const rulesSnap = await getDocs(query(col(userId, "recurring"), where("isActive", "==", true)))
      const rules = rulesSnap.docs.map((d) => mapRecurringTransaction(docData(d)))
      const generated: Transaction[] = []

      for (const rule of rules) {
        let nextDue = new Date(rule.nextDueDate)

        while (nextDue <= upToDate) {
          if (rule.endDate && nextDue > rule.endDate) break

          const key = `${rule.id}:${format(nextDue, "yyyy-MM-dd")}`

          // Idempotency check
          const existingSnap = await getDocs(
            query(col(userId, "transactions"), where("linkedTransactionId", "==", key))
          )
          if (existingSnap.empty) {
            let txAmount = rule.amount
            let txNotes = rule.notes

            if (rule.loanMeta) {
              const monthsElapsed = differenceInCalendarMonths(nextDue, rule.startDate)
              const paymentIdx = rule.loanMeta.paymentStartMonth - 1 + monthsElapsed
              const schedule = calculateMortgage({
                homePrice: rule.loanMeta.loanAmount,
                downPayment: 0,
                annualRate: rule.loanMeta.annualRate,
                termYears: rule.loanMeta.termMonths / 12,
              })
              const row = schedule.amortization[paymentIdx]
              if (row) {
                txAmount = row.payment
                txNotes = encodeLoanNote({
                  loanId: rule.id,
                  paymentNumber: paymentIdx + 1,
                  principal: row.principal,
                  interest: row.interest,
                  remainingBalance: row.balance,
                })
              }
            }

            const tx = await this.createTransaction(userId, {
              accountId: rule.accountId,
              type: rule.type,
              amount: txAmount,
              currency: rule.currency,
              categoryId: rule.categoryId,
              description: rule.description,
              date: new Date(nextDue),
              notes: txNotes,
              isRecurring: true,
              linkedTransactionId: key,
            })
            generated.push(tx)
          }

          nextDue = advanceDate(nextDue, rule.frequency, rule.interval)
        }

        // Update nextDueDate on the rule
        await updateDoc(docRef(userId, "recurring", rule.id), {
          nextDueDate: Timestamp.fromDate(nextDue),
          updatedAt: now(),
        })
      }

      return generated
    },

    async getRecurringHistory(userId: string, recurringId: string): Promise<Transaction[]> {
      // Firestore doesn't support startsWith, so we use string range query
      const prefix = `${recurringId}:`
      const end = `${recurringId};` // ';' is next ASCII char after ':'
      const q = query(
        col(userId, "transactions"),
        where("linkedTransactionId", ">=", prefix),
        where("linkedTransactionId", "<", end),
        orderBy("linkedTransactionId"),
      )
      const snap = await getDocs(q)
      return snap.docs
        .map((d) => mapTransaction(docData(d)))
        .sort((a, b) => b.date.getTime() - a.date.getTime())
    },

    async takeSnapshot(userId: string): Promise<NetWorthSnapshot> {
      const db = getDb()
      const accounts = (await this.getAccounts(userId)).filter((a) => !a.isArchived)
      const { totalAssets, totalLiabilities, netWorth } = netWorthTotals(accounts)
      const dateStr = format(new Date(), "yyyy-MM-dd")
      const snapRef = doc(db, `users/${userId}/net_worth_snapshots/${dateStr}`)

      await setDoc(
        snapRef,
        { userId, date: Timestamp.fromDate(new Date(dateStr + "T00:00:00")), totalAssets, totalLiabilities, netWorth },
        { merge: true }
      )
      const snapDoc = await readBack(snapRef)
      return mapNetWorthSnapshot(dateStr, snapDoc.data()!)
    },

    async getNetWorthHistory(userId: string, months = 12): Promise<NetWorthSnapshot[]> {
      const cutoff = new Date()
      cutoff.setMonth(cutoff.getMonth() - months)
      const q = query(
        col(userId, "net_worth_snapshots"),
        where("date", ">=", Timestamp.fromDate(cutoff)),
        orderBy("date", "asc")
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => mapNetWorthSnapshot(d.id, d.data()))
    },

    async getNetWorthAt(userId: string, date: Date): Promise<NetWorthSnapshot | null> {
      const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
      const q = query(
        col(userId, "net_worth_snapshots"),
        where("date", "<=", Timestamp.fromDate(end)),
        orderBy("date", "desc"),
        limit(1)
      )
      const snap = await getDocs(q)
      return snap.empty ? null : mapNetWorthSnapshot(snap.docs[0].id, snap.docs[0].data())
    },

    async getTags(userId: string): Promise<Tag[]> {
      const snap = await getDocs(col(userId, "tags"))
      return snap.docs.map((d) => mapTag(docData(d))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    },

    async createTag(userId: string, input: CreateTagInput): Promise<Tag> {
      const ref = await addDoc(col(userId, "tags"), {
        userId,
        name: input.name,
        color: input.color ?? "#6366f1",
        createdAt: now(),
      })
      const snap = await readBack(ref)
      return mapTag(docData(snap))
    },

    async deleteTag(userId: string, tagId: string): Promise<void> {
      await deleteDoc(docRef(userId, "tags", tagId))
    },

    async getCategorizationRules(userId: string): Promise<CategorizationRule[]> {
      const snap = await getDocs(col(userId, "categorization_rules"))
      return snap.docs.map((d) => mapCategorizationRule(docData(d))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    },

    async createCategorizationRule(userId: string, input: CreateCategorizationRuleInput): Promise<CategorizationRule> {
      const ref = await addDoc(col(userId, "categorization_rules"), {
        userId,
        pattern: input.pattern,
        categoryId: input.categoryId,
        displayAs: input.displayAs ?? null,
        isActive: true,
        createdAt: now(),
      })
      const snap = await readBack(ref)
      return mapCategorizationRule(docData(snap))
    },

    async updateCategorizationRule(
      userId: string,
      ruleId: string,
      input: Partial<CreateCategorizationRuleInput & { isActive: boolean }>
    ): Promise<CategorizationRule> {
      const ref = docRef(userId, "categorization_rules", ruleId)
      const updates: Record<string, unknown> = {}
      if (input.pattern !== undefined) updates.pattern = input.pattern
      if (input.categoryId !== undefined) updates.categoryId = input.categoryId
      if (input.displayAs !== undefined) updates.displayAs = input.displayAs
      if (input.isActive !== undefined) updates.isActive = input.isActive
      await updateDoc(ref, updates)
      const snap = await readBack(ref)
      return mapCategorizationRule(docData(snap))
    },

    async deleteCategorizationRule(userId: string, ruleId: string): Promise<void> {
      await deleteDoc(docRef(userId, "categorization_rules", ruleId))
    },

    async applyCategorization(userId: string, description: string): Promise<string | null> {
      const rules = await this.getCategorizationRules(userId)
      const active = rules.filter((r) => r.isActive)
      const lower = description.toLowerCase()
      for (const rule of active) {
        if (lower.includes(rule.pattern.toLowerCase())) return rule.categoryId
      }
      return null
    },

    async renormalizeTransactions(userId: string): Promise<number> {
      const userRules = await this.getCategorizationRules(userId)
      const txSnap = await getDocs(col(userId, "transactions"))
      let count = 0
      for (const d of txSnap.docs) {
        const data = d.data()
        const raw = data.rawDescription as string | null
        if (!raw) continue
        const normalized = normalizeDescription(raw, userRules)
        if (normalized !== (data.description as string)) {
          await updateDoc(d.ref, { description: normalized, updatedAt: now() })
          count++
        }
      }
      return count
    },

    async getUniqueDescriptions(userId: string): Promise<string[]> {
      const db = getDb()
      const snapshot = await getDocs(collection(db, `users/${userId}/transactions`))
      const descs = new Set<string>()
      snapshot.forEach((d) => {
        const desc = d.data().description
        if (desc) descs.add(desc as string)
      })
      return Array.from(descs).sort((a, b) => a.localeCompare(b))
    },

    async getDashboardData(userId: string): Promise<DashboardData> {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const windowStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      // Only what the cards show: this month and last. Recent Activity comes from the same
      // rows; a quiet two months lists the ten newest on their own (no count of the collection).
      const [allAccounts, windowResult, userCategories] = await Promise.all([
        this.getAccounts(userId),
        this.getTransactions(userId, { dateFrom: windowStart }),
        this.getCategories(userId),
      ])
      // An archived account is closed: its history stays, its balance leaves the totals.
      const userAccounts = allAccounts.filter((a) => !a.isArchived)
      const recentTransactions =
        windowResult.data.length >= 10
          ? windowResult.data.slice(0, 10)
          : (await this.getTransactions(userId, { limit: 10, skipCount: true })).data
      const reportTransactions = windowResult.data.filter((t) => !t.excludeFromReports)

      const { totalAssets, totalLiabilities, netWorth } = netWorthTotals(userAccounts)

      const monthTxns = reportTransactions.filter((t) => t.date >= monthStart)

      const monthlyIncome = monthTxns.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0)
      const monthlyExpenses = monthTxns.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0)

      const categoryMap = new Map(userCategories.map((c) => [c.id, c]))
      const categoryTotals = accumulateCategorySpending(monthTxns.filter((t) => t.type === "expense"))
      const categorySpending = Array.from(categoryTotals.entries())
        .map(([catId, amount]) => {
          const cat = categoryMap.get(catId)
          return {
            categoryId: catId,
            categoryName: cat?.name ?? "Uncategorized",
            categoryIcon: cat?.icon ?? "HelpCircle",
            categoryColor: cat?.color ?? "#94a3b8",
            amount,
            percentage: monthlyExpenses > 0 ? (amount / monthlyExpenses) * 100 : 0,
          }
        })
        .sort((a, b) => b.amount - a.amount)

      const monthTotalsMap = new Map<string, { income: number; expenses: number }>()
      for (const t of reportTransactions) {
        const month = format(t.date, "yyyy-MM")
        const entry = monthTotalsMap.get(month) ?? { income: 0, expenses: 0 }
        if (t.type === "income") entry.income += t.amount
        if (t.type === "expense") entry.expenses += t.amount
        monthTotalsMap.set(month, entry)
      }
      const monthlySummary = Array.from(monthTotalsMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({ month, income: data.income, expenses: data.expenses, net: data.income - data.expenses }))

      return {
        totalAssets,
        totalLiabilities,
        netWorth,
        monthlyIncome,
        monthlyExpenses,
        monthlySavingsRate: monthlyIncome > 0 ? (monthlyIncome - monthlyExpenses) / monthlyIncome : 0,
        accountBalances: userAccounts.map((a) => ({
          accountId: a.id,
          accountName: a.name,
          balance: a.balance,
          currency: a.currency,
          type: a.type,
        })),
        monthlySummary,
        categorySpending,
        recentTransactions,
        accounts: allAccounts,
        categories: userCategories,
      }
    },

    async getReportData(
      userId: string,
      dateRange: { from: Date; to: Date },
      filters?: { accountIds?: string[]; categoryIds?: string[] }
    ): Promise<ReportData> {
      let txs = (await this.getTransactions(userId, {
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
      })).data.filter((t) => !t.excludeFromReports)
      if (filters?.accountIds?.length) txs = txs.filter((t) => filters.accountIds!.includes(t.accountId))
      if (filters?.categoryIds?.length) txs = txs.filter((t) => t.categoryId != null && filters.categoryIds!.includes(t.categoryId))

      const userCategories = await this.getCategories(userId)
      const categoryMap = new Map(userCategories.map((c) => [c.id, c]))

      const totalIncome = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0)
      const totalExpenses = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0)

      const categoryTotals = accumulateCategorySpending(txs.filter((t) => t.type === "expense"))
      const categorySpending = Array.from(categoryTotals.entries())
        .map(([catId, amount]) => {
          const cat = categoryMap.get(catId)
          return {
            categoryId: catId,
            categoryName: cat?.name ?? "Uncategorized",
            categoryIcon: cat?.icon ?? "HelpCircle",
            categoryColor: cat?.color ?? "#94a3b8",
            amount,
            percentage: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
          }
        })
        .sort((a, b) => b.amount - a.amount)

      const monthTotals = new Map<string, { income: number; expenses: number }>()
      for (const t of txs) {
        const month = format(t.date, "yyyy-MM")
        const entry = monthTotals.get(month) ?? { income: 0, expenses: 0 }
        if (t.type === "income") entry.income += t.amount
        if (t.type === "expense") entry.expenses += t.amount
        monthTotals.set(month, entry)
      }
      const monthlySummary = Array.from(monthTotals.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({ month, income: data.income, expenses: data.expenses, net: data.income - data.expenses }))

      const topExpenses = txs
        .filter((t) => t.type === "expense")
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 15)

      return { categorySpending, monthlySummary, totalIncome, totalExpenses, netSavings: totalIncome - totalExpenses, topExpenses }
    },

    async getDismissedSubscriptionPatterns(
      userId: string,
    ): Promise<DismissedSubscriptionPattern[]> {
      try {
        const snap = await getDocs(col(userId, "dismissed_subscription_patterns"))
        return snap.docs.map((d) => mapDismissedSubscriptionPattern(docData(d)))
      } catch (err) {
        if (isPermissionDenied(err)) return []
        throw err
      }
    },

    async createDismissedSubscriptionPattern(
      userId: string,
      input: CreateDismissedSubscriptionPatternInput,
    ): Promise<DismissedSubscriptionPattern> {
      const ref = await addDoc(col(userId, "dismissed_subscription_patterns"), {
        userId,
        patternKey: input.patternKey,
        dismissedAt: now(),
      })
      const snap = await readBack(ref)
      return mapDismissedSubscriptionPattern(docData(snap))
    },

    async deleteDismissedSubscriptionPattern(userId: string, id: string): Promise<void> {
      await deleteDoc(docRef(userId, "dismissed_subscription_patterns", id))
    },
  }
}
