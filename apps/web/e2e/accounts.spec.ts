import { test, expect } from "@playwright/test"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

test.describe("Accounts", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await navigateTo(page, "Accounts", "/accounts")
  })

  test("should create a new account", async ({ page }) => {
    const name = uniqueName("Test Checking")
    await page.getByRole("button", { name: /new account/i }).click()

    await page.getByLabel("Name").fill(name)
    await page.getByRole("button", { name: /create account/i }).click()

    await expect(page.getByText(name)).toBeVisible()
  })

  test("should show account in the list after creation", async ({ page }) => {
    const name = uniqueName("My Savings")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(name)
    await page.getByRole("button", { name: /create account/i }).click()

    await expect(page.getByText(name)).toBeVisible()
  })

  test("should show when an account last moved", async ({ page }) => {
    const name = uniqueName("Moving Account")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(name)
    await page.getByRole("button", { name: /create account/i }).click()
    const card = page.getByRole("article", { name })
    await expect(card.getByText("No activity yet")).toBeVisible()

    await navigateTo(page, "Transactions", "/transactions")
    await page.getByRole("button", { name: /new transaction/i }).click()
    await page.getByLabel("Description").fill(uniqueName("Coffee"))
    await page.getByLabel("Amount").fill("5")
    await page.getByRole("button", { name: /add transaction/i }).click()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    await navigateTo(page, "Accounts", "/accounts")
    await expect(page.getByRole("article", { name }).getByText(/^Last activity \d{1,2} \w{3}$/)).toBeVisible()
  })

  test("should edit an existing account", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "Dropdown menus tested on desktop only")

    const oldName = uniqueName("Old Name")
    const newName = uniqueName("New Name")

    // Create an account first
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(oldName)
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(oldName)).toBeVisible()

    // Open dropdown menu and click Edit
    await page.getByRole("button", { name: /actions/i }).first().click()
    await page.getByRole("menuitem", { name: /edit/i }).click()

    // Exact: the card of an account called "Old Name ..." is itself labelled by that name.
    await page.getByLabel("Name", { exact: true }).clear()
    await page.getByLabel("Name", { exact: true }).fill(newName)
    await page.getByRole("button", { name: /save changes/i }).click()

    await expect(page.getByText(newName)).toBeVisible()
  })

  test("should delete an account", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "Dropdown menus tested on desktop only")

    const name = uniqueName("To Delete")

    // Create an account first
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(name)
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(name)).toBeVisible()

    // Open dropdown menu and click Delete
    await page.getByRole("button", { name: /actions/i }).first().click()
    await page.getByRole("menuitem", { name: /delete/i }).click()

    // Confirm deletion in alert dialog
    await page.getByRole("button", { name: /^delete$/i }).click()

    await expect(page.getByText(name)).not.toBeVisible()
  })

  test("should keep an archived account behind the Archived tab", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "Dropdown menus tested on desktop only")

    const name = uniqueName("To Archive")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(name)
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(name)).toBeVisible()

    await page.getByRole("button", { name: `Actions for ${name}` }).click()
    await page.getByRole("menuitem", { name: /archive/i }).click()

    await expect(page.getByText(name)).not.toBeVisible()
    await page.getByRole("tab", { name: /^Archived/ }).click()
    await expect(page.getByRole("link", { name })).toBeVisible()
  })

  test("an overpaid card is owed to you and is not counted as debt", async ({ page }) => {
    const name = uniqueName("Overpaid Card")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(name)
    await page.getByLabel("Type").fill("credit_card")
    await page.getByLabel("Balance").fill("40")
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByRole("article", { name })).toContainText("owed to you")
  })
})
