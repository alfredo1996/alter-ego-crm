"use client"

import { formatDate } from "@alter-ego/kernel/dates"
import { Badge } from "@alter-ego/ui/ui/badge"
import { Button } from "@alter-ego/ui/ui/button"
import { Checkbox } from "@alter-ego/ui/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alter-ego/ui/ui/select"
import { cn } from "@alter-ego/ui/utils"
import { useQueryClient } from "@tanstack/react-query"
import { format as fmtDate } from "date-fns"
import {
  Upload,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Plus,
  FileText,
  ArrowRight,
} from "lucide-react"
import { useState, useRef, useCallback } from "react"


import { useAccounts } from "../../hooks/use-accounts"
import { useCategories } from "../../hooks/use-categories"
import { useAuth } from "../../host"
import { getBackend } from "../../host"
import { partitionByImportHash } from "../../lib/import-dedup"
import {
  parseMoneyManagerCSV,
  inferAccountType,
  matchAccountName,
  matchCategoryName,
  computeMMImportHashes,
  resolveLedger,
} from "../../lib/money-manager-import"
import { useImportStore } from "../../stores/import-store"

import type { ParseResult, ResolvedAccount, ResolvedCategory } from "../../lib/money-manager-import"
import type { AccountType, CategoryGroup } from "../../types"

// ─── Constants ────────────────────────────────────────────────────────────────

type Step = "upload" | "reconcile" | "preview" | "import"

const ACCOUNT_TYPES: AccountType[] = [
  "checking", "savings", "credit_card", "cash", "investment", "loan", "other",
]

const CATEGORY_GROUPS: CategoryGroup[] = [
  "income", "housing", "transportation", "food", "utilities",
  "healthcare", "personal", "entertainment", "education", "savings", "debt", "other",
]

// ─── Component ────────────────────────────────────────────────────────────────

interface MMImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ImportDuplicate {
  date: Date
  accountName: string
  amount: number
  description: string
}

