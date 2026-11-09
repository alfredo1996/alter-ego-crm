import Link from "next/link"

import { AuthCard } from "@/components/auth/auth-shell"

// Alter Ego is single-user (#389): sign-up is closed, and the rules refuse any uid
// but the owner's. The page stays so old links say why instead of 404ing.
export function RegisterForm() {
  return (
    <AuthCard
      title="Sign-Up Is Closed"
      subtitle="This app is private, so new accounts can't be created."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4 pointer-coarse:-my-3 pointer-coarse:inline-block pointer-coarse:min-w-11 pointer-coarse:py-3">
            Sign in
          </Link>
        </>
      }
    >
      {null}
    </AuthCard>
  )
}
