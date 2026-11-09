/**
 * The scope vocabulary, in a module with no imports at all.
 *
 * It lives apart from ./tokens because the consent screen is a client component
 * and tokens.ts reaches the Admin SDK: importing the constants from there pulled
 * `google-auth-library` into the browser bundle, and the build failed on
 * `Can't resolve 'child_process'`. A leaf module keeps one source of truth
 * without dragging the server graph across the boundary.
 *
 * Named after what they grant, not after one of the two products this server can
 * serve. They were `crm:read`/`crm:write` while the CRM was the only consumer;
 * the finance tools then arrived behind the same gate, leaving the accounting
 * half asking for a scope named after the company half.
 */
export const SCOPE_READ = "data:read"
export const SCOPE_WRITE = "data:write"

/** Scopes this authorization server issues. Read and write are separate on purpose. */
export const SCOPES = [SCOPE_READ, SCOPE_WRITE] as const

/**
 * Narrows a requested scope string to the ones this server actually issues.
 *
 * Only an absent parameter means the defaults (RFC 6749 §3.3). Anything
 * present is narrowed, and may come out empty: callers refuse that with
 * `invalid_scope` rather than quietly granting more than was asked, which would
 * let the consent screen show less than the server grants.
 */
export function parseScopes(requested: string | null | undefined): (typeof SCOPES)[number][] {
  if (requested == null) return [...SCOPES]
  const asked = new Set(requested.split(/\s+/).filter(Boolean))
  return SCOPES.filter((s) => asked.has(s))
}
