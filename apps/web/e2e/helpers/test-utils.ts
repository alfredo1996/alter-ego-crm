import { revealLink } from "./demo"

import type { Page } from "@playwright/test"

let counter = 0
export function uniqueName(base: string): string {
  return `${base} ${Date.now().toString(36)}${(counter++).toString(36)}`
}

/**
 * Signs in and lands on Settings, not on the first page of the deployment: Pipeline reads the
 * clients, and a read cached before a spec seeds its data would hide the seed from the next page.
 * `next` is a page that reads nothing of the company's.
 */
export async function signIn(page: Page, next = "/settings") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel("Email").fill("test@example.com")
  await page.getByLabel("Password", { exact: true }).fill("password123")
  await page.getByRole("button", { name: "Sign In" }).click()
  await page.waitForURL(next)
}

export async function navigateTo(page: Page, linkName: string, url: string) {
  // The sidebar's link: a page may link the same name too (a client page's "Invoices" section, "All Invoices").
  const sidebar = page.locator("aside")
  const sidebarLink = sidebar.getByRole("link", { name: linkName })
  const sidebarHeading = sidebar.getByRole("navigation", { name: "Main" }).getByRole("button", { expanded: false })
  const mobileMenuButton = page.getByRole("button", { name: /open navigation/i })

  // Wait for either sidebar or mobile nav button to be visible
  await Promise.race([
    // A closed group hides its links: the sidebar is there once a link or a heading shows.
    sidebarLink.or(sidebarHeading.first()).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {}),
    mobileMenuButton.waitFor({ state: "visible", timeout: 5000 }).catch(() => {}),
  ])

  const isSidebarVisible = await sidebar.isVisible().catch(() => false)

  if (isSidebarVisible) {
    await (await revealLink(sidebar, linkName)).click()
  } else {
    await mobileMenuButton.click()
    await (await revealLink(page.getByRole("dialog"), linkName)).click()
  }
  await page.waitForURL(url)
}
