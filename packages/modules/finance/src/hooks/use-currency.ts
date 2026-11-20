"use client"

import { formatCompactCurrency, formatCurrency } from "@alter-ego/kernel/currency"
import { useCallback } from "react"

import { useFinanceSettingsStore } from "../stores/finance-settings-store"

import type { Currency } from "../types"

export function useCurrency() {
  const defaultCurrency = useFinanceSettingsStore((s) => s.defaultCurrency)
  const locale = useFinanceSettingsStore((s) => s.locale)

  const format = useCallback(
    (amount: number, currency?: Currency) => {
      return formatCurrency(amount, currency ?? defaultCurrency, locale)
    },
    [defaultCurrency, locale]
  )

  /** "€2,850": no cents, for a chart's labels. */
  const formatWhole = useCallback((amount: number) => formatCurrency(amount, defaultCurrency, locale, 0), [defaultCurrency, locale])
  /** "€4K": a chart's axis. */
  const formatCompact = useCallback((amount: number) => formatCompactCurrency(amount, defaultCurrency), [defaultCurrency])

  return { format, formatWhole, formatCompact, defaultCurrency }
}
