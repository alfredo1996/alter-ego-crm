"use client"


import { FilterBar } from "@alter-ego/ui/page/filter-bar"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { StatusTabs } from "@alter-ego/ui/page/status-tabs"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@alter-ego/ui/ui/alert-dialog"
import { Button } from "@alter-ego/ui/ui/button"
import { Card, CardContent } from "@alter-ego/ui/ui/card"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { format as formatDate } from "date-fns"
import { Plus, AlertCircle } from "lucide-react"
import { useMemo, useState } from "react"

import { CategoryFormDialog } from "./category-form-dialog"
import { CategoryList } from "./category-list"
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from "../../hooks/use-categories"
import { useCurrency } from "../../hooks/use-currency"
import { useDashboard } from "../../hooks/use-dashboard"
import { useAuth } from "../../host"
import { categoryGroups, kindCounts, type CategoryKind } from "../../lib/category-groups"

import type { CategoryFormValues } from "../../schemas"
import type { Category } from "../../types"

export function CategoriesShell() {
  const { user } = useAuth()
  const { data: categories, isPending, isError, error, refetch } = useCategories(user?.id)

  // Spend never blocks the list: without it the cards just show no amounts.
  const { data: dashboard } = useDashboard(user?.id)
  const { format } = useCurrency()
  const spend = useMemo(
    () => (dashboard ? new Map(dashboard.categorySpending.map((s) => [s.categoryId, s.amount])) : undefined),
    [dashboard]
  )
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<CategoryKind>("all")

  const createCategory = useCreateCategory(user?.id)
  const updateCategory = useUpdateCategory(user?.id)
  const deleteCategory = useDeleteCategory(user?.id)

  const [formOpen, setFormOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null)

  function handleCreate() {
    setEditingCategory(null)
    setFormOpen(true)
  }

  function handleEdit(category: Category) {
    setEditingCategory(category)
    setFormOpen(true)
  }

  function handleFormSubmit(values: CategoryFormValues) {
    if (editingCategory) {
      updateCategory.mutate(
        { categoryId: editingCategory.id, input: values },
        { onSuccess: () => setFormOpen(false) }
      )
    } else {
      createCategory.mutate(values, {
        onSuccess: () => setFormOpen(false),
      })
    }
  }

  function handleDeleteConfirm() {
    if (!deletingCategory) return
    deleteCategory.mutate(deletingCategory.id, {
      onSuccess: () => setDeletingCategory(null),
    })
  }

  if (isPending) {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-11 w-36" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3 sm:gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (isError && !categories) {
    return (
      <div>
        <PageHeader className="mb-6" title="Categories" />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Failed to load categories"}
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const all = categories ?? []
  const counts = kindCounts(all)
  const groups = categoryGroups(all, { query, kind, spend })
  const used = all.filter((c) => spend?.get(c.id)).length
  // Money out is a minus in the text colour, as everywhere (plan §0.5).
  const formatOut = (amount: number) => `−${format(amount)}`

  return (
    <div>
      <PageHeader
        className="mb-6"
        title="Categories"
        subtitle={all.length > 0 && `${all.length} categories in ${new Set(all.map((c) => c.group)).size} groups`}
        actions={
          <Button size="lg" onClick={handleCreate}>
            <Plus className="h-4 w-4" />
            New Category
          </Button>
        }
      />

      {all.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">No categories found.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <FilterBar
            search={{ value: query, onChange: setQuery, label: "Search categories", placeholder: `Search ${all.length} categories…` }}
          />
          <StatusTabs
            items={[
              { value: "all", label: "All", count: counts.all },
              { value: "income", label: "Income", count: counts.income },
              { value: "expenses", label: "Expenses", count: counts.expenses },
            ]}
            value={kind}
            onValueChange={(v) => setKind(v as CategoryKind)}
            aria-label="Kind"
            toolbar={
              dashboard && (
                <p className="text-[13px] text-muted-foreground">
                  {formatDate(new Date(), "MMMM")} so far: <span className="text-foreground">{used} {used === 1 ? "category" : "categories"} used</span>,{" "}
                  <span className="font-medium text-foreground tabular-nums">{formatOut(dashboard.monthlyExpenses)}</span> out
                </p>
              )
            }
          >
            {groups.length === 0 ? (
              <p className="py-12 text-center text-muted-foreground">No categories match &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              <CategoryList groups={groups} spend={spend} formatOut={formatOut} onEdit={handleEdit} onDelete={setDeletingCategory} onReset={(c) => deleteCategory.mutate(c.id)} />
            )}
          </StatusTabs>
        </div>
      )}

      <CategoryFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        category={editingCategory}
        onSubmit={handleFormSubmit}
        isPending={createCategory.isPending || updateCategory.isPending}
      />

      <AlertDialog
        open={!!deletingCategory}
        onOpenChange={(open) => !open && setDeletingCategory(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deletingCategory?.name}&rdquo;? Transactions
              using this category will become uncategorized.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCategory.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteCategory.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCategory.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
