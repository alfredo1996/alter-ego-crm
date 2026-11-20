import { readFileSync } from "node:fs"

import { afterEach, describe, expect, it, vi } from "vitest"

import { registerCrmReadTools } from "@/lib/mcp/tools/crm-read"
import { registerCrmWriteTools } from "@/lib/mcp/tools/crm-write"
import { registerRentTools } from "@/lib/mcp/tools/rent"

import { DEFAULT_PLUGINS, allToolNames, enabledToolNames, gateTools, resolveModules } from "../index"

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
  for (const r of [registerCrmReadTools, registerCrmWriteTools, registerRentTools]) r(server)
  return names
}

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
