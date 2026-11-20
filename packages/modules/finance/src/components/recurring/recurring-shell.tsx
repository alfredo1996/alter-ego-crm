"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { DataTableCard } from "@alter-ego/ui/page/data-table-card"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { SignedAmount } from "@alter-ego/ui/page/signed-amount"
import { StatCard, StatStrip } from "@alter-ego/ui/page/stat-card"
import { StatusTabs } from "@alter-ego/ui/page/status-tabs"
import { Button } from "@alter-ego/ui/ui/button"
import { Card, CardContent } from "@alter-ego/ui/ui/card"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { cn } from "@alter-ego/ui/utils"
import { format as formatDate } from "date-fns"
import { Plus, AlertCircle } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useState, useEffect } from "react"
import { type z } from "zod"

import { ConfirmDeleteDialog } from "../confirm-delete-dialog"
import { RecurringFormDialog } from "./recurring-form-dialog"
import { RULE_GRID, RecurringRow } from "./recurring-row"
import { SuggestedTab } from "./suggested-tab"
import { useAccounts } from "../../hooks/use-accounts"
import { useCategories } from "../../hooks/use-categories"
import { useCurrency } from "../../hooks/use-currency"
import {
  useRecurring,
  useCreateRecurring,
  useUpdateRecurring,
  useDeleteRecurring,
  useGenerateDue,
} from "../../hooks/use-recurring"
import { useSuspectedSubscriptions } from "../../hooks/use-suspected-subscriptions"
import { useAuth } from "../../host"
import { summarizeRecurring } from "../../lib/recurring-summary"
import { type createRecurringTransactionSchema } from "../../schemas"

import type { RecurringTransaction } from "../../types"

type TabId = "active" | "loans" | "paused" | "suggested"
type FormValues = z.infer<typeof createRecurringTransactionSchema>

