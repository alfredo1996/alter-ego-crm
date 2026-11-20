import { describe, it, expect } from "vitest"

import { apiCreateTransactionSchema, apiTransactionFiltersSchema, apiTransactionsExportSchema, transactionFormSchema } from "../../schemas"

/**
 * The transfer invariant at the schema layer.
 *
 * `assertLedgerValid` in the adapters is the real backstop — these refinements
 * exist so the transaction form and `/api/v1/transactions` surface a field
 * error instead of letting an exception escape as a 500. Both schemas are
 * derived from `createTransactionSchema` via `.omit()` / `.extend()`, so this
 * also pins that the refinement survives that derivation.
 */

const base = {
  accountId: "acc1",
  amount: 100,
  description: "Move to savings",
  date: new Date("2026-02-01"),
}

describe("transactionFormSchema — the web form path", () => {
  it("accepts a transfer with a distinct destination", () => {
    const result = transactionFormSchema.safeParse({
      ...base,
      type: "transfer",
      transferToAccountId: "acc2",
    })
    expect(result.success).toBe(true)
  })

  it("rejects a transfer with no destination, pointing at the field", () => {
    const result = transactionFormSchema.safeParse({ ...base, type: "transfer" })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0].path).toEqual(["transferToAccountId"])
    expect(result.error!.issues[0].message).toMatch(/destination/i)
  })

  it("rejects a transfer to its own source account", () => {
    const result = transactionFormSchema.safeParse({
      ...base,
      type: "transfer",
      transferToAccountId: "acc1",
    })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0].path).toEqual(["transferToAccountId"])
  })

  it("leaves expenses and income alone", () => {
    expect(transactionFormSchema.safeParse({ ...base, type: "expense" }).success).toBe(true)
    expect(transactionFormSchema.safeParse({ ...base, type: "income" }).success).toBe(true)
  })
})

describe("apiCreateTransactionSchema — the REST path", () => {
  it("rejects a destinationless transfer", () => {
    const result = apiCreateTransactionSchema.safeParse({
      ...base,
      type: "transfer",
      currency: "EUR",
      date: "2026-02-01",
    })
    expect(result.success).toBe(false)
  })

  it("still coerces the date string it was extended to accept", () => {
    const result = apiCreateTransactionSchema.safeParse({
      ...base,
      type: "expense",
      currency: "EUR",
      date: "2026-02-01",
    })
    expect(result.success).toBe(true)
    expect(result.data!.date).toBeInstanceOf(Date)
  })
})

describe("request array caps (DoS guard)", () => {
  const big = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i))
  const ok = { ...base, type: "expense", currency: "EUR" }
  const split = (i: number) => ({ id: `s${i}`, categoryId: "c", amount: 1 })

  it.each([
    ["splits", big(10_000, split)],
    ["tagIds", big(10_000, (i) => `t${i}`)],
  ])("rejects a 10,000-element %s on the API schema", (key, value) => {
    expect(apiCreateTransactionSchema.safeParse({ ...ok, [key]: value }).success).toBe(false)
  })

  it("still accepts 50 splits and 50 tagIds", () => {
    const r = apiCreateTransactionSchema.safeParse({ ...ok, splits: big(50, split), tagIds: big(50, (i) => `t${i}`) })
    expect(r.success).toBe(true)
  })

  it.each([
    [101, false],
    [100, true],
  ])("the list filter's tagIds with %i ids: success is %s", (n, success) => {
    const tagIds = big(n, (i) => `t${i}`).join(",")
    expect(apiTransactionFiltersSchema.safeParse({ tagIds }).success).toBe(success)
  })
})

describe("boolean query flags", () => {
  it.each([
    ["true", true],
    ["false", false],
  ])("uncategorized and hasNote read %s as %s", (raw, want) => {
    const r = apiTransactionFiltersSchema.parse({ uncategorized: raw, hasNote: raw })
    expect([r.uncategorized, r.hasNote]).toEqual([want, want])
  })

  it.each([["yes"], ["0"], [""]])("rejects %j", (raw) => {
    expect(apiTransactionFiltersSchema.safeParse({ uncategorized: raw }).success).toBe(false)
  })

  it("expandSplits reads false as false", () => {
    const r = apiTransactionsExportSchema.parse({ dateFrom: "2026-01-01", dateTo: "2026-01-31", expandSplits: "false" })
    expect(r.expandSplits).toBe(false)
  })
})
