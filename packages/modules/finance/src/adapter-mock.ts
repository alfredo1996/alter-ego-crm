
import { advanceDate, isoDate } from "@alter-ego/kernel/dates"
import { format, differenceInCalendarMonths } from "date-fns"

import {
  ACCOUNT_HAS_TRANSACTIONS,
  assertArchivable,
  assertLedgerValid,
  txBelongsToAccount,
  balanceEffects,
  balanceEffectsDiff,
} from "./lib/account-ledger"
import { calculateMortgage } from "./lib/amortization"
import { defaultCategories } from "./lib/categories"
import { normalizeDescription } from "./lib/merchants"
import { monthBounds, monthKeysBetween, totalsDelta, totalsFromTransactions } from "./lib/monthly-totals"
import { encodeLoanNote } from "./lib/mortgage"
import { netWorthTotals } from "./lib/net-worth"
import { accumulateCategorySpending } from "./lib/splits"

import type { FinanceAdapter } from "./adapter"
import type {
  MonthlyTotal,
  MonthlyTotals,
  Account,
  Transaction,
  Category,
  Budget,
  RecurringTransaction,
  SavingsGoal,
  NetWorthSnapshot,
  Tag,
  CategorizationRule,
  PaginatedResult,
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
  DismissedSubscriptionPattern,
  CreateDismissedSubscriptionPatternInput,
} from "./types"

const accounts: Map<string, Account> = new Map()
const transactions: Map<string, Transaction> = new Map()
// `${userId}:${yyyy-MM}` → expense totals; `ready` once the month holds every transaction
// (a write to a month never read yet leaves a partial entry, filled on the first read).
const monthlyTotals: Map<string, MonthlyTotal & { ready: boolean }> = new Map()

/** Moves the monthly totals by what `before` becoming `after` changes (see totalsDelta). */
function adjustTotals(userId: string, before: Transaction | null, after: Transaction | null) {
  for (const [month, d] of totalsDelta(before, after)) {
    const key = `${userId}:${month}`
    const entry = monthlyTotals.get(key) ?? { total: 0, expenseByCategory: {}, ready: false }
    entry.total += d.total
    for (const [categoryId, amount] of Object.entries(d.byCategory)) {
      entry.expenseByCategory[categoryId] = (entry.expenseByCategory[categoryId] ?? 0) + amount
    }
    monthlyTotals.set(key, entry)
  }
}

function clearTotals(userId: string) {
  for (const key of monthlyTotals.keys()) if (key.startsWith(`${userId}:`)) monthlyTotals.delete(key)
}
const categories: Map<string, Category> = new Map()
// A user's own copy of a built-in, keyed `${userId}:${id}`; same id as the default.
const categoryCopies: Map<string, Category> = new Map()
const copyKey = (userId: string, id: string) => `${userId}:${id}`
const budgets: Map<string, Budget> = new Map()
const recurringTransactions: Map<string, RecurringTransaction> = new Map()
const savingsGoals: Map<string, SavingsGoal> = new Map()
const netWorthSnapshots: Map<string, NetWorthSnapshot> = new Map()
const tags: Map<string, Tag> = new Map()
const transactionTags: Map<string, string[]> = new Map() // transactionId → tagIds
const categorizationRules: Map<string, CategorizationRule> = new Map()
const dismissedSubscriptionPatterns: Map<string, DismissedSubscriptionPattern> = new Map()

let idCounter = 0
function nextId(): string {
  return `mock-${++idCounter}`
}

