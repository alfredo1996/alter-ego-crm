/**
 * The connector page of the user guide lists every tool the server registers, in both languages. The list
 * is read off the register calls, so a tool added without a row, or a row left behind by a removed tool,
 * fails here. A tool row is a table line that opens with the name in backticks: `| `get_pipeline` | ... |`.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { REGISTERS } from "@/lib/mcp/plugins"

import type { McpServer } from "@modelcontextprotocol/server"

const registered = new Set<string>(["ping"]) // `ping` belongs to no plugin: the route registers it itself
const capture = { registerTool: (name: string) => void registered.add(name) } as unknown as McpServer
for (const register of REGISTERS) register(capture)

const page = (lang: string) => readFileSync(path.join(__dirname, "../../../../../../content/docs", lang, "guide/connector.mdx"), "utf8")
const rowsOf = (text: string) => new Set([...text.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]))

describe.each(["en", "it"])("guide/connector.mdx (%s)", (lang) => {
  const listed = rowsOf(page(lang))

  it("has a row for every registered tool", () => {
    expect([...registered].filter((t) => !listed.has(t)).sort()).toEqual([])
  })

  it("has no row for a tool that no longer exists", () => {
    expect([...listed].filter((t) => !registered.has(t)).sort()).toEqual([])
  })
})
