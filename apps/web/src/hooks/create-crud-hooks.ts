"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

/**
 * Creates a standard list query hook that fetches data for a given userId.
 */
export function createListHook<T>(
  key: readonly string[],
  fetcher: (userId: string) => Promise<T[]>,
) {
  return function useList(userId: string | undefined) {
    return useQuery({
      queryKey: [...key, userId],
      queryFn: () => fetcher(userId!),
      enabled: !!userId,
    })
  }
}

/**
 * Creates a standard mutation hook with automatic query invalidation.
 * @param key - primary query key to invalidate
 * @param mutator - the backend mutation function
 * @param extraInvalidations - additional query keys to invalidate on success
 */
export function createMutationHook<TInput, TResult = unknown>(
  key: readonly string[],
  mutator: (userId: string, input: TInput) => Promise<TResult>,
  extraInvalidations?: readonly (readonly string[])[],
) {
  return function useMutationHook(userId: string | undefined) {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: (input: TInput) => mutator(userId!, input),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [...key, userId] })
        if (extraInvalidations) {
          for (const inv of extraInvalidations) {
            queryClient.invalidateQueries({ queryKey: [...inv] })
          }
        }
      },
    })
  }
}

/**
 * Creates a mutation hook for update operations where the input is { id, input }.
 */
export function createUpdateHook<TInput>(
  key: readonly string[],
  mutator: (userId: string, id: string, input: TInput) => Promise<unknown>,
  extraInvalidations?: readonly (readonly string[])[],
) {
  return function useUpdateHook(userId: string | undefined) {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: TInput }) =>
        mutator(userId!, id, input),
      // Returned, so the mutation stays pending until the list is refetched: a dialog left open
      // on the item (Amend Contract after a Remove) must not write again from the copy before it.
      onSuccess: () => {
        if (extraInvalidations) {
          for (const inv of extraInvalidations) {
            queryClient.invalidateQueries({ queryKey: [...inv] })
          }
        }
        return queryClient.invalidateQueries({ queryKey: [...key, userId] })
      },
    })
  }
}

/**
 * Creates a mutation hook for delete operations (takes a single ID string).
 */
export function createDeleteHook(
  key: readonly string[],
  mutator: (userId: string, id: string) => Promise<unknown>,
  extraInvalidations?: readonly (readonly string[])[],
) {
  return function useDeleteHook(userId: string | undefined) {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: (id: string) => mutator(userId!, id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [...key, userId] })
        if (extraInvalidations) {
          for (const inv of extraInvalidations) {
            queryClient.invalidateQueries({ queryKey: [...inv] })
          }
        }
      },
    })
  }
}
