import { readFileSync } from "node:fs"

import { RENT_WRITE_TOOL_NAMES } from "@alter-ego/rent/tools"
import { afterEach, describe, expect, it, vi } from "vitest"


import { PLUGIN_REGISTERS, WRITE_TOOL_NAMES, registerAllTools } from "@/lib/mcp/plugins"
import { registerCrmWriteTools } from "@/lib/mcp/tools/crm-write"

import { collectFacts, problems, type Facts } from "./plugin-checks"
import { DEFAULT_PLUGINS, MODULES, allToolNames, enabledToolNames, gateTools, resolveModules } from "../index"

import type { ModuleId } from "../index"
import type { McpServer } from "@modelcontextprotocol/server"

const on = (plugins?: string) => [...resolveModules(plugins).enabled].sort()

describe("selection", () => {
  it.each([
    [undefined, ["accounting", "consulting", "rent"]],
    ["", ["accounting", "consulting", "rent"]],
    ["consulting", ["consulting"]],
    ["consulting,accounting", ["accounting", "consulting"]],
    [" Consulting , ACCOUNTING , rent ", ["accounting", "consulting", "rent"]],
    ["rent,accounting,consulting,rent", ["accounting", "consulting", "rent"]],
  ] as const)("listing %j runs %j", (plugins, expected) => {
    expect(on(plugins)).toEqual(expected)
  })

  it("names what the deployment runs, for Settings, in the registry's order", () => {
    expect(resolveModules(undefined).selection).toEqual({ variable: "NEXT_PUBLIC_PLUGINS", value: "consulting,accounting,rent" })
    expect(resolveModules(" Accounting,consulting ").selection).toEqual({ variable: "NEXT_PUBLIC_PLUGINS", value: "consulting,accounting" })
  })

  it("rejects an id it does not know", () => {
    expect(() => resolveModules("consulting,billing")).toThrow(
      'Unknown plugin "billing" in NEXT_PUBLIC_PLUGINS. The plugins are: consulting, accounting, rent.',
    )
  })

  it.each(["", "crm", "consulting,accounting"])("fails when the old variable is defined at all: %j", (old) => {
    expect(() => resolveModules("consulting", old)).toThrow(
      "NEXT_PUBLIC_DISABLED_MODULES is no longer read. Remove it and list the plugins to run in NEXT_PUBLIC_PLUGINS, for example NEXT_PUBLIC_PLUGINS=consulting,accounting,rent.",
    )
  })
})

describe("requirements", () => {
  it("names the missing plugin and the way out", () => {
    expect(() => resolveModules("accounting")).toThrow(
      "Accounting needs Consulting, but NEXT_PUBLIC_PLUGINS does not list Consulting. List Consulting, or leave Accounting out too.",
    )
  })

  it("checks rent against accounting", () => {
    expect(() => resolveModules("consulting,rent")).toThrow("Rent needs Accounting, but NEXT_PUBLIC_PLUGINS does not list Accounting.")
  })
})

describe("isModuleOn", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it.each([
    ["consulting", [true, false, false]],
    ["consulting,accounting", [true, true, false]],
    ["consulting,accounting,rent", [true, true, true]],
  ] as const)("answers per id from the selection %j", async (plugins, expected) => {
    vi.stubEnv("NEXT_PUBLIC_PLUGINS", plugins)
    vi.resetModules()
    const { isModuleOn } = await import("../index")
    expect((["consulting", "accounting", "rent"] as ModuleId[]).map((id) => isModuleOn(id))).toEqual(expected)
  })
})

describe("the default", () => {
  it("is the three plugins that exist today, so a plugin added later stays off until it is listed", () => {
    expect(DEFAULT_PLUGINS).toEqual(["consulting", "accounting", "rent"])
  })
})

/** Every tool the two servers register, by name. */
function registered(): string[] {
  const names: string[] = []
  const server = { registerTool: (name: string) => void names.push(name) } as unknown as McpServer
  registerAllTools(server)
  return names
}

describe("one tool list", () => {
  it("has an entry for every plugin the registry knows, and no other", () => {
    expect(Object.keys(PLUGIN_REGISTERS).sort()).toEqual(MODULES.map((m) => m.id).sort())
  })

  // The scope gate reads WRITE_TOOL_NAMES alone: a write tool missing from it would answer a read-only token.
  // Checked against the write tools each side declares itself, not against the union plugins.ts builds.
  it("holds every write tool a plugin registers", () => {
    const names: string[] = []
    registerCrmWriteTools({ registerTool: (name: string) => void names.push(name) } as unknown as McpServer)
    expect([...names, ...RENT_WRITE_TOOL_NAMES].filter((t) => !WRITE_TOOL_NAMES.has(t))).toEqual([])
  })

  // The route and the stdio server once each wrote the register calls out by hand.
  it.each(["src/app/api/mcp/route.ts", "scripts/mcp-stdio.ts"])("%s names no register function: it reads lib/mcp/plugins", (file) => {
    const source = readFileSync(file, "utf8")
    expect(source.match(/register[A-Z]\w*Tools/g)?.filter((n) => n !== "registerAllTools") ?? []).toEqual([])
    expect(source).toContain("@/lib/mcp/plugins")
    // The module gate lives inside registerAllTools, so a caller cannot skip it.
    expect(source).not.toContain("gateTools")
  })
})

