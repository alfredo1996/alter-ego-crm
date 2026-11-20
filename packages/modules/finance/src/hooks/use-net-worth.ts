"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"

import { getBackend } from "../host"

const HISTORY_KEY = ["net-worth-history"] as const

export function useNetWorthHistory(userId: string | undefined, months = 12) {
  return useQuery({
    queryKey: [...HISTORY_KEY, userId, months],
    queryFn: () => getBackend().db.getNetWorthHistory(userId!, months),
    enabled: !!userId,
  })
}

/** The net worth as of the end of `date`'s day (the newest snapshot on or before it), null with none. */
export function useNetWorthAt(userId: string | undefined, date: Date) {
  const day = format(date, "yyyy-MM-dd")
  return useQuery({
    queryKey: ["net-worth-at", userId, day],
    queryFn: () => getBackend().db.getNetWorthAt(userId!, date),
    enabled: !!userId,
  })
}

export function useTakeSnapshot(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => getBackend().db.takeSnapshot(userId!),
    // Runs by itself once a day on the dashboard; a failure just retries next visit.
    meta: { silent: true },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY })
    },
  })
}
