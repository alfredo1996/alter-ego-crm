import { test, expect, type Page } from "@playwright/test"
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns"

import { seedMonthEndExample } from "./helpers/month-end-seed"
import { signIn, navigateTo } from "./helpers/test-utils"

/** The toast's own line only: the hidden screen-reader copy reads "Notification …". */
const toastText = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)

/**
 * The plan's four examples on the mock backend, each fixed from Month End
 * itself, in the window the other pages use, with the dates on last month's
 * last day where the date decides it. Dates follow the day the suite runs.
 */

const ago = (n: number) => subMonths(startOfMonth(new Date()), n)
const monthName = (n: number) => format(ago(n), "MMMM yyyy")
const short = (n: number) => format(ago(n), "MMM yyyy")
/** Last month's last day, as a date input holds it. */
const monthEnd = format(endOfMonth(ago(1)), "yyyy-MM-dd")

async function open(page: Page, example: "A" | "B" | "C" | "D") {
  await signIn(page)
  await seedMonthEndExample(page, example)
  await navigateTo(page, "Month End", "/month-end")
}

/** A Radix select: open it, then pick the option. */
async function pick(page: Page, scope: ReturnType<Page["getByRole"]>, label: string, option: string) {
  await scope.getByRole("combobox", { name: label }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}

test.describe("Month End fixes", () => {
  test("A: records the missing invoice and moves a misdated one to its month", async ({ page }) => {
    await open(page, "A")
    const verdict = page.getByRole("region", { name: "Verdict" })
    await expect(verdict).toContainText(`${monthName(1)}: 1 step to do (Invoices)`)
    await expect(verdict).toContainText(`Also open: 1 earlier month (oldest: ${monthName(2)})`)
    const invoices = page.getByRole("region", { name: "Invoices", exact: true })
    await expect(invoices).toContainText(`Lumen Srl, ${monthName(1)}: €4,050.00 not invoiced`)
    await expect(invoices).toContainText(`the ${format(ago(2), "MMMM")} invoice? Edit its period.`)

    await invoices.getByRole("button", { name: "Record Invoice" }).click()
    let sheet = page.getByRole("dialog", { name: "Record Invoice" })
    await expect(sheet.getByRole("combobox", { name: "From" })).toHaveText(short(1))
    await expect(sheet.getByRole("combobox", { name: "To" })).toHaveText(short(1))
    await expect(sheet.getByLabel("Net amount")).toHaveValue("4050")
    await sheet.getByRole("button", { name: "Record Invoice" }).click()
    await expect(sheet).toBeHidden()
    await expect(invoices).not.toContainText(`Lumen Srl, ${monthName(1)}`)

    await invoices.getByRole("button", { name: "Edit Period" }).click()
    sheet = page.getByRole("dialog", { name: /^Invoice 15\// })
    await expect(sheet.getByRole("combobox", { name: "From" })).toHaveText(short(0))
    await pick(page, sheet, "From", short(2))
    await pick(page, sheet, "To", short(2))
    await sheet.getByRole("button", { name: "Save Changes" }).click()
    await expect(sheet).toBeHidden()
    // Recomputed in place: no reload, no other page.
    await expect(verdict).toContainText(`${monthName(1)} is closed: every required step is done.`)
    await expect(verdict).not.toContainText("Also open")
  })

  test("B: marks the invoice a Missing IN matches paid on the month's last day, and the bank matches", async ({ page }) => {
    await open(page, "B")
    const verdict = page.getByRole("region", { name: "Verdict" })
    await expect(verdict).toContainText(`${monthName(1)}: 1 step to do (Bank)`)
    const bank = page.getByRole("region", { name: "Bank" })
    await expect(bank).toContainText("Main Bank: Missing IN of €1,830.00")
    await expect(bank).toContainText("Nordica Spa, €1,830.00, unpaid: was it paid?")
    // Waiting for Payment, above, names the same match: its Mark Paid dates it as the Bank does.
    await expect(page.getByRole("region", { name: "Waiting for Payment" })).toContainText("It may be the Missing IN on Main Bank.")

    await bank.getByRole("button", { name: /^Mark 12\/\d{4} Paid$/ }).click()
    const popup = page.getByRole("dialog", { name: /^Mark 12\/\d{4} Paid$/ })
    // Not today: today would put the money in this month and leave last month's check red.
    await expect(popup.getByLabel("Paid on")).toHaveValue(monthEnd)
    await expect(popup.getByRole("combobox", { name: "Into Account" })).toHaveText("Main Bank")
    await popup.getByRole("button", { name: "Mark Paid" }).click()
    await expect(popup).toBeHidden()
    await expect(verdict).toContainText(`${monthName(1)} is closed: every required step is done.`)
    await bank.getByText("What was checked (1)").click()
    await expect(bank).toContainText(`Main Bank: Matches the bank on ${format(endOfMonth(ago(1)), "dd/MM/yyyy")}`)
  })

  test("C: links a forgotten payment to its estimate and moves a late one into the month", async ({ page }) => {
    await open(page, "C")
    const verdict = page.getByRole("region", { name: "Verdict" })
    // Amber only: never blocking.
    await expect(verdict).toContainText(`${monthName(1)} is closed: every required step is done.`)
    await expect(verdict).toContainText("2 recurring costs not paid")
    const recurring = page.getByRole("region", { name: "Recurring Costs" })
    await expect(recurring).toContainText('Paid as "Accountant monthly"')

    await recurring.getByRole("button", { name: "Link" }).click()
    let dialog = page.getByRole("dialog", { name: "Edit Cost" })
    await expect(dialog.getByRole("combobox", { name: "Pays Recurring Cost" })).toContainText("Accountant fee")
    await dialog.getByRole("button", { name: "Save Changes" }).click()
    await expect(dialog).toBeHidden()
    await expect(verdict).toContainText("1 recurring cost not paid")

    await recurring.getByRole("button", { name: "Edit Date" }).click()
    dialog = page.getByRole("dialog", { name: "Edit Cost" })
    await expect(dialog.getByLabel("Date")).toHaveValue(format(new Date(ago(0).getFullYear(), ago(0).getMonth(), 2), "yyyy-MM-dd"))
    await dialog.getByLabel("Date").fill(monthEnd)
    await dialog.getByRole("button", { name: "Save Changes" }).click()
    await expect(dialog).toBeHidden()
    await expect(recurring.getByText("Nothing to do")).toBeVisible()
    await expect(verdict).not.toContainText("recurring cost")
  })

  test("D: closes a month from the top, Use, No Work, Check Balance and Mark Done, then downloads it", async ({ page }) => {
    await open(page, "D")
    const verdict = page.getByRole("region", { name: "Verdict" })
    await expect(verdict).toContainText(`${monthName(1)}: 3 steps to do (Hours, Bank, Deadlines)`)

    const hours = page.getByRole("region", { name: "Hours" })
    await hours.getByRole("button", { name: "Use 9 d" }).click()
    // Anchored: Radix also announces the toast in a hidden "Notification …" copy for a second.
    await expect(page.getByText(toastText(`9 d used: Lumen Srl · Retainer, ${monthName(1)}`))).toBeVisible()
    await expect(hours.getByRole("button", { name: "Use 9 d" })).toBeHidden()
    await hours.getByRole("button", { name: "No Work" }).click()
    await expect(page.getByText(toastText(`No work: Bottega Rossi · Support, ${monthName(1)}, set to 0 days.`))).toBeVisible()
    await expect(verdict).toContainText(`${monthName(1)}: 2 steps to do (Bank, Deadlines)`)

    const bank = page.getByRole("region", { name: "Bank" })
    await bank.getByRole("button", { name: "Check Balance" }).click()
    const check = page.getByRole("dialog", { name: "Check Balance" })
    await expect(check.getByLabel("On")).toHaveValue(monthEnd)
    await check.getByLabel("Bank Balance").fill("3196")
    await expect(check).toContainText("Matches the bank")
    await check.getByRole("button", { name: "Save Check" }).click()
    await expect(check).toBeHidden()

    await page.getByRole("region", { name: "Deadlines" }).getByRole("button", { name: "Mark Done" }).click()
    await expect(verdict).toContainText(`${monthName(1)} is closed: every required step is done.`)
    await hours.getByText("What was checked (2)").click()
    await expect(hours).toContainText("Bottega Rossi · Support: no work (0 days)")
    await expect(hours).toContainText("Lumen Srl · Retainer: 9 d confirmed")

    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: "Download CSV" }).click()
    expect((await download).suggestedFilename()).toBe(`cash-book_${format(ago(1), "yyyy-MM")}_all-accounts_all-cost-centres.csv`)
  })
})
