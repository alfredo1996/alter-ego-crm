"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { getBackend } from "@/lib/backend"

import {
  createListHook,
  createMutationHook,
  createUpdateHook,
  createDeleteHook,
} from "./create-crud-hooks"

import type { Assignment, CreateAssignmentInput, UpdateAssignmentInput } from "@/types"

export const ASSIGNMENTS_KEY = ["assignments"] as const

export const useAssignments = createListHook(ASSIGNMENTS_KEY, (userId) => getBackend().db.getAssignments(userId))

export const useCreateAssignment = createMutationHook<CreateAssignmentInput, Assignment>(
  ASSIGNMENTS_KEY,
  (userId, input) => getBackend().db.createAssignment(userId, input),
)

export const useUpdateAssignment = createUpdateHook<UpdateAssignmentInput>(
  ASSIGNMENTS_KEY,
  (userId, assignmentId, input) => getBackend().db.updateAssignment(userId, assignmentId, input),
)

export const useDeleteAssignment = createDeleteHook(ASSIGNMENTS_KEY, (userId, assignmentId) =>
  getBackend().db.deleteAssignment(userId, assignmentId),
)

/**
 * Sets one month of an assignment in Days by Month: `days`, or null to take the month's override
 * away so the default counts again. The stored map is read fresh and merged, never the cached copy.
 */
export function useSetAssignmentMonthDays(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    scope: { id: `assignment-days:${userId}` },
    mutationFn: async ({ assignmentId, yearMonth, days }: { assignmentId: string; yearMonth: string; days: number | null }) => {
      const db = getBackend().db
      const a = (await db.getAssignments(userId!)).find((x) => x.id === assignmentId)
      if (!a) throw new Error("Assignment not found")
      const monthDays = { ...a.monthDays }
      if (days === null) delete monthDays[yearMonth]
      else monthDays[yearMonth] = days
      await db.updateAssignment(userId!, assignmentId, { monthDays })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [...ASSIGNMENTS_KEY, userId] }),
  })
}