export function MMImportDialog({ open, onOpenChange }: MMImportDialogProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const importStore = useImportStore()
  const { data: existingAccounts } = useAccounts(user?.id)
  const { data: existingCategories } = useCategories(user?.id)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>("upload")
  const [fileName, setFileName] = useState("")
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [accountMappings, setAccountMappings] = useState<ResolvedAccount[]>([])
  const [categoryMappings, setCategoryMappings] = useState<ResolvedCategory[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [totalProcessed, setTotalProcessed] = useState(0)
  // Completion is its own fact, not something to infer from the counter: an
  // import where every row is a duplicate processes nothing and is still done.
  const [finished, setFinished] = useState(false)
  const [importFailed, setImportFailed] = useState(0)
  const [duplicateRows, setDuplicateRows] = useState<ImportDuplicate[]>([])
  const [reimportDuplicates, setReimportDuplicates] = useState(false)

  // ── Reset ─────────────────────────────────────────────────────────────────

  function reset() {
    setStep("upload")
    setFileName("")
    setParseResult(null)
    setParseError(null)
    setAccountMappings([])
    setCategoryMappings([])
    setProgress(null)
    setTotalProcessed(0)
    setFinished(false)
    setImportFailed(0)
    setDuplicateRows([])
    setReimportDuplicates(false)
  }

  function handleClose(v: boolean) {
    // Keep state only while an import is actually running. Skipping the reset
    // for the whole import step meant reopening the dialog after a finished
    // run landed back on the completion screen, with no way to upload again.
    if (!v && progress === null) reset()
    onOpenChange(v)
  }

  // ── Step 1: Upload ────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError(null)
    setParseResult(null)

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const result = parseMoneyManagerCSV(text)

      if (result.rows.length === 0 && result.errors.length > 0) {
        setParseError(result.errors[0].message)
        return
      }
      setParseResult(result)
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  // ── Step 2: Build reconciliation mappings ─────────────────────────────────

  const buildMappings = useCallback(() => {
    if (!parseResult) return

    const accounts: ResolvedAccount[] = parseResult.accountNames.map((sourceName) => {
      const existingId = matchAccountName(sourceName, existingAccounts ?? [])
      const matched = existingAccounts?.find((a) => a.id === existingId)

      // Reconstruct display name from normalized (capitalize each word)
      const displayName = sourceName
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")

      return {
        sourceName,
        displayName: matched ? matched.name : displayName,
        existingId,
        type: matched ? matched.type : inferAccountType(sourceName),
        enabled: true,
      }
    })

    const categories: ResolvedCategory[] = parseResult.categoryNames.map((sourceName) => {
      const existingId = matchCategoryName(sourceName, existingCategories ?? [])
      const matched = existingCategories?.find((c) => c.id === existingId)

      return {
        sourceName,
        displayName: matched ? matched.name : sourceName.trim(),
        existingId,
        group: matched ? matched.group : "other",
      }
    })

    setAccountMappings(accounts)
    setCategoryMappings(categories)
  }, [parseResult, existingAccounts, existingCategories])

  function handleProceedToReconcile() {
    buildMappings()
    setStep("reconcile")
  }

  // ── Step 4: Import (idempotent) ───────────────────────────────────────────

  async function handleImport() {
    if (!user || !parseResult) return
    setStep("import")

    const db = getBackend().db
    // Maps: sourceName (normalized) → resolved account/category ID
    const accountIdMap = new Map<string, string>()
    const categoryIdMap = new Map<string, string>()

    // Layer 1: Accounts — lookup-before-create (idempotent), only enabled
    for (const mapping of accountMappings) {
      if (!mapping.enabled) continue
      if (mapping.existingId) {
        accountIdMap.set(mapping.sourceName, mapping.existingId)
      } else {
        const created = await db.createAccount(user.id, {
          name: mapping.displayName,
          type: mapping.type,
          currency: "EUR",
          balance: 0,
        })
        accountIdMap.set(mapping.sourceName, created.id)
      }
    }
    // Invalidate accounts cache after batch creates
    queryClient.invalidateQueries({ queryKey: ["accounts", user.id] })

    // Layer 2: Categories — lookup-before-create (idempotent)
    for (const mapping of categoryMappings) {
      if (mapping.existingId) {
        categoryIdMap.set(mapping.sourceName, mapping.existingId)
      } else {
        const created = await db.createCategory(user.id, {
          name: mapping.displayName,
          group: mapping.group,
          icon: "HelpCircle",
          color: "#6b7280",
        })
        categoryIdMap.set(mapping.sourceName, created.id)
      }
    }
    // Invalidate categories cache after batch creates
    queryClient.invalidateQueries({ queryKey: ["categories", user.id] })

    // Layer 3: Transactions — importHash dedup, computed up-front so we can
    // SHOW which rows are duplicates instead of silently dropping them.
    // Hashes cover the whole file so occurrence numbering doesn't depend on
    // which accounts are enabled; then keep rows that touch an imported account.
    const hashes = await computeMMImportHashes(parseResult.rows)
    const rowsWithHash = parseResult.rows
      .map((row, i) => ({ row, hash: hashes[i] }))
      .filter(({ row }) => resolveLedger(row, accountIdMap) !== null)
    // When reimportDuplicates is on, don't treat already-imported rows as
    // duplicates (empty existing set). In-file dedup still applies.
    const existingHashes = reimportDuplicates
      ? new Set<string>()
      : new Set(await db.getImportHashes(user.id))
    const { newItems: newRows, duplicates } = partitionByImportHash(rowsWithHash, existingHashes)
    setDuplicateRows(
      duplicates.map((row) => ({
        date: row.date,
        accountName: row.accountName,
        amount: row.amount,
        description: row.description,
      })),
    )

    setProgress({ done: 0, total: newRows.length })
    importStore.setActive({ label: "Importing transactions...", done: 0, total: newRows.length })

    const BATCH_SIZE = 50
    let done = 0
    let failed = 0

    for (let start = 0; start < newRows.length; start += BATCH_SIZE) {
      const batch = newRows.slice(start, start + BATCH_SIZE)
      await Promise.all(
        batch.map(async ({ row, hash }) => {
          try {
            const ledger = resolveLedger(row, accountIdMap)
            if (!ledger) return

            const categoryId = row.categoryName
              ? (categoryIdMap.get(row.categoryName) ?? null)
              : null

            await db.createTransaction(user.id, {
              ...ledger,
              amount: row.amount,
              currency: row.currency,
              description: row.description.trim(),
              date: row.date,
              notes: row.notes,
              categoryId,
              importHash: hash,
              excludeFromReports: row.excludeFromReports,
            })
          } catch (err) {
            console.error("[MM Import] Transaction failed:", row.description, err)
            failed++
          }
        }),
      )
      done += batch.length
      setProgress({ done, total: newRows.length })
      importStore.update(done)
    }

    setImportFailed(failed)
    importStore.setActive(null)

    // Recalculate account balances from transaction ledger
    await db.recalculateBalances(user.id)

    // Invalidate caches once after all transactions are imported
    queryClient.invalidateQueries({ queryKey: ["transactions", user.id] })
    queryClient.invalidateQueries({ queryKey: ["dashboard", user.id] })
    queryClient.invalidateQueries({ queryKey: ["accounts", user.id] })

    setTotalProcessed(newRows.length)
    setProgress(null)
    setFinished(true)
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const steps: Step[] = ["upload", "reconcile", "preview", "import"]
  const stepLabels: Record<Step, string> = {
    upload: "Upload",
    reconcile: "Reconcile",
    preview: "Preview",
    import: "Import",
  }
  const enabledAccounts = accountMappings.filter((a) => a.enabled)
  // Names stand in for ids here: the preview only needs to know which accounts are imported.
  const enabledAccountIds = new Map(enabledAccounts.map((a) => [a.sourceName, a.sourceName]))
  const newAccounts = accountMappings.filter((a) => !a.existingId && a.enabled)
  const newCategories = categoryMappings.filter((c) => !c.existingId)
  const disabledCount = accountMappings.length - enabledAccounts.length
  // Each row as it will be saved: a transfer to a skipped account shows as the expense it becomes.
  const filteredRows = (parseResult?.rows ?? []).flatMap((row) => {
    const ledger = resolveLedger(row, enabledAccountIds)
    return ledger ? [{ ...row, type: ledger.type }] : []
  })
  const isDone = step === "import" && finished

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Import from Money Manager</DialogTitle>
          <DialogDescription>
            {step === "upload" && "Upload your Money Manager CSV export to import transactions."}
            {step === "reconcile" && "Review accounts and categories found in your export."}
            {step === "preview" && "Review parsed transactions before importing."}
            {step === "import" && (isDone ? "Import complete." : "Importing transactions…")}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {steps.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              <span className={cn("transition-colors", step === s && "font-semibold text-foreground")}>
                {i + 1}. {stepLabels[s]}
              </span>
            </span>
          ))}
        </div>

        {/* ── Step 1: Upload ──────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="flex-1 space-y-4 overflow-y-auto">
            <div
              className={cn(
                "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors",
                parseResult
                  ? "border-primary/40 bg-primary/5"
                  : parseError
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50",
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              {parseResult ? (
                <>
                  <FileText className="h-8 w-8 text-primary" />
                  <div className="text-center">
                    <p className="text-sm font-medium">{fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {parseResult.rows.length} transactions · {parseResult.accountNames.length} accounts · {parseResult.categoryNames.length} categories
                    </p>
                    {(parseResult.errors.length > 0 || parseResult.skippedIngresso > 0) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {parseResult.skippedIngresso > 0 && (
                          <span>{parseResult.skippedIngresso} duplicate transfer row{parseResult.skippedIngresso !== 1 ? "s" : ""} removed</span>
                        )}
                        {parseResult.errors.length > 0 && (
                          <span className="text-amber-600">
                            {parseResult.skippedIngresso > 0 ? " · " : ""}
                            {parseResult.errors.length} parse error{parseResult.errors.length !== 1 ? "s" : ""}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    Money Manager format detected
                  </Badge>
                </>
              ) : parseError ? (
                <>
                  <XCircle className="h-8 w-8 text-destructive" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-destructive">Not a Money Manager file</p>
                    <p className="text-xs text-muted-foreground">{parseError}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      For other CSV formats, use the generic Import CSV button.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium">Click to upload Money Manager CSV</p>
                    <p className="text-xs text-muted-foreground">
                      Export from Money Manager → Settings → Export Data
                    </p>
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* ── Step 2: Reconcile ───────────────────────────────────────── */}
        {step === "reconcile" && (
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {/* Accounts */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">
                Accounts
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {enabledAccounts.length} selected · {newAccounts.length} new
                  {disabledCount > 0 && ` · ${disabledCount} skipped`}
                </span>
              </h3>
              <p className="text-xs text-muted-foreground">
                Uncheck accounts you don&apos;t want to import.
              </p>
              <div className="space-y-2">
                {accountMappings.map((mapping) => (
                  <ReconcileRow
                    key={mapping.sourceName}
                    sourceName={mapping.sourceName}
                    isNew={!mapping.existingId}
                    displayName={mapping.displayName}
                    enabled={mapping.enabled}
                    onEnabledChange={(v) =>
                      setAccountMappings((prev) =>
                        prev.map((m) => m.sourceName === mapping.sourceName ? { ...m, enabled: v } : m)
                      )
                    }
                    onDisplayNameChange={(v) =>
                      setAccountMappings((prev) =>
                        prev.map((m) => m.sourceName === mapping.sourceName ? { ...m, displayName: v } : m)
                      )
                    }
                    selectValue={mapping.type}
                    onSelectChange={(v) =>
                      setAccountMappings((prev) =>
                        prev.map((m) => m.sourceName === mapping.sourceName ? { ...m, type: v as AccountType } : m)
                      )
                    }
                    selectOptions={ACCOUNT_TYPES.map((t) => ({ value: t, label: t.replace("_", " ") }))}
                    selectPlaceholder="Account type"
                  />
                ))}
              </div>
            </div>

            {/* Categories */}
            {categoryMappings.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">
                  Categories
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {categoryMappings.length - newCategories.length} matched · {newCategories.length} new
                  </span>
                </h3>
                <div className="space-y-2">
                  {categoryMappings.map((mapping) => (
                    <ReconcileRow
                      key={mapping.sourceName}
                      sourceName={mapping.sourceName}
                      isNew={!mapping.existingId}
                      displayName={mapping.displayName}
                      onDisplayNameChange={(v) =>
                        setCategoryMappings((prev) =>
                          prev.map((m) => m.sourceName === mapping.sourceName ? { ...m, displayName: v } : m)
                        )
                      }
                      selectValue={mapping.group}
                      onSelectChange={(v) =>
                        setCategoryMappings((prev) =>
                          prev.map((m) => m.sourceName === mapping.sourceName ? { ...m, group: v as CategoryGroup } : m)
                        )
                      }
                      selectOptions={CATEGORY_GROUPS.map((g) => ({ value: g, label: g }))}
                      selectPlaceholder="Group"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Preview ─────────────────────────────────────────── */}
        {step === "preview" && parseResult && (
          <div className="flex-1 space-y-3 overflow-y-auto">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border p-2">
                <p className="text-lg font-bold">{filteredRows.length}</p>
                <p className="text-xs text-muted-foreground">Transactions</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-lg font-bold">
                  {filteredRows.filter((r) => r.type === "transfer").length}
                </p>
                <p className="text-xs text-muted-foreground">Transfers</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-lg font-bold">{parseResult.errors.length}</p>
                <p className="text-xs text-muted-foreground text-amber-600">Skipped</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-md border text-xs">
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-muted/90">
                    <tr className="border-b">
                      <th className="px-2 py-1.5 text-left font-medium">Date</th>
                      <th className="px-2 py-1.5 text-left font-medium">Account</th>
                      <th className="px-2 py-1.5 text-left font-medium">Type</th>
                      <th className="px-2 py-1.5 text-left font-medium">Description</th>
                      <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                          {formatDate(row.date)}
                        </td>
                        <td className="max-w-[90px] truncate px-2 py-1.5">
                          {row.accountName}
                        </td>
                        <td className="px-2 py-1.5">
                          <span
                            className={cn(
                              "rounded px-1 py-0.5 text-[10px] font-medium",
                              row.type === "income" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                              row.type === "expense" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                              row.type === "transfer" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                            )}
                          >
                            {row.type}
                          </span>
                        </td>
                        <td className="max-w-[150px] px-2 py-1.5">
                          <span className="block truncate">{row.description}</span>
                          {row.type === "transfer" && row.destAccountName && (
                            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <ArrowRight className="h-2.5 w-2.5 shrink-0" />
                              {row.destAccountName}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          €{row.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {parseResult.errors.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 dark:bg-amber-950/20 dark:border-amber-900">
                <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                  Rows that will be skipped ({parseResult.errors.length}):
                </p>
                {parseResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    Row {e.line}: {e.message}
                  </p>
                ))}
              </div>
            )}

            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={reimportDuplicates}
                onCheckedChange={(v) => setReimportDuplicates(v === true)}
                className="mt-0.5"
              />
              <span>
                {reimportDuplicates
                  ? "Duplicates will be re-imported — already-imported transactions matching this file will be created again."
                  : "Re-importing the same file is safe — duplicate transactions are detected and skipped automatically. Check to import them anyway."}
              </span>
            </label>
          </div>
        )}

        {/* ── Step 4: Import ──────────────────────────────────────────── */}
        {step === "import" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6">
            {isDone ? (
              <>
                <CheckCircle2 className={cn("h-12 w-12", importFailed > 0 ? "text-amber-500" : "text-emerald-600")} />
                <p className="text-base font-semibold">Import complete</p>
                <p className="text-sm text-muted-foreground text-center">
                  {totalProcessed} new transaction{totalProcessed !== 1 ? "s" : ""} imported.
                  {importFailed > 0 && (
                    <>
                      <br />
                      <span className="text-amber-600">{importFailed} failed (skipped).</span>
                    </>
                  )}
                </p>
                {duplicateRows.length > 0 && (
                  <details className="w-full max-w-md text-sm">
                    <summary className="cursor-pointer text-amber-600">
                      {duplicateRows.length} duplicate{duplicateRows.length !== 1 ? "s" : ""} skipped (already imported) — show
                    </summary>
                    <ul className="mt-2 max-h-48 space-y-1 overflow-auto rounded-md border bg-muted/40 p-2">
                      {duplicateRows.slice(0, 100).map((d, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate">
                            {fmtDate(d.date, "yyyy-MM-dd")} · {d.accountName} · {d.description}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {d.amount.toFixed(2)}
                          </span>
                        </li>
                      ))}
                      {duplicateRows.length > 100 && (
                        <li className="text-xs text-muted-foreground">
                          …and {duplicateRows.length - 100} more
                        </li>
                      )}
                    </ul>
                  </details>
                )}
              </>
            ) : progress ? (
              <>
                <p className="text-sm font-medium">
                  Importing {progress.done} of {progress.total}…
                </p>
                <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${(progress.done / progress.total) * 100}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Preparing…</p>
            )}
          </div>
        )}

        {/* Footer */}
        <DialogFooter className="shrink-0">
          {step === "upload" && (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                disabled={!parseResult || parseResult.rows.length === 0}
                onClick={handleProceedToReconcile}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}

          {step === "reconcile" && (
            <>
              <Button variant="outline" onClick={() => setStep("upload")}>
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button onClick={() => setStep("preview")}>
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}

          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("reconcile")}>
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                disabled={!parseResult || filteredRows.length === 0}
                onClick={handleImport}
              >
                Import {filteredRows.length} transaction
                {filteredRows.length !== 1 ? "s" : ""}
              </Button>
            </>
          )}

          {step === "import" && isDone && (
            <Button onClick={() => handleClose(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── ReconcileRow ─────────────────────────────────────────────────────────────
// Shared row for both accounts and categories in the reconcile step.

interface ReconcileRowProps {
  sourceName: string
  isNew: boolean
  displayName: string
  enabled?: boolean
  onEnabledChange?: (v: boolean) => void
  onDisplayNameChange: (v: string) => void
  selectValue: string
  onSelectChange: (v: string) => void
  selectOptions: Array<{ value: string; label: string }>
  selectPlaceholder: string
}

function ReconcileRow({
  sourceName,
  isNew,
  displayName,
  enabled,
  onEnabledChange,
  onDisplayNameChange,
  selectValue,
  onSelectChange,
  selectOptions,
  selectPlaceholder,
}: ReconcileRowProps) {
  const isDisabled = enabled === false
  return (
    <div className={cn("rounded-md border p-3", isDisabled && "opacity-50")}>
      <div className="mb-1.5 flex items-center gap-2">
        {onEnabledChange && (
          <Checkbox
            checked={enabled ?? true}
            onCheckedChange={(v) => onEnabledChange(v === true)}
            aria-label={`Include ${sourceName}`}
          />
        )}
        <p className="text-xs text-muted-foreground">
          CSV: <span className="font-mono">{sourceName}</span>
        </p>
      </div>
      {isNew ? (
        <div className="flex items-center gap-2">
          <Badge className="shrink-0 border-amber-200 bg-amber-100 text-[10px] text-amber-700 hover:bg-amber-100">
            <Plus className="mr-1 h-2.5 w-2.5" />
            New
          </Badge>
          <Input
            className="h-7 flex-1 text-sm"
            value={displayName}
            onChange={(e) => onDisplayNameChange(e.target.value)}
            disabled={isDisabled}
          />
          <Select value={selectValue} onValueChange={onSelectChange} disabled={isDisabled}>
            <SelectTrigger className="h-7 w-36 shrink-0 text-xs">
              <SelectValue placeholder={selectPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {selectOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            Matched
          </Badge>
          <span className="text-sm font-medium">{displayName}</span>
        </div>
      )}
    </div>
  )
}
