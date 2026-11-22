import { test, expect } from "@playwright/test"

import { signIn, navigateTo } from "./helpers/test-utils"

/**
 * A deployment built with NEXT_PUBLIC_PLUGINS=consulting: Personal Finance, Accounting and Rent are off. It needs
 * its own build, so it runs only under playwright.modules.config.ts (`pnpm test:e2e:modules`).
 *
 * A page load wipes the mock backend and signs out, so a page.goto to /invoices would land on
 * the sign-in page and prove nothing about the guard. The blocked URLs are opened the way a link
 * would: through the app's own history.
 */
test.describe("a deployment that lists only Consulting", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("shows the Consulting group alone: always open, with no group heading to press", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Main" })
    await expect(sidebar.getByRole("button")).toHaveCount(0)
    for (const name of ["Pipeline", "Clients", "Solutions", "Plan"]) {
      await expect(sidebar.getByRole("link", { name, exact: true })).toBeVisible()
    }
    for (const name of ["Accounting", "Rent"]) {
      await expect(sidebar.getByRole("button", { name, exact: true })).toHaveCount(0)
    }
    for (const name of ["Invoices", "Cash Book", "Costs", "Month End", "Rent"]) {
      await expect(sidebar.getByRole("link", { name, exact: true })).toHaveCount(0)
    }
  })

  // The manifest and the page's meta description are read from the build, not written for every build.
  test("offers only the shortcuts and the description this build has", async ({ page, request }) => {
    const res = await request.get("/manifest.webmanifest")
    expect(res.ok()).toBe(true)
    const manifest = await res.json()
    expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(["/pipeline"])
    expect(manifest.description).toBe("Pipeline, clients and contracts")
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", manifest.description)
  })

  // Personal Finance is opt-in: a deployment that does not list it has no group, no link and no page of it.
  test("has no Personal Finance group or link", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Main" })
    await expect(sidebar.getByRole("link", { name: "Pipeline", exact: true })).toBeVisible()
    await expect(sidebar.getByText("Personal Finance")).toHaveCount(0)
    for (const name of ["Dashboard", "Accounts", "Transactions", "Categories", "Budgets", "Goals", "Recurring", "Reports"]) {
      await expect(sidebar.getByRole("link", { name, exact: true })).toHaveCount(0)
    }
  })

  for (const path of ["/dashboard", "/accounts", "/accounts/a1", "/transactions", "/categories", "/budgets", "/goals", "/recurring", "/reports"]) {
    test(`sends Personal Finance's ${path} to the first page`, async ({ page }) => {
      await page.evaluate((p) => window.history.pushState({}, "", p), path)
      await expect(page).toHaveURL(/\/pipeline$/)
    })
  }

  test("Settings has none of Personal Finance's sections", async ({ page }) => {
    await navigateTo(page, "Settings", "/settings")
    const index = page.getByRole("navigation", { name: "On this page" })
    await expect(index.getByRole("link")).toHaveText(["Profile", "Preferences", "Plugins", "Data"])
    await index.getByRole("link", { name: "Data" }).click()
    await expect(page.getByRole("heading", { level: 2, name: "Data" })).toBeInViewport()
    for (const name of ["Categories & Tags", "Danger Zone"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toHaveCount(0)
    }
    await expect(page.getByRole("button", { name: /delete all accounts/i })).toHaveCount(0)
  })

  for (const path of ["/invoices", "/cash-book", "/costs", "/month-end", "/rent"]) {
    test(`sends ${path} to the first page`, async ({ page }) => {
      await page.evaluate((p) => window.history.pushState({}, "", p), path)
      await expect(page).toHaveURL(/\/pipeline$/)
    })
  }

  test("Consulting's money views are hidden: no owed line on Clients, no Runway or Quarters on the Plan", async ({ page }) => {
    await navigateTo(page, "Clients", "/clients")
    await expect(page.getByText("Who you work for and what is signed.", { exact: true })).toBeVisible()
    await navigateTo(page, "Plan", "/plan")
    await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible()
    await expect(page.getByText("Runway", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Quarters" })).toHaveCount(0)
    await navigateTo(page, "Collaborators", "/collaborators")
    await expect(page.getByRole("heading", { name: "Collaborators", level: 1 })).toBeVisible()
    await expect(page.getByText(/not invoiced yet/)).toHaveCount(0)
    await expect(page.getByRole("group", { name: "Invoiced against plan" })).toHaveCount(0)
  })

  test("Settings lists Consulting as On, Personal Finance, Accounting and Rent as Off, and the variable's value", async ({ page }) => {
    await navigateTo(page, "Settings", "/settings")
    const plugins = page.getByRole("region", { name: "Plugins" })
    await expect(plugins.getByText("NEXT_PUBLIC_PLUGINS")).toBeVisible()
    await expect(plugins.getByText("consulting", { exact: true })).toBeVisible()
    for (const name of ["Personal Finance", "Consulting", "Accounting", "Rent"]) {
      await expect(plugins.getByText(new RegExp(`^${name}(Needs (Consulting|Accounting))?$`))).toBeVisible()
    }
    // A row has no role to name it by; which pill belongs to which plugin is modules-section.test.tsx's.
    await expect(plugins.getByText("Off", { exact: true })).toHaveCount(3)
    await expect(plugins.getByText("On", { exact: true })).toHaveCount(1)
  })
})
