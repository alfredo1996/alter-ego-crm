"use client"

import { usePathname } from "next/navigation"
import { Suspense } from "react"


import { useIsPresenting } from "@/hooks/use-present"

function Hidden({ children }: { children: React.ReactNode }) {
  const presenting = useIsPresenting()
  const path = usePathname()
  // Only the solutions pages draw the banner and Stop: elsewhere the navigation stays.
  return presenting && path?.startsWith("/solutions") ? null : children
}

/** The app's chrome (sidebar, phone bar), gone while the URL says ?present=1 on a solutions page. Until the URL is known it shows. */
export function HideWhenPresenting({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={children}>
      <Hidden>{children}</Hidden>
    </Suspense>
  )
}
