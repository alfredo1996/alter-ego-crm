/**
 * The registry: which modules this deployment runs, resolved once at load from
 * NEXT_PUBLIC_DISABLED_MODULES (everything on otherwise).
 *
 * A module that needs a disabled one throws here, which fails the build: pages
 * import this file, so `next build` evaluates it.
 */
import { rent } from "@alter-ego/rent/manifest"

import { env } from "@/lib/env"

import { books } from "./books/manifest"
import { crm } from "./crm/manifest"
import { invoicing } from "./invoicing/manifest"
import { solutions } from "./solutions/manifest"

import type { ModuleId, ModuleManifest } from "@alter-ego/kernel/module"

export type { ModuleId, ModuleManifest } from "@alter-ego/kernel/module"

export const MODULES: ModuleManifest[] = [crm, invoicing, books, solutions, rent]

const byId = new Map(MODULES.map((m) => [m.id, m]))

export interface ResolvedModules {
  enabled: Set<ModuleId>
  /** The variable and value that left modules out, for Settings: "none" when nothing is. */
  leftOut: { variable: string; value: string }
}

export function resolveModules(disabledCsv: string): ResolvedModules {
  const listed = disabledCsv.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  for (const id of listed) {
    if (!byId.has(id as ModuleId)) throw new Error(`Unknown module "${id}" in NEXT_PUBLIC_DISABLED_MODULES.`)
  }
  const off = new Set<string>(listed)
  const enabled = new Set(MODULES.filter((m) => !off.has(m.id)).map((m) => m.id))
  for (const m of MODULES) {
    for (const need of m.requires) {
      if (enabled.has(m.id) && !enabled.has(need)) {
        const dep = byId.get(need)!.label
        throw new Error(
          `${m.label} needs ${dep}, but NEXT_PUBLIC_DISABLED_MODULES leaves ${dep} out. Turn ${dep} back on, or leave ${m.label} out too.`,
        )
      }
    }
  }
  const leftOut = { variable: "NEXT_PUBLIC_DISABLED_MODULES", value: listed.length ? listed.join(",") : "none" }
  return { enabled, leftOut }
}

const resolved = resolveModules(env.NEXT_PUBLIC_DISABLED_MODULES)

export const leftOut = resolved.leftOut

export function isModuleOn(id: ModuleId): boolean {
  return resolved.enabled.has(id)
}

export function allToolNames(): string[] {
  return MODULES.flatMap((m) => m.tools)
}

/**
 * get_quarters is declared under crm but reads ended months off invoices and
 * costs: without either, every ended quarter would say €0. ponytail: one rule, so
 * a constant here; a `needs` field on the manifest if a second tool ever wants it.
 */
const QUARTERS_NEED: ModuleId[] = ["invoicing", "books"]

export function enabledToolNames(enabled: Set<ModuleId> = resolved.enabled): Set<string> {
  const names = new Set(MODULES.filter((m) => enabled.has(m.id)).flatMap((m) => m.tools))
  if (!QUARTERS_NEED.every((id) => enabled.has(id))) names.delete("get_quarters")
  return names
}

/**
 * The server with `registerTool` filtered: a tool of a disabled module is never
 * registered, so `tools/list` omits it. The tool modules stay whole; only the
 * registry knows which module owns which tool.
 */
export function gateTools<S extends { registerTool: (name: string, ...rest: never[]) => unknown }>(
  server: S,
  allowed: Set<string> = enabledToolNames(),
): S {
  return new Proxy(server, {
    get(target, key) {
      if (key === "registerTool") {
        return (name: string, ...rest: never[]) => (allowed.has(name) ? target.registerTool(name, ...rest) : undefined)
      }
      const value = Reflect.get(target, key, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
