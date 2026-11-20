import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BudgetsCard } from "../budgets-card"
import { NetWorthCard } from "../net-worth-card"
import { OverviewCard } from "../overview-card"
import { PeriodSelector } from "../period-selector"
import { ReportSections } from "../report-sections"
import { TopTransactionsTable } from "../top-transactions-table"
import { WhereItWentCard } from "../where-it-went-card"

import type { BudgetWithSpending, CategorySpending, Transaction } from "../../../types"

const fmt = (n: number) => `€${n.toFixed(2)}`
const cat = (name: string, amount: number, total = 100): CategorySpending => ({
  categoryId: name,
  categoryName: name,
  categoryColor: "#000000",
  categoryIcon: "",
  amount,
  percentage: (amount / total) * 100,
})
const seven = ["Rent", "Groceries", "Gas", "Dining", "Phone", "Gym", "Transit"].map((n, i) => cat(n, 40 - i * 5, 175))

// happy-dom answers every media query its own way: say what the screen is.
const screenIs = (wide: boolean) => vi.stubGlobal("matchMedia", () => ({ matches: wide }))
afterEach(() => vi.unstubAllGlobals())

describe("WhereItWentCard", () => {
  it("lists the five largest, then the rest under one Everything else row that opens", () => {
    screenIs(false)
    render(<WhereItWentCard data={seven} period="October 2026" format={fmt} />)
    expect(screen.getByRole("heading", { level: 2, name: "Where It Went" })).toBeInTheDocument()
    expect(screen.getByText("€175.00 across 7 categories")).toBeInTheDocument()
    const toggle = screen.getByRole("button", { name: /Everything else/ })
    // A phone starts folded.
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    // Tailwind is not loaded here: the folded list is the one with the `hidden` class.
    const list = document.getElementById(toggle.getAttribute("aria-controls")!)!
    expect(list).toHaveClass("hidden")
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(list).not.toHaveClass("hidden")
    // Gym 15 and Transit 10, of 175 in all: shares are of the whole.
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Gym€15.008.6%", "Transit€10.005.7%"])
  })

  it("starts open on a desktop, where the whole breakdown fits", () => {
    screenIs(true)
    render(<WhereItWentCard data={seven} period="October 2026" format={fmt} />)
    expect(screen.getByRole("button", { name: /Everything else/ })).toHaveAttribute("aria-expanded", "true")
    expect(document.getElementById(screen.getByRole("button", { name: /Everything else/ }).getAttribute("aria-controls")!)).not.toHaveClass("hidden")
  })

  it("shows every category with its amount and one-decimal share when there are five or fewer", () => {
    render(<WhereItWentCard data={[cat("Rent", 950, 1488.93), cat("Coffee", 6.4, 1488.93)]} period="October 2026" format={fmt} />)
    expect(screen.getByText("63.8%")).toBeInTheDocument()
    expect(screen.getByText("0.4%")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Everything else/ })).toBeNull()
  })

  it("says so when nothing was spent", () => {
    render(<WhereItWentCard data={[]} period="October 2026" format={fmt} />)
    expect(screen.getByText("No spending recorded in October 2026.")).toBeInTheDocument()
  })
})

