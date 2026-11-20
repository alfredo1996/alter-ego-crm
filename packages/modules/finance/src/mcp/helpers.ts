import type { Account, Category } from "../types"

/**
 * Pure logic shared by every MCP tool: the response envelope, month arithmetic,
 * and resolving accounts and categories. Everything here is unit-tested and the
 * handlers stay thin wrappers.
 */

export class ToolInputError extends Error {}

export const round2 = (n: number) => Math.round(n * 100) / 100

// ─── MCP response shape ──────────────────────────────────────────────────────

export function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] }
}

export function fail(error: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error }) }],
    isError: true as const,
  }
}

// ─── Months ──────────────────────────────────────────────────────────────────

/**
 * Normalizes "YYYY-MM" or "YYYY-MM-DD" to the month, with a readable error.
 * Italian month names are NOT parsed here — the model translates before calling.
 */
export function normalizeMonth(input: string): string {
  const match = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(input.trim())
  const month = match ? Number(match[2]) : 0
  if (!match || month < 1 || month > 12) {
    throw new ToolInputError(
      `Invalid date: "${input}". Use YYYY-MM (e.g. 2026-08) or YYYY-MM-DD.`
    )
  }
  return `${match[1]}-${match[2]}`
}

/**
 * Resolves a [from, to] window that honours day precision when it is given.
 *
 * `normalizeMonth` deliberately truncates, which is right for the tools that
 * group by month — but a listing asked for "2026-07-05" must not silently answer
 * for all of July. A month bound still widens to the whole month (`from` to its
 * first day, `to` to its last), so the two precisions mix: from a day, to a month.
 *
 * `to` defaults to `from`, at the same precision: one day, or one whole month.
 */
export function resolveDateWindow(input: { from: string; to?: string }): {
  from: Date
  to: Date
} {
  const from = parseBound(input.from, "start")
  const to = input.to ? parseBound(input.to, "end") : parseBound(input.from, "end")
  if (to.getTime() < from.getTime()) {
    throw new ToolInputError(`Invalid range: "${input.from}" is after "${input.to}".`)
  }
  return { from, to }
}

/** A bound as a Date: start-of-day/month for "start", end-of-day/month for "end". */
function parseBound(input: string, edge: "start" | "end"): Date {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(input.trim())
  const month = match ? Number(match[2]) : 0
  if (!match || month < 1 || month > 12) {
    throw new ToolInputError(
      `Invalid date: "${input}". Use YYYY-MM-DD (e.g. 2026-08-23) or YYYY-MM.`
    )
  }
  const year = Number(match[1])
  const day = match[3] ? Number(match[3]) : null

  if (day === null) {
    return edge === "start"
      ? new Date(year, month - 1, 1)
      : new Date(year, month, 0, 23, 59, 59, 999)
  }
  const date =
    edge === "start"
      ? new Date(year, month - 1, day)
      : new Date(year, month - 1, day, 23, 59, 59, 999)
  // Rejects "2026-02-30", which the Date constructor would roll into March.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new ToolInputError(`Invalid date: "${input}" does not exist.`)
  }
  return date
}

/** Number of months in the inclusive [from, to] window. Negative spans throw. */
export function monthSpan(from: string, to: string): number {
  const span =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) +
    1
  if (span < 1) {
    throw new ToolInputError(`Invalid range: "${from}" is after "${to}".`)
  }
  return span
}

/** The month `delta` months after `from` (negative = before). */
export function monthShift(from: string, delta: number): string {
  const total = Number(from.slice(0, 4)) * 12 + (Number(from.slice(5, 7)) - 1) + delta
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return `${year}-${String(month).padStart(2, "0")}`
}

// ─── Entity resolution ───────────────────────────────────────────────────────

/**
 * Resolves a category by id or name — exact, then prefix, then substring, all
 * case-insensitive. Misses list the available names so the model self-corrects
 * on the next call rather than silently returning an empty set.
 */
export function resolveCategory(categories: Category[], query: string): Category {
  const byId = categories.find((c) => c.id === query)
  if (byId) return byId

  const q = query.trim().toLowerCase()
  for (const match of [
    categories.filter((c) => c.name.toLowerCase() === q),
    categories.filter((c) => c.name.toLowerCase().startsWith(q)),
    categories.filter((c) => c.name.toLowerCase().includes(q)),
  ]) {
    if (match.length === 1) return match[0]
    if (match.length > 1) {
      throw new ToolInputError(
        `Several categories match "${query}": ${match.map((c) => c.name).join(", ")}. Be more specific.`
      )
    }
  }
  throw new ToolInputError(
    `No category matches "${query}". Categories: ${categories.map((c) => c.name).join(", ") || "none"}.`
  )
}

/** Same ladder as resolveCategory, over accounts. Archived accounts still resolve. */
export function resolveAccount(accounts: Account[], query: string): Account {
  const byId = accounts.find((a) => a.id === query)
  if (byId) return byId

  const q = query.trim().toLowerCase()
  for (const match of [
    accounts.filter((a) => a.name.toLowerCase() === q),
    accounts.filter((a) => a.name.toLowerCase().startsWith(q)),
    accounts.filter((a) => a.name.toLowerCase().includes(q)),
  ]) {
    if (match.length === 1) return match[0]
    if (match.length > 1) {
      throw new ToolInputError(
        `Several accounts match "${query}": ${match.map((a) => a.name).join(", ")}. Be more specific.`
      )
    }
  }
  throw new ToolInputError(
    `No account matches "${query}". Accounts: ${accounts.map((a) => a.name).join(", ") || "none"}.`
  )
}
