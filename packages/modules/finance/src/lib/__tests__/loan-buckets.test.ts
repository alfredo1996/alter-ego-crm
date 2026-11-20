import { describe, expect, it } from "vitest"

import { bucketName, loanBuckets } from "../loan-buckets"

import type { Transaction } from "../../types"

const LOAN = "loan-acc"
const BANK = "bank-acc"

type Tx = Pick<Transaction, "type" | "amount" | "accountId" | "transferToAccountId" | "description" | "date">

/** A transfer from the bank into the loan account: money lent. */
function lend(description: string, amount: number, date = "2026-01-01"): Tx {
  return { type: "transfer", amount, accountId: BANK, transferToAccountId: LOAN, description, date: new Date(date) }
}

/** A transfer from the loan account back to the bank: money paid back. */
function repay(description: string, amount: number, date = "2026-01-01"): Tx {
  return { type: "transfer", amount, accountId: LOAN, transferToAccountId: BANK, description, date: new Date(date) }
}

describe("bucketName", () => {
  it("drops a leading Soldi, whatever the case and spacing", () => {
    expect(bucketName("Soldi Alice")).toBe("Alice")
    expect(bucketName("  soldi   alice ")).toBe("alice")
  })

  it("keeps a description with no Soldi prefix whole", () => {
    expect(bucketName("Capodanno")).toBe("Capodanno")
    expect(bucketName("Soldiera")).toBe("Soldiera")
  })

  it("falls back when nothing is left", () => {
    expect(bucketName("Soldi")).toBe("Soldi")
    expect(bucketName("   ")).toBe("Unnamed")
  })
})

describe("loanBuckets", () => {
  it("groups the same person across casing and keeps the name as last written", () => {
    const buckets = loanBuckets(
      [lend("soldi alice", 100, "2026-01-01"), lend("Soldi Alice", 50, "2026-02-01")],
      LOAN,
    )
    expect(buckets).toHaveLength(1)
    expect(buckets[0]).toMatchObject({ key: "alice", name: "Alice", lent: 150, repaid: 0, balance: 150, count: 2 })
    expect(buckets[0].lastDate).toEqual(new Date("2026-02-01"))
  })

  it("counts a transfer in as lent and a transfer out as paid back", () => {
    const [alice] = loanBuckets([lend("Soldi Alice", 300), repay("Soldi Alice", 120.5)], LOAN)
    expect(alice).toMatchObject({ lent: 300, repaid: 120.5, balance: 179.5 })
  })

  it("adds up to the account's balance over any mix of rows", () => {
    const rows: Tx[] = [
      lend("Soldi Alice", 300),
      repay("Soldi Alice", 100),
      lend("Soldi Carol", 1000),
      { type: "expense", amount: 250, accountId: LOAN, transferToAccountId: null, description: "Differenza di equilibrio", date: new Date("2026-03-01") },
      { type: "income", amount: 40, accountId: LOAN, transferToAccountId: null, description: "Capodanno", date: new Date("2026-03-02") },
      { type: "expense", amount: 999, accountId: BANK, transferToAccountId: null, description: "Not this account", date: new Date("2026-03-03") },
    ]
    const buckets = loanBuckets(rows, LOAN)
    // 300 − 100 + 1000 − 250 + 40: what recalculateBalances would put on the account.
    expect(buckets.reduce((s, b) => s + b.balance, 0)).toBe(990)
    expect(buckets.map((b) => b.name)).not.toContain("Not this account")
    expect(buckets.find((b) => b.name === "Differenza di equilibrio")?.balance).toBe(-250)
  })

  it("sorts open buckets by balance, settled ones last", () => {
    const buckets = loanBuckets(
      [
        lend("Soldi Fay", 20),
        lend("Soldi Alice", 500),
        lend("Soldi Bob", 630, "2026-01-01"),
        repay("Soldi Bob", 630, "2026-01-28"),
        repay("Soldi Eve", 45),
      ],
      LOAN,
    )
    expect(buckets.map((b) => [b.name, b.balance])).toEqual([
      ["Alice", 500],
      ["Fay", 20],
      ["Eve", -45],
      ["Bob", 0],
    ])
  })

  it("rounds to cents", () => {
    const [b] = loanBuckets([lend("Soldi Dave", 0.1), lend("Soldi Dave", 0.2)], LOAN)
    expect(b.balance).toBe(0.3)
  })
})
