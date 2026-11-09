import { test, expect } from "@playwright/test"
import { format, startOfMonth, subMonths } from "date-fns"

import { seedMonthEnd } from "./helpers/month-end-seed"
import { signIn, navigateTo } from "./helpers/test-utils"

/**
 * Month End on the mock backend (see helpers/month-end-seed): last month has
 * one step to do, Invoices, because two months ago's invoice went in on last
 * month; Record Invoice, in place, closes both months. Dates follow the day
 * the suite runs. The plan's examples, each fixed in place, are
 * month-end-actions.spec.ts.
 */

const ago = (n: number) => subMonths(startOfMonth(new Date()), n)
const monthName = (n: number) => format(ago(n), "MMMM yyyy")

test.describe("Month End", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await seedMonthEnd(page)
  })

  test("last month has an invoice to record and an older month open, and closes once it is recorded", async ({ page }) => {
    await navigateTo(page, "Month End", "/month-end")
    const verdict = page.getByRole("region", { name: "Verdict" })
    await expect(verdict).toContainText(`${monthName(1)}: 1 step to do (Invoices)`)
    await expect(verdict).toContainText(`Also open: 1 earlier month (oldest: ${monthName(2)})`)
    await expect(verdict).toContainText("1 recurring cost not paid")

    const invoices = page.getByRole("region", { name: "Invoices", exact: true })
    await expect(invoices).toContainText(`Studio Verdi, ${monthName(2)}: €1,800.00 not invoiced`)
    await invoices.getByText("What was checked (2)").click()
    await expect(invoices).toContainText(`Studio Verdi: covered by 14/${format(new Date(), "yyyy")} (${format(ago(1), "MMM yyyy")})`)
    const bank = page.getByRole("region", { name: "Bank" })
    await bank.getByText("What was checked (1)").click()
    await expect(bank).toContainText(`Main Bank: Matches the bank on ${format(ago(0), "dd/MM/yyyy")} (after month end)`)

    // Recorded in place, from Ready to Invoice's draft.
    await invoices.getByRole("button", { name: "Record Invoice" }).click()
    const sheet = page.getByRole("dialog", { name: "Record Invoice" })
    await expect(sheet.getByLabel("Net amount")).toHaveValue("1800")
    await sheet.getByRole("button", { name: "Record Invoice" }).click()
    await expect(sheet).toBeHidden()

    await expect(verdict).toContainText(`${monthName(1)} is closed: every required step is done.`)
    await expect(verdict).not.toContainText("Also open")
    await page.getByRole("button", { name: "Previous month" }).click()
    await expect(verdict).toContainText(`${monthName(2)} is closed: every required step is done.`)
    await page.getByRole("button", { name: "Previous month" }).click()
    await expect(verdict).toContainText(`${monthName(3)} is closed: every required step is done.`)
    // The first month with data: nothing before it to close.
    await expect(page.getByRole("button", { name: "Previous month" })).toBeDisabled()
  })

  test("goes to the older open month, and downloads the month's CSV without a dialog", async ({ page }) => {
    await navigateTo(page, "Month End", "/month-end")
    const verdict = page.getByRole("region", { name: "Verdict" })
    await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled()
    await verdict.getByRole("button", { name: monthName(2) }).click()
    await expect(verdict).toContainText(`${monthName(2)}: 1 step to do (Invoices)`)
    await expect(page).toHaveURL(new RegExp(`/month-end\\?month=${format(ago(2), "yyyy-MM")}$`))

    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: "Download CSV" }).click()
    expect((await download).suggestedFilename()).toBe(`cash-book_${format(ago(2), "yyyy-MM")}_all-accounts_all-cost-centres.csv`)
    await page.getByRole("button", { name: "Other Periods" }).click()
    const dialog = page.getByRole("dialog", { name: "Export" })
    await expect(dialog.getByRole("radio", { name: "Accountant's Package" })).toBeChecked()
    await expect(dialog.getByRole("status")).toContainText(`File: ${format(ago(2), "yyyy-MM")}-accountant-package.zip`)
  })
})
