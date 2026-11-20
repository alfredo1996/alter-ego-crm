"use client"

import { FilterBar, FilterSelect } from "@alter-ego/ui/page/filter-bar"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { format as fmtDate, isThisMonth } from "date-fns"
import { Repeat, X } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useState } from "react"



import { BudgetsCard } from "./budgets-card"
import { NetWorthCard } from "./net-worth-card"
import { OverviewCard } from "./overview-card"
import { PeriodSelector } from "./period-selector"
import { ReportFiltersBar } from "./report-filters"
import { ReportSections } from "./report-sections"
import { TopTransactionsTable } from "./top-transactions-table"
import { WhereItWentCard } from "./where-it-went-card"
import { useAccounts } from "../../hooks/use-accounts"
import { useBudgetsWithSpending } from "../../hooks/use-budgets"
import { useCategories } from "../../hooks/use-categories"
import { useCurrency } from "../../hooks/use-currency"
import { useNetWorthHistory } from "../../hooks/use-net-worth"
import {
  analysisPeriodToDateRange,
  deltaText,
  deserializePeriod,
  effectiveComparisonMode,
  fillMonths,
  getComparisonPeriod,
  netDetail,
  periodEyebrow,
  periodLabel,
  periodSubtitle,
  serializePeriod,
  trendMonths,
  trendPeriod,
  useReportComparison,
  useReports,
  type ComparisonMode,
  type ReportFilters,
} from "../../hooks/use-reports"
import { useAuth } from "../../host"

import type { AnalysisPeriod } from "../../types"


