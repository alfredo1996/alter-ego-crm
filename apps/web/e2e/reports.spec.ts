import { test, expect } from "@playwright/test"

import { signIn, navigateTo } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"

test.describe("Reports", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await navigateTo(page, "Reports", "/reports")
  })

  test("should show reports page heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /reports/i })).toBeVisible()
  })

  test("should show period selector", async ({ page }) => {
    // At minimum, the page should load without errors and show the heading + a combobox or select
    await expect(page.getByRole("heading", { name: /reports/i })).toBeVisible()
    await expect(page.locator("[role='combobox'], select").first()).toBeVisible()
  })

  test("should show summary statistics section", async ({ page }) => {
    // Money in, money out and net, signed: in is green and +, out is −
    const strip = page.getByRole("region", { name: "Money in, money out and net" })
    await expect(strip.getByText("Money in", { exact: true })).toBeVisible()
    await expect(strip.getByText("Money out", { exact: true })).toBeVisible()
    await expect(strip.getByText("Net", { exact: true })).toBeVisible()
  })

  test("should name the period in the subtitle and step it by month", async ({ page }) => {
    await expect(page.getByText(/^Where your money went in \w+ \d{4}$/)).toBeVisible()
    const month = page.getByRole("group", { name: "Month" })
    await expect(month.getByRole("button", { name: /^Next month, / })).toBeDisabled()
    const before = await month.locator("span").first().innerText()
    await month.getByRole("button", { name: /^Previous month, / }).click()
    await expect(month.locator("span").first()).not.toHaveText(before)
    await expect(page.getByText(/^Where your money went in /)).toContainText((await month.locator("span").first().innerText()))
  })

  test("should show where the money went in one card", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 2, name: "Where It Went" })).toBeVisible()
    // The e2e user starts with no transactions: the card says so, in the card
    await expect(page.getByRole("region", { name: "Where It Went" }).getByText(/^No spending recorded in /)).toBeVisible()
  })

  test("should offer Compare as a labelled combobox", async ({ page }) => {
    // A phone folds Compare into the Filters sheet
    // The bar renders once the page has its data: decide only then
    await expect(page.getByRole("group", { name: "Report period and filters" })).toBeVisible()
    const filters = page.getByRole("button", { name: /^Filters/ })
    if (await filters.isVisible()) {
      await filters.click()
      await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible()
    }
    await page.getByRole("combobox", { name: "Compare" }).click()
    await page.getByRole("option", { name: "Previous Month" }).click()
    await expect(page.getByRole("combobox", { name: "Compare" })).toContainText("Previous Month")
  })

  test("should show monthly summary section", async ({ page }) => {
    await expect(page.getByText(/monthly|month/i).first()).toBeVisible()
  })

  test("Compare shows its figures, and on a phone a removable chip", async ({ page }) => {
    await page.evaluate(async () => {
      const backend = (window as unknown as { __mockBackend: BackendAdapter }).__mockBackend
      const u = (await backend.auth.getCurrentUser())!.id
      const account = await backend.db.createAccount(u, { name: "Checking", type: "checking", currency: "EUR", balance: 0 })
      const now = new Date()
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      await backend.db.createTransaction(u, { accountId: account.id, type: "expense", amount: 80, currency: "EUR", description: "Groceries", date: lastMonth })
      await backend.db.createTransaction(u, { accountId: account.id, type: "expense", amount: 50, currency: "EUR", description: "Groceries", date: new Date(now.getFullYear(), now.getMonth(), 1) })
    })
    await navigateTo(page, "Accounts", "/accounts")
    await navigateTo(page, "Reports", "/reports")
    await expect(page.getByRole("group", { name: "Report period and filters" })).toBeVisible()
    const filters = page.getByRole("button", { name: /^Filters/ })
    const phone = await filters.isVisible()
    if (phone) {
      await filters.click()
      await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible()
    }
    await page.getByRole("combobox", { name: "Compare" }).click()
    await page.getByRole("option", { name: "Previous Month" }).click()
    // The sheet is modal: close it before reading the page behind
    if (phone) await page.keyboard.press("Escape")
    // The Money out detail names the move against the same days of last month
    await expect(page.getByRole("region", { name: "Money in, money out and net" }).getByText(/less than by|more than by|Same as by/).first()).toBeVisible()
    if (phone) {
      await page.getByRole("button", { name: "Remove Compare: Previous Month" }).click()
      await expect(page.getByRole("button", { name: "Remove Compare: Previous Month" })).toHaveCount(0)
    }
  })

  test("In and Out sets the month against the three before it, as a chart or a table, and Top Expenses lists the largest", async ({ page }) => {
    await page.evaluate(async () => {
      const backend = (window as unknown as { __mockBackend: BackendAdapter }).__mockBackend
      const u = (await backend.auth.getCurrentUser())!.id
      const account = await backend.db.createAccount(u, { name: "Checking", type: "checking", currency: "EUR", balance: 0 })
      const now = new Date()
      for (const [back, type, amount, description] of [
        [0, "income", 3000, "Salary"],
        [0, "expense", 1200, "Rent"],
        [1, "expense", 90, "Groceries"],
      ] as const)
        await backend.db.createTransaction(u, { accountId: account.id, type, amount, currency: "EUR", description, date: new Date(now.getFullYear(), now.getMonth() - back, 1) })
    })
    // The report loaded empty before the seed, and a minute of cache would show it again.
    await page.evaluate(() => (window as unknown as { __clearQueryCache: () => void }).__clearQueryCache())
    await navigateTo(page, "Accounts", "/accounts")
    await navigateTo(page, "Reports", "/reports")
    const overview = page.getByRole("region", { name: "In and Out" })
    await expect(overview.getByRole("img", { name: /^Money in and out by month\./ })).toBeVisible()
    await overview.getByRole("button", { name: "Table" }).click()
    // The header and the four months
    await expect(overview.getByRole("table", { name: "Money in and out by month" }).getByRole("row")).toHaveCount(5)
    await expect(overview.getByRole("img", { name: /^Money in and out/ })).toHaveCount(0)
    // Largest first, signed as money out
    const top = page.getByRole("region", { name: "Top Expenses" })
    await expect(top.getByRole("row").nth(1)).toContainText("−€1,200.00")
    // A phone jumps between sections with chips; a desktop has none
    const sections = page.getByRole("navigation", { name: "Sections" })
    if (await page.getByRole("button", { name: /^Filters/ }).isVisible()) {
      await sections.getByRole("link", { name: /^Top Expenses/ }).click()
      await expect(page).toHaveURL(/#top$/)
    } else {
      await expect(sections).toBeHidden()
    }
    // Open in Transactions keeps the report's month
    await top.getByRole("link", { name: "Open in Transactions" }).click()
    const t = new Date()
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    await expect(page).toHaveURL(new RegExp(`/transactions\\?dateFrom=${iso(new Date(t.getFullYear(), t.getMonth(), 1))}&dateTo=${iso(new Date(t.getFullYear(), t.getMonth() + 1, 0))}$`))
    await expect(page.getByRole("button", { name: /^Remove filter: Dates / })).toBeVisible()
    await expect(page.locator("button:visible", { hasText: "Rent" })).toHaveCount(1)
    await expect(page.getByText("Groceries")).toHaveCount(0)
  })
})
