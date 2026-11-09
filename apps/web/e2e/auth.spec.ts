import { test, expect } from "@playwright/test"

import { signIn } from "./helpers/test-utils"

test.describe("Authentication", () => {
  test("should show sign-up as closed, with the way to sign in", async ({ page }) => {
    await page.goto("/register")
    await expect(page.getByRole("heading", { name: "Sign-Up Is Closed" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Create Account" })).toHaveCount(0)
    await page.getByRole("link", { name: "Sign in" }).click()
    await expect(page).toHaveURL(/\/login/)
  })

  test("should sign in and land on the first page", async ({ page }) => {
    await page.goto("/login")
    await page.getByLabel("Email").fill("test@example.com")
    await page.getByLabel("Password", { exact: true }).fill("password123")
    await page.getByRole("button", { name: "Sign In" }).click()
    await expect(page).toHaveURL("/pipeline")
  })

  test("should sign in and go on to the page it was asked for", async ({ page }) => {
    await signIn(page, "/clients")
    await expect(page).toHaveURL("/clients")
  })

  test("should redirect root to login when unauthenticated", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/login/)
  })

  test("should redirect protected route to login when unauthenticated", async ({ page }) => {
    await page.goto("/clients")
    await expect(page).toHaveURL(/\/login/)
  })

  test("should show validation errors for empty login form", async ({ page }) => {
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign In" }).click()

    await expect(page.getByText("Please enter a valid email")).toBeVisible()
    await expect(
      page.getByText("Password must be at least 6 characters")
    ).toBeVisible()
  })
})
