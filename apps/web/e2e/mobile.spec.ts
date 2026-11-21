import { test, expect } from "@playwright/test"

import { seedCashBook } from "./helpers/cash-book-seed"
import { DEMO_PAGES, openDemoPage, seedDemo } from "./helpers/demo"
import { seedSummaries } from "./helpers/summaries-seed"
import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { BackendAdapter } from "@/lib/backend"

/**
 * The shared phone fixes, checked where they were broken (mobile audit,
 * 2026-10): the nav sheet did not scroll, long form dialogs hid Save below the
 * fold, and Select lists had no height cap. A 375x667 phone, the smallest the
 * audit measured; the mobile-chrome project also emulates touch.
 */
test.describe("Mobile", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!isMobile, "Phone layout only")
    await page.setViewportSize({ width: 375, height: 667 })
    await signIn(page)
  })

  test("the nav sheet scrolls down to Settings and Sign out", async ({ page }) => {
    await page.getByRole("button", { name: /open navigation/i }).click()
    const sheet = page.getByRole("dialog")
    // The footer stays on screen; the links between scroll.
    await expect(sheet.getByRole("button", { name: "Sign out" })).toBeInViewport({ ratio: 1 })
    const settings = sheet.getByRole("link", { name: "Settings", exact: true })
    await settings.scrollIntoViewIfNeeded()
    await expect(settings).toBeInViewport({ ratio: 1 })
    await settings.click()
    await expect(page).toHaveURL("/settings")
  })

  test("a heading in the nav sheet opens its group and keeps the sheet open; a link closes it", async ({ page }) => {
    await page.getByRole("button", { name: /open navigation/i }).click()
    const sheet = page.getByRole("dialog")
    // The first group is open: Personal Finance in this build, which lists it first.
    await expect(sheet.getByRole("button", { name: "Personal Finance" })).toHaveAttribute("aria-expanded", "true")
    await sheet.getByRole("button", { name: "Accounting" }).click()
    await expect(sheet.getByRole("button", { name: "Accounting" })).toHaveAttribute("aria-expanded", "true")
    await expect(sheet.getByRole("link", { name: "Cash Book", exact: true })).toBeVisible()
    await sheet.getByRole("link", { name: "Cash Book", exact: true }).click()
    await expect(page).toHaveURL("/cash-book")
    await expect(sheet).toHaveCount(0)
  })

  test("Add Movement's pinned footer is one row on a 360 px phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await seedCashBook(page)
    await navigateTo(page, "Cash Book", "/cash-book")
    await page.getByRole("button", { name: "Add Movement" }).click()
    const dialog = page.getByRole("dialog", { name: "Add Movement" })
    const save = dialog.getByRole("button", { name: "Save", exact: true })
    const another = dialog.getByRole("button", { name: "Save & Add Another" })
    await expect(save).toBeInViewport({ ratio: 1 })
    // Side by side: a third button (Cancel; the X closes) wrapped Save onto a second row.
    expect((await another.boundingBox())!.y).toBe((await save.boundingBox())!.y)
  })

  // Every page, lived in: #205/#206 brought sideways overflow to zero on a phone, and this keeps it there.
  for (const demo of DEMO_PAGES) {
    test(`no page scrolls sideways at 375px: ${demo.path}`, async ({ page }) => {
      await seedDemo(page)
      await openDemoPage(page, demo)
      const width = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(width, `${demo.path} is ${width} px wide`).toBeLessThanOrEqual(375)
    })
  }

  test("Plan on a phone: a month strip with a card per contract, and the projection's Net column inside its card", async ({ page }) => {
    await seedDemo(page)
    await openDemoPage(page, { path: "/plan", nav: "Plan" })
    // No table to scroll sideways: the open month's contracts are cards, each with its days field.
    await expect(page.getByRole("table", { name: "Days by Month" })).toHaveCount(0)
    await expect(page.getByRole("tablist", { name: "Month" })).toBeVisible()
    await expect(page.getByRole("tabpanel").getByRole("textbox").first()).toBeVisible()
    // The projection table fits the card: its last column ends inside it.
    const table = page.getByRole("table", { name: "Projection by month: gross minus costs equals net" })
    await expect(table).toBeVisible()
    const card = (await table.locator("xpath=..").boundingBox())!
    const net = (await table.locator("tbody tr").first().locator("td").last().boundingBox())!
    expect(net.x + net.width).toBeLessThanOrEqual(card.x + card.width)
  })

  test("pinch-zoom is not locked", async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content")
    expect(viewport).not.toMatch(/maximum-scale|user-scalable=no/)
  })

  test("the Cash Book's first movement shows on the first screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await seedCashBook(page)
    await navigateTo(page, "Cash Book", "/cash-book")
    // The opening balance, then the month's first movement (rows under a day's heading, so not
    // the heading's row): both above the fold (the intro, the tall account cards and seven tiles put it at y 1631).
    const first = page.getByRole("table").first().locator("tbody tr:not(:has(th))").nth(1)
    await expect(first).toBeVisible()
    const box = (await first.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(812)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    // The tabs are one row that scrolls sideways, and the page never does.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })

  test("a Cash Book warning comes first on a phone, and the first movement still shows", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.evaluate(async () => {
      const backend = (window as unknown as { __mockBackend: BackendAdapter }).__mockBackend
      const u = (await backend.auth.getCurrentUser())!.id
      const now = new Date()
      const main = (await backend.db.createCompanyAccount(u, { name: "Main Bank", openingBalance: 9000, openingDate: new Date(now.getFullYear(), now.getMonth() - 1, 1) })).id
      // Paid to the owner with nothing lent: the SRL has paid more than it owed.
      await backend.db.createCompanyLoan(u, { description: "Paid to the owner", direction: "from_company", amount: 2000, date: new Date(now.getFullYear(), now.getMonth(), 1), accountId: main })
    })
    await navigateTo(page, "Cash Book", "/cash-book")
    // Fifth in a row that swipes, it sat off screen and stretched every tile to its height.
    const warning = page.getByRole("region", { name: "Summary" }).getByText(/more than it owed/)
    await expect(warning).toBeInViewport({ ratio: 1 })
    const first = page.getByRole("table").first().locator("tbody tr:not(:has(th))").nth(1)
    await expect(first).toContainText("Paid to the owner")
    const box = (await first.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(812)
  })

  test("a Costs warning stays on a phone, and the recurring rows fit", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.evaluate(async () => {
      const backend = (window as unknown as { __mockBackend: BackendAdapter }).__mockBackend
      const u = (await backend.auth.getCurrentUser())!.id
      const now = new Date()
      const main = (await backend.db.createCompanyAccount(u, { name: "Main Bank", openingBalance: 9000, openingDate: new Date(now.getFullYear(), now.getMonth() - 1, 1) })).id
      await backend.db.createCompanyLoan(u, { description: "Paid to the owner", direction: "from_company", amount: 2000, date: new Date(now.getFullYear(), now.getMonth(), 1), accountId: main })
    })
    await navigateTo(page, "Costs", "/costs")
    // The strip's own detail is hidden on a phone; the first visible copy is the one under the strip.
    await expect(page.getByText(/more than it owed/).filter({ visible: true }).first()).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })

  test("the Cash Book search stays 16 px on a touch tablet, where the toolbar asks for 14", async ({ page }) => {
    // An iPad Air in portrait: past sm, still touch. iOS zooms into a field under 16 px on focus.
    await page.setViewportSize({ width: 820, height: 1180 })
    await seedCashBook(page)
    await navigateTo(page, "Cash Book", "/cash-book")
    const search = page.getByRole("searchbox", { name: "Search movements" })
    await expect(search).toBeVisible()
    expect(await search.evaluate((i) => getComputedStyle(i).fontSize)).toBe("16px")
  })

  test("a client page's summary controls are 44 px tall and the page does not scroll sideways", async ({ page }) => {
    const client = uniqueName("Summary")
    await seedSummaries(page, client)
    await navigateTo(page, "Clients", "/clients")
    await page.getByRole("heading", { name: client }).getByRole("link").click()
    await expect(page.getByRole("heading", { name: client, level: 1 })).toBeVisible()
    const controls = [
      page.getByRole("region", { name: "Meetings", exact: true }).getByRole("button", { name: "Show 2 Older Meetings" }),
      page.getByRole("region", { name: "Contracts", exact: true }).getByRole("button", { name: "Show 3 Closed Contracts" }),
      page.getByRole("region", { name: "Opportunities", exact: true }).getByRole("link", { name: "View All opportunities" }),
      page.getByRole("region", { name: "Solutions", exact: true }).getByRole("link", { name: "View All solutions" }),
    ]
    for (const control of controls) {
      await control.scrollIntoViewIfNeeded()
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })

  test("the Pipeline's View All Closed is 44 px tall and the page does not scroll sideways", async ({ page }) => {
    await seedSummaries(page, uniqueName("Summary"))
    await navigateTo(page, "Pipeline", "/pipeline")
    const control = page.getByRole("button", { name: /^View All Closed \(\d+\)$/ })
    await control.scrollIntoViewIfNeeded()
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })

  // ── Personal Finance ─────────────────────────────────────────────────────────

  test("a form taller than the phone keeps Save on screen, also after a validation error", async ({ page }) => {
    await page.getByRole("button", { name: "New Transaction" }).click()
    const dialog = page.getByRole("dialog", { name: "New Transaction" })
    await expect(dialog).toBeVisible()
    // Taller than the screen, so the dialog scrolls inside itself...
    expect(await dialog.evaluate((d) => d.scrollHeight > d.clientHeight)).toBe(true)
    const save = dialog.getByRole("button", { name: "Add Transaction" })
    // ...and Save is pinned at its bottom, without scrolling anything.
    await expect(save).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => window.scrollY)).toBe(0)

    await save.click()
    await expect(dialog.getByText(/required|must|greater/i).first()).toBeVisible()
    await expect(save).toBeInViewport({ ratio: 1 })
    // 44 px on a touch screen.
    expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  })

  test("a phone held landscape keeps Save on screen too", async ({ page }) => {
    await navigateTo(page, "Dashboard", "/dashboard")
    // Wider than sm, but too short for the form: the footer still pins.
    await page.setViewportSize({ width: 844, height: 390 })
    await page.getByRole("button", { name: "New Transaction" }).click()
    const dialog = page.getByRole("dialog", { name: "New Transaction" })
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate((d) => d.scrollHeight > d.clientHeight)).toBe(true)
    await expect(dialog.getByRole("button", { name: "Add Transaction" })).toBeInViewport({ ratio: 1 })
  })

  test("turning the phone while the dashboard loads leaves the page unzoomed", async ({ page }) => {
    type E2eWindow = Window & { __MOCK_LATENCY_MS__?: number; __clearQueryCache?: () => void }
    // The dashboard's skeleton, held on screen: every read takes a second, from an empty cache.
    await navigateTo(page, "Settings", "/settings")
    await page.evaluate(() => {
      ;(window as E2eWindow).__MOCK_LATENCY_MS__ = 1000
      ;(window as E2eWindow).__clearQueryCache!()
    })
    await navigateTo(page, "Dashboard", "/dashboard")
    await expect(page.locator("main .animate-pulse").first()).toBeVisible()
    // Its account cards made the page 616 px wide. Chrome keeps a turned phone's zoom
    // relative to fit-the-width, so turning it zoomed the page 1.6x and hid the FAB.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    await page.setViewportSize({ width: 844, height: 390 })
    await page.evaluate(() => ((window as E2eWindow).__MOCK_LATENCY_MS__ = 0))
    await expect(page.getByRole("heading", { name: "Get started with Alter Ego" })).toBeVisible()
    expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1)
    await page.getByRole("button", { name: "New Transaction" }).click()
    await expect(page.getByRole("dialog", { name: "New Transaction" })).toBeVisible()
  })

  test("the edit transaction footer is one row on a 375 px phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await navigateTo(page, "Accounts", "/accounts")
    await page.getByRole("button", { name: /new account/i }).click()
    await page.getByLabel("Name").fill(uniqueName("Footer Account"))
    await page.getByRole("button", { name: /create account/i }).click()
    await navigateTo(page, "Transactions", "/transactions")
    await page.getByRole("button", { name: /new transaction/i }).click()
    const desc = uniqueName("Footer")
    await page.getByLabel("Description").fill(desc)
    await page.getByLabel("Amount").fill("5")
    await page.getByRole("combobox", { name: "Account" }).click()
    await page.getByRole("option").first().click()
    await page.getByRole("button", { name: /add transaction/i }).click()
    await page.getByRole("button", { name: desc }).click()
    const dialog = page.getByRole("dialog", { name: "Edit Transaction" })
    await expect(dialog).toBeVisible()
    const ys = await Promise.all(
      ["Delete", "Cancel", "Save Changes"].map(async (n) => (await dialog.getByRole("button", { name: n }).boundingBox())!.y),
    )
    expect(new Set(ys).size).toBe(1)
  })

  test("the date range picker shows the whole month, in a dialog, from the Filters sheet", async ({ page }) => {
    await navigateTo(page, "Transactions", "/transactions")
    // Below sm the filters live in a bottom sheet; search stays on the page.
    await expect(page.getByPlaceholder("Search transactions...")).toBeVisible()
    await page.getByRole("button", { name: "Filters", exact: true }).click()
    const sheet = page.getByRole("dialog", { name: "Filters" })
    await sheet.getByRole("button", { name: "Dates", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Date Range" })
    await expect(dialog).toBeVisible()
    // The month's last week on screen without scrolling (the popover hid it in an inner scroll).
    await expect(dialog.getByRole("gridcell").last()).toBeInViewport({ ratio: 1 })
    // Days a thumb can hit.
    const day = (await dialog.getByRole("gridcell").first().boundingBox())!
    expect(Math.min(day.width, day.height)).toBeGreaterThanOrEqual(44)
    await dialog.getByRole("button", { name: "Last 7 days" }).click()
    await expect(dialog).not.toBeVisible()
    await sheet.getByRole("button", { name: "Done" }).click()
    await expect(page.getByRole("button", { name: "Filters (1)" })).toBeVisible()
  })

  test("a long select list scrolls to its last option, inside the screen", async ({ page }) => {
    await navigateTo(page, "Settings", "/settings")
    // The auto-categorisation rule's category: every category, 40-odd options.
    const trigger = page.getByRole("combobox", { name: "Rule category" })
    await trigger.scrollIntoViewIfNeeded()
    await trigger.click()
    const list = page.getByRole("listbox")
    await expect(list).toBeVisible()
    const box = (await list.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(667)
    expect(box.x + box.width).toBeLessThanOrEqual(375)

    const last = list.getByRole("option").last()
    const name = (await last.textContent())!.trim()
    // The first scroll mounts Radix's scroll-up arrow, and the arrow scrolls the focused first option
    // back into view: a finger's few pixels, but this whole list in one jump. Jump again once it is in.
    await expect(async () => {
      await last.scrollIntoViewIfNeeded()
      await expect(last).toBeInViewport({ ratio: 1, timeout: 1_000 })
    }).toPass()
    await last.click()
    await expect(trigger).toHaveText(name)
  })

  test("transaction rows are two-line cards: the amount on the description's line, never wrapped alone", async ({ page }) => {
    const description = "Supermarket Grocery Store Weekly Shopping Downtown"
    await page.evaluate(async (description) => {
      const backend = (window as unknown as { __mockBackend: BackendAdapter }).__mockBackend
      const u = (await backend.auth.getCurrentUser())!.id
      const account = await backend.db.createAccount(u, { name: "Everyday Checking Account", type: "checking", currency: "EUR", balance: 0 })
      for (const [d, amount] of [[description, 1234567.89], ["Coffee", 4.5]] as const)
        await backend.db.createTransaction(u, { accountId: account.id, type: "expense", amount, currency: "EUR", description: d, date: new Date(), status: "pending" })
    }, description)
    await navigateTo(page, "Transactions", "/transactions")

    // Each row is an li in its day's card: the description is a button (it carries a Pending pill beside it,
    // so the amount is found by its sign and currency, not as the next sibling).
    const text = page.locator("main .md\\:hidden").getByText(description)
    const row = text.locator("xpath=ancestor::li[1]")
    const amount = row.getByText(/^[−+]?€/)
    const [t, a] = [(await text.boundingBox())!, (await amount.boundingBox())!]
    // One line, beside the description, inside the screen.
    expect(a.height).toBeLessThan(24)
    expect(Math.abs(a.y - t.y)).toBeLessThan(4)
    expect(a.x + a.width).toBeLessThanOrEqual(375)
    // The description keeps a real share of the row beside the Pending pill and a seven-figure amount
    // (it was cut to about 12 characters: that is under 70 px).
    expect(t.width).toBeGreaterThan(100)
    // No trash beside the amount on touch: swipe, or open the row.
    await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0)
  })

  test("a vertical scroll over a row never opens Delete; a swipe left does", async ({ page }) => {
    await page.evaluate(async () => {
      const backend = (window as unknown as { __mockBackend: BackendAdapter }).__mockBackend
      const u = (await backend.auth.getCurrentUser())!.id
      const account = await backend.db.createAccount(u, { name: "Checking", type: "checking", currency: "EUR", balance: 0 })
      for (let i = 0; i < 12; i++)
        await backend.db.createTransaction(u, { accountId: account.id, type: "expense", amount: 10 + i, currency: "EUR", description: `Row ${i}`, date: new Date() })
    })
    await navigateTo(page, "Transactions", "/transactions")
    // The first card, on screen: a touch past the viewport hits nothing.
    const row = (await page.locator("main .md\\:hidden").getByText(/^Row \d+$/).first().boundingBox())!
    const cdp = await page.context().newCDPSession(page)
    const drag = async (dx: number, dy: number) => {
      const [x, y] = [row.x + row.width / 2, row.y + row.height / 2]
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
      for (let k = 1; k <= 8; k++)
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * k) / 8, y: y + (dy * k) / 8 }] })
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    }
    // Up 160 px, drifting 90 px left: a scroll (a drag down from the top of the page has nothing to scroll).
    await drag(-90, -160)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    // The end state: the fling has settled (scrollY the same two frames apart), so a dialog the drag wrongly opened is up by now.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise((r) => {
              const y = window.scrollY
              requestAnimationFrame(() => requestAnimationFrame(() => r(window.scrollY === y)))
            }),
        ),
      )
      .toBe(true)
    await expect(page.getByRole("alertdialog")).toHaveCount(0)
    // Back to the top (momentum can overwrite one scrollTo), then straight left: Delete asks.
    await expect
      .poll(async () => {
        await page.evaluate(() => window.scrollTo(0, 0))
        return page.evaluate(() => window.scrollY)
      })
      .toBe(0)
    await drag(-120, 4)
    await expect(page.getByRole("alertdialog", { name: "Delete Transaction" })).toBeVisible()
  })

  test("Reports' Top Expenses shows every amount whole on a 360 px phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await page.evaluate(async () => {
      const backend = (window as unknown as { __mockBackend: BackendAdapter }).__mockBackend
      const u = (await backend.auth.getCurrentUser())!.id
      const account = await backend.db.createAccount(u, { name: "Checking", type: "checking", currency: "EUR", balance: 0 })
      for (const [description, amount] of [["Annual home insurance premium for the flat", 1100], ["Groceries", 85.4]] as const)
        await backend.db.createTransaction(u, { accountId: account.id, type: "expense", amount, currency: "EUR", description, date: new Date() })
    })
    await navigateTo(page, "Reports", "/reports")
    const table = page.getByRole("table").filter({ hasText: "Annual home insurance" })
    await expect(table).toBeVisible()
    // A 200 px description column pushed Amount past the card: "−€1,100.00" read "−€".
    const scroller = (await table.locator("xpath=..").boundingBox())!
    for (const cell of await table.locator("tbody tr td:last-child").all()) {
      const box = (await cell.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(scroller.x + scroller.width)
    }
    await expect(table.locator("tbody tr td:last-child").first()).toHaveText("−€1,100.00")
  })
})
