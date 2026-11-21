import { test, expect } from "@playwright/test"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

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

  // Personal Finance is listed in this build: its Categories & Tags, Data and Danger Zone sections join the page (the
  // Consulting-only build's list, with no Danger Zone, is checked in modules.spec.ts).
  test("should list the sections in an index and keep Danger Zone last", async ({ page }) => {
    const index = page.getByRole("navigation", { name: "On this page" })
    await expect(index.getByRole("link")).toHaveText(["Profile", "Preferences", "Plugins", "Categories & Tags", "Data", "Danger Zone"])
    await index.getByRole("link", { name: "Danger Zone" }).click()
    await expect(page.getByRole("heading", { level: 2, name: "Danger Zone" })).toBeInViewport()
    await expect(page.getByText("Nothing to reset")).toBeVisible()
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

  // ── Personal Finance ─────────────────────────────────────────────────────────

  test("should change currency with the segmented choice", async ({ page }) => {
    const group = page.getByRole("group", { name: "Currency" })
    await group.getByRole("button", { name: "EUR" }).click()
    await expect(group.getByRole("button", { name: "EUR" })).toHaveAttribute("aria-pressed", "true")
    await expect(group.getByRole("button", { name: "USD" })).toHaveAttribute("aria-pressed", "false")
    // Other opens the rest of the list and shows the pick.
    await group.getByRole("combobox", { name: "Other currency" }).click()
    await page.getByRole("option", { name: "CHF" }).click()
    await expect(group.getByRole("combobox", { name: "Other currency" })).toHaveText("CHF")
    await expect(group.getByRole("button", { name: "EUR" })).toHaveAttribute("aria-pressed", "false")
  })

  test("should show export button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /export/i })).toBeVisible()
  })

  test("should show tags section", async ({ page }) => {
    await expect(page.getByText(/tags/i).first()).toBeVisible()
  })

  test("should show auto-categorization rules section", async ({ page }) => {
    await expect(page.getByText(/auto-categorization/i)).toBeVisible()
  })

  test("should delete all accounts and transactions", async ({ page }) => {
    const name = uniqueName("Doomed Account")
    await navigateTo(page, "Accounts", "/accounts")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(name)
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(name)).toBeVisible()

    await navigateTo(page, "Settings", "/settings")
    await page.getByRole("button", { name: /delete all accounts/i }).click()
    await page.getByRole("button", { name: /delete everything/i }).click()
    await expect(page.getByText("All accounts and transactions deleted").first()).toBeVisible()

    await navigateTo(page, "Accounts", "/accounts")
    await expect(page.getByText(/no accounts yet/i)).toBeVisible()
  })
})
