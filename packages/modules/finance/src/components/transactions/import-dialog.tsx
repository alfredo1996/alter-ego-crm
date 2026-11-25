"use client"

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
import { Label } from "@alter-ego/ui/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alter-ego/ui/ui/select"
import { cn } from "@alter-ego/ui/utils"
import { useQueryClient } from "@tanstack/react-query"
import {
  Upload,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  Loader2,
} from "lucide-react"
import { useState, useRef, useMemo, useEffect } from "react"


import { useMerchantNormalization } from "../../hooks/use-merchant-normalization"
import { useAuth } from "../../host"
import { getBackend } from "../../host"
import {
  parseCSV,
  autoSuggestColumns,
  tryParseDate,
  tryParseAmount,
  detectDateOrder,
  detectDecimalSeparator,
  inferTransactionType,
  typeFromString,
  computeImportHash,
} from "../../lib/csv-import"
import { useImportStore } from "../../stores/import-store"

import type { DateOrder, DecimalSeparator } from "../../lib/csv-import"
import type { Account, TransactionType } from "../../types"

type Step = "upload" | "map" | "review"

interface ColumnMap {
  date: string
  description: string
  amount: string
  type: string  // "" = not mapped
  notes: string // "" = not mapped
}

interface MappedRow {
  index: number
  date: Date | null
  description: string
  amount: number | null
  type: TransactionType
  notes: string | null
  error: string | null
}

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: Account[]
}

const SKIP = "__skip__"
const PREVIEW_ROWS = 5

