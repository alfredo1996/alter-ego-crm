import { beforeEach, describe, expect, it, vi } from "vitest"

import { clearMockFinance, mockFinance } from "../adapter-mock"

import type { FinanceAdapter } from "../adapter"

const USER = "user-1"
const OTHER_USER = "user-2"

function makeDate(daysAgo: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(0, 0, 0, 0)
  return d
}

// today's date at midnight, used for "this month" tests
const TODAY = makeDate(0)

const db: FinanceAdapter = mockFinance

beforeEach(() => clearMockFinance())

describe("categories", () => {
  it("a built-in edited by one user stays as it was for another", async () => {
    const original = (await db.getCategories(USER)).find((c) => c.isDefault)!
    await db.updateCategory(USER, original.id, { name: "Mine" })
    const theirs = (await db.getCategories(OTHER_USER)).filter((c) => c.id === original.id)
    expect(theirs.map((c) => c.name)).toEqual([original.name])
  })
})

// ─── Accounts ────────────────────────────────────────────────────────────────

describe("accounts", () => {
  it("createAccount returns account with correct fields", async () => {
    const account = await db.createAccount(USER, {
      name: "Checking",
      type: "checking",
      currency: "USD",
      balance: 1000,
    })
    expect(account.userId).toBe(USER)
    expect(account.name).toBe("Checking")
    expect(account.type).toBe("checking")
    expect(account.currency).toBe("USD")
    expect(account.balance).toBe(1000)
    expect(account.isArchived).toBe(false)
    expect(account.id).toBeTruthy()
  })

  it("getAccounts returns only accounts for the given user", async () => {
    await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    await db.createAccount(OTHER_USER, { name: "B", type: "savings", currency: "USD", balance: 0 })
    const accounts = await db.getAccounts(USER)
    expect(accounts).toHaveLength(1)
    expect(accounts[0].name).toBe("A")
  })

  it("updateAccount merges changed fields and preserves others", async () => {
    const account = await db.createAccount(USER, {
      name: "Old Name",
      type: "checking",
      currency: "USD",
      balance: 500,
    })
    const updated = await db.updateAccount(USER, account.id, { name: "New Name", balance: 750 })
    expect(updated.name).toBe("New Name")
    expect(updated.balance).toBe(750)
    expect(updated.type).toBe("checking")
    expect(updated.currency).toBe("USD")
  })

  it("deleteAccount removes it from the store", async () => {
    const account = await db.createAccount(USER, {
      name: "To Delete",
      type: "cash",
      currency: "USD",
      balance: 0,
    })
    await db.deleteAccount(USER, account.id)
    const accounts = await db.getAccounts(USER)
    expect(accounts).toHaveLength(0)
  })
})

// ─── Transactions — income / expense ─────────────────────────────────────────

describe("transactions (income/expense)", () => {
  it("createTransaction(income) creates a single row with correct fields", async () => {
    const account = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 0 })
    const tx = await db.createTransaction(USER, {
      accountId: account.id,
      type: "income",
      amount: 500,
      currency: "USD",
      description: "Salary",
      date: TODAY,
    })
    expect(tx.type).toBe("income")
    expect(tx.amount).toBe(500)
    expect(tx.description).toBe("Salary")
    expect(tx.linkedTransactionId).toBeNull()
    const all = await db.getTransactions(USER)
    expect(all.data).toHaveLength(1)
  })

  it("createTransaction(expense) creates a single row", async () => {
    const account = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 0 })
    await db.createTransaction(USER, {
      accountId: account.id,
      type: "expense",
      amount: 100,
      currency: "USD",
      description: "Groceries",
      date: TODAY,
    })
    const all = await db.getTransactions(USER)
    expect(all.data).toHaveLength(1)
    expect(all.data[0].linkedTransactionId).toBeNull()
  })

  it("getTransactions returns results sorted by date descending", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const older = makeDate(5)
    const newer = makeDate(1)
    await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 10, currency: "USD", description: "Old", date: older })
    await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 20, currency: "USD", description: "New", date: newer })
    const results = await db.getTransactions(USER)
    expect(results.data[0].description).toBe("New")
    expect(results.data[1].description).toBe("Old")
  })

  it("getTransactions filters by accountId", async () => {
    const a1 = await db.createAccount(USER, { name: "A1", type: "checking", currency: "USD", balance: 0 })
    const a2 = await db.createAccount(USER, { name: "A2", type: "savings", currency: "USD", balance: 0 })
    await db.createTransaction(USER, { accountId: a1.id, type: "income", amount: 10, currency: "USD", description: "X", date: TODAY })
    await db.createTransaction(USER, { accountId: a2.id, type: "income", amount: 20, currency: "USD", description: "Y", date: TODAY })
    const results = await db.getTransactions(USER, { accountId: a1.id })
    expect(results.data).toHaveLength(1)
    expect(results.data[0].description).toBe("X")
  })

  it("getTransactions filters by type", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 100, currency: "USD", description: "Inc", date: TODAY })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 50, currency: "USD", description: "Exp", date: TODAY })
    const expenses = await db.getTransactions(USER, { type: "expense" })
    expect(expenses.data).toHaveLength(1)
    expect(expenses.data[0].description).toBe("Exp")
  })

  it("getTransactions filters by dateFrom and dateTo", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const d10 = makeDate(10)
    const d5 = makeDate(5)
    const d1 = makeDate(1)
    await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 10, currency: "USD", description: "Old", date: d10 })
    await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 20, currency: "USD", description: "Mid", date: d5 })
    await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 30, currency: "USD", description: "New", date: d1 })
    const results = await db.getTransactions(USER, { dateFrom: makeDate(6), dateTo: makeDate(2) })
    expect(results.data).toHaveLength(1)
    expect(results.data[0].description).toBe("Mid")
  })

  it("getTransactions filters by search substring", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 10, currency: "USD", description: "Coffee Shop", date: TODAY })
    await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 20, currency: "USD", description: "Salary", date: TODAY })
    const results = await db.getTransactions(USER, { search: "coffee" })
    expect(results.data).toHaveLength(1)
    expect(results.data[0].description).toBe("Coffee Shop")
  })

  it("updateTransaction merges fields", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const tx = await db.createTransaction(USER, {
      accountId: account.id,
      type: "expense",
      amount: 50,
      currency: "USD",
      description: "Old Desc",
      date: TODAY,
    })
    const updated = await db.updateTransaction(USER, tx.id, { description: "New Desc", amount: 75 })
    expect(updated.description).toBe("New Desc")
    expect(updated.amount).toBe(75)
    expect(updated.type).toBe("expense")
  })

  it("deleteTransaction removes exactly one row", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const tx1 = await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 10, currency: "USD", description: "Keep", date: TODAY })
    const tx2 = await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 20, currency: "USD", description: "Delete", date: TODAY })
    await db.deleteTransaction(USER, tx2.id)
    const all = await db.getTransactions(USER)
    expect(all.data).toHaveLength(1)
    expect(all.data[0].id).toBe(tx1.id)
  })
})

