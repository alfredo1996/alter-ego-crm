import { describe, it, expect } from "vitest"

import {
  ARCHIVE_REFUSAL,
  assertArchivable,
  closedTarget,
  isAtZero,
  assertLedgerValid,
  txBelongsToAccount,
  txDelta,
  balanceEffects,
  balanceEffectsDiff,
  monthFlow,
} from "../account-ledger"

import type { Account, Transaction } from "../../types"

const ACC = "acc-1"
const OTHER = "acc-2"

function t(p: Partial<Transaction> & Pick<Transaction, "type">): Pick<Transaction, "type" | "amount" | "accountId" | "transferToAccountId"> {
  return { type: p.type, amount: p.amount ?? 10, accountId: p.accountId ?? ACC, transferToAccountId: p.transferToAccountId ?? null }
}

describe("txBelongsToAccount", () => {
  it("includes income/expense originating from the account", () => {
    expect(txBelongsToAccount(t({ type: "income", accountId: ACC }), ACC)).toBe(true)
    expect(txBelongsToAccount(t({ type: "expense", accountId: ACC }), ACC)).toBe(true)
  })

  it("excludes transactions on a different account", () => {
    expect(txBelongsToAccount(t({ type: "expense", accountId: OTHER }), ACC)).toBe(false)
  })

  it("includes an OUTGOING transfer (account is source)", () => {
    expect(txBelongsToAccount(t({ type: "transfer", accountId: ACC, transferToAccountId: OTHER }), ACC)).toBe(true)
  })

  it("includes an INCOMING transfer (account is destination) — the #95 regression", () => {
    expect(txBelongsToAccount(t({ type: "transfer", accountId: OTHER, transferToAccountId: ACC }), ACC)).toBe(true)
  })

  it("excludes a transfer between two other accounts", () => {
    expect(txBelongsToAccount(t({ type: "transfer", accountId: OTHER, transferToAccountId: "acc-3" }), ACC)).toBe(false)
  })
})

describe("txDelta", () => {
  it("signs income/expense/transfer-in/transfer-out", () => {
    expect(txDelta(t({ type: "income", amount: 40 }), ACC)).toBe(40)
    expect(txDelta(t({ type: "expense", amount: 40 }), ACC)).toBe(-40)
    expect(txDelta(t({ type: "transfer", amount: 40, accountId: OTHER, transferToAccountId: ACC }), ACC)).toBe(40)
    expect(txDelta(t({ type: "transfer", amount: 40, accountId: ACC, transferToAccountId: OTHER }), ACC)).toBe(-40)
  })
})

describe("balanceEffects", () => {
  it("income/expense affect only their own account", () => {
    expect(balanceEffects(t({ type: "income", amount: 25, accountId: ACC }))).toEqual([{ accountId: ACC, delta: 25 }])
    expect(balanceEffects(t({ type: "expense", amount: 25, accountId: ACC }))).toEqual([{ accountId: ACC, delta: -25 }])
  })

  it("a transfer debits source and credits destination", () => {
    expect(
      balanceEffects(t({ type: "transfer", amount: 30, accountId: ACC, transferToAccountId: OTHER })),
    ).toEqual([
      { accountId: ACC, delta: -30 },
      { accountId: OTHER, delta: 30 },
    ])
  })

  it("a transfer with no destination only debits the source", () => {
    expect(
      balanceEffects(t({ type: "transfer", amount: 30, accountId: ACC, transferToAccountId: null })),
    ).toEqual([{ accountId: ACC, delta: -30 }])
  })
})

describe("balanceEffectsDiff", () => {
  it("amount change applies only the difference", () => {
    expect(
      balanceEffectsDiff(t({ type: "income", amount: 50, accountId: ACC }), t({ type: "income", amount: 80, accountId: ACC })),
    ).toEqual([{ accountId: ACC, delta: 30 }])
  })

  it("type change (income→expense) doubles the reversal", () => {
    expect(
      balanceEffectsDiff(t({ type: "income", amount: 50, accountId: ACC }), t({ type: "expense", amount: 50, accountId: ACC })),
    ).toEqual([{ accountId: ACC, delta: -100 }])
  })

  it("moving a transaction to another account credits the old, debits the new", () => {
    const diff = balanceEffectsDiff(
      t({ type: "expense", amount: 20, accountId: ACC }),
      t({ type: "expense", amount: 20, accountId: OTHER }),
    )
    expect(diff).toContainEqual({ accountId: ACC, delta: 20 }) // reverse old expense
    expect(diff).toContainEqual({ accountId: OTHER, delta: -20 }) // apply new expense
    expect(diff).toHaveLength(2)
  })

  it("an unchanged transaction produces no net effect", () => {
    expect(
      balanceEffectsDiff(t({ type: "income", amount: 50, accountId: ACC }), t({ type: "income", amount: 50, accountId: ACC })),
    ).toEqual([])
  })

  it("changing a transfer's destination moves the credit", () => {
    const diff = balanceEffectsDiff(
      t({ type: "transfer", amount: 40, accountId: ACC, transferToAccountId: OTHER }),
      t({ type: "transfer", amount: 40, accountId: ACC, transferToAccountId: "acc-3" }),
    )
    // source ACC unchanged (−40 both), OTHER loses its +40, acc-3 gains +40
    expect(diff).toContainEqual({ accountId: OTHER, delta: -40 })
    expect(diff).toContainEqual({ accountId: "acc-3", delta: 40 })
    expect(diff.find((e) => e.accountId === ACC)).toBeUndefined()
  })
})

