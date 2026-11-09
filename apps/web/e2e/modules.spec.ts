import { test, expect } from "@playwright/test"

import { signIn, navigateTo } from "./helpers/test-utils"

/**
 * A deployment built with NEXT_PUBLIC_DISABLED_MODULES=invoicing,solutions. It needs
 * its own build, so it runs only under playwright.modules.config.ts (`pnpm test:e2e:modules`).
 *
 * A page load wipes the mock backend and signs out, so a page.goto to /invoices would land on
 * the sign-in page and prove nothing about the guard. The blocked URLs are opened the way a link
 * would: through the app's own history.
 */
test.describe("a deployment without invoicing and solutions", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("leaves their links out of the sidebar and keeps the rest of Company", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Main" })
    for (const name of ["Pipeline", "Clients", "Cash Book", "Month End", "Plan"]) {
      await expect(sidebar.getByRole("link", { name, exact: true })).toBeVisible()
    }
    for (const name of ["Invoices", "Solutions"]) {
      await expect(sidebar.getByRole("link", { name, exact: true })).toHaveCount(0)
    }
  })

  for (const path of ["/invoices", "/solutions"]) {
    test(`sends ${path} to the first page`, async ({ page }) => {
      await page.evaluate((p) => window.history.pushState({}, "", p), path)
      await expect(page).toHaveURL(/\/pipeline$/)
    })
  }

  test("Month End has no Invoices or Invoice Files step", async ({ page }) => {
    await navigateTo(page, "Month End", "/month-end")
    await expect(page.getByRole("heading", { name: "Month End", level: 1 })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Invoice Files", level: 2 })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Invoices", level: 2, exact: true })).toHaveCount(0)
  })

  test("Settings lists Invoicing and Solutions as Off and Books and Rent as On", async ({ page }) => {
    await navigateTo(page, "Settings", "/settings")
    const modules = page.getByRole("region", { name: "Modules" })
    await expect(modules.getByText("invoicing,solutions")).toBeVisible()
    for (const name of ["CRM", "Invoicing", "Books", "Solutions", "Rent"]) {
      await expect(modules.getByText(new RegExp(`^${name}(Needs (CRM|Books))?$`))).toBeVisible()
    }
    // A row has no role to name it by; which pill belongs to which module is modules-section.test.tsx's.
    await expect(modules.getByText("Off", { exact: true })).toHaveCount(2)
    await expect(modules.getByText("On", { exact: true })).toHaveCount(3)
  })
})
