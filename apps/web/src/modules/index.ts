/**
 * The registry: which plugins this deployment runs, resolved once at load from
 * NEXT_PUBLIC_PLUGINS (every plugin when unset).
 *
 * A bad list throws here, and next.config.ts calls the same resolver, so `next build` fails before it
 * compiles a page.
 */
import { env } from "@/lib/env"

import { MODULES, resolveModules } from "./resolve"

import type { ModuleId } from "@alter-ego/kernel/module"

export { MODULES, resolveModules } from "./resolve"
export type { ModuleId, ModuleManifest } from "@alter-ego/kernel/module"

const resolved = resolveModules(env.NEXT_PUBLIC_PLUGINS, env.NEXT_PUBLIC_DISABLED_MODULES)

export const selection = resolved.selection

export function isModuleOn(id: ModuleId): boolean {
  return resolved.enabled.has(id)
}

export function allToolNames(): string[] {
  return MODULES.flatMap((m) => m.tools)
}

/**
 * get_quarters is declared under consulting but reads ended months off invoices and
 * costs: without Accounting, every ended quarter would say €0. ponytail: one rule, so
 * a constant here; a `needs` field on the manifest if a second tool ever wants it.
 */
const QUARTERS_NEED: ModuleId[] = ["accounting"]

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
