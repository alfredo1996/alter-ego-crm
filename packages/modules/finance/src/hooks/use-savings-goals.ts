"use client"

import { useMemo, useState } from "react"

import { getBackend } from "../host"
import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateSavingsGoalInput, UpdateSavingsGoalInput, SavingsGoalWithProgress } from "../types"

const GOALS_KEY = ["savings-goals"] as const

export const useSavingsGoals = createListHook(
  GOALS_KEY,
  (userId) => getBackend().db.getSavingsGoals(userId),
)

export function useSavingsGoalsWithProgress(userId: string | undefined) {
  const query = useSavingsGoals(userId)
  // Capture current time once per render cycle so the Compiler sees a stable value
  const [mountedAt] = useState<number>(Date.now)

  // undefined until loaded, so a failed first load is not "no goals"
  const goalsWithProgress = useMemo<SavingsGoalWithProgress[] | undefined>(() => {
    return query.data?.map((goal) => {
      const percentage = goal.targetAmount > 0
        ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100)
        : 0
      const remaining = Math.max(0, goal.targetAmount - goal.currentAmount)
      const daysRemaining = goal.targetDate
        ? Math.ceil((goal.targetDate.getTime() - mountedAt) / 86_400_000)
        : null
      const isCompleted = percentage >= 100

      return { ...goal, percentage, remaining, daysRemaining, isCompleted }
    })
  }, [query.data, mountedAt])

  return { ...query, data: goalsWithProgress }
}

export const useCreateSavingsGoal = createMutationHook<CreateSavingsGoalInput>(
  GOALS_KEY,
  (userId, input) => getBackend().db.createSavingsGoal(userId, input),
  [["dashboard"]],
)

export const useUpdateSavingsGoal = createUpdateHook<UpdateSavingsGoalInput>(
  GOALS_KEY,
  (userId, goalId, input) => getBackend().db.updateSavingsGoal(userId, goalId, input),
  [["dashboard"]],
)

export const useDeleteSavingsGoal = createDeleteHook(
  GOALS_KEY,
  (userId, goalId) => getBackend().db.deleteSavingsGoal(userId, goalId),
  [["dashboard"]],
)