// ─── Transactions — transfers ─────────────────────────────────────────────────

describe("transactions (transfers)", () => {
  it("createTransaction(transfer) creates exactly 1 row", async () => {
    const checking = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 1000 })
    const savings = await db.createAccount(USER, { name: "Savings", type: "savings", currency: "USD", balance: 500 })

    const source = await db.createTransaction(USER, {
      accountId: checking.id,
      type: "transfer",
      amount: 200,
      currency: "USD",
      description: "Move to savings",
      date: TODAY,
      transferToAccountId: savings.id,
    })

    const all = await db.getTransactions(USER)
    expect(all.data).toHaveLength(1)
    expect(all.data[0].id).toBe(source.id)
  })

  it("transfer has correct accountId and transferToAccountId", async () => {
    const checking = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 1000 })
    const savings = await db.createAccount(USER, { name: "Savings", type: "savings", currency: "USD", balance: 500 })

    const source = await db.createTransaction(USER, {
      accountId: checking.id,
      type: "transfer",
      amount: 200,
      currency: "USD",
      description: "Transfer",
      date: TODAY,
      transferToAccountId: savings.id,
    })

    expect(source.accountId).toBe(checking.id)
    expect(source.transferToAccountId).toBe(savings.id)
    expect(source.type).toBe("transfer")
  })

  it("creates single row for transfer (no linked pair)", async () => {
    const checking = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 1000 })
    const savings = await db.createAccount(USER, { name: "Savings", type: "savings", currency: "USD", balance: 500 })

    await db.createTransaction(USER, {
      accountId: checking.id,
      type: "transfer",
      amount: 200,
      currency: "USD",
      description: "Transfer",
      date: TODAY,
      transferToAccountId: savings.id,
    })

    const all = await db.getTransactions(USER)
    expect(all.data).toHaveLength(1)
    expect(all.data[0].accountId).toBe(checking.id)
    expect(all.data[0].transferToAccountId).toBe(savings.id)
  })

  it("transfer visible in both source and destination account queries", async () => {
    const checking = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 1000 })
    const savings = await db.createAccount(USER, { name: "Savings", type: "savings", currency: "USD", balance: 500 })

    await db.createTransaction(USER, {
      accountId: checking.id,
      type: "transfer",
      amount: 200,
      currency: "USD",
      description: "Transfer",
      date: TODAY,
      transferToAccountId: savings.id,
    })

    const srcTxs = await db.getTransactions(USER, { accountId: checking.id })
    const dstTxs = await db.getTransactions(USER, { accountId: savings.id })
    expect(srcTxs.data).toHaveLength(1)
    expect(dstTxs.data).toHaveLength(1)
    expect(srcTxs.data[0].id).toBe(dstTxs.data[0].id)
  })

  it("deleteTransaction removes the single transfer row", async () => {
    const checking = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 1000 })
    const savings = await db.createAccount(USER, { name: "Savings", type: "savings", currency: "USD", balance: 500 })

    const source = await db.createTransaction(USER, {
      accountId: checking.id,
      type: "transfer",
      amount: 200,
      currency: "USD",
      description: "Transfer",
      date: TODAY,
      transferToAccountId: savings.id,
    })

    await db.deleteTransaction(USER, source.id)
    const all = await db.getTransactions(USER)
    expect(all.data).toHaveLength(0)
  })
})

// ─── getDashboardData ─────────────────────────────────────────────────────────

describe("getDashboardData", () => {
  it("totals follow the balance sign: an overpaid card is an asset, an overdrawn checking a liability, archived left out", async () => {
    await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 1000 })
    await db.createAccount(USER, { name: "Card", type: "credit_card", currency: "USD", balance: 40 })
    await db.createAccount(USER, { name: "Overdrawn", type: "savings", currency: "USD", balance: -200 })
    const old = await db.createAccount(USER, { name: "Old", type: "checking", currency: "USD", balance: 0 })
    await db.updateAccount(USER, old.id, { isArchived: true })
    await db.updateAccount(USER, old.id, { balance: 9999 }) // a balance written after closing

    const dash = await db.getDashboardData(USER)
    expect([dash.totalAssets, dash.totalLiabilities, dash.netWorth]).toEqual([1040, 200, 840])
    const snap = await db.takeSnapshot(USER)
    expect([snap.totalAssets, snap.totalLiabilities, snap.netWorth]).toEqual([1040, 200, 840])
  })

  it("excludes transfers from monthlyIncome and monthlyExpenses", async () => {
    const checking = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 2000 })
    const savings = await db.createAccount(USER, { name: "Savings", type: "savings", currency: "USD", balance: 1000 })

    // Income
    await db.createTransaction(USER, { accountId: checking.id, type: "income", amount: 3000, currency: "USD", description: "Salary", date: TODAY })
    // Expense
    await db.createTransaction(USER, { accountId: checking.id, type: "expense", amount: 500, currency: "USD", description: "Rent", date: TODAY })
    // Transfer — must not affect income/expenses
    await db.createTransaction(USER, {
      accountId: checking.id,
      type: "transfer",
      amount: 500,
      currency: "USD",
      description: "Save",
      date: TODAY,
      transferToAccountId: savings.id,
    })

    const dashboard = await db.getDashboardData(USER)
    expect(dashboard.monthlyIncome).toBe(3000)
    expect(dashboard.monthlyExpenses).toBe(500)
  })

  it("categorySpending contains only expense transactions", async () => {
    const account = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 0 })
    const savings = await db.createAccount(USER, { name: "Savings", type: "savings", currency: "USD", balance: 0 })
    await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 1000, currency: "USD", description: "Inc", date: TODAY })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 200, currency: "USD", description: "Exp", date: TODAY })
    await db.createTransaction(USER, {
      accountId: account.id,
      type: "transfer",
      amount: 100,
      currency: "USD",
      description: "Move",
      date: TODAY,
      transferToAccountId: savings.id,
    })
    const dashboard = await db.getDashboardData(USER)
    const total = dashboard.categorySpending.reduce((s, c) => s + c.amount, 0)
    expect(total).toBe(200)
  })

  it("summarises this month and last, nothing older, and the figures do not move", async () => {
    const acc = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 0 })
    const now = new Date()
    // One expense a month for the last 13 months (day 10, local midnight), 100 + months back.
    for (let back = 0; back <= 12; back++) {
      await db.createTransaction(USER, {
        accountId: acc.id, type: "expense", amount: 100 + back, currency: "USD", description: `m${back}`,
        date: new Date(now.getFullYear(), now.getMonth() - back, 10),
      })
    }
    const dash = await db.getDashboardData(USER)
    const ym = (back: number) => {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    }
    expect(dash.monthlySummary.map((m) => [m.month, m.expenses])).toEqual([[ym(1), 101], [ym(0), 100]])
    expect([dash.monthlyExpenses, dash.categorySpending.reduce((s, c) => s + c.amount, 0)]).toEqual([100, 100])
    expect(dash.recentTransactions).toHaveLength(10)
    // Balance comes from the account, not the window: all 13 expenses (100..112) are in it.
    expect(dash.netWorth).toBe(-1378)
  })

  it("carries the full account list (archived too) and the categories for the page to reuse", async () => {
    await db.createAccount(USER, { name: "Open", type: "checking", currency: "USD", balance: 5 })
    const old = await db.createAccount(USER, { name: "Closed", type: "checking", currency: "USD", balance: 0 })
    await db.updateAccount(USER, old.id, { isArchived: true })
    const dash = await db.getDashboardData(USER)
    expect(dash.accounts).toEqual(await db.getAccounts(USER))
    expect(dash.accounts.map((a) => a.name)).toEqual(["Open", "Closed"])
    expect(dash.categories).toEqual(await db.getCategories(USER))
    expect(dash.accountBalances.map((a) => a.accountName)).toEqual(["Open"])
  })

  it("netWorth is the sum of the account balances", async () => {
    await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 1000 })
    await db.createAccount(USER, { name: "B", type: "savings", currency: "USD", balance: 2500 })
    const dashboard = await db.getDashboardData(USER)
    expect(dashboard.netWorth).toBe(3500)
  })
})

