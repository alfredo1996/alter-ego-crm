import { test, expect } from "@playwright/test"

import { signIn, navigateTo } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"
import type { Page } from "@playwright/test"

/**
 * The Contracts timeline on the mock backend, made-up data only: Alpine Resorts Group with a running
 * contract and a deal in the pipeline. A page load wipes the mock, so the page is opened by the sidebar's link.
 * On a phone (375 px) the page never scrolls sideways: the timeline scrolls inside its card.
 */
const CLIENT = "Alpine Resorts Group"
const CONTRACT = "Guest 360 MVP"
const DEAL = "Front-desk guest card"

async function seed(page: Page) {
  await page.evaluate(
    async ({ client, contract, deal }) => {
      const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend
      if (!backend) throw new Error("window.__mockBackend is missing: the server must run the mock backend")
      const u = (await backend.auth.getCurrentUser())!.id
      const ym = (n: number) => {
        const d = new Date(new Date().getFullYear(), new Date().getMonth() + n, 1)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      }
      const c = await backend.db.createClient(u, { name: client })
      const e = await backend.db.createEngagement(u, {
        clientId: c.id, name: contract, dailyRate: 1000, vatApplicable: true, defaultDaysPerMonth: 4, contractedDays: 11,
        startMonth: ym(-1), endMonth: ym(3),
      })
      await backend.db.setTimecard(u, { engagementId: e.id, date: `${ym(-1)}-10`, hours: 16 })
      await backend.db.createOpportunity(u, {
        clientId: c.id, title: deal, stage: "proposal", probability: 40, dailyRate: 900, estimatedDaysPerMonth: 5,
        estimatedDurationMonths: 2, expectedStartMonth: ym(2), vatApplicable: true,
      })
    },
    { client: CLIENT, contract: CONTRACT, deal: DEAL },
  )
}

test.describe("Contracts", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    await signIn(page)
    if (isMobile) await page.setViewportSize({ width: 375, height: 667 })
  })

  test("opens a bar for its quarters, and Earlier moves the window", async ({ page, isMobile }) => {
    await seed(page)
    await navigateTo(page, "Contracts", "/contracts")
    await expect(page.getByRole("heading", { name: "Contracts", level: 1 })).toBeVisible()
    const timeline = page.getByRole("region", { name: "Timeline" })
    await expect(timeline.getByRole("button", { name: new RegExp(`^${DEAL}, ${CLIENT}`) })).toBeVisible()

    const bar = timeline.getByRole("button", { name: new RegExp(`^${CONTRACT}, ${CLIENT}`) })
    if (!isMobile) {
      // The contract is shown by default, so a click on the deal first proves the click changes the detail.
      await timeline.getByRole("button", { name: new RegExp(`^${DEAL}, ${CLIENT}`) }).click()
      await expect(page.getByRole("region", { name: "Contract detail" }).getByRole("heading", { name: DEAL })).toBeVisible()
    }
    await bar.click()
    // A phone opens the detail as a sheet, a desktop shows it below the timeline.
    const detail = isMobile ? page.getByRole("dialog", { name: CONTRACT }) : page.getByRole("region", { name: "Contract detail" })
    await expect(detail.getByRole("heading", { name: CONTRACT })).toBeVisible()
    await expect(detail.getByRole("columnheader", { name: "Planned" })).toBeVisible()
    await expect(detail.getByRole("row", { name: /^Q\d \d{4}/ }).first()).toBeVisible()
    await expect(detail.getByRole("row", { name: /^Total/ })).toBeVisible()
    if (isMobile) {
      await page.keyboard.press("Escape")
      // The sheet has no trigger: focus must go back to the bar that opened it.
      await expect(bar).toBeFocused()
    }

    const range = page.getByText(/^[A-Z][a-z]{2} \d{4} – [A-Z][a-z]{2} \d{4}$/)
    const before = await range.textContent()
    await page.getByRole("button", { name: "Earlier" }).click()
    await expect(range).not.toHaveText(before!)
  })

  test("Hide Pipeline takes the deal off the timeline", async ({ page }) => {
    await seed(page)
    await navigateTo(page, "Contracts", "/contracts")
    const timeline = page.getByRole("region", { name: "Timeline" })
    await expect(timeline.getByRole("button", { name: new RegExp(`^${DEAL}`) })).toBeVisible()
    await page.getByRole("button", { name: "Hide Pipeline" }).click()
    await expect(page.getByRole("button", { name: "Show Pipeline" })).toBeVisible()
    await expect(timeline.getByRole("button", { name: new RegExp(`^${DEAL}`) })).toHaveCount(0)
  })

  test("on a phone the bars are thumb-sized and the contract column stays put while the card scrolls", async ({ page, isMobile }) => {
    test.skip(!isMobile, "a phone behaviour")
    await seed(page)
    await navigateTo(page, "Contracts", "/contracts")
    const timeline = page.getByRole("region", { name: "Timeline" })
    const box = await timeline.getByRole("button", { name: new RegExp(`^${CONTRACT}, ${CLIENT}`) }).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    const name = timeline.getByText(CONTRACT, { exact: true })
    const x = (await name.boundingBox())!.x
    await timeline.locator(".overflow-x-auto").evaluate((el) => { el.scrollLeft = 200 })
    expect((await name.boundingBox())!.x).toBe(x)
  })

  test("on a phone the timeline opens with the Today line in view", async ({ page, isMobile }) => {
    test.skip(!isMobile, "a phone behaviour")
    await seed(page)
    await navigateTo(page, "Contracts", "/contracts")
    const timeline = page.getByRole("region", { name: "Timeline" })
    const scroller = (await timeline.locator(".overflow-x-auto").boundingBox())!
    const today = (await timeline.locator("[data-today]").boundingBox())!
    expect(today.x).toBeGreaterThanOrEqual(scroller.x + 168)
    expect(today.x + today.width).toBeLessThanOrEqual(scroller.x + scroller.width)
  })
})
