import { createMcpHandler, type McpHandlerOptions } from "mcp-handler"

import { authenticate, insufficientScope, unauthorized } from "@/lib/mcp/auth"
import { MCP_VERSION } from "@/lib/mcp/config"
import { registerCrmReadTools } from "@/lib/mcp/tools/crm-read"
import { registerCrmWriteTools, WRITE_TOOLS } from "@/lib/mcp/tools/crm-write"
import { RENT_WRITE_TOOLS, registerRentTools } from "@/lib/mcp/tools/rent"
import { hasScopes, SCOPE_WRITE } from "@/lib/oauth/tokens"
import { z } from "@/lib/zod"
import { enabledToolNames, gateTools } from "@/modules"

export const runtime = "nodejs"

// maxToolInputElements: the SDK rejects tool arguments with more nodes than this (GHSA-46jr).
// mcp-handler forwards unknown options to McpServer but its type omits this one; a variable
// (no excess-property check) plus `satisfies` keeps a misspelt key a type error.
const handlerOptions = {
  serverInfo: { name: "alter-ego-crm", version: MCP_VERSION },
  maxToolInputElements: 5000,
} satisfies McpHandlerOptions & { maxToolInputElements: number }

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "ping",
      {
        title: "Ping",
        description:
          "Health check for the Alter Ego CRM connector. Call this to confirm the " +
          "connector is reachable and the API key is valid before running other tools.",
        // mcp-handler 2.x takes a full z.object(), not a raw shape.
        inputSchema: z.object({ message: z.string().optional() }),
      },
      // 2.x moved authInfo from extra.authInfo to ctx.http.authInfo.
      async ({ message }, ctx) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              pong: message ?? "pong",
              userId: ctx.http?.authInfo?.extra?.userId ?? null,
              // What this credential may do, without provoking a 403 to find out (#157).
              scopes: ctx.http?.authInfo?.scopes ?? [],
              serverTime: new Date().toISOString(),
            }),
          },
        ],
      })
    )

    // The module registry decides which tools exist: a disabled module's tools are
    // never registered. `ping` stays in every build — it is how a client checks
    // reachability before it knows what else is there.
    const gated = gateTools(server)
    registerCrmReadTools(gated)
    registerCrmWriteTools(gated)
    registerRentTools(gated)
  },
  handlerOptions
)

/**
 * Every tool the scope gate must hold write access for — from the modules this
 * deployment actually registers. A build that answered 403 for a tool of a module
 * it switched off would be claiming to have a tool it does not serve; "unknown
 * tool" is the truth.
 */
const SERVED = enabledToolNames()
const ALL_WRITE_TOOLS = new Set([...WRITE_TOOLS, ...RENT_WRITE_TOOLS].filter((t) => SERVED.has(t)))

/** The first tool in the JSON-RPC body that requires the write scope, or null. */
async function writeToolCalled(request: Request): Promise<string | null> {
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null)
  const messages: unknown[] = Array.isArray(body) ? body : [body]
  for (const m of messages) {
    const { method, params } = (m ?? {}) as { method?: unknown; params?: { name?: unknown } }
    const name = String(params?.name)
    if (method === "tools/call" && ALL_WRITE_TOOLS.has(name)) return name
  }
  return null
}

async function route(request: Request): Promise<Response> {
  const auth = await authenticate(request)
  if (!auth) return unauthorized(request)

  // Scope step-up gate, at the HTTP layer: once a tool handler runs, its
  // refusal would be a 200 tool error and Claude would never show the
  // re-consent card. A 403 + insufficient_scope challenge does.
  if (request.method === "POST" && !hasScopes(auth.scopes, [SCOPE_WRITE])) {
    const tool = await writeToolCalled(request)
    if (tool) return insufficientScope(request, tool, [SCOPE_WRITE], auth.scopes)
  }

  // mcp-handler reads `request.auth` and forwards it as ctx.http.authInfo. This is
  // what its own withMcpAuth does; we build the challenge ourselves because that
  // wrapper cannot add the `scope` parameter Claude uses to size its consent prompt.
  request.auth = {
    token: "",
    clientId: auth.clientId,
    scopes: auth.scopes,
    extra: { userId: auth.userId },
  }
  return handler(request)
}

export { route as GET, route as POST }
