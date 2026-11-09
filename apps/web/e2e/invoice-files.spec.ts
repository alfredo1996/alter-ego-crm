import { readFile } from "node:fs/promises"

import { test, expect, type Download, type Page } from "@playwright/test"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"

/**
 * The invoice file on a cost and on an invoice, on the mock backend (its files
 * live in memory, so a full page load would wipe them: "later" and "reload" here
 * mean leaving the page and coming back, as billing.spec does).
 */

type MockWindow = Window & { __mockBackend?: BackendAdapter; __uploads?: number }

const SIGNED = { name: "IT02345678901_0b7Q2.xml.p7m", mimeType: "application/pkcs7-mime", buffer: Buffer.from("signed-fattura-bytes") }
const PLAIN = { name: "IT09876543210_00014.xml", mimeType: "application/xml", buffer: Buffer.from('<?xml version="1.0"?><p:FatturaElettronica/>') }
const PDF = { name: "EUINIT26-1234567.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 foreign supplier") }

const bytesOf = async (download: Download) => readFile(await download.path())

/** Counts the uploads the app makes, so "Cancel leaves nothing" is a number and not a hope. */
async function countUploads(page: Page) {
  await page.evaluate(() => {
    const w = window as MockWindow
    const files = w.__mockBackend!.files
    const upload = files.upload.bind(files)
    w.__uploads = 0
    files.upload = (...args) => {
      w.__uploads = (w.__uploads ?? 0) + 1
      return upload(...args)
    }
  })
  return () => page.evaluate(() => (window as MockWindow).__uploads)
}

async function downloaded(page: Page, slot: ReturnType<Page["getByRole"]>) {
  const [download] = await Promise.all([page.waitForEvent("download"), slot.getByRole("button", { name: "Download file" }).click()])
  return { name: download.suggestedFilename(), bytes: await bytesOf(download) }
}

/** Signs in, on a desktop or a phone. */
async function startCompany(page: Page) {
  await signIn(page)
}

const noSideScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)

/** A phone's touch target is 44 px. */
async function bigEnough(locator: ReturnType<Page["getByRole"]>) {
  expect((await locator.boundingBox())!.height).toBeGreaterThanOrEqual(44)
}

/** The object path a cost (by description) or an invoice (by number) names now, read from the mock; null when it names none. */
async function pathOf(page: Page, record: { cost: string } | { invoice: string }) {
  return page.evaluate(async (r) => {
    const backend = (window as MockWindow).__mockBackend!
    const user = await backend.auth.getCurrentUser()
    const file =
      "cost" in r
        ? (await backend.db.getCompanyExpenses(user!.id)).find((e) => e.description === r.cost)?.file
        : (await backend.db.getInvoices(user!.id)).find((i) => i.number === r.invoice)?.file
    return file?.path ?? null
  }, record)
}

/** True when the mock holds no object at that path any more. */
const objectGone = (page: Page, path: string) =>
  page.evaluate(
    (p) => (window as MockWindow).__mockBackend!.files.download({ path: p } as never).then(() => false, () => true),
    path,
  )

async function chooseMore(page: Page, slot: ReturnType<Page["getByRole"]>, item: string) {
  await slot.getByRole("button", { name: "More file actions" }).click()
  await page.getByRole("menuitem", { name: item }).click()
}

