"use client"

import { formatMonthYear, isoDate } from "@alter-ego/kernel/dates"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { MetaRow } from "@alter-ego/ui/page/meta-row"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { Button } from "@alter-ego/ui/ui/button"
import { Card, CardContent } from "@alter-ego/ui/ui/card"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { useToast } from "@alter-ego/ui/use-toast"
import { endOfMonth, format as formatDate, subMonths } from "date-fns"
import { AlertCircle, Plus } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { AccountCardsRow } from "./account-cards-row"
import { BudgetsAtRiskWidget } from "./budgets-at-risk-widget"
import { MonthlySummaryCard } from "./monthly-summary-card"
import { RecentTransactionsCard } from "./recent-transactions-card"
import { SavingsGoalsWidget } from "./savings-goals-widget"
import { SpendingByCategoryCard } from "./spending-by-category-card"
import { UpcomingBillsWidget } from "./upcoming-bills-widget"
import { useAccounts } from "../../hooks/use-accounts"
import { useBudgetsWithSpending } from "../../hooks/use-budgets"
import { useCategories } from "../../hooks/use-categories"
import { useCurrency } from "../../hooks/use-currency"
import { useDashboard } from "../../hooks/use-dashboard"
import { useNetWorthAt, useTakeSnapshot } from "../../hooks/use-net-worth"
import { useRecurring } from "../../hooks/use-recurring"
import { useSavingsGoalsWithProgress } from "../../hooks/use-savings-goals"
import { useAuth } from "../../host"
import { getBudgetStatus } from "../../lib/budgets"
import { NewAccountDialog } from "../accounts/new-account-dialog"
import { PullToRefresh } from "../pull-to-refresh"
import { NewTransactionDialog } from "../transactions/new-transaction-dialog"

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5 sm:gap-7">
      {/* The four figures */}
      <div className="flex flex-wrap gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 min-w-0 flex-[1_1_220px] rounded-xl" />
        ))}
      </div>
      {/* Accounts and spending. Clipped, as the real row wraps: a fixed-width card made a phone's page
          616 px wide while it loaded, and turning the phone then left the page zoomed in. */}
      <div className="flex flex-wrap gap-5 overflow-hidden">
        <Skeleton className="h-64 min-w-0 flex-[5_1_300px] rounded-xl" />
        <Skeleton className="h-64 min-w-0 flex-[4_1_300px] rounded-xl" />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

