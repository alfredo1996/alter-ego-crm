import { isoDate } from "@alter-ego/kernel/dates"

import type { FinanceAdapter } from "../adapter"
import type {
  Account, Category, Transaction, Budget, SavingsGoal,
  RecurringTransaction, Tag, CategorizationRule, NetWorthSnapshot,
} from "../types"

export const FULL_EXPORT_VERSION = "1.0"

/** Everything needed to back up / port a user's data. */
export interface FullExportData {
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  budgets: Budget[]
  savingsGoals: SavingsGoal[]
  recurringTransactions: RecurringTransaction[]
  tags: Tag[]
  categorizationRules: CategorizationRule[]
  netWorthSnapshots: NetWorthSnapshot[]
}

export interface FullExport extends FullExportData {
  version: string
  exportedAt: string
}

/** Stamp the collected data with a version + timestamp. Pure. */
export function buildFullExport(data: FullExportData, exportedAt: Date): FullExport {
  return { version: FULL_EXPORT_VERSION, exportedAt: exportedAt.toISOString(), ...data }
}

/** File name for a full export, e.g. alter-ego-backup-2026-07-03.json */
export function fullExportFileName(exportedAt: Date): string {
  return `alter-ego-backup-${isoDate(exportedAt)}.json`
}

/** Fetch every collection for a user and assemble the export object. */
export async function fetchFullExport(db: FinanceAdapter, userId: string, exportedAt: Date): Promise<FullExport> {
  const [
    accounts, categories, transactions, budgets, savingsGoals,
    recurringTransactions, tags, categorizationRules, netWorthSnapshots,
  ] = await Promise.all([
    db.getAccounts(userId),
    db.getCategories(userId),
    db.getTransactions(userId).then((r) => r.data),
    db.getBudgets(userId),
    db.getSavingsGoals(userId),
    db.getRecurringTransactions(userId),
    db.getTags(userId),
    db.getCategorizationRules(userId),
    db.getNetWorthHistory(userId, 1200), // effectively "all"
  ])
  return buildFullExport(
    { accounts, categories, transactions, budgets, savingsGoals, recurringTransactions, tags, categorizationRules, netWorthSnapshots },
    exportedAt,
  )
}

/** Trigger a browser download of an object as pretty-printed JSON. */
export function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
