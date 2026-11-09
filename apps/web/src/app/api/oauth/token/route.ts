import { hashApiKey } from "@/lib/api-auth"
import { getAdminAuth } from "@/lib/firebase-admin-client"
import { oauthError } from "@/lib/oauth/http"
import { verifyPkce } from "@/lib/oauth/pkce"
import { deleteToken, deleteTokenFamily, getToken, saveToken, takeCode, markClientRedeemed, takeRefreshToken, type StoredToken } from "@/lib/oauth/store"
import {
  ACCESS_TTL_SECONDS,
  expiresAt,
  isExpired,
  mintToken,
  REFRESH_TTL_SECONDS,
  type Scope,
} from "@/lib/oauth/tokens"

export const runtime = "nodejs"

/**
 * Reads the request body as parameters.
 *
 * RFC 6749 §4.1.3 specifies form-urlencoded, and Claude sends both the initial
 * exchange and refreshes that way. JSON is accepted too so a hand-written curl
 * or a differently-behaved client doesn't get an opaque 415.
 */
async function readParams(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? ""
  if (type.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(body).filter(([, v]) => typeof v === "string")
    ) as Record<string, string>
  }
  const form = await request.formData()
  return Object.fromEntries(
    Array.from(form.entries()).filter(([, v]) => typeof v === "string")
  ) as Record<string, string>
}

/** Issues a fresh access/refresh pair and returns the RFC 6749 §5.1 payload. */
async function issueTokens(
  clientId: string,
  userId: string,
  scopes: Scope[],
  familyId: string = crypto.randomUUID()
): Promise<Response> {
  const issuedAt = Date.now()
  const access = await mintToken()
  const refresh = await mintToken()

  await saveToken(access.hash, {
    type: "access",
    clientId,
    userId,
    scopes,
    issuedAt,
    familyId,
    expiresAt: expiresAt(ACCESS_TTL_SECONDS),
  })
  await saveToken(refresh.hash, {
    type: "refresh",
    clientId,
    userId,
    scopes,
    issuedAt,
    familyId,
    expiresAt: expiresAt(REFRESH_TTL_SECONDS),
  })

  return Response.json(
    {
      access_token: access.value,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refresh.value,
      scope: scopes.join(" "),
    },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
  )
}

/** True when the user is gone, disabled, or signed out everywhere after this token was issued. */
async function accountInactive(token: StoredToken): Promise<boolean> {
  try {
    const user = await getAdminAuth().getUser(token.userId)
    const validAfter = user.tokensValidAfterTime ? Date.parse(user.tokensValidAfterTime) : 0
    // tokensValidAfterTime has one-second resolution; compare at that resolution.
    const issued = token.issuedAt === undefined ? Infinity : Math.floor(token.issuedAt / 1000) * 1000
    return user.disabled || issued < validAfter
  } catch (err) {
    if ((err as { code?: string }).code === "auth/user-not-found") return true
    throw err // an outage must not revoke grants
  }
}

// ponytail: fixed 10s window; a client retrying a lost response after that must be re-approved.
const REUSE_GRACE_MS = 10_000

export async function POST(request: Request): Promise<Response> {
  let params: Record<string, string>
  try {
    params = await readParams(request)
  } catch {
    return oauthError("invalid_request", "Body must be form-encoded or JSON")
  }

  const grantType = params.grant_type

  if (grantType === "authorization_code") {
    const { code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri } = params
    if (!code || !clientId) {
      return oauthError("invalid_request", "code and client_id are required")
    }

    // Single-use: takeCode reads and deletes in one transaction, so a replayed
    // code finds nothing even if two requests race.
    const stored = await takeCode(await hashApiKey(code))
    if (!stored) {
      return oauthError("invalid_grant", "Authorization code is invalid or already used")
    }
    if (isExpired(stored.expiresAt)) {
      return oauthError("invalid_grant", "Authorization code has expired")
    }
    if (stored.clientId !== clientId) {
      return oauthError("invalid_grant", "Authorization code was issued to another client")
    }
    // RFC 6749 §4.1.3: the redirect_uri must match the one used at /authorize.
    if (redirectUri !== undefined && redirectUri !== stored.redirectUri) {
      return oauthError("invalid_grant", "redirect_uri does not match the authorization request")
    }
    if (!(await verifyPkce(verifier, stored.codeChallenge, stored.codeChallengeMethod))) {
      return oauthError("invalid_grant", "PKCE verification failed")
    }

    // Takes the client out of the never-redeemed sweep; best-effort (a swept client has no doc).
    await markClientRedeemed(clientId).catch(() => {})
    return issueTokens(clientId, stored.userId, stored.scopes)
  }

  if (grantType === "refresh_token") {
    const { refresh_token: refreshToken, client_id: clientId } = params
    if (!refreshToken) {
      return oauthError("invalid_request", "refresh_token is required")
    }

    const hash = await hashApiKey(refreshToken)
    const stored = await getToken(hash)
    if (!stored || stored.type !== "refresh") {
      return oauthError("invalid_grant", "Refresh token is invalid")
    }
    if (isExpired(stored.expiresAt)) {
      await deleteToken(hash)
      return oauthError("invalid_grant", "Refresh token has expired")
    }
    if (clientId && stored.clientId !== clientId) {
      return oauthError("invalid_grant", "Refresh token was issued to another client")
    }

    // The grant dies with the account: a deleted or disabled user, or one whose
    // sessions were revoked after this token was issued, cannot refresh.
    const inactive = await accountInactive(stored)
    if (inactive) {
      await deleteTokenFamily(stored.familyId ?? hash, hash)
      return oauthError("invalid_grant", "The account behind this grant is no longer active")
    }

    // Rotation: OAuth 2.1 requires it for public clients. The transaction lets
    // one concurrent redemption win; the token stays, spent, so a replay is seen
    // and revokes the whole family (a stolen copy and the thief's descendants).
    const taken = await takeRefreshToken(hash)
    if (!taken || taken.status === "reused") {
      // Within the grace window a spent token is a concurrent loser (the winner holds the live
      // pair): refuse without revoking. A later presentation is a replay and kills the family.
      const raced = taken?.token.usedAt !== undefined && Date.now() - taken.token.usedAt < REUSE_GRACE_MS
      if (taken && !raced) await deleteTokenFamily(taken.token.familyId ?? hash, hash)
      return oauthError("invalid_grant", "Refresh token is invalid")
    }
    return issueTokens(stored.clientId, stored.userId, stored.scopes, stored.familyId ?? hash)
  }

  return oauthError("unsupported_grant_type", `Unsupported grant_type: ${grantType ?? "(missing)"}`)
}
