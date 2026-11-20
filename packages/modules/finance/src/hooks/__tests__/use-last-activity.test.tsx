import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useLastActivity } from "../use-accounts"

import type { ReactNode } from "react"

vi.mock("../../host", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getBackend: () => ({ db: { getLastActivity } }),
}))
const getLastActivity = vi.fn(async () => ({ a: new Date("2026-03-01"), b: null }))


describe("useLastActivity", () => {
  it("makes one call for all the accounts", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useLastActivity("u1", ["a", "b"]), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual({ a: new Date("2026-03-01"), b: null }))
    expect(getLastActivity).toHaveBeenCalledTimes(1)
    expect(getLastActivity).toHaveBeenCalledWith("u1", ["a", "b"])
  })

  it("keeps the dates up while a new account list loads", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    )
    const { result, rerender } = renderHook(({ ids }) => useLastActivity("u1", ids), { wrapper, initialProps: { ids: ["a", "b"] } })
    await waitFor(() => expect(result.current.data).toBeDefined())
    getLastActivity.mockImplementationOnce(() => new Promise(() => {}))
    rerender({ ids: ["a", "b", "c"] })
    expect(result.current.data).toEqual({ a: new Date("2026-03-01"), b: null })
  })
})
