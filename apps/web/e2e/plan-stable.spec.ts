import { test, expect } from "@playwright/test"
import { addMonths, format } from "date-fns"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"
import type { Locator, Page } from "@playwright/test"

/**
 * Editing a cell on /plan never moves or resizes the page: not in Days by Month, not in the week.
 * Each step (before, focused, typed, saved) is measured as the boxes of the table, its
 * column headers and its rows (size and place on the page); every step must equal the first. On a phone Days by Month
 * is a card per month, so its card and rows are measured instead of a table.
 */

// One reading of the clock for the pin, the seeds and the locators: a run across midnight on a month end cannot split them.
const NOW = new Date()

type MockWindow = Window & { __mockBackend?: BackendAdapter }

/**
 * A contract of 10 d a month; `budget` days cap it, so a later month shows its "over" line.
 * It starts `startOffset` months from now; with `hoursDays` it has that many 8 h days logged (a half day is 4 h)
 * in the month before this one, so that month offers Use (and the header Use All).
 * `typed` stores allocations ([months from now, days]): months the owner typed, which count in full against the budget.
 */
async function seedContract(page: Page, client: string, budget: number | null, startOffset = 0, hoursDays = 0, endOffset: number | null = null, typed: [number, number][] = []) {
  const startMonth = format(addMonths(NOW, startOffset), "yyyy-MM")
  const endMonth = endOffset === null ? null : format(addMonths(NOW, endOffset), "yyyy-MM")
  const hoursMonth = format(addMonths(NOW, -1), "yyyy-MM")
  const typedMonths = typed.map(([offset, days]) => ({ yearMonth: format(addMonths(NOW, offset), "yyyy-MM"), days }))
  await page.evaluate(
    async ({ client, startMonth, endMonth, budget, hoursMonth, hoursDays, typedMonths }) => {
      const backend = (window as MockWindow).__mockBackend
      const user = await backend?.auth.getCurrentUser()
      if (!backend || !user) throw new Error("no mock backend or user")
      const { id: clientId } = await backend.db.createClient(user.id, { name: client })
      const { id: engagementId } = await backend.db.createEngagement(user.id, {
        clientId, name: "Retainer", dailyRate: 500, vatApplicable: true, defaultDaysPerMonth: 10, startMonth, contractedDays: budget, ...(endMonth ? { endMonth } : {}),
      })
      for (const { yearMonth, days } of typedMonths) await backend.db.createAllocation(user.id, { engagementId, yearMonth, days })
      for (let d = 1; d <= Math.ceil(hoursDays); d++) {
        const hours = d <= hoursDays ? 8 : 4
        await backend.db.setTimecard(user.id, { engagementId, date: `${hoursMonth}-${String(d).padStart(2, "0")}`, hours })
      }
    },
    { client, startMonth, endMonth, budget, hoursMonth, hoursDays, typedMonths },
  )
}

/** Width, height and top (on the page) of `scope`, of each header cell in it, and of each row (or direct child, for cards). */
async function boxes(scope: Locator) {
  return scope.evaluate((el) => {
    const r = (e: Element) => {
      const b = e.getBoundingClientRect()
      // A hidden row (display: none) has no place, whatever the scroll.
      if (!b.width && !b.height) return [0, 0, 0]
      return [Math.round(b.width * 100) / 100, Math.round(b.height * 100) / 100, Math.round((b.top + window.scrollY) * 100) / 100]
    }
    const parts = el.tagName === "TABLE" ? [...el.querySelectorAll("th, tr")] : [...el.children]
    return [r(el), ...parts.map(r)]
  })
}

/** The text of anything in `scope` whose text runs past its box: clipped, whatever the CSS says. */
async function clipped(scope: Locator) {
  return scope.evaluate((el) =>
    [...el.querySelectorAll("button, span, p, div")].filter((e) => e.children.length === 0 && e.textContent && getComputedStyle(e).display !== "inline" && e.scrollWidth > e.clientWidth).map((e) => e.textContent),
  )
}