export function ImportDialog({ open, onOpenChange, accounts }: ImportDialogProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const importStore = useImportStore()
  const { normalize } = useMerchantNormalization(user?.id)

  const [step, setStep] = useState<Step>("upload")
  const [accountId, setAccountId] = useState("")
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null)
  const [fileName, setFileName] = useState("")
  const [columnMap, setColumnMap] = useState<ColumnMap>({
    date: "",
    description: "",
    amount: "",
    type: "",
    notes: "",
  })
  const [flipSigns, setFlipSigns] = useState(false)
  const [dateFormat, setDateFormat] = useState<"auto" | DateOrder>("auto")
  const [decimalSeparator, setDecimalSeparator] = useState<"auto" | DecimalSeparator>("auto")
  const [rowHashes, setRowHashes] = useState<Map<number, string>>(new Map())
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [importDone, setImportDone] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStep("upload")
    setAccountId("")
    setParsed(null)
    setFileName("")
    setColumnMap({ date: "", description: "", amount: "", type: "", notes: "" })
    setFlipSigns(false)
    setDateFormat("auto")
    setDecimalSeparator("auto")
    setRowHashes(new Map())
    setImportProgress(null)
    setImportDone(false)
    setIsParsing(false)
    setParseError(null)
  }

  function handleClose(open: boolean) {
    if (!open) reset()
    onOpenChange(open)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParsed(null)
    setParseError(null)
    setIsParsing(true)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string
        const result = parseCSV(text)
        setParsed(result)
        const suggestions = autoSuggestColumns(result.headers)
        setColumnMap({
          date: suggestions.date ?? "",
          description: suggestions.description ?? "",
          amount: suggestions.amount ?? "",
          type: suggestions.type ?? "",
          notes: suggestions.notes ?? "",
        })
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Failed to parse CSV")
      } finally {
        setIsParsing(false)
      }
    }
    reader.onerror = () => {
      setParseError("Failed to read file")
      setIsParsing(false)
    }
    reader.readAsText(file)
    // Reset value so the same file can be re-selected
    e.target.value = ""
  }

  // Auto reads the mapped column; when nothing decides it, keep month-first and period
  const resolvedDateOrder = useMemo((): DateOrder => {
    if (dateFormat !== "auto") return dateFormat
    if (parsed && columnMap.date) {
      const idx = parsed.headers.indexOf(columnMap.date)
      return detectDateOrder(parsed.rows.map((r) => r[idx] ?? "")) ?? "mdy"
    }
    return "mdy"
  }, [parsed, columnMap.date, dateFormat])

  const resolvedDecimalSeparator = useMemo((): DecimalSeparator => {
    if (decimalSeparator !== "auto") return decimalSeparator
    if (parsed && columnMap.amount) {
      const idx = parsed.headers.indexOf(columnMap.amount)
      return detectDecimalSeparator(parsed.rows.map((r) => r[idx] ?? "")) ?? "."
    }
    return "."
  }, [parsed, columnMap.amount, decimalSeparator])

  const rows = useMemo((): MappedRow[] => {
    if (!parsed || !columnMap.date || !columnMap.description || !columnMap.amount) return []

    const dateIdx = parsed.headers.indexOf(columnMap.date)
    const descIdx = parsed.headers.indexOf(columnMap.description)
    const amtIdx = parsed.headers.indexOf(columnMap.amount)
    const typeIdx = columnMap.type ? parsed.headers.indexOf(columnMap.type) : -1
    const notesIdx = columnMap.notes ? parsed.headers.indexOf(columnMap.notes) : -1

    return parsed.rows.map((row, index) => {
      const dateVal = row[dateIdx] ?? ""
      const descVal = row[descIdx] ?? ""
      const amtVal = row[amtIdx] ?? ""
      const typeVal = typeIdx >= 0 ? (row[typeIdx] ?? "") : ""
      const notesVal = notesIdx >= 0 ? (row[notesIdx] ?? "") : ""

      const date = tryParseDate(dateVal, resolvedDateOrder)
      const rawAmount = tryParseAmount(amtVal, resolvedDecimalSeparator)

      let error: string | null = null
      if (!date) error = `Invalid date: "${dateVal}"`
      else if (rawAmount === null) error = `Invalid amount: "${amtVal}"`
      else if (!descVal.trim()) error = "Empty description"

      const amount = rawAmount !== null ? Math.abs(rawAmount) : null
      const type: TransactionType =
        rawAmount !== null
          ? typeVal
            ? typeFromString(typeVal)
            : inferTransactionType(rawAmount, flipSigns)
          : "expense"

      return {
        index,
        date,
        description: descVal.trim(),
        amount,
        type,
        notes: notesVal || null,
        error,
      }
    })
  }, [parsed, columnMap, flipSigns, resolvedDateOrder, resolvedDecimalSeparator])

  // Asynchronously compute hashes for all valid rows whenever inputs change
  useEffect(() => {
    let cancelled = false

    const validRows = accountId && rows.length > 0
      ? rows.filter((r) => !r.error && r.date && r.amount !== null)
      : []

    Promise.all(
      validRows.map((row) =>
        computeImportHash(accountId!, row.date!, row.amount!, row.description).then(
          (hash) => [row.index, hash] as [number, string]
        )
      )
    ).then((entries) => {
      if (!cancelled) setRowHashes(new Map(entries))
    })

    return () => { cancelled = true }
  }, [rows, accountId])

  const errorRows = rows.filter((r) => r.error)
  const validRows = rows.filter((r) => !r.error)

  const selectedAccount = accounts.find((a) => a.id === accountId)
  const canProceedUpload = !!accountId && !!parsed && parsed.rows.length > 0 && !isParsing
  const canProceedMap = !!columnMap.date && !!columnMap.description && !!columnMap.amount

  async function handleImport() {
    if (!user || !selectedAccount) return
    setImportProgress({ done: 0, total: validRows.length })
    importStore.setActive({ label: "Importing CSV...", done: 0, total: validRows.length })
    const db = getBackend().db
    const BATCH_SIZE = 50
    let done = 0

    for (let start = 0; start < validRows.length; start += BATCH_SIZE) {
      const batch = validRows.slice(start, start + BATCH_SIZE)
      await Promise.all(
        batch.map(async (row) => {
          const normalizedDesc = normalize(row.description)
          await db.createTransaction(user.id, {
            accountId,
            type: row.type,
            amount: row.amount!,
            currency: selectedAccount.currency,
            description: normalizedDesc,
            rawDescription: normalizedDesc !== row.description ? row.description : null,
            date: row.date!,
            notes: row.notes,
            categoryId: null,
            importHash: rowHashes.get(row.index) ?? null,
          })
        }),
      )
      done += batch.length
      setImportProgress({ done, total: validRows.length })
      importStore.update(done)
    }

    importStore.setActive(null)

    // Invalidate caches once after all transactions are imported
    queryClient.invalidateQueries({ queryKey: ["transactions", user.id] })
    queryClient.invalidateQueries({ queryKey: ["dashboard", user.id] })
    queryClient.invalidateQueries({ queryKey: ["accounts", user.id] })

    setImportDone(true)
    setImportProgress(null)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === "upload" && "Import Transactions"}
            {step === "map" && "Map CSV Columns"}
            {step === "review" && "Review & Import"}
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Select an account and upload a CSV file to import transactions."}
            {step === "map" && "Match each CSV column to the corresponding transaction field."}
            {step === "review" && "Review the parsed transactions before importing."}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {(["upload", "map", "review"] as Step[]).map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              <span className={cn("transition-colors", step === s && "font-semibold text-foreground")}>
                {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
              </span>
            </span>
          ))}
        </div>

        {/* ── Step 1: Upload ─────────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account…" />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter((a) => !a.isArchived)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>CSV File</Label>
              <div
                className={cn(
                  "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors",
                  isParsing && "cursor-wait border-muted-foreground/40 bg-muted/30",
                  !isParsing && parsed && "cursor-pointer border-primary/40 bg-primary/5",
                  !isParsing && !parsed && !parseError && "cursor-pointer border-muted-foreground/25 hover:border-muted-foreground/50",
                  !isParsing && parseError && "cursor-pointer border-destructive/40 bg-destructive/5",
                )}
                onClick={() => {
                  if (isParsing) return
                  fileInputRef.current?.click()
                }}
              >
                {isParsing ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <div className="text-center">
                      <p className="text-sm font-medium">Parsing CSV…</p>
                      <p className="text-xs text-muted-foreground">{fileName}</p>
                    </div>
                  </>
                ) : parseError ? (
                  <>
                    <XCircle className="h-8 w-8 text-destructive" />
                    <div className="text-center">
                      <p className="text-sm font-medium">Couldn&apos;t parse {fileName}</p>
                      <p className="text-xs text-muted-foreground">{parseError} — click to try another file</p>
                    </div>
                  </>
                ) : parsed ? (
                  <>
                    <FileText className="h-8 w-8 text-primary" />
                    <div className="text-center">
                      <p className="text-sm font-medium">{fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {parsed.rows.length} rows · {parsed.headers.length} columns
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <div className="text-center">
                      <p className="text-sm font-medium">Click to upload CSV</p>
                      <p className="text-xs text-muted-foreground">Comma-separated values (.csv)</p>
                    </div>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>
        )}

        {/* ── Step 2: Map columns ────────────────────────────────────────── */}
        {step === "map" && parsed && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["date", "description", "amount"] as const).map((field) => (
                <div key={field} className="space-y-1.5">
                  <Label className="capitalize">
                    {field} <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={columnMap[field] || SKIP}
                    onValueChange={(v) =>
                      setColumnMap((prev) => ({ ...prev, [field]: v === SKIP ? "" : v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column…" />
                    </SelectTrigger>
                    <SelectContent>
                      {parsed.headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}

              {(["type", "notes"] as const).map((field) => (
                <div key={field} className="space-y-1.5">
                  <Label className="capitalize">
                    {field}{" "}
                    <span className="text-xs text-muted-foreground">(optional)</span>
                  </Label>
                  <Select
                    value={columnMap[field] || SKIP}
                    onValueChange={(v) =>
                      setColumnMap((prev) => ({ ...prev, [field]: v === SKIP ? "" : v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not mapped" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP}>Not mapped</SelectItem>
                      {parsed.headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}

              <div className="space-y-1.5">
                <Label>Date format</Label>
                <Select
                  value={dateFormat}
                  onValueChange={(v) => setDateFormat(v as "auto" | DateOrder)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Auto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="dmy">Day first (DD/MM/YYYY)</SelectItem>
                    <SelectItem value="mdy">Month first (MM/DD/YYYY)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Decimal separator</Label>
                <Select
                  value={decimalSeparator}
                  onValueChange={(v) => setDecimalSeparator(v as "auto" | DecimalSeparator)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Auto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value=".">Period (1,234.56)</SelectItem>
                    <SelectItem value=",">Comma (1.234,56)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!columnMap.type && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="flip-signs"
                  checked={flipSigns}
                  onCheckedChange={(v) => setFlipSigns(!!v)}
                />
                <Label htmlFor="flip-signs" className="text-sm font-normal">
                  Treat positive amounts as expenses (flip sign convention)
                </Label>
              </div>
            )}

            {/* Live preview */}
            {canProceedMap && rows.length > 0 && (
              <div className="overflow-hidden rounded-md border">
                <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                  Preview — first {Math.min(PREVIEW_ROWS, rows.length)} rows
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/20">
                        <th className="px-3 py-1.5 text-left font-medium">Date</th>
                        <th className="px-3 py-1.5 text-left font-medium">Description</th>
                        <th className="px-3 py-1.5 text-right font-medium">Amount</th>
                        <th className="px-3 py-1.5 text-left font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, PREVIEW_ROWS).map((row) => (
                        <tr
                          key={row.index}
                          className={cn("border-b last:border-0", row.error && "bg-destructive/5")}
                        >
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {row.date ? (
                              row.date.toLocaleDateString()
                            ) : (
                              <span className="text-destructive">Invalid</span>
                            )}
                          </td>
                          <td className="max-w-[180px] px-3 py-1.5">
                            {row.description ? (
                              <>
                                <p className="truncate">{normalize(row.description)}</p>
                                {normalize(row.description) !== row.description && (
                                  <p className="truncate text-[10px] text-muted-foreground/60">{row.description}</p>
                                )}
                              </>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {row.amount !== null ? (
                              row.amount.toFixed(2)
                            ) : (
                              <span className="text-destructive">Invalid</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <span
                              className={cn(
                                "rounded-sm px-1 py-0.5 text-[10px] font-medium",
                                row.type === "income"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              )}
                            >
                              {row.type}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Review & Import ────────────────────────────────────── */}
        {step === "review" && (
          <div className="space-y-4">
            {importDone ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                <p className="text-base font-semibold">Import complete!</p>
                <p className="text-sm text-muted-foreground">
                  {validRows.length} transaction{validRows.length !== 1 ? "s" : ""} processed
                  (already-imported rows were skipped automatically).
                </p>
              </div>
            ) : importProgress ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <p className="text-sm font-medium">
                  Importing {importProgress.done} of {importProgress.total}…
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{
                      width: `${(importProgress.done / importProgress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border p-3 text-center">
                    <CheckCircle2 className="mx-auto mb-1 h-4 w-4 text-emerald-600" />
                    <p className="text-xl font-bold">{validRows.length}</p>
                    <p className="text-xs text-muted-foreground">Ready to import</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <XCircle
                      className={cn(
                        "mx-auto mb-1 h-4 w-4",
                        errorRows.length > 0 ? "text-destructive" : "text-muted-foreground"
                      )}
                    />
                    <p className="text-xl font-bold">{errorRows.length}</p>
                    <p className="text-xs text-muted-foreground">Parse errors</p>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  <AlertTriangle className="mr-1 inline h-3 w-3 text-amber-500" />
                  Rows already imported (matching a previous import) will be skipped automatically.
                </p>

                {errorRows.length > 0 && (
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-destructive/20 bg-destructive/5 p-3">
                    <p className="text-xs font-medium text-destructive">
                      Rows with errors (will be skipped):
                    </p>
                    {errorRows.map((r) => (
                      <p key={r.index} className="text-xs text-muted-foreground">
                        Row {r.index + 2}: {r.error}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {!importDone && !importProgress && (
            <>
              {step !== "upload" && (
                <Button
                  variant="outline"
                  onClick={() => setStep(step === "review" ? "map" : "upload")}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </Button>
              )}
              {step === "upload" && (
                <Button disabled={!canProceedUpload} onClick={() => setStep("map")}>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}
              {step === "map" && (
                <Button disabled={!canProceedMap} onClick={() => setStep("review")}>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}
              {step === "review" && (
                <Button disabled={validRows.length === 0} onClick={handleImport}>
                  Import {validRows.length} transaction{validRows.length !== 1 ? "s" : ""}
                </Button>
              )}
            </>
          )}
          {importDone && <Button onClick={() => handleClose(false)}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
