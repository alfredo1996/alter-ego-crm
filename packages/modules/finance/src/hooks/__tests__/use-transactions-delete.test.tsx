/**
 * Deleting a row while another query sits under the ["transactions", userId] prefix (the
 * budget-spending array) must still reach the backend: onMutate only edits pages.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useDeleteTransaction } from "../use-transactions"

import type { ReactNode } from "react"

vi.mock("../../host", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getBackend: () => ({ db: { deleteTransaction } }),
}))
const deleteTransaction = vi.fn(async () => {})


describe("useDeleteTransaction", () => {
  it("deletes and trims the page even with a budget-spending array cached beside it", async () => {
    const client = new QueryClient()
    client.setQueryData(["transactions", "u1", "list"], { data: [{ id: "a" }, { id: "b" }], total: 2 })
    client.setQueryData(["transactions", "u1", "budget-spending", []], [{ id: "budget" }])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useDeleteTransaction("u1"), { wrapper })

    act(() => result.current.mutate("a"))
    await waitFor(() => expect(deleteTransaction).toHaveBeenCalledWith("u1", "a"))
    expect(client.getQueryData<{ data: { id: string }[] }>(["transactions", "u1", "list"])?.data).toEqual([{ id: "b" }])
  })
})
