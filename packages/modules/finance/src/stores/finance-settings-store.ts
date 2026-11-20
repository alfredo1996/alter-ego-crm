"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

import type { Currency } from "../types"

interface FinanceSettingsState {
  defaultCurrency: Currency
  locale: string

  setDefaultCurrency: (currency: Currency) => void
  setLocale: (locale: string) => void
}

const KEY = "alter-ego-finance-settings"
// Before this store, currency and locale were saved with the app's theme under this key.
const LEGACY_KEY = "alter-ego-settings"

// Reads the legacy value once, the first time this store has no value of its own, so nobody's currency
// resets to the default. After that the store reads and writes only its own key; the legacy one is left alone.
const storage = createJSONStorage<Pick<FinanceSettingsState, "defaultCurrency" | "locale">>(() => ({
  getItem: (name) => {
    const own = localStorage.getItem(name)
    if (own !== null) return own
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy === null) return null
    const { state } = JSON.parse(legacy) as { state?: Partial<FinanceSettingsState> }
    const copy = JSON.stringify({ state: { defaultCurrency: state?.defaultCurrency, locale: state?.locale }, version: 0 })
    // persist writes nothing until a setter runs, so copy it now: this is the only time the legacy key is read
    localStorage.setItem(name, copy)
    return copy
  },
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
}))

export const useFinanceSettingsStore = create<FinanceSettingsState>()(
  persist(
    (set) => ({
      defaultCurrency: "USD",
      locale: "en-US",

      setDefaultCurrency: (defaultCurrency) => set({ defaultCurrency }),
      setLocale: (locale) => set({ locale }),
    }),
    { name: KEY, storage },
  ),
)