function seedDefaultCategories() {
  categories.clear()
  const now = new Date()
  for (const seed of defaultCategories) {
    const id = nextId()
    categories.set(id, {
      id,
      userId: null,
      name: seed.name,
      group: seed.group,
      icon: seed.icon,
      color: seed.color,
      parentId: null,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
  }
}

// Seed default categories once at module init
seedDefaultCategories()

/**
 * The finance half of the mock database. State lives in this module; the host composes it with its own
 * (API keys, audit) and calls clearMockFinance() between tests.
 */
export const mockFinance: FinanceAdapter = {
  async getAccounts(userId: string): Promise<Account[]> {
    return Array.from(accounts.values()).filter((a) => a.userId === userId)
  },

  async getAccount(userId: string, accountId: string): Promise<Account | null> {
    const account = accounts.get(accountId)
    if (!account || account.userId !== userId) return null
    return account
  },

  async createAccount(userId: string, input: CreateAccountInput): Promise<Account> {
    const account: Account = {
      id: nextId(),
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
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    accounts.set(account.id, account)
    return account
  },

  async updateAccount(userId: string, accountId: string, input: UpdateAccountInput): Promise<Account> {
    const existing = accounts.get(accountId)
    if (!existing || existing.userId !== userId) throw new Error(`Account ${accountId} not found`)
    assertArchivable(existing, input)
    const updated: Account = { ...existing, ...input, updatedAt: new Date() }
    // A `balance` edit sets the OPENING balance; keep current balance consistent
    // by preserving the existing transaction delta (balance − openingBalance).
    if (input.balance !== undefined) {
      const txnDelta = existing.balance - existing.openingBalance
      updated.openingBalance = input.balance
      updated.balance = input.balance + txnDelta
    }
    accounts.set(accountId, updated)
    return updated
  },

  async deleteAccount(userId: string, accountId: string): Promise<void> {
    const existing = accounts.get(accountId)
    if (!existing || existing.userId !== userId) return
    for (const t of transactions.values()) {
      if (t.userId === userId && txBelongsToAccount(t, accountId)) throw new Error(ACCOUNT_HAS_TRANSACTIONS)
    }
    accounts.delete(accountId)
  },

  async getLastActivity(userId: string, accountIds: string[]): Promise<Record<string, Date | null>> {
    const out: Record<string, Date | null> = {}
    for (const id of accountIds) {
      const dates = Array.from(transactions.values())
        .filter((t) => t.userId === userId && txBelongsToAccount(t, id))
        .map((t) => t.date.getTime())
      out[id] = dates.length ? new Date(Math.max(...dates)) : null
    }
    return out
  },

  async getTransactions(userId: string, filters?: TransactionFilters): Promise<PaginatedResult<Transaction>> {
    let result = Array.from(transactions.values()).filter((t) => t.userId === userId)

    if (filters?.accountId) {
      result = result.filter((t) => txBelongsToAccount(t, filters.accountId!))
    }
    if (filters?.type) {
      result = result.filter((t) => t.type === filters.type)
    }
    if (filters?.categoryId) {
      result = result.filter((t) => t.categoryId === filters.categoryId)
    }
    if (filters?.dateFrom) {
      result = result.filter((t) => t.date >= filters.dateFrom!)
    }
    if (filters?.dateTo) {
      result = result.filter((t) => t.date <= filters.dateTo!)
    }
    if (filters?.minAmount !== undefined) {
      result = result.filter((t) => t.amount >= filters.minAmount!)
    }
    if (filters?.maxAmount !== undefined) {
      result = result.filter((t) => t.amount <= filters.maxAmount!)
    }
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase()
      result = result.filter((t) =>
        t.description.toLowerCase().includes(searchLower) ||
        t.rawDescription?.toLowerCase().includes(searchLower) ||
        t.notes?.toLowerCase().includes(searchLower)
      )
    }
    if (filters?.uncategorized) {
      // A split transaction is filed on its splits, so it is not uncategorized.
      result = result.filter((t) => t.categoryId === null && t.splits.length === 0)
    }
    if (filters?.hasNote) {
      result = result.filter((t) => !!t.notes)
    }
    if (filters?.tagIds?.length) {
      result = result.filter((t) => filters.tagIds!.some((id) => t.tagIds.includes(id)))
    }
    if (filters?.status) {
      result = result.filter((t) => t.status === filters.status)
    }

    // Stable order: newest date first, then most-recently-created (tiebreaker for
    // same-date rows, e.g. date-only bulk imports — avoids "random" ordering).
    result = result.sort(
      (a, b) =>
        b.date.getTime() - a.date.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime()
    )

    const total = result.length
    const limit = filters?.limit ?? result.length  // no limit = return all
    const offset = filters?.offset ?? 0
    const data = result.slice(offset, offset + limit)
    return { data, total, limit, offset }
  },

  async getTransaction(userId: string, transactionId: string): Promise<Transaction | null> {
    const tx = transactions.get(transactionId)
    if (!tx || tx.userId !== userId) return null
    return tx
  },

  async createTransaction(userId: string, input: CreateTransactionInput): Promise<Transaction> {
    const now = new Date()
    const base = {
      userId,
      type: input.type,
      amount: input.amount,
      currency: input.currency,
      categoryId: input.categoryId ?? null,
      description: input.description,
      rawDescription: input.rawDescription ?? null,
      date: input.date,
      notes: input.notes ?? null,
      tagIds: input.tagIds ?? [],
      splits: input.splits ?? [],
      attachments: [],
      status: input.status ?? "cleared",
      isRecurring: input.isRecurring ?? false,
      importHash: input.importHash ?? null,
      excludeFromReports: input.excludeFromReports ?? false,
      createdAt: now,
      updatedAt: now,
    }

    // Idempotent import: if same user+hash already exists, return the existing row silently
    if (input.importHash) {
      const existing = Array.from(transactions.values()).find(
        (t) => t.userId === userId && t.importHash === input.importHash
      )
      if (existing) return existing
    }

    const transaction: Transaction = {
      ...base,
      id: nextId(),
      accountId: input.accountId,
      transferToAccountId: input.transferToAccountId ?? null,
      linkedTransactionId: input.linkedTransactionId ?? null,
    }
    assertLedgerValid(transaction)
    transactions.set(transaction.id, transaction)
    adjustTotals(userId, null, transaction)
    for (const e of balanceEffects(transaction)) {
      const acc = accounts.get(e.accountId)
      if (acc) acc.balance += e.delta
    }
    return transaction
  },

  async updateTransaction(userId: string, transactionId: string, input: UpdateTransactionInput): Promise<Transaction> {
    const existing = transactions.get(transactionId)
    if (!existing || existing.userId !== userId) throw new Error(`Transaction ${transactionId} not found`)
    const updated: Transaction = {
      ...existing,
      ...input,
      splits: input.splits !== undefined ? input.splits : existing.splits,
      excludeFromReports: input.excludeFromReports !== undefined ? input.excludeFromReports : existing.excludeFromReports,
      updatedAt: new Date(),
    }
    assertLedgerValid(updated)
    transactions.set(transactionId, updated)
    adjustTotals(userId, existing, updated)
    // Apply the net balance change (reverse old effects, apply new) inline.
    for (const e of balanceEffectsDiff(existing, updated)) {
      const acc = accounts.get(e.accountId)
      if (acc) acc.balance += e.delta
    }
    return updated
  },

  async deleteTransaction(userId: string, transactionId: string): Promise<void> {
    const tx = transactions.get(transactionId)
    if (!tx || tx.userId !== userId) return
    for (const e of balanceEffects(tx)) {
      const acc = accounts.get(e.accountId)
      if (acc) acc.balance -= e.delta
    }
    adjustTotals(userId, tx, null)
    transactions.delete(transactionId)
  },

  async deleteTransactions(userId: string, transactionIds: string[]): Promise<void> {
    for (const id of transactionIds) {
      const tx = transactions.get(id)
      if (!tx || tx.userId !== userId) continue
      for (const e of balanceEffects(tx)) {
        const acc = accounts.get(e.accountId)
        if (acc) acc.balance -= e.delta
      }
      adjustTotals(userId, tx, null)
      transactions.delete(id)
    }
  },

  async deleteAllAccountData(userId: string): Promise<void> {
    clearTotals(userId)
    const stores = [accounts, transactions, recurringTransactions, netWorthSnapshots]
    for (const store of stores as Map<string, { userId: string }>[]) {
      for (const [id, item] of store) {
        if (item.userId === userId) store.delete(id)
      }
    }
  },

  async getMonthlyTotals(userId: string, fromMonth: string, toMonth: string): Promise<MonthlyTotals> {
    const result: MonthlyTotals = {}
    for (const month of monthKeysBetween(fromMonth, toMonth)) {
      const key = `${userId}:${month}`
      let entry = monthlyTotals.get(key)
      if (!entry?.ready) {
        const { start, end } = monthBounds(month)
        const inMonth = Array.from(transactions.values()).filter(
          (t) => t.userId === userId && t.date >= start && t.date <= end,
        )
        entry = { ...totalsFromTransactions(inMonth), ready: true }
        monthlyTotals.set(key, entry)
      }
      result[month] = { total: entry.total, expenseByCategory: { ...entry.expenseByCategory } }
    }
    return result
  },

  async deleteAllTransactions(userId: string): Promise<void> {
    clearTotals(userId)
    for (const [id, tx] of transactions) {
      if (tx.userId === userId) transactions.delete(id)
    }
  },

  async getImportHashes(userId: string): Promise<string[]> {
    return Array.from(transactions.values())
      .filter((t) => t.userId === userId && t.importHash)
      .map((t) => t.importHash as string)
  },

  async recalculateBalances(userId: string): Promise<void> {
    const userAccounts = Array.from(accounts.values()).filter((a) => a.userId === userId)
    const userTxs = Array.from(transactions.values()).filter((t) => t.userId === userId)

    // Single-row transfers: account_id = source, transfer_to_account_id = dest.
    // Seed each account with its opening balance, then apply transaction effects.
    const balanceMap = new Map<string, number>()
    for (const acc of userAccounts) balanceMap.set(acc.id, acc.openingBalance)

    for (const tx of userTxs) {
      if (tx.type === 'income') {
        balanceMap.set(tx.accountId, (balanceMap.get(tx.accountId) ?? 0) + tx.amount)
      } else if (tx.type === 'expense') {
        balanceMap.set(tx.accountId, (balanceMap.get(tx.accountId) ?? 0) - tx.amount)
      } else if (tx.type === 'transfer') {
        balanceMap.set(tx.accountId, (balanceMap.get(tx.accountId) ?? 0) - tx.amount)
        if (tx.transferToAccountId) {
          balanceMap.set(tx.transferToAccountId, (balanceMap.get(tx.transferToAccountId) ?? 0) + tx.amount)
        }
      }
    }

    for (const account of userAccounts) {
      account.balance = balanceMap.get(account.id) ?? 0
    }
  },

  async getCategories(userId: string): Promise<Category[]> {
    return Array.from(categories.values())
      .filter((c) => c.userId === userId || c.isDefault)
      .map((c) => categoryCopies.get(copyKey(userId, c.id)) ?? c)
  },

  async getCategory(userId: string, categoryId: string): Promise<Category | null> {
    const cat = categories.get(categoryId)
    if (!cat) return null
    if (!cat.isDefault && cat.userId !== userId) return null
    return categoryCopies.get(copyKey(userId, categoryId)) ?? cat
  },

  async createCategory(userId: string, input: CreateCategoryInput): Promise<Category> {
    const category: Category = {
      id: nextId(),
      userId,
      name: input.name,
      group: input.group,
      icon: input.icon,
      color: input.color,
      parentId: input.parentId ?? null,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    categories.set(category.id, category)
    return category
  },

  async updateCategory(userId: string, categoryId: string, input: UpdateCategoryInput): Promise<Category> {
    const existing = categories.get(categoryId)
    if (!existing || (!existing.isDefault && existing.userId !== userId)) throw new Error(`Category ${categoryId} not found`)
    if (existing.isDefault) {
      // Built-ins are shared: the edit goes to this user's copy, same id.
      const key = copyKey(userId, categoryId)
      const updated = { ...(categoryCopies.get(key) ?? existing), ...input, userId, updatedAt: new Date() }
      categoryCopies.set(key, updated)
      return updated
    }
    const updated = { ...existing, ...input, updatedAt: new Date() }
    categories.set(categoryId, updated)
    return updated
  },

  // A built-in id removes the user's copy (Reset to Default); the default itself stays.
  async deleteCategory(userId: string, categoryId: string): Promise<void> {
    categoryCopies.delete(copyKey(userId, categoryId))
    const existing = categories.get(categoryId)
    if (existing && !existing.isDefault && existing.userId === userId) categories.delete(categoryId)
  },

  async deleteAllCategories(userId: string): Promise<void> {
    for (const key of categoryCopies.keys()) if (key.startsWith(`${userId}:`)) categoryCopies.delete(key)
    for (const [id, cat] of categories) {
      if (!cat.isDefault && cat.userId === userId) categories.delete(id)
    }
  },

  async getBudgets(userId: string): Promise<Budget[]> {
    return Array.from(budgets.values()).filter((b) => b.userId === userId)
  },

  async getBudget(userId: string, budgetId: string): Promise<Budget | null> {
    const budget = budgets.get(budgetId)
    if (!budget || budget.userId !== userId) return null
    return budget
  },

  async createBudget(userId: string, input: CreateBudgetInput): Promise<Budget> {
    const budget: Budget = {
      id: nextId(),
      userId,
      name: input.name,
      categoryId: input.categoryId ?? null,
      amount: input.amount,
      currency: input.currency,
      period: input.period,
      rolloverMode: input.rolloverMode ?? "reset",
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    budgets.set(budget.id, budget)
    return budget
  },

  async updateBudget(userId: string, budgetId: string, input: UpdateBudgetInput): Promise<Budget> {
    const existing = budgets.get(budgetId)
    if (!existing || existing.userId !== userId) throw new Error(`Budget ${budgetId} not found`)
    const updated = { ...existing, ...input, updatedAt: new Date() }
    budgets.set(budgetId, updated)
    return updated
  },

  async deleteBudget(userId: string, budgetId: string): Promise<void> {
    const existing = budgets.get(budgetId)
    if (existing && existing.userId !== userId) return
    budgets.delete(budgetId)
  },

  async getReportData(
    userId: string,
    dateRange: { from: Date; to: Date },
    filters?: { accountIds?: string[]; categoryIds?: string[] }
  ): Promise<ReportData> {
    let userTransactions = (await this.getTransactions(userId)).data.filter(
      (t) => t.date >= dateRange.from && t.date <= dateRange.to && !t.excludeFromReports
    )
    if (filters?.accountIds?.length) {
      userTransactions = userTransactions.filter((t) => filters.accountIds!.includes(t.accountId))
    }
    if (filters?.categoryIds?.length) {
      userTransactions = userTransactions.filter(
        (t) => t.categoryId !== null && filters.categoryIds!.includes(t.categoryId)
      )
    }
    const userCategories = await this.getCategories(userId)
    const categoryMap = new Map(userCategories.map((c) => [c.id, c]))

    const totalIncome = userTransactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + t.amount, 0)
    const totalExpenses = userTransactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + t.amount, 0)

    // Group expenses by category (split-aware)
    const categoryTotals = accumulateCategorySpending(userTransactions.filter((t) => t.type === "expense"))

    const categorySpending = Array.from(categoryTotals.entries()).map(
      ([catId, amount]) => {
        const cat = categoryMap.get(catId)
        return {
          categoryId: catId,
          categoryName: cat?.name ?? "Uncategorized",
          categoryIcon: cat?.icon ?? "HelpCircle",
          categoryColor: cat?.color ?? "#94a3b8",
          amount,
          percentage: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
        }
      }
    )
    categorySpending.sort((a, b) => b.amount - a.amount)

    // Group by month
    const monthTotals = new Map<string, { income: number; expenses: number }>()
    for (const t of userTransactions) {
      const month = format(t.date, "yyyy-MM")
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

    const topExpenses = userTransactions
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
  },

  async getRecurringTransactions(userId: string): Promise<RecurringTransaction[]> {
    return Array.from(recurringTransactions.values())
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.nextDueDate.getTime() - b.nextDueDate.getTime())
  },

  async getRecurringTransaction(userId: string, recurringId: string): Promise<RecurringTransaction | null> {
    const rule = recurringTransactions.get(recurringId)
    if (!rule || rule.userId !== userId) return null
    return rule
  },

  async createRecurringTransaction(userId: string, input: CreateRecurringTransactionInput): Promise<RecurringTransaction> {
    const rule: RecurringTransaction = {
      id: nextId(),
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
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      nextDueDate: input.startDate,
      isActive: true,
      loanMeta: input.loanMeta ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    recurringTransactions.set(rule.id, rule)
    return rule
  },

  async updateRecurringTransaction(userId: string, recurringId: string, input: UpdateRecurringTransactionInput): Promise<RecurringTransaction> {
    const existing = recurringTransactions.get(recurringId)
    if (!existing || existing.userId !== userId) throw new Error(`RecurringTransaction ${recurringId} not found`)
    const updated = { ...existing, ...input, updatedAt: new Date() }
    recurringTransactions.set(recurringId, updated)
    return updated
  },

  async deleteRecurringTransaction(userId: string, recurringId: string): Promise<void> {
    const existing = recurringTransactions.get(recurringId)
    if (existing && existing.userId !== userId) return
    recurringTransactions.delete(recurringId)
  },

  async generateDue(userId: string, upToDate: Date): Promise<Transaction[]> {
    const generated: Transaction[] = []
    const userRules = Array.from(recurringTransactions.values()).filter(
      (r) => r.userId === userId && r.isActive
    )

    for (const rule of userRules) {
      let nextDue = new Date(rule.nextDueDate)

      while (nextDue <= upToDate) {
        // Skip if past endDate
        if (rule.endDate && nextDue > rule.endDate) break

        // Idempotent: check if a transaction for this rule+date already exists
        const key = `${rule.id}:${format(nextDue, "yyyy-MM-dd")}`
        const alreadyGenerated = Array.from(transactions.values()).some(
          (t) => t.linkedTransactionId === key
        )

        if (!alreadyGenerated) {
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

        // Advance to next occurrence
        nextDue = advanceDate(nextDue, rule.frequency, rule.interval)
      }

      // Persist new nextDueDate on the rule
      recurringTransactions.set(rule.id, { ...rule, nextDueDate: nextDue, updatedAt: new Date() })
    }

    return generated
  },

  async getRecurringHistory(userId: string, recurringId: string): Promise<Transaction[]> {
    const prefix = `${recurringId}:`
    return Array.from(transactions.values())
      .filter((t) => t.userId === userId && t.linkedTransactionId?.startsWith(prefix))
      .sort((a, b) => b.date.getTime() - a.date.getTime())
  },

  async getSavingsGoals(userId: string): Promise<SavingsGoal[]> {
    return Array.from(savingsGoals.values()).filter((g) => g.userId === userId)
  },

  async getSavingsGoal(userId: string, goalId: string): Promise<SavingsGoal | null> {
    const goal = savingsGoals.get(goalId)
    if (!goal || goal.userId !== userId) return null
    return goal
  },

  async createSavingsGoal(userId: string, input: CreateSavingsGoalInput): Promise<SavingsGoal> {
    const goal: SavingsGoal = {
      id: nextId(),
      userId,
      name: input.name,
      targetAmount: input.targetAmount,
      currentAmount: 0,
      currency: input.currency,
      targetDate: input.targetDate ?? null,
      icon: input.icon ?? "🎯",
      color: input.color ?? "#6366f1",
      isCompleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    savingsGoals.set(goal.id, goal)
    return goal
  },

  async updateSavingsGoal(userId: string, goalId: string, input: UpdateSavingsGoalInput): Promise<SavingsGoal> {
    const existing = savingsGoals.get(goalId)
    if (!existing || existing.userId !== userId) throw new Error(`SavingsGoal ${goalId} not found`)
    const updated = { ...existing, ...input, updatedAt: new Date() }
    savingsGoals.set(goalId, updated)
    return updated
  },

  async deleteSavingsGoal(userId: string, goalId: string): Promise<void> {
    const existing = savingsGoals.get(goalId)
    if (existing && existing.userId !== userId) return
    savingsGoals.delete(goalId)
  },

  async takeSnapshot(userId: string): Promise<NetWorthSnapshot> {
    const today = isoDate(new Date())
    // Idempotent: return existing snapshot if one exists for today. Compared on
    // local calendar day — UTC serialisation rolls over hours before local
    // midnight, which both revived the previous day's snapshot and duplicated
    // the current one during that window.
    const existing = Array.from(netWorthSnapshots.values()).find(
      (s) => s.userId === userId && isoDate(s.date) === today
    )
    if (existing) return existing

    const userAccounts = (await this.getAccounts(userId)).filter((a) => !a.isArchived)
    const { totalAssets, totalLiabilities, netWorth } = netWorthTotals(userAccounts)

    const snapshot: NetWorthSnapshot = {
      id: nextId(),
      userId,
      date: new Date(`${today}T00:00:00`),
      totalAssets,
      totalLiabilities,
      netWorth,
    }
    netWorthSnapshots.set(snapshot.id, snapshot)
    return snapshot
  },

  async getNetWorthHistory(userId: string, months = 12): Promise<NetWorthSnapshot[]> {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - months)
    return Array.from(netWorthSnapshots.values())
      .filter((s) => s.userId === userId && s.date >= cutoff)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
  },

  async getNetWorthAt(userId: string, date: Date): Promise<NetWorthSnapshot | null> {
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
    const found = Array.from(netWorthSnapshots.values())
      .filter((s) => s.userId === userId && s.date <= end)
      .sort((a, b) => b.date.getTime() - a.date.getTime())
    return found[0] ?? null
  },

  // Tags
  async getTags(userId: string): Promise<Tag[]> {
    return Array.from(tags.values()).filter((t) => t.userId === userId)
  },

  async createTag(userId: string, input: CreateTagInput): Promise<Tag> {
    const tag: Tag = {
      id: nextId(),
      userId,
      name: input.name,
      color: input.color ?? "#6366f1",
      createdAt: new Date(),
    }
    tags.set(tag.id, tag)
    return tag
  },

  async deleteTag(userId: string, tagId: string): Promise<void> {
    const existing = tags.get(tagId)
    if (existing && existing.userId !== userId) return
    tags.delete(tagId)
    // Remove from all transactions
    for (const [txId, txTagIds] of transactionTags.entries()) {
      transactionTags.set(txId, txTagIds.filter((id) => id !== tagId))
    }
  },

  // Categorization rules
  async getCategorizationRules(userId: string): Promise<CategorizationRule[]> {
    return Array.from(categorizationRules.values()).filter((r) => r.userId === userId)
  },

  async createCategorizationRule(userId: string, input: CreateCategorizationRuleInput): Promise<CategorizationRule> {
    const rule: CategorizationRule = {
      id: nextId(),
      userId,
      pattern: input.pattern,
      categoryId: input.categoryId,
      displayAs: input.displayAs ?? null,
      isActive: true,
      createdAt: new Date(),
    }
    categorizationRules.set(rule.id, rule)
    return rule
  },

  async updateCategorizationRule(userId: string, ruleId: string, input: Partial<CreateCategorizationRuleInput & { isActive: boolean }>): Promise<CategorizationRule> {
    const existing = categorizationRules.get(ruleId)
    if (!existing || existing.userId !== userId) throw new Error(`CategorizationRule ${ruleId} not found`)
    const updated = { ...existing, ...input }
    categorizationRules.set(ruleId, updated)
    return updated
  },

  async deleteCategorizationRule(userId: string, ruleId: string): Promise<void> {
    const existing = categorizationRules.get(ruleId)
    if (existing && existing.userId !== userId) return
    categorizationRules.delete(ruleId)
  },

  async applyCategorization(userId: string, description: string): Promise<string | null> {
    const userRules = Array.from(categorizationRules.values()).filter(
      (r) => r.userId === userId && r.isActive
    )
    const lowerDesc = description.toLowerCase()
    for (const rule of userRules) {
      if (lowerDesc.includes(rule.pattern.toLowerCase())) {
        return rule.categoryId
      }
    }
    return null
  },

  async renormalizeTransactions(userId: string): Promise<number> {
    const userRules = Array.from(categorizationRules.values()).filter(
      (r) => r.userId === userId,
    )
    let count = 0
    for (const [id, tx] of transactions) {
      if (tx.userId !== userId || !tx.rawDescription) continue
      const normalized = normalizeDescription(tx.rawDescription, userRules)
      if (normalized !== tx.description) {
        transactions.set(id, { ...tx, description: normalized, updatedAt: new Date() })
        count++
      }
    }
    return count
  },

  async getUniqueDescriptions(userId: string): Promise<string[]> {
    const descs = new Set<string>()
    for (const tx of transactions.values()) {
      if (tx.userId === userId && tx.description) descs.add(tx.description)
    }
    return Array.from(descs).sort((a, b) => a.localeCompare(b))
  },

  async getDashboardData(userId: string): Promise<DashboardData> {
    // An archived account is closed: its history stays, its balance leaves the totals.
    const allAccounts = await this.getAccounts(userId)
    const userAccounts = allAccounts.filter((a) => !a.isArchived)
    const userTransactions = (await this.getTransactions(userId)).data
    const reportTransactions = userTransactions.filter((t) => !t.excludeFromReports)

    const { totalAssets, totalLiabilities, netWorth } = netWorthTotals(userAccounts)

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthTransactions = reportTransactions.filter((t) => t.date >= monthStart)

    const monthlyIncome = monthTransactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + t.amount, 0)
    const monthlyExpenses = monthTransactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + t.amount, 0)

    const userCategories = await this.getCategories(userId)
    const categoryMap = new Map(userCategories.map((c) => [c.id, c]))

    // Group current-month expenses by category (split-aware)
    const categoryTotals = accumulateCategorySpending(monthTransactions.filter((t) => t.type === "expense"))
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
      monthlySummary: (() => {
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const recentTxns = reportTransactions.filter((t) => t.date >= lastMonthStart)
        const monthTotals = new Map<string, { income: number; expenses: number }>()
        for (const t of recentTxns) {
          const month = format(t.date, "yyyy-MM")
          const entry = monthTotals.get(month) ?? { income: 0, expenses: 0 }
          if (t.type === "income") entry.income += t.amount
          if (t.type === "expense") entry.expenses += t.amount
          monthTotals.set(month, entry)
        }
        return Array.from(monthTotals.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, data]) => ({ month, income: data.income, expenses: data.expenses, net: data.income - data.expenses }))
      })(),
      categorySpending,
      recentTransactions: userTransactions.slice(0, 10),
      accounts: allAccounts,
      categories: userCategories,
    }
  },

  // Costs and loans are parsed with the shared zod schemas, standing in for the
  // rules; an update parses the merged document, as the rules read incoming().

  async getDismissedSubscriptionPatterns(userId: string): Promise<DismissedSubscriptionPattern[]> {
    return Array.from(dismissedSubscriptionPatterns.values()).filter((d) => d.userId === userId)
  },

  async createDismissedSubscriptionPattern(
    userId: string,
    input: CreateDismissedSubscriptionPatternInput,
  ): Promise<DismissedSubscriptionPattern> {
    const pattern: DismissedSubscriptionPattern = {
      id: nextId(),
      userId,
      patternKey: input.patternKey,
      dismissedAt: new Date(),
    }
    dismissedSubscriptionPatterns.set(pattern.id, pattern)
    return pattern
  },

  async deleteDismissedSubscriptionPattern(userId: string, id: string): Promise<void> {
    const p = dismissedSubscriptionPatterns.get(id)
    if (p && p.userId === userId) dismissedSubscriptionPatterns.delete(id)
  },
}

export function clearMockFinance() {
  accounts.clear()
  transactions.clear()
  monthlyTotals.clear()
  budgets.clear()
  recurringTransactions.clear()
  savingsGoals.clear()
  netWorthSnapshots.clear()
  tags.clear()
  transactionTags.clear()
  categorizationRules.clear()
  categoryCopies.clear()
  dismissedSubscriptionPatterns.clear()
  idCounter = 0
  seedDefaultCategories()
}

/** The next id from the counter the finance rows share, for a host whose own mock rows (API keys) use it too. */
export const mockId = nextId
