/**
 * The company write tools in a deployment that leaves Rent out: the lease arguments are
 * refused with a sentence, and the descriptions do not mention get_rent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { registerCrmWriteTools } from "@/lib/mcp/tools/crm-write"

import type { McpServer } from "@modelcontextprotocol/server"

const { off, rows, calls } = vi.hoisted(() => ({
  off: new Set<string>(),
  rows: {} as Record<string, unknown>,
  calls: [] as { name: string; args: unknown[] }[],
}))

vi.mock("@/modules", () => ({ isModuleOn: (id: string) => !off.has(id) }))
vi.mock("@/lib/backend/server-db", () => ({
  getServerDb: () => new Proxy({}, { get: (_t, name: string) => async (...args: unknown[]) => {
        calls.push({ name, args })
        return rows[name] ?? []
      },
    }),
}))

type Handler = (input: Record<string, unknown>, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
const handlers = new Map<string, Handler>()
const descriptions = new Map<string, string>()
function register() {
  handlers.clear()
  registerCrmWriteTools({
    registerTool: (name: string, def: { description: string }, h: Handler) => {
      handlers.set(name, h)
      descriptions.set(name, def.description)
    },
  } as unknown as McpServer)
}

const call = async (tool: string, input: Record<string, unknown>) => {
  const res = await handlers.get(tool)!(input, { http: { authInfo: { extra: { userId: "u1" } } } })
  return { ...JSON.parse(res.content[0].text), isError: res.isError }
}

const day = (d: string) => new Date(`${d}T00:00:00`)

beforeEach(() => {
  off.clear()
  calls.length = 0
  rows.getLeases = [{ id: "l1" }]
  rows.createCompanyExpense = { id: "new1", description: "Offset", category: "other", amount: 100, vat: 0, documentRef: null, project: null }
  rows.getCompanyAccounts = [{ id: "a1", name: "Bank One", openingBalance: 100, openingDate: day("2026-01-01"), statementBalance: null, statementDate: null }]
  rows.getCompanyMovements = [
    { id: "m1", kind: "income", direction: "in", amount: 5, date: day("2026-02-01"), accountId: "a1", description: "Rent", leaseId: null, rentMonth: null, rentPart: null, createdAt: day("2026-02-01"), updatedAt: day("2026-02-01") },
  ]
  rows.getCompanyExpenses = [
    { id: "e1", description: "Offset", category: "other", amount: 10, vat: 0, date: day("2026-02-01"), isRecurring: false, accountId: "a1", leaseId: null, forMonth: null, createdAt: day("2026-02-01"), updatedAt: day("2026-02-01") },
  ]
  register()
})

const TOOLS = ["add_movement", "update_movement", "update_expense", "add_expense"]

describe("without the Rent module", () => {
  it.each(TOOLS)("%s does not mention get_rent or leases in its description", (tool) => {
    off.add("rent")
    register()
    expect(descriptions.get(tool)).not.toMatch(/get_rent|lease/i)
  })

  it.each(TOOLS)("%s describes the lease with Rent on", (tool) => {
    expect(descriptions.get(tool)).toContain("get_rent")
  })

  it.each([
    ["add_movement", { kind: "income", direction: "in", amount: 5, account: "Bank One", leaseId: "l1", rentMonth: "2026-02", rentPart: "rent", force: true }],
    ["add_movement", { kind: "income", direction: "in", amount: 5, account: "Bank One", rentMonth: "2026-02", force: true }],
    ["update_movement", { id: "m1", leaseId: "none", confirm: true }],
    ["update_expense", { id: "e1", leaseId: "l1", for_month: "2026-02", confirm: true }],
    ["add_expense", { description: "Offset", total: 100, paidFrom: "Bank One", category: "other", leaseId: "l1", force: true }],
  ])("%s refuses the lease arguments", async (tool, input) => {
    off.add("rent")
    const res = await call(tool, input)
    expect(res.isError).toBe(true)
    expect(res.error).toBe("Rent is left out of this deployment: leaseId, rentMonth and rentPart are not available.")
  })
})

describe("add_expense with leaseId", () => {
  const offset = { description: "Offset", total: 100, paidFrom: "Bank One", category: "other", date: "2026-11-03", force: true }
  const saved = () => calls.find((c) => c.name === "createCompanyExpense")?.args[1]

  it.each([
    ["names the month", { leaseId: "l1", for_month: "2026-10" }, "2026-10"],
    ["defaults to the date's month", { leaseId: "l1", date: "2026-09-15" }, "2026-09"],
  ])("saves one linked cost that %s", async (_n, extra, forMonth) => {
    const res = await call("add_expense", { ...offset, ...extra })
    expect(res.isError).toBeUndefined()
    expect(calls.filter((c) => c.name === "createCompanyExpense")).toHaveLength(1)
    expect(saved()).toMatchObject({ leaseId: "l1", forMonth, collaboratorId: null, engagementId: null })
  })

  it("replies with the lease link and says which rent month it offsets", async () => {
    rows.createCompanyExpense = { ...(rows.createCompanyExpense as object), leaseId: "l1", forMonth: "2026-09" }
    const res = await call("add_expense", { ...offset, leaseId: "l1", date: "2026-09-15" })
    expect(res.cost).toMatchObject({ leaseId: "l1", forMonth: "2026-09" })
    expect(res.summary).toContain(" It offsets the rent for September 2026 on lease l1.")
  })

  it.each([
    ["an unknown lease", { leaseId: "nope" }, 'No lease with id "nope": get_rent lists the leases with their ids.'],
    ["a collaborator", { leaseId: "l1", collaborator: "Giulia" }, "A cost is a rent offset or a collaborator's invoice, not both: leave out leaseId, or the collaborator, contract and supplierInvoice."],
    ["a supplier invoice payment", { leaseId: "l1", supplierInvoice: "ST-9" }, "A rent offset is a new cost, not a supplier invoice payment: leave out leaseId or supplierInvoice."],
  ])("refuses %s", async (_n, extra, error) => {
    const res = await call("add_expense", { ...offset, ...extra })
    expect(res.error).toBe(error)
    expect(saved()).toBeUndefined()
  })

  it("still refuses for_month without a collaborator or a lease", async () => {
    const res = await call("add_expense", { ...offset, for_month: "2026-10" })
    expect(res.error).toBe("contract and for_month belong to a collaborator's invoice: pass collaborator.")
  })
})
