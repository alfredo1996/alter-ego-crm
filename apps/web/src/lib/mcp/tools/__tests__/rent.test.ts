/**
 * The Rent tools' registration: what the handler audits. Writes only, like crm-read and
 * crm-write; an edit without confirm is marked as a preview; a refusal is audited too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { registerRentTools } from "@/lib/mcp/tools/rent"

import type { McpServer } from "@modelcontextprotocol/server"

const { audit, tenants } = vi.hoisted(() => ({ audit: vi.fn(async () => {}), tenants: [] as Record<string, unknown>[] }))

vi.mock("@/lib/backend/server-db", () => ({
  getServerDb: () => ({
    addAuditEntry: audit,
    getTenants: async () => tenants,
    getLeases: async () => [],
    getCompanyMovements: async () => [],
    getCompanyExpenses: async () => [],
    updateTenant: async () => {},
    createTenant: async (_u: string, t: object) => ({ id: "t9", ...t }),
  }),
}))

type Handler = (input: Record<string, unknown>, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
const handlers = new Map<string, Handler>()
registerRentTools({ registerTool: (name: string, _def: unknown, h: Handler) => void handlers.set(name, h) } as unknown as McpServer)

const call = (tool: string, input: Record<string, unknown> = {}) =>
  handlers.get(tool)!(input, { http: { authInfo: { clientId: "c1", extra: { userId: "u1" } } } })

const anna = { id: "t1", firstName: "Anna", surname: "Test", taxId: "X1", street: "Via Uno 1", postcode: "10100", city: "Turin", country: "Italy" }

beforeEach(() => {
  audit.mockClear()
  tenants.length = 0
  tenants.push(anna)
})

describe("registerRentTools audit", () => {
  it("does not audit a read", async () => {
    await call("get_rent")
    await call("get_tenant", { tenant: "nobody" }) // a refused read is not audited either
    expect(audit).not.toHaveBeenCalled()
  })

  it("audits a write with the ids it touched", async () => {
    const input = { firstName: "Hanna", surname: "Other", taxId: "X2", street: "Via Due 2", postcode: "10100", city: "Turin", country: "Italy" }
    await call("create_tenant", input)
    expect(audit).toHaveBeenCalledWith("u1", { tool: "create_tenant", params: input, clientId: "c1", result: "ok", documentIds: ["t9"] })
  })

  it("marks an edit without confirm as a preview, and not one with it", async () => {
    await call("update_tenant", { tenant: "Anna Test", city: "Milan" })
    expect(audit).toHaveBeenLastCalledWith("u1", expect.objectContaining({ tool: "update_tenant", result: "ok", preview: true }))
    await call("update_tenant", { tenant: "Anna Test", city: "Milan", confirm: true })
    expect(audit).toHaveBeenLastCalledWith("u1", expect.not.objectContaining({ preview: true }))
  })

  it("audits a refused write with its message and answers an error", async () => {
    const res = await call("update_tenant", { tenant: "Nobody", city: "Milan" })
    expect(res.isError).toBe(true)
    expect(audit).toHaveBeenCalledWith("u1", expect.objectContaining({ tool: "update_tenant", result: "error", errorMessage: expect.stringContaining('No tenant matches "Nobody"') }))
  })
})
