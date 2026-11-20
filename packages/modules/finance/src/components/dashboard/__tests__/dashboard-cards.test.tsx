import { render, screen, within } from "@testing-library/react"
import { addDays } from "date-fns"
import { describe, expect, it, vi } from "vitest"

import { AccountCardsRow } from "../account-cards-row"
import { BudgetsAtRiskWidget } from "../budgets-at-risk-widget"
import { RecentTransactionsCard } from "../recent-transactions-card"
import { SavingsGoalsWidget } from "../savings-goals-widget"
import { SpendingByCategoryCard } from "../spending-by-category-card"
import { UpcomingBillsWidget } from "../upcoming-bills-widget"

import type { BudgetWithSpending, Category, RecurringTransaction, Transaction, Account } from "../../../types"

const eur = (n: number) => `€${n.toFixed(2)}`

function budget(name: string, spent: number, limit: number): BudgetWithSpending {
  return {
    id: name, name, currency: "EUR", spent, effectiveAmount: limit, amount: limit, percentage: (spent / limit) * 100,
  } as unknown as BudgetWithSpending
}

describe("BudgetsAtRiskWidget", () => {
  const budgets = [
    ...["A", "B", "C", "D"].map((n) => budget(n, 10, 100)),
    budget("Groceries", 195.55, 240),
    budget("Fuel", 130, 120),
  ]

  it("calls a budget with a zero or negative limit and spending Over limit, as the Budgets page does", () => {
    const zero = { ...budget("Zero", 20, 1), effectiveAmount: 0, percentage: 0 }
    const debt = { ...budget("Debt", 1, 1), effectiveAmount: -50, percentage: 0 }
    render(<BudgetsAtRiskWidget budgets={[budget("Fine", 10, 100), zero, debt]} format={eur} />)
    const card = screen.getByRole("region", { name: "Budgets" })
    expect(within(card).getAllByText("Over limit")).toHaveLength(2)
    // Over budgets come first, whatever their percentage.
    expect(within(card).getAllByRole("progressbar").map((p) => p.getAttribute("aria-label")?.split(",")[0])).toEqual(["Zero", "Debt", "Fine"])
  })

  it("lists the five nearest their limit, each with its words and a named bar", () => {
    render(<BudgetsAtRiskWidget budgets={budgets} format={eur} />)
    const card = screen.getByRole("region", { name: "Budgets" })
    expect(within(card).getAllByRole("progressbar")).toHaveLength(5)
    expect(within(card).getByRole("progressbar", { name: "Fuel" })).toHaveAttribute("aria-valuenow", "100")
    expect(within(card).getByRole("progressbar", { name: "Groceries" })).toHaveAttribute("aria-valuenow", "81")
    expect(within(card).getByText("Over limit")).toBeInTheDocument()
    expect(within(card).getByText("Near limit")).toBeInTheDocument()
    expect(within(card).getByText("€195.55 of €240.00")).toBeInTheDocument()
    expect(within(card).getByText("6 budgets · 2 near limit")).toBeInTheDocument()
    expect(within(card).getByRole("link", { name: "View all budgets" })).toHaveAttribute("href", "/budgets")
  })
})

function rule(description: string, inDays: number, amount: number, type: "income" | "expense" = "expense"): RecurringTransaction {
  return { id: description, description, type, amount, currency: "EUR", isActive: true, nextDueDate: addDays(new Date(), inDays) } as RecurringTransaction
}

describe("UpcomingBillsWidget", () => {
  it("puts a pill on a bill due within the week only, leaves income out and totals the bills", () => {
    render(
      <UpcomingBillsWidget
        format={eur}
        rules={[rule("Phone", 2, 12.99), rule("Rent", 17, 950), rule("Salary", 12, 2850, "income"), rule("Gym", 40, 39)]}
      />,
    )
    const card = screen.getByRole("region", { name: "Upcoming Bills" })
    expect(within(card).getByText("In 2 days")).toBeInTheDocument()
    expect(within(card).getByText(/in 17 days/)).toBeInTheDocument()
    expect(within(card).queryByText("Salary")).toBeNull()
    expect(within(card).queryByText("Gym")).toBeNull()
    expect(within(card).getByText("2 bills")).toBeInTheDocument()
    expect(within(card).getByText(/in all/)).toHaveTextContent("−€962.99 in all")
  })
})

