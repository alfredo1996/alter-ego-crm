import { z } from "./lib/zod"

// ─── Enum Schemas ────────────────────────────────────────────────────────────

// Free-form: built-in types plus any user-created custom type.
/** A document id is one path segment: a "/" would nest a document or break the path. */
export const idSchema = (required = "Id is required") =>
  z.string().min(1, required).refine((v) => !v.includes("/"), "Invalid id")

/** A list filter: an empty value means no filter, so only the slash is refused. */
const filterIdSchema = z.string().refine((v) => !v.includes("/"), "Invalid id")

export const accountTypeSchema = z.string().trim().min(1, "Account type is required").max(50)

export const accountKindSchema = z.enum(["asset", "liability"])

export const transactionTypeSchema = z.enum(["income", "expense", "transfer"])

export const currencySchema = z.enum([
  "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "MXN", "BRL", "ARS",
])

export const aiModeSchema = z.enum(["off", "local", "cloud"])

export const transactionStatusSchema = z.enum(["pending", "cleared", "reconciled"])

export const categoryGroupSchema = z.enum([
  "income", "housing", "transportation", "food", "utilities", "healthcare",
  "personal", "entertainment", "education", "savings", "debt", "other",
])

// ─── Transaction Split Schema ────────────────────────────────────────────────

// Request-array caps: unbounded arrays let one account holder exhaust the instance (#345).
const MAX_SPLITS = 100
const MAX_TAG_IDS = 100

export const transactionSplitSchema = z.object({
  id: z.string().min(1),
  categoryId: idSchema(),
  amount: z.number().positive("Split amount must be positive").finite(),
  note: z.string().max(500).nullish(),
})

// ─── Input Schemas ───────────────────────────────────────────────────────────

export const createAccountSchema = z.object({
  name: z.string().min(1, "Account name is required").max(100),
  type: accountTypeSchema,
  kind: accountKindSchema.nullish(),
  currency: currencySchema,
  balance: z.number().finite(),
  icon: z.string().nullish(),
  color: z.string().nullish(),
})

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: accountTypeSchema.optional(),
  kind: accountKindSchema.nullish(),
  currency: currencySchema.optional(),
  balance: z.number().finite().optional(),
  icon: z.string().nullish(),
  color: z.string().nullish(),
  isArchived: z.boolean().optional(),
})

export const createTransactionSchema = z.object({
  accountId: idSchema("Account is required"),
  type: transactionTypeSchema,
  amount: z.number().positive("Amount must be positive").finite(),
  currency: currencySchema,
  categoryId: idSchema().optional(),
  description: z.string().min(1, "Description is required").max(500),
  date: z.date(),
  notes: z.string().max(1000).optional(),
  transferToAccountId: idSchema().optional(),
  rawDescription: z.string().nullable().optional(),
  linkedTransactionId: idSchema().nullable().optional(),
  splits: z.array(transactionSplitSchema).max(MAX_SPLITS).optional(),
  status: transactionStatusSchema.optional(),
  isRecurring: z.boolean().optional(),
  importHash: z.string().nullable().optional(),
  excludeFromReports: z.boolean().optional(),
})

export const updateTransactionSchema = z.object({
  accountId: idSchema().optional(),
  type: transactionTypeSchema.optional(),
  amount: z.number().positive().finite().optional(),
  currency: currencySchema.optional(),
  categoryId: idSchema().nullish(),
  description: z.string().min(1).max(500).optional(),
  date: z.date().optional(),
  notes: z.string().max(1000).nullish(),
  transferToAccountId: idSchema().nullish(),
  linkedTransactionId: idSchema().nullable().optional(),
  splits: z.array(transactionSplitSchema).max(MAX_SPLITS).optional(),
  status: transactionStatusSchema.optional(),
  isRecurring: z.boolean().optional(),
  excludeFromReports: z.boolean().optional(),
})

export const budgetPeriodSchema = z.enum(["monthly", "yearly"])

export const rolloverModeSchema = z.enum(["reset", "surplus", "deficit", "full"])

export const createBudgetSchema = z.object({
  name: z.string().min(1, "Budget name is required").max(100),
  categoryId: idSchema().nullish(),
  amount: z.number().positive("Amount must be positive").finite(),
  currency: currencySchema,
  period: budgetPeriodSchema,
  rolloverMode: rolloverModeSchema.optional(),
})

export const updateBudgetSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  categoryId: idSchema().nullish(),
  amount: z.number().positive().finite().optional(),
  currency: currencySchema.optional(),
  period: budgetPeriodSchema.optional(),
  rolloverMode: rolloverModeSchema.optional(),
})

export const createCategorySchema = z.object({
  name: z.string().min(1, "Category name is required").max(100),
  group: categoryGroupSchema,
  icon: z.string().min(1),
  color: z.string().min(1),
  parentId: idSchema().nullish(),
})

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  group: categoryGroupSchema.optional(),
  icon: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  parentId: idSchema().nullish(),
})

export const recurringFrequencySchema = z.enum(["daily", "weekly", "monthly", "yearly"])

export const createRecurringTransactionSchema = z.object({
  accountId: idSchema("Account is required"),
  type: z.enum(["income", "expense"]),
  amount: z.number().positive("Amount must be positive").finite(),
  currency: currencySchema,
  categoryId: idSchema().nullish(),
  description: z.string().min(1, "Description is required").max(500),
  notes: z.string().max(1000).nullish(),
  frequency: recurringFrequencySchema,
  interval: z.number().int().positive(),
  startDate: z.date(),
  endDate: z.date().nullish(),
})

