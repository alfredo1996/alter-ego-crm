import { beforeEach, describe, expect, it, vi } from "vitest"

const LEGACY = "alter-ego-settings"
const OWN = "alter-ego-finance-settings"

// A fresh module per test: the store reads localStorage once, when it is created.
async function freshStore() {
  vi.resetModules()
  return (await import("../finance-settings-store")).useFinanceSettingsStore
}

beforeEach(() => localStorage.clear())

describe("the finance settings store", () => {
  it("starts at USD and en-US when nothing is stored", async () => {
    const { defaultCurrency, locale } = (await freshStore()).getState()
    expect({ defaultCurrency, locale }).toEqual({ defaultCurrency: "USD", locale: "en-US" })
  })

  it("reads currency and locale from an existing alter-ego-settings value", async () => {
    localStorage.setItem(
      LEGACY,
      JSON.stringify({ state: { aiMode: "off", defaultCurrency: "EUR", locale: "it-IT", theme: "dark" }, version: 0 }),
    )
    const { defaultCurrency, locale } = (await freshStore()).getState()
    expect({ defaultCurrency, locale }).toEqual({ defaultCurrency: "EUR", locale: "it-IT" })
  })

  it("copies the legacy value to its own key on that first read, so it never reads the old one again", async () => {
    localStorage.setItem(LEGACY, JSON.stringify({ state: { defaultCurrency: "EUR", locale: "it-IT" }, version: 0 }))
    await freshStore()
    expect(JSON.parse(localStorage.getItem(OWN) as string).state).toEqual({ defaultCurrency: "EUR", locale: "it-IT" })
  })

  it("prefers its own key once it exists, and writes there, leaving the old value alone", async () => {
    const legacy = JSON.stringify({ state: { defaultCurrency: "EUR", locale: "it-IT" }, version: 0 })
    localStorage.setItem(LEGACY, legacy)
    localStorage.setItem(OWN, JSON.stringify({ state: { defaultCurrency: "GBP", locale: "en-GB" }, version: 0 }))
    const store = await freshStore()
    expect(store.getState().defaultCurrency).toBe("GBP")
    store.getState().setDefaultCurrency("USD")
    expect(JSON.parse(localStorage.getItem(OWN) as string).state.defaultCurrency).toBe("USD")
    expect(localStorage.getItem(LEGACY)).toBe(legacy)
  })
})