describe("PeriodSelector stepper", () => {
  it("steps by month, naming where each button goes, and stops at the current month", () => {
    const onChange = vi.fn()
    const now = new Date()
    const { rerender } = render(<PeriodSelector value={{ mode: "monthly", year: 2026, month: 1 }} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Previous month, December 2025" }))
    expect(onChange).toHaveBeenCalledWith({ mode: "monthly", year: 2025, month: 12 })
    expect(screen.getByText("January 2026")).toBeInTheDocument()
    rerender(<PeriodSelector value={{ mode: "monthly", year: now.getFullYear(), month: now.getMonth() + 1 }} onChange={onChange} />)
    expect(screen.getByRole("button", { name: /^Next month, / })).toBeDisabled()
  })

  it("steps by year in Yearly, and has no stepper for a rolling window", () => {
    const onChange = vi.fn()
    const { rerender } = render(<PeriodSelector value={{ mode: "yearly", year: 2024 }} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Next year, 2025" }))
    expect(onChange).toHaveBeenCalledWith({ mode: "yearly", year: 2025 })
    rerender(<PeriodSelector value={{ mode: "rolling", months: 3 }} onChange={onChange} />)
    expect(screen.queryByRole("group", { name: "Month" })).toBeNull()
    expect(screen.queryByRole("group", { name: "Year" })).toBeNull()
    expect(screen.getByRole("combobox", { name: "Period type" })).toBeInTheDocument()
  })
})

const eur0 = (n: number) => `€${n.toFixed(2)}`
const months = [
  { month: "2026-08", income: 3450, expenses: 1772.73, net: 1677.27 },
  { month: "2026-09", income: 2850, expenses: 1840.88, net: 1009.12 },
  { month: "2026-10", income: 2850, expenses: 1488.93, net: 1361.07 },
]
const overview = (over: Partial<Parameters<typeof OverviewCard>[0]> = {}) => (
  <OverviewCard
    eyebrow="October so far"
    income={2850}
    expenses={1488.93}
    net={1361.07}
    incomeDetail="Same as by 15 September"
    expensesDetail="€94.10 less than by 15 September"
    netText="You kept 47.8% of what came in"
    months={months}
    focusMonth="2026-10"
    format={eur0}
    whole={(n) => `€${Math.round(n)}`}
    compact={(n) => `€${n}`}
    {...over}
  />
)

describe("OverviewCard", () => {
  it("puts the three figures beside the chart, signed, under the period's eyebrow", () => {
    render(overview())
    expect(screen.getByRole("heading", { level: 2, name: "In and Out" })).toBeInTheDocument()
    expect(screen.getByText("By month, August to October 2026")).toBeInTheDocument()
    const figures = screen.getByRole("region", { name: "Money in, money out and net" })
    expect(within(figures).getByText("October so far")).toBeInTheDocument()
    expect(within(figures).getByText("+€2850.00")).toBeInTheDocument()
    expect(within(figures).getByText("−€1488.93")).toBeInTheDocument()
    expect(within(figures).getByText("+€1361.07")).toBeInTheDocument()
    expect(within(figures).getByText("€94.10 less than by 15 September")).toBeInTheDocument()
    expect(within(figures).getByText("You kept 47.8% of what came in")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /^Money in and out by month\./ })).toBeInTheDocument()
  })

  it("switches to the same months as a table and back", () => {
    render(overview())
    expect(screen.getByRole("button", { name: "Chart" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByRole("button", { name: "Table" }))
    const table = screen.getByRole("table", { name: "Money in and out by month" })
    expect(within(table).getAllByRole("row").map((r) => r.textContent)).toEqual([
      "MonthInOutNet",
      "Aug 2026+€3450.00−€1772.73+€1677.27",
      "Sep 2026+€2850.00−€1840.88+€1009.12",
      "Oct 2026+€2850.00−€1488.93+€1361.07",
    ])
    expect(screen.queryByRole("img", { name: /^Money in and out/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Chart" }))
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("with nothing in any month, says so instead of drawing empty columns", () => {
    render(overview({ months: months.map((m) => ({ ...m, income: 0, expenses: 0, net: 0 })), income: 0, expenses: 0, net: 0 }))
    expect(screen.getByText("No money in or out in these months.")).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: /^Money in and out/ })).toBeNull()
  })

  it("with one month, says to switch to Yearly instead of drawing a single column", () => {
    render(overview({ months: months.slice(2), focusMonth: undefined }))
    expect(screen.getByText(/switch to Yearly/)).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: /^Money in and out/ })).toBeNull()
    expect(screen.getByRole("region", { name: "Money in, money out and net" })).toBeInTheDocument()
  })

  it("on Yearly with one month (January), does not tell the user to switch to Yearly", () => {
    render(overview({ months: months.slice(2), focusMonth: undefined, mode: "yearly" }))
    expect(screen.queryByText(/switch to Yearly/)).toBeNull()
    expect(screen.getByText(/fills in as the months pass/)).toBeInTheDocument()
  })

  it("with no months at all (a future period), says there is nothing to chart", () => {
    render(overview({ months: [], focusMonth: undefined, mode: "yearly" }))
    expect(screen.queryByText(/switch to Yearly/)).toBeNull()
    expect(screen.getByText("Nothing to chart yet.")).toBeInTheDocument()
  })

  it("when the months could not be loaded, says so instead of 'No money in or out'", () => {
    render(overview({ months: months.map((m) => ({ ...m, income: 0, expenses: 0, net: 0 })), monthsFailed: true }))
    expect(screen.getByText("The months could not be loaded.")).toBeInTheDocument()
    expect(screen.queryByText("No money in or out in these months.")).toBeNull()
  })
})

const tx = (i: number, amount: number): Transaction =>
  ({ id: `t${i}`, accountId: "a1", type: "expense", amount, currency: "EUR", description: `Shop ${i}`, date: new Date(2026, 9, i), categoryId: "c1" }) as Transaction

describe("TopTransactionsTable", () => {
  const fifteen = Array.from({ length: 15 }, (_, i) => tx(i + 1, 100 - i))
  const props = {
    categories: [{ id: "c1", name: "Groceries", color: "#e69f00" }] as never,
    accounts: [{ id: "a1", name: "Main Checking" }] as never,
    format: eur0,
    period: "October 2026",
    range: { from: new Date(2026, 9, 1), to: new Date(2026, 9, 31, 23, 59, 59) },
    totalExpenses: 2000,
  }

  it("shows ten of the fifteen largest as a table, with what they add up to, and the rest on request", () => {
    render(<TopTransactionsTable transactions={fifteen} {...props} />)
    expect(screen.getByRole("heading", { level: 2, name: "Top Expenses" })).toBeInTheDocument()
    const table = screen.getByRole("table")
    expect(within(table).getAllByRole("row")).toHaveLength(11)
    // 100 + 99 + ... + 91 = 955, of 2000.
    expect(screen.getByText(/Top 10 of the 15 largest/)).toHaveTextContent("Top 10 of the 15 largest · −€955.00, 47.8% of spending in October 2026")
    expect(within(table).getByText("−€100.00")).toBeInTheDocument()
    expect(within(table).getAllByText("Main Checking").length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("button", { name: "Show All 15" }))
    expect(within(table).getAllByRole("row")).toHaveLength(16)
    fireEvent.click(screen.getByRole("button", { name: "Show Fewer" }))
    expect(within(table).getAllByRole("row")).toHaveLength(11)
  })

  it("opens Transactions on the report's dates", () => {
    render(<TopTransactionsTable transactions={fifteen} {...props} />)
    expect(screen.getByRole("link", { name: "Open in Transactions" })).toHaveAttribute("href", "/transactions?dateFrom=2026-10-01&dateTo=2026-10-31")
  })

  it("with few expenses has no button and says all of them", () => {
    render(<TopTransactionsTable transactions={fifteen.slice(0, 3)} {...props} totalExpenses={297} />)
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull()
    expect(screen.getByText(/^All 3 expenses/)).toHaveTextContent("All 3 expenses · −€297.00, 100.0% of spending in October 2026")
  })
})

const budget = (name: string, spent: number, limit: number): BudgetWithSpending =>
  ({ id: name, name, currency: "EUR", spent, effectiveAmount: limit, amount: limit, remaining: limit - spent, percentage: (spent / limit) * 100, rolloverAmount: 0, categoryId: null, period: "monthly" }) as never

describe("BudgetsCard", () => {
  const budgets = [budget("Coffee", 6.4, 40), budget("Groceries", 195.55, 240), budget("Fuel", 61, 120), budget("Dining", 150, 100)]

  it("calls a budget spent to exactly its limit Over limit", () => {
    render(<BudgetsCard budgets={[budget("Rent", 500, 500)]} currency="EUR" format={eur0} />)
    expect(screen.getByText("Over limit")).toBeInTheDocument()
  })

  it("calls a budget with a zero limit and spending Over by the amount, and lists it first", () => {
    const zero = { ...budget("Zero", 20, 1), effectiveAmount: 0, percentage: 0 }
    render(<BudgetsCard budgets={[budget("Coffee", 6.4, 40), zero]} currency="EUR" format={eur0} />)
    expect(screen.getByText("Over by €20.00")).toBeInTheDocument()
    expect(screen.getAllByRole("progressbar")[0]).toHaveAttribute("aria-label", expect.stringMatching(/^Zero,/))
  })

  it.each([
    { limit: -50, spent: 0, pill: null },
    { limit: -50, spent: 1, pill: "Over by €51.00" },
  ])("limit $limit, spent $spent shows $pill", ({ limit, spent, pill }) => {
    const b = { ...budget("Debt", spent, 1), effectiveAmount: limit, percentage: 0 }
    render(<BudgetsCard budgets={[b]} currency="EUR" format={eur0} />)
    if (pill) expect(screen.getByText(pill)).toBeInTheDocument()
    else expect(screen.queryByText(/^Over/)).toBeNull()
  })

  it("lists the fullest first with how far, names the state in words, and totals", () => {
    render(<BudgetsCard budgets={budgets} currency="EUR" format={eur0} />)
    expect(screen.getByRole("heading", { level: 2, name: "Budgets This Period" })).toBeInTheDocument()
    expect(screen.getAllByRole("progressbar").map((p) => p.getAttribute("aria-label"))).toEqual([
      "Dining, 150% of the limit used",
      "Groceries, 81% of the limit used",
      "Fuel, 51% of the limit used",
      "Coffee, 16% of the limit used",
    ])
    expect(screen.getByText("Near limit")).toBeInTheDocument()
    expect(screen.getByText("Over by €50.00")).toBeInTheDocument()
    expect(screen.getByText("€195.55 of €240.00")).toBeInTheDocument()
    expect(screen.getByText("4 budgets · 1 near limit · 1 over")).toBeInTheDocument()
    expect(screen.getByText("€412.95 of €500.00 spent")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open Budgets" })).toHaveAttribute("href", "/budgets")
  })
})

describe("NetWorthCard", () => {
  const snap = (m: number, d: number, netWorth: number, a = 0, l = 0) => ({ id: `${m}-${d}`, userId: "u", date: new Date(2026, m, d), netWorth, totalAssets: a, totalLiabilities: l })

  it("heads with today's figure, how far it moved since the month before, and assets against debts", () => {
    // Two snapshots in September: only the last stands for the month end.
    const data = [snap(8, 12, 15000), snap(8, 30, 15405.61), snap(9, 15, 16766.68, 17278.64, 511.96)]
    render(<NetWorthCard data={data} format={eur0} whole={(n) => `€${Math.round(n)}`} compact={(n) => `€${n}`} />)
    expect(screen.getByRole("heading", { level: 2, name: "Net Worth" })).toBeInTheDocument()
    expect(screen.getByText("€16766.68")).toBeInTheDocument()
    expect(screen.getByText("Up €1361.07 since 30 September")).toBeInTheDocument()
    expect(screen.getByText("€17278.64")).toBeInTheDocument()
    expect(screen.getByText("€511.96")).toBeInTheDocument()
    expect(document.querySelectorAll("svg circle")).toHaveLength(2)
  })

  it("with one snapshot says the line begins with the next, and with none, that there is no history yet", () => {
    const { rerender } = render(<NetWorthCard data={[snap(9, 15, 100)]} format={eur0} whole={(n) => `€${Math.round(n)}`} compact={(n) => `€${n}`} />)
    expect(screen.getByText("One snapshot so far: the line appears once there is a second.")).toBeInTheDocument()
    rerender(<NetWorthCard data={[]} format={eur0} whole={(n) => `€${Math.round(n)}`} compact={(n) => `€${n}`} />)
    expect(screen.getByText(/No net worth history yet/)).toBeInTheDocument()
  })
})

describe("ReportSections", () => {
  it("is a nav of anchors with counts, for a phone", () => {
    render(<ReportSections items={[{ id: "overview", label: "In and Out" }, { id: "where", label: "Where It Went", count: 12 }]} />)
    const nav = screen.getByRole("navigation", { name: "Sections" })
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["In and Out", "#overview"],
      ["Where It Went12", "#where"],
    ])
  })
})
