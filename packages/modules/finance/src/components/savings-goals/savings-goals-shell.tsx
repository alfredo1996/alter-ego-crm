"use client"

import { formatDate } from "@alter-ego/kernel/dates"
import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { PageError } from "@alter-ego/ui/page/page-state"
import { StatusTabs } from "@alter-ego/ui/page/status-tabs"
import { Button } from "@alter-ego/ui/ui/button"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { Plus } from "lucide-react"
import { useState } from "react"
import { type z } from "zod"

import { ConfirmDeleteDialog } from "../confirm-delete-dialog"
import { AddFundsDialog } from "./add-funds-dialog"
import { SavingsGoalCard } from "./savings-goal-card"
import { SavingsGoalFormDialog } from "./savings-goal-form-dialog"
import { useCurrency } from "../../hooks/use-currency"
import {
  useSavingsGoalsWithProgress,
  useCreateSavingsGoal,
  useUpdateSavingsGoal,
  useDeleteSavingsGoal,
} from "../../hooks/use-savings-goals"
import { useAuth } from "../../host"
import { type createSavingsGoalSchema } from "../../schemas"

import type { SavingsGoalWithProgress } from "../../types"

type GoalFormValues = z.infer<typeof createSavingsGoalSchema>

export function SavingsGoalsShell() {
  const { user } = useAuth()
  const { format, defaultCurrency } = useCurrency()

  const { data: goals, isPending, refetch } = useSavingsGoalsWithProgress(user?.id)

  const createGoal = useCreateSavingsGoal(user?.id)
  const updateGoal = useUpdateSavingsGoal(user?.id)
  const deleteGoal = useDeleteSavingsGoal(user?.id)

  const [formOpen, setFormOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<SavingsGoalWithProgress | null>(null)
  const [deletingGoal, setDeletingGoal] = useState<SavingsGoalWithProgress | null>(null)
  const [status, setStatus] = useState<"all" | "progress" | "reached">("all")
  const [addFundsGoal, setAddFundsGoal] = useState<SavingsGoalWithProgress | null>(null)

  function handleCreate() {
    setEditingGoal(null)
    setFormOpen(true)
  }

  function handleEdit(goal: SavingsGoalWithProgress) {
    setEditingGoal(goal)
    setFormOpen(true)
  }

  function handleFormSubmit(values: GoalFormValues) {
    if (editingGoal) {
      updateGoal.mutate(
        { id: editingGoal.id, input: values },
        { onSuccess: () => setFormOpen(false) }
      )
    } else {
      createGoal.mutate(values, { onSuccess: () => setFormOpen(false) })
    }
  }

  function handleAddFundsConfirm(goalId: string, newAmount: number, isCompleted: boolean) {
    updateGoal.mutate(
      { id: goalId, input: { currentAmount: newAmount, isCompleted } },
      { onSuccess: () => setAddFundsGoal(null) }
    )
  }

  function handleDeleteConfirm() {
    if (!deletingGoal) return
    deleteGoal.mutate(deletingGoal.id, {
      onSuccess: () => setDeletingGoal(null),
    })
  }

  if (isPending) {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // Settled with no data: the first load failed.
  if (!goals) {
    return (
      <div>
        <PageHeader className="mb-6" title="Savings Goals" />
        <PageError message="Failed to load savings goals" onRetry={() => refetch()} />
      </div>
    )
  }

  const activeGoals = goals.filter((g) => !g.isCompleted)
  const reachedGoals = goals.filter((g) => g.isCompleted)
  // ponytail: the totals count goals in the default currency; foreign-currency goals have their own cards.
  const counted = goals.filter((g) => g.currency === defaultCurrency)
  const saved = counted.reduce((sum, g) => sum + g.currentAmount, 0)
  const target = counted.reduce((sum, g) => sum + g.targetAmount, 0)
  const next = activeGoals
    .filter((g) => g.targetDate && (g.daysRemaining ?? 0) > 0)
    .sort((a, b) => a.targetDate!.getTime() - b.targetDate!.getTime())[0]
  const subtitle =
    counted.length > 0 &&
    `${format(saved)} of ${format(target)} saved${next ? ` · next target ${next.name} on ${formatDate(next.targetDate!, "d MMM yyyy")}` : ""}`
  // A tab for a bucket that is empty would show nothing; with one bucket there is nothing to switch.
  const tabbed = activeGoals.length > 0 && reachedGoals.length > 0
  const shown = !tabbed || status === "all" ? goals : status === "progress" ? activeGoals : reachedGoals
  const cards = (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3 sm:gap-5">
      {shown.map((goal) => (
        <SavingsGoalCard
          key={goal.id}
          goal={goal}
          format={format}
          onEdit={handleEdit}
          onDelete={setDeletingGoal}
          onAddFunds={setAddFundsGoal}
        />
      ))}
    </div>
  )

  return (
    <div>
      <PageHeader
        className="mb-6"
        title="Savings Goals"
        subtitle={subtitle}
        actions={
          <Button size="lg" onClick={handleCreate}>
            <Plus className="h-4 w-4" />
            New Goal
          </Button>
        }
      />

      {goals.length === 0 ? (
        <EmptyPrompt
          title="No savings goals yet"
          description="Create a goal and track your progress toward it by adding funds over time."
          action={
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4" />
              Create your first goal
            </Button>
          }
        />
      ) : tabbed ? (
        <StatusTabs
          items={[
            { value: "all", label: "All", count: goals.length },
            { value: "progress", label: "In Progress", count: activeGoals.length },
            { value: "reached", label: "Reached", count: reachedGoals.length },
          ]}
          value={status}
          onValueChange={(v) => setStatus(v as typeof status)}
          aria-label="Goal status"
        >
          {cards}
        </StatusTabs>
      ) : (
        cards
      )}

      <SavingsGoalFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        goal={editingGoal}
        defaultCurrency={defaultCurrency}
        onSubmit={handleFormSubmit}
        isPending={createGoal.isPending || updateGoal.isPending}
      />

      <AddFundsDialog
        open={!!addFundsGoal}
        onOpenChange={(v) => !v && setAddFundsGoal(null)}
        goal={addFundsGoal}
        format={format}
        onConfirm={handleAddFundsConfirm}
        isPending={updateGoal.isPending}
      />

      <ConfirmDeleteDialog
        open={!!deletingGoal}
        onOpenChange={(open) => !open && setDeletingGoal(null)}
        title="Delete goal?"
        description={deletingGoal ? `"${deletingGoal.name}" will be permanently deleted. This cannot be undone.` : "This goal will be permanently deleted."}
        onConfirm={handleDeleteConfirm}
        isPending={deleteGoal.isPending}
      />
    </div>
  )
}