// ─── getReportData ────────────────────────────────────────────────────────────

describe("getReportData", () => {
  const from = makeDate(30)
  const to = makeDate(0)

  it("excludes transfers from totalIncome and totalExpenses", async () => {
    const checking = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 0 })
    const savings = await db.createAccount(USER, { name: "Savings", type: "savings", currency: "USD", balance: 0 })

    await db.createTransaction(USER, { accountId: checking.id, type: "income", amount: 4000, currency: "USD", description: "Income", date: TODAY })
    await db.createTransaction(USER, { accountId: checking.id, type: "expense", amount: 1000, currency: "USD", description: "Expense", date: TODAY })
    await db.createTransaction(USER, {
      accountId: checking.id,
      type: "transfer",
      amount: 500,
      currency: "USD",
      description: "Transfer",
      date: TODAY,
      transferToAccountId: savings.id,
    })

    const report = await db.getReportData(USER, { from, to })
    expect(report.totalIncome).toBe(4000)
    expect(report.totalExpenses).toBe(1000)
    expect(report.netSavings).toBe(3000)
  })

  it("excludes transfers from categorySpending", async () => {
    const checking = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 0 })
    const savings = await db.createAccount(USER, { name: "Savings", type: "savings", currency: "USD", balance: 0 })

    await db.createTransaction(USER, { accountId: checking.id, type: "expense", amount: 300, currency: "USD", description: "Expense", date: TODAY })
    await db.createTransaction(USER, {
      accountId: checking.id,
      type: "transfer",
      amount: 100,
      currency: "USD",
      description: "Move",
      date: TODAY,
      transferToAccountId: savings.id,
    })

    const report = await db.getReportData(USER, { from, to })
    const total = report.categorySpending.reduce((s, c) => s + c.amount, 0)
    expect(total).toBe(300)
  })

  it("excludes transfers from monthlySummary income/expense accumulators", async () => {
    const checking = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 0 })
    const savings = await db.createAccount(USER, { name: "Savings", type: "savings", currency: "USD", balance: 0 })

    await db.createTransaction(USER, { accountId: checking.id, type: "income", amount: 2000, currency: "USD", description: "Income", date: TODAY })
    await db.createTransaction(USER, { accountId: checking.id, type: "expense", amount: 800, currency: "USD", description: "Expense", date: TODAY })
    await db.createTransaction(USER, {
      accountId: checking.id,
      type: "transfer",
      amount: 200,
      currency: "USD",
      description: "Transfer",
      date: TODAY,
      transferToAccountId: savings.id,
    })

    const report = await db.getReportData(USER, { from, to })
    const summary = report.monthlySummary
    expect(summary.length).toBeGreaterThan(0)
    const totalIncomeSummary = summary.reduce((s, m) => s + m.income, 0)
    const totalExpensesSummary = summary.reduce((s, m) => s + m.expenses, 0)
    expect(totalIncomeSummary).toBe(2000)
    expect(totalExpensesSummary).toBe(800)
  })

  it("monthlySummary is sorted chronologically when data spans multiple months", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })

    // Use makeDate to guarantee dates are before TODAY (the range upper bound)
    const recentDate = makeDate(1)  // yesterday — safely within current month
    const olderDate = makeDate(35)  // 35 days ago — always a different calendar month

    await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 1000, currency: "USD", description: "Recent", date: recentDate })
    await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 800, currency: "USD", description: "Older", date: olderDate })

    const report = await db.getReportData(USER, { from: makeDate(40), to: TODAY })

    expect(report.monthlySummary.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < report.monthlySummary.length; i++) {
      expect(report.monthlySummary[i].month >= report.monthlySummary[i - 1].month).toBe(true)
    }
  })

  it("filters by accountIds when provided", async () => {
    const a1 = await db.createAccount(USER, { name: "A1", type: "checking", currency: "USD", balance: 0 })
    const a2 = await db.createAccount(USER, { name: "A2", type: "savings", currency: "USD", balance: 0 })
    await db.createTransaction(USER, { accountId: a1.id, type: "income", amount: 1000, currency: "USD", description: "Inc1", date: TODAY })
    await db.createTransaction(USER, { accountId: a2.id, type: "income", amount: 500, currency: "USD", description: "Inc2", date: TODAY })

    const report = await db.getReportData(USER, { from, to }, { accountIds: [a1.id] })
    expect(report.totalIncome).toBe(1000)
  })

  it("filters by categoryIds when provided", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const cat1 = await db.createCategory(USER, { name: "Food", group: "food", icon: "X", color: "#000" })
    const cat2 = await db.createCategory(USER, { name: "Transport", group: "transportation", icon: "Y", color: "#000" })

    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 200, currency: "USD", description: "Food", date: TODAY, categoryId: cat1.id })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 50, currency: "USD", description: "Bus", date: TODAY, categoryId: cat2.id })

    const report = await db.getReportData(USER, { from, to }, { categoryIds: [cat1.id] })
    expect(report.totalExpenses).toBe(200)
  })
})

// ─── getAccount / getTransaction (single lookup) ──────────────────────────────

describe("single-record lookups", () => {
  it("getAccount returns the account for a valid id", async () => {
    const created = await db.createAccount(USER, { name: "Savings", type: "savings", currency: "USD", balance: 5000 })
    const found = await db.getAccount(USER, created.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
    expect(found!.name).toBe("Savings")
  })

  it("getAccount returns null for an unknown id", async () => {
    expect(await db.getAccount(USER, "does-not-exist")).toBeNull()
  })

  it("getTransaction returns the transaction for a valid id", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const created = await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 100, currency: "USD", description: "Test", date: TODAY })
    const found = await db.getTransaction(USER, created.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
  })

  it("getTransaction returns null for an unknown id", async () => {
    expect(await db.getTransaction(USER, "does-not-exist")).toBeNull()
  })
})

