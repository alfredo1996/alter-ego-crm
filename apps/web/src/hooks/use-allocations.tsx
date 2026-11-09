"use client"

import { ToastAction } from "@alter-ego/ui/ui/toast"
import { toast } from "@alter-ego/ui/use-toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRef } from "react"


import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { CreateAllocationInput, UpdateAllocationInput } from "@/types"

const ALLOCATIONS_KEY = ["allocations"] as const

export const useAllocations = createListHook(ALLOCATIONS_KEY, (userId) =>
  getBackend().db.getAllocations(userId),
)

export const useCreateAllocation = createMutationHook<CreateAllocationInput>(
  ALLOCATIONS_KEY,
  (userId, input) => getBackend().db.createAllocation(userId, input),
)

export const useUpdateAllocation = createUpdateHook<UpdateAllocationInput>(
  ALLOCATIONS_KEY,
  (userId, allocationId, input) => getBackend().db.updateAllocation(userId, allocationId, input),
)

export const useDeleteAllocation = createDeleteHook(ALLOCATIONS_KEY, (userId, allocationId) =>
  getBackend().db.deleteAllocation(userId, allocationId),
)

/**
 * Sets one contract-month in the plan, as log_allocation's "set" does: `days`, or
 * null to remove the month's row so the contract default counts again. The row is
 * looked up fresh, not in the cache, so one written from chat within the cache's
 * minute is updated, never duplicated. The writes run one at a time (a shared
 * scope), so a double click cannot make two rows either, and each stays pending
 * until the plan has refetched. Resolves to the days the row held before, or null
 * when there was none.
 */
export function useSetMonthDays(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    scope: { id: `month-days:${userId}` },
    mutationFn: async ({ engagementId, yearMonth, days }: { engagementId: string; yearMonth: string; days: number | null }) => {
      const db = getBackend().db
      const existing = (await db.getAllocations(userId!)).find(
        (a) => a.engagementId === engagementId && a.yearMonth === yearMonth,
      )
      if (days === null) {
        if (existing) await db.deleteAllocation(userId!, existing.id)
      } else if (existing) {
        await db.updateAllocation(userId!, existing.id, { days })
      } else {
        await db.createAllocation(userId!, { engagementId, yearMonth, days })
      }
      return existing?.days ?? null
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [...ALLOCATIONS_KEY, userId] }),
  })
}

/**
 * Use, Use All and No Work, on the Plan and on Month End: each month's days
 * written in turn, then one toast whose Undo puts back what every month held
 * (its days, or no row at all). One run at a time, a click during it dropped,
 * so Undo always knows what was there. Resolves to whether it was written.
 */
export function useApplyHours(userId: string | undefined) {
  const setMonthDays = useSetMonthDays(userId)
  const using = useRef(false)
  async function apply(writes: { engagementId: string; yearMonth: string; days: number }[], title: string): Promise<boolean> {
    if (using.current) return false
    using.current = true
    const done: { engagementId: string; yearMonth: string; days: number | null }[] = []
    try {
      for (const w of writes) done.push({ ...w, days: await setMonthDays.mutateAsync(w) })
    } catch {
      return false // The app-wide "Change not saved" toast says why.
    } finally {
      using.current = false
    }
    toast({
      title,
      action: (
        <ToastAction altText="Undo" onClick={() => done.forEach((w) => setMonthDays.mutate(w))}>
          Undo
        </ToastAction>
      ),
    })
    return true
  }
  return { apply, setMonthDays }
}
