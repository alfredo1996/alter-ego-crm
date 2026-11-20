"use client"

import { useCallback, useMemo, useState } from "react"

import type { Transaction } from "../types"

/**
 * The selected rows, not only their ids: the bar sums them, and after Select all matching
 * most are not on the visible page.
 */
export function useRowSelection() {
  const [selected, setSelected] = useState<Map<string, Transaction>>(new Map())
  const ids = useMemo(() => new Set(selected.keys()), [selected])

  const toggle = useCallback((id: string, rows: Transaction[]) => {
    setSelected((prev) => {
      const next = new Map(prev)
      const row = rows.find((t) => t.id === id)
      if (next.has(id)) next.delete(id)
      else if (row) next.set(id, row)
      return next
    })
  }, [])
  const set = useCallback((rows: Transaction[]) => setSelected(new Map(rows.map((t) => [t.id, t]))), [])
  const remove = useCallback((id: string) => {
    setSelected((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])
  /** Swap selected rows for their fresh copies (an edit changes the amount); rows off this page stay. */
  const sync = useCallback((rows: Transaction[]) => {
    setSelected((prev) => {
      let next: Map<string, Transaction> | null = null
      for (const row of rows) {
        if (prev.has(row.id) && prev.get(row.id) !== row) (next ??= new Map(prev)).set(row.id, row)
      }
      return next ?? prev
    })
  }, [])
  const clear = useCallback(() => setSelected(new Map()), [])

  return { selected, ids, toggle, set, remove, sync, clear }
}
