"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/hooks/use-auth"
import { getBackend } from "@/lib/backend"

const API_KEYS_KEY = ["api-keys"] as const

export function useApiKeys() {
  const { user } = useAuth()
  return useQuery({
    queryKey: [...API_KEYS_KEY, user?.id],
    queryFn: () => getBackend().db.getApiKeys(user!.id),
    enabled: !!user?.id,
  })
}

export function useCreateApiKey() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in")
      return getBackend().db.createApiKey(user.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: API_KEYS_KEY })
    },
  })
}

export function useDeleteApiKey() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (keyId: string) => {
      if (!user) throw new Error("Not signed in")
      await getBackend().db.deleteApiKey(user.id, keyId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: API_KEYS_KEY })
    },
  })
}