test.describe("the invoice file on a cost", () => {
  test.beforeEach(async ({ page }) => {
    await startCompany(page)
    await navigateTo(page, "Costs", "/costs")
  })

  async function addCost(page: Page, description: string, file?: typeof PLAIN) {
    await page.getByRole("button", { name: "Add Cost" }).click()
    const dialog = page.getByRole("dialog", { name: "New Cost" })
    await dialog.getByLabel("Description").fill(description)
    await dialog.getByLabel("Amount Before VAT").fill("900")
    if (file) await dialog.getByLabel("Choose invoice file").setInputFiles(file)
    return dialog
  }

  async function editCost(page: Page, description: string, isMobile: boolean) {
    // The table's row has an Edit button; a phone's card keeps Edit Cost behind its More menu.
    if (isMobile) {
      await page.getByRole("button", { name: `More for ${description}` }).click()
      await page.getByRole("menuitem", { name: "Edit Cost" }).click()
    } else {
      await page.getByRole("button", { name: `Edit ${description}` }).click()
    }
    const dialog = page.getByRole("dialog", { name: "Edit Cost" })
    return { dialog, slot: dialog.getByRole("group", { name: "Invoice File" }) }
  }

  test("View opens a signed XML as the readable invoice, Print leaves the toolbar out, and Back returns to the cost", async ({ page, isMobile }) => {
    const description = uniqueName("Bookkeeping")
    const real = {
      name: "IT09999999990_0b7Q2.xml.p7m",
      mimeType: "application/pkcs7-mime",
      buffer: await readFile("src/lib/__tests__/fixtures/fattura-pa/cdata-stream.xml.p7m"),
    }
    const dialog = await addCost(page, description, real)
    await dialog.getByRole("button", { name: "Add Cost" }).click()
    await expect(dialog).toBeHidden()

    const { dialog: edit, slot } = await editCost(page, description, isMobile)
    // View reads the saved record: an edit in the form makes it wait for Save.
    await edit.getByLabel("Description").fill(`${description} changed`)
    await expect(slot.getByRole("link", { name: "View" })).toHaveCount(0)
    await expect(slot.getByRole("button", { name: "View" })).toBeDisabled()
    await expect(slot.getByText("Save first to view the invoice.")).toBeVisible()
    await edit.getByLabel("Description").fill(description)
    await slot.getByRole("link", { name: "View" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Invoice 112/2026 · Studio Esempio S.r.l." })).toBeVisible()
    // A description in a CDATA section reads as the text it holds.
    await expect(page.getByText("Consulenza straordinaria & <revisione>")).toBeVisible()
    await expect(page.getByText("€1,354.60", { exact: true }).first()).toBeVisible()
    await expect(page.getByText(`Read from ${real.name} (FatturaPA FPR12).`)).toBeVisible()
    await noSideScroll(page)
    await page.screenshot({ path: `.shots/e2e-invoice-view-${isMobile ? "phone" : "desktop"}.png`, fullPage: true })

    await page.emulateMedia({ media: "print" })
    await expect(page.getByRole("link", { name: "Back" })).toBeHidden()
    await expect(page.getByRole("button", { name: "Print" })).toBeHidden()
    await expect(page.getByRole("heading", { level: 2, name: "Invoice" })).toBeVisible()
    await page.screenshot({ path: `.shots/e2e-invoice-view-print-${isMobile ? "phone" : "desktop"}.png`, fullPage: true })
    await page.emulateMedia({ media: "screen" })

    // Back returns to the page the user came from.
    await page.getByRole("link", { name: "Back" }).click()
    await expect(page).toHaveURL(/\/costs$/)
    await expect(page.getByText(description).filter({ visible: true }).first()).toBeVisible()
  })

  test("View lists the stated withholding, stamp duty and pension fund, and saves an attachment under a safe name", async ({ page, isMobile }) => {
    const description = uniqueName("Credit note")
    const stated = {
      name: "IT09999999990_stated.xml",
      mimeType: "application/xml",
      buffer: await readFile("src/lib/__tests__/fixtures/fattura-pa/stated-rows.xml"),
    }
    const dialog = await addCost(page, description, stated)
    await dialog.getByRole("button", { name: "Add Cost" }).click()
    await expect(dialog).toBeHidden()

    const { slot } = await editCost(page, description, isMobile)
    await slot.getByRole("link", { name: "View" }).click()
    await expect(page.getByRole("heading", { level: 2, name: "Credit Note" })).toBeVisible()
    await expect(page.getByText("Invoice 112/2026 of 30 Sep 2026")).toBeVisible()
    await expect(page.getByText("Stamp Duty")).toBeVisible()
    await expect(page.getByText("Pension Fund")).toBeVisible()
    await expect(page.getByText("Withholding")).toBeVisible()
    await expect(page.getByText("Total", { exact: true })).toBeVisible()
    await noSideScroll(page)
    await page.screenshot({ path: `.shots/e2e-invoice-view-stated-${isMobile ? "phone" : "desktop"}.png`, fullPage: true })

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download ../nota:1.txt" }).click()])
    expect(download.suggestedFilename()).toBe("nota_1.txt")
    expect((await bytesOf(download)).toString()).toBe("hello attachment")
  })

  test("a file attached on save is there after leaving the page, and downloads the same bytes", async ({ page, isMobile }) => {
    const description = uniqueName("Bookkeeping")
    const dialog = await addCost(page, description)
    if (isMobile) {
      await bigEnough(dialog.getByRole("button", { name: "Choose File" }))
      await noSideScroll(page)
    }
    await dialog.getByLabel("Choose invoice file").setInputFiles(SIGNED)
    await expect(dialog.getByText(`${SIGNED.name}`)).toBeVisible()
    await expect(dialog.getByText("saved with the cost")).toBeVisible()
    await dialog.getByRole("button", { name: "Add Cost" }).click()
    await expect(dialog).toBeHidden()

    await navigateTo(page, "Pipeline", "/pipeline")
    await navigateTo(page, "Costs", "/costs")
    const { slot } = await editCost(page, description, isMobile)
    await expect(slot.getByText(SIGNED.name)).toBeVisible()
    await expect(slot.getByText(/^Signed FatturaPA XML · 1 KB · added /)).toBeVisible()
    await expect(slot.getByRole("link", { name: "View" })).toBeVisible()
    if (isMobile) {
      await bigEnough(slot.getByRole("button", { name: "Download file" }))
      await bigEnough(slot.getByRole("button", { name: "More file actions" }))
      await noSideScroll(page)
    }
    expect(await downloaded(page, slot)).toEqual({ name: SIGNED.name, bytes: SIGNED.buffer })
  })

  test("Cancel leaves nothing behind", async ({ page }) => {
    const uploads = await countUploads(page)
    const description = uniqueName("Never saved")
    const dialog = await addCost(page, description, PLAIN)
    await expect(dialog.getByText(PLAIN.name)).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText(description)).toHaveCount(0)
    expect(await uploads()).toBe(0)
  })

  test("a wrong type and an oversized file are refused under the slot, in words", async ({ page }) => {
    const dialog = await addCost(page, uniqueName("Refused"))
    const input = dialog.getByLabel("Choose invoice file")
    await input.setInputFiles({ name: "invoice.docx", mimeType: "application/vnd.openxmlformats", buffer: Buffer.from("x") })
    await expect(dialog.getByRole("alert")).toHaveText("invoice.docx can't be attached: use the XML, the signed .p7m, or a PDF.")
    await input.setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(11 * 1024 * 1024) })
    await expect(dialog.getByRole("alert")).toHaveText("scan.pdf is over the 10 MB limit.")
    await expect(dialog.getByRole("button", { name: "Choose File" })).toBeVisible()
  })

  test("Replace File swaps the file on save, and Remove File takes it away on save", async ({ page, isMobile }) => {
    const description = uniqueName("Swap")
    const dialog = await addCost(page, description, PLAIN)
    await dialog.getByRole("button", { name: "Add Cost" }).click()
    await expect(dialog).toBeHidden()

    const plainPath = (await pathOf(page, { cost: description }))!
    expect(await objectGone(page, plainPath)).toBe(false)
    const first = await editCost(page, description, isMobile)
    await expect(first.slot.getByText(PLAIN.name)).toBeVisible()
    await chooseMore(page, first.slot, "Replace File…")
    await first.dialog.getByLabel("Choose invoice file").setInputFiles(PDF)
    await expect(first.slot.getByText("saved with the cost")).toBeVisible()
    await first.dialog.getByRole("button", { name: "Save Changes" }).click()
    await expect(first.dialog).toBeHidden()
    expect(await objectGone(page, plainPath)).toBe(true)

    const second = await editCost(page, description, isMobile)
    await expect(second.slot.getByText(PDF.name)).toBeVisible()
    await expect(second.slot.getByText(PLAIN.name)).toHaveCount(0)
    await expect(second.slot.getByRole("button", { name: "View" })).toBeVisible()
    expect(await downloaded(page, second.slot)).toEqual({ name: PDF.name, bytes: PDF.buffer })

    await chooseMore(page, second.slot, "Remove File")
    await expect(second.slot.getByText(`${PDF.name} is removed when you save.`)).toBeVisible()
    const pdfPath = (await pathOf(page, { cost: description }))!
    await second.dialog.getByRole("button", { name: "Save Changes" }).click()
    await expect(second.dialog).toBeHidden()
    expect(await objectGone(page, pdfPath)).toBe(true)

    const third = await editCost(page, description, isMobile)
    await expect(third.slot.getByRole("button", { name: "Choose File" })).toBeVisible()
    await expect(third.slot.getByText(PDF.name)).toHaveCount(0)
  })
})