/** Runs each step of an edit and expects every box to stay as it was before the first. */
async function stays(scope: Locator, steps: (() => Promise<unknown>)[], saved?: () => Promise<unknown>) {
  // The page has finished loading when two reads two frames apart agree.
  const frames = () => scope.page().evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  let first = await boxes(scope)
  await expect
    .poll(async () => {
      await frames()
      const again = await boxes(scope)
      const same = JSON.stringify(again) === JSON.stringify(first) && first[0][0] > 0
      first = again
      return same
    })
    .toBe(true)
  for (const [i, step] of steps.entries()) {
    await step()
    const now = await boxes(scope)
    // On failure the diff names the box that moved: [0] is the table, then each th and tr in DOM order.
    expect(now, `step ${i + 1}`).toEqual(first)
  }
  // The save lands after the last step: what it adds or removes (an over line, Use All) is measured too.
  // `saved` waits for the save's visible end state; without one, two frames (ponytail: time-based, fine on the mock, which answers in a microtask; give the caller a `saved` step when a slow backend matters).
  if (saved) await saved()
  else await scope.page().evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  expect(await boxes(scope), "after the save").toEqual(first)
}

/** The second line of the contract's box, "<N> d not planned" or "<N> d over plan", exactly: toContainText would take "10 d" for "0 d". */
const planLine = (scope: Locator) => scope.locator("div.w-40 > div:nth-child(2)").first()

/** Below sm (640 px) Days by Month is a card per month, not a table. */
const isPhone = (page: Page) => page.viewportSize()!.width < 640