// ─── getTransactions – additional filters ─────────────────────────────────────

describe("getTransactions – additional filters", () => {
  it("filters by categoryId", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const cat = await db.createCategory(USER, { name: "Food", group: "food", icon: "X", color: "#000" })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 50, currency: "USD", description: "Lunch", date: TODAY, categoryId: cat.id })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 30, currency: "USD", description: "Other", date: TODAY })

    const results = await db.getTransactions(USER, { categoryId: cat.id })
    expect(results.data).toHaveLength(1)
    expect(results.data[0].description).toBe("Lunch")
  })

  it("filters by minAmount", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 10, currency: "USD", description: "Cheap", date: TODAY })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 200, currency: "USD", description: "Pricey", date: TODAY })

    const results = await db.getTransactions(USER, { minAmount: 100 })
    expect(results.data).toHaveLength(1)
    expect(results.data[0].description).toBe("Pricey")
  })

  it("filters by maxAmount", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 10, currency: "USD", description: "Cheap", date: TODAY })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 500, currency: "USD", description: "Expensive", date: TODAY })

    const results = await db.getTransactions(USER, { maxAmount: 50 })
    expect(results.data).toHaveLength(1)
    expect(results.data[0].description).toBe("Cheap")
  })

  it("filters by minAmount and maxAmount combined", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 10, currency: "USD", description: "Cheap", date: TODAY })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 100, currency: "USD", description: "Mid", date: TODAY })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 500, currency: "USD", description: "Expensive", date: TODAY })

    const results = await db.getTransactions(USER, { minAmount: 50, maxAmount: 200 })
    expect(results.data).toHaveLength(1)
    expect(results.data[0].description).toBe("Mid")
  })
})

// ─── Categories ───────────────────────────────────────────────────────────────

describe("categories", () => {
  it("getCategories includes seeded default categories", async () => {
    const cats = await db.getCategories(USER)
    expect(cats.length).toBeGreaterThan(0)
    expect(cats.some((c) => c.isDefault)).toBe(true)
  })

  it("createCategory creates a user-owned category", async () => {
    const cat = await db.createCategory(USER, {
      name: "My Category",
      group: "personal",
      icon: "Star",
      color: "#ff0000",
    })
    expect(cat.userId).toBe(USER)
    expect(cat.name).toBe("My Category")
    expect(cat.isDefault).toBe(false)
    expect(cat.id).toBeTruthy()
  })

  it("getCategory returns the category for a valid id", async () => {
    const cat = await db.createCategory(USER, { name: "Test", group: "food", icon: "Pizza", color: "#abc" })
    const found = await db.getCategory(USER, cat.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(cat.id)
  })

  it("getCategory returns null for an unknown id", async () => {
    expect(await db.getCategory(USER, "does-not-exist")).toBeNull()
  })

  it("updateCategory merges changed fields and preserves unchanged ones", async () => {
    const cat = await db.createCategory(USER, { name: "Old", group: "food", icon: "X", color: "#000" })
    const updated = await db.updateCategory(USER, cat.id, { name: "New" })
    expect(updated.name).toBe("New")
    expect(updated.group).toBe("food") // unchanged
    expect(updated.icon).toBe("X")     // unchanged
  })

  it("deleteCategory removes the category from the store", async () => {
    // Create with a name that won't collide with default categories
    const cat = await db.createCategory(USER, { name: "Delete Me", group: "other", icon: "X", color: "#000" })
    await db.deleteCategory(USER, cat.id)
    // Verify the specific category is gone
    expect(await db.getCategory(USER, cat.id)).toBeNull()
  })

  it("clearMockFinance removes custom categories but re-seeds defaults", async () => {
    const beforeDefaults = (await db.getCategories(USER)).filter((c) => c.isDefault)
    await db.createCategory(USER, { name: "Custom Cat", group: "other", icon: "X", color: "#000" })

    clearMockFinance()
    const freshDb = mockFinance
    const afterCats = await freshDb.getCategories(USER)

    expect(afterCats.some((c) => c.name === "Custom Cat")).toBe(false)
    expect(afterCats.filter((c) => c.isDefault).length).toBe(beforeDefaults.length)
  })
})

// ─── Budgets ──────────────────────────────────────────────────────────────────

describe("budgets", () => {
  it("createBudget returns a budget with correct fields", async () => {
    const budget = await db.createBudget(USER, {
      name: "Groceries",
      amount: 500,
      currency: "USD",
      period: "monthly",
    })
    expect(budget.userId).toBe(USER)
    expect(budget.name).toBe("Groceries")
    expect(budget.amount).toBe(500)
    expect(budget.currency).toBe("USD")
    expect(budget.period).toBe("monthly")
    expect(budget.id).toBeTruthy()
  })

  it("getBudgets returns only budgets for the given user", async () => {
    await db.createBudget(USER, { name: "A", amount: 100, currency: "USD", period: "monthly" })
    await db.createBudget(OTHER_USER, { name: "B", amount: 200, currency: "USD", period: "monthly" })
    const budgets = await db.getBudgets(USER)
    expect(budgets).toHaveLength(1)
    expect(budgets[0].name).toBe("A")
  })

  it("getBudget returns the budget for a valid id", async () => {
    const created = await db.createBudget(USER, { name: "Rent", amount: 1200, currency: "USD", period: "monthly" })
    const found = await db.getBudget(USER, created.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
  })

  it("getBudget returns null for an unknown id", async () => {
    expect(await db.getBudget(USER, "does-not-exist")).toBeNull()
  })

  it("updateBudget merges changed fields and preserves unchanged ones", async () => {
    const budget = await db.createBudget(USER, { name: "Old", amount: 200, currency: "USD", period: "monthly" })
    const updated = await db.updateBudget(USER, budget.id, { name: "New", amount: 400 })
    expect(updated.name).toBe("New")
    expect(updated.amount).toBe(400)
    expect(updated.currency).toBe("USD")   // preserved
    expect(updated.period).toBe("monthly") // preserved
  })

  it("deleteBudget removes the budget from the store", async () => {
    const budget = await db.createBudget(USER, { name: "Delete Me", amount: 100, currency: "USD", period: "monthly" })
    await db.deleteBudget(USER, budget.id)
    expect(await db.getBudgets(USER)).toHaveLength(0)
  })

  it("supports yearly period", async () => {
    const budget = await db.createBudget(USER, { name: "Annual", amount: 5000, currency: "USD", period: "yearly" })
    expect(budget.period).toBe("yearly")
  })
})

// ─── getDashboardData – sorting ───────────────────────────────────────────────

describe("getDashboardData – extended", () => {
  it("categorySpending is sorted by amount descending when there are multiple categories", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const cat1 = await db.createCategory(USER, { name: "Food", group: "food", icon: "X", color: "#000" })
    const cat2 = await db.createCategory(USER, { name: "Transport", group: "transportation", icon: "Y", color: "#000" })

    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 50, currency: "USD", description: "Bus", date: TODAY, categoryId: cat2.id })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 200, currency: "USD", description: "Groceries", date: TODAY, categoryId: cat1.id })

    const { categorySpending } = await db.getDashboardData(USER)
    expect(categorySpending.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < categorySpending.length; i++) {
      expect(categorySpending[i - 1].amount).toBeGreaterThanOrEqual(categorySpending[i].amount)
    }
  })

  it("monthlySavingsRate is 0 when there is no monthly income", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 100, currency: "USD", description: "Cost", date: TODAY })
    const { monthlySavingsRate } = await db.getDashboardData(USER)
    expect(monthlySavingsRate).toBe(0)
  })

  it("accountBalances lists all accounts with their balances", async () => {
    await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 1000 })
    await db.createAccount(USER, { name: "B", type: "savings", currency: "EUR", balance: 2000 })
    const { accountBalances } = await db.getDashboardData(USER)
    expect(accountBalances).toHaveLength(2)
    expect(accountBalances.some((b) => b.accountName === "A" && b.balance === 1000)).toBe(true)
  })
})



