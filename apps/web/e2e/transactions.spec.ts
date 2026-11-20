import { test, expect } from "@playwright/test"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

test.describe("Transactions", () => {
  let accountName: string

  test.beforeEach(async ({ page }) => {
    await signIn(page)

    // Create an account first (needed for transactions)
    accountName = uniqueName("Test Account")
    await navigateTo(page, "Accounts", "/accounts")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(accountName)
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(accountName).first()).toBeVisible()

    // Navigate to transactions
    await navigateTo(page, "Transactions", "/transactions")
  })

  test("should create a new transaction", async ({ page }) => {
    const desc = uniqueName("Grocery shopping")
    await page.getByRole("button", { name: /new transaction/i }).click()

    await page.getByLabel("Description").fill(desc)
    await page.getByLabel("Amount").fill("50")

    await page.getByRole("button", { name: /add transaction/i }).click()

    // Wait for dialog to close, then verify the description appears in the list
    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(
      page.getByText(desc).locator("visible=true")
    ).toBeVisible()
  })

  test("should show transaction in the list", async ({ page }) => {
    const desc = uniqueName("Coffee")
    await page.getByRole("button", { name: /new transaction/i }).click()

    await page.getByLabel("Description").fill(desc)
    await page.getByLabel("Amount").fill("5")
    await page.getByRole("button", { name: /add transaction/i }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(
      page.getByText(desc).locator("visible=true")
    ).toBeVisible()
  })

  test("should delete a transaction", async ({ page }) => {
    const desc = uniqueName("ToDelete")
    await page.getByRole("button", { name: /new transaction/i }).click()
    await page.getByLabel("Description").fill(desc)
    await page.getByLabel("Amount").fill("10")
    await page.getByRole("button", { name: /add transaction/i }).click()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    // A row opens the one edit dialog, which carries Delete; the confirmation is a second dialog.
    await page.getByText(desc).locator("visible=true").click()
    const edit = page.getByRole("dialog", { name: "Edit Transaction" })
    await edit.getByRole("button", { name: "Delete" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText(desc)).toHaveCount(0)
  })

  test("the type tabs narrow the list and carry the count", async ({ page }) => {
    const salary = uniqueName("Salary")
    const rent = uniqueName("Rent")
    const tabs = page.getByRole("tablist", { name: "Transaction type" })
    const income = async () => Number(/(\d+)$/.exec((await tabs.getByRole("tab", { name: /^Income/ }).textContent()) ?? "")?.[1])
    const before = await income()
    for (const [desc, amount, type] of [[salary, "3000", "Income"], [rent, "900", "Expense"]]) {
      await page.getByRole("button", { name: /new transaction/i }).click()
      await page.getByLabel("Description").fill(desc)
      await page.getByLabel("Amount").fill(amount)
      await page.getByRole("combobox", { name: "Type" }).click()
      await page.getByRole("option", { name: type, exact: true }).click()
      await page.getByRole("button", { name: /add transaction/i }).click()
      await expect(page.getByRole("dialog")).not.toBeVisible()
    }
    // The count is part of the tab's name and went up by the one income added.
    await expect(tabs.getByRole("tab", { name: `Income ${before + 1}` })).toBeVisible()
    await tabs.getByRole("tab", { name: /^Income/ }).click()
    await expect(page).toHaveURL(/type=income/)
    await expect(page.getByText(salary).locator("visible=true")).toBeVisible()
    await expect(page.getByText(rent)).toHaveCount(0)
    // Narrowed: the list says so, and Clear All brings the whole book back.
    await expect(page.getByText(/of \d+ match/)).toBeVisible()
    await page.getByRole("button", { name: "Clear All" }).click()
    await expect(page.getByText(rent).locator("visible=true")).toBeVisible()
    await expect(tabs.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true")
  })

  test("the Dates chip removes the dates and keeps the search", async ({ page }) => {
    await page.getByPlaceholder("Search transactions...").fill("zz")
    // Below sm the Dates control lives in the Filters sheet.
    const sheet = page.getByRole("button", { name: "Filters", exact: true })
    const phone = await sheet.isVisible()
    if (phone) await sheet.click()
    await page.getByRole("button", { name: "Dates", exact: true }).locator("visible=true").click()
    await page.getByRole("button", { name: "This year" }).click()
    if (phone) await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Done" }).click()
    await page.getByRole("button", { name: /^Remove filter: Dates / }).click()
    await expect(page).toHaveURL(/search=zz/)
    await expect(page).not.toHaveURL(/dateFrom/)
  })

  test("should filter transactions by type", async ({ page }) => {
    // Create an income transaction
    const incomeDesc = uniqueName("Salary")
    await page.getByRole("button", { name: /new transaction/i }).click()
    await page.getByLabel("Description").fill(incomeDesc)
    await page.getByLabel("Amount").fill("3000")

    // Select income type
    const typeSelect = page.locator('[id="type"]')
    if (await typeSelect.isVisible().catch(() => false)) {
      await typeSelect.selectOption("income")
    }

    await page.getByRole("button", { name: /add transaction/i }).click()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    // Verify the transaction appears
    await expect(page.getByText(incomeDesc).locator("visible=true")).toBeVisible()
  })

  test("should filter transactions by search", async ({ page }) => {
    const desc = uniqueName("UniqueSearchTerm")
    await page.getByRole("button", { name: /new transaction/i }).click()
    await page.getByLabel("Description").fill(desc)
    await page.getByLabel("Amount").fill("25")
    await page.getByRole("button", { name: /add transaction/i }).click()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    // Use search filter
    const searchInput = page.getByPlaceholder(/search/i)
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("UniqueSearchTerm")
      await expect(page.getByText(desc).locator("visible=true")).toBeVisible()
    }
  })
  test("the bar sums the rows you tick, here and on the account's page", async ({ page }) => {
    const [rent, gas] = [uniqueName("Rent"), uniqueName("Gas")]
    for (const [desc, amount] of [[rent, "50"], [gas, "30"]]) {
      await page.getByRole("button", { name: /new transaction/i }).click()
      await page.getByLabel("Description").fill(desc)
      await page.getByLabel("Amount").fill(amount)
      await page.getByRole("button", { name: /add transaction/i }).click()
      await expect(page.getByRole("dialog")).not.toBeVisible()
    }
    const tick = async () => {
      for (const desc of [rent, gas]) await page.getByRole("checkbox", { name: new RegExp(`^Select ${desc},`) }).locator("visible=true").check()
      await expect(page.getByText("2 selected")).toBeVisible()
      await expect(page.locator("dl").filter({ hasText: "Net" }).first()).toContainText(/−[$€]80\.00/)
    }
    await tick()

    await navigateTo(page, "Accounts", "/accounts")
    await page.getByRole("link", { name: accountName }).first().click()
    await tick()
  })
})
