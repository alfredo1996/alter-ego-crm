import { test, expect } from "@playwright/test"
import { format } from "date-fns"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"
import type { Page } from "@playwright/test"

type MockWindow = Window & { __mockBackend?: BackendAdapter }

const isPhone = (page: Page) => page.viewportSize()!.width < 640

/** Mon to Fri in the month `now` is in, as the app counts them. */
function weekdays(now: Date) {
  let n = 0
  for (const d = new Date(now.getFullYear(), now.getMonth(), 1); d.getMonth() === now.getMonth(); d.setDate(d.getDate() + 1)) {
    if (d.getDay() >= 1 && d.getDay() <= 5) n++
  }
  return n
}

test.describe("Plan: time off", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  // One contract of 20 d a month from this month. Time off of (weekdays - 12) leaves 12 available: 8 over.
  test("typing days off changes Available and You plan, in words", async ({ page }) => {
    await page.evaluate(
      async ({ client, startMonth }) => {
        const backend = (window as MockWindow).__mockBackend
        const user = await backend?.auth.getCurrentUser()
        if (!backend || !user) throw new Error("no mock backend or user")
        const { id: clientId } = await backend.db.createClient(user.id, { name: client })
        await backend.db.createEngagement(user.id, { clientId, name: "Retainer", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 20, startMonth })
      },
      { client: uniqueName("Off"), startMonth: format(new Date(), "yyyy-MM") },
    )
    await navigateTo(page, "Plan", "/plan")
    await expect(page.getByRole("heading", { name: "Days by Month" })).toBeVisible()

    const now = new Date()
    const month = format(now, "MMMM yyyy")
    const w = weekdays(now)
    const word = (available: number) => (available < 20 ? `${20 - available} over` : available === 20 ? "full" : `${available - 20} free`)

    if (isPhone(page)) {
      const card = page.getByRole("tabpanel", { name: month })
      const input = card.getByRole("textbox", { name: `Time off, ${month}, days` })
      await expect(card).toContainText(`Available${w} d`)
      await input.fill(String(w - 12))
      await input.press("Enter")
      await expect(card).toContainText("Available12 d")
      await expect(card).toContainText("You plan20 d8 over")
      // The month tab says it in words for a screen reader, and shows a dot.
      await expect(page.getByRole("tab", { name: new RegExp(`${format(now, "MMM")}.*more days planned than available`) }).first()).toBeVisible()
      await input.fill("0")
      await input.press("Enter")
      await expect(card).toContainText(`Available${w} d`)
      await expect(card).toContainText(`You plan20 d${word(w)}`)
      return
    }

    const table = page.getByRole("table", { name: "Days by month" })
    const col = 2 // the grid opens two months before this one
    const cellOf = (row: string) => table.getByRole("row", { name: new RegExp(`^${row}`) }).getByRole("cell").nth(col)
    await expect(cellOf("Available")).toHaveText(String(w))
    await table.getByRole("button", { name: `Time off, ${month}: none. Click to type days off` }).click()
    await table.getByRole("spinbutton", { name: `Time off, ${month}, days` }).fill(String(w - 12))
    await table.getByRole("spinbutton", { name: `Time off, ${month}, days` }).press("Enter")
    await expect(cellOf("Time off")).toHaveText(String(w - 12))
    await expect(cellOf("Available")).toHaveText("12")
    await expect(cellOf("You plan")).toHaveText("208 over")
    // Clearing it gives the weekdays back.
    await table.getByRole("button", { name: new RegExp(`^Time off, ${month}: ${w - 12} days?$`) }).click()
    await table.getByRole("spinbutton", { name: `Time off, ${month}, days` }).fill("")
    await table.getByRole("spinbutton", { name: `Time off, ${month}, days` }).press("Enter")
    await expect(cellOf("Available")).toHaveText(String(w))
    await expect(cellOf("You plan")).toHaveText(`20${word(w)}`)
  })
})
