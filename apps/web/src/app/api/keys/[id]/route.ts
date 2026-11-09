
import { uidFromIdToken } from "@/lib/api-keys-route"
import { getServerDb } from "@/lib/backend/server-db"
import { z } from "@/lib/zod"

export const runtime = "nodejs"

/** Revokes one of the signed-in user's keys; another user's id is a no-op. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const uid = await uidFromIdToken(request)
  if (!uid) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).safeParse((await params).id)
  if (!id.success) return Response.json({ error: "Invalid key id" }, { status: 400 })
  await getServerDb().deleteApiKey(uid, id.data)
  return new Response(null, { status: 204 })
}