describe("assertLedgerValid", () => {
  it("accepts income and expense regardless of the transfer fields", () => {
    expect(() => assertLedgerValid(t({ type: "income" }))).not.toThrow()
    expect(() => assertLedgerValid(t({ type: "expense" }))).not.toThrow()
  })

  it("accepts a transfer with a distinct destination", () => {
    expect(() =>
      assertLedgerValid(t({ type: "transfer", transferToAccountId: OTHER }))
    ).not.toThrow()
  })

  it("rejects a transfer with no destination — the amount would be lost", () => {
    // balanceEffects debits the source and credits nobody, so the money leaves
    // net worth silently. This is the state the schemas and rules used to allow.
    const orphan = t({ type: "transfer", transferToAccountId: null })
    expect(balanceEffects(orphan)).toEqual([{ accountId: ACC, delta: -10 }])
    expect(() => assertLedgerValid(orphan)).toThrow(/destination/i)
  })

  it("rejects a transfer to its own source account", () => {
    expect(() =>
      assertLedgerValid(t({ type: "transfer", transferToAccountId: ACC }))
    ).toThrow(/same source and destination/i)
  })
})

describe("monthFlow: what an account took in and paid out in a month", () => {
  const at = (iso: string, p: Parameters<typeof t>[0]) => ({ ...t(p), date: new Date(iso) })
  const rows = [
    at("2026-10-05T10:00:00", { type: "income", amount: 100 }),
    at("2026-10-06T10:00:00", { type: "expense", amount: 30 }),
    at("2026-10-07T10:00:00", { type: "expense", amount: 20 }),
    at("2026-10-08T10:00:00", { type: "transfer", amount: 50, accountId: OTHER, transferToAccountId: ACC }), // lands here
    at("2026-10-09T10:00:00", { type: "transfer", amount: 15, transferToAccountId: OTHER }), // leaves here
    at("2026-09-30T23:00:00", { type: "income", amount: 999 }), // last month
    at("2026-11-01T00:00:00", { type: "expense", amount: 999 }), // next month
  ]

  it("signs every row from this account's side, transfers included, and counts each way", () => {
    expect(monthFlow(rows, ACC, new Date("2026-10-15"))).toEqual({ in: 150, out: 65, countIn: 2, countOut: 3 })
  })

  it("is zero for a month with nothing in it", () => {
    expect(monthFlow(rows, ACC, new Date("2026-08-15"))).toEqual({ in: 0, out: 0, countIn: 0, countOut: 0 })
  })
})

describe("at zero to the cent (#314)", () => {
  it.each([
    [0, true],
    [0.1 + 0.2 - 0.3, true],
    [-0.004, true],
    [-0.005, false],
    [0.005, false],
    [-0.01, false],
    [12.5, false],
  ])("isAtZero(%s) is %s, and assertArchivable agrees", (balance, zero) => {
    expect(isAtZero(balance)).toBe(zero)
    const archive = () => assertArchivable({ balance, isArchived: false }, { isArchived: true })
    if (zero) expect(archive).not.toThrow()
    else expect(archive).toThrow(ARCHIVE_REFUSAL)
  })
})

describe("closedTarget (#319)", () => {
  const acc = (id: string, isArchived: boolean) => ({ id, name: id, isArchived }) as Account
  const accounts = [acc("open", false), acc("old", true), acc("older", true)]

  it.each([
    ["names a closed target", ["open", "old"], [], "old"],
    ["ignores open targets", ["open", null, undefined], [], undefined],
    ["exempts the transaction's own closed accounts", ["old", "older"], ["old", "older"], undefined],
    ["still refuses a closed account that is not its own", ["old", "older"], ["old"], "older"],
  ])("%s", (_n, ids, own, expected) => {
    expect(closedTarget(accounts, ids, own)?.id).toBe(expected)
  })
})
