/**
 * Sanitises a post-login `?next=` destination.
 *
 * Returns the path only when it is unambiguously same-origin. Anything else
 * falls back to `/` (which sends the user to the first page the deployment has), because a `next` parameter that accepts absolute
 * URLs is an open redirect: an attacker sends a login link that bounces the user
 * to a look-alike site immediately after they authenticate.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback
  // Must be a rooted path. "//evil.com" and "/\evil.com" are protocol-relative
  // URLs that browsers resolve to another origin, so they are rejected too.
  if (!next.startsWith("/")) return fallback
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback
  // The URL parser drops tab, CR and LF, so "/\t/evil.com" becomes "//evil.com".
  if (/[\u0000-\u001F\u007F\s\\]/.test(next)) return fallback
  const origin = "http://safe-next.invalid"
  try {
    if (new URL(next, origin).origin !== origin) return fallback
  } catch {
    return fallback
  }
  return next
}
