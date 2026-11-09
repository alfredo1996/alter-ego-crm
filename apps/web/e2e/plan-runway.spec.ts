import { test, expect } from "@playwright/test"
import { format } from "date-fns"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"
import type { Page } from "@playwright/test"

type MockWindow = Window & { __mockBackend?: BackendAdapter }

// A company account opened with €8,000 and a contract of 10 d a month at €500 from this month: €5,000 of net every month.
// A proposal at 100 % and €1,000 a day adds €10,000 a month to "With Weighted Pipeline".
async function seed(page: Page) {
  const startMonth = format(new Date(), "yyyy-MM")
  const client = uniqueName("Runway Client")
  await page.evaluate(
    async ({ client, startMonth }) => {
      const backend = (window as MockWindow).__mockBackend
      const user = await backend?.auth.getCurrentUser()
      if (!backend || !user) throw new Error("no mock backend or user")
      const { id: clientId } = await backend.db.createClient(user.id, { name: client })
      await backend.db.createEngagement(user.id, { clientId, name: "Retainer", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 10, startMonth, contractedDays: null })
      await backend.db.createOpportunity(user.id, { clientId, title: "Next", stage: "proposal", probability: 100, dailyRate: 1000, estimatedDaysPerMonth: 10, estimatedDurationMonths: 36, vatApplicable: true })
      await backend.db.createCompanyAccount(user.id, { name: "Runway Bank", openingBalance: 8000, openingDate: new Date(2020, 0, 1) })
    },
    { client, startMonth },
  )
}

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)

test("the Runway shows the money today, never runs out on a profitable plan, and takes a floor", async ({ page }) => {
  await signIn(page)
  await seed(page)
  await navigateTo(page, "Plan", "/plan")

  await page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Runway" }).click()
  await expect(page.getByRole("heading", { name: "Runway" })).toBeVisible()
  const headline = page.getByRole("region", { name: "Runway headline" })
  await expect(headline.getByText("Money Today").locator("..")).toContainText("€8,000")
  await expect(headline.getByText("Covered Until").locator("..")).toContainText("Beyond")
  await expect(headline.getByText("Under Your Floor").locator("..")).toContainText("No floor set")
  const table = page.getByRole("table", { name: /^Runway by month/ })
  await expect(table).toBeVisible()

  // The Projection's switch moves the Runway: the first month after this one adds the scenario's net.
  const firstMonth = table.getByRole("row").nth(2)
  await expect(page.getByText(/Counting: Contracts Only/)).toBeVisible()
  await expect(firstMonth).toContainText("€13,000")
  await page.getByRole("button", { name: "With Weighted Pipeline" }).click()
  await expect(page.getByText(/Counting: With Weighted Pipeline/)).toBeVisible()
  await expect(firstMonth).toContainText("€23,000")

  await page.getByRole("button", { name: "Set Floor" }).click()
  const dialog = page.getByRole("dialog", { name: "Set Floor" })
  await dialog.getByLabel("Floor").fill("12000")
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog).toBeHidden()

  await expect(page.getByRole("button", { name: "Floor €12,000" })).toBeVisible()
  await expect(headline.getByText("Under Your Floor").locator("..")).toContainText("Now")
  await noSidewaysScroll(page)
})

test("at 375 px the Runway fits the page, with its table and no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await signIn(page)
  await seed(page)
  await navigateTo(page, "Plan", "/plan")

  await page.getByRole("heading", { name: "Runway" }).scrollIntoViewIfNeeded()
  await expect(page.getByRole("region", { name: "Runway headline" })).toBeVisible()
  await expect(page.getByRole("table", { name: /^Runway by month/ })).toBeVisible()
  await noSidewaysScroll(page)
})
