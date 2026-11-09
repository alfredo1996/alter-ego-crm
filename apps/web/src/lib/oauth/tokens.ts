import { hashApiKey } from "@/lib/api-auth"

import type { SCOPES } from "@/lib/oauth/scopes"

// Re-exported so server-side callers keep importing them from here.
export { parseScopes, SCOPE_READ, SCOPE_WRITE, SCOPES } from "@/lib/oauth/scopes"
export type Scope = (typeof SCOPES)[number]

/** Authorization codes are single-use and redeemed within seconds; a minute is generous. */
export const CODE_TTL_SECONDS = 60
/** Claude proactively refreshes ~5 minutes before expiry, so an hour is comfortable. */
export const ACCESS_TTL_SECONDS = 60 * 60
/** Rotated on every refresh, so a long life costs little. */
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 90

/**
 * A fresh opaque credential and the hash it is stored under.
 *
 * 256 bits from the platform CSPRNG. Only the hash is persisted, so a database
 * leak does not yield usable tokens — the same reasoning as the API-key index.
 */
export async function mintToken(): Promise<{ value: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const value = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return { value, hash: await hashApiKey(value) }
}

/** Seconds since epoch, `ttl` seconds from `now`. Matches AuthInfo.expiresAt's unit. */
export function expiresAt(ttl: number, now: number = Date.now()): number {
  return Math.floor(now / 1000) + ttl
}

export function isExpired(exp: number, now: number = Date.now()): boolean {
  return exp <= Math.floor(now / 1000)
}

/** True when every scope in `required` was granted. */
export function hasScopes(granted: readonly string[], required: readonly Scope[]): boolean {
  return required.every((s) => granted.includes(s))
}
