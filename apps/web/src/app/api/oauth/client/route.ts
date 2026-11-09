
import { isAllowedRedirectUri, matchesRegistered } from "@/lib/oauth/redirect-uri"
import { getClient } from "@/lib/oauth/store"
import { z } from "@/lib/zod"

const querySchema = z.object({
  client_id: z.string().min(1).max(200),
  redirect_uri: z.string().min(1).max(2048),
})

export const runtime = "nodejs"

/**
 * Whether a client_id and redirect_uri pair is registered, for the consent page.
 *
 * The page must not navigate to a redirect_uri it has not checked: the query is
 * attacker-supplied. This uses the same rules as /api/oauth/authorize and
 * answers with the client's name only. Any failure reads as "not valid".
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    client_id: searchParams.get("client_id") ?? "",
    redirect_uri: searchParams.get("redirect_uri") ?? "",
  })
  const headers = { "Cache-Control": "no-store" }

  try {
    if (parsed.success && isAllowedRedirectUri(parsed.data.redirect_uri)) {
      const client = await getClient(parsed.data.client_id)
      if (client && matchesRegistered(parsed.data.redirect_uri, client.redirectUris)) {
        return Response.json({ valid: true, clientName: client.clientName }, { headers })
      }
    }
  } catch {
    // Store unreachable: fall through to not valid.
  }
  return Response.json({ valid: false }, { headers })
}
