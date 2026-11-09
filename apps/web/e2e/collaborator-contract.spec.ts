import { test, expect } from "@playwright/test"
import { format, startOfISOWeek } from "date-fns"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"

type MockWindow = Window & { __mockBackend?: BackendAdapter }

/**
 * A collaborator on a contract, end to end on the mock backend: she is assigned from her card's
 * dialog, her day is logged on her own row of This Week, and her card shows the days used while the
 * client's contract card shows the quarter's margin and who used what. The contract and the
 * collaborator are seeded behind the page; the arithmetic is lib/__tests__/assignments.test.ts's.
 */
test.describe("a collaborator on a contract", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("assign her, log her day, see her usage and the contract's margin", async ({ page }) => {
    const client = uniqueName("Nordwind")
    const person = uniqueName("Giulia")
    const monday = startOfISOWeek(new Date())
    // The Monday of this week can fall in last month (1 to 6 of a month): everything starts in its month.
    const startMonth = format(monday, "yyyy-MM")
    await page.evaluate(
      async ({ client, person, startMonth }) => {
        const backend = (window as MockWindow).__mockBackend
        const user = await backend?.auth.getCurrentUser()
        if (!backend || !user) throw new Error("no mock backend or user")
        const { id: clientId } = await backend.db.createClient(user.id, { name: client })
        await backend.db.createEngagement(user.id, { clientId, name: "Graph", dailyRate: 520, vatApplicable: true, defaultDaysPerMonth: 8, startMonth })
        await backend.db.createCollaborator(user.id, { name: person, type: "freelancer" })
      },
      { client, person, startMonth },
    )
    await navigateTo(page, "Collaborators", "/collaborators")

    // Assign her to the contract at €320 a day, 4 days a month, from the month of this week.
    const card = page.getByRole("article", { name: person })
    await card.getByRole("button", { name: `More actions for ${person}` }).click()
    await page.getByRole("menuitem", { name: "Edit Collaborator" }).click()
    const dialog = page.getByRole("dialog", { name: "Edit Collaborator" })
    await dialog.getByRole("button", { name: "Assign to Contract" }).click()
    const form = dialog.getByRole("group", { name: "New assignment" })
    await form.getByRole("combobox", { name: "Contract" }).click()
    await page.getByRole("option", { name: new RegExp(`^${client} · `) }).click()
    await form.getByLabel("A Day").fill("320")
    await form.getByLabel("Days a Month").fill("4")
    await form.getByLabel("Assignment From").fill(startMonth)
    await expect(form.getByRole("status")).toContainText("€200 a day of margin on their days, 38%")
    await form.getByRole("button", { name: "Add Assignment" }).click()
    await expect(dialog).toContainText("€320/day")
    // No end on either: nothing to be used up, only what was used.
    await expect(dialog).toContainText("0 days used")
    await dialog.getByRole("button", { name: "Cancel" }).click()

    // Her row of This Week: log a day of 8 hours on Monday.
    await navigateTo(page, "Plan", "/plan")
    const week = page.getByRole("table", { name: /^Hours from / })
    await expect(week.getByRole("rowheader", { name: `${client} · Graph · You` })).toBeVisible()
    const cell = week.getByRole("textbox", { name: new RegExp(`^${client} · Graph · ${person}, ${format(monday, "EEEE d MMM")}`) })
    await cell.fill("8")
    await cell.press("Enter")
    await expect(week.getByRole("row").filter({ has: page.getByRole("rowheader", { name: `${client} · Graph`, exact: true }) })).toContainText("8 h")

    // Her card: one day used.
    await navigateTo(page, "Collaborators", "/collaborators")
    await expect(page.getByRole("article", { name: person })).toContainText("1 day used")

    // The client's contract: who used what, and the quarter's margin.
    await navigateTo(page, "Clients", "/clients")
    await page.getByRole("heading", { name: client }).getByRole("link").click()
    const contract = page.getByRole("article").filter({ hasText: "Graph" }).first()
    await expect(contract).toContainText(`Used 1: you 0, ${person} 1`)
    await expect(contract.getByText(/^Q[1-4] margin \d+%$/)).toBeVisible()
    await expect(contract.getByRole("table", { name: /^Margin, Q[1-4] \d{4}$/ })).toBeVisible()
  })
})
