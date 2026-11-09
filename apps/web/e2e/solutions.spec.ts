import { test, expect } from "@playwright/test"

import { signIn, navigateTo } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"
import type { Page } from "@playwright/test"

/**
 * The Solutions catalog and a solution's page on the mock backend, made-up data
 * only: Nordwind Retail S.p.A. and its Product graph contract. A page load
 * wipes the mock, so "reload" here is leaving the page and coming back through
 * the Clients page's link: the list is read again from the backend. On a phone
 * (375 px) the page never scrolls sideways and each Save stays on screen.
 */

const CLIENT = "Nordwind Retail S.p.A."
const NAME = "Product knowledge graph"
const PURPOSE = "One graph for the catalog.\nSearch and merchandising read the same products."
const toastText = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)

async function seedClient(page: Page): Promise<string> {
  return page.evaluate(async (name) => {
    const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend
    if (!backend) throw new Error("window.__mockBackend is missing: the server must run the mock backend")
    const u = (await backend.auth.getCurrentUser())!.id
    const client = await backend.db.createClient(u, { name })
    await backend.db.createEngagement(u, { clientId: client.id, name: "Product graph", dailyRate: 600, vatApplicable: true, defaultDaysPerMonth: 10 })
    return client.id
  }, CLIENT)
}

const noSideScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)