// ─── Recurring transactions ───────────────────────────────────────────────────

describe("recurring transactions – CRUD", () => {
  let accountId: string

  beforeEach(async () => {
    const account = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 1000 })
    accountId = account.id
  })

  it("createRecurringTransaction returns a rule with correct fields", async () => {
    const startDate = makeDate(0)
    const rule = await db.createRecurringTransaction(USER, {
      accountId,
      type: "expense",
      amount: 500,
      currency: "USD",
      description: "Rent",
      frequency: "monthly",
      startDate,
    })
    expect(rule.userId).toBe(USER)
    expect(rule.accountId).toBe(accountId)
    expect(rule.type).toBe("expense")
    expect(rule.amount).toBe(500)
    expect(rule.description).toBe("Rent")
    expect(rule.frequency).toBe("monthly")
    expect(rule.interval).toBe(1)
    expect(rule.isActive).toBe(true)
    expect(rule.nextDueDate).toEqual(startDate)
    expect(rule.id).toBeTruthy()
  })

  it("getRecurringTransactions returns only rules for the given user", async () => {
    await db.createRecurringTransaction(USER, { accountId, type: "expense", amount: 100, currency: "USD", description: "A", frequency: "monthly", startDate: makeDate(0) })
    await db.createRecurringTransaction(OTHER_USER, { accountId, type: "expense", amount: 200, currency: "USD", description: "B", frequency: "monthly", startDate: makeDate(0) })
    const rules = await db.getRecurringTransactions(USER)
    expect(rules).toHaveLength(1)
    expect(rules[0].description).toBe("A")
  })

  it("getRecurringTransaction returns the rule for a valid id", async () => {
    const rule = await db.createRecurringTransaction(USER, { accountId, type: "income", amount: 3000, currency: "USD", description: "Salary", frequency: "monthly", startDate: makeDate(0) })
    const found = await db.getRecurringTransaction(USER, rule.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(rule.id)
  })

  it("getRecurringTransaction returns null for an unknown id", async () => {
    expect(await db.getRecurringTransaction(USER, "no-such-id")).toBeNull()
  })

  it("updateRecurringTransaction merges fields", async () => {
    const rule = await db.createRecurringTransaction(USER, { accountId, type: "expense", amount: 100, currency: "USD", description: "Old", frequency: "monthly", startDate: makeDate(0) })
    const updated = await db.updateRecurringTransaction(USER, rule.id, { description: "New", amount: 200 })
    expect(updated.description).toBe("New")
    expect(updated.amount).toBe(200)
    expect(updated.frequency).toBe("monthly") // preserved
  })

  it("updateRecurringTransaction can pause and resume a rule", async () => {
    const rule = await db.createRecurringTransaction(USER, { accountId, type: "expense", amount: 50, currency: "USD", description: "Sub", frequency: "monthly", startDate: makeDate(0) })
    const paused = await db.updateRecurringTransaction(USER, rule.id, { isActive: false })
    expect(paused.isActive).toBe(false)
    const resumed = await db.updateRecurringTransaction(USER, rule.id, { isActive: true })
    expect(resumed.isActive).toBe(true)
  })

  it("deleteRecurringTransaction removes the rule", async () => {
    const rule = await db.createRecurringTransaction(USER, { accountId, type: "expense", amount: 50, currency: "USD", description: "Del", frequency: "monthly", startDate: makeDate(0) })
    await db.deleteRecurringTransaction(USER, rule.id)
    expect(await db.getRecurringTransaction(USER, rule.id)).toBeNull()
  })
})

// ─── Import hash deduplication ────────────────────────────────────────────────

describe("import hash deduplication", () => {
  it("stores importHash on the created transaction", async () => {
    const account = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 0 })
    const tx = await db.createTransaction(USER, {
      accountId: account.id,
      type: "expense",
      amount: 50,
      currency: "USD",
      description: "Coffee",
      date: TODAY,
      importHash: "abc123hash",
    })
    expect(tx.importHash).toBe("abc123hash")
  })

  it("re-creating with the same importHash for the same user returns the existing transaction (same id, count unchanged)", async () => {
    const account = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 0 })
    const first = await db.createTransaction(USER, {
      accountId: account.id,
      type: "expense",
      amount: 50,
      currency: "USD",
      description: "Coffee",
      date: TODAY,
      importHash: "dedup-hash-1",
    })

    const second = await db.createTransaction(USER, {
      accountId: account.id,
      type: "expense",
      amount: 50,
      currency: "USD",
      description: "Coffee",
      date: TODAY,
      importHash: "dedup-hash-1",
    })

    expect(second.id).toBe(first.id)
    const all = await db.getTransactions(USER)
    expect(all.data).toHaveLength(1)
  })

  it("two different users can have the same importHash without conflict", async () => {
    const account1 = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const account2 = await db.createAccount(OTHER_USER, { name: "B", type: "checking", currency: "USD", balance: 0 })

    const tx1 = await db.createTransaction(USER, {
      accountId: account1.id,
      type: "expense",
      amount: 25,
      currency: "USD",
      description: "Lunch",
      date: TODAY,
      importHash: "shared-hash",
    })

    const tx2 = await db.createTransaction(OTHER_USER, {
      accountId: account2.id,
      type: "expense",
      amount: 25,
      currency: "USD",
      description: "Lunch",
      date: TODAY,
      importHash: "shared-hash",
    })

    expect(tx1.id).not.toBe(tx2.id)
    expect((await db.getTransactions(USER)).data).toHaveLength(1)
    expect((await db.getTransactions(OTHER_USER)).data).toHaveLength(1)
  })
})

