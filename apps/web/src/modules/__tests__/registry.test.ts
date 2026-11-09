import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { registerCrmReadTools } from "@/lib/mcp/tools/crm-read"
import { registerCrmWriteTools } from "@/lib/mcp/tools/crm-write"
import { registerRentTools } from "@/lib/mcp/tools/rent"

import { allToolNames, enabledToolNames, gateTools, resolveModules } from "../index"

import type { McpServer } from "@modelcontextprotocol/server"

const on = (disabled = "") => [...resolveModules(disabled).enabled].sort()

describe("presets", () => {
  it.each([
    ["", ["books", "crm", "invoicing", "rent", "solutions"]],
    ["invoicing,solutions", ["books", "crm", "rent"]],
    [" Invoicing , rent ", ["books", "crm", "solutions"]],
    ["books,rent", ["crm", "invoicing", "solutions"]],
    ["rent", ["books", "crm", "invoicing", "solutions"]],
  ] as const)("disabling %j runs %j", (disabled, expected) => {
    expect(on(disabled)).toEqual(expected)
  })

  it("names what a deployment left out, for Settings", () => {
    expect(resolveModules("").leftOut).toEqual({ variable: "NEXT_PUBLIC_DISABLED_MODULES", value: "none" })
    expect(resolveModules(" Rent,solutions ").leftOut).toEqual({ variable: "NEXT_PUBLIC_DISABLED_MODULES", value: "rent,solutions" })
  })
})

describe("dependencies", () => {
  it("names the missing module and the way out", () => {
    expect(() => resolveModules("crm")).toThrow(
      "Invoicing needs CRM, but NEXT_PUBLIC_DISABLED_MODULES leaves CRM out. Turn CRM back on, or leave Invoicing out too.",
    )
  })

  it("lets a module go with its dependency", () => {
    expect(on("crm,invoicing,solutions")).toEqual(["books", "rent"])
  })

  it("checks rent against books", () => {
    expect(() => resolveModules("books")).toThrow("Rent needs Books, but NEXT_PUBLIC_DISABLED_MODULES leaves Books out.")
  })

  it("rejects an id it does not know", () => {
    expect(() => resolveModules("billing")).toThrow('Unknown module "billing" in NEXT_PUBLIC_DISABLED_MODULES.')
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
    const names = enabledToolNames(resolveModules("invoicing,solutions").enabled)
    expect(names.has("get_cash_book")).toBe(true)
    expect(names.has("create_client")).toBe(true)
    expect(["list_invoices", "create_invoice", "list_solutions", "update_solution"].filter((t) => names.has(t))).toEqual([])
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

  it.each(["index", "crm/manifest", "invoicing/manifest", "books/manifest", "solutions/manifest"])(
    "%s imports only other module files",
    (file) => {
      const specs = [...readFileSync(`src/modules/${file}.ts`, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
      expect([...new Set(specs.filter((s) => !s.startsWith(".")))].sort()).toEqual(file === "index" ? ["@/lib/env", "@alter-ego/kernel/module", "@alter-ego/rent/manifest"] : ["@alter-ego/kernel/module"])
    },
  )
})
