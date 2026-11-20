"use client"

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query"

import { getBackend } from "../host"

import type {
  CreateTransactionInput,
  UpdateTransactionInput,
  TransactionFilters,
  Transaction,
  PaginatedResult,
} from "../types"

const TRANSACTIONS_KEY = ["transactions"] as const

export function useTransactions(userId: string | undefined, filters?: TransactionFilters, enabled = true) {
  return useQuery({
    queryKey: [...TRANSACTIONS_KEY, userId, filters],
    queryFn: () => getBackend().db.getTransactions(userId!, filters),
    enabled: !!userId && enabled,
    placeholderData: keepPreviousData,
  })
}

export function useTransaction(userId: string | undefined, transactionId: string | undefined) {
  return useQuery({
    queryKey: [...TRANSACTIONS_KEY, userId, transactionId],
    queryFn: () => getBackend().db.getTransaction(userId!, transactionId!),
    enabled: !!userId && !!transactionId,
  })
}

export function useCreateTransaction(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTransactionInput) =>
      getBackend().db.createTransaction(userId!, input),
    // Balance is maintained atomically inside createTransaction — no full recalc.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...TRANSACTIONS_KEY, userId] })
      queryClient.invalidateQueries({ queryKey: ["dashboard", userId] })
      queryClient.invalidateQueries({ queryKey: ["accounts", userId] })
    },
  })
}

export function useUpdateTransaction(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTransactionInput }) =>
      getBackend().db.updateTransaction(userId!, id, input),
    // Balance change is applied atomically inside updateTransaction — no full recalc.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...TRANSACTIONS_KEY, userId] })
      queryClient.invalidateQueries({ queryKey: ["dashboard", userId] })
      queryClient.invalidateQueries({ queryKey: ["accounts", userId] })
    },
  })
}

export function useDeleteTransaction(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (transactionId: string) =>
      getBackend().db.deleteTransaction(userId!, transactionId),
    // Optimistically drop the row from every cached transactions page so the UI
    // responds instantly; balance recalc + refetch happen in the background.
    onMutate: async (transactionId: string) => {
      const key = [...TRANSACTIONS_KEY, userId]
      await queryClient.cancelQueries({ queryKey: key })
      const snapshots = queryClient.getQueriesData<PaginatedResult<Transaction>>({ queryKey: key })
      for (const [qKey, page] of snapshots) {
        // other queries share this prefix (budget spending is an array), only pages have rows
        if (!page || !Array.isArray(page.data)) continue
        const data = page.data.filter((t) => t.id !== transactionId)
        if (data.length !== page.data.length) {
          queryClient.setQueryData(qKey, { ...page, data, total: Math.max(0, page.total - 1) })
        }
      }
      return { snapshots }
    },
    onError: (_err, _id, context) => {
      for (const [qKey, page] of context?.snapshots ?? []) {
        queryClient.setQueryData(qKey, page)
      }
    },
    // Balance is reversed atomically inside deleteTransaction — no full recalc.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [...TRANSACTIONS_KEY, userId] })
      queryClient.invalidateQueries({ queryKey: ["dashboard", userId] })
      queryClient.invalidateQueries({ queryKey: ["accounts", userId] })
    },
  })
}

export function useBulkDeleteTransactions(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (transactionIds: string[]) =>
      getBackend().db.deleteTransactions(userId!, transactionIds),
    // Each delete reverses its own balance effects atomically — no full recalc.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...TRANSACTIONS_KEY, userId] })
      queryClient.invalidateQueries({ queryKey: ["dashboard", userId] })
      queryClient.invalidateQueries({ queryKey: ["accounts", userId] })
      queryClient.invalidateQueries({ queryKey: ["reports", userId] })
    },
  })
}

export function useDescriptionSuggestions(userId: string | undefined) {
  return useQuery({
    queryKey: ["descriptions", userId],
    queryFn: () => getBackend().db.getUniqueDescriptions(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })
}

export function useDeleteAllTransactions(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => getBackend().db.deleteAllTransactions(userId!),
    onSuccess: async () => {
      await getBackend().db.recalculateBalances(userId!)
      queryClient.invalidateQueries({ queryKey: [...TRANSACTIONS_KEY, userId] })
      queryClient.invalidateQueries({ queryKey: ["dashboard", userId] })
      queryClient.invalidateQueries({ queryKey: ["accounts", userId] })
      queryClient.invalidateQueries({ queryKey: ["reports", userId] })
    },
  })
}
