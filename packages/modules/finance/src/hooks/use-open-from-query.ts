"use client"

import { useEffect, useRef } from "react"

/**
 * Opens the record a link names, `?open=<id>`, once the list has loaded: how Back from an invoice
 * file returns to the cost or invoice it came from. `open` reports nothing; a missing id opens
 * nothing. The parameter is dropped either way, so a reload does not reopen it.
 */
export function useOpenFromQuery(ready: boolean, open: (id: string) => void): void {
  const done = useRef(false)
  useEffect(() => {
    if (!ready || done.current) return
    const id = new URLSearchParams(window.location.search).get("open")
    if (!id) return
    done.current = true
    open(id)
    window.history.replaceState(null, "", window.location.pathname)
  })
}
