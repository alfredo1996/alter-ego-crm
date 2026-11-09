"use client"

import { PageLoader } from "@alter-ego/ui/page/page-state"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { useAuth } from "@/hooks/use-auth"

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login")
    }
  }, [loading, user, router])

  // Also while redirecting to /login.
  if (loading || !user) return <PageLoader />

  return <>{children}</>
}
