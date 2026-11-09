import { test, expect } from "@playwright/test"
import { format } from "date-fns"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"
import type { Page } from "@playwright/test"

type MockWindow = Window & { __mockBackend?: BackendAdapter }

// A contract of 10 d a month from this month, 500 a day: every month to December is 5,000 at plan.
async function seedContract(page: Page) {
  const startMonth = format(new Date(), "yyyy-MM")
  const client = uniqueName("Quarters Client")
  await page.evaluate(
    async ({ client, startMonth }) => {
      const backend = (window as MockWindow).__mockBackend
      const user = await backend?.auth.getCurrentUser()
      if (!backend || !user) throw new Error("no mock backend or user")
      const { id: clientId } = await backend.db.createClient(user.id, { name: client })
      await backend.db.createEngagement(user.id, { clientId, name: "Retainer", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 10, startMonth, contractedDays: null })
    },
    { client, startMonth },
  )
  return `€${((12 - new Date().getMonth()) * 5000).toLocaleString("en-IE")}`
}

const noSidewaysScroll = async (page: Page, width: number) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)

test("the Quarters chip reaches the section, with the year at plan and no sideways scroll", async ({ page }) => {
  await signIn(page)
  const yearAtPlan = await seedContract(page)
  await navigateTo(page, "Plan", "/plan")

  await page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Quarters" }).click()
  await expect(page.getByRole("heading", { name: "Quarters" })).toBeVisible()
  await expect(page.getByText("Year at plan").locator("xpath=following-sibling::*[1]")).toHaveText(yearAtPlan)
  await expect(page.getByRole("table", { name: /^Quarters of/ })).toBeVisible()
  await noSidewaysScroll(page, page.viewportSize()!.width)
})

test("at 375 px the Quarters are cards, the quarter in progress first, and the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await signIn(page)
  const yearAtPlan = await seedContract(page)
  await navigateTo(page, "Plan", "/plan")

  const heading = page.getByRole("heading", { name: "Quarters" })
  await heading.scrollIntoViewIfNeeded()
  await expect(page.getByText("Year at plan").locator("xpath=following-sibling::*[1]")).toHaveText(yearAtPlan)
  await expect(page.getByRole("table", { name: /^Quarters of/ })).toBeHidden()
  const cards = page.getByRole("list", { name: "Quarters" }).locator(":scope > li")
  await expect(cards).toHaveCount(4)
  const current = Math.floor(new Date().getMonth() / 3) + 1
  const expected = [current, ...[4, 3, 2, 1].filter((q) => q !== current)]
  await expect(cards.locator(":scope > button")).toHaveText(expected.map((q) => new RegExp(`^Q${q} `)))
  await noSidewaysScroll(page, 375)
})

test("at 768 px the Quarters are still cards, the table waits for 1024 px, and the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await signIn(page)
  const yearAtPlan = await seedContract(page)
  await navigateTo(page, "Plan", "/plan")

  await page.getByRole("heading", { name: "Quarters" }).scrollIntoViewIfNeeded()
  await expect(page.getByText("Year at plan").locator("xpath=following-sibling::*[1]")).toHaveText(yearAtPlan)
  await expect(page.getByRole("list", { name: "Quarters" }).locator(":scope > li")).toHaveCount(4)
  await expect(page.getByRole("table", { name: /^Quarters of/ })).toBeHidden()
  await noSidewaysScroll(page, 768)
})
