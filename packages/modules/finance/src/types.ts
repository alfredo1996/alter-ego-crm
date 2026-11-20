import type { Currency } from "@alter-ego/kernel/currency"

// ─── Enums ────────────────────────────────────────────────────────────────────

// Built-in types keep autocomplete; `(string & {})` allows user-created custom types.
export type AccountType = "checking" | "savings" | "credit_card" | "cash" | "investment" | "loan" | "other" | (string & {})

/** Only the words for a balance above 0 (yours, or owed to you); net worth follows the balance sign, not the kind. */
export type AccountKind = "asset" | "liability"

export type TransactionType = "income" | "expense" | "transfer"

export type { Currency }

export type AIMode = "off" | "local" | "cloud"

export type TransactionStatus = "pending" | "cleared" | "reconciled"

export type CategoryGroup =
  | "income"
  | "housing"
  | "transportation"
  | "food"
  | "utilities"
  | "healthcare"
  | "personal"
  | "entertainment"
  | "education"
  | "savings"
  | "debt"
  | "other"

// ─── Attachments ────────────────────────────────────────────────────────────

export interface TransactionAttachment {
  id: string
  fileName: string
  mimeType: string
  url: string
  size: number
  uploadedAt: Date
}

// ─── Split Transactions ──────────────────────────────────────────────────────

export interface TransactionSplit {
  id: string
  categoryId: string
  amount: number        // positive, must sum to transaction.amount
  note?: string | null
}

// ─── Core Entities ────────────────────────────────────────────────────────────

