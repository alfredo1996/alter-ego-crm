import { test, expect } from "@playwright/test"

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
      await page.getByRole("link", { name: link.name }).click()
      await expect(page).toHaveURL(link.url)
    }
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
