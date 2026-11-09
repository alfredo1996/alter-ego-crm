const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_WINDOW = 30

// ponytail: per instance and in memory, so it resets on deploy and each App Hosting
// instance counts alone (the real ceiling is limit x instances). Upgrade path: a
// Firestore counter per IP per hour, if registration abuse survives this.
const hits = new Map<string, number[]>()

/** True when this IP may register; records the attempt. */
export function allowRegister(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent)
    return false
  }
  recent.push(now)
  hits.set(ip, recent)
  // Bound the map: drop the oldest key once it grows past 10k IPs.
  if (hits.size > 10_000) hits.delete(hits.keys().next().value as string)
  return true
}

export const REGISTER_RETRY_AFTER_SECONDS = WINDOW_MS / 1000

export function resetRegisterLimit(): void {
  hits.clear()
}
