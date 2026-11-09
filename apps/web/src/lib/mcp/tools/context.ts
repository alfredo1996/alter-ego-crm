
import { formatCurrency } from "@alter-ego/kernel/currency"

import { fail, round2, ToolInputError } from "@/lib/mcp/tools/helpers"
import { z } from "@/lib/zod"

import type { Currency } from "@/types"

/**
 * The bits every tool module needs: who is calling, how a failure is shaped, and
 * the month/day input format.
 */

export const monthInput = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "Use YYYY-MM or YYYY-MM-DD")

/** Env var naming the ledger owner when the server is spawned over stdio. */
export const STDIO_USER_ID_ENV = "ALTER_EGO_USER_ID"

/**
 * The user whose data a tool call acts on.
 *
 * Over HTTP that is the OAuth subject, established before any tool runs. Over
 * stdio there is no request to authenticate: the client spawned this process, so
 * the process boundary *is* the trust boundary and identity comes from the
 * environment it was started with. Erroring beats defaulting — a wrong id would
 * silently read and write somebody else's ledger.
 */
export function userIdOf(ctx: {
  http?: { authInfo?: { extra?: Record<string, unknown> } }
}): string {
  const fromRequest = ctx.http?.authInfo?.extra?.userId
  if (typeof fromRequest === "string" && fromRequest) return fromRequest

  const fromEnv = process.env[STDIO_USER_ID_ENV]
  if (fromEnv) return fromEnv

  throw new ToolInputError(
    `No user for this call: set ${STDIO_USER_ID_ENV} when starting the server over stdio.`
  )
}

export function toolError(e: unknown) {
  return fail(e instanceof ToolInputError ? e.message : (console.error("[mcp] internal error", e), "Internal error"))
}

/** "€12.50", "$12.50": an amount in its own currency, to the cent, for a reply's summary. Payload numbers stay numbers. */
export function money(amount: number, currency: Currency): string {
  // round2 first so a float residue is "€0.00", and + 0 so a rounded -0 is not "-€0.00".
  return formatCurrency(round2(amount) + 0, currency, "en")
}

/**
 * An amount summed over rows that may differ in currency (the tools add balances and
 * spending without converting). One currency: formatted in it. Several: the bare
 * number, because no symbol would be true. ponytail: no conversion; a base currency would fix it.
 */
export function moneyIn(amount: number, currencies: Currency[]): string {
  const distinct = new Set(currencies)
  return distinct.size === 1
    ? money(amount, [...distinct][0])
    : (round2(amount) + 0).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** The sentence a summary appends when its totals add several currencies; "" when there is one or none. */
export function mixedNote(currencies: Currency[]): string {
  const distinct = [...new Set(currencies)].sort()
  return distinct.length > 1 ? ` Totals add ${distinct.join(" and ")} without conversion.` : ""
}
