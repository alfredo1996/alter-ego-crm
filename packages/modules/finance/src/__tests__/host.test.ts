import { beforeEach, describe, expect, it, vi } from "vitest"

// The setup file provides the app's host for every test; a fresh module graph is a package no app has set up.
async function freshHost() {
  vi.resetModules()
  return await import("../host")
}

describe("the finance host seam", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("throws a named error when finance code runs before the app provides the host", async () => {
    const { getBackend, useAuth, categorize, FinanceHostNotProvidedError } = await freshHost()
    for (const call of [getBackend, useAuth, () => categorize("coffee")]) {
      expect(call).toThrow(FinanceHostNotProvidedError)
      expect(call).toThrow(/provideFinanceHost/)
    }
    expect(new FinanceHostNotProvidedError().name).toBe("FinanceHostNotProvidedError")
  })

  it("hands finance code the backend, the auth state and the categorizer the app provided", async () => {
    const { getBackend, useAuth, categorize, provideFinanceHost } = await freshHost()
    const backend = { db: {} } as ReturnType<typeof getBackend>
    const suggestion = { categoryId: "food", confidence: 0.9 }
    const auth = { user: { id: "user-1", displayName: "Ada" }, loading: false }
    provideFinanceHost({ getBackend: () => backend, useAuth: () => auth, categorize: async () => suggestion })
    expect(getBackend()).toBe(backend)
    expect(useAuth()).toBe(auth)
    await expect(categorize("coffee")).resolves.toBe(suggestion)
  })

  it("uses the latest host when the app provides another", async () => {
    const { useAuth, provideFinanceHost } = await freshHost()
    const backend = { db: {} } as ReturnType<Parameters<typeof provideFinanceHost>[0]["getBackend"]>
    const categorize = async () => null
    provideFinanceHost({ getBackend: () => backend, useAuth: () => ({ user: null, loading: true }), categorize })
    provideFinanceHost({ getBackend: () => backend, useAuth: () => ({ user: null, loading: false }), categorize })
    expect(useAuth().loading).toBe(false)
  })
})
