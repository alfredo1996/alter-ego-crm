import { AuthGuard } from "@/components/auth/auth-guard"
import { RouteGuard } from "@/components/route-guard"

/** Full-page views (an invoice file laid out on an A4 page): signed in and company-only like (app), without its sidebar. */
export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <RouteGuard>{children}</RouteGuard>
    </AuthGuard>
  )
}