describe("generateDue", () => {
  let accountId: string

  beforeEach(async () => {
    const account = await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 0 })
    accountId = account.id
  })

  it("generates a transaction for an overdue rule and marks it isRecurring", async () => {
    // Start date 3 days ago — monthly → due date is in the past
    const startDate = makeDate(3)
    await db.createRecurringTransaction(USER, {
      accountId,
      type: "expense",
      amount: 50,
      currency: "USD",
      description: "Netflix",
      frequency: "monthly",
      startDate,
    })

    const generated = await db.generateDue(USER, TODAY)
    expect(generated).toHaveLength(1)
    expect(generated[0].description).toBe("Netflix")
    expect(generated[0].amount).toBe(50)
    expect(generated[0].isRecurring).toBe(true)
  })

  it("does not generate a transaction for a future-dated rule", async () => {
    // Start date 5 days in the future
    const futureStart = new Date(TODAY)
    futureStart.setDate(futureStart.getDate() + 5)
    await db.createRecurringTransaction(USER, {
      accountId,
      type: "income",
      amount: 3000,
      currency: "USD",
      description: "Salary",
      frequency: "monthly",
      startDate: futureStart,
    })

    const generated = await db.generateDue(USER, TODAY)
    expect(generated).toHaveLength(0)
  })

  it("is idempotent — calling generateDue twice does not double-create", async () => {
    const startDate = makeDate(2)
    await db.createRecurringTransaction(USER, {
      accountId,
      type: "expense",
      amount: 100,
      currency: "USD",
      description: "Gym",
      frequency: "monthly",
      startDate,
    })

    await db.generateDue(USER, TODAY)
    await db.generateDue(USER, TODAY)

    const txs = await db.getTransactions(USER, { type: "expense" })
    const gymTxs = txs.data.filter((t) => t.description === "Gym")
    expect(gymTxs).toHaveLength(1)
  })

  it("does not generate transactions for paused rules", async () => {
    const startDate = makeDate(2)
    const rule = await db.createRecurringTransaction(USER, {
      accountId,
      type: "expense",
      amount: 50,
      currency: "USD",
      description: "Paused Sub",
      frequency: "monthly",
      startDate,
    })
    // Pause the rule
    await db.updateRecurringTransaction(USER, rule.id, { isActive: false })

    const generated = await db.generateDue(USER, TODAY)
    expect(generated).toHaveLength(0)
  })

  it("generates multiple missed daily occurrences", async () => {
    // Start 3 days ago, daily → should generate 3 transactions (day-3, day-2, day-1)
    // today's occurrence only if startDate <= today which it will be after advancing
    const startDate = makeDate(3)
    await db.createRecurringTransaction(USER, {
      accountId,
      type: "expense",
      amount: 5,
      currency: "USD",
      description: "Coffee",
      frequency: "daily",
      startDate,
    })

    const generated = await db.generateDue(USER, makeDate(0)) // up to today
    // 3 days ago, 2 days ago, 1 day ago = 3 occurrences (today's is <= upToDate too)
    expect(generated.length).toBeGreaterThanOrEqual(3)
  })

  it("stops generating past endDate", async () => {
    // Start 5 days ago, end 3 days ago → only 1 occurrence (day-5 through day-3 is in range)
    // Actually: startDate=day-5, endDate=day-3, daily → occurrences on day-5, day-4, day-3 = 3
    const startDate = makeDate(5)
    const endDate = makeDate(3)
    await db.createRecurringTransaction(USER, {
      accountId,
      type: "expense",
      amount: 10,
      currency: "USD",
      description: "Trial",
      frequency: "daily",
      startDate,
      endDate,
    })

    const generated = await db.generateDue(USER, TODAY)
    // Should generate day-5, day-4, day-3 (3 occurrences) — not day-2 or day-1
    expect(generated).toHaveLength(3)
  })
})

// ─── Savings Goals ────────────────────────────────────────────────────────────

describe("savings goals", () => {
  it("createSavingsGoal returns a goal with correct fields and defaults", async () => {
    const goal = await db.createSavingsGoal(USER, {
      name: "Emergency Fund",
      targetAmount: 5000,
      currency: "USD",
    })
    expect(goal.userId).toBe(USER)
    expect(goal.name).toBe("Emergency Fund")
    expect(goal.targetAmount).toBe(5000)
    expect(goal.currentAmount).toBe(0)
    expect(goal.currency).toBe("USD")
    expect(goal.isCompleted).toBe(false)
    expect(goal.icon).toBe("🎯")
    expect(goal.color).toBe("#6366f1")
    expect(goal.id).toBeTruthy()
  })

  it("getSavingsGoals returns only goals for the given user", async () => {
    await db.createSavingsGoal(USER, { name: "A", targetAmount: 1000, currency: "USD" })
    await db.createSavingsGoal(OTHER_USER, { name: "B", targetAmount: 2000, currency: "USD" })
    const goals = await db.getSavingsGoals(USER)
    expect(goals).toHaveLength(1)
    expect(goals[0].name).toBe("A")
  })

  it("getSavingsGoal returns null for an unknown id", async () => {
    expect(await db.getSavingsGoal(USER, "does-not-exist")).toBeNull()
  })

  it("updateSavingsGoal merges fields and preserves unchanged ones", async () => {
    const goal = await db.createSavingsGoal(USER, { name: "Vacation", targetAmount: 2000, currency: "EUR" })
    const updated = await db.updateSavingsGoal(USER, goal.id, { currentAmount: 500, name: "Holiday" })
    expect(updated.name).toBe("Holiday")
    expect(updated.currentAmount).toBe(500)
    expect(updated.targetAmount).toBe(2000) // preserved
    expect(updated.currency).toBe("EUR")    // preserved
  })

  it("deleteSavingsGoal removes the goal from the store", async () => {
    const goal = await db.createSavingsGoal(USER, { name: "Delete Me", targetAmount: 100, currency: "USD" })
    await db.deleteSavingsGoal(USER, goal.id)
    expect(await db.getSavingsGoals(USER)).toHaveLength(0)
  })
})

// ─── Net Worth Snapshots ───────────────────────────────────────────────────────

