"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { useCategorizationRules } from "./use-categorization-rules"
import { getBackend } from "../host"
import { normalizeDescription } from "../lib/merchants"

import type { CategorizationRule } from "../types"

export function useMerchantNormalization(userId: string | undefined) {
  const queryClient = useQueryClient()
  const { data: rules } = useCategorizationRules(userId)

  const normalize = useCallback(
    (raw: string): string => {
      return normalizeDescription(raw, rules as CategorizationRule[] | undefined)
    },
    [rules],
  )

  const renormalize = useMutation({
    mutationFn: async () => {
      if (!userId) return 0
      return getBackend().db.renormalizeTransactions(userId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    },
  })

  return { normalize, renormalize }
}
