"use client"

import { useQuery, keepPreviousData } from "@tanstack/react-query"

import { getBackend } from "../host"
import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"
import { loadBudgetsWithSpending } from "../lib/budgets"


import type { CreateBudgetInput, UpdateBudgetInput } from "../types"

const BUDGETS_KEY = ["budgets"] as const

export const useBudgets = createListHook(
  BUDGETS_KEY,
  (userId) => getBackend().db.getBudgets(userId),
)

/**
 * Budgets enriched with current-period spending. Reads the current period's transactions
 * and, for rollover budgets, one stored total per carried-over month.
 */
export function useBudgetsWithSpending(userId: string | undefined) {
  const budgetsQuery = useBudgets(userId)
  const budgets = budgetsQuery.data
  // Under "transactions" so every transaction write refetches it, as it did when this was
  // computed from the transactions query; the budgets in the key refetch it on a budget edit.
  const spendingQuery = useQuery({
    queryKey: ["transactions", userId, "budget-spending", budgets],
    queryFn: () => loadBudgetsWithSpending(getBackend().db, userId!, budgets!, new Date()),
    enabled: !!userId && !!budgets,
    placeholderData: keepPreviousData,
  })

  return {
    // undefined until both have loaded, so a failed first load reads as "no data"
    // (the error card), not as "no budgets".
    data: spendingQuery.data,
    // The spending query waits on the budgets, so a failed budgets load must not read as pending.
    isPending: budgetsQuery.isPending || (!!budgets && spendingQuery.isPending),
    refetch: () => Promise.all([budgetsQuery.refetch(), spendingQuery.refetch()]),
  }
}

export const useCreateBudget = createMutationHook<CreateBudgetInput>(
  BUDGETS_KEY,
  (userId, input) => getBackend().db.createBudget(userId, input),
  [["dashboard"]],
)

export const useUpdateBudget = createUpdateHook<UpdateBudgetInput>(
  BUDGETS_KEY,
  (userId, budgetId, input) => getBackend().db.updateBudget(userId, budgetId, input),
  [["dashboard"]],
)

export const useDeleteBudget = createDeleteHook(
  BUDGETS_KEY,
  (userId, budgetId) => getBackend().db.deleteBudget(userId, budgetId),
  [["dashboard"]],
)
