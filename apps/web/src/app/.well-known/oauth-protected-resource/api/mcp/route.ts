import { publicOrigin, resourceId } from "@/lib/mcp/config"
import { metadataJson, metadataOptions } from "@/lib/oauth/http"
import { SCOPES } from "@/lib/oauth/tokens"

export const runtime = "nodejs"

/**
 * RFC 9728 protected resource metadata.
 *
 * `resource` must equal the connector URL exactly, and `authorization_servers`
 * must lead with the real issuer — Claude reads only the first entry.
 */
export function GET(request: Request): Response {
  return metadataJson({
    resource: resourceId(request),
    authorization_servers: [publicOrigin(request)],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
  })
}

export const OPTIONS = metadataOptions