describe("tools", () => {
  it("assigns every registered tool to exactly one module", () => {
    expect(allToolNames().sort()).toEqual(registered().sort())
  })

  it("serves only the enabled modules' tools", () => {
    const names = enabledToolNames(resolveModules("consulting").enabled)
    expect(names.has("create_client")).toBe(true)
    expect(names.has("list_solutions")).toBe(true)
    expect(
      ["list_invoices", "create_invoice", "get_cash_book", "add_expense", "get_quarters", "get_rent", "create_lease"].filter((t) => names.has(t)),
    ).toEqual([])
  })

  it("gateTools drops a tool outside the allowed set and passes the rest through", () => {
    const names: string[] = []
    const gated = gateTools({ registerTool: (name: string) => void names.push(name), other: () => "kept" }, new Set(["a"]))
    gated.registerTool("a")
    gated.registerTool("b")
    expect(names).toEqual(["a"])
    expect(gated.other()).toBe("kept")
  })
})

describe("module manifests are plain data", () => {
  // A module package's manifest is the one file of it the registry may import.
  it("rent's manifest imports only the kernel's contract", () => {
    const specs = [...readFileSync("../../packages/modules/rent/src/manifest.ts", "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
    expect(specs).toEqual(["@alter-ego/kernel/module"])
  })

  const externals: Record<string, string[]> = {
    index: ["@/lib/env", "@alter-ego/kernel/module"],
    resolve: ["@alter-ego/kernel/module", "@alter-ego/rent/manifest"],
  }
  it.each(["index", "resolve", "consulting/manifest", "accounting/manifest"])(
    "%s imports only other module files",
    (file) => {
      const specs = [...readFileSync(`src/modules/${file}.ts`, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
      expect([...new Set(specs.filter((s) => !s.startsWith(".")))].sort()).toEqual(externals[file] ?? ["@alter-ego/kernel/module"])
    },
  )
})

// A plugin is wired when every step below is done. Each check is proven on a fake plugin that skips just that step.
describe("a plugin is wired end to end", () => {
  const good = (): Facts => ({
    plugins: [
      { id: "alpha", tools: ["a_read", "a_write"], navGroups: 1, hrefs: ["/alpha"], registers: ["registerAlpha"] },
      { id: "beta", tools: ["b_read"], navGroups: 1, hrefs: ["/beta", "/beta/more"], registers: ["registerAlpha", "registerBeta"] },
    ],
    registered: { registerAlpha: ["a_read", "a_write"], registerBeta: ["b_read"] },
    writeTools: ["a_write"],
    routes: new Set(["/alpha", "/beta", "/beta/more"]),
    fragments: [{ name: "alpha.rules", text: "match /alpha/{id}" }],
    builtRules: "rules { match /alpha/{id} }",
    indexFiles: [{ name: "alpha.indexes.json", indexes: [{ collectionGroup: "alpha", fields: ["x"] }] }],
    rootIndexes: [{ collectionGroup: "alpha", fields: ["x"] }, { collectionGroup: "other", fields: ["y"] }],
  })
  const broken = (change: (f: Facts) => void): string[] => {
    const f = good()
    change(f)
    return problems(f)
  }

  it("finds nothing wrong with a fully wired plugin", () => {
    expect(problems(good())).toEqual([])
  })

  it.each([
    ["no nav group", (f: Facts) => (f.plugins[0].navGroups = 0), 'Plugin "alpha" has 0 nav groups in lib/nav.ts; it needs exactly one group with module: "alpha".'],
    ["two nav groups", (f: Facts) => (f.plugins[1].navGroups = 2), 'Plugin "beta" has 2 nav groups in lib/nav.ts; it needs exactly one group with module: "beta".'],
    [
      "a link without a page",
      (f: Facts) => f.plugins[1].hrefs.push("/beta/ghost"),
      'Plugin "beta" links /beta/ghost in lib/nav.ts, but app/(app)/beta/ghost/page.tsx does not exist. Add the page, or remove the link.',
    ],
    [
      "a manifest tool no register function registers",
      (f: Facts) => f.plugins[0].tools.push("a_ghost"),
      'Plugin "alpha" lists tool "a_ghost" in its manifest, but none of its register functions in lib/mcp/plugins.ts registers it. Register it, or take it off the manifest.',
    ],
    [
      "a registered tool no manifest lists",
      (f: Facts) => f.registered.registerBeta.push("b_stray"),
      'Register function registerBeta registers "b_stray", but no manifest of a plugin that lists it in lib/mcp/plugins.ts lists that tool. Add it to a manifest, or stop registering it.',
    ],
    [
      "a tool owned twice",
      (f: Facts) => f.plugins[1].tools.push("a_read"),
      'Tool "a_read" is listed by two manifests (alpha, beta). A tool belongs to exactly one plugin.',
    ],
    [
      "a tool registered twice",
      (f: Facts) => f.registered.registerAlpha.push("a_read"),
      'Tool "a_read" is registered 2 times (registerAlpha, registerAlpha). Register it once.',
    ],
    [
      "a write tool no manifest owns",
      (f: Facts) => f.writeTools.push("orphan_write"),
      'Write tool "orphan_write" is not owned by any manifest, so it is never served and its scope gate guards nothing. Add it to a manifest, or drop it from the write list.',
    ],
    [
      "a rules fragment not spliced in",
      (f: Facts) => f.fragments.push({ name: "beta.rules", text: "match /beta/{id}" }),
      "Rules fragment beta.rules is not in firestore.rules. Splice it in (scripts/build-firestore-rules.mjs) and run pnpm rules:build.",
    ],
    [
      "an index not in the root file",
      (f: Facts) => f.indexFiles[0].indexes.push({ collectionGroup: "beta", fields: ["z"] }),
      'Index file alpha.indexes.json holds an index that firestore.indexes.json does not: {"collectionGroup":"beta","fields":["z"]}. Add it to the root file.',
    ],
  ])("fails, naming the missing step, for %s", (_name, change, message) => {
    expect(broken(change)).toEqual([message])
  })

  it("holds for the real plugins", () => {
    expect(problems(collectFacts())).toEqual([])
  })
})
