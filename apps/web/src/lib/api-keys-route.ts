import { getAdminAuth } from "@/lib/firebase-admin-client"

/** The uid behind a `Authorization: Bearer <Firebase ID token>` header, or null. */
export async function uidFromIdToken(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) return null
  try {
    return (await getAdminAuth().verifyIdToken(header.slice(7))).uid
  } catch {
    return null
  }
}
