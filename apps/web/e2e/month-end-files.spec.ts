import { readFile } from "node:fs/promises"

import { test, expect } from "@playwright/test"
import { format, startOfMonth, subMonths } from "date-fns"
import { strFromU8, unzipSync } from "fflate"

import { seedMonthEndExample } from "./helpers/month-end-seed"
import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

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

test("a cost holds two files: attach both, view the second, download each, remove one, and the package carries what is left", async ({ page, isMobile }) => {
  await signIn(page)
  await seedMonthEndExample(page, "C") // Month End has nothing to close without hours or an account
  await navigateTo(page, "Costs", "/costs")
  const description = uniqueName("Print run")
  const first = { name: "IT01234567890_00118.xml", mimeType: "application/xml", buffer: await readFile("src/lib/__tests__/fixtures/fattura-pa/standard.xml") }
  const second = { name: "IT01234567890_00121.xml.p7m", mimeType: "application/pkcs7-mime", buffer: await readFile("src/lib/__tests__/fixtures/fattura-pa/standard-stream.xml.p7m") }

  // Attach: one file at a time, the second through the add zone that appears under the first.
  await page.getByRole("button", { name: "Add Cost" }).click()
  const add = page.getByRole("dialog", { name: "New Cost" })
  await add.getByLabel("Description").fill(description)
  await add.getByLabel("Amount Before VAT").fill("900")
  await add.getByLabel("Date", { exact: true }).fill(`${month}-15`)
  await add.getByLabel("Choose invoice file").setInputFiles(first)
  await expect(add.getByRole("button", { name: "Add File" })).toBeVisible()
  await add.getByLabel("Choose invoice file").setInputFiles(second)
  await expect(add.getByRole("button", { name: `Remove ${first.name}` })).toBeVisible()
  await expect(add.getByRole("button", { name: `Remove ${second.name}` })).toBeVisible()
  await add.getByRole("button", { name: "Add Cost" }).click()
  await expect(add).toBeHidden()

  const edit = async () => {
    if (isMobile) {
      await page.getByRole("button", { name: `More for ${description}` }).click()
      await page.getByRole("menuitem", { name: "Edit Cost" }).click()
    } else {
      await page.getByRole("button", { name: `Edit ${description}` }).click()
    }
    const dialog = page.getByRole("dialog", { name: "Edit Cost" })
    return { dialog, slot: dialog.getByRole("group", { name: "Invoice Files" }) }
  }

  // View the second: its own address names it, and the page reads it.
  const opened = await edit()
  await expect(opened.slot.getByText(first.name)).toBeVisible()
  await expect(opened.slot.getByText(second.name)).toBeVisible()
  await opened.slot.getByRole("link", { name: `View ${second.name}` }).click()
  await expect(page).toHaveURL(/\/costs\/[^/]+\/file\?file=/)
  await expect(page.getByText(`Read from ${second.name} (FatturaPA FPR12).`)).toBeVisible()
  await page.getByRole("link", { name: "Back" }).click()
  await expect(page).toHaveURL(/\/costs/)

  // Download each: its own bytes under its own name.
  const again = await edit()
  for (const file of [first, second]) {
    const [download] = await Promise.all([page.waitForEvent("download"), again.slot.getByRole("button", { name: `Download ${file.name}` }).click()])
    expect(download.suggestedFilename()).toBe(file.name)
    expect(await readFile((await download.path()) as string)).toEqual(file.buffer)
  }
  await again.dialog.getByRole("button", { name: "Cancel" }).click()

  // The package: Month End names both on the checked line, and the zip holds each file once, numbered.
  const packageFor = async () => {
    if (isMobile) await page.getByRole("button", { name: "More" }).click()
    const download = page.waitForEvent("download")
    await (isMobile ? page.getByRole("menuitem", { name: "Download Package" }) : page.getByRole("button", { name: "Download Package" })).click()
    return unzipSync(new Uint8Array(await readFile(((await (await download).path()) as string))))
  }
  await navigateTo(page, "Month End", "/month-end")
  // A record with files is a checked line; the line names every file.
  await page.getByRole("region", { name: "Invoice Files", exact: true }).getByText(/^What was checked/).click()
  await expect(page.getByText(`2 files: ${first.name}, ${second.name}`)).toBeVisible()
  const stem = `costs/${month}-15 ${description}`
  let zip = await packageFor()
  expect(Object.keys(zip).filter((n) => n.startsWith("costs/"))).toEqual([`${stem} (file 1 of 2).xml`, `${stem} (file 2 of 2).xml.p7m`])
  expect(Buffer.from(zip[`${stem} (file 2 of 2).xml.p7m`])).toEqual(second.buffer)
  await expect(page.getByText(/^\d+ rows?, \d+ payments?, 2 files\./)).toBeVisible()

  // Remove one on Save: the other stays, under the plain name of a record with one file.
  await navigateTo(page, "Costs", "/costs")
  const last = await edit()
  await last.slot.getByRole("button", { name: `More actions for ${first.name}` }).click()
  await page.getByRole("menuitem", { name: "Remove File" }).click()
  await last.dialog.getByRole("button", { name: "Save Changes" }).click()
  await expect(last.dialog).toBeHidden()
  await navigateTo(page, "Month End", "/month-end")
  await page.getByRole("region", { name: "Invoice Files", exact: true }).getByText(/^What was checked/).click()
  await expect(page.getByText(second.name, { exact: true })).toBeVisible()
  zip = await packageFor()
  expect(Object.keys(zip).filter((n) => n.startsWith("costs/"))).toEqual([`${stem}.xml.p7m`])
})
