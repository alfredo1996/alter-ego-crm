import { test, expect } from "@playwright/test"

import { signIn, navigateTo } from "./helpers/test-utils"

import type { Page, Locator } from "@playwright/test"

// ── Real Money Manager TSV (11 columns, comma decimals, transfer pairs) ──────

const MM_HEADER = "Periodo\tConto\tCategoria\tSotto-categoria\tNota\tEUR\tGuadagni/Spese\tDescrizione\tImporto\tValuta\tConto"

const MM_ROWS = [
  "08/03/2026\tConto in banca\tAbbonamento Telefonico\t\tSpotify\t18\tSpese\t\t18\tEUR\t18",
  "07/03/2026\tConto in banca\tSpese Generali\t\tAmazon\t32,45\tSpese\tPacco regalo\t32,45\tEUR\t32,45",
  "06/03/2026\tPortafoglio\tPrestiti\t\tSoldi Alice\t250\tTrasferimento uscita\tMancano 750\t250\tEUR\t250",
  "06/03/2026\tPrestiti\tPortafoglio\t\tSoldi Alice\t250\tTrasferimento ingresso\tMancano 750\t250\tEUR\t250",
  "05/03/2026\tConto in banca\tStipendio\t\tStipendio Marzo\t1900\tIn\t\t1900\tEUR\t1900",
]

const VALID_TSV = [MM_HEADER, ...MM_ROWS].join("\n")

// After ingresso dedup: 4 transactions (1 ingresso skipped)
const EXPECTED_TX_COUNT = 4

// Unique accounts: conto in banca, portafoglio, prestiti
const EXPECTED_ACCOUNT_COUNT = 3

// Unique categories: Abbonamento Telefonico, Spese Generali, Stipendio
const EXPECTED_CATEGORY_COUNT = 3

// ── Invalid file (not Money Manager format) ──────────────────────────────────

const INVALID_CSV = "Date,Description,Amount\n2026-03-01,Coffee,5.00"

// ── Helpers ──────────────────────────────────────────────────────────────────

function dialog(page: Page): Locator {
  return page.getByRole("dialog")
}

async function openMMDialog(page: Page) {
  // The import lives in the header's More menu.
  await page.getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Money Manager" }).click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByText("Import from Money Manager")).toBeVisible()
}

async function uploadTSV(page: Page, content: string, filename = "export.tsv") {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: filename,
    mimeType: "text/tab-separated-values",
    buffer: Buffer.from(content, "utf-8"),
  })
}