export function ReportsShell() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const period: AnalysisPeriod = deserializePeriod(searchParams)

  const setPeriod = useCallback(
    (next: AnalysisPeriod) => {
      const params = new URLSearchParams(searchParams.toString())
      const serialized = serializePeriod(next)
      // clear old period params then set new ones
      for (const key of ["p", "y", "m", "n"]) params.delete(key)
      for (const [k, v] of Object.entries(serialized)) params.set(k, v)
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  // Filters: accountIds and categoryIds from URL params (comma-separated)
  const filters: ReportFilters = {
    accountIds: searchParams.get("accts")?.split(",").filter(Boolean) || undefined,
    categoryIds: searchParams.get("cats")?.split(",").filter(Boolean) || undefined,
  }

  const setFilters = useCallback(
    (next: ReportFilters) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next.accountIds?.length) {
        params.set("accts", next.accountIds.join(","))
      } else {
        params.delete("accts")
      }
      if (next.categoryIds?.length) {
        params.set("cats", next.categoryIds.join(","))
      } else {
        params.delete("cats")
      }
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  const { data, isPending, error } = useReports(user?.id, period, filters)
  const [pickedComparison, setComparisonMode] = useState<ComparisonMode>("none")
  // Only a month or a year has a period before it; a year has no "same month last year".
  const comparable = period.mode === "monthly" || period.mode === "yearly"
  const comparisonMode = effectiveComparisonMode(period, pickedComparison)
  const { data: comparisonData, isPlaceholderData: comparisonStale } = useReportComparison(user?.id, period, comparisonMode, filters)
  const { format, formatWhole, formatCompact, defaultCurrency } = useCurrency()
  // A month's own report holds one month: the chart reads its trailing window. Any other period
  // asks for itself, which is the query above (same key, one read).
  const { data: trend, isPending: trendPending, isError: trendFailed } = useReports(user?.id, trendPeriod(period), filters)

  const { data: accounts } = useAccounts(user?.id)
  const { data: categories, isPending: categoriesPending } = useCategories(user?.id)
  const { data: netWorthHistory, isPending: netWorthPending } = useNetWorthHistory(user?.id, 12)
  const { data: budgets, isPending: budgetsPending } = useBudgetsWithSpending(user?.id)

  // One skeleton until the lower sections can render too: Budgets This
  // Period popped in and pushed Net Worth down, which first read "No net worth history
  // yet", and top expenses read "Uncategorized" until categories arrived.
  if (isPending || trendPending || categoriesPending || netWorthPending || budgetsPending) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-10 w-44" />
        </div>
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-destructive">Failed to load reports. Please try again.</p>
      </div>
    )
  }

  const topExpenses = data?.topExpenses ?? []
  // The tinted column of the chart: the month the page is about, only when it is a month.
  const focus = period.mode === "monthly" ? `${period.year}-${String(period.month).padStart(2, "0")}` : undefined
  const now = new Date()
  const focusLabel = period.mode === "monthly" && isThisMonth(new Date(period.year, period.month - 1, 1)) ? `${fmtDate(now, "MMM")} · to ${fmtDate(now, "do")}` : undefined
  const income = data?.totalIncome ?? 0
  const expenses = data?.totalExpenses ?? 0
  const net = data?.netSavings ?? 0

  const comparison = getComparisonPeriod(period, comparisonMode)
  const hasComparison = !!comparison && !!comparisonData && !comparisonStale
  const since = comparison?.label ?? ""
  const compareName = (mode: Exclude<ComparisonMode, "none">) =>
    mode === "year-ago" ? "Same Month Last Year" : period.mode === "yearly" ? "Previous Year" : "Previous Month"
  const compareOptions: { value: string; label: string }[] =
    period.mode === "yearly"
      ? [{ value: "previous", label: compareName("previous") }]
      : [
          { value: "previous", label: compareName("previous") },
          { value: "year-ago", label: compareName("year-ago") },
        ]
  const activeFilters = (filters.accountIds?.length ? 1 : 0) + (filters.categoryIds?.length ? 1 : 0) + (comparisonMode !== "none" ? 1 : 0)

  const named = (ids: string[] | undefined, all: { id: string; name: string }[]) =>
    ids!.length === 1 ? (all.find((x) => x.id === ids![0])?.name ?? "1 selected") : `${ids!.length} selected`
  const chips: { key: string; text: string; clear: () => void }[] = []
  if (filters.accountIds?.length)
    chips.push({ key: "accts", text: `Accounts: ${named(filters.accountIds, accounts ?? [])}`, clear: () => setFilters({ ...filters, accountIds: undefined }) })
  if (filters.categoryIds?.length)
    chips.push({ key: "cats", text: `Categories: ${named(filters.categoryIds, categories ?? [])}`, clear: () => setFilters({ ...filters, categoryIds: undefined }) })
  if (comparisonMode !== "none")
    chips.push({ key: "compare", text: `Compare: ${compareName(comparisonMode)}`, clear: () => setComparisonMode("none") })

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle={periodSubtitle(period)} />

      <div role="group" aria-label="Report period and filters" className="flex flex-wrap items-center gap-2.5">
        <PeriodSelector value={period} onChange={setPeriod} />
        <span aria-hidden className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <FilterBar className="contents" sheet={{ active: activeFilters }}>
          <ReportFiltersBar accounts={accounts ?? []} categories={categories ?? []} filters={filters} onChange={setFilters} />
          {comparable && (
            <FilterSelect
              label="Compare"
              allLabel="No comparison"
              noneLabel="None"
              value={comparisonMode === "none" ? null : comparisonMode}
              options={compareOptions}
              onValueChange={(v) => setComparisonMode((v ?? "none") as ComparisonMode)}
            />
          )}
        </FilterBar>
        {/* A phone keeps the filters in the sheet; what is set stays visible, and removable, here. */}
        {chips.length > 0 && (
          <ul className="flex basis-full flex-wrap gap-2 sm:hidden">
            {chips.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={c.clear}
                  aria-label={`Remove ${c.text}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-foreground px-3 text-sm"
                >
                  {c.text}
                  <X aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ReportSections
        items={[
          { id: "overview", label: "In and Out" },
          { id: "where", label: "Where It Went", count: data?.categorySpending.length },
          ...(topExpenses.length > 0 ? [{ id: "top", label: "Top Expenses", count: topExpenses.length }] : []),
          ...(budgets && budgets.length > 0 ? [{ id: "budgets", label: "Budgets", count: budgets.length }] : []),
          { id: "worth", label: "Net Worth" },
        ]}
      />

      <OverviewCard
        eyebrow={periodEyebrow(period)}
        income={income}
        expenses={expenses}
        net={net}
        incomeDetail={hasComparison ? deltaText(income, comparisonData.totalIncome, since, format) : undefined}
        expensesDetail={hasComparison ? deltaText(expenses, comparisonData.totalExpenses, since, format) : undefined}
        netText={netDetail(income, expenses, format)}
        months={fillMonths(trend?.monthlySummary ?? [], trendMonths(period))}
        mode={period.mode}
        monthsFailed={trendFailed}
        focusMonth={focus}
        focusLabel={focusLabel}
        format={format}
        whole={formatWhole}
        compact={formatCompact}
      />

      {/* The suspected subscriptions moved to Recurring (plan §3, /reports). Their count would need
          that tab's own lazy read, so Reports keeps the link. */}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-hairline bg-surface-subtle px-[18px] py-3 text-sm text-subtle-foreground">
        <Repeat aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span>
          Repeating charges that look like subscriptions are listed on{" "}
          <Link href="/recurring?tab=suggested" className="font-medium text-foreground underline underline-offset-4">
            Recurring, under Suggested
          </Link>
          .
        </span>
      </p>

      <WhereItWentCard data={data?.categorySpending ?? []} period={periodLabel(period)} format={format} />

      <TopTransactionsTable
        transactions={topExpenses}
        categories={categories ?? []}
        accounts={accounts ?? []}
        format={format}
        period={periodLabel(period)}
        range={analysisPeriodToDateRange(period)}
        totalExpenses={expenses}
      />

      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        {budgets && budgets.length > 0 && <BudgetsCard budgets={budgets} currency={defaultCurrency} format={format} />}
        <NetWorthCard data={netWorthHistory ?? []} format={format} whole={formatWhole} compact={formatCompact} />
      </div>
    </div>
  )
}