describe("SpendingByCategoryCard", () => {
  const cat = (n: number, amount: number) => ({
    categoryId: `c${n}`, categoryName: `Cat ${n}`, categoryIcon: "x", categoryColor: "#000", amount, percentage: amount,
  })

  it("names five categories in distinct hues and folds the rest into one grey line", () => {
    render(<SpendingByCategoryCard period="October" format={eur} categorySpending={[40, 20, 15, 10, 8, 4, 3].map((a, i) => cat(i + 1, a))} />)
    const items = within(screen.getByRole("list")).getAllByRole("listitem")
    expect(items).toHaveLength(6)
    expect(items[5]).toHaveTextContent("Everything else€7.007%")
    const hues = items.slice(0, 5).map((li) => (li.querySelector("[aria-hidden]") as HTMLElement).style.backgroundColor)
    expect(new Set(hues).size).toBe(5)
    expect(screen.getByRole("img")).toHaveAccessibleName(/Spending by category in October, €100\.00 in all: Cat 1 €40\.00 \(40%\)/)
  })

  it("says so, in a line, when nothing was spent", () => {
    render(<SpendingByCategoryCard period="October" format={eur} categorySpending={[]} />)
    expect(screen.getByText("No spending recorded in October yet.")).toBeInTheDocument()
  })
})

describe("RecentTransactionsCard", () => {
  const accounts = [
    { id: "a1", name: "Main Checking" },
    { id: "a2", name: "Rainy Day Savings" },
  ] as Account[]
  const categories = [{ id: "g", name: "Groceries", color: "#e69f00" }] as Category[]
  const tx = (o: Partial<Transaction>) =>
    ({ id: "t", accountId: "a1", currency: "EUR", date: new Date(2026, 9, 13), categoryId: null, transferToAccountId: null, ...o }) as Transaction

  it("signs each row by its type and names a transfer's other account", () => {
    render(
      <RecentTransactionsCard
        accounts={accounts}
        categories={categories}
        format={eur}
        onNewTransaction={vi.fn()}
        recentTransactions={[
          tx({ id: "1", type: "expense", amount: 92.45, description: "Mercato Verde", categoryId: "g" }),
          tx({ id: "2", type: "income", amount: 2850, description: "Salary" }),
          tx({ id: "3", type: "transfer", amount: 400, description: "Monthly saving", transferToAccountId: "a2" }),
        ]}
      />,
    )
    const table = screen.getByRole("table")
    const row = (name: string) => within(table).getByText(name).closest("tr")!
    expect(row("Mercato Verde")).toHaveTextContent("−€92.45")
    expect(row("Mercato Verde")).toHaveTextContent("Groceries")
    expect(row("Salary")).toHaveTextContent("+€2850.00")
    expect(row("Salary")).toHaveTextContent("Uncategorized")
    expect(row("Monthly saving")).toHaveTextContent("€400.00 → moved to Rainy Day Savings")
    expect(row("Monthly saving")).not.toHaveTextContent("+")
    expect(screen.getByText("Last 3 transactions")).toBeInTheDocument()
  })

  it("asks for the first transaction when there are none", () => {
    const onNew = vi.fn()
    render(<RecentTransactionsCard accounts={[]} categories={[]} format={eur} recentTransactions={[]} onNewTransaction={onNew} />)
    screen.getByRole("button", { name: "Add First Transaction" }).click()
    expect(onNew).toHaveBeenCalledOnce()
  })
})