export interface Account {
  id: string
  userId: string
  name: string
  type: AccountType
  /** Asset vs liability. Null/absent falls back to the built-in classification of `type`. */
  kind?: AccountKind | null
  currency: Currency
  /** Current balance = openingBalance + sum of transaction effects. */
  balance: number
  /** Starting balance before any transactions. `recalculateBalances` builds on top of this. */
  openingBalance: number
  icon: string | null
  color: string | null
  isArchived: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Transaction {
  id: string
  userId: string
  accountId: string
  type: TransactionType
  amount: number
  currency: Currency
  categoryId: string | null
  description: string
  rawDescription: string | null
  date: Date
  notes: string | null
  tagIds: string[]
  transferToAccountId: string | null
  linkedTransactionId: string | null
  isRecurring: boolean
  splits: TransactionSplit[]  // empty array = single-category (backward compatible)
  attachments: TransactionAttachment[]
  status: TransactionStatus
  importHash: string | null
  excludeFromReports: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Category {
  id: string
  userId: string | null
  name: string
  group: CategoryGroup
  icon: string
  color: string
  parentId: string | null
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

export type BudgetPeriod = "monthly" | "yearly"

export type RolloverMode = "reset" | "surplus" | "deficit" | "full"

export type RecurringFrequency = "daily" | "weekly" | "monthly" | "yearly"

export interface LoanRecurringMeta {
  loanAmount: number       // original principal (homePrice - downPayment)
  annualRate: number       // e.g. 6.5
  termMonths: number       // e.g. 360
  paymentStartMonth: number // 1 for a brand-new loan
}

export interface RecurringTransaction {
  id: string
  userId: string
  accountId: string
  type: "income" | "expense"
  amount: number
  currency: Currency
  categoryId: string | null
  description: string
  notes: string | null
  frequency: RecurringFrequency
  interval: number
  startDate: Date
  endDate: Date | null
  nextDueDate: Date
  isActive: boolean
  loanMeta: LoanRecurringMeta | null
  createdAt: Date
  updatedAt: Date
}

export interface Budget {
  id: string
  userId: string
  name: string
  categoryId: string | null
  amount: number
  currency: Currency
  period: BudgetPeriod
  rolloverMode: RolloverMode
  createdAt: Date
  updatedAt: Date
}

/** What a month spent on expenses: the stored `monthly_totals/{yyyy-MM}` document. */
export interface MonthlyTotal {
  /** Sum of the expense amounts (what a budget without a category counts). */
  total: number
  /** categoryId → amount, splits filed on their own categories. */
  expenseByCategory: Record<string, number>
}

/** yyyy-MM → that month's expenses. */
export type MonthlyTotals = Record<string, MonthlyTotal>

export interface BudgetWithSpending extends Budget {
  spent: number
  remaining: number
  percentage: number
  rolloverAmount: number
  effectiveAmount: number
}

export interface SavingsGoal {
  id: string
  userId: string
  name: string
  targetAmount: number
  currentAmount: number
  currency: Currency
  targetDate: Date | null
  icon: string
  color: string
  isCompleted: boolean
  createdAt: Date
  updatedAt: Date
}

export interface SavingsGoalWithProgress extends SavingsGoal {
  percentage: number
  remaining: number
  daysRemaining: number | null
}

export interface CreateSavingsGoalInput {
  name: string
  targetAmount: number
  currency: Currency
  targetDate?: Date | null
  icon?: string
  color?: string
}

export interface UpdateSavingsGoalInput {
  name?: string
  targetAmount?: number
  currentAmount?: number
  currency?: Currency
  targetDate?: Date | null
  icon?: string
  color?: string
  isCompleted?: boolean
}

// ─── Input Types ──────────────────────────────────────────────────────────────

export interface CreateAccountInput {
  name: string
  type: AccountType
  kind?: AccountKind | null
  currency: Currency
  balance: number
  icon?: string | null
  color?: string | null
}

export interface UpdateAccountInput {
  name?: string
  type?: AccountType
  kind?: AccountKind | null
  currency?: Currency
  balance?: number
  icon?: string | null
  color?: string | null
  isArchived?: boolean
}

export interface CreateTransactionInput {
  accountId: string
  type: TransactionType
  amount: number
  currency: Currency
  categoryId?: string | null
  description: string
  rawDescription?: string | null
  date: Date
  notes?: string | null
  tagIds?: string[]
  transferToAccountId?: string | null
  linkedTransactionId?: string | null
  splits?: TransactionSplit[]
  status?: TransactionStatus
  isRecurring?: boolean
  importHash?: string | null
  excludeFromReports?: boolean
}

export interface UpdateTransactionInput {
  accountId?: string
  type?: TransactionType
  amount?: number
  currency?: Currency
  categoryId?: string | null
  description?: string
  rawDescription?: string | null
  date?: Date
  notes?: string | null
  tagIds?: string[]
  transferToAccountId?: string | null
  linkedTransactionId?: string | null
  splits?: TransactionSplit[]
  status?: TransactionStatus
  isRecurring?: boolean
  excludeFromReports?: boolean
}

export interface CreateBudgetInput {
  name: string
  categoryId?: string | null
  amount: number
  currency: Currency
  period: BudgetPeriod
  rolloverMode?: RolloverMode
}

export interface UpdateBudgetInput {
  name?: string
  categoryId?: string | null
  amount?: number
  currency?: Currency
  period?: BudgetPeriod
  rolloverMode?: RolloverMode
}

export interface CreateRecurringTransactionInput {
  accountId: string
  type: "income" | "expense"
  amount: number
  currency: Currency
  categoryId?: string | null
  description: string
  notes?: string | null
  frequency: RecurringFrequency
  interval?: number
  startDate: Date
  endDate?: Date | null
  loanMeta?: LoanRecurringMeta | null
}

export interface UpdateRecurringTransactionInput {
  accountId?: string
  type?: "income" | "expense"
  amount?: number
  currency?: Currency
  categoryId?: string | null
  description?: string
  notes?: string | null
  frequency?: RecurringFrequency
  interval?: number
  startDate?: Date
  endDate?: Date | null
  nextDueDate?: Date
  isActive?: boolean
  loanMeta?: LoanRecurringMeta | null
}

export interface CreateCategoryInput {
  name: string
  group: CategoryGroup
  icon: string
  color: string
  parentId?: string | null
}

export interface UpdateCategoryInput {
  name?: string
  group?: CategoryGroup
  icon?: string
  color?: string
  parentId?: string | null
}

// ─── Tags ──────────────────────────────────────────────────────────────────────

export interface Tag {
  id: string
  userId: string
  name: string
  color: string
  createdAt: Date
}

export interface CreateTagInput {
  name: string
  color?: string
}

// ─── Categorization Rules ──────────────────────────────────────────────────────

export interface CategorizationRule {
  id: string
  userId: string
  pattern: string
  categoryId: string
  displayAs: string | null
  isActive: boolean
  createdAt: Date
}

export interface CreateCategorizationRuleInput {
  pattern: string
  categoryId: string
  displayAs?: string | null
}

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  data: T[]
  total: number
  limit: number
  offset: number
}

// ─── Filters ──────────────────────────────────────────────────────────────────

export interface TransactionFilters {
  accountId?: string
  type?: TransactionType
  categoryId?: string
  dateFrom?: Date
  dateTo?: Date
  minAmount?: number
  maxAmount?: number
  search?: string
  uncategorized?: boolean
  status?: TransactionStatus
  hasNote?: boolean
  tagIds?: string[]
  limit?: number
  offset?: number
  /** With `limit`: skip the count of the whole collection (`total` is then the rows returned). */
  skipCount?: boolean
}

// ─── Report Types ────────────────────────────────────────────────────────────

export type ReportPeriod = "this-month" | "last-month" | "last-3-months" | "last-6-months" | "this-year"

export type AnalysisPeriod =
  | { mode: "monthly"; year: number; month: number }   // specific calendar month
  | { mode: "yearly"; year: number }                    // full calendar year
  | { mode: "last12months" }                            // rolling 12-month window
  | { mode: "rolling"; months: 3 | 6 | 12 }            // rolling N months
  | { mode: "custom"; from: Date; to: Date }            // free-form date range

export interface ReportData {
  categorySpending: CategorySpending[]
  monthlySummary: MonthlySummary[]
  totalIncome: number
  totalExpenses: number
  netSavings: number
  topExpenses: Transaction[]
}

// ─── Dashboard Aggregations ───────────────────────────────────────────────────

export interface AccountBalance {
  accountId: string
  accountName: string
  balance: number
  currency: Currency
  type: AccountType
}

export interface MonthlySummary {
  month: string
  income: number
  expenses: number
  net: number
}

export interface CategorySpending {
  categoryId: string
  categoryName: string
  categoryIcon: string
  categoryColor: string
  amount: number
  percentage: number
}

export interface DashboardData {
  totalAssets: number
  totalLiabilities: number
  netWorth: number
  monthlyIncome: number
  monthlyExpenses: number
  monthlySavingsRate: number
  accountBalances: AccountBalance[]
  monthlySummary: MonthlySummary[]
  categorySpending: CategorySpending[]
  recentTransactions: Transaction[]
  /** Every account, archived included, as `getAccounts` returns them: the page seeds its own cache with it. */
  accounts: Account[]
  /** The categories read for the spending figures, as `getCategories` returns them. */
  categories: Category[]
}

export interface NetWorthSnapshot {
  id: string
  userId: string
  date: Date
  totalAssets: number
  totalLiabilities: number
  netWorth: number
}

// ─── Subscription Detector Types ─────────────────────────────────────────────

export interface DismissedSubscriptionPattern {
  id: string
  userId: string
  patternKey: string
  dismissedAt: Date
}

export interface CreateDismissedSubscriptionPatternInput {
  patternKey: string
}

export interface SuspectedSubscription {
  /** Stable pattern key — also used as React key and dismiss key */
  id: string
  merchantName: string
  accountId: string
  estimatedAmount: number
  currency: Currency
  cadence: "weekly" | "monthly" | "yearly"
  interval: number
  observationCount: number
  firstSeen: Date
  lastSeen: Date
  daysSinceLastSeen: number
  /** True when lastSeen > 1.5 × medianGap ago */
  looksCancelled: boolean
  confidence: "high" | "medium" | "low"
  /** Source transaction IDs — the observations */
  transactionIds: string[]
  /** Most common categoryId across observations; null if all uncategorized */
  suggestedCategoryId: string | null
  /** Prefill for Mark-as-recurring dialog: lastSeen + medianGap */
  suggestedStartDate: Date
  /** Median interval in days — exposed for dialog prefill */
  medianGap: number
}
