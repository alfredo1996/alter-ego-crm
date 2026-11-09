"use client"

import { useQuery } from "@tanstack/react-query"

import { getBackend } from "@/lib/backend"
import { timeOffDoc } from "@/lib/capacity"

import { createMutationHook } from "./create-crud-hooks"

const CAPACITY_KEY = ["capacity"] as const

/** The months' time off records, from the first month to the last (both included). */
export function useCapacityDocs(userId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: [...CAPACITY_KEY, userId, from, to],
    queryFn: () => getBackend().db.getCapacityDocs(userId!, { from, to }),
    enabled: !!userId,
  })
}

/**
 * A month's days off, typed on the Plan. The month's reason and note stay as the connector set
 * them (a month the connector never touched has none); the available days are derived. 0 clears the days.
 */
export const useSetTimeOff = createMutationHook<{ yearMonth: string; daysOff: number }>(CAPACITY_KEY, async (userId, { yearMonth, daysOff }) => {
  const db = getBackend().db
  const [prev] = await db.getCapacityDocs(userId, { from: yearMonth, to: yearMonth })
  await db.setCapacity(userId, timeOffDoc({ yearMonth, daysOff, prev }))
})
