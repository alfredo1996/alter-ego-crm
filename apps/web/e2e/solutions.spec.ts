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
    await expect(main.getByText("0 of 7 sections written")).toBeVisible()
    if (isMobile) {
      // 44 px on a touch screen: the section chips, and the jump to what is still to write.
      const chip = main.getByRole("navigation", { name: "Sections" }).getByRole("link").first()
      expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect((await main.getByRole("link", { name: "Still to write: 7" }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }

    await main.getByRole("button", { name: "Write Purpose and Target" }).click()
    await main.getByRole("textbox", { name: "Purpose and Target" }).fill(PURPOSE)
    await expect(main.getByText(/Unsaved changes/)).toBeVisible()
    const save = main.getByRole("button", { name: "Save Purpose and Target" })
    if (isMobile) expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await save.click()
    await expect(main.getByText("One graph for the catalog.", { exact: false })).toBeVisible()
    await expect(main.getByText("1 of 7 sections written")).toBeVisible()

    await main.getByRole("button", { name: "Write KPIs" }).click()
    await main.getByRole("textbox", { name: "KPIs" }).fill("Search time: from 4 s to 1 s")
    await main.getByRole("button", { name: "Save KPIs" }).click()
    await expect(main.getByText("2 of 7 sections written")).toBeVisible()

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

    // Back on the catalog by the breadcrumb, the solution is a row of it.
    await main.getByRole("link", { name: "Back to Solutions" }).click()
    await expect(page).toHaveURL("/solutions")
    await expect(page.getByRole("article", { name: NAME })).toContainText("Product graph · Active")
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

    await main.getByRole("button", { name: "Write Architecture" }).click()
    await main.getByRole("textbox", { name: "Architecture" }).fill("Kafka into Neo4j")
    await main.getByRole("link", { name: "Back to Solutions" }).click()
    const ask = page.getByRole("alertdialog", { name: "Discard Changes" })
    await ask.getByRole("button", { name: "Keep Editing" }).click()
    await expect(ask).toBeHidden()
    await expect(page).toHaveURL(`/solutions/${id}`)
    await expect(main.getByRole("textbox", { name: "Architecture" })).toHaveValue("Kafka into Neo4j")

    await main.getByRole("link", { name: "Back to Solutions" }).click()
    await ask.getByRole("button", { name: "Discard Changes" }).click()
    await expect(page).toHaveURL("/solutions")
    await expect(page.getByRole("article", { name: NAME })).toContainText("Pre-sales")
  })

  test("the road: add three steps, make the second Now, finish it, reorder, and a reload keeps it", async ({ page, isMobile }) => {
    const clientId = await seedClient(page)
    const id = await page.evaluate(
      async ({ clientId, name }) => {
        const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend!
        const u = (await backend.auth.getCurrentUser())!.id
        return (await backend.db.createSolution(u, { clientId, name, target: "Every query under 2 seconds." })).id
      },
      { clientId, name: NAME },
    )
    await navigateTo(page, "Solutions", "/solutions")
    type NextWindow = Window & { next: { router: { push: (href: string) => void } } }
    await page.evaluate((id) => (window as unknown as NextWindow).next.router.push(`/solutions/${id}`), id)
    const main = page.getByRole("main")
    await expect(main.getByText("Every query under 2 seconds.")).toBeVisible()
    await expect(main.getByText("No steps yet")).toBeVisible()

    for (const title of ["Profile the queries", "Add indexes", "Load test"]) {
      await main.getByRole("button", { name: "Add Step" }).click()
      const dialog = page.getByRole("dialog", { name: "Add Step" })
      await dialog.getByRole("textbox", { name: "Title" }).fill(title)
      await dialog.getByRole("button", { name: "Save Step" }).click()
      await expect(dialog).toBeHidden()
    }
    const road = main.getByRole("region", { name: "Roadmap" })
    const step = (title: string) => road.getByRole("button", { name: new RegExp(title) })
    await expect(road.getByRole("listitem").filter({ has: page.getByRole("button") })).toHaveCount(3)

    // The second step becomes Now.
    await step("Add indexes").click()
    let dialog = page.getByRole("dialog", { name: "Edit Step" })
    await dialog.getByRole("radio", { name: "Now" }).click()
    await dialog.getByRole("button", { name: "Save Step" }).click()
    await expect(dialog).toBeHidden()
    await expect(main.getByText("Now · Step 2", { exact: true })).toBeVisible()
    await expect(road.getByText("Step 2 of 3")).toBeVisible()

    // Done asks for its outcome; the third step becomes Now.
    await step("Add indexes").click()
    dialog = page.getByRole("dialog", { name: "Edit Step" })
    await dialog.getByRole("radio", { name: "Done" }).click()
    await dialog.getByRole("button", { name: "Save Step" }).click()
    await expect(dialog.getByRole("alert")).toHaveText("Say what came of it to mark the step Done")
    await dialog.getByRole("textbox", { name: "Outcome" }).fill("p95 from 38 s to 4 s")
    await dialog.getByRole("button", { name: "Save Step" }).click()
    await expect(dialog).toBeHidden()
    await expect(main.getByText("Now · Step 3", { exact: true })).toBeVisible()
    await expect(road.getByText("p95 from 38 s to 4 s")).toBeVisible()

    // Reorder: the first step moves later, from the keyboard's buttons.
    await step("Profile the queries").click()
    dialog = page.getByRole("dialog", { name: "Edit Step" })
    await dialog.getByRole("button", { name: "Move Later" }).click()
    await expect(dialog).toContainText("Step 2 of 3")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(road.getByRole("listitem").filter({ has: page.getByRole("button") }).first()).toContainText("Add indexes")
    if (isMobile) {
      const boxes = await Promise.all(["Add indexes", "Profile the queries", "Load test"].map((t) => step(t).boundingBox()))
      // Top to bottom on a phone.
      expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y)
      expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y)
      await noSideScroll(page)
    }

    // "Reload": away and back, the solution read again from the backend.
    await navigateTo(page, "Clients", "/clients")
    await page.getByRole("link", { name: "1 solution", exact: true }).click()
    await page.getByRole("link", { name: NAME }).click()
    await expect(road.getByRole("listitem").filter({ has: page.getByRole("button") })).toHaveText([/Add indexes/, /Profile the queries/, /Load test/])
    await expect(main.getByText("Now · Step 3", { exact: true })).toBeVisible()
    // The outcome written on the way survived the round trip.
    await expect(road.getByText("p95 from 38 s to 4 s")).toBeVisible()
  })

  test("History: Add an Entry opens with today's date, typed straight away the entry goes on top", async ({ page }) => {
    const clientId = await seedClient(page)
    const id = await page.evaluate(
      async ({ clientId, name }) => {
        const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend!
        const u = (await backend.auth.getCurrentUser())!.id
        const sections = { history: "2026-02-10 Kickoff, 40-day contract.\n2026-07-15 Go-live." }
        return (await backend.db.createSolution(u, { clientId, name, sections })).id
      },
      { clientId, name: NAME },
    )
    await navigateTo(page, "Solutions", "/solutions")
    type NextWindow = Window & { next: { router: { push: (href: string) => void } } }
    await page.evaluate((id) => (window as unknown as NextWindow).next.router.push(`/solutions/${id}`), id)
    const main = page.getByRole("main")
    await expect(main.getByRole("region", { name: "History" }).getByRole("listitem")).toHaveText([
      /^2026-07-15\s*Go-live\.$/,
      /^2026-02-10\s*Kickoff, 40-day contract\.$/,
    ])
    await main.getByRole("button", { name: "Add an Entry" }).click()
    await expect(main.getByRole("textbox", { name: "History" })).toBeFocused()
    await page.keyboard.type("Pilot signed off.")
    await main.getByRole("button", { name: "Save History" }).click()
    const today = new Date().toLocaleDateString("en-CA")
    await expect(main.getByRole("region", { name: "History" }).getByRole("listitem").first()).toHaveText(new RegExp(`^${today}\\s*Pilot signed off\\.$`))
  })
  test("Journal: Log Work files a session on the Now step, a reload keeps it, and Calls shows only meetings", async ({ page, isMobile }) => {
    const clientId = await seedClient(page)
    const id = await page.evaluate(
      async ({ clientId, name }) => {
        const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend!
        const u = (await backend.auth.getCurrentUser())!.id
        const contract = (await backend.db.getEngagements(u))[0]
        await backend.db.createMeeting(u, { clientId, engagementId: contract.id, date: "2026-10-04", time: null, health: "green", text: "Third data drop reviewed\nThe historic hotels come in." })
        const step = { toMonth: null, goal: null, outcome: null, doneOn: null } as const
        const steps = [
          { ...step, title: "Proof of concept", state: "done" as const, fromMonth: "2026-08", paidBy: null, outcome: "Report sent", doneOn: "2026-09-12" },
          { ...step, title: "MVP", state: "now" as const, fromMonth: "2026-10", paidBy: { type: "contract" as const, id: contract.id } },
        ]
        return (await backend.db.createSolution(u, { clientId, name, steps })).id
      },
      { clientId, name: NAME },
    )
    await navigateTo(page, "Solutions", "/solutions")
    type NextWindow = Window & { next: { router: { push: (href: string) => void } } }
    await page.evaluate((id) => (window as unknown as NextWindow).next.router.push(`/solutions/${id}`), id)
    const main = page.getByRole("main")
    const journal = main.getByRole("region", { name: "Journal" })
    await expect(journal.getByRole("listitem")).toHaveCount(2)

    await main.getByRole("button", { name: "Log Work" }).click()
    const dialog = page.getByRole("dialog", { name: "Log Work" })
    await expect(dialog.getByRole("combobox", { name: "Step" })).toHaveText(/2\. MVP \(Now\)/)
    await dialog.getByRole("textbox", { name: "Did" }).fill("Loading rewritten as idempotent Cypher.")
    await dialog.getByRole("textbox", { name: "Decided" }).fill("Spend goes to the booking holder.")
    await dialog.getByRole("textbox", { name: "Next" }).fill("One nightly run.")
    await dialog.getByRole("button", { name: "Log Work" }).click()
    await expect(dialog).toBeHidden()
    await expect(journal.getByText("Loading rewritten as idempotent Cypher.")).toBeVisible()
    await expect(journal.getByRole("listitem")).toHaveCount(4)
    if (isMobile) await noSideScroll(page)

    // "Reload": away and back, the journal read again from the backend.
    await navigateTo(page, "Clients", "/clients")
    await page.getByRole("link", { name: "1 solution", exact: true }).click()
    await page.getByRole("link", { name: NAME }).click()
    await expect(journal.getByText("Loading rewritten as idempotent Cypher.")).toBeVisible()
    await expect(journal.getByText("Spend goes to the booking holder.")).toBeVisible()

    await journal.getByRole("button", { name: "Calls" }).click()
    await expect(journal.getByRole("listitem")).toHaveText([/Call: Third data drop reviewed/])
    await expect(journal.getByText("Loading rewritten as idempotent Cypher.")).toBeHidden()
  })

  test("presents the list: no sidebar, no edit controls, kept by the URL, and Stop restores the page", async ({ page, isMobile }) => {
    const clientId = await seedClient(page)
    await page.evaluate(async (clientId) => {
      const backend = (window as Window & { __mockBackend?: BackendAdapter }).__mockBackend!
      const u = (await backend.auth.getCurrentUser())!.id
      await backend.db.createSolution(u, {
        clientId,
        name: "Guest 360",
        status: "building",
        target: "One guest record on the front desk's screen.",
        steps: [
          { title: "Proof of concept", state: "done", fromMonth: "2026-08", toMonth: "2026-08", paidBy: null, goal: null, outcome: "15 questions answered", doneOn: "2026-09-12" },
          { title: "MVP on the client's server", state: "now", fromMonth: "2026-10", toMonth: null, paidBy: null, goal: null, outcome: null, doneOn: null },
          { title: "Front-desk guest card", state: "next", fromMonth: "2027-01", toMonth: null, paidBy: null, goal: null, outcome: null, doneOn: null },
        ],
      })
    }, clientId)
    await navigateTo(page, "Solutions", "/solutions")
    const main = page.getByRole("main")
    const row = main.getByRole("article", { name: "Guest 360" })
    await expect(row).toContainText("Now: MVP on the client's server (step 2 of 3)")
    await expect(row).toContainText("Next: Front-desk guest card")
    await expect(main.getByRole("button", { name: "New Solution" })).toBeVisible()
    if (isMobile) await noSideScroll(page)

    await main.getByRole("button", { name: "Present" }).click()
    await expect(page).toHaveURL("/solutions?present=1")
    await expect(main.getByText(/^Presenting:/)).toBeVisible()
    await expect(main.getByRole("button", { name: "New Solution" })).toHaveCount(0)
    await expect(page.locator("aside")).toHaveCount(0)
    await expect(page.getByRole("button", { name: /open navigation/i })).toHaveCount(0)
    // The row keeps the page presenting, and the page itself has no edit control.
    await row.getByRole("link", { name: "Guest 360" }).click()
    await expect(page).toHaveURL(/\/solutions\/[^/?]+\?present=1$/)
    await expect(main.getByRole("heading", { level: 1, name: "Guest 360" })).toBeVisible()
    for (const name of ["Log Work", "Edit Details", "More actions", "Add Step"]) await expect(main.getByRole("button", { name })).toHaveCount(0)
    if (isMobile) await noSideScroll(page)
    await main.getByRole("link", { name: "Back to Solutions" }).click()
    await expect(page).toHaveURL("/solutions?present=1")

    // A full load of the link (the mock backend signs out and empties on one: sign in to it again): the URL alone keeps it presenting.
    await signIn(page, "/solutions?present=1")
    await expect(page.getByRole("main").getByText(/^Presenting:/)).toBeVisible()
    await expect(page.locator("aside")).toHaveCount(0)

    await page.getByRole("button", { name: "Stop Presenting" }).click()
    await expect(page).toHaveURL("/solutions")
    await expect(page.getByText(/^Presenting:/)).toHaveCount(0)
    if (isMobile) await expect(page.getByRole("button", { name: /open navigation/i })).toBeVisible()
    else await expect(page.locator("aside")).toBeVisible()
  })
})