export function RecurringShell() {
  const { user } = useAuth()
  const { format, defaultCurrency } = useCurrency()

  const { data: rules, isPending, isError, refetch } = useRecurring(user?.id)
  const { data: accounts } = useAccounts(user?.id)
  const { data: categories } = useCategories(user?.id)

  const createRule = useCreateRecurring(user?.id)
  const updateRule = useUpdateRecurring(user?.id)
  const deleteRule = useDeleteRecurring(user?.id)
  const generateDue = useGenerateDue(user?.id)

  const [formOpen, setFormOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RecurringTransaction | null>(null)
  const [deletingRule, setDeletingRule] = useState<RecurringTransaction | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)
  // Reports' link opens the page on ?tab=suggested.
  const [tab, setTab] = useState<TabId>(useSearchParams().get("tab") === "suggested" ? "suggested" : "active")
  // The 13-month expense read behind Suggested is the heavy one: it starts when the tab is
  // first opened, and the count shows from then on. Until then the tab has no count.
  const [suggestedOpened, setSuggestedOpened] = useState(tab === "suggested")
  const suggestions = useSuspectedSubscriptions(suggestedOpened)

  // Generate due transactions once per day
  useEffect(() => {
    if (!user?.id) return
    const today = isoDate(new Date())
    const key = `alter-ego-generate-due-${today}`
    if (localStorage.getItem(key)) return
    generateDue.mutate(undefined, {
      onSuccess: () => localStorage.setItem(key, "1"),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  function handleCreate() {
    setEditingRule(null)
    setFormOpen(true)
  }

  function handleEdit(rule: RecurringTransaction) {
    setEditingRule(rule)
    setFormOpen(true)
  }

  function handleToggle(rule: RecurringTransaction) {
    updateRule.mutate({ id: rule.id, input: { isActive: !rule.isActive } })
  }

  function handleFormSubmit(values: FormValues) {
    if (editingRule) {
      updateRule.mutate(
        { id: editingRule.id, input: values },
        { onSuccess: () => setFormOpen(false) }
      )
    } else {
      createRule.mutate(values, { onSuccess: () => setFormOpen(false) })
    }
  }

  function handleDeleteConfirm() {
    if (!deletingRule) return
    deleteRule.mutate(deletingRule.id, {
      onSuccess: () => setDeletingRule(null),
    })
  }

  if (isPending) {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-11 w-40" />
        </div>
        <Skeleton className="mb-6 h-28 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    )
  }

  if (isError && !rules) {
    return (
      <div>
        <PageHeader className="mb-6" title="Recurring Transactions" />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-muted-foreground">Failed to load recurring transactions</p>
            <Button variant="outline" onClick={() => refetch()}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Next due first, so the soonest charge heads each tab.
  const all = [...(rules ?? [])].sort((a, b) => a.nextDueDate.getTime() - b.nextDueDate.getTime())
  const byTab: Record<Exclude<TabId, "suggested">, RecurringTransaction[]> = {
    active: all.filter((r) => r.isActive && r.loanMeta === null),
    loans: all.filter((r) => r.isActive && r.loanMeta !== null),
    paused: all.filter((r) => !r.isActive),
  }
  const running = all.filter((r) => r.isActive)
  const soonest = running[0]
  const summary = summarizeRecurring(all)
  const left = summary.monthlyIn.total - summary.monthlyOut.total
  const tabs = [
    { value: "active", label: "Active", count: byTab.active.length },
    // Only when there is a loan: a tab nobody can use is noise.
    ...(byTab.loans.length > 0 ? [{ value: "loans", label: "Loans", count: byTab.loans.length }] : []),
    { value: "paused", label: "Paused", count: byTab.paused.length },
    {
      value: "suggested",
      label: "Suggested",
      count: suggestedOpened && !suggestions.isLoading ? suggestions.data.length : undefined,
    },
  ]
  // The tab that emptied (the last loan deleted) falls back to Active.
  const shown: TabId = tabs.some((t) => t.value === tab) ? tab : "active"
  const visible = shown === "suggested" ? [] : byTab[shown]
  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      <PageHeader
        title="Recurring Transactions"
        subtitle={
          soonest
            ? `${running.length} running · next: ${soonest.description} on ${formatDate(soonest.nextDueDate, "d MMM")}`
            : "Nothing running"
        }
        actions={
          <Button size="lg" onClick={handleCreate}>
            <Plus />
            New Rule
          </Button>
        }
      />

      {running.length > 0 && (
        <StatStrip aria-label="Every month">
          <StatCard
            label="In every month"
            value={<SignedAmount amount={summary.monthlyIn.total} kind="in" format={format} className="font-semibold" />}
            detail={summary.monthlyIn.names.length > 2 ? `${summary.monthlyIn.names.length} rules` : summary.monthlyIn.names.join(", ")}
          />
          <StatCard
            label="Out every month"
            value={<SignedAmount amount={summary.monthlyOut.total} kind="out" format={format} className="font-semibold" />}
            detail={otherLine(summary, format)}
          />
          <StatCard label="Left every month" value={format(left)} detail="Before day-to-day spending" />
        </StatStrip>
      )}

      <StatusTabs items={tabs} value={shown} onValueChange={(v) => {
          setTab(v as TabId)
          if (v === "suggested") setSuggestedOpened(true)
        }} aria-label="Rule status">
        {shown === "suggested" ? (
          suggestions.isLoading ? (
            <Skeleton className="h-60 w-full rounded-xl" />
          ) : (
            <SuggestedTab data={suggestions.data} transactions={suggestions.transactions} />
          )
        ) : visible.length === 0 ? (
          shown === "active" && all.length === 0 ? (
            <EmptyPrompt
              title="No recurring rules yet"
              description="Set up a rule for regular income or an expense and the app creates it for you each period."
              action={
                <Button onClick={handleCreate}>
                  <Plus />
                  Create your first rule
                </Button>
              }
            />
          ) : (
            <EmptyPrompt title={`No ${shown} rules`} />
          )
        ) : (
          <DataTableCard>
            <div aria-hidden className={cn(RULE_GRID, "bg-surface-subtle py-2.5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase max-sm:hidden sm:pl-[22px] sm:pr-[22px]")}>
              <span>Rule</span>
              <span>Repeats</span>
              <span>Next</span>
              <span className="text-right">Amount</span>
              <span className="w-[182px]" />
            </div>
            <ul>
              {visible.map((rule) => (
                <RecurringRow
                  key={rule.id}
                  rule={rule}
                  categories={categories ?? []}
                  accountName={accountName(rule.accountId)}
                  format={format}
                  historyOpen={historyId === rule.id}
                  onEdit={handleEdit}
                  onDelete={setDeletingRule}
                  onToggle={handleToggle}
                  onHistory={(r) => setHistoryId(historyId === r.id ? null : r.id)}
                />
              ))}
            </ul>
          </DataTableCard>
        )}
      </StatusTabs>

      <RecurringFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        rule={editingRule}
        accounts={accounts ?? []}
        categories={categories ?? []}
        defaultCurrency={defaultCurrency}
        onSubmit={handleFormSubmit}
        isPending={createRule.isPending || updateRule.isPending}
      />

      <ConfirmDeleteDialog
        open={!!deletingRule}
        onOpenChange={(open) => !open && setDeletingRule(null)}
        title="Delete Recurring Rule"
        description={`Are you sure you want to delete \u201c${deletingRule?.description}\u201d? This will stop future auto-generation but will not remove transactions already created.`}
        onConfirm={handleDeleteConfirm}
        isPending={deleteRule.isPending}
        confirmLabel="Delete Rule"
      />
    </div>
  )
}

/** "5 rules, plus −€480.00 a year for Car insurance": what the monthly figure leaves out. */
function otherLine(s: ReturnType<typeof summarizeRecurring>, format: (n: number) => string) {
  const rules = `${s.monthlyOut.count} ${s.monthlyOut.count === 1 ? "rule" : "rules"}`
  if (!s.other || s.other.out === 0) return rules
  if (s.other.yearlyOnly) return `${rules}, plus −${format(s.other.out)} a year for ${s.other.names.join(", ")}`
  return `${rules}, plus ${s.other.names.length} on another cycle`
}
