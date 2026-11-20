/**
 * Which plugins a deployment runs. Pure: no env, no `@/` imports, so next.config.ts can call it and
 * fail the build before any page is compiled. index.ts is what the app imports.
 */
import { rent } from "@alter-ego/rent/manifest"

import { accounting } from "./accounting/manifest"
import { consulting } from "./consulting/manifest"
import { finance } from "./finance/manifest"

import type { ModuleId, ModuleManifest } from "@alter-ego/kernel/module"

// The order is the sidebar's: Personal Finance first, so `/` opens its Dashboard when it is on.
export const MODULES: ModuleManifest[] = [finance, consulting, accounting, rent]

/**
 * What an unset NEXT_PUBLIC_PLUGINS runs. A literal on purpose, not MODULES: a plugin added later
 * (Personal Finance was) must stay off until a deployment lists it, so an upgrade never changes what it shows.
 */
export const DEFAULT_PLUGINS: ModuleId[] = ["consulting", "accounting", "rent"]

const byId = new Map(MODULES.map((m) => [m.id, m]))

export interface ResolvedModules {
  enabled: Set<ModuleId>
  /** The variable and the plugins it ends up listing, for Settings. */
  selection: { variable: string; value: string }
}

/**
 * `plugins` is NEXT_PUBLIC_PLUGINS: an opt-in list; unset or blank means consulting,accounting,rent. `retired` is
 * NEXT_PUBLIC_DISABLED_MODULES, which is no longer read: defined at all, even empty, it throws, so a
 * deployment that kept it fails loudly instead of silently running something else.
 */
export function resolveModules(plugins?: string, retired?: string): ResolvedModules {
  if (retired !== undefined) {
    throw new Error(
      "NEXT_PUBLIC_DISABLED_MODULES is no longer read. Remove it and list the plugins to run in NEXT_PUBLIC_PLUGINS, for example NEXT_PUBLIC_PLUGINS=consulting,accounting,rent.",
    )
  }
  const listed = (plugins ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  for (const id of listed) {
    if (!byId.has(id as ModuleId)) {
      throw new Error(`Unknown plugin "${id}" in NEXT_PUBLIC_PLUGINS. The plugins are: ${MODULES.map((m) => m.id).join(", ")}.`)
    }
  }
  const on = new Set<string>(listed.length ? listed : DEFAULT_PLUGINS)
  const enabled = new Set(MODULES.filter((m) => on.has(m.id)).map((m) => m.id))
  for (const m of MODULES) {
    for (const need of m.requires) {
      if (enabled.has(m.id) && !enabled.has(need)) {
        const dep = byId.get(need)!.label
        throw new Error(`${m.label} needs ${dep}, but NEXT_PUBLIC_PLUGINS does not list ${dep}. List ${dep}, or leave ${m.label} out too.`)
      }
    }
  }
  return { enabled, selection: { variable: "NEXT_PUBLIC_PLUGINS", value: [...enabled].join(",") } }
}
