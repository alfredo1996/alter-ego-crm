
import { clientIp } from "@/lib/oauth/client-ip"
import { oauthError } from "@/lib/oauth/http"
import { allowRegister, REGISTER_RETRY_AFTER_SECONDS } from "@/lib/oauth/rate-limit"
import { isAllowedRedirectUri } from "@/lib/oauth/redirect-uri"
import { saveClient, sweepStaleClients } from "@/lib/oauth/store"
import { z } from "@/lib/zod"

export const runtime = "nodejs"

const MAX_REDIRECT_URIS = 10
const MAX_URI_LENGTH = 2048
const MAX_NAME_LENGTH = 100
// 10 URIs of 2048 characters plus JSON overhead fit well under this.
const MAX_BODY_BYTES = 32 * 1024

const bodySchema = z.object({
  redirect_uris: z.array(z.string().max(MAX_URI_LENGTH)).min(1).max(MAX_REDIRECT_URIS),
  client_name: z.string().max(MAX_NAME_LENGTH).optional(),
})

/**
 * RFC 7591 dynamic client registration.
 *
 * Open by design — the spec has no way to authenticate an unregistered client,
 * and registration alone grants nothing: the caller still has to send the user
 * through sign-in and consent, and the token that results is scoped to whoever
 * actually approved it. The validation below is anti-abuse, not authorization.
 */
export async function POST(request: Request): Promise<Response> {
  // Bucket on the caller as Google's edge saw it; client-supplied entries cannot move it (see clientIp).
  const ip = clientIp(request.headers.get("x-forwarded-for"))
  if (!allowRegister(ip)) {
    const res = oauthError("invalid_client_metadata", "Too many registrations, try again later", 429)
    res.headers.set("Retry-After", String(REGISTER_RETRY_AFTER_SECONDS))
    return res
  }

  const tooBig = () => oauthError("invalid_client_metadata", "Body is too large", 413)
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooBig()
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return tooBig()

  let body: unknown
  try {
    // RFC 7591 §3.1 registration is JSON, unlike the form-encoded token endpoint.
    body = JSON.parse(text)
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON")
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    if (parsed.error.issues[0].path[0] === "client_name") {
      return oauthError(
        "invalid_client_metadata",
        `client_name must be a string of at most ${MAX_NAME_LENGTH} characters`
      )
    }
    return oauthError(
      "invalid_redirect_uri",
      `redirect_uris (1 to ${MAX_REDIRECT_URIS}, each up to ${MAX_URI_LENGTH} characters) is required`
    )
  }
  const uris = parsed.data.redirect_uris
  if (!uris.every(isAllowedRedirectUri)) {
    return oauthError(
      "invalid_redirect_uri",
      "Each redirect_uri must be https, or http on a loopback address"
    )
  }

  const clientName = parsed.data.client_name ?? "Unnamed client"
  const clientId = crypto.randomUUID()

  const now = Date.now()
  await saveClient({ clientId, clientName, redirectUris: uris, createdAt: now, unredeemedSince: now })
  // Lazy TTL sweep; a failure must not fail the registration.
  await sweepStaleClients(now).catch(() => {})

  return Response.json(
    {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: uris,
      // Public client: PKCE replaces the secret, so none is issued.
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  )
}
