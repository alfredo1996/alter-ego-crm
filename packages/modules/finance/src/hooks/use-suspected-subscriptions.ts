"use client"

import { endOfDay, startOfDay, subDays } from "date-fns"
import { useMemo } from "react"

import { useAuth } from "../host"
import { useDismissedSubscriptionPatterns } from "./use-dismissed-subscriptions"
import { useMerchantNormalization } from "./use-merchant-normalization"
import { useRecurring } from "./use-recurring"
import { useTransactions } from "./use-transactions"
import { detectSuspectedSubscriptions } from "../lib/subscription-detector"

import type { SuspectedSubscription, Transaction } from "../types"

const WINDOW_DAYS = 395 // 13 months

export function useSuspectedSubscriptions(enabled = true): {
  data: SuspectedSubscription[]
  /** The expenses the patterns came from, for the dates each was seen. */
  transactions: Transaction[]
  isLoading: boolean
} {
  const { user } = useAuth()
  const userId = user?.id

  const now = useMemo(() => new Date(), [])

  // Whole days, so the query key is the same on every visit that day and a
  // return to /reports is served from the cache (to the millisecond, it never was).
  const { data: txResult, isLoading: txLoading } = useTransactions(userId, {
    dateFrom: startOfDay(subDays(now, WINDOW_DAYS)),
    dateTo: endOfDay(now),
    type: "expense",
  }, enabled)
  const { data: recurring = [], isLoading: recurringLoading } = useRecurring(userId)
  const { data: dismissed = [], isLoading: dismissedLoading } =
    useDismissedSubscriptionPatterns(userId)
  const { normalize } = useMerchantNormalization(userId)

  const transactions = useMemo(() => txResult?.data ?? [], [txResult])

  const data = useMemo(
    () =>
      detectSuspectedSubscriptions({
        transactions,
        recurringTransactions: recurring,
        dismissedPatterns: dismissed,
        normalize,
        now,
      }),
    [transactions, recurring, dismissed, normalize, now],
  )

  return {
    data,
    transactions,
    isLoading: txLoading || recurringLoading || dismissedLoading,
  }
}
