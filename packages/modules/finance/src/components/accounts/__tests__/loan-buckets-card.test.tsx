import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LoanBucketsCard } from "../loan-buckets-card"

import type { Transaction } from "../../../types"

const LOAN = "loan-acc"
const BANK = "bank-acc"
const now = new Date("2026-01-01")

function tx(p: Partial<Transaction> & Pick<Transaction, "description" | "amount">): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    userId: "u1",
    accountId: BANK,
    type: "transfer",
    currency: "EUR",
    categoryId: null,
    rawDescription: null,
    date: now,
    notes: null,
    tagIds: [],
    transferToAccountId: LOAN,
    linkedTransactionId: null,
    isRecurring: false,
    splits: [],
    attachments: [],
    status: "cleared",
    importHash: null,
    excludeFromReports: false,
    createdAt: now,
    updatedAt: now,
    ...p,
  }
}

const format = (n: number) => `€${n.toFixed(2)}`
const rows = [
  tx({ description: "Soldi Alice", amount: 500 }),
  tx({ description: "Soldi Alice", amount: 100, accountId: LOAN, transferToAccountId: BANK }),
  tx({ description: "Soldi Bob", amount: 630 }),
  tx({ description: "Soldi Bob", amount: 630, accountId: LOAN, transferToAccountId: BANK }),
]

describe("LoanBucketsCard", () => {
  it("lists who owes what, the total owed to you, and the settled ones apart", () => {
    render(<LoanBucketsCard account={{ id: LOAN, type: "loan", currency: "EUR" }} transactions={rows} format={format} />)
    expect(screen.getByText("By Person")).toBeInTheDocument()
    expect(screen.getByText("€400.00 owed to you")).toBeInTheDocument()
    const alice = screen.getByRole("link", { name: "Alice" })
    expect(alice).toHaveAttribute("href", `/transactions?accountId=${LOAN}&search=Alice`)
    expect(screen.getByText("€500.00 lent · €100.00 paid back")).toBeInTheDocument()
    expect(screen.getByText("Settled (1)")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Bob" })).toBeInTheDocument()
  })

  it("shows a bucket you owe as your debt, with both totals in the header", () => {
    // Carol lent you 1,000 (money left the loan account for your bank) and you gave 200 back.
    const mixed = [
      ...rows,
      tx({ description: "Soldi Carol", amount: 1000, accountId: LOAN, transferToAccountId: BANK }),
      tx({ description: "Soldi Carol", amount: 200 }),
    ]
    render(<LoanBucketsCard account={{ id: LOAN, type: "loan", currency: "EUR" }} transactions={mixed} format={format} />)
    expect(screen.getByText("€400.00 owed to you · €800.00 you owe")).toBeInTheDocument()
    expect(screen.getByText("€-800.00")).toBeInTheDocument()
    expect(screen.getByText("€1000.00 borrowed · €200.00 given back")).toBeInTheDocument()
    // Alice's line keeps the lending words.
    expect(screen.getByText("€500.00 lent · €100.00 paid back")).toBeInTheDocument()
  })

  it("renders nothing on an account that is not a loan, or has no rows", () => {
    const { container, rerender } = render(
      <LoanBucketsCard account={{ id: LOAN, type: "checking", currency: "EUR" }} transactions={rows} format={format} />,
    )
    expect(container).toBeEmptyDOMElement()
    rerender(<LoanBucketsCard account={{ id: LOAN, type: "loan", currency: "EUR" }} transactions={[]} format={format} />)
    expect(container).toBeEmptyDOMElement()
  })
})
