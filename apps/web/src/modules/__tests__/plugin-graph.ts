/**
 * What the import ratchet (plugin-boundary.test.ts) is built from: which plugin a file belongs to, which
 * files it imports, and the edge each import across plugins makes. Plain node and regexes, no dependency.
 *
 * Test files are neither scanned nor a target. A test may build another plugin's fixtures, and its
 * `vi.mock` / `vi.importActual` specifiers are strings in a call, which no import form below matches: a
 * mock of a cross-plugin module is not a coupling of the shipped code.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

export type Plugin = "consulting" | "accounting" | "rent" | "host"

/**
 * First match wins; a file no rule names is host (the shared app: backend, types, UI shell, settings).
 * A folder is mapped whole where it belongs to one side; the exceptions come first, one by one.
 * crm-read.ts and crm-write.ts register both Consulting's and Accounting's tools in one file, so they stay
 * host until they split per plugin.
 */
const PATH_MAP: [RegExp, Plugin][] = [
  [/^app\/\(app\)\/(pipeline|clients|contracts|collaborators|solutions|tasks|plan|deadlines)\//, "consulting"],
  [/^app\/\(app\)\/(invoices|cash-book|costs|month-end)\//, "accounting"],
  [/^app\/\(app\)\/rent\//, "rent"],
  // The Costs and Invoices file viewers, and the MCP tool module for invoice files.
  [/^app\/\(viewer\)\/(costs|invoices)\//, "accounting"],
  [/^lib\/mcp\/tools\/invoice-files\.ts$/, "accounting"],
  // The invoice screens that sit in the Consulting folder today.
  [/^components\/crm\/(billing-shell|invoice-sheet|invoice-table)\.tsx$/, "accounting"],
  [/^components\/(crm|plan|deadlines)\//, "consulting"],
  [/^components\/(cash-book|company-expenses|company-files|month-end)\//, "accounting"],
  [/^components\/rent\//, "rent"],
  [
    /^hooks\/use-(allocations|assignments|capacity|clients|collaborators|company-deadlines|engagements|journal|meetings|opportunities|solutions|tasks|timecards)\./,
    "consulting",
  ],
  [/^hooks\/use-(company-accounts|company-expenses|company-files|company-loans|company-movements|invoices)\./, "accounting"],
  [/^hooks\/use-leases\./, "rent"],
  [
    /^lib\/(assignment-plan|assignments|capacity|collaborator-invoices|collaborators|company-calendar|contract-timeline|engagement-burndown|engagements|meetings|opportunities|projection|quarters|runway|solution-graph|solution-journal|solutions|tasks|timecards)\.ts$/,
    "consulting",
  ],
  [
    /^lib\/(accountant-package|cash-book|cash-book-recurring|cash-flow-summary|fattura-pa|invoice-files|invoice-files-zip|invoices|month-end|prima-nota)\.ts$/,
    "accounting",
  ],
  [/^lib\/mcp\/tools\/rent\.ts$/, "rent"],
]

export const RULE =
  "A plugin imports no other plugin's files. Move what both need into the host (shared lib, hooks, types), or go through the host; " +
  "do not add the edge to KNOWN_EDGES, which was seeded once and only ever shrinks."

export function isTestFile(rel: string): boolean {
  return /(^|\/)__tests__\//.test(rel) || /\.test\.tsx?$/.test(rel)
}

/** The plugin a file under apps/web/src belongs to (`rel` is relative to it, with forward slashes). */
export function pluginOf(rel: string): Plugin {
  return PATH_MAP.find(([re]) => re.test(rel))?.[1] ?? "host"
}

const FROM = String.raw`from\s*["']([^"']+)["']`
// A statement starts at a line start or after a `;`, so `a(); import x from "y"` is read too.
const START = String.raw`(?:^|;)[ \t]*`
const FORMS = [
  // import a from "x" · import type { A } from "x" · import * as a from "x" · import a, { b } from "x"
  new RegExp(String.raw`${START}import\b(?:[ \t]+type\b)?[^"'` + "`" + String.raw`;]*?\b${FROM}`, "gm"),
  // export * from "x" · export * as a from "x" · export { a } from "x" · export type { A } from "x"
  new RegExp(String.raw`${START}export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*${FROM}`, "gm"),
  // import "x"
  new RegExp(String.raw`${START}import\s*["']([^"']+)["']`, "gm"),
  // import("x"), import ("x"), a plain template literal, anywhere; import a = require("x"); require("x")
  /\b(?:import|require)\s*\(\s*["'`]([^"'`$]+)["'`]\s*\)/g,
]

/** Every module specifier a source file imports, in any form; comments are ignored. */
export function specifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\w])\/\/.*$/gm, "$1")
  return [...new Set(FORMS.flatMap((re) => [...code.matchAll(re)].map((m) => m[1])))]
}

const RENT_PACKAGE = /^@alter-ego\/rent(\/|$)/

/**
 * The file a specifier points at: relative to src for `@/` and relative paths, the specifier itself for
 * the Rent package, null for anything else (node_modules, the other workspace packages).
 */
export function resolveSpec(spec: string, fromRel: string, exists: (rel: string) => boolean): string | null {
  if (RENT_PACKAGE.test(spec)) return spec
  const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? path.posix.join(path.posix.dirname(fromRel), spec) : null
  if (base === null) return null
  const hit = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => exists(c))
  if (!hit) throw new Error(`${fromRel}: cannot resolve "${spec}" to a file under apps/web/src`)
  return hit
}

/** `from-plugin:file -> to-plugin:file` for each import that crosses from one plugin into another; host on either side makes none. */
export function crossEdges(files: Record<string, string>, exists: (rel: string) => boolean = (r) => r in files): string[] {
  const edges = new Set<string>()
  for (const [rel, source] of Object.entries(files)) {
    const from = pluginOf(rel)
    if (from === "host" || isTestFile(rel)) continue
    for (const spec of specifiers(source)) {
      const target = resolveSpec(spec, rel, exists)
      if (target === null || isTestFile(target)) continue
      const to = RENT_PACKAGE.test(target) ? "rent" : pluginOf(target)
      if (to !== "host" && to !== from) edges.add(`${from}:${rel} -> ${to}:${target}`)
    }
  }
  return [...edges].sort()
}

export function diffEdges(found: string[], known: string[]): { added: string[]; gone: string[] } {
  return { added: found.filter((e) => !known.includes(e)), gone: known.filter((e) => !found.includes(e)) }
}

/** The app's source files, by path under src, read from disk. The tests run from apps/web. */
export function readSource(root = "src"): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(rel)
      else if (/\.(ts|tsx)$/.test(rel) && !isTestFile(rel)) out[rel] = readFileSync(path.join(root, rel), "utf8")
    }
  }
  walk("")
  return out
}

export function existsInSrc(rel: string, root = "src"): boolean {
  try {
    return statSync(path.join(root, rel)).isFile()
  } catch {
    return false
  }
}
