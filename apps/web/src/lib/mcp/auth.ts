import { hashApiKey, validateApiKey } from "@/lib/api-auth"
import { PRM_PATH, publicOrigin } from "@/lib/mcp/config"
import { getToken } from "@/lib/oauth/store"
import { isExpired, SCOPES, type Scope } from "@/lib/oauth/tokens"

export type McpAuth = {
  userId: string
  scopes: string[]
  clientId: string
}

/**
 * The RFC 6750 challenge that starts Claude's OAuth flow.
 *
 * `resource_metadata` points at the RFC 9728 document naming this authorization
 * server, and `scope` tells Claude what to request — without it Claude falls back
 * to whatever the metadata advertises, which produces a broader consent prompt.
 * The 401 status is load-bearing: Claude ignores this header on a 200.
 */
export function challenge(
  request: Request,
  error = "invalid_token",
  description = "Authentication required"
): string {
  return [
    `Bearer error="${error}"`,
    // RFC 6750 §3 allows only %x20-21 / %x23-5B / %x5D-7E here. Dropping the rest
    // keeps a stored scope from closing the quote or splitting the header.
    `error_description="${description.replace(/[^\x20\x21\x23-\x5b\x5d-\x7e]/g, "")}"`,
    `resource_metadata="${publicOrigin(request)}${PRM_PATH}"`,
    `scope="${SCOPES.join(" ")}"`,
  ].join(", ")
}

export function unauthorized(request: Request): Response {
  return Response.json(
    { error: "invalid_token", error_description: "Authentication required" },
    { status: 401, headers: { "WWW-Authenticate": challenge(request) } }
  )
}

/**
 * RFC 6750 §3.1 step-up: a valid token that is missing a scope gets a 403, not a 401.
 *
 * The gate answers before the MCP handler, so a Streamable-HTTP client reports a
 * transport failure and this description is all it can show. It leads with what
 * the credential holds, unfiltered: a token issued before the `crm:*` → `data:*`
 * rename does hold write under the old name, and "Requires: data:write" alone
 * read as if it did not. Only the caller's own scopes appear — never the token,
 * the user or the client.
 */
export function insufficientScope(
  request: Request,
  tool: string,
  required: readonly Scope[],
  granted: readonly string[]
): Response {
  const needs = required.join(" ")
  const description =
    `This credential was granted: ${granted.join(" ") || "none"}. ` +
    `The ${tool} tool needs ${needs}. ` +
    "Scopes are fixed when a credential is issued and never change afterwards: " +
    `to get ${needs}, reconnect the connector (re-authorize) and approve it, ` +
    `or use an API key, which carries every scope (${SCOPES.join(" ")}).`
  return Response.json(
    { error: "insufficient_scope", error_description: description },
    {
      status: 403,
      // Claude unions the challenge's `scope` with the discovery scope, and
      // challenge() sends the full set the user should end up holding.
      headers: { "WWW-Authenticate": challenge(request, "insufficient_scope", description) },
    }
  )
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) return null
  return header.slice(7) || null
}

/**
 * Resolves the caller to a user and their granted scopes, or null.
 *
 * Two credentials are accepted. An OAuth access token issued by this server is
 * tried first and carries real scopes. An Alter Ego API key is the fallback, for
 * clients that send a fixed header instead of running the OAuth flow — it is
 * full-access by nature, so it grants every scope.
 */
export async function authenticate(request: Request): Promise<McpAuth | null> {
  const token = bearer(request)
  if (!token) return null

  const stored = await getToken(await hashApiKey(token))
  if (stored) {
    if (stored.type !== "access" || isExpired(stored.expiresAt)) return null
    return { userId: stored.userId, scopes: stored.scopes, clientId: stored.clientId }
  }

  const userId = await validateApiKey(request)
  if (!userId) return null
  return { userId, scopes: [...SCOPES], clientId: "api-key" }
}
