import { publicOrigin } from "@/lib/mcp/config"
import { metadataJson, metadataOptions } from "@/lib/oauth/http"
import { SCOPES } from "@/lib/oauth/tokens"

export const runtime = "nodejs"

/** RFC 8414 authorization server metadata. */
export function GET(request: Request): Response {
  const origin = publicOrigin(request)
  return metadataJson({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    scopes_supported: [...SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Public client: PKCE stands in for a client secret, so no secret is expected.
    token_endpoint_auth_methods_supported: ["none"],
    // S256 only. OAuth 2.1 forbids `plain`, and Claude always sends S256.
    code_challenge_methods_supported: ["S256"],
    // Deliberately no `client_id_metadata_document_supported`: advertising CIMD
    // would make Claude skip registration, and this server implements DCR.
  })
}

export const OPTIONS = metadataOptions
