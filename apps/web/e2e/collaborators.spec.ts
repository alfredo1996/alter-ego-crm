import { test, expect } from "@playwright/test"
import { addMonths, format } from "date-fns"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

/**
 * Collaborators on the mock backend: a fee with a change is created and edited on the
 * page, then read back on the Plan's Projection, which splits Collaborators from the rest.
 * No contracts and no costs, so every figure on the Plan is the fee: 1,000 this month,
 * then 1,500 for the eleven months after it.
 */
test.describe("Collaborators", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("creates a collaborator with a fee and a change, edits it, and the Plan splits its cost", async ({ page }) => {
    const name = uniqueName("Studio")
    const renamed = `${name} Renamed`
    const now = new Date()
    await navigateTo(page, "Collaborators", "/collaborators")
    await expect(page.getByRole("heading", { name: "Collaborators", level: 1 })).toBeVisible()

    await page.getByRole("button", { name: "New Collaborator" }).click()
    const dialog = page.getByRole("dialog", { name: "New Collaborator" })
    await dialog.getByLabel("Name").fill(name)
    await dialog.getByRole("button", { name: "Company" }).click()
    await dialog.getByRole("switch", { name: "A fee every month" }).click()
    await dialog.getByLabel("A month").fill("1000")
    await dialog.getByLabel("From", { exact: true }).fill(format(now, "yyyy-MM"))
    await dialog.getByRole("button", { name: "Add Change" }).click()
    await dialog.getByLabel("Change From").fill(format(addMonths(now, 1), "yyyy-MM"))
    await dialog.getByLabel("New Amount a Month").fill("1500")
    await dialog.getByRole("button", { name: "Save Change" }).click()
    await expect(dialog.getByText(`From ${format(addMonths(now, 1), "MMM yyyy")}`)).toBeVisible()
    await dialog.getByRole("button", { name: "Create Collaborator" }).click()

    const card = page.getByRole("article", { name })
    await expect(card).toContainText("Company")
    await expect(card).toContainText("Active")
    await expect(card).toContainText("€1,000 a month")
    await expect(card).toContainText(`€1,500 from ${format(addMonths(now, 1), "MMM yyyy")}`)

    // Edit: the name changes, the fee stays.
    await card.getByRole("button", { name: `More actions for ${name}` }).click()
    await page.getByRole("menuitem", { name: "Edit Collaborator" }).click()
    const edit = page.getByRole("dialog", { name: "Edit Collaborator" })
    await edit.getByLabel("Name").fill(renamed)
    await edit.getByRole("button", { name: "Save" }).click()
    await expect(page.getByRole("article", { name: renamed })).toContainText("€1,000 a month")

    await navigateTo(page, "Plan", "/plan")
    const projection = page.getByRole("table", { name: /Projection by month/ })
    await expect(projection.getByRole("columnheader", { name: "Collaborators" })).toBeVisible()
    await expect(projection.getByRole("columnheader", { name: "Other costs" })).toBeVisible()
    await expect(projection.getByRole("row", { name: new RegExp(`Fee changes ${renamed}`) })).toBeVisible()
    const stats = page.getByRole("region", { name: "Next 12 months" })
    await expect(stats.getByText("Collaborators")).toBeVisible()
    await expect(stats.getByText("€17,500", { exact: true })).toHaveCount(2) // the Costs total, and its Collaborators line
  })

  test("rejects a fee that ends before it starts, in words", async ({ page }) => {
    await navigateTo(page, "Collaborators", "/collaborators")
    await page.getByRole("button", { name: "New Collaborator" }).click()
    const dialog = page.getByRole("dialog", { name: "New Collaborator" })
    await dialog.getByLabel("Name").fill(uniqueName("Late"))
    await dialog.getByRole("switch", { name: "A fee every month" }).click()
    await dialog.getByLabel("A month").fill("500")
    await dialog.getByLabel("From", { exact: true }).fill("2026-06")
    await dialog.getByLabel("Until").fill("2026-01")
    await dialog.getByRole("button", { name: "Create Collaborator" }).click()
    await expect(dialog.getByRole("alert")).toHaveText("The end is before the start")
  })
})
