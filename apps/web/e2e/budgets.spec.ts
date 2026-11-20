import { test, expect } from "@playwright/test"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

test.describe("Budgets", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await navigateTo(page, "Budgets", "/budgets")
  })

  test("should show budgets page heading", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: "Budgets" })).toBeVisible()
  })

  test("should create a new budget", async ({ page }) => {
    const name = uniqueName("Groceries")
    await page.getByRole("button", { name: /new budget/i }).click()

    await page.getByLabel("Name").fill(name)
    await page.getByLabel("Limit").fill("500")

    await page.getByRole("button", { name: /create budget/i }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.getByText(name)).toBeVisible()
  })

  test("should show budget progress after creation", async ({ page }) => {
    const name = uniqueName("Entertainment")
    await page.getByRole("button", { name: /new budget/i }).click()
    await page.getByLabel("Name").fill(name)
    await page.getByLabel("Limit").fill("200")
    await page.getByRole("button", { name: /create budget/i }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.getByText(name)).toBeVisible()
  })

  test("should edit an existing budget", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "Dropdown menus tested on desktop only")

    const name = uniqueName("Travel")
    const editedName = uniqueName("Travel Fund")

    await page.getByRole("button", { name: /new budget/i }).click()
    await page.getByLabel("Name").fill(name)
    await page.getByLabel("Limit").fill("1000")
    await page.getByRole("button", { name: /create budget/i }).click()
    await expect(page.getByText(name)).toBeVisible()

    await page.getByRole("button", { name: `Actions for ${name}` }).click()
    await page.getByRole("menuitem", { name: /edit/i }).click()

    await page.getByLabel("Name").clear()
    await page.getByLabel("Name").fill(editedName)
    await page.getByRole("button", { name: /save changes/i }).click()

    await expect(page.getByText(editedName)).toBeVisible()
  })

  test("should delete a budget", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "Dropdown menus tested on desktop only")

    const name = uniqueName("To Delete")

    await page.getByRole("button", { name: /new budget/i }).click()
    await page.getByLabel("Name").fill(name)
    await page.getByLabel("Limit").fill("100")
    await page.getByRole("button", { name: /create budget/i }).click()
    await expect(page.getByText(name)).toBeVisible()

    await page.getByRole("button", { name: `Actions for ${name}` }).click()
    await page.getByRole("menuitem", { name: /delete/i }).click()
    await page.getByRole("button", { name: /^delete$/i }).click()

    await expect(page.getByText(name)).not.toBeVisible()
  })
})
