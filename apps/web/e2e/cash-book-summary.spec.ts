import { test, expect, type Page } from "@playwright/test"
import { format } from "date-fns"

import { seedCashBook } from "./helpers/cash-book-seed"
import { signIn, navigateTo } from "./helpers/test-utils"

/**
 * The Cash Book's Summary tab on the mock backend with the synthetic book of
 * helpers/cash-book-seed. This month (the 1st only): rent €650 in; a €976 laptop
 * and the €480 fridge repaid out. Last month: €9,330 in, €3,014.64 out, the
 * fridge on the owner's card and €2,500 still owed on INV 40; Main Bank ends at
 * €9,565.36 and Second Bank at €1,750.00 (from €5,000 and €0), as on the Months card.
 */

const now = new Date()
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)

const panel = (page: Page, name: string) => page.getByRole("tabpanel", { name })
const region = (page: Page, name: string) => panel(page, "Summary").getByRole("region", { name })

test.describe("Cash Book summary", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await seedCashBook(page)
  })

  test("sums up this month and last, equals the Months card, keeps to one account, fits a phone", async ({ page }) => {
    await navigateTo(page, "Cash Book", "/cash-book")
    await page.getByRole("tab", { name: "Summary" }).click()

    const totals = region(page, "Period totals")
    await expect(totals).toContainText("Money In+€650.00")
    await expect(totals).toContainText("Money Out−€1,456.00")
    await expect(totals).toContainText("Net−€806.00")
    await expect(region(page, "Where the Money Went")).toContainText("Cost: Office Supplies · 1 row€976.00 67%")
    await expect(panel(page, "Summary").getByRole("img", { name: /Money in and out by month/ })).toBeVisible()

    // A Month opens on last month, and moves the page's month with it.
    await panel(page, "Summary").getByRole("combobox", { name: "Period" }).click()
    await page.getByRole("option", { name: "A Month", exact: true }).click()
    await expect(panel(page, "Summary").getByRole("combobox", { name: "Month" })).toHaveText(format(lastMonth, "MMMM yyyy"))
    await expect(totals).toContainText("Money In+€9,330.00")
    await expect(totals).toContainText("Money Out−€3,014.64")
    await expect(region(page, "Where It Came From")).toContainText("Deposit Received")
    const paid = region(page, "How It Was Paid")
    await expect(paid).toContainText("Your personal card€480.00")
    await expect(paid).toContainText("Supplier invoices not paid yet€2,500.00")
    // The INV 40 payment names what it bought, and its cost centre: one basis with the money out.
    await expect(region(page, "Where the Money Went")).toContainText("Supplier Invoice: Other · 1 row€1,500.00")
    await expect(region(page, "Money Out by Cost Centre")).toContainText("Flat Rental€2,700.00")
    await expect(region(page, "Biggest Costs")).toContainText("Renovation (INV 40) · 1 payment€1,500.00")

    const balances = region(page, "Balances Over Time")
    await balances.getByRole("button", { name: "Show as Table" }).click()
    await expect(balances.getByRole("button", { name: "Show as Chart" })).toBeVisible()
    await expect(balances.getByRole("row").nth(1)).toContainText("€5,000.00€0.00€5,000.00")
    await expect(balances.getByRole("row").nth(2)).toContainText("€9,565.36€1,750.00€11,315.36")

    // The Months card, the old Months tab, has the same month: the same In, Out and balances.
    await expect(page.getByRole("tab", { name: "Months" })).toHaveCount(0)
    const month = region(page, "Months").getByRole("row").filter({ hasText: format(lastMonth, "MMMM") })
    await expect(month).toContainText("€9,330.00€3,014.64+€6,315.36€9,565.36€1,750.00€11,315.36")

    await page.getByRole("main").getByRole("combobox", { name: "Account" }).click()
    await page.getByRole("option", { name: "Second Bank", exact: true }).click()
    // The €1,500 transfer in is no income: rent 650 + 100 and the 700 deposit. It is in the balance: 0 + 250 + 1,500 = 1,750.
    await expect(totals).toContainText("Money In+€1,450.00")
    await expect(totals).toContainText("Money Out−€1,200.00")
    await expect(totals).toContainText("Transfers (Net)€1,500.00")
    await expect(paid).toContainText("choose All Accounts to see them")

    await page.setViewportSize({ width: 375, height: 812 })
    await expect(totals).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test("the ledger fits a 1024 px laptop and an iPad with the sidebar open, and a wide screen keeps its columns", async ({ page }) => {
    await navigateTo(page, "Cash Book", "/cash-book")
    const sheet = panel(page, "Movements")
    const table = sheet.getByRole("table")
    // Its fixed columns need ~800 px: a narrower card folds each row into two lines, so Amount and
    // Balance never sit behind a sideways scroll. This month has the long "Shareholder Loan Repayment";
    // last month the transfer, with its counterpart.
    for (const [width, height] of [[1024, 768], [768, 1024]]) {
      await page.setViewportSize({ width, height })
      for (const [step, row] of [[null, "Repayment of the fridge"], ["Previous month", "Transfer to Second Bank"]]) {
        if (step) await page.getByRole("button", { name: step }).click()
        await expect(sheet.getByRole("button", { name: row! })).toBeVisible()
        expect(await table.evaluate((t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth), `${width} px`).toBeLessThanOrEqual(0)
        await expect(sheet.getByText(/^Bal\. €/).first()).toBeVisible()
      }
      await page.getByRole("button", { name: "Next month" }).click()
    }
    // A mouse gets the 14 px search, so it fits beside the views.
    expect(await page.getByRole("searchbox", { name: "Search movements" }).evaluate((i) => getComputedStyle(i).fontSize)).toBe("14px")

    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(table.getByRole("columnheader", { name: "Amount" })).toBeVisible()
    await expect(table.getByRole("columnheader", { name: "Balance" })).toBeVisible()
    expect(await table.evaluate((t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth)).toBeLessThanOrEqual(0)
  })
})
