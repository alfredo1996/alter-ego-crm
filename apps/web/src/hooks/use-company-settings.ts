"use client"

import { useQuery } from "@tanstack/react-query"

import { getBackend } from "@/lib/backend"

import { createMutationHook } from "./create-crud-hooks"

const SETTINGS_KEY = ["companySettings"] as const

export function useCompanySettings(userId: string | undefined) {
  return useQuery({
    queryKey: [...SETTINGS_KEY, userId],
    queryFn: () => getBackend().db.getCompanySettings(userId!),
    enabled: !!userId,
  })
}

/** The Runway's floor: a number, or null to remove it. */
export const useSetCashFloor = createMutationHook<number | null>(SETTINGS_KEY, (userId, floor) =>
  getBackend().db.setCompanyCashFloor(userId, floor),
)
