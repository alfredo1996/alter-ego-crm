import { test, expect } from "@playwright/test"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"


test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("should show dashboard heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /dashboard/i })
    ).toBeVisible()
  })

  test("should display empty state when no accounts exist", async ({ page }) => {
    await expect(page.getByText(/get started/i)).toBeVisible()
  })

  test("should show account balances after creating an account", async ({ page }) => {
    // Create an account first
    const accountName = uniqueName("DashAccount")
    await navigateTo(page, "Accounts", "/accounts")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(accountName)
    await page.getByLabel("Balance").fill("5000")
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(accountName).first()).toBeVisible()

    // Go back to dashboard
    await navigateTo(page, "Dashboard", "/dashboard")

    // Should show the total balance area (not the empty state)
    await expect(page.getByText("Net worth", { exact: true })).toBeVisible()
  })

  test("should show net worth section when accounts exist", async ({ page }) => {
    const accountName = uniqueName("NetWorthAccount")
    await navigateTo(page, "Accounts", "/accounts")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(accountName)
    await page.getByLabel("Balance").fill("10000")
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(accountName).first()).toBeVisible()

    await navigateTo(page, "Dashboard", "/dashboard")
    await expect(page.getByText(/assets/i).first()).toBeVisible()
    await expect(page.getByText("Net worth", { exact: true }).first()).toBeVisible()
  })

  test("New Transaction adds to Recent Activity, and the account tile opens its page", async ({ page }) => {
    const accountName = uniqueName("TileAccount")
    await page.getByRole("button", { name: "Add Your First Account" }).click()
    await page.getByLabel("Name").fill(accountName)
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByRole("link", { name: new RegExp(accountName) })).toBeVisible()

    // The header's button on a desktop, the top bar's + on a phone: one of them shows.
    const description = uniqueName("Tile Coffee")
    await page.getByRole("button", { name: "New Transaction" }).click()
    await page.getByLabel("Description").fill(description)
    await page.getByLabel("Amount").fill("4")
    await page.getByRole("button", { name: "Add Transaction" }).click()
    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.getByRole("region", { name: "Recent Activity" }).getByText(description).locator("visible=true")).toBeVisible()

    await page.getByRole("link", { name: new RegExp(accountName) }).click()
    await expect(page).toHaveURL(/\/accounts\/[^/]+$/)
  })

  test("the Accounts card shows at most six accounts and no New Account tile past six", async ({ page }) => {
    await navigateTo(page, "Accounts", "/accounts")
    for (let n = 1; n <= 7; n++) {
      await page.getByRole("button", { name: /new account/i }).first().click()
      await page.getByLabel("Name").fill(uniqueName(`Cap${n}`))
      await page.getByLabel("Balance").fill(String(n * 100))
      await page.getByRole("button", { name: /create account/i }).click()
      await expect(page.getByRole("dialog")).not.toBeVisible()
    }
    await navigateTo(page, "Dashboard", "/dashboard")
    const card = page.getByRole("region", { name: "Accounts" })
    await expect(card.getByText("7 accounts")).toBeVisible()
    await expect(card.locator('a[href^="/accounts/"]')).toHaveCount(6)
    await expect(card.getByRole("button", { name: "New Account" })).toHaveCount(0)
  })
})
