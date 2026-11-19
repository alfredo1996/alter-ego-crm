import { test, expect } from "@playwright/test"

import { revealLink } from "./helpers/demo"
import { signIn, navigateTo } from "./helpers/test-utils"

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("sidebar links navigate correctly", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "Sidebar is hidden on mobile")

    const links = [
      { name: "Clients", url: "/clients" },
      { name: "Invoices", url: "/invoices" },
      { name: "Cash Book", url: "/cash-book" },
      { name: "Settings", url: "/settings" },
      { name: "Pipeline", url: "/pipeline" },
    ]

    for (const link of links) {
      await (await revealLink(page.locator("aside"), link.name, true)).click()
      await expect(page).toHaveURL(link.url)
    }
  })

  test("only the current page's group is open, and a heading opens the other in place", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "The sheet's headings are covered in mobile.spec.ts")

    const nav = page.getByRole("navigation", { name: "Main" })
    await navigateTo(page, "Clients", "/clients")
    await expect(nav.getByRole("button", { name: "Consulting" })).toHaveAttribute("aria-expanded", "true")
    await expect(nav.getByRole("link", { name: "Invoices", exact: true })).toHaveCount(0)

    await nav.getByRole("button", { name: "Accounting" }).click()
    await expect(page).toHaveURL("/clients")
    await expect(nav.getByRole("link", { name: "Invoices", exact: true })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Clients", exact: true })).toHaveCount(0)

    await nav.getByRole("link", { name: "Invoices", exact: true }).click()
    await expect(page).toHaveURL("/invoices")
    await expect(nav.getByRole("button", { name: "Accounting" })).toHaveAttribute("aria-expanded", "true")

    // Back to the page where a heading was pressed: its own group, not the picked one.
    await page.goBack()
    await expect(page).toHaveURL("/clients")
    await expect(nav.getByRole("button", { name: "Consulting" })).toHaveAttribute("aria-expanded", "true")
    await expect(nav.getByRole("link", { name: "Clients", exact: true })).toBeVisible()
  })

  // next/font's variables must sit on <html>: on <body> the preflight's html font-family found
  // no --font-geist-sans and fell back to system-ui, so the page text was never Geist.
  test("the page text is set in Geist, and code in Geist Mono", async ({ page }) => {
    const family = (selector: string) =>
      page.evaluate((s) => {
        const el = document.body.appendChild(document.createElement(s))
        const f = getComputedStyle(el).fontFamily
        el.remove()
        return f
      }, selector)
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Geist"?,/)
    expect(await family("code")).toMatch(/^"?Geist Mono"?,/)
  })

  test("mobile nav opens and navigates", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile nav only visible on mobile")

    await navigateTo(page, "Clients", "/clients")
    await expect(page).toHaveURL("/clients")
  })
})
