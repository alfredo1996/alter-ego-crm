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

describe("get_month_end without invoicing", () => {
  it("names the missing invoice file with invoicing on", async () => {
    expect((await call("get_month_end", { month: last })).summary).toContain("1 invoice file missing")
  })

  it("leaves the Invoice Files reminder out of the summary and the steps", async () => {
    off.add("invoicing")
    const res = await call("get_month_end", { month: last })
    expect(res.summary).not.toContain("invoice file")
    expect(res.summary).not.toContain("waiting for payment")
    expect(res.steps.map((s: { step: string }) => s.step)).not.toContain("files")
  })
})

describe("get_month_end without books", () => {
  it("does not keep the month open for a Bank step the owner cannot see", async () => {
    expect((await call("get_month_end", { month: last })).summary).toContain("2 steps to do (Bank, To Chase)")
    off.add("books")
    const res = await call("get_month_end", { month: last })
    expect(res.closed).toBe(true)
    expect(res.summary).toContain("is closed: every required step is done.")
  })
})

describe("get_revenue without invoicing", () => {
  it.each(["invoiced", "paid"])("refuses basis %s with a sentence naming the module", async (basis) => {
    off.add("invoicing")
    const res = await call("get_revenue", { from: last, basis })
    expect(res.isError).toBe(true)
    expect(res.error).toBe(`Basis '${basis}' needs the Invoicing module, which this deployment leaves out. Ask for basis 'accrued'.`)
  })

  it("still answers the contract basis", async () => {
    off.add("invoicing")
    expect((await call("get_revenue", { from: last })).isError).toBeUndefined()
  })
})
