import { describe, expect, it } from "vitest"

import { cadenceLabel, summarizeRecurring } from "../recurring-summary"

import type { RecurringTransaction } from "../../types"

const day = new Date(2026, 9, 1)
const rule = (o: Partial<RecurringTransaction>): RecurringTransaction => ({
  id: "r", userId: "u", accountId: "a", type: "expense", amount: 10, currency: "EUR", categoryId: null,
  description: "Rule", notes: null, frequency: "monthly", interval: 1, startDate: day, endDate: null,
  nextDueDate: day, isActive: true, loanMeta: null, createdAt: day, updatedAt: day, ...o,
})

describe("summarizeRecurring", () => {
  it("adds the monthly rules and names the ones on another cycle apart (the Recurring board's figures)", () => {
    const s = summarizeRecurring([
      rule({ type: "income", amount: 2850, description: "Salary" }),
      rule({ amount: 950, description: "Rent" }),
      rule({ amount: 39, description: "Gym" }),
      rule({ amount: 480, frequency: "yearly", description: "Car insurance" }),
      rule({ amount: 99, isActive: false, description: "Paused one" }),
    ])
    expect(s.monthlyIn).toEqual({ total: 2850, names: ["Salary"] })
    expect(s.monthlyOut).toEqual({ total: 989, count: 2 })
    expect(s.other).toEqual({ out: 480, in: 0, names: ["Car insurance"], yearlyOnly: true })
  })

  it("an every-2-months rule is not monthly", () => {
    const s = summarizeRecurring([rule({ amount: 30, interval: 2, description: "Bi-monthly" })])
    expect(s.monthlyOut).toEqual({ total: 0, count: 0 })
    expect(s.other?.yearlyOnly).toBe(false)
  })

  it("has no other cycle when every rule is monthly", () => {
    expect(summarizeRecurring([rule({})]).other).toBeNull()
  })
})

describe("cadenceLabel", () => {
  it.each([
    ["monthly", 1, "Monthly"],
    ["yearly", 1, "Yearly"],
    ["weekly", 2, "Every 2 weeks"],
    ["daily", 3, "Every 3 days"],
  ] as const)("%s x%i reads %s", (frequency, interval, label) => {
    expect(cadenceLabel(rule({ frequency, interval }))).toBe(label)
  })
})
