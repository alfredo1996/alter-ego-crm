"use client"

import { formatShortDate } from "@alter-ego/kernel/dates"
import { ContentCard } from "@alter-ego/ui/page/content-card"
import { MetaRow } from "@alter-ego/ui/page/meta-row"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { PageError } from "@alter-ego/ui/page/page-state"
import { SectionHeader } from "@alter-ego/ui/page/section-header"
import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { StatCard } from "@alter-ego/ui/page/stat-card"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { format as formatDay, subMonths, subYears } from "date-fns"
import { ArrowLeft, ChevronRight, Pencil, Plus } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { AccountMenu, useAccountActions } from "./account-actions"
import { balanceText } from "./account-list"
import { LoanBucketsCard } from "./loan-buckets-card"
import { useAccount, useAccounts } from "../../hooks/use-accounts"
import { useCategories } from "../../hooks/use-categories"
import { useCurrency } from "../../hooks/use-currency"
import { useRowSelection } from "../../hooks/use-row-selection"
import { useTags } from "../../hooks/use-tags"
import {
  useTransactions,
  useUpdateTransaction,
  useDeleteTransaction,
} from "../../hooks/use-transactions"
import { useAuth } from "../../host"
import { monthFlow } from "../../lib/account-ledger"
import { accountKind, balanceOwing } from "../../lib/net-worth"
import { accountTypeLabel } from "../../lib/options"
import { BalanceChart } from "../charts/balance-chart"
import {
  ChartTimeRangeSelector,
  type TimeRange,
} from "../charts/chart-time-range-selector"
import { ConfirmDeleteDialog } from "../confirm-delete-dialog"
import { NewTransactionDialog } from "../transactions/new-transaction-dialog"
import { PaginationFooter } from "../transactions/pagination-footer"
import { SelectAllBanner } from "../transactions/select-all-banner"
import { TransactionSelectionBar } from "../transactions/selection-bar"
import { TransactionFormDialog } from "../transactions/transaction-form-dialog"
import { TransactionList } from "../transactions/transaction-list"

import type { TransactionFormValues } from "../../schemas"
import type { Transaction } from "../../types"

// ponytail: an account without a colour of its own gets slate; the account form always sets one.
const NO_COLOUR = "#64748b"

export interface AccountDetailShellProps {
  accountId: string
}

const PAGE_SIZE = 25

