import { getAdminAuth } from "@/lib/firebase-admin-client"
import { oauthError } from "@/lib/oauth/http"
import { deleteTokensForUser } from "@/lib/oauth/store"

export const runtime = "nodejs"

/**
 * "Disconnect All Connectors": revokes every OAuth access and refresh token of
 * the signed-in user. Identity is the Firebase ID token in the Authorization
 * header, verified server-side, as at /authorize.
 */
export async function POST(request: Request): Promise<Response> {
  const idToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1]
  if (!idToken) return oauthError("access_denied", "Sign-in could not be verified", 401)

  let userId: string
  try {
    userId = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return oauthError("access_denied", "Sign-in could not be verified", 401)
  }

  const revoked = await deleteTokensForUser(userId)
  return Response.json({ revoked }, { headers: { "Cache-Control": "no-store" } })
}
