/**
 * The rate-limit key for a request: the caller's IP out of x-forwarded-for.
 *
 * Verified on App Hosting (#391, 2026-10-27): its chain appends two Google hops after the caller
 * ([client, 35.219.200.x, 74.125.212.x]) and anything the client sends lands before the caller, so
 * the caller is the third entry from the end. With fewer than three entries (dev, tests, a local
 * proxy) the last entry stands in; a missing or empty header is "unknown". Empty segments are
 * dropped before counting.
 *
 * The index also relies on the Cloud Run service not being publicly invokable: a direct request to
 * the *.run.app URL would carry fewer Google hops and could pick its own bucket. Its invoker IAM
 * policy has no public member, so direct requests get 403 (verified 2026-10-27, #391). Granting
 * allUsers invoker, or adding a path without Google's two hops, would break the key.
 *
 * ponytail: the index is fixed. If App Hosting adds or removes a hop it shifts; the upgrade path is
 * matching Google's published proxy ranges instead of counting.
 */
export function clientIp(xff: string | null): string {
  const entries = (xff ?? "").split(",").map((e) => e.trim()).filter(Boolean)
  return entries.at(entries.length >= 3 ? -3 : -1) ?? "unknown"
}
