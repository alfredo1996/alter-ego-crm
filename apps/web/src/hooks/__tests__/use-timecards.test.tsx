/**
 * Hours are logged from outside the page (chat's log_time, another tab), and every money figure
 * on the client page reads them: a copy cached by the Clients list must not stand for a minute.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useTimecards } from "../use-timecards"

import type { Timecard } from "@/types"
import type { ReactNode } from "react"

const getTimecards = vi.fn<() => Promise<Timecard[]>>()
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ db: { getTimecards } }) }))

const card = (hours: number): Timecard => ({ engagementId: "e1", date: "2026-10-10", hours }) as Timecard

describe("useTimecards", () => {
  it("refetches on mount even when the cached copy is seconds old", async () => {
    getTimecards.mockResolvedValueOnce([card(0)]).mockResolvedValueOnce([card(16)])
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const first = renderHook(() => useTimecards("u1"), { wrapper })
    await waitFor(() => expect(first.result.current.data).toEqual([card(0)]))
    first.unmount()

    const second = renderHook(() => useTimecards("u1"), { wrapper })
    await waitFor(() => expect(second.result.current.data).toEqual([card(16)]))
  })
})
