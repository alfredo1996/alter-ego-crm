import { isModuleOn, MODULES } from "@/modules"

import type { ModuleId } from "@/modules"

// ponytail: a Record here so a new plugin id fails typecheck until it has a phrase; a field on
// ModuleManifest if plugins ever ship from outside this repo.
const PHRASES: Record<ModuleId, string> = {
  finance: "personal accounts, budgets and reports",
  consulting: "pipeline, clients and contracts",
  accounting: "invoices, costs and the cash book",
  rent: "tenants and leases",
}

/**
 * What this build runs, in words, lower-case: one phrase per plugin that is on, in MODULES order.
 * The manifest, the page's meta description and the OAuth consent screen all read it, so none names
 * data the build does not have. Empty only if no plugin is on, which resolveModules never yields.
 */
export function enabledDataPhrase(): string {
  return MODULES.filter((m) => isModuleOn(m.id))
    .map((m) => PHRASES[m.id])
    .join("; ")
}

/** The same phrase with a capital, or "Alter Ego" as the guard for an empty set. */
export function appDescription(): string {
  const text = enabledDataPhrase()
  return text ? text[0]!.toUpperCase() + text.slice(1) : "Alter Ego"
}