test.describe("Solutions", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    await signIn(page)
    if (isMobile) await page.setViewportSize({ width: 375, height: 667 })
  })

  test("creates a solution, saves a section and the data model, and reads them back", async ({ page, isMobile }) => {
    const clientId = await seedClient(page)
    await navigateTo(page, "Solutions", "/solutions")
    await expect(page.getByText(/No solutions yet/)).toBeVisible()

    await page.getByRole("button", { name: "New Solution" }).click()
    const dialog = page.getByRole("dialog", { name: "New Solution" })
    await dialog.getByLabel("Name").fill(NAME)
    await dialog.getByRole("combobox", { name: "Client" }).click()
    await page.getByRole("option", { name: CLIENT }).click()
    await dialog.getByRole("combobox", { name: "Contract" }).click()
    await page.getByRole("option", { name: "Product graph" }).click()
    for (const tag of ["Neo4j", "gds", "kafka"]) {
      await dialog.getByRole("textbox", { name: "Stack" }).fill(tag)
      await dialog.getByRole("textbox", { name: "Stack" }).press("Enter")
    }
    const create = dialog.getByRole("button", { name: "Create Solution" })
    await expect(create).toBeInViewport({ ratio: 1 })
    await create.click()

    // Created, it opens on its own page: the sections are written there.
    await expect(page).toHaveURL(/\/solutions\/[^/?]+$/)
    const main = page.getByRole("main")
    await expect(main.getByRole("heading", { level: 1, name: NAME })).toBeVisible()
    for (const tag of ["neo4j", "gds", "kafka"]) await expect(main.getByText(tag, { exact: true })).toBeVisible()
    await expect(main).toContainText("Product graph · Active")
    await expect(main.getByText("0 of 9 sections written")).toBeVisible()
    if (isMobile) {
      // 44 px on a touch screen: the section chips, and the jump to what is still to write.
      const chip = main.getByRole("navigation", { name: "Sections" }).getByRole("link").first()
      expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect((await main.getByRole("link", { name: "Still to write: 9" }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }

    await main.getByRole("button", { name: "Write Purpose and Target" }).click()
    await main.getByRole("textbox", { name: "Purpose and Target" }).fill(PURPOSE)
    await expect(main.getByText(/Unsaved changes/)).toBeVisible()
    const save = main.getByRole("button", { name: "Save Purpose and Target" })
    if (isMobile) expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await save.click()
    await expect(main.getByText("One graph for the catalog.", { exact: false })).toBeVisible()
    await expect(main.getByText("1 of 9 sections written")).toBeVisible()

    // History reads as a timeline, newest first, once its lines open on dates.
    await main.getByRole("button", { name: "Write History" }).click()
    await main.getByRole("textbox", { name: "History" }).fill("2026-02-10 Kickoff, 40-day contract.\n2026-07-15 Go-live.")
    await main.getByRole("button", { name: "Save History" }).click()
    await expect(main.getByRole("region", { name: "History" }).getByRole("listitem")).toHaveText([
      /^2026-07-15\s*Go-live\.$/,
      /^2026-02-10\s*Kickoff, 40-day contract\.$/,
    ])
    // Add an Entry opens with the caret after today's date: typed straight away, the entry goes on top.
    await main.getByRole("button", { name: "Add an Entry" }).click()
    await expect(main.getByRole("textbox", { name: "History" })).toBeFocused()
    await page.keyboard.type("Pilot signed off.")
    await main.getByRole("button", { name: "Save History" }).click()
    const today = new Date().toLocaleDateString("en-CA")
    await expect(main.getByRole("region", { name: "History" }).getByRole("listitem").first()).toHaveText(
      new RegExp(`^${today}\\s*Pilot signed off\\.$`),
    )
    await expect(main.getByText("2 of 9 sections written")).toBeVisible()

    // An empty data model opens on its Entities; the relations are the next tab.
    await main.getByRole("button", { name: "Add Entity" }).click()
    await main.getByRole("textbox", { name: "Entity 1 name" }).fill("Product")
    await main.getByRole("textbox", { name: "Entity 1 source" }).fill("SAP MARA")
    await main.getByRole("button", { name: "Add Entity" }).click()
    await main.getByRole("textbox", { name: "Entity 2 name" }).fill("Category")
    await main.getByRole("tab", { name: "Relations" }).click()
    await main.getByRole("button", { name: "Add Relation" }).click()
    await main.getByRole("combobox", { name: "Relation 1 From" }).click()
    await page.getByRole("option", { name: "Product" }).click()
    await main.getByRole("combobox", { name: "Relation 1 To" }).click()
    await page.getByRole("option", { name: "Category" }).click()
    await main.getByRole("textbox", { name: "Relation 1 type" }).fill("IN_CATEGORY")
    const saveModel = main.getByRole("button", { name: "Save Data Model" })
    // Pinned to the screen's bottom while the tables are on screen.
    await expect(saveModel).toBeInViewport({ ratio: 1 })
    await saveModel.click()
    await expect(main.getByText("Unsaved changes")).toHaveCount(0)
    await expect(main.getByText("2 entities · 1 relation")).toBeVisible()
    // The graph draws the saved model: each box its name and source, the line its type.
    await main.getByRole("tab", { name: "Graph" }).click()
    const graph = main.getByRole("img", { name: "Data model graph: 2 entities, 1 relation" })
    for (const text of ["Product", "SAP MARA", "Category", "derived", "IN_CATEGORY"]) {
      await expect(graph.locator("text", { hasText: new RegExp(`^${text}$`) })).toBeVisible()
    }
    if (isMobile) await noSideScroll(page)

    // Back on the catalog by the breadcrumb, the card says how much is written.
    await main.getByRole("link", { name: "Back to Solutions" }).click()
    await expect(page).toHaveURL("/solutions")
    await expect(page.getByRole("article", { name: NAME })).toContainText("2/9")
    if (isMobile) await noSideScroll(page)

    // "Reload": away to Clients and back through its link, the list read again.
    await navigateTo(page, "Clients", "/clients")
    await page.getByRole("link", { name: "1 solution", exact: true }).click()
    await expect(page).toHaveURL(`/solutions?client=${clientId}`)
    // A name is unique within its client, in any case: a second one is refused under Name.
    await page.getByRole("button", { name: "New Solution" }).click()
    const again = page.getByRole("dialog", { name: "New Solution" })
    await again.getByLabel("Name").fill(NAME.toUpperCase())
    await again.getByRole("button", { name: "Create Solution" }).click()
    await expect(again.getByText(`${CLIENT} already has a solution named "${NAME}".`)).toBeVisible()
    await again.getByRole("button", { name: "Cancel" }).click()
    await expect(again).toBeHidden()
    await page.getByRole("link", { name: NAME }).click()
    await expect(page).toHaveURL(/\/solutions\/[^/?]+$/)
    await expect(main.getByText("One graph for the catalog.", { exact: false })).toBeVisible()
    await main.getByRole("tab", { name: "Entities" }).click()
    await expect(main.getByRole("textbox", { name: "Entity 1 name" })).toHaveValue("Product")
    await expect(main.getByRole("textbox", { name: "Entity 1 source" })).toHaveValue("SAP MARA")
    await main.getByRole("tab", { name: "Relations" }).click()
    await expect(main.getByRole("combobox", { name: "Relation 1 To" })).toHaveText("Category")
    await expect(main.getByRole("textbox", { name: "Relation 1 type" })).toHaveValue("IN_CATEGORY")
    if (isMobile) await noSideScroll(page)

    // The page is the only place a solution is deleted.
    await main.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete Solution" }).click()
    await page.getByRole("alertdialog", { name: "Delete Solution" }).getByRole("button", { name: "Delete Solution" }).click()
    await expect(page.getByText(toastText(`Solution "${NAME}" deleted.`))).toBeVisible()
    await expect(page).toHaveURL("/solutions")
    await expect(page.getByText(/No solutions yet/)).toBeVisible()
  })

  test("an old ?solution= link opens the page, and the breadcrumb asks before unsaved edits go", async ({ page }) => {
    const clientId = await seedClient(page)
    const id = await page.evaluate(
      async ({ clientId, name }) => {
        const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend!
        const u = (await backend.auth.getCurrentUser())!.id
        return (await backend.db.createSolution(u, { clientId, name })).id
      },
      { clientId, name: NAME },
    )
    await navigateTo(page, "Solutions", "/solutions")
    // A link from when a solution opened in a sheet, followed inside the app: page.goto would wipe the mock.
    type NextWindow = Window & { next: { router: { push: (href: string) => void } } }
    await page.evaluate((id) => (window as unknown as NextWindow).next.router.push(`/solutions?solution=${id}`), id)
    await expect(page).toHaveURL(`/solutions/${id}`)
    const main = page.getByRole("main")
    await expect(main.getByRole("heading", { level: 1, name: NAME })).toBeVisible()

    await main.getByRole("button", { name: "Write Steps" }).click()
    await main.getByRole("textbox", { name: "Steps" }).fill("1. Load the catalog")
    await main.getByRole("link", { name: "Back to Solutions" }).click()
    const ask = page.getByRole("alertdialog", { name: "Discard Changes" })
    await ask.getByRole("button", { name: "Keep Editing" }).click()
    await expect(ask).toBeHidden()
    await expect(page).toHaveURL(`/solutions/${id}`)
    await expect(main.getByRole("textbox", { name: "Steps" })).toHaveValue("1. Load the catalog")

    await main.getByRole("link", { name: "Back to Solutions" }).click()
    await ask.getByRole("button", { name: "Discard Changes" }).click()
    await expect(page).toHaveURL("/solutions")
    await expect(page.getByRole("article", { name: NAME })).toContainText("0/9")
  })
})
