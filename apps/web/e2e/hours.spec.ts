import { test, expect } from "@playwright/test"
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  isWeekend,
  parseISO,
  startOfISOWeek,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"
import type { Locator, Page } from "@playwright/test"

/**
 * The week of hours on /plan: type hours into a day, see the row and the week add up,
 * find them again after moving between weeks, and clear them. Most steps work in
 * last week, whose days are all past whatever day the suite runs on; days to come
 * take scheduled hours, up to 3 months ahead. Contracts sit under a header per
 * client, which folds. Days by month sits under the week on the same page, so
 * every week locator is scoped to its table ("Hours from …") and every plan one to
 * "Days by month": both have "Client · Contract" rows. The contract is seeded
 * through the mock backend the app exposes to e2e (see Providers); the contract
 * form has specs of its own.
 */

type MockWindow = Window & { __mockBackend?: BackendAdapter; __MOCK_LATENCY_MS__?: number }

/** Every mock backend call takes `ms`, about what a Firestore save and its refetch take; 0 turns it off. */
async function latency(page: Page, ms: number) {
  await page.evaluate((ms) => {
    ;(window as MockWindow).__MOCK_LATENCY_MS__ = ms
  }, ms)
}

/** A row for `client`'s contract written behind the page's cache, as log_allocation from chat does. */
async function writeDaysBehind(page: Page, client: string, yearMonth: string, days: number) {
  await page.evaluate(
    async ({ client, yearMonth, days }) => {
      const backend = (window as MockWindow).__mockBackend
      const user = await backend?.auth.getCurrentUser()
      if (!backend || !user) throw new Error("no mock backend or user")
      const clientId = (await backend.db.getClients(user.id)).find((c) => c.name === client)?.id
      const engagement = (await backend.db.getEngagements(user.id)).find((e) => e.clientId === clientId)
      if (!engagement) throw new Error(`no contract for ${client}`)
      await backend.db.createAllocation(user.id, { engagementId: engagement.id, yearMonth, days })
    },
    { client, yearMonth, days },
  )
}

/**
 * A contract (`name`, "Retainer" by default) for `client`, created unless it exists;
 * `startMonth` anchors its plan, `closed` ends it on a day, `hours` are [date, hours]
 * already stored.
 */
async function seedContract(
  page: Page,
  client: string,
  {
    name = "Retainer",
    startMonth = null,
    closed,
    hours = [],
    unit,
  }: { name?: string; startMonth?: string | null; closed?: string; hours?: [string, number][]; unit?: "hour" } = {},
) {
  await page.evaluate(
    async ({ client, name, startMonth, closed, hours, unit }) => {
      const backend = (window as MockWindow).__mockBackend
      if (!backend) throw new Error("window.__mockBackend is missing: the e2e server must run the mock backend")
      const user = await backend.auth.getCurrentUser()
      if (!user) throw new Error("not signed in")
      const clientId =
        (await backend.db.getClients(user.id)).find((c) => c.name === client)?.id ??
        (await backend.db.createClient(user.id, { name: client })).id
      const { id } = await backend.db.createEngagement(user.id, {
        clientId, name, dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 10, startMonth, ...(unit && { unit }),
      })
      for (const [date, h] of hours) await backend.db.setTimecard(user.id, { engagementId: id, date, hours: h, notes: null })
      if (closed) {
        await backend.db.updateEngagement(user.id, id, { isActive: false, endDate: closed, endMonth: closed.slice(0, 7) })
      }
    },
    { client, name, startMonth, closed, hours, unit },
  )
}

/** The week's grid, named by its caption "Hours from <Monday> to <Sunday>". */
function weekTable(page: Page) {
  return page.getByRole("table", { name: /^Hours from / })
}

/** The week grid's row of `client`'s contract: its row header reads "Client · Contract". */
function contractRow(page: Page, client: string, contract = "Retainer") {
  return weekTable(page).getByRole("row").filter({ has: page.getByRole("rowheader", { name: `${client} · ${contract}` }) })
}

/** The plan's months: "Days by month" on /plan. */
function planTable(page: Page) {
  return page.getByRole("table", { name: "Days by month" })
}

/** `client`'s contract's plan days for `month` ("MMMM yyyy"), as its button names them. */
function plannedDays(page: Page, client: string, month: string, days: number) {
  return planTable(page).getByRole("button", { name: `${client} · Retainer, ${month}: ${days} d planned`, exact: true })
}

