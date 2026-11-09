/**
 * Redirect URI validation.
 *
 * This is the highest-stakes check in the server: the authorization code is
 * delivered to whatever URI is accepted here, so a loose comparison hands codes
 * to an attacker. Matching is exact per RFC 6749 §3.1.2, with the single
 * exception RFC 8252 §7.3 requires for native loopback clients.
 */

/** Loopback hosts a native client may bind. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

function parse(uri: string): URL | null {
  try {
    return new URL(uri)
  } catch {
    return null
  }
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK.has(url.hostname)
}

/**
 * Whether a client may register this URI.
 *
 * https anywhere, plain http only on loopback — a native client cannot obtain a
 * certificate for 127.0.0.1. Fragments are forbidden by RFC 6749 §3.1.2.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  const url = parse(uri)
  if (!url) return false
  if (url.hash) return false
  return url.protocol === "https:" || isLoopback(url)
}

/**
 * Whether `requested` matches one of the client's registered URIs.
 *
 * Exact string comparison, except that a loopback URI ignores the port: native
 * clients such as Claude Code bind an ephemeral port at runtime and cannot
 * register it in advance (RFC 8252 §7.3). Everything else — scheme, host, path,
 * query — must still match exactly.
 */
export function matchesRegistered(requested: string, registered: readonly string[]): boolean {
  if (registered.includes(requested)) return true

  const want = parse(requested)
  if (!want || !isLoopback(want)) return false

  return registered.some((candidate) => {
    const have = parse(candidate)
    if (!have || !isLoopback(have)) return false
    return (
      have.hostname === want.hostname &&
      have.pathname === want.pathname &&
      have.search === want.search
    )
  })
}
