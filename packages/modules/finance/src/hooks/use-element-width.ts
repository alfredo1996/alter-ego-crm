"use client"

import { useCallback, useState } from "react"

/**
 * An element's rendered content width, kept current by a ResizeObserver: 0 until
 * it is first measured. A callback ref, so an element that mounts after an empty
 * state is still observed. For SVG charts that draw at their real width, so their
 * text stays readable on a phone instead of shrinking with a fixed viewBox.
 */
export function useElementWidth<T extends Element>(): [(el: T | null) => (() => void) | undefined, number] {
  const [width, setWidth] = useState(0)
  const ref = useCallback((el: T | null) => {
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}