/** Holds a card's place, at its height, until its data is in. */
function WidgetSlot({ label }: { label: string }) {
  return (
    <div role="status" aria-label={`Loading ${label}`}>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

export function DashboardShell() {
  const { user } = useAuth()
  const { data, isPending, isError, error, refetch } = useDashboard(user?.id)
  const { format } = useCurrency()
  const { data: budgets, isPending: budgetsPending } = useBudgetsWithSpending(user?.id)
  const { data: goals, isPending: goalsPending } = useSavingsGoalsWithProgress(user?.id)
  const { data: recurringRules, isPending: recurringPending } = useRecurring(user?.id)
  // After the dashboard: it hands both lists to these hooks, which then read nothing.
  const { data: accounts, isPending: accountsPending } = useAccounts(data ? user?.id : undefined)
  const { data: categories, isPending: categoriesPending } = useCategories(data ? user?.id : undefined)
  const [newTransactionOpen, setNewTransactionOpen] = useState(false)
  const [newAccountOpen, setNewAccountOpen] = useState(false)
  const { toast } = useToast()
  const takeSnapshot = useTakeSnapshot(user?.id)
  const lastMonthEnd = endOfMonth(subMonths(new Date(), 1))
  // One limit-1 document, read beside the dashboard so the card's change line arrives with it; the
  // card holds the line's place while this is pending.
  const { data: lastMonthNetWorth } = useNetWorthAt(user?.id, lastMonthEnd)

  // The page waits for the dashboard alone (it carries the accounts and categories). Budgets,
  // goals and bills fill a slot of their own below, so nothing above them moves.
  // `!!data` keeps the error card reachable (the two hooks stay disabled, so pending, without data);
  // the seed makes the two extra terms false at once.
  const loading = isPending || (!!data && (accountsPending || categoriesPending))
  const budgetsLoading = budgetsPending
  const billsLoading = recurringPending
  const goalsLoading = goalsPending

  // Take the net worth snapshot once per day, after the dashboard is in so it never competes with it
  const loaded = !!data
  useEffect(() => {
    if (!user?.id || !loaded) return
    const today = isoDate(new Date())

    const nwKey = `alter-ego-snapshot-${today}`
    if (!localStorage.getItem(nwKey)) {
      takeSnapshot.mutate(undefined, {
        onSuccess: () => localStorage.setItem(nwKey, "1"),
      })
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, loaded])

  // Fire budget alert toasts once per day
  useEffect(() => {
    if (!budgets || budgets.length === 0) return
    const today = isoDate(new Date())
    const storageKey = `alter-ego-budget-alert-${today}`
    if (localStorage.getItem(storageKey)) return

    const dangerBudgets = budgets.filter((b) => getBudgetStatus(b) === "danger")
    const warningBudgets = budgets.filter((b) => getBudgetStatus(b) === "warning")

    dangerBudgets.forEach((b) => {
      toast({
        title: "Budget exceeded",
        description: `"${b.name}" has exceeded its limit.`,
        variant: "destructive",
      })
    })

    if (warningBudgets.length > 0) {
      toast({
        title: "Budgets approaching limit",
        description: `${warningBudgets.length} budget${warningBudgets.length > 1 ? "s are" : " is"} at 80%+.`,
      })
    }

    if (dangerBudgets.length > 0 || warningBudgets.length > 0) {
      localStorage.setItem(storageKey, "1")
    }
  }, [budgets, toast])

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <Skeleton className="mb-2 h-8 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <DashboardSkeleton />
      </div>
    )
  }

  if (isError && !data) {
    return (
      <div>
        <PageHeader className="mb-6" title="Dashboard" />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Failed to load dashboard data"}
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const isEmpty = data && data.accountBalances.length === 0 && data.recentTransactions.length === 0

  const now = new Date()
  const greeting = `${user?.displayName ? `Welcome back, ${user.displayName}` : "Welcome back"} · ${formatMonthYear(now)}`
  const uncategorized = data?.recentTransactions.filter((t) => t.categoryId === null && t.type !== "transfer").length ?? 0
  const hasBudgets = !!budgets && budgets.length > 0
  const hasBills = !!recurringRules && recurringRules.length > 0
  const hasGoals = !!goals && goals.some((g) => !g.isCompleted)

  return (
    <PullToRefresh onRefresh={async () => { await refetch() }}>
      <PageHeader
        className="mb-6"
        title="Dashboard"
        subtitle={greeting}
        actions={
          // From md up the header carries it; a phone has the + in the top bar.
          <Button size="lg" className="max-md:hidden" onClick={() => setNewTransactionOpen(true)}>
            <Plus className="h-4 w-4" />
            New Transaction
          </Button>
        }
      />

      {isEmpty ? (
        <EmptyPrompt
          titleId="get-started-title"
          title="Get started with Alter Ego"
          description="Add your first account to start tracking your finances: a bank account, a credit card, cash."
          action={<Button onClick={() => setNewAccountOpen(true)}>Add Your First Account</Button>}
        />
      ) : data ? (
        <div className="flex flex-col gap-5 sm:gap-7">
          {uncategorized > 0 && (
            <MetaRow className="gap-x-3">
              <AlertCircle aria-hidden className="size-4 shrink-0 text-warning-soft-foreground" />
              <span>
                {uncategorized} uncategorized {uncategorized === 1 ? "transaction" : "transactions"} in recent activity
              </span>
              <Link
                href="/transactions?uncategorized=true"
                className="-my-3 py-3 font-medium text-foreground underline underline-offset-2"
              >
                Categorize
              </Link>
            </MetaRow>
          )}
          <MonthlySummaryCard
            netWorth={data.netWorth}
            totalAssets={data.totalAssets}
            totalLiabilities={data.totalLiabilities}
            lastMonthEnd={lastMonthEnd}
            lastMonthNetWorth={lastMonthNetWorth === undefined ? undefined : (lastMonthNetWorth?.netWorth ?? null)}
            monthlyIncome={data.monthlyIncome}
            monthlyExpenses={data.monthlyExpenses}
            monthlySavingsRate={data.monthlySavingsRate}
            monthlySummary={data.monthlySummary}
            format={format}
          />
          <div className="flex flex-wrap gap-5">
            <AccountCardsRow
              className="flex-[5_1_480px]"
              accountBalances={data.accountBalances}
              accounts={accounts}
              format={format}
              onNewAccount={() => setNewAccountOpen(true)}
            />
            <SpendingByCategoryCard
              className="flex-[4_1_380px]"
              categorySpending={data.categorySpending}
              period={formatDate(now, "MMMM")}
              format={format}
            />
          </div>
          {(hasBudgets || hasBills || hasGoals || budgetsLoading || billsLoading || goalsLoading) && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-5">
              {budgetsLoading ? <WidgetSlot label="budgets" /> : hasBudgets && <BudgetsAtRiskWidget budgets={budgets} format={format} />}
              {billsLoading ? <WidgetSlot label="upcoming bills" /> : hasBills && <UpcomingBillsWidget rules={recurringRules} format={format} />}
              {goalsLoading ? <WidgetSlot label="savings goals" /> : hasGoals && <SavingsGoalsWidget goals={goals} format={format} />}
            </div>
          )}
          <RecentTransactionsCard
            recentTransactions={data.recentTransactions}
            accounts={accounts ?? []}
            categories={categories ?? []}
            format={format}
            onNewTransaction={() => setNewTransactionOpen(true)}
          />
        </div>
      ) : null}

      <NewTransactionDialog open={newTransactionOpen} onOpenChange={setNewTransactionOpen} />
      <NewAccountDialog open={newAccountOpen} onOpenChange={setNewAccountOpen} />
    </PullToRefresh>
  )
}
