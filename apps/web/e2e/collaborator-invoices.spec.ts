import { test, expect } from "@playwright/test"
import { format, subMonths } from "date-fns"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

/**
 * A collaborator's invoice on the mock backend: a collaborator with a €1,000 fee that started last month,
 * the invoice for that month recorded in Costs, and the three places that read it: the Costs row,
 * Quarters (Collaborators beside Other costs, with the plan) and the Collaborators card.
 */
test.describe("Collaborator invoices", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("an invoice recorded for last month closes the gap on the card and shows in Quarters", async ({ page }) => {
    const name = uniqueName("Studio")
    const last = subMonths(new Date(), 1)
    const lastMonth = format(last, "yyyy-MM")
    const short = format(last, "MMM")

    await navigateTo(page, "Collaborators", "/collaborators")
    await page.getByRole("button", { name: "New Collaborator" }).click()
    const create = page.getByRole("dialog", { name: "New Collaborator" })
    await create.getByLabel("Name").fill(name)
    await create.getByRole("button", { name: "Company" }).click()
    await create.getByRole("switch", { name: "A fee every month" }).click()
    await create.getByLabel("A month").fill("1000")
    await create.getByLabel("From", { exact: true }).fill(lastMonth)
    await create.getByRole("button", { name: "Create Collaborator" }).click()

    // Nothing invoiced yet: the card names the missing month and the strip adds up the gap.
    const card = page.getByRole("article", { name })
    const block = card.getByRole("group", { name: "Invoiced against plan" })
    await expect(block).toContainText("invoiced €0 of €1,000")
    await expect(block).toContainText(`${short} not invoiced`)
    await expect(page.getByText("€1,000 not invoiced yet")).toBeVisible()

    await navigateTo(page, "Costs", "/costs")
    await page.getByRole("button", { name: "Add Cost" }).click()
    const cost = page.getByRole("dialog", { name: "New Cost" })
    await cost.getByLabel("Description").fill("Invoice 14/2026")
    await cost.getByLabel("Amount Before VAT").fill("1000")
    await cost.getByRole("combobox", { name: "Collaborator" }).click()
    await page.getByRole("option", { name }).click()
    await expect(cost.getByRole("combobox", { name: "Category" })).toContainText("Collaborators")
    await cost.getByLabel("For Month").fill(lastMonth)
    await cost.getByLabel("Document (optional)").fill("14/2026")
    await cost.getByRole("button", { name: "Add Cost" }).click()
    await expect(page.getByRole("dialog")).toBeHidden()
    await expect(page.getByRole("table").getByText(`${name} · fixed fee for ${format(last, "MMM yyyy")}`)).toBeVisible()

    await navigateTo(page, "Collaborators", "/collaborators")
    const covered = page.getByRole("article", { name }).getByRole("group", { name: "Invoiced against plan" })
    await expect(covered).toContainText("invoiced €1,000 of €1,000")
    await expect(covered).toContainText("All invoiced")
    await expect(covered).toContainText(`${short} · 14/2026`)
    await expect(page.getByText("not invoiced yet")).toHaveCount(0)

    await navigateTo(page, "Plan", "/plan")
    if (last.getFullYear() !== new Date().getFullYear()) await page.getByRole("button", { name: "Previous year" }).click()
    const quarters = page.getByRole("table", { name: /^Quarters of/ })
    await expect(quarters.getByRole("columnheader", { name: "Collaborators" })).toBeVisible()
    await expect(quarters.getByRole("columnheader", { name: "Other costs" })).toBeVisible()
    await quarters.getByRole("button", { name: new RegExp(`^Q${Math.floor(last.getMonth() / 3) + 1}`) }).click()
    const month = quarters.getByRole("row", { name: new RegExp(`^${format(last, "MMMM")} · invoiced`) })
    await expect(month).toContainText("€1,000")
    await expect(month).toContainText("plan €1,000 ✓")
  })
})
