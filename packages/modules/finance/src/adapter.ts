import type {
  Account,
  Transaction,
  PaginatedResult,
  Category,
  Budget,
  RecurringTransaction,
  SavingsGoal,
  NetWorthSnapshot,
  Tag,
  CategorizationRule,
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
  MonthlyTotals,
  DashboardData,
  ReportData,
  DismissedSubscriptionPattern,
  CreateDismissedSubscriptionPatternInput,
} from "./types"

/**
 * What finance needs from a database. The app's `DatabaseAdapter` adds what is not finance (API keys);
 * the adapters themselves are implemented by the app, not by this package.
 */
export interface FinanceAdapter {
  // Accounts
  getAccounts(userId: string): Promise<Account[]>
  getAccount(userId: string, accountId: string): Promise<Account | null>
  createAccount(userId: string, input: CreateAccountInput): Promise<Account>
  updateAccount(userId: string, accountId: string, input: UpdateAccountInput): Promise<Account>
  deleteAccount(userId: string, accountId: string): Promise<void>

  // Transactions
  getTransactions(userId: string, filters?: TransactionFilters): Promise<PaginatedResult<Transaction>>
  /**
   * The newest transaction date of each account, an incoming transfer counted; null for an
   * account with none. One bounded read per account (limit 1), not the ledger.
   */
  getLastActivity(userId: string, accountIds: string[]): Promise<Record<string, Date | null>>
  getTransaction(userId: string, transactionId: string): Promise<Transaction | null>
  createTransaction(userId: string, input: CreateTransactionInput): Promise<Transaction>
  updateTransaction(userId: string, transactionId: string, input: UpdateTransactionInput): Promise<Transaction>
  deleteTransaction(userId: string, transactionId: string): Promise<void>
  deleteTransactions(userId: string, transactionIds: string[]): Promise<void>
  deleteAllTransactions(userId: string): Promise<void>
  /**
   * Expense totals per month, `fromMonth` to `toMonth` inclusive ("yyyy-MM"), read from the
   * stored `monthly_totals` documents. A month with no complete document is computed once from
   * its transactions and stored (a missing month heals itself), so every month in the range
   * is in the result. Every transaction write keeps these in step, in the same batch.
   */
  getMonthlyTotals(userId: string, fromMonth: string, toMonth: string): Promise<MonthlyTotals>
  /**
   * Start from zero: delete every account and what hangs off one — transactions,
   * recurring transactions, balance and net-worth history. Categories, tags,
   * budgets, rules and API keys stay.
   */
  deleteAllAccountData(userId: string): Promise<void>
  /** All non-null importHashes for the user — used to detect already-imported rows. */
  getImportHashes(userId: string): Promise<string[]>
  recalculateBalances(userId: string): Promise<void>

  // Categories
  getCategories(userId: string): Promise<Category[]>
  getCategory(userId: string, categoryId: string): Promise<Category | null>
  createCategory(userId: string, input: CreateCategoryInput): Promise<Category>
  updateCategory(userId: string, categoryId: string, input: UpdateCategoryInput): Promise<Category>
  deleteCategory(userId: string, categoryId: string): Promise<void>
  /** Delete all of the user's custom categories, leaving only defaults (factory reset). */
  deleteAllCategories(userId: string): Promise<void>

  // Budgets
  getBudgets(userId: string): Promise<Budget[]>
  getBudget(userId: string, budgetId: string): Promise<Budget | null>
  createBudget(userId: string, input: CreateBudgetInput): Promise<Budget>
  updateBudget(userId: string, budgetId: string, input: UpdateBudgetInput): Promise<Budget>
  deleteBudget(userId: string, budgetId: string): Promise<void>

  // Savings goals
  getSavingsGoals(userId: string): Promise<SavingsGoal[]>
  getSavingsGoal(userId: string, goalId: string): Promise<SavingsGoal | null>
  createSavingsGoal(userId: string, input: CreateSavingsGoalInput): Promise<SavingsGoal>
  updateSavingsGoal(userId: string, goalId: string, input: UpdateSavingsGoalInput): Promise<SavingsGoal>
  deleteSavingsGoal(userId: string, goalId: string): Promise<void>

  // Recurring transactions
  getRecurringTransactions(userId: string): Promise<RecurringTransaction[]>
  getRecurringTransaction(userId: string, recurringId: string): Promise<RecurringTransaction | null>
  createRecurringTransaction(userId: string, input: CreateRecurringTransactionInput): Promise<RecurringTransaction>
  updateRecurringTransaction(userId: string, recurringId: string, input: UpdateRecurringTransactionInput): Promise<RecurringTransaction>
  deleteRecurringTransaction(userId: string, recurringId: string): Promise<void>
  generateDue(userId: string, upToDate: Date): Promise<Transaction[]>
  getRecurringHistory(userId: string, recurringId: string): Promise<Transaction[]>

  // Net worth history
  takeSnapshot(userId: string): Promise<NetWorthSnapshot>
  getNetWorthHistory(userId: string, months?: number): Promise<NetWorthSnapshot[]>
  /** The newest snapshot dated on or before the end of `date`'s local day; null with none. One bounded read. */
  getNetWorthAt(userId: string, date: Date): Promise<NetWorthSnapshot | null>

  // Tags
  getTags(userId: string): Promise<Tag[]>
  createTag(userId: string, input: CreateTagInput): Promise<Tag>
  deleteTag(userId: string, tagId: string): Promise<void>

  // Categorization rules
  getCategorizationRules(userId: string): Promise<CategorizationRule[]>
  createCategorizationRule(userId: string, input: CreateCategorizationRuleInput): Promise<CategorizationRule>
  updateCategorizationRule(userId: string, ruleId: string, input: Partial<CreateCategorizationRuleInput & { isActive: boolean }>): Promise<CategorizationRule>
  deleteCategorizationRule(userId: string, ruleId: string): Promise<void>
  applyCategorization(userId: string, description: string): Promise<string | null>
  renormalizeTransactions(userId: string): Promise<number>

  // Autocomplete
  getUniqueDescriptions(userId: string): Promise<string[]>

  // Dashboard
  getDashboardData(userId: string): Promise<DashboardData>

  // Reports
  getReportData(
    userId: string,
    dateRange: { from: Date; to: Date },
    filters?: { accountIds?: string[]; categoryIds?: string[] }
  ): Promise<ReportData>

  // Dismissed subscription patterns
  getDismissedSubscriptionPatterns(userId: string): Promise<DismissedSubscriptionPattern[]>
  createDismissedSubscriptionPattern(userId: string, input: CreateDismissedSubscriptionPatternInput): Promise<DismissedSubscriptionPattern>
  deleteDismissedSubscriptionPattern(userId: string, id: string): Promise<void>
}

/** The one AI call finance makes: a category for a description, or null. */
export interface FinanceAI {
  categorize(description: string): Promise<{ categoryId: string; confidence: number } | null>
}
