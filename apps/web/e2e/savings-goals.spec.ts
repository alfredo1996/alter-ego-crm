import { test, expect } from "@playwright/test"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

test.describe("Savings Goals", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await navigateTo(page, "Goals", "/goals")
  })

  test("should show savings goals page heading", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: "Savings Goals" })).toBeVisible()
  })

  test("should create a new savings goal", async ({ page }) => {
    const name = uniqueName("Vacation Fund")
    await page.getByRole("button", { name: /new goal/i }).click()

    await page.getByLabel("Goal name").fill(name)
    await page.getByLabel("Target amount").fill("3000")

    await page.getByRole("button", { name: /create goal/i }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.getByText(name)).toBeVisible()
  })

  test("should show goal with zero progress initially", async ({ page }) => {
    const name = uniqueName("Emergency Fund")
    await page.getByRole("button", { name: /new goal/i }).click()
    await page.getByLabel("Goal name").fill(name)
    await page.getByLabel("Target amount").fill("5000")
    await page.getByRole("button", { name: /create goal/i }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.getByText(name)).toBeVisible()

    // The percentage is a bar width, never text — so zero progress is visible
    // as the whole target still being outstanding, and no completion note.
    const card = page.getByRole("article", { name })
    await expect(card.getByText(/to go/)).toBeVisible()
    await expect(card.getByText("Goal reached!")).toBeHidden()
  })

  test("should add funds to a goal from the card's own button", async ({ page }) => {
    const name = uniqueName("New Car")
    await page.getByRole("button", { name: /new goal/i }).click()
    await page.getByLabel("Goal name").fill(name)
    await page.getByLabel("Target amount").fill("20000")
    await page.getByRole("button", { name: /create goal/i }).click()
    await expect(page.getByText(name)).toBeVisible()

    // Add Funds is on the card, not in its menu: one tap on a phone too.
    await page.getByRole("button", { name: `Add Funds to ${name}` }).click()

    await page.getByLabel("Amount").fill("500")
    await page.getByRole("dialog").getByRole("button", { name: /add funds/i }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.getByRole("article", { name })).toContainText("3% saved")
  })

  test("should delete a savings goal", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "Dropdown menus tested on desktop only")

    const name = uniqueName("To Delete Goal")
    await page.getByRole("button", { name: /new goal/i }).click()
    await page.getByLabel("Goal name").fill(name)
    await page.getByLabel("Target amount").fill("100")
    await page.getByRole("button", { name: /create goal/i }).click()
    await expect(page.getByText(name)).toBeVisible()

    await page.getByRole("button", { name: `Actions for ${name}` }).click()
    await page.getByRole("menuitem", { name: /delete/i }).click()
    await page.getByRole("button", { name: /^delete$/i }).click()

    await expect(page.getByText(name)).not.toBeVisible()
  })
})
