import { createFinanceAdmin } from "@alter-ego/finance/adapter-admin"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_BACKEND: "firebase" } }))

// What Personal Finance's MCP tools call on the server's database, and nothing else of its.
const FINANCE = [
  "getAccounts", "getAccount", "getBudgets", "getTags", "getRecurringTransactions", "getLastActivity",
  "getTransactions", "getTransaction", "createTransaction", "updateTransaction", "deleteTransaction",
  "getMonthlyTotals", "createAccount", "updateAccount", "getCategories", "getReportData",
]

describe("the server db", () => {
  it("the package's admin slice is exactly the finance functions", () => {
    expect(Object.keys(createFinanceAdmin(() => { throw new Error("never read at creation") })).sort()).toEqual([...FINANCE].sort())
  })

  it("carries each of them next to the company's, from the same admin module the company's come from", async () => {
    const { getServerDb } = await import("../server-db")
    const db = getServerDb() as unknown as Record<string, unknown>
    expect(FINANCE.filter((name) => typeof db[name] !== "function")).toEqual([])
    // Not shadowed: the company side and the API keys are still there.
    expect(["getClients", "createCompanyMovement", "getTenants", "createApiKey", "validateApiKey", "addAuditEntry"].filter((n) => typeof db[n] !== "function")).toEqual([])
  })
})
