import { uidFromIdToken } from "@/lib/api-keys-route"
import { getServerDb } from "@/lib/backend/server-db"
import { isOwner } from "@/lib/owner-uid"

export const runtime = "nodejs"

/** Creates an API key for the signed-in user; the raw key is returned once. */
export async function POST(request: Request): Promise<Response> {
  const uid = await uidFromIdToken(request)
  if (!uid) return Response.json({ error: "Unauthorized" }, { status: 401 })
  // The Admin SDK below bypasses the rules, so the allowlist is checked here (#389).
  if (!isOwner(uid)) return Response.json({ error: "Forbidden" }, { status: 403 })
  const created = await getServerDb().createApiKey(uid)
  return Response.json(created, { headers: { "Cache-Control": "no-store" } })
}
