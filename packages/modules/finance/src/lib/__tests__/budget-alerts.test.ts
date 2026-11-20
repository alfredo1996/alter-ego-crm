import { describe, it, expect } from "vitest"

import { getBudgetStatus } from "../budgets"

describe("getBudgetStatus", () => {
  it.each([
    { limit: 100, spent: 0, status: "ok" },
    { limit: 100, spent: 79, status: "ok" },
    { limit: 100, spent: 80, status: "warning" },
    { limit: 100, spent: 99.9, status: "warning" },
    { limit: 100, spent: 100, status: "danger" },
    { limit: 100, spent: 120, status: "danger" },
    { limit: 12, spent: 9.6, status: "warning" },
    { limit: 3, spent: 2.4, status: "warning" },
    { limit: 0, spent: 0, status: "ok" },
    { limit: 0, spent: 20, status: "danger" },
    { limit: -50, spent: 0, status: "ok" },
    { limit: -50, spent: 1, status: "danger" },
  ])("limit $limit, spent $spent is $status", ({ limit, spent, status }) => {
    expect(getBudgetStatus({ spent, effectiveAmount: limit })).toBe(status)
  })
})
