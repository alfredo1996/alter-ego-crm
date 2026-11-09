import { test, expect, type Locator, type Page } from "@playwright/test"
import { addMonths, format, lastDayOfMonth, subDays, subMonths } from "date-fns"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"

/**
 * Month-end billing: hours logged in a closed month show as ready to invoice,
 * Create Invoice opens the one invoice sheet prefilled from them, and the
 * months then read Invoiced. Mark Paid, credit notes, edits and deletes go
 * through the same sheet and the invoice table on /invoices and the client
 * page. The spec seeds through the mock backend the app exposes to e2e (see
 * Providers): the week of hours on /plan has its own spec, hours.spec.ts.
 */

type MockWindow = Window & { __mockBackend?: BackendAdapter }

type Seed = {
  client: string
  /** hours: "YYYY-MM-DD" → hours logged that day. */
  contracts?: { name: string; dailyRate: number; vat: boolean; startMonth?: string; hours: Record<string, number> }[]
  /** Dates as "YYYY-MM-DD". */
  invoices?: {
    number: string
    yearMonth: string
    fromMonth?: string
    amount: number
    vat: number
    dueDate?: string
    paidDate?: string
  }[]
}

/** One client, its contracts with their hours, and its invoices, written straight to the mock backend. */
async function seed(page: Page, data: Seed) {
  await page.evaluate(async ({ client, contracts = [], invoices = [] }) => {
    const backend = (window as MockWindow).__mockBackend
    if (!backend) throw new Error("window.__mockBackend is missing: the e2e server must run the mock backend")
    const user = await backend.auth.getCurrentUser()
    if (!user) throw new Error("not signed in")
    const { id: clientId } = await backend.db.createClient(user.id, { name: client })
    for (const c of contracts) {
      const e = await backend.db.createEngagement(user.id, {
        clientId, name: c.name, dailyRate: c.dailyRate, vatApplicable: c.vat, defaultDaysPerMonth: 5,
        startMonth: c.startMonth ?? null,
      })
      for (const [date, hours] of Object.entries(c.hours)) {
        await backend.db.setTimecard(user.id, { engagementId: e.id, date, hours })
      }
    }
    const day = (value?: string) => (value ? new Date(`${value}T00:00:00`) : null)
    for (const i of invoices) {
      await backend.db.createInvoice(user.id, {
        clientId, ...i, fromMonth: i.fromMonth ?? null, dueDate: day(i.dueDate), paidDate: day(i.paidDate),
      })
    }
  }, data)
}

async function openClient(page: Page, client: string) {
  await navigateTo(page, "Clients", "/clients")
  await page.getByRole("heading", { name: client }).getByRole("link").click()
  await expect(page.getByRole("heading", { name: client, level: 1 })).toBeVisible()
}

/** Delete Contract sits in a contract card's More menu. */
async function deleteContract(page: Page, card: Locator) {
  await card.getByRole("button", { name: /^More actions for / }).click()
  await page.getByRole("menuitem", { name: "Delete Contract" }).click()
}

const ago = (n: number) => subMonths(new Date(), n)
const ym = (n: number) => format(ago(n), "yyyy-MM")
/** invoicePeriodLabel: "Jul–Sep 2026", or "Nov 2025–Jan 2026". */
const periodLabel = (from: Date, to: Date) =>
  `${format(from, from.getFullYear() === to.getFullYear() ? "MMM" : "MMM yyyy")}–${format(to, "MMM yyyy")}`
/** invoiceStatus's day: the year only when it is not this year's. */
const statusDay = (d: Date) => format(d, d.getFullYear() === new Date().getFullYear() ? "d MMM" : "d MMM yyyy")
const monthRow = (page: Page, d: Date) =>
  page.locator("#billing").getByRole("row").filter({ hasText: format(d, "MMM yyyy") })
const invoiceRow = (page: Page, number: string) =>
  page
    .locator("#invoices")
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: number, exact: true }) })
/** /invoices' Unpaid figure: its label's card in the Summary strip. */
const unpaidFigure = (page: Page) =>
  page.getByRole("region", { name: "Summary" }).getByText("Unpaid", { exact: true }).locator("..")
