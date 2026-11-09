import { test, expect, type Page } from "@playwright/test"

import { signIn } from "./helpers/test-utils"

// The mock auth derives displayName from email: test@example.com → "test"
const USER_DISPLAY = "test"

async function performSignOut(page: Page, isMobile: boolean | undefined) {
  if (isMobile) {
    // Mobile: open the sheet nav → tap "Sign out" button
    await page.getByRole("button", { name: "Open navigation" }).click()
    await page.getByRole("button", { name: /sign out/i }).click()
  } else {
    // Desktop: open the user dropdown in the sidebar → click menu item
    await page.getByRole("button", { name: USER_DISPLAY }).click()
    await page.getByRole("menuitem", { name: /sign out/i }).click()
  }
}

test.describe("Sign Out", () => {
  test("should sign out and redirect to login", async ({ page, isMobile }) => {
    await signIn(page)
    await performSignOut(page, isMobile)
    await expect(page).toHaveURL(/\/login/)
  })

  test("should redirect protected routes to login after sign-out", async ({ page, isMobile }) => {
    await signIn(page)
    await performSignOut(page, isMobile)
    await page.waitForURL(/\/login/)

    await page.goto("/pipeline")
    await expect(page).toHaveURL(/\/login/)
  })
})
