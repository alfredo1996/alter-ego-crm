/**
 * Guards over the registered company tools: the HTTP scope gate knows every write
 * tool, the README count is true, the descriptions keep the owner's rules, and
 * the module registry serves the right tools per module set.
 */
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { registerCrmReadTools } from "@/lib/mcp/tools/crm-read"
import { registerCrmWriteTools, WRITE_TOOLS } from "@/lib/mcp/tools/crm-write"
import { RENT_WRITE_TOOLS, registerRentTools } from "@/lib/mcp/tools/rent"
import { enabledToolNames, gateTools, resolveModules } from "@/modules"

import type { McpServer } from "@modelcontextprotocol/server"

/** Records tool names instead of serving them. */
function collect(register: (server: McpServer) => void): string[] {
  const names: string[] = []
  register({ registerTool: (name: string) => void names.push(name) } as unknown as McpServer)
  return names.sort()
}

/** Each tool's description, by name. */
function descriptions(...registers: ((server: McpServer) => void)[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const register of registers) {
    register({ registerTool: (name: string, config: { description: string }) => void (out[name] = config.description) } as unknown as McpServer)
  }
  return out
}

const crmRead = collect(registerCrmReadTools)
const crmWrite = collect(registerCrmWriteTools)
const rentTools = collect(registerRentTools)

describe("tool module registrations", () => {
  it("registers every tool exactly once", () => {
    const all = [...crmRead, ...crmWrite, ...rentTools]
    expect(new Set(all).size).toBe(all.length)
  })

  // The HTTP scope gate reads these sets rather than the registry, so a write
  // tool missing from them would answer a read-only token.
  it("declares every registered write tool to the scope gate", () => {
    expect(crmWrite.filter((t) => !WRITE_TOOLS.has(t))).toEqual([])
    expect(rentTools.filter((t) => ["create_tenant", "update_tenant", "create_lease", "update_lease"].includes(t) !== RENT_WRITE_TOOLS.has(t))).toEqual([])
    expect([...RENT_WRITE_TOOLS].sort()).toEqual(["create_lease", "create_tenant", "update_lease", "update_tenant"])
  })

  it("claims no write tool it does not register", () => {
    expect([...WRITE_TOOLS].filter((t) => !crmWrite.includes(t))).toEqual([])
  })

  // The README's count went stale once: it is checked here now. ping is not counted.
  it("the README counts every tool served, ping excluded", () => {
    expect(crmRead.length + crmWrite.length + rentTools.length).toBe(68)
    expect(readFileSync("../../README.md", "utf8")).toContain("- 68 tools over the company data")
  })
})

describe("tool descriptions keep the owner's rules", () => {
  const crm = descriptions(registerCrmReadTools, registerCrmWriteTools)
  const EDITS = ["update_invoice", "delete_invoice", "update_movement", "delete_movement", "update_expense", "delete_expense", "update_loan", "delete_loan"]

  it.each(["get_cash_book", "add_movement", "add_expense", "record_loan", "check_balance", "mark_invoice_paid", ...EDITS])(
    "%s says company (SRL) account, with at most three owner phrasings",
    (tool) => {
      expect(crm[tool]).toMatch(/company \(SRL\)/)
      // The cash book's one gloss, «prima nota», besides the phrasings.
      expect((crm[tool].match(/«/g) ?? []).length - (crm[tool].includes("«prima nota»") ? 1 : 0)).toBeLessThanOrEqual(3)
    },
  )

  // The owner's rule (2026-10-10): every delete and edit by chat is previewed, then confirmed.
  it.each(EDITS)("%s says preview, then confirm", (tool) => {
    expect(crm[tool]).toContain("Preview, then confirm")
    expect(crm[tool]).toContain("confirm: true")
  })

  // A month's close is get_month_end, never get_plan.
  it("list_deadlines sends a month's close to get_month_end, never to get_plan", () => {
    expect(crm.list_deadlines).not.toContain("get_plan")
    expect(crm.list_deadlines).toContain("get_month_end")
  })

  it("get_month_end is about a month, never a contract, with three owner phrasings", () => {
    expect(crm.get_month_end).toContain("never a contract: closing a contract is update_engagement")
    expect(crm.get_month_end.match(/«/g)).toHaveLength(3)
  })

  // "Closed" is the Month End verdict only: a month that has ended is "ended".
  it("no description calls a month that has ended closed", () => {
    expect(Object.keys(crm).filter((tool) => /closed months?\b/.test(crm[tool]))).toEqual([])
  })
})

// tools/list per module set: the registry's gate over the real registrations.
describe("tools served per module set", () => {
  const served = (disabled: string): string[] => {
    const names: string[] = []
    const gated = gateTools({ registerTool: (name: string) => void names.push(name) }, enabledToolNames(resolveModules(disabled).enabled))
    for (const register of [registerCrmReadTools, registerCrmWriteTools, registerRentTools]) {
      register(gated as unknown as McpServer)
    }
    return names.sort()
  }

  it("serves every tool when nothing is switched off", () => {
    expect(served("")).toEqual([...crmRead, ...crmWrite, ...rentTools].sort())
  })

  it("leaves out the invoice tools, get_quarters and the solution tools without invoicing and solutions", () => {
    const names = new Set(served("invoicing,solutions"))
    expect(["list_invoices", "get_unbilled", "create_invoice", "mark_invoice_paid", "update_invoice", "delete_invoice", "attach_file", "remove_file", "get_file", "list_solutions", "get_solution", "create_solution", "update_solution", "log_work"].filter((t) => names.has(t))).toEqual([])
    expect(names.size).toBe(crmRead.length + crmWrite.length + rentTools.length - 15)
  })

  // Quarters reads ended months off invoices and costs: without either every quarter would say €0.
  it.each([["invoicing"], ["books,rent"], ["invoicing,books,rent"]])("leaves out get_quarters when %s is off", (disabled) => {
    expect(served(disabled)).not.toContain("get_quarters")
  })

  it("serves get_quarters when invoicing and books are both on", () => {
    expect(served("solutions")).toContain("get_quarters")
  })

  it("leaves out the cash tools without books", () => {
    const names = new Set(served("books,rent"))
    expect(["get_cash_book", "get_month_end", "add_movement", "add_expense", "record_loan", "check_balance"].filter((t) => names.has(t))).toEqual([])
    expect(names.has("list_invoices")).toBe(true)
  })

  it("leaves out the rent tools when rent is off, and keeps the other company tools", () => {
    const names = new Set(served("rent"))
    expect(rentTools.filter((t) => names.has(t))).toEqual([])
    expect(names.has("add_movement")).toBe(true)
  })

  it("keeps the rent descriptions to names and at most three owner phrasings; only get_tenant speaks of a tax ID", () => {
    const rent = descriptions(registerRentTools)
    for (const [tool, text] of Object.entries(rent)) expect((text.match(/«/g) ?? []).length, tool).toBeLessThanOrEqual(3)
    expect(rent.get_rent).toContain("no tax ID and no address")
    expect(rent.get_tenant).toContain("The only tool that returns a tax ID or an address")
    for (const t of ["update_tenant", "update_lease"]) expect(rent[t]).toContain("confirm: true")
  })
})
