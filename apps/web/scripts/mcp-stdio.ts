/**
 * The MCP server over stdio, for a client that spawns it as a subprocess —
 * Claude Desktop, or any local model that speaks MCP.
 *
 * Same tools as the HTTP route, registered from the same modules. What it drops
 * is everything that exists to authenticate a remote caller: no OAuth, no bearer
 * token, no scope gate. Over stdio the client already owns this process, so the
 * process boundary is the trust boundary, and a scope check against a token
 * nobody issued would be theatre.
 *
 * Identity comes from ALTER_EGO_USER_ID. Point NEXT_PUBLIC_BACKEND and the
 * Firebase variables at the same store the app uses — see docs/SELF-HOSTING.md.
 *
 *   ALTER_EGO_USER_ID=<uid> pnpm mcp:stdio
 */
import { pinServerTimeZone } from "@alter-ego/kernel/dates"
import { McpServer } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"

import { MCP_VERSION } from "@/lib/mcp/config"
import { STDIO_USER_ID_ENV } from "@/lib/mcp/tools/context"
import { registerCrmReadTools } from "@/lib/mcp/tools/crm-read"
import { registerCrmWriteTools } from "@/lib/mcp/tools/crm-write"
import { registerRentTools } from "@/lib/mcp/tools/rent"
import { gateTools } from "@/modules"


pinServerTimeZone()

// Fail at startup rather than on the first tool call: a client that spawned us
// without it would otherwise look connected and error on everything.
if (!process.env[STDIO_USER_ID_ENV]) {
  console.error(
    `${STDIO_USER_ID_ENV} is not set. It names the user whose ledger this server ` +
      `reads and writes; there is no request to infer it from over stdio.`
  )
  process.exit(1)
}

// stdout is the transport. Anything written to it that is not a JSON-RPC message
// corrupts the stream, so diagnostics go to stderr — including from libraries.
console.log = console.error

serveStdio(() => {
  const server = new McpServer(
    { name: "alter-ego", version: MCP_VERSION },
    { capabilities: { tools: {} } }
  )

  // Same gate as the HTTP route: the module registry.
  const gated = gateTools(server)
  registerCrmReadTools(gated)
  registerCrmWriteTools(gated)
  registerRentTools(gated)

  return server
})
