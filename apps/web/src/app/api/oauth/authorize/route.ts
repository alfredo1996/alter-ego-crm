import { getAdminAuth } from "@/lib/firebase-admin-client"
import { oauthError } from "@/lib/oauth/http"
import { matchesRegistered } from "@/lib/oauth/redirect-uri"
import { getClient, saveCode } from "@/lib/oauth/store"
import { CODE_TTL_SECONDS, expiresAt, mintToken, parseScopes } from "@/lib/oauth/tokens"
import { isOwner } from "@/lib/owner-uid"

export const runtime = "nodejs"

type ApproveBody = {
  idToken?: string
  clientId?: string
  redirectUri?: string
  scope?: string
  codeChallenge?: string
  codeChallengeMethod?: string
}

/**
 * Consent approval: turns a signed-in Firebase user into an authorization code.
 *
 * Identity is delegated to the Firebase session the app already maintains — the
 * consent page sends its ID token here and `verifyIdToken` checks the signature
 * server-side. There is no second password to manage, and the resulting code is
 * bound to whichever account actually approved it.
 */
export async function POST(request: Request): Promise<Response> {
  let body: ApproveBody
  try {
    body = (await request.json()) as ApproveBody
  } catch {
    return oauthError("invalid_request", "Body must be JSON")
  }

  const { idToken, clientId, redirectUri, codeChallenge, codeChallengeMethod } = body

  if (!idToken || !clientId || !redirectUri) {
    return oauthError("invalid_request", "idToken, clientId and redirectUri are required")
  }
  // PKCE is mandatory under OAuth 2.1; a code with no challenge is replayable.
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return oauthError("invalid_request", "A code_challenge with method S256 is required")
  }

  if (body.scope != null && typeof body.scope !== "string") {
    return oauthError("invalid_request", "scope must be a string")
  }
  // Before any lookup: an empty or all-unknown scope must not widen to the defaults.
  const scopes = parseScopes(body.scope)
  if (scopes.length === 0) {
    return oauthError("invalid_scope", "None of the requested scopes is supported")
  }

  let userId: string
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken)
    userId = decoded.uid
  } catch {
    return oauthError("access_denied", "Sign-in could not be verified", 401)
  }
  // The MCP tools write through the Admin SDK, which bypasses the rules (#389).
  if (!isOwner(userId)) {
    return oauthError("access_denied", "This account is not allowed to connect", 403)
  }

  const client = await getClient(clientId)
  if (!client) {
    return oauthError("invalid_client", "Unknown client_id", 401)
  }
  // Re-checked here and not only in the browser: this is what stops a forged
  // authorize link from delivering the code to somewhere the client never registered.
  if (!matchesRegistered(redirectUri, client.redirectUris)) {
    return oauthError("invalid_request", "redirect_uri does not match a registered value")
  }

  const { value: code, hash } = await mintToken()
  await saveCode(hash, {
    clientId,
    userId,
    redirectUri,
    scopes,
    codeChallenge,
    codeChallengeMethod,
    expiresAt: expiresAt(CODE_TTL_SECONDS),
  })

  return Response.json({ code }, { headers: { "Cache-Control": "no-store" } })
}
