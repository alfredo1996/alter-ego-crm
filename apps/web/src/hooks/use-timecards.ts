"use client"

import { useQuery } from "@tanstack/react-query"

import { getBackend } from "@/lib/backend"

import { createMutationHook } from "./create-crud-hooks"

import type { SetTimecardInput, Timecard } from "@/types"
import type { QueryClient } from "@tanstack/react-query"

const TIMECARDS_KEY = ["timecards"] as const

/**
 * Hours are also logged from outside the page (chat's log_time, another tab) and feed money figures
 * on several pages, so every mount re-reads them instead of trusting a copy up to a minute old.
 */
export function useTimecards(userId: string | undefined) {
  return useQuery({
    queryKey: [...TIMECARDS_KEY, userId],
    queryFn: () => getBackend().db.getTimecards(userId!),
    enabled: !!userId,
    staleTime: 0,
  })
}

/**
 * The hours as stored now, past a cached copy that is still fresh: what a contract dialog decides
 * on (the rate lock, what an amendment reprices), and chat may have logged some a moment ago.
 */
export const fetchTimecards = (queryClient: QueryClient, userId: string) =>
  queryClient.fetchQuery({
    queryKey: [...TIMECARDS_KEY, userId],
    queryFn: () => getBackend().db.getTimecards(userId),
    staleTime: 0,
  })

/** Upsert on (contract, day, person): the week grid on /plan and log_time write the same document. */
export const useSetTimecard = createMutationHook<SetTimecardInput, Timecard>(TIMECARDS_KEY, (userId, input) =>
  getBackend().db.setTimecard(userId, input),
)

/** `collaboratorId` omitted or null = the owner's row. */
export const useDeleteTimecard = createMutationHook<Pick<Timecard, "engagementId" | "date"> & { collaboratorId?: string | null }>(
  TIMECARDS_KEY,
  (userId, { engagementId, date, collaboratorId }) => getBackend().db.deleteTimecard(userId, engagementId, date, collaboratorId),
)
