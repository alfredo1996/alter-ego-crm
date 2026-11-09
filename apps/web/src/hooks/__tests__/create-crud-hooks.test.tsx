/**
 * An update hook stays pending until the list it invalidates is back: a dialog left
 * open on the item (Amend Contract after a Remove) must not write again from the
 * copy the write replaced.
 */
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createUpdateHook } from "../create-crud-hooks"

import type { ReactNode } from "react"

describe("createUpdateHook", () => {
  it("stays pending until the list it invalidates is refetched", async () => {
    let release = () => {}
    const list = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["before"])
      .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(["after"]))))
    const useUpdate = createUpdateHook<string>(["things"], async () => {})
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => ({ list: useQuery({ queryKey: ["things", "u1"], queryFn: list }), update: useUpdate("u1") }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.list.data).toEqual(["before"]))

    act(() => result.current.update.mutate({ id: "x", input: "y" }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    // Written, but the list still holds the copy from before: not done yet.
    expect(result.current.update.isPending).toBe(true)
    expect(result.current.list.data).toEqual(["before"])

    act(() => release())
    await waitFor(() => expect(result.current.update.isPending).toBe(false))
    expect(result.current.list.data).toEqual(["after"])
  })
})
