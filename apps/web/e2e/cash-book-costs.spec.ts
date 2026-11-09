import { readFile } from "node:fs/promises"

import { test, expect, type Locator, type Page } from "@playwright/test"
import { format } from "date-fns"
import { strFromU8, unzipSync } from "fflate"

import { seedCashBook } from "./helpers/cash-book-seed"
import { signIn, navigateTo } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"

/**
 * Costs and shareholder loans in the Cash Book, on the mock backend with the
 * synthetic book of helpers/cash-book-seed: Main Bank ends at €8,109.36 and
 * Second Bank at €2,400.00; the SRL owes the owner €3,000 (a €3,000 loan, a
 * €480 fridge on the card, €480 paid back); €2,500 is owed on invoice INV 40.
 */

async function pick(page: Page, scope: Locator, label: string, option: string) {
  await scope.getByRole("combobox", { name: label }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}

const card = (page: Page, name: string) => page.getByRole("region", { name: "Accounts" }).getByRole("article", { name, exact: true })
const owedHeld = (page: Page, label: string) => page.getByRole("region", { name: "Summary" }).getByRole("article", { name: label, exact: true })

const now = new Date()
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
const lastMonthDay = (n: number) => format(new Date(lastMonth.getFullYear(), lastMonth.getMonth(), n), "dd/MM/yyyy")

test.describe("Cash Book costs and loans", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("a cost paid from an account is in the sheet, the balance and on Costs", async ({ page }) => {
    await seedCashBook(page)
    await navigateTo(page, "Cash Book", "/cash-book")
    await expect(card(page, "Main Bank").getByText("€8,109.36")).toBeVisible()

    await page.getByRole("button", { name: "Add Movement" }).click()
    const dialog = page.getByRole("dialog", { name: "Add Movement" })
    await expect(dialog.getByRole("combobox", { name: "Type" })).toHaveText("Cost")
    await dialog.getByLabel("Amount").fill("122")
    await dialog.getByLabel("Of Which VAT").fill("22")
    await pick(page, dialog, "From Account", "Main Bank")
    await pick(page, dialog, "Category", "Software & Tools")
    await dialog.getByLabel("Description (optional)").fill("Domain renewal")
    await dialog.getByLabel("Cost Centre (optional)").fill("Consulting")
    await expect(dialog.getByText("On Costs and in the Plan: €100.00 + VAT €22.00.")).toBeVisible()
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog).toBeHidden()

    // The bank lost what was paid, VAT included.
    await expect(card(page, "Main Bank").getByText("€7,987.36")).toBeVisible()
    const sheet = page.getByRole("tabpanel", { name: "Movements" })
    await expect(sheet.getByRole("button", { name: "Domain renewal" })).toBeVisible()
    const line = sheet.getByRole("row").filter({ has: page.getByRole("button", { name: "Domain renewal" }) })
    await expect(line.getByText("Cost: Software & Tools", { exact: true })).toBeVisible()
    await expect(line.getByRole("cell").nth(1)).toHaveText("Consulting")
    await expect(line.getByRole("cell").nth(4)).toHaveText("−€122.00")

    await navigateTo(page, "Costs", "/costs")
    const row = page.getByRole("row").filter({ hasText: "Domain renewal" })
    await expect(row).toContainText("€100.00")
    await expect(row).toContainText("+ VAT €22.00")
    await expect(row).toContainText("Main Bank")
  })

  test("a cost on the owner's card raises SRL Owes You, and a repayment lowers it", async ({ page }) => {
    await seedCashBook(page)
    await navigateTo(page, "Costs", "/costs")
    // The StatCard in the Summary strip: its label's parent holds the figure.
    const owes = page.getByRole("region", { name: "Summary" }).getByText("SRL Owes You", { exact: true }).locator("..")
    await expect(owes).toContainText("€3,000.00")

    await page.getByRole("button", { name: "Add Cost" }).click()
    const dialog = page.getByRole("dialog", { name: "New Cost" })
    await dialog.getByLabel("Description").fill("Desk chair")
    await pick(page, dialog, "Paid From", "Owner's Personal Card")
    await dialog.getByLabel("Amount Before VAT").fill("200")
    await dialog.getByRole("button", { name: "Add Cost" }).click()
    await expect(dialog).toBeHidden()
    await expect(owes).toContainText("€3,200.00")

    // The same figure on the Cash Book, and no account moved.
    await navigateTo(page, "Cash Book", "/cash-book")
    await expect(owedHeld(page, "SRL owes you")).toContainText("€3,200.00")
    await expect(card(page, "Main Bank").getByText("€8,109.36")).toBeVisible()

    await page.getByRole("button", { name: "Add Movement" }).click()
    const move = page.getByRole("dialog", { name: "Add Movement" })
    await pick(page, move, "Type", "Shareholder Loan Repayment")
    await move.getByLabel("Amount").fill("200")
    await pick(page, move, "From Account", "Main Bank")
    await expect(move.getByText("The SRL owes you €3,200.00 now, €3,000.00 after this.")).toBeVisible()
    await move.getByRole("button", { name: "Save", exact: true }).click()
    await expect(move).toBeHidden()
    await expect(owedHeld(page, "SRL owes you")).toContainText("€3,000.00")
    await expect(card(page, "Main Bank").getByText("€7,909.36")).toBeVisible()
  })

  test("a supplier invoice paid in two parts ends with nothing owed", async ({ page }) => {
    await seedCashBook(page)
    await navigateTo(page, "Costs", "/costs")
    await page.getByRole("button", { name: "Add Cost" }).click()
    const dialog = page.getByRole("dialog", { name: "New Cost" })
    await dialog.getByLabel("Description").fill("Plumbing works")
    await pick(page, dialog, "Paid From", "Not Paid Yet")
    await dialog.getByLabel("Amount Before VAT").fill("1000")
    await dialog.getByLabel("Document (optional)").fill("PL 7")
    await dialog.getByLabel("Cost Centre (optional)").fill("Flat Rental")
    await expect(dialog.getByText(/^A supplier invoice to pay later: it shows in You Owe Suppliers/)).toBeVisible()
    await dialog.getByRole("button", { name: "Add Cost" }).click()
    await expect(dialog).toBeHidden()

    await navigateTo(page, "Cash Book", "/cash-book")
    await page.getByRole("tab", { name: "Owed & Held" }).click()
    const suppliers = page.getByRole("region", { name: "You Owe Suppliers" })
    await expect(suppliers).toContainText("€3,500.00")

    for (const [part, left] of [["600", "€400.00 owed"], ["400", null]] as const) {
      await suppliers.getByRole("button", { name: "Pay PL 7" }).click()
      const pay = page.getByRole("dialog", { name: "Add Movement" })
      await expect(pay.getByRole("combobox", { name: "Type" })).toHaveText("Supplier Invoice Payment")
      await pay.getByLabel("Amount").fill(part)
      await pick(page, pay, "From Account", "Main Bank")
      await pay.getByRole("button", { name: "Save", exact: true }).click()
      await expect(pay).toBeHidden()
      if (left) await expect(suppliers.getByText(left)).toBeVisible()
    }
    await expect(suppliers.getByRole("button", { name: "Pay PL 7" })).toHaveCount(0)
    await expect(suppliers).toContainText("€2,500.00")
    // €1,000 left the bank in two parts.
    await expect(card(page, "Main Bank").getByText("€7,109.36")).toBeVisible()

    await navigateTo(page, "Costs", "/costs")
    const row = page.getByRole("row").filter({ hasText: "Plumbing works" })
    await expect(row).toContainText("Paid by Supplier Invoice Payments")
    // Its payments are in the Cash Book: it stays a supplier invoice, never paid twice.
    await row.getByRole("button", { name: "Edit Plumbing works" }).click()
    const edit = page.getByRole("dialog", { name: "Edit Cost" })
    await expect(edit.getByRole("combobox", { name: "Paid From" })).toBeDisabled()
    await expect(edit.getByText(/^Paid in the Cash Book by Supplier Invoice Payments/)).toBeVisible()
  })

  test("a recurring cost's payment stands for it in the Plan, never on top of it", async ({ page }) => {
    await navigateTo(page, "Costs", "/costs")
    await page.getByRole("button", { name: "Add Recurring Cost" }).click()
    const dialog = page.getByRole("dialog", { name: "New Recurring Cost" })
    await dialog.getByLabel("Description").fill("Accountant")
    await dialog.getByLabel("Amount Each Time").fill("300")
    await dialog.getByRole("button", { name: "Add Recurring Cost" }).click()
    await expect(dialog).toBeHidden()

    const net = async () => {
      await navigateTo(page, "Plan", "/plan")
      // Net is the row's last column; the month is the row's header and the columns before it vary by width.
      return page.getByRole("row").filter({ hasText: format(now, "MMMM yyyy") }).first().getByRole("cell").last()
    }
    await expect(await net()).toHaveText("-€300")

    await navigateTo(page, "Costs", "/costs")
    await page.getByRole("button", { name: "Record Payment of Accountant" }).click()
    const pay = page.getByRole("dialog", { name: "Record Payment" })
    await expect(pay.getByRole("combobox", { name: "Pays Recurring Cost" })).toContainText("Accountant")
    await pay.getByRole("button", { name: "Record Payment" }).click()
    await expect(pay).toBeHidden()
    await expect(page.getByRole("row").filter({ hasText: "Pays: Accountant" })).toBeVisible()
    // The month counts the payment instead of the estimate.
    await expect(await net()).toHaveText("-€300")

    // A cost that pays no estimate adds to it.
    await navigateTo(page, "Costs", "/costs")
    await page.getByRole("button", { name: "Add Cost" }).click()
    const other = page.getByRole("dialog", { name: "New Cost" })
    await other.getByLabel("Description").fill("Office cleaning")
    await other.getByLabel("Amount Before VAT").fill("300")
    await expect(other.getByText('Does it pay "Accountant"? Pick it, or the Plan counts both.')).toBeVisible()
    await other.getByRole("button", { name: "Add Cost" }).click()
    await expect(other).toBeHidden()
    await expect(await net()).toHaveText("-€600")
  })

  test("Cost Centres says each one's gain or loss, deposits and loans apart", async ({ page }) => {
    await seedCashBook(page)
    await navigateTo(page, "Cash Book", "/cash-book")
    await page.getByRole("button", { name: "Previous month" }).click()
    await page.getByRole("tab", { name: "Cost Centres" }).click()
    const panel = page.getByRole("tabpanel", { name: "Cost Centres" })
    const centre = (name: string) => panel.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) })
    // Invoice 1 net of VAT, less the Google payment.
    await expect(centre("Consulting")).toContainText("Gain €3,988.00")
    // Rent and contribution 750, less rent 1,200, the renovation invoice 4,000 and the card's fridge 480.
    await expect(centre("Flat Rental")).toContainText("Loss €4,930.00")
    await expect(centre("Flat Rental")).toContainText("tenants' deposits €700.00")
    await expect(centre("All Cost Centres")).toContainText("Loss €942.00")
    await expect(panel.getByText(/€3,000\.00 lent to the SRL/)).toBeVisible()

    // Through Main Bank the renovation invoice is in no account: left out, and the help says so.
    await pick(page, page.getByRole("main"), "Account", "Main Bank")
    await expect(centre("Flat Rental")).toHaveCount(0)
    await expect(panel.getByText(/Supplier invoices and costs paid with your own card went through no account/)).toBeVisible()
  })

  test("Export picks a month, an account and a cost centre, rows and summaries", async ({ page }) => {
    await seedCashBook(page)
    await navigateTo(page, "Cash Book", "/cash-book")
    await page.getByRole("button", { name: "More" }).click()
    await page.getByRole("menuitem", { name: "Export", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Export" })
    await pick(page, dialog, "Period", "A Month")
    await pick(page, dialog, "Month", format(lastMonth, "MMMM yyyy"))
    await pick(page, dialog, "Account", "Second Bank")
    await pick(page, dialog, "Cost Centre", "Flat Rental")
    await expect(dialog.getByRole("status")).toContainText("4 rows")
    const download = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "Download CSV" }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe(`cash-book_${format(lastMonth, "yyyy-MM")}_second-bank_flat-rental.csv`)
    const lines = (await readFile((await file.path())!, "utf8")).slice(1).trimEnd().split("\r\n")
    expect(lines.slice(0, 5)).toEqual([
      "Date;Account;Type;Description;Document;Cost Centre;Counterparty;In;Out;VAT;Notes;Flags",
      `${lastMonthDay(4)};Second Bank;Cost: Rent / Office;Flat rent;Rent receipt 4;Flat Rental;;;1200,00;;;`,
      `${lastMonthDay(5)};Second Bank;Rent & Other Income;Rent Room 2;;Flat Rental;Room 2;650,00;;;;`,
      `${lastMonthDay(5)};Second Bank;Rent & Other Income;Expense contribution Room 2;;Flat Rental;Room 2;100,00;;;;`,
      `${lastMonthDay(5)};Second Bank;Deposit Received;Deposit Room 2;;Flat Rental;Room 2;700,00;;;;`,
    ])
    // The account whole, transfer included; the cost centre on that account.
    expect(lines).toContain("Second Bank;0,00;2950,00;1200,00;1750,00")
    expect(lines).toContain("Flat Rental;750,00;1200,00;-450,00;Loss;700,00;0,00")
    // A note containing commas is quoted, like every cell that holds a separator (#376).
    expect(lines.find((l) => l.startsWith(`"Cost Centres`))).toContain("Through Second Bank only: supplier invoices and costs paid with the owner's card")
    expect(lines.at(-1)).toMatch(/^Management record/)
  })

  test("Export Package for a quarter saves a zip with the prima nota, the payments and the files", async ({ page }) => {
    await seedCashBook(page)
    // The laptop (FT 12, paid from Main Bank on the 1st of this month) gets its supplier invoice.
    await page.evaluate(async () => {
      const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend!
      const u = (await backend.auth.getCurrentUser())!.id
      const laptop = (await backend.db.getCompanyExpenses(u)).find((e) => e.description === "Laptop")!
      const file = await backend.files.upload(u, new Blob(["<FatturaElettronica/>"]), "FT12.xml")
      await backend.db.updateCompanyExpense(u, laptop.id, { file })
    })
    await navigateTo(page, "Cash Book", "/cash-book")
    await page.getByRole("button", { name: "More" }).click()
    await page.getByRole("menuitem", { name: "Export", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Export" })
    await expect(dialog.getByRole("radiogroup", { name: "What to export" }).getByRole("radio", { name: "Prima Nota CSV" })).toBeChecked()
    await dialog.getByRole("radio", { name: "Accountant's Package" }).click()
    await expect(dialog.getByLabel("Cost Centre")).toHaveCount(0)
    await pick(page, dialog, "Period", "A Quarter")
    const now = new Date()
    const period = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`
    await expect(dialog.getByRole("status")).toContainText(`File: ${period}-accountant-package.zip`)
    const download = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "Download Package" }).click()
    const saved = await download
    expect(saved.suggestedFilename()).toBe(`${period}-accountant-package.zip`)
    const zip = unzipSync(new Uint8Array(await readFile((await saved.path())!)))
    const first = `${format(now, "yyyy-MM")}-01`
    expect(Object.keys(zip).sort()).toEqual([`costs/${first} Laptop (FT 12).xml`, `payments-${period}.csv`, `prima-nota-${period}.csv`])
    expect(strFromU8(zip[`costs/${first} Laptop (FT 12).xml`])).toBe("<FatturaElettronica/>")
    const payments = strFromU8(zip[`payments-${period}.csv`]).replace("\uFEFF", "").split("\r\n")
    expect(payments[0]).toBe("Date;Account;Paid To;Description;Amount;VAT;Pays;File")
    expect(payments).toContain(`${format(now, "01/MM/yyyy")};Main Bank;;Laptop;976,00;176,00;Cost FT 12;Yes`)
  })
})
