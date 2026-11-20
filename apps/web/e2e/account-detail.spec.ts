import { test, expect } from "@playwright/test"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

test.describe("Account Detail", () => {
  let accountName: string

  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await navigateTo(page, "Accounts", "/accounts")

    // Create an account to navigate into
    accountName = uniqueName("Detail Test Account")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(accountName)
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(accountName).first()).toBeVisible()
  })

  test("should navigate to account detail page", async ({ page }) => {
    await page.getByText(accountName).first().click()
    await expect(page).toHaveURL(/\/accounts\/.+/)
  })

  test("should show account name in detail page", async ({ page }) => {
    await page.getByText(accountName).first().click()
    await expect(page).toHaveURL(/\/accounts\/.+/)
    await expect(page.getByText(accountName).first()).toBeVisible()
  })

  test("should show back to accounts link", async ({ page }) => {
    await page.getByText(accountName).first().click()
    await expect(page).toHaveURL(/\/accounts\/.+/)
    await expect(page.getByRole("link", { name: /back to accounts/i })).toBeVisible()
  })

  test("should show Balance Over Time section", async ({ page }) => {
    await page.getByText(accountName).first().click()
    await expect(page).toHaveURL(/\/accounts\/.+/)
    await expect(page.getByText(/balance over time/i)).toBeVisible()
  })

  test("should show recent transactions section", async ({ page }) => {
    await page.getByText(accountName).first().click()
    await expect(page).toHaveURL(/\/accounts\/.+/)
    await expect(page.getByRole("main").getByText(/^Transactions/).first()).toBeVisible()
  })

  test("should navigate back to accounts list", async ({ page }) => {
    await page.getByText(accountName).first().click()
    await expect(page).toHaveURL(/\/accounts\/.+/)

    await page.getByRole("link", { name: /back to accounts/i }).click()
    await expect(page).toHaveURL("/accounts")
  })

  test("should rename the account from Edit Details", async ({ page }) => {
    await page.getByText(accountName).first().click()
    await expect(page).toHaveURL(/\/accounts\/.+/)
    await page.getByRole("button", { name: "Edit Details" }).click()
    const renamed = uniqueName("Renamed Account")
    await page.getByLabel("Name").fill(renamed)
    await page.getByRole("button", { name: /save changes/i }).click()
    await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible()
  })

  test("should delete the account from More and return to the list", async ({ page }) => {
    await page.getByText(accountName).first().click()
    await expect(page).toHaveURL(/\/accounts\/.+/)
    await page.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: /delete/i }).click()
    await page.getByRole("button", { name: /^delete$/i }).click()
    await expect(page).toHaveURL("/accounts")
    await expect(page.getByText(accountName)).not.toBeVisible()
  })

  test("should open New Transaction from the header", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "A phone has the + in the top bar")
    await page.getByText(accountName).first().click()
    await expect(page).toHaveURL(/\/accounts\/.+/)
    await page.getByRole("button", { name: "New Transaction" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
  })
})
