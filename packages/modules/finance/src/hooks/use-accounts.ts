"use client"

import { toast } from "@alter-ego/ui/use-toast"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { getBackend } from "../host"
import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"
import { useImportStore } from "../stores/import-store"


import type { CreateAccountInput, UpdateAccountInput } from "../types"

export const ACCOUNTS_KEY = ["accounts"] as const

export const useAccounts = createListHook(
  ACCOUNTS_KEY,
  (userId) => getBackend().db.getAccounts(userId),
)

/** Each account's newest transaction date, one call for all of them; the Accounts page only. */
export function useLastActivity(userId: string | undefined, accountIds: string[]) {
  return useQuery({
    // Under ["accounts", userId]: what refreshes the accounts (every transaction write) refreshes this.
    queryKey: [...ACCOUNTS_KEY, userId, "last-activity", accountIds.join(",")],
    queryFn: () => getBackend().db.getLastActivity(userId!, accountIds),
    enabled: !!userId && accountIds.length > 0,
    // A created or deleted account changes the key; keep the dates up meanwhile.
    placeholderData: keepPreviousData,
  })
}

export function useAccount(userId: string | undefined, accountId: string | undefined) {
  return useQuery({
    queryKey: [...ACCOUNTS_KEY, userId, accountId],
    queryFn: () => getBackend().db.getAccount(userId!, accountId!),
    enabled: !!userId && !!accountId,
  })
}

export const useCreateAccount = createMutationHook<CreateAccountInput>(
  ACCOUNTS_KEY,
  (userId, input) => getBackend().db.createAccount(userId, input),
  [["dashboard"]],
)

export const useUpdateAccount = createUpdateHook<UpdateAccountInput>(
  ACCOUNTS_KEY,
  (userId, accountId, input) => getBackend().db.updateAccount(userId, accountId, input),
  [["dashboard"]],
)

export const useDeleteAccount = createDeleteHook(
  ACCOUNTS_KEY,
  (userId, accountId) => getBackend().db.deleteAccount(userId, accountId),
  [["dashboard"]],
)

/**
 * Runs in the background: progress shows in the global indicator, and the
 * callbacks live on the hook rather than on mutate() so they still fire after
 * the user navigates away from Settings mid-delete.
 */
export function useDeleteAllAccountData(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => getBackend().db.deleteAllAccountData(userId!),
    onMutate: () =>
      useImportStore.getState().setActive({ label: "Deleting accounts and transactions…", done: 0, total: 0 }),
    onSuccess: () => toast({ title: "All accounts and transactions deleted" }),
    onError: (err) =>
      toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
    onSettled: () => {
      useImportStore.getState().setActive(null)
      // Everything derives from accounts and transactions; a partial failure changed data too.
      queryClient.invalidateQueries()
    },
  })
}