export const updateRecurringTransactionSchema = z.object({
  accountId: idSchema().optional(),
  type: z.enum(["income", "expense"]).optional(),
  amount: z.number().positive().finite().optional(),
  currency: currencySchema.optional(),
  categoryId: idSchema().nullish(),
  description: z.string().min(1).max(500).optional(),
  notes: z.string().max(1000).nullish(),
  frequency: recurringFrequencySchema.optional(),
  interval: z.number().int().positive().optional(),
  startDate: z.date().optional(),
  endDate: z.date().nullish(),
  nextDueDate: z.date().optional(),
  isActive: z.boolean().optional(),
})

export const transactionFiltersSchema = z.object({
  accountId: filterIdSchema.optional(),
  type: transactionTypeSchema.optional(),
  categoryId: filterIdSchema.optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  minAmount: z.number().optional(),
  maxAmount: z.number().optional(),
  search: z.string().optional(),
  uncategorized: z.boolean().optional(),
  hasNote: z.boolean().optional(),
  tagIds: z.array(idSchema()).max(MAX_TAG_IDS).optional(),
})

// ─── API Schemas ─────────────────────────────────────────────────────────────

/**
 * A transfer must name a destination distinct from its source. Without this the
 * source is debited and nothing is credited — see `assertLedgerValid`, which is
 * the backstop in the adapters. This copy exists so the transaction form and
 * `/api/v1/transactions` report it as a field error rather than a thrown 500.
 *
 * Applied after `.omit()`/`.extend()`, never before: `superRefine` returns a
 * ZodEffects, which has neither method.
 */
export function refineTransfer(
  data: { type?: string; accountId?: string; transferToAccountId?: string | null },
  ctx: z.RefinementCtx,
) {
  if (data.type !== "transfer") return
  if (!data.transferToAccountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transferToAccountId"],
      message: "Select the destination account",
    })
    return
  }
  if (data.transferToAccountId === data.accountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transferToAccountId"],
      message: "Source and destination must differ",
    })
  }
}

export const apiCreateTransactionSchema = createTransactionSchema
  .extend({
    date: z.coerce.date(),
    categoryId: idSchema().nullish(),
    tagIds: z.array(idSchema()).max(MAX_TAG_IDS).optional(),
  })
  .superRefine(refineTransfer)

// Query-string flag: z.coerce.boolean() reads "false" as true.
const queryFlag = z.enum(["true", "false"]).transform((v) => v === "true")

export const apiTransactionFiltersSchema = z.object({
  accountId: filterIdSchema.optional(),
  type: transactionTypeSchema.optional(),
  categoryId: filterIdSchema.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  search: z.string().optional(),
  uncategorized: queryFlag.optional(),
  hasNote: queryFlag.optional(),
  tagIds: z
    .string()
    .transform((s) => s.split(","))
    .pipe(z.array(z.string()).max(MAX_TAG_IDS))
    .optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const createTagSchema = z.object({
  name: z.string().min(1, "Tag name is required").max(50),
  color: z.string().min(1),
})

export const createCategorizationRuleSchema = z.object({
  pattern: z.string().min(1, "Pattern is required").max(200),
  categoryId: idSchema("Category is required"),
  displayAs: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
})

export const updateSavingsGoalSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  targetAmount: z.number().positive().finite().optional(),
  currentAmount: z.number().min(0).finite().optional(),
  currency: currencySchema.optional(),
  targetDate: z.date().nullish(),
  icon: z.string().optional(),
  color: z.string().optional(),
})

export const loanRecurringMetaSchema = z.object({
  principalAmount: z.number().min(0).finite(),
  annualRate: z.number().min(0).finite(),
  termMonths: z.number().int().positive(),
  startDate: z.string(),
})

// ─── Form Schemas (subset for UI forms that don't expose all fields) ────────

export const transactionFormSchema = createTransactionSchema
  .omit({ currency: true })
  .superRefine(refineTransfer)

export const createSavingsGoalSchema = z.object({
  name: z.string().min(1, "Goal name is required").max(100),
  targetAmount: z.number().positive("Target must be positive").finite(),
  currency: currencySchema,
  targetDate: z.date().nullable().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
})

// ─── CSV Export Schemas ──────────────────────────────────────────────────────

export const apiTransactionsExportSchema = z
  .object({
    dateFrom: z.coerce.date(),
    dateTo: z.coerce.date(),
    expandSplits: queryFlag.optional().default(false),
  })
  .refine((data) => data.dateFrom <= data.dateTo, {
    message: "dateFrom must be <= dateTo",
    path: ["dateFrom"],
  })

// ─── Subscription Detector Schemas ───────────────────────────────────────────

export const createDismissedSubscriptionPatternSchema = z.object({
  patternKey: z.string().min(1),
})

// ─── Reports API Schema ──────────────────────────────────────────────────────

export const reportPeriodShortcutSchema = z.enum([
  "this-month",
  "last-month",
  "last-3-months",
  "last-6-months",
  "this-year",
  "last-12-months",
])

export const apiReportsQuerySchema = z
  .object({
    period: reportPeriodShortcutSchema.optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    accountIds: z
      .string()
      .transform((s) => s.split(",").filter(Boolean))
      .optional(),
    categoryIds: z
      .string()
      .transform((s) => s.split(",").filter(Boolean))
      .optional(),
  })
  .refine((data) => !!data.period || (!!data.dateFrom && !!data.dateTo), {
    message: "Either `period` or both `dateFrom` and `dateTo` are required",
  })
  .refine((data) => !data.dateFrom || !data.dateTo || data.dateFrom <= data.dateTo, {
    message: "dateFrom must be <= dateTo",
    path: ["dateFrom"],
  })

// ─── Form Value Types (inferred from schemas) ────────────────────────────────

export type AccountFormValues = z.infer<typeof createAccountSchema>
export type TransactionFormValues = z.infer<typeof transactionFormSchema>
export type CategoryFormValues = z.infer<typeof createCategorySchema>