export function AccountDetailShell({ accountId }: AccountDetailShellProps) {
  const { user } = useAuth()
  const {
    data: account,
    isPending: accountPending,
    isError: accountError,
    refetch: refetchAccount,
  } = useAccount(user?.id, accountId)
  const { data: accounts, isPending: accountsPending } = useAccounts(user?.id)

  const { selected, ids: selectedIds, toggle, set: selectRows, remove: removeSelected, sync: syncSelection, clear: clearSelection } = useRowSelection()
  const [page, setPage] = useState(0)
  const [prevAccountId, setPrevAccountId] = useState(accountId)

  // Paginated fetch for the transaction list
  const { data: txResult, isPending: txPending } = useTransactions(
    user?.id,
    { accountId, limit: PAGE_SIZE, offset: page * PAGE_SIZE }
  )
  const transactions = txResult?.data
  // An edit refetches the page: keep the selected copies (and so the sums) current.
  useEffect(() => {
    if (transactions) syncSelection(transactions)
  }, [transactions, syncSelection])

  // Unpaginated fetch for the balance chart (needs all transactions)
  const { data: allTxResult, isPending: allTxPending } = useTransactions(user?.id, { accountId })
  const allTransactions = allTxResult?.data

  const { data: categories, isPending: categoriesPending } = useCategories(user?.id)
  const { data: tags, isPending: tagsPending } = useTags(user?.id)
  const { format, defaultCurrency } = useCurrency()

  // Reset page when account changes
  if (accountId !== prevAccountId) {
    setPrevAccountId(accountId)
    setPage(0)
    clearSelection()
  }

  const router = useRouter()
  const actions = useAccountActions({ onDeleted: () => router.push("/accounts") })
  const updateTransaction = useUpdateTransaction(user?.id)
  const deleteTransaction = useDeleteTransaction(user?.id)

  const [formOpen, setFormOpen] = useState(false)
  const [newTransactionOpen, setNewTransactionOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null)
  const [chartRange, setChartRange] = useState<TimeRange>("All")
  const [brushRange, setBrushRange] = useState<{ from: Date; to: Date } | null>(null)

  const isPending = accountPending || accountsPending || txPending || allTxPending || categoriesPending || tagsPending

  function handleEdit(transaction: Transaction) {
    setEditingTransaction(transaction)
    setFormOpen(true)
  }

  function handleFormSubmit(values: TransactionFormValues) {
    if (!editingTransaction) return
    const input = {
      ...values,
      currency: accounts?.find((a) => a.id === values.accountId)?.currency ?? defaultCurrency,
    }
    updateTransaction.mutate(
      { id: editingTransaction.id, input },
      { onSuccess: () => setFormOpen(false) }
    )
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

  const chartDateRange = useMemo(() => {
    if (brushRange) return brushRange
    const now = new Date()
    switch (chartRange) {
      case "1M": return { from: subMonths(now, 1), to: now }
      case "3M": return { from: subMonths(now, 3), to: now }
      case "6M": return { from: subMonths(now, 6), to: now }
      case "1Y": return { from: subYears(now, 1), to: now }
      default: return undefined
    }
  }, [chartRange, brushRange])

  const oldest = useMemo(
    () => (allTransactions ?? []).reduce<Date | null>((min, t) => (min === null || t.date < min ? t.date : min), null),
    [allTransactions],
  )
  const newest = useMemo(
    () => (allTransactions ?? []).reduce<Date | null>((max, t) => (max === null || t.date > max ? t.date : max), null),
    [allTransactions],
  )

  if (isPending) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-7 w-40" />
        </div>
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  // A failed load is not a missing account.
  if (accountError && !account) return <PageError onRetry={() => void refetchAccount()} />

  if (!account) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">Account not found.</p>
        <Link
          href="/accounts"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-4 pointer-coarse:mt-1 pointer-coarse:py-3"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Accounts
        </Link>
      </div>
    )
  }

  const total = txResult?.total ?? 0
  const owing = balanceOwing(account)
  const now = new Date()
  const thisMonth = monthFlow(allTransactions ?? [], accountId, now)
  const lastMonth = monthFlow(allTransactions ?? [], accountId, subMonths(now, 1))
  const money = (n: number) => format(n, account.currency)
  const day = (d: Date) => formatShortDate(d)
  const rangeFrom = chartDateRange?.from ?? oldest
  const rangeTo = chartDateRange?.to ?? now

  return (
    <div className="space-y-6">
      <PageHeader
        size="detail"
        back={{ href: "/accounts", label: "Accounts", current: account.name }}
        pills={
          <>
            <StatusPill>{accountTypeLabel(account.type)}</StatusPill>
            {account.isArchived && <StatusPill>Archived</StatusPill>}
            {owing === "owe" && <StatusPill tone="warning">You owe</StatusPill>}
            <span className="text-[13px] text-muted-foreground">
              {accountKind(account) === "liability" ? "Liability" : "Asset"}
              {owing === "owed" && " · owed to you"}
            </span>
          </>
        }
        title={
          <span className="flex items-center gap-3.5">
            <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ backgroundColor: account.color ?? NO_COLOUR }} />
            {account.name}
          </span>
        }
        meta={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">Balance</span>
              <span className="text-[28px] leading-[1.15] font-semibold tracking-tight tabular-nums sm:text-4xl">
                {balanceText(account.balance, account.currency, format)}
                {account.currency !== defaultCurrency && (
                  <span className="ml-2 text-meta font-normal tracking-normal text-muted-foreground">{account.currency}</span>
                )}
              </span>
            </div>
            <MetaRow>
              <span>
                {total} {total === 1 ? "transaction" : "transactions"}
                {oldest && ` since ${formatDay(oldest, "d MMM yyyy")}`}
              </span>
              {newest && <span>Last activity {day(newest)}</span>}
            </MetaRow>
          </div>
        }
        actions={
          <>
            <Button size="lg" variant="outline" onClick={() => actions.edit(account)}>
              <Pencil className="h-4 w-4" />
              Edit Details
            </Button>
            {/* An archived account is closed: no transaction can go on it. From md up the header carries
                New Transaction; a phone has the + in the top bar. */}
            {!account.isArchived && (
              <Button size="lg" className="max-md:hidden" onClick={() => setNewTransactionOpen(true)}>
                <Plus className="h-4 w-4" />
                New Transaction
              </Button>
            )}
          </>
        }
        more={<AccountMenu variant="header" account={account} onArchive={actions.archive} onDelete={actions.remove} />}
      />

      {/* Who owes what: loan accounts only */}
      <LoanBucketsCard account={account} transactions={allTransactions ?? []} format={format} />

      <div className="flex flex-wrap gap-5">
        <ContentCard as="section" labelledBy="chart-title" className="flex min-w-0 flex-[3_1_560px] flex-col gap-4">
          <SectionHeader
            variant="card"
            id="chart-title"
            title="Balance Over Time"
            description={rangeFrom && `${day(rangeFrom)} – ${day(rangeTo)}`}
            actions={
              <ChartTimeRangeSelector
                value={chartRange}
                onChange={(r) => {
                  setChartRange(r)
                  setBrushRange(null)
                }}
                hasBrush={!!brushRange}
                onClearBrush={() => setBrushRange(null)}
              />
            }
          />
          <BalanceChart
            transactions={allTransactions ?? []}
            currentBalance={account.balance}
            accountId={accountId}
            dateRange={chartDateRange}
            onBrushSelect={setBrushRange}
          />
        </ContentCard>
        {/* This month in and out, from this account's side; the phone's board leaves them out. */}
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-5 max-sm:hidden">
          <StatCard
            className="sm:flex-1"
            label="In this month"
            value={<SignedAmount amount={thisMonth.in} kind="in" format={money} />}
            detail={`${thisMonth.countIn} ${thisMonth.countIn === 1 ? "deposit" : "deposits"}. ${formatDay(subMonths(now, 1), "LLLL")}: ${money(lastMonth.in)} in.`}
          />
          <StatCard
            className="sm:flex-1"
            label="Out this month"
            value={<SignedAmount amount={thisMonth.out} kind="out" format={money} />}
            detail={`${thisMonth.countOut} ${thisMonth.countOut === 1 ? "payment" : "payments"}. ${formatDay(subMonths(now, 1), "LLLL")}: ${money(lastMonth.out)} out.`}
          />
        </div>
      </div>

      {/* Transactions */}
      <section aria-labelledby="tx-title" className="flex flex-col gap-3">
        <SectionHeader
          variant="card"
          id="tx-title"
          title="Transactions"
          description={total > 0 && total}
          actions={
            <Link
              href={`/transactions?accountId=${accountId}`}
              className="-my-2.5 -mr-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View all in Transactions
              <ChevronRight aria-hidden className="size-3.5" />
            </Link>
          }
        />
        {(transactions?.length ?? 0) === 0 ? (
          <ContentCard as="div" className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No transactions yet for this account.</p>
          </ContentCard>
        ) : (
          <>
          <SelectAllBanner
            pageCount={transactions?.length ?? 0}
            pageSelected={!!transactions?.every((t) => selectedIds.has(t.id))}
            total={total}
            selectedCount={selectedIds.size}
            selecting={false}
            // Every row of this account, incoming transfers included: the unpaginated read the chart holds.
            onSelectAll={() => selectRows(allTransactions ?? [])}
            onClear={clearSelection}
          />
          <TransactionList
            transactions={transactions ?? []}
            accounts={accounts ?? []}
            categories={categories ?? []}
            tags={tags ?? []}
            accountId={accountId}
            format={format}
            onDelete={setDeletingTransaction}
            onView={handleEdit}
            selectedIds={selectedIds}
            onToggleSelect={(id) => toggle(id, transactions ?? [])}
            onToggleSelectAll={() => {
              const rows = transactions ?? []
              if (rows.every((t) => selectedIds.has(t.id))) clearSelection()
              else selectRows(rows)
            }}
            footer={
              <PaginationFooter page={page} pageSize={PAGE_SIZE} shown={transactions?.length ?? 0} total={total} onPageChange={setPage} />
            }
          />
          </>
        )}
      </section>

      <TransactionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        transaction={editingTransaction}
        accounts={accounts ?? []}
        categories={categories ?? []}
        onSubmit={handleFormSubmit}
        isPending={updateTransaction.isPending}
        onDelete={(transaction) => {
          setFormOpen(false)
          setDeletingTransaction(transaction)
        }}
      />

      <TransactionSelectionBar selected={selected} accounts={accounts ?? []} onClear={clearSelection} />

      <NewTransactionDialog open={newTransactionOpen} onOpenChange={setNewTransactionOpen} defaultAccountId={accountId} />
      {actions.dialogs}

      <ConfirmDeleteDialog
        open={!!deletingTransaction}
        onOpenChange={(open) => !open && setDeletingTransaction(null)}
        title="Delete Transaction"
        description={`Are you sure you want to delete \u201c${deletingTransaction?.description}\u201d? This action cannot be undone and account balances will be updated.`}
        onConfirm={handleDeleteConfirm}
        isPending={deleteTransaction.isPending}
      />
    </div>
  )
}
