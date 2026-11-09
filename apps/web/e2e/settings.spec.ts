import { test, expect } from "@playwright/test"

import { signIn, navigateTo } from "./helpers/test-utils"

test.describe("Settings", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await navigateTo(page, "Settings", "/settings")
  })

  test("should show settings heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible()
  })

  test("should show profile section", async ({ page }) => {
    await expect(page.getByText(/profile/i).first()).toBeVisible()
    await expect(page.getByText(/email/i).first()).toBeVisible()
  })

  test("should edit profile display name", async ({ page }) => {
    await page.getByRole("button", { name: /edit/i }).first().click()
    const nameInput = page.getByLabel(/display name/i)
    await nameInput.clear()
    await nameInput.fill("Updated Name")
    await page.getByRole("button", { name: /save/i }).click()

    // Should exit edit mode and show success
    await expect(page.getByRole("main").getByText("Updated Name")).toBeVisible()
  })

  test("should cancel profile edit", async ({ page }) => {
    await page.getByRole("button", { name: /edit/i }).first().click()
    await page.getByRole("button", { name: /cancel/i }).click()

    // Should no longer be in edit mode
    await expect(page.getByLabel(/display name/i)).not.toBeVisible()
  })

  test("should toggle theme", async ({ page }) => {
    const darkButton = page.getByRole("button", { name: /dark/i })
    await darkButton.click()
    await expect(darkButton).toHaveAttribute("aria-pressed", "true")

    // Switch back to light
    const lightButton = page.getByRole("button", { name: /light/i })
    await lightButton.click()
    await expect(lightButton).toHaveAttribute("aria-pressed", "true")
  })

  test("should list the sections in an index and keep Data last", async ({ page }) => {
    const index = page.getByRole("navigation", { name: "On this page" })
    await expect(index.getByRole("link")).toHaveText(["Profile", "Preferences", "Modules", "Data"])
    await index.getByRole("link", { name: "Data" }).click()
    await expect(page.getByRole("heading", { level: 2, name: "Data" })).toBeInViewport()
  })

  test("should ask before disconnecting all connectors", async ({ page }) => {
    await page.getByRole("button", { name: "Disconnect All Connectors" }).click()
    await expect(page.getByRole("alertdialog", { name: "Disconnect All Connectors" })).toBeVisible()
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("alertdialog")).toBeHidden()
  })

  test("should create and revoke an API key", async ({ page }) => {
    await page.getByRole("button", { name: "Generate New API Key" }).click()
    await expect(page.getByText("Copy your API key now. It won't be shown again.")).toBeVisible()
    const revoke = page.getByRole("button", { name: /^Revoke key ak_/ })
    await expect(revoke).toHaveCount(1)

    await revoke.click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Revoke", exact: true }).click()
    await expect(page.getByText("API key revoked").first()).toBeVisible()
    await expect(revoke).toHaveCount(0)
  })
})
