import { isoDate } from "@alter-ego/kernel/dates"
import { RENT_WRITE_TOOL_NAMES, rentTools } from "@alter-ego/rent/tools"

import { getServerDb } from "@/lib/backend/server-db"
import { toolError, userIdOf } from "@/lib/mcp/tools/context"
import { ok, ToolInputError } from "@/lib/mcp/tools/helpers"
import { z } from "@/lib/zod"

import type { McpServer } from "@modelcontextprotocol/server"

/** Names the HTTP-layer scope gate requires the write scope for. */
export const RENT_WRITE_TOOLS = new Set(RENT_WRITE_TOOL_NAMES)

/**
 * The Rent module's tools live in its package as data; this registers them. Audited like
 * crm-read and crm-write audit theirs: writes only, an edit's preview marked so.
 */
export function registerRentTools(server: McpServer): void {
  const refuse = (message: string): never => {
    throw new ToolInputError(message)
  }
  for (const t of rentTools) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: z.object(t.input) },
      async (input: Record<string, unknown>, ctx: { http?: { authInfo?: { clientId?: string; extra?: Record<string, unknown> } } }) => {
        const userId = userIdOf(ctx)
        const db = getServerDb()
        const marked = t.edits && !input.confirm ? { preview: true } : {}
        const clientId = ctx.http?.authInfo?.clientId ?? "unknown"
        const audit = (entry: object) => {
          if (t.write) void db.addAuditEntry(userId, { tool: t.name, params: input, clientId, ...marked, ...entry } as never).catch((e) => console.error("mcp_audit write failed:", e))
        }
        try {
          const { payload, documentIds } = await t.run(input as never, { db, userId, today: isoDate(new Date()), refuse })
          audit({ result: "ok", documentIds })
          return ok(payload)
        } catch (e) {
          audit({ result: "error", errorMessage: e instanceof ToolInputError ? e.message : String(e) })
          return toolError(e)
        }
      },
    )
  }
}
