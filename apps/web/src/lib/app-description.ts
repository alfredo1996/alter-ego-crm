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
 * What this build runs, in words: one phrase per plugin that is on, in MODULES order. The manifest and
 * the page's meta description both read it, so neither names a page the build does not have.
 * resolveModules never yields an empty set (an unset list means the defaults), so "Alter Ego" is a guard.
 */
export function appDescription(): string {
  const text = MODULES.filter((m) => isModuleOn(m.id))
    .map((m) => PHRASES[m.id])
    .join("; ")
  return text ? text[0]!.toUpperCase() + text.slice(1) : "Alter Ego"
}
