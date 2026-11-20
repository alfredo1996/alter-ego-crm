/**
 * Server-side finance access using the firebase-admin SDK.
 *
 * Why this exists: Next.js API routes run server-side with no Firebase Auth
 * session, so the browser-oriented Web SDK adapter (adapter-firebase.ts) gets
 * PERMISSION_DENIED on every rules-protected write. Admin SDK bypasses
 * rules and is the correct server-side primitive.
 *
 * Scope: only the methods the live REST API and the MCP tools call. Extend as needed.
 * The host passes its Firestore getter in; the getter is read on every call, never at creation.
 */

import { FieldPath, FieldValue, Filter, Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore"

import { assertArchivable, assertLedgerValid, txBelongsToAccount, balanceEffects, balanceEffectsDiff } from "./lib/account-ledger"
import { mergeCategoryCopies } from "./lib/categories"
import {
  afterCreate,
  afterUpdate,
  monthBounds,
  monthKeysBetween,
  totalsDelta,
  totalsFromTransactions,
  type CountedTransaction,
} from "./lib/monthly-totals"
import { accumulateCategorySpending } from "./lib/splits"

import type {
  MonthlyTotal,
  MonthlyTotals,
  Account,
  CreateAccountInput,
  Budget,
  BudgetPeriod,
  Tag,
  RecurringTransaction,
  RecurringFrequency,
  LoanRecurringMeta,
  Category,
  CategoryGroup,
  CreateTransactionInput,
  ReportData,
  Transaction,
  TransactionFilters,
  TransactionSplit,
  TransactionStatus,
  TransactionType,
  Currency,
  UpdateTransactionInput,
} from "./types"

// ─── Helpers ────────────────────────────────────────────────────────────────

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  if (val && typeof (val as { toDate?: () => Date }).toDate === "function") {
    return (val as { toDate: () => Date }).toDate()
  }
  return new Date(val as string)
}

