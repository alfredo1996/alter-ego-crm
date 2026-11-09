import { readFile } from "node:fs/promises"

import { test, expect, type Page } from "@playwright/test"
import { format } from "date-fns"

import { signIn, navigateTo } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"

/**
 * The Cash Book on the mock backend with made-up data: two accounts, a
 * transfer, rent from a tenant, an invoice paid €10 short into one account,
 * the balance checked against the bank, To Chase and the CSV export. The
 * customer and its invoices are seeded through the mock backend (see Providers);
 * everything else goes through the UI.
 */

type MockWindow = Window & { __mockBackend?: BackendAdapter }

const today = format(new Date(), "dd/MM/yyyy")

async function seedInvoices(page: Page) {
  await page.evaluate(async () => {
    const backend = (window as MockWindow).__mockBackend
    if (!backend) throw new Error("window.__mockBackend is missing: the e2e server must run the mock backend")
    const user = await backend.auth.getCurrentUser()
    if (!user) throw new Error("not signed in")
    const { id: clientId } = await backend.db.createClient(user.id, { name: "Acme Ltd" })
    const now = new Date()
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    await backend.db.createInvoice(user.id, { clientId, number: "16/2026", yearMonth: ym, amount: 1000, vat: 0 })
    // Paid before the cash book, with no account: To Chase asks for one.
    await backend.db.createInvoice(user.id, { clientId, number: "9/2026", yearMonth: ym, amount: 200, vat: 0, paidDate: day })
  })
}

