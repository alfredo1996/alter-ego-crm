import { getServerDb } from "@/lib/backend/server-db"

export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function validateApiKey(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null

  const rawKey = authHeader.slice(7)
  if (!rawKey) return null

  const keyHash = await hashApiKey(rawKey)
  return getServerDb().validateApiKey(keyHash)
}

export function apiError(
  code: string,
  message: string,
  status: number,
  details?: unknown[]
) {
  return Response.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status }
  )
}
