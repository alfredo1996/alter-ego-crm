import { test, expect } from "@playwright/test"

import { seedCashBook } from "./helpers/cash-book-seed"
import { DEMO_PAGES, openDemoPage, seedDemo } from "./helpers/demo"
import { seedSummaries } from "./helpers/summaries-seed"
import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"

/**
 * The shared phone fixes, checked where they were broken (mobile audit,
 * 2026-10): the nav sheet did not scroll, long form dialogs hid Save below the
 * fold, and Select lists had no height cap. A 375x667 phone, the smallest the
 * audit measured; the mobile-chrome project also emulates touch.
 */
test.describe("Mobile", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!isMobile, "Phone layout only")
    await page.setViewportSize({ width: 375, height: 667 })
    await signIn(page)
  })

  test("the nav sheet scrolls down to Settings and Sign out", async ({ page }) => {
    await page.getByRole("button", { name: /open navigation/i }).click()
    const sheet = page.getByRole("dialog")
    // The footer stays on screen; the links between scroll.
    await expect(sheet.getByRole("button", { name: "Sign out" })).toBeInViewport({ ratio: 1 })
    const settings = sheet.getByRole("link", { name: "Settings", exact: true })
    await settings.scrollIntoViewIfNeeded()
    await expect(settings).toBeInViewport({ ratio: 1 })
    await settings.click()
    await expect(page).toHaveURL("/settings")
  })

  test("Add Movement's pinned footer is one row on a 360 px phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await seedCashBook(page)
    await navigateTo(page, "Cash Book", "/cash-book")
    await page.getByRole("button", { name: "Add Movement" }).click()
    const dialog = page.getByRole("dialog", { name: "Add Movement" })
    const save = dialog.getByRole("button", { name: "Save", exact: true })
    const another = dialog.getByRole("button", { name: "Save & Add Another" })
    await expect(save).toBeInViewport({ ratio: 1 })
    // Side by side: a third button (Cancel; the X closes) wrapped Save onto a second row.
    expect((await another.boundingBox())!.y).toBe((await save.boundingBox())!.y)
  })

  // Every page, lived in: #205/#206 brought sideways overflow to zero on a phone, and this keeps it there.
  for (const demo of DEMO_PAGES) {
    test(`no page scrolls sideways at 375px: ${demo.path}`, async ({ page }) => {
      await seedDemo(page)
      await openDemoPage(page, demo)
      const width = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(width, `${demo.path} is ${width} px wide`).toBeLessThanOrEqual(375)
    })
  }

  test("Plan on a phone: a month strip with a card per contract, and the projection's Net column inside its card", async ({ page }) => {
    await seedDemo(page)
    await openDemoPage(page, { path: "/plan", nav: "Plan" })
    // No table to scroll sideways: the open month's contracts are cards, each with its days field.
    await expect(page.getByRole("table", { name: "Days by Month" })).toHaveCount(0)
    await expect(page.getByRole("tablist", { name: "Month" })).toBeVisible()
    await expect(page.getByRole("tabpanel").getByRole("textbox").first()).toBeVisible()
    // The projection table fits the card: its last column ends inside it.
    const table = page.getByRole("table", { name: "Projection by month: gross minus costs equals net" })
    await expect(table).toBeVisible()
    const card = (await table.locator("xpath=..").boundingBox())!
    const net = (await table.locator("tbody tr").first().locator("td").last().boundingBox())!
    expect(net.x + net.width).toBeLessThanOrEqual(card.x + card.width)
  })

  test("pinch-zoom is not locked", async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content")
    expect(viewport).not.toMatch(/maximum-scale|user-scalable=no/)
  })

  test("the Cash Book's first movement shows on the first screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await seedCashBook(page)
    await navigateTo(page, "Cash Book", "/cash-book")
    // The opening balance, then the month's first movement (rows under a day's heading, so not
    // the heading's row): both above the fold (the intro, the tall account cards and seven tiles put it at y 1631).
    const first = page.getByRole("table").first().locator("tbody tr:not(:has(th))").nth(1)
    await expect(first).toBeVisible()
    const box = (await first.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(812)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    // The tabs are one row that scrolls sideways, and the page never does.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })

  test("a Cash Book warning comes first on a phone, and the first movement still shows", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.evaluate(async () => {
      const backend = (window as unknown as { __mockBackend: BackendAdapter }).__mockBackend
      const u = (await backend.auth.getCurrentUser())!.id
      const now = new Date()
      const main = (await backend.db.createCompanyAccount(u, { name: "Main Bank", openingBalance: 9000, openingDate: new Date(now.getFullYear(), now.getMonth() - 1, 1) })).id
      // Paid to the owner with nothing lent: the SRL has paid more than it owed.
      await backend.db.createCompanyLoan(u, { description: "Paid to the owner", direction: "from_company", amount: 2000, date: new Date(now.getFullYear(), now.getMonth(), 1), accountId: main })
    })
    await navigateTo(page, "Cash Book", "/cash-book")
    // Fifth in a row that swipes, it sat off screen and stretched every tile to its height.
    const warning = page.getByRole("region", { name: "Summary" }).getByText(/more than it owed/)
    await expect(warning).toBeInViewport({ ratio: 1 })
    const first = page.getByRole("table").first().locator("tbody tr:not(:has(th))").nth(1)
    await expect(first).toContainText("Paid to the owner")
    const box = (await first.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(812)
  })

  test("a Costs warning stays on a phone, and the recurring rows fit", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.evaluate(async () => {
      const backend = (window as unknown as { __mockBackend: BackendAdapter }).__mockBackend
      const u = (await backend.auth.getCurrentUser())!.id
      const now = new Date()
      const main = (await backend.db.createCompanyAccount(u, { name: "Main Bank", openingBalance: 9000, openingDate: new Date(now.getFullYear(), now.getMonth() - 1, 1) })).id
      await backend.db.createCompanyLoan(u, { description: "Paid to the owner", direction: "from_company", amount: 2000, date: new Date(now.getFullYear(), now.getMonth(), 1), accountId: main })
    })
    await navigateTo(page, "Costs", "/costs")
    // The strip's own detail is hidden on a phone; the first visible copy is the one under the strip.
    await expect(page.getByText(/more than it owed/).filter({ visible: true }).first()).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })

  test("the Cash Book search stays 16 px on a touch tablet, where the toolbar asks for 14", async ({ page }) => {
    // An iPad Air in portrait: past sm, still touch. iOS zooms into a field under 16 px on focus.
    await page.setViewportSize({ width: 820, height: 1180 })
    await seedCashBook(page)
    await navigateTo(page, "Cash Book", "/cash-book")
    const search = page.getByRole("searchbox", { name: "Search movements" })
    await expect(search).toBeVisible()
    expect(await search.evaluate((i) => getComputedStyle(i).fontSize)).toBe("16px")
  })

  test("a client page's summary controls are 44 px tall and the page does not scroll sideways", async ({ page }) => {
    const client = uniqueName("Summary")
    await seedSummaries(page, client)
    await navigateTo(page, "Clients", "/clients")
    await page.getByRole("heading", { name: client }).getByRole("link").click()
    await expect(page.getByRole("heading", { name: client, level: 1 })).toBeVisible()
    const controls = [
      page.getByRole("region", { name: "Meetings", exact: true }).getByRole("button", { name: "Show 2 Older Meetings" }),
      page.getByRole("region", { name: "Contracts", exact: true }).getByRole("button", { name: "Show 3 Closed Contracts" }),
      page.getByRole("region", { name: "Opportunities", exact: true }).getByRole("link", { name: "View All opportunities" }),
      page.getByRole("region", { name: "Solutions", exact: true }).getByRole("link", { name: "View All solutions" }),
    ]
    for (const control of controls) {
      await control.scrollIntoViewIfNeeded()
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })

  test("the Pipeline's View All Closed is 44 px tall and the page does not scroll sideways", async ({ page }) => {
    await seedSummaries(page, uniqueName("Summary"))
    await navigateTo(page, "Pipeline", "/pipeline")
    const control = page.getByRole("button", { name: /^View All Closed \(\d+\)$/ })
    await control.scrollIntoViewIfNeeded()
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
})
