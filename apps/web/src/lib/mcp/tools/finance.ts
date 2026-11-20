import { FINANCE_WRITE_TOOLS, registerFinanceReadTools, registerFinanceWriteTools } from "@alter-ego/finance/mcp"

import { getServerDb } from "@/lib/backend/server-db"

import type { McpServer } from "@modelcontextprotocol/server"

export { FINANCE_WRITE_TOOLS }

// The Personal Finance plugin's tools live in its package; these hand them the server's database by a getter,
// read when a tool runs. Two named functions, because the registry reads each register function by name.
export function registerFinanceRead(server: McpServer): void {
  registerFinanceReadTools(server, { db: getServerDb })
}

export function registerFinanceWrite(server: McpServer): void {
  registerFinanceWriteTools(server, { db: getServerDb })
}