test.describe("the invoice file on an invoice", () => {
  test.beforeEach(async ({ page }) => {
    await startCompany(page)
  })

  async function seedInvoice(page: Page, number: string) {
    await page.evaluate(async (n) => {
      const backend = (window as MockWindow).__mockBackend!
      const user = await backend.auth.getCurrentUser()
      const client = await backend.db.createClient(user!.id, { name: `Client ${n}` })
      await backend.db.createInvoice(user!.id, { clientId: client.id, number: n, yearMonth: "2026-09", amount: 9600, vat: 2112 })
    }, number)
  }

  async function openInvoice(page: Page, number: string) {
    await navigateTo(page, "Invoices", "/invoices")
    await page.locator("#invoices").getByRole("button", { name: number, exact: true }).first().click()
    const sheet = page.getByRole("dialog", { name: `Invoice ${number}` })
    return { sheet, slot: sheet.getByRole("group", { name: "Invoice File" }) }
  }

  test("attach on save, download the same bytes, replace, then remove", async ({ page }) => {
    const number = uniqueName("F").replace(/\s/g, "-")
    await seedInvoice(page, number)

    const opened = await openInvoice(page, number)
    await expect(opened.sheet.getByRole("heading", { name: "Invoice File", level: 3 })).toBeVisible()
    await opened.sheet.getByLabel("Choose invoice file").setInputFiles(PLAIN)
    await expect(opened.slot.getByText("saved with the invoice")).toBeVisible()
    await opened.sheet.getByRole("button", { name: "Save Changes" }).click()
    await expect(opened.sheet).toBeHidden()

    await navigateTo(page, "Pipeline", "/pipeline")
    const again = await openInvoice(page, number)
    await expect(again.slot.getByText(/^FatturaPA XML · 1 KB · added /)).toBeVisible()
    expect(await downloaded(page, again.slot)).toEqual({ name: PLAIN.name, bytes: PLAIN.buffer })

    const plainPath = (await pathOf(page, { invoice: number }))!
    await chooseMore(page, again.slot, "Replace File…")
    await again.sheet.getByLabel("Choose invoice file").setInputFiles(PDF)
    await again.sheet.getByRole("button", { name: "Save Changes" }).click()
    await expect(again.sheet).toBeHidden()
    expect(await objectGone(page, plainPath)).toBe(true)

    const replaced = await openInvoice(page, number)
    await expect(replaced.slot.getByText(PDF.name)).toBeVisible()
    await expect(replaced.slot.getByText(PLAIN.name)).toHaveCount(0)
    const pdfPath = (await pathOf(page, { invoice: number }))!
    await chooseMore(page, replaced.slot, "Remove File")
    await replaced.sheet.getByRole("button", { name: "Save Changes" }).click()
    await expect(replaced.sheet).toBeHidden()
    expect(await objectGone(page, pdfPath)).toBe(true)

    const removed = await openInvoice(page, number)
    await expect(removed.slot.getByRole("button", { name: "Choose File" })).toBeVisible()
  })

  test("View opens the signed XML of an invoice, and Back returns to the invoices", async ({ page }) => {
    const number = uniqueName("H").replace(/\s/g, "-")
    await seedInvoice(page, number)
    const signed = {
      name: "IT09999999990_0b7Q2.xml.p7m",
      mimeType: "application/pkcs7-mime",
      buffer: await readFile("src/lib/__tests__/fixtures/fattura-pa/standard-stream.xml.p7m"),
    }
    const opened = await openInvoice(page, number)
    await opened.sheet.getByLabel("Choose invoice file").setInputFiles(signed)
    await expect(opened.slot.getByRole("button", { name: "View" })).toHaveCount(0)
    await opened.sheet.getByRole("button", { name: "Save Changes" }).click()
    await expect(opened.sheet).toBeHidden()

    const again = await openInvoice(page, number)
    await again.slot.getByRole("link", { name: "View" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Invoice 112/2026 · Studio Esempio S.r.l." })).toBeVisible()
    await page.getByRole("link", { name: "Back" }).click()
    await expect(page).toHaveURL(/\/invoices$/)
    await expect(page.locator("#invoices").getByRole("button", { name: number, exact: true }).first()).toBeVisible()
  })

  test("Cancel leaves nothing behind", async ({ page }) => {
    const number = uniqueName("G").replace(/\s/g, "-")
    await seedInvoice(page, number)
    const uploads = await countUploads(page)
    const { sheet } = await openInvoice(page, number)
    await sheet.getByLabel("Choose invoice file").setInputFiles(PLAIN)
    await sheet.getByRole("button", { name: "Cancel" }).click()
    await expect(sheet).toBeHidden()
    const again = await openInvoice(page, number)
    await expect(again.slot.getByRole("button", { name: "Choose File" })).toBeVisible()
    expect(await uploads()).toBe(0)
  })
})
