/**
 * The connector page of the user guide lists every tool the server registers, in both languages, read off
 * the code: the names from the register calls (and `ping`, which only the HTTP route registers), the scope
 * from WRITE_TOOL_NAMES, the plugin section from the plugin manifests, and "previews first" from a
 * `confirm` input. A tool row is a table line that opens with the name in backticks:
 * `| `get_pipeline` | read | ... |`. The area pages' "Tools:" lines may name only tools that exist.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { REGISTERS, WRITE_TOOL_NAMES } from "@/lib/mcp/plugins"
import { MODULES } from "@/modules"

import type { McpServer } from "@modelcontextprotocol/server"

type Config = { inputSchema?: { shape?: Record<string, unknown> } }
const registered = new Map<string, Config>()
const capture = { registerTool: (name: string, config: Config) => void registered.set(name, config) } as unknown as McpServer
for (const register of REGISTERS) register(capture)

// `ping` is registered inline by the HTTP route, which is server-only code (auth, mcp-handler) a unit test
// should not import; so read its name off the route's source. stdio never serves it.
const routeSource = readFileSync(path.join(__dirname, "../../../app/api/mcp/route.ts"), "utf8")
const routeTools = [...routeSource.matchAll(/\.registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1])
for (const name of routeTools) registered.set(name, {})

const guide = (lang: string, file: string) =>
  readFileSync(path.join(__dirname, "../../../../../../content/docs", lang, "guide", file), "utf8")

const WORDS = { en: { read: "read", write: "write", preview: "previews first" }, it: { read: "lettura", write: "scrittura", preview: "anteprima" } }
const labels = new Set(MODULES.map((m) => m.label))

/** Rows of the page: the tool, its section (a plugin label, or "" for the section before them), the scope cell and the line. */
function rowsOf(text: string) {
  let section = ""
  const rows: { name: string; section: string; scope: string; line: string }[] = []
  for (const line of text.split("\n")) {
    const h = line.match(/^### (.+)$/)
    if (h) section = labels.has(h[1]) ? h[1] : ""
    const m = line.match(/^\| `([a-z_]+)` \| ([^|]+) \|/)
    if (m) rows.push({ name: m[1], section, scope: m[2].trim(), line })
  }
  return rows
}

describe.each(["en", "it"] as const)("guide/connector.mdx (%s)", (lang) => {
  const rows = rowsOf(guide(lang, "connector.mdx"))
  const listed = new Set(rows.map((r) => r.name))
  const words = WORDS[lang]

  it("has a row for every registered tool", () => {
    expect([...registered.keys()].filter((t) => !listed.has(t)).sort()).toEqual([])
  })

  it("has no row for a tool that no longer exists", () => {
    expect([...listed].filter((t) => !registered.has(t)).sort()).toEqual([])
  })

  it("marks write tools as write and every other tool as read", () => {
    const wrong = rows.filter((r) => r.scope !== (WRITE_TOOL_NAMES.has(r.name) ? words.write : words.read)).map((r) => r.name)
    expect(wrong.sort()).toEqual([])
  })

  it("files each tool under its plugin, and the route's own tools under the shared section", () => {
    const expected = (name: string) => MODULES.find((m) => m.tools.includes(name))?.label ?? ""
    const wrong = rows.filter((r) => r.section !== (routeTools.includes(r.name) ? "" : expected(r.name))).map((r) => r.name)
    expect(wrong.sort()).toEqual([])
  })

  it("says previews first on exactly the tools that take a confirm input", () => {
    const previews = (name: string) => registered.get(name)?.inputSchema?.shape?.confirm !== undefined
    const wrong = rows.filter((r) => r.line.includes(words.preview) !== previews(r.name)).map((r) => r.name)
    expect(wrong.sort()).toEqual([])
  })
})

describe.each(["en", "it"] as const)("area pages' Tools lines (%s)", (lang) => {
  it("name only registered tools", () => {
    const stale: string[] = []
    for (const file of ["crm", "plan", "invoicing", "books", "solutions", "rent"]) {
      for (const line of guide(lang, `${file}.mdx`).split("\n")) {
        if (!/^(Tools|Strumenti):/.test(line)) continue
        for (const m of line.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) if (!registered.has(m[1])) stale.push(`${file}: ${m[1]}`)
      }
    }
    expect(stale).toEqual([])
  })
})
