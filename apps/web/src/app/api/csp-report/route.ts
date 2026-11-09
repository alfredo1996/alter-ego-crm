// Receives CSP violation reports (#347). Log-only, unauthenticated by design
// (browsers send no credentials), so the body is size-capped and never stored.
const MAX_BYTES = 8 * 1024

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MAX_BYTES) return new Response(null, { status: 413 })

  // Count bytes as they arrive: a chunked body has no content-length to trust.
  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      return new Response(null, { status: 413 })
    }
    chunks.push(value)
  }
  const body = new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer())

  // JSON.stringify escapes newlines: a body cannot forge extra log lines.
  console.warn("[csp-report]", JSON.stringify(body.slice(0, 2000)))
  return new Response(null, { status: 204 })
}