async function clickNext(page: Page) {
  await dialog(page).getByRole("button", { name: "Next", exact: true }).click()
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Money Manager Import", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await navigateTo(page, "Transactions", "/transactions")
  })

  test("should open and close the dialog", async ({ page }) => {
    await openMMDialog(page)
    // Close via Cancel
    await dialog(page).getByRole("button", { name: /cancel/i }).click()
    await expect(dialog(page)).not.toBeVisible()
  })

  test("should reject invalid file format", async ({ page }) => {
    await openMMDialog(page)
    await uploadTSV(page, INVALID_CSV, "bad.csv")

    // Should show error state
    await expect(dialog(page).getByText(/not a money manager file/i)).toBeVisible()

    // Next button should be disabled
    const nextBtn = dialog(page).getByRole("button", { name: "Next", exact: true })
    await expect(nextBtn).toBeDisabled()
  })

  test("should parse valid TSV and show summary", async ({ page }) => {
    await openMMDialog(page)
    await uploadTSV(page, VALID_TSV)

    // Should show format detection badge
    await expect(dialog(page).getByText("Money Manager format detected")).toBeVisible()

    // Should show parsed counts
    await expect(dialog(page).getByText(`${EXPECTED_TX_COUNT} transactions`)).toBeVisible()
    await expect(dialog(page).getByText(`${EXPECTED_ACCOUNT_COUNT} accounts`)).toBeVisible()
    await expect(dialog(page).getByText(`${EXPECTED_CATEGORY_COUNT} categories`)).toBeVisible()

    // Should show ingresso dedup count
    await expect(dialog(page).getByText(/1 duplicate transfer row.* removed/)).toBeVisible()

    // Next button should be enabled
    const nextBtn = dialog(page).getByRole("button", { name: "Next", exact: true })
    await expect(nextBtn).toBeEnabled()
  })

  test("should show reconcile step with accounts and categories", async ({ page }) => {
    await openMMDialog(page)
    await uploadTSV(page, VALID_TSV)
    await clickNext(page)

    // Step 2: Reconcile
    await expect(dialog(page).getByText("Review accounts and categories")).toBeVisible()

    // Should show Accounts section header
    await expect(dialog(page).getByText("Accounts").first()).toBeVisible()

    // All accounts should be "New" since none exist yet
    const newBadges = dialog(page).getByText("New", { exact: true })
    await expect(newBadges.first()).toBeVisible()

    // Should show Categories section header
    await expect(dialog(page).getByText("Categories").first()).toBeVisible()

    // Should have Back and Next buttons
    await expect(dialog(page).getByRole("button", { name: /back/i })).toBeVisible()
    await expect(dialog(page).getByRole("button", { name: "Next", exact: true })).toBeVisible()
  })

  test("should navigate back from reconcile to upload", async ({ page }) => {
    await openMMDialog(page)
    await uploadTSV(page, VALID_TSV)
    await clickNext(page)

    // On reconcile step
    await expect(dialog(page).getByText("Review accounts and categories")).toBeVisible()

    // Go back
    await dialog(page).getByRole("button", { name: /back/i }).click()

    // Should be back on upload step with file still loaded
    await expect(dialog(page).getByText("Money Manager format detected")).toBeVisible()
  })

  test("should show preview step with transaction table", async ({ page }) => {
    await openMMDialog(page)
    await uploadTSV(page, VALID_TSV)

    // Step 1 → 2
    await clickNext(page)
    // Step 2 → 3
    await clickNext(page)

    // Step 3: Preview
    await expect(dialog(page).getByText("Review parsed transactions before importing")).toBeVisible()

    // Summary cards with transaction count
    await expect(dialog(page).getByText(String(EXPECTED_TX_COUNT)).first()).toBeVisible()
    await expect(dialog(page).getByText("Transactions").first()).toBeVisible()

    // Transfer count (1 transfer kept after dedup)
    await expect(dialog(page).getByText("Transfers").first()).toBeVisible()

    // Table headers
    await expect(dialog(page).getByText("Date").first()).toBeVisible()
    await expect(dialog(page).getByText("Account").first()).toBeVisible()
    await expect(dialog(page).getByText("Description").first()).toBeVisible()

    // Specific transaction descriptions visible in preview table
    await expect(dialog(page).getByText("Spotify").first()).toBeVisible()
    await expect(dialog(page).getByText("Amazon").first()).toBeVisible()
    await expect(dialog(page).getByText("Stipendio Marzo").first()).toBeVisible()

    // Import button with count
    await expect(
      dialog(page).getByRole("button", { name: new RegExp(`import ${EXPECTED_TX_COUNT} transaction`, "i") })
    ).toBeVisible()

    // Idempotency notice
    await expect(dialog(page).getByText(/re-importing.*safe/i)).toBeVisible()
  })

  test("should import transactions and show completion", async ({ page }) => {
    await openMMDialog(page)
    await uploadTSV(page, VALID_TSV)

    // Step 1 → 2 → 3
    await clickNext(page)
    await clickNext(page)

    // Click Import
    await dialog(page).getByRole("button", { name: /import \d+ transaction/i }).click()

    // Should show completion
    await expect(dialog(page).getByText("Import complete", { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(
      dialog(page).getByText(`${EXPECTED_TX_COUNT} new transactions imported.`),
    ).toBeVisible()

    // Done button
    await dialog(page).getByRole("button", { name: /done/i }).click()
    await expect(dialog(page)).not.toBeVisible()

    // Imported transactions should appear in the list
    await expect(page.getByText("Spotify").locator("visible=true")).toBeVisible({ timeout: 10_000 })
  })

  test("should be idempotent — re-import same file without duplicates", async ({ page }) => {
    await openMMDialog(page)
    await uploadTSV(page, VALID_TSV)

    // First import: full flow
    await clickNext(page)
    await clickNext(page)
    await dialog(page).getByRole("button", { name: /import \d+ transaction/i }).click()
    await expect(dialog(page).getByText("Import complete", { exact: true })).toBeVisible({ timeout: 30_000 })
    await dialog(page).getByRole("button", { name: /done/i }).click()

    // Second import: re-open dialog and import same data
    await openMMDialog(page)
    await uploadTSV(page, VALID_TSV)
    await clickNext(page)

    // On reconcile step, accounts should now be "Matched" (not "New")
    await expect(dialog(page).getByText("Matched").first()).toBeVisible()

    await clickNext(page)
    await dialog(page).getByRole("button", { name: /import \d+ transaction/i }).click()
    await expect(dialog(page).getByText("Import complete", { exact: true })).toBeVisible({ timeout: 30_000 })
    // Nothing new the second time, and every row accounted for as a duplicate.
    await expect(dialog(page).getByText("0 new transactions imported.")).toBeVisible()
    await expect(
      dialog(page).getByText(new RegExp(`${EXPECTED_TX_COUNT} duplicates skipped`)),
    ).toBeVisible()
    await dialog(page).getByRole("button", { name: /done/i }).click()
  })

  test("should show step indicator with all 4 steps", async ({ page }) => {
    await openMMDialog(page)

    // Step labels should be visible
    await expect(dialog(page).getByText("1. Upload")).toBeVisible()
    await expect(dialog(page).getByText("2. Reconcile")).toBeVisible()
    await expect(dialog(page).getByText("3. Preview")).toBeVisible()
    await expect(dialog(page).getByText("4. Import")).toBeVisible()
  })

  test("should replace file when uploading a different one", async ({ page }) => {
    await openMMDialog(page)

    // Upload invalid file first
    await uploadTSV(page, INVALID_CSV, "bad.csv")
    await expect(dialog(page).getByText(/not a money manager file/i)).toBeVisible()

    // Upload valid file — should replace the error
    await uploadTSV(page, VALID_TSV, "good.tsv")
    await expect(dialog(page).getByText("Money Manager format detected")).toBeVisible()
    await expect(dialog(page).getByText(/not a money manager file/i)).not.toBeVisible()
  })
})
