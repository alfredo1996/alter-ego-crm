/**
 * The company read tools in a deployment that leaves invoicing out: a left-out
 * module's parts are absent from what a tool says, not only from what it lists.
 */
import { subMonths, format } from "date-fns"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { registerCrmReadTools } from "@/lib/mcp/tools/crm-read"

import type { McpServer } from "@modelcontextprotocol/server"

const { off, rows } = vi.hoisted(() => ({
  off: new Set<string>(),
  rows: {} as Record<string, unknown[]>,
}))

vi.mock("@/modules", () => ({ isModuleOn: (id: string) => !off.has(id) }))
vi.mock("@/lib/backend/server-db", () => ({
  getServerDb: () => new Proxy({}, { get: (_t, name: string) => async () => rows[name] ?? [] }),
}))

type Handler = (input: Record<string, unknown>, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
const handlers = new Map<string, Handler>()
registerCrmReadTools({ registerTool: (name: string, _def: unknown, h: Handler) => void handlers.set(name, h) } as unknown as McpServer)

async function call(tool: string, input: Record<string, unknown> = {}) {
  const res = await handlers.get(tool)!(input, { http: { authInfo: { extra: { userId: "u1" } } } })
  return { ...JSON.parse(res.content[0].text), isError: res.isError }
}

const last = format(subMonths(new Date(), 1), "yyyy-MM")

beforeEach(() => {
  off.clear()
  rows.getCompanyAccounts = [{ id: "a1", name: "Bank", openingBalance: 0, openingDate: new Date(`${last}-01T00:00:00`), statementBalance: null, statementDate: null }]
  rows.getCompanyExpenses = [
    { id: "e1", description: "Laptop", amount: 900, date: new Date(`${last}-10T00:00:00`), isRecurring: false, accountId: "a1", file: null },
  ]
  rows.getInvoices = []
})

describe("get_revenue without accounting", () => {
  it.each(["invoiced", "paid"])("refuses basis %s with a sentence naming the plugin", async (basis) => {
    off.add("accounting")
    const res = await call("get_revenue", { from: last, basis })
    expect(res.isError).toBe(true)
    expect(res.error).toBe(`Basis '${basis}' needs the Accounting plugin, which this deployment does not run. Ask for basis 'accrued'.`)
  })

  it("still answers the contract basis", async () => {
    off.add("accounting")
    expect((await call("get_revenue", { from: last })).isError).toBeUndefined()
  })
})
