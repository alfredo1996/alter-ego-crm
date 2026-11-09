import { test, expect } from "@playwright/test"

import { signIn, navigateTo, uniqueName } from "./helpers/test-utils"

import type { Page } from "@playwright/test"

/**
 * A page must never show its empty state before its data. "No clients yet" or
 * "Account not found." for a moment, then the real content popping in, is the
 * bug this guards: the owner wants a spinner, then the page.
 *
 * The mock answers in a microtask, so each test seeds its data at full speed,
 * then gives every read 400 ms (window.__MOCK_LATENCY_MS__, see mock.ts) and
 * walks the pages through the sidebar while a MutationObserver records any
 * empty-state text the DOM ever held, even for one frame. The pages are
 * reached by client-side navigation, not reload, because the mock keeps its
 * data in module state and a reload wipes it and signs out. Pages share
 * queries, so earlier visits would have cached what the next one reads and
 * hidden a missing gate: every visit empties TanStack's cache first, so each
 * page loads from nothing, as after a reload.
 *
 * ponytail: every read waits the same 400 ms, so this catches a page with no
 * gate, not one section's read left out of it (it lands with the rest).
 * loading-states.test.tsx holds single reads back for those.
 */

const EMPTY_STATES = [
  "No clients yet",
  "No opportunities yet",
  "No active contracts",
  "Client not found.",
  "No contracts yet",
  "Unknown",
]

type Watched = Window & {
  __emptyStates?: string[]
  __MOCK_LATENCY_MS__?: number
  __clearQueryCache?: () => void
}

async function watchEmptyStates(page: Page) {
  await page.addInitScript((needles: string[]) => {
    const w = window as Watched
    new MutationObserver((records) => {
      if (!w.__emptyStates) return
      for (const r of records) {
        // characterData: React rewrote a text node in place, so its old value
        // was on screen too.
        const texts =
          r.type === "characterData"
            ? [r.oldValue ?? "", r.target.textContent ?? ""]
            : Array.from(r.addedNodes, (n) => n.textContent ?? "")
        for (const t of texts) {
          for (const n of needles) if (t.includes(n)) w.__emptyStates.push(`${location.pathname}: ${n}`)
        }
      }
    }).observe(document, { childList: true, subtree: true, characterData: true, characterDataOldValue: true })
  }, EMPTY_STATES)
}

/** From here on every read is slow and every empty state is recorded. */
async function slowDownAndWatch(page: Page) {
  await page.evaluate(() => {
    const w = window as Watched
    w.__MOCK_LATENCY_MS__ = 400
    w.__emptyStates = []
  })
}

/**
 * Forgets every cached query (see Providers), so the next page starts cold. It
 * cancels fetches in flight too, so call it only once the current page shows.
 */
async function clearQueryCache(page: Page) {
  await page.evaluate(() => {
    const clear = (window as Watched).__clearQueryCache
    if (!clear) throw new Error("window.__clearQueryCache is missing: the e2e server must run the mock backend")
    clear()
  })
}

async function visitCold(page: Page, link: string, url: string) {
  await clearQueryCache(page)
  await navigateTo(page, link, url)
}

async function emptyStatesSeen(page: Page) {
  return page.evaluate(() => (window as Watched).__emptyStates)
}

test.describe("Loading states", () => {
  test.beforeEach(async ({ page }) => {
    await watchEmptyStates(page)
    await signIn(page)
  })

  test("pages never show an empty state before their data", async ({ page }) => {
    await navigateTo(page, "Pipeline", "/pipeline")

    const clientName = uniqueName("Loading Cliente")
    const title = uniqueName("Loading Deal")
    await page.getByRole("button", { name: /new opportunity/i }).click()
    const form = page.getByRole("dialog", { name: "New Opportunity" })
    await page.getByRole("combobox").filter({ hasText: "Choose or type a client" }).first().click()
    await page.getByPlaceholder(/search or type a new name/i).fill(clientName)
    await page.getByRole("option").filter({ hasText: clientName }).first().click()
    await form.getByLabel("Title").fill(title)
    await form.getByRole("button", { name: /^create opportunity$/i }).click()
    await expect(form).toBeHidden()
    // Winning it makes a contract. /plan below loads the contracts cold, so
    // "No active contracts" can only show if the page renders before they arrive.
    await page.getByRole("button", { name: "Won" }).first().click()
    const contract = page.getByRole("dialog", { name: "Create Contract" })
    await contract.getByRole("button", { name: /^create contract$/i }).click()
    await expect(contract).toBeHidden()

    await slowDownAndWatch(page)

    await visitCold(page, "Plan", "/plan")
    await expect(page.getByText(clientName).first()).toBeVisible()

    for (const [link, url] of [
      ["Deadlines", "/deadlines"],
      ["Tasks", "/tasks"],
      ["Invoices", "/invoices"],
    ] as const) {
      await visitCold(page, link, url)
      await expect(page.getByRole("heading", { name: link, level: 1 })).toBeVisible()
    }

    await visitCold(page, "Clients", "/clients")
    const clientLink = page.getByRole("heading", { name: clientName }).getByRole("link")
    // Clearing mid-load would cancel the list's own fetch: wait for it first.
    await expect(clientLink).toBeVisible()
    await clearQueryCache(page)
    await clientLink.click()
    await expect(page.getByRole("heading", { name: clientName, level: 1 })).toBeVisible()

    await visitCold(page, "Pipeline", "/pipeline")
    await expect(page.getByText(title).first()).toBeVisible()

    expect(await emptyStatesSeen(page)).toEqual([])
  })
})