export function createFinanceAdmin(getAdminFirestore: () => Firestore) {
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

  // ─── Row mappers (mirror firebase.ts) ───────────────────────────────────────

  function mapAccount(d: DocumentData & { id: string }): Account {
    return {
      id: d.id,
      userId: d.userId as string,
      name: d.name as string,
      type: d.type as Account["type"],
      // Without this the explicit asset/liability override is invisible to every
      // admin-path read, and accountKind() silently falls back to the type default.
      kind: (d.kind as Account["kind"]) ?? null,
      currency: d.currency as Currency,
      balance: Number(d.balance ?? 0),
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


  // ─── Accounts ───────────────────────────────────────────────────────────────

  async function getAccounts(userId: string): Promise<Account[]> {
    const snap = await userCol(userId, "accounts").get()
    return snap.docs.map((d) => mapAccount(withId(d)))
  }

  async function getAccount(userId: string, accountId: string): Promise<Account | null> {
    const snap = await userDoc(userId, "accounts", accountId).get()
    if (!snap.exists) return null
    return mapAccount(withId(snap))
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

  async function getBudgets(userId: string): Promise<Budget[]> {
    const snap = await userCol(userId, "budgets").get()
    return snap.docs.map((d) => mapBudget(withId(d)))
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

  async function getTags(userId: string): Promise<Tag[]> {
    const snap = await userCol(userId, "tags").get()
    return snap.docs.map((d) => mapTag(withId(d)))
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
      endDate: d.endDate ? toDate(d.endDate) : null,
      nextDueDate: toDate(d.nextDueDate),
      isActive: Boolean(d.isActive),
      loanMeta: (d.loanMeta as LoanRecurringMeta | null) ?? null,
      createdAt: toDate(d.createdAt),
      updatedAt: toDate(d.updatedAt),
    }
  }

  async function getRecurringTransactions(userId: string): Promise<RecurringTransaction[]> {
    const snap = await userCol(userId, "recurring").get()
    return snap.docs.map((d) => mapRecurringTransaction(withId(d)))
  }

  // ─── Transactions ───────────────────────────────────────────────────────────

  async function getLastActivity(userId: string, accountIds: string[]): Promise<Record<string, Date | null>> {
    const dates = await Promise.all(
      accountIds.map(async (id) => {
        const snap = await userCol(userId, "transactions")
          .where(
            Filter.or(
              Filter.where("accountId", "==", id),
              Filter.and(Filter.where("transferToAccountId", "==", id), Filter.where("type", "==", "transfer")),
            ),
          )
          .orderBy("date", "desc")
          .limit(1)
          .get()
        return [id, snap.docs[0] ? mapTransaction(withId(snap.docs[0])).date : null] as const
      }),
    )
    return Object.fromEntries(dates)
  }

  async function getTransactions(
    userId: string,
    filters?: TransactionFilters,
  ): Promise<{ data: Transaction[]; total: number }> {
    try {
      return await fetchTransactions(userId, filters ?? {}, true)
    } catch (err) {
      // A filter combination without its composite index: answer the old way (every
      // row, filtered here) and say which index is missing instead of failing the call.
      if ((err as { code?: number }).code === 9 && filters?.accountId) {
        console.warn("getTransactions: missing Firestore index, reading the account in memory.", err)
        return fetchTransactions(userId, filters, false)
      }
      throw err
    }
  }

  /**
   * Pages on the server, like the client adapter: every filter Firestore has a form for
   * goes in the query, the total comes from a count aggregation, and only the page is
   * read. The filters with no Firestore form still read every match and page in memory.
   * accountServerSide: the account as an `or` over source and destination (incoming
   * transfers belong to the destination too), which needs an index per branch.
   */
  async function fetchTransactions(
    userId: string,
    filters: TransactionFilters,
    accountServerSide: boolean,
  ): Promise<{ data: Transaction[]; total: number }> {
    let q: FirebaseFirestore.Query = userCol(userId, "transactions")
    if (filters.accountId && accountServerSide) {
      q = q.where(
        Filter.or(
          Filter.where("accountId", "==", filters.accountId),
          Filter.where("transferToAccountId", "==", filters.accountId),
        ),
      )
    }
    if (filters.dateFrom) q = q.where("date", ">=", Timestamp.fromDate(filters.dateFrom))
    if (filters.dateTo) q = q.where("date", "<=", Timestamp.fromDate(filters.dateTo))
    if (filters.type) q = q.where("type", "==", filters.type)
    if (filters.categoryId) q = q.where("categoryId", "==", filters.categoryId)
    q = q.orderBy("date", "desc")

    const inMemory =
      (filters.accountId && !accountServerSide) ||
      !!filters.search ||
      !!filters.status ||
      filters.minAmount !== undefined ||
      filters.maxAmount !== undefined ||
      !!filters.hasNote ||
      !!filters.uncategorized ||
      !!filters.tagIds?.length
    const paged = filters.limit != null && !inMemory

    let total: number | undefined
    let snap: FirebaseFirestore.QuerySnapshot
    if (paged) {
      ;[snap, total] = await Promise.all([
        q.offset(filters.offset ?? 0).limit(filters.limit!).get(),
        q.count().get().then((c) => c.data().count),
      ])
    } else {
      snap = await q.get()
    }
    let data = snap.docs.map((d) => mapTransaction(withId(d)))

    // Re-applied after the `or` too: it drops a non-transfer row that kept a stray destination.
    if (filters.accountId) {
      data = data.filter((t) => txBelongsToAccount(t, filters.accountId!))
    }

    // Client-side filters not expressible in Firestore where()
    if (filters?.search) {
      const needle = filters.search.toLowerCase()
      data = data.filter(
        (t) =>
          t.description.toLowerCase().includes(needle) ||
          t.rawDescription?.toLowerCase().includes(needle) ||
          t.notes?.toLowerCase().includes(needle),
      )
    }
    if (filters?.minAmount !== undefined) data = data.filter((t) => t.amount >= filters.minAmount!)
    if (filters?.maxAmount !== undefined) data = data.filter((t) => t.amount <= filters.maxAmount!)
    // In memory like the client adapter: no (status, date) composite index to deploy.
    if (filters.status) data = data.filter((t) => t.status === filters.status)
    if (filters?.hasNote) data = data.filter((t) => !!t.notes)
    if (filters?.uncategorized) data = data.filter((t) => !t.categoryId && t.splits.length === 0)
    if (filters?.tagIds?.length) {
      data = data.filter((t) => filters.tagIds!.some((tag) => t.tagIds.includes(tag)))
    }

    // Same order as the other adapters. Firestore breaks same-date ties by document id,
    // stable across pages (no repeat, no skip) but not the createdAt order shown here.
    data.sort(
      (a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime(),
    )

    if (paged) return { data, total: total! }
    total = data.length
    if (filters.offset) data = data.slice(filters.offset)
    if (filters.limit) data = data.slice(0, filters.limit)
    return { data, total }
  }

  async function getTransaction(userId: string, id: string): Promise<Transaction | null> {
    const snap = await userDoc(userId, "transactions", id).get()
    if (!snap.exists) return null
    return mapTransaction(withId(snap))
  }

  async function createTransaction(
    userId: string,
    input: CreateTransactionInput,
  ): Promise<Transaction> {
    assertLedgerValid({
      type: input.type,
      amount: input.amount,
      accountId: input.accountId,
      transferToAccountId: input.transferToAccountId ?? null,
    })
    // The transaction and its share of the month totals go in one batch.
    const ref = userCol(userId, "transactions").doc()
    const batch = getAdminFirestore().batch()
    batch.set(ref, {
      userId,
      accountId: input.accountId,
      type: input.type,
      amount: input.amount,
      currency: input.currency,
      categoryId: input.categoryId ?? null,
      description: input.description,
      rawDescription: input.rawDescription ?? null,
      date: Timestamp.fromDate(input.date),
      notes: input.notes ?? null,
      tagIds: input.tagIds ?? [],
      transferToAccountId: input.transferToAccountId ?? null,
      linkedTransactionId: input.linkedTransactionId ?? null,
      splits: input.splits ?? [],
      attachments: [],
      status: input.status ?? "cleared",
      isRecurring: false,
      importHash: input.importHash ?? null,
      excludeFromReports: input.excludeFromReports ?? false,
      createdAt: now(),
      updatedAt: now(),
    })
    stageTotals(batch, userId, null, afterCreate(input))
    await batch.commit()
    // Atomically apply balance effects (source + transfer destination).
    await Promise.all(
      balanceEffects({
        type: input.type,
        amount: input.amount,
        accountId: input.accountId,
        transferToAccountId: input.transferToAccountId ?? null,
      }).map((e) =>
        userDoc(userId, "accounts", e.accountId).update({
          balance: FieldValue.increment(e.delta),
          updatedAt: now(),
        }),
      ),
    )
    const snap = await ref.get()
    return mapTransaction(withId(snap))
  }

  async function updateTransaction(
    userId: string,
    id: string,
    input: UpdateTransactionInput,
  ): Promise<Transaction> {
    const ref = userDoc(userId, "transactions", id)
    const oldSnap = await ref.get()
    if (!oldSnap.exists) throw new Error(`Transaction ${id} not found`)
    const oldTx = mapTransaction(withId(oldSnap))
    const updates: Record<string, unknown> = { updatedAt: now() }
    if (input.accountId !== undefined) updates.accountId = input.accountId
    if (input.type !== undefined) updates.type = input.type
    if (input.amount !== undefined) updates.amount = input.amount
    if (input.currency !== undefined) updates.currency = input.currency
    if (input.categoryId !== undefined) updates.categoryId = input.categoryId
    if (input.description !== undefined) updates.description = input.description
    if (input.rawDescription !== undefined) updates.rawDescription = input.rawDescription
    if (input.date !== undefined) updates.date = Timestamp.fromDate(input.date)
    if (input.notes !== undefined) updates.notes = input.notes
    if (input.tagIds !== undefined) updates.tagIds = input.tagIds
    if (input.splits !== undefined) updates.splits = input.splits
    if (input.transferToAccountId !== undefined) updates.transferToAccountId = input.transferToAccountId
    if (input.status !== undefined) updates.status = input.status
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
    const batch = getAdminFirestore().batch()
    batch.update(ref, updates)
    stageTotals(batch, userId, oldTx, afterUpdate(oldTx, input))
    await batch.commit()
    await Promise.all(
      balanceEffectsDiff(oldTx, newLedger).map((e) =>
        userDoc(userId, "accounts", e.accountId).update({
          balance: FieldValue.increment(e.delta),
          updatedAt: now(),
        }),
      ),
    )
    const snap = await ref.get()
    return mapTransaction(withId(snap))
  }

  async function deleteTransaction(userId: string, id: string): Promise<void> {
    const snap = await userDoc(userId, "transactions", id).get()
    if (!snap.exists) return
    const tx = mapTransaction(withId(snap))
    // ponytail: the totals delta comes from a read outside the batch, so two concurrent deletes of one row
    // both subtract (as account balances already do). Upgrade: runTransaction around read + delete.
    // Reverse the transaction's balance effects atomically, then delete.
    await Promise.all(
      balanceEffects(tx).map((e) =>
        userDoc(userId, "accounts", e.accountId).update({
          balance: FieldValue.increment(-e.delta),
          updatedAt: now(),
        }),
      ),
    )
    const batch = getAdminFirestore().batch()
    batch.delete(userDoc(userId, "transactions", id))
    stageTotals(batch, userId, tx, null)
    await batch.commit()
  }

  // ─── Monthly totals (the rollup behind rollover budgets) ────────────────────

  // Moves the month totals by what `before` becoming `after` changes, in the batch that writes
  // the transaction. `n` counts the writes: the lazy fill uses it to notice a write that landed
  // while it computed. increment() keeps parallel writers from overwriting each other.
  function stageTotals(
    batch: FirebaseFirestore.WriteBatch,
    userId: string,
    before: CountedTransaction | null,
    after: CountedTransaction | null,
  ) {
    for (const [month, d] of totalsDelta(before, after)) {
      batch.set(
        userDoc(userId, "monthly_totals", month),
        {
          total: FieldValue.increment(d.total),
          // an empty map in a merge write REPLACES the stored one, so leave the key out
          ...(Object.keys(d.byCategory).length > 0 && {
            expenseByCategory: Object.fromEntries(
              Object.entries(d.byCategory).map(([c, v]) => [c, FieldValue.increment(v)]),
            ),
          }),
          n: FieldValue.increment(1),
        },
        { merge: true },
      )
    }
  }

  /** Expense totals per month, `fromMonth` to `toMonth` inclusive; a month not stored yet is computed once and stored. */
  async function getMonthlyTotals(userId: string, fromMonth: string, toMonth: string): Promise<MonthlyTotals> {
    const snap = await userCol(userId, "monthly_totals")
      .where(FieldPath.documentId(), ">=", fromMonth)
      .where(FieldPath.documentId(), "<=", toMonth)
      .get()
    const result: MonthlyTotals = {}
    const seen = new Map<string, number>() // writes on a month that is not complete yet
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
  }

  // Computes a month's totals from its transactions and stores them, once. The store is a
  // transaction that checks the month's write count is still `seen`: a write that landed while
  // we computed is not in our sum, and writing over it would lose it, so we compute again.
  // If the store keeps losing or fails, the answer is still right for this read, just not kept.
  async function fillMonth(userId: string, month: string, seenWrites: number): Promise<MonthlyTotal> {
    const ref = userDoc(userId, "monthly_totals", month)
    const { start, end } = monthBounds(month)
    let seen = seenWrites
    let totals: MonthlyTotal = { total: 0, expenseByCategory: {} }
    for (let attempt = 0; attempt < 3; attempt++) {
      totals = totalsFromTransactions((await getTransactions(userId, { dateFrom: start, dateTo: end })).data)
      try {
        const kept = await getAdminFirestore().runTransaction(async (t) => {
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

  // ─── Categories (system + user) ─────────────────────────────────────────────

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

  async function createAccount(userId: string, input: CreateAccountInput): Promise<Account> {
    const ref = await userCol(userId, "accounts").add({
      userId,
      name: input.name,
      type: input.type,
      kind: input.kind ?? null,
      currency: input.currency,
      balance: input.balance,
      // The starting point recalculateBalances builds transaction effects on top of.
      openingBalance: input.balance,
      icon: input.icon ?? null,
      color: input.color ?? null,
      isArchived: false,
      createdAt: now(),
      updatedAt: now(),
    })
    return mapAccount(withId(await ref.get()))
  }

  /**
   * Close or reopen. The Admin SDK bypasses the rules, so the #219 close guard runs here, in the
   * transaction that reads the balance it checks. Only `isArchived` is writable: the one caller is the
   * MCP archive_account tool, and a wider write path through the Admin SDK would have no test.
   */
  async function updateAccount(
    userId: string,
    accountId: string,
    input: { isArchived: boolean }
  ): Promise<Account> {
    const ref = userDoc(userId, "accounts", accountId)
    await getAdminFirestore().runTransaction(async (t) => {
      const snap = await t.get(ref)
      if (!snap.exists) throw new Error(`Account ${accountId} not found.`)
      assertArchivable(mapAccount(withId(snap)), input)
      t.update(ref, { isArchived: input.isArchived, updatedAt: now() })
    })
    return mapAccount(withId(await ref.get()))
  }

  async function getCategories(userId: string): Promise<Category[]> {
    const db = getAdminFirestore()
    const [systemSnap, userSnap] = await Promise.all([
      db.collection("categories").get(),
      userCol(userId, "categories").get(),
    ])
    return mergeCategoryCopies(
      systemSnap.docs.map((d) => mapCategory(withId(d))),
      userSnap.docs.map((d) => mapCategory(withId(d)))
    )
  }

  // ─── Reports aggregation ────────────────────────────────────────────────────

  async function getReportData(
    userId: string,
    dateRange: { from: Date; to: Date },
    filters?: { accountIds?: string[]; categoryIds?: string[] },
  ): Promise<ReportData> {
    const txResult = await getTransactions(userId, {
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
    })
    let txs = txResult.data.filter((t) => !t.excludeFromReports)
    if (filters?.accountIds?.length) {
      txs = txs.filter((t) => filters.accountIds!.includes(t.accountId))
    }
    if (filters?.categoryIds?.length) {
      txs = txs.filter(
        (t) => t.categoryId != null && filters.categoryIds!.includes(t.categoryId),
      )
    }

    const categories = await getCategories(userId)
    const categoryMap = new Map(categories.map((c) => [c.id, c]))

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
      const y = t.date.getFullYear()
      const m = String(t.date.getMonth() + 1).padStart(2, "0")
      const month = `${y}-${m}`
      const entry = monthTotals.get(month) ?? { income: 0, expenses: 0 }
      if (t.type === "income") entry.income += t.amount
      if (t.type === "expense") entry.expenses += t.amount
      monthTotals.set(month, entry)
    }
    const monthlySummary = Array.from(monthTotals.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        income: data.income,
        expenses: data.expenses,
        net: data.income - data.expenses,
      }))

    const topExpenses = txs
      .filter((t) => t.type === "expense")
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15)

    return {
      categorySpending,
      monthlySummary,
      totalIncome,
      totalExpenses,
      netSavings: totalIncome - totalExpenses,
      topExpenses,
    }
  }

  return {
    getAccounts,
    getAccount,
    getBudgets,
    getTags,
    getRecurringTransactions,
    getLastActivity,
    getTransactions,
    getTransaction,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    getMonthlyTotals,
    createAccount,
    updateAccount,
    getCategories,
    getReportData,
  }
}
