"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { getBackend } from "../host"
import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateRecurringTransactionInput, UpdateRecurringTransactionInput } from "../types"

const RECURRING_KEY = ["recurring"] as const

export const useRecurring = createListHook(
  RECURRING_KEY,
  (userId) => getBackend().db.getRecurringTransactions(userId),
)

export const useCreateRecurring = createMutationHook<CreateRecurringTransactionInput>(
  RECURRING_KEY,
  (userId, input) => getBackend().db.createRecurringTransaction(userId, input),
  [["transactions"], ["dashboard"]],
)

export const useUpdateRecurring = createUpdateHook<UpdateRecurringTransactionInput>(
  RECURRING_KEY,
  (userId, recurringId, input) =>
    getBackend().db.updateRecurringTransaction(userId, recurringId, input),
  [["dashboard"], ["reports"]],
)

export const useDeleteRecurring = createDeleteHook(
  RECURRING_KEY,
  (userId, recurringId) =>
    getBackend().db.deleteRecurringTransaction(userId, recurringId),
  [["transactions"], ["dashboard"]],
)

export function useGenerateDue(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => getBackend().db.generateDue(userId!, new Date()),
    onSuccess: (generated) => {
      if (generated.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["transactions"] })
        queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      }
    },
  })
}
