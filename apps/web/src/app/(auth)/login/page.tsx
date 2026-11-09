import { Suspense } from "react"

import { LoginForm } from "@/components/auth/login-form"

export default function LoginPage() {
  // LoginForm reads ?next= via useSearchParams, which needs a Suspense boundary
  // to prerender.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