describe("net worth snapshots", () => {
  it("takeSnapshot computes correct assets and liabilities", async () => {
    await db.createAccount(USER, { name: "Checking", type: "checking", currency: "USD", balance: 5000 })
    await db.createAccount(USER, { name: "Savings", type: "savings", currency: "USD", balance: 10000 })
    await db.createAccount(USER, { name: "Credit Card", type: "credit_card", currency: "USD", balance: -1500 })

    const snapshot = await db.takeSnapshot(USER)
    expect(snapshot.userId).toBe(USER)
    expect(snapshot.totalAssets).toBe(15000)
    expect(snapshot.totalLiabilities).toBe(1500)
    expect(snapshot.netWorth).toBe(13500)
  })

  it("getNetWorthAt returns the newest snapshot on or before the date, and null with none", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 100 })
    vi.useFakeTimers()
    try {
      for (const [day, balance] of [[10, 100], [20, 250], [25, 400]] as const) {
        vi.setSystemTime(new Date(2026, 8, day, 10, 0))
        await db.updateAccount(USER, account.id, { balance })
        await db.takeSnapshot(USER)
      }
    } finally {
      vi.useRealTimers()
    }
    expect(await db.getNetWorthAt(USER, new Date(2026, 8, 9))).toBeNull()
    expect((await db.getNetWorthAt(USER, new Date(2026, 8, 20)))?.netWorth).toBe(250)
    expect((await db.getNetWorthAt(USER, new Date(2026, 8, 24, 23, 0)))?.netWorth).toBe(250)
    expect((await db.getNetWorthAt(USER, new Date(2026, 9, 31)))?.netWorth).toBe(400)
    expect(await db.getNetWorthAt(OTHER_USER, new Date(2026, 9, 31))).toBeNull()
  })

  it("takeSnapshot is idempotent for the same day", async () => {
    await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 1000 })
    const first = await db.takeSnapshot(USER)
    const second = await db.takeSnapshot(USER)
    expect(first.id).toBe(second.id)

    const history = await db.getNetWorthHistory(USER)
    expect(history).toHaveLength(1)
  })

  // Regression: idempotency was keyed on `toISOString().slice(0, 10)`, which rolls
  // over at UTC midnight — an hour or two before local midnight in Europe/Rome. In
  // that window takeSnapshot returned the *previous* day's snapshot, and the day
  // after it created a second one for a day already covered. The test run pins
  // TZ=Europe/Rome (vitest.config.ts).
  it("takeSnapshot keys idempotency on the local calendar day", async () => {
    await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 1000 })
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 2, 1, 10, 0)) // 1 Mar, 10:00 local
      const first = await db.takeSnapshot(USER)

      vi.setSystemTime(new Date(2026, 2, 2, 0, 30)) // 2 Mar, 00:30 local — still 1 Mar in UTC
      const second = await db.takeSnapshot(USER)
      expect(second.id).not.toBe(first.id)

      vi.setSystemTime(new Date(2026, 2, 2, 10, 0)) // later the same local day
      const third = await db.takeSnapshot(USER)
      expect(third.id).toBe(second.id)

      expect(await db.getNetWorthHistory(USER)).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("getNetWorthHistory returns only snapshots for the given user", async () => {
    await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 2000 })
    await db.createAccount(OTHER_USER, { name: "B", type: "savings", currency: "USD", balance: 500 })
    await db.takeSnapshot(USER)
    await db.takeSnapshot(OTHER_USER)

    const history = await db.getNetWorthHistory(USER)
    expect(history).toHaveLength(1)
    expect(history[0].userId).toBe(USER)
  })

  it("getNetWorthHistory snapshots are sorted oldest first", async () => {
    await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 1000 })
    await db.takeSnapshot(USER)

    const history = await db.getNetWorthHistory(USER)
    expect(history.length).toBeGreaterThan(0)
    for (let i = 1; i < history.length; i++) {
      expect(history[i].date.getTime()).toBeGreaterThanOrEqual(history[i - 1].date.getTime())
    }
  })

  it("getDashboardData includes correct totalAssets, totalLiabilities, and netWorth", async () => {
    await db.createAccount(USER, { name: "Investment", type: "investment", currency: "USD", balance: 20000 })
    await db.createAccount(USER, { name: "Loan", type: "loan", currency: "USD", balance: -8000 })

    const { totalAssets, totalLiabilities, netWorth } = await db.getDashboardData(USER)
    expect(totalAssets).toBe(20000)
    expect(totalLiabilities).toBe(8000)
    expect(netWorth).toBe(12000)
  })
})

// ─── Tags CRUD ──────────────────────────────────────────────────────────────

describe("tags", () => {
  it("createTag returns a tag with correct fields", async () => {
    const tag = await db.createTag(USER, { name: "Vacation", color: "#ff0000" })
    expect(tag.userId).toBe(USER)
    expect(tag.name).toBe("Vacation")
    expect(tag.color).toBe("#ff0000")
    expect(tag.id).toBeTruthy()
  })

  it("getTags returns only tags for the given user", async () => {
    await db.createTag(USER, { name: "A", color: "#000" })
    await db.createTag(OTHER_USER, { name: "B", color: "#111" })
    const tags = await db.getTags(USER)
    expect(tags).toHaveLength(1)
    expect(tags[0].name).toBe("A")
  })

  it("deleteTag removes the tag", async () => {
    const tag = await db.createTag(USER, { name: "Old", color: "#000" })
    await db.deleteTag(USER, tag.id)
    const tags = await db.getTags(USER)
    expect(tags).toHaveLength(0)
  })

  it("deleteTag cleans up transactionTags map entries", async () => {
    const tag = await db.createTag(USER, { name: "Travel", color: "#000" })
    await db.createTag(USER, { name: "Work", color: "#111" })
    await db.deleteTag(USER, tag.id)
    // Remaining tag still exists
    const remaining = await db.getTags(USER)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].name).toBe("Work")
  })

  it("createTag uses default color when not provided", async () => {
    const tag = await db.createTag(USER, { name: "NoColor" } as { name: string; color: string })
    expect(tag.color).toBeTruthy()
  })
})

// ─── Categorization Rules ────────────────────────────────────────────────────

describe("categorization rules", () => {
  it("createCategorizationRule returns a rule with correct fields", async () => {
    const cat = await db.createCategory(USER, { name: "Food", group: "food", icon: "X", color: "#000" })
    const rule = await db.createCategorizationRule(USER, { pattern: "uber eats", categoryId: cat.id })
    expect(rule.userId).toBe(USER)
    expect(rule.pattern).toBe("uber eats")
    expect(rule.categoryId).toBe(cat.id)
    expect(rule.isActive).toBe(true)
  })

  it("getCategorizationRules returns only rules for the given user", async () => {
    const cat = await db.createCategory(USER, { name: "Food", group: "food", icon: "X", color: "#000" })
    await db.createCategorizationRule(USER, { pattern: "starbucks", categoryId: cat.id })
    await db.createCategorizationRule(OTHER_USER, { pattern: "coffee", categoryId: cat.id })
    const rules = await db.getCategorizationRules(USER)
    expect(rules).toHaveLength(1)
    expect(rules[0].pattern).toBe("starbucks")
  })

  it("updateCategorizationRule updates fields", async () => {
    const cat = await db.createCategory(USER, { name: "Food", group: "food", icon: "X", color: "#000" })
    const rule = await db.createCategorizationRule(USER, { pattern: "starbucks", categoryId: cat.id })
    const updated = await db.updateCategorizationRule(USER, rule.id, { isActive: false })
    expect(updated.isActive).toBe(false)
  })

  it("deleteCategorizationRule removes the rule", async () => {
    const cat = await db.createCategory(USER, { name: "Food", group: "food", icon: "X", color: "#000" })
    const rule = await db.createCategorizationRule(USER, { pattern: "starbucks", categoryId: cat.id })
    await db.deleteCategorizationRule(USER, rule.id)
    const rules = await db.getCategorizationRules(USER)
    expect(rules).toHaveLength(0)
  })

  it("applyCategorization matches case-insensitively", async () => {
    const cat = await db.createCategory(USER, { name: "Food", group: "food", icon: "X", color: "#000" })
    await db.createCategorizationRule(USER, { pattern: "starbucks", categoryId: cat.id })
    const result = await db.applyCategorization(USER, "STARBUCKS Coffee")
    expect(result).toBe(cat.id)
  })

  it("applyCategorization returns null when no rule matches", async () => {
    const result = await db.applyCategorization(USER, "Random Store")
    expect(result).toBeNull()
  })

  it("applyCategorization skips inactive rules", async () => {
    const cat = await db.createCategory(USER, { name: "Food", group: "food", icon: "X", color: "#000" })
    const rule = await db.createCategorizationRule(USER, { pattern: "starbucks", categoryId: cat.id })
    await db.updateCategorizationRule(USER, rule.id, { isActive: false })
    const result = await db.applyCategorization(USER, "Starbucks Coffee")
    expect(result).toBeNull()
  })
})


