"use client"

import { useQuery } from "@tanstack/react-query"

import { getBackend } from "../host"

export function useRecurringHistory(userId: string | undefined, recurringId: string | undefined) {
  return useQuery({
    queryKey: ["recurring-history", userId, recurringId],
    queryFn: () => getBackend().db.getRecurringHistory(userId!, recurringId!),
    enabled: !!userId && !!recurringId,
  })
}
