"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

/** Whether the URL says ?present=1: the one place Present lives, so a reload or a link keeps it. */
export function useIsPresenting(): boolean {
  return useSearchParams()?.get("present") === "1"
}

/** Present on or off for the page at hand: writes ?present=1 over the other params, or drops it. `href` keeps a link presenting. */
export function usePresent() {
  const present = useIsPresenting()
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const setPresent = (on: boolean) => {
    const next = new URLSearchParams(params?.toString())
    if (on) next.set("present", "1")
    else next.delete("present")
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }
  const href = (path: string) => (present ? `${path}${path.includes("?") ? "&" : "?"}present=1` : path)
  return { present, setPresent, href }
}
