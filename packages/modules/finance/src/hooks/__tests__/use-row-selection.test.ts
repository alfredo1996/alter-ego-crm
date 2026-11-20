import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useRowSelection } from "../use-row-selection"

import type { Transaction } from "../../types"

const tx = (id: string, amount: number) => ({ id, amount }) as Transaction

describe("useRowSelection", () => {
  it("drops a removed id", () => {
    const { result } = renderHook(() => useRowSelection())
    act(() => result.current.set([tx("a", 1), tx("b", 2)]))
    act(() => result.current.remove("a"))
    expect([...result.current.ids]).toEqual(["b"])
  })

  it("replaces a selected row with its fresh copy and leaves rows off the page alone", () => {
    const { result } = renderHook(() => useRowSelection())
    act(() => result.current.set([tx("a", 1), tx("b", 2)]))
    act(() => result.current.sync([tx("a", 99)]))
    expect(result.current.selected.get("a")?.amount).toBe(99)
    expect(result.current.selected.get("b")?.amount).toBe(2)
  })

  it("keeps the same state when nothing changed, so an effect cannot loop", () => {
    const { result } = renderHook(() => useRowSelection())
    const a = tx("a", 1)
    act(() => result.current.set([a]))
    const before = result.current.selected
    act(() => result.current.sync([a, tx("z", 5)]))
    expect(result.current.selected).toBe(before)
  })
})
