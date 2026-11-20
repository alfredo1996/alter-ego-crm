"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { StatusTabs } from "@alter-ego/ui/page/status-tabs"
import { Button } from "@alter-ego/ui/ui/button"
import { Card, CardContent } from "@alter-ego/ui/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alter-ego/ui/ui/dropdown-menu"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { cn } from "@alter-ego/ui/utils"
import { format as format_ } from "date-fns"
import { Plus, AlertCircle, Upload, Download, MoreHorizontal, X } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, useCallback, useEffect } from "react"

import { ConfirmDeleteDialog } from "../confirm-delete-dialog"
import { PullToRefresh } from "../pull-to-refresh"
import { ImportDialog } from "./import-dialog"
import { MMImportDialog } from "./mm-import-dialog"
import { PaginationFooter } from "./pagination-footer"
import { SelectAllBanner } from "./select-all-banner"
import { TransactionSelectionBar } from "./selection-bar"
import { TransactionExportDialog } from "./transaction-export-dialog"
import { TransactionFiltersBar, countFilters, countsAreCheap } from "./transaction-filters"
import { TransactionFormDialog } from "./transaction-form-dialog"
import { TransactionList } from "./transaction-list"
import { useAccounts } from "../../hooks/use-accounts"
import { useCategories } from "../../hooks/use-categories"
import { useCurrency } from "../../hooks/use-currency"
import { useRowSelection } from "../../hooks/use-row-selection"
import { useTags } from "../../hooks/use-tags"
import {
  useTransactions,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
} from "../../hooks/use-transactions"
import { useAuth } from "../../host"
import { getBackend } from "../../host"


import type { TransactionFormValues } from "../../schemas"
import type { Transaction, TransactionFilters, TransactionStatus, TransactionType } from "../../types"

function filtersFromParams(params: URLSearchParams): TransactionFilters {
  const dateFromStr = params.get("dateFrom")
  const dateToStr = params.get("dateTo")
  const minAmountStr = params.get("minAmount")
  const maxAmountStr = params.get("maxAmount")
  return {
    categoryId: params.get("categoryId") ?? undefined,
    accountId: params.get("accountId") ?? undefined,
    type: (params.get("type") as TransactionType) ?? undefined,
    search: params.get("search") ?? undefined,
    uncategorized: params.get("uncategorized") === "true" ? true : undefined,
    dateFrom: dateFromStr ? new Date(dateFromStr + "T00:00:00") : undefined,
    dateTo: dateToStr ? new Date(dateToStr + "T23:59:59") : undefined,
    minAmount: minAmountStr ? parseFloat(minAmountStr) : undefined,
    maxAmount: maxAmountStr ? parseFloat(maxAmountStr) : undefined,
    hasNote: params.get("hasNote") === "true" ? true : undefined,
    tagIds: params.get("tagIds")?.split(",").filter(Boolean) ?? undefined,
    status: (params.get("status") as TransactionStatus) ?? undefined,
  }
}

const useTotal = (userId: string | undefined, filters: TransactionFilters, enabled = true) =>
  useTransactions(userId, { ...filters, limit: 1 }, enabled).data?.total

/**
 * The type tabs' counts: a limit-1 read each, narrowed by every filter but the type, so a tab says
 * what it would show. `unfiltered` is the whole book, for "41 of 88 match": with no filter it is the
 * "All" read again, which React Query shares.
 */
function useTypeCounts(userId: string | undefined, base: TransactionFilters) {
  const rest = { ...base, type: undefined }
  // An in-memory filter would make each of the four reads fetch every match: no numbers then.
  const on = countsAreCheap(base)
  return {
    all: useTotal(userId, rest, on),
    income: useTotal(userId, { ...rest, type: "income" }, on),
    expense: useTotal(userId, { ...rest, type: "expense" }, on),
    transfer: useTotal(userId, { ...rest, type: "transfer" }, on),
    unfiltered: useTotal(userId, {}),
  }
}