async function pick(page: Page, scope: ReturnType<Page["getByRole"]>, label: string, option: string) {
  await scope.getByRole("combobox", { name: label }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}

async function addAccount(page: Page, name: string, opening: string) {
  const dialog = page.getByRole("dialog", { name: "Company Accounts" })
  await dialog.getByLabel("Name").fill(name)
  await dialog.getByLabel("Opening Balance").fill(opening)
  await dialog.getByRole("button", { name: "Add Account" }).click()
  await expect(dialog.getByText(name, { exact: true })).toBeVisible()
}

const card = (page: Page, name: string) => page.getByRole("region", { name: "Accounts" }).getByRole("article", { name, exact: true })

test.describe("Cash Book", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await seedInvoices(page)
  })

  test("two accounts, a transfer, rent, an invoice paid short into an account, checked and exported", async ({ page }) => {
    await navigateTo(page, "Cash Book", "/cash-book")
    await page.getByRole("button", { name: "Add Your First Account" }).click()
    await addAccount(page, "Main Bank", "1000")
    await addAccount(page, "Second Bank", "0")
    await page.getByRole("dialog", { name: "Company Accounts" }).getByRole("button", { name: "Close" }).click()

    // Money moved between the two: neither in nor out.
    await page.getByRole("button", { name: "Add Movement" }).click()
    let dialog = page.getByRole("dialog", { name: "Add Movement" })
    await dialog.getByRole("button", { name: "Transfer" }).click()
    await dialog.getByLabel("Amount").fill("300")
    await pick(page, dialog, "From Account", "Main Bank")
    await pick(page, dialog, "To Account", "Second Bank")
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog).toBeHidden()

    await page.getByRole("button", { name: "Add Movement" }).click()
    dialog = page.getByRole("dialog", { name: "Add Movement" })
    await dialog.getByRole("button", { name: "In", exact: true }).click()
    await pick(page, dialog, "Type", "Rent & Other Income")
    await dialog.getByLabel("Amount").fill("650")
    await pick(page, dialog, "Into Account", "Second Bank")
    await dialog.getByLabel("Paid By (optional)").fill("Room 2")
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog).toBeHidden()

    // The customer pays €990 of €1,000: €10 kept by the bank becomes a fee.
    await navigateTo(page, "Invoices", "/invoices")
    const row = page.locator("#invoices").getByRole("row").filter({ has: page.getByRole("button", { name: "16/2026", exact: true }) })
    await row.getByRole("button", { name: "Mark Paid" }).click()
    const popup = page.getByRole("dialog", { name: "Mark 16/2026 Paid" })
    await pick(page, popup, "Into Account", "Main Bank")
    await popup.getByLabel("Amount Received").fill("990")
    await expect(popup.getByText("€10.00 short: booked as a bank fee, a cost on the same day and account.")).toBeVisible()
    await popup.getByRole("button", { name: "Mark Paid" }).click()
    // Anchored: Radix also announces the toast in a hidden "Notification …" copy for a second.
    await expect(page.getByText(/^Invoice 16\/2026 marked paid on .* into Main Bank\. €10\.00 booked as a bank fee\.$/)).toBeVisible()

    await navigateTo(page, "Cash Book", "/cash-book")
    // Main: 1,000 − 300 + 1,000 − 10. Second: 300 + 650.
    await expect(card(page, "Main Bank").getByText("€1,690.00")).toBeVisible()
    await expect(card(page, "Second Bank").getByText("€950.00")).toBeVisible()
    await expect(card(page, "Main Bank").getByText("Not checked")).toBeVisible()
    const sheet = page.getByRole("tabpanel", { name: "Movements" })
    await expect(sheet.getByRole("cell", { name: "€300.00 moved to Second Bank" })).toBeVisible()
    await expect(sheet.getByText("Bank fee on invoice 16/2026")).toBeVisible()
    await expect(page.getByRole("region", { name: /totals/ }).getByText("€1,650.00")).toBeVisible()

    // The bank says the same: it matches. Each account not matching offers the check in its row.
    await card(page, "Main Bank").getByRole("button", { name: "Check Balance" }).click()
    const check = page.getByRole("dialog", { name: "Check Balance" })
    await check.getByRole("region", { name: "Main Bank" }).getByLabel("Bank Balance").fill("1680")
    await expect(check.getByText(`Missing OUT of €10.00 on ${today}`)).toBeVisible()
    await check.getByRole("region", { name: "Main Bank" }).getByLabel("Bank Balance").fill("1690")
    await expect(check.getByText(`Matches the bank on ${today}`)).toBeVisible()
    await check.getByRole("button", { name: "Save Check" }).click()
    await expect(card(page, "Main Bank").getByText("Matches", { exact: true })).toBeVisible()
    await expect(card(page, "Main Bank").getByText(`Checked against the bank on ${format(new Date(), "d MMM")}`)).toBeVisible()

    await page.getByRole("tab", { name: "Summary" }).click()
    const month = page.getByRole("tabpanel", { name: "Summary" }).getByRole("region", { name: "Months" }).getByRole("row").filter({ hasText: format(new Date(), "MMMM") })
    await expect(month).toContainText("€1,690.00")
    await expect(month).toContainText("€950.00")

    await page.getByRole("tab", { name: /To Chase/ }).click()
    await expect(page.getByText(`Invoice 9/2026 paid on ${today}, no account`)).toBeVisible()

    await page.getByRole("button", { name: "More" }).click()
    await page.getByRole("menuitem", { name: "Export", exact: true }).click()
    const exporting = page.getByRole("dialog", { name: "Export" })
    const download = page.waitForEvent("download")
    await exporting.getByRole("button", { name: "Download CSV" }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe(`cash-book_${format(new Date(), "yyyy-MM")}_all-accounts_all-cost-centres.csv`)
    const csv = await readFile((await file.path())!, "utf8")
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain(`${today};Main Bank;Client Invoice Payment;Invoice 16/2026 · Acme Ltd;16/2026;Consulting;;1000,00;;;;`)
    expect(csv).toContain(`${today};Main Bank;Cost: Bank Fees;Bank fee on invoice 16/2026;;;;;10,00;;;`)
    expect(csv).toContain(`${today};Second Bank;Rent & Other Income;Rent & Other Income;;;Room 2;650,00;;;;`)
    // Each account from its opening balance: In − Out adds up to the bank.
    expect(csv).toContain("Main Bank;1000,00;1000,00;310,00;1690,00")
    expect(csv).toContain("Second Bank;0,00;950,00;0,00;950,00")
    expect(csv.trimEnd().split("\r\n").at(-1)).toMatch(/^Management record/)
  })
})
