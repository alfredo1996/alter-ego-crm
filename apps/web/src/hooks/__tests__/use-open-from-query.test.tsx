import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useOpenFromQuery } from "../use-open-from-query"

afterEach(() => window.history.replaceState(null, "", "/"))

describe("useOpenFromQuery", () => {
  it("opens the record ?open names once the list is ready, and drops the parameter", () => {
    window.history.replaceState(null, "", "/costs?open=c1&x=1")
    const open = vi.fn()
    const { rerender } = renderHook(({ ready }) => useOpenFromQuery(ready, open), { initialProps: { ready: false } })
    expect(open).not.toHaveBeenCalled()
    rerender({ ready: true })
    rerender({ ready: true })
    expect(open).toHaveBeenCalledExactlyOnceWith("c1")
    expect(window.location.pathname + window.location.search).toBe("/costs")
  })

  it("does nothing without the parameter", () => {
    window.history.replaceState(null, "", "/costs")
    const open = vi.fn()
    renderHook(() => useOpenFromQuery(true, open))
    expect(open).not.toHaveBeenCalled()
  })
})