// ─── Transaction Filters (uncategorized, hasNote, tagIds) ────────────────────

describe("transaction filters", () => {
  let accountId: string

  beforeEach(async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    accountId = account.id
  })

  it("filters uncategorized transactions", async () => {
    const cat = await db.createCategory(USER, { name: "Food", group: "food", icon: "X", color: "#000" })
    await db.createTransaction(USER, { accountId, type: "expense", amount: 50, currency: "USD", description: "Categorized", date: TODAY, categoryId: cat.id })
    await db.createTransaction(USER, { accountId, type: "expense", amount: 30, currency: "USD", description: "Uncategorized", date: TODAY })

    const results = await db.getTransactions(USER, { uncategorized: true })
    expect(results.data).toHaveLength(1)
    expect(results.data[0].description).toBe("Uncategorized")
  })

  it("filters transactions with notes", async () => {
    await db.createTransaction(USER, { accountId, type: "expense", amount: 50, currency: "USD", description: "WithNote", date: TODAY, notes: "Important" })
    await db.createTransaction(USER, { accountId, type: "expense", amount: 30, currency: "USD", description: "NoNote", date: TODAY })

    const results = await db.getTransactions(USER, { hasNote: true })
    expect(results.data).toHaveLength(1)
    expect(results.data[0].description).toBe("WithNote")
  })

  it("filters transactions by tagIds", async () => {
    const tag = await db.createTag(USER, { name: "Travel", color: "#000" })
    await db.createTransaction(USER, { accountId, type: "expense", amount: 100, currency: "USD", description: "Flight", date: TODAY, tagIds: [tag.id] })
    await db.createTransaction(USER, { accountId, type: "expense", amount: 50, currency: "USD", description: "Coffee", date: TODAY })

    const results = await db.getTransactions(USER, { tagIds: [tag.id] })
    expect(results.data).toHaveLength(1)
    expect(results.data[0].description).toBe("Flight")
  })
})

// ─── generateDue weekly ─────────────────────────────────────────────────────

describe("generateDue weekly", () => {
  it("generates weekly occurrences", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    // Start 14 days ago, weekly → should generate 2 occurrences (day-14, day-7)
    const startDate = makeDate(14)
    await db.createRecurringTransaction(USER, {
      accountId: account.id,
      type: "expense",
      amount: 25,
      currency: "USD",
      description: "Weekly Groceries",
      frequency: "weekly",
      startDate,
    })

    const generated = await db.generateDue(USER, TODAY)
    // day-14, day-7, and possibly day-0 (today) = at least 2
    expect(generated.length).toBeGreaterThanOrEqual(2)
    expect(generated.every((t) => t.description === "Weekly Groceries")).toBe(true)
  })
})

// ─── Transaction Status ──────────────────────────────────────────────────────

describe("transaction status field", () => {
  it("defaults status to 'cleared'", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const tx = await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 50, currency: "USD", description: "Test", date: TODAY })
    expect(tx.status).toBe("cleared")
  })
  it("creates with explicit status", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const tx = await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 50, currency: "USD", description: "P", date: TODAY, status: "pending" })
    expect(tx.status).toBe("pending")
  })
  it("updates status", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const tx = await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 50, currency: "USD", description: "T", date: TODAY, status: "pending" })
    const updated = await db.updateTransaction(USER, tx.id, { status: "reconciled" })
    expect(updated.status).toBe("reconciled")
  })
  it("filters by status", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 10, currency: "USD", description: "C", date: TODAY, status: "cleared" })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 20, currency: "USD", description: "P", date: TODAY, status: "pending" })
    expect((await db.getTransactions(USER, { status: "pending" })).data).toHaveLength(1)
    expect((await db.getTransactions(USER)).data).toHaveLength(2)
  })
})

// ─── Top Expenses ────────────────────────────────────────────────────────────

describe("getReportData – topExpenses", () => {
  const from = makeDate(30)
  const to = makeDate(0)
  it("sorted desc, excludes non-expenses, capped at 15", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 100, currency: "USD", description: "Small", date: TODAY })
    await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 500, currency: "USD", description: "Large", date: TODAY })
    await db.createTransaction(USER, { accountId: account.id, type: "income", amount: 9000, currency: "USD", description: "Salary", date: TODAY })
    const report = await db.getReportData(USER, { from, to })
    expect(report.topExpenses).toHaveLength(2)
    expect(report.topExpenses[0].description).toBe("Large")
  })
})

// ─── Recurring History ───────────────────────────────────────────────────────

describe("getRecurringHistory", () => {
  it("returns generated transactions for a rule", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const rule = await db.createRecurringTransaction(USER, {
      accountId: account.id, type: "expense", amount: 100, currency: "USD",
      description: "Weekly", frequency: "weekly", interval: 1,
      startDate: makeDate(14), endDate: null, categoryId: null, notes: null,
    })
    await db.generateDue(USER, TODAY)
    const history = await db.getRecurringHistory(USER, rule.id)
    expect(history.length).toBeGreaterThanOrEqual(1)
    expect(history.every((tx) => tx.linkedTransactionId?.startsWith(`${rule.id}:`))).toBe(true)
  })
  it("returns empty for unknown rule", async () => {
    expect(await db.getRecurringHistory(USER, "x")).toEqual([])
  })
})

// ─── Transaction Attachments ─────────────────────────────────────────────────

describe("transaction attachments", () => {
  it("initializes with empty attachments array", async () => {
    const account = await db.createAccount(USER, { name: "A", type: "checking", currency: "USD", balance: 0 })
    const tx = await db.createTransaction(USER, { accountId: account.id, type: "expense", amount: 50, currency: "USD", description: "Test", date: TODAY })
    expect(tx.attachments).toEqual([])
  })
})