/** Delete and Issue Credit Note sit in the invoice sheet's More menu. */
async function sheetMenu(page: Page, sheet: Locator, item: string) {
  await sheet.getByRole("button", { name: "More actions" }).click()
  await page.getByRole("menuitem", { name: item }).click()
}

test.describe("Client billing", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("logged hours show as to invoice until Create Invoice covers the month", async ({ page }) => {
    const client = uniqueName("Billing")
    const lastMonth = format(subMonths(new Date(), 1), "yyyy-MM")
    const lastMonthLabel = format(subMonths(new Date(), 1), "MMM yyyy")

    // Form defaults: €500/day.
    await navigateTo(page, "Clients", "/clients")
    await page.getByRole("button", { name: "New Contract", exact: true }).click()
    const form = page.getByRole("dialog", { name: "New Contract" })
    await page.getByRole("combobox").filter({ hasText: "Choose or type a client" }).first().click()
    await page.getByPlaceholder(/search or type a new name/i).fill(client)
    await page.getByRole("option").filter({ hasText: client }).first().click()
    await form.getByRole("button", { name: /^create contract$/i }).click()
    await expect(form).toBeHidden()

    // 16 h = 2 days × €500.
    await page.evaluate(
      async ({ client, date }) => {
        const backend = (window as MockWindow).__mockBackend
        if (!backend) throw new Error("window.__mockBackend is missing: the e2e server must run the mock backend")
        const user = await backend.auth.getCurrentUser()
        if (!user) throw new Error("not signed in")
        const clientId = (await backend.db.getClients(user.id)).find((c) => c.name === client)?.id
        const engagement = (await backend.db.getEngagements(user.id)).find((e) => e.clientId === clientId)
        if (!engagement) throw new Error(`no contract for ${client}`)
        await backend.db.setTimecard(user.id, { engagementId: engagement.id, date, hours: 16 })
      },
      { client, date: `${lastMonth}-10` },
    )

    await page.getByRole("heading", { name: client }).getByRole("link").click()
    await expect(page).toHaveURL(/\/clients\/[^/]+$/)
    await expect(page.getByRole("heading", { name: client, level: 1 })).toBeVisible()
    // The Billing card's Ready to invoice, beside the client's last six months of invoices.
    const ready = page.locator("#ready")
    await expect(ready).toContainText("Ready to invoice")
    await expect(ready).toContainText("€1,000.00")
    const bar = page.getByRole("img", { name: `${lastMonthLabel}: €1,000.00` })
    await expect(page.getByText("No invoices in the last 6 months.")).toBeVisible()

    const billing = page.locator("#billing")
    const row = billing.getByRole("row").filter({ hasText: lastMonthLabel })
    await expect(row).toContainText("16 h")
    await expect(row).toContainText("€1,000.00 to invoice")
    await billing.getByRole("button", { name: "Create Invoice" }).click()

    // Prefilled from the hours; the first invoice has no series to continue, so the number is typed.
    const sheet = page.getByRole("dialog", { name: "Record Invoice" })
    await expect(sheet.getByLabel("Net amount")).toHaveValue("1000")
    await expect(sheet.getByLabel("VAT")).toHaveValue("220")
    await expect(sheet.getByLabel("Invoice number")).toBeFocused()
    await expect(sheet.getByLabel("Invoice number")).toHaveValue("")
    await sheet.getByLabel("Invoice number").fill("1")
    await sheet.getByRole("button", { name: "Record Invoice" }).click()
    await expect(sheet).toBeHidden()
    await expect(page.getByText(`Invoice 1 recorded. ${lastMonthLabel} is now invoiced.`, { exact: true })).toBeVisible()

    await expect(row.getByText("Invoiced", { exact: true })).toBeVisible()
    await expect(row.getByRole("button", { name: "1", exact: true })).toBeVisible()
    // The card turns to the month being worked: its Create Invoice is that month's now.
    await expect(ready).toContainText("Ready to invoice this month")
    await expect(page.getByText("Ended months are all invoiced.")).toBeVisible()
    await expect(bar).toBeVisible()
    expect((await bar.locator("div").boundingBox())?.height).toBeGreaterThan(0)

    await navigateTo(page, "Invoices", "/invoices")
    await expect(page.getByRole("heading", { name: "Invoices", level: 1 })).toBeVisible()
    const chart = page.getByRole("region", { name: "Invoiced by Month" })
    await expect(chart.getByText("Last 12 months", { exact: true }).locator("..")).toContainText("€1,000.00")
    await expect(page.locator("#ready")).toContainText("Nothing to invoice: every ended month with hours is invoiced.")
    const recorded = invoiceRow(page, "1")
    await expect(recorded).toContainText(client)
    await expect(recorded).toContainText("€1,220.00")
    await expect(recorded).toContainText("Unpaid")
  })

  // Invoices bill the customer: one a month covers every contract's hours (Lumon's August).
  test("one invoice covers a client's three contracts", async ({ page }) => {
    const client = uniqueName("Three")
    const lastMonth = format(subMonths(new Date(), 1), "yyyy-MM")
    const lastMonthLabel = format(subMonths(new Date(), 1), "MMM yyyy")
    const days = { Operator: 8, Consulting: 4, Labs: 5 } // days of 8 h at €700, no VAT
    await seed(page, {
      client,
      contracts: Object.entries(days).map(([name, n]) => ({
        name, dailyRate: 700, vat: false,
        hours: Object.fromEntries(
          Array.from({ length: n }, (_, d) => [`${lastMonth}-${String(d + 1).padStart(2, "0")}`, 8]),
        ),
      })),
    })

    await openClient(page, client)
    const row = page.locator("#billing").getByRole("row").filter({ hasText: lastMonthLabel })
    await expect(row).toContainText("€11,900.00 to invoice")
    await page.locator("#billing").getByRole("button", { name: "Create Invoice" }).click()

    // The month's contract lines are in the sheet's breakdown, under the month they make up.
    const sheet = page.getByRole("dialog", { name: "Record Invoice" })
    await expect(sheet).toContainText("Operator 64 h · €5,600.00")
    await expect(sheet).toContainText("Consulting 32 h · €2,800.00")
    await expect(sheet).toContainText("Labs 40 h · €3,500.00")
    await expect(sheet.getByLabel("Net amount")).toHaveValue("11900")
    await expect(sheet.getByLabel("VAT")).toHaveValue("0")
    await sheet.getByLabel("Invoice number").fill("14")
    await sheet.getByRole("button", { name: "Record Invoice" }).click()
    await expect(sheet).toBeHidden()

    await expect(row.getByText("Invoiced", { exact: true })).toBeVisible()
    await expect(row.getByRole("button", { name: "14", exact: true })).toBeVisible()
    await expect(page.getByText("Ended months are all invoiced.")).toBeVisible()

    await navigateTo(page, "Invoices", "/invoices")
    await expect(page.locator("#ready")).toContainText("Nothing to invoice")
  })

  // Nordic's quarter: three open months are one suggestion, one button, one invoice.
  test("several months recorded as one invoice from /invoices, number and due date prefilled", async ({ page }) => {
    const client = uniqueName("Nordic")
    const year = format(new Date(), "yyyy")
    const termsEnd = format(lastDayOfMonth(ago(3)), "yyyy-MM-dd")
    await seed(page, {
      client,
      // 40 + 16 + 48 h at €500/day: €2,500 + €1,000 + €3,000, with 22% VAT.
      contracts: [
        {
          name: "Retail", dailyRate: 500, vat: true,
          hours: { [`${ym(3)}-10`]: 40, [`${ym(2)}-10`]: 16, [`${ym(1)}-10`]: 48 },
        },
      ],
      // The last invoice sets the series and the terms: due the month after, on its last day.
      invoices: [{ number: `17/${year}`, yearMonth: ym(4), amount: 2000, vat: 440, dueDate: termsEnd, paidDate: termsEnd }],
    })
    const period = periodLabel(ago(3), ago(1))

    await navigateTo(page, "Invoices", "/invoices")
    const line = page.locator("#ready").getByRole("listitem").filter({ hasText: client })
    await expect(line).toContainText(`${period} · 104 h`)
    await expect(line).toContainText("€6,500.00 + VAT")
    await line.getByRole("button", { name: `Create Invoice for ${client}, ${period}` }).click()

    const sheet = page.getByRole("dialog", { name: "Record Invoice" })
    await expect(sheet.getByLabel("Invoice number")).toHaveValue(`18/${year}`)
    await expect(sheet.getByLabel("Due date")).toHaveValue(format(lastDayOfMonth(new Date()), "yyyy-MM-dd"))
    await expect(sheet.getByLabel("Net amount")).toHaveValue("6500")
    await expect(sheet.getByLabel("VAT")).toHaveValue("1430")
    await sheet.getByRole("button", { name: "Record Invoice" }).click()
    await expect(sheet).toBeHidden()

    await expect(page.locator("#ready")).toContainText("Nothing to invoice")
    await expect(invoiceRow(page, `18/${year}`)).toContainText(period)

    await openClient(page, client)
    const short = `${format(ago(3), "MMM")}–${format(ago(1), "MMM")}`
    for (const n of [3, 2, 1]) {
      const row = monthRow(page, ago(n))
      await expect(row.getByText("Invoiced", { exact: true })).toBeVisible()
      await expect(row.getByRole("button", { name: `18/${year} (${short})` })).toBeVisible()
    }
  })

  // Its hours are what the client's invoices are checked against, so they are never deleted with it.
  test("a contract with hours closes, never deletes", async ({ page }) => {
    const client = uniqueName("Close")
    const lastMonth = format(subMonths(new Date(), 1), "yyyy-MM")
    const nextMonth = format(addMonths(new Date(), 1), "yyyy-MM")

    await navigateTo(page, "Clients", "/clients")
    await page.getByRole("button", { name: "New Contract", exact: true }).click()
    const form = page.getByRole("dialog", { name: "New Contract" })
    await page.getByRole("combobox").filter({ hasText: "Choose or type a client" }).first().click()
    await page.getByPlaceholder(/search or type a new name/i).fill(client)
    await page.getByRole("option").filter({ hasText: client }).first().click()
    await form.getByRole("button", { name: /^create contract$/i }).click()
    await expect(form).toBeHidden()

    await page.evaluate(
      async ({ client, date, ahead }) => {
        const backend = (window as MockWindow).__mockBackend
        if (!backend) throw new Error("window.__mockBackend is missing: the e2e server must run the mock backend")
        const user = await backend.auth.getCurrentUser()
        if (!user) throw new Error("not signed in")
        const clientId = (await backend.db.getClients(user.id)).find((c) => c.name === client)?.id
        const engagement = (await backend.db.getEngagements(user.id)).find((e) => e.clientId === clientId)
        if (!engagement) throw new Error(`no contract for ${client}`)
        await backend.db.setTimecard(user.id, { engagementId: engagement.id, date, hours: 8 })
        // Scheduled ahead: the close keeps it, and it bills once its day passes.
        await backend.db.setTimecard(user.id, { engagementId: engagement.id, date: ahead, hours: 8 })
      },
      { client, date: `${lastMonth}-10`, ahead: `${nextMonth}-10` },
    )

    // Contracts are worked on the client's page.
    await openClient(page, client)
    const card = page.getByRole("region", { name: "Contracts", exact: true }).getByRole("article")
    const confirm = page.getByRole("alertdialog")
    await deleteContract(page, card)
    await expect(confirm).toContainText("has 16 h logged")
    await expect(confirm).toContainText("8 h dated after its last day")
    await expect(confirm).toContainText("still bill once their day passes")
    await confirm.getByRole("button", { name: "Close Contract" }).click()
    await expect(confirm).toBeHidden()
    // A closed contract folds away: focus goes to the toggle that brings it back.
    const toggle = page.getByRole("button", { name: "Show 1 Closed Contract" })
    await expect(page.getByRole("region", { name: "Contracts", exact: true })).toContainText("No active contracts.")
    await expect(toggle).toBeFocused()
    await toggle.click()
    await expect(card).toContainText("Closed · ended")

    await deleteContract(page, card)
    await expect(confirm).toContainText("closed already")
    await expect(confirm.getByRole("button", { name: "Close Contract" })).toHaveCount(0)
    await expect(confirm.getByRole("button", { name: /^delete$/i })).toHaveCount(0)
    await confirm.getByRole("button", { name: "Cancel" }).click()
    await expect(card.getByRole("button", { name: /^More actions for / })).toBeVisible()
  })

  // Globex's #9: recorded on the month it was issued, it pays the three before hours were logged.
  test("an invoice edited to cover the months before hours were logged", async ({ page }) => {
    const client = uniqueName("Period")
    const lastMonth = ym(1)
    const [from, to] = [ago(4), ago(2)]
    await seed(page, {
      client,
      // Started the month hours begin, so last month's invoice reads ahead rather than started mid-month.
      contracts: [
        { name: "Retainer", dailyRate: 500, vat: true, startMonth: lastMonth, hours: { [`${lastMonth}-10`]: 16 } },
      ],
      invoices: [{ number: "9", yearMonth: lastMonth, amount: 3000, vat: 660 }],
    })

    await openClient(page, client)
    await expect(page.getByText("Invoiced €2,000.00 more than the hours")).toBeVisible()

    await invoiceRow(page, "9").getByRole("button", { name: "9", exact: true }).click()
    const sheet = page.getByRole("dialog", { name: "Invoice 9" })
    await expect(sheet.getByLabel("VAT")).toHaveValue("660")
    await sheet.getByRole("combobox", { name: "From" }).click()
    await page.getByRole("option", { name: format(from, "MMM yyyy") }).click()
    await sheet.getByRole("combobox", { name: "To" }).click()
    await page.getByRole("option", { name: format(to, "MMM yyyy") }).click()
    await expect(sheet).toContainText("Split by hours value.")
    await sheet.getByRole("button", { name: "Save Changes" }).click()
    await expect(sheet).toBeHidden()
    // Focus back on the number that opened it, so Tab carries on from the row.
    await expect(invoiceRow(page, "9").getByRole("button", { name: "9", exact: true })).toBeFocused()

    await expect(page.locator("#ready")).toContainText("Ready to invoice")
    await expect(page.locator("#ready")).toContainText("€1,000.00")
    await expect(monthRow(page, ago(1))).toContainText("€1,000.00 to invoice")
    const short = `${format(from, "MMM")}–${format(to, "MMM")}`
    for (const n of [4, 3, 2]) {
      const row = monthRow(page, ago(n))
      await expect(row).toContainText("€1,000.00")
      await expect(row).toContainText("No hours")
      await expect(row.getByRole("button", { name: `9 (${short})` })).toBeVisible()
    }
    await expect(invoiceRow(page, "9")).toContainText(periodLabel(from, to))
  })

  test("a typo fixed in the sheet, and a delete that asks first", async ({ page }) => {
    const client = uniqueName("Typo")
    await seed(page, { client, invoices: [{ number: "2O", yearMonth: ym(1), amount: 1000, vat: 220 }] })

    await navigateTo(page, "Invoices", "/invoices")
    await invoiceRow(page, "2O").click()
    const edit = page.getByRole("dialog", { name: "Invoice 2O" })
    await edit.getByLabel("Invoice number").fill("20")
    await edit.getByRole("button", { name: "Save Changes" }).click()
    await expect(edit).toBeHidden()
    await expect(page.getByText("Invoice 20 saved.", { exact: true })).toBeVisible()
    await expect(invoiceRow(page, "2O")).toHaveCount(0)

    await invoiceRow(page, "20").getByRole("button", { name: "20", exact: true }).click()
    const sheet = page.getByRole("dialog", { name: "Invoice 20" })
    const confirm = page.getByRole("alertdialog")
    await sheetMenu(page, sheet, "Delete Invoice")
    await expect(confirm).toContainText("Delete Invoice 20?")
    await expect(confirm).toContainText("This removes the app's copy only")
    await confirm.getByRole("button", { name: "Cancel" }).click()
    await expect(confirm).toBeHidden()
    await expect(sheet).toBeVisible()

    await sheetMenu(page, sheet, "Delete Invoice")
    await confirm.getByRole("button", { name: "Delete Invoice" }).click()
    await expect(sheet).toBeHidden()
    await expect(page.getByText("Invoice 20 deleted.", { exact: true })).toBeVisible()
    await expect(page.locator("#invoices")).toContainText("No invoices recorded yet.")
  })

  test("a credit note issued from the invoice it corrects", async ({ page }) => {
    const client = uniqueName("Credit")
    await seed(page, { client, invoices: [{ number: "20", yearMonth: ym(1), amount: 1000, vat: 220 }] })

    await navigateTo(page, "Invoices", "/invoices")
    await invoiceRow(page, "20").getByRole("button", { name: "20", exact: true }).click()
    await sheetMenu(page, page.getByRole("dialog", { name: "Invoice 20" }), "Issue Credit Note")

    // Positive amounts, the VAT mirrored; stored negative.
    const credit = page.getByRole("dialog", { name: "Credit Note for 20" })
    await expect(credit.getByLabel("Amount credited")).toHaveValue("1000")
    await expect(credit.getByLabel("VAT")).toHaveValue("220")
    await credit.getByLabel("Credit note number").fill("NC 1")
    await credit.getByRole("button", { name: "Record Credit Note" }).click()
    await expect(credit).toBeHidden()

    const row = invoiceRow(page, "NC 1")
    await expect(row).toContainText("-€1,000.00")
    await expect(row).toContainText("-€1,220.00")
    await expect(row).toContainText("Credit note · open")
    await expect(unpaidFigure(page)).toContainText("€0.00")

    // Its panel signs the total as the list does.
    await row.getByRole("button", { name: "NC 1", exact: true }).click()
    const panel = page.getByRole("dialog", { name: "Credit Note NC 1" })
    await expect(panel.getByText("Back to the customer").locator("..")).toContainText("-€1,220.00")
  })

  test("Mark Paid on a chosen day settles the credit note deducted from it, here and on Deadlines", async ({ page }) => {
    const client = uniqueName("Paid")
    const paidOn = subDays(new Date(), 1)
    await seed(page, {
      client,
      invoices: [
        { number: "14", yearMonth: ym(2), amount: 14000, vat: 0, dueDate: format(subDays(new Date(), 5), "yyyy-MM-dd") },
        { number: "NC 2", yearMonth: ym(2), amount: -700, vat: 0 },
      ],
    })

    await navigateTo(page, "Invoices", "/invoices")
    // From a tab and a search that hide it, the pill still lands on the overdue invoice.
    await page.getByRole("tab", { name: /^Paid/ }).click()
    await page.getByRole("searchbox", { name: "Search invoices" }).fill("NC 2")
    await page.getByRole("link", { name: "1 overdue" }).click()
    await expect(page).toHaveURL(/\/invoices\?status=overdue#invoices$/)
    await expect(page.getByRole("tab", { name: /^Overdue/, selected: true })).toBeVisible()
    await expect(page.getByRole("searchbox", { name: "Search invoices" })).toHaveValue("")
    await expect(page.locator("#invoices")).toBeInViewport()
    const row = invoiceRow(page, "14")
    await expect(row).toContainText("Overdue · due")
    await row.getByRole("button", { name: "Mark Paid" }).click()

    const popup = page.getByRole("dialog", { name: "Mark 14 Paid" })
    await expect(popup).toBeVisible()
    await expect(popup.getByLabel("Paid on")).toHaveValue(format(new Date(), "yyyy-MM-dd"))
    await expect(popup.getByRole("checkbox", { name: "Also settle NC 2" })).toBeChecked()
    await expect(popup).toContainText("Expected in the bank: €13,300.00")
    await popup.getByLabel("Paid on").fill(format(paidOn, "yyyy-MM-dd"))
    await popup.getByRole("button", { name: "Mark Paid" }).click()

    // Marked, never moved: the rows keep their place, their badges change, the number takes focus.
    await expect(row).toContainText(`Paid ${statusDay(paidOn)}`)
    await expect(row.getByRole("button", { name: "14", exact: true })).toBeFocused()
    // The pill opened the Overdue tab, which never listed the credit note: All does.
    await page.getByRole("tab", { name: /^All/ }).click()
    await expect(invoiceRow(page, "NC 2")).toContainText(`Credit note · settled ${statusDay(paidOn)}`)
    await expect(unpaidFigure(page)).toContainText("€0.00")

    // Deadlines: Mark Unpaid clears the date with an Undo; Mark Paid opens the same popup.
    // The row is named by its title, the client beside it; it moves from Done to Overdue and back.
    await navigateTo(page, "Deadlines", "/deadlines")
    const deadline = page.getByRole("listitem", { name: "Invoice 14", exact: true }).filter({ hasText: client })
    await expect(deadline).toContainText(`Paid ${statusDay(paidOn)}`)
    await deadline.getByRole("button", { name: "Mark Unpaid" }).click()
    await expect(page.getByText("Invoice 14 marked unpaid.", { exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "Overdue" }).getByRole("listitem", { name: "Invoice 14" })).toBeVisible()
    await deadline.getByRole("button", { name: "Mark Paid" }).click()
    const again = page.getByRole("dialog", { name: "Mark 14 Paid" })
    await expect(again).toBeVisible()
    await again.getByRole("button", { name: "Mark Paid" }).click()
    await expect(deadline.getByRole("button", { name: "Mark Unpaid" })).toBeVisible()
  })

  test("the client page and its sheet fit a phone", async ({ page }) => {
    const client = uniqueName("Phone")
    const longName = "Operator platform engineering and support"
    await seed(page, {
      client,
      contracts: [
        { name: "Retail", dailyRate: 500, vat: true, hours: { [`${ym(1)}-10`]: 48, [`${ym(2)}-10`]: 40 } },
        { name: longName, dailyRate: 500, vat: true, hours: { [`${ym(1)}-11`]: 32 } },
      ],
      invoices: [
        { number: "9/2026", fromMonth: ym(5), yearMonth: ym(3), amount: 7500, vat: 1650, paidDate: format(ago(1), "yyyy-MM-dd") },
        { number: "14/2026", yearMonth: ym(2), amount: 2500, vat: 550, dueDate: format(subDays(new Date(), 3), "yyyy-MM-dd") },
      ],
    })
    await page.setViewportSize({ width: 375, height: 812 })

    // The Clients card's unpaid line lands on the Invoices card, below the fold on a phone.
    await navigateTo(page, "Clients", "/clients")
    await page
      .getByRole("article", { name: client, exact: true })
      .getByRole("link", { name: /^Invoices: €3,050\.00 unpaid · 1 overdue/ })
      .click()
    await expect(page).toHaveURL(/\/clients\/[^/]+#invoices$/)
    await expect(page.getByRole("heading", { name: client, level: 1 })).toBeVisible()
    await expect(page.locator("#invoices")).toBeInViewport()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    const width = () => page.evaluate(() => document.documentElement.scrollWidth)
    expect(await width()).toBeLessThanOrEqual(375)

    await page.locator("#billing").getByRole("button", { name: "Create Invoice" }).click()
    const sheet = page.getByRole("dialog", { name: "Record Invoice" })
    await expect(sheet).toBeVisible()
    expect((await sheet.boundingBox())?.width).toBe(375)
    // The breakdown: no Hours value column, each contract on one line, a long name truncated.
    await expect(sheet.getByRole("columnheader", { name: "Hours value" })).toBeHidden()
    const contract = sheet.getByTitle(longName)
    await expect(contract.locator("..")).toContainText("32 h · €2,000.00")
    expect(await contract.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    expect((await contract.locator("..").boundingBox())?.height).toBeLessThanOrEqual(16)
    expect(await sheet.locator("table").evaluate((t) => t.parentElement!.scrollWidth <= t.parentElement!.clientWidth)).toBe(true)
    await sheet.getByRole("button", { name: "Cancel" }).click()
    await expect(sheet).toBeHidden()

    await navigateTo(page, "Invoices", "/invoices")
    await expect(page.getByRole("heading", { name: "Invoices", level: 1 })).toBeVisible()
    expect(await width()).toBeLessThanOrEqual(375)
    // A row as Invoices-phone.dc draws it: number · months beside the total, then the customer beside
    // its pill, each one line, and Mark Paid across under them.
    const overdue = invoiceRow(page, "14/2026")
    await expect(overdue).toContainText("Overdue · due")
    await expect(overdue).toContainText(`14/2026 · ${format(ago(2), "MMM yyyy")}`)
    const box = async (l: Locator) => (await l.boundingBox())!
    const middle = (b: { y: number; height: number }) => b.y + b.height / 2
    const number = await box(overdue.getByRole("button", { name: "14/2026", exact: true }))
    const total = await box(overdue.getByText("€3,050.00").first())
    const customer = await box(overdue.getByText(client, { exact: true }).first())
    // A string, not a regex: the pill's spaces are non-breaking, and only a string match normalises them.
    const pill = await box(overdue.getByText("Overdue · due").first())
    expect(Math.abs(middle(number) - middle(total))).toBeLessThan(6)
    expect(Math.abs(middle(customer) - middle(pill))).toBeLessThan(6)
    expect(middle(customer)).toBeGreaterThan(middle(total) + 8)
    expect(customer.height).toBeLessThanOrEqual(22)
    const markPaid = await box(overdue.getByRole("button", { name: "Mark Paid" }))
    expect(markPaid.y).toBeGreaterThanOrEqual(pill.y + pill.height)
    expect(markPaid.width).toBeGreaterThan(300)

    // Mark Paid keeps a gutter on both sides instead of touching the screen edge.
    await overdue.getByRole("button", { name: "Mark Paid" }).click()
    const dialog = page.getByRole("dialog", { name: "Mark 14/2026 Paid" })
    await expect(dialog).toBeVisible()
    // Measured once its zoom-in ends: mid-animation it is scaled down, away from the edge.
    await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    const popup = await dialog.boundingBox()
    expect(popup!.x).toBeGreaterThanOrEqual(16)
    expect(popup!.x + popup!.width).toBeLessThanOrEqual(375 - 16)
  })

  test("the client's invoiced chart draws six months in proportion, and a phone leaves it out", async ({ page }) => {
    const client = uniqueName("Chart")
    // A retainer invoiced every month, one of them a credit note: the client page charts the last six.
    const amounts = [9800, 10100, -8700, 11924, 10500, 9900, 5962, 10200, 11000, 9700, 10800, 9800]
    const months = amounts.map((_, i) => format(subMonths(new Date(), 11 - i), "yyyy-MM"))
    await page.evaluate(
      async ({ client, months, amounts }) => {
        const backend = (window as MockWindow).__mockBackend
        if (!backend) throw new Error("window.__mockBackend is missing: the e2e server must run the mock backend")
        const user = await backend.auth.getCurrentUser()
        if (!user) throw new Error("not signed in")
        const { id: clientId } = await backend.db.createClient(user.id, { name: client })
        await backend.db.createEngagement(user.id, {
          clientId, name: "Retainer", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 20,
        })
        for (const [i, yearMonth] of months.entries()) {
          await backend.db.createInvoice(user.id, { clientId, number: `C-${i}`, yearMonth, amount: amounts[i], vat: 0 })
        }
      },
      { client, months, amounts },
    )

    await navigateTo(page, "Clients", "/clients")
    await page.getByRole("heading", { name: client }).getByRole("link").click()
    await expect(page.getByRole("heading", { name: client, level: 1 })).toBeVisible()

    const columns = page.getByRole("img", { name: /^\w{3} \d{4}: / })
    await expect(columns).toHaveCount(6)
    const widths = await columns.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1)

    const barHeight = async (amount: string) =>
      (await page.getByRole("img", { name: `: ${amount}` }).locator("div").boundingBox())?.height ?? 0
    const max = await barHeight("€11,000.00")
    expect((await barHeight("€10,200.00")) / max).toBeCloseTo(0.93, 1)
    expect((await barHeight("€5,962.00")) / max).toBeCloseTo(0.54, 1)

    // The phone board draws no chart: the month rows below say the same, and nothing scrolls sideways.
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(columns).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })
})
