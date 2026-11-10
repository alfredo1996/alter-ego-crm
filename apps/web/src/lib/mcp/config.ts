/**
 * Public URLs for the MCP resource server and its authorization server.
 *
 * Read lazily from the request rather than validated at import: `src/lib/env.ts`
 * runs at module load and is pulled into the client bundle, so a required
 * server-only value there throws in the browser and in every test.
 */

/** What both transports (HTTP route, stdio script) report as the server version. */
export const MCP_VERSION = "0.40.0"

/** The MCP endpoint's path, and the path component of the RFC 9728 resource identifier. */
export const MCP_PATH = "/api/mcp"

/**
 * RFC 9728 §3.1 inserts the resource's path after the well-known prefix, so a
 * resource of `https://h/api/mcp` publishes its metadata at
 * `https://h/.well-known/oauth-protected-resource/api/mcp`.
 */
export const PRM_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`

/**
 * The public origin, honouring proxy headers.
 *
 * App Hosting terminates TLS upstream, so `request.url` is the internal
 * http://localhost address; x-forwarded-* carries the real one. MCP_PUBLIC_ORIGIN
 * overrides both, for when the forwarded headers can't be trusted.
 */
export function publicOrigin(request: Request): string {
  const override = process.env.MCP_PUBLIC_ORIGIN
  if (override) return override.replace(/\/+$/, "")

  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  if (host) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https"
    return `${proto}://${host}`
  }
  return new URL(request.url).origin
}

/** The RFC 9728 resource identifier — must match the connector URL byte for byte. */
export function resourceId(request: Request): string {
  return `${publicOrigin(request)}${MCP_PATH}`
}
