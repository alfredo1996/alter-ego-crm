import { test, expect, type Page } from "@playwright/test"

import { navigateTo, signIn } from "./helpers/test-utils"
import { primaNotaWorkbook, SYNTHETIC_BOOK } from "../src/lib/__tests__/helpers/prima-nota-workbook"

import type { BackendAdapter } from "@/lib/backend"

/**
 * Import Excel on the mock backend with a synthetic workbook built in the test
 * (invented banks, rooms, clients and amounts): the owner decides the rows the
 * workbook can't settle, sees both banks match, imports, is refused a second
 * import and undoes it. The customers and their invoices are seeded through
 * the mock backend; a page load would wipe them.
 */

async function seedInvoices(page: Page) {
  await page.evaluate(async () => {
    const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend
    if (!backend) throw new Error("window.__mockBackend is missing: the e2e server must run the mock backend")
    const user = await backend.auth.getCurrentUser()
    if (!user) throw new Error("not signed in")
    const db = backend.db
    const acme = (await db.createClient(user.id, { name: "Acme Ltd" })).id
    const beta = (await db.createClient(user.id, { name: "Beta Srl" })).id
    await db.createClient(user.id, { name: "Gamma Spa" })
    await db.createInvoice(user.id, { clientId: acme, number: "101/2026", yearMonth: "2026-06", amount: 1000, vat: 220 })
    await db.createInvoice(user.id, { clientId: beta, number: "102/2026", yearMonth: "2026-06", amount: 2000, vat: 0 })
    await db.createInvoice(user.id, { clientId: beta, number: "NC 101/2026", yearMonth: "2026-06", amount: -2000, vat: 0 })
    await db.createInvoice(user.id, { clientId: beta, number: "103/2026", yearMonth: "2026-06", amount: 2000, vat: 0 })
    await db.createInvoice(user.id, { clientId: acme, number: "105/2026", yearMonth: "2026-07", amount: 500, vat: 110 })
  })
}

const card = (page: Page, name: string) => page.getByRole("region", { name: "Accounts" }).getByRole("article", { name, exact: true })

test.describe("Cash Book, Import Excel", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await seedInvoices(page)
  })

  test("decides the open rows, matches both banks, imports once and undoes it", async ({ page }) => {
    await navigateTo(page, "Cash Book", "/cash-book")
    await page.getByRole("button", { name: "Import Excel" }).click()
    const dialog = page.getByRole("dialog", { name: "Import Excel" })
    await dialog.getByLabel("Workbook (.xlsx)").setInputFiles({
      name: "prima-nota.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: primaNotaWorkbook(SYNTHETIC_BOOK),
    })

    const summary = dialog.getByRole("region", { name: "What's in the File" })
    await expect(summary).toContainText("43 rows on 4 month sheets, May 2026 to August 2026")
    await expect(summary).toContainText("What Import will do: Create 2 accounts")
    const importButton = dialog.getByRole("button", { name: "Import", exact: true })
    await expect(importButton).toBeDisabled()
    await expect(dialog.getByRole("status")).toHaveText("Import is off until you decide 9 rows.")

    await dialog.getByRole("button", { name: "Accept All Suggestions" }).click()
    // Rent and a deposit in one bank amount: the owner says how much each is.
    const split = dialog.getByRole("listitem").filter({ hasText: "Room 5 (affitto e deposito cauzionale)" })
    await split.getByRole("spinbutton", { name: "Part 1: amount" }).fill("700")
    await split.getByRole("spinbutton", { name: "Part 2: amount" }).fill("650")
    await expect(split).toContainText("The parts add up to €1,350.00, the bank amount is €1,400.00.")
    await split.getByRole("spinbutton", { name: "Part 2: amount" }).fill("700")
    await split.getByRole("textbox", { name: "Part 2: description" }).fill("Deposit Room 5")

    const check = dialog.getByRole("list", { name: "Check", exact: true })
    await expect(check).toContainText("Main Bank: matches €4,088.00 on 05/08/2026")
    await expect(check).toContainText("Second Bank: matches €5,965.00 on 05/08/2026")
    await expect(dialog.getByRole("status")).toHaveText(/^Ready: \d+ changes, and every account matches the Saldo sheet\.$/)
    await importButton.click()
    await expect(dialog.getByText(/Imported: \d+ changes written\./)).toBeVisible()
    await dialog.getByRole("button", { name: "Done" }).click()
    await expect(dialog).toBeHidden()

    // The book turns to August, the workbook's last month: its rows are there.
    await expect(page.getByText("August 2026", { exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: "Fornitore Estero servizi" })).toBeVisible()
    await expect(card(page, "Main Bank").getByText(/^Checked against the bank on 5 Aug( 2026)?$/)).toBeVisible()
    await expect(card(page, "Second Bank").getByText(/^Checked against the bank on 5 Aug( 2026)?$/)).toBeVisible()

    // Twice? No: Undo Import first.
    await page.getByRole("button", { name: /More/ }).click()
    await page.getByRole("menuitem", { name: "Import Excel" }).click()
    await expect(dialog).toContainText("The workbook is already imported.")
    await expect(dialog.getByLabel("Workbook (.xlsx)")).toBeDisabled()
    await dialog.getByRole("button", { name: "Undo Import" }).click()

    const undo = page.getByRole("dialog", { name: "Undo Import" })
    await expect(undo).toContainText("Deletes the 2 accounts it created.")
    await undo.getByRole("button", { name: "Undo Import" }).click()
    await expect(undo).toBeHidden()
    await expect(page.getByText(/^Import undone: \d+ records deleted, \d+ invoices without the account, 2 accounts deleted\.$/).first()).toBeVisible()
    await expect(page.getByRole("heading", { name: "Start With Your Accounts" })).toBeVisible()
  })
})
