import { test, expect, type Page } from "@playwright/test"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

// The page subtitle names the next rule too ("1 running · next: <rule> on 16 Oct"): exact picks the row.
const row = (page: Page, desc: string) => page.getByText(desc, { exact: true })

test.describe("Recurring Transactions", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)

    // Create an account first (required for recurring transactions)
    const accountName = uniqueName("Recurring Test Account")
    await navigateTo(page, "Accounts", "/accounts")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(accountName)
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(accountName).first()).toBeVisible()

    await navigateTo(page, "Recurring", "/recurring")
  })

  test("should show recurring transactions page heading", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: "Recurring Transactions" })).toBeVisible()
  })

  test("should create a new recurring transaction rule", async ({ page }) => {
    const desc = uniqueName("Monthly Rent")
    await page.getByRole("button", { name: /new rule/i }).click()

    await page.getByLabel("Description").fill(desc)
    await page.getByLabel("Amount").fill("1200")

    await page.getByRole("button", { name: /create/i }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(row(page, desc)).toBeVisible()
  })

  test("should show the rule on the Active tab", async ({ page }) => {
    const desc = uniqueName("Netflix")
    await page.getByRole("button", { name: /new rule/i }).click()
    await page.getByLabel("Description").fill(desc)
    await page.getByLabel("Amount").fill("15.99")
    await page.getByRole("button", { name: /create/i }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(row(page, desc)).toBeVisible()
    // It runs: the Active tab is selected and lists it
    await expect(page.getByRole("tab", { name: /^active/i })).toHaveAttribute("aria-selected", "true")
  })

  test("should delete a recurring rule", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "Dropdown menus tested on desktop only")

    const desc = uniqueName("To Delete Rule")
    await page.getByRole("button", { name: /new rule/i }).click()
    await page.getByLabel("Description").fill(desc)
    await page.getByLabel("Amount").fill("50")
    await page.getByRole("button", { name: /create/i }).click()
    await expect(row(page, desc)).toBeVisible()

    await page.getByRole("button", { name: /^delete$/i }).click()
    await page.getByRole("button", { name: /delete rule/i }).click()

    await expect(row(page, desc)).not.toBeVisible()
  })
})

test.describe("Recurring Transactions, history", () => {
  test("a rule's history opens in place under its row", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "Row actions are tested on desktop only")
    await signIn(page)
    await navigateTo(page, "Accounts", "/accounts")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(uniqueName("History Account"))
    await page.getByRole("button", { name: /create account/i }).click()
    await navigateTo(page, "Recurring", "/recurring")
    const desc = uniqueName("Gym")
    await page.getByRole("button", { name: /new rule/i }).click()
    await page.getByLabel("Description").fill(desc)
    await page.getByLabel("Amount").fill("39")
    await page.getByRole("button", { name: /create/i }).click()
    await expect(row(page, desc)).toBeVisible()

    const history = page.getByRole("button", { name: "History" })
    await expect(history).toHaveAttribute("aria-expanded", "false")
    await history.click()
    await expect(history).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })
})

test.describe("Recurring Transactions, deep link", () => {
  test("?tab=suggested opens on the Suggested tab", async ({ page }) => {
    await signIn(page)
    // A client-side hop: page.goto would wipe the mock backend and sign out.
    await navigateTo(page, "Reports", "/reports")
    await page.getByRole("link", { name: "Recurring, under Suggested" }).click()
    await page.waitForURL("**/recurring?tab=suggested")
    await expect(page.getByRole("tab", { name: /^Suggested/ })).toHaveAttribute("aria-selected", "true")
  })
})
