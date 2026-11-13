"use client"

import { Suspense } from "react"

import { useIsPresenting } from "@/hooks/use-present"

function Hidden({ children }: { children: React.ReactNode }) {
  return useIsPresenting() ? null : children
}

/** The app's chrome (sidebar, phone bar), gone while the URL says ?present=1. Until the URL is known it shows. */
export function HideWhenPresenting({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={children}>
      <Hidden>{children}</Hidden>
    </Suspense>
  )
}
