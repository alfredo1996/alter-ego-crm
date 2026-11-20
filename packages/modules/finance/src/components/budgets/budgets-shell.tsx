"use client"

import { daysLeftInMonth, formatDate } from "@alter-ego/kernel/dates"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { PageError } from "@alter-ego/ui/page/page-state"
import { StatusPill } from "@alter-ego/ui/page/status-pill"
import { Button } from "@alter-ego/ui/ui/button"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { type z } from "zod"

import { BudgetCard, budgetState } from "./budget-card"
import { BudgetFormDialog } from "./budget-form-dialog"
import { BudgetsSummary } from "./budgets-summary"
import { useBudgetsWithSpending, useCreateBudget, useUpdateBudget, useDeleteBudget } from "../../hooks/use-budgets"
import { useCategories } from "../../hooks/use-categories"
import { useCurrency } from "../../hooks/use-currency"
import { useAuth } from "../../host"
import { type createBudgetSchema } from "../../schemas"
import { ConfirmDeleteDialog } from "../confirm-delete-dialog"

import type { BudgetWithSpending } from "../../types"

type BudgetFormValues = z.infer<typeof createBudgetSchema>

export function BudgetsShell() {
  const { user } = useAuth()
  const { format, defaultCurrency } = useCurrency()

  const { data: budgets, isPending, refetch } = useBudgetsWithSpending(user?.id)
  const { data: categories } = useCategories(user?.id)

  const createBudget = useCreateBudget(user?.id)
  const updateBudget = useUpdateBudget(user?.id)
  const deleteBudget = useDeleteBudget(user?.id)

  const [formOpen, setFormOpen] = useState(false)
  const [editingBudget, setEditingBudget] = useState<BudgetWithSpending | null>(null)
  const [deletingBudget, setDeletingBudget] = useState<BudgetWithSpending | null>(null)

  function handleCreate() {
    setEditingBudget(null)
    setFormOpen(true)
  }

  function handleEdit(budget: BudgetWithSpending) {
    setEditingBudget(budget)
    setFormOpen(true)
  }

  function handleFormSubmit(values: BudgetFormValues) {
    if (editingBudget) {
      updateBudget.mutate(
        { id: editingBudget.id, input: values },
        { onSuccess: () => setFormOpen(false) }
      )
    } else {
      createBudget.mutate(values, { onSuccess: () => setFormOpen(false) })
    }
  }

  function handleDeleteConfirm() {
    if (!deletingBudget) return
    deleteBudget.mutate(deletingBudget.id, {
      onSuccess: () => setDeletingBudget(null),
    })
  }

  // Over-limit budgets first; the rest keep their order.
  const sorted = useMemo(
    () => budgets && [...budgets].sort((a, b) => Number(budgetState(b) === "over") - Number(budgetState(a) === "over")),
    [budgets],
  )

  if (isPending) {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // Settled with no data: the first load failed.
  if (!budgets || !sorted) {
    return (
      <div>
        <PageHeader className="mb-6" title="Budgets" />
        <PageError message="Failed to load budgets" onRetry={() => refetch()} />
      </div>
    )
  }

  const now = new Date()
  const daysLeft = daysLeftInMonth(now)
  // ponytail: the summary totals this month's budgets in the default currency; yearly and
  // foreign-currency budgets have their own cards. Convert or split it when someone needs both.
  const monthly = budgets.filter((b) => b.period === "monthly" && b.currency === defaultCurrency)

  return (
    <div>
      <PageHeader
        className="mb-6"
        title="Budgets"
        subtitle={`${formatDate(now, "MMMM yyyy")} · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}
        actions={
          <Button size="lg" onClick={handleCreate}>
            <Plus className="h-4 w-4" />
            New Budget
          </Button>
        }
      />

      {budgets.length === 0 ? (
        <EmptyPrompt
          title="No budgets yet"
          description="Create budgets to track your spending against monthly or yearly limits."
          action={
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4" />
              Create your first budget
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-6 sm:gap-7">
          <BudgetsSummary budgets={monthly} format={format} monthName={formatDate(now, "MMMM")} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3 sm:gap-5">
            {sorted.map((budget) => (
              <BudgetCard
                key={budget.id}
                budget={budget}
                categories={categories ?? []}
                format={format}
                onEdit={handleEdit}
                onDelete={setDeletingBudget}
              />
            ))}
          </div>
          <ul aria-label="What the labels mean" className="flex flex-col gap-2 text-[13px] text-subtle-foreground sm:flex-row sm:flex-wrap sm:gap-x-6">
            <li className="flex items-center gap-2">
              <StatusPill tone="success">On track</StatusPill> under 80% of the limit
            </li>
            <li className="flex items-center gap-2">
              <StatusPill tone="warning">Near limit</StatusPill> from 80%
            </li>
            <li className="flex items-center gap-2">
              <StatusPill tone="danger">Over</StatusPill> at or past the limit, shown first
            </li>
          </ul>
        </div>
      )}

      <BudgetFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        budget={editingBudget}
        categories={categories ?? []}
        defaultCurrency={defaultCurrency}
        onSubmit={handleFormSubmit}
        isPending={createBudget.isPending || updateBudget.isPending}
      />

      <ConfirmDeleteDialog
        open={!!deletingBudget}
        onOpenChange={(open) => !open && setDeletingBudget(null)}
        title="Delete budget?"
        description={deletingBudget ? `"${deletingBudget.name}" will be permanently deleted. This cannot be undone.` : "This budget will be permanently deleted."}
        onConfirm={handleDeleteConfirm}
        isPending={deleteBudget.isPending}
      />
    </div>
  )
}
