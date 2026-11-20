"use client"

import { SegmentedButtons } from "@alter-ego/ui/page/segmented-buttons"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@alter-ego/ui/ui/select"
import { useToast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { ArrowRight, Trash2 } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { ConfirmDeleteDialog } from "./components/confirm-delete-dialog"
import { CategorizationRulesSection } from "./components/settings/categorization-rules-section"
import { DataExportSection } from "./components/settings/data-export-section"
import { SettingsRow, SettingsSection } from "./components/settings/settings-section"
import { TagsSection } from "./components/settings/tags-section"
import { useDeleteAllAccountData } from "./hooks/use-accounts"
import { useCategories, useDeleteAllCategories } from "./hooks/use-categories"
import { useTransactions, useDeleteAllTransactions } from "./hooks/use-transactions"
import { useAuth } from "./host"
import { currencyOptionsShort, localeOptions } from "./lib/options"
import { useFinanceSettingsStore } from "./stores/finance-settings-store"
import { useImportStore } from "./stores/import-store"

import type { Currency } from "./types"

const MAIN_CURRENCIES: Currency[] = ["EUR", "USD", "GBP"]
const CURRENCY_SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" }

/** The Preferences rows finance owns: currency and locale. The host puts them in its Preferences section. */
export function FinancePreferenceRows() {
  const { defaultCurrency, locale, setDefaultCurrency, setLocale } = useFinanceSettingsStore()

  const isOtherCurrency = !MAIN_CURRENCIES.includes(defaultCurrency)
  const today = new Date()
  const formatHint = `Dates read ${today.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}; amounts ${new Intl.NumberFormat(locale, { style: "currency", currency: defaultCurrency }).format(1488.93)}.`

  return (
    <>
      <SettingsRow label="Currency" labelId="currency-label" hint="For totals and new accounts. Each account keeps its own.">
        <SegmentedButtons
          aria-labelledby="currency-label"
          value={isOtherCurrency ? "" : defaultCurrency}
          onChange={(value) => setDefaultCurrency(value as Currency)}
          options={MAIN_CURRENCIES.map((c) => ({ value: c as string, label: c, icon: <span aria-hidden>{CURRENCY_SYMBOL[c]}</span> }))}
          trailing={
            <Select value={isOtherCurrency ? defaultCurrency : ""} onValueChange={(value) => setDefaultCurrency(value as Currency)}>
              <SelectTrigger
                aria-label="Other currency"
                className={cn(
                  "h-auto min-h-[38px] w-auto gap-1 rounded-lg border-0 px-3 py-0 text-[13px] shadow-none pointer-coarse:min-h-11",
                  isOtherCurrency ? "bg-background font-medium shadow-xs" : "bg-transparent text-subtle-foreground data-[placeholder]:text-subtle-foreground",
                )}
              >
                <SelectValue placeholder="Other" />
              </SelectTrigger>
              <SelectContent>
                {currencyOptionsShort
                  .filter((o) => !MAIN_CURRENCIES.includes(o.value))
                  .map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.value}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsRow>
      <SettingsRow label="Language and Format" htmlFor="locale" hint={formatHint}>
        <Select value={locale} onValueChange={setLocale}>
          <SelectTrigger id="locale" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {localeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
    </>
  )
}

/**
 * Finance's sections of the settings page: Categories & Tags, Data (the export; the host's own rows
 * go in as children, after it) and the Danger Zone. Rendered inside the host's column of sections.
 */
export function FinanceSettings({ children }: { children?: React.ReactNode }) {
  const { user } = useAuth()
  const { toast } = useToast()
  // Only the total is shown; one row keeps the read to a count, not the whole ledger.
  const { data: txResult, isLoading: txLoading } = useTransactions(user?.id, { limit: 1 })
  const transactionCount = txResult?.total ?? 0

  const deleteAllTransactions = useDeleteAllTransactions(user?.id)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)

  const deleteAllAccountData = useDeleteAllAccountData(user?.id)
  const [wipeOpen, setWipeOpen] = useState(false)
  // One background job at a time: a running import or wipe owns the progress indicator.
  const backgroundBusy = useImportStore((s) => s.active !== null)

  const { data: categories, isLoading: categoriesLoading } = useCategories(user?.id)
  const customCategoryCount = categories?.filter((c) => !c.isDefault || c.userId !== null).length ?? 0
  const deleteAllCategories = useDeleteAllCategories(user?.id)
  const [resetCategoriesOpen, setResetCategoriesOpen] = useState(false)

  return (
    <>
      <SettingsSection id="sorting" title="Categories & Tags" description="Sort transactions without doing it by hand.">
        <SettingsRow label="Categories" hint="Rename, recolour and group them on their own page.">
          <Button variant="outline" size="lg" asChild>
            <Link href="/categories">
              Open Categories
              <ArrowRight />
            </Link>
          </Button>
        </SettingsRow>
        <TagsSection userId={user?.id} />
        <CategorizationRulesSection userId={user?.id} transactionCount={txLoading ? undefined : transactionCount} />
      </SettingsSection>

      <SettingsSection id="data" title="Data" description="Take your data with you, or let your own tools read it.">
        <DataExportSection />
        {children}
      </SettingsSection>

      <SettingsSection id="danger" title="Danger Zone" description="Each action asks you to confirm, and none can be undone." danger>
        <SettingsRow
          label="Delete All Transactions"
          hint={`Removes all ${txLoading ? "" : `${transactionCount} `}transactions. Accounts, categories, budgets and rules stay.`}
        >
          {!txLoading && transactionCount === 0 ? (
            <StatusPill>Nothing to delete</StatusPill>
          ) : (
            <Button variant="outline-destructive" size="lg" disabled={txLoading} onClick={() => setDeleteAllOpen(true)}>
              <Trash2 />
              Delete All Transactions{txLoading ? "" : ` (${transactionCount})`}
            </Button>
          )}
        </SettingsRow>
        <SettingsRow
          label="Start from Zero"
          hint="Deletes every account and transaction, with recurring rules and balance history. Categories, tags, budgets and rules stay. It runs in the background."
        >
          <Button variant="outline-destructive" size="lg" disabled={backgroundBusy} onClick={() => setWipeOpen(true)}>
            <Trash2 />
            Delete All Accounts &amp; Transactions
          </Button>
        </SettingsRow>
        <SettingsRow label="Reset Categories" hint="Deletes the categories you made, undoes your edits to the defaults and brings back the default set.">
          {!categoriesLoading && customCategoryCount === 0 ? (
            <StatusPill>Nothing to reset</StatusPill>
          ) : (
            <Button variant="outline-destructive" size="lg" disabled={categoriesLoading} onClick={() => setResetCategoriesOpen(true)}>
              <Trash2 />
              Reset Categories to Default{categoriesLoading ? "" : ` (${customCategoryCount})`}
            </Button>
          )}
        </SettingsRow>
      </SettingsSection>

      <ConfirmDeleteDialog
        open={deleteAllOpen}
        onOpenChange={setDeleteAllOpen}
        title="Delete All Transactions"
        description={`Are you sure you want to delete all ${transactionCount} transactions? This action cannot be undone. Account balances will be reset.`}
        onConfirm={() => {
          deleteAllTransactions.mutate(undefined, {
            onSuccess: () => {
              setDeleteAllOpen(false)
              toast({ title: "All transactions deleted" })
            },
          })
        }}
        isPending={deleteAllTransactions.isPending}
      />

      <ConfirmDeleteDialog
        open={wipeOpen}
        onOpenChange={setWipeOpen}
        title="Delete All Accounts & Transactions"
        description="Every account, transaction, recurring transaction and balance history entry will be deleted, bringing all balances to zero. This cannot be undone."
        confirmLabel="Delete everything"
        onConfirm={() => {
          setWipeOpen(false)
          deleteAllAccountData.mutate()
        }}
        isPending={false}
      />

      <ConfirmDeleteDialog
        open={resetCategoriesOpen}
        onOpenChange={setResetCategoriesOpen}
        title="Reset Categories to Default"
        description={`Are you sure you want to delete all ${customCategoryCount} custom or edited categories? The default categories will remain, as they were before you edited them. Transactions keep their data but lose any custom-category assignment. This cannot be undone.`}
        onConfirm={() => {
          deleteAllCategories.mutate(undefined, {
            onSuccess: () => {
              setResetCategoriesOpen(false)
              toast({ title: "Categories reset to default" })
            },
          })
        }}
        isPending={deleteAllCategories.isPending}
      />
    </>
  )
}
