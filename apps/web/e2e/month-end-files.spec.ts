import { readFile } from "node:fs/promises"

import { test, expect } from "@playwright/test"
import { format, startOfMonth, subMonths } from "date-fns"
import { strFromU8, unzipSync } from "fflate"

import { seedMonthEndExample } from "./helpers/month-end-seed"
import { signIn, navigateTo } from "./helpers/test-utils"

/**
 * Invoice Files on the mock backend: example C's last month holds two issued
 * invoices without a file. Attach File fills one in place; Download Package saves
 * the month's zip (prima nota, payments, files) with it. On a phone, Download Package is in the More menu.
 */
const last = subMonths(startOfMonth(new Date()), 1)
const month = format(last, "yyyy-MM")
const year = new Date().getFullYear()

test("Attach File clears the row, and Download Package saves a package holding that file", async ({ page, isMobile }) => {
  await signIn(page)
  await seedMonthEndExample(page, "C")
  await navigateTo(page, "Month End", "/month-end")

  const files = page.getByRole("region", { name: "Invoice Files", exact: true })
  const lumen = files.getByRole("listitem").filter({ hasText: `Invoice 16/${year} · Lumen Srl` })
  await expect(lumen).toContainText(`Issued invoice · ${format(last, "MMMM yyyy")}`)
  await expect(files.getByRole("button", { name: "Attach File" })).toHaveCount(2)

  await lumen.getByRole("button", { name: "Attach File" }).click()
  await page.getByLabel("Choose invoice file").setInputFiles({
    name: "IT01_00016.xml",
    mimeType: "application/xml",
    buffer: Buffer.from("<FatturaElettronica/>"),
  })
  // exact: the toast's live region also announces this text on a phone (strict-mode match).
  await expect(page.getByText("Attached IT01_00016.xml.", { exact: true })).toBeVisible()
  await expect(files.getByRole("button", { name: "Attach File" })).toHaveCount(1)
  await expect(lumen.getByRole("button", { name: "Attach File" })).toHaveCount(0)

  if (isMobile) await page.getByRole("button", { name: "More" }).click()
  const download = page.waitForEvent("download")
  await (isMobile ? page.getByRole("menuitem", { name: "Download Package" }) : page.getByRole("button", { name: "Download Package" })).click()
  const saved = await download
  expect(saved.suggestedFilename()).toBe(`${month}-accountant-package.zip`)
  const zip = unzipSync(new Uint8Array(await readFile((await saved.path()) as string)))
  const entry = `invoices/${month} Invoice 16-${year} (Lumen Srl).xml`
  expect(Object.keys(zip).sort()).toEqual([entry, `payments-${month}.csv`, `prima-nota-${month}.csv`])
  expect(strFromU8(zip[`payments-${month}.csv`])).toContain("Date;Account;Paid To;Description;Amount;VAT;Pays;File")
  expect(strFromU8(zip[entry])).toBe("<FatturaElettronica/>")
  await expect(page.getByText(`Saved ${month}-accountant-package.zip`, { exact: true })).toBeVisible()
  await expect(page.getByText(/^\d+ rows?, \d+ payments?, 1 file\. 1 record has no file yet\.$/)).toBeVisible()
})
