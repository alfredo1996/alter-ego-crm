"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import { ACCOUNTS_KEY } from "./use-accounts"
import { CATEGORIES_KEY } from "./use-categories"
import { getBackend } from "../host"

const DASHBOARD_KEY = ["dashboard"] as const

export function useDashboard(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: [...DASHBOARD_KEY, userId],
    queryFn: async () => {
      const data = await getBackend().db.getDashboardData(userId!)
      // It read both lists already: hand them to the page's own hooks instead of letting
      // them read the same collections again. An existing copy is left alone.
      const seed = (key: readonly string[], rows: unknown[]) => {
        const k = [...key, userId]
        if (queryClient.getQueryData(k) === undefined) queryClient.setQueryData(k, rows)
      }
      seed(ACCOUNTS_KEY, data.accounts)
      seed(CATEGORIES_KEY, data.categories)
      return data
    },
    enabled: !!userId,
  })
}
