/** Public discovery documents are read cross-origin by browser-based clients. */
export const METADATA_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "max-age=300",
} as const

export function metadataJson(body: unknown): Response {
  return Response.json(body, { headers: METADATA_CORS })
}

export function metadataOptions(): Response {
  return new Response(null, { status: 200, headers: METADATA_CORS })
}

/**
 * An RFC 6749 §5.2 error response.
 *
 * The code matters: Claude retries a refresh only on `invalid_grant`. A custom
 * code, or `invalid_request` in its place, surfaces as a dead connection.
 */
export function oauthError(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
  )
}
