"use client"


import { Button } from "@alter-ego/ui/ui/button"
import { Checkbox } from "@alter-ego/ui/ui/checkbox"
import { DateRangePicker } from "@alter-ego/ui/ui/date-range-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alter-ego/ui/ui/dialog"
import { Label } from "@alter-ego/ui/ui/label"
import { Download } from "lucide-react"
import { useMemo, useState } from "react"

import { useAccounts } from "../../hooks/use-accounts"
import { useCurrency } from "../../hooks/use-currency"
import { useTransactions } from "../../hooks/use-transactions"
import { useAuth } from "../../host"
import { downloadCsv } from "../../lib/export"
import { buildTransactionsCsv, transactionsCsvFileName } from "../../lib/transactions-export"

import type { Currency } from "../../types"
import type { DateRange } from "react-day-picker"

interface TransactionExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TransactionExportDialog({ open, onOpenChange }: TransactionExportDialogProps) {
  const { user } = useAuth()
  const { format: formatCurrency, defaultCurrency } = useCurrency()
  const [range, setRange] = useState<DateRange | undefined>(undefined)
  const [expandSplits, setExpandSplits] = useState(false)

  const rangeReady = !!range?.from && !!range.to

  const { data: accounts = [] } = useAccounts(user?.id)
  const { data: txResult } = useTransactions(
    user?.id,
    rangeReady ? { dateFrom: range!.from!, dateTo: range!.to! } : undefined,
  )
  const transactions = useMemo(() => txResult?.data ?? [], [txResult])

  const preview = useMemo(() => {
    if (!rangeReady) return null
    const accountIds = new Set<string>()
    const totalsByCurrency = new Map<Currency, { income: number; expense: number }>()
    let transferCount = 0
    for (const tx of transactions) {
      accountIds.add(tx.accountId)
      if (tx.type === "transfer") {
        transferCount += 1
        continue
      }
      const totals = totalsByCurrency.get(tx.currency) ?? { income: 0, expense: 0 }
      if (tx.type === "income") totals.income += tx.amount
      else totals.expense += tx.amount
      totalsByCurrency.set(tx.currency, totals)
    }
    const primary =
      totalsByCurrency.get(defaultCurrency) ??
      totalsByCurrency.values().next().value ??
      { income: 0, expense: 0 }
    const primaryCurrency =
      totalsByCurrency.has(defaultCurrency)
        ? defaultCurrency
        : (totalsByCurrency.keys().next().value ?? defaultCurrency)
    return {
      count: transactions.length,
      accountCount: accountIds.size,
      transferCount,
      income: primary.income,
      expense: primary.expense,
      previewCurrency: primaryCurrency,
      hasMixedCurrencies: totalsByCurrency.size > 1,
    }
  }, [rangeReady, transactions, defaultCurrency])

  function handleDownload() {
    if (!rangeReady || !preview || preview.count === 0) return
    const csv = buildTransactionsCsv({
      transactions,
      accounts,
      dateFrom: range!.from!,
      dateTo: range!.to!,
      expandSplits,
    })
    downloadCsv(csv, transactionsCsvFileName(range!.from!, range!.to!, expandSplits))
    onOpenChange(false)
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setRange(undefined)
      setExpandSplits(false)
    }
    onOpenChange(next)
  }

  const canDownload = rangeReady && (preview?.count ?? 0) > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export Transactions</DialogTitle>
          <DialogDescription>
            Download a CSV of your transactions for a custom date range.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Date range</Label>
            <DateRangePicker value={range} onChange={setRange} />
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="expand-splits"
              checked={expandSplits}
              onCheckedChange={(v) => setExpandSplits(!!v)}
            />
            <div className="space-y-0.5">
              <Label htmlFor="expand-splits" className="text-sm font-normal">
                Expand splits into separate rows
              </Label>
              <p className="text-xs text-muted-foreground">
                One row per split with its own category and amount. Useful for accountant exports.
              </p>
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {!rangeReady ? (
              "Pick a date range to preview the export."
            ) : preview && preview.count === 0 ? (
              "No transactions in this range."
            ) : preview ? (
              <>
                <span className="font-medium text-foreground">
                  {preview.count} transaction{preview.count === 1 ? "" : "s"}
                </span>
                {" · "}
                {preview.accountCount} account{preview.accountCount === 1 ? "" : "s"}
                {" · "}
                {formatCurrency(preview.income, preview.previewCurrency)} income
                {" · "}
                {formatCurrency(preview.expense, preview.previewCurrency)} expenses
                {preview.transferCount > 0 ? (
                  <>{" · "}{preview.transferCount} transfer{preview.transferCount === 1 ? "" : "s"}</>
                ) : null}
                {preview.hasMixedCurrencies ? (
                  <p className="mt-1 text-[10px]">
                    Multiple currencies in range — totals shown in {preview.previewCurrency}.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleDownload} disabled={!canDownload}>
            <Download className="h-4 w-4" />
            Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
