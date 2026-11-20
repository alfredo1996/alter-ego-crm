import { describe, expect, it } from "vitest"

import { FINANCE_WRITE_TOOLS, registerFinanceReadTools, registerFinanceWriteTools } from "../index"

import type { McpServer } from "@modelcontextprotocol/server"

function toolNames(register: (server: McpServer, opts: { db: () => never }) => void): string[] {
  const names: string[] = []
  const server = { registerTool: (name: string) => void names.push(name) } as unknown as McpServer
  register(server, { db: () => { throw new Error("the db is read only when a tool runs") } })
  return names
}

describe("the finance MCP tools", () => {
  it("registers the read tools under their names", () => {
    expect(toolNames(registerFinanceReadTools)).toEqual([
      "list_categories",
      "list_accounts",
      "list_tags",
      "list_transactions",
      "get_spending",
      "get_budget_status",
    ])
  })

  it("registers the write tools under their names, and the scope gate holds exactly those", () => {
    const written = toolNames(registerFinanceWriteTools)
    expect(written).toEqual(["add_transaction", "update_transaction", "delete_transaction", "create_account", "archive_account"])
    expect([...FINANCE_WRITE_TOOLS]).toEqual(written)
  })
})