export function TransactionsShell() {
  const { user } = useAuth()
  const { format, defaultCurrency } = useCurrency()
  const router = useRouter()
  const searchParams = useSearchParams()

  const PAGE_SIZE = 25
  const [page, setPage] = useState(0)

  const baseFilters = filtersFromParams(searchParams)
  const filters: TransactionFilters = { ...baseFilters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }

  const setFilters = useCallback(
    (next: TransactionFilters) => {
      const params = new URLSearchParams()
      if (next.categoryId) params.set("categoryId", next.categoryId)
      if (next.accountId) params.set("accountId", next.accountId)
      if (next.type) params.set("type", next.type)
      if (next.search) params.set("search", next.search)
      if (next.uncategorized) params.set("uncategorized", "true")
      if (next.dateFrom) params.set("dateFrom", isoDate(next.dateFrom))
      if (next.dateTo) params.set("dateTo", isoDate(next.dateTo))
      if (next.minAmount !== undefined) params.set("minAmount", String(next.minAmount))
      if (next.maxAmount !== undefined) params.set("maxAmount", String(next.maxAmount))
      if (next.hasNote) params.set("hasNote", "true")
      if (next.tagIds?.length) params.set("tagIds", next.tagIds.join(","))
      if (next.status) params.set("status", next.status)
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router]
  )

  const { data: paginatedResult, isPending, isError, error, refetch } = useTransactions(user?.id, filters)
  const transactions = paginatedResult?.data
  const { all, income, expense, transfer, unfiltered } = useTypeCounts(user?.id, baseFilters)
  const datesLabel = [filters.dateFrom, filters.dateTo].filter(Boolean).map((d) => format_(d!, "d MMM yyyy")).join(" to ")
  const totalCount = paginatedResult?.total ?? 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  // Anything narrowing the list: search, the type tab, or a control of the sheet.
  const narrowed = countFilters(filters) + (filters.search ? 1 : 0) + (filters.type ? 1 : 0) > 0
  // Each row names its account; without the list it reads "Unknown".
  const { data: accounts, isPending: accountsPending } = useAccounts(user?.id)
  const { data: categories, isPending: categoriesPending } = useCategories(user?.id)
  const { data: tags, isPending: tagsPending } = useTags(user?.id)

  const createTransaction = useCreateTransaction(user?.id)
  const updateTransaction = useUpdateTransaction(user?.id)
  const deleteTransaction = useDeleteTransaction(user?.id)

  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [mmImportOpen, setMmImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null)

  // Multi-selection state
  const { selected, ids: selectedIds, toggle, set: selectRows, remove: removeSelected, sync: syncSelection, clear: clearSelection } = useRowSelection()
  const [selectingAll, setSelectingAll] = useState(false)

  // An edit refetches the page: keep the selected copies (and so the sums) current.
  useEffect(() => {
    if (transactions) syncSelection(transactions)
  }, [transactions, syncSelection])

  // Clear selection and reset page on filter change
  const filterKey = searchParams.toString()
  useEffect(() => {
    clearSelection()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- react-hooks 7 on existing code; rewrite left for 0.16
    setPage(0)
  }, [filterKey, clearSelection])

  // Deleting the last row of the last page leaves `page` past the end: step back.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- react-hooks 7 on existing code; rewrite left for 0.16
    if (page > 0 && totalPages > 0 && page >= totalPages) setPage(totalPages - 1)
  }, [page, totalPages])

  function handleCreate() {
    setEditingTransaction(null)
    setFormOpen(true)
  }

  function handleEdit(transaction: Transaction) {
    setEditingTransaction(transaction)
    setFormOpen(true)
  }

  function handleFormSubmit(values: TransactionFormValues) {
    const input = {
      ...values,
      currency: accounts?.find((a) => a.id === values.accountId)?.currency ?? defaultCurrency,
    }

    if (editingTransaction) {
      updateTransaction.mutate(
        { id: editingTransaction.id, input },
        { onSuccess: () => setFormOpen(false) }
      )
    } else {
      createTransaction.mutate(input, {
        onSuccess: () => setFormOpen(false),
      })
    }
  }

  function handleDeleteConfirm() {
    if (!deletingTransaction) return
    deleteTransaction.mutate(deletingTransaction.id, {
      onSuccess: () => {
        removeSelected(deletingTransaction.id)
        setDeletingTransaction(null)
      },
    })
  }

  function handleToggleSelectAll() {
    if (!transactions) return
    if (transactions.every((tx) => selectedIds.has(tx.id))) clearSelection()
    else selectRows(transactions)
  }

  // Select every transaction matching the current filters (all pages, e.g. a
  // whole month), not just the visible page.
  async function handleSelectAllMatching() {
    if (!user) return
    setSelectingAll(true)
    try {
      const all = await getBackend().db.getTransactions(user.id, baseFilters)
      selectRows(all.data)
    } finally {
      setSelectingAll(false)
    }
  }

  if (isPending || accountsPending || categoriesPending || tagsPending) {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-40" />
        </div>
        <Skeleton className="mb-4 h-10 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (isError && !paginatedResult) {
    return (
      <div>
        <PageHeader className="mb-6" title="Transactions" />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Failed to load transactions"}
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        className="mb-6"
        title="Transactions"
        subtitle={unfiltered === undefined ? undefined : `${unfiltered} ${unfiltered === 1 ? "transaction" : "transactions"}`}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="lg" className="max-sm:w-11 max-sm:px-0">
                  <MoreHorizontal aria-hidden />
                  <span className="max-sm:sr-only">More</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setMmImportOpen(true)}>
                  <Upload aria-hidden className="mr-2 h-4 w-4" />
                  Money Manager
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                  <Upload aria-hidden className="mr-2 h-4 w-4" />
                  Import CSV
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setExportOpen(true)}>
                  <Download aria-hidden className="mr-2 h-4 w-4" />
                  Export…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* The label collapses below sm; aria-label keeps the name. */}
            <Button size="lg" aria-label="New Transaction" className="max-sm:w-11 max-sm:px-0" onClick={handleCreate}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Transaction</span>
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-4 sm:gap-5">
        <TransactionFiltersBar
          filters={filters}
          onFiltersChange={setFilters}
          accounts={accounts ?? []}
          categories={categories ?? []}
          tags={tags ?? []}
        />
        <StatusTabs
          aria-label="Transaction type"
          value={filters.type ?? "all"}
          onValueChange={(type) => setFilters({ ...filters, type: type === "all" ? undefined : (type as TransactionType) })}
          items={[
            { value: "all", label: "All", count: all },
            { value: "income", label: "Income", count: income },
            { value: "expense", label: "Expenses", count: expense },
            { value: "transfer", label: "Transfers", count: transfer },
          ]}
          // Always mounted, only hidden: a toolbar that came and went would remount the tabs and drop their focus.
          toolbar={
            <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground", !narrowed && "hidden")}>
              <span>
                <span className="tabular-nums">{totalCount}</span> of <span className="tabular-nums">{unfiltered}</span> match
              </span>
              {(filters.dateFrom || filters.dateTo) && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Remove filter: Dates ${datesLabel}`}
                  onClick={() => setFilters({ ...filters, dateFrom: undefined, dateTo: undefined })}
                >
                  Dates · {datesLabel}
                  <X aria-hidden />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
                Clear All
              </Button>
            </div>
          }
        >
          <SelectAllBanner
            pageCount={transactions?.length ?? 0}
            pageSelected={!!transactions?.every((tx) => selectedIds.has(tx.id))}
            total={totalCount}
            selectedCount={selectedIds.size}
            selecting={selectingAll}
            onSelectAll={handleSelectAllMatching}
            onClear={clearSelection}
          />

          <PullToRefresh onRefresh={async () => { await refetch() }}>
            <TransactionList
              transactions={transactions ?? []}
              accounts={accounts ?? []}
              categories={categories ?? []}
              tags={tags ?? []}
              format={format}
              onDelete={setDeletingTransaction}
              onView={handleEdit}
              selectedIds={selectedIds}
              onToggleSelect={(id) => toggle(id, transactions ?? [])}
              onToggleSelectAll={handleToggleSelectAll}
              footer={
                (transactions?.length ?? 0) > 0 && (
                  <PaginationFooter page={page} pageSize={PAGE_SIZE} shown={transactions?.length ?? 0} total={totalCount} onPageChange={setPage} />
                )
              }
            />
          </PullToRefresh>
        </StatusTabs>
      </div>

      <TransactionSelectionBar selected={selected} accounts={accounts ?? []} onClear={clearSelection} />

      <TransactionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        transaction={editingTransaction}
        accounts={accounts ?? []}
        categories={categories ?? []}
        onSubmit={handleFormSubmit}
        isPending={createTransaction.isPending || updateTransaction.isPending}
        onDelete={(transaction) => {
          setFormOpen(false)
          setDeletingTransaction(transaction)
        }}
      />

      <ConfirmDeleteDialog
        open={!!deletingTransaction}
        onOpenChange={(open) => !open && setDeletingTransaction(null)}
        title="Delete Transaction"
        description={`Are you sure you want to delete \u201c${deletingTransaction?.description}\u201d? This action cannot be undone and account balances will be updated.`}
        onConfirm={handleDeleteConfirm}
        isPending={deleteTransaction.isPending}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        accounts={accounts ?? []}
      />

      <MMImportDialog
        open={mmImportOpen}
        onOpenChange={setMmImportOpen}
      />

      <TransactionExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
      />
    </div>
  )
}
