/**
 * The steps that make a plugin whole, as one pure check over plain facts (registry.test.ts). The real
 * facts come from collectFacts(); the tests feed the check a fake plugin that skips one step at a time.
 */
import { existsSync, globSync, readFileSync } from "node:fs"
import path from "node:path"

import { PLUGIN_REGISTERS, REGISTERS, WRITE_TOOL_NAMES } from "@/lib/mcp/plugins"
import { NAV_GROUPS } from "@/lib/nav"
import { MODULES } from "@/modules"

import type { McpServer } from "@modelcontextprotocol/server"

export interface Facts {
  plugins: { id: string; tools: string[]; navGroups: number; hrefs: string[]; registers: string[] }[]
  /** What each register function registers, by the function's name. */
  registered: Record<string, string[]>
  writeTools: string[]
  /** The nav links that have a page. */
  routes: Set<string>
  fragments: { name: string; text: string }[]
  builtRules: string
  indexFiles: { name: string; indexes: unknown[] }[]
  rootIndexes: unknown[]
}

const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))

export function problems(f: Facts): string[] {
  const out: string[] = []
  const names = (r: string) => f.registered[r] ?? []

  for (const p of f.plugins) {
    if (p.navGroups !== 1) out.push(`Plugin "${p.id}" has ${p.navGroups} nav groups in lib/nav.ts; it needs exactly one group with module: "${p.id}".`)
    for (const href of p.hrefs) {
      if (!f.routes.has(href)) out.push(`Plugin "${p.id}" links ${href} in lib/nav.ts, but app/(app)${href}/page.tsx does not exist. Add the page, or remove the link.`)
    }
    const served = new Set(p.registers.flatMap(names))
    for (const t of p.tools) {
      if (!served.has(t)) {
        out.push(`Plugin "${p.id}" lists tool "${t}" in its manifest, but none of its register functions in lib/mcp/plugins.ts registers it. Register it, or take it off the manifest.`)
      }
    }
  }

  for (const [register, tools] of Object.entries(f.registered)) {
    const owners = f.plugins.filter((p) => p.registers.includes(register))
    for (const t of tools) {
      if (!owners.some((p) => p.tools.includes(t))) {
        out.push(`Register function ${register} registers "${t}", but no manifest of a plugin that lists it in lib/mcp/plugins.ts lists that tool. Add it to a manifest, or stop registering it.`)
      }
    }
  }

  const ownersOf = new Map<string, string[]>()
  for (const p of f.plugins) for (const t of p.tools) ownersOf.set(t, [...(ownersOf.get(t) ?? []), p.id])
  for (const [t, ids] of ownersOf) if (ids.length > 1) out.push(`Tool "${t}" is listed by two manifests (${ids.join(", ")}). A tool belongs to exactly one plugin.`)

  const registeredBy = new Map<string, string[]>()
  for (const [r, tools] of Object.entries(f.registered)) for (const t of tools) registeredBy.set(t, [...(registeredBy.get(t) ?? []), r])
  for (const [t, rs] of registeredBy) {
    if (rs.length > 1) out.push(`Tool "${t}" is registered ${rs.length} times (${rs.join(", ")}). Register it once.`)
  }

  for (const t of f.writeTools) {
    if (!ownersOf.has(t)) {
      out.push(`Write tool "${t}" is not owned by any manifest, so it is never served and its scope gate guards nothing. Add it to a manifest, or drop it from the write list.`)
    }
  }

  for (const frag of f.fragments) {
    if (!f.builtRules.includes(frag.text.trim())) {
      out.push(`Rules fragment ${frag.name} is not in firestore.rules. Splice it in (scripts/build-firestore-rules.mjs) and run pnpm rules:build.`)
    }
  }

  const root = new Set(f.rootIndexes.map(canon))
  for (const file of f.indexFiles) {
    for (const index of file.indexes) {
      if (!root.has(canon(index))) out.push(`Index file ${file.name} holds an index that firestore.indexes.json does not: ${JSON.stringify(index)}. Add it to the root file.`)
    }
  }
  return out
}

const repo = (...p: string[]) => path.join("..", "..", ...p)

/**
 * Packages that are copied in but not wired yet: their rules fragments are not spliced into firestore.rules and
 * their index file is not in the root file. Named one by one, never a pattern, so every other package stays
 * checked. Issue 31 wires finance and deletes this list.
 */
export const NOT_YET_WIRED = ["finance"]
const wired = (file: string) => !NOT_YET_WIRED.includes(path.basename(path.dirname(path.dirname(file))))

/** The facts of the repository as it stands. Tests run from apps/web. */
export function collectFacts(): Facts {
  const registered: Record<string, string[]> = {}
  for (const register of REGISTERS) {
    const names: string[] = []
    register({ registerTool: (name: string) => void names.push(name) } as unknown as McpServer)
    registered[register.name] = names
  }
  const groups = (id: string) => NAV_GROUPS.filter((g) => g.module === id)
  const hrefs = (id: string) => groups(id).flatMap((g) => g.items.map((i) => i.href))
  const rulesFiles = [repo("firestore", "crm.rules"), ...globSync(repo("packages", "modules", "*", "src", "*.rules")).filter(wired)]
  return {
    plugins: MODULES.map((m) => ({
      id: m.id,
      tools: m.tools,
      navGroups: groups(m.id).length,
      hrefs: hrefs(m.id),
      registers: PLUGIN_REGISTERS[m.id].map((r) => r.name),
    })),
    registered,
    writeTools: [...WRITE_TOOL_NAMES],
    routes: new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)).filter((h) => existsSync(path.join("src", "app", "(app)", h, "page.tsx")))),
    fragments: rulesFiles.map((file) => ({ name: path.basename(file), text: readFileSync(file, "utf8") })),
    builtRules: readFileSync(repo("firestore.rules"), "utf8"),
    // A module package keeps its own indexes in a src/*.indexes.json file (finance's is src/firestore.indexes.json), same shape as the root file.
    indexFiles: globSync(repo("packages", "modules", "*", "src", "*.indexes.json")).filter(wired).map((file) => ({
      name: path.basename(file),
      indexes: JSON.parse(readFileSync(file, "utf8")).indexes ?? [],
    })),
    rootIndexes: JSON.parse(readFileSync(repo("firestore.indexes.json"), "utf8")).indexes,
  }
}
