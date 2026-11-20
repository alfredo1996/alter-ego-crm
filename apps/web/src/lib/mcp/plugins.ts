/**
 * The one list of which register functions serve which plugin. The HTTP route, the stdio server and the
 * tests read it; none of them writes a register call out by hand.
 *
 * Tool names live in each plugin's manifest (`@/modules`), which is plain data the build also reads; this
 * file ties the register functions to those manifests, and a registry test fails when the two disagree.
 * `ping` belongs to no plugin: the route registers it itself.
 *
 * ponytail: crm-read and crm-write register Consulting's and Accounting's tools in one function each, so
 * both plugins list both. They split per plugin with Consulting's later refactor, not here.
 */
import { registerCrmReadTools } from "@/lib/mcp/tools/crm-read"
import { registerCrmWriteTools, WRITE_TOOLS } from "@/lib/mcp/tools/crm-write"
import { RENT_WRITE_TOOLS, registerRentTools } from "@/lib/mcp/tools/rent"

import type { ModuleId } from "@/modules"
import type { McpServer } from "@modelcontextprotocol/server"

export type RegisterTools = (server: McpServer) => void

export const PLUGIN_REGISTERS: Record<ModuleId, RegisterTools[]> = {
  consulting: [registerCrmReadTools, registerCrmWriteTools],
  accounting: [registerCrmReadTools, registerCrmWriteTools],
  rent: [registerRentTools],
}

/** Every register function once, in plugin order. */
export const REGISTERS: RegisterTools[] = [...new Set(Object.values(PLUGIN_REGISTERS).flat())]

/** The tools the HTTP scope gate holds write access for, from every plugin. */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([...WRITE_TOOLS, ...RENT_WRITE_TOOLS])

export function registerAllTools(server: McpServer): void {
  for (const register of REGISTERS) register(server)
}