/** `client`'s contract-month cells on /plan: two months back, last month, this month, next month... */
function planCell(page: Page, client: string, index: number) {
  return planTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: `${client} · Retainer` }) })
    .getByRole("cell")
    .nth(index)
}

/** Clears `button`'s plan cell: the contract default applies again. */
async function clearPlanCell(page: Page, button: Locator) {
  await button.click()
  const input = planTable(page).getByRole("spinbutton")
  await input.fill("")
  await input.press("Enter")
}

/** [date, hours] of every stored timecard, by date. */
async function storedHours(page: Page) {
  return page.evaluate(async () => {
    const backend = (window as MockWindow).__mockBackend
    const user = await backend?.auth.getCurrentUser()
    if (!backend || !user) throw new Error("no mock backend or user")
    return (await backend.db.getTimecards(user.id)).map((t) => [t.date, t.hours]).sort()
  })
}

/** [date, hours, notes] of every stored timecard, by date. */
async function storedNotes(page: Page) {
  return page.evaluate(async () => {
    const backend = (window as MockWindow).__mockBackend
    const user = await backend?.auth.getCurrentUser()
    if (!backend || !user) throw new Error("no mock backend or user")
    return (await backend.db.getTimecards(user.id)).map((t) => [t.date, t.hours, t.notes]).sort()
  })
}

/** [yearMonth, days] of every allocation stored on `client`'s contracts. */
async function storedDays(page: Page, client: string) {
  return page.evaluate(async (client) => {
    const backend = (window as MockWindow).__mockBackend
    const user = await backend?.auth.getCurrentUser()
    if (!backend || !user) throw new Error("no mock backend or user")
    const clientId = (await backend.db.getClients(user.id)).find((c) => c.name === client)?.id
    const ids = new Set((await backend.db.getEngagements(user.id)).filter((e) => e.clientId === clientId).map((e) => e.id))
    return (await backend.db.getAllocations(user.id)).filter((a) => ids.has(a.engagementId)).map((a) => [a.yearMonth, a.days])
  }, client)
}

/** The week's result above the grid; `tile` is one of its cards, by its label. */
function weekResultTile(page: Page, tile: string) {
  return page.getByRole("region", { name: "Week result" }).getByText(tile, { exact: true }).locator("..")
}

/** Opens /plan on last week and returns its Monday. */
async function openLastWeek(page: Page) {
  await navigateTo(page, "Plan", "/plan")
  await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible()
  await page.getByRole("link", { name: "Previous week" }).click()
  await expect(page).toHaveURL(/\/plan\?week=\d{4}-\d{2}-\d{2}$/)
  return new URL(page.url()).searchParams.get("week") as string
}

