"use client"


import { Toaster } from "@alter-ego/ui/ui/toaster"
import { TooltipProvider } from "@alter-ego/ui/ui/tooltip"
import { toast } from "@alter-ego/ui/use-toast"
import { focusManager, MutationCache, QueryClient, QueryClientProvider, useIsFetching } from "@tanstack/react-query"
import { useState, useEffect } from "react"

import { getBackend } from "@/lib/backend"
import { env } from "@/lib/env"
import { useSettingsStore } from "@/stores/settings-store"

// TanStack refetches stale queries on visibilitychange only, so clicking back into
// a window that never went hidden (a second monitor, side by side with Claude
// writing through MCP) kept the old data. Window focus now counts too; a tab
// switch fires both events, and the second joins the fetch already in flight.
// ponytail: no refetchInterval or onSnapshot, add them only if focus proves too little
if (typeof window !== "undefined") {
  focusManager.setEventListener((onFocus) => {
    const listener = () => onFocus()
    window.addEventListener("visibilitychange", listener)
    window.addEventListener("focus", listener)
    return () => {
      window.removeEventListener("visibilitychange", listener)
      window.removeEventListener("focus", listener)
    }
  })
}

/**
 * A thin bar across the top while any query fetches: a background refresh keeps
 * the page on screen, so this is the only sign data may change. It mounts after
 * 300 ms, so fast fetches never flash it, and is fixed, so nothing shifts.
 */
function FetchingBar() {
  const fetching = useIsFetching() > 0
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!fetching) return
    const timer = setTimeout(() => setShown(true), 300)
    return () => {
      clearTimeout(timer)
      setShown(false)
    }
  }, [fetching])

  if (!shown) return null
  return (
    <div
      role="progressbar"
      aria-label="Refreshing data"
      className="bg-primary pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 motion-safe:animate-pulse"
    />
  )
}

function ThemeApplier() {
  const theme = useSettingsStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === "dark") {
      root.classList.add("dark")
    } else if (theme === "light") {
      root.classList.remove("dark")
    } else {
      // system
      const mq = window.matchMedia("(prefers-color-scheme: dark)")
      root.classList.toggle("dark", mq.matches)
      const handler = (e: MediaQueryListEvent) => root.classList.toggle("dark", e.matches)
      mq.addEventListener("change", handler)
      return () => mq.removeEventListener("change", handler)
    }
  }, [theme])

  return null
}

/**
 * Whether the page puts the backend on window: the mock, or Firebase on the local
 * emulator. Never a production Firebase build: NEXT_PUBLIC_USE_EMULATOR is inlined
 * at build time, no apphosting*.yaml sets it, and with it set the SDK talks to
 * localhost only (configureForEmulator), so there is no real data to reach.
 */
export function exposesBackend(e: Pick<typeof env, "NEXT_PUBLIC_BACKEND" | "NEXT_PUBLIC_USE_EMULATOR">): boolean {
  return e.NEXT_PUBLIC_BACKEND === "mock" || e.NEXT_PUBLIC_USE_EMULATOR
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
          },
        },
        // Every mutation hook in the app defined onSuccess and nothing else, so a
        // rejected write — a Firestore rule refusing a value, a dropped connection —
        // left the UI unchanged and silent. One cache-level handler covers all of
        // them, including the hand-written hooks that never used the CRUD factories.
        // meta.silent opts out a write nobody clicked (the dashboard's daily
        // snapshot): it retries on the next visit, so a toast would only alarm.
        mutationCache: new MutationCache({
          onError: (error, _variables, _onMutateResult, mutation) => {
            if (mutation.meta?.silent) return
            toast({
              variant: "destructive",
              title: "Change not saved",
              description: error instanceof Error ? error.message : "Unknown error",
            })
          },
        }),
      })
  )

  // e2e and scripts only: a spec empties the cache so each page it visits loads
  // from nothing, as after a reload (which would wipe the mock's in-memory data).
  // __mockBackend lets a spec, `pnpm shots` or `pnpm seed:demo` seed data faster
  // than through the UI; on the emulator it is the Firebase adapter, named as before.
  useEffect(() => {
    if (!exposesBackend(env)) return
    const w = window as { __clearQueryCache?: () => void; __mockBackend?: unknown }
    w.__clearQueryCache = () => queryClient.clear()
    w.__mockBackend = getBackend()
  }, [queryClient])

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeApplier />
        <FetchingBar />
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
