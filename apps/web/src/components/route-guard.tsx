"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"

import { homeRoute, isRouteEnabled } from "@/lib/nav"

/**
 * Blocks routes the current mode has switched off. Wraps the whole (app) layout so
 * feature flags gate the URL and not just the sidebar link — one guard instead of a
 * wrapper per page that new pages would inevitably forget.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const enabled = isRouteEnabled(pathname)

  useEffect(() => {
    if (!enabled) router.replace(homeRoute())
  }, [enabled, router])

  if (!enabled) return null
  return <>{children}</>
}
