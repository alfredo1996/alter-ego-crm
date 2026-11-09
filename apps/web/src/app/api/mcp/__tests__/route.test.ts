import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const authenticate = vi.hoisted(() => vi.fn())
vi.mock("@/lib/mcp/auth", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  authenticate,
}))

// Counts the calls that get past the gate into the real mcp-handler.
const handlerCalls = vi.hoisted(() => vi.fn())
vi.mock("mcp-handler", async (orig) => {
  const mod = await orig<typeof McpHandler>()
  return {
    ...mod,
    createMcpHandler: (...args: Parameters<typeof mod.createMcpHandler>) => {
      const h = mod.createMcpHandler(...args)
      return (req: Request) => (handlerCalls(), h(req))
    },
  }
})

import { WRITE_TOOLS } from "@/lib/mcp/tools/crm-write"

import { POST } from "../route"

import type * as McpHandler from "mcp-handler"

const readOnly = { userId: "u1", clientId: "c1", scopes: ["data:read"] }
const writer = { userId: "u1", clientId: "c1", scopes: ["data:read", "data:write"] }

// A write tool this deployment actually registers.
const writeTool = [...WRITE_TOOLS][0]

const rpc = (body: unknown) =>
  POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
    })
  )
const ping = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ping", arguments: {} } }
const write = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: writeTool, arguments: {} } }

beforeEach(() => {
  authenticate.mockReset()
  handlerCalls.mockReset()
})

describe("POST /api/mcp scope gate", () => {
  it.each([
    ["a write alone", [write]],
    ["a write after a read", [ping, write]],
    ["a write last of three", [ping, ping, write]],
  ])("refuses a read-only token on a batch with %s", async (_n, batch) => {
    authenticate.mockResolvedValue(readOnly)
    const res = await rpc(batch)
    expect(res.status).toBe(403)
    expect(res.headers.get("WWW-Authenticate")).toContain("insufficient_scope")
    // The 403 comes before the handler: no tool in the batch ran.
    expect(handlerCalls).not.toHaveBeenCalled()
  })

  it("lets a read-only token run a batch of reads", async () => {
    authenticate.mockResolvedValue(readOnly)
    expect((await rpc([ping, ping])).status).toBe(200)
  })

  it("does not gate a token that holds write", async () => {
    authenticate.mockResolvedValue(writer)
    expect((await rpc([ping, write])).status).toBe(200)
    expect(handlerCalls).toHaveBeenCalledTimes(1)
  })

  it("answers 401 without a valid credential", async () => {
    authenticate.mockResolvedValue(null)
    expect((await rpc([ping])).status).toBe(401)
  })
})

describe("tools/list", () => {
  it("serves the connector's tools and none of a finance app's", async () => {
    authenticate.mockResolvedValue(readOnly)
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    const text = await res.text()
    const payload = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))!.slice(5)
    const names: string[] = JSON.parse(payload).result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain("ping")
    expect(names).toContain("create_client")
    expect(names).toContain("list_clients")
    expect(names).not.toContain("add_transaction")
    expect(names).not.toContain("list_accounts")
  })
})

// The registry is read once at load, so a deployment that leaves a module out is a fresh import of the route.
describe("a deployment that leaves Invoicing out", () => {
  const call = (route: { POST: typeof POST }, body: unknown) =>
    route.POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
      })
    )
  const load = async (disabled: string) => {
    vi.stubEnv("NEXT_PUBLIC_DISABLED_MODULES", disabled)
    vi.resetModules()
    return import("../route")
  }
  const toolNames = async (route: { POST: typeof POST }) => {
    const text = await (await call(route, { jsonrpc: "2.0", id: 1, method: "tools/list" })).text()
    const payload = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))!.slice(5)
    return (JSON.parse(payload).result.tools as { name: string }[]).map((t) => t.name)
  }
  const createInvoice = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_invoice", arguments: {} } }

  beforeEach(() => authenticate.mockResolvedValue(readOnly))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("lists the invoice tools with Invoicing on, and gates create_invoice behind the write scope", async () => {
    const route = await load("")
    const names = await toolNames(route)
    expect(["list_invoices", "create_invoice", "get_quarters"].filter((t) => !names.includes(t))).toEqual([])
    expect((await call(route, createInvoice)).status).toBe(403)
  })

  it("lists no invoice tool, and no get_quarters, with Invoicing off", async () => {
    const names = await toolNames(await load("invoicing"))
    expect(["list_invoices", "get_unbilled", "create_invoice", "mark_invoice_paid", "update_invoice", "delete_invoice", "get_quarters"].filter((t) => names.includes(t))).toEqual([])
    expect(names).toContain("list_clients")
  })

  it("leaves create_invoice out of the write-scope set: it is not served, so it is not a write", async () => {
    const route = await load("invoicing")
    expect((await call(route, createInvoice)).status).toBe(200)
  })
})
