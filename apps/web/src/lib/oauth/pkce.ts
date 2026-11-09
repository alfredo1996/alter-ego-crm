/**
 * PKCE (RFC 7636) verification for the authorization-code grant.
 *
 * Claude always sends a `code_challenge` with `code_challenge_method=S256`, and
 * OAuth 2.1 requires PKCE for public clients, so `plain` is deliberately not
 * supported — accepting it would let anyone who intercepts a code redeem it.
 */

/** base64url without padding, per RFC 7636 §A. */
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/** S256: BASE64URL(SHA256(ASCII(verifier))). */
export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

/**
 * True when `verifier` matches the stored `challenge`.
 *
 * Rejects anything but S256, and rejects verifiers outside RFC 7636's 43–128
 * character range — a short verifier is brute-forceable.
 */
export async function verifyPkce(
  verifier: string | undefined,
  challenge: string | undefined,
  method: string | undefined
): Promise<boolean> {
  if (!verifier || !challenge) return false
  if (method !== "S256") return false
  if (verifier.length < 43 || verifier.length > 128) return false
  return (await s256(verifier)) === challenge
}