test.describe("Hours", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("logs two days, totals them, keeps them across weeks and clears a cell", async ({ page }) => {
    const client = uniqueName("Hours")
    await seedContract(page, client)
    const monday = await openLastWeek(page)
    const tuesday = format(addDays(parseISO(monday), 1), "yyyy-MM-dd")
    const lastWeek = page.url()

    const row = contractRow(page, client)
    const totals = weekTable(page).getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Total" }) })
    const mon = row.getByRole("textbox").nth(0)
    const tue = row.getByRole("textbox").nth(1)

    await mon.fill("6")
    await mon.press("Tab")
    await expect(tue).toBeFocused()
    await tue.fill("2,5")
    // The only row: Enter saves where it stands.
    await tue.press("Enter")

    // 8.5 h at 8 hours a day.
    await expect(row.getByRole("cell").last()).toHaveText("8.5 h")
    await expect(totals).toContainText("6 h")
    await expect(totals).toContainText("2.5 h")
    await expect(totals.getByRole("cell").last()).toContainText("8.5 h")
    // 1.0625 d at €500, as invoices value them; last week is all worked.
    await expect(totals.getByRole("cell").last()).toContainText("1.06 d")
    await expect(totals.getByRole("cell").last()).toContainText("€531.25")
    await expect(weekResultTile(page, "Worked")).toContainText("8.5 h")
    await expect(weekResultTile(page, "Worked")).toContainText("1.06 d · €531.25")
    await expect.poll(() => storedHours(page)).toEqual([[monday, 6], [tuesday, 2.5]])

    // Out of range: marked, explained, never written; Esc puts the stored hours back.
    await mon.fill("25")
    await expect(mon).toHaveAttribute("aria-invalid", "true")
    await expect(page.getByRole("alert").filter({ hasText: "Hours go from 0 to 24" })).toBeVisible()
    await mon.press("Escape")
    await expect(mon).toHaveValue("6")
    await expect(mon).not.toHaveAttribute("aria-invalid")

    // A ninth hour on the client's day: refused with the reason, nothing written.
    await mon.fill("9")
    await mon.press("Tab")
    await expect(page.getByRole("alert").filter({ hasText: "That makes 9 h on this client in one day: more than 8." })).toBeVisible()
    await expect.poll(() => storedHours(page)).toEqual([[monday, 6], [tuesday, 2.5]])
    await mon.fill("6")
    await mon.press("Tab")

    await page.getByRole("link", { name: "Next week" }).click()
    await expect(page).not.toHaveURL(lastWeek)
    await expect(row.getByRole("cell").last()).toHaveText("—")
    await page.getByRole("link", { name: "Previous week" }).click()
    await expect(page).toHaveURL(lastWeek)
    await expect(mon).toHaveValue("6")
    await expect(tue).toHaveValue("2.5")

    await mon.fill("")
    await mon.press("Tab")
    await expect(row.getByRole("cell").last()).toContainText("2.5 h")
    await expect(totals.getByRole("cell").last()).toContainText("0.31 d")
    await expect(mon).toHaveValue("")
    await expect.poll(() => storedHours(page)).toEqual([[tuesday, 2.5]])
  })

  // The page is one scroll with anchor chips: a chip jumps, and nothing unmounts, so a draft keeps until its blur saves it.
  test("jumping to Projection saves what was just typed, in the week and in Days by Month", async ({ page }) => {
    const client = uniqueName("Tab")
    await seedContract(page, client)
    const monday = await openLastWeek(page)
    const thisMonth = format(new Date(), "yyyy-MM")
    const chip = (name: string) => page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name })
    const mon = contractRow(page, client).getByRole("textbox").nth(0)

    await mon.fill("8")
    await chip("Projection").click()
    await expect.poll(() => storedHours(page)).toEqual([[monday, 8]])

    await chip("This Week").click()
    await expect(mon).toHaveValue("8")
    await plannedDays(page, client, format(new Date(), "MMMM yyyy"), 10).click()
    await planTable(page).getByRole("spinbutton").fill("12")
    await chip("Projection").click()
    await expect.poll(() => storedDays(page, client)).toEqual([[thisMonth, 12]])
  })

  test("the projection shows twelve months, and Show 24 Months all of them", async ({ page }) => {
    await seedContract(page, uniqueName("Months"))
    await navigateTo(page, "Plan", "/plan")
    await expect(page.getByRole("tab")).toHaveCount(0)
    const rows = page.getByRole("table", { name: /^Projection by month/ }).getByRole("row")
    // Header, the months, the total.
    await expect(rows).toHaveCount(14)
    await page.getByRole("button", { name: "Show 24 Months" }).click()
    await expect(rows).toHaveCount(26)
    await expect(page.getByRole("button", { name: "Show 12 Months" })).toBeVisible()
  })

  test("a cell typed into again while its save is in flight stores what was typed last", async ({ page }) => {
    const client = uniqueName("Slow")
    await seedContract(page, client)
    const monday = await openLastWeek(page)
    const row = contractRow(page, client)
    const [mon, tue] = [0, 1].map((d) => row.getByRole("textbox").nth(d))
    await mon.fill("6")
    await mon.press("Tab")
    await expect.poll(() => storedHours(page)).toEqual([[monday, 6]])

    await latency(page, 700)
    await mon.fill("8")
    await mon.press("Tab")
    // Sent: read-only until it lands, so no second save races it and no refetch lands under typing.
    await expect(mon).not.toBeEditable()
    await expect(mon).toHaveValue("8")
    // fill waits for the cell to open again. Typing the old 6 back is then a change from 8, not "the same".
    await mon.fill("6")
    await mon.press("Tab")
    await expect(mon).toHaveValue("6")
    await expect.poll(() => storedHours(page)).toEqual([[monday, 6]])

    // Clearing a day whose first hours are still being saved clears it.
    await tue.fill("8")
    await tue.press("Tab")
    await expect(tue).not.toBeEditable()
    await tue.fill("")
    await tue.press("Tab")
    await expect(tue).toHaveValue("")
    await expect.poll(() => storedHours(page)).toEqual([[monday, 6]])
    await expect(row.getByRole("cell").last()).toContainText("6 h")
  })

  test("adds, reads, edits and clears a note on a day with hours", async ({ page }) => {
    const client = uniqueName("Note")
    await seedContract(page, client)
    const monday = await openLastWeek(page)
    const row = contractRow(page, client)
    const mon = row.getByRole("textbox").nth(0)
    const label = `Note for ${client} · Retainer, ${format(parseISO(monday), "EEEE d MMM")}`
    const note = page.getByRole("button", { name: label })
    const dot = note.locator(".rounded-full")
    const text = page.getByRole("dialog", { name: label }).getByLabel("Note")
    const save = page.getByRole("button", { name: "Save" })

    // A day without hours holds no note.
    await expect(note).toBeDisabled()
    await expect(note).toHaveAttribute("title", "Log hours first")

    await mon.fill("6")
    await mon.press("Tab")
    await expect.poll(() => storedHours(page)).toEqual([[monday, 6]])
    await expect(note).toBeEnabled()
    await expect(dot).toHaveCount(0)

    await note.click()
    await expect(text).toBeFocused()
    await text.fill("Sprint review")
    await save.click()
    await expect(text).toBeHidden()
    await expect(note).toBeFocused()
    await expect(dot).toHaveCount(1)
    await expect(mon).toHaveAttribute("aria-label", /\. Note: Sprint review$/)
    await expect.poll(() => storedNotes(page)).toEqual([[monday, 6, "Sprint review"]])

    // Reopened, it holds the note; Cancel keeps it as it was.
    await note.click()
    await expect(text).toHaveValue("Sprint review")
    await text.fill("Never saved")
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(text).toBeHidden()
    await note.click()
    await expect(text).toHaveValue("Sprint review")
    await text.fill("Sprint review and retro")
    await save.click()
    await expect(text).toBeHidden()
    await expect.poll(() => storedNotes(page)).toEqual([[monday, 6, "Sprint review and retro"]])

    // Changing the hours keeps the note, and Tab goes on to the next day, past the note.
    await mon.fill("7")
    await mon.press("Tab")
    await expect(row.getByRole("textbox").nth(1)).toBeFocused()
    await expect.poll(() => storedNotes(page)).toEqual([[monday, 7, "Sprint review and retro"]])

    // Alt+Enter in the day opens its note; empty text clears it, and the hours stay.
    await mon.press("Alt+Enter")
    await expect(text).toBeFocused()
    await text.fill("")
    await save.click()
    await expect(text).toBeHidden()
    await expect(dot).toHaveCount(0)
    await expect.poll(() => storedNotes(page)).toEqual([[monday, 7, null]])

    // On a phone the note opens as a dialog, its title naming the day.
    await page.setViewportSize({ width: 375, height: 812 })
    await note.click()
    await expect(page.getByRole("heading", { name: label })).toBeVisible()
    await expect(text).toBeFocused()
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(text).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })

  test("shows one day at a time on a phone, without scrolling sideways", async ({ page }) => {
    const client = uniqueName("Phone")
    await seedContract(page, client)
    await openLastWeek(page)
    await page.setViewportSize({ width: 375, height: 812 })

    const headers = weekTable(page).getByRole("columnheader").filter({ visible: true })
    // Contract, Monday (a past week opens on its first day), Total.
    await expect(headers).toHaveCount(3)
    await expect(headers.nth(1)).toContainText("Mon")

    await page.getByRole("button", { name: /^Tue/ }).click()
    await expect(page.getByRole("button", { name: /^Tue/ })).toHaveAttribute("aria-pressed", "true")
    await expect(headers.nth(1)).toContainText("Tue")
    const cell = contractRow(page, client).getByRole("textbox").filter({ visible: true })
    await expect(cell).toHaveCount(1)
    await cell.fill("4")
    await cell.press("Enter")
    await expect(page.getByRole("button", { name: /^Tue/ })).toContainText("4 h")

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    expect((await cell.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  })

  test("groups contracts under their client, collapsible", async ({ page }) => {
    // Alpha sorts first, so Zulu's rows come after its own.
    const [alpha, zulu] = [uniqueName("Alpha"), uniqueName("Zulu")]
    await seedContract(page, zulu, { name: "Build" })
    await seedContract(page, zulu, { name: "Support" })
    await seedContract(page, alpha)
    const monday = await openLastWeek(page)
    const tuesday = format(addDays(parseISO(monday), 1), "yyyy-MM-dd")

    const toggle = (client: string) => weekTable(page).getByRole("rowheader").getByRole("button", { name: client })
    // `has` looks inside the row, so its locator starts from the page, not the table.
    const header = (client: string) =>
      weekTable(page).getByRole("row").filter({ has: page.getByRole("rowheader").getByRole("button", { name: client }) })
    const [build, support] = [contractRow(page, zulu, "Build"), contractRow(page, zulu, "Support")]
    const retainer = contractRow(page, alpha)
    const [buildMon, alphaMon] = [build.getByRole("textbox").nth(0), retainer.getByRole("textbox").nth(0)]

    await buildMon.fill("6")
    await buildMon.press("Enter")
    await expect(support.getByRole("textbox").nth(0)).toBeFocused()
    await support.getByRole("textbox").nth(0).fill("2")
    await support.getByRole("textbox").nth(0).press("Tab")
    await expect.poll(() => storedHours(page)).toEqual([[monday, 2], [monday, 6]])

    // A header per client: its contracts, its day and its week.
    await expect(toggle(zulu)).toContainText("2 contracts")
    await expect(toggle(alpha)).toContainText("1 contract")
    await expect(header(zulu).getByRole("cell").first()).toHaveText("8 h")
    await expect(header(zulu).getByRole("cell").last()).toContainText("8 h")
    await expect(header(alpha).getByRole("cell").last()).toHaveText("—")

    // Folding saves what was just typed, drops the rows, and keeps the totals.
    await expect(toggle(zulu)).toHaveAttribute("aria-expanded", "true")
    await build.getByRole("textbox").nth(1).fill("3")
    await toggle(zulu).click()
    await expect(toggle(zulu)).toHaveAttribute("aria-expanded", "false")
    await expect(weekTable(page).getByRole("rowheader", { name: `${zulu} ·` })).toHaveCount(0)
    await expect.poll(() => storedHours(page)).toEqual([[monday, 2], [monday, 6], [tuesday, 3]])
    await expect(header(zulu).getByRole("cell").first()).toHaveText("8 h")
    await expect(header(zulu).getByRole("cell").nth(1)).toHaveText("3 h")
    await expect(header(zulu).getByRole("cell").last()).toContainText("11 h")

    // Enter walks past the folded rows: from the last row shown it saves in place.
    await alphaMon.fill("1")
    await alphaMon.press("Enter")
    await expect(page.locator("input:focus")).toHaveCount(0)
    await expect.poll(() => storedHours(page)).toEqual([[monday, 1], [monday, 2], [monday, 6], [tuesday, 3]])

    // The fold is kept in this browser: back on the page, Zulu is still folded.
    // Clients and Back, not a reload: a full load wipes the mock backend.
    await navigateTo(page, "Clients", "/clients")
    await page.goBack()
    await expect(toggle(zulu)).toHaveAttribute("aria-expanded", "false")
    await expect(weekTable(page).getByRole("rowheader", { name: `${zulu} ·` })).toHaveCount(0)

    const all = page.getByRole("button", { name: /^(Collapse|Expand) All$/ })
    await expect(all).toHaveText("Collapse All")
    await all.click()
    await expect(all).toHaveText("Expand All")
    await expect(toggle(alpha)).toHaveAttribute("aria-expanded", "false")
    await expect(retainer).toHaveCount(0)
    await all.click()
    await expect(all).toHaveText("Collapse All")
    for (const row of [build, support, retainer]) await expect(row).toBeVisible()
    // Unfolded, Enter goes down into Zulu again.
    await alphaMon.press("Enter")
    await expect(buildMon).toBeFocused()

    // On a phone the headers show the one day too, and nothing scrolls sideways.
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(weekTable(page).getByRole("columnheader").filter({ visible: true })).toHaveCount(3)
    await expect(header(zulu).getByRole("cell").filter({ visible: true })).toHaveCount(2)
    await expect(header(zulu).getByRole("cell").filter({ visible: true }).first()).toHaveText("8 h")
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })

  test("logs hours ahead, up to 3 months", async ({ page }) => {
    const client = uniqueName("Ahead")
    await seedContract(page, client)
    await navigateTo(page, "Plan", "/plan")
    const row = contractRow(page, client)
    const totals = weekTable(page).getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Total" }) })

    // Next week's Monday is after today: it takes hours, stored as they are, drawn dashed.
    await page.getByRole("link", { name: "Next week" }).click()
    await expect(page).toHaveURL(/\/plan\?week=\d{4}-\d{2}-\d{2}$/)
    const nextMonday = new URL(page.url()).searchParams.get("week") as string
    const mon = row.getByRole("textbox").nth(0)
    await expect(mon).toBeEnabled()
    await expect(mon).toHaveAttribute("aria-label", /, scheduled$/)
    await expect(mon).toHaveClass(/border-dashed/)
    await mon.fill("3")
    await mon.press("Tab")
    await expect.poll(() => storedHours(page)).toEqual([[nextMonday, 3]])
    // Scheduled, so priced apart from what is worked.
    await expect(row.getByRole("cell").last()).toContainText("3 h scheduled")
    await expect(weekResultTile(page, "Scheduled")).toContainText("3 h")
    await expect(weekResultTile(page, "Scheduled")).toContainText("€187.50")
    await expect(totals).toContainText("+€187.50 sch.")

    // Next walks up to the week holding the last day that takes hours, then stops.
    const next = page.getByRole("link", { name: "Next week" })
    for (let i = 0; i < 15 && (await next.count()) > 0; i++) {
      const url = page.url()
      await next.click()
      await expect(page).not.toHaveURL(url)
      await expect(row).toBeVisible()
    }
    await expect(page.getByRole("button", { name: "Next week" })).toBeDisabled()
    const monday = new URL(page.url()).searchParams.get("week") as string
    const limit = differenceInCalendarDays(addMonths(new Date(), 3), parseISO(monday))
    expect(limit).toBeGreaterThanOrEqual(0)
    expect(limit).toBeLessThan(7)
    await expect(row.getByRole("textbox").nth(limit)).toBeEnabled()
    if (limit < 6) await expect(row.getByRole("textbox").nth(limit + 1)).toBeDisabled()
  })

  test("a contract closed on a date locks the days after it", async ({ page }) => {
    const client = uniqueName("Ended")
    const lastMonday = startOfISOWeek(subDays(new Date(), 7))
    const day = (n: number) => format(addDays(lastMonday, n), "yyyy-MM-dd")
    // Closed on last week's Wednesday, with hours already stored on the Thursday after it.
    await seedContract(page, client, { closed: day(2), hours: [[day(3), 4]] })
    expect(await openLastWeek(page)).toBe(day(0))

    const row = contractRow(page, client)
    const cells = [0, 1, 2, 3, 4].map((d) => row.getByRole("textbox").nth(d))
    for (const d of [0, 1, 2]) await expect(cells[d]).toBeEnabled()
    await expect(cells[4]).toBeDisabled()

    // Thursday keeps its hours: no new ones, but they can be cleared.
    const thu = cells[3]
    await expect(thu).toHaveValue("4")
    await thu.fill("5")
    await thu.press("Tab")
    await expect(page.getByRole("alert").filter({ hasText: "The contract has ended before this day." })).toBeVisible()
    await thu.fill("")
    await thu.press("Tab")
    await expect(thu).toHaveValue("")
    await expect.poll(() => storedHours(page)).toEqual([])
    await expect(thu).toBeDisabled()
  })

  test("a week's hours show in Days by month on the same page, and Use puts them in the plan", async ({ page }) => {
    const client = uniqueName("Close")
    const now = new Date()
    const lastMonth = format(subMonths(now, 1), "yyyy-MM")
    const lastName = format(subMonths(now, 1), "MMMM yyyy")
    // Started 3 months back, so last month is in the plan.
    await seedContract(page, client, { startMonth: format(subMonths(now, 3), "yyyy-MM") })
    await navigateTo(page, "Plan", "/plan")
    const row = contractRow(page, client)

    // Back to a week wholly inside last month.
    let monday = ""
    for (let i = 0; i < 10 && !(monday.startsWith(lastMonth) && shiftWeekEnd(monday).startsWith(lastMonth)); i++) {
      const url = page.url()
      await page.getByRole("link", { name: "Previous week" }).click()
      await expect(page).not.toHaveURL(url)
      monday = new URL(page.url()).searchParams.get("week") as string
    }
    expect(monday.startsWith(lastMonth)).toBe(true)

    const [mon, tue, wed] = [0, 1, 2].map((d) => row.getByRole("textbox").nth(d))
    await mon.fill("8")
    await mon.press("Tab")
    await tue.fill("8")
    await tue.press("Tab")
    await wed.fill("4")
    await wed.press("Tab")

    // 20 h = 2.5 d against the contract's default 10, under the week: shown before anything is written.
    const last = planCell(page, client, 1)
    const use = last.getByRole("button", { name: `Use hours: ${client} · Retainer, ${lastName}, ` })
    await expect(use).toHaveText("Use 2.5 d")
    expect(await storedDays(page, client)).toEqual([])

    await use.click()
    await expect(last).toContainText("✓")
    await expect.poll(() => storedDays(page, client)).toEqual([[lastMonth, 2.5]])

    // Then the hours change: the plan keeps what was used until Use is clicked again.
    await wed.fill("6")
    await wed.press("Tab")
    await expect(use).toHaveText("Use 2.75 d")
    await expect(plannedDays(page, client, lastName, 2.5)).toBeVisible()
    await expect.poll(() => storedDays(page, client)).toEqual([[lastMonth, 2.5]])
  })

  test("Use puts a closed month's hours in the plan, Undo takes them back out", async ({ page }) => {
    const client = uniqueName("Use")
    const now = new Date()
    const lastMonth = format(subMonths(now, 1), "yyyy-MM")
    const lastName = format(subMonths(now, 1), "MMMM yyyy")
    // Started 3 months back, so last month is in the plan: 20 h there.
    await seedContract(page, client, {
      startMonth: format(subMonths(now, 3), "yyyy-MM"),
      hours: [[`${lastMonth}-10`, 8], [`${lastMonth}-11`, 8], [`${lastMonth}-12`, 4]],
    })
    await navigateTo(page, "Plan", "/plan")

    const last = planCell(page, client, 1)
    const use = last.getByRole("button", { name: `Use hours: ${client} · Retainer, ${lastName}, ` })
    const useAll = planTable(page)
      .getByRole("columnheader", { name: format(subMonths(now, 1), "MMM ''yy") })
      .getByRole("button", { name: /^Use All/ })
    const undo = page.getByRole("button", { name: "Undo" })

    // 20 h = 2.5 d against the contract's default 10: shown before anything is written.
    await expect(plannedDays(page, client, lastName, 10)).toBeVisible()
    await expect(use).toHaveText("Use 2.5 d")
    await expect(useAll).toHaveText("Use All (1)")
    expect(await storedDays(page, client)).toEqual([])

    await use.click()
    await expect(last).toContainText("✓")
    await expect(plannedDays(page, client, lastName, 2.5)).toBeVisible()
    await expect(useAll).toHaveCount(0)
    await expect.poll(() => storedDays(page, client)).toEqual([[lastMonth, 2.5]])

    // Undo puts the default back: the row goes, not a stored 10.
    await undo.click()
    await expect(use).toHaveText("Use 2.5 d")
    await expect.poll(() => storedDays(page, client)).toEqual([])

    // A row written from chat that the page has not seen yet is updated, not doubled; Undo puts it back.
    await writeDaysBehind(page, client, lastMonth, 4)
    await use.click()
    await expect(last).toContainText("✓")
    await expect.poll(() => storedDays(page, client)).toEqual([[lastMonth, 2.5]])
    await undo.click()
    await expect(plannedDays(page, client, lastName, 4)).toBeVisible()
    await expect(use).toHaveText("Use 2.5 d")
    await expect.poll(() => storedDays(page, client)).toEqual([[lastMonth, 4]])

    // A double click, on a slow backend, makes one row.
    await clearPlanCell(page, plannedDays(page, client, lastName, 4))
    await expect.poll(() => storedDays(page, client)).toEqual([])
    await latency(page, 300)
    await use.dblclick()
    await expect(last).toContainText("✓")
    await expect.poll(() => storedDays(page, client)).toEqual([[lastMonth, 2.5]])
    await latency(page, 0)

    // Use All does the same for the whole column; clearing the cell takes the month back to the default.
    await clearPlanCell(page, plannedDays(page, client, lastName, 2.5))
    await expect(useAll).toHaveText("Use All (1)")
    await useAll.click()
    await expect(last).toContainText("✓")
    await expect.poll(() => storedDays(page, client)).toEqual([[lastMonth, 2.5]])
    await clearPlanCell(page, plannedDays(page, client, lastName, 2.5))
    await expect(use).toHaveText("Use 2.5 d")
    await expect.poll(() => storedDays(page, client)).toEqual([])

    // The current month still reads the contract default: only last month moved.
    await expect(plannedDays(page, client, format(now, "MMMM yyyy"), 10)).toBeVisible()
  })

  test("Use raises an open month any time, and lowers one only once most of it has hours", async ({ page }) => {
    const [pace, raise] = [uniqueName("Pace"), uniqueName("Raise")]
    const next = addMonths(new Date(), 1)
    const weekdays = eachDayOfInterval({ start: startOfMonth(next), end: endOfMonth(next) })
      .filter((d) => !isWeekend(d))
      .map((d): [string, number] => [format(d, "yyyy-MM-dd"), 8])
    // Seeded before the page opens: what it has read stays fresh for a minute.
    await seedContract(page, pace, { hours: weekdays.slice(0, 2) })
    await seedContract(page, raise, { hours: weekdays.slice(0, 11) })
    await navigateTo(page, "Plan", "/plan")

    // 2 d against 10, with 11 weekdays of the month covered: too early to lower it.
    await expect(planCell(page, pace, 3)).toContainText("2 of 10 d")
    await expect(planCell(page, pace, 3).getByRole("button")).toHaveCount(1)
    // 11 d against 10: raised now.
    const use = planCell(page, raise, 3).getByRole("button", { name: /^Use hours: / })
    await expect(use).toHaveText("Use 11 d")
    await use.click()
    await expect(planCell(page, raise, 3)).toContainText("✓")
    await expect.poll(() => storedDays(page, raise)).toEqual([[format(next, "yyyy-MM"), 11]])
    expect(await storedDays(page, pace)).toEqual([])
  })

  // #249: an hourly contract could only be entered as days, so 10 h at €75/h billed €93.75.
  test("a contract signed in hours bills hours × its rate: €75/h, 100 h, 10 h logged is €750", async ({ page }) => {
    const client = uniqueName("Hourly")
    // Seeded through the backend before any page reads it (the queries cache): Month End below needs 10 h in last month.
    const lastMonth = format(subMonths(new Date(), 1), "yyyy-MM")
    const seeded = uniqueName("Seeded")
    await seedContract(page, seeded, { name: "Seeded", unit: "hour", startMonth: lastMonth, hours: [[`${lastMonth}-10`, 10]] })
    await navigateTo(page, "Clients", "/clients")
    await page.getByRole("button", { name: "New Contract", exact: true }).click()
    const form = page.getByRole("dialog", { name: "New Contract" })
    await page.getByRole("combobox").filter({ hasText: "Choose or type a client" }).first().click()
    await page.getByPlaceholder(/search or type a new name/i).fill(client)
    await page.getByRole("option").filter({ hasText: client }).first().click()
    await form.getByLabel("Name").fill("Support")
    await form.getByRole("button", { name: "Hours" }).click()
    await form.getByLabel("Hourly rate").fill("75")
    await form.getByLabel("Hours/month").fill("40")
    await form.getByLabel("Contracted hours").fill("100")
    await form.getByRole("button", { name: /^create contract$/i }).click()
    await expect(form).toBeHidden()

    await openLastWeek(page)
    const mon = contractRow(page, client, "Support").getByRole("textbox").nth(0)
    // 8 h a day is the most a client takes: 8 + 2.
    await mon.fill("8")
    await mon.press("Tab")
    await contractRow(page, client, "Support").getByRole("textbox").nth(1).fill("2")
    await contractRow(page, client, "Support").getByRole("textbox").nth(1).press("Enter")
    await expect(weekResultTile(page, "Worked")).toContainText("€750.00")
    // #255: the week says hours, never a day count beside them.
    await expect(page.getByRole("region", { name: "Week result" })).not.toContainText(/ d\b/)
    await expect(weekResultTile(page, "Worked")).toContainText("10 h")

    // Month End reads that contract in hours.
    await navigateTo(page, "Month End", "/month-end")
    const hours = page.getByRole("region", { name: "Hours" })
    await expect(hours.getByText(`${seeded} · Seeded: 10 h logged, 80 h planned`)).toBeVisible()
    await expect(hours.getByRole("button", { name: "Use 10 h" }).first()).toBeVisible()
    await expect(hours).not.toContainText(/ d (logged|planned)/)

    await navigateTo(page, "Clients", "/clients")
    await page.getByRole("heading", { name: client }).getByRole("link").click()
    await expect(page.getByRole("heading", { name: client, level: 1 })).toBeVisible()
    await expect(page.getByText("10 h of 100 h used")).toBeVisible()
    await expect(page.getByRole("region", { name: "Summary" })).toContainText("€750.00")
  })
})

/** The Sunday of the week starting `monday`. */
function shiftWeekEnd(monday: string) {
  return format(addDays(parseISO(monday), 6), "yyyy-MM-dd")
}