test.describe("Plan stays still while you edit", () => {
  test.beforeEach(async ({ page }) => {
    // The week tests click Previous Week, and the contract starts this month: up to the 13th that week lies before it. The 15th of the current month keeps both weeks inside it, whatever day the suite runs (the seeds above only use the month, so they agree with it).
    const now = new Date(NOW)
    await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), 15, 12))
    await signIn(page)
  })

  // `month`: the edited month, in months from now. 10 d a month; a budget of 15 d is filled by the default plan, and only a typed month can push it over.
  const cases = [
    { name: "a plain cell", budget: null, month: 0, value: "12", start: 0, hours: 0 },
    { name: "a cell in a capped contract", budget: 15, month: 1, value: "12", start: 0, hours: 0 },
    { name: "a cell that crosses the budget", budget: 15, month: 0, value: "20", start: 0, hours: 0 },
    // "Use 13.5 d": the longest line a cell's slot holds in everyday use.
    { name: "a closed month saved to its hours", budget: null, month: -1, value: "13.5", start: -1, hours: 13.5 },
  ]
  for (const { name, budget, month, value, start, hours } of cases) {
    test(`Days by Month: ${name} keeps the table's boxes`, async ({ page }) => {
      await seedContract(page, uniqueName("Still"), budget, start, hours)
      await navigateTo(page, "Plan", "/plan")
      const table = page.getByRole("table", { name: "Days by month" })
      await expect(page.getByRole("heading", { name: "Days by Month" })).toBeVisible()
      if (isPhone(page)) {
        // Phone: the month card, its input always there.
        // The strip can hold one month name twice (Sep 2026 and Sep 2027): the first is the nearest to today.
        const target = addMonths(NOW, month)
        await page.getByRole("tab", { name: new RegExp(format(target, "MMM")) }).first().click()
        const card = page.getByRole("tabpanel", { name: format(target, "MMMM yyyy") })
        await expect(card).toBeVisible()
        expect(await clipped(card), "clipped text").toEqual([])
        const input = card.getByRole("textbox").first()
        await stays(card, [() => input.focus(), () => input.fill(value), () => input.press("Enter")])
        return
      }
      // The contract's first button is its start month's; the edited month is `month - start` after it.
      const cell = table.getByRole("button", { name: /d planned/ }).nth(month - start)
      const input = table.getByRole("spinbutton")
      await expect(cell).toBeVisible()
      expect(await clipped(table), "clipped text").toEqual([])
      // The save has landed when the cell's name (it carries the planned days) is no longer the one it had.
      const before = await cell.getAttribute("aria-label")
      await stays(table, [() => cell.click(), () => input.fill(value), () => input.press("Enter")], () => expect(cell).not.toHaveAttribute("aria-label", before!))
    })
  }

  test("the week: typing hours keeps the table's boxes", async ({ page }) => {
    await seedContract(page, uniqueName("Week"), null)
    await navigateTo(page, "Plan", "/plan")
    await page.getByRole("link", { name: "Previous week" }).click()
    const table = page.getByRole("table", { name: /^Hours from / })
    const input = table.getByRole("textbox").first()
    await stays(table, [() => input.focus(), () => input.fill("7.5"), () => input.press("Tab"), () => expect(table).toContainText("7.5 h")])
    // Days to come add the "scheduled" line to the totals, and their weekdays to the Scheduled card above the table.
    await page.getByRole("link", { name: "Next week" }).click()
    await page.getByRole("link", { name: "Next week" }).click()
    const future = table.getByRole("textbox")
    // A phone's card holds one day of the row in view: one day there, three on a desktop.
    const last = isPhone(page) ? 0 : 2
    await stays(table, [
      ...[...Array(last + 1).keys()].map((i) => () => future.nth(i).fill("7.5")),
      () => future.nth(last).press("Tab"),
      () => expect(table).toContainText("scheduled"),
    ])
  })

  // A 60 d contract planning 10 d a month for 12 months is filled up to its budget: 0 d not planned, never over plan.
  test("the week: the budget line moves while hours are typed, and the boxes do not", async ({ page }) => {
    await seedContract(page, uniqueName("Left"), 60)
    await navigateTo(page, "Plan", "/plan")
    await page.getByRole("link", { name: "Previous week" }).click()
    const table = page.getByRole("table", { name: /^Hours from / })
    const input = table.getByRole("textbox").first()
    await expect(table).toContainText("60 d left of 60")
    await stays(table, [() => input.focus(), () => input.fill("8"), () => expect(table).toContainText("59 d left of 60")])
    await expect(planLine(table)).toHaveText("0 d not planned") // the default plan fills the budget: never over plan
  })

  // 41 d with 31 d worked last month: 10 d left, a figure that loses a digit once 8 h are typed.
  test("the week: a figure losing a digit moves nothing", async ({ page }) => {
    await seedContract(page, uniqueName("Digit"), 41, 0, 31)
    await navigateTo(page, "Plan", "/plan")
    await page.getByRole("link", { name: "Previous week" }).click()
    const table = page.getByRole("table", { name: /^Hours from / })
    const input = table.getByRole("textbox").first()
    await expect(table).toContainText("10 d left of 41")
    expect(await clipped(table.locator("div.w-40")), "clipped text").toEqual([])
    await stays(table, [
      () => input.focus(),
      () => input.fill("8"),
      () => expect(table).toContainText("9 d left of 41"),
      () => input.fill("4"),
      () => expect(table).toContainText("9.5 d left of 41"),
    ])
    expect(await clipped(table.locator("div.w-40")), "clipped text").toEqual([])
  })

  // 60 d over this month and the 4 after, 50 d of it typed in the two months after this one: the default fills the other 10 d, so "0 d not planned".
  // The values typed cross into "over plan" (the typed months hold more than the budget) and back out, and a digit count.
  test("Days by Month: not planned crossing to over plan moves nothing", async ({ page }) => {
    await seedContract(page, uniqueName("Cross"), 60, 0, 0, 4, [[1, 30], [2, 20]])
    await navigateTo(page, "Plan", "/plan")
    await expect(page.getByRole("heading", { name: "Days by Month" })).toBeVisible()
    const phone = isPhone(page)
    const scope = phone ? page.getByRole("tabpanel", { name: format(NOW, "MMMM yyyy") }) : page.getByRole("table", { name: "Days by month" })
    const input = phone ? scope.getByRole("textbox").first() : scope.getByRole("spinbutton")
    await expect(planLine(scope)).toHaveText("0 d not planned")
    expect(await clipped(scope.locator("div.w-40")), "clipped text").toEqual([])
    const type = (value: string, text: string) => async () => {
      await input.fill(value)
      await expect(planLine(scope)).toHaveText(text)
    }
    await stays(scope, [
      ...(phone ? [() => input.focus()] : [() => scope.getByRole("button", { name: /d planned/ }).first().click()]),
      type("19", "9 d over plan"),
      type("5", "0 d not planned"),
      type("30", "20 d over plan"),
    ])
    expect(await clipped(scope.locator("div.w-40")), "clipped text").toEqual([])
  })

  test("Days by Month: the budget line moves while a month is typed, and the boxes do not", async ({ page }) => {
    await seedContract(page, uniqueName("Plan"), 60, 0, 0, 4)
    await navigateTo(page, "Plan", "/plan")
    await expect(page.getByRole("heading", { name: "Days by Month" })).toBeVisible()
    if (isPhone(page)) {
      const card = page.getByRole("tabpanel", { name: format(NOW, "MMMM yyyy") })
      const input = card.getByRole("textbox").first()
      await expect(card).toContainText("10 d not planned")
      await stays(card, [() => input.focus(), () => input.fill("12"), () => expect(card).toContainText("8 d not planned")])
      return
    }
    const table = page.getByRole("table", { name: "Days by month" })
    await expect(table).toContainText("10 d not planned")
    await stays(table, [
      () => table.getByRole("button", { name: /d planned/ }).first().click(),
      () => table.getByRole("spinbutton").fill("12"),
      () => expect(table).toContainText("8 d not planned"),
    ])
  })
})