describe("AccountCardsRow", () => {
  it("draws the section bare on a phone and keeps each tile a link, New Account last", () => {
    const balances = [{ accountId: "a1", accountName: "Main Checking", type: "checking", currency: "EUR", balance: 100 }] as never
    render(<AccountCardsRow accountBalances={balances} format={eur} onNewAccount={() => {}} />)
    const card = screen.getByRole("region", { name: "Accounts" })
    expect(card.className).toContain("max-sm:border-0")
    expect(within(card).getByRole("link", { name: /Main Checking/ })).toHaveAttribute("href", "/accounts/a1")
    const last = card.querySelector("button:last-child") as HTMLElement
    expect(last).toHaveTextContent("New Account")
  })

  const bal = (name: string, balance: number) => ({ accountId: name, accountName: name, type: "checking", currency: "EUR", balance })

  it("shows the six largest by absolute balance, a debt included, and no New Account tile", () => {
    const balances = [bal("A", 10), bal("B", 9000), bal("Card", -5000), bal("C", 300), bal("D", 20), bal("E", 4000), bal("F", 1), bal("G", 2500)] as never
    render(<AccountCardsRow accountBalances={balances} format={eur} onNewAccount={() => {}} />)
    const card = screen.getByRole("region", { name: "Accounts" })
    const names = within(card).getAllByRole("link").map((l) => l.getAttribute("href")).filter((h) => h?.startsWith("/accounts/"))
    expect(names).toEqual(["/accounts/B", "/accounts/Card", "/accounts/E", "/accounts/G", "/accounts/C", "/accounts/D"])
    expect(within(card).getByText("8 accounts")).toBeInTheDocument()
    expect(within(card).queryByRole("button", { name: "New Account" })).toBeNull()
  })

  it("lists four accounts, then New Account; ties go by name", () => {
    const balances = [bal("Zed", 50), bal("Amy", 50), bal("Big", 500), bal("Low", 1)] as never
    render(<AccountCardsRow accountBalances={balances} format={eur} onNewAccount={() => {}} />)
    const card = screen.getByRole("region", { name: "Accounts" })
    expect(within(card).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/accounts", "/accounts/Big", "/accounts/Amy", "/accounts/Zed", "/accounts/Low"])
    expect(within(card).getByRole("button", { name: "New Account" })).toBeInTheDocument()
  })

  it("writes a float residue as €0.00 with no minus sign", () => {
    render(<AccountCardsRow accountBalances={[bal("Acc", -2.78e-17)] as never} format={eur} onNewAccount={() => {}} />)
    expect(screen.getByRole("link", { name: /Acc/ })).toHaveTextContent("€0.00")
    expect(screen.getByRole("link", { name: /Acc/ })).not.toHaveTextContent("−")
  })

  // A balance goes either way: the words follow the sign, not the account's kind.
  it.each([
    ["credit_card", -511.96, "Credit Card · you owe this"],
    ["credit_card", 40, "Credit Card · owed to you"], // overpaid
    ["loan", 350, "Loan · owed to you"],
    ["loan", -350, "Loan · you owe this"],
    ["checking", 100, "Checking"],
  ])("reads a %s at %d as '%s'", (type, balance, words) => {
    const balances = [{ accountId: "a1", accountName: "Acc", type, currency: "EUR", balance }] as never
    render(<AccountCardsRow accountBalances={balances} format={eur} onNewAccount={() => {}} />)
    expect(screen.getByRole("link", { name: /Acc/ })).toHaveTextContent(words)
  })
})


describe("SavingsGoalsWidget", () => {
  it("keeps View all on the title's line however long the description is", () => {
    const goal = { id: "g", name: "Holiday", currency: "EUR", currentAmount: 1234567.89, targetAmount: 9999999.99, percentage: 12, isCompleted: false, targetDate: null } as never
    render(<SavingsGoalsWidget goals={[goal]} format={eur} />)
    const link = screen.getByRole("link", { name: "View all goals" })
    // jsdom has no layout: the header must not wrap, and the title block takes the slack.
    const header = link.parentElement?.parentElement
    expect(header).toHaveClass("flex-nowrap", "items-start", "[&>:first-child]:flex-1")
  })
})
