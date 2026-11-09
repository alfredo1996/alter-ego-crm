"use client"

import { Button } from "@alter-ego/ui/ui/button"
import { Skeleton } from "@alter-ego/ui/ui/skeleton"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { AuthAlert, AuthCard } from "@/components/auth/auth-shell"
import { useAuth } from "@/hooks/use-auth"
import { parseScopes } from "@/lib/oauth/scopes"

const SCOPE_LABELS: Record<string, string> = {
  "data:read": "Read your clients, contracts, invoices, costs and cash book",
  "data:write": "Create, update and delete that same data on your behalf",
}

/** Appends parameters to the client's redirect_uri and leaves the app. */
function redirectBack(base: string, params: Record<string, string>) {
  const url = new URL(base)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  window.location.href = url.toString()
}

export function AuthorizeConsent() {
  const params = useSearchParams()
  const router = useRouter()
  const { user, loading, getIdToken } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // The redirect_uri is attacker-supplied: nothing may navigate to it, or show
  // it, until the server says this exact pair is registered. The verdict keeps
  // the pair it was for, so a changed link falls back to "checking".
  const [checked, setChecked] = useState<{ clientId: string; redirectUri: string; name: string | false } | null>(null)

  const clientId = params.get("client_id")
  const redirectUri = params.get("redirect_uri")
  const state = params.get("state")
  const codeChallenge = params.get("code_challenge")
  const codeChallengeMethod = params.get("code_challenge_method")
  const responseType = params.get("response_type")
  // What the server will grant, so the list cannot disagree with it.
  const scopes = parseScopes(params.get("scope"))

  useEffect(() => {
    if (loading || user) return
    // Come back here after sign-in rather than dropping the request on the floor.
    const next = `${window.location.pathname}${window.location.search}`
    router.replace(`/login?next=${encodeURIComponent(next)}`)
  }, [loading, user, router])

  useEffect(() => {
    if (!user || !clientId || !redirectUri) return
    let live = true
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri })
    fetch(`/api/oauth/client?${q}`)
      .then((r) => r.json() as Promise<{ valid?: boolean; clientName?: string }>)
      .then((d) => live && setChecked({ clientId, redirectUri, name: d.valid ? (d.clientName ?? "") : false }))
      .catch(() => live && setChecked({ clientId, redirectUri, name: false }))
    return () => {
      live = false
    }
  }, [user, clientId, redirectUri])

  if (loading || !user) {
    return <Skeleton className="h-80 w-full rounded-xl" />
  }

  const verdict = checked && checked.clientId === clientId && checked.redirectUri === redirectUri ? checked : null
  const clientName = verdict ? verdict.name : null

  // Validated again server-side; this is only to fail early with a readable message.
  const invalid = !clientId || !redirectUri
    ? "This authorization link is missing client_id or redirect_uri."
    : responseType !== "code"
      ? "Only the authorization code flow is supported."
      : !codeChallenge || codeChallengeMethod !== "S256"
        ? "This client did not send a PKCE challenge, which is required."
        : scopes.length === 0
          ? "This request asks for no access that can be granted."
          : clientName === false
          ? "This connector's return address isn't registered."
          : null

  async function approve() {
    setError(null)
    setPending(true)
    try {
      const idToken = await getIdToken()
      if (!idToken) throw new Error("Your session expired. Sign in again.")

      const res = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idToken,
          clientId,
          redirectUri,
          scope: scopes.join(" "),
          codeChallenge,
          codeChallengeMethod,
        }),
      })
      const data = (await res.json()) as { code?: string; error_description?: string }
      if (!res.ok || !data.code) throw new Error(data.error_description ?? "Authorization failed")

      redirectBack(verdict!.redirectUri, { code: data.code, ...(state ? { state } : {}) })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authorization failed")
      setPending(false)
    }
  }

  function deny() {
    if (!verdict || verdict.name === false) return
    redirectBack(verdict.redirectUri, { error: "access_denied", ...(state ? { state } : {}) })
  }

  return (
    <AuthCard
      title="Authorize Connector"
      subtitle={invalid ? "This request cannot be completed." : `Signed in as ${user.email}`}
    >
      {invalid ? (
        <AuthAlert>{invalid}</AuthAlert>
      ) : clientName === null ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-subtle-foreground">
            An application is asking to connect to your Alter Ego data. It will be able to:
          </p>
          <ul className="space-y-2 text-sm">
            {scopes.map((s) => (
              <li key={s} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>{SCOPE_LABELS[s] ?? s}</span>
              </li>
            ))}
          </ul>
          {/* The registered name is client-supplied, so show the redirect host —
              that is the part an attacker cannot fake. */}
          <p className="text-meta text-muted-foreground">
            You will be sent to <strong className="font-semibold text-foreground">{new URL(verdict!.redirectUri).host}</strong> after approving.
            Only continue if you started this from there.
          </p>
          {error && <AuthAlert>{error}</AuthAlert>}
          <div className="flex gap-2 pt-2">
            <Button size="lg" className="flex-1" onClick={approve} disabled={pending}>
              {pending ? "Authorizing…" : "Approve"}
            </Button>
            <Button size="lg" variant="outline" className="flex-1" onClick={deny} disabled={pending}>
              Deny
            </Button>
          </div>
        </div>
      )}
    </AuthCard>
  )
}
