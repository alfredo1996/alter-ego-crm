import { Suspense } from "react"

import { AuthShell } from "@/components/auth/auth-shell"
import { AuthorizeConsent } from "@/components/auth/authorize-consent"

export const metadata = { title: "Authorize Connector" }

/**
 * OAuth 2.1 authorization endpoint (the user-facing half).
 *
 * Rendered as a page rather than a route handler so it can reuse the Firebase
 * session the app already maintains: the browser proves who is approving, and
 * the paired API route verifies that proof server-side.
 */
export default function AuthorizePage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <AuthorizeConsent />
      </Suspense>
    </AuthShell>
  )
}
