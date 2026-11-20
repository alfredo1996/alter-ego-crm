import { test, expect } from "@playwright/test"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

test.describe("Categories", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await navigateTo(page, "Categories", "/categories")
  })

  test("should show categories heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /categories/i })).toBeVisible()
  })

  test("should display default categories", async ({ page }) => {
    // Default categories are seeded — at least some should be visible
    await expect(page.getByText(/housing/i).first()).toBeVisible()
  })

  test("should create a new category", async ({ page }) => {
    const catName = uniqueName("TestCategory")
    await page.getByRole("button", { name: /new category/i }).click()
    await page.getByLabel("Name", { exact: true }).fill(catName)

    // Submit the form
    await page.getByRole("button", { name: /create/i }).click()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    // Verify it appears in the list
    await expect(page.getByText(catName).first()).toBeVisible()
  })

  test("should delete a custom category", async ({ page }) => {
    const catName = uniqueName("DeleteMe")
    await page.getByRole("button", { name: /new category/i }).click()
    await page.getByLabel("Name", { exact: true }).fill(catName)
    await page.getByRole("button", { name: /create/i }).click()
    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.getByText(catName)).toBeVisible()

    await page.getByRole("button", { name: `Actions for ${catName}` }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()

    await expect(page.getByText(catName)).toHaveCount(0)
  })

  test("should group categories in cards, custom ones with their own actions", async ({ page }) => {
    const housing = page.getByRole("region", { name: "Housing" })
    await expect(housing.getByRole("link", { name: "Rent" })).toHaveAttribute("href", /\/transactions\?categoryId=/)
    // A built-in has Edit and Reset to Default, never Delete.
    await housing.getByRole("button", { name: "Actions for Rent" }).click()
    await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0)
    await expect(page.getByRole("menuitem", { name: "Reset to Default" })).toHaveCount(0) // nothing edited yet
    await page.keyboard.press("Escape")

    const catName = uniqueName("Mine")
    await page.getByRole("button", { name: /new category/i }).click()
    await page.getByLabel("Name", { exact: true }).fill(catName)
    await page.getByRole("button", { name: /create/i }).click()
    await expect(page.getByRole("button", { name: `Actions for ${catName}` })).toBeVisible()
  })

  test("should search and filter by kind", async ({ page }) => {
    await page.getByRole("searchbox", { name: "Search categories" }).fill("rent")
    await expect(page.getByRole("link", { name: "Rent", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Groceries" })).toHaveCount(0)
    await page.getByRole("searchbox", { name: "Search categories" }).fill("zzzz-nothing")
    await expect(page.getByText(/no categories match/i)).toBeVisible()

    await page.getByRole("searchbox", { name: "Search categories" }).fill("")
    await page.getByRole("tab", { name: /^Income/ }).click()
    await expect(page.getByRole("link", { name: "Salary", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Rent", exact: true })).toHaveCount(0)
  })

  test("should edit a custom category", async ({ page }) => {
    const catName = uniqueName("EditMe")
    await page.getByRole("button", { name: /new category/i }).click()
    await page.getByLabel("Name", { exact: true }).fill(catName)
    await page.getByRole("button", { name: /create/i }).click()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    await page.getByRole("button", { name: `Actions for ${catName}` }).click()
    await page.getByRole("menuitem", { name: "Edit" }).click()
    await expect(page.getByLabel("Icon Name")).toHaveCount(0)
    await page.getByLabel("Name", { exact: true }).fill(`${catName} Renamed`)
    await page.getByRole("button", { name: "Save Changes" }).click()
    await expect(page.getByRole("link", { name: `${catName} Renamed` })).toBeVisible()
  })

  test("should edit a built-in as your own copy, keep its transactions on it, and reset it", async ({ page }) => {
    // Restaurants: its icon (UtensilsCrossed) is the long one the Firebase create rule once refused.
    const food = page.getByRole("region", { name: "Food" })
    const href = await food.getByRole("link", { name: "Restaurants", exact: true }).getAttribute("href")
    const newName = uniqueName("Eating Out")
    const desc = uniqueName("Lunch")

    // A transaction needs an account.
    const accountName = uniqueName("Test Account")
    await navigateTo(page, "Accounts", "/accounts")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(accountName)
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(accountName).first()).toBeVisible()

    await navigateTo(page, "Transactions", "/transactions")
    await page.getByRole("button", { name: /new transaction/i }).click()
    await page.getByLabel("Description").fill(desc)
    await page.getByLabel("Amount").fill("12")
    await page.getByRole("dialog").getByText("Select category...").click()
    await page.getByPlaceholder("Search categories...").fill("Restaurants")
    await page.getByRole("option", { name: /Restaurants/ }).click()
    await page.getByRole("button", { name: /add transaction/i }).click()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    await navigateTo(page, "Categories", "/categories")
    await page.getByRole("button", { name: "Actions for Restaurants" }).click()
    await page.getByRole("menuitem", { name: "Edit" }).click()
    await page.getByLabel("Name", { exact: true }).fill(newName)
    await page.getByRole("button", { name: "Save Changes" }).click()
    // Same id, so every transaction and budget pointing at it still does.
    await expect(page.getByRole("link", { name: newName })).toHaveAttribute("href", href!)
    await expect(page.getByRole("link", { name: "Restaurants", exact: true })).toHaveCount(0)

    await navigateTo(page, "Transactions", "/transactions")
    await expect(page.getByText(desc).locator("visible=true").first()).toBeVisible()
    await expect(page.getByText(newName).locator("visible=true").first()).toBeVisible()

    await navigateTo(page, "Categories", "/categories")
    await page.getByRole("button", { name: `Actions for ${newName}` }).click()
    await page.getByRole("menuitem", { name: "Reset to Default" }).click()
    await expect(page.getByRole("link", { name: "Restaurants", exact: true })).toHaveAttribute("href", href!)
    await expect(page.getByText(newName)).toHaveCount(0)
  })
})
